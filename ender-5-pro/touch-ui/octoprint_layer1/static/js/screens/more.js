// More: everything that isn't needed every minute.

import { icon } from '../icons.js';
import { esc } from '../util.js';
import { openTune } from '../sheets/tune.js';
import { openFilament } from '../sheets/filament.js';
import { openLiveCamera } from '../sheets/camera.js';
import { openPrinter } from '../sheets/printer.js';
import { openSystem } from '../sheets/system.js';
import { openDisplay } from '../sheets/display.js';
import { openHistory } from '../sheets/history.js';
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
      { icon: 'plug', title: 'Printer', open: openPrinter },
      { icon: 'power', title: 'System', open: openSystem },
      { icon: 'display', title: 'Display', open: openDisplay },
      { icon: 'lock', title: 'Lock', open: openLockSettings },
    ];
    el.innerHTML = `<div class="more">${tiles.map((t, i) => `
      <button class="tile" data-i="${i}"><span class="ti">${icon(t.icon)}</span><b>${esc(t.title)}</b></button>`).join('')}</div>`;
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-i]');
      if (b) tiles[+b.dataset.i].open(ctx);
    });
    return {};
  },
};
