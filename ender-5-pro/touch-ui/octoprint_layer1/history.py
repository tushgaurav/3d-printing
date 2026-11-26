# coding=utf-8
"""Print history for the History page: one entry for every print that ended.

OctoPrint itself keeps a short run log per file. That log is lost when the file is
deleted, and it can't tell a stopped print from a failed one. So Layer1 keeps its
own list in the plugin's data folder, fed by OctoPrint's print events. The first
time the list is loaded it is seeded from OctoPrint's per-file logs, so prints made
before Layer1 was installed show up too.

An entry looks like:
    {"id": 7, "path": "parts/clip.gcode", "name": "clip.gcode", "origin": "local",
     "end": 1732600000.0, "duration": 1312.5, "result": "done"}
result is "done", "failed", "cancelled", or "unfinished" (seeded from OctoPrint, which
records stopped and failed prints the same way). A failed print may carry "error".
"""
from __future__ import absolute_import, unicode_literals

import io
import json
import os
import threading
import time

MAX_ENTRIES = 500
GCODE_EXTENSIONS = (".gcode", ".gco", ".g")
EVENTS = ("PrintDone", "PrintFailed", "PrintCancelled")

# PrintCancelled is followed by PrintFailed (reason "cancelled") for the same print,
# and a seeded entry for the print that just ended can land a moment before its
# event. Either way it is the same print if it ended within this many seconds.
SAME_PRINT_SECONDS = 15


def gcode_files(root):
    """Relative paths ("a/b.gcode") of every G-code file under root, skipping hidden ones."""
    for folder, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if not d.startswith(".")]
        for name in files:
            if name.startswith(".") or not name.lower().endswith(GCODE_EXTENSIONS):
                continue
            rel = os.path.relpath(os.path.join(folder, name), root)
            yield rel.replace(os.sep, "/")


def _number(value):
    try:
        value = float(value)
    except (TypeError, ValueError):
        return None
    return value if value >= 0 else None


def summarize(entries):
    """Totals for the History page header."""
    counts = {result: 0 for result in ("done", "failed", "cancelled", "unfinished")}
    seconds = 0.0
    for entry in entries:
        if entry.get("result") in counts:
            counts[entry["result"]] += 1
        seconds += entry.get("duration") or 0
    return {"prints": len(entries), "seconds": round(seconds), "results": counts}


class PrintHistory(object):
    def __init__(self, path, seed=None, logger=None):
        """seed: optional callable returning (path, octoprint_history_list) pairs."""
        self._path = path
        self._seed = seed
        self._logger = logger
        self._lock = threading.RLock()
        self._data = None

    # ~~ reading

    def entries(self):
        """All entries, newest first."""
        with self._lock:
            return [dict(e) for e in reversed(self._load()["entries"])]

    def load(self):
        """Load (and on first run, seed) the history now rather than on first use."""
        with self._lock:
            self._load()

    # ~~ recording

    def record(self, event, payload, now=None):
        """Add the print an OctoPrint event reports as ended. Returns the entry, or None."""
        payload = payload or {}
        if event == "PrintDone":
            result = "done"
        elif event == "PrintCancelled":
            result = "cancelled"
        elif event == "PrintFailed":
            result = "cancelled" if payload.get("reason") == "cancelled" else "failed"
        else:
            return None

        path = payload.get("path") or payload.get("name")
        if not path:
            return None
        now = time.time() if now is None else now
        entry = {
            "path": path,
            "name": payload.get("name") or path.rsplit("/", 1)[-1],
            "origin": payload.get("origin") or "local",
            "end": round(now, 1),
            "duration": _number(payload.get("time")),
            "result": result,
        }
        if result == "failed" and payload.get("error"):
            entry["error"] = str(payload["error"])[:200]

        with self._lock:
            data = self._load()
            entries = data["entries"]
            for i in range(len(entries) - 1, max(-1, len(entries) - 6), -1):
                old = entries[i]
                if old.get("path") != path or abs((old.get("end") or 0) - now) > SAME_PRINT_SECONDS:
                    continue
                if old.get("seeded"):
                    # OctoPrint's own log of this print got in first: keep our richer copy
                    entry["id"] = old["id"]
                    entries[i] = entry
                    self._save()
                    return entry
                if old.get("result") == result:
                    return None  # the PrintFailed that follows PrintCancelled
            entry["id"] = data["next_id"]
            data["next_id"] += 1
            entries.append(entry)
            del entries[:-MAX_ENTRIES]
            self._save()
            return entry

    # ~~ storage

    def _load(self):
        if self._data is not None:
            return self._data
        data = None
        if os.path.exists(self._path):
            try:
                with io.open(self._path, encoding="utf-8") as f:
                    data = json.load(f)
            except (IOError, OSError, ValueError) as e:
                self._log("error", "Could not read %s, starting a new history: %s", self._path, e)
                try:
                    os.replace(self._path, self._path + ".bad")  # keep it for a human to look at
                except OSError:
                    pass
        if not isinstance(data, dict) or not isinstance(data.get("entries"), list):
            data = {"version": 1, "seeded": False, "next_id": 1, "entries": []}
        data.setdefault("next_id", max([e.get("id", 0) for e in data["entries"]] + [0]) + 1)
        self._data = data
        if not data.get("seeded"):
            self._seed_from_octoprint()
        return data

    def _seed_from_octoprint(self):
        data = self._data
        seeded = []
        if self._seed:
            try:
                for path, runs in self._seed():
                    for run in runs or []:
                        end = _number(run.get("timestamp")) if isinstance(run, dict) else None
                        if not end:
                            continue
                        seeded.append({
                            "path": path,
                            "name": path.rsplit("/", 1)[-1],
                            "origin": "local",
                            "end": round(end, 1),
                            "duration": _number(run.get("printTime")),
                            "result": "done" if run.get("success") else "unfinished",
                            "seeded": True,
                        })
            except Exception as e:  # a broken metadata file must never stop the plugin
                self._log("warning", "Could not read OctoPrint's print logs: %s", e)
        seeded.sort(key=lambda e: e["end"])
        for entry in seeded[-MAX_ENTRIES:]:
            entry["id"] = data["next_id"]
            data["next_id"] += 1
        data["entries"] = sorted(seeded[-MAX_ENTRIES:] + data["entries"], key=lambda e: e.get("end") or 0)[-MAX_ENTRIES:]
        data["seeded"] = True
        self._save()
        if seeded:
            self._log("info", "Print history: imported %d earlier prints from OctoPrint", len(seeded))

    def _save(self):
        tmp = self._path + ".tmp"
        try:
            with io.open(tmp, "w", encoding="utf-8") as f:
                f.write(json.dumps(self._data, indent=1))
            os.replace(tmp, self._path)
        except (IOError, OSError) as e:
            self._log("error", "Could not save the print history to %s: %s", self._path, e)

    def _log(self, level, msg, *args):
        if self._logger:
            getattr(self._logger, level)(msg, *args)
