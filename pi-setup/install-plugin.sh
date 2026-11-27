#!/usr/bin/env bash
# Install (or update) the Layer1 plugin into OctoPrint's virtualenv,
# then restart OctoPrint. Run as your normal user (pi), NOT with sudo:
#
#   bash ~/layer1/pi-setup/install-plugin.sh
#
# Override the pip it uses with:  PIP=/path/to/venv/bin/pip bash install-plugin.sh
set -euo pipefail

if [[ $EUID -eq 0 ]]; then
  echo "Run this as your normal user (e.g. pi), not with sudo - it installs into OctoPrint's own virtualenv." >&2
  exit 1
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$(cd "$HERE/.." && pwd)"   # the repo root, where pyproject.toml is

find_pip() {
  local p op
  for p in "$HOME/oprint/bin/pip" /opt/octopi/oprint/bin/pip; do
    [[ -x "$p" ]] && { echo "$p"; return 0; }
  done
  op="$(command -v octoprint || true)"
  if [[ -n "$op" && -x "$(dirname "$op")/pip" ]]; then echo "$(dirname "$op")/pip"; return 0; fi
  return 1
}

PIP="${PIP:-$(find_pip || true)}"
if [[ -z "$PIP" ]]; then
  echo "Couldn't find OctoPrint's pip (looked in ~/oprint/bin). Re-run with PIP=/path/to/venv/bin/pip" >&2
  exit 1
fi

echo "==> Installing the plugin with $PIP"
if ! "$PIP" install --upgrade "$SRC"; then
  echo "==> Retrying without build isolation (no internet access?)"
  "$PIP" install --upgrade --no-build-isolation "$SRC"
fi

echo "==> Restarting OctoPrint"
if systemctl list-unit-files octoprint.service >/dev/null 2>&1; then
  sudo service octoprint restart
else
  echo "    No octoprint service found - restart OctoPrint yourself."
fi

echo
echo "Done. Layer1 is at:       http://$(hostname).local/plugin/layer1/"
echo "Its settings file appears after the first visit:  ~/.octoprint/data/layer1/config.json"
