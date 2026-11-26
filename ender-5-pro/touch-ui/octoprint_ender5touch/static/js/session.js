// Version, plus what this screen remembers: its OctoPrint application key, theme,
// whether Home shows the camera or the model, and the Files view (list or grid) and sort.

export const UI_VERSION = '0.2.0';

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
