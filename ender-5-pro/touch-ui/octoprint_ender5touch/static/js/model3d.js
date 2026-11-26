// 3D view of a print, main-thread side: loads G-code into the worker
// (gcode/worker.js) and keeps canvases showing the frames it draws.
//
// A file is downloaded and parsed once (the last two are kept). While printing,
// a view redraws at most every few seconds; dragging redraws at once with a
// lighter frame, then a full one when the finger lifts.

import { DEFAULT_YAW, DEFAULT_PITCH } from './gcode/render.js';

export { DEFAULT_YAW, DEFAULT_PITCH };

const MAX_BYTES = 64 * 1024 * 1024;  // bigger files would take too long on the Pi; the picture is used instead
const KEEP = 2;                      // parsed models kept in the worker
const PROGRESS_EVERY = 2500;         // ms between redraws that only show more of the print

let worker = null;
let broken = null;
const pending = new Map();
let seq = 0;

function getWorker() {
  if (broken) throw broken;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./gcode/worker.js', import.meta.url), { type: 'module' });
  } catch (e) {
    broken = new Error(`3D view unavailable: ${e.message || e}`);
    throw broken;
  }
  worker.onmessage = (ev) => {
    const { id, ok, result, error } = ev.data || {};
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (ok) p.resolve(result); else p.reject(new Error(error));
  };
  worker.onerror = (ev) => {
    broken = new Error(`3D view unavailable: ${ev.message || 'worker failed to start'}`);
    for (const p of pending.values()) p.reject(broken);
    pending.clear();
    worker = null;
  };
  return worker;
}

function call(msg, transfer) {
  return new Promise((resolve, reject) => {
    let w;
    try { w = getWorker(); } catch (e) { reject(e); return; }
    const id = ++seq;
    pending.set(id, { resolve, reject });
    w.postMessage({ ...msg, id }, transfer || []);
  });
}

// ~~ files

export function modelKey(file) {
  return `${file.origin || 'local'}:${file.path}:${file.date || ''}:${file.size || ''}`;
}

/** Can this file be shown in 3D? (local G-code of a sane size) */
export function canModel(file) {
  return !!(file && file.path && (file.origin || 'local') === 'local' && !(file.size > MAX_BYTES));
}

const loads = new Map(); // key -> Promise<info>

/** Download and parse once; resolves with { layers, segments, ... } or rejects. */
export function loadModel(client, file) {
  const key = modelKey(file);
  let p = loads.get(key);
  if (p) { loads.delete(key); loads.set(key, p); return p; } // most recently used last
  p = (async () => {
    const buffer = await client.gcodeBuffer(file);
    return call({ type: 'load', key, buffer }, [buffer]);
  })();
  loads.set(key, p);
  p.catch(() => setTimeout(() => { if (loads.get(key) === p) loads.delete(key); }, 30000)); // retry later
  while (loads.size > KEEP) {
    const old = loads.keys().next().value;
    loads.delete(old);
    call({ type: 'drop', key: old }).catch(() => {});
  }
  return p;
}

// ~~ views

const views = new Set();

// redraw in the new colours when the theme changes
if (typeof MutationObserver !== 'undefined') {
  new MutationObserver(() => views.forEach((v) => v.refresh()))
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}

function readPalette(el) {
  const cs = getComputedStyle(el);
  const v = (name) => cs.getPropertyValue(name).trim();
  return {
    body: v('--m3d-body'), shade: v('--m3d-shade'), ghost: v('--m3d-ghost'), layer: v('--m3d-layer'),
    plate: v('--m3d-plate'), grid: v('--m3d-grid'), halo: v('--m3d-halo'),
  };
}

/** Keeps one <canvas> showing a model. fit: 'box' fills it, 'sphere' keeps the size while turning. */
export class ModelView {
  constructor(canvas, { fit = 'box', onStats = null } = {}) {
    this.canvas = canvas;
    this.fit = fit;
    this.onStats = onStats;
    this.key = null;
    this.upTo = Infinity;
    this.yaw = DEFAULT_YAW;
    this.pitch = DEFAULT_PITCH;
    this.paused = false;
    this.busy = false;
    this.queued = null;
    this.timer = null;
    this.lastDraw = 0;
    this.lastSig = '';
    this.ctx = null;
    views.add(this);
  }

  setModel(key) { if (key !== this.key) { this.key = key; this.request(false, true); } }

  /** Bytes of the file printed so far (Infinity = the whole part). */
  setProgress(upTo) {
    if (upTo === this.upTo) return;
    // a print starting or ending shows at once; progress within a print is throttled
    const now = upTo === Infinity || this.upTo === Infinity;
    this.upTo = upTo;
    this.request(false, now);
  }

  setAngles(yaw, pitch, fast = false) { this.yaw = yaw; this.pitch = pitch; this.request(fast, true); }

  /** Redraw if anything changed (size, theme, ...). */
  refresh() { this.request(false, true); }

  setPaused(p) { this.paused = p; if (!p) this.refresh(); }

  destroy() { this.destroyed = true; clearTimeout(this.timer); views.delete(this); }

  request(fast, now) {
    if (this.destroyed) return;
    if (!now) {
      const wait = this.lastDraw + PROGRESS_EVERY - Date.now();
      if (wait > 0) {
        if (!this.timer) this.timer = setTimeout(() => { this.timer = null; this.request(false, true); }, wait);
        return;
      }
    }
    this.queued = { fast };
    this.pump();
  }

  async pump() {
    if (this.busy || !this.queued || this.paused || this.destroyed) return;
    const { fast } = this.queued;
    this.queued = null;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(this.canvas.clientWidth * dpr);
    const h = Math.round(this.canvas.clientHeight * dpr);
    if (!this.key || !w || !h) return; // hidden: drawn when shown again
    const palette = readPalette(this.canvas);
    const sig = [this.key, w, h, this.yaw, this.pitch, this.upTo, fast, this.fit, JSON.stringify(palette)].join('|');
    if (sig === this.lastSig) return;
    this.busy = true;
    try {
      const res = await call({
        type: 'render', key: this.key, w, h, dpr, yaw: this.yaw, pitch: this.pitch,
        upTo: this.upTo, fit: this.fit, fast, palette,
      });
      if (res && !this.destroyed) {
        if (!this.ctx) this.ctx = this.canvas.getContext('bitmaprenderer');
        this.ctx.transferFromImageBitmap(res.bitmap);
        this.lastSig = sig;
        if (this.onStats) this.onStats(res.stats);
      }
    } catch (e) {
      console.warn('[ender5] 3D view:', e.message || e);
    } finally {
      this.busy = false;
      this.lastDraw = Date.now();
      this.pump();
    }
  }
}
