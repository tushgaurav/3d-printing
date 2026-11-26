// Printer connection (USB serial) status and connect / disconnect.

import { icon } from '../icons.js';
import { refs, setText } from '../util.js';
import { ACTIVE, phaseOf } from '../model.js';
import { openSheet, attempt, toast, confirmDialog } from '../ui.js';

export function openPrinter(ctx) {
  const { store } = ctx;
  openSheet({
    title: 'Printer connection',
    render(body) {
      body.innerHTML = `
        <div class="kvlist" style="margin-bottom:10px">
          <div class="kv"><span>State</span><b data-r="state">…</b></div>
          <div class="kv"><span>Port</span><b data-r="port">…</b></div>
          <div class="kv"><span>Baud rate</span><b data-r="baud">…</b></div>
          <div class="kv"><span>Profile</span><b data-r="profile">…</b></div>
        </div>
        <div class="row-actions">
          <button class="btn ghost" data-a="disconnect" style="height:52px">${icon('close')}Disconnect</button>
          <button class="btn primary" data-a="connect" style="height:52px">${icon('plug')}Connect</button>
        </div>
        <div class="note" style="margin-top:10px">Connect uses OctoPrint’s saved port and baud rate (AUTO by default). Change them in OctoPrint’s web interface if the printer isn’t found.</div>`;
      const r = refs(body);

      async function load() {
        try {
          const c = await ctx.client.connection();
          const cur = (c && c.current) || {};
          setText(r.state, cur.state || '—');
          setText(r.port, cur.port || '—');
          setText(r.baud, cur.baudrate || '—');
          const profiles = (c && c.options && c.options.printerProfiles) || [];
          const prof = profiles.find((p) => p.id === cur.printerProfile);
          setText(r.profile, (prof && prof.name) || cur.printerProfile || '—');
        } catch (e) {
          setText(r.state, e.message);
        }
      }

      body.addEventListener('click', (e) => {
        const b = e.target.closest('[data-a]');
        if (!b) return;
        attempt(async () => {
          if (b.dataset.a === 'connect') {
            await ctx.client.connect();
            toast('Connecting to the Printer…', 'muted', 3500, 'plug');
          } else {
            if (ACTIVE.has(phaseOf(store.get()))) {
              const ok = await confirmDialog({ title: 'Disconnect during a print?', body: 'The print will fail.', confirm: 'Disconnect', tone: 'danger' });
              if (!ok) return;
            }
            await ctx.client.disconnect();
            toast('Printer Disconnected', 'muted', 3500, 'unplug');
          }
          setTimeout(load, 1500);
        });
      });

      load();
      let lastText = '';
      return store.subscribe((s) => {
        const t = (s.printer && s.printer.text) || '';
        if (t !== lastText) { lastText = t; load(); }
      });
    },
  });
}
