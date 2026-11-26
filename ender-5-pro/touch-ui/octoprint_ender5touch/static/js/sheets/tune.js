// Tune: speed modes (M220), flow (M221) and part-cooling fan (M106/M107).
// OctoPrint doesn't report these back, so values are tracked from what we send
// plus what the G-code stream sends (parsed from the terminal log in app.js).

import { icon } from '../icons.js';
import { refs, setText, toggle, esc, clamp } from '../util.js';
import { openSheet, attempt, toast } from '../ui.js';

const FAN_STEPS = [0, 25, 50, 75, 100];

export function openTune(ctx) {
  const { store, cfg } = ctx;
  openSheet({
    title: 'Tune',
    render(body) {
      body.innerHTML = `
        <div class="section"><div class="label">Print speed <em data-r="feedNote"></em></div>
          <div class="grid-auto">${cfg.speedModes.map((m) => `<button class="seg" data-feed="${m.factor}">${esc(m.name)}<small>${m.factor}%</small></button>`).join('')}</div>
        </div>
        <div class="section"><div class="label">Flow <em>extrusion multiplier</em></div>
          <div class="stepper">
            <button class="btn" data-flow="-5" aria-label="Less">${icon('minus')}</button>
            <div class="val" data-r="flow">100%</div>
            <button class="btn" data-flow="5" aria-label="More">${icon('plus')}</button>
            <button class="btn ghost" data-flow="reset">Reset</button>
          </div>
        </div>
        <div class="section"><div class="label">Part fan <em data-r="fanNote"></em></div>
          <div class="grid-auto">${FAN_STEPS.map((v) => `<button class="seg" data-fan="${v}">${v === 0 ? 'Off' : `${v}%`}</button>`).join('')}</div>
        </div>`;
      const r = refs(body);
      const feedBtns = [...body.querySelectorAll('[data-feed]')];
      const fanBtns = [...body.querySelectorAll('[data-fan]')];

      body.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        const s = store.get();
        if (b.dataset.feed) {
          const f = +b.dataset.feed;
          attempt(async () => { await ctx.client.feedrate(f); store.set({ feed: f }); toast(`Speed ${f}%`); });
        } else if (b.dataset.flow) {
          const v = b.dataset.flow === 'reset' ? 100 : clamp(s.flow + +b.dataset.flow, 50, 150);
          attempt(async () => { await ctx.client.flowrate(v); store.set({ flow: v }); });
        } else if (b.dataset.fan) {
          const v = +b.dataset.fan;
          const cmd = v === 0 ? 'M107' : `M106 S${Math.round((v * 255) / 100)}`;
          attempt(async () => { await ctx.client.gcode(cmd); store.set({ fan: v }); });
        }
      });

      const render = (s) => {
        feedBtns.forEach((b) => toggle(b, 'active', +b.dataset.feed === s.feed));
        const known = cfg.speedModes.some((m) => m.factor === s.feed);
        setText(r.feedNote, known ? '' : `now ${s.feed}%`);
        setText(r.flow, `${s.flow}%`);
        const nearest = s.fan == null ? null : FAN_STEPS.reduce((a, b) => (Math.abs(b - s.fan) < Math.abs(a - s.fan) ? b : a));
        fanBtns.forEach((b) => toggle(b, 'active', +b.dataset.fan === nearest));
        setText(r.fanNote, s.fan == null ? 'not reported yet' : `now ${s.fan}%`);
      };
      render(store.get());
      return store.subscribe(render);
    },
  });
}
