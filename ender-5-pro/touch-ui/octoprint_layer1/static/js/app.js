// Boot: load config, pair if needed, start the OctoPrint client, build the
// rail + status bar + screens, and route events into one small store.
//
// URL options
//   ?demo[=printing|paused|finished|heating|offline|error]  simulated printer
//   ?page=files|heat|move|more|calibrate|pair               open a screen at start
//   ?sheet=tune|filament|printer|system|display|phone|quick open a sheet at start (quick = the status bar's quick info)
//   ?theme=light|dark  or  #theme=…                         default theme (a choice saved on the screen wins)
//   #key=…&tm=…&host=…&kiosk=1                              passed in by the kiosk launcher
//   #desktop=1                                              a desktop is underneath: System offers "Exit to Desktop"

import { OctoClient } from './api.js';
import { MockClient, DEMO_CAMERA } from './mock.js';
import { icon } from './icons.js';
import { logo } from './logo.js';
import { refs, setText, toggle, setData, deepMerge, debounce, fmtTemp, fmtClock, fmtDuration, setClock24 } from './util.js';
import { PHASES, ACTIVE, phaseOf } from './model.js';
import { initUI, toast, closeSheets, setScale } from './ui.js';
import { loadKey, saveKey, forgetKey, storedTheme, applyTheme } from './session.js';
import home from './screens/home.js';
import files from './screens/files.js';
import heat from './screens/heat.js';
import move from './screens/move.js';
import more from './screens/more.js';
import { showPairing } from './sheets/pair.js';
import { openCalibration } from './sheets/calibrate.js';
import { openTune } from './sheets/tune.js';
import { openFilament } from './sheets/filament.js';
import { openPrinter } from './sheets/printer.js';
import { openSystem } from './sheets/system.js';
import { openDisplay } from './sheets/display.js';
import { openPhone } from './sheets/phone.js';
import { openFileDetail } from './sheets/file.js';
import { openQuickInfo, toggleQuickInfo, closeQuickInfo } from './sheets/quickinfo.js';
import { openLiveCamera } from './sheets/camera.js';
import { numberPad } from './ui.js';

const SCREENS = [home, files, heat, move, more];
const SHEETS = { tune: openTune, filament: openFilament, printer: openPrinter, system: openSystem, display: openDisplay, phone: openPhone, quick: openQuickInfo };

let lastError = '';
function showError(e) {
  const msg = `Error: ${(e && e.message) || e}`;
  if (msg === lastError) return; // a broken render repeats every second; say it once
  lastError = msg;
  toast(msg, 'danger', 10000);
}

function createStore(initial) {
  let state = initial;
  const subs = new Set();
  return {
    get: () => state,
    set(patch) {
      state = { ...state, ...patch };
      for (const fn of [...subs]) {
        try { fn(state); } catch (e) { console.error(e); showError(e); }
      }
    },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
}

function computeBase() {
  const i = location.pathname.indexOf('/plugin/layer1/');
  return i >= 0 ? location.pathname.slice(0, i + 1) : '/';
}

async function loadConfig(demo) {
  const defaults = await fetch('defaults.json', { cache: 'no-store' }).then((r) => r.json());
  if (demo) return defaults;
  try {
    const r = await fetch('../config', { cache: 'no-store' });
    if (r.ok) return deepMerge(defaults, await r.json());
  } catch { /* plugin route missing: fall back to defaults */ }
  return defaults;
}

function parseMatrix(text) {
  if (!text) return null;
  const m = text.split(/[\s,]+/).map(Number);
  return m.length === 9 && m.every(Number.isFinite) ? m : null;
}

/** 480x320 shows 1:1. Anything else (a desktop preview) gets a scaled "device". */
function fitStage(kiosk) {
  const app = document.getElementById('app');
  // Chromium won't make a window narrower than 500px, so on a 480px-wide screen the
  // kiosk viewport is wider than the screen. Fit to the visible screen and pin to its
  // top-left, rather than centring in the (partly off-screen) window.
  const w = kiosk ? Math.min(innerWidth, screen.width || innerWidth) : innerWidth;
  const h = kiosk ? Math.min(innerHeight, screen.height || innerHeight) : innerHeight;
  const fit = Math.min(w / 480, h / 320);
  const exact = Math.abs(fit - 1) < 0.05;
  const scale = exact ? 1 : kiosk ? fit : Math.max(0.5, Math.min(3, Math.floor(fit * 0.9 * 10) / 10));
  document.body.classList.toggle('preview', !exact && !kiosk);
  document.body.classList.toggle('kiosk', kiosk);
  if (kiosk) {
    const x = Math.max(0, Math.round((w - 480 * scale) / 2));
    const y = Math.max(0, Math.round((h - 320 * scale) / 2));
    app.style.transform = x || y || scale !== 1 ? `translate(${x}px, ${y}px) scale(${scale})` : '';
  } else {
    app.style.transform = scale === 1 ? '' : `scale(${scale})`;
  }
  setScale(scale);
}

const LOG_RE = /^(?:Send:|>>>)\s*(?:N\d+\s+)?(M106|M107|M220|M221)\b([^*;]*)/i;

function logPatch(lines) {
  const patch = {};
  for (const line of lines) {
    const m = LOG_RE.exec(String(line));
    if (!m) continue;
    const cmd = m[1].toUpperCase();
    const s = /\bS(\d+(?:\.\d+)?)/i.exec(m[2]);
    const p = /\bP(\d+)/i.exec(m[2]);
    if (p && p[1] !== '0') continue; // only the part-cooling fan
    if (cmd === 'M107') patch.fan = 0;
    else if (cmd === 'M106') patch.fan = s ? Math.round((Math.min(255, +s[1]) / 255) * 100) : 100;
    else if (cmd === 'M220' && s) patch.feed = Math.round(+s[1]);
    else if (cmd === 'M221' && s) patch.flow = Math.round(+s[1]);
  }
  return patch;
}

function buildStatusBar(el, ctx) {
  el.innerHTML = `
    ${logo()}
    <div class="pill" data-r="pill"><i></i><span data-r="pillText"></span></div>
    <div class="grow"></div>
    <div class="tchip" data-r="noz">${icon('nozzle')}<span class="t" data-r="nozA">—</span><span class="tg" data-r="nozT"></span></div>
    <div class="tchip" data-r="bed">${icon('bed')}<span class="t" data-r="bedA">—</span><span class="tg" data-r="bedT"></span></div>
    <div id="clock" data-r="clock"></div>`;
  // the whole bar is one big button: tap it for quick info, tap again to close
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', 'Quick info');
  el.addEventListener('click', () => toggleQuickInfo(ctx));
  const r = refs(el);
  const chip = (key, box, a, t, s) => {
    const v = (s.temps && s.temps[key]) || {};
    setText(a, `${fmtTemp(v.actual)}°`);
    setText(t, v.target > 0 ? `/${Math.round(v.target)}` : '');
    toggle(box, 'heating', v.target > 0 && v.actual != null && v.actual < v.target - 3);
    toggle(box, 'hot', v.target > 0 && v.actual != null && v.actual >= v.target - 3);
  };
  const render = (s) => {
    const ph = phaseOf(s);
    const meta = PHASES[ph];
    const pct = ACTIVE.has(ph) && s.progress ? ` ${Math.floor(s.progress.completion || 0)}%` : '';
    setText(r.pillText, meta.label + pct);
    setData(r.pill, 'tone', meta.tone);
    chip('tool0', r.noz, r.nozA, r.nozT, s);
    chip('bed', r.bed, r.bedA, r.bedT, s);
  };
  const tick = () => setText(r.clock, fmtClock(new Date()));
  tick();
  setInterval(tick, 10000);
  ctx.store.subscribe(render);
  render(ctx.store.get());
}

async function boot() {
  const app = document.getElementById('app');
  const query = new URLSearchParams(location.search);
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const demo = query.has('demo') ? query.get('demo') || 'idle' : null;
  const kiosk = hash.get('kiosk') === '1';

  // A key handed over by the kiosk launcher is stored, then removed from the URL,
  // and so is a one-shot start page (so "Reload Screen" doesn't reopen it).
  const page = query.get('page') || hash.get('page');
  if (hash.get('key')) saveKey(hash.get('key'));
  if (hash.has('key') || hash.has('page')) {
    hash.delete('key');
    hash.delete('page');
    const rest = hash.toString();
    history.replaceState(null, '', location.pathname + location.search + (rest ? `#${rest}` : ''));
  }

  fitStage(kiosk);
  window.addEventListener('resize', () => fitStage(kiosk));

  const cfg = await loadConfig(!!demo);
  if (demo) cfg.webcam = { ...cfg.webcam, enabled: true, snapshot: DEMO_CAMERA, stream: DEMO_CAMERA };
  setClock24(cfg.ui.clock24);
  // Theme: choice saved on this screen > ?theme= / #theme= > config default.
  applyTheme(storedTheme() || query.get('theme') || hash.get('theme') || cfg.ui.theme);

  const loopback = /^(127\.|localhost$|\[?::1\]?$)/.test(location.hostname);
  const store = createStore({
    link: 'connecting',
    printer: { text: '', flags: {}, error: '' },
    temps: { tool0: { actual: null, target: null }, bed: { actual: null, target: null } },
    job: null,
    progress: null,
    currentZ: null,
    fan: null,
    feed: 100,
    flow: 100,
    files: null,
    filesError: null,
    dismissedJob: null,
  });

  let filesAt = 0;
  let filesLoading = null;
  const ctx = {
    store,
    cfg,
    demo,
    base: computeBase(),
    host: hash.get('host') || (loopback ? 'octopi.local' : location.host),
    loopback, // the page came from 127.0.0.1: other devices need ctx.host or the Pi's IP
    // The launcher says there is a desktop underneath (#desktop=1), so offer "Exit to Desktop".
    desktop: hash.get('desktop') === '1',
    touchMatrix: parseMatrix(hash.get('tm')),
    client: null,
    go: null,
    refreshFiles() {
      if (!ctx.client) return Promise.resolve();
      if (!filesLoading) {
        filesLoading = ctx.client.files()
          .then((res) => { filesAt = Date.now(); store.set({ files: (res && res.files) || [], filesError: null }); })
          .catch((e) => { store.set({ filesError: e.message }); })
          .finally(() => { filesLoading = null; });
      }
      return filesLoading;
    },
    filesAge: () => Date.now() - filesAt,
  };
  const refreshFilesSoon = debounce(() => ctx.refreshFiles(), 800);
  document.title = `Layer1 · ${cfg.printer.name}`;

  // ~~ shell

  initUI(app);
  const rail = app.querySelector('#rail');
  rail.innerHTML = `${SCREENS.map((s) => `<button data-nav="${s.id}" aria-label="${s.title}">${icon(s.icon)}</button>`).join('')}`;
  buildStatusBar(app.querySelector('#status'), ctx);

  const screensEl = app.querySelector('#screens');
  const mounted = {};
  for (const screen of SCREENS) {
    const el = document.createElement('section');
    el.className = 'screen';
    el.dataset.screen = screen.id;
    screensEl.appendChild(el);
    mounted[screen.id] = { el, hooks: screen.mount(el, ctx) || {} };
  }

  let current = null;
  ctx.go = (id) => {
    closeSheets();
    closeQuickInfo();
    if (id === current || !mounted[id]) return;
    if (current) {
      mounted[current].el.classList.remove('active');
      if (mounted[current].hooks.onHide) mounted[current].hooks.onHide();
    }
    current = id;
    mounted[id].el.classList.add('active');
    rail.querySelectorAll('[data-nav]').forEach((b) => toggle(b, 'active', b.dataset.nav === id));
    if (mounted[id].hooks.onShow) mounted[id].hooks.onShow();
  };
  rail.addEventListener('click', (e) => {
    const b = e.target.closest('[data-nav]');
    if (b) ctx.go(b.dataset.nav);
  });
  ctx.go('home');
  app.classList.remove('booting');

  // ~~ client

  function startClient(key) {
    const client = demo ? new MockClient(cfg, demo) : new OctoClient({ base: ctx.base, apiKey: key, throttle: cfg.ui.socketThrottle });
    ctx.client = client;
    client.on('link', (link) => {
      store.set({ link });
      if (link === 'online' && !filesAt) ctx.refreshFiles();
      if (link === 'unauthorized' && !demo) {
        client.stop();
        forgetKey();
        toast('Screen Key Rejected · Pair Again', 'warn', 6000, 'link');
        pairThenStart();
      }
    });
    client.on('status', (st) => store.set(st));
    client.on('logs', (lines) => {
      const patch = logPatch(lines);
      if (Object.keys(patch).length) store.set(patch);
    });
    client.on('event', (type, payload) => {
      switch (type) {
        case 'PrintStarted':
          store.set({ feed: 100, flow: 100, dismissedJob: null });
          refreshFilesSoon();
          break;
        case 'PrintDone':
          toast(`Print Finished · ${fmtDuration(payload.time)}`, 'ok', 8000);
          refreshFilesSoon();
          break;
        case 'PrintFailed':
          toast(`Print Failed${payload.reason ? ` · ${payload.reason}` : ''}`, 'danger', 8000, 'cross');
          refreshFilesSoon();
          break;
        case 'PrintCancelled': toast('Print Stopped', 'warn', 3500, 'stop'); refreshFilesSoon(); break;
        case 'PrintPaused': toast('Print Paused', 'warn', 3500, 'pause'); break;
        case 'PrintResumed': toast('Print Resumed', 'accent', 3500, 'play'); break;
        case 'Connected': toast('Printer Connected', 'ok', 3500, 'plug'); break;
        case 'Disconnected': toast('Printer Disconnected', 'warn', 3500, 'unplug'); break;
        case 'Error': toast(payload.error || 'Printer Error', 'danger', 10000); break;
        case 'UpdatedFiles':
        case 'FileAdded':
        case 'FileRemoved':
        case 'MetadataAnalysisFinished':
          refreshFilesSoon();
          break;
        default:
      }
    });
    client.start();
  }

  function pairThenStart() {
    showPairing(ctx).then((key) => {
      saveKey(key);
      toast('Paired with OctoPrint', 'ok', 3500, 'link');
      startClient(key);
    });
  }

  if (demo) {
    startClient('demo');
    if (page === 'pair') showPairing(ctx, { demo: true });
  } else {
    const key = loadKey();
    if (key) startClient(key);
    else pairThenStart();
  }

  if (page && mounted[page]) ctx.go(page);
  if (page === 'calibrate') openCalibration(ctx);
  const sheet = query.get('sheet');
  if (sheet && SHEETS[sheet]) SHEETS[sheet](ctx);
  if (demo) demoExtras(ctx, sheet);
}

// Demo-only shortcuts so every view can be previewed straight from a URL.
function demoExtras(ctx, sheet) {
  if (sheet === 'camera') setTimeout(() => openLiveCamera(ctx), 400);
  if (sheet === 'keypad') numberPad({ title: 'Nozzle target', value: 205, max: ctx.cfg.limits.nozzleMax });
  if (sheet === 'file') {
    const unsub = ctx.store.subscribe((s) => {
      if (!s.files) return;
      unsub();
      openFileDetail(ctx, s.files.find((f) => f.type !== 'folder'));
    });
  }
}

window.addEventListener('error', (e) => showError(e.error || e.message));
window.addEventListener('unhandledrejection', (e) => showError(e.reason));
document.addEventListener('contextmenu', (e) => e.preventDefault());

boot().catch((e) => {
  const t = document.querySelector('.boot-text');
  if (t) t.textContent = `Couldn’t start: ${e.message}`;
  console.error(e);
});

