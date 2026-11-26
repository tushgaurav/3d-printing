// Files: OctoPrint's local G-code library with thumbnails, folders and sorting.

import { icon } from '../icons.js';
import { refs, setText, show, esc, fmtDuration, fmtAgo, displayName, filamentUse, fmtFilament } from '../util.js';
import { thumbUrl } from '../model.js';
import { makeScrollable, attempt } from '../ui.js';
import { openFileDetail } from '../sheets/file.js';

const SORTS = { date: 'Recent', name: 'A–Z' };

export default {
  id: 'files',
  icon: 'files',
  title: 'Files',

  mount(el, ctx) {
    const { store, cfg } = ctx;
    el.innerHTML = `
      <div class="files">
        <div class="files-head">
          <button class="icon-btn hidden" data-r="up" aria-label="Up">${icon('back')}</button>
          <div class="title" data-r="title">Files</div>
          <div class="count" data-r="count"></div>
          <div class="grow"></div>
          <button class="chipbtn" data-r="sort">${icon('sort')}<span data-r="sortText"></span></button>
          <button class="icon-btn" data-r="refresh" aria-label="Refresh">${icon('refresh')}</button>
        </div>
        <div class="scrollbox"><div class="scroll" data-r="list"></div></div>
      </div>`;
    const r = refs(el);
    const scroller = makeScrollable(r.list);

    let folder = [];   // folder names from the root
    let sort = 'date';
    let entries = [];
    let lastFiles;

    function currentList(files) {
      let list = files || [];
      for (const name of folder) {
        const f = list.find((x) => x.type === 'folder' && x.name === name);
        if (!f) { folder = []; return files || []; }
        list = f.children || [];
      }
      return list;
    }

    function rowHTML(f, i) {
      if (f.type === 'folder') {
        const n = (f.children || []).length;
        return `<div class="frow" data-i="${i}"><div class="thumb folder">${icon('folder')}</div>
          <div style="min-width:0"><div class="name">${esc(f.display || f.name)}</div><div class="meta">${n} item${n === 1 ? '' : 's'}</div></div>
          <div class="end">${icon('right')}</div></div>`;
      }
      const a = f.gcodeAnalysis || {};
      const meta = [fmtDuration(a.estimatedPrintTime), fmtFilament(filamentUse(a, cfg.ui.filamentDensity)), fmtAgo(f.date)]
        .filter((x) => x && x !== '—').join(' · ');
      const url = thumbUrl(f, ctx.base);
      const last = f.prints && f.prints.last;
      const end = last ? `<span class="${last.success ? 'ok' : 'bad'}">${icon(last.success ? 'check' : 'cross')}</span>` : icon('right');
      return `<div class="frow" data-i="${i}">
        <div class="thumb">${icon('cube')}${url ? `<img loading="lazy" alt="" src="${esc(url)}" onerror="this.remove()">` : ''}</div>
        <div style="min-width:0"><div class="name">${esc(displayName(f))}</div><div class="meta">${esc(meta)}</div></div>
        <div class="end">${end}</div></div>`;
    }

    function render(force) {
      const s = store.get();
      if (!force && s.files === lastFiles) return;
      lastFiles = s.files;
      setText(r.sortText, SORTS[sort]);
      show(r.up, folder.length > 0);
      setText(r.title, folder.length ? folder[folder.length - 1] : 'Files');

      if (!s.files) {
        setText(r.count, '');
        r.list.innerHTML = s.filesError
          ? `<div class="empty-state">${icon('alert')}<b>Couldn’t load files</b><span>${esc(s.filesError)}</span></div>`
          : `<div class="empty-state">${icon('files')}<span>Loading files…</span></div>`;
        entries = [];
        scroller.update();
        return;
      }

      const list = currentList(s.files).slice();
      const folders = list.filter((f) => f.type === 'folder').sort((a, b) => a.name.localeCompare(b.name));
      const prints = list.filter((f) => f.type !== 'folder');
      prints.sort(sort === 'name'
        ? (a, b) => displayName(a).localeCompare(displayName(b))
        : (a, b) => (b.date || 0) - (a.date || 0));
      entries = [...folders, ...prints];
      setText(r.count, `${prints.length} file${prints.length === 1 ? '' : 's'}`);
      r.list.innerHTML = entries.length
        ? entries.map(rowHTML).join('')
        : `<div class="empty-state">${icon('files')}<b>No files here</b><span>Upload G-code from your slicer or OctoPrint’s web page.</span></div>`;
      scroller.update();
    }

    r.list.addEventListener('click', (e) => {
      const row = e.target.closest('[data-i]');
      const f = row && entries[+row.dataset.i];
      if (!f) return;
      if (f.type === 'folder') { folder.push(f.name); r.list.scrollTop = 0; render(true); }
      else openFileDetail(ctx, f);
    });
    r.up.addEventListener('click', () => { folder.pop(); r.list.scrollTop = 0; render(true); });
    r.sort.addEventListener('click', () => { sort = sort === 'date' ? 'name' : 'date'; r.list.scrollTop = 0; render(true); });
    r.refresh.addEventListener('click', () => attempt(() => ctx.refreshFiles()));

    store.subscribe(() => render(false));
    render(true);

    return {
      onShow() {
        if (ctx.filesAge() > 20000) ctx.refreshFiles();
        render(false);
      },
    };
  },
};
