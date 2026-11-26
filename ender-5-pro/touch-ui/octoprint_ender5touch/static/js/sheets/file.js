// One file: big thumbnail, stats, and the Print button.

import { icon } from '../icons.js';
import { esc, fmtDuration, fmtAgo, fmtBytes, displayName, filamentUse, fmtFilament } from '../util.js';
import { ACTIVE, IDLE, phaseOf, thumbUrl } from '../model.js';
import { openSheet, attempt, toast } from '../ui.js';

export function openFileDetail(ctx, file) {
  const { store, cfg } = ctx;
  openSheet({
    title: 'Print file',
    render(body, sheet) {
      const a = file.gcodeAnalysis || {};
      const url = thumbUrl(file, ctx.base);
      const last = file.prints && file.prints.last;
      const lastText = last ? `${last.success ? 'Succeeded' : 'Failed'} · ${fmtAgo(last.date)}` : 'Never printed';
      const fil = fmtFilament(filamentUse(a, cfg.ui.filamentDensity)) || '—';
      body.innerHTML = `
        <div class="fdetail">
          <div class="big-thumb">${icon('cube')}${url ? `<img alt="" src="${esc(url)}" onerror="this.remove()">` : ''}</div>
          <div style="min-width:0">
            <div class="fname">${esc(displayName(file))}</div>
            <div class="kv"><span>Print time</span><b>${esc(fmtDuration(a.estimatedPrintTime))}</b></div>
            <div class="kv"><span>Filament</span><b>${esc(fil)}</b></div>
            <div class="kv"><span>Uploaded</span><b>${esc(fmtAgo(file.date) || '—')}</b></div>
            <div class="kv"><span>Size</span><b>${esc(fmtBytes(file.size))}</b></div>
            <div class="kv"><span>Last print</span><b>${esc(lastText)}</b></div>
          </div>
          <div class="row-actions">
            <button class="btn ghost" data-a="back">Back</button>
            <button class="btn primary" data-a="print">${icon('play')}<span data-label>Print</span></button>
          </div>
        </div>`;
      const btn = body.querySelector('[data-a=print]');
      const label = body.querySelector('[data-label]');
      body.querySelector('[data-a=back]').addEventListener('click', () => sheet.close());
      btn.addEventListener('click', () => attempt(async () => {
        await ctx.client.printFile(file.origin || 'local', file.path);
        toast(`Starting ${displayName(file)}`, 'accent');
        sheet.close();
        ctx.go('home');
      }));
      const update = (s) => {
        const ph = phaseOf(s);
        const ok = IDLE.has(ph);
        btn.disabled = !ok;
        const text = ok ? 'Print' : ACTIVE.has(ph) ? 'Printer busy' : 'Printer offline';
        if (label.textContent !== text) label.textContent = text;
      };
      update(store.get());
      return store.subscribe(update);
    },
  });
}
