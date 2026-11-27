// Full-screen live camera with a small progress/temperature readout.

import { esc, fmtTemp, fmtDuration } from '../util.js';
import { ACTIVE, phaseOf } from '../model.js';
import { openCamera, toast } from '../ui.js';

export function openLiveCamera(ctx) {
  const cam = ctx.cfg.webcam || {};
  if (!cam.enabled || !cam.stream) { toast('No Camera Configured', 'warn', 3500, 'camera'); return; }
  openCamera(cam, (hud) => {
    const render = (s) => {
      const t = s.temps || {};
      const parts = [
        `Nozzle ${fmtTemp(t.tool0 && t.tool0.actual)}°`,
        `Bed ${fmtTemp(t.bed && t.bed.actual)}°`,
      ];
      if (ACTIVE.has(phaseOf(s)) && s.progress) {
        parts.unshift(`${Math.floor(s.progress.completion || 0)}%`);
        if (s.progress.printTimeLeft != null) parts.push(`${fmtDuration(s.progress.printTimeLeft)} left`);
      }
      const html = parts.map((p) => `<span>${esc(p)}</span>`).join('');
      if (hud._html !== html) { hud._html = html; hud.innerHTML = html; }
    };
    render(ctx.store.get());
    return ctx.store.subscribe(render);
  });
}
