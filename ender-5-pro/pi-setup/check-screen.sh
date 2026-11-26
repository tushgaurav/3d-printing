#!/usr/bin/env bash
# What does the Pi see of the SPI screen and its touch controller?
#
#   bash check-screen.sh            report
#   sudo bash check-screen.sh test  also fill the small screen with noise for 2 seconds
set -u

BOOT=/boot/firmware
[[ -f $BOOT/config.txt ]] || BOOT=/boot

echo "== Board and OS"
tr -d '\0' < /proc/device-tree/model 2>/dev/null; echo
# shellcheck source=/dev/null
. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME, kernel $(uname -r)"

echo
echo "== Display lines in $BOOT/config.txt"
grep -nE '^[[:space:]]*(#ender5-disabled# )?(dtoverlay|dtparam=spi|max_framebuffers|disable_fw_kms_setup|hdmi_|display_)' "$BOOT/config.txt" 2>/dev/null || echo "(none)"

echo
echo "== Framebuffers"
SPI_FB=""
for d in /sys/class/graphics/fb*; do
  [[ -r "$d/name" ]] || continue
  name="$(cat "$d/name")"
  size="$(tr ',' 'x' < "$d/virtual_size" 2>/dev/null)"
  bpp="$(cat "$d/bits_per_pixel" 2>/dev/null)"
  kind="HDMI/firmware"
  case "$name" in *vc4*|*BCM2708*|*bcm2708*|*simple*|*efi*) ;; *) kind="SPI screen"; [[ -z "$SPI_FB" ]] && SPI_FB="/dev/$(basename "$d")" ;; esac
  echo "/dev/$(basename "$d"): $name  ${size} @ ${bpp}bpp  <- $kind"
done
[[ -z "$SPI_FB" ]] && echo "No SPI framebuffer found. The screen driver isn't loaded - see docs/screen-setup.md."

echo
echo "== Touch controller"
if grep -qiE 'ads7846|xpt2046|touch' /proc/bus/input/devices; then
  # mawk (Pi OS default) has no IGNORECASE, so spell the cases out
  awk 'BEGIN{RS=""} /[Aa][Dd][Ss]7846|[Xx][Pp][Tt]2046|[Tt]ouch/ {print}' /proc/bus/input/devices | grep -E '^(N|H):'
else
  echo "No touch input device found. Check the dtoverlay line (the ads7846 touch part comes with it)."
fi

echo
echo "== Kernel messages"
if out="$(dmesg 2>/dev/null)"; then
  echo "$out" | grep -iE 'ili9486|fbtft|fb_ili|ads7846|piscreen|mipi.dbi|waveshare' | tail -n 15 || echo "(nothing relevant)"
else
  echo "(run with sudo to include kernel messages)"
fi

echo
echo "== Kiosk"
if systemctl list-unit-files ender5-kiosk.service >/dev/null 2>&1; then
  echo "ender5-kiosk.service: $(systemctl is-active ender5-kiosk.service)"
else
  echo "not installed"
fi

if [[ "${1:-}" == test ]]; then
  echo
  if [[ -z "$SPI_FB" ]]; then echo "Nothing to test: no SPI framebuffer."; exit 1; fi
  if [[ $EUID -ne 0 ]]; then echo "The test writes to $SPI_FB - run with sudo."; exit 1; fi
  sysd="/sys/class/graphics/$(basename "$SPI_FB")"
  IFS=, read -r w h < "$sysd/virtual_size"
  bytes=$(( w * h * $(cat "$sysd/bits_per_pixel") / 8 ))
  echo "Filling $SPI_FB with noise - the small screen should show coloured static."
  head -c "$bytes" /dev/urandom > "$SPI_FB"
  sleep 2
  head -c "$bytes" /dev/zero > "$SPI_FB"
  echo "Done. If you saw static, the display side works."
fi
