// Level Bed (from Move): the Ender 5 Pro has no probe, so the bed is levelled by hand with
// the knobs under its corners. Tap a spot and the nozzle goes there at Z 0 (the first move
// homes first); slide paper under it and turn that knob until the paper just drags. Next
// Corner goes round the four corners in order, since turning one knob shifts the others.
// Leaving the page lowers the bed off the nozzle again.
//
// "Arrived" comes from the printer: each move ends with M400 (wait until the moves are done)
// and M114 (report position), and that reply shows up in OctoPrint's terminal log. If it
// never comes (no push socket), the page stops waiting after a while and shows the steps.

import { icon } from '../icons.js';
import { refs, setText, setData, toggle } from '../util.js';
import { IDLE, phaseOf } from '../model.js';
import { openSheet, attempt, toast } from '../ui.js';

// row/col place each spot on the 3×3 map, as you see the bed from the front of the printer
const SPOTS = {
  bl: { name: 'Back Left', row: 1, col: 1 },
  br: { name: 'Back Right', row: 1, col: 3 },
  c: { name: 'Centre', row: 2, col: 2 },
  fl: { name: 'Front Left', row: 3, col: 1 },
  fr: { name: 'Front Right', row: 3, col: 3 },
};
const CORNERS = ['fl', 'fr', 'br', 'bl']; // Next Corner goes round the bed in this order

// M114's reply in the terminal log; OctoPrint 2 marks received lines "<<<", older ones "Recv:"
const POSITION = /^(?:Recv:|<<<)\s*X:(-?\d+(?:\.\d+)?)\s*Y:(-?\d+(?:\.\d+)?)\s*Z:(-?\d+(?:\.\d+)?)/;

/** Where a spot is in printer coordinates (X 0 is left, Y 0 is the front). */
export function spotXY(id, cfg) {
  const [w, d] = cfg.printer.buildVolume;
  const inset = cfg.level.inset;
  if (id === 'c') return { x: w / 2, y: d / 2 };
  return { x: id[1] === 'l' ? inset : w - inset, y: id[0] === 'f' ? inset : d - inset };
}

/** Lower the bed, go over the spot, bring the bed up to paper height, then report back. */
export function moveSequence(p, lv, home) {
  return [
    ...(home ? ['G28'] : []),
    'G90',
    `G1 Z${lv.clearance} F${lv.zFeed}`,
    `G1 X${p.x} Y${p.y} F${lv.travelFeed}`,
    `G1 Z${lv.paperZ} F${lv.zFeed}`,
    'M400',
    'M114',
  ];
}

export function openLevel(ctx) {
  const { store, cfg } = ctx;
  const lv = cfg.level;
  const client = ctx.client;
  let homed = false; // homed since this page opened (Motors Off elsewhere loses the position)
  let spot = null; // the spot the nozzle is at or going to
  let state = 'start'; // start | moving | there
  let target = null; // { x, y, z } we expect M114 to report
  let homing = false; // the current move started with G28
  let waitTimer = null;

  openSheet({
    title: 'Level Bed',
    render(body, sheet) {
      body.innerHTML = `
        <div class="level">
          <div class="bedmap">${Object.entries(SPOTS).map(([id, s]) => `
            <button class="spot" data-spot="${id}" style="grid-area:${s.row}/${s.col}">${icon('touch')}<small>${s.name}</small></button>`).join('')}
          </div>
          <div class="side">
            <div class="statusline" data-r="status"><i></i><span data-r="text"></span></div>
            <button class="btn primary next" data-act="next">${icon('right')}<span><span data-r="nextLabel"></span><small data-r="nextSub"></small></span></button>
            <div class="row-actions">
              <button class="btn" data-act="home">${icon('home')}Home</button>
              <button class="btn" data-act="done">${icon('check')}Done</button>
            </div>
          </div>
        </div>`;
      const r = refs(body);
      const spotBtns = [...body.querySelectorAll('[data-spot]')];
      const actBtns = [...body.querySelectorAll('[data-act]')];

      const idle = () => IDLE.has(phaseOf(store.get()));
      const nextCorner = () => {
        const i = CORNERS.indexOf(spot);
        return CORNERS[i < 0 ? 0 : (i + 1) % CORNERS.length];
      };

      function go(id) {
        const p = spotXY(id, cfg);
        const home = !homed;
        attempt(async () => {
          await client.gcode(moveSequence(p, lv, home));
          homed = true;
          homing = home;
          spot = id;
          state = 'moving';
          target = { x: p.x, y: p.y, z: lv.paperZ };
          clearTimeout(waitTimer);
          // homing a bed that is far down takes a while on an Ender 5
          waitTimer = setTimeout(() => { if (state === 'moving') { state = 'there'; render(store.get()); } }, (home ? 90 : 20) * 1000);
          render(store.get());
        });
      }

      function onLogs(lines) {
        if (state !== 'moving' || !target) return;
        for (const line of lines) {
          const m = POSITION.exec(String(line));
          if (!m) continue;
          const near = (a, b) => Math.abs(+a - b) < 0.05;
          if (near(m[1], target.x) && near(m[2], target.y) && near(m[3], target.z)) {
            state = 'there';
            clearTimeout(waitTimer);
            render(store.get());
            return;
          }
        }
      }

      body.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b || b.disabled) return;
        if (b.dataset.spot) { go(b.dataset.spot); return; }
        switch (b.dataset.act) {
          case 'next': go(nextCorner()); break;
          case 'home':
            attempt(async () => {
              await client.home(['x', 'y', 'z']);
              homed = true;
              spot = null; state = 'start'; target = null;
              clearTimeout(waitTimer);
              toast('Homing X, Y and Z', 'muted', 3500, 'home');
              render(store.get());
            });
            break;
          case 'done': sheet.close(); break;
          default:
        }
      });

      function render(s) {
        const ok = IDLE.has(phaseOf(s));
        spotBtns.forEach((b) => {
          b.disabled = !ok;
          toggle(b, 'active', b.dataset.spot === spot);
          setData(b, 'state', b.dataset.spot === spot ? state : null);
        });
        actBtns.forEach((b) => { if (b.dataset.act !== 'done') b.disabled = !ok; });
        setText(r.nextLabel, spot ? 'Next Corner' : 'Start');
        setText(r.nextSub, SPOTS[nextCorner()].name);

        const name = spot && SPOTS[spot].name;
        let text;
        let tone = null;
        if (!ok) {
          text = 'Not available while printing or disconnected.';
          tone = 'warn';
        } else if (state === 'moving') {
          text = homing ? `Homing, then moving to ${name}…` : `Moving to ${name}…`;
          tone = 'accent';
        } else if (state === 'there' && spot === 'c') {
          text = 'Centre check: the paper should drag about the same as at the corners.';
          tone = 'ok';
        } else if (state === 'there') {
          text = `Slide paper under the nozzle. Turn the ${name} knob until the paper just drags.`;
          tone = 'ok';
        } else {
          text = homed ? 'Tap a spot on the bed, or Start.' : 'Tap a spot on the bed, or Start. The printer homes first.';
        }
        setText(r.text, text);
        setData(r.status, 'tone', tone);
      }

      render(store.get());
      const unsub = store.subscribe(render);
      const unlog = client.on('logs', onLogs);
      return () => {
        unsub();
        unlog();
        clearTimeout(waitTimer);
        // don't leave the nozzle resting on the bed (or on the paper)
        if (spot && idle()) attempt(() => client.gcode(['G90', `G1 Z${lv.clearance} F${lv.zFeed}`]));
      };
    },
  });
}
