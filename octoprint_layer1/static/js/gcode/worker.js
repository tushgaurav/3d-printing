// Background thread for the 3D view: parses G-code and draws frames, so the
// touch UI never stalls while a big file loads or the view turns.
//
// Messages in:  { id, type: 'load', key, buffer } | { id, type: 'drop', key } | { id, type: 'render', key, ...view }
// Messages out: { id, ok: true, result } | { id, ok: false, error }

import { parseGcode } from './parse.js';
import { renderModel } from './render.js';

const models = new Map();
let canvas = null;

function reply(id, result, transfer) {
  self.postMessage({ id, ok: true, result }, transfer || []);
}

self.onmessage = (ev) => {
  const msg = ev.data || {};
  try {
    if (msg.type === 'load') {
      const m = parseGcode(new Uint8Array(msg.buffer));
      models.set(msg.key, m);
      reply(msg.id, { layers: m.layerCount, segments: m.count, truncated: m.truncated, height: m.bounds.maxZ });
    } else if (msg.type === 'drop') {
      models.delete(msg.key);
      reply(msg.id, true);
    } else if (msg.type === 'render') {
      const m = models.get(msg.key);
      if (!m) { reply(msg.id, null); return; }
      if (!canvas || canvas.width !== msg.w || canvas.height !== msg.h) canvas = new OffscreenCanvas(msg.w, msg.h);
      const stats = renderModel(canvas.getContext('2d'), m, msg);
      const bitmap = canvas.transferToImageBitmap();
      reply(msg.id, { bitmap, stats }, [bitmap]);
    } else {
      throw new Error(`unknown message ${msg.type}`);
    }
  } catch (e) {
    self.postMessage({ id: msg.id, ok: false, error: (e && e.message) || String(e) });
  }
};
