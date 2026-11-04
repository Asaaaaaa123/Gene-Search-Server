// upload-panel.js — the Data tab's "Upload data" card on a hosted server (an online installation, whose folders are
// not the user's). The user chooses the Space Ranger output folder of one or more sections; the browser uploads only
// the files the analysis reads (square_<size>/filtered_feature_bc_matrix.h5 and the positions, scale factors and
// images of square_<size>/spatial/, for the analysis and QC bin sizes) to the project's upload folder, its data root,
// in chunks (PUT /api/projects/<id>/upload/<path>?offset=&size=), so that no request outlasts a proxy's timeout.
import { h, mount, button, api, apiUrl, banner, confirmDialog, fmt, state } from '../core.js';

const MATRIX = 'filtered_feature_bc_matrix.h5';
const SPATIAL = new Set(['tissue_positions.parquet', 'tissue_positions.csv', 'tissue_positions_list.csv',
  'scalefactors_json.json', 'tissue_hires_image.png', 'tissue_lowres_image.png']);
const SQUARE = /^square_(\d{3}um)$/;
const CHUNK = 16 * 1024 * 1024; // bytes per request (the server takes up to 64 MB)
const ATTEMPTS = 3;             // tries per chunk when the connection drops

const enc = encodeURIComponent;

/**
 * The files of a folder selection that the analysis reads for the bin sizes `bins`: [{file, path}], path relative to
 * the folder above the chosen one (webkitRelativePath), so that the sample folder keeps its name on the server.
 */
export function neededFiles(files, bins) {
  const out = [];
  for (const file of files) {
    const path = file.webkitRelativePath || file.name;
    const parts = path.split('/');
    const i = parts.findIndex((p) => SQUARE.test(p));
    if (i < 0 || !bins.includes(parts[i].match(SQUARE)[1]) || !file.size) continue;
    if (parts.some((p) => !p || p.startsWith('.'))) continue;
    const tail = parts.slice(i + 1);
    if ((tail.length === 1 && tail[0] === MATRIX) || (tail.length === 2 && tail[0] === 'spatial' && SPATIAL.has(tail[1]))) {
      out.push({ file, path });
    }
  }
  return out;
}

/** The folder of a sample in an upload path: everything above square_<size>/ (or the upload folder itself). */
function sampleFolder(path) {
  const parts = path.split('/');
  const i = parts.findIndex((p) => SQUARE.test(p));
  return i > 0 ? parts.slice(0, i).join('/') : '(upload folder)';
}

async function putChunk(url, body, signal) {
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(url, { method: 'PUT', body, signal, credentials: 'same-origin',
        headers: { 'Content-Type': 'application/octet-stream', Accept: 'application/json' } });
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      if (attempt < ATTEMPTS) continue;
      throw new Error('the connection to the server was lost');
    }
    if (res.ok) return res.json();
    let message = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      if (data && typeof data.detail === 'string') message = data.detail;
    } catch { /* not JSON */ }
    if (res.status >= 500 && res.status !== 507 && attempt < ATTEMPTS) continue;
    throw new Error(message);
  }
}

async function uploadFile(projectId, { file, path }, onBytes, signal) {
  const route = `/api/projects/${enc(projectId)}/upload/${path.split('/').map(enc).join('/')}`;
  for (let offset = 0; offset < file.size; offset += CHUNK) {
    const chunk = file.slice(offset, Math.min(offset + CHUNK, file.size));
    await putChunk(apiUrl(route, { offset, size: file.size }), chunk, signal);
    onBytes(chunk.size);
  }
}

/**
 * The upload card's content. getBins() gives the bin sizes to upload; onUploaded(root) runs after a successful
 * upload with the project's upload folder (the Data tab then detects the samples there).
 */
export function uploadPanel({ projectId, getBins, onUploaded }) {
  const input = h('input', { type: 'file', webkitdirectory: true, multiple: true, hidden: true });
  const choose = button({ label: 'Upload a Space Ranger folder…', icon: 'upload', kind: 'primary', onClick: () => input.click() });
  const status = h('div');
  const stored = h('div');
  let info = null;
  let ctrl = null;

  async function refresh() {
    try {
      info = await api(`/api/projects/${enc(projectId)}/upload`);
    } catch (e) {
      info = null;
      mount(stored, banner('danger', `The uploaded data cannot be listed: ${e.message}`));
      return;
    }
    paintStored();
  }

  function paintStored() {
    if (!info || !info.files.length) {
      mount(stored, h('p', { class: 'muted small' }, `Nothing uploaded yet. This project may upload up to ${fmt.bytes(info ? info.max_bytes : 0)}.`));
      return;
    }
    const folders = new Map();
    for (const f of info.files) {
      const key = sampleFolder(f.path);
      const entry = folders.get(key) || { files: 0, bytes: 0, bins: new Set() };
      entry.files += 1;
      entry.bytes += f.size;
      const m = f.path.split('/').find((p) => SQUARE.test(p));
      if (m) entry.bins.add(m.match(SQUARE)[1]);
      folders.set(key, entry);
    }
    // the samples are offered after every upload; this offers them again (a dismissed choice, a later visit)
    const samples = button({ label: 'Add samples…', icon: 'search', small: true, onClick: () => onUploaded(info.root) });
    const remove = button({
      label: 'Remove uploaded data', icon: 'trash', small: true, kind: 'ghost',
      onClick: async () => {
        const ok = await confirmDialog({
          title: 'Remove the uploaded data?', confirmLabel: 'Remove', danger: true,
          message: `The ${fmt.bytes(info.bytes)} uploaded to this project are deleted from the server. Finished runs keep their results, but their gene maps need the data.`,
        });
        if (!ok) return;
        info = await api(`/api/projects/${enc(projectId)}/upload`, { method: 'DELETE' });
        mount(status, null);
        paintStored();
      },
    });
    mount(stored, h('div', { class: 'stack' },
      h('div', { class: 'table-wrap' }, h('table', { class: 'table compact' },
        h('thead', null, h('tr', null, h('th', null, 'Uploaded folder'), h('th', null, 'Bin sizes'), h('th', null, 'Files'), h('th', null, 'Size'))),
        h('tbody', null, [...folders].map(([name, e]) => h('tr', null,
          h('td', { class: 'mono' }, name), h('td', null, [...e.bins].sort().join(', ')), h('td', null, String(e.files)), h('td', null, fmt.bytes(e.bytes))))))),
      h('div', { class: 'row' }, h('span', { class: 'muted small' }, `${fmt.bytes(info.bytes)} of ${fmt.bytes(info.max_bytes)} used.`), samples, remove)));
  }

  async function start(files) {
    const bins = getBins();
    const picked = neededFiles(files, bins);
    if (!picked.length) {
      mount(status, banner('warning', `No Space Ranger outputs for ${bins.join(' and ')} in this folder. Choose the folder of a section (or its outs/ or outs/binned_outputs/ folder): it holds square_${bins[0]}/${MATRIX}.`));
      return;
    }
    const total = picked.reduce((n, f) => n + f.file.size, 0);
    if (info && total > info.max_bytes) {
      mount(status, banner('danger', `These files take ${fmt.bytes(total)}; a project may upload ${fmt.bytes(info.max_bytes)} on this server.`));
      return;
    }
    ctrl = new AbortController();
    choose.disabled = true;
    let done = 0;
    const bar = h('div', { class: 'bar', style: 'width:0%' });
    const label = h('span', { class: 'muted small' });
    const cancel = button({ label: 'Cancel', small: true, kind: 'ghost', onClick: () => ctrl && ctrl.abort() });
    mount(status, h('div', { class: 'stack' }, h('div', { class: 'progress' }, bar), h('div', { class: 'row' }, label, cancel)));
    const paint = (path) => {
      bar.style.width = `${Math.round((100 * done) / total)}%`;
      label.textContent = `${fmt.bytes(done)} of ${fmt.bytes(total)} · ${path}`;
    };
    try {
      for (const f of picked) {
        paint(f.path);
        await uploadFile(projectId, f, (n) => { done += n; paint(f.path); }, ctrl.signal);
      }
      mount(status, banner('success', `${picked.length} files uploaded (${fmt.bytes(total)}). Choose the samples to add.`));
      await refresh();
      if (info) await onUploaded(info.root);
    } catch (e) {
      mount(status, e && e.name === 'AbortError'
        ? banner('info', 'Upload cancelled. The files already uploaded are kept.')
        : banner('danger', `Upload failed: ${e.message}`));
      await refresh();
    } finally {
      ctrl = null;
      choose.disabled = false;
    }
  }

  input.addEventListener('change', () => {
    const files = [...input.files];
    input.value = '';
    if (files.length) start(files);
  });

  const hosted = (state.health && state.health.hosted) || {};
  const minutes = hosted.max_run_minutes ? ` and stops an analysis after ${hosted.max_run_minutes} minutes` : '';
  const el = h('div', { class: 'stack' },
    h('p', { class: 'muted small' },
      'Choose the Space Ranger output folder of a section (or a folder holding several). Only the files the analysis reads are uploaded: ',
      h('span', { class: 'mono' }, MATRIX), ' and the spatial positions, scale factors and H&E images of the analysis and quality-control bin sizes below. ',
      `The server has limited memory${minutes}, so large sections are better analysed on your own computer.`),
    h('div', { class: 'row' }, choose),
    status, stored, input);
  refresh();
  return { el, refresh };
}
