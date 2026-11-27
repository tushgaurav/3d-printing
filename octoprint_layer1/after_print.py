# coding=utf-8
"""After Print: what happens when a print finishes.

Two actions are remembered and run after every print that finishes:
    coolDown   heaters, part fan and motors off (a safety net for slicer end G-code)
    lowerBed   drop the bed and park the head at the back, so the part is easy to reach
One is switched on for a single print and then clears itself:
    shutdown   shut the Pi down a little after the print finishes, with a countdown
               the screen can cancel. The heaters go off first, whatever coolDown says.

These run here in the plugin rather than in the screen, so they still happen when the
screen is asleep, locked or showing something else, or when the print was started from
a phone. Only a print that finishes counts: a stopped or failed print runs nothing and
clears the shutdown, since someone is probably at the printer.

Screens get the state from GET /plugin/layer1/after-print and then as plugin messages
({"afterPrint": state}) whenever it changes.
"""
from __future__ import absolute_import, unicode_literals

import io
import json
import os
import subprocess
import threading
import time

REMEMBERED = ("coolDown", "lowerBed")
Z_FEED = 600  # mm/min; the firmware lowers these to its own limits
XY_FEED = 6000


class AfterPrint(object):
    def __init__(self, path, printer, config, shutdown_command, notify, logger):
        """
        path: JSON file for the remembered choices.
        config(): the merged Layer1 config (defaults.json + the user's config.json).
        shutdown_command(): OctoPrint's configured shutdown command, "" when there is none.
        notify(state): push a new state to the screens.
        """
        self._path = path
        self._printer = printer
        self._config = config
        self._shutdown_command = shutdown_command
        self._notify = notify
        self._logger = logger
        self._lock = threading.RLock()
        self._saved = self._read()
        self._shutdown = False  # switched on for the next print that finishes
        self._pending_at = None  # time.time() the Pi shuts down at, during the countdown
        self._timer = None
        self._error = None  # why the last shutdown didn't happen, for the screen

    # ~~ state

    def _options(self):
        options = self._config().get("afterPrint")
        return options if isinstance(options, dict) else {}

    def _delay(self):
        try:
            return max(10, int(self._options().get("shutdownSeconds", 60)))
        except (TypeError, ValueError):
            return 60

    def state(self):
        with self._lock:
            options = self._options()
            state = {key: bool(self._saved.get(key, options.get(key, True))) for key in REMEMBERED}
            state.update({
                "shutdown": self._shutdown,
                "canShutdown": bool(self._shutdown_command()),
                "shutdownSeconds": self._delay(),
                "lowerBedBy": options.get("lowerBedBy", 100),
                "pending": None,
                "error": self._error,
            })
            if self._pending_at is not None:
                state["pending"] = {"action": "shutdown", "seconds": max(0, int(round(self._pending_at - time.time())))}
            return state

    def update(self, patch, can_system):
        """Apply a change from a screen. Raises PermissionError or ValueError without changing anything."""
        if not isinstance(patch, dict):
            raise ValueError("Expected a JSON object")
        if patch.get("shutdown") or patch.get("now"):
            if not can_system:
                raise PermissionError("This screen's key may not shut down the Pi")
            if not self._shutdown_command():
                raise ValueError("No shutdown command is set in OctoPrint (Settings → Server → Commands)")
        with self._lock:
            remembered = [key for key in REMEMBERED if key in patch]
            for key in remembered:
                self._saved[key] = bool(patch[key])
            if remembered:
                self._write()
            if "shutdown" in patch:
                self._shutdown = bool(patch["shutdown"])
                self._error = None
            if patch.get("cancel") and self._cancel():
                self._logger.info("After Print: shutdown cancelled from a screen")
            now = bool(patch.get("now")) and self._pending_at is not None
        if now:
            # off the request thread: the shutdown command can take a moment to return
            thread = threading.Thread(target=self._fire, name="layer1-shutdown")
            thread.daemon = True
            thread.start()
        else:
            self._push()
        return self.state()

    # ~~ events

    def on_event(self, event, payload):
        if event == "PrintStarted":
            with self._lock:
                cancelled = self._cancel()
            if cancelled:
                self._logger.info("After Print: a new print started, so the Pi stays on")
                self._push()
        elif event == "PrintDone":
            self._run()
        elif event in ("PrintFailed", "PrintCancelled"):
            with self._lock:
                was = self._shutdown
                self._shutdown = False
            if was:
                self._push()

    def _run(self):
        state = self.state()
        commands = []
        if state["lowerBed"]:
            commands += self._lower_bed()
        if state["coolDown"] or state["shutdown"]:
            commands += ["M104 S0", "M140 S0", "M107"]
        if state["coolDown"]:
            commands.append("M84")  # Marlin finishes the moves above first
        if commands:
            self._logger.info("After Print: %s", " | ".join(commands))
            self._printer.commands(commands)
        if state["shutdown"]:
            with self._lock:
                self._shutdown = False
                self._error = None
                self._cancel()
                delay = self._delay()
                self._pending_at = time.time() + delay
                self._timer = threading.Timer(delay, self._fire)
                self._timer.daemon = True
                self._timer.start()
            self._logger.info("After Print: shutting down the Pi in %d s", delay)
        self._push()

    def _lower_bed(self):
        """The bed moves down (Z up) by lowerBedBy, never past the bottom, then the head parks at the back."""
        config = self._config()
        volume = (config.get("printer") or {}).get("buildVolume") or [220, 220, 300]
        width, depth, height = (float(v) for v in volume[:3])
        try:
            drop = float(self._options().get("lowerBedBy", 100))
        except (TypeError, ValueError):
            drop = 100.0
        z = None
        try:
            z = (self._printer.get_current_data() or {}).get("currentZ")
        except Exception:
            pass
        if isinstance(z, (int, float)) and z >= 0:
            drop = min(drop, height - z)
        commands = []
        if drop > 0:
            commands += ["G91", "G1 Z%g F%d" % (round(drop, 2), Z_FEED)]
        commands += ["G90", "G1 X%g Y%g F%d" % (width, depth, XY_FEED)]
        return commands

    # ~~ shutdown

    def _cancel(self):
        """Stop a countdown. Call with the lock held. True if one was running."""
        if self._timer is not None:
            self._timer.cancel()
            self._timer = None
        was = self._pending_at is not None
        self._pending_at = None
        return was

    def _fire(self):
        with self._lock:
            if self._pending_at is None:
                return  # cancelled while the timer was going off
            self._cancel()
        if self._printer.is_printing() or self._printer.is_paused():
            self._logger.info("After Print: the printer is busy again, so the Pi stays on")
            self._push()
            return
        command = self._shutdown_command()
        if not command:
            with self._lock:
                self._error = "No shutdown command is set in OctoPrint"
            self._logger.error("After Print: %s", self._error)
            self._push()
            return
        self._logger.info("After Print: shutting down the Pi: %s", command)
        error = None
        try:
            # OctoPrint's own configured command, run the way OctoPrint runs it (a shell line)
            result = subprocess.run(command, shell=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=30)
            if result.returncode != 0:
                output = result.stdout.decode("utf-8", "replace").strip()
                error = output.splitlines()[-1] if output else "exit code %d" % result.returncode
        except (OSError, subprocess.SubprocessError) as e:
            error = str(e)
        if error:
            self._logger.error("After Print: shutdown failed: %s", error)
            with self._lock:
                self._error = error
        self._push()

    # ~~ storage and push

    def _push(self):
        try:
            self._notify(self.state())
        except Exception:
            self._logger.exception("After Print: could not update the screens")

    def _read(self):
        try:
            with io.open(self._path, encoding="utf-8") as f:
                data = json.load(f)
            return {key: bool(data[key]) for key in REMEMBERED if key in data} if isinstance(data, dict) else {}
        except (IOError, OSError, ValueError):
            return {}

    def _write(self):
        try:
            with io.open(self._path, "w", encoding="utf-8") as f:
                f.write(json.dumps(self._saved, indent=2))
        except (IOError, OSError) as e:
            self._logger.warning("Could not write %s: %s", self._path, e)
