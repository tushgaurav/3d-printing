#!/usr/bin/env bash
# Turn the Pi's small screen into a full-screen kiosk for the Ender 5 touch UI:
# a minimal X11 (no desktop environment) running only Chromium, started at
# boot by systemd. Safe to re-run; it updates an existing install.
#
#   sudo bash ~/ender5-touch/pi-setup/install-kiosk.sh
#
# Get the screen driver working first (see setup-screen.sh / docs/screen-setup.md).
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo:  sudo bash $0" >&2
  exit 1
fi
KUSER="${KIOSK_USER:-${SUDO_USER:-pi}}"
if [[ "$KUSER" == root ]] || ! id "$KUSER" >/dev/null 2>&1; then
  echo "Run this with sudo from your normal login (e.g. pi), or set KIOSK_USER=<user>." >&2
  exit 1
fi
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FILES="$HERE/kiosk-files"
LIB=/usr/local/lib/ender5-kiosk

echo "==> Installing Xorg + Chromium (no desktop) - this takes a few minutes"
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
  xserver-xorg-core xserver-xorg-legacy xserver-xorg-video-fbdev xserver-xorg-input-libinput \
  xinit x11-xserver-utils xinput curl fonts-dejavu-core
if ! command -v chromium >/dev/null 2>&1 && ! command -v chromium-browser >/dev/null 2>&1; then
  apt-get install -y --no-install-recommends chromium-browser || apt-get install -y --no-install-recommends chromium
fi

echo "==> Letting X start from a system service"
if [[ -f /etc/X11/Xwrapper.config && ! -f /etc/X11/Xwrapper.config.ender5-bak ]]; then
  cp /etc/X11/Xwrapper.config /etc/X11/Xwrapper.config.ender5-bak
fi
printf 'allowed_users=anybody\nneeds_root_rights=yes\n' > /etc/X11/Xwrapper.config
for g in video input render tty; do
  getent group "$g" >/dev/null && usermod -aG "$g" "$KUSER"
done

echo "==> Installing kiosk files"
install -d "$LIB"
install -m 755 "$FILES/session.sh" "$LIB/session.sh"
install -m 755 "$FILES/prepare.sh" "$LIB/prepare.sh"
install -m 755 "$FILES/ender5-kiosk" /usr/local/bin/ender5-kiosk
install -d -o "$KUSER" -g "$KUSER" /var/lib/ender5-kiosk
if [[ ! -f /etc/ender5-kiosk.conf ]]; then
  install -m 640 -o root -g "$KUSER" "$FILES/ender5-kiosk.conf" /etc/ender5-kiosk.conf
else
  echo "    keeping your existing /etc/ender5-kiosk.conf"
fi
sed "s/__KIOSK_USER__/$KUSER/" "$FILES/ender5-kiosk.service" > /etc/systemd/system/ender5-kiosk.service

echo "==> Enabling the kiosk service"
systemctl daemon-reload
systemctl enable ender5-kiosk.service
systemctl restart ender5-kiosk.service

echo
echo "Done. The touch UI should appear on the small screen within a minute."
echo "  First start: it asks to be paired - click Allow in OctoPrint's web page."
echo "  Touch off?   sudo ender5-kiosk calibrate"
echo "  Logs:        ender5-kiosk logs"
