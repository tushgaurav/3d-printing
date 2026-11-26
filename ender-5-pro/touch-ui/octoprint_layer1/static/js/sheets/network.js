// Network: how the Pi is connected (Wi-Fi name and signal, or Ethernet) and its addresses,
// plus "Open on Phone" for QR codes to OctoPrint and Layer1. Opened from the Wi-Fi icon at
// the end of the status bar, which shows the same state (see netGlyph).

import { icon } from '../icons.js';
import { refs, setText, setHTML, setData } from '../util.js';
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
            <div class="kvlist">
              <div class="kv"><span>IP address</span><b data-r="ip"></b></div>
              <div class="kv"><span>Host name</span><b data-r="host"></b></div>
              <div class="kv"><span>Signal</span><b data-r="signal"></b></div>
              <div class="kv"><span>Interface</span><b data-r="iface"></b></div>
            </div>
          </div>
          <button class="tile" data-r="phone">
            <span class="ti">${icon('qr')}</span>
            <span><b>Open on Phone</b><small>QR codes for OctoPrint and Layer1</small></span>
          </button>
        </div>`;
      const r = refs(body);
      let phone = null;

      const render = (s) => {
        const net = s.net;
        const { glyph, tone } = netGlyph(net);
        setHTML(r.glyph, icon(glyph));
        setData(r.hero, 'tone', tone);
        const host = net && net.hostname ? (net.hostname.includes('.') ? net.hostname : `${net.hostname}.local`) : ctx.host;
        setText(r.host, host);
        if (!net) {
          setText(r.name, s.netError ? 'Network details unavailable' : 'Checking…');
          setText(r.sub, s.netError || '');
          for (const k of ['ip', 'signal', 'iface']) setText(r[k], '—');
          return;
        }
        if (!net.ip) {
          setText(r.name, 'Not connected');
          setText(r.sub, 'The Pi has no network');
        } else if (net.wifi) {
          setText(r.name, net.ssid || 'Wi-Fi');
          setText(r.sub, ['Wi-Fi', band(net.freq), net.signal != null ? `${wifiWord(net.signal)} signal` : ''].filter(Boolean).join(' · '));
        } else {
          setText(r.name, 'Ethernet');
          setText(r.sub, 'Wired connection');
        }
        setText(r.ip, net.ip || '—');
        setText(r.signal, net.signal != null ? `${String(net.signal).replace('-', '−')} dBm` : '—');
        setText(r.iface, net.iface || '—');
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
