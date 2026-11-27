# coding=utf-8
"""Layer1: a full-screen touch UI for OctoPrint, made for small touch screens.

The plugin serves a static single-page app, its config (OctoPrint's settings for
the plugin, edited in Settings > Layer1), a read-only Pi health summary for the
quick-info panel, and the print history it records from OctoPrint's print events.
Inside OctoPrint's own UI it adds a setup page (Settings, and a first-run wizard
step) that links to the touch UI, lists the steps for putting it on the Pi's
screen and, in Settings, edits the config.

Printer control happens in the browser through OctoPrint's normal REST and push
APIs, authenticated with an application key. The one exception is After Print
(after_print.py), which runs here so it works without a screen; its settings
routes check OctoPrint's permissions like the API.
"""
from __future__ import absolute_import, unicode_literals

import copy
import io
import json
import os
import threading

import flask
import octoprint.plugin
from octoprint.access.permissions import Permissions

from . import after_print, history, sysinfo

# What the printer keys fall back to when the settings leave them empty and OctoPrint's
# printer profile can't be read: the values of OctoPrint's own default profile.
PROFILE_FALLBACK = {"name": "Printer", "buildVolume": [200, 200, 200], "origin": "lowerleft"}

# Not imported from an old config.json: they come from OctoPrint's printer profile now, and
# the old file was a full copy of the old defaults, which held one particular printer's numbers.
NOT_IMPORTED = (("printer", "buildVolume"), ("printer", "origin"))


def _changes(defaults, data, path=()):
    """(keys, value) for every value in data that differs from defaults. Dicts are compared
    key by key, anything else (numbers, strings, lists) as a whole. Keys that defaults
    doesn't have are skipped, since OctoPrint's settings only keep known keys."""
    for key, value in data.items():
        if key not in defaults:
            continue
        keys = path + (key,)
        default = defaults[key]
        if isinstance(default, dict):
            if isinstance(value, dict):
                for change in _changes(default, value, keys):
                    yield change
        elif value != default and keys not in NOT_IMPORTED:
            yield list(keys), value


def _json_response(data):
    response = flask.make_response(json.dumps(data))
    response.headers["Content-Type"] = "application/json"
    response.headers["Cache-Control"] = "no-store"
    return response


class Layer1Plugin(
    octoprint.plugin.AssetPlugin,
    octoprint.plugin.BlueprintPlugin,
    octoprint.plugin.EventHandlerPlugin,
    octoprint.plugin.SettingsPlugin,
    octoprint.plugin.StartupPlugin,
    octoprint.plugin.TemplatePlugin,
    octoprint.plugin.WizardPlugin,
):
    def initialize(self):
        self._history = history.PrintHistory(
            os.path.join(self.get_plugin_data_folder(), "history.json"),
            seed=self._octoprint_print_logs,
            logger=self._logger,
        )
        self._after_print = after_print.AfterPrint(
            os.path.join(self.get_plugin_data_folder(), "after_print.json"),
            printer=self._printer,
            config=self._ui_config,
            shutdown_command=lambda: (self._settings.global_get(["server", "commands", "systemShutdownCommand"]) or "").strip(),
            notify=lambda state: self._plugin_manager.send_plugin_message(self._identifier, {"afterPrint": state}),
            logger=self._logger,
        )

    def _octoprint_print_logs(self):
        """(path, runs) for every local G-code file: OctoPrint's own per-file print log."""
        for path in history.gcode_files(self._settings.global_get_basefolder("uploads")):
            try:
                meta = self._file_manager.get_metadata("local", path) or {}
            except Exception:
                continue
            yield path, meta.get("history") or []

    def _static_dir(self):
        return os.path.join(self._basefolder, "static")

    def _load_defaults(self):
        with io.open(os.path.join(self._static_dir(), "defaults.json"), encoding="utf-8") as f:
            return json.load(f)

    # ~~ SettingsPlugin: the config lives in OctoPrint's settings (config.yaml, plugins.layer1),
    # edited in Settings > Layer1. Keys the form leaves out can still be set in config.yaml.

    def get_settings_defaults(self):
        # The touch UI reads the same file for demo mode and when the plugin isn't there
        return self._load_defaults()

    def on_settings_save(self, data):
        diff = octoprint.plugin.SettingsPlugin.on_settings_save(self, data)
        # Screens read the config once, when they load, so tell them to load it again.
        # (Older OctoPrint returns None here instead of what changed.)
        if diff is None or diff:
            self._plugin_manager.send_plugin_message(self._identifier, {"configChanged": True})
        return diff

    def on_settings_initialized(self):
        try:
            self._import_config_json()
        except Exception:
            self._logger.exception("Could not import the old config.json")

    def _import_config_json(self):
        """Layer1 used to keep its settings in config.json in its data folder. Copy what
        differs from the defaults into OctoPrint's settings once, then set the file aside,
        so this runs only while the file is there."""
        path = os.path.join(self.get_plugin_data_folder(), "config.json")
        if not os.path.exists(path):
            return
        try:
            with io.open(path, encoding="utf-8") as f:
                data = json.load(f)
        except (IOError, OSError, ValueError) as e:
            self._logger.warning("Not importing %s, it could not be read as JSON: %s", path, e)
            data = None
        imported = []
        if isinstance(data, dict):
            for keys, value in _changes(self.get_settings_defaults(), data):
                self._settings.set(keys, value)
                imported.append(".".join(keys))
            if imported:
                self._settings.save()
        done = path + ".imported"
        os.replace(path, done)
        self._logger.info(
            "Imported %s from %s into OctoPrint's settings, and renamed it to %s",
            ", ".join(imported) or "nothing", path, done,
        )

    def _fill_from_profile(self, printer):
        """Fill the printer keys the settings leave empty from OctoPrint's printer profile
        (the connected printer's, else the default one), so the screen matches whatever
        printer OctoPrint drives without any Layer1 setup."""
        if all(printer.get(key) for key in PROFILE_FALLBACK):
            return
        try:
            profile = self._printer_profile_manager.get_current_or_default() or {}
        except Exception:
            self._logger.exception("Could not read OctoPrint's printer profile")
            profile = {}
        volume = profile.get("volume") or {}
        size = [volume.get(key) for key in ("width", "depth", "height")]
        found = {
            "name": profile.get("name"),
            "buildVolume": size if all(size) else None,
            "origin": volume.get("origin"),
        }
        for key, fallback in PROFILE_FALLBACK.items():
            if not printer.get(key):
                printer[key] = found[key] or fallback

    def _ui_config(self):
        """The plugin's settings over the defaults, with the printer filled in from its profile."""
        config = copy.deepcopy(self._settings.get_all_data(merged=True) or {})
        if not isinstance(config.get("printer"), dict):
            config["printer"] = {}
        self._fill_from_profile(config["printer"])
        return config

    # ~~ StartupPlugin

    def on_after_startup(self):
        # The first load imports OctoPrint's earlier print logs; do it now, in the
        # background, so a big file library doesn't slow the first History page.
        thread = threading.Thread(target=self._history.load, name="layer1-history")
        thread.daemon = True
        thread.start()

    # ~~ Setup page: the setup steps, shown in OctoPrint's Settings (with the settings form
    # below them) and as a setup wizard step

    def get_assets(self):
        return {"js": ["octoprint/layer1_setup.js"]}

    def get_template_configs(self):
        return [
            {"type": "settings", "template": "layer1_settings.jinja2", "custom_bindings": True},
            {"type": "wizard", "template": "layer1_setup.jinja2", "custom_bindings": True},
        ]

    def is_template_autoescaped(self):
        # OctoPrint 2.1 makes this the only option; until then it logs a warning without it
        return True

    def is_wizard_required(self):
        # The wizard walks through installing the kiosk, so skip it on Pis that have one.
        # Elsewhere OctoPrint shows it once per wizard version.
        return not os.path.exists(sysinfo.KIOSK_UNIT)

    def get_wizard_version(self):
        return 1

    # ~~ EventHandlerPlugin

    def on_event(self, event, payload):
        if event in history.EVENTS:
            try:
                self._history.record(event, payload)
            except Exception:
                self._logger.exception("Could not add %s to the print history", event)
        try:
            self._after_print.on_event(event, payload)
        except Exception:
            self._logger.exception("After Print failed on %s", event)

    # ~~ BlueprintPlugin

    def get_blueprint_kwargs(self):
        return {
            "static_folder": self._static_dir(),
            "static_url_path": "/static",
        }

    def is_blueprint_protected(self):
        # The page and its assets are public so the kiosk browser can load them
        # before it has been paired. Every API call the page makes still needs
        # an application key.
        return False

    def is_blueprint_csrf_protected(self):
        # POSTs from the screen carry its API key, which OctoPrint exempts from CSRF checks
        return True

    @octoprint.plugin.BlueprintPlugin.route("/", methods=["GET"])
    def index(self):
        return flask.redirect(flask.url_for(".static", filename="index.html"))

    @octoprint.plugin.BlueprintPlugin.route("/config", methods=["GET"])
    def ui_config(self):
        return _json_response(self._ui_config())

    @octoprint.plugin.BlueprintPlugin.route("/sysinfo", methods=["GET"])
    @Permissions.STATUS.require(403)
    def system_info(self):
        # The blueprint is public (see above), so this route checks for itself: it needs
        # the screen's application key, like every OctoPrint API call the page makes.
        return _json_response(sysinfo.collect(self._settings.global_get_basefolder("uploads")))

    @octoprint.plugin.BlueprintPlugin.route("/setup", methods=["GET"])
    @Permissions.SETTINGS.require(403)
    def setup_status(self):
        # For the setup page. Whether the screen is paired comes from OctoPrint's appkeys API.
        return _json_response({"kiosk": sysinfo.kiosk()})

    @octoprint.plugin.BlueprintPlugin.route("/history", methods=["GET"])
    @Permissions.STATUS.require(403)
    def print_history(self):
        # Newest first. ?limit=N (default 100) caps the list; the totals cover every entry.
        try:
            limit = max(1, min(history.MAX_ENTRIES, int(flask.request.args.get("limit", 100))))
        except ValueError:
            limit = 100
        entries = self._history.entries()
        return _json_response({
            "entries": entries[:limit],
            "total": len(entries),
            "stats": history.summarize(entries),
        })

    @octoprint.plugin.BlueprintPlugin.route("/after-print", methods=["GET"])
    @Permissions.STATUS.require(403)
    def after_print_state(self):
        return _json_response(self._after_print.state())

    @octoprint.plugin.BlueprintPlugin.route("/after-print", methods=["POST"])
    @Permissions.CONTROL.require(403)
    def after_print_update(self):
        # {"coolDown"|"lowerBed"|"shutdown": bool} changes a choice; {"cancel": true} stops a
        # shutdown countdown, {"now": true} skips it. Switching shutdown on needs SYSTEM too.
        patch = flask.request.get_json(silent=True)
        try:
            state = self._after_print.update(patch, can_system=Permissions.SYSTEM.can())
        except PermissionError as e:
            return flask.make_response(json.dumps({"error": str(e)}), 403, {"Content-Type": "application/json"})
        except ValueError as e:
            return flask.make_response(json.dumps({"error": str(e)}), 409, {"Content-Type": "application/json"})
        return _json_response(state)

    # ~~ Software Update hook

    def get_update_information(self):
        # OctoPrint compares the newest GitHub release's tag (e.g. "0.3.0", no "v")
        # with the installed version, and installs updates with pip from the tag's
        # source zip.
        return {
            "layer1": {
                "displayName": "Layer1",
                "displayVersion": self._plugin_version,
                "type": "github_release",
                "user": "tushgaurav",
                "repo": "layer1",
                "current": self._plugin_version,
                "pip": "https://github.com/tushgaurav/layer1/archive/{target_version}.zip",
            }
        }


__plugin_name__ = "Layer1"
__plugin_description__ = "Full-screen touch UI for any printer, on a small Raspberry Pi screen"
__plugin_author__ = "Tushar Gaurav"
__plugin_url__ = "https://layer1.nodebench.com"
__plugin_license__ = "AGPLv3"
__plugin_pythoncompat__ = ">=3.9,<4"
__plugin_implementation__ = Layer1Plugin()
__plugin_hooks__ = {
    "octoprint.plugin.softwareupdate.check_config": __plugin_implementation__.get_update_information,
}
