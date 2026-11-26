// Phone: QR codes that open OctoPrint and Layer1 on a phone, so nobody has to type the Pi's
// address. Phones often can't resolve "octopi.local" (Android especially), so the codes use
// the Pi's network address from /sysinfo when there is one. Tap a code to show it full
// screen, which scans from further away.

import { esc, sleep } from '../util.js';
import { openSheet, mount } from '../ui.js';
import { qrSVG } from '../qr.js';

const IP_WAIT_MS = 2000; // past this, show codes with the host name rather than none

/** Where another device on the network reaches this OctoPrint, e.g. "http://192.168.1.42". */
export function lanOrigin(ctx, ip) {
  // The kiosk loads the UI from 127.0.0.1, which means nothing to a phone. A browser on
  // another machine already has a working address; keep it unless it's a .local name.
  let host = ctx.loopback ? ctx.host.replace(/:\d+$/, '') : location.hostname;
  if (ip && (ctx.loopback || /\.local$/i.test(host))) host = ip;
  const port = location.port && !ctx.demo ? `:${location.port}` : '';
  return `${location.protocol}//${host}${port}`;
}

const shortUrl = (url) => url.replace(/^https?:\/\//, '').replace(/\/$/, '');

async function lanIP(ctx) {
  if (!ctx.client || !ctx.client.sysinfo) return null;
  const ip = ctx.client.sysinfo().then((s) => (s && s.net && s.net.ip) || null, () => null);
  return Promise.race([ip, sleep(IP_WAIT_MS).then(() => null)]);
}

function showFull(link) {
  const el = document.createElement('div');
  el.className = 'qr-full';
  el.innerHTML = `
    ${qrSVG(link.url, { size: 300 })}
    <div class="qr-text">
      <b>${esc(link.name)}</b>
      <span class="qr-url">${esc(shortUrl(link.url).replace(/\//g, '/\u200b'))}</span>
      <span class="qr-hint">Tap to close</span>
    </div>`;
  el.addEventListener('click', () => el.remove());
  return mount(el);
}

export function openPhone(ctx) {
  openSheet({
    title: 'Open on Phone',
    render(body, sheet) {
      sheet.head.insertAdjacentHTML('beforeend', '<span class="note">Phone must be on the same network</span>');
      body.innerHTML = '<div class="qr-pair"><div class="qr-card"></div><div class="qr-card"></div></div>';
      let links = [];
      let full = null;
      let closed = false;

      lanIP(ctx).then((ip) => {
        if (closed) return;
        const base = `${lanOrigin(ctx, ip)}${ctx.base}`;
        links = [
          { name: 'OctoPrint', url: base },
          { name: 'Layer1', url: `${base}plugin/layer1/` },
        ];
        body.innerHTML = `<div class="qr-pair">${links.map((l, i) => `
          <button class="qr-card" data-i="${i}">
            ${qrSVG(l.url, { size: 148 })}
            <b>${esc(l.name)}</b>
            <span class="qr-url">${esc(shortUrl(l.url))}</span>
          </button>`).join('')}</div>`;
      });

      body.addEventListener('click', (e) => {
        const b = e.target.closest('[data-i]');
        if (b) full = showFull(links[+b.dataset.i]);
      });
      return () => {
        closed = true;
        if (full) full.remove();
      };
    },
  });
}
