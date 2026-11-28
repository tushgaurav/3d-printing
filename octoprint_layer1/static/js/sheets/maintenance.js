// Maintenance (from More): jobs like oiling the Z screw that come round every so many hours
// of printing. The plugin keeps them (maintenance.py): the tasks and how often they come round
// are in OctoPrint → Settings → Layer1, and the hours come from the print history. Mark Done
// starts a task's count again. While one is due, the rail's More button has a dot and the
// Maintenance tile a count, and a print that makes one due says so in a toast.

import { icon } from '../icons.js';
import { esc, fmtAgo, setText, toggle } from '../util.js';
import { openSheet, makeScrollable, attempt, toast, confirmDialog } from '../ui.js';

/** Hours in seconds as 38, or 2.5 under ten. */
function hours(sec) {
  const h = Math.max(0, sec || 0) / 3600;
  return h < 10 ? +h.toFixed(1) : Math.round(h);
}
export const fmtHours = (sec) => `${hours(sec)} h`;

export const dueNames = (st) => (st && st.tasks ? st.tasks.filter((t) => t.due).map((t) => t.name) : []);

const share = (t) => (t.hours > 0 ? t.printed / (t.hours * 3600) : 0);

// a ring that fills as the hours go by, around the task's icon
const R = 15;
const C = 2 * Math.PI * R;
function ring(frac) {
  const f = Math.max(0, Math.min(1, frac));
  const bar = f > 0
    ? `<circle class="bar" cx="18" cy="18" r="${R}" stroke-dasharray="${(f * C).toFixed(2)} ${C.toFixed(2)}" transform="rotate(-90 18 18)"/>`
    : '';
  return `<svg class="rg" viewBox="0 0 36 36" aria-hidden="true"><circle class="track" cx="18" cy="18" r="${R}"/>${bar}</svg>`;
}

function rowHTML(t, i) {
  const limit = t.hours * 3600;
  const status = t.due ? 'Due' : t.soon ? `${fmtHours(limit - t.printed)} left` : '';
  // "93/100 h": it has to fit beside Mark Done on the 3.5" screen
  const meta = [`${hours(t.printed)}/${fmtHours(limit)}`, t.done ? `done ${fmtAgo(t.done)}` : ''].filter(Boolean).join(' · ');
  return `<div class="frow mrow" data-tone="${t.due ? 'due' : t.soon ? 'soon' : ''}">
    <div class="mring">${ring(share(t))}${icon('wrench')}</div>
    <div style="min-width:0"><div class="name">${esc(t.name)}</div>
      <div class="meta">${status ? `<b>${esc(status)}</b> · ` : ''}${esc(meta)}</div></div>
    <button class="chipbtn" data-i="${i}">Mark Done</button></div>`;
}

export function openMaintenance(ctx) {
  const { store } = ctx;
  ctx.refreshMaintenance();
  openSheet({
    title: 'Maintenance',
    render(body, sheet) {
      sheet.head.insertAdjacentHTML('beforeend', '<span class="note msum" data-sum></span>');
      const sum = sheet.head.querySelector('[data-sum]');
      body.innerHTML = '<div class="hist"><div class="scrollbox"><div class="scroll" data-list></div></div></div>';
      const list = body.querySelector('[data-list]');
      const scroller = makeScrollable(list);
      let tasks = []; // as shown: the most worn first
      let busy = false;

      list.addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-i]');
        const t = b && tasks[+b.dataset.i];
        if (!t || busy) return;
        busy = true;
        attempt(async () => {
          const ok = await confirmDialog({
            title: `Mark “${t.name}” done?`,
            body: `Its count starts again, and it’s due after another ${fmtHours(t.hours * 3600)} of printing.`,
            confirm: 'Mark Done',
          });
          if (!ok) return;
          ctx.applyMaintenance(await ctx.client.maintenanceDone(t.name));
          toast(`Marked Done · ${t.name}`, 'ok', 3500, 'check');
        }).finally(() => { busy = false; });
      });

      function render(s) {
        const st = s.maintenance;
        tasks = st && st.tasks ? st.tasks.slice().sort((a, b) => share(b) - share(a)) : [];
        const due = st ? st.due || 0 : 0;
        setText(sum, !tasks.length ? '' : due ? `${due} due` : 'All up to date');
        toggle(sum, 'due', due > 0);
        if (!st) {
          list.innerHTML = s.maintenanceError
            ? `<div class="empty-state">${icon('alert')}<b>Couldn’t load maintenance</b><span>${esc(s.maintenanceError)}</span></div>`
            : `<div class="empty-state">${icon('wrench')}<span>Loading…</span></div>`;
        } else if (!tasks.length) {
          list.innerHTML = `<div class="empty-state">${icon('wrench')}<b>No maintenance tasks</b><span>Add them in OctoPrint → Settings → Layer1.</span></div>`;
        } else {
          list.innerHTML = tasks.map(rowHTML).join('')
            + '<div class="note hist-more">Hours of printing, from History. Change the tasks in OctoPrint → Settings → Layer1.</div>';
        }
        scroller.update();
      }

      // the store changes every couple of seconds while printing; redraw only for this
      let shown = {};
      const update = (s) => {
        if (s.maintenance === shown.st && s.maintenanceError === shown.err) return;
        shown = { st: s.maintenance, err: s.maintenanceError };
        render(s);
      };
      update(store.get());
      return store.subscribe(update);
    },
  });
}

/** The dot on the rail's More button while a task is due, and a toast when one falls due. */
export function initMaintenance(ctx) {
  const more = document.querySelector('#rail [data-nav="more"]');
  let last = null;
  ctx.store.subscribe((s) => {
    const st = s.maintenance;
    if (!st || st === last) return;
    const before = last && new Set(dueNames(last));
    last = st;
    const due = dueNames(st);
    if (more) toggle(more, 'alert', due.length > 0);
    // newly due: a print just ended. Tasks already due when the page loaded are old news.
    const fresh = before ? due.filter((name) => !before.has(name)) : [];
    if (fresh.length) toast(`Maintenance Due · ${fresh.length === 1 ? fresh[0] : `${fresh.length} tasks`}`, 'warn', 8000, 'wrench');
  });
}
