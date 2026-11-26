// G-code -> compact toolpath model for the 3D view. Runs in the worker; no DOM.
//
// Only extruding XY moves are kept, as segments grouped into layers by Z. Each
// segment remembers the byte offset just past its line, so OctoPrint's
// progress.filepos (bytes of the file sent so far) splits the model into what is
// printed and what is still to come. The file is read as bytes, not text, so
// those offsets stay exact even when comments hold non-ASCII characters.

const LAYER_EPS = 0.03;          // mm of Z change that starts a new layer (vase mode creeps up)
const MERGE_SIN = 0.026;         // ~1.5°: a nearly straight continuation merges into one segment
const TINY = 0.08;               // mm: shorter continuations always merge
const ARC_STEP = Math.PI / 18;   // arcs (G2/G3) are drawn in 10° pieces

// byte values
const B = { G: 71, M: 77, N: 78, SEMI: 59, STAR: 42, LF: 10 };

/** Offset of the first slicer layer marker (";LAYER:" Cura, ";LAYER_CHANGE" Prusa/Orca), or -1. */
function firstLayerMarker(b) {
  const L = [76, 65, 89, 69, 82]; // "LAYER"
  for (let i = 0; i < b.length - 7; i++) {
    if (b[i] !== B.SEMI) continue;
    let k = 0;
    while (k < 5 && b[i + 1 + k] === L[k]) k++;
    if (k === 5 && (b[i + 6] === 58 || b[i + 6] === 95)) return i; // ':' or '_'
  }
  return -1;
}

/**
 * bytes: Uint8Array of a G-code file.
 * Returns { seg, off, count, layers: { z, start, end, order, rank }, layerCount, maxLayerSegs, bounds, size, truncated }.
 * seg holds x1,y1,x2,y2 per segment; layer i is segments [start[i], end[i]) at height z[i];
 * order lists layers bottom to top (the drawing order) and rank is its inverse.
 */
export function parseGcode(bytes, { maxSegments = 2000000 } = {}) {
  const len = bytes.length;
  let cap = 1 << 16;
  let seg = new Float32Array(cap * 4);
  let off = new Uint32Array(cap);
  let n = 0;
  const layerZ = [];
  const layerStart = [];
  let truncated = false;

  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  let minZ = Infinity; let maxZ = -Infinity;

  // machine state
  let x = 0; let y = 0; let z = 0; let e = 0;
  let absPos = true; let absE = true;
  let curZ = NaN;          // Z of the layer being filled
  // the last segment, for merging continuations
  let linked = false;      // the last stored segment ends where the next one may start
  let sx = 0; let sy = 0;  // its start (float64, the stored copy is float32)
  let ex = 0; let ey = 0;  // its end

  // skip the purge/prime line in the start G-code when the slicer marks layers
  const skipBefore = firstLayerMarker(bytes);

  function grow() {
    cap *= 2;
    const s2 = new Float32Array(cap * 4); s2.set(seg); seg = s2;
    const o2 = new Uint32Array(cap); o2.set(off); off = o2;
  }

  function addSeg(x1, y1, x2, y2, zz, o) {
    if (n >= maxSegments) { truncated = true; return; }
    if (!(Math.abs(zz - curZ) < LAYER_EPS)) {
      curZ = zz;
      layerZ.push(zz);
      layerStart.push(n);
      linked = false;
      if (zz < minZ) minZ = zz;
      if (zz > maxZ) maxZ = zz;
    }
    const dx = x2 - x1; const dy = y2 - y1;
    if (linked && x1 === ex && y1 === ey) {
      const px = ex - sx; const py = ey - sy;
      const l2 = Math.hypot(dx, dy);
      if (l2 < TINY || (px * dx + py * dy > 0 && Math.abs(px * dy - py * dx) < MERGE_SIN * Math.hypot(px, py) * l2)) {
        const k = (n - 1) * 4;
        seg[k + 2] = x2; seg[k + 3] = y2;
        off[n - 1] = o;
        ex = x2; ey = y2;
        if (x2 < minX) minX = x2; if (x2 > maxX) maxX = x2;
        if (y2 < minY) minY = y2; if (y2 > maxY) maxY = y2;
        return;
      }
    }
    if (n === cap) grow();
    const k = n * 4;
    seg[k] = x1; seg[k + 1] = y1; seg[k + 2] = x2; seg[k + 3] = y2;
    off[n] = o;
    n++;
    sx = x1; sy = y1; ex = x2; ey = y2; linked = true;
    if (x1 < minX) minX = x1; if (x1 > maxX) maxX = x1;
    if (x2 < minX) minX = x2; if (x2 > maxX) maxX = x2;
    if (y1 < minY) minY = y1; if (y1 > maxY) maxY = y1;
    if (y2 < minY) minY = y2; if (y2 > maxY) maxY = y2;
  }

  // number parser over the byte buffer; leaves the read position in `p`
  let p = 0;
  function num(end) {
    let sign = 1;
    if (bytes[p] === 45) { sign = -1; p++; } else if (bytes[p] === 43) p++;
    let v = 0; let digits = 0;
    while (p < end) { const c = bytes[p] - 48; if (c < 0 || c > 9) break; v = v * 10 + c; p++; digits++; }
    if (bytes[p] === 46) {
      p++;
      let f = 0.1;
      while (p < end) { const c = bytes[p] - 48; if (c < 0 || c > 9) break; v += c * f; f *= 0.1; p++; digits++; }
    }
    return digits ? sign * v : NaN;
  }

  let i = 0;
  while (i < len) {
    let end = i;
    while (end < len && bytes[end] !== B.LF) end++;
    const lineEnd = end < len ? end + 1 : end; // OctoPrint's filepos counts the newline too
    p = i;
    i = lineEnd;

    while (p < end && (bytes[p] === 32 || bytes[p] === 9)) p++;
    let c = bytes[p] & 0xdf; // upper-case
    if (c === B.N) { // line number
      p++; num(end);
      while (p < end && (bytes[p] === 32 || bytes[p] === 9)) p++;
      c = bytes[p] & 0xdf;
    }
    if (c !== B.G && c !== B.M) continue;
    p++;
    const code = num(end);
    if (Number.isNaN(code)) continue;
    const g = c === B.G;

    // parameters
    let hasX = false; let hasY = false; let hasZ = false; let hasE = false; let hasI = false; let hasJ = false;
    let X = 0; let Y = 0; let Z = 0; let E = 0; let I = 0; let J = 0;
    while (p < end) {
      const ch = bytes[p];
      if (ch === B.SEMI || ch === B.STAR) break;
      const L = ch & 0xdf;
      if (L < 65 || L > 90) { p++; continue; }
      p++;
      const v = num(end);
      switch (L) {
        case 88: hasX = true; X = v; break; // X
        case 89: hasY = true; Y = v; break; // Y
        case 90: hasZ = true; Z = v; break; // Z
        case 69: hasE = true; E = v; break; // E
        case 73: hasI = true; I = v; break; // I
        case 74: hasJ = true; J = v; break; // J
        default:
      }
    }

    if (g && (code === 0 || code === 1 || code === 2 || code === 3)) {
      const nx = hasX && !Number.isNaN(X) ? (absPos ? X : x + X) : x;
      const ny = hasY && !Number.isNaN(Y) ? (absPos ? Y : y + Y) : y;
      const nz = hasZ && !Number.isNaN(Z) ? (absPos ? Z : z + Z) : z;
      let de = 0;
      if (hasE && !Number.isNaN(E)) {
        if (absE) { de = E - e; e = E; } else de = E;
      }
      const extruding = de > 1e-6 && (nx !== x || ny !== y) && lineEnd > skipBefore;
      if (extruding) {
        if ((code === 2 || code === 3) && (hasI || hasJ)) {
          const cx = x + (hasI ? I : 0); const cy = y + (hasJ ? J : 0);
          const r = Math.hypot(x - cx, y - cy);
          const a0 = Math.atan2(y - cy, x - cx);
          let sweep = Math.atan2(ny - cy, nx - cx) - a0;
          if (code === 2) { if (sweep >= -1e-9) sweep -= 2 * Math.PI; } else if (sweep <= 1e-9) sweep += 2 * Math.PI;
          const pieces = Math.max(1, Math.ceil(Math.abs(sweep) / ARC_STEP));
          let px = x; let py = y;
          for (let k = 1; k <= pieces; k++) {
            const last = k === pieces;
            const a = a0 + (sweep * k) / pieces;
            const qx = last ? nx : cx + r * Math.cos(a);
            const qy = last ? ny : cy + r * Math.sin(a);
            addSeg(px, py, qx, qy, nz, lineEnd);
            px = qx; py = qy;
          }
        } else {
          addSeg(x, y, nx, ny, nz, lineEnd);
        }
      }
      x = nx; y = ny; z = nz;
    } else if (g && code === 28) { // home: named axes, or all
      const all = !hasX && !hasY && !hasZ;
      if (all || hasX) x = 0;
      if (all || hasY) y = 0;
      if (all || hasZ) z = 0;
    } else if (g && code === 90) { absPos = true; absE = true; }
    else if (g && code === 91) { absPos = false; absE = false; }
    else if (g && code === 92) {
      const none = !hasX && !hasY && !hasZ && !hasE;
      if (hasX) x = X || 0;
      if (hasY) y = Y || 0;
      if (hasZ) z = Z || 0;
      if (hasE || none) e = hasE ? E || 0 : 0;
      if (none) { x = 0; y = 0; z = 0; }
    } else if (!g && code === 82) absE = true;
    else if (!g && code === 83) absE = false;
  }

  if (!n) throw new Error('No printable moves in this G-code');

  const L = layerZ.length;
  const zs = Float32Array.from(layerZ);
  const start = Uint32Array.from(layerStart);
  const endIdx = new Uint32Array(L);
  let maxLayerSegs = 0;
  for (let k = 0; k < L; k++) {
    endIdx[k] = k + 1 < L ? start[k + 1] : n;
    maxLayerSegs = Math.max(maxLayerSegs, endIdx[k] - start[k]);
  }
  const order = Uint32Array.from({ length: L }, (_, k) => k).sort((a, b) => zs[a] - zs[b] || a - b);
  const rank = new Uint32Array(L);
  for (let k = 0; k < L; k++) rank[order[k]] = k;

  return {
    seg: seg.subarray(0, n * 4),
    off: off.subarray(0, n),
    count: n,
    layers: { z: zs, start, end: endIdx, order, rank },
    layerCount: L,
    maxLayerSegs,
    bounds: { minX, maxX, minY, maxY, minZ: Math.min(0, minZ), maxZ },
    size: len,
    truncated,
  };
}
