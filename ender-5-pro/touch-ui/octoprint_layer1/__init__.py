# coding=utf-8
"""Layer1: a full-screen touch UI for OctoPrint, sized for a 480x320 screen.

The plugin serves a static single-page app, a small JSON config, a read-only
Pi health summary for the quick-info panel, and the print history it records
from OctoPrint's print events. All printer control happens in the browser
through OctoPrint's normal REST and push APIs, authenticated with an
application key, so nothing here bypasses OctoPrint's own permission checks.
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

from . import history, sysinfo


def _deep_merge(base, override):
    """Return base updated with override; nested dicts merge, everything else replaces."""
    result = copy.deepcopy(base)
    for key, value in (override or {}).items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = value
    return result


def _json_response(data):
    response = flask.make_response(json.dumps(data))
    response.headers["Content-Type"] = "application/json"
    response.headers["Cache-Control"] = "no-store"
    return response


class Layer1Plugin(
    octoprint.plugin.BlueprintPlugin,
    octoprint.plugin.EventHandlerPlugin,
    octoprint.plugin.StartupPlugin,
):
    def initialize(self):
        self._history = history.PrintHistory(
            os.path.join(self.get_plugin_data_folder(), "history.json"),
            seed=self._octoprint_print_logs,
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

    def _user_config_path(self):
        return os.path.join(self.get_plugin_data_folder(), "config.json")

    def _load_defaults(self):
        with io.open(os.path.join(self._static_dir(), "defaults.json"), encoding="utf-8") as f:
            return json.load(f)

    def _load_user_config(self, defaults):
        path = self._user_config_path()
        if not os.path.exists(path):
            # First run: drop a full copy of the defaults where the user can edit it.
            try:
                with io.open(path, "w", encoding="utf-8") as f:
                    f.write(json.dumps(defaults, indent=2))
            except (IOError, OSError) as e:
                self._logger.warning("Could not write %s: %s", path, e)
            return {}
        try:
            with io.open(path, encoding="utf-8") as f:
                data = json.load(f)
            return data if isinstance(data, dict) else {}
        except (IOError, OSError, ValueError) as e:
            self._logger.error("Ignoring %s, it could not be read as JSON: %s", path, e)
            return {}

    # ~~ StartupPlugin

    def on_after_startup(self):
        # The first load imports OctoPrint's earlier print logs; do it now, in the
        # background, so a big file library doesn't slow the first History page.
        thread = threading.Thread(target=self._history.load, name="layer1-history")
        thread.daemon = True
        thread.start()

    # ~~ EventHandlerPlugin

    def on_event(self, event, payload):
        if event in history.EVENTS:
            try:
                self._history.record(event, payload)
            except Exception:
                self._logger.exception("Could not add %s to the print history", event)

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

    @octoprint.plugin.BlueprintPlugin.route("/", methods=["GET"])
    def index(self):
        return flask.redirect(flask.url_for(".static", filename="index.html"))

    @octoprint.plugin.BlueprintPlugin.route("/config", methods=["GET"])
    def ui_config(self):
        defaults = self._load_defaults()
        merged = _deep_merge(defaults, self._load_user_config(defaults))
        return _json_response(merged)

    @octoprint.plugin.BlueprintPlugin.route("/sysinfo", methods=["GET"])
    @Permissions.STATUS.require(403)
    def system_info(self):
        # The blueprint is public (see above), so this route checks for itself: it needs
        # the screen's application key, like every OctoPrint API call the page makes.
        return _json_response(sysinfo.collect(self._settings.global_get_basefolder("uploads")))

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

    # ~~ Software Update hook

    def get_update_information(self):
        # OctoPrint compares the newest GitHub release's tag (e.g. "0.3.0", no "v")
        # with the installed version, and installs updates with pip from the tag's
        # source zip. The plugin lives in a sub-folder of the repo, hence #subdirectory.
        return {
            "layer1": {
                "displayName": "Layer1",
                "displayVersion": self._plugin_version,
                "type": "github_release",
                "user": "tushgaurav",
                "repo": "layer1",
                "current": self._plugin_version,
                "pip": "https://github.com/tushgaurav/layer1/archive/{target_version}.zip"
                "#subdirectory=ender-5-pro/touch-ui",
            }
        }


__plugin_name__ = "Layer1"
__plugin_description__ = "Full-screen touch UI for an Ender 5 Pro on a small Raspberry Pi screen"
__plugin_author__ = "Tushar Gaurav"
__plugin_url__ = "https://layer1.nodebench.com"
__plugin_license__ = "AGPLv3"
__plugin_pythoncompat__ = ">=3.9,<4"
__plugin_implementation__ = Layer1Plugin()
__plugin_hooks__ = {
    "octoprint.plugin.softwareupdate.check_config": __plugin_implementation__.get_update_information,
}
