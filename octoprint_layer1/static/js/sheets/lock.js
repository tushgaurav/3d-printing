// Lock Screen (from More): lock now, and how long without a touch before the
// screen locks by itself. The choice is remembered on this screen.

import { icon } from '../icons.js';
import { toggle } from '../util.js';
import { openSheet } from '../ui.js';
import { saveAutoLock } from '../session.js';
import { autoLockMinutes, lockScreen } from '../lock.js';

const CHOICES = [0, 1, 5, 15];

export function openLockSettings(ctx) {
  openSheet({
    title: 'Lock Screen',
    render(body, sheet) {
      body.innerHTML = `
        <div class="lockset">
          <p class="note">Locking stops stray taps and curious hands from changing anything. The print stays on screen. To unlock, <b>hold the button for a second</b>.</p>
          <div class="section"><div class="label">Lock automatically <em>after no touches</em></div>
            <div class="grid-auto">${CHOICES.map((m) => `<button class="seg" data-min="${m}">${m ? `${m} min` : 'Never'}</button>`).join('')}</div>
          </div>
          <button class="btn primary" data-a="lock">${icon('lock')}Lock Now</button>
        </div>`;
      const segs = [...body.querySelectorAll('[data-min]')];
      const mark = () => {
        const cur = autoLockMinutes(ctx);
        segs.forEach((b) => toggle(b, 'active', +b.dataset.min === cur));
      };
      mark();
      body.addEventListener('click', (e) => {
        const seg = e.target.closest('[data-min]');
        if (seg) { saveAutoLock(+seg.dataset.min); mark(); return; }
        if (e.target.closest('[data-a="lock"]')) { sheet.close(); lockScreen(ctx); }
      });
      return null;
    },
  });
}
