#!/usr/bin/env bash
# Set up the 3.5" SPI screen driver in the Pi's boot config (config.txt).
# A timestamped backup is made first; "remove" undoes everything this added.
#
#   sudo bash setup-screen.sh piscreen [rotate]      built-in kernel driver (DRM). Try this first.
#   sudo bash setup-screen.sh waveshare35a [rotate]  Waveshare's own overlay (copy waveshare35a.dtbo
#                                                    into the overlays folder first - see docs)
#   sudo bash setup-screen.sh remove                 undo
#
# rotate: 90 = landscape (default), 270 = landscape upside down, 0/180 = portrait.
# Reboot afterwards, then check with:  bash check-screen.sh
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo:  sudo bash $0 ${*:-piscreen}" >&2
  exit 1
fi

BOOT=/boot/firmware
[[ -f $BOOT/config.txt ]] || BOOT=/boot
CFG=$BOOT/config.txt
[[ -f $CFG ]] || { echo "Can't find config.txt in /boot/firmware or /boot" >&2; exit 1; }

MODE="${1:-}"
ROT="${2:-90}"
BEGIN="# >>> layer1 screen >>>"
END="# <<< layer1 screen <<<"
MARK="#layer1-disabled# "

case "$MODE" in piscreen|waveshare35a|remove) ;; *)
  sed -n '2,12p' "$0"; exit 1 ;;
esac
case "$ROT" in 0|90|180|270) ;; *) echo "rotate must be 0, 90, 180 or 270" >&2; exit 1 ;; esac

if [[ "$MODE" == waveshare35a && ! -f "$BOOT/overlays/waveshare35a.dtbo" ]]; then
  echo "Missing $BOOT/overlays/waveshare35a.dtbo." >&2
  echo "Get it from Waveshare's 3.5inch RPi LCD (A) wiki page and copy it there, then re-run." >&2
  exit 1
fi

BACKUP="$CFG.layer1-$(date +%Y%m%d-%H%M%S).bak"
cp "$CFG" "$BACKUP"
echo "Backup: $BACKUP"

# 1. undo a previous run: drop our block, re-enable lines we commented out
tmp="$(mktemp)"
# (blank lines are held back and only printed before more content, so no trailing blanks pile up)
awk -v b="$BEGIN" -v e="$END" '
  $0==b {skip=1; next}
  $0==e {skip=0; next}
  skip {next}
  /^[[:space:]]*$/ {blank++; next}
  {while (blank > 0) {print ""; blank--} print}
' "$CFG" > "$tmp"
sed -i "s/^${MARK}//" "$tmp"
cat "$tmp" > "$CFG"
rm -f "$tmp"

if [[ "$MODE" == remove ]]; then
  echo "Removed the Layer1 screen settings. Reboot to apply:  sudo reboot"
  exit 0
fi

# 2. comment out other SPI-screen / touch overlays that would fight ours
sed -i -E "s/^(dtoverlay=(piscreen|waveshare35[a-z]?|tft35a|ads7846)([,:].*)?)$/${MARK}\1/" "$CFG"

# 3. Waveshare's fbtft overlay needs the firmware framebuffer, not KMS
if [[ "$MODE" == waveshare35a ]]; then
  sed -i -E "s/^(dtoverlay=vc4-f?kms-v3d.*)$/${MARK}\1/" "$CFG"
  OVERLAY="dtoverlay=waveshare35a,rotate=${ROT}"
else
  OVERLAY="dtoverlay=piscreen,drm,speed=16000000,rotate=${ROT}"
fi

# 4. append our block under [all] so it applies whatever section the file ends in
{
  echo
  echo "$BEGIN"
  echo "[all]"
  echo "dtparam=spi=on"
  echo "$OVERLAY"
  echo "$END"
} >> "$CFG"

echo "Added to $CFG:"
echo "    dtparam=spi=on"
echo "    $OVERLAY"
grep -q "^${MARK}" "$CFG" && { echo "Commented out (restore with 'remove'):"; grep "^${MARK}" "$CFG" | sed 's/^/    /'; }
echo
echo "Reboot to apply:  sudo reboot"
echo "Then check:       bash $(dirname "$0")/check-screen.sh"
