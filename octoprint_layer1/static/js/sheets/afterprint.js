// After Print (Tune's header chip, or the reminder on Home): what the plugin does when a print
// finishes (see after_print.py, which runs them even with no screen). Cool Down and Lower Bed
// are remembered for every print; Shut Down Pi is for one print and clears itself. When a
// print finishes with it on, a countdown comes up over everything with Keep Pi On.

import { icon } from '../icons.js';
import { refs, setText, toggle } from '../util.js';
import { ACTIVE, phaseOf } from '../model.js';
import { openSheet, attempt, toast, scrim } from '../ui.js';

const EVERY = [
  { key: 'coolDown', icon: 'cool', name: 'Cool Down', note: () => 'Heaters, fan and motors off' },
  { key: 'lowerBed', icon: 'down', name: 'Lower Bed', note: (st) => `Drops ${st.lowerBedBy} mm, head to the back` },
];

async function change(ctx, patch) {
  const st = await ctx.client.setAfterPrint(patch);
  ctx.applyAfterPrint(st);
  return st;
}

export function openAfterPrint(ctx) {
  const { store } = ctx;
  if (!store.get().afterPrint) ctx.refreshAfterPrint();
  openSheet({
    title: 'After Print',
    render(body) {
      const option = (o, cls = '') => `
        <button class="aopt ${cls}" data-key="${o.key}"><span class="ck">${icon('check')}</span>
          <b>${icon(o.icon)}${o.name}</b><small data-r="${o.key}Note"></small></button>`;
      body.innerHTML = `
        <div class="section"><div class="label">Every print <em>remembered</em></div>
          <div class="apick">${EVERY.map((o) => option(o)).join('')}</div>
        </div>
        <div class="section"><div class="label"><span data-r="onceLabel"></span> <em>then it switches itself off</em></div>
          ${option({ key: 'shutdown', icon: 'power', name: 'Shut Down Pi' }, 'once')}
        </div>
        <div class="note" data-r="foot"></div>`;
      const r = refs(body);
      const btns = [...body.querySelectorAll('[data-key]')];
      let busy = false;

      body.addEventListener('click', (e) => {
        const b = e.target.closest('[data-key]');
        const st = store.get().afterPrint;
        if (!b || b.disabled || busy || !st) return;
        const key = b.dataset.key;
        const on = !st[key];
        busy = true;
        attempt(async () => {
          await change(ctx, { [key]: on });
          if (key === 'shutdown') toast(on ? 'Pi Shuts Down After This Print' : 'Pi Stays On', on ? 'warn' : 'muted', 3500, 'power');
        }).finally(() => { busy = false; });
      });

      function render(s) {
        const st = s.afterPrint;
        setText(r.onceLabel, ACTIVE.has(phaseOf(s)) ? 'This print only' : 'Next print only');
        btns.forEach((b) => {
          const key = b.dataset.key;
          b.disabled = !st || (key === 'shutdown' && !st.canShutdown && !st.shutdown);
          toggle(b, 'active', !!(st && st[key]));
        });
        if (!st) {
          setText(r.foot, s.afterPrintError ? `Couldn’t load: ${s.afterPrintError}. Update the Layer1 plugin on the Pi if it’s older than this screen.` : 'Loading…');
          return;
        }
        EVERY.forEach((o) => setText(r[`${o.key}Note`], o.note(st)));
        setText(r.shutdownNote, st.canShutdown
          ? `${st.shutdownSeconds} s after it finishes, with a countdown to cancel. Heaters go off first.`
          : 'Needs a shutdown command in OctoPrint → Settings → Server → Commands.');
        setText(r.foot, 'These run on the Pi, so they happen even if this screen is asleep. A stopped or failed print runs none of them.');
      }

      render(store.get());
      return store.subscribe(render);
    },
  });
}

/** Count down a pending shutdown over everything. Returns a close function. */
function showCountdown(ctx) {
  const { store } = ctx;
  const el = scrim(`
    <div class="modal shutdown">
      <div class="sd-head"><span class="sd-icon">${icon('power')}</span>
        <div><h3>Shutting down the Pi</h3><div class="sd-count" data-r="count"></div></div></div>
      <p>The print finished. The printer stays on with its heaters off, so switch it off once the nozzle has cooled.</p>
      <div class="row-actions">
        <button class="btn ghost" data-a="now">Shut Down Now</button>
        <button class="btn primary" data-a="keep">${icon('power')}Keep Pi On</button>
      </div>
    </div>`);
  const r = refs(el);
  const btns = [...el.querySelectorAll('[data-a]')];
  const tick = () => {
    const st = store.get().afterPrint;
    const p = st && st.pending;
    if (!p) return;
    const left = Math.max(0, Math.ceil((st.at + p.seconds * 1000 - Date.now()) / 1000));
    setText(r.count, left > 0 ? `in ${left} s` : 'now…');
  };
  tick();
  const timer = setInterval(tick, 250);
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]');
    if (!b || b.disabled) return; // a tap outside does nothing: this one matters
    btns.forEach((x) => { x.disabled = true; });
    const now = b.dataset.a === 'now';
    attempt(async () => {
      await change(ctx, now ? { now: true } : { cancel: true });
      toast(now ? 'Shutting Down the Pi' : 'Pi Stays On', now ? 'warn' : 'ok', 3500, 'power');
    }).finally(() => btns.forEach((x) => { x.disabled = false; }));
  });
  return () => { clearInterval(timer); el.remove(); };
}

/** Show the countdown while a shutdown is pending, and say so when one fails. */
export function initAfterPrint(ctx) {
  let close = null;
  let seen = false;
  let lastError = null;
  ctx.store.subscribe((s) => {
    const st = s.afterPrint;
    if (!st) return;
    if (st.pending && !close) close = showCountdown(ctx);
    if (!st.pending && close) { close(); close = null; }
    // an error from before this page loaded is old news
    if (seen && st.error && st.error !== lastError) toast(`Shutdown Failed · ${st.error}`, 'danger', 10000, 'power');
    lastError = st.error;
    seen = true;
  });
}
