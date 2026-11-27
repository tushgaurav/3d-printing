// Temperature line charts, drawn as SVG paths so they pick up the theme's colours.
// Readings are averaged into one point every few pixels: half an hour is ~900
// readings, and a 3.5" screen has no use for more points than it has pixels.

/**
 * Average one heater's readings into `n` time buckets over [start, end].
 * -> [{ t, actual, target }]; target is the bucket's last one (targets jump, they don't drift).
 * The last point is the newest reading itself, not an average, so the line ends on the
 * number the screen shows (an average lags while heating).
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
  const points = out.map((c) => ({ t: c.sumT / c.count, actual: c.sum / c.count, target: c.target }));
  for (let i = samples.length - 1; i >= 0 && points.length; i--) {
    const v = samples[i][key];
    if (v && v.actual != null) {
      points[points.length - 1] = { t: samples[i].t, actual: v.actual, target: v.target || 0 };
      break;
    }
  }
  return points;
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

/**
 * The axis for a range: the data plus a little room, with 3 or 4 gridlines at round
 * values ({ lo, hi, ticks }). The ends aren't rounded out to gridlines (24-205° would
 * become 0-300°, a third of a small panel empty); when a step leaves only two
 * gridlines, the axis stretches to the nearest round value outside, whichever is closer.
 */
export function niceRange(lo, hi, maxTicks = 4, minTicks = 3) {
  const pad = (hi - lo) * 0.06;
  lo -= pad;
  hi += pad;
  for (const step of STEPS) {
    let first = Math.ceil(lo / step) * step;
    let last = Math.floor(hi / step) * step;
    if ((last - first) / step + 1 > maxTicks) continue;
    while ((last - first) / step + 1 < minTicks) {
      if (lo - (first - step) <= last + step - hi) { first -= step; lo = first; }
      else { last += step; hi = last; }
    }
    const ticks = [];
    for (let v = first; v <= last + 1e-9; v += step) ticks.push(v);
    return { lo, hi, ticks };
  }
  return { lo, hi, ticks: [] };
}

const f1 = (v) => Math.round(v * 10) / 10;

/**
 * A smooth curve through [x, y] points (monotone cubic, Fritsch-Carlson): no wobble
 * between readings and no overshoot past them, so a heater never seems to dip or peak
 * where it didn't.
 */
export function smoothPath(pts) {
  const n = pts.length;
  if (n < 3) return n ? `M${pts.map(([px, py]) => `${f1(px)},${f1(py)}`).join('L')}` : '';
  const dx = [];
  const m = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1][0] - pts[i][0];
    m[i] = dx[i] ? (pts[i + 1][1] - pts[i][1]) / dx[i] : 0;
  }
  const t = [m[0]];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  t[n - 1] = m[n - 2];
  for (let i = 0; i < n - 1; i++) {
    if (!m[i]) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i];
    const b = t[i + 1] / m[i];
    const s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  let d = `M${f1(pts[0][0])},${f1(pts[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += `C${f1(pts[i][0] + h)},${f1(pts[i][1] + t[i] * h)} ${f1(pts[i + 1][0] - h)},${f1(pts[i + 1][1] - t[i + 1] * h)} ${f1(pts[i + 1][0])},${f1(pts[i + 1][1])}`;
  }
  return d;
}

/**
 * Path data for a heater: the reading as a smooth line, and the target as steps (only
 * where the heater is on). No area fill: the axis doesn't start at 0, so a filled area
 * would misstate the size. x(t) and y(value) map to drawing units; a gap of more than
 * `gap` seconds between points breaks the line rather than bridging it.
 */
export function tempPaths(points, { x, y, gap }) {
  let line = '';
  let target = '';
  let run = [];
  const flush = () => {
    if (!run.length) return;
    line += smoothPath(run.map((p) => [x(p.t), y(p.actual)]));
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
const SPARK_POINTS = 40;

/**
 * SVG for a sparkline; fill it with drawSpark(). It stretches to its box, so strokes are
 * non-scaling and the "now" dot is a round-capped zero-length line (a circle would squash).
 */
export function sparkSVG() {
  return `<svg viewBox="0 0 ${SPARK_W} ${SPARK_H}" preserveAspectRatio="none" aria-hidden="true">
    <path class="tgt"/><path class="ln"/><path class="ring"/><path class="now"/></svg>`;
}

/**
 * Draw the last `seconds` of one heater into an svg made by sparkSVG(). minSpan keeps
 * the scale calm: a heater drifting a degree or two near room temperature stays flat
 * instead of filling the box. The current target (if any) is a faint line across the
 * whole width, the level the reading is heading for; the full graph shows its history.
 */
export function drawSpark(svg, history, key, seconds, minSpan = 10) {
  const win = history.window(seconds);
  const points = bucket(win.samples, key, win.start, win.end, SPARK_POINTS);
  const last = points[points.length - 1];
  const goal = last && last.target > 0 ? last.target : 0;
  const range = valueRange(points.map((p) => ({ actual: p.actual, target: goal })), minSpan);
  const paths = [...svg.children];
  if (!range) {
    paths.forEach((p) => p.removeAttribute('d'));
    return;
  }
  const x = (t) => Math.max(0, ((t - win.start) / seconds) * SPARK_W);
  const y = (v) => SPARK_H - ((v - range.lo) / (range.hi - range.lo)) * SPARK_H;
  const d = tempPaths(points, { x, y, gap: Math.max(60, (seconds / SPARK_POINTS) * 3) });
  const dot = `M${f1(x(last.t))},${f1(y(last.actual))}h0.01`;
  const [tgt, ln, ring, now] = paths;
  if (goal) tgt.setAttribute('d', `M0,${f1(y(goal))}H${SPARK_W}`);
  else tgt.removeAttribute('d');
  ln.setAttribute('d', d.line);
  ring.setAttribute('d', dot);
  now.setAttribute('d', dot);
}
