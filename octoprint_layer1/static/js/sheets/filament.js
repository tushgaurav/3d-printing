// Filament load / unload for a Bowden setup (set filament.bowdenLength for your printer).
// Moves are split into short chunks because Marlin refuses single
// extrusions longer than EXTRUDE_MAXLENGTH (often 200 mm).

import { icon } from '../icons.js';
import { refs, setText, setData, esc, toggle, fmtTemp } from '../util.js';
import { IDLE, phaseOf } from '../model.js';
import { openSheet, attempt, toast } from '../ui.js';

function chunks(total, size) {
  const out = [];
  let left = total;
  while (left > 0.001) {
    const c = Math.min(size, left);
    out.push(Math.round(c * 100) / 100);
    left -= c;
  }
  return out;
}

export function loadSequence(temp, f) {
  const fast = Math.max(0, f.bowdenLength - f.fastFeedStopShort);
  return {
    commands: [
      'M83',
      `M109 S${temp}`,
      ...chunks(fast, f.chunk).map((l) => `G1 E${l} F${f.fastFeed}`),
      ...chunks(f.purgeLength, f.chunk).map((l) => `G1 E${l} F${f.purgeFeed}`),
      'M82',
    ],
    seconds: fast / (f.fastFeed / 60) + f.purgeLength / (f.purgeFeed / 60),
  };
}

export function unloadSequence(temp, f) {
  const out = f.bowdenLength + f.unloadExtra;
  return {
    commands: [
      'M83',
      `M109 S${temp}`,
      `G1 E10 F${f.purgeFeed}`, // soften and shape the tip first
      ...chunks(out, f.chunk).map((l) => `G1 E-${l} F${f.fastFeed}`),
      'M82',
    ],
    seconds: 10 / (f.purgeFeed / 60) + out / (f.fastFeed / 60),
  };
}

export function purgeSequence(temp, f) {
  return { commands: ['M83', `M109 S${temp}`, `G1 E20 F${f.purgeFeed}`, 'M82'], seconds: 20 / (f.purgeFeed / 60) };
}

const VERB = { load: 'Loading', unload: 'Unloading', purge: 'Purging' };
const DONE = {
  load: 'Loaded — filament should be coming out of the nozzle.',
  unload: 'Unloaded — pull the filament out of the extruder.',
  purge: 'Purged 20 mm.',
};

export function openFilament(ctx) {
  const { store, cfg } = ctx;
  const f = cfg.filament;
  const presets = cfg.presets;
  const t0 = store.get().temps.tool0;
  let mat = Math.max(0, presets.findIndex((p) => t0 && Math.round(t0.target) === p.nozzle));
  let op = null; // { kind, temp, heatedAt, seconds }
  let tick = null;

  openSheet({
    title: 'Filament',
    render(body) {
      body.innerHTML = `
        <div class="section"><div class="label">Material <em>sets the nozzle temperature</em></div>
          <div class="grid-auto">${presets.map((p, i) => `<button class="seg" data-mat="${i}">${esc(p.name)}<small>${p.nozzle}°</small></button>`).join('')}</div>
        </div>
        <div class="row-actions" style="margin-bottom:10px">
          <button class="btn primary" data-op="load" style="height:54px">${icon('extrude')}Load</button>
          <button class="btn" data-op="unload" style="height:54px">${icon('retract')}Unload</button>
          <button class="btn ghost" data-op="purge" style="height:54px">Purge 20 mm</button>
        </div>
        <div class="statusline" data-r="status"><i></i><span data-r="text"></span></div>
        <div class="note" style="margin-top:8px">Bowden tube length is set to ${f.bowdenLength} mm. If loading stops short or pushes too far, measure yours and change <b>filament.bowdenLength</b> in the config.</div>`;
      const r = refs(body);
      const matBtns = [...body.querySelectorAll('[data-mat]')];
      const opBtns = [...body.querySelectorAll('[data-op]')];

      body.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b || b.disabled) return;
        if (b.dataset.mat) { mat = +b.dataset.mat; render(store.get()); return; }
        if (b.dataset.op) {
          const kind = b.dataset.op;
          const temp = presets[mat].nozzle;
          const seq = kind === 'load' ? loadSequence(temp, f) : kind === 'unload' ? unloadSequence(temp, f) : purgeSequence(temp, f);
          attempt(async () => {
            await ctx.client.gcode(seq.commands);
            op = { kind, temp, heatedAt: null, seconds: seq.seconds };
            toast(`${VERB[kind]} ${presets[mat].name}`, 'accent', 3500, 'spool');
            render(store.get());
          });
        }
      });

      function render(s) {
        matBtns.forEach((b) => toggle(b, 'active', +b.dataset.mat === mat));
        const idle = IDLE.has(phaseOf(s));
        opBtns.forEach((b) => { b.disabled = !idle; });
        const t = s.temps.tool0 || {};
        let text = `Pick a material, then Load or Unload. The nozzle heats to ${presets[mat].nozzle}° first.`;
        let tone = null;
        if (!idle) {
          text = 'Not available while printing or disconnected.';
          tone = 'warn';
        } else if (op) {
          if (!op.heatedAt && t.actual != null && t.actual >= op.temp - 3) op.heatedAt = Date.now();
          if (!op.heatedAt) {
            text = `Heating nozzle to ${op.temp}° · now ${fmtTemp(t.actual)}°`;
            tone = 'heat';
          } else {
            const left = Math.ceil(op.seconds - (Date.now() - op.heatedAt) / 1000);
            if (left > 0) { text = `${VERB[op.kind]} filament… ≈ ${left} s`; tone = 'accent'; }
            else { text = DONE[op.kind]; tone = 'ok'; }
          }
        }
        setText(r.text, text);
        setData(r.status, 'tone', tone);
      }

      render(store.get());
      const unsub = store.subscribe(render);
      tick = setInterval(() => render(store.get()), 1000);
      return () => { unsub(); clearInterval(tick); };
    },
  });
}
