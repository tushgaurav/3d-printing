// Files: OctoPrint's local G-code library with thumbnails, folders and sorting,
// shown as a list or as a grid (gallery) of thumbnails.

import { icon } from '../icons.js';
import { refs, setText, show, toggle, esc, fmtDuration, fmtAgo, displayName, filamentUse, fmtFilament } from '../util.js';
import { thumbUrl } from '../model.js';
import { makeScrollable, attempt, choiceDialog } from '../ui.js';
import { openFileDetail } from '../sheets/file.js';
import { storedFilesView, saveFilesView, storedFilesSort, saveFilesSort } from '../session.js';

// Slicer's estimate, or null when OctoPrint hasn't analysed the file (yet).
function printTime(f) {
  const t = f.gcodeAnalysis && f.gcodeAnalysis.estimatedPrintTime;
  return Number.isFinite(t) ? t : null;
}

// dir 1 = shortest first, -1 = longest first; files without an estimate go last either way
const byPrintTime = (dir) => (a, b) => {
  const ta = printTime(a);
  const tb = printTime(b);
  if (ta == null || tb == null) return (ta == null) - (tb == null);
  return (ta - tb) * dir;
};

// label/sub: the sort dialog; chip: the header button (defaults to label)
const SORTS = {
  date: { label: 'Recent', sub: 'Newest first', compare: (a, b) => (b.date || 0) - (a.date || 0) },
  name: { label: 'Name', sub: 'A to Z', chip: 'A–Z', compare: (a, b) => displayName(a).localeCompare(displayName(b)) },
  short: { label: 'Shortest', sub: 'Print time', compare: byPrintTime(1) },
  long: { label: 'Longest', sub: 'Print time', compare: byPrintTime(-1) },
};

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
          <button class="icon-btn" data-r="view"></button>
          <button class="icon-btn" data-r="refresh" aria-label="Refresh">${icon('refresh')}</button>
        </div>
        <div class="scrollbox"><div class="scroll" data-r="list"></div></div>
      </div>`;
    const r = refs(el);
    const scroller = makeScrollable(r.list);

    let folder = [];   // folder names from the root
    let sort = SORTS[storedFilesSort()] ? storedFilesSort() : 'date';
    let view = storedFilesView(); // 'list' or 'grid'
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

    // grid view: a big thumbnail, the name, and print time · age; last result as a corner badge
    function cellHTML(f, i) {
      if (f.type === 'folder') {
        const n = (f.children || []).length;
        return `<div class="gcell" data-i="${i}"><div class="gthumb folder">${icon('folder')}</div>
          <div class="name">${esc(f.display || f.name)}</div><div class="meta">${n} item${n === 1 ? '' : 's'}</div></div>`;
      }
      const a = f.gcodeAnalysis || {};
      const meta = [fmtDuration(a.estimatedPrintTime), fmtAgo(f.date)].filter((x) => x && x !== '—').join(' · ');
      const url = thumbUrl(f, ctx.base);
      const last = f.prints && f.prints.last;
      const badge = last ? `<span class="gstate ${last.success ? 'ok' : 'bad'}">${icon(last.success ? 'check' : 'cross')}</span>` : '';
      return `<div class="gcell" data-i="${i}">
        <div class="gthumb">${icon('cube')}${url ? `<img loading="lazy" alt="" src="${esc(url)}" onerror="this.remove()">` : ''}${badge}</div>
        <div class="name">${esc(displayName(f))}</div><div class="meta">${esc(meta)}</div></div>`;
    }

    // the button offers the other view, like most file browsers
    function renderViewButton() {
      const next = view === 'grid' ? 'list' : 'grid';
      if (r.view.dataset.next === next) return;
      r.view.dataset.next = next;
      r.view.innerHTML = icon(next);
      r.view.setAttribute('aria-label', next === 'grid' ? 'Grid view' : 'List view');
    }

    function render(force) {
      const s = store.get();
      if (!force && s.files === lastFiles) return;
      lastFiles = s.files;
      setText(r.sortText, SORTS[sort].chip || SORTS[sort].label);
      renderViewButton();
      toggle(r.list, 'grid', false); // loading / empty states always use the full width
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
      prints.sort(SORTS[sort].compare);
      entries = [...folders, ...prints];
      setText(r.count, `${prints.length} file${prints.length === 1 ? '' : 's'}`);
      toggle(r.list, 'grid', view === 'grid' && entries.length > 0);
      r.list.innerHTML = entries.length
        ? entries.map(view === 'grid' ? cellHTML : rowHTML).join('')
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
    r.sort.addEventListener('click', async () => {
      const pick = await choiceDialog({
        title: 'Sort files',
        options: Object.entries(SORTS).map(([value, o]) => ({ label: o.label, sub: o.sub, value, active: value === sort })),
      });
      if (!pick || pick === sort) return;
      sort = pick;
      saveFilesSort(sort);
      r.list.scrollTop = 0;
      render(true);
    });
    r.view.addEventListener('click', () => { view = view === 'grid' ? 'list' : 'grid'; saveFilesView(view); r.list.scrollTop = 0; render(true); });
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
