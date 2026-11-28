// More: everything that isn't needed every minute.

import { icon } from '../icons.js';
import { esc, setText, show } from '../util.js';
import { openTune } from '../sheets/tune.js';
import { openFilament } from '../sheets/filament.js';
import { openLiveCamera } from '../sheets/camera.js';
import { openPrinter } from '../sheets/printer.js';
import { openSystem } from '../sheets/system.js';
import { openDisplay } from '../sheets/display.js';
import { openHistory } from '../sheets/history.js';
import { openMaintenance, dueNames } from '../sheets/maintenance.js';
import { openLockSettings } from '../sheets/lock.js';

export default {
  id: 'more',
  icon: 'more',
  title: 'More',

  mount(el, ctx) {
    const tiles = [
      { icon: 'spool', title: 'Filament', open: openFilament },
      { icon: 'tune', title: 'Tune', open: openTune },
      { icon: 'camera', title: 'Camera', open: openLiveCamera },
      { icon: 'history', title: 'History', open: openHistory },
      { icon: 'wrench', title: 'Maintenance', open: openMaintenance, badge: (s) => dueNames(s.maintenance).length },
      { icon: 'plug', title: 'Printer', open: openPrinter },
      { icon: 'power', title: 'System', open: openSystem },
      { icon: 'display', title: 'Display', open: openDisplay },
      { icon: 'lock', title: 'Lock', open: openLockSettings },
    ];
    el.innerHTML = `<div class="more">${tiles.map((t, i) => `
      <button class="tile" data-i="${i}"><span class="ti">${icon(t.icon)}</span><b>${esc(t.title)}</b>${t.badge ? '<em class="badge hidden"></em>' : ''}</button>`).join('')}</div>`;
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-i]');
      if (b) tiles[+b.dataset.i].open(ctx);
    });

    // a count on the tiles that have something waiting (maintenance that's due)
    const badges = tiles.map((t, i) => t.badge && { count: t.badge, el: el.querySelector(`[data-i="${i}"] .badge`) }).filter(Boolean);
    const render = (s) => badges.forEach((b) => {
      const n = b.count(s);
      setText(b.el, n || '');
      show(b.el, n > 0);
    });
    render(ctx.store.get());
    ctx.store.subscribe(render);
    return {};
  },
};
