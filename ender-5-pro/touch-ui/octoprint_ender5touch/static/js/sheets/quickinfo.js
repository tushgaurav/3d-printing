// Quick info: tap the status bar for one page that answers "how is everything?" at a
// glance. A gauge cluster on top (job ring, nozzle and bed dials), then one plate with
// fan/speed/flow/Z and the printer, network and Pi underneath. Nothing on it is a
// control, so a tap anywhere on it (or on the bar again) closes it. It also closes itself
// after cfg.ui.quickInfoSeconds (0 = stays open).

import { icon } from '../icons.js';
import { refs, setText, setHTML, setData, toggle, clamp, fmtTemp, fmtDuration, fmtClock, fmtAgo, displayName } from '../util.js';
import { PHASES, ACTIVE, phaseOf, lastPrinted } from '../model.js';
import { mount } from '../ui.js';

const SYS_POLL_MS = 5000;
const WARM = 40; // °C: a heater that is off but still above this shows "Cooling"
const DIAL_SWEEP = 75; // the dials are 270° arcs: 75 of the circle's pathLength of 100

// vcgencmd get_throttled bits
const UNDERVOLT_NOW = 1 << 0;
const CAPPED_NOW = 1 << 1;
const THROTTLED_NOW = 1 << 2;
const SOFT_LIMIT_NOW = 1 << 3;
const UNDERVOLT_SEEN = 1 << 16;

// what sits in the middle of the job ring when there is no percentage to show
const PHASE_GLYPH = {
  ready: 'printer', heating: 'flame', finished: 'check', error: 'alert', disconnected: 'unplug',
  linking: 'plug', connecting: 'plug', offline: 'link', unauthorized: 'link',
};

let current = null;

export function closeQuickInfo() {
  if (current) current.close();
}

export function toggleQuickInfo(ctx) {
  if (current) current.close();
  else openQuickInfo(ctx);
}

const gb = (n) => `${(n / 1073741824).toFixed(1)} GB`;

function wifiWord(dbm) {
  if (dbm == null) return '';
  if (dbm >= -55) return 'Excellent';
  if (dbm >= -67) return 'Good';
  if (dbm >= -75) return 'Fair';
  return 'Weak';
}

/** CPU temperature + throttle bits -> { tone, power } for the Pi cell. */
export function piHealth(temp, bits) {
  const b = bits || 0;
  let power = bits == null ? '' : 'Power OK';
  let tone = 'ok';
  if (b & UNDERVOLT_NOW) { power = 'Under-voltage!'; tone = 'danger'; }
  else if (b & (THROTTLED_NOW | CAPPED_NOW | SOFT_LIMIT_NOW)) { power = 'Throttled'; tone = 'warn'; }
  else if (b & UNDERVOLT_SEEN) { power = 'Low voltage earlier'; tone = 'warn'; }
  if (temp != null) {
    if (temp >= 80) tone = 'danger';
    else if (temp >= 70 && tone === 'ok') tone = 'warn';
  }
  return { tone, power };
}

function idleLine(s, ph) {
  switch (ph) {
    case 'error': return (s.printer && (s.printer.error || s.printer.text)) || 'Printer error';
    case 'disconnected': return 'Printer not connected';
    case 'linking': return 'Opening the serial port…';
    case 'offline': return 'Can’t reach OctoPrint';
    case 'unauthorized': return 'Screen needs pairing';
    case 'connecting': return 'Talking to OctoPrint…';
    default: return null;
  }
}

/**
 * Arc length (of pathLength 100) on an SVG circle. A zero-length dash would still draw its
 * round cap, so it is hidden; a full circle drops the dash so its caps don't leave a notch.
 */
function setArc(el, len) {
  const v = len >= 99.95 ? 'none' : `${Math.max(0, len).toFixed(2)} 100`;
  if (el._dash !== v) { el._dash = v; el.setAttribute('stroke-dasharray', v); }
  const show = len > 0.3 ? 'visible' : 'hidden';
  if (el.style.visibility !== show) el.style.visibility = show;
}

// 84px dial, 7px stroke, open at the bottom; the label sits in the gap like on a gauge face
function dial(key, label) {
  const c = 'cx="42" cy="42" r="38" pathLength="100" transform="rotate(135 42 42)"';
  return `
    <div class="qcard q-dial" data-r="${key}">
      <div class="qface">
        <svg class="qarc" viewBox="0 0 84 84" width="84" height="84" aria-hidden="true">
          <circle class="trk" ${c} stroke-dasharray="${DIAL_SWEEP} 100"/>
          <circle class="val" ${c} data-r="${key}Arc" stroke-dasharray="0 100"/>
        </svg>
        <div class="qread"><div class="qnum"><b data-r="${key}A">—</b><i>°</i></div><small data-r="${key}T"></small></div>
        <div class="qface-label">${label}</div>
      </div>
      <div class="qstate" data-r="${key}State"></div>
    </div>`;
}

function stat(key, glyph, label) {
  return `<div class="qcell qstat" data-r="${key}Box"><div class="qh">${icon(glyph)}<span>${label}</span></div><b data-r="${key}">—</b></div>`;
}

function sysCell(key, label) {
  return `<div class="qcell qsys" data-r="${key}Cell">
      <div class="qh"><i></i><span>${label}</span></div>
      <b data-r="${key}Main">…</b>
      <span class="qsub" data-r="${key}Sub1"></span>
      <span class="qsub" data-r="${key}Sub2"></span>
    </div>`;
}

const numHTML = (n, unit) => `${n}<small>${unit}</small>`;

/** File names have no spaces: let them wrap after _ - . instead of mid-word (zero-width spaces). */
const wrapName = (name) => name.replace(/([_\-.])(?=.)/g, '$1\u200b');

export function openQuickInfo(ctx) {
  if (current) return current;
  const { store, cfg } = ctx;
  const app = document.getElementById('app');
  const el = document.createElement('div');
  el.className = 'quick';
  el.innerHTML = `
    <div class="q-top">
      <div class="qcard q-job" data-r="job">
        <div class="qring">
          <svg viewBox="0 0 88 88" width="88" height="88" aria-hidden="true">
            <circle class="trk" cx="44" cy="44" r="39.5"/>
            <circle class="val" cx="44" cy="44" r="39.5" pathLength="100" transform="rotate(-90 44 44)" data-r="ring" stroke-dasharray="0 100"/>
          </svg>
          <div class="qring-c">
            <div class="qnum" data-r="pctBox"><b data-r="pct">0</b><i>%</i></div>
            <span class="qglyph" data-r="glyph"></span>
          </div>
        </div>
        <div class="qjob-text">
          <div class="qh"><i></i><span data-r="phase"></span></div>
          <div class="qname" data-r="jobName"></div>
          <div class="qeta"><b data-r="eta1"></b><span data-r="eta2"></span></div>
        </div>
      </div>
      ${dial('noz', 'Nozzle')}
      ${dial('bed', 'Bed')}
    </div>
    <div class="q-plate">
      <div class="q-stats">
        ${stat('fan', 'fan', 'Fan')}
        ${stat('feed', 'speed', 'Speed')}
        ${stat('flow', 'flow', 'Flow')}
        ${stat('z', 'layers', 'Z height')}
      </div>
      <div class="q-sys">
        ${sysCell('pr', 'Printer')}
        ${sysCell('net', 'Network')}
        ${sysCell('pi', 'Raspberry Pi')}
      </div>
    </div>`;
  mount(el);
  const r = refs(el);

  let sys = null;        // last /sysinfo answer
  let sysError = null;
  let conn = null;       // last /api/connection "current"
  let lastText = null;   // printer state text, to refetch the connection when it changes
  let closed = false;

  // ~~ live store data

  function renderDial(key, v, max) {
    const a = v.actual;
    const on = v.target > 0;
    const heating = on && a != null && a < v.target - 3;
    const warm = !on && a != null && a >= WARM;
    const [label, tone] = heating ? ['Heating', 'heat'] : on ? ['At temp', 'ok'] : warm ? ['Cooling', 'cool'] : ['Off', 'muted'];
    setText(r[`${key}A`], a == null ? '—' : fmtTemp(a));
    setText(r[`${key}T`], on ? `of ${Math.round(v.target)}°` : '');
    setText(r[`${key}State`], label);
    setData(r[`${key}State`], 'tone', tone);
    setData(r[key], 'tone', tone);
    const frac = a == null ? 0 : on ? a / v.target : a / max;
    setArc(r[`${key}Arc`], clamp(frac, 0, 1) * DIAL_SWEEP);
  }

  function renderJob(s, ph) {
    const meta = PHASES[ph];
    setText(r.phase, meta.label);
    setData(r.job, 'tone', meta.tone);
    const file = s.job && s.job.file && s.job.file.name ? s.job.file : null;
    const showJob = !!file && ACTIVE.has(ph);
    const done = !!file && ph === 'finished';
    const problem = showJob || done ? null : idleLine(s, ph);
    toggle(r.job, 'problem', !!problem);
    toggle(r.job, 'idle', !showJob && !done);
    toggle(r.pctBox, 'hidden', !showJob);
    toggle(r.glyph, 'hidden', showJob);
    if (!showJob) setHTML(r.glyph, icon(PHASE_GLYPH[ph] || 'printer'));

    if (showJob || done) {
      const prog = s.progress || {};
      const pct = done ? 100 : clamp(prog.completion || 0, 0, 100);
      setText(r.jobName, wrapName(displayName(file)));
      setText(r.pct, Math.floor(pct));
      setArc(r.ring, pct);
      if (done) {
        setText(r.eta1, 'Print complete');
        setText(r.eta2, `took ${fmtDuration(prog.printTime)}`);
      } else if (prog.printTimeLeft != null) {
        setText(r.eta1, `${fmtDuration(prog.printTimeLeft)} left`);
        setText(r.eta2, `done ≈ ${fmtClock(new Date(Date.now() + prog.printTimeLeft * 1000))}`);
      } else {
        setText(r.eta1, 'Estimating…');
        setText(r.eta2, `${fmtDuration(prog.printTime)} in`);
      }
      return;
    }

    setArc(r.ring, 0);
    const last = problem ? null : lastPrinted(s.files);
    if (problem) {
      setText(r.jobName, problem);
      setText(r.eta1, '');
      setText(r.eta2, '');
    } else if (last) {
      setText(r.jobName, wrapName(displayName(last.file)));
      setText(r.eta1, last.last.success ? 'Last print · done' : 'Last print · failed');
      setText(r.eta2, [fmtAgo(last.last.date), last.last.printTime ? fmtDuration(last.last.printTime) : ''].filter(Boolean).join(' · '));
    } else {
      setText(r.jobName, 'Nothing printing');
      setText(r.eta1, 'Ready to print');
      setText(r.eta2, 'Pick a file on Files');
    }
  }

  function renderStats(s, ph) {
    setHTML(r.fan, s.fan == null ? '—' : numHTML(s.fan, '%'));
    setHTML(r.feed, numHTML(s.feed, '%'));
    setHTML(r.flow, numHTML(s.flow, '%'));
    toggle(r.feedBox, 'changed', s.feed !== 100);
    toggle(r.flowBox, 'changed', s.flow !== 100);
    const z = s.currentZ != null && (ACTIVE.has(ph) || ph === 'finished');
    setHTML(r.z, z ? numHTML(Number(s.currentZ).toFixed(2), 'mm') : '—');
  }

  function renderPrinter(s, ph) {
    const online = s.link === 'online';
    const tone = !online ? 'muted'
      : ph === 'error' ? 'danger'
        : ph === 'disconnected' ? 'muted'
          : ph === 'linking' || ph === 'paused' || ph === 'pausing' ? 'warn' : 'ok';
    setData(r.prCell, 'tone', tone);
    setText(r.prMain, online ? (s.printer && s.printer.text) || PHASES[ph].label : '—');
    const port = conn && conn.port;
    setText(r.prSub1, port || (online && ph === 'disconnected' ? 'Not connected' : ''));
    setText(r.prSub2, port && conn.baudrate ? `${conn.baudrate} baud` : '');
  }

  function renderNet(s) {
    const net = sys && sys.net;
    const linkTone = s.link === 'online' ? 'ok' : s.link === 'offline' ? 'danger' : 'muted';
    const weak = net && net.wifi && net.signal != null && net.signal < -75;
    setData(r.netCell, 'tone', linkTone === 'ok' && weak ? 'warn' : linkTone);
    setText(r.netMain, ctx.host);
    if (!net) {
      setText(r.netSub1, s.link === 'offline' ? 'OctoPrint unreachable' : '');
      setText(r.netSub2, '');
      return;
    }
    setText(r.netSub1, net.ip || '');
    setText(r.netSub2, net.wifi ? ['Wi-Fi', wifiWord(net.signal)].filter(Boolean).join(' · ')
      : net.iface ? 'Ethernet' : net.ip ? '' : 'No network');
  }

  function renderPi() {
    if (!sys) {
      setData(r.piCell, 'tone', sysError ? 'muted' : null);
      setText(r.piMain, sysError ? '—' : '…');
      setText(r.piSub1, sysError || '');
      setText(r.piSub2, '');
      return;
    }
    const { tone, power } = piHealth(sys.cpuTemp, sys.throttled);
    setData(r.piCell, 'tone', tone);
    setHTML(r.piMain, sys.cpuTemp != null ? `${Math.round(sys.cpuTemp)}°C <small>CPU</small>` : '—');
    setText(r.piSub1, [power, sys.uptime != null ? `up ${fmtDuration(sys.uptime)}` : ''].filter(Boolean).join(' · '));
    setText(r.piSub2, sys.disk ? `${gb(sys.disk.free)} free` : '');
  }

  function render(s) {
    const ph = phaseOf(s);
    const t = s.temps || {};
    renderJob(s, ph);
    renderDial('noz', t.tool0 || {}, cfg.limits.nozzleMax);
    renderDial('bed', t.bed || {}, cfg.limits.bedMax);
    renderStats(s, ph);
    renderPrinter(s, ph);
    renderNet(s);
    renderPi();
    const text = (s.printer && s.printer.text) || '';
    if (text !== lastText && s.link === 'online') { lastText = text; loadConnection(); }
  }

  // ~~ polled data: Pi health and the serial connection

  let sysBusy = false;
  async function loadSys() {
    if (sysBusy || !ctx.client || !ctx.client.sysinfo) return;
    sysBusy = true;
    try {
      sys = await ctx.client.sysinfo();
      sysError = null;
    } catch (e) {
      sys = null;
      sysError = e && e.status === 403 ? 'No permission' : 'Not available';
    } finally {
      sysBusy = false;
    }
    if (!closed) render(store.get());
  }

  async function loadConnection() {
    if (!ctx.client) return;
    try {
      const c = await ctx.client.connection();
      conn = (c && c.current) || null;
    } catch {
      conn = null;
    }
    if (!closed) render(store.get());
  }

  const unsub = store.subscribe(render);
  render(store.get());
  loadSys();
  const poll = setInterval(loadSys, SYS_POLL_MS);
  const secs = Number(cfg.ui.quickInfoSeconds ?? 15);
  const auto = secs > 0 ? setTimeout(() => close(), secs * 1000) : null;
  app.classList.add('quick-open');

  function close() {
    if (closed) return;
    closed = true;
    clearInterval(poll);
    clearTimeout(auto);
    unsub();
    el.remove();
    app.classList.remove('quick-open');
    current = null;
  }

  el.addEventListener('click', close);
  current = { el, close };
  return current;
}
