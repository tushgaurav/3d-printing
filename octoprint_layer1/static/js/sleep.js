// Screen sleep: after some minutes without a touch the screen goes black, and a tap
// wakes it. Most 3.5" SPI panels can't switch their backlight off from software, so
// black is the best there is: no glow in a dark room, and nothing for the Pi to
// redraw (everything underneath is hidden and the Home camera stops). It wakes by
// itself when a print finishes, fails or pauses, since those want someone to look.
// Chosen in Display; the lock screen, if on, is still there when it wakes.

import { mount, closeFullViews } from './ui.js';
import { storedSleep } from './session.js';
import { initIdle, idleFor, activity, screenBusy } from './idle.js';

const CHECK_MS = 10000;
let overlay = null;

/** Minutes without a touch before the screen sleeps; 0 = never. */
export function sleepMinutes(ctx) {
  const v = storedSleep();
  return v != null ? v : +(ctx.cfg.ui.sleepMinutes || 0);
}

export function isAsleep() { return !!overlay; }

export function initSleep(ctx) {
  initIdle();
  setInterval(() => {
    const min = sleepMinutes(ctx);
    if (!min || overlay || idleFor() < min * 60000 || screenBusy()) return;
    sleep(ctx);
  }, CHECK_MS);
}

export function sleep(ctx) {
  if (overlay) return;
  closeFullViews();
  const el = document.createElement('div');
  el.className = 'sleep';
  // Wake on the tap's click, not its press: the whole tap lands on the black screen,
  // so the tap that wakes it can't also press whatever is underneath.
  el.addEventListener('click', () => wake(ctx));
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  overlay = mount(el);
  document.getElementById('app').classList.add('asleep');
  ctx.setAwake(false);
}

/** Wake up (a tap, or something worth seeing happened). Counts as activity either way. */
export function wake(ctx) {
  activity();
  if (!overlay) return;
  overlay.remove();
  overlay = null;
  document.getElementById('app').classList.remove('asleep');
  ctx.setAwake(true);
}
