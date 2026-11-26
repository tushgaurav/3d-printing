// First-run pairing: ask OctoPrint for an application key, which someone
// approves from OctoPrint's web page on a phone or computer. No typing on a
// 3.5" screen.

import { icon } from '../icons.js';
import { refs, setText, setData, show, esc, sleep } from '../util.js';
import { APP_NAME, probeAppKeys, requestAppKey } from '../api.js';
import { mount } from '../ui.js';

export function showPairing(ctx, { demo = false } = {}) {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'takeover';
    el.innerHTML = `
      <div class="pair">
        <div class="mark"><div class="boot-mark">E5</div><span>${esc(ctx.cfg.printer.name)}<br>touchscreen</span></div>
        <div class="body">
          <h1>Pair this screen with OctoPrint</h1>
          <ol>
            <li><span>On your phone or computer, open <b>${esc(ctx.host)}</b> and log in.</span></li>
            <li><span>Click <b>Allow</b> on the access request from <b>${esc(APP_NAME)}</b>.</span></li>
            <li><span>This screen connects by itself and remembers the key.</span></li>
          </ol>
          <div class="statusline" data-r="status"><i></i><span data-r="text">Asking OctoPrint…</span></div>
          <div class="row-actions hidden" data-r="actions"><button class="btn primary" data-r="retry">${icon('refresh')}Ask Again</button></div>
        </div>
      </div>`;
    mount(el);
    const r = refs(el);

    const status = (text, tone, canRetry = false) => {
      setText(r.text, text);
      setData(r.status, 'tone', tone);
      show(r.actions, canRetry);
    };

    async function run() {
      if (demo) { status('Waiting for someone to click Allow in OctoPrint…', 'accent'); return; }
      status('Asking OctoPrint…', null);
      for (;;) {
        const probe = await probeAppKeys(ctx.base);
        if (probe === 'ok') break;
        if (probe === 'missing') {
          status('OctoPrint’s Application Keys plugin is off. Enable it, or put an API key in /etc/ender5-kiosk.conf.', 'danger', true);
          return;
        }
        status('Waiting for OctoPrint to start…', 'muted');
        await sleep(4000);
      }
      try {
        const pending = requestAppKey(ctx.base);
        status('Waiting for someone to click Allow in OctoPrint…', 'accent');
        const key = await pending;
        status('Paired!', 'ok');
        el.remove();
        resolve(key);
      } catch (e) {
        status(e.denied ? 'The request was denied or timed out.' : e.message, 'danger', true);
      }
    }

    r.retry.addEventListener('click', run);
    run();
  });
}
