// Display: dark or light theme, screen sleep, and touch calibration (in the header:
// it's needed once, when taps land in the wrong place).

import { icon } from '../icons.js';
import { toggle } from '../util.js';
import { openSheet } from '../ui.js';
import { currentTheme, setTheme, saveSleep } from '../session.js';
import { sleepMinutes } from '../sleep.js';
import { openCalibration } from './calibrate.js';

const OPTIONS = [
  { id: 'dark', name: 'Dark', icon: 'moon', note: 'Graphite. Best on screens with deep blacks.' },
  { id: 'light', name: 'Light', icon: 'sun', note: 'Easier to read on cheap panels with greyish blacks.' },
];
const SLEEP = [0, 2, 5, 15, 30];

export function openDisplay(ctx) {
  openSheet({
    title: 'Display',
    render(body, sheet) {
      sheet.head.insertAdjacentHTML('beforeend', `<button class="chipbtn" data-a="calibrate">${icon('touch')}Calibrate Touch</button>`);
      body.innerHTML = `
        <div class="section"><div class="label">Theme</div>
          <div class="theme-pick">${OPTIONS.map((o) => `
            <button class="theme-opt" data-pick="${o.id}">
              <span class="sw ${o.id}"><i></i><i class="card"></i></span>
              <b>${icon(o.icon)}${o.name}</b><small>${o.note}</small>
            </button>`).join('')}
          </div>
        </div>
        <div class="section"><div class="label">Screen sleep <em>goes dark after no touches · tap to wake</em></div>
          <div class="grid-auto">${SLEEP.map((m) => `<button class="seg" data-sleep="${m}">${m ? `${m} min` : 'Never'}</button>`).join('')}</div>
        </div>`;
      const mark = () => {
        body.querySelectorAll('[data-pick]').forEach((b) => toggle(b, 'active', b.dataset.pick === currentTheme()));
        const sleep = sleepMinutes(ctx);
        body.querySelectorAll('[data-sleep]').forEach((b) => toggle(b, 'active', +b.dataset.sleep === sleep));
      };
      mark();
      body.addEventListener('click', (e) => {
        const pick = e.target.closest('[data-pick]');
        if (pick) { setTheme(pick.dataset.pick); mark(); return; }
        const sleep = e.target.closest('[data-sleep]');
        if (sleep) { saveSleep(+sleep.dataset.sleep); mark(); }
      });
      sheet.head.querySelector('[data-a="calibrate"]').addEventListener('click', () => { sheet.close(); openCalibration(ctx); });
      return null;
    },
  });
}
