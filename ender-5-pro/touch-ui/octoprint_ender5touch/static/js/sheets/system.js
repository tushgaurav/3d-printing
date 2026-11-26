// System: OctoPrint/Pi power commands, screen reload, unpair, and exit to the desktop
// when the launcher said there is one.

import { icon } from '../icons.js';
import { refs, setText, esc } from '../util.js';
import { ACTIVE, phaseOf } from '../model.js';
import { openSheet, attempt, toast, confirmDialog } from '../ui.js';
import { UI_VERSION, forgetKey } from '../session.js';

const LABELS = {
  restart: { label: 'Restart OctoPrint', icon: 'refresh', body: 'The screen reconnects by itself in about a minute.' },
  restart_safe: { label: 'Safe Mode', icon: 'refresh', body: 'Restarts OctoPrint with third-party plugins disabled, including this screen’s plugin.' },
  reboot: { label: 'Reboot Pi', icon: 'refresh', body: 'The whole Raspberry Pi restarts. Back in about two minutes.' },
  shutdown: { label: 'Shut Down', icon: 'power', body: 'Wait until the Pi’s green light stops blinking before you unplug it.' },
};

/** Close the full-screen browser and reveal the Pi's desktop underneath. */
export async function exitToDesktop() {
  const ok = await confirmDialog({
    title: 'Exit to desktop?',
    body: 'The printer screen closes and the Pi’s desktop comes back. To open it again, double-tap “Printer screen” on the desktop.',
    confirm: 'Exit',
  });
  if (!ok) return;
  window.close(); // allowed: the launcher opened this window and it has a single history entry
  setTimeout(() => toast('Browser Didn’t Close · Run ~/ender5-touch/demo.sh stop over SSH', 'warn', 6000), 800);
}

export function openSystem(ctx) {
  openSheet({
    title: 'System',
    render(body, sheet) {
      if (ctx.desktop) {
        sheet.head.insertAdjacentHTML('beforeend', `<button class="chipbtn" data-a="exit">${icon('exit')}Exit to Desktop</button>`);
        sheet.head.querySelector('[data-a="exit"]').addEventListener('click', exitToDesktop);
      }
      body.innerHTML = `
        <div class="kvlist" style="margin-bottom:10px">
          <div class="kv"><span>OctoPrint</span><b data-r="ver">…</b></div>
          <div class="kv"><span>Touch UI</span><b>${esc(UI_VERSION)}</b></div>
          <div class="kv"><span>Web address</span><b>${esc(ctx.host)}</b></div>
        </div>
        <div class="row-actions" data-r="power" style="margin-bottom:6px"></div>
        <div class="row-actions">
          <button class="btn ghost" data-a="reload" style="height:42px">Reload Screen</button>
          <button class="btn ghost" data-a="unpair" style="height:42px">Unpair Screen</button>
        </div>`;
      const r = refs(body);
      let commands = [];

      attempt(async () => {
        const v = await ctx.client.version();
        setText(r.ver, (v && (v.text || v.server)) || '—');
      });

      attempt(async () => {
        const list = (await ctx.client.systemCommands()) || [];
        commands = list.filter((c) => LABELS[c.action] && c.action !== 'restart_safe');
        r.power.innerHTML = commands.length
          ? commands.map((c, i) => `<button class="btn tall ${c.action === 'shutdown' ? 'danger' : ''}" data-cmd="${i}" style="height:60px">${icon(LABELS[c.action].icon)}${esc(LABELS[c.action].label)}</button>`).join('')
          : '<div class="note">No power commands are configured in OctoPrint (Settings → Server → Commands).</div>';
      });

      body.addEventListener('click', async (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.a === 'reload') { location.reload(); return; }
        if (b.dataset.a === 'unpair') {
          const ok = await confirmDialog({
            title: 'Unpair this screen?',
            body: 'It forgets its OctoPrint key and asks for a new one. To fully revoke the old key, remove it in OctoPrint → Settings → Application Keys.',
            confirm: 'Unpair', tone: 'danger',
          });
          if (ok) { forgetKey(); location.reload(); }
          return;
        }
        if (b.dataset.cmd != null) {
          const c = commands[+b.dataset.cmd];
          const info = LABELS[c.action];
          const printing = ACTIVE.has(phaseOf(ctx.store.get()));
          const ok = await confirmDialog({
            title: `${info.label}?`,
            body: printing ? `A print is running and will FAIL. ${info.body}` : info.body,
            confirm: info.label,
            tone: printing || c.action === 'shutdown' ? 'danger' : 'primary',
          });
          if (ok) attempt(async () => { await ctx.client.system(c.action); toast(`${info.label}…`, 'warn', 8000, info.icon); });
        }
      });
      return null;
    },
  });
}
