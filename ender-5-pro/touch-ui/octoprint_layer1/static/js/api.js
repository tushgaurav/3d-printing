// OctoPrint client: REST + push socket.
//
// Live updates come over OctoPrint's SockJS endpoint. We speak the SockJS
// websocket transport directly (it is a tiny framing protocol) so no client
// library is needed. If the socket is down or silent, REST polling keeps the
// screen alive until it recovers.

import { sleep } from './util.js';

export const APP_NAME = 'Layer1';

export class Emitter {
  constructor() { this._handlers = {}; }
  on(type, fn) { (this._handlers[type] ||= []).push(fn); return () => this.off(type, fn); }
  off(type, fn) { this._handlers[type] = (this._handlers[type] || []).filter((f) => f !== fn); }
  emit(type, ...args) {
    for (const fn of (this._handlers[type] || []).slice()) {
      // rethrow async so a broken listener reaches window.onerror (shown on screen) without stopping the others
      try { fn(...args); } catch (e) { setTimeout(() => { throw e; }); }
    }
  }
}

export class ApiError extends Error {
  constructor(status, message, body) { super(message); this.status = status; this.body = body; }
}

const pickTemp = (t) => (t ? { actual: t.actual ?? null, target: t.target ?? null } : { actual: null, target: null });
const encPath = (p) => String(p).split('/').map(encodeURIComponent).join('/');

/** Push-API `current`/`history` payload -> partial app status. */
export function normalizeCurrent(c) {
  const out = {};
  if (c.state) out.printer = { text: c.state.text || '', flags: c.state.flags || {}, error: c.state.error || '' };
  if ('job' in c) out.job = c.job || null;
  if ('progress' in c) out.progress = c.progress || null;
  if ('currentZ' in c) out.currentZ = c.currentZ;
  if (Array.isArray(c.temps) && c.temps.length) {
    const t = c.temps[c.temps.length - 1];
    out.temps = { tool0: pickTemp(t.tool0), bed: pickTemp(t.bed) };
  }
  return out;
}

export class OctoClient extends Emitter {
  /** base: OctoPrint root path ending in "/", apiKey: application key */
  constructor({ base = '/', apiKey, throttle = 2 }) {
    super();
    this.base = base;
    this.apiKey = apiKey;
    this.throttle = throttle;
    this.link = null;
    this.ws = null;
    this.socketLive = false;
    this.lastSocketData = 0;
    this.retry = 0;
    this.stopped = true;
  }

  setLink(v) {
    if (this.link === v) return;
    this.link = v;
    this.emit('link', v);
  }

  async request(method, path, body) {
    const headers = { 'X-Api-Key': this.apiKey };
    const init = { method, headers, cache: 'no-store' };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch(this.base + path, init);
    } catch (e) {
      throw new ApiError(0, 'Cannot Reach OctoPrint');
    }
    const text = await res.text();
    let data = null;
    if (text) { try { data = JSON.parse(text); } catch { data = text; } }
    if (!res.ok) {
      let msg = (data && typeof data === 'object' && (data.error || data.message)) || '';
      if (!msg && typeof data === 'string') msg = data.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
      throw new ApiError(res.status, msg || `${res.status} ${res.statusText}`, data);
    }
    return data;
  }

  get(path) { return this.request('GET', path); }
  post(path, body = {}) { return this.request('POST', path, body); }

  // ~~ lifecycle

  start() {
    this.stopped = false;
    this.setLink('connecting');
    this._loginAndConnect();
    this._pollLoop();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this._reconnectTimer);
    if (this.ws) { const ws = this.ws; this.ws = null; try { ws.close(); } catch { /* ignore */ } }
  }

  async _loginAndConnect() {
    while (!this.stopped) {
      try {
        const user = await this.post('api/login', { passive: true });
        if (!user || !user.name) { this.setLink('unauthorized'); return; }
        this.user = user.name;
        this.session = user.session;
        if (this.session) this._openSocket();
        return; // no session: REST polling carries on alone
      } catch (e) {
        if (e.status === 0) this.setLink('offline');
        else if ([400, 401, 403].includes(e.status) && (await this._keyRejected())) { this.setLink('unauthorized'); return; }
        await sleep(3000);
      }
    }
  }

  /**
   * Is our key really gone? OctoPrint answers a revoked key with 403 on GETs and,
   * since 2.0, with 400 "CSRF validation failed" on POSTs (an unknown key falls
   * back to cookie auth, which then fails the CSRF check). Confirm with a GET
   * twice, 3 s apart, so a hiccup while OctoPrint restarts never forces a re-pair.
   */
  async _keyRejected() {
    for (let i = 0; i < 2; i++) {
      if (i) await sleep(3000);
      try {
        await this.get('api/job');
        return false;
      } catch (e) {
        if (e.status !== 401 && e.status !== 403) return false;
      }
    }
    return true;
  }

  _openSocket() {
    if (this.stopped) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const server = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
    const sid = Math.random().toString(36).slice(2, 10);
    let ws;
    try {
      ws = new WebSocket(`${proto}//${location.host}${this.base}sockjs/${server}/${sid}/websocket`);
    } catch (e) {
      this._scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onmessage = (ev) => this._onFrame(ev.data);
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.socketLive = false;
      this._scheduleReconnect();
    };
  }

  _scheduleReconnect() {
    if (this.stopped) return;
    const delay = Math.min(15000, 1000 * 2 ** this.retry);
    this.retry = Math.min(this.retry + 1, 4);
    clearTimeout(this._reconnectTimer);
    this._reconnectTimer = setTimeout(() => this._loginAndConnect(), delay);
  }

  _send(obj) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify([JSON.stringify(obj)]));
  }

  // SockJS frames: o = open, h = heartbeat, a[...] = messages, m"..." = single message, c[...] = close
  _onFrame(data) {
    if (typeof data !== 'string' || !data) return;
    const kind = data[0];
    if (kind === 'o') {
      // subscribe before auth so we never receive unfiltered data
      this._send({ subscribe: { state: { logs: true, messages: false }, events: true, plugins: false } });
      this._send({ throttle: this.throttle });
      this._send({ auth: `${this.user}:${this.session}` });
    } else if (kind === 'a' || kind === 'm') {
      let items;
      try { items = JSON.parse(data.slice(1)); } catch { return; }
      if (kind === 'm') items = [items];
      for (let msg of items) {
        if (typeof msg === 'string') { try { msg = JSON.parse(msg); } catch { continue; } }
        if (msg && typeof msg === 'object') this._onMessage(msg);
      }
    } else if (kind === 'c') {
      try { this.ws && this.ws.close(); } catch { /* ignore */ }
    }
  }

  _onMessage(msg) {
    for (const [type, payload] of Object.entries(msg)) {
      if (type === 'current' || type === 'history') {
        this.socketLive = true;
        this.lastSocketData = Date.now();
        this.retry = 0;
        this.setLink('online');
        this.emit('status', normalizeCurrent(payload || {}));
        if (payload && Array.isArray(payload.logs) && payload.logs.length) this.emit('logs', payload.logs);
      } else if (type === 'event' && payload) {
        this.emit('event', payload.type, payload.payload || {});
      } else if (type === 'connected') {
        this.emit('connected', payload || {});
      } else if (type === 'reauthRequired') {
        try { this.ws && this.ws.close(); } catch { /* ignore */ }
      }
    }
  }

  async _pollLoop() {
    while (!this.stopped) {
      const socketFresh = this.socketLive && Date.now() - this.lastSocketData < 6000;
      if (!socketFresh && this.link !== 'unauthorized') {
        try {
          await this.pollOnce();
        } catch (e) {
          if ((e.status === 401 || e.status === 403) && (await this._keyRejected())) this.setLink('unauthorized');
          else if (e.status === 0 || e.status >= 500) this.setLink('offline');
        }
      }
      await sleep(socketFresh ? 3000 : 2000);
    }
  }

  async pollOnce() {
    const [printer, job] = await Promise.all([
      this.get('api/printer?exclude=sd').catch((e) => { if (e.status === 409) return null; throw e; }),
      this.get('api/job'),
    ]);
    const out = { job: (job && job.job) || null, progress: (job && job.progress) || null };
    if (printer) {
      const st = printer.state || {};
      out.printer = { text: st.text || (job && job.state) || '', flags: st.flags || {}, error: st.error || '' };
      const t = printer.temperature || {};
      out.temps = { tool0: pickTemp(t.tool0), bed: pickTemp(t.bed) };
    } else {
      // 409 = printer not operational; /api/job still carries the state text
      const text = (job && job.state) || 'Offline';
      const connecting = /connect|detect|open/i.test(text);
      out.printer = { text, flags: connecting ? {} : { closedOrError: true, error: /error/i.test(text) }, error: (job && job.error) || '' };
      out.temps = { tool0: pickTemp(null), bed: pickTemp(null) };
    }
    this.setLink('online');
    this.emit('status', out);
  }

  // ~~ commands

  files() { return this.get('api/files?recursive=true'); }

  /** Raw G-code of a file in OctoPrint's local storage, for the 3D view. */
  async gcodeBuffer(file) {
    const origin = file.origin || 'local';
    if (origin !== 'local') throw new ApiError(400, 'Only files stored in OctoPrint can be shown in 3D');
    let res;
    try {
      res = await fetch(`${this.base}downloads/files/${encodeURIComponent(origin)}/${encPath(file.path)}`, { headers: { 'X-Api-Key': this.apiKey } });
    } catch (e) {
      throw new ApiError(0, 'Cannot Reach OctoPrint');
    }
    if (!res.ok) throw new ApiError(res.status, `G-code download failed (${res.status})`);
    return res.arrayBuffer();
  }
  printFile(origin, path) { return this.post(`api/files/${encodeURIComponent(origin)}/${encPath(path)}`, { command: 'select', print: true }); }
  jog(axes) { return this.post('api/printer/printhead', { command: 'jog', ...axes }); }
  home(axes) { return this.post('api/printer/printhead', { command: 'home', axes }); }
  setToolTemp(t) { return this.post('api/printer/tool', { command: 'target', targets: { tool0: t } }); }
  setBedTemp(t) { return this.post('api/printer/bed', { command: 'target', target: t }); }
  extrude(mm) { return this.post('api/printer/tool', { command: 'extrude', amount: mm }); }
  feedrate(factor) { return this.post('api/printer/printhead', { command: 'feedrate', factor }); }
  flowrate(factor) { return this.post('api/printer/tool', { command: 'flowrate', factor }); }
  gcode(commands) { return this.post('api/printer/command', { commands: [].concat(commands) }); }
  pause() { return this.post('api/job', { command: 'pause', action: 'pause' }); }
  resume() { return this.post('api/job', { command: 'pause', action: 'resume' }); }
  cancel() { return this.post('api/job', { command: 'cancel' }); }
  connection() { return this.get('api/connection'); }
  connect() { return this.post('api/connection', { command: 'connect' }); }
  disconnect() { return this.post('api/connection', { command: 'disconnect' }); }
  systemCommands() { return this.get('api/system/commands/core'); }
  system(action) { return this.post(`api/system/commands/core/${encodeURIComponent(action)}`); }
  version() { return this.get('api/version'); }
  /** Pi health from this plugin (CPU temperature, power, network, disk): see sysinfo.py. */
  sysinfo() { return this.get('plugin/layer1/sysinfo'); }
}

// ~~ pairing via OctoPrint's Application Keys workflow

/** 'ok' | 'missing' (plugin disabled/absent) | 'unreachable' (OctoPrint down) */
export async function probeAppKeys(base) {
  try {
    const r = await fetch(base + 'plugin/appkeys/probe', { cache: 'no-store' });
    return r.status === 204 ? 'ok' : 'missing';
  } catch {
    return 'unreachable';
  }
}

/** Ask OctoPrint for a key; resolves once someone clicks "Allow" in OctoPrint. */
export async function requestAppKey(base, { signal } = {}) {
  const r = await fetch(base + 'plugin/appkeys/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app: APP_NAME }),
    cache: 'no-store',
  });
  if (!r.ok) throw new Error(`OctoPrint refused the request (${r.status})`);
  const token = (await r.json()).app_token;
  if (!token) throw new Error('OctoPrint did not return a request token');

  // OctoPrint drops the request if it isn't polled for 5 s, so poll every second.
  while (!(signal && signal.aborted)) {
    await sleep(1000);
    let p;
    try {
      p = await fetch(base + 'plugin/appkeys/request/' + encodeURIComponent(token), { cache: 'no-store' });
    } catch {
      continue;
    }
    if (p.status === 202) continue;
    if (p.status === 200) {
      const key = (await p.json()).api_key;
      if (key) return key;
      throw new Error('OctoPrint approved but sent no key');
    }
    if (p.status === 404) {
      const e = new Error('The request was denied or expired');
      e.denied = true;
      throw e;
    }
    throw new Error(`Unexpected response ${p.status}`);
  }
  throw new Error('aborted');
}
