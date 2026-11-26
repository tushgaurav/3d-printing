// Lock screen: covers the whole UI so stray taps and curious hands can't change
// anything, and shows the print (or the time) big enough to read across the room.
// Unlock by holding the button for a second: a tap or a brush of the screen can't,
// and a resistive panel reports a held press reliably. Toasts still show on top.
// It can lock by itself after some minutes without a touch (see sheets/lock.js).

import { icon } from './icons.js';
import { logo } from './logo.js';
import { refs, setText, setHTML, setStyle, setData, show, toggle, esc, fmtTemp, fmtDuration, fmtClock, displayName } from './util.js';
import { PHASES, ACTIVE, phaseOf, findFile, thumbUrl } from './model.js';
import { mount, closeFullViews } from './ui.js';
import { storedLocked, saveLocked, storedAutoLock } from './session.js';
import { initIdle, idleFor, activity, screenBusy } from './idle.js';

const HOLD_MS = 1000;
const HOLD_STEPS = 8;       // the fill grows in steps: SPI screens redraw a few times a second
const NUDGE_MS = 1400;      // a tap away from the button points at it this long
const IDLE_CHECK_MS = 10000;

let current = null;         // the open lock screen: { el, close }

/** Minutes without a touch before the screen locks itself; 0 = never. */
export function autoLockMinutes(ctx) {
  const v = storedAutoLock();
  return v != null ? v : +(ctx.cfg.ui.autoLockMinutes || 0);
}

export function isLocked() { return !!current; }

/** Start auto-lock, and lock again if the screen was locked before a reload. */
export function initLock(ctx) {
  initIdle();
  setInterval(() => {
    const min = autoLockMinutes(ctx);
    if (!min || current || idleFor() < min * 60000 || screenBusy()) return;
    lockScreen(ctx);
  }, IDLE_CHECK_MS);
  if (storedLocked()) lockScreen(ctx);
}

export function lockScreen(ctx) {
  if (current) return current;
  const { store, cfg } = ctx;
  closeFullViews();
  saveLocked(true);

  const el = document.createElement('div');
  el.className = 'lockscreen';
  el.innerHTML = `
    <div class="ls-top">${logo()}<span class="ls-clock" data-r="clock"></span></div>
    <div class="ls-main">
      <div class="ls-text">
        <div class="label" data-r="phase"></div>
        <div class="ls-hero"><b data-r="big"></b><span data-r="unit"></span></div>
        <div class="ls-name" data-r="name"></div>
        <div class="ls-sub" data-r="sub"></div>
      </div>
      <div class="ls-thumb hidden" data-r="thumbBox"><img data-r="thumb" alt=""></div>
    </div>
    <div class="ls-bar" data-r="bar"><i data-r="fill"></i></div>
    <div class="ls-temps">
      <span class="tchip" data-r="noz">${icon('nozzle')}<span class="t" data-r="nozA">—</span><span class="tg" data-r="nozT"></span></span>
      <span class="tchip" data-r="bed">${icon('bed')}<span class="t" data-r="bedA">—</span><span class="tg" data-r="bedT"></span></span>
    </div>
    <button class="btn ls-unlock" data-r="unlock"><i class="ls-hold" data-r="hold"></i>${icon('lock')}<span data-r="unlockText">Hold to Unlock</span></button>`;
  mount(el);
  const r = refs(el);
  let thumbSrc = null;
  r.thumb.onerror = () => { thumbSrc = 'bad'; show(r.thumbBox, false); };

  // ~~ what it shows

  const chip = (key, box, a, t, s) => {
    const v = (s.temps && s.temps[key]) || {};
    setText(a, `${fmtTemp(v.actual)}°`);
    setText(t, v.target > 0 ? `/${Math.round(v.target)}` : '');
    toggle(box, 'heating', v.target > 0 && v.actual != null && v.actual < v.target - 3);
    toggle(box, 'hot', v.target > 0 && v.actual != null && v.actual >= v.target - 3);
  };

  function render() {
    const s = store.get();
    const ph = phaseOf(s);
    const meta = PHASES[ph];
    const file = s.job && s.job.file && s.job.file.name ? s.job.file : null;
    const job = (ACTIVE.has(ph) || ph === 'finished') && file;
    const now = new Date();
    setText(r.phase, meta.label);
    setData(r.phase, 'tone', meta.tone);
    toggle(el, 'is-job', !!job);

    if (job) {
      const prog = s.progress || {};
      const pct = ph === 'finished' ? 100 : Math.max(0, Math.min(100, prog.completion || 0));
      setHTML(r.big, String(Math.floor(pct)));
      setText(r.unit, '%');
      setText(r.name, displayName(file));
      const left = prog.printTimeLeft;
      setText(r.sub, ph === 'finished' ? `Done in ${fmtDuration(prog.printTime)}`
        : left != null ? `${fmtDuration(left)} left · Done ≈ ${fmtClock(new Date(Date.now() + left * 1000))}` : 'Estimating time left');
      setText(r.clock, fmtClock(now));
      setStyle(r.fill, 'width', `${pct.toFixed(1)}%`);
      setData(r.bar, 'tone', meta.tone);
      const entry = findFile(s.files, file.path);
      const url = thumbUrl(entry, ctx.base);
      if (thumbSrc !== 'bad' && url && url !== thumbSrc) { thumbSrc = url; r.thumb.src = url; }
      show(r.thumbBox, !!url && thumbSrc !== 'bad');
    } else {
      // idle: the time is the headline
      const [clock, ampm] = fmtClock(now).split(/\s+/);
      setHTML(r.big, esc(clock).replace(':', '<i>:</i>')); // a mono colon is a full digit wide: tuck it in
      setText(r.unit, ampm || '');
      setText(r.name, cfg.printer.name);
      setText(r.sub, now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }));
      setText(r.clock, '');
      show(r.thumbBox, false);
    }
    chip('tool0', r.noz, r.nozA, r.nozT, s);
    chip('bed', r.bed, r.bedA, r.bedT, s);
  }

  // ~~ hold to unlock

  let holdStart = 0;
  let holdTimer = null;
  let nudgeTimer = null;

  const label = (text) => setText(r.unlockText, text);
  function stopHold() {
    clearInterval(holdTimer);
    holdTimer = null;
    setStyle(r.hold, 'width', '0%');
    label('Hold to Unlock');
  }
  function holdTick() {
    const p = Math.min(1, (Date.now() - holdStart) / HOLD_MS);
    setStyle(r.hold, 'width', `${Math.round(p * HOLD_STEPS) * (100 / HOLD_STEPS)}%`);
    if (p >= 1) close();
  }
  r.unlock.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { r.unlock.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    toggle(r.unlock, 'nudge', false);
    holdStart = Date.now();
    label('Keep Holding…');
    clearInterval(holdTimer);
    holdTimer = setInterval(holdTick, HOLD_MS / HOLD_STEPS);
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    r.unlock.addEventListener(type, () => { if (holdTimer) stopHold(); });
  }
  // a tap anywhere else: point at the button
  el.addEventListener('pointerdown', (e) => {
    if (r.unlock.contains(e.target)) return;
    toggle(r.unlock, 'nudge', true);
    clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(() => toggle(r.unlock, 'nudge', false), NUDGE_MS);
  });
  el.addEventListener('contextmenu', (e) => e.preventDefault());

  const unsub = store.subscribe(render);
  const clockTimer = setInterval(render, 10000);
  render();

  function close() {
    clearInterval(holdTimer);
    clearInterval(clockTimer);
    clearTimeout(nudgeTimer);
    unsub();
    el.remove();
    current = null;
    saveLocked(false);
    activity();
  }
  current = { el, close };
  return current;
}
