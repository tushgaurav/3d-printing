// Small DOM + formatting helpers. DOM writes are skipped when nothing changed,
// because every repaint costs real time on an SPI screen.

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Collect every [data-r="name"] element under root into an object. */
export function refs(root) {
  const r = {};
  root.querySelectorAll('[data-r]').forEach((el) => { r[el.dataset.r] = el; });
  return r;
}

export function setText(el, text) {
  const t = text == null ? '' : String(text);
  if (el.textContent !== t) el.textContent = t;
}

export function setHTML(el, html) {
  if (el._html !== html) { el._html = html; el.innerHTML = html; }
}

export function toggle(el, cls, on) {
  on = !!on;
  if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on);
}

export function show(el, on) { toggle(el, 'hidden', !on); }

export function setData(el, key, value) {
  if (value == null) { if (key in el.dataset) delete el.dataset[key]; return; }
  if (el.dataset[key] !== String(value)) el.dataset[key] = value;
}

export function setStyle(el, prop, value) {
  if (el.style[prop] !== value) el.style[prop] = value;
}

export function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

export function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function deepMerge(base, over) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object' && !Array.isArray(base[k])
      ? deepMerge(base[k], v) : v;
  }
  return out;
}

export function fmtDuration(sec) {
  if (sec == null || !isFinite(sec)) return '—';
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h >= 48) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m) return `${m}m`;
  return '<1m';
}

let clock24 = false;
export function setClock24(v) { clock24 = !!v; }

export function fmtClock(date) {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: !clock24 });
}

export function fmtAgo(unixSec) {
  if (!unixSec) return '';
  const s = Date.now() / 1000 - unixSec;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 172800) return 'yesterday';
  if (s < 30 * 86400) return `${Math.round(s / 86400)} d ago`;
  return new Date(unixSec * 1000).toLocaleDateString([], { day: 'numeric', month: 'short' });
}

export function fmtBytes(n) {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

export function fmtTemp(v) {
  return v == null || !isFinite(v) ? '—' : String(Math.round(v));
}

/** "Benchy_0.2mm_PLA_E5P_1h12m.gcode" -> "Benchy_0.2mm_PLA_E5P_1h12m" */
export function displayName(file) {
  const name = (file && (file.display || file.name)) || '';
  return name.replace(/\.(gcode|gco|g|gc)$/i, '');
}

/** Filament use for a file's analysis: { meters, grams } or null. */
export function filamentUse(analysis, density = 1.24) {
  const f = analysis && analysis.filament;
  if (!f) return null;
  let length = 0; let volume = 0;
  for (const tool of Object.values(f)) {
    length += (tool && tool.length) || 0;
    volume += (tool && tool.volume) || 0;
  }
  if (!length) return null;
  return { meters: length / 1000, grams: volume ? volume * density : null };
}

export function fmtFilament(use) {
  if (!use) return '';
  const len = use.meters < 0.1 ? '<0.1 m' : `${use.meters.toFixed(1)} m`;
  return use.grams >= 1 ? `${len} · ${Math.round(use.grams)} g` : len;
}

/** Append a cache-busting parameter, but never to data: URIs. */
export function bust(url) {
  if (!url || url.startsWith('data:')) return url;
  return url + (url.includes('?') ? '&' : '?') + '_=' + Date.now();
}

/** CSS transform for OctoPrint-style webcam flip/rotate settings. */
export function camTransform(cam) {
  const t = [];
  if (cam.rotate90) t.push('rotate(-90deg)');
  if (cam.flipH) t.push('scaleX(-1)');
  if (cam.flipV) t.push('scaleY(-1)');
  return t.join(' ');
}
