// Network: how the computer OctoPrint runs on is connected (Wi-Fi name and signal bars, or Ethernet and its speed)
// and its addresses, plus "Open on Phone" for QR codes to OctoPrint and Layer1. When both
// are connected, the one carrying traffic leads and the other gets a row. Opened from the
// Wi-Fi icon at the end of the status bar, which shows the same state (see netGlyph).

import { icon } from '../icons.js';
import { refs, setText, setHTML, setData, esc } from '../util.js';
import { openSheet } from '../ui.js';
import { openPhone } from './phone.js';

const POLL_MS = 5000;

export function wifiWord(dbm) {
  if (dbm == null) return '';
  if (dbm >= -55) return 'Excellent';
  if (dbm >= -67) return 'Good';
  if (dbm >= -75) return 'Fair';
  return 'Weak';
}

/** Icon and tone for the network state in the store: bars for Wi-Fi strength, or a cable. */
export function netGlyph(net) {
  if (!net) return { glyph: 'wifi', tone: 'muted' }; // not known (yet)
  if (!net.ip) return { glyph: 'wifiOff', tone: 'danger' };
  if (!net.wifi) return { glyph: net.iface ? 'ethernet' : 'wifi', tone: null };
  const s = net.signal;
  if (s == null || s >= -67) return { glyph: 'wifi', tone: null };
  if (s >= -75) return { glyph: 'wifiMid', tone: null };
  return { glyph: 'wifiLow', tone: 'warn' };
}

/** 0-4 bars, on the same thresholds as wifiWord. */
export function signalBars(dbm) {
  if (dbm == null) return 0;
  if (dbm >= -55) return 4;
  if (dbm >= -67) return 3;
  return dbm >= -75 ? 2 : 1;
}

/** Signal strength as phone-style bars and a word, e.g. ▂▄▆_ Good. */
function signalHTML(dbm, label = wifiWord(dbm)) {
  const n = signalBars(dbm);
  return `<span class="bars" data-n="${n}"${n === 1 ? ' data-tone="warn"' : ''}><i></i><i></i><i></i><i></i></span>${esc(label)}`;
}

function fmtSpeed(mbps) {
  if (!mbps) return '';
  return mbps >= 1000 ? `${+(mbps / 1000).toFixed(1)} Gb/s` : `${mbps} Mb/s`;
}

function band(mhz) {
  if (!mhz) return '';
  if (mhz < 3000) return '2.4 GHz';
  return mhz < 5925 ? '5 GHz' : '6 GHz';
}

let current = null;

/** The status bar's Wi-Fi icon: open the page, or close it when it is already open. */
export function toggleNetwork(ctx) {
  if (current) current.close();
  else openNetwork(ctx);
}

export function openNetwork(ctx) {
  if (current) return current;
  current = openSheet({
    title: 'Network',
    render(body) {
      body.innerHTML = `
        <div class="net">
          <div class="net-info">
            <div class="net-hero" data-r="hero">
              <span class="ti" data-r="glyph"></span>
              <div><b data-r="name"></b><span data-r="sub"></span></div>
            </div>
            <div class="kvlist" data-r="rows"></div>
          </div>
          <button class="tile" data-r="phone">
            <span class="ti">${icon('qr')}</span>
            <span><b>Open on Phone</b><small>QR codes for OctoPrint and Layer1</small></span>
          </button>
        </div>`;
      const r = refs(body);
      let phone = null;

      // [label, value HTML, extra class for the value]
      const row = ([label, html, cls]) => `<div class="kv"><span>${esc(label)}</span><b${cls ? ` class="${cls}"` : ''}>${html}</b></div>`;

      const render = (s) => {
        const net = s.net;
        const { glyph, tone } = netGlyph(net);
        setHTML(r.glyph, icon(glyph));
        setData(r.hero, 'tone', tone);
        const host = net && net.hostname ? (net.hostname.includes('.') ? net.hostname : `${net.hostname}.local`) : ctx.host;
        if (!net) {
          setText(r.name, s.netError ? 'Network details unavailable' : 'Checking…');
          setText(r.sub, s.netError || '');
          setHTML(r.rows, [['IP address', '—'], ['Host name', esc(host)]].map(row).join(''));
          return;
        }
        const eth = net.ethernet && net.ethernet.connected ? net.ethernet : null;
        const wifiUp = net.wifi || !!net.ssid || net.signal != null; // the Wi-Fi link, even when not the route
        const rows = [['IP address', esc(net.ip || '—')], ['Host name', esc(host)]];
        if (!net.ip) {
          setText(r.name, 'Not connected');
          setText(r.sub, 'No network connection');
          rows.push(['Interface', '—']);
        } else if (net.wifi) {
          setText(r.name, net.ssid || 'Wi-Fi');
          setText(r.sub, ['Wi-Fi', band(net.freq)].filter(Boolean).join(' · '));
          rows.push(['Signal', net.signal != null ? signalHTML(net.signal) : '—', 'sig']);
          // a cable plugged in as well: it's a second way in, with its own address
          rows.push(eth ? ['Ethernet', esc([fmtSpeed(eth.speed), eth.ip].filter(Boolean).join(' · ') || 'Connected')] : ['Interface', esc(net.iface || '—')]);
        } else {
          setText(r.name, 'Ethernet');
          setText(r.sub, 'Wired LAN connection');
          rows.push(['Speed', esc((eth && fmtSpeed(eth.speed)) || '—')]);
          rows.push(wifiUp ? ['Wi-Fi', signalHTML(net.signal, net.ssid || wifiWord(net.signal) || 'Connected'), 'sig'] : ['Interface', esc(net.iface || '—')]);
        }
        setHTML(r.rows, rows.map(row).join(''));
      };

      const unsub = ctx.store.subscribe(render);
      render(ctx.store.get());
      ctx.refreshNet();
      const poll = setInterval(() => ctx.refreshNet(), POLL_MS);
      r.phone.addEventListener('click', () => { phone = openPhone(ctx); });
      return () => {
        unsub();
        clearInterval(poll);
        if (phone) phone.close();
      };
    },
    onClose() { current = null; },
  });
  return current;
}
