# coding=utf-8
"""Ender 5 Touch: a full-screen touch UI for OctoPrint, sized for a 480x320 screen.

The plugin only serves a static single-page app and a small JSON config. All
printer control happens in the browser through OctoPrint's normal REST and push
APIs, authenticated with an application key, so nothing here bypasses
OctoPrint's own permission checks.
"""
from __future__ import absolute_import, unicode_literals

import copy
import io
import json
import os

import flask
import octoprint.plugin


def _deep_merge(base, override):
    """Return base updated with override; nested dicts merge, everything else replaces."""
    result = copy.deepcopy(base)
    for key, value in (override or {}).items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = value
    return result


class Ender5TouchPlugin(octoprint.plugin.BlueprintPlugin):
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
        response = flask.make_response(json.dumps(merged))
        response.headers["Content-Type"] = "application/json"
        response.headers["Cache-Control"] = "no-store"
        return response


__plugin_name__ = "Ender 5 Touch"
__plugin_description__ = "Full-screen touch UI for an Ender 5 Pro on a small Raspberry Pi screen"
__plugin_pythoncompat__ = ">=3.7,<4"
__plugin_implementation__ = Ender5TouchPlugin()
