# coding=utf-8
"""Maintenance: jobs like oiling the Z screw that come round every so many hours of printing.

The tasks and how often they come round are in the settings (maintenance.tasks, a list of
{"name": "Lubricate Z screw", "hours": 100}, edited in Settings > Layer1). The hours printed
since each was last done come from the print history (history.py), so all this keeps is
when each task's count started, in maintenance.json in the plugin's data folder:
    {"Lubricate Z screw": {"since": 1732600000.0, "done": 1732600000.0}}
since is when the task was last marked done or, before that, when Layer1 first saw it in
the settings, so a new task (or a new install with a long history) starts at 0 h rather
than overdue. done is when it was last marked done, if it ever was. Tasks are matched by
name, so renaming one starts its count again.

Screens get the state from GET /plugin/layer1/maintenance, and then as a plugin message
({"maintenance": state}) whenever a print ends or a task is marked done.
"""
from __future__ import absolute_import, unicode_literals

import io
import json
import os
import threading
import time

# A task is "soon" once this share of its interval has been printed
SOON = 0.9


def _number(value):
    try:
        value = float(value)
    except (TypeError, ValueError):
        return None
    return value if value >= 0 else None


def printed_since(entries, since):
    """Seconds printed after `since`, from history entries. A print that was running at
    `since` counts only for the part of it after then."""
    total = 0.0
    for entry in entries:
        end = _number(entry.get("end"))
        duration = _number(entry.get("duration"))
        if end is None or not duration or end <= since:
            continue
        total += min(duration, end - since)
    return total


class Maintenance(object):
    def __init__(self, path, entries, config, notify, logger):
        """
        path: JSON file for when each task's count started.
        entries(): the print history's entries (see history.PrintHistory.entries).
        config(): the merged Layer1 config.
        notify(state): push a new state to the screens.
        """
        self._path = path
        self._entries = entries
        self._config = config
        self._notify = notify
        self._logger = logger
        self._lock = threading.RLock()
        self._saved = self._read()

    def tasks(self):
        """[(name, hours)] from the settings, skipping blank names, repeats and bad intervals."""
        options = self._config().get("maintenance")
        listed = options.get("tasks") if isinstance(options, dict) else None
        tasks = []
        seen = set()
        for task in listed if isinstance(listed, list) else []:
            if not isinstance(task, dict):
                continue
            name = str(task.get("name") or "").strip()
            hours = _number(task.get("hours"))
            if not name or name in seen or not hours:
                continue
            seen.add(name)
            tasks.append((name, hours))
        return tasks

    def state(self):
        tasks = self.tasks()
        entries = self._entries()
        now = time.time()
        out = []
        with self._lock:
            started = False
            for name, hours in tasks:
                record = self._saved.get(name)
                if not isinstance(record, dict) or _number(record.get("since")) is None:
                    record = {"since": round(now, 1)}
                    self._saved[name] = record
                    started = True
                printed = printed_since(entries, record["since"])
                limit = hours * 3600
                out.append({
                    "name": name,
                    "hours": hours,
                    "printed": round(printed),
                    "since": record["since"],
                    "done": record.get("done"),
                    "due": printed >= limit,
                    "soon": printed >= limit * SOON,
                })
            if started:
                self._write()
        return {"tasks": out, "due": sum(1 for task in out if task["due"])}

    def mark_done(self, name, now=None):
        """Start a task's count again. Raises ValueError for a name that isn't in the settings."""
        if not any(name == task for task, _ in self.tasks()):
            raise ValueError("There is no maintenance task called %r" % name)
        now = round(time.time() if now is None else now, 1)
        with self._lock:
            self._saved[name] = {"since": now, "done": now}
            self._write()
        self._logger.info("Maintenance: %s marked done", name)
        return self.push()

    def push(self):
        """Send the state to the screens (after a print ends, say). Returns it."""
        state = self.state()
        try:
            self._notify(state)
        except Exception:
            self._logger.exception("Maintenance: could not update the screens")
        return state

    # ~~ storage

    def _read(self):
        try:
            with io.open(self._path, encoding="utf-8") as f:
                data = json.load(f)
        except (IOError, OSError, ValueError):
            return {}
        return data if isinstance(data, dict) else {}

    def _write(self):
        tmp = self._path + ".tmp"
        try:
            with io.open(tmp, "w", encoding="utf-8") as f:
                f.write(json.dumps(self._saved, indent=1))
            os.replace(tmp, self._path)
        except (IOError, OSError) as e:
            self._logger.warning("Could not write %s: %s", self._path, e)
