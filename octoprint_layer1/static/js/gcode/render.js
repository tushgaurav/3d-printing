// Draws a parsed model (parse.js) in 3D on a 2D canvas: printed layers shaded,
// the layer in progress highlighted, what is still to print as a faint ghost.
//
// Plain Canvas 2D on purpose: the kiosk runs Chromium with the GPU off, so there
// is no WebGL. Layers are drawn bottom to top, which hides the right lines for
// any view from above: two points that land on the same pixel can only be on
// different layers, and the higher one is then always the nearer one.

const BUCKETS = 8;              // shades of the body colour
const FAST_BUDGET = 24000;      // segments drawn per frame while the view is being dragged
const LIGHT = [-0.42, -0.91];   // light direction in view space (screen x, depth): from the front left

export const DEFAULT_YAW = -0.6;    // radians, a three-quarter view from the front left
export const DEFAULT_PITCH = 0.5;   // radians above the horizon

function rgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  const v = m ? parseInt(m[1], 16) : 0x9aa0a6;
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** 'rgba(r, g, b, a)' or '#rrggbb' -> [opaque colour, alpha] */
function colourAlpha(c) {
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)/i.exec(String(c));
  if (!m) return [c, 1];
  return [`rgb(${m[1]},${m[2]},${m[3]})`, m[4] === undefined ? 1 : +m[4]];
}

let ghostCanvas = null;
function ghostLayer(w, h) {
  if (!ghostCanvas || ghostCanvas.width !== w || ghostCanvas.height !== h) ghostCanvas = new OffscreenCanvas(w, h);
  return ghostCanvas;
}

// per-shade lists of segment indices for one layer, reused between frames
let scratch = null;
function scratchBuckets(size) {
  if (!scratch || scratch[0].length < size) {
    scratch = Array.from({ length: BUCKETS }, () => new Uint32Array(Math.max(1, size)));
  }
  return scratch;
}

/** Last segment index whose line ends at or before byte `upTo` (-1 if none). */
function printedUpTo(off, upTo) {
  if (!(upTo < Infinity)) return off.length - 1;
  let lo = 0; let hi = off.length - 1; let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (off[mid] <= upTo) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/** Layer (file order) that holds segment `idx`. */
function layerOf(start, idx) {
  let lo = 0; let hi = start.length - 1; let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (start[mid] <= idx) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/**
 * o: { w, h, dpr, yaw, pitch, upTo (bytes printed; Infinity = all), fit: 'box' | 'sphere',
 *      fast, palette: { body, shade, ghost, layer, plate, grid, halo } }
 * Returns { layer, layers, z, done }: the layer in progress (1-based), the total, its height.
 */
export function renderModel(ctx, m, o) {
  const { w, h } = o;
  const dpr = o.dpr || 1;
  const pal = o.palette || {};
  ctx.clearRect(0, 0, w, h);

  const b = m.bounds;
  const { seg, off } = m;
  const { z: lz, start, end, order, rank } = m.layers;
  const L = m.layerCount;

  // ~~ projection: yaw turns the part on the bed, pitch tilts the view down onto it
  const cyw = Math.cos(o.yaw); const syw = Math.sin(o.yaw);
  const cp = Math.cos(o.pitch); const sp = Math.sin(o.pitch);
  const mx = (b.minX + b.maxX) / 2; const my = (b.minY + b.maxY) / 2; const mz = (b.minZ + b.maxZ) / 2;
  const U = (x, y) => (x - mx) * cyw - (y - my) * syw;                                // screen right
  const V = (x, y, zz) => (zz - mz) * cp + ((x - mx) * syw + (y - my) * cyw) * sp;   // screen up

  const pad = 10 * dpr;
  let s; let ox; let oy;
  if (o.fit === 'sphere') { // constant size while turning
    const r = 0.5 * Math.hypot(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ) || 1;
    s = (Math.min(w, h) - 2 * pad) / (2 * r);
    ox = w / 2; oy = h / 2;
  } else { // fill the box at this angle
    let u0 = Infinity; let u1 = -Infinity; let v0 = Infinity; let v1 = -Infinity;
    for (const x of [b.minX, b.maxX]) for (const y of [b.minY, b.maxY]) for (const zz of [b.minZ, b.maxZ]) {
      const u = U(x, y); const v = V(x, y, zz);
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    s = Math.min((w - 2 * pad) / Math.max(u1 - u0, 1e-3), (h - 2 * pad) / Math.max(v1 - v0, 1e-3));
    ox = w / 2 - s * ((u0 + u1) / 2);
    oy = h / 2 + s * ((v0 + v1) / 2);
  }
  // screen = A*x + B*y (+ C*z) + K, inlined in the loops below
  const ax = s * cyw; const bx = -s * syw; const kx = ox - s * (mx * cyw - my * syw);
  const ay = -s * syw * sp; const by = -s * cyw * sp; const az = -s * cp;
  const ky = oy + s * (mz * cp + (mx * syw + my * cyw) * sp);

  // ~~ the bed under the part: a plate with a 10 mm grid
  const margin = Math.max(6, 0.22 * Math.max(b.maxX - b.minX, b.maxY - b.minY));
  const px0 = b.minX - margin; const px1 = b.maxX + margin; const py0 = b.minY - margin; const py1 = b.maxY + margin;
  const pz = b.minZ;
  const P = (x, y) => [ax * x + bx * y + kx, ay * x + by * y + az * pz + ky];
  ctx.beginPath();
  for (const [x, y] of [[px0, py0], [px1, py0], [px1, py1], [px0, py1]]) { const [X, Y] = P(x, y); ctx.lineTo(X, Y); }
  ctx.closePath();
  ctx.fillStyle = pal.plate || 'rgba(128,128,128,0.15)';
  ctx.fill();
  ctx.beginPath();
  for (let g = Math.ceil(px0 / 10) * 10; g <= px1; g += 10) { const [X0, Y0] = P(g, py0); const [X1, Y1] = P(g, py1); ctx.moveTo(X0, Y0); ctx.lineTo(X1, Y1); }
  for (let g = Math.ceil(py0 / 10) * 10; g <= py1; g += 10) { const [X0, Y0] = P(px0, g); const [X1, Y1] = P(px1, g); ctx.moveTo(X0, Y0); ctx.lineTo(X1, Y1); }
  ctx.strokeStyle = pal.grid || 'rgba(128,128,128,0.2)';
  ctx.lineWidth = Math.max(1, dpr);
  ctx.stroke();

  // ~~ progress
  const last = printedUpTo(off, o.upTo);            // last printed segment
  const done = last >= m.count - 1;
  const cur = last >= 0 ? layerOf(start, last) : -1; // layer in progress (file order)

  // ~~ shading: walls facing the light are brighter; a line has no "outside", so both sides count
  const body = rgb(pal.body);
  const shadeMin = Number.isFinite(+pal.shade) ? +pal.shade : 0.45;
  const colours = Array.from({ length: BUCKETS }, (_, k) => {
    const f = shadeMin + (1 - shadeMin) * ((k + 0.5) / BUCKETS);
    return `rgb(${Math.round(body[0] * f)},${Math.round(body[1] * f)},${Math.round(body[2] * f)})`;
  });
  // |normal · light| for a segment direction (dx, dy), normal = (-dy, dx) turned into view space
  const lx = LIGHT[0]; const ld = LIGHT[1];
  const kdx = -syw * lx + cyw * ld;
  const kdy = -cyw * lx - syw * ld;
  const buckets = scratchBuckets(m.maxLayerSegs);
  const fill = new Uint32Array(BUCKETS);

  // One device pixel, whatever the zoom: software canvas draws such thin lines on a fast
  // path, many times faster than wider ones, and layers sit closer than a pixel apart
  // anyway, so walls still look solid.
  const lw = dpr;
  const stride = o.fast ? Math.max(1, Math.ceil(m.count / FAST_BUDGET)) : 1;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  let kyz = 0; // ky + az * (layer z), set per layer
  const line = (path, k) => {
    const x1 = seg[k]; const y1 = seg[k + 1]; const x2 = seg[k + 2]; const y2 = seg[k + 3];
    path.moveTo(ax * x1 + bx * y1 + kx, ay * x1 + by * y1 + kyz);
    path.lineTo(ax * x2 + bx * y2 + kx, ay * x2 + by * y2 + kyz);
  };

  const ghost = new Path2D();
  let ghostCount = 0;

  for (let r = 0; r < L; r++) {
    const li = order[r];
    if (stride > 1 && r % stride && li !== cur) continue;
    const a = start[li]; const e = end[li];
    kyz = ky + az * lz[li];
    const pe = last < a ? a : last >= e ? e : last + 1; // printed: [a, pe)

    if (pe > a) {
      if (li === cur && !done) {
        // the layer being printed, in the progress colour
        ctx.beginPath();
        for (let i = a; i < pe; i++) line(ctx, i * 4);
        ctx.strokeStyle = pal.layer || '#c8f251';
        ctx.lineWidth = 2 * lw;
        ctx.stroke();
      } else {
        fill.fill(0);
        for (let i = a; i < pe; i++) {
          const k = i * 4;
          const dx = seg[k + 2] - seg[k]; const dy = seg[k + 3] - seg[k + 1];
          const len = Math.hypot(dx, dy) || 1;
          const t = Math.abs(dx * kdx + dy * kdy) / len;
          const q = t >= 1 ? BUCKETS - 1 : (t * BUCKETS) | 0;
          buckets[q][fill[q]++] = i;
        }
        ctx.lineWidth = lw;
        for (let q = 0; q < BUCKETS; q++) {
          if (!fill[q]) continue;
          ctx.beginPath();
          const idx = buckets[q];
          for (let j = 0; j < fill[q]; j++) line(ctx, idx[j] * 4);
          ctx.strokeStyle = colours[q];
          ctx.stroke();
        }
      }
    }
    for (let i = pe; i < e; i++) { line(ghost, i * 4); ghostCount++; }
  }

  if (ghostCount) {
    // drawn opaque on its own layer, then blended once: one translucent stroke of a huge
    // path is very slow in software, and overlapping lines must not add up to solid
    const [colour, alpha] = colourAlpha(pal.ghost || 'rgba(128,128,128,0.15)');
    const layer = ghostLayer(w, h);
    const g = layer.getContext('2d');
    g.clearRect(0, 0, w, h);
    g.lineWidth = lw;
    g.strokeStyle = colour;
    g.stroke(ghost);
    ctx.globalAlpha = alpha;
    ctx.drawImage(layer, 0, 0);
    ctx.globalAlpha = 1;
  }

  // the nozzle: end of the last printed line
  if (!done && last >= 0) {
    const k = last * 4;
    kyz = ky + az * lz[cur];
    const X = ax * seg[k + 2] + bx * seg[k + 3] + kx;
    const Y = ay * seg[k + 2] + by * seg[k + 3] + kyz;
    ctx.beginPath();
    ctx.arc(X, Y, 3.5 * dpr, 0, 2 * Math.PI);
    ctx.fillStyle = pal.layer || '#c8f251';
    ctx.fill();
    ctx.lineWidth = 1.5 * dpr;
    ctx.strokeStyle = pal.halo || '#000';
    ctx.stroke();
  }

  return {
    layer: done ? L : cur >= 0 ? rank[cur] + 1 : 0,
    layers: L,
    z: done ? lz[order[L - 1]] : cur >= 0 ? lz[cur] : 0,
    done,
  };
}
