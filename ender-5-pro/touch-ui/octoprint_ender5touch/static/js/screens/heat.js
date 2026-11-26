// Heat: nozzle and bed targets with +/- steps, a keypad, and material presets.
// Taps are batched (debounced) so hammering "+" sends one command, not ten.

import { icon } from '../icons.js';
import { refs, setText, setData, setStyle, esc, clamp, debounce, fmtTemp } from '../util.js';
import { toast, attempt, numberPad } from '../ui.js';

export default {
  id: 'heat',
  icon: 'heat',
  title: 'Temperature',

  mount(el, ctx) {
    const { store, cfg } = ctx;
    const heaters = [
      { key: 'tool0', name: 'Nozzle', icon: 'nozzle', max: cfg.limits.nozzleMax, preset: 'nozzle', set: (t) => ctx.client.setToolTemp(t) },
      { key: 'bed', name: 'Bed', icon: 'bed', max: cfg.limits.bedMax, preset: 'bed', set: (t) => ctx.client.setBedTemp(t) },
    ];

    el.innerHTML = `
      <div class="heat">
        ${heaters.map((h) => `
          <div class="hcard">
            <div class="head">${icon(h.icon)}<span class="name">${h.name}</span><span class="badge" data-r="${h.key}Badge">Off</span></div>
            <div class="actual"><b data-r="${h.key}Actual">—</b><span>°C</span></div>
            <div class="track"><div class="bar" data-r="${h.key}Bar"></div></div>
            <div class="ctl">
              <button class="btn" data-act="dec" data-h="${h.key}" aria-label="Lower">${icon('minus')}</button>
              <button class="btn target" data-act="edit" data-h="${h.key}"><span data-r="${h.key}Target">0°</span><small>Target</small></button>
              <button class="btn" data-act="inc" data-h="${h.key}" aria-label="Raise">${icon('plus')}</button>
            </div>
            <button class="btn ghost off" data-act="off" data-h="${h.key}">Turn off</button>
          </div>`).join('')}
        <div class="presets">
          ${cfg.presets.map((p, i) => `<button class="preset" data-preset="${i}"><b>${esc(p.name)}</b><span>${p.nozzle}°/${p.bed}°</span></button>`).join('')}
          <button class="preset cool" data-preset="off">${icon('cool')}<b>Off</b></button>
        </div>
      </div>`;
    const r = refs(el);

    // value shown immediately on tap; cleared once OctoPrint reports it (or after 5 s)
    const pending = {};
    const senders = {};
    for (const h of heaters) {
      senders[h.key] = debounce(() => {
        const p = pending[h.key];
        if (!p) return;
        p.sentAt = Date.now();
        attempt(() => h.set(p.value));
      }, 600);
    }

    function shownTarget(s, key) {
      const real = (s.temps && s.temps[key] && s.temps[key].target) || 0;
      const p = pending[key];
      if (p) {
        if (Math.round(real) === p.value || (p.sentAt && Date.now() - p.sentAt > 5000)) delete pending[key];
        else return p.value;
      }
      return Math.round(real);
    }

    function setTarget(h, v) {
      pending[h.key] = { value: clamp(Math.round(v), 0, h.max) };
      senders[h.key]();
      render(store.get());
    }

    el.addEventListener('click', async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const s = store.get();
      if (b.dataset.preset != null) {
        const p = b.dataset.preset === 'off' ? { name: 'Cool', nozzle: 0, bed: 0 } : cfg.presets[+b.dataset.preset];
        setTarget(heaters[0], p.nozzle);
        setTarget(heaters[1], p.bed);
        toast(p.nozzle ? `Preheating for ${p.name}` : 'Heaters off', p.nozzle ? 'heat' : 'muted');
        return;
      }
      const h = heaters.find((x) => x.key === b.dataset.h);
      if (!h) return;
      const cur = shownTarget(s, h.key);
      switch (b.dataset.act) {
        case 'inc': setTarget(h, cur === 0 ? cfg.presets[0][h.preset] : cur + 5); break;
        case 'dec': setTarget(h, cur - 5 <= 0 ? 0 : cur - 5); break;
        case 'off': setTarget(h, 0); break;
        case 'edit': {
          const v = await numberPad({ title: `${h.name} target`, value: cur, max: h.max });
          if (v != null) setTarget(h, v);
          break;
        }
        default:
      }
    });

    function render(s) {
      for (const h of heaters) {
        const t = (s.temps && s.temps[h.key]) || {};
        const target = shownTarget(s, h.key);
        setText(r[`${h.key}Actual`], fmtTemp(t.actual));
        setText(r[`${h.key}Target`], `${target}°`);
        let badge = 'Off';
        let tone = null;
        if (target > 0) {
          if (t.actual != null && t.actual < target - 3) { badge = 'Heating'; tone = 'heat'; }
          else if (t.actual != null && t.actual > target + 5) { badge = 'Cooling'; tone = 'cool'; }
          else { badge = 'At temp'; tone = 'ok'; }
        } else if (t.actual != null && t.actual > 50) {
          badge = 'Hot'; tone = 'warn';
        }
        setText(r[`${h.key}Badge`], badge);
        setData(r[`${h.key}Badge`], 'tone', tone);
        const ratio = clamp((t.actual || 0) / (target > 0 ? target : h.max), 0, 1);
        setStyle(r[`${h.key}Bar`], 'width', `${Math.round(ratio * 50) * 2}%`);
        setData(r[`${h.key}Bar`], 'tone', tone);
      }
    }

    store.subscribe(render);
    render(store.get());
    return {};
  },
};
