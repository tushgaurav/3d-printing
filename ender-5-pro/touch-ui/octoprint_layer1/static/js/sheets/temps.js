// Temperature (tap a sparkline on the Heat screen): nozzle and bed over the last
// 5, 10 or 30 minutes. One panel per heater, each scaled to its own range, since a
// 60° bed under a 0-250° axis is a flat line. The dashed line is the target.
// Press and drag across the graph to read both heaters at that moment.

import { icon } from '../icons.js';
import { refs, setText, toggle, show, fmtTemp } from '../util.js';
import { openSheet } from '../ui.js';
import { bucket, valueRange, niceRange, tempPaths, nearest } from '../chart.js';

const RANGES = [5, 10, 30];             // minutes
const PANELS = [
  { key: 'tool0', name: 'Nozzle', icon: 'nozzle', minSpan: 10 },
  { key: 'bed', name: 'Bed', icon: 'bed', minSpan: 6 },
];
const GUTTER = 30;                      // left, for the °C labels
const PAD_R = 8;
const PAD_Y = 7;
const PX_PER_POINT = 2.5;
const SCRUB_HOLD_MS = 3000;             // the readout stays this long after you let go

function agoText(sec) {
  sec = Math.max(0, Math.round(sec));
  if (sec < 5) return 'Now';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m ? `${m}:${String(s).padStart(2, '0')} ago` : `${s}s ago`;
}

export function openTemps(ctx) {
  let minutes = 10;
  openSheet({
    title: 'Temperature',
    render(body, sheet) {
      sheet.head.insertAdjacentHTML('beforeend', `<div class="trange">${RANGES.map((m) => `<button class="seg" data-min="${m}">${m} min</button>`).join('')}</div>`);
      const segs = [...sheet.head.querySelectorAll('[data-min]')];
      body.innerHTML = `
        <div class="tgraph" data-r="graph">
          ${PANELS.map((p) => `
            <div class="tpanel">
              <div class="tph">${icon(p.icon)}<span class="n">${p.name}</span>
                <span class="v"><b data-r="${p.key}V">—</b><small data-r="${p.key}T"></small></span></div>
              <svg class="tplot" data-r="${p.key}Svg" aria-hidden="true"></svg>
              <div class="tempty hidden" data-r="${p.key}Empty">Waiting for readings…</div>
            </div>`).join('')}
          <div class="taxis" style="padding:0 ${PAD_R}px 0 ${GUTTER}px"><div data-r="axis"></div></div>
        </div>`;
      const r = refs(body);

      let scrubT = null;       // the moment being read, as seconds before the newest reading
      let scrubTimer = null;
      let geo = null;          // last drawing's x mapping, for the scrubber

      function draw() {
        const win = ctx.temps.window(minutes * 60);
        const range = minutes * 60;
        let w = 0;
        for (const p of PANELS) {
          const svg = r[`${p.key}Svg`];
          w = svg.clientWidth;
          const h = svg.clientHeight;
          if (!w || !h) continue;
          const x0 = GUTTER;
          const x1 = w - PAD_R;
          const x = (t) => x0 + ((t - win.start) / range) * (x1 - x0);
          geo = { x0, x1, start: win.start, end: win.end, range };
          const points = bucket(win.samples, p.key, win.start, win.end, Math.max(20, Math.floor((x1 - x0) / PX_PER_POINT)));
          const vr = valueRange(points, p.minSpan);
          show(r[`${p.key}Empty`], !vr);
          if (!vr) { svg.innerHTML = ''; setText(r[`${p.key}V`], '—'); setText(r[`${p.key}T`], ''); continue; }
          const nice = niceRange(vr.lo, vr.hi, 3);
          const y = (v) => PAD_Y + (1 - (v - nice.lo) / (nice.hi - nice.lo)) * (h - 2 * PAD_Y);
          const d = tempPaths(points, { x, y, gap: Math.max(60, (range / ((x1 - x0) / PX_PER_POINT)) * 3) });
          const grid = nice.ticks.map((v) => `<line class="grid" x1="${x0}" x2="${x1}" y1="${y(v)}" y2="${y(v)}"/>
            <text class="tick" x="${x0 - 6}" y="${y(v)}">${v}</text>`).join('');

          // the reading shown in the header: the scrubbed moment, else the newest
          const at = scrubT != null ? nearest(points, win.end - scrubT) : points[points.length - 1];
          const mark = at ? `<circle class="dot" cx="${x(at.t)}" cy="${y(at.actual)}" r="4"/>` : '';
          const hair = scrubT != null && at ? `<line class="cross" x1="${x(at.t)}" x2="${x(at.t)}" y1="${PAD_Y - 4}" y2="${h - PAD_Y + 4}"/>` : '';
          svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
          svg.innerHTML = `${grid}<path class="tgt" d="${d.target}"/><path class="ln" d="${d.line}"/>${hair}${mark}`;
          setText(r[`${p.key}V`], at ? `${fmtTemp(at.actual)}°` : '—');
          setText(r[`${p.key}T`], at && at.target > 0 ? `/${Math.round(at.target)}` : '');
        }
        drawAxis(win, w);
      }

      // minutes-ago labels under both panels; while scrubbing, the moment being read
      function drawAxis(win, w) {
        const step = minutes <= 5 ? 1 : minutes <= 10 ? 2 : 10;
        const labels = [];
        for (let m = minutes; m >= 0; m -= step) {
          const pct = ((minutes - m) / minutes) * 100;
          const cls = m === minutes ? 'first' : m === 0 ? 'last' : '';
          labels.push(`<span class="${cls}" style="left:${pct}%">${m ? `−${m} min` : 'Now'}</span>`);
        }
        if (scrubT != null && geo && w) {
          const pct = Math.max(0, Math.min(100, ((minutes * 60 - scrubT) / (minutes * 60)) * 100));
          labels.push(`<span class="at" style="left:${pct}%">${agoText(scrubT)}</span>`);
        }
        const html = labels.join('');
        if (r.axis._html !== html) { r.axis._html = html; r.axis.innerHTML = html; }
        toggle(r.axis, 'scrubbing', scrubT != null);
      }

      // ~~ scrub: press and drag across either panel

      function scrubTo(e) {
        const svg = e.target.closest('.tplot') || r.tool0Svg;
        if (!geo) return;
        const rect = svg.getBoundingClientRect();
        const px = ((e.clientX - rect.left) / rect.width) * svg.clientWidth; // the screen may be scaled
        const t = geo.start + ((px - geo.x0) / (geo.x1 - geo.x0)) * geo.range;
        scrubT = Math.max(0, Math.min(geo.range, geo.end - t));
        draw();
      }
      let pid = null;
      r.graph.addEventListener('pointerdown', (e) => {
        if (!e.target.closest('.tplot')) return;
        pid = e.pointerId;
        try { r.graph.setPointerCapture(pid); } catch { /* ignore */ }
        clearTimeout(scrubTimer);
        scrubTo(e);
      });
      r.graph.addEventListener('pointermove', (e) => { if (pid === e.pointerId) scrubTo(e); });
      const release = () => {
        if (pid == null) return;
        pid = null;
        clearTimeout(scrubTimer);
        scrubTimer = setTimeout(() => { scrubT = null; draw(); }, SCRUB_HOLD_MS);
      };
      r.graph.addEventListener('pointerup', release);
      r.graph.addEventListener('pointercancel', release);

      const markRange = () => segs.forEach((b) => toggle(b, 'active', +b.dataset.min === minutes));
      sheet.head.addEventListener('click', (e) => {
        const b = e.target.closest('[data-min]');
        if (!b) return;
        minutes = +b.dataset.min;
        scrubT = null;
        markRange();
        draw();
      });
      markRange();

      const unsub = ctx.temps.subscribe(draw);
      requestAnimationFrame(draw); // after layout, so the panels have a size
      return () => { unsub(); clearTimeout(scrubTimer); };
    },
  });
}
