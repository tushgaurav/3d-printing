// Heat: nozzle and bed targets with +/- steps, a keypad, and material presets.
// Taps are batched (debounced) so hammering "+" sends one command, not ten.
// Each card shows its last ten minutes as a sparkline; tap it for the full graph.

import { icon } from '../icons.js';
import { refs, setText, setData, esc, clamp, debounce, fmtTemp } from '../util.js';
import { toast, attempt, numberPad } from '../ui.js';
import { sparkSVG, drawSpark } from '../chart.js';
import { openTemps } from '../sheets/temps.js';

const SPARK_SECONDS = 10 * 60;

export default {
  id: 'heat',
  icon: 'heat',
  title: 'Temperature',

  mount(el, ctx) {
    const { store, cfg } = ctx;
    const heaters = [
      // span: the sparkline's smallest scale (°C top to bottom), so small drifts read as small
      { key: 'tool0', name: 'Nozzle', icon: 'nozzle', max: cfg.limits.nozzleMax, preset: 'nozzle', span: 30, set: (t) => ctx.client.setToolTemp(t) },
      { key: 'bed', name: 'Bed', icon: 'bed', max: cfg.limits.bedMax, preset: 'bed', span: 15, set: (t) => ctx.client.setBedTemp(t) },
    ];

    el.innerHTML = `
      <div class="heat">
        ${heaters.map((h) => `
          <div class="hcard">
            <div class="head">${icon(h.icon)}<span class="name">${h.name}</span><span class="badge" data-r="${h.key}Badge">Off</span></div>
            <div class="actual"><b data-r="${h.key}Actual">—</b><span>°C</span></div>
            <button class="spark" data-r="${h.key}Spark" data-graph="${h.key}" aria-label="${h.name} temperature graph">${sparkSVG()}</button>
            <div class="ctl">
              <button class="btn" data-act="dec" data-h="${h.key}" aria-label="Lower">${icon('minus')}</button>
              <button class="btn target" data-act="edit" data-h="${h.key}"><span data-r="${h.key}Target">0°</span><small>Target</small></button>
              <button class="btn" data-act="inc" data-h="${h.key}" aria-label="Raise">${icon('plus')}</button>
            </div>
            <button class="btn ghost off" data-act="off" data-h="${h.key}">Turn Off</button>
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
      if (b.dataset.graph) { openTemps(ctx); return; }
      const s = store.get();
      if (b.dataset.preset != null) {
        const p = b.dataset.preset === 'off' ? { name: 'Cool', nozzle: 0, bed: 0 } : cfg.presets[+b.dataset.preset];
        setTarget(heaters[0], p.nozzle);
        setTarget(heaters[1], p.bed);
        toast(p.nozzle ? `Preheating for ${p.name}` : 'Heaters Off', p.nozzle ? 'heat' : 'muted', 3500, p.nozzle ? 'flame' : 'cool');
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
        setData(r[`${h.key}Spark`], 'tone', tone);
      }
    }

    // sparklines: redrawn when readings arrive, and only while this screen is showing
    let visible = false;
    let drawn = -1;
    function renderSparks() {
      if (!visible || drawn === ctx.temps.version) return;
      drawn = ctx.temps.version;
      for (const h of heaters) drawSpark(r[`${h.key}Spark`].firstElementChild, ctx.temps, h.key, SPARK_SECONDS, h.span);
    }

    store.subscribe(render);
    ctx.temps.subscribe(renderSparks);
    render(store.get());
    return {
      onShow() { visible = true; renderSparks(); },
      onHide() { visible = false; },
    };
  },
};
