// Version, plus what this screen remembers: its OctoPrint application key and theme.

export const UI_VERSION = '0.2.0';

const KEY = 'ender5touch.apiKey';

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
const THEME_KEY = 'ender5touch.theme';
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
