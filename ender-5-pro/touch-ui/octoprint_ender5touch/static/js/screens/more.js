// More: everything that isn't needed every minute.

import { icon } from '../icons.js';
import { esc } from '../util.js';
import { openTune } from '../sheets/tune.js';
import { openFilament } from '../sheets/filament.js';
import { openLiveCamera } from '../sheets/camera.js';
import { openPrinter } from '../sheets/printer.js';
import { openSystem } from '../sheets/system.js';
import { openCalibration } from '../sheets/calibrate.js';

export default {
  id: 'more',
  icon: 'more',
  title: 'More',

  mount(el, ctx) {
    const tiles = [
      { icon: 'spool', title: 'Filament', sub: 'Load · unload · purge', open: openFilament },
      { icon: 'tune', title: 'Tune', sub: 'Speed · flow · fan', open: openTune },
      { icon: 'camera', title: 'Camera', sub: 'Live view', open: openLiveCamera },
      { icon: 'plug', title: 'Printer', sub: 'USB connection', open: openPrinter },
      { icon: 'power', title: 'System', sub: 'Restart · shut down', open: openSystem },
      { icon: 'touch', title: 'Touch', sub: 'Calibrate screen', open: openCalibration },
    ];
    el.innerHTML = `<div class="more">${tiles.map((t, i) => `
      <button class="tile" data-i="${i}"><span class="ti">${icon(t.icon)}</span><div><b>${esc(t.title)}</b><span>${esc(t.sub)}</span></div></button>`).join('')}</div>`;
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-i]');
      if (b) tiles[+b.dataset.i].open(ctx);
    });
    return {};
  },
};
