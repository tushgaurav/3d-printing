// Display: dark or light theme, and touch calibration.

import { icon } from '../icons.js';
import { openSheet } from '../ui.js';
import { currentTheme, setTheme } from '../session.js';
import { openCalibration } from './calibrate.js';

const OPTIONS = [
  { id: 'dark', name: 'Dark', icon: 'moon', note: 'Graphite. Best on screens with deep blacks.' },
  { id: 'light', name: 'Light', icon: 'sun', note: 'Easier to read on cheap panels with greyish blacks.' },
];

export function openDisplay(ctx) {
  openSheet({
    title: 'Display',
    render(body, sheet) {
      body.innerHTML = `
        <div class="section"><div class="label">Theme</div>
          <div class="theme-pick">${OPTIONS.map((o) => `
            <button class="theme-opt" data-pick="${o.id}">
              <span class="sw ${o.id}"><i></i><i class="card"></i></span>
              <b>${icon(o.icon)}${o.name}</b><small>${o.note}</small>
            </button>`).join('')}
          </div>
        </div>
        <div class="section"><div class="label">Touch <em>if taps land in the wrong place</em></div>
          <button class="btn" data-a="calibrate" style="width:100%">${icon('touch')}Calibrate Touch</button>
        </div>`;
      const mark = () => body.querySelectorAll('[data-pick]')
        .forEach((b) => b.classList.toggle('active', b.dataset.pick === currentTheme()));
      mark();
      body.addEventListener('click', (e) => {
        const pick = e.target.closest('[data-pick]');
        if (pick) { setTheme(pick.dataset.pick); mark(); return; }
        if (e.target.closest('[data-a="calibrate"]')) { sheet.close(); openCalibration(ctx); }
      });
      return null;
    },
  });
}
