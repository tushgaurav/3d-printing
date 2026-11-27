// How long since anyone touched the screen: drives auto-lock and screen sleep.

let last = Date.now();
let started = false;

export function initIdle() {
  if (started) return;
  started = true;
  // capture phase: counts every touch, even ones a control stops from bubbling
  document.addEventListener('pointerdown', () => { last = Date.now(); }, true);
}

/** Milliseconds since the last touch (or since activity() was last called). */
export function idleFor() { return Date.now() - last; }

/** Count as activity without a touch, e.g. when the screen wakes for a finished print. */
export function activity() { last = Date.now(); }

/** Pairing and touch calibration need the screen: never lock or sleep over them. */
export function screenBusy() { return !!document.querySelector('.takeover, .calib'); }
