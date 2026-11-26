#!/usr/bin/env bash
# Remove the kiosk service and its files. Leaves Xorg/Chromium installed and
# keeps /etc/ender5-kiosk.conf. The OctoPrint plugin is separate: remove it in
# OctoPrint -> Settings -> Plugin Manager.
#
#   sudo bash uninstall-kiosk.sh
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo:  sudo bash $0" >&2
  exit 1
fi

systemctl disable --now ender5-kiosk.service 2>/dev/null || true
rm -f /etc/systemd/system/ender5-kiosk.service
systemctl daemon-reload
rm -f /etc/X11/xorg.conf.d/99-ender5-kiosk.conf /usr/local/bin/ender5-kiosk
rm -rf /usr/local/lib/ender5-kiosk /var/lib/ender5-kiosk
if [[ -f /etc/X11/Xwrapper.config.ender5-bak ]]; then
  mv /etc/X11/Xwrapper.config.ender5-bak /etc/X11/Xwrapper.config
fi

echo "Kiosk removed. Kept /etc/ender5-kiosk.conf."
echo "To also remove the packages:  sudo apt remove xserver-xorg-core xinit chromium-browser chromium && sudo apt autoremove"
