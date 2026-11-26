// Home: camera (or model thumbnail), the layer-stack progress gauge, job stats
// and the three actions that matter right now.

import { icon } from '../icons.js';
import {
  refs, setText, toggle, show, setData, setStyle, esc, bust, camTransform,
  fmtDuration, fmtClock, fmtAgo, displayName, filamentUse, fmtFilament,
} from '../util.js';
import { PHASES, ACTIVE, phaseOf, findFile, thumbUrl, lastPrinted, jobPath } from '../model.js';
import { toast, attempt, confirmDialog, choiceDialog } from '../ui.js';
import { openTune } from '../sheets/tune.js';
import { openLiveCamera } from '../sheets/camera.js';

const LAYERS = 36; // the gauge is 216px tall: 36 layers of 4px + 2px gap

export default {
  id: 'home',
  icon: 'home',
  title: 'Home',

  mount(el, ctx) {
    const { store, cfg } = ctx;
    el.innerHTML = `
      <div class="home" data-r="root">
        <div class="media" data-r="media">
          <img data-r="cam" class="hidden" alt="">
          <img data-r="model" class="model hidden" alt="">
          <div class="empty" data-r="empty">${icon('camera')}<span data-r="emptyText"></span></div>
          <button class="chip hidden" data-r="chip"><i></i><span data-r="chipText">Live</span></button>
          <div class="expand hidden" data-r="expand">${icon('expand')}</div>
        </div>
        <div class="caption">
          <div class="t" data-r="capT"></div>
          <div class="s" data-r="capS"></div>
        </div>
        <div class="stack" data-r="stack"><div class="fill" data-r="fill"></div><div class="cur" data-r="cur"></div></div>
        <div class="info">
          <div class="label" data-r="phase"></div>
          <div class="job-only">
            <div class="pct"><b data-r="pct">0</b><span>%</span></div>
            <div class="left"><span data-r="left">—</span><small data-r="leftUnit"></small></div>
            <div class="eta" data-r="eta"></div>
            <div class="rule"></div>
            <div class="kv"><span>Height</span><b data-r="z">—</b></div>
            <div class="kv"><span>Elapsed</span><b data-r="elapsed">—</b></div>
            <div class="kv"><span>Speed</span><b data-r="speed">100%</b></div>
          </div>
          <div class="idle-only">
            <div class="title" data-r="title"></div>
            <div class="text" data-r="text"></div>
            <div data-r="lastBox" class="lastbox hidden">
              <div class="rule"></div>
              <div class="label">Last print</div>
              <div class="last" data-r="lastName"></div>
              <div class="last-meta" data-r="lastMeta"></div>
            </div>
          </div>
        </div>
        <div class="actions row-actions" data-r="actions"></div>
      </div>`;

    const r = refs(el);
    const cam = cfg.webcam || {};
    const camOn = !!(cam.enabled && cam.snapshot);
    r.cam.style.transform = camTransform(cam);

    let visible = false;
    let camOk = null;          // null = not tried yet
    let mediaPref = 'cam';     // or 'model'
    let thumb = null;
    const badThumbs = new Set();
    let snapTimer = null;
    let snapping = false;
    let actions = [];
    let actionsKey = '';

    // ~~ camera snapshots (only while this screen is visible)

    function snap() {
      if (snapping) return;
      snapping = true;
      const img = new Image();
      const done = (ok) => {
        snapping = false;
        if (ok) r.cam.src = img.src;
        if (camOk !== ok) { camOk = ok; render(store.get()); }
      };
      img.onload = () => done(true);
      img.onerror = () => done(false);
      img.src = bust(cam.snapshot);
    }

    function syncSnap(want) {
      if (want && !snapTimer) {
        snap();
        snapTimer = setInterval(snap, Math.max(1, cam.snapshotSeconds || 3) * 1000);
      } else if (!want && snapTimer) {
        clearInterval(snapTimer);
        snapTimer = null;
      }
    }

    r.model.onerror = () => { badThumbs.add(r.model.getAttribute('src')); render(store.get()); };

    r.chip.addEventListener('click', (e) => {
      e.stopPropagation();
      mediaPref = mediaPref === 'cam' ? 'model' : 'cam';
      render(store.get());
    });

    r.media.addEventListener('click', () => { if (camOn) openLiveCamera(ctx); });

    // ~~ actions

    const tune = { label: 'Tune', icon: 'tune', run: () => openTune(ctx) };
    const stop = {
      label: 'Stop', icon: 'stop', tone: 'danger',
      run: async () => {
        const ok = await confirmDialog({
          title: 'Stop this print?',
          body: 'The print is cancelled and can’t be resumed.',
          confirm: 'Stop print', tone: 'danger',
        });
        if (ok) await ctx.client.cancel();
      },
    };

    async function printAgain(file) {
      const ok = await confirmDialog({ title: 'Print again?', body: displayName(file), confirm: 'Print', tone: 'primary' });
      if (!ok) return;
      await ctx.client.printFile(file.origin || 'local', file.path);
      toast(`Starting ${displayName(file)}`, 'accent');
    }

    async function preheat() {
      const choice = await choiceDialog({
        title: 'Preheat',
        options: [
          ...cfg.presets.map((p) => ({ label: p.name, sub: `${p.nozzle}° / ${p.bed}°`, value: p })),
          { label: 'Cool down', sub: 'Heaters off', value: 'off' },
        ],
      });
      if (!choice) return;
      const p = choice === 'off' ? { name: 'Cool down', nozzle: 0, bed: 0 } : choice;
      await Promise.all([ctx.client.setToolTemp(p.nozzle), ctx.client.setBedTemp(p.bed)]);
      toast(p.nozzle ? `Preheating for ${p.name}` : 'Heaters off', p.nozzle ? 'accent' : 'muted');
    }

    function actionsFor(s, ph) {
      const file = s.job && s.job.file;
      switch (ph) {
        case 'printing':
        case 'resuming':
          return [{ label: 'Pause', icon: 'pause', run: () => ctx.client.pause() }, tune, stop];
        case 'pausing':
          return [{ label: 'Pausing…', icon: 'pause', disabled: true }, tune, stop];
        case 'paused':
          return [{ label: 'Resume', icon: 'play', tone: 'primary', run: () => ctx.client.resume() }, tune, stop];
        case 'cancelling':
          return [{ label: 'Stopping…', icon: 'stop', disabled: true }];
        case 'finished':
          return [
            { label: 'Done', icon: 'check', run: () => store.set({ dismissedJob: jobPath(s) }) },
            { label: 'Files', icon: 'files', run: () => ctx.go('files') },
            { label: 'Print again', icon: 'refresh', tone: 'primary', run: () => printAgain(file) },
          ];
        case 'ready':
        case 'heating':
          return [
            { label: 'Preheat', icon: 'heat', run: preheat },
            { label: 'Home axes', icon: 'home', run: async () => { await ctx.client.home(['x', 'y', 'z']); toast('Homing X, Y and Z'); } },
            { label: 'Print', icon: 'play', tone: 'primary', run: () => ctx.go('files') },
          ];
        case 'disconnected':
        case 'error':
          return [
            { label: 'Files', icon: 'files', run: () => ctx.go('files') },
            { label: 'Connect printer', icon: 'plug', tone: 'primary', run: async () => { await ctx.client.connect(); toast('Connecting to the printer…'); } },
          ];
        case 'linking':
          return [{ label: 'Connecting to printer…', icon: 'plug', disabled: true }];
        default:
          return [{ label: 'Reload screen', icon: 'refresh', run: () => location.reload() }];
      }
    }

    r.actions.addEventListener('click', (e) => {
      const b = e.target.closest('[data-i]');
      const a = b && actions[+b.dataset.i];
      if (a && a.run) attempt(a.run);
    });

    function renderActions(s, ph) {
      const list = actionsFor(s, ph);
      const key = list.map((a) => `${a.label}${a.disabled ? '!' : ''}`).join('|');
      actions = list;
      if (key === actionsKey) return;
      actionsKey = key;
      r.actions.innerHTML = list.map((a, i) => `<button class="btn ${a.tone || ''}" data-i="${i}" ${a.disabled ? 'disabled' : ''}>${icon(a.icon)}<span>${esc(a.label)}</span></button>`).join('');
    }

    // ~~ render

    function renderStack(pct, tone) {
      const exact = (pct / 100) * LAYERS;
      const done = Math.min(LAYERS, Math.floor(exact));
      const frac = Math.round((exact - done) * 8) / 8; // quantised: fewer repaints
      setStyle(r.fill, 'height', `${done * 6}px`);
      setStyle(r.cur, 'bottom', `${done * 6}px`);
      setStyle(r.cur, 'width', `${done < LAYERS ? frac * 100 : 0}%`);
      setData(r.stack, 'tone', tone === 'ok' || tone === 'warn' ? tone : null);
    }

    function renderMedia() {
      const useModel = !!thumb && (mediaPref === 'model' || !camOn || camOk === false);
      if (useModel && r.model.getAttribute('src') !== thumb) r.model.src = thumb;
      show(r.model, useModel);
      show(r.cam, !useModel && camOn && camOk === true);
      show(r.empty, !useModel && !(camOn && camOk === true));
      setText(r.emptyText, !camOn ? 'No camera' : camOk === false ? 'Camera offline' : 'Camera…');
      show(r.chip, camOn && !!thumb);
      toggle(r.chip, 'model', useModel);
      setText(r.chipText, useModel ? 'Model' : 'Live');
      show(r.expand, camOn);
      syncSnap(visible && camOn && !useModel);
    }

    function idleCopy(s, ph) {
      const t = s.temps || {};
      switch (ph) {
        case 'ready': return ['Ready', 'Pick a file to print, or preheat for your filament.'];
        case 'heating': {
          const parts = [];
          if (t.tool0 && t.tool0.target > 0) parts.push(`Nozzle → ${Math.round(t.tool0.target)}°`);
          if (t.bed && t.bed.target > 0) parts.push(`Bed → ${Math.round(t.bed.target)}°`);
          return ['Heating', parts.join(' · ')];
        }
        case 'disconnected': return ['Printer off', 'OctoPrint is running but the printer isn’t connected. Check power and the USB cable.'];
        case 'linking': return ['Connecting', (s.printer && s.printer.text) || 'Opening the serial port…'];
        case 'error': return ['Printer error', (s.printer && (s.printer.error || s.printer.text)) || 'Unknown error'];
        case 'offline': return ['No OctoPrint', 'Can’t reach OctoPrint on this Pi. Retrying…'];
        case 'unauthorized': return ['Not paired', 'This screen needs to be paired with OctoPrint.'];
        default: return ['Starting', 'Talking to OctoPrint…'];
      }
    }

    function render(s) {
      const ph = phaseOf(s);
      const meta = PHASES[ph];
      const showJob = ACTIVE.has(ph) || ph === 'finished';
      toggle(r.root, 'is-job', showJob);
      setText(r.phase, meta.label);
      setData(r.phase, 'tone', meta.tone);

      const file = s.job && s.job.file && s.job.file.name ? s.job.file : null;
      const entry = showJob && file ? findFile(s.files, file.path) : null;
      const url = entry ? thumbUrl(entry, ctx.base) : null;
      thumb = url && !badThumbs.has(url) ? url : null;

      const prog = s.progress || {};
      const pct = ph === 'finished' ? 100 : Math.max(0, Math.min(100, prog.completion || 0));

      if (showJob && file) {
        setText(r.pct, Math.floor(pct));
        if (ph === 'finished') {
          setText(r.left, fmtDuration(prog.printTime));
          setText(r.leftUnit, 'total');
          setText(r.eta, 'Print complete');
        } else {
          const left = prog.printTimeLeft;
          setText(r.left, left != null ? fmtDuration(left) : 'Estimating');
          setText(r.leftUnit, left != null ? 'left' : '');
          setText(r.eta, left != null ? `Done ≈ ${fmtClock(new Date(Date.now() + left * 1000))}` : '');
        }
        setText(r.z, s.currentZ != null ? `${Number(s.currentZ).toFixed(2)} mm` : '—');
        setText(r.elapsed, fmtDuration(prog.printTime));
        setText(r.speed, s.flow !== 100 ? `${s.feed}% · flow ${s.flow}%` : `${s.feed}%`);
        setText(r.capT, displayName(file));
        const est = s.job.estimatedPrintTime;
        const use = filamentUse(s.job, cfg.ui.filamentDensity);
        setText(r.capS, [est ? `Est. ${fmtDuration(est)}` : '', fmtFilament(use)].filter(Boolean).join(' · '));
      } else {
        const [title, text] = idleCopy(s, ph);
        setText(r.title, title);
        setText(r.text, text);
        const bv = cfg.printer.buildVolume || [];
        setText(r.capT, cfg.printer.name);
        setText(r.capS, bv.length === 3 ? `${bv[0]} × ${bv[1]} × ${bv[2]} mm` : '');
        const last = (ph === 'ready' || ph === 'heating') && lastPrinted(s.files);
        show(r.lastBox, !!last);
        if (last) {
          setText(r.lastName, displayName(last.file));
          const ok = last.last.success;
          const time = last.last.printTime ? ` · ${fmtDuration(last.last.printTime)}` : '';
          const html = `<span style="color:var(--${ok ? 'ok' : 'danger'})">${icon(ok ? 'check' : 'cross')}</span>${esc(fmtAgo(last.last.date) + time)}`;
          if (r.lastMeta._html !== html) { r.lastMeta._html = html; r.lastMeta.innerHTML = html; }
        }
      }

      renderStack(showJob ? pct : 0, meta.tone);
      renderMedia();
      renderActions(s, ph);
    }

    store.subscribe(render);
    render(store.get());

    return {
      onShow() { visible = true; render(store.get()); },
      onHide() { visible = false; syncSnap(false); },
    };
  },
};
