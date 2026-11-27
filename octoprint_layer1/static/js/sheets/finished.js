// Print finished: a card over whatever is on screen when a print completes (it stands
// in for the old toast). A camera photo of the part (the slicer's picture if there is
// no camera), how long it took against the estimate, the filament it used, and the bed
// cooling down, since most parts come off a cool bed more easily. Done clears the
// finished state from Home; Print Again starts the same file. Under the lock screen
// it waits there until someone unlocks.

import { icon } from '../icons.js';
import { refs, esc, setText, setData, fmtDuration, fmtTemp, displayName, filamentUse, fmtFilament, bust, camTransform } from '../util.js';
import { IDLE, ACTIVE, phaseOf, flattenFiles, thumbUrl } from '../model.js';
import { scrim, attempt, toast, closeSheets } from '../ui.js';

const COOL_ENOUGH = 35; // °C: below this, parts come off most beds easily

let current = null;

export function closeFinished() {
  if (current) current();
}

/** done: the PrintDone payload ({ name, path, origin, time }); missing bits come from the job. */
export function showFinished(ctx, done = {}) {
  closeFinished();
  const { store, cfg } = ctx;
  const s = store.get();
  const jobFile = (s.job && s.job.file) || {};
  const path = done.path || jobFile.path;
  const origin = done.origin || jobFile.origin || 'local';
  const fileNow = () => flattenFiles(store.get().files).find((f) => f.path === path && (f.origin || 'local') === origin) || null;
  const file = fileNow();
  const analysis = (file && file.gcodeAnalysis) || s.job || {};
  const took = done.time != null ? done.time : s.progress && s.progress.printTime;
  const est = (s.job && s.job.estimatedPrintTime) || analysis.estimatedPrintTime;
  const use = fmtFilament(filamentUse(analysis, cfg.ui.filamentDensity));
  const cam = cfg.webcam || {};
  const named = file || (jobFile.name ? jobFile : { name: done.name || path || '' });

  const el = scrim(`
    <div class="modal donecard">
      <div class="dc-media">${icon('cube')}<img data-r="img" class="hidden" alt=""></div>
      <div class="dc-info">
        <div class="dc-kicker">${icon('check')}Print finished</div>
        <h3>${esc(displayName(named))}</h3>
        <div class="kv"><span>Took</span><b>${esc(fmtDuration(took))}</b></div>
        ${est ? `<div class="kv"><span>Estimate</span><b>${esc(fmtDuration(est))}</b></div>` : ''}
        ${use ? `<div class="kv"><span>Filament</span><b>${esc(use)}</b></div>` : ''}
        <div class="kv"><span>Bed</span><b data-r="bed">—</b></div>
      </div>
      <div class="row-actions">
        <button class="btn ghost" data-a="done">Done</button>
        <button class="btn primary" data-a="again" data-r="again">${icon('again')}<span data-r="againText">Print Again</span></button>
      </div>
    </div>`);
  const r = refs(el);

  // the part as the camera sees it now; else the slicer's picture; else the cube icon
  const thumb = thumbUrl(file, ctx.base);
  const sources = [];
  if (cam.enabled && cam.snapshot) sources.push({ src: bust(cam.snapshot), transform: camTransform(cam), cls: 'photo' });
  if (thumb) sources.push({ src: thumb, transform: '', cls: 'model' });
  const tryNext = () => {
    const next = sources.shift();
    if (!next) { r.img.classList.add('hidden'); return; }
    r.img.className = next.cls;
    r.img.style.transform = next.transform;
    r.img.src = next.src;
  };
  r.img.onerror = tryNext;
  tryNext();

  function render(st) {
    const bed = (st.temps && st.temps.bed) || {};
    let text = '—';
    let tone = null;
    if (bed.actual != null) {
      if (bed.target > 0) { text = `${fmtTemp(bed.actual)}° · still on`; tone = 'heat'; }
      else if (bed.actual > COOL_ENOUGH) { text = `${fmtTemp(bed.actual)}° · cooling`; tone = 'cool'; }
      else { text = `${fmtTemp(bed.actual)}° · cool`; tone = 'ok'; }
    }
    setText(r.bed, text);
    setData(r.bed, 'tone', tone);
    const ph = phaseOf(st);
    const present = !!fileNow();
    const ok = present && IDLE.has(ph);
    r.again.disabled = !ok;
    const label = !present ? 'File Deleted' : ok ? 'Print Again' : ACTIVE.has(ph) ? 'Printer Busy' : 'Printer Offline';
    setText(r.againText, label);
  }
  el.addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]');
    if (!a) { if (e.target === el) close(); return; } // tap outside: just close
    if (a.dataset.a === 'done') {
      store.set({ dismissedJob: path });
      close();
    } else if (a.dataset.a === 'again') {
      attempt(async () => {
        const f = fileNow();
        if (!f) return;
        await ctx.client.printFile(f.origin || 'local', f.path);
        toast(`Starting ${displayName(f)}`, 'accent', 3500, 'play');
        close();
        closeSheets();
        ctx.go('home');
      });
    }
  });

  const unsub = store.subscribe(render);
  render(store.get());
  function close() {
    if (current !== close) return;
    current = null;
    unsub();
    r.img.onerror = null;
    el.remove();
  }
  current = close;
  return close;
}
