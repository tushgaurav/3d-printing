// Version and the stored OctoPrint application key for this screen.

export const UI_VERSION = '0.1.0';

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
