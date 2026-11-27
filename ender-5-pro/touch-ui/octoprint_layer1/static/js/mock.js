// Demo mode: a simulated Ender 5 Pro so the UI can be tried in any browser
// without OctoPrint. Open index.html?demo (or ?demo=printing, paused,
// finished, heating, offline, error).

import { Emitter, ApiError } from './api.js';
import { demoGcode, demoZAt } from './mock-gcode.js';

const AMBIENT = 24;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ~~ heaters: a hotend heats in about a minute, the bed in a few; both cool slowly

const HEATER = {
  tool0: { rise: 3, cool: 0.006 },  // °C/s at most while heating; share of the gap lost per second
  bed: { rise: 0.3, cool: 0.003 },
};

/** One second of a heater moving toward `goal` (0 = off). */
function stepHeater(key, t, goal, noise = 0.3) {
  const h = HEATER[key];
  const on = goal > 0;
  if (on && t.actual < goal - 0.5) t.actual += Math.min(h.rise, (goal - t.actual) * 0.15); // heating
  else if (on && t.actual < goal + 1) t.actual += (goal - t.actual) * 0.3;               // holding
  else t.actual = Math.max(on ? goal : AMBIENT, t.actual + (AMBIENT - t.actual) * h.cool); // cooling
  t.actual += (Math.random() - 0.5) * noise;
}

// What the demo printer's heaters did in the last half hour, per scenario:
// [seconds ago, nozzle target, bed target, optional nozzle kick]. The kick is a part-fan
// blast that briefly pulls the nozzle down, as happens on bridges.
const TEMP_STORIES = {
  idle: [[1800, 0, 0], [1440, 200, 60], [960, 0, 0]],      // someone preheated, then switched off
  heating: [[1800, 0, 0], [48, 200, 60]],
  printing: [[1800, 205, 60], [1020, 205, 60, -3.5], [380, 205, 60, -2]],
  paused: [[1800, 205, 60], [1020, 205, 60, -3.5], [380, 205, 60, -2]],
  finished: [[1800, 205, 60], [260, 0, 0]],
  error: [[1800, 0, 0], [200, 200, 0], [70, 0, 0]],
  offline: [[1800, 0, 0]],
};

/** Half an hour of readings every 2 s, ending now; the last one is where the live demo carries on. */
function tempStory(scenario) {
  const story = TEMP_STORIES[scenario] || TEMP_STORIES.idle;
  const now = Date.now() / 1000;
  const [, noz0, bed0] = story[0];
  const t = {
    tool0: { actual: noz0 > 0 ? noz0 : AMBIENT, target: noz0 },
    bed: { actual: bed0 > 0 ? bed0 : AMBIENT, target: bed0 },
  };
  const out = [];
  let step = 0;
  for (let ago = 1800; ago >= 0; ago--) {
    while (step < story.length && story[step][0] >= ago) {
      const [, noz, bed, kick] = story[step++];
      t.tool0.target = noz;
      t.bed.target = bed;
      if (kick) t.tool0.actual += kick;
    }
    stepHeater('tool0', t.tool0, t.tool0.target);
    stepHeater('bed', t.bed, t.bed.target, 0.1);
    if (ago % 2 === 0) out.push({ time: now - ago, tool0: { ...t.tool0 }, bed: { ...t.bed } });
  }
  return out;
}

// ~~ print history: what History shows in the demo (newest last)

function makeHistory(files) {
  const now = Date.now() / 1000;
  const flat = [];
  const walk = (l) => l.forEach((f) => (f.type === 'folder' ? walk(f.children) : flat.push(f)));
  walk(files);
  const file = (name) => flat.find((f) => f.name === name) || { name, path: name };
  const runs = [
    ['Z_endstop_spacer.gcode', 'done', 30, 610],
    ['Fan_duct_v2.gcode', 'done', 24, 4380],  // since deleted: History can't print it again
    ['Spool_holder_Ender5.gcode', 'done', 13, 7710],
    ['Cable_chain_link_x12.gcode', 'cancelled', 12, 380],
    ['Raspberry_Pi_4_case_base.gcode', 'done', 8, 11530],
    ['Calibration_cube_20mm.gcode', 'done', 7, 2390],
    ['Calibration_cube_20mm.gcode', 'failed', 6, 840, 'Heating failed, system stopped! Heater_ID: 0'],
    ['Benchy_0.2mm_PLA_E5P.gcode', 'cancelled', 1.1, 260],
    ['Benchy_0.2mm_PLA_E5P.gcode', 'done', 1, 5232],
  ];
  return runs.map(([name, result, daysAgo, duration, error], i) => {
    const f = file(name);
    const entry = { id: i + 1, path: f.path, name: f.name, origin: 'local', end: now - daysAgo * 86400, duration, result };
    if (error) entry.error = error;
    return entry;
  });
}
const svgUri = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

// ~~ fake slicer thumbnails: tiny isometric models

function isoBox(x, y, z, w, d, h, hue, sat = 70) {
  const P = (px, py, pz) => `${(80 + (px - py) * 0.866).toFixed(1)},${(98 + (px + py) * 0.5 - pz).toFixed(1)}`;
  const x2 = x + w; const y2 = y + d; const z2 = z + h;
  return `<polygon points="${P(x, y2, z)} ${P(x2, y2, z)} ${P(x2, y2, z2)} ${P(x, y2, z2)}" fill="hsl(${hue} ${sat}% 34%)"/>
    <polygon points="${P(x2, y, z)} ${P(x2, y2, z)} ${P(x2, y2, z2)} ${P(x2, y, z2)}" fill="hsl(${hue} ${sat}% 46%)"/>
    <polygon points="${P(x, y, z2)} ${P(x2, y, z2)} ${P(x2, y2, z2)} ${P(x, y2, z2)}" fill="hsl(${hue} ${sat}% 62%)"/>`;
}

const MODELS = {
  boat: (h) => isoBox(-30, -16, 0, 60, 32, 18, h) + isoBox(-8, -12, 18, 26, 24, 22, h) + isoBox(4, -4, 40, 8, 8, 14, h),
  clip: (h) => isoBox(-40, -6, 0, 80, 12, 8, h) + isoBox(-40, -6, 8, 10, 12, 18, h) + isoBox(30, -6, 8, 10, 12, 18, h),
  cube: (h) => isoBox(-24, -24, 0, 48, 48, 48, h),
  case: (h) => isoBox(-44, -30, 0, 88, 60, 22, h) + isoBox(-40, -26, 22, 16, 10, 4, h, 20),
  spool: (h) => isoBox(-34, -10, 0, 68, 20, 10, h) + isoBox(-6, -10, 10, 12, 20, 48, h) + isoBox(-20, -10, 58, 40, 20, 8, h),
  chain: (h) => [0, 1, 2, 3].map((i) => isoBox(-46 + i * 23, -10, 0, 20, 20, 14, h)).join(''),
  knob: (h) => isoBox(-26, -26, 0, 52, 52, 10, h) + isoBox(-10, -10, 10, 20, 20, 16, h),
  spacer: (h) => isoBox(-20, -12, 0, 40, 24, 6, h) + isoBox(-20, -12, 6, 40, 24, 6, h, 40),
};

const thumb = (kind, hue) => svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160">${MODELS[kind](hue)}</svg>`);

const CAMERA = svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480">
  <defs><radialGradient id="g" cx="50%" cy="35%" r="75%"><stop offset="0" stop-color="#3a3632"/><stop offset="1" stop-color="#0d0c0b"/></radialGradient>
  <pattern id="p" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="11" cy="11" r="1.4" fill="#4a4741"/></pattern></defs>
  <rect width="640" height="480" fill="url(#g)"/>
  <polygon points="70,440 570,440 500,250 140,250" fill="#22201e"/><polygon points="70,440 570,440 500,250 140,250" fill="url(#p)"/>
  <polygon points="250,400 390,400 372,318 268,318" fill="#d9601d"/><polygon points="268,318 372,318 366,296 274,296" fill="#ff8a3d"/>
  <rect x="0" y="92" width="640" height="26" fill="#1a1918"/><rect x="288" y="118" width="64" height="86" rx="6" fill="#2b2a28"/>
  <polygon points="306,204 334,204 324,236 316,236" fill="#c8a24a"/><circle cx="320" cy="150" r="16" fill="#151413" stroke="#3a3836" stroke-width="3"/>
  <text x="18" y="462" font-family="monospace" font-size="16" fill="#8a857c">CAM 1 · demo</text></svg>`);

function makeFiles() {
  const now = Date.now() / 1000;
  const file = (name, est, len, hue, kind, ago, prints) => ({
    name, display: name, path: name, type: 'machinecode', typePath: ['machinecode', 'gcode'], origin: 'local',
    size: Math.round(len * 220), date: Math.round(now - ago),
    gcodeAnalysis: { estimatedPrintTime: est, filament: { tool0: { length: len, volume: len * 0.002405 } } },
    prints, thumbnail: thumb(kind, hue),
    demoKind: kind, // which demo G-code to make for the 3D view
  });
  const ok = (daysAgo, t) => ({ success: 1, failure: 0, last: { date: now - daysAgo * 86400, success: true, printTime: t } });
  return [
    file('Benchy_0.2mm_PLA_E5P.gcode', 5400, 5120, 20, 'boat', 7200, ok(1, 5232)),
    file('Filament_clip_x4_PETG.gcode', 1320, 1450, 200, 'clip', 1.5 * 86400, null),
    file('Calibration_cube_20mm.gcode', 2460, 2360, 140, 'cube', 6 * 86400,
      { success: 1, failure: 1, last: { date: now - 6 * 86400, success: false } }),
    file('Raspberry_Pi_4_case_base.gcode', 11200, 18400, 350, 'case', 9 * 86400, ok(8, 11530)),
    file('Spool_holder_Ender5.gcode', 7600, 9800, 45, 'spool', 14 * 86400, ok(13, 7710)),
    file('Cable_chain_link_x12.gcode', 3900, 4100, 265, 'chain', 20 * 86400, null),
    {
      name: 'Functional parts', display: 'Functional parts', path: 'Functional parts', type: 'folder', typePath: ['folder'], origin: 'local',
      children: [
        { ...file('Bed_level_knob_x4.gcode', 2900, 3300, 180, 'knob', 25 * 86400, null), path: 'Functional parts/Bed_level_knob_x4.gcode' },
        { ...file('Z_endstop_spacer.gcode', 600, 520, 0, 'spacer', 31 * 86400, ok(30, 610)), path: 'Functional parts/Z_endstop_spacer.gcode' },
      ],
    },
  ];
}

export const DEMO_CAMERA = CAMERA;

export class MockClient extends Emitter {
  constructor(cfg, scenario = 'idle') {
    super();
    this.cfg = cfg;
    this.base = './';
    this.fileList = makeFiles();
    this.historyList = makeHistory(this.fileList);
    // the heaters carry on from the last half hour's story (see TEMP_STORIES)
    this.tempLog = tempStory(scenario);
    const last = this.tempLog[this.tempLog.length - 1];
    this.t = { tool0: { ...last.tool0 }, bed: { ...last.bed } };
    this.state = 'operational';
    this.job = null;
    this.progress = null;
    this.speedup = 1;
    this.gcodes = new Map(); // path -> generated demo G-code
    const benchy = this.fileList[0];
    if (scenario === 'printing' || scenario === 'paused' || scenario === 'finished') {
      this._startJob(benchy, scenario === 'finished' ? 1 : 0.47);
      if (scenario === 'paused') this.state = 'paused';
      if (scenario === 'finished') this.state = 'operational';
    } else if (scenario === 'offline') {
      this.state = 'offline';
    } else if (scenario === 'error') {
      this.state = 'error';
    }
    this.scenario = scenario;
  }

  _flat() {
    const flat = [];
    const walk = (l) => l.forEach((f) => (f.type === 'folder' ? walk(f.children) : flat.push(f)));
    walk(this.fileList);
    return flat;
  }

  /** The demo G-code of a file, made on first use: { bytes, layers, height }. */
  _demoGcode(path) {
    if (!this.gcodes.has(path)) {
      const f = this._flat().find((x) => x.path === path);
      if (!f) return null;
      const g = demoGcode(f.demoKind);
      this.gcodes.set(path, { bytes: new TextEncoder().encode(g.text), layers: g.layers, height: g.height });
    }
    return this.gcodes.get(path);
  }

  _startJob(file, completion = 0) {
    this._demoGcode(file.path); // so progress can report a file position, like OctoPrint
    const est = file.gcodeAnalysis.estimatedPrintTime;
    this.job = { file: { name: file.name, display: file.display, path: file.path, origin: 'local', size: file.size, date: file.date }, estimatedPrintTime: est, filament: file.gcodeAnalysis.filament };
    this.progress = { completion: completion * 100, printTime: est * completion, printTimeLeft: est * (1 - completion), printTimeLeftOrigin: 'estimate' };
    this.state = 'printing';
  }

  _flags() {
    const s = this.state;
    return {
      operational: ['operational', 'printing', 'paused', 'cancelling'].includes(s),
      printing: s === 'printing', paused: s === 'paused', cancelling: s === 'cancelling',
      pausing: false, resuming: false, finishing: false,
      closedOrError: s === 'offline' || s === 'error', error: s === 'error',
      ready: s === 'operational',
    };
  }

  _status() {
    const text = { operational: 'Operational', printing: 'Printing', paused: 'Paused', cancelling: 'Cancelling', offline: 'Offline', error: 'Offline after error', linking: 'Connecting' }[this.state];
    // file position and height follow the demo G-code, so the 3D view and the numbers agree
    const g = this.job && this._demoGcode(this.job.file.path);
    const filepos = g && this.progress ? Math.round((this.progress.completion / 100) * g.bytes.length) : null;
    const z = this.progress && this.state !== 'operational' ? (g ? demoZAt(g, filepos) : 0.2 + (this.progress.completion / 100) * 47.8) : null;
    return {
      printer: { text, flags: this.state === 'linking' ? {} : this._flags(), error: this.state === 'error' ? 'Heating failed, system stopped! Heater_ID: 0' : '' },
      temps: JSON.parse(JSON.stringify(this.t)),
      job: this.job, progress: this.progress ? { ...this.progress, filepos } : null, currentZ: z,
    };
  }

  start() {
    this.emit('link', 'connecting');
    setTimeout(() => {
      this.emit('link', 'online');
      this.emit('temps', this.tempLog, true); // like OctoPrint's `history` message on connect
      if (this.state === 'printing' || this.state === 'paused') this.emit('logs', ['Send: N2041 M106 S178*86', 'Recv: ok']);
      this._tick();
      this.timer = setInterval(() => this._tick(), 1000);
    }, 250);
  }

  stop() { clearInterval(this.timer); }

  _tick() {
    const online = this.state !== 'offline' && this.state !== 'error';
    for (const [k, t] of Object.entries(this.t)) stepHeater(k, t, online ? t.target : 0, k === 'bed' ? 0.1 : 0.3);
    this.emit('temps', [{ time: Date.now() / 1000, tool0: { ...this.t.tool0 }, bed: { ...this.t.bed } }]);
    if (this.state === 'printing' && this.progress) {
      const est = this.job.estimatedPrintTime;
      const pct = Math.min(100, this.progress.completion + 0.02 * this.speedup);
      this.progress.completion = pct;
      this.progress.printTime = (est * pct) / 100;
      this.progress.printTimeLeft = Math.max(0, est * (1 - pct / 100));
      if (pct >= 100) {
        this.state = 'operational';
        this.progress.printTimeLeft = 0;
        this.t.tool0.target = 0; this.t.bed.target = 0;
        this._logPrint('done');
        this.emit('event', 'PrintDone', { name: this.job.file.name, path: this.job.file.path, origin: 'local', time: this.progress.printTime });
      }
    }
    this.emit('status', this._status());
  }

  async _ok(v) { await wait(120); return v; }
  _busy() { if (this.state !== 'operational') throw new ApiError(409, 'Printer Busy or Not Connected'); }

  files() { return this._ok({ files: this.fileList }); }

  async gcodeBuffer(file) {
    await wait(150);
    const g = this._demoGcode(file.path);
    if (!g) throw new ApiError(404, 'File not found');
    return g.bytes.slice().buffer; // a copy: the caller hands it to the worker
  }

  async printFile(origin, path) {
    this._busy();
    const f = this._flat().find((x) => x.path === path);
    if (!f) throw new ApiError(404, 'File not found');
    this._startJob(f, 0);
    this.t.tool0.target = 205; this.t.bed.target = 60;
    this.speedup = 25;
    this.emit('event', 'PrintStarted', { name: f.name, path: f.path });
    return this._ok(null);
  }

  async jog() { this._busy(); return this._ok(null); }
  async home() { this._busy(); return this._ok(null); }
  async setToolTemp(t) { this.t.tool0.target = t; return this._ok(null); }
  async setBedTemp(t) { this.t.bed.target = t; return this._ok(null); }
  async extrude() { this._busy(); return this._ok(null); }
  async feedrate(f) { this.emit('logs', [`Send: M220 S${f}`]); return this._ok(null); }
  async flowrate(f) { this.emit('logs', [`Send: M221 S${f}`]); return this._ok(null); }

  async gcode(commands) {
    const pos = this.pos || (this.pos = { x: 0, y: 0, z: 0 }); // so M114 can answer, as after M400
    let homing = false;
    let report = false;
    for (const c of [].concat(commands)) {
      const m = /^(M10[49]|M140|M190)\s+S(\d+)/i.exec(c);
      if (m) { if (/M1(04|09)/i.test(m[1])) this.t.tool0.target = +m[2]; else this.t.bed.target = +m[2]; }
      if (/^G28\b/i.test(c)) { homing = true; Object.assign(pos, { x: 0, y: 0, z: 0 }); }
      if (/^G[01]\b/i.test(c)) for (const [, axis, v] of c.matchAll(/\b([XYZ])(-?[\d.]+)/gi)) pos[axis.toLowerCase()] = +v;
      if (/^M114\b/i.test(c)) report = true;
    }
    this.emit('logs', [].concat(commands).map((c) => `Send: ${c}`));
    if (report) {
      const line = `Recv: X:${pos.x.toFixed(2)} Y:${pos.y.toFixed(2)} Z:${pos.z.toFixed(2)} E:0.00 Count X:0 Y:0 Z:0`;
      setTimeout(() => this.emit('logs', [line, 'Recv: ok']), homing ? 5000 : 1800);
    }
    return this._ok(null);
  }

  async pause() { if (this.state === 'printing') { this.state = 'paused'; this.emit('event', 'PrintPaused', {}); } return this._ok(null); }
  async resume() { if (this.state === 'paused') { this.state = 'printing'; this.emit('event', 'PrintResumed', {}); } return this._ok(null); }

  async cancel() {
    this.state = 'cancelling';
    setTimeout(() => {
      this.state = 'operational';
      this.t.tool0.target = 0; this.t.bed.target = 0;
      this._logPrint('cancelled');
      this.emit('event', 'PrintCancelled', {});
    }, 1500);
    return this._ok(null);
  }

  /** The print that just ended, into the demo's History (like the plugin's history.py). */
  _logPrint(result) {
    if (!this.job) return;
    const f = this.job.file;
    const id = this.historyList.reduce((m, e) => Math.max(m, e.id), 0) + 1;
    // a demo print runs sped up: log the time it would have taken
    this.historyList.push({ id, path: f.path, name: f.name, origin: 'local', end: Date.now() / 1000, duration: this.progress ? this.progress.printTime : null, result });
  }

  history(limit = 100) {
    const all = this.historyList.slice().reverse();
    const results = { done: 0, failed: 0, cancelled: 0, unfinished: 0 };
    let seconds = 0;
    for (const e of all) { results[e.result]++; seconds += e.duration || 0; }
    return this._ok({ entries: all.slice(0, limit), total: all.length, stats: { prints: all.length, seconds: Math.round(seconds), results } });
  }

  connection() {
    return this._ok({
      current: { state: this._status().printer.text, port: '/dev/ttyUSB0', baudrate: 115200, printerProfile: 'ender5pro' },
      options: { printerProfiles: [{ id: 'ender5pro', name: 'Creality Ender 5 Pro' }] },
    });
  }

  async connect() {
    this.state = 'linking';
    setTimeout(() => { this.state = 'operational'; this.emit('event', 'Connected', {}); }, 2000);
    return this._ok(null);
  }

  async disconnect() { this.state = 'offline'; this.emit('event', 'Disconnected', {}); return this._ok(null); }

  systemCommands() {
    return this._ok([
      { action: 'restart', name: 'Restart OctoPrint' },
      { action: 'reboot', name: 'Reboot system' },
      { action: 'shutdown', name: 'Shutdown system' },
    ]);
  }

  system() { return this._ok(null); }
  version() { return this._ok({ server: '1.11.3', text: 'OctoPrint 1.11.3 (demo)' }); }

  sysinfo() {
    const busy = this.state === 'printing';
    return this._ok({
      model: 'Raspberry Pi 4 Model B Rev 1.4',
      cpuTemp: (busy ? 54 : 47) + Math.round(Math.random() * 20) / 10,
      throttled: 0,
      load: [busy ? 0.62 : 0.18, 0.4, 0.31],
      cores: 4,
      mem: { total: 1945 * 1048576, available: 1310 * 1048576 },
      disk: { total: 29.1 * 1073741824, free: 18.4 * 1073741824 },
      uptime: 3 * 86400 + 4 * 3600 + 17 * 60,
      net: {
        hostname: 'octopi', ip: '192.168.1.42', iface: 'wlan0', wifi: true, signal: -58, ssid: 'Workshop', freq: 5180,
        ethernet: { iface: 'eth0', connected: false, ip: null, speed: null },
      },
    });
  }
}
