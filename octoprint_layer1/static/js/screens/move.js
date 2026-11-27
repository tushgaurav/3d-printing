// Move: XY jog pad, Z (which moves the bed on an Ender 5), step size,
// extrude/retract (by the same step), Level Bed and motors off. Locked while printing.

import { icon } from '../icons.js';
import { refs, setText, show, toggle } from '../util.js';
import { ACTIVE, IDLE, phaseOf } from '../model.js';
import { toast, attempt } from '../ui.js';
import { openLevel } from '../sheets/level.js';

export default {
  id: 'move',
  icon: 'move',
  title: 'Move',

  mount(el, ctx) {
    const { store, cfg } = ctx;
    const zBed = !!cfg.printer.zMovesBed;
    let step = cfg.move.defaultStep;

    el.innerHTML = `
      <div class="move" data-r="root">
        <div class="pad">
          <div class="void"></div>
          <button class="jog" data-axis="y" data-dir="1">${icon('up')}<small>Y+</small></button>
          <div class="void"></div>
          <button class="jog" data-axis="x" data-dir="-1">${icon('left')}<small>X−</small></button>
          <button class="jog home-btn" data-home="x,y">${icon('home')}<small>XY</small></button>
          <button class="jog" data-axis="x" data-dir="1">${icon('right')}<small>X+</small></button>
          <div class="void"></div>
          <button class="jog" data-axis="y" data-dir="-1">${icon('down')}<small>Y−</small></button>
          <div class="void"></div>
        </div>
        <div class="zcol">
          <button class="jog" data-axis="z" data-dir="${zBed ? -1 : 1}">${icon('up')}<small>${zBed ? 'Bed Up' : 'Z+'}</small></button>
          <button class="jog home-btn" data-home="z">${icon('home')}<small>Z</small></button>
          <button class="jog" data-axis="z" data-dir="${zBed ? 1 : -1}">${icon('down')}<small>${zBed ? 'Bed Down' : 'Z−'}</small></button>
        </div>
        <div class="steps">
          <div class="label">Step · mm</div>
          ${cfg.move.steps.map((v) => `<button class="seg" data-step="${v}">${v}</button>`).join('')}
        </div>
        <div class="bottom row-actions">
          <button class="btn tall" data-act="level">${icon('level')}Level Bed</button>
          <button class="btn tall" data-act="extrude">${icon('extrude')}<span data-r="extrudeLabel"></span></button>
          <button class="btn tall" data-act="retract">${icon('retract')}<span data-r="retractLabel"></span></button>
          <button class="btn tall" data-act="motors">${icon('unlock')}Motors Off</button>
        </div>
        <div class="lock hidden" data-r="lock">${icon('alert')}<span data-r="lockText"></span></div>
      </div>`;
    const r = refs(el);
    const stepButtons = [...el.querySelectorAll('[data-step]')];
    // The step size drives the jog distance and the extrude/retract length.
    const markStep = () => {
      stepButtons.forEach((b) => toggle(b, 'active', +b.dataset.step === step));
      setText(r.extrudeLabel, `Extrude ${step}`);
      setText(r.retractLabel, `Retract ${step}`);
    };
    markStep();

    function hotEnough() {
      const t = store.get().temps.tool0;
      if (t && t.actual != null && t.actual >= cfg.limits.minExtrudeTemp) return true;
      toast(`Heat the Nozzle to ${cfg.limits.minExtrudeTemp}° First`, 'warn', 3500, 'nozzle');
      return false;
    }

    el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.step) { step = +b.dataset.step; markStep(); return; }
      if (b.dataset.axis) {
        const d = step * +b.dataset.dir;
        attempt(() => ctx.client.jog({ [b.dataset.axis]: d }));
        return;
      }
      if (b.dataset.home) { attempt(() => ctx.client.home(b.dataset.home.split(','))); return; }
      switch (b.dataset.act) {
        case 'level': openLevel(ctx); break;
        case 'extrude': if (hotEnough()) attempt(() => ctx.client.extrude(step)); break;
        case 'retract': if (hotEnough()) attempt(() => ctx.client.extrude(-step)); break;
        case 'motors': attempt(async () => { await ctx.client.gcode('M84'); toast('Motors Off · Axes Can Be Moved by Hand', 'muted', 3500, 'unlock'); }); break;
        default:
      }
    });

    function render(s) {
      const ph = phaseOf(s);
      const locked = !IDLE.has(ph);
      toggle(r.root, 'locked', locked);
      show(r.lock, locked);
      setText(r.lockText, ACTIVE.has(ph) ? 'Movement is locked while printing' : 'Printer not connected');
    }

    store.subscribe(render);
    render(store.get());
    return {};
  },
};
