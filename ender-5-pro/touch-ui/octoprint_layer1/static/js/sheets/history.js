// History (from More): every print that ended, newest first: when, how long, and
// whether it finished. Tap one for details and Print Again. The plugin records them
// (history.py); prints from before Layer1 was installed come from OctoPrint's own
// per-file logs, which can't tell a stopped print from a failed one ("Didn't finish").

import { icon } from '../icons.js';
import { esc, debounce, fmtDuration, fmtWhen, displayName, filamentUse, fmtFilament } from '../util.js';
import { IDLE, ACTIVE, phaseOf, flattenFiles, thumbUrl } from '../model.js';
import { openSheet, closeSheets, makeScrollable, attempt, toast } from '../ui.js';

const LIMIT = 100;

const RESULTS = {
  done: { label: 'Finished', icon: 'check', cls: 'ok' },
  failed: { label: 'Failed', icon: 'cross', cls: 'bad' },
  cancelled: { label: 'Stopped', icon: 'stop', cls: 'stopped' },
  unfinished: { label: 'Didn’t finish', icon: 'cross', cls: 'bad' },
};
const resultOf = (e) => RESULTS[e.result] || RESULTS.unfinished;

/** "1h 27m", or "Stopped after 4m" when it didn't finish. */
function outcome(e) {
  const res = resultOf(e);
  if (e.result === 'done') return fmtDuration(e.duration);
  return e.duration ? `${res.label} after ${fmtDuration(e.duration)}` : res.label;
}

/** The file this entry printed, if it is still in OctoPrint's library (or on the SD card). */
function fileOf(ctx, e) {
  const origin = e.origin || 'local';
  return flattenFiles(ctx.store.get().files).find((f) => f.path === e.path && (f.origin || 'local') === origin) || null;
}

function thumbHTML(ctx, file, cls) {
  const url = thumbUrl(file, ctx.base);
  return `<div class="${cls}">${icon('cube')}${url ? `<img loading="lazy" alt="" src="${esc(url)}" onerror="this.remove()">` : ''}</div>`;
}

export function openHistory(ctx) {
  const { store } = ctx;
  openSheet({
    title: 'History',
    render(body, sheet) {
      sheet.head.insertAdjacentHTML('beforeend', '<span class="note" data-stats></span>');
      const statsEl = sheet.head.querySelector('[data-stats]');
      body.innerHTML = '<div class="hist"><div class="scrollbox"><div class="scroll" data-list></div></div></div>';
      const list = body.querySelector('[data-list]');
      const scroller = makeScrollable(list);

      let data = null;   // { entries, total, stats }
      let error = null;
      let closed = false;

      function renderStats() {
        const st = data && data.stats;
        if (!st || !st.prints) { statsEl.textContent = ''; return; }
        const done = Math.round(((st.results && st.results.done) || 0) / st.prints * 100);
        statsEl.textContent = `${st.prints} print${st.prints === 1 ? '' : 's'} · ${fmtDuration(st.seconds)} printing · ${done}% finished`;
      }

      function rowHTML(e, i) {
        const res = resultOf(e);
        const meta = [fmtWhen(e.end), outcome(e)].filter(Boolean).join(' · ');
        return `<div class="frow" data-i="${i}">
          ${thumbHTML(ctx, fileOf(ctx, e), 'thumb')}
          <div style="min-width:0"><div class="name">${esc(displayName(e))}</div><div class="meta">${esc(meta)}</div></div>
          <div class="end"><span class="${res.cls}" aria-label="${esc(res.label)}">${icon(res.icon)}</span></div></div>`;
      }

      function render() {
        renderStats();
        if (!data) {
          list.innerHTML = error
            ? `<div class="empty-state">${icon('alert')}<b>Couldn’t load history</b><span>${esc(error)}</span></div>`
            : `<div class="empty-state">${icon('history')}<span>Loading history…</span></div>`;
        } else if (!data.entries.length) {
          list.innerHTML = `<div class="empty-state">${icon('history')}<b>No prints yet</b><span>Prints show up here when they finish, fail or are stopped.</span></div>`;
        } else {
          const more = data.total > data.entries.length
            ? `<div class="note hist-more">Showing the latest ${data.entries.length} of ${data.total} prints</div>` : '';
          list.innerHTML = data.entries.map(rowHTML).join('') + more;
        }
        scroller.update();
      }

      function load() {
        return ctx.client.history(LIMIT).then(
          (res) => { if (!closed) { data = res; error = null; render(); } },
          (e) => {
            if (closed) return;
            // an older plugin (OctoPrint not restarted since the update) has no /history yet
            error = e && e.status === 404 ? 'Restart OctoPrint to finish updating Layer1.' : (e && e.message) || String(e);
            render();
          },
        );
      }

      list.addEventListener('click', (ev) => {
        const row = ev.target.closest('[data-i]');
        const e = row && data && data.entries[+row.dataset.i];
        if (e) openEntry(ctx, e);
      });

      // reload when a print ends; redraw when files change (thumbnails, deleted files)
      const reload = debounce(load, 1200);
      let rev = store.get().historyRev;
      let files = store.get().files;
      const unsub = store.subscribe((s) => {
        if (s.historyRev !== rev) { rev = s.historyRev; reload(); }
        if (s.files !== files) { files = s.files; if (data) render(); }
      });

      render();
      load();
      return () => { closed = true; unsub(); };
    },
  });
}

// One past print: what happened, and Print Again if the file is still there.
function openEntry(ctx, e) {
  const { store, cfg } = ctx;
  openSheet({
    title: 'Past print',
    render(body, sheet) {
      const res = resultOf(e);
      const file = fileOf(ctx, e);
      const use = file && e.result === 'done' ? fmtFilament(filamentUse(file.gcodeAnalysis, cfg.ui.filamentDensity)) : '';
      body.innerHTML = `
        <div class="fdetail">
          ${thumbHTML(ctx, file, 'big-thumb')}
          <div style="min-width:0">
            <div class="fname">${esc(displayName(e))}</div>
            <div class="kv"><span>Result</span><b class="hres ${res.cls}">${icon(res.icon)}${esc(res.label)}</b></div>
            <div class="kv"><span>Ended</span><b>${esc(fmtWhen(e.end))}</b></div>
            <div class="kv"><span>${e.result === 'done' ? 'Print time' : 'Ran for'}</span><b>${esc(fmtDuration(e.duration))}</b></div>
            ${use ? `<div class="kv"><span>Filament</span><b>${esc(use)}</b></div>` : ''}
            ${e.error ? `<div class="note herr">${esc(e.error)}</div>` : ''}
            ${file ? '' : '<div class="note herr">This file is no longer on the printer’s file list, so it can’t be printed again.</div>'}
          </div>
          <div class="row-actions">
            <button class="btn ghost" data-a="back">Back</button>
            <button class="btn primary" data-a="print">${icon('again')}<span data-label>Print Again</span></button>
          </div>
        </div>`;
      const btn = body.querySelector('[data-a=print]');
      const label = body.querySelector('[data-label]');
      body.querySelector('[data-a=back]').addEventListener('click', () => sheet.close());
      btn.addEventListener('click', () => attempt(async () => {
        const f = fileOf(ctx, e);
        if (!f) return;
        await ctx.client.printFile(f.origin || 'local', f.path);
        toast(`Starting ${displayName(f)}`, 'accent', 3500, 'play');
        closeSheets();
        ctx.go('home');
      }));
      const update = (s) => {
        const ph = phaseOf(s);
        const present = !!fileOf(ctx, e);
        const ok = present && IDLE.has(ph);
        btn.disabled = !ok;
        const text = !present ? 'File Deleted' : ok ? 'Print Again' : ACTIVE.has(ph) ? 'Printer Busy' : 'Printer Offline';
        if (label.textContent !== text) label.textContent = text;
      };
      update(store.get());
      return store.subscribe(update);
    },
  });
}
