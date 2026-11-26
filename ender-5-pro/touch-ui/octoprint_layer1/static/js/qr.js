// A small QR Code encoder (ISO/IEC 18004) so the screen can show its own web address
// without a library or the internet. Byte mode only (UTF-8), versions 1-40, automatic
// mask choice. Follows the structure of Project Nayuki's QR Code generator (MIT).
//
//   qrMatrix('http://192.168.1.42/')  -> rows of booleans, true = dark module
//   qrSVG('http://192.168.1.42/', { size: 150 })  -> '<svg …>' 150px square, quiet zone included

const ECL_INDEX = { L: 0, M: 1, Q: 2, H: 3 };
const ECL_FORMAT = [1, 0, 3, 2]; // the two format-info bits for L, M, Q, H

// [ecl][version]: error correction codewords per block, and number of blocks
const ECC_PER_BLOCK = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];
const NUM_BLOCKS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

const bit = (x, i) => ((x >>> i) & 1) !== 0;

/** Modules left for data and error correction once the fixed patterns are drawn. */
function rawModules(ver) {
  let n = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const align = Math.floor(ver / 7) + 2;
    n -= (25 * align - 10) * align - 55;
    if (ver >= 7) n -= 36;
  }
  return n;
}

const dataCodewords = (ver, e) => Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[e][ver] * NUM_BLOCKS[e][ver];

// ~~ Reed-Solomon over GF(2^8), polynomial 0x11D

function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function rsDivisor(degree) {
  const out = new Array(degree).fill(0);
  out[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      out[j] = gfMul(out[j], root);
      if (j + 1 < degree) out[j] ^= out[j + 1];
    }
    root = gfMul(root, 2);
  }
  return out;
}

function rsRemainder(data, divisor) {
  const out = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ out.shift();
    out.push(0);
    divisor.forEach((c, i) => { out[i] ^= gfMul(c, factor); });
  }
  return out;
}

// ~~ codewords

/** Mode, length, bytes, terminator and padding, packed into data codewords. */
function encodeData(bytes, ver, e) {
  const bits = [];
  const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(0x4, 4); // byte mode
  put(bytes.length, ver <= 9 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  const capacity = dataCodewords(ver, e) * 8;
  put(0, Math.min(4, capacity - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) put(pad, 8);
  const out = [];
  for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  return out;
}

/** Split into blocks, add each block's error correction, then interleave. */
function addEcc(data, ver, e) {
  const numBlocks = NUM_BLOCKS[e][ver];
  const eccLen = ECC_PER_BLOCK[e][ver];
  const raw = Math.floor(rawModules(ver) / 8);
  const numShort = numBlocks - (raw % numBlocks);
  const shortLen = Math.floor(raw / numBlocks);
  const div = rsDivisor(eccLen);
  const blocks = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < numShort ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, div);
    if (i < numShort) dat.push(0); // placeholder, skipped below
    blocks.push(dat.concat(ecc));
  }
  const out = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((b, j) => { if (i !== shortLen - eccLen || j >= numShort) out.push(b[i]); });
  }
  return out;
}

// ~~ the symbol

function alignmentPositions(ver, size) {
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2;
  const step = Math.floor((ver * 8 + n * 3 + 5) / (n * 4 - 4)) * 2;
  const out = [6];
  for (let pos = size - 7; out.length < n; pos -= step) out.splice(1, 0, pos);
  return out;
}

function penalty(m, size) {
  let score = 0;
  let dark = 0;
  const finderA = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const finderB = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  for (let pass = 0; pass < 2; pass++) {
    // pass 0 reads rows, pass 1 reads columns
    const at = pass ? (a, b) => m[b][a] : (a, b) => m[a][b];
    for (let a = 0; a < size; a++) {
      let run = 1;
      for (let b = 1; b <= size; b++) {
        if (b < size && at(a, b) === at(a, b - 1)) { run++; continue; }
        if (run >= 5) score += run - 2; // 3 for five in a row, +1 for each one longer
        run = 1;
      }
      for (let b = 0; b + 11 <= size; b++) {
        let fa = true;
        let fb = true;
        for (let k = 0; k < 11 && (fa || fb); k++) {
          const v = at(a, b + k) ? 1 : 0;
          if (v !== finderA[k]) fa = false;
          if (v !== finderB[k]) fb = false;
        }
        if (fa) score += 40;
        if (fb) score += 40;
      }
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (m[y][x]) dark++;
      if (x + 1 < size && y + 1 < size) {
        const c = m[y][x];
        if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
      }
    }
  }
  const total = size * size;
  score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return score;
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/**
 * The QR code for text as rows of booleans (true = dark), without the quiet zone.
 * Uses the smallest version that fits at error correction level ecl ('L'|'M'|'Q'|'H'),
 * then raises the level as far as that version still allows.
 */
export function qrMatrix(text, ecl = 'M') {
  const bytes = Array.from(new TextEncoder().encode(String(text)));
  let e = ECL_INDEX[ecl] ?? 1;
  const bitsNeeded = (ver) => 4 + (ver <= 9 ? 8 : 16) + bytes.length * 8;
  let ver = 1;
  while (ver <= 40 && bitsNeeded(ver) > dataCodewords(ver, e) * 8) ver++;
  if (ver > 40) throw new Error('Too long for a QR code');
  while (e < 3 && bitsNeeded(ver) <= dataCodewords(ver, e + 1) * 8) e++;

  const size = ver * 4 + 17;
  const m = Array.from({ length: size }, () => new Array(size).fill(false));
  const fixed = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, dark) => { m[y][x] = dark; fixed[y][x] = true; };

  // timing lines, then finders (with their separators), then alignment patterns
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
      }
    }
  }
  const al = alignmentPositions(ver, size);
  for (let i = 0; i < al.length; i++) {
    for (let j = 0; j < al.length; j++) {
      const corner = (i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0);
      if (corner) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) set(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }

  const drawFormat = (mask) => {
    const data = (ECL_FORMAT[e] << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    for (let i = 0; i <= 5; i++) set(8, i, bit(bits, i));
    set(8, 7, bit(bits, 6));
    set(8, 8, bit(bits, 7));
    set(7, 8, bit(bits, 8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(bits, i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(bits, i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(bits, i));
    set(8, size - 8, true); // the dark module
  };
  drawFormat(0); // reserve the area; the real mask is written at the end

  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, bit(bits, i));
      set(b, a, bit(bits, i));
    }
  }

  // data in two-module columns, zig-zagging up and down from the bottom right
  const words = addEcc(encodeData(bytes, ver, e), ver, e);
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // skip the vertical timing line
    const up = ((right + 1) & 2) === 0;
    for (let v = 0; v < size; v++) {
      const y = up ? size - 1 - v : v;
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        if (!fixed[y][x] && i < words.length * 8) {
          m[y][x] = bit(words[i >>> 3], 7 - (i & 7));
          i++;
        }
      }
    }
  }

  const applyMask = (k) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) if (!fixed[y][x] && MASKS[k](x, y)) m[y][x] = !m[y][x];
    }
  };
  let best = 0;
  let bestScore = Infinity;
  for (let k = 0; k < 8; k++) {
    applyMask(k);
    drawFormat(k);
    const s = penalty(m, size);
    if (s < bestScore) { best = k; bestScore = s; }
    applyMask(k); // XOR again undoes it
  }
  applyMask(best);
  drawFormat(best);
  return m;
}

/**
 * A `size` px white square with the code centred on it, dark on white. Modules are as large
 * as fits with at least `quiet` modules of margin, and a whole number of pixels each so the
 * edges stay crisp on the panel. Codes of different versions come out the same size.
 */
export function qrSVG(text, { size = 150, quiet = 4, ecl = 'M' } = {}) {
  const m = qrMatrix(text, ecl);
  const px = Math.max(1, Math.floor(size / (m.length + quiet * 2)));
  const off = Math.floor((size - m.length * px) / 2);
  let d = '';
  m.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (!row[x]) continue;
      let w = 1;
      while (row[x + w]) w++;
      d += `M${off + x * px} ${off + y * px}h${w * px}v${px}h-${w * px}z`;
      x += w - 1;
    }
  });
  return `<svg class="qr" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" shape-rendering="crispEdges" aria-hidden="true">`
    + `<rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
