#!/usr/bin/env bash
# The X session: runs as the kiosk user inside xinit. Sets up the screen and
# touch, waits for OctoPrint, then keeps Chromium running full-screen.
CONF=/etc/layer1-kiosk.conf
# shellcheck source=/dev/null
[[ -r $CONF ]] && . "$CONF"
URL="${URL:-http://127.0.0.1/plugin/layer1/static/index.html}"
STATE_DIR=/var/lib/layer1-kiosk

# never blank the screen
xset s off -dpms s noblank 2>/dev/null || true

# touch calibration
if [[ -n "${TOUCH_MATRIX:-}" ]]; then
  while read -r id; do
    name="$(xinput list --name-only "$id" 2>/dev/null)" || continue
    [[ "$name" =~ ${TOUCH_DEVICE:-ADS7846|[Tt]ouch} ]] || continue
    # shellcheck disable=SC2086  # the 9 numbers must split into 9 arguments
    if xinput set-prop "$id" "Coordinate Transformation Matrix" $TOUCH_MATRIX 2>/dev/null; then
      echo "layer1-kiosk: touch matrix applied to '$name'"
    fi
  done < <(xinput list --id-only 2>/dev/null)
fi

# wait for OctoPrint (up to 4 minutes after a cold boot)
ROOT="${URL%%/plugin/*}"
for _ in $(seq 1 120); do
  code="$(curl -s -o /dev/null -m 3 -w '%{http_code}' "$ROOT/api/version" || true)"
  [[ "$code" =~ ^(200|401|403)$ ]] && break
  sleep 2
done

# screen size as X sees it (falls back to 480x320)
SIZE="$(xrandr 2>/dev/null | sed -n 's/.* current \([0-9]*\) x \([0-9]*\).*/\1,\2/p' | head -n1)"
SIZE="${SIZE:-480,320}"

# what the page needs to know (after "#", so it never reaches a server log)
HASH="kiosk=1&host=$(hostname).local"
[[ -n "${TOUCH_MATRIX:-}" ]] && HASH+="&tm=$(echo "$TOUCH_MATRIX" | tr -s ' ' ',')"
[[ -n "${API_KEY:-}" ]] && HASH+="&key=${API_KEY}"
if [[ -f "$STATE_DIR/calibrate" ]]; then
  HASH+="&page=calibrate"
  rm -f "$STATE_DIR/calibrate"
fi

BROWSER="$(command -v chromium || command -v chromium-browser)"
PROFILE="$HOME/.config/layer1-kiosk"
CACHE="${XDG_RUNTIME_DIR:-/tmp}/layer1-kiosk-cache"
mkdir -p "$PROFILE"

while true; do
  # no "Chromium didn't shut down correctly" bar after a power cut
  sed -i 's/"exited_cleanly":false/"exited_cleanly":true/; s/"exit_type":"[^"]*"/"exit_type":"Normal"/' \
    "$PROFILE/Default/Preferences" 2>/dev/null || true
  # shellcheck disable=SC2086  # CHROMIUM_FLAGS is a list of flags
  "$BROWSER" \
    --kiosk --noerrdialogs --disable-infobars --disable-session-crashed-bubble \
    --no-first-run --disable-translate --disable-features=Translate,TranslateUI,MediaRouter \
    --check-for-update-interval=31536000 --overscroll-history-navigation=0 --disable-pinch \
    --touch-events=enabled --password-store=basic \
    --user-data-dir="$PROFILE" --disk-cache-dir="$CACHE" \
    --window-position=0,0 --window-size="$SIZE" --force-device-scale-factor="${SCALE:-1}" \
    ${CHROMIUM_FLAGS:-} \
    "$URL#$HASH"
  sleep 2
done
