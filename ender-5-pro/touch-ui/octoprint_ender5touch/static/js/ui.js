// Overlays shared by all screens: toasts, dialogs, keypad, sheets, camera,
// plus drag-to-scroll (resistive touch often arrives as a mouse, and a mouse
// drag would otherwise select text instead of scrolling).

import { icon } from './icons.js';
import { esc, camTransform } from './util.js';

let layer = null;
let toastBox = null;
let scale = 1;
const sheets = [];

export function initUI(app) {
  layer = app.querySelector('#layer');
  toastBox = document.createElement('div');
  toastBox.className = 'toasts';
  layer.appendChild(toastBox);
}

export function setScale(s) { scale = s || 1; }
export function getScale() { return scale; }

/** Add an element to the overlay layer (below toasts). */
export function mount(el) {
  layer.insertBefore(el, toastBox);
  return el;
}

export function toast(text, tone = 'muted', ms = 3500) {
  if (!toastBox) { console.warn(text); return; }
  const el = document.createElement('div');
  el.className = 'toast';
  el.dataset.tone = tone;
  el.textContent = text;
  toastBox.appendChild(el);
  while (toastBox.children.length > 2) toastBox.firstChild.remove();
  setTimeout(() => el.remove(), ms);
}

/** Run an action; failures become a toast instead of a silent console error. */
export async function attempt(fn) {
  try {
    return await fn();
  } catch (e) {
    let msg = (e && e.message) || String(e);
    if (e && e.status === 409) msg = msg && !/^409/.test(msg) ? msg : 'Printer is busy or not connected';
    toast(msg, 'danger', 5000);
    return undefined;
  }
}

function scrim(html) {
  const s = document.createElement('div');
  s.className = 'scrim';
  s.innerHTML = html;
  return mount(s);
}

export function confirmDialog({ title, body = '', confirm = 'OK', cancel = 'Cancel', tone = 'primary' }) {
  return new Promise((resolve) => {
    const s = scrim(`<div class="modal"><h3>${esc(title)}</h3>${body ? `<p>${esc(body)}</p>` : ''}
      <div class="row-actions"><button class="btn ghost" data-a="no">${esc(cancel)}</button>
      <button class="btn ${tone}" data-a="yes">${esc(confirm)}</button></div></div>`);
    s.addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]');
      if (!a && e.target !== s) return;
      s.remove();
      resolve(!!a && a.dataset.a === 'yes');
    });
  });
}

/** options: [{ label, sub, value, tone, active }] -> resolves with value, or null. active marks the current choice. */
export function choiceDialog({ title, options }) {
  return new Promise((resolve) => {
    const s = scrim(`<div class="modal"><h3>${esc(title)}</h3>
      <div class="choices">${options.map((o, i) => `<button class="btn ${o.tone || ''} ${o.active ? 'current' : ''}" data-i="${i}">${esc(o.label)}${o.sub ? `<small>${esc(o.sub)}</small>` : ''}</button>`).join('')}</div>
      <div class="row-actions"><button class="btn ghost" data-i="-1">Cancel</button></div></div>`);
    s.addEventListener('click', (e) => {
      const b = e.target.closest('[data-i]');
      if (!b && e.target !== s) return;
      s.remove();
      const i = b ? +b.dataset.i : -1;
      resolve(i >= 0 ? options[i].value : null);
    });
  });
}

/** Big-key number entry. Resolves with a number, or null when cancelled. */
export function numberPad({ title, value = 0, min = 0, max = 300, unit = '°', hint }) {
  return new Promise((resolve) => {
    let text = value ? String(Math.round(value)) : '0';
    let fresh = true; // first key press replaces the old value
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clr', '0', 'del'];
    const s = scrim(`<div class="modal keypad">
      <div class="left">
        <h3>${esc(title)}</h3>
        <div class="disp"><b data-d></b><small>${esc(unit)}</small></div>
        <div class="range" data-range>${esc(hint || `Up to ${max}${unit}. 0 turns it off.`)}</div>
        <div class="row-actions"><button class="btn ghost" data-k="cancel">Cancel</button><button class="btn primary" data-k="ok">Set</button></div>
      </div>
      <div class="keys">${keys.map((k) => `<button class="btn" data-k="${k}">${k === 'del' ? icon('backspace') : k === 'clr' ? 'C' : k}</button>`).join('')}</div>
    </div>`);
    const disp = s.querySelector('[data-d]');
    const range = s.querySelector('[data-range]');
    const draw = () => { disp.textContent = text || '0'; disp.style.color = fresh ? 'var(--text-2)' : ''; };
    draw();
    s.addEventListener('click', (e) => {
      const b = e.target.closest('[data-k]');
      if (!b) { if (e.target === s) { s.remove(); resolve(null); } return; }
      const k = b.dataset.k;
      if (k === 'cancel') { s.remove(); resolve(null); return; }
      if (k === 'ok') {
        const v = parseInt(text || '0', 10);
        if (v > max || (v > 0 && v < min)) { range.style.color = 'var(--danger)'; return; }
        s.remove();
        resolve(v);
        return;
      }
      if (k === 'del') text = fresh ? '' : text.slice(0, -1);
      else if (k === 'clr') text = '';
      else text = fresh || text === '0' ? k : (text + k).slice(0, 3);
      fresh = false;
      range.style.color = '';
      draw();
    });
  });
}

/** A full-content page over the current screen. render(body, sheet) may return a cleanup fn. */
export function openSheet({ title, render, onClose }) {
  const el = document.createElement('div');
  el.className = 'sheet';
  el.innerHTML = `<div class="sheet-head"><button class="icon-btn back" data-close aria-label="Back">${icon('back')}</button><h2>${esc(title)}</h2></div><div class="sheet-body"></div>`;
  mount(el);
  let cleanup = null;
  const sheet = {
    el,
    body: el.querySelector('.sheet-body'),
    head: el.querySelector('.sheet-head'),
    close() {
      if (!el.isConnected) return;
      el.remove();
      const i = sheets.indexOf(sheet);
      if (i >= 0) sheets.splice(i, 1);
      if (cleanup) cleanup();
      if (onClose) onClose();
    },
  };
  el.querySelector('[data-close]').addEventListener('click', () => sheet.close());
  sheets.push(sheet);
  cleanup = render(sheet.body, sheet) || null;
  return sheet;
}

export function closeSheets() {
  sheets.slice().reverse().forEach((s) => s.close());
}

/** Drag-to-scroll with a slim position indicator. Call .update() after changing content. */
export function makeScrollable(el) {
  const ind = document.createElement('div');
  ind.className = 'scroll-ind';
  el.parentElement.appendChild(ind);
  let down = false;
  let dragging = false;
  let startY = 0;
  let startTop = 0;
  let pid = null;

  const update = () => {
    const sh = el.scrollHeight;
    const ch = el.clientHeight;
    if (sh <= ch + 1) { ind.style.display = 'none'; return; }
    ind.style.display = '';
    const h = Math.max(24, (ch * ch) / sh);
    ind.style.height = `${h}px`;
    ind.style.top = `${(el.scrollTop / (sh - ch)) * (ch - h)}px`;
  };
  const swallowClick = (e) => { e.stopPropagation(); e.preventDefault(); };

  el.addEventListener('scroll', update, { passive: true });
  el.addEventListener('pointerdown', (e) => {
    down = true; dragging = false; pid = e.pointerId;
    startY = e.clientY; startTop = el.scrollTop;
  });
  el.addEventListener('pointermove', (e) => {
    if (!down || e.pointerId !== pid) return;
    const dy = (e.clientY - startY) / scale;
    if (!dragging && Math.abs(dy) > 8) {
      dragging = true;
      try { el.setPointerCapture(pid); } catch { /* ignore */ }
    }
    if (dragging) el.scrollTop = startTop - dy;
  });
  const end = () => {
    if (dragging) {
      el.addEventListener('click', swallowClick, { capture: true, once: true });
      setTimeout(() => el.removeEventListener('click', swallowClick, true), 60);
    }
    down = false; dragging = false;
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', () => { down = false; dragging = false; });
  if (window.ResizeObserver) new ResizeObserver(update).observe(el);
  return { update };
}

/** Full-screen live MJPEG view. hud(el) may return a cleanup fn. */
export function openCamera(cam, hud) {
  const el = document.createElement('div');
  el.className = 'camera-full';
  el.innerHTML = `<img alt=""><div class="msg hidden">Camera stream unavailable</div><div class="hud" data-hud></div>
    <button class="close" aria-label="Close">${icon('close')}</button>`;
  const img = el.querySelector('img');
  img.style.transform = camTransform(cam);
  img.onerror = () => { img.classList.add('hidden'); el.querySelector('.msg').classList.remove('hidden'); };
  img.src = cam.stream;
  mount(el);
  const stopHud = hud ? hud(el.querySelector('[data-hud]')) : null;
  const close = () => {
    img.onerror = null;
    img.src = 'data:,'; // aborts the MJPEG stream so it doesn't keep a connection open
    el.remove();
    if (stopHud) stopHud();
  };
  el.addEventListener('click', close);
  return close;
}
