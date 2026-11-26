// Temperature line charts, drawn as SVG paths so they pick up the theme's colours.
// Readings are averaged into one point every few pixels: half an hour is ~900
// readings, and a 3.5" screen has no use for more points than it has pixels.

/**
 * Average one heater's readings into `n` time buckets over [start, end].
 * -> [{ t, actual, target }]; target is the bucket's last one (targets jump, they don't drift).
 */
export function bucket(samples, key, start, end, n) {
  const span = end - start || 1;
  const out = [];
  let cur = null;
  for (const s of samples) {
    const v = s[key];
    if (!v || v.actual == null) continue;
    const b = Math.min(n - 1, Math.floor(((s.t - start) / span) * n));
    if (!cur || cur.b !== b) {
      cur = { b, sumT: 0, sum: 0, count: 0, target: 0 };
      out.push(cur);
    }
    cur.sumT += s.t;
    cur.sum += v.actual;
    cur.count++;
    cur.target = v.target || 0;
  }
  return out.map((c) => ({ t: c.sumT / c.count, actual: c.sum / c.count, target: c.target }));
}

/** Lowest and highest reading or target, at least `minSpan` apart. null when there is nothing to draw. */
export function valueRange(points, minSpan) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of points) {
    lo = Math.min(lo, p.actual);
    hi = Math.max(hi, p.actual);
    if (p.target > 0) {
      lo = Math.min(lo, p.target);
      hi = Math.max(hi, p.target);
    }
  }
  if (!Number.isFinite(lo)) return null;
  if (hi - lo < minSpan) {
    const mid = (hi + lo) / 2;
    lo = mid - minSpan / 2;
    hi = mid + minSpan / 2;
  }
  return { lo, hi };
}

const STEPS = [1, 2, 5, 10, 20, 25, 50, 100];

/** Round a range out to clean gridline values: { lo, hi, ticks }. */
export function niceRange(lo, hi, maxTicks = 4) {
  for (const step of STEPS) {
    const a = Math.floor(lo / step) * step;
    const b = Math.ceil(hi / step) * step;
    if ((b - a) / step <= maxTicks) {
      const ticks = [];
      for (let v = a; v <= b + 1e-9; v += step) ticks.push(v);
      return { lo: a, hi: b, ticks };
    }
  }
  return { lo, hi, ticks: [lo, hi] };
}

const f1 = (v) => Math.round(v * 10) / 10;

/**
 * Path data for a heater: the reading as a line, and the target as steps (only where the
 * heater is on). No area fill: the axis doesn't start at 0, so a filled area would
 * misstate the size. x(t) and y(value) map to drawing units; a gap of more than `gap`
 * seconds between points breaks the line rather than bridging it.
 */
export function tempPaths(points, { x, y, gap }) {
  let line = '';
  let target = '';
  let run = [];
  const flush = () => {
    if (!run.length) return;
    line += `M${run.map((p) => `${f1(x(p.t))},${f1(y(p.actual))}`).join('L')}`;
    run = [];
  };
  let prev = null;
  for (const p of points) {
    const broken = prev && p.t - prev.t > gap;
    if (broken) flush();
    run.push(p);
    if (p.target > 0) {
      if (prev && !broken && prev.target > 0) {
        if (prev.target !== p.target) target += `L${f1(x(p.t))},${f1(y(prev.target))}`;
        target += `L${f1(x(p.t))},${f1(y(p.target))}`;
      } else {
        target += `M${f1(x(p.t))},${f1(y(p.target))}`;
      }
    }
    prev = p;
  }
  flush();
  return { line, target };
}

/** The reading nearest to time t: { t, actual, target } or null. */
export function nearest(points, t) {
  let best = null;
  for (const p of points) if (!best || Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
  return best;
}

const SPARK_W = 200;
const SPARK_H = 40;
const SPARK_POINTS = 60;

/** SVG for a sparkline; fill it with drawSpark(). Stretches to its box (strokes stay 2px). */
export function sparkSVG() {
  return `<svg viewBox="0 0 ${SPARK_W} ${SPARK_H}" preserveAspectRatio="none" aria-hidden="true">
    <path class="tgt"/><path class="ln"/></svg>`;
}

/** Draw the last `seconds` of one heater into an svg made by sparkSVG(). */
export function drawSpark(svg, history, key, seconds, minSpan = 10) {
  const win = history.window(seconds);
  const points = bucket(win.samples, key, win.start, win.end, SPARK_POINTS);
  const range = valueRange(points, minSpan);
  const [tgt, ln] = svg.children;
  if (!range) {
    tgt.removeAttribute('d');
    ln.removeAttribute('d');
    return;
  }
  const pad = (range.hi - range.lo) * 0.18;
  const lo = range.lo - pad;
  const hi = range.hi + pad;
  const d = tempPaths(points, {
    x: (t) => ((t - win.start) / seconds) * SPARK_W,
    y: (v) => SPARK_H - ((v - lo) / (hi - lo)) * SPARK_H,
    gap: Math.max(60, (seconds / SPARK_POINTS) * 3),
  });
  tgt.setAttribute('d', d.target);
  ln.setAttribute('d', d.line);
}
