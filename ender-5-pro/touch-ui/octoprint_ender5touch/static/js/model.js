// What is the printer doing? One "phase" drives labels, colours and which
// buttons make sense, so every screen agrees.

export const PHASES = {
  connecting: { label: 'Connecting', tone: 'muted' },
  offline: { label: 'No OctoPrint', tone: 'danger' },
  unauthorized: { label: 'Not paired', tone: 'warn' },
  linking: { label: 'Connecting', tone: 'muted' },
  disconnected: { label: 'Printer off', tone: 'muted' },
  error: { label: 'Error', tone: 'danger' },
  printing: { label: 'Printing', tone: 'accent' },
  pausing: { label: 'Pausing', tone: 'warn' },
  paused: { label: 'Paused', tone: 'warn' },
  resuming: { label: 'Resuming', tone: 'accent' },
  cancelling: { label: 'Stopping', tone: 'danger' },
  finished: { label: 'Finished', tone: 'ok' },
  heating: { label: 'Heating', tone: 'accent' },
  ready: { label: 'Ready', tone: 'ok' },
};

export const ACTIVE = new Set(['printing', 'pausing', 'paused', 'resuming', 'cancelling']);
export const IDLE = new Set(['ready', 'heating', 'finished']);

export function isHeating(temps) {
  return ['tool0', 'bed'].some((k) => {
    const t = temps && temps[k];
    return t && t.target > 0 && t.actual != null && t.actual < t.target - 3;
  });
}

export function jobPath(s) {
  return (s.job && s.job.file && s.job.file.path) || null;
}

export function isFinished(s) {
  const path = jobPath(s);
  const pct = s.progress && s.progress.completion;
  return !!path && pct != null && pct >= 99.9 && s.dismissedJob !== path;
}

export function phaseOf(s) {
  if (s.link !== 'online') {
    if (s.link === 'offline') return 'offline';
    if (s.link === 'unauthorized') return 'unauthorized';
    return 'connecting';
  }
  const f = (s.printer && s.printer.flags) || {};
  const text = (s.printer && s.printer.text) || '';
  if (f.error) return 'error';
  if (f.cancelling) return 'cancelling';
  if (f.pausing) return 'pausing';
  if (f.paused) return 'paused';
  if (f.resuming) return 'resuming';
  if (f.printing || f.finishing) return 'printing';
  if (!f.operational) {
    if (/error/i.test(text)) return 'error';
    if (f.closedOrError || !text || /offline|closed/i.test(text)) return 'disconnected';
    return 'linking';
  }
  if (isFinished(s)) return 'finished';
  if (isHeating(s.temps)) return 'heating';
  return 'ready';
}

/** All printable files in a (recursive) OctoPrint file listing, flattened. */
export function flattenFiles(list, out = []) {
  for (const f of list || []) {
    if (f.type === 'folder') flattenFiles(f.children, out);
    else if (f.type === 'machinecode' || /\.(gcode|gco|g)$/i.test(f.name || '')) out.push(f);
  }
  return out;
}

export function findFile(files, path) {
  if (!path) return null;
  return flattenFiles(files).find((f) => f.path === path) || null;
}

/** OctoPrint thumbnail (PrusaSlicer Thumbnails plugin and friends), as a URL. */
export function thumbUrl(file, base) {
  const t = file && file.thumbnail;
  if (!t || typeof t !== 'string') return null;
  if (/^(data:|https?:|\/)/.test(t)) return t;
  return base + t;
}

export function lastPrinted(files) {
  let best = null;
  for (const f of flattenFiles(files)) {
    const last = f.prints && f.prints.last;
    if (last && last.date && (!best || last.date > best.last.date)) best = { file: f, last };
  }
  return best;
}
