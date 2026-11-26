// Home: camera or 3D view of the print (the slicer picture when 3D isn't
// possible), the layer-stack progress gauge, job stats and the three actions
// that matter right now.

import { icon } from '../icons.js';
import {
  refs, setText, toggle, show, setData, setStyle, esc, bust, camTransform,
  fmtDuration, fmtClock, fmtAgo, displayName, filamentUse, fmtFilament,
} from '../util.js';
import { PHASES, ACTIVE, phaseOf, findFile, thumbUrl, lastPrinted, jobPath, printedBytes } from '../model.js';
import { toast, attempt, confirmDialog, choiceDialog } from '../ui.js';
import { openTune } from '../sheets/tune.js';
import { openLiveCamera } from '../sheets/camera.js';
import { openModel3d } from '../sheets/model3d.js';
import { storedMedia, saveMedia } from '../session.js';
import { ModelView, canModel, loadModel, modelKey } from '../model3d.js';

const LAYERS = 35; // the gauge is 210px tall: 35 layers of 4px + 2px gap (see .stack in app.css)

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
          <canvas data-r="m3d" class="m3d hidden"></canvas>
          <div class="empty" data-r="empty"><span data-r="emptyIcon">${icon('camera')}</span><span data-r="emptyText"></span></div>
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
            <div class="kv">${icon('layers')}<span>Height</span><b data-r="z">—</b></div>
            <div class="kv">${icon('clock')}<span>Elapsed</span><b data-r="elapsed">—</b></div>
            <div class="kv">${icon('speed')}<span>Speed</span><b data-r="speed">100%</b></div>
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
    let mediaPref = storedMedia(); // 'cam' or 'model' (the 3D view)
    let thumb = null;
    const badThumbs = new Set();
    let modelFile = null;          // the file the model side shows: the job, or the last print when idle
    let m3d = { key: null, status: null }; // 3D model of modelFile: 'loading' | 'ready' | 'failed'
    const view3d = new ModelView(r.m3d, { fit: 'box' });
    let emptyIcon = 'camera';
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
      saveMedia(mediaPref);
      render(store.get());
    });

    r.media.addEventListener('click', () => {
      if (!r.m3d.classList.contains('hidden') && modelFile) {
        const file = modelFile;
        view3d.setPaused(true); // one renderer at a time on the Pi
        openModel3d(ctx, file, { onClose: () => view3d.setPaused(false) });
      } else if (camOn) {
        openLiveCamera(ctx);
      }
    });

    // download and parse the model once; the picture shows meanwhile (and if it fails)
    function ensure3d(key) {
      if (m3d.key === key) return;
      m3d = { key, status: 'loading' };
      loadModel(ctx.client, modelFile).then(
        () => { if (m3d.key === key) { m3d.status = 'ready'; render(store.get()); } },
        (e) => {
          console.warn('[ender5] 3D view:', (e && e.message) || e);
          if (m3d.key === key) { m3d.status = 'failed'; render(store.get()); }
        },
      );
    }

    // ~~ actions

    const tune = { label: 'Tune', icon: 'tune', run: () => openTune(ctx) };
    const stop = {
      label: 'Stop', icon: 'stop', tone: 'danger',
      run: async () => {
        const ok = await confirmDialog({
          title: 'Stop this print?',
          body: 'The print is cancelled and can’t be resumed.',
          confirm: 'Stop Print', tone: 'danger',
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
          { label: 'Cool Down', sub: 'Heaters off', value: 'off' },
        ],
      });
      if (!choice) return;
      const p = choice === 'off' ? { name: 'Cool down', nozzle: 0, bed: 0 } : choice;
      await Promise.all([ctx.client.setToolTemp(p.nozzle), ctx.client.setBedTemp(p.bed)]);
      toast(p.nozzle ? `Preheating for ${p.name}` : 'Heaters off', p.nozzle ? 'heat' : 'muted');
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
            { label: 'Print Again', icon: 'again', tone: 'primary', run: () => printAgain(file) },
          ];
        case 'ready':
        case 'heating':
          return [
            { label: 'Preheat', icon: 'flame', run: preheat },
            { label: 'Home Axes', icon: 'home', run: async () => { await ctx.client.home(['x', 'y', 'z']); toast('Homing X, Y and Z'); } },
            { label: 'Print', icon: 'play', tone: 'primary', run: () => ctx.go('files') },
          ];
        case 'disconnected':
        case 'error':
          return [
            { label: 'Files', icon: 'files', run: () => ctx.go('files') },
            { label: 'Connect Printer', icon: 'plug', tone: 'primary', run: async () => { await ctx.client.connect(); toast('Connecting to the printer…'); } },
          ];
        case 'linking':
          return [{ label: 'Connecting to Printer…', icon: 'plug', disabled: true }];
        default:
          return [{ label: 'Reload Screen', icon: 'refresh', run: () => location.reload() }];
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

    function setEmpty(name, text) {
      if (emptyIcon !== name) { emptyIcon = name; r.emptyIcon.innerHTML = icon(name); }
      setText(r.emptyText, text);
    }

    function renderMedia(s) {
      const camLive = camOn && camOk === true;
      const key = canModel(modelFile) ? modelKey(modelFile) : null;
      const mine = !!key && m3d.key === key;
      const failed = mine && m3d.status === 'failed';
      const hasModel = (!!key && !failed) || !!thumb;
      // the model side: when chosen, or when there is no working camera
      const modelSide = hasModel && (mediaPref === 'model' || !camOn || camOk === false);
      if (modelSide && key && visible) ensure3d(key);
      const show3d = modelSide && mine && m3d.status === 'ready';
      const loading3d = modelSide && !!key && m3d.status === 'loading';
      const showThumb = modelSide && !show3d && !!thumb;
      if (showThumb && r.model.getAttribute('src') !== thumb) r.model.src = thumb;

      const was3d = !r.m3d.classList.contains('hidden');
      show(r.m3d, show3d);
      show(r.model, showThumb);
      show(r.cam, !modelSide && camLive);
      show(r.empty, !show3d && !showThumb && (modelSide || !camLive));
      if (modelSide) setEmpty('cube', loading3d ? 'Loading 3D…' : 'No preview');
      else setEmpty('camera', !camOn ? 'No camera' : camOk === false ? 'Camera offline' : 'Camera…');
      show(r.chip, camOn && hasModel);
      toggle(r.chip, 'model', modelSide);
      setText(r.chipText, !modelSide ? 'Live' : key && !failed ? '3D' : 'Model');
      show(r.expand, show3d || camOn);
      syncSnap(visible && camOn && !modelSide);

      if (show3d) {
        view3d.setModel(key);
        view3d.setProgress(printedBytes(s, modelFile)); // redraws every few seconds at most
        if (!was3d) view3d.refresh(); // it had no size while hidden
      }
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
      // Idle, the model view shows the last print: the file named in the "Last print" box.
      const last = showJob ? null : lastPrinted(s.files);
      const url = thumbUrl(entry || (last && last.file), ctx.base);
      thumb = url && !badThumbs.has(url) ? url : null;
      modelFile = entry || (showJob ? file : null) || (last && last.file) || null;

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
        const showLast = (ph === 'ready' || ph === 'heating') && !!last;
        show(r.lastBox, showLast);
        if (showLast) {
          setText(r.lastName, displayName(last.file));
          const ok = last.last.success;
          const time = last.last.printTime ? ` · ${fmtDuration(last.last.printTime)}` : '';
          const html = `<span style="color:var(--${ok ? 'signal-fg' : 'danger'})">${icon(ok ? 'check' : 'cross')}</span>${esc(fmtAgo(last.last.date) + time)}`;
          if (r.lastMeta._html !== html) { r.lastMeta._html = html; r.lastMeta.innerHTML = html; }
        }
      }

      renderStack(showJob ? pct : 0, meta.tone);
      renderMedia(s);
      renderActions(s, ph);
    }

    store.subscribe(render);
    render(store.get());

    return {
      onShow() { visible = true; render(store.get()); view3d.refresh(); },
      onHide() { visible = false; syncSnap(false); },
    };
  },
};
