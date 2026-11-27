// Version, plus what this screen remembers: its OctoPrint application key, theme, lock, sleep,
// brightness, whether Home shows the camera or the model, and the Files view (list or grid) and sort.

export const UI_VERSION = '0.1.0';

const KEY = 'layer1.apiKey';

export function loadKey() {
  try { return localStorage.getItem(KEY) || ''; } catch { return ''; }
}

export function saveKey(key) {
  try { localStorage.setItem(KEY, key); } catch { /* private mode: key lives for this page load only */ }
}

export function forgetKey() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

// Theme: 'dark' or 'light'. The choice made on the screen is remembered per device and
// wins over the config default. index.html applies it before first paint (no flash).
const THEME_KEY = 'layer1.theme';
const THEMES = ['dark', 'light'];

export function storedTheme() {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return THEMES.includes(t) ? t : null;
  } catch { return null; }
}

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark';
}

export function currentTheme() {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

export function setTheme(theme) {
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* not remembered, still applied */ }
  applyTheme(theme);
}

// Home picture: 'cam' (live camera) or 'model' (the slicer thumbnail), toggled by its chip.
const MEDIA_KEY = 'layer1.homeMedia';

export function storedMedia() {
  try { return localStorage.getItem(MEDIA_KEY) === 'model' ? 'model' : 'cam'; } catch { return 'cam'; }
}

export function saveMedia(pref) {
  try { localStorage.setItem(MEDIA_KEY, pref); } catch { /* remembered for this page load only */ }
}

// Files view: 'list' (rows) or 'grid' (a gallery of thumbnails).
const FILES_VIEW_KEY = 'layer1.filesView';

export function storedFilesView() {
  try { return localStorage.getItem(FILES_VIEW_KEY) === 'grid' ? 'grid' : 'list'; } catch { return 'list'; }
}

export function saveFilesView(view) {
  try { localStorage.setItem(FILES_VIEW_KEY, view); } catch { /* remembered for this page load only */ }
}

// Files sort: one of the keys of SORTS in screens/files.js (which checks it), or null.
const FILES_SORT_KEY = 'layer1.filesSort';

export function storedFilesSort() {
  try { return localStorage.getItem(FILES_SORT_KEY); } catch { return null; }
}

export function saveFilesSort(sort) {
  try { localStorage.setItem(FILES_SORT_KEY, sort); } catch { /* remembered for this page load only */ }
}

// Lock screen: whether this screen is locked (so a reload stays locked), and the
// auto-lock delay in minutes (0 = never), chosen on the screen. null = not chosen yet,
// so the config default (ui.autoLockMinutes) applies.
const LOCKED_KEY = 'layer1.locked';
const AUTOLOCK_KEY = 'layer1.autoLock';

export function storedLocked() {
  try { return localStorage.getItem(LOCKED_KEY) === '1'; } catch { return false; }
}

export function saveLocked(on) {
  try {
    if (on) localStorage.setItem(LOCKED_KEY, '1');
    else localStorage.removeItem(LOCKED_KEY);
  } catch { /* a reload unlocks */ }
}

export function storedAutoLock() {
  try {
    const v = localStorage.getItem(AUTOLOCK_KEY);
    return v != null && Number.isFinite(+v) ? +v : null;
  } catch { return null; }
}

export function saveAutoLock(minutes) {
  try { localStorage.setItem(AUTOLOCK_KEY, String(minutes)); } catch { /* remembered for this page load only */ }
}

// Screen sleep: minutes without a touch before the screen goes dark (0 = never), chosen on
// the screen. null = not chosen yet, so the config default (ui.sleepMinutes) applies.
const SLEEP_KEY = 'layer1.sleep';

export function storedSleep() {
  try {
    const v = localStorage.getItem(SLEEP_KEY);
    return v != null && Number.isFinite(+v) ? +v : null;
  } catch { return null; }
}

export function saveSleep(minutes) {
  try { localStorage.setItem(SLEEP_KEY, String(minutes)); } catch { /* remembered for this page load only */ }
}

// Brightness: percent, 100 = full. SPI panels have no backlight control, so it's a black
// layer over the whole UI (CSS: html[data-dim]). null = not chosen on the screen yet, so the
// config default (ui.brightness) applies. index.html applies it before first paint; keep in step.
const BRIGHTNESS_KEY = 'layer1.brightness';
const MIN_BRIGHTNESS = 30; // any darker and the screen is too dim to find the setting again

export function storedBrightness() {
  try {
    const v = localStorage.getItem(BRIGHTNESS_KEY);
    return v != null && Number.isFinite(+v) ? +v : null;
  } catch { return null; }
}

export function applyBrightness(pct) {
  const p = Math.min(100, Math.max(MIN_BRIGHTNESS, Number.isFinite(+pct) ? +pct : 100));
  const root = document.documentElement;
  if (p >= 100) { delete root.dataset.dim; root.style.removeProperty('--dim'); return; }
  root.dataset.dim = '';
  root.style.setProperty('--dim', String(1 - p / 100));
}

export function saveBrightness(pct) {
  try { localStorage.setItem(BRIGHTNESS_KEY, String(pct)); } catch { /* applied for this page load only */ }
  applyBrightness(pct);
}
