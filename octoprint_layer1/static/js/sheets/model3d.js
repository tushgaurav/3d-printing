// Full-screen 3D view of a print: drag to turn it, follows the print live.
// Opened from the Home picture box once its model has loaded.

import { icon } from '../icons.js';
import { esc, clamp, displayName } from '../util.js';
import { mount, getScale } from '../ui.js';
import { printedBytes } from '../model.js';
import { ModelView, modelKey, DEFAULT_YAW, DEFAULT_PITCH } from '../model3d.js';

const YAW_PER_PX = 0.012;    // radians per pixel dragged
const PITCH_PER_PX = 0.008;
const PITCH_MIN = 0.12;      // stay above the bed: the drawing order needs a view from above
const PITCH_MAX = 1.5;

export function openModel3d(ctx, file, { onClose } = {}) {
  const { store } = ctx;
  const el = document.createElement('div');
  el.className = 'model-full';
  el.innerHTML = `<canvas></canvas>
    <div class="name">${esc(displayName(file))}</div>
    <div class="hud" data-r="hud">…</div>
    <div class="hint">${icon('rotate')}<span>Drag to rotate</span></div>
    <button class="round reset" aria-label="Reset view">${icon('again')}</button>
    <button class="round close" aria-label="Close">${icon('close')}</button>`;
  mount(el);
  const canvas = el.querySelector('canvas');
  const hud = el.querySelector('[data-r=hud]');

  const view = new ModelView(canvas, {
    fit: 'sphere', // same size at every angle
    onStats(st) {
      hud.textContent = st.done
        ? `${st.layers} layers · ${st.z.toFixed(1)} mm`
        : `Layer ${st.layer} / ${st.layers} · ${st.z.toFixed(2)} mm`;
    },
  });
  view.setModel(modelKey(file));
  view.setProgress(printedBytes(store.get(), file));
  const unsub = store.subscribe((s) => view.setProgress(printedBytes(s, file)));

  // ~~ drag to turn: a light frame while moving, the full one when the finger lifts
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, yaw: view.yaw, pitch: view.pitch, moved: false };
    try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const k = getScale();
    const dx = (e.clientX - drag.x) / k;
    const dy = (e.clientY - drag.y) / k;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    view.setAngles(drag.yaw + dx * YAW_PER_PX, clamp(drag.pitch + dy * PITCH_PER_PX, PITCH_MIN, PITCH_MAX), true);
  });
  const endDrag = () => {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    if (moved) view.setAngles(view.yaw, view.pitch, false);
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  el.querySelector('.reset').addEventListener('click', () => view.setAngles(DEFAULT_YAW, DEFAULT_PITCH, false));

  function close() {
    unsub();
    view.destroy();
    el.remove();
    if (onClose) onClose();
  }
  el.querySelector('.close').addEventListener('click', close);
  return close;
}
