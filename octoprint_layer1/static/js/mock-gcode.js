// Demo G-code for the 3D view: small models like the demo thumbnails, sliced
// here into perimeters and infill so the viewer has real toolpaths to draw.
// ASCII only, so string length = byte length (what progress.filepos counts).

const LH = 0.2;          // layer height
const W = 0.45;          // line width
const E_MM = 0.0333;     // filament per mm of line (0.45 x 0.2 bead from 1.75 mm filament)
const SPARSE = 3.6;      // sparse infill spacing, about 20 %
const SHELL = 0.8;       // solid floor and roof thickness
const BED = 110;         // parts are centred on the 220 x 220 bed

const f3 = (v) => (Math.round(v * 1000) / 1000).toString();

// ~~ convex outlines, counter-clockwise, centred on 0,0

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

const circle = (cx, cy, r, n = 32) =>
  Array.from({ length: n }, (_, i) => { const a = (2 * Math.PI * i) / n; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });

function roundRect(x0, y0, x1, y1, r, n = 5) {
  const pts = [];
  const corners = [[x1 - r, y0 + r, -Math.PI / 2], [x1 - r, y1 - r, 0], [x0 + r, y1 - r, Math.PI / 2], [x0 + r, y0 + r, Math.PI]];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= n; i++) { const a = a0 + (Math.PI / 2) * (i / n); pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  }
  return pts;
}

/** A boat deck outline, bow towards +x: rounded stern, straight sides, tapering bow. */
function hull(sw, sl) {
  const hw = (x) => {
    if (x < -18) return 15.5 * Math.sqrt(Math.max(0, 1 - ((x + 18) / 12) ** 2));
    if (x > 8) return 15.5 * Math.max(0, (30 - x) / 22) ** 0.8;
    return 15.5;
  };
  const xs = [];
  for (let x = -30; x <= 30.001; x += 2) xs.push(x);
  const pts = xs.map((x) => [x * sl, -hw(x) * sw]);
  for (let i = xs.length - 2; i > 0; i--) pts.push([xs[i] * sl, hw(xs[i]) * sw]);
  return pts;
}

/** Move every edge of a convex outline inwards by d. */
function inset(poly, d) {
  const n = poly.length;
  const edges = poly.map((p, i) => {
    const q = poly[(i + 1) % n];
    const dx = q[0] - p[0]; const dy = q[1] - p[1];
    const l = Math.hypot(dx, dy) || 1;
    return [p[0] - (dy / l) * d, p[1] + (dx / l) * d, dx, dy];
  });
  return edges.map((b, i) => {
    const a = edges[(i + n - 1) % n];
    const den = a[2] * b[3] - a[3] * b[2];
    if (Math.abs(den) < 1e-9) return [b[0], b[1]];
    const t = ((b[0] - a[0]) * b[3] - (b[1] - a[1]) * b[2]) / den;
    return [a[0] + t * a[2], a[1] + t * a[3]];
  });
}

/** Parallel lines across a convex outline, every `gap` mm at `angle`, in zig-zag order. */
function hatch(poly, angle, gap) {
  const c = Math.cos(angle); const s = Math.sin(angle);
  const pv = poly.map(([x, y]) => [x * c + y * s, -x * s + y * c]);
  let vmin = Infinity; let vmax = -Infinity;
  for (const [, v] of pv) { vmin = Math.min(vmin, v); vmax = Math.max(vmax, v); }
  const out = [];
  for (let v = Math.ceil(vmin / gap) * gap; v < vmax; v += gap) {
    let u0 = Infinity; let u1 = -Infinity;
    for (let i = 0; i < pv.length; i++) {
      const [ua, va] = pv[i]; const [ub, vb] = pv[(i + 1) % pv.length];
      if ((va <= v && vb > v) || (vb <= v && va > v)) {
        const u = ua + ((v - va) / (vb - va)) * (ub - ua);
        u0 = Math.min(u0, u); u1 = Math.max(u1, u);
      }
    }
    if (u1 - u0 < 0.3) continue;
    const a = [u0 * c - v * s, u0 * s + v * c]; const b = [u1 * c - v * s, u1 * s + v * c];
    out.push(out.length % 2 ? [b, a] : [a, b]);
  }
  return out;
}

// ~~ the demo parts. Each piece: { z0, z1, at(height above z0) -> outline, walls, hollow, floor, roof }

const MODELS = {
  boat: [
    { z0: 0, z1: 16, at: (zr) => hull(0.72 + (0.28 * zr) / 16, 0.86 + (0.14 * zr) / 16) },
    { z0: 16, z1: 36, at: () => rect(-17, -11, 5, 11), hollow: true, floor: false, roof: false },
    { z0: 36, z1: 38.4, at: () => rect(-20, -13.5, 8, 13.5) },
    { z0: 38.4, z1: 48, at: () => circle(-11, 0, 3.6, 24), hollow: true, floor: false, roof: false },
  ],
  clip: [
    { z0: 0, z1: 8, at: () => roundRect(-40, -6, 40, 6, 2) },
    { z0: 8, z1: 26, at: () => roundRect(-40, -6, -31, 6, 2) },
    { z0: 8, z1: 26, at: () => roundRect(31, -6, 40, 6, 2) },
    { z0: 21, z1: 26, at: () => rect(-31, -6, -27, 6) },
    { z0: 21, z1: 26, at: () => rect(27, -6, 31, 6) },
  ],
  cube: [{ z0: 0, z1: 20, at: () => rect(-10, -10, 10, 10) }],
  case: [
    { z0: 0, z1: 2, at: () => roundRect(-44, -30, 44, 30, 4) },
    { z0: 2, z1: 22, at: () => roundRect(-44, -30, 44, 30, 4), walls: 4, hollow: true, floor: false, roof: false },
    ...[[-29, -24.5], [29, -24.5], [-29, 24.5], [29, 24.5]].map(([x, y]) => ({ z0: 2, z1: 7, at: () => circle(x, y, 3, 16), floor: false })),
  ],
  spool: [
    { z0: 0, z1: 10, at: () => roundRect(-34, -10, 34, 10, 3) },
    { z0: 10, z1: 58, at: () => roundRect(-6, -10, 6, 10, 2), floor: false },
    { z0: 58, z1: 66, at: () => roundRect(-20, -10, 20, 10, 3) },
  ],
  chain: [0, 1, 2, 3].map((i) => ({ z0: 0, z1: 14, at: () => roundRect(-44 + i * 23, -10, -24 + i * 23, 10, 4), walls: 3, hollow: true, roof: false })),
  knob: [
    { z0: 0, z1: 8, at: () => circle(0, 0, 16, 28) },
    { z0: 8, z1: 22, at: () => circle(0, 0, 6, 20), floor: false },
  ],
  spacer: [{ z0: 0, z1: 12, at: () => roundRect(-20, -12, 20, 12, 3) }],
};

export const DEMO_KINDS = Object.keys(MODELS);

/** Slice a demo part. Returns { text, layers: [{ offset, z }], height }. */
export function demoGcode(kind) {
  const parts = MODELS[kind] || MODELS.cube;
  const height = Math.max(...parts.map((p) => p.z1));
  const lines = [];
  let size = 0;
  let x = 0; let y = 0;
  let travelled = true;
  const out = (s) => { lines.push(s); size += s.length + 1; };
  const travel = (px, py) => {
    const d = Math.hypot(px - x, py - y);
    if (d < 0.01) return;
    if (d > 2) out('G1 E-0.8 F2400');
    out(`G0 X${f3(px + BED)} Y${f3(py + BED)} F7200`);
    if (d > 2) out('G1 E0.8 F2400');
    x = px; y = py; travelled = true;
  };
  const extrude = (px, py) => {
    const l = Math.hypot(px - x, py - y);
    if (l < 0.01) return;
    out(`G1 X${f3(px + BED)} Y${f3(py + BED)} E${(l * E_MM).toFixed(5)}${travelled ? ' F1800' : ''}`);
    x = px; y = py; travelled = false;
  };
  const loop = (poly) => { travel(poly[0][0], poly[0][1]); for (let i = 1; i <= poly.length; i++) extrude(...poly[i % poly.length]); };

  out(`; Layer1 demo part: ${kind}`);
  out(';FLAVOR:Marlin');
  out('M140 S60');
  out('M104 S205');
  out('G28');
  out('M190 S60');
  out('M109 S205');
  out('G90');
  out('M83');
  out('G92 E0');
  // prime line along the bed edge, before the first layer marker (the viewer leaves it out)
  out('G1 Z2 F600');
  out('G0 X5 Y20 F7200');
  out('G1 Z0.28 F600');
  out('G1 X5 Y200 E12 F1500');
  out('G1 X5.4 Y200');
  out('G1 X5.4 Y20 E12');
  out('G1 Z2 F600');
  x = 5.4 - BED; y = 20 - BED;
  const count = Math.round(height / LH);
  out(`;LAYER_COUNT:${count}`);

  const layers = [];
  for (let i = 0; i < count; i++) {
    const z = Math.round((i + 1) * LH * 1000) / 1000;
    layers.push({ offset: size, z });
    out(`;LAYER:${i}`);
    out(`G1 Z${f3(z)} F600`);
    for (const p of parts) {
      if (!(z > p.z0 + 1e-6 && z <= p.z1 + 1e-6)) continue;
      const outline = p.at(z - p.z0);
      const walls = p.walls || 2;
      for (let k = walls - 1; k >= 0; k--) loop(inset(outline, W * (k + 0.5)));
      const solid = (p.floor !== false && z - p.z0 <= SHELL + 1e-6) || (p.roof !== false && p.z1 - z < SHELL - 1e-6);
      if (p.hollow && !solid) continue;
      const lines2 = hatch(inset(outline, W * (walls + 0.15)), (i % 2 ? 1 : -1) * (Math.PI / 4), solid ? W : SPARSE);
      for (const [a, b] of lines2) { travel(a[0], a[1]); extrude(b[0], b[1]); }
    }
  }

  out('G1 E-2 F2400');
  out(`G0 Z${f3(height + 10)} F600`);
  out('G0 X0 Y210 F7200');
  out('M104 S0');
  out('M140 S0');
  out('M107');
  out('M84');
  return { text: `${lines.join('\n')}\n`, layers, height };
}

/** Height being printed at byte `pos` of a demoGcode() result. */
export function demoZAt(g, pos) {
  let z = 0;
  for (const l of g.layers) { if (l.offset > pos) break; z = l.z; }
  return z;
}
