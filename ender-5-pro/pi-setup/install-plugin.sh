#!/usr/bin/env bash
# Install (or update) the Ender 5 Touch plugin into OctoPrint's virtualenv,
# then restart OctoPrint. Run as your normal user (pi), NOT with sudo:
#
#   bash ~/ender5-touch/pi-setup/install-plugin.sh
#
# Override the pip it uses with:  PIP=/path/to/venv/bin/pip bash install-plugin.sh
set -euo pipefail

if [[ $EUID -eq 0 ]]; then
  echo "Run this as your normal user (e.g. pi), not with sudo - it installs into OctoPrint's own virtualenv." >&2
  exit 1
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$(cd "$HERE/../touch-ui" && pwd)"

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
echo "Done. The touch UI is at:  http://$(hostname).local/plugin/ender5touch/"
echo "Its settings file appears after the first visit:  ~/.octoprint/data/ender5touch/config.json"
