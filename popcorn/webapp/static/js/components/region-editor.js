// region-editor.js — draw regions on the sections of a run (Analysis tab › Regions). A region is one or more shapes on
// one section, in the micrometres of the per-bin table; the bins whose centre lies inside are its bins. Saved with the
// run (PUT /api/runs/<id>/regions), a region is a yes/no field of the analysis tools ("Region: <name>": inside or
// outside), and regions of the same name in several sections are one group.
//
//   openRegionEditor({runId, ctx, binUm, bins}) -> Promise<boolean>   true when the regions were saved
//     ctx: GET /analysis/context (sections, regions); bins: Map section -> Promise of GET /bins (shared with the tab).
//
// Tools: Polygon (click the corners; Enter or a double click closes it, Backspace removes the last corner, Esc drops
// it), Lasso (press and draw), Move (drag). The wheel zooms and the middle button drags in every tool.
import { h, api, apiUrl, mount, icon, button, modal, loading, banner, fmt, confirmDialog } from '../core.js';
import { PALETTE, pointPitch } from './charts.js';

const COLORS = ['#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#42d4f4', '#f032e6', '#bfef45', '#911eb4', '#469990'];
const GRAY = { unassigned: '#5d6673', ambiguous: '#5d6673', removed: '#4b535f', unresolved: '#586170' };
const CLICK_PX = 4;        // a press that moves less is a click
const LASSO_STEP_PX = 3;   // distance between the points kept while drawing freehand
const SIMPLIFY_PX = 1.2;   // freehand shapes are simplified to this tolerance
const MAX_CORNERS = 400;

function inside(px, py, poly) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** Ramer-Douglas-Peucker: the points of a line kept within `tol` of it. */
function simplify(points, tol) {
  if (points.length < 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    let far = -1;
    let dist = tol;
    for (let i = a + 1; i < b; i += 1) {
      const d = Math.abs((by - ay) * points[i][0] - (bx - ax) * points[i][1] + bx * ay - by * ax) / len;
      if (d > dist) { dist = d; far = i; }
    }
    if (far > 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  return points.filter((_, i) => keep[i]);
}

export function openRegionEditor({ runId, ctx, binUm, bins }) {
  return new Promise((resolve) => {
    const base = `/api/runs/${encodeURIComponent(runId)}`;
    const labelOfSample = Object.fromEntries(ctx.samples.map((s) => [s.id, s.label || s.id]));
    let regions = ctx.regions.map((r) => ({
      id: r.id, name: r.name, sample: r.sample, color: r.color || null, n: Number.isFinite(r.n) ? r.n : null,
      polygons: r.polygons.map((p) => p.map((q) => [q[0], q[1]])),
    }));
    regions.forEach((r, i) => { if (!r.color) r.color = COLORS[i % COLORS.length]; });
    let dirty = false;
    let sample = ctx.samples[0].id;
    let tool = 'polygon';
    let target = null;       // the region new shapes are added to; null: each shape starts a region
    let draft = [];          // corners (µm) of the shape being drawn
    let hover = null;        // the pointer (µm) while a polygon is being drawn
    let data = null;         // GET /bins of the section shown
    let view = null;         // {k: screen px per µm, ox, oy: the µm at the canvas' top left}
    let image = null;        // {img, pxPerUm} of the H&E image of the section, when shown
    let showImage = false;
    let colorBy = ['tissue_class', 'assigned_signature', 'leiden_domain'].find((k) => ctx.fields.some((f) => f.key === k)) || '';
    let drag = null;
    let frame = 0;
    let closed = false;
    let autoFit = true;      // the whole section is shown until the user moves or zooms

    const canvas = h('canvas', { class: 're-canvas', tabIndex: 0, 'aria-label': 'Section map: draw regions here' });
    const layer = document.createElement('canvas');            // the bins, drawn again only when the view changes
    const stage = h('div', { class: 're-stage' }, canvas);
    const status = h('div', { class: 're-status muted small' });
    const listEl = h('div', { class: 're-list' });
    const errorBox = h('div');
    const g = canvas.getContext('2d');

    // ---------------------------------------------------------------- data
    async function loadSection() {
      data = null;
      image = null;
      draft = [];
      mount(status, 'Loading the section…');
      paint();
      if (!bins.has(sample)) bins.set(sample, api(`${base}/bins`, { query: { sample } }));
      try {
        const loaded = await bins.get(sample);
        if (closed) return;
        data = loaded;
      } catch (err) {
        bins.delete(sample);
        mount(status, h('span', { class: 'sv-warn' }, `The section cannot be read: ${err.message}`));
        return;
      }
      fitView();
      countAll();
      if (showImage) loadImage();
      paintList();
      paintStatus();
      paint(true);
    }

    async function loadImage() {
      const wanted = sample;
      try {
        const info = await api(`${base}/bins/image`, { query: { sample } });
        const img = new Image();
        await new Promise((ok, bad) => { img.onload = ok; img.onerror = bad; img.src = apiUrl(info.url); });
        if (!closed && wanted === sample) { image = { img, pxPerUm: info.px_per_um }; paint(true); }
      } catch {
        if (!closed && wanted === sample) { showImage = false; imageBox.checked = false; mount(status, 'This section has no H&E image.'); }
      }
    }

    function countAll() {
      if (!data) return;
      for (const r of regions) {
        if (r.sample !== sample) continue;
        let n = 0;
        for (let i = 0; i < data.n; i += 1) {
          const x = data.x[i];
          const y = data.y[i];
          if (x === null || y === null) continue;
          if (r.polygons.some((p) => inside(x, y, p))) n += 1;
        }
        r.n = n;
      }
    }

    // ---------------------------------------------------------------- drawing
    const cssSize = () => [stage.clientWidth || 600, stage.clientHeight || 400];

    // the size of a bin, else (cells, spots) the spacing of the section's points
    const pitchNow = () => {
      if (Number.isFinite(binUm) && binUm > 0) return binUm;
      if (!data) return 16;
      if (!data.pitch) data.pitch = pointPitch(data.x, data.y);
      return data.pitch;
    };

    function fitView() {
      if (!data) return;
      let x0 = Infinity; let x1 = -Infinity; let y0 = Infinity; let y1 = -Infinity;
      for (let i = 0; i < data.n; i += 1) {
        const x = data.x[i];
        const y = data.y[i];
        if (x === null || y === null) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
      if (!Number.isFinite(x0)) { view = { k: 1, ox: 0, oy: 0 }; return; }
      const [w, hgt] = cssSize();
      const pad = pitchNow() * 2;
      const k = Math.min(w / (x1 - x0 + 2 * pad), hgt / (y1 - y0 + 2 * pad));
      view = { k, ox: (x0 + x1) / 2 - w / (2 * k), oy: (y0 + y1) / 2 - hgt / (2 * k) };
    }

    const toScreen = (x, y) => [(x - view.ox) * view.k, (y - view.oy) * view.k];
    const toUm = (sx, sy) => [sx / view.k + view.ox, sy / view.k + view.oy];

    function drawBins() {
      const [w, hgt] = cssSize();
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      for (const c of [canvas, layer]) {
        if (c.width !== Math.round(w * ratio) || c.height !== Math.round(hgt * ratio)) { c.width = Math.round(w * ratio); c.height = Math.round(hgt * ratio); }
      }
      canvas.style.width = `${w}px`;
      canvas.style.height = `${hgt}px`;
      const c = layer.getContext('2d');
      c.setTransform(ratio, 0, 0, ratio, 0, 0);
      c.clearRect(0, 0, w, hgt);
      if (!data || !view) return;
      if (image) {
        const [ix, iy] = toScreen(0, 0);
        c.globalAlpha = 0.9;
        c.drawImage(image.img, ix, iy, (image.img.naturalWidth / image.pxPerUm) * view.k, (image.img.naturalHeight / image.pxPerUm) * view.k);
        c.globalAlpha = image ? 0.55 : 1;
      }
      const side = Math.max(1.5, pitchNow() * view.k);
      const half = (pitchNow() * view.k) / 2;
      const f = colorBy && data.fields ? data.fields[colorBy] : null;
      const groups = new Map();
      const neutral = '#39414d';
      if (f && f.type === 'category') {
        const configured = (data.colors && data.colors[colorBy]) || {};
        let k = 0;
        const colors = f.categories.map((name) => configured[name] || GRAY[String(name).toLowerCase()] || PALETTE[(k++) % PALETTE.length]);
        for (let i = 0; i < data.n; i += 1) {
          const color = f.codes[i] >= 0 ? colors[f.codes[i]] : neutral;
          if (!groups.has(color)) groups.set(color, []);
          groups.get(color).push(i);
        }
      } else {
        groups.set(neutral, Array.from({ length: data.n }, (_, i) => i));
      }
      for (const [color, list] of groups) {
        c.fillStyle = color;
        for (const i of list) {
          const x = data.x[i];
          const y = data.y[i];
          if (x === null || y === null) continue;
          const sx = (x - view.ox) * view.k - half;
          const sy = (y - view.oy) * view.k - half;
          if (sx < -side || sy < -side || sx > w || sy > hgt) continue;
          c.fillRect(sx, sy, side, side);
        }
      }
      c.globalAlpha = 1;
    }

    function trace(poly) {
      g.beginPath();
      poly.forEach((p, i) => { const [sx, sy] = toScreen(p[0], p[1]); if (i) g.lineTo(sx, sy); else g.moveTo(sx, sy); });
    }

    function paint(binsToo = false) {
      if (binsToo) drawBins();
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const [w, hgt] = cssSize();
        const ratio = canvas.width / w;
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, canvas.width, canvas.height);
        g.drawImage(layer, 0, 0);
        g.setTransform(ratio, 0, 0, ratio, 0, 0);
        if (!view) return;
        for (const r of regions) {
          if (r.sample !== sample) continue;
          for (const p of r.polygons) {
            trace(p);
            g.closePath();
            g.fillStyle = `${r.color}33`;
            g.fill();
            g.lineWidth = r === target ? 3 : 2;
            g.strokeStyle = '#0b0d11';
            g.stroke();
            g.lineWidth = r === target ? 2 : 1.2;
            g.strokeStyle = r.color;
            g.stroke();
          }
          const [lx, ly] = toScreen(...r.polygons[0][0]);
          g.font = '600 12px system-ui, sans-serif';
          g.lineWidth = 3;
          g.strokeStyle = '#0b0d11';
          g.strokeText(r.name, lx + 6, ly - 6);
          g.fillStyle = '#ffffff';
          g.fillText(r.name, lx + 6, ly - 6);
        }
        if (draft.length) {
          trace(hover && tool === 'polygon' ? [...draft, hover] : draft);
          g.lineWidth = 2;
          g.setLineDash([5, 4]);
          g.strokeStyle = '#ffffff';
          g.stroke();
          g.setLineDash([]);
          if (tool === 'polygon') {
            for (const p of draft) {
              const [sx, sy] = toScreen(p[0], p[1]);
              g.beginPath();
              g.arc(sx, sy, 3.5, 0, 2 * Math.PI);
              g.fillStyle = '#ffffff';
              g.fill();
              g.strokeStyle = '#0b0d11';
              g.lineWidth = 1;
              g.stroke();
            }
          }
        }
        void hgt;
      });
    }

    // ---------------------------------------------------------------- shapes
    function nextName() {
      const names = new Set(regions.map((r) => r.name));
      for (let i = 1; ; i += 1) if (!names.has(`Region ${i}`)) return `Region ${i}`;
    }

    function finishShape(points) {
      draft = [];
      hover = null;
      const poly = points.slice(0, MAX_CORNERS).map((p) => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100]);
      if (poly.length < 3) { paint(); return; }
      if (target && target.sample === sample) target.polygons.push(poly);
      else {
        target = { id: null, name: nextName(), sample, color: COLORS[regions.length % COLORS.length], polygons: [poly], n: null };
        regions.push(target);
      }
      dirty = true;
      countAll();
      paintList();
      paintStatus();
      paint();
    }

    function paintStatus() {
      if (!data) return;
      const hint = tool === 'polygon'
        ? (draft.length ? `${draft.length} corner${draft.length === 1 ? '' : 's'}: Enter or a double click closes the shape, Backspace removes the last corner, Esc drops it.` : 'Click the corners of the shape.')
        : tool === 'lasso' ? 'Press and draw around the bins.' : 'Drag to move, wheel to zoom.';
      const adds = target && target.sample === sample ? ` New shapes are added to “${target.name}”.` : ' Each shape starts a new region.';
      mount(status, `${fmt.int(data.n)} bins. ${hint}${tool === 'move' ? '' : adds}`);
    }

    // ---------------------------------------------------------------- pointer and keys
    const posOf = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

    canvas.addEventListener('wheel', (e) => {
      if (!view) return;
      e.preventDefault();
      const [sx, sy] = posOf(e);
      const [ux, uy] = toUm(sx, sy);
      autoFit = false;
      view.k *= Math.exp(-e.deltaY * 0.0015);
      view.k = Math.max(0.005, Math.min(60, view.k));
      view.ox = ux - sx / view.k;
      view.oy = uy - sy / view.k;
      paint(true);
    }, { passive: false });

    canvas.addEventListener('pointerdown', (e) => {
      if (!view || !data) return;
      canvas.focus({ preventScroll: true });
      try { canvas.setPointerCapture(e.pointerId); } catch { /* a pointer that cannot be captured still draws */ }
      const [sx, sy] = posOf(e);
      const panning = tool === 'move' || e.button === 1;
      drag = { sx, sy, panning, moved: false, ox: view.ox, oy: view.oy, button: e.button };
      if (!panning && tool === 'lasso' && e.button === 0) draft = [toUm(sx, sy)];
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!view) return;
      const [sx, sy] = posOf(e);
      if (drag) {
        if (Math.hypot(sx - drag.sx, sy - drag.sy) > CLICK_PX) drag.moved = true;
        if (drag.panning) {
          autoFit = false;
          view.ox = drag.ox - (sx - drag.sx) / view.k;
          view.oy = drag.oy - (sy - drag.sy) / view.k;
          paint(true);
          return;
        }
        if (tool === 'lasso' && draft.length) {
          const [lx, ly] = toScreen(...draft[draft.length - 1]);
          if (Math.hypot(sx - lx, sy - ly) >= LASSO_STEP_PX) { draft.push(toUm(sx, sy)); paint(); }
          return;
        }
      }
      if (tool === 'polygon' && draft.length) { hover = toUm(sx, sy); paint(); }
    });

    canvas.addEventListener('pointerup', (e) => {
      if (!drag) return;
      const d = drag;
      drag = null;
      if (d.panning || d.button !== 0) return;
      const [sx, sy] = posOf(e);
      if (tool === 'lasso') {
        const tol = SIMPLIFY_PX / view.k;
        finishShape(simplify(draft, tol));
        return;
      }
      if (tool === 'polygon' && !d.moved) {
        const p = toUm(sx, sy);
        const last = draft[draft.length - 1];
        // the second press of a double click lands on the corner just made: it closes the shape
        if (last && Math.hypot(...toScreen(...last).map((v, i) => v - [sx, sy][i])) < CLICK_PX) { if (draft.length >= 3) finishShape(draft); return; }
        draft.push(p);
        paintStatus();
        paint();
      }
    });
    canvas.addEventListener('pointercancel', () => { drag = null; });

    canvas.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && draft.length >= 3) { e.preventDefault(); finishShape(draft); } else if (e.key === 'Escape' && draft.length) {
        e.preventDefault(); e.stopPropagation(); draft = []; hover = null; paintStatus(); paint();
      } else if (e.key === 'Backspace' && draft.length) { e.preventDefault(); draft.pop(); paintStatus(); paint(); }
    });

    // ---------------------------------------------------------------- side panel
    function paintList() {
      if (!regions.length) {
        mount(listEl, h('p', { class: 'muted small' }, 'No region yet. Draw a shape on the map: the bins inside it become a group you can compare, test or count in any analysis.'));
        return;
      }
      mount(listEl, regions.map((r) => {
        const name = h('input', { class: 'input re-name', value: r.name, maxlength: 60, 'aria-label': 'Name of the region' });
        name.addEventListener('input', () => { r.name = name.value; dirty = true; paint(); paintStatus(); });
        const color = h('input', { class: 'color-input re-color', type: 'color', value: r.color, title: 'Color', 'aria-label': `Color of ${r.name}` });
        color.addEventListener('input', () => { r.color = color.value; dirty = true; paint(); });
        const here = r.sample === sample;
        const add = h('button', {
          type: 'button', class: 'btn small toggle', 'aria-pressed': r === target ? 'true' : 'false', disabled: !here,
          title: here ? 'New shapes are added to this region while this is on' : 'Shown on another section',
          onClick: () => { target = r === target ? null : r; paintList(); paintStatus(); paint(); },
        }, icon('plus', { size: 13 }), 'Add shapes');
        const remove = h('button', {
          type: 'button', class: 'btn small ghost danger icon-only', title: `Delete ${r.name}`, 'aria-label': `Delete ${r.name}`,
          onClick: () => { regions = regions.filter((x) => x !== r); if (target === r) target = null; dirty = true; paintList(); paintStatus(); paint(); },
        }, icon('trash', { size: 14 }));
        return h('div', { class: r === target ? 're-item active' : 're-item' },
          h('div', { class: 're-item-head' }, color, name, remove),
          h('div', { class: 're-item-foot' },
            h('button', { type: 'button', class: 'linklike', title: 'Show this section', onClick: () => { if (sample !== r.sample) { sample = r.sample; sampleSelect.value = sample; loadSection(); } } }, labelOfSample[r.sample] || r.sample),
            h('span', { class: 'muted' }, `${r.polygons.length} shape${r.polygons.length === 1 ? '' : 's'} · ${r.n === null ? '—' : fmt.int(r.n)} bins`),
            add));
      }));
    }

    const sampleSelect = h('select', { class: 'select', 'aria-label': 'Section' }, ctx.samples.map((s) => h('option', { value: s.id }, s.label || s.id)));
    sampleSelect.addEventListener('change', () => { sample = sampleSelect.value; target = null; loadSection(); });
    const colorFields = ctx.fields.filter((f) => f.type === 'category' && f.key !== 'sample');
    const colorSelect = h('select', { class: 'select', 'aria-label': 'Color the bins by' },
      h('option', { value: '' }, 'Gray bins'), colorFields.map((f) => h('option', { value: f.key }, f.label)));
    colorSelect.value = colorBy;
    colorSelect.addEventListener('change', () => { colorBy = colorSelect.value; paint(true); });
    const imageBox = h('input', { type: 'checkbox' });
    imageBox.addEventListener('change', () => { showImage = imageBox.checked; if (showImage) loadImage(); else { image = null; paint(true); } });
    const toolButtons = {};
    const setTool = (t) => {
      tool = t;
      draft = [];
      hover = null;
      for (const [k, b] of Object.entries(toolButtons)) { b.classList.toggle('active', k === t); b.setAttribute('aria-pressed', k === t ? 'true' : 'false'); }
      canvas.dataset.tool = t;
      paintStatus();
      paint();
    };
    for (const [id, label, ic] of [['polygon', 'Polygon', 'polygon'], ['lasso', 'Lasso', 'edit'], ['move', 'Move', 'maximize']]) {
      toolButtons[id] = h('button', { type: 'button', class: 'btn small', onClick: () => setTool(id) }, icon(ic, { size: 14 }), label);
    }

    const body = h('div', { class: 're' },
      h('div', { class: 're-main' },
        h('div', { class: 're-toolbar' },
          h('label', { class: 're-control' }, h('span', null, 'Section'), sampleSelect),
          h('div', { class: 're-control' }, h('span', null, 'Draw'), h('div', { class: 'btn-group', role: 'group', 'aria-label': 'Drawing tool' }, Object.values(toolButtons))),
          h('label', { class: 're-control' }, h('span', null, 'Color the bins by'), colorSelect),
          h('label', { class: 'check re-check' }, imageBox, 'H&E image'),
          button({ label: 'Fit', icon: 'maximize', small: true, kind: 'ghost', title: 'Show the whole section', onClick: () => { autoFit = true; fitView(); paint(true); } })),
        stage, status),
      h('div', { class: 're-side' },
        h('h3', null, 'Regions'),
        h('p', { class: 'muted small' }, 'Regions with the same name in several sections count as one group.'),
        errorBox, listEl));

    let dialog = null;
    const done = (saved) => { if (closed) return; closed = true; cancelAnimationFrame(frame); observer.disconnect(); dialog.close(); resolve(saved); };
    dialog = modal({
      title: 'Regions', size: 'full', dismissable: false, body,
      actions: [
        {
          label: 'Cancel',
          onClick: async () => {
            if (dirty && !(await confirmDialog({ title: 'Leave without saving?', message: 'The changes to the regions are lost.', confirmLabel: 'Leave', danger: true }))) return false;
            done(false);
            return false;
          },
        },
        {
          label: 'Save regions', kind: 'primary', icon: 'save',
          onClick: async () => {
            const unnamed = regions.find((r) => !r.name.trim());
            if (unnamed) { mount(errorBox, banner('danger', 'Every region needs a name.')); return false; }
            try {
              await api(`${base}/regions`, {
                method: 'PUT',
                body: { regions: regions.map((r) => ({ ...(r.id ? { id: r.id } : {}), name: r.name.trim(), sample: r.sample, color: r.color, polygons: r.polygons })) },
              });
            } catch (err) {
              mount(errorBox, banner('danger', err.message));
              return false;
            }
            done(true);
            return false;
          },
        },
      ],
    });
    // the dialog settles its size after it opens: the section is fitted again until the user moves or zooms the map
    const observer = new ResizeObserver(() => { if (!view) return; if (autoFit) fitView(); paint(true); });
    observer.observe(stage);
    setTool('polygon');
    mount(status, loading('Loading the section…'));
    paintList();
    // the stage has its size once the dialog is laid out
    requestAnimationFrame(loadSection);
  });
}
