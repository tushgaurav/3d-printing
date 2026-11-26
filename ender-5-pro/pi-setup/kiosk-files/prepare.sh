#!/usr/bin/env bash
# Runs as root before X starts (ExecStartPre): find the SPI screen's
# framebuffer and write an Xorg config that uses only that screen.
set -u
CONF=/etc/ender5-kiosk.conf
# shellcheck source=/dev/null
[[ -r $CONF ]] && . "$CONF"

FB="${FBDEV:-auto}"
if [[ "$FB" == auto ]]; then
  FB=""
  # SPI drivers can register a few seconds after boot; give them a moment.
  for _ in $(seq 1 15); do
    for d in /sys/class/graphics/fb*; do
      [[ -r "$d/name" ]] || continue
      case "$(cat "$d/name")" in
        *vc4*|*BCM2708*|*bcm2708*|*simple*|*efi*) continue ;;  # HDMI / firmware framebuffers
      esac
      FB="/dev/$(basename "$d")"
      break
    done
    [[ -n "$FB" ]] && break
    sleep 1
  done
  if [[ -z "$FB" ]]; then
    echo "ender5-kiosk: no SPI framebuffer found - falling back to /dev/fb0 (HDMI). Is the screen driver set up?"
    FB=/dev/fb0
  fi
fi
echo "ender5-kiosk: using $FB ($(cat "/sys/class/graphics/$(basename "$FB")/name" 2>/dev/null || echo unknown))"

mkdir -p /etc/X11/xorg.conf.d
cat > /etc/X11/xorg.conf.d/99-ender5-kiosk.conf <<EOF
# Written by ender5-kiosk on every start. Change FBDEV in /etc/ender5-kiosk.conf instead.
Section "ServerFlags"
    Option "AutoAddGPU" "false"
    Option "BlankTime" "0"
    Option "StandbyTime" "0"
    Option "SuspendTime" "0"
    Option "OffTime" "0"
EndSection

Section "Device"
    Identifier "ender5-fb"
    Driver "fbdev"
    Option "fbdev" "$FB"
EndSection

Section "Screen"
    Identifier "ender5-screen"
    Device "ender5-fb"
EndSection
EOF
