// Touch calibration for resistive SPI screens.
//
// X maps touches with a "Coordinate Transformation Matrix" (screen = M · device,
// both normalised 0..1). The kiosk passes the matrix it applied as #tm=...
// We record where four taps land, fit the affine correction C that moves them
// onto the crosshairs, and print M_new = C · M_current for the kiosk config.
// Every tap counts wherever it lands, so this works even when touch is way off.

import { esc } from '../util.js';
import { mount } from '../ui.js';

const TARGETS = [[0.1, 0.12], [0.9, 0.12], [0.9, 0.88], [0.1, 0.88]];
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

function det3(m) {
  return m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
    - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
    + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
}

function solve3(A, b) {
  const D = det3(A);
  if (Math.abs(D) < 1e-9) return null;
  return [0, 1, 2].map((c) => det3(A.map((row, i) => row.map((v, k) => (k === c ? b[i] : v)))) / D);
}

/** Least-squares affine fit: returns [a,b,c,d,e,f] with t ≈ (a·x+b·y+c, d·x+e·y+f). */
export function fitAffine(obs, tgt) {
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const bx = [0, 0, 0];
  const by = [0, 0, 0];
  obs.forEach(([x, y], i) => {
    const v = [x, y, 1];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) A[r][c] += v[r] * v[c];
      bx[r] += v[r] * tgt[i][0];
      by[r] += v[r] * tgt[i][1];
    }
  });
  const px = solve3(A, bx);
  const py = solve3(A, by);
  return px && py ? [...px, ...py] : null;
}

/**
 * Is this fit trustworthy? Returns an error message, or null when it's fine.
 * A real run puts the four taps far apart and the fit lands each within a few pixels
 * of its crosshair; misclicks (e.g. pressing buttons while touch is still mirrored)
 * bunch taps together and leave a large residual, giving a wild matrix.
 */
export function checkFit(obs, tgt, c) {
  if (!c) return 'The taps were too close together. Tap each crosshair where it is drawn.';
  let spread = Infinity;
  for (let i = 0; i < obs.length; i++) {
    for (let j = i + 1; j < obs.length; j++) {
      spread = Math.min(spread, Math.hypot(obs[i][0] - obs[j][0], obs[i][1] - obs[j][1]));
    }
  }
  if (spread < 0.2) return 'Two taps landed almost in the same place. Tap each crosshair once, where it is drawn.';
  // residual in screen widths (y scaled by 320/480 so both axes count in the same units)
  const miss = Math.max(...obs.map(([x, y], i) => Math.hypot(
    c[0] * x + c[1] * y + c[2] - tgt[i][0], (c[3] * x + c[4] * y + c[5] - tgt[i][1]) * (320 / 480))));
  if (miss > 0.06) return 'The taps didn’t line up with each other. Hold still on each crosshair and try again.';
  return null;
}

export function mul3(a, b) {
  const out = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    out.push(a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]);
  }
  return out;
}

const fmt = (m) => m.map((v) => {
  const s = (Math.round(v * 10000) / 10000).toFixed(4).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
}).join(' ');

function median(points) {
  const xs = points.map((p) => p[0]).sort((a, b) => a - b);
  const ys = points.map((p) => p[1]).sort((a, b) => a - b);
  const m = Math.floor(points.length / 2);
  return [xs[m], ys[m]];
}

export function openCalibration(ctx) {
  const app = document.getElementById('app');
  const current = ctx.touchMatrix || IDENTITY;
  const el = document.createElement('div');
  el.className = 'calib';
  mount(el);

  let mode = 'collect';
  let index = 0;
  let samples = null;
  let observed = [];
  let correction = null;

  const pos = (e) => {
    const box = app.getBoundingClientRect();
    return [(e.clientX - box.left) / box.width, (e.clientY - box.top) / box.height];
  };
  const apply = (c, [x, y]) => [c[0] * x + c[1] * y + c[2], c[3] * x + c[4] * y + c[5]];
  const pct = ([x, y]) => `left:${(x * 100).toFixed(2)}%;top:${(y * 100).toFixed(2)}%`;

  function drawTarget() {
    el.innerHTML = `<div class="target" style="${pct(TARGETS[index])}"><i></i></div>
      <div class="help"><b>Tap the crosshair · ${index + 1} of ${TARGETS.length}</b>
      <span>Use a stylus or fingernail and hold still for a moment. Every tap counts wherever it lands.</span></div>`;
  }

  function drawResult(error) {
    mode = 'result';
    if (error) {
      el.innerHTML = `<div class="result"><h3>That didn’t work</h3><div class="note">${esc(error)}</div>
        <div class="row-actions"><button class="btn" data-a="redo">Try Again</button><button class="btn ghost" data-a="close">Close</button></div></div>`;
      return;
    }
    const m = mul3([...correction, 0, 0, 1], current);
    // Also to the browser log, so the result can be read over SSH (kiosk/demo logs).
    console.info(`[ender5] touch matrix: ${fmt(m)} | taps: ${JSON.stringify(observed.map((p) => p.map((v) => +v.toFixed(4))))}`);
    el.innerHTML = `<div class="result">
      <h3>Touch calibrated</h3>
      <div class="note">To keep it, run this on the Pi over SSH. The screen restarts with the new setting:</div>
      <code>sudo ender5-kiosk set-touch "${fmt(m)}"</code>
      <div class="note">${ctx.touchMatrix ? '' : 'The kiosk didn’t report its current matrix, so this assumes none was set. '}Use “Test” to check: grey dot is where touches land now, green is where they will land.</div>
      <div class="row-actions"><button class="btn ghost" data-a="redo">Redo</button><button class="btn" data-a="test">Test</button><button class="btn primary" data-a="close">Close</button></div>
    </div>`;
  }

  function drawTest() {
    mode = 'test';
    el.innerHTML = `<div class="help"><b>Tap anywhere</b><span>Grey = now · green = after calibration</span></div>
      <button class="btn" data-a="back" style="position:absolute;left:50%;bottom:16px;transform:translateX(-50%);width:200px;height:56px">Back</button>`;
  }

  function finish() {
    correction = fitAffine(observed, TARGETS);
    const problem = checkFit(observed, TARGETS, correction);
    if (problem) {
      console.info(`[ender5] touch calibration rejected: ${problem} | taps: ${JSON.stringify(observed.map((p) => p.map((v) => +v.toFixed(4))))}`);
      drawResult(problem);
      return;
    }
    drawResult();
  }

  el.addEventListener('pointerdown', (e) => {
    if (mode === 'result') return;
    samples = [pos(e)];
    // capture only while collecting; in test mode it would steal the Back button's click
    if (mode === 'collect') { try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ } }
  });
  el.addEventListener('pointermove', (e) => { if (samples) samples.push(pos(e)); });
  el.addEventListener('pointerup', (e) => {
    if (!samples) return;
    samples.push(pos(e));
    const p = median(samples);
    samples = null;
    if (mode === 'collect') {
      observed.push(p);
      index += 1;
      if (index < TARGETS.length) drawTarget(); else finish();
    } else if (mode === 'test' && !e.target.closest('[data-a]')) {
      el.querySelectorAll('.dot').forEach((d) => d.remove());
      el.insertAdjacentHTML('beforeend', `<div class="dot raw" style="${pct(p)}"></div><div class="dot fix" style="${pct(apply(correction, p))}"></div>`);
    }
  });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    if (b.dataset.a === 'close') el.remove();
    else if (b.dataset.a === 'redo') { mode = 'collect'; index = 0; observed = []; drawTarget(); }
    else if (b.dataset.a === 'test') drawTest();
    else if (b.dataset.a === 'back') drawResult();
  });

  drawTarget();
}
