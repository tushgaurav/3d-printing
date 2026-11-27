// Temperature history for the graphs: the last half hour of nozzle and bed readings.
// OctoPrint sends its recent history when the push socket connects, then the new
// readings with every update; while the socket is down, each REST poll adds one.
// Times are OctoPrint's clock (unix seconds); graphs measure back from the newest
// reading, so a screen whose clock is off still draws the right shape.

const KEEP_SECONDS = 30 * 60;
const MAX_SAMPLES = 3000;
export const HEATERS = ['tool0', 'bed'];

const reading = (t) => ({
  actual: t && Number.isFinite(t.actual) ? t.actual : null,
  target: t && Number.isFinite(t.target) ? t.target : null,
});

export class TempHistory {
  constructor() {
    this.samples = []; // [{ t, tool0: { actual, target }, bed: { actual, target } }], oldest first
    this.version = 0;  // bumps on every change, so a graph can skip redraws
    this.subs = new Set();
  }

  /** list: [{ time, tool0, bed }] as OctoPrint sends them. replace: a full history (socket connect). */
  push(list, replace = false) {
    if (replace) this.samples = [];
    const last = this.samples[this.samples.length - 1];
    let lastT = last ? last.t : -Infinity;
    let added = false;
    for (const s of list || []) {
      const t = s && +s.time;
      if (!Number.isFinite(t) || t <= lastT) continue;
      const sample = { t, tool0: reading(s.tool0), bed: reading(s.bed) };
      if (sample.tool0.actual == null && sample.bed.actual == null) continue;
      this.samples.push(sample);
      lastT = t;
      added = true;
    }
    if (!added && !replace) return;
    const cut = lastT - KEEP_SECONDS;
    let drop = 0;
    while (drop < this.samples.length && this.samples[drop].t < cut) drop++;
    drop = Math.max(drop, this.samples.length - MAX_SAMPLES);
    if (drop > 0) this.samples.splice(0, drop);
    this.version++;
    for (const fn of [...this.subs]) fn(this);
  }

  /** The newest reading's time, or null. */
  latest() {
    const s = this.samples[this.samples.length - 1];
    return s ? s.t : null;
  }

  /** Readings in the last `seconds` before the newest one (plus one just before, so lines reach the edge). */
  window(seconds) {
    const end = this.latest();
    if (end == null) return { start: 0, end: 0, samples: [] };
    const start = end - seconds;
    let i = this.samples.length - 1;
    while (i > 0 && this.samples[i - 1].t >= start) i--;
    return { start, end, samples: this.samples.slice(Math.max(0, i - 1)) };
  }

  subscribe(fn) {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }
}
