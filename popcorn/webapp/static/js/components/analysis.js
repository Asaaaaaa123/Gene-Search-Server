// analysis.js — the Analysis tab of a run: the place where the user asks the questions. A toolbar ("New analysis",
// Regions, Templates) and a list of cards, newest first; each card is one analysis made with one tool of
// webapp/analysis.py (GET /api/runs/<id>/analysis/context lists the tools, with the form of each, and what the run
// offers them: sections, fields and their values, regions, result tables). A card shows its chart (several kinds per
// tool, switched without computing again), the notes of the tool and its table; its menu edits the settings (the card
// is computed again in place), duplicates, renames, downloads (PNG, SVG, CSV) and deletes it. Cards are kept with the
// run; a set of cards can be kept as a template and applied to another run.
//
//   analysisWorkbench({runId, store, binUm, onShowGenes}) -> {el, destroy()}
//     store: kept by the caller between visits (the results already fetched); binUm: the bin size of the run (maps);
//     onShowGenes(genes): show genes on the map of the Spatial viewer tab.
import {
  h, api, apiUrl, mount, icon, button, menuButton, field, switchToggle, loading, emptyState, errorPanel, banner, toast,
  modal, confirmDialog, promptDialog, fmt, debounce, clone,
} from '../core.js';
import { geneInput, fieldLabel } from './spatial-viewer.js';
import { formatNumber } from './table-viewer.js';
import * as ch from './charts.js';
import { openRegionEditor } from './region-editor.js';
import { userName } from '../auth.js';

const POLL_MS = 1000;
const TABLE_PAGE = 100;
const EXPORT_WIDTH = 960;
const REGION = 'region:';
const GROUP_ICONS = { Expression: 'dna', Composition: 'chart', Space: 'map', Custom: 'table' };
const P_COLUMNS = new Set(['p', 'fdr', 'fisher_p']);   // columns of P values in the result tables

const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
const plural = (n, one, many = `${one}s`) => `${fmt.int(n)} ${n === 1 ? one : many}`;
// what one row of the run is: 'bin', 'spot' or 'cell' (GET /analysis/context unit; set when the context loads)
let UNIT = 'bin';
const units = (n) => (n === 1 ? UNIT : `${UNIT}s`);
const fileName = (s) => String(s || 'analysis').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'analysis';
let seq = 0;
const uid = (p) => `${p}-${(seq += 1)}`;

/** Name of a field in the forms: as the spatial viewer names the per-bin fields. */
function labelOf(f) {
  if (f.key === 'sample') return 'Section';
  if (f.key.startsWith(REGION)) return `Region: ${f.key.slice(REGION.length)}`;
  return fieldLabel(f.key);
}

// ================================================================================================ form controls
/** Checklist of the values of a field. selected: null (every value) or an array. -> {el, get() (null = all)} */
function valuePicker({ fieldDef, selected, allIsNull = true, onChange }) {
  const options = fieldDef.type === 'bool'
    ? [{ value: true, label: cap(fieldDef.text[0]), n: fieldDef.n_true }, { value: false, label: cap(fieldDef.text[1]), n: fieldDef.n_false }]
    : fieldDef.values.map((v) => ({ value: v.value, label: v.label, n: v.n, color: v.color }));
  const chosen = new Set(selected ? options.filter((o) => selected.includes(o.value)).map((o) => o.value) : options.map((o) => o.value));
  const boxes = new Map();
  const count = h('span', { class: 'an-values-count' });
  const paint = () => {
    for (const [value, box] of boxes) box.checked = chosen.has(value);
    count.textContent = chosen.size === options.length ? `all ${options.length}` : `${chosen.size} of ${options.length}`;
  };
  const changed = () => { paint(); if (onChange) onChange(); };
  const list = h('div', { class: 'an-values-list' }, options.map((o) => {
    const box = h('input', { type: 'checkbox' });
    box.addEventListener('change', () => { if (box.checked) chosen.add(o.value); else chosen.delete(o.value); changed(); });
    boxes.set(o.value, box);
    return h('label', { class: 'check an-value', dataset: { text: String(o.label).toLowerCase() } }, box,
      o.color ? h('span', { class: 'swatch', style: { background: o.color } }) : null,
      h('span', { class: 'an-value-label' }, o.label),
      Number.isFinite(o.n) ? h('span', { class: 'an-value-n' }, fmt.int(o.n)) : null);
  }));
  const all = h('button', { type: 'button', class: 'linklike', onClick: () => { options.forEach((o) => chosen.add(o.value)); changed(); } }, 'All');
  const none = h('button', { type: 'button', class: 'linklike', onClick: () => { chosen.clear(); changed(); } }, 'None');
  let filter = null;
  if (options.length > 10) {
    filter = h('input', { class: 'input an-values-filter', type: 'search', placeholder: 'Filter values', 'aria-label': 'Filter values' });
    filter.addEventListener('input', () => {
      const q = filter.value.trim().toLowerCase();
      for (const row of list.children) row.hidden = !!q && !row.dataset.text.includes(q);
    });
  }
  paint();
  return {
    el: h('div', { class: 'an-values' }, options.length > 2 ? h('div', { class: 'an-values-head' }, count, all, none, filter) : null, list),
    get: () => {
      const values = options.filter((o) => chosen.has(o.value)).map((o) => o.value);
      return allIsNull && values.length === options.length ? null : values;
    },
  };
}

/** Gene names with suggestions from the run's data, kept as removable chips. -> {el, get()} */
function genePicker({ search, max, value, placeholder }) {
  let genes = [...(value || [])];
  const chips = h('div', { class: 'pill-list an-genes' });
  const note = h('div', { class: 'help' });
  const paint = () => {
    mount(chips, genes.map((g) => h('span', { class: 'chip' }, g,
      h('button', { type: 'button', title: `Remove ${g}`, 'aria-label': `Remove ${g}`, onClick: () => { genes = genes.filter((x) => x !== g); paint(); } }, icon('x', { size: 12 })))));
    note.textContent = max > 1 ? `${genes.length} of at most ${max}${genes.length ? '' : '. Type or paste names; commas or spaces separate them.'}` : '';
    clearAll.hidden = genes.length < 4;
  };
  const clearAll = h('button', { type: 'button', class: 'linklike', onClick: () => { genes = []; paint(); } }, 'Remove all');
  const box = geneInput({
    label: 'Genes', submitLabel: max > 1 ? 'Add' : 'Choose', placeholder: placeholder || (max > 1 ? 'e.g. Ctsk, Acp5' : 'e.g. Ctsk'),
    search,
    onSubmit: (names) => {
      if (!names.length) return;
      genes = max === 1 ? [names[0]] : [...new Set([...genes, ...names])].slice(0, max);
      box.set('');
      paint();
    },
  });
  paint();
  return {
    el: h('div', { class: 'an-gene-picker' }, box.el, chips, h('div', { class: 'row' }, note, clearAll)),
    // names typed but not added yet count too
    get: () => {
      const typed = box.input.value.split(/[\s,;+]+/).filter(Boolean);
      return max === 1 ? (typed.length ? [typed[0]] : genes) : [...new Set([...genes, ...typed])].slice(0, max);
    },
    destroy: box.destroy,
  };
}

/** A field of the run and the values that count. -> {el, get() -> {field, values?} | null} */
function groupingPicker({ ctx, value, optional, kinds = ['category', 'bool'], noneLabel = 'No split', defaultTrue = false }) {
  const fields = ctx.fields.filter((f) => kinds.includes(f.type));
  const select = h('select', { class: 'select' },
    optional ? h('option', { value: '' }, noneLabel) : null,
    fields.map((f) => h('option', { value: f.key }, labelOf(f))));
  // nothing chosen yet: the cell types, else the tissue classes, else the first field (the sections)
  const preferred = ['assigned_signature', 'tissue_class'].map((k) => fields.find((f) => f.key === k)).find(Boolean) || fields[0];
  const start = value && fields.some((f) => f.key === value.field) ? value.field : (optional ? '' : (preferred ? preferred.key : ''));
  select.value = start;
  const slot = h('div');
  let picker = null;
  const paint = (selected) => {
    const f = fields.find((x) => x.key === select.value);
    picker = f ? valuePicker({ fieldDef: f, selected: selected || (defaultTrue && f.type === 'bool' ? [true] : null), allIsNull: !defaultTrue }) : null;
    mount(slot, picker ? picker.el : null);
  };
  select.addEventListener('change', () => paint(null));
  paint(value && value.field === start ? value.values || null : null);
  return {
    el: h('div', { class: 'an-grouping' }, select, slot),
    get: () => {
      if (!select.value || !picker) return null;
      const values = picker.get();
      return values === null ? { field: select.value } : { field: select.value, values };
    },
  };
}

/** A list of conditions, each a field with values or a gene detected or not. -> {el, get()} */
function conditionsEditor({ ctx, search, value, addLabel = 'Add a condition', emptyText }) {
  const rows = [];
  const list = h('div', { class: 'an-conds' });
  const emptyNote = emptyText ? h('p', { class: 'muted small an-conds-empty' }, emptyText) : null;
  const GENE_YES = '__detects__';
  const GENE_NO = '__lacks__';

  function addRow(cond) {
    const select = h('select', { class: 'select an-cond-field', 'aria-label': 'Condition' },
      h('optgroup', { label: 'Fields' }, ctx.fields.map((f) => h('option', { value: f.key }, labelOf(f)))),
      ctx.expression.available ? h('optgroup', { label: 'Genes' },
        h('option', { value: GENE_YES }, 'Detects a gene'), h('option', { value: GENE_NO }, 'Does not detect a gene')) : null);
    const slot = h('div', { class: 'an-cond-body' });
    const row = { get: () => null };
    const remove = h('button', {
      type: 'button', class: 'btn small ghost icon-only', title: 'Remove this condition', 'aria-label': 'Remove this condition',
      onClick: () => { rows.splice(rows.indexOf(row), 1); el.remove(); paintEmpty(); },
    }, icon('x', { size: 14 }));
    const el = h('div', { class: 'an-cond' }, h('div', { class: 'an-cond-head' }, select, remove), slot);
    const paint = (given) => {
      if (select.value === GENE_YES || select.value === GENE_NO) {
        const picker = genePicker({ search, max: ctx.limits.genes, value: given && given.genes });
        mount(slot, picker.el, h('div', { class: 'help' }, select.value === GENE_YES
          ? 'Bins with at least one UMI of any of these genes.' : 'Bins with no UMI of any of these genes.'));
        row.get = () => ({ genes: picker.get(), detected: select.value === GENE_YES });
        return;
      }
      const f = ctx.fields.find((x) => x.key === select.value);
      const picker = valuePicker({ fieldDef: f, selected: given && given.values ? given.values : (f.type === 'bool' ? [true] : null), allIsNull: false });
      mount(slot, picker.el);
      row.get = () => ({ field: f.key, values: picker.get() });
    };
    if (cond && Array.isArray(cond.genes)) select.value = cond.detected === false ? GENE_NO : GENE_YES;
    else if (cond && ctx.fields.some((f) => f.key === cond.field)) select.value = cond.field;
    else {
      const first = ctx.fields.find((f) => f.key !== 'sample') || ctx.fields[0];
      select.value = first ? first.key : GENE_YES;
    }
    select.addEventListener('change', () => paint(null));
    paint(cond);
    rows.push(row);
    list.append(el);
    paintEmpty();
  }

  function paintEmpty() { if (emptyNote) emptyNote.hidden = rows.length > 0; }
  for (const cond of value || []) addRow(cond);
  paintEmpty();
  return {
    el: h('div', { class: 'an-conds-box' }, emptyNote, list,
      button({ label: addLabel, icon: 'plus', small: true, onClick: () => addRow(null) })),
    get: () => rows.map((r) => r.get()),
  };
}

/** Sections, the region of interest, and conditions. -> {el, get()} */
function scopeEditor({ ctx, search, value }) {
  const given = value || {};
  const hasRoi = ctx.fields.some((f) => f.key === 'in_region_of_interest');
  const sampleField = ctx.fields.find((f) => f.key === 'sample');
  const samples = ctx.samples.length > 1 ? valuePicker({ fieldDef: sampleField, selected: given.samples || null }) : null;
  let roi = !!given.roi && hasRoi;
  const roiSwitch = hasRoi ? switchToggle({ checked: roi, label: `Only the ${units()} of the region of interest`, onChange: (v) => { roi = v; } }) : null;
  const where = conditionsEditor({ ctx, search, value: given.where, addLabel: `Only ${units()} where…` });
  return {
    el: h('div', { class: 'an-scope' },
      samples ? h('div', { class: 'an-scope-part' }, h('div', { class: 'an-sub' }, 'Sections'), samples.el) : null,
      roiSwitch, where.el),
    get: () => {
      const out = {};
      const picked = samples ? samples.get() : null;
      if (picked) out.samples = picked;
      if (roi) out.roi = true;
      const conds = where.get();
      if (conds.length) out.where = conds;
      return Object.keys(out).length ? out : null;
    },
  };
}

/** Composition: a category field and its values, or several yes/no calls. -> {el, get()} */
function countPicker({ ctx, value }) {
  const CALLS = '__calls__';
  const cats = ctx.fields.filter((f) => f.type === 'category' && f.key !== 'sample');
  const calls = ctx.fields.filter((f) => f.type === 'bool');
  const select = h('select', { class: 'select' },
    cats.map((f) => h('option', { value: f.key }, labelOf(f))),
    calls.length ? h('option', { value: CALLS }, 'Yes/no calls (each counted on its own)') : null);
  const given = value || {};
  select.value = Array.isArray(given.calls) ? CALLS
    : (cats.some((f) => f.key === given.field) ? given.field : (cats.find((f) => f.key === 'assigned_signature') || cats[0] || { key: CALLS }).key);
  const slot = h('div');
  let get = () => null;
  const paint = (first) => {
    if (select.value === CALLS) {
      const preset = first && Array.isArray(given.calls) ? given.calls : calls.filter((f) => /^positive_/.test(f.key) && !/_pooled/.test(f.key)).map((f) => f.key);
      const picker = valuePicker({
        fieldDef: { type: 'category', values: calls.map((f) => ({ value: f.key, label: labelOf(f), n: f.n_true, color: f.color })) },
        selected: preset.length ? preset : null, allIsNull: false,
      });
      mount(slot, picker.el);
      get = () => ({ calls: picker.get() });
      return;
    }
    const f = cats.find((x) => x.key === select.value);
    const picker = valuePicker({ fieldDef: f, selected: first && given.field === f.key ? given.values || null : null });
    mount(slot, picker.el);
    get = () => { const values = picker.get(); return values ? { field: f.key, values } : { field: f.key }; };
  };
  select.addEventListener('change', () => paint(false));
  paint(true);
  return { el: h('div', { class: 'an-grouping' }, select, slot), get: () => get() };
}

// ================================================================================================ result table
/** The table of a result ({columns, rows, data} by column), sorted and paged in the browser. */
function resultTable(table, { onGene } = {}) {
  const cols = table.columns || [];
  const n = table.rows || 0;
  let order = Array.from({ length: n }, (_, i) => i);
  let sortKey = null;
  let desc = false;
  let page = 0;
  let query = '';
  const wrap = h('div', { class: 'table-wrap an-table-wrap' });
  const count = h('span', { class: 'tv-count' });
  const prev = button({ icon: 'chevron-left', small: true, title: 'Previous page', onClick: () => { page -= 1; paint(); } });
  const next = button({ icon: 'chevron-right', small: true, title: 'Next page', onClick: () => { page += 1; paint(); } });
  const textCols = cols.filter((c) => c.type === 'text').map((c) => c.key);
  const search = textCols.length && n > 20 ? h('input', { class: 'input an-table-search', type: 'search', placeholder: 'Search', 'aria-label': 'Search the table' }) : null;

  function rows() {
    if (!query) return order;
    return order.filter((i) => textCols.some((k) => String(table.data[k][i] ?? '').toLowerCase().includes(query)));
  }

  function sortBy(key) {
    if (sortKey === key) desc = !desc; else { sortKey = key; desc = false; }
    const values = table.data[key];
    const numeric = cols.find((c) => c.key === key).type !== 'text';
    order = Array.from({ length: n }, (_, i) => i).sort((a, b) => {
      const x = values[a];
      const y = values[b];
      if (x === null || x === undefined) return y === null || y === undefined ? a - b : 1;   // empty cells last
      if (y === null || y === undefined) return -1;
      const d = numeric ? Number(x) - Number(y) : String(x).localeCompare(String(y), undefined, { numeric: true });
      return (desc ? -d : d) || a - b;
    });
    page = 0;
    paint();
  }

  function cell(c, i) {
    const v = table.data[c.key][i];
    if (v === null || v === undefined) return h('td', { class: c.type === 'text' ? 'tv-null' : 'num tv-null' }, '—');
    if (c.type === 'bool') return h('td', { class: 'tv-bool' }, v ? '✓' : '–');
    if (c.type === 'text') {
      if (c.key === 'gene' && onGene) {
        return h('td', null, h('button', { type: 'button', class: 'linklike an-gene-link', title: `Show ${v} on the map`, onClick: () => onGene(String(v)) }, String(v)));
      }
      return h('td', null, String(v));
    }
    // a P value too small for a number: the test statistic is beyond what floating point can turn into a probability
    if (v === 0 && P_COLUMNS.has(c.key)) return h('td', { class: 'num', title: 'Smaller than the smallest number the computer can hold' }, '< 1e-300');
    const shown = formatNumber(v);
    return h('td', { class: 'num', title: String(v) !== shown ? String(v) : null }, shown);
  }

  function paint() {
    const list = rows();
    const pages = Math.max(1, Math.ceil(list.length / TABLE_PAGE));
    page = Math.max(0, Math.min(page, pages - 1));
    const shown = list.slice(page * TABLE_PAGE, (page + 1) * TABLE_PAGE);
    mount(wrap, h('table', { class: 'table compact tv-table' },
      h('thead', null, h('tr', null, cols.map((c) => h('th', {
        class: [c.type === 'text' ? '' : 'num', 'sortable', sortKey === c.key ? 'tv-sorted' : ''], scope: 'col',
        'aria-sort': sortKey === c.key ? (desc ? 'descending' : 'ascending') : 'none',
      }, h('button', { class: 'tv-sort', type: 'button', title: `Sort by ${c.label}`, onClick: () => sortBy(c.key) },
        h('span', null, c.label), icon(sortKey === c.key && desc ? 'chevron-down' : 'chevron-up', { size: 13, cls: sortKey === c.key ? 'tv-sort-icon on' : 'tv-sort-icon' })))))),
      h('tbody', null, shown.length ? shown.map((i) => h('tr', null, cols.map((c) => cell(c, i))))
        : h('tr', null, h('td', { class: 'tv-norows', colSpan: cols.length }, query ? 'No row matches.' : 'This table has no rows.')))));
    count.textContent = list.length
      ? `Rows ${fmt.int(page * TABLE_PAGE + 1)}–${fmt.int(page * TABLE_PAGE + shown.length)} of ${fmt.int(list.length)}` : '';
    prev.disabled = page <= 0;
    next.disabled = page >= pages - 1;
  }

  if (search) {
    search.addEventListener('input', debounce(() => { query = search.value.trim().toLowerCase(); page = 0; paint(); }, 200));
  }
  paint();
  return h('div', { class: 'stack an-table' },
    h('div', { class: 'tv-toolbar' }, search, h('span', { class: 'spacer' }), count,
      n > TABLE_PAGE ? h('div', { class: 'tv-pager', role: 'group', 'aria-label': 'Pages' }, prev, next) : null), wrap);
}

// ================================================================================================ how each tool is drawn
// A renderer turns a result and the card's view settings into {kinds: [[id, label]] (the charts offered), kind (the
// one shown), facts: [text] (a line above the chart), options: [nodes] (controls of this chart), draw(width, theme) ->
// an <svg>, a canvas or a Promise of one}. `set(patch)` changes the view settings and draws again.
const matrix = (stats, pick) => stats.map((s) => s.groups.map(pick));

function selectControl(label, value, options, onChange) {
  const id = uid('an-opt');
  const sel = h('select', { class: 'select', id }, options.map(([v, text]) => h('option', { value: String(v) }, text)));
  sel.value = String(value);
  sel.addEventListener('change', () => onChange(sel.value));
  return h('label', { class: 'an-opt', for: id }, h('span', null, label), sel);
}

function numberControl(label, value, { min, max, step }, onChange) {
  const id = uid('an-opt');
  const input = h('input', { class: 'input', id, type: 'number', min, max, step, value });
  input.addEventListener('change', () => {
    const v = Number(input.value);
    if (Number.isFinite(v) && v >= min && v <= max) onChange(v); else input.value = value;
  });
  return h('label', { class: 'an-opt', for: id }, h('span', null, label), input);
}

function distributionTip(label, d, valueName, withDetection) {
  return [label, `${fmt.int(d.n)} ${units(d.n)}`, withDetection && d.pct !== null && d.pct !== undefined ? `${ch.num(d.pct, 1)}% detect it` : null,
    `mean ${valueName}: ${ch.num(d.mean)}`, `median: ${ch.num(d.q[3])}`, `25th–75th percentile: ${ch.num(d.q[2])}–${ch.num(d.q[4])}`]
    .filter(Boolean).join('\n');
}

const RENDERERS = {
  expression(res, view, set) {
    // many genes or groups: the dot plot reads at a glance; a few: the distributions themselves
    const kind = ['violin', 'box', 'dot', 'heatmap', 'bars'].includes(view.chart) ? view.chart
      : (res.genes.length > 6 || res.groups.length > 8 ? 'dot' : 'violin');
    const groups = res.groups.map((g) => g.label);
    const options = [];
    if (kind === 'dot') options.push(switchToggle({ checked: !!view.perRow, label: 'Each gene on its own color scale', onChange: (v) => set({ perRow: v }) }));
    if (kind === 'heatmap') options.push(switchToggle({ checked: view.zscore !== false, label: 'Compare the groups within each gene (z-score)', onChange: (v) => set({ zscore: v }) }));
    return {
      kinds: [['violin', 'Violins'], ['box', 'Boxes'], ['dot', 'Dot plot'], ['heatmap', 'Heatmap'], ['bars', '% detecting']], kind, options,
      facts: [`${plural(res.genes.length, 'gene')} in ${plural(res.groups.length, 'group')}`, res.scope],
      draw(width, theme) {
        if (kind === 'violin' || kind === 'box') {
          return ch.distributions({
            mode: kind, groups: res.groups, yLabel: 'Expression', width, theme,
            panels: res.stats.map((s) => ({
              title: s.gene, lo: 0, hi: s.max,
              groups: s.groups.map((d, i) => ({ ...d, tip: distributionTip(`${s.gene} · ${groups[i]}`, d, 'expression', true) })),
            })),
          });
        }
        if (kind === 'dot') {
          return ch.dotPlot({ rows: res.genes, cols: groups, size: matrix(res.stats, (d) => d.pct), color: matrix(res.stats, (d) => d.mean), perRow: !!view.perRow, width, theme });
        }
        if (kind === 'heatmap') {
          let values = matrix(res.stats, (d) => d.mean);
          const z = view.zscore !== false && groups.length > 1;
          if (z) {
            values = values.map((row) => {
              const ok = row.filter(Number.isFinite);
              const m = ok.reduce((a, b) => a + b, 0) / (ok.length || 1);
              const sd = Math.sqrt(ok.reduce((a, b) => a + (b - m) ** 2, 0) / (ok.length || 1));
              return row.map((v) => (Number.isFinite(v) && sd > 0 ? (v - m) / sd : (Number.isFinite(v) ? 0 : null)));
            });
          }
          return ch.heatmap({
            rows: res.genes, cols: groups, values, kind: z ? 'diverging' : 'sequential', label: z ? 'Mean expression, z-score within the gene' : 'Mean expression', width, theme,
            tips: (i, j) => distributionTip(`${res.genes[i]} · ${groups[j]}`, res.stats[i].groups[j], 'expression', true),
          });
        }
        return ch.bars({
          categories: groups, yLabel: `% of ${units()} detecting`, width, theme,
          series: res.stats.map((s) => ({ label: s.gene, values: s.groups.map((d) => d.pct), tips: s.groups.map((d, i) => distributionTip(`${s.gene} · ${groups[i]}`, d, 'expression', true)) })),
        });
      },
    };
  },

  de(res, view, set) {
    const kind = view.chart === 'top' ? 'top' : 'volcano';
    const maxFdr = Number.isFinite(view.maxFdr) ? view.maxFdr : 0.05;
    const minEffect = Number.isFinite(view.minEffect) ? view.minEffect : 1;
    const d = res.table.data;
    return {
      kinds: [['volcano', 'Volcano'], ['top', 'Top genes']], kind,
      facts: [`A: ${res.a.label} (${plural(res.a.n, UNIT)})`, `B: ${res.b.label} (${plural(res.b.n, UNIT)})`,
        `${plural(res.n_tested, 'gene')} tested, ${res.method}`],
      options: [
        numberControl('FDR at most', maxFdr, { min: 0, max: 1, step: 0.01 }, (v) => set({ maxFdr: v })),
        numberControl('|log2 fold change| at least', minEffect, { min: 0, max: 20, step: 0.25 }, (v) => set({ minEffect: v })),
      ],
      draw(width, theme) {
        if (kind === 'volcano') {
          return ch.volcano({
            points: { x: d.log2fc, p: d.p, fdr: d.fdr, label: d.gene }, maxFdr, minEffect, width, theme,
            xLabel: 'log2 fold change (A over B)', aLabel: 'A', bLabel: 'B',
            tip: (i) => `${d.gene[i]}\nlog2 fold change: ${ch.num(d.log2fc[i])}\nP: ${ch.num(d.p[i])}   FDR: ${ch.num(d.fdr[i])}\ndetected in ${ch.num(d.pct_a[i], 1)}% of A, ${ch.num(d.pct_b[i], 1)}% of B`,
          });
        }
        const pass = d.gene.map((_, i) => i).filter((i) => Number.isFinite(d.fdr[i]) && d.fdr[i] <= maxFdr && Math.abs(d.log2fc[i]) >= minEffect);
        const up = pass.filter((i) => d.log2fc[i] > 0).sort((a, b) => d.log2fc[b] - d.log2fc[a]).slice(0, 15);
        const down = pass.filter((i) => d.log2fc[i] < 0).sort((a, b) => d.log2fc[a] - d.log2fc[b]).slice(0, 15);
        return ch.rankedBars({
          items: [...up, ...down.reverse()].map((i) => ({
            label: d.gene[i], value: d.log2fc[i], color: d.log2fc[i] > 0 ? '#e5604f' : '#4a90d9',
            tip: `${d.gene[i]}\nFDR: ${ch.num(d.fdr[i])}\ndetected in ${ch.num(d.pct_a[i], 1)}% of A, ${ch.num(d.pct_b[i], 1)}% of B`,
          })),
          xLabel: 'log2 fold change (A over B)', width, theme,
        });
      },
    };
  },

  composition(res, view) {
    const fallback = res.exclusive ? 'stacked' : 'grouped';
    const kind = ['stacked', 'grouped', 'heatmap'].includes(view.chart) ? view.chart : fallback;
    const groups = res.groups.map((g) => g.label);
    const tips = (k) => res.cells.map((c, i) => `${groups[i]} · ${res.series[k].label}\n${fmt.int(c.n[k])} of ${fmt.int(c.total)} ${units()} (${ch.num(c.pct[k], 2)}%)\n95% interval: ${ch.num(c.lo[k], 2)}–${ch.num(c.hi[k], 2)}%`);
    return {
      kinds: res.exclusive ? [['stacked', 'Stacked bars'], ['grouped', 'Side by side'], ['heatmap', 'Heatmap']] : [['grouped', 'Bars'], ['heatmap', 'Heatmap']],
      kind: !res.exclusive && kind === 'stacked' ? 'grouped' : kind,
      facts: [`${cap(res.what)} across ${plural(groups.length, 'group')}`, res.scope],
      options: [],
      draw(width, theme) {
        const k = !res.exclusive && kind === 'stacked' ? 'grouped' : kind;
        if (k === 'heatmap') {
          return ch.heatmap({
            rows: res.series.map((s) => s.label), cols: groups, values: res.series.map((_, j) => res.cells.map((c) => c.pct[j])),
            label: `% of ${units()}`, digits: 1, width, theme, tips: (i, j) => tips(i)[j],
          });
        }
        return ch.bars({
          categories: groups, stacked: k === 'stacked', yLabel: `% of ${units()}`, max: k === 'stacked' ? 100 : undefined, width, theme,
          series: res.series.map((s, j) => ({
            label: s.label, color: s.color, values: res.cells.map((c) => c.pct[j]), tips: tips(j),
            lo: k === 'stacked' ? null : res.cells.map((c) => c.lo[j]), hi: k === 'stacked' ? null : res.cells.map((c) => c.hi[j]),
          })),
        });
      },
    };
  },

  coexpression(res, view, set) {
    const nShown = Number.isFinite(view.n) ? view.n : 20;
    const d = res.table.data;
    const total = d.gene.length;
    return {
      kinds: [], kind: 'bars',
      facts: [`Genes that follow ${res.gene}`, `${plural(res.n, UNIT)}, ${res.gene} detected in ${fmt.int(res.n_detected)}`, res.scope],
      options: [selectControl('Show', view.side || 'both', [['both', 'Most and least correlated'], ['top', 'Most correlated'], ['bottom', 'Least correlated']], (v) => set({ side: v })),
        numberControl('Genes', nShown, { min: 5, max: 60, step: 5 }, (v) => set({ n: v }))],
      draw(width, theme) {
        const side = view.side || 'both';
        const k = side === 'both' ? Math.ceil(nShown / 2) : nShown;
        const top = side === 'bottom' ? [] : Array.from({ length: Math.min(k, total) }, (_, i) => i);
        const bottom = side === 'top' ? [] : Array.from({ length: Math.min(k, Math.max(0, total - top.length)) }, (_, i) => total - 1 - i).reverse();
        return ch.rankedBars({
          items: [...top, ...bottom].map((i) => ({
            label: d.gene[i], value: d.r[i], color: d.r[i] >= 0 ? '#e5604f' : '#4a90d9',
            tip: `${d.gene[i]}\nPearson r with ${res.gene}: ${ch.num(d.r[i])}\nFDR: ${ch.num(d.fdr[i])}\ndetected in ${ch.num(d.pct_detected[i], 1)}% of the ${units()}`,
          })),
          xLabel: `Pearson r with ${res.gene}`, width, theme,
        });
      },
    };
  },

  gene_pair(res) {
    const o = res.overall;
    return {
      kinds: [], kind: 'density', options: [],
      facts: [`Pearson r ${ch.num(o.r)}, Spearman rho ${ch.num(o.rho)}`,
        `${fmt.int(o.both)} ${units()} detect both, ${fmt.int(o.only_x)} only ${res.x}, ${fmt.int(o.only_y)} only ${res.y}, ${fmt.int(o.neither)} neither`,
        `odds ratio ${ch.num(o.odds_ratio, 2)}`, res.scope],
      draw: (width, theme) => ch.density2d({ grid: res.density, maxX: res.max_x, maxY: res.max_y, xLabel: `${res.x} expression`, yLabel: `${res.y} expression`, width, theme }),
    };
  },

  distance(res, view) {
    const kind = view.chart === 'histograms' ? 'histograms' : 'ratio';
    const d = res.table.data;
    const hasNull = res.n_perm > 0;
    return {
      kinds: hasNull ? [['ratio', 'Observed over null'], ['histograms', 'Distances']] : [['histograms', 'Distances']],
      kind: hasNull ? kind : 'histograms', options: [],
      facts: [`From ${res.a}`, `to the nearest ${res.b}`, hasNull ? `${res.n_perm} random placements` : 'no null', res.scope],
      draw(width, theme) {
        if (hasNull && kind === 'ratio') {
          return ch.forest({
            xLabel: 'Observed mean distance over the null mean (below 1: closer than chance)', width, theme,
            rows: d.section.map((label, i) => ({
              label, value: d.ratio[i], lo: d.ratio_lo[i], hi: d.ratio_hi[i],
              note: d.status[i] === 'estimable' ? `${ch.num(d.ratio[i], 2)}  (P ${ch.num(d.ratio[i] < 1 ? d.p_closer[i] : d.p_farther[i], 3)})` : 'not estimable',
              tip: `${label}\nobserved mean ${ch.num(d.mean_um[i], 1)} µm, null mean ${ch.num(d.null_mean_um[i], 1)} µm\n${fmt.int(d.n_a[i])} A ${units()}, ${fmt.int(d.n_b[i])} B ${units()}`,
            })),
          });
        }
        return ch.histograms({ panels: res.histograms.map((p) => ({ title: p.section, edges: p.edges, observed: p.observed, null: p.null })), xLabel: `Distance to the nearest B ${UNIT} (µm)`, width, theme });
      },
    };
  },

  neighborhood(res, view, set) {
    const at = Math.max(0, Math.min(res.sections.length - 1, Number(view.section) || 0));
    const names = res.categories.map((c) => c.label);
    const sec = res.sections[at];
    return {
      kinds: [], kind: 'heatmap',
      facts: [`${res.field}: ${plural(names.length, 'category', 'categories')}`, `${res.k} neighbors per ${UNIT}, ${res.n_perm} shuffles`, res.scope],
      options: res.sections.length > 1 ? [selectControl('Section', at, res.sections.map((s, i) => [i, s.section]), (v) => set({ section: Number(v) }))] : [],
      draw: (width, theme) => ch.heatmap({
        rows: names, cols: names, values: sec.z, kind: 'diverging', label: 'z (above 0: neighbors more often than chance)', digits: 1,
        rowTitle: 'Bin', colTitle: 'Its neighbors', width, theme,
        tips: (i, j) => `${names[i]} next to ${names[j]}\n${fmt.int(sec.observed[i][j])} neighbor pairs\nz: ${sec.z[i][j] === null ? 'not available' : ch.num(sec.z[i][j], 2)}`,
      }),
    };
  },

  score(res, view, set, env) {
    // a score is mostly near zero with a few high bins: where they lie says more than the shape of the distribution
    const kind = ['violin', 'box', 'map'].includes(view.chart) ? view.chart : 'map';
    const groups = res.groups.map((g) => g.label);
    return {
      kinds: [['map', 'Map'], ['violin', 'Violins'], ['box', 'Boxes']], kind, options: [],
      facts: [`${plural(res.genes.length, 'gene')} against ${plural(res.n_control, 'control gene')}`, res.scope],
      draw(width, theme) {
        if (kind !== 'map') {
          return ch.distributions({
            mode: kind, groups: res.groups, yLabel: 'Score', width, theme,
            panels: [{ title: res.name, lo: res.min, hi: res.max, groups: res.stats.map((d, i) => ({ ...d, tip: distributionTip(groups[i], d, 'score', false) })) }],
          });
        }
        return env.scoreMaps(res, width, theme);
      },
    };
  },

  svg(res, view, set) {
    const done = res.sections.filter((s) => s.status === 'done').map((s) => s.section);
    const section = done.includes(view.section) ? view.section : done[0];
    const nShown = Number.isFinite(view.n) ? view.n : 25;
    const d = res.table.data;
    return {
      kinds: [], kind: 'bars',
      facts: [res.sections.map((s) => (s.status === 'done' ? `${s.section}: ${fmt.int(s.n_tested)} genes tested, ${fmt.int(s.n_significant)} with FDR ≤ 0.05` : `${s.section}: ${s.status}`)).join(' · '),
        res.n_shared ? `${fmt.int(res.n_shared)} genes are in the top ${res.top} of every section` : null, res.scope].filter(Boolean),
      options: [done.length > 1 ? selectControl('Section', section, done.map((s) => [s, s]), (v) => set({ section: v })) : null,
        numberControl('Genes', nShown, { min: 5, max: 60, step: 5 }, (v) => set({ n: v }))].filter(Boolean),
      draw(width, theme) {
        const rows = d.section.map((_, i) => i).filter((i) => d.section[i] === section).slice(0, nShown);
        return ch.rankedBars({
          items: rows.map((i) => ({ label: d.gene[i], value: d.I[i], tip: `${d.gene[i]}\nMoran's I: ${ch.num(d.I[i])}\nFDR: ${ch.num(d.fdr[i])}\ndetected in ${ch.num(d.pct_detected[i], 1)}% of the ${units()}` })),
          xLabel: `Moran's I — ${section}`, width, theme,
        });
      },
    };
  },

  table_chart(res) {
    const d = res.table.data;
    return {
      kinds: [], kind: res.kind, options: [],
      facts: [res.file, `${fmt.int(res.n_rows)} rows`],
      draw: (width, theme) => ch.xyChart({
        x: d[res.x], y: d[res.y], color: res.color ? d[res.color] : null, labels: res.label ? d[res.label] : null,
        kind: res.kind, xLabel: res.x, yLabel: res.y, colorLabel: res.color, width, theme,
      }),
    };
  },
};

/** A title for a new card from its settings. */
function suggestTitle(tool, p, ctx) {
  const name = (key) => { const f = ctx.fields.find((x) => x.key === key); return f ? labelOf(f) : key; };
  const condText = (conds) => (conds || []).map((c) => {
    if (Array.isArray(c.genes)) return `${c.detected === false ? 'no ' : ''}${c.genes.slice(0, 3).join('/')}`;
    const f = ctx.fields.find((x) => x.key === c.field);
    if (!f) return c.field;
    if (f.type === 'bool') return `${(c.values || [true]).includes(true) ? '' : 'not '}${name(c.field).replace(/^(Positive|Region): /, '')}`;
    const vals = (c.values || []).map((v) => { const o = f.values.find((x) => x.value === v); return o ? o.label : v; });
    return vals.length > 3 ? `${vals.slice(0, 3).join(', ')}…` : vals.join(', ');
  }).join(' and ');
  const genes = (list) => (list || []).slice(0, 4).join(', ') + ((list || []).length > 4 ? '…' : '');
  switch (tool.id) {
    case 'expression': return `${genes(p.genes)} by ${p.group_by ? name(p.group_by.field) : 'group'}`;
    case 'de': return `${condText(p.a) || 'A'} vs ${p.b && p.b.length ? condText(p.b) : 'the rest'}`;
    case 'composition': return `${p.count && p.count.field ? name(p.count.field) : 'Positive calls'} by ${p.across ? name(p.across.field) : 'section'}`;
    case 'coexpression': return `Genes that follow ${genes(p.gene)}`;
    case 'gene_pair': return `${genes(p.x)} and ${genes(p.y)}`;
    case 'score': return p.name || `Score of ${genes(p.genes)}`;
    case 'distance': return `${condText(p.a) || 'A'} to ${condText(p.b) || 'B'}`;
    case 'neighborhood': return `Neighbors by ${p.field ? name(p.field.field) : 'category'}`;
    case 'svg': return 'Spatially variable genes';
    case 'table_chart': return p.file ? `${p.y} by ${p.x}` : tool.title;
    default: return tool.title;
  }
}

// ================================================================================================ the tab
// canEdit false (another user's run, webapp/auth.py): the cards are shown and downloaded, and a chart may be switched
// for oneself, but nothing is added, changed, kept or deleted; `owner` names whose run it is.
export function analysisWorkbench({ runId, store, binUm, onShowGenes, canEdit = true, owner = null }) {
  const enc = encodeURIComponent(runId);
  const base = `/api/runs/${enc}`;
  if (!(store.results instanceof Map)) store.results = new Map();    // card id -> its result, once fetched
  if (!(store.bins instanceof Map)) store.bins = new Map();          // section -> its bins (x, y), for the maps
  let ctx = null;
  let alive = true;
  let poller = null;
  const views = new Map();                                            // card id -> its view on the page
  const listEl = h('div', { class: 'an-cards' });
  const toolbarEl = h('div', { class: 'an-toolbar' });
  const noteEl = h('div');
  const el = h('div', { class: 'an' }, loading('Loading the analyses…'));
  const removeTips = ch.attachTips(el);
  const seen = typeof IntersectionObserver === 'function' ? new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting && e.target.anView) e.target.anView.shown();
  }, { rootMargin: '300px' }) : null;

  const searchGenes = (query, signal, offset = 0) => api(`${base}/genes`, {
    query: { sample: ctx.samples[0].id, query, limit: 100, offset }, signal,
  }).then((r) => (r && Array.isArray(r.genes) ? r.genes : []));

  const toolOf = (id) => (ctx ? ctx.tools.find((t) => t.id === id) : null);

  // ---------------------------------------------------------------- forms
  /** The dialog of a tool: `params` to start from; resolves to the card made (or computed again), or null. */
  function openForm({ tool, params = {}, title = '', card = null }) {
    return new Promise((resolve) => {
      const getters = [];
      const destroyers = [];
      const errorBox = h('div');
      const titleInput = h('input', { class: 'input', maxlength: 120, value: title, placeholder: 'Named after its settings when left empty' });
      const main = h('div', { class: 'an-form' });
      const advanced = h('div', { class: 'an-form' });

      for (const p of tool.params) {
        const given = params[p.key] !== undefined ? params[p.key] : p.default;
        let control;
        let get;
        if (p.type === 'genes' || p.type === 'gene') {
          const picker = genePicker({ search: searchGenes, max: p.type === 'gene' ? 1 : p.max, value: Array.isArray(given) ? given : (given ? [given] : []) });
          destroyers.push(picker.destroy);
          control = picker.el;
          get = () => (p.type === 'gene' ? picker.get()[0] || '' : picker.get());
        } else if (p.type === 'grouping') {
          const picker = groupingPicker({ ctx, value: given, optional: !!p.optional });
          control = picker.el;
          get = picker.get;
        } else if (p.type === 'category') {
          const picker = groupingPicker({ ctx, value: given || { field: 'tissue_class' }, kinds: ['category'] });
          control = picker.el;
          get = picker.get;
        } else if (p.type === 'conditions') {
          const editor = conditionsEditor({ ctx, search: searchGenes, value: given, emptyText: p.required ? null : `No condition: every other ${UNIT} of the scope.` });
          control = editor.el;
          get = editor.get;
          if (p.required && !(given && given.length)) control.querySelector('button.btn').click();
        } else if (p.type === 'scope') {
          const editor = scopeEditor({ ctx, search: searchGenes, value: given });
          control = editor.el;
          get = editor.get;
        } else if (p.type === 'count') {
          const picker = countPicker({ ctx, value: given });
          control = picker.el;
          get = picker.get;
        } else if (p.type === 'choice') {
          control = h('select', { class: 'select' }, p.options.map(([v, text]) => h('option', { value: v }, text)));
          control.value = given ?? p.default;
          get = () => control.value;
        } else if (p.type === 'bool') {
          let on = given === true;
          control = switchToggle({ checked: on, label: p.label, onChange: (v) => { on = v; } });
          get = () => on;
        } else if (p.type === 'int' || p.type === 'float') {
          control = h('input', { class: 'input an-number', type: 'number', min: p.min, max: p.max, step: p.step || (p.type === 'int' ? 1 : 'any'), value: given ?? '' });
          get = () => (control.value === '' ? undefined : Number(control.value));
        } else if (p.type === 'table') {
          control = h('select', { class: 'select' }, h('option', { value: '' }, 'Choose a table'), ctx.tables.map((t) => h('option', { value: t.file }, `${t.title} (${t.file})`)));
          control.value = given || '';
          control.dataset.role = 'table';
          get = () => control.value;
        } else if (p.type === 'column') {
          control = h('select', { class: 'select', disabled: true }, h('option', { value: '' }, p.optional ? 'None' : 'Choose a table first'));
          control.dataset.role = 'column';
          control.dataset.given = given || '';
          control.dataset.optional = p.optional ? '1' : '';
          control.dataset.numeric = p.numeric ? '1' : '';
          get = () => control.value || undefined;
        } else {
          control = h('input', { class: 'input', value: given ?? '', maxlength: 120 });
          get = () => control.value.trim() || undefined;
        }
        getters.push([p.key, get]);
        (p.advanced ? advanced : main).append(field({ label: p.type === 'bool' ? null : p.label, help: p.help, control }));
      }

      // a chart of a table: its columns once the table is chosen
      const tableSelect = main.querySelector('select[data-role="table"]');
      if (tableSelect) {
        const fill = async () => {
          const selects = [...main.querySelectorAll('select[data-role="column"]')];
          let columns = [];
          let dtypes = {};
          if (tableSelect.value) {
            try {
              const t = await api(`${base}/table`, { query: { file: tableSelect.value, limit: 1 } });
              columns = t.columns || [];
              dtypes = t.dtypes || {};
            } catch (err) { mount(errorBox, banner('danger', err.message)); }
          }
          for (const sel of selects) {
            const usable = sel.dataset.numeric ? columns.filter((c) => dtypes[c] === 'number') : columns;
            mount(sel, sel.dataset.optional ? h('option', { value: '' }, 'None') : null, usable.map((c) => h('option', { value: c }, c)));
            sel.disabled = !usable.length;
            if (usable.includes(sel.dataset.given)) sel.value = sel.dataset.given;
          }
        };
        tableSelect.addEventListener('change', fill);
        fill();
      }

      let settled = false;
      const finish = (value) => { if (!settled) { settled = true; destroyers.forEach((d) => d()); resolve(value); } };
      modal({
        title: card ? `${tool.title}: settings` : tool.title, size: 'wide',
        body: h('div', { class: 'stack-lg' },
          h('p', { class: 'muted an-form-lead' }, tool.summary), errorBox, main,
          advanced.children.length ? h('details', { class: 'an-advanced' }, h('summary', null, 'More settings'), advanced) : null,
          field({ label: 'Title', control: titleInput })),
        onClose: () => finish(null),
        actions: [
          { label: 'Cancel' },
          {
            label: card ? 'Compute again' : 'Run', kind: 'primary', icon: 'play',
            onClick: async () => {
              const values = {};
              for (const [key, get] of getters) {
                const v = get();
                if (v !== undefined && v !== null && v !== '') values[key] = v;
              }
              const name = titleInput.value.trim() || suggestTitle(tool, values, ctx);
              try {
                const made = card
                  ? await api(`${base}/analyses/${card.id}/rerun`, { method: 'POST', body: { params: values, title: name } })
                  : await api(`${base}/analyses`, { method: 'POST', body: { tool: tool.id, params: values, title: name.slice(0, 120) } });
                finish(made);
                return true;
              } catch (err) {
                mount(errorBox, banner('danger', [h('strong', null, 'This cannot be computed as asked. '), err.message]));
                errorBox.scrollIntoView({ block: 'nearest' });
                return false;
              }
            },
          },
        ],
      });
    });
  }

  async function newAnalysis(tool, params, title) {
    const made = await openForm({ tool, params, title });
    if (made && alive) adopt(made, true);
  }

  // ---------------------------------------------------------------- cards
  function cardView(meta) {
    let card = meta;
    let result = store.results.get(card.id) || null;
    let fetching = false;
    let drawn = null;        // {kind, width} of the chart on the page
    let resizer = null;
    const titleEl = h('h2', { class: 'an-title' });
    const subEl = h('div', { class: 'card-sub' });
    const kindsEl = h('div', { class: 'btn-group an-kinds', role: 'group', 'aria-label': 'Chart' });
    const bodyEl = h('div', { class: 'card-body an-body' });
    const root = h('section', { class: 'card an-card' },
      h('div', { class: 'card-header' }, h('div', { class: 'card-titles' }, titleEl, subEl),
        h('div', { class: 'row' }, kindsEl, menuButton({ title: 'Analysis actions', items: menuItems }))),
      bodyEl);
    const chartEl = h('div', { class: 'an-chart' });
    const saveView = debounce(() => {
      if (!canEdit) return;   // another user's card: the chart is switched for this page only
      api(`${base}/analyses/${card.id}`, { method: 'PUT', body: { view: card.view || {} } }).catch(() => {});
    }, 600);

    const env = {
      /** The maps of a score: one canvas per section, on one color scale. */
      async scoreMaps(res, width, theme) {
        const maps = await Promise.all(res.maps.map(async (m) => {
          if (!store.bins.has(m.sample)) store.bins.set(m.sample, api(`${base}/bins`, { query: { sample: m.sample } }));
          const [bins, values] = await Promise.all([store.bins.get(m.sample),
            api(`${base}/analyses/${card.id}/values`, { query: { name: m.array } })]);
          return { label: m.label, x: bins.x, y: bins.y, values: values.values };
        }));
        const all = maps.flatMap((m) => m.values.filter((v) => v !== null)).sort((a, b) => a - b);
        const lo = all.length ? all[Math.floor(0.01 * (all.length - 1))] : 0;
        const hi = all.length ? all[Math.ceil(0.99 * (all.length - 1))] : 1;
        const each = Math.max(220, Math.floor((width - 16 * (maps.length - 1)) / maps.length));
        const box = h('div', { class: 'an-maps' }, maps.map((m) => h('figure', { class: 'an-map' },
          ch.spatialMap({ x: m.x, y: m.y, values: m.values, binUm, lo, hi, width: Math.min(each, 560), theme }),
          h('figcaption', null, m.label))));
        const legendEl = h('div', { class: 'an-map-legend' }, h('span', null, `${res.name}: score`), h('span', { class: 'an-map-bar' }),
          h('span', null, `${ch.num(lo, 2)} to ${ch.num(hi, 2)} (1st to 99th percentile; ${units()} outside the scope in gray)`));
        legendEl.querySelector('.an-map-bar').style.background = `linear-gradient(90deg, ${[0, 0.25, 0.5, 0.75, 1].map((t) => ch.sequential(t, theme)).join(', ')})`;
        box.append(legendEl);
        return box;
      },
    };

    function model() {
      const make = RENDERERS[card.tool];
      if (!make || !result) return null;
      return make(result, card.view || {}, (patch) => {
        card = { ...card, view: { ...(card.view || {}), ...patch } };
        saveView();
        paintBody();
      }, env);
    }

    function setKind(kind) {
      card = { ...card, view: { ...(card.view || {}), chart: kind } };
      saveView();
      paintBody();
    }

    async function drawChart(m, width) {
      const token = (drawn = { kind: m.kind, width, view: JSON.stringify(card.view || {}) });
      try {
        const node = await m.draw(Math.max(280, width), ch.screenTheme());
        if (drawn === token && alive) mount(chartEl, node);
      } catch (err) {
        if (drawn === token) mount(chartEl, errorPanel(err));
      }
    }

    function paintHead() {
      const tool = toolOf(card.tool);
      titleEl.textContent = card.title || (tool ? tool.title : card.tool);
      const parts = [tool ? tool.title : card.tool];
      if (card.status === 'done' && Number.isFinite(card.seconds)) parts.push(card.seconds < 1 ? 'under a second' : fmt.duration(card.seconds));
      parts.push(fmt.ago(card.created));
      const maker = userName(card.created_by);
      if (maker) parts.push(`by ${maker}`);
      // changed after it was made (renamed, other settings, computed again): by whom
      const changer = card.changed_by;
      if (userName(changer) && changer.at && changer.at !== card.created) parts.push(`changed by ${userName(changer)}, ${fmt.ago(changer.at)}`);
      subEl.textContent = parts.join(' · ');
    }

    function paintBody() {
      paintHead();
      mount(kindsEl);
      if (card.status === 'running') {
        drawn = null;
        mount(bodyEl, h('div', { class: 'an-wait' }, h('span', { class: 'spinner' }), h('span', null, 'Computing… this card fills in when it is done.')));
        return;
      }
      if (card.status === 'failed') {
        drawn = null;
        mount(bodyEl, h('div', { class: 'banner danger an-failed', role: 'alert' }, icon('alert', { size: 18 }),
          h('div', { class: 'banner-body' }, h('strong', null, 'This analysis could not be computed. '), card.error || ''),
          canEdit && toolOf(card.tool) ? button({ label: 'Change the settings', small: true, onClick: edit }) : null));
        return;
      }
      if (!result) {
        mount(bodyEl, h('div', { class: 'an-wait' }, h('span', { class: 'spinner' }), h('span', null, 'Loading the result…')));
        load();
        return;
      }
      const m = model();
      const notes = Array.isArray(result.notes) ? result.notes.filter(Boolean) : [];
      const tableBlock = result.table && result.table.rows ? h('details', { class: 'an-details' },
        h('summary', null, `Table (${plural(result.table.rows, 'row')})`),
        h('div', { class: 'an-details-body' }, resultTable(result.table, { onGene: onShowGenes ? (g) => onShowGenes([g]) : null }))) : null;
      if (!m) {
        mount(bodyEl, banner('info', 'This version has no chart for this tool; its table is below.'), tableBlock);
        if (tableBlock) tableBlock.open = true;
        return;
      }
      mount(kindsEl, m.kinds.length > 1 ? m.kinds.map(([id, label]) => h('button', {
        type: 'button', class: id === m.kind ? 'btn small active' : 'btn small', 'aria-pressed': id === m.kind ? 'true' : 'false', onClick: () => setKind(id),
      }, label)) : null);
      mount(bodyEl,
        h('div', { class: 'an-facts' }, m.facts.filter(Boolean).map((f) => h('span', null, f))),
        m.options.length ? h('div', { class: 'an-options' }, m.options) : null,
        chartEl,
        notes.length ? h('details', { class: 'an-details an-notes' }, h('summary', null, `Read before interpreting (${notes.length})`),
          h('ul', { class: 'an-details-body' }, notes.map((n) => h('li', null, n)))) : null,
        tableBlock);
      drawChart(m, chartEl.clientWidth || root.clientWidth - 32);
      if (!resizer && typeof ResizeObserver === 'function') {
        resizer = new ResizeObserver(debounce(() => {
          const w = chartEl.clientWidth;
          if (!w || !drawn || Math.abs(w - drawn.width) < 12 || card.status !== 'done') return;
          const again = model();
          if (again) drawChart(again, w);
        }, 150));
        resizer.observe(chartEl);
      }
    }

    async function load() {
      if (fetching || result || card.status !== 'done') return;
      fetching = true;
      try {
        const full = await api(`${base}/analyses/${card.id}`);
        if (!alive) return;
        if (full.result) { result = full.result; store.results.set(card.id, result); }
        card = { ...full, result: undefined };
        delete card.result;
        paintBody();
      } catch (err) {
        if (alive) mount(bodyEl, errorPanel(err, { retry: () => { fetching = false; load(); } }));
      } finally {
        fetching = false;
      }
    }

    async function edit() {
      const tool = toolOf(card.tool);
      if (!tool) return;
      const made = await openForm({ tool, params: clone(card.params || {}), title: card.title, card });
      if (made && alive) adopt(made, false);
    }

    async function exportImage(kind) {
      const m = model();
      if (!m) return;
      const node = await m.draw(EXPORT_WIDTH, ch.PAPER);
      const name = fileName(card.title);
      if (node instanceof SVGElement) {
        const titled = withTitle(node, card.title);
        if (kind === 'svg') ch.exportSvg(titled, `${name}.svg`); else await ch.exportPng(titled, `${name}.png`);
        return;
      }
      await ch.exportPng(mapsImage(node, card.title), `${name}.png`);
    }

    function menuItems() {
      const ready = card.status === 'done' && !!result;
      const m = ready ? model() : null;
      const isMap = m && m.kind === 'map';
      const editing = canEdit ? [
        toolOf(card.tool) ? { label: 'Change the settings…', icon: 'sliders', hint: 'Computed again in this card', disabled: card.status === 'running', onClick: edit } : null,
        toolOf(card.tool) ? { label: 'Duplicate…', icon: 'copy', hint: 'A new card from these settings', onClick: () => newAnalysis(toolOf(card.tool), clone(card.params || {}), '') } : null,
        { label: 'Rename…', icon: 'edit', onClick: rename },
        'separator',
      ] : [];
      return [
        ...editing,
        { heading: 'Download' },
        { label: 'Image (PNG)', icon: 'image', disabled: !m, onClick: () => exportImage('png') },
        { label: 'Image (SVG)', icon: 'image', hint: isMap ? 'Maps are saved as PNG' : 'Vector, for figures', disabled: !m || isMap, onClick: () => exportImage('svg') },
        { label: 'Table (CSV)', icon: 'table', disabled: !(ready && result.table && result.table.rows), href: apiUrl(`${base}/analyses/${card.id}/table.csv`), download: `${fileName(card.title)}.csv` },
        canEdit ? 'separator' : null,
        canEdit ? { label: 'Delete', icon: 'trash', danger: true, onClick: remove } : null,
      ].filter(Boolean);
    }

    async function rename() {
      const name = await promptDialog({ title: 'Rename the analysis', label: 'Title', value: card.title || '', confirmLabel: 'Rename' });
      if (!name) return;
      const saved = await api(`${base}/analyses/${card.id}`, { method: 'PUT', body: { title: name.slice(0, 120) } });
      card = { ...card, title: saved.title };
      sync(card);
      paintHead();
    }

    async function remove() {
      const ok = await confirmDialog({ title: 'Delete this analysis?', message: `“${card.title || card.tool}” and its result are removed. This cannot be undone.`, confirmLabel: 'Delete', danger: true });
      if (!ok) return;
      await api(`${base}/analyses/${card.id}`, { method: 'DELETE' });
      store.results.delete(card.id);
      drop(card.id);
    }

    const view = {
      el: root,
      get card() { return card; },
      /** The card changed on the server (computed, failed, computed again). */
      update(next, fresh) {
        if (fresh) { result = fresh; store.results.set(next.id, fresh); } else if (next.status !== 'done' || next.updated !== card.updated) { result = null; store.results.delete(next.id); }
        card = { ...next };
        delete card.result;
        drawn = null;
        paintBody();
      },
      shown() { if (card.status === 'done' && !result) load(); },
      destroy() { if (resizer) resizer.disconnect(); saveView.cancel(); if (seen) seen.unobserve(root); },
    };
    root.anView = view;
    if (seen) seen.observe(root);
    paintHead();
    if (card.status === 'done' && !result && seen) {
      mount(bodyEl, h('div', { class: 'an-wait' }, h('span', { class: 'spinner' }), h('span', null, 'Loading the result…')));
    } else {
      paintBody();
    }
    return view;
  }

  /** The chart with the card's title above it (exported images say what they show). */
  function withTitle(chart, title) {
    const w = Number(chart.getAttribute('width'));
    const hgt = Number(chart.getAttribute('height'));
    const NS = 'http://www.w3.org/2000/svg';
    const outer = document.createElementNS(NS, 'svg');
    outer.setAttribute('xmlns', NS);
    outer.setAttribute('width', w);
    outer.setAttribute('height', hgt + 40);
    outer.setAttribute('viewBox', `0 0 ${w} ${hgt + 40}`);
    outer.setAttribute('font-family', ch.FONT);
    const bg = document.createElementNS(NS, 'rect');
    bg.setAttribute('width', w); bg.setAttribute('height', hgt + 40); bg.setAttribute('fill', '#ffffff');
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('x', 12); t.setAttribute('y', 24); t.setAttribute('font-size', 15); t.setAttribute('font-weight', 600); t.setAttribute('fill', '#18212c');
    t.textContent = ch.fit(title || '', w - 24, 15, 600);
    chart.setAttribute('x', 0); chart.setAttribute('y', 36);
    outer.append(bg, t, chart);
    return outer;
  }

  /** The maps of a card (canvases with their captions) as one canvas with the title. */
  function mapsImage(box, title) {
    const canvases = [...box.querySelectorAll('canvas')];
    const captions = [...box.querySelectorAll('figcaption')].map((c) => c.textContent);
    const legendText = box.querySelector('.an-map-legend') ? box.querySelector('.an-map-legend').textContent : '';
    const gap = 24;
    const ratio = canvases.length ? canvases[0].width / parseFloat(canvases[0].style.width) : 1;
    const width = canvases.reduce((a, c) => a + c.width, 0) + gap * ratio * (canvases.length + 1);
    const height = Math.max(...canvases.map((c) => c.height)) + 110 * ratio;
    const out = document.createElement('canvas');
    out.width = Math.max(width, 600 * ratio);
    out.height = height;
    const g = out.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, out.width, out.height);
    g.fillStyle = '#18212c';
    g.font = `600 ${15 * ratio}px ${ch.FONT}`;
    g.fillText(title || '', gap * ratio, 28 * ratio);
    let x = gap * ratio;
    canvases.forEach((c, i) => {
      g.drawImage(c, x, 44 * ratio);
      g.font = `${12 * ratio}px ${ch.FONT}`;
      g.fillText(captions[i] || '', x, 44 * ratio + c.height + 18 * ratio);
      x += c.width + gap * ratio;
    });
    g.fillStyle = '#5b6675';
    g.font = `${11 * ratio}px ${ch.FONT}`;
    g.fillText(legendText, gap * ratio, height - 14 * ratio);
    return out;
  }

  // ---------------------------------------------------------------- the list
  function sync(card) {
    const i = store.cards.findIndex((c) => c.id === card.id);
    const meta = { ...card };
    delete meta.result;
    if (i >= 0) store.cards[i] = meta; else store.cards.unshift(meta);
  }

  /** A card made or changed by this page: shown (new ones on top) and followed until it is done. */
  function adopt(card, isNew) {
    sync(card);
    const existing = views.get(card.id);
    if (existing) existing.update(card, card.result || null);
    else {
      if (card.result) store.results.set(card.id, card.result);
      const view = cardView(card);
      views.set(card.id, view);
      if (isNew) listEl.prepend(view.el); else listEl.append(view.el);
    }
    paintChrome();
    if (isNew) views.get(card.id).el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    follow();
  }

  function drop(id) {
    const view = views.get(id);
    if (view) { view.destroy(); view.el.remove(); views.delete(id); }
    store.cards = store.cards.filter((c) => c.id !== id);
    paintChrome();
  }

  /** Ask for the running cards until none is left. */
  function follow() {
    if (poller || !store.cards.some((c) => c.status === 'running')) return;
    poller = setInterval(async () => {
      const running = store.cards.filter((c) => c.status === 'running');
      if (!alive || !running.length) { clearInterval(poller); poller = null; return; }
      for (const c of running) {
        try {
          const next = await api(`${base}/analyses/${c.id}`);
          if (!alive) return;
          if (next.status !== 'running') {
            sync(next);
            const view = views.get(next.id);
            if (view) view.update(next, next.result || null);
            if (next.status === 'failed') toast(`“${next.title}” could not be computed.`, 'error');
          }
        } catch (err) {
          if (err.status === 404) drop(c.id);
        }
      }
    }, POLL_MS);
  }

  // ---------------------------------------------------------------- toolbar
  function toolItems() {
    const items = [];
    let group = null;
    for (const t of ctx.tools) {
      if (t.group !== group) { group = t.group; items.push({ heading: group }); }
      const off = t.expression && !ctx.expression.available ? 'Needs the raw data the run analysed, which cannot be found' : null;
      items.push({ label: t.title, icon: t.icon || GROUP_ICONS[t.group], hint: off || t.summary, disabled: !!off, onClick: () => newAnalysis(t, {}, '') });
    }
    return items;
  }

  async function editRegions() {
    const changed = await openRegionEditor({ runId, ctx, binUm, bins: store.bins });
    if (!changed || !alive) return;
    await loadContext();
    paintChrome();
  }

  async function openTemplates() {
    const listBox = h('div', null, loading());
    const done = store.cards.filter((c) => c.status === 'done');
    const dialog = modal({
      title: 'Templates', size: 'wide',
      body: h('div', { class: 'stack-lg' },
        h('p', { class: 'muted' }, 'A template keeps the settings of a set of analyses, so that the same charts can be made for another run with one click. A setting that does not fit the other run (a cell type it lacks, a gene not in its data) makes that one card fail with the reason; the others are computed.'),
        h('div', { class: 'row' }, button({
          label: `Keep the ${plural(done.length, 'analysis', 'analyses')} of this run as a template…`, icon: 'save', disabled: !done.length,
          onClick: async () => {
            const name = await promptDialog({ title: 'Keep as a template', label: 'Name of the template', value: '', confirmLabel: 'Keep' });
            if (!name) return;
            // oldest first: applied, they are made in the order they were made here
            const cards = done.slice().reverse().map((c) => ({ tool: c.tool, title: c.title, params: c.params || {}, view: c.view || {} }));
            await api('/api/analysis/templates', { method: 'POST', body: { name: name.slice(0, 120), cards } });
            toast('Template kept', 'success');
            paintList();
          },
        })),
        listBox),
      actions: [{ label: 'Close' }],
    });
    async function paintList() {
      let templates;
      try { templates = await api('/api/analysis/templates'); } catch (err) { mount(listBox, errorPanel(err, { retry: paintList })); return; }
      if (!templates.length) { mount(listBox, h('p', { class: 'muted' }, 'No template yet.')); return; }
      mount(listBox, h('div', { class: 'table-wrap' }, h('table', { class: 'table compact' },
        h('thead', null, h('tr', null, h('th', null, 'Template'), h('th', null, 'Analyses'), h('th', null, 'Kept'), h('th', null, h('span', { class: 'sr-only' }, 'Actions')))),
        h('tbody', null, templates.map((t) => h('tr', null,
          h('td', null, h('strong', null, t.name)),
          h('td', { class: 'muted small' }, t.cards.map((c) => c.title).join(' · ')),
          h('td', { class: 'nowrap', title: fmt.date(t.created) }, fmt.ago(t.created), userName(t.owner) ? h('div', { class: 'muted small' }, `by ${userName(t.owner)}`) : null),
          h('td', { class: 'nowrap' }, h('div', { class: 'row end' },
            button({
              label: 'Apply to this run', small: true, kind: 'primary',
              onClick: async () => {
                const started = await api(`${base}/templates/${t.id}/apply`, { method: 'POST' });
                dialog.close();
                for (const c of started.slice().reverse()) adopt(c, true);
                toast(`${plural(started.length, 'analysis', 'analyses')} started`, 'success');
              },
            }),
            t.can_edit === false ? null : button({
              icon: 'trash', small: true, kind: 'ghost danger', title: `Delete the template ${t.name}`,
              onClick: async () => {
                if (!(await confirmDialog({ title: 'Delete this template?', message: `“${t.name}” is removed. The analyses made from it stay.`, confirmLabel: 'Delete', danger: true }))) return;
                await api(`/api/analysis/templates/${t.id}`, { method: 'DELETE' });
                paintList();
              },
            })))))))));
    }
    paintList();
  }

  // The analyses a run starts with (POST /analyses/defaults, analysis.py default_analyses): chosen from what the run has,
  // added the first time its owner opens the tab, and again on request (only the ones not here yet). They are ordinary
  // cards: change their settings, delete them, add more.
  let addingDefaults = false;
  async function addDefaults(auto) {
    if (addingDefaults) return;
    addingDefaults = true;
    paintChrome();
    try {
      const res = await api(`${base}/analyses/defaults`, { method: 'POST' });
      ctx.defaults_added = true;
      if (!alive) return;
      for (const c of res.cards.slice().reverse()) adopt(c, true);
      if (res.added) {
        toast(auto
          ? `Started with ${plural(res.added, 'recommended analysis', 'recommended analyses')} for this run. Change their settings with ⋯, delete the ones you do not need, or add your own with New analysis.`
          : `${plural(res.added, 'recommended analysis', 'recommended analyses')} added`, 'success', { timeout: auto ? 9000 : 4500 });
      } else if (!auto) {
        toast('Every recommended analysis is already here.', 'info');
      }
    } catch (err) {
      if (!auto || alive) toast(`The recommended analyses could not be added: ${err.message || err}`, 'error');
    } finally {
      addingDefaults = false;
      if (alive) paintChrome();
    }
  }

  function paintChrome() {
    if (!ctx) return;
    const n = store.cards.length;
    if (!canEdit) {
      mount(toolbarEl, h('span', { class: 'owner-chip' }, icon('lock', { size: 13 }),
        `View only: ${owner || 'the owner of this run'} adds and changes its analyses. You can look at them and download them.`),
      h('span', { class: 'spacer' }), h('span', { class: 'muted small' }, n ? plural(n, 'analysis', 'analyses') : ''));
    } else mount(toolbarEl,
      menuButton({ label: 'New analysis', icon: 'plus', kind: 'primary', items: toolItems, align: 'start' }),
      button({
        label: addingDefaults ? 'Adding…' : 'Recommended', icon: 'chart', disabled: addingDefaults,
        title: 'Add the recommended analyses for this run (cell types, marker genes, differences between sections, neighbors): the ones that are not here yet',
        onClick: () => addDefaults(false),
      }),
      button({ label: ctx.regions.length ? `Regions (${ctx.regions.length})` : 'Regions', icon: 'polygon', title: 'Draw regions on the sections; a region is a group like any other', onClick: editRegions }),
      button({ label: 'Templates', icon: 'layers', onClick: openTemplates }),
      h('span', { class: 'spacer' }),
      h('span', { class: 'muted small' }, n ? plural(n, 'analysis', 'analyses') : ''));
    mount(noteEl, ctx.expression.available ? null : banner('warning', [h('strong', null, 'The raw counts cannot be read. '), ctx.expression.reason,
      ' Composition, distances and neighborhoods still work.']));
    const emptyEl = el.querySelector('.an-empty');
    if (emptyEl) emptyEl.hidden = n > 0;
  }

  function quickStart() {
    if (!canEdit) {
      return h('div', { class: 'card an-empty' }, emptyState({
        icon: 'chart', title: 'No analyses yet',
        text: `The analyses of this run are made by ${owner || 'its owner'}; they appear here when there are some.`,
      }));
    }
    const starts = [['expression', 'Compare genes between groups'], ['de', 'Find the genes of a group'], ['composition', 'Count cell types per section']];
    return h('div', { class: 'card an-empty' }, emptyState({
      icon: 'chart', title: 'Start with the recommended analyses, or ask your own questions',
      text: `The recommended analyses are chosen from what this run has: the cell types of each section and their marker genes, the genes that differ between the sections, which cell types lie next to each other. Or choose a tool yourself, say which ${units()} and genes it should look at, and the chart is added below. Settings can be changed afterwards and every chart can be downloaded.`,
      action: h('div', { class: 'stack', style: 'align-items:center' },
        button({ label: 'Add the recommended analyses', icon: 'chart', kind: 'primary', onClick: () => addDefaults(false) }),
        h('div', { class: 'row an-starts' }, starts.map(([id, label]) => {
          const t = toolOf(id);
          const off = t && t.expression && !ctx.expression.available;
          return t ? button({ label, icon: t.icon || 'chart', disabled: !!off, onClick: () => newAnalysis(t, {}, '') }) : null;
        }))),
    }));
  }

  async function loadContext() {
    ctx = await api(`${base}/analysis/context`);
    UNIT = ['bin', 'spot', 'cell'].includes(ctx.unit) ? ctx.unit : 'bin';
  }

  async function start() {
    try {
      const [, cards] = await Promise.all([loadContext(), api(`${base}/analyses`)]);
      if (!alive) return;
      store.cards = cards;
      mount(el, toolbarEl, noteEl, quickStart(), listEl);
      for (const c of cards) {
        const view = cardView(c);
        views.set(c.id, view);
        listEl.append(view.el);
      }
      paintChrome();
      follow();
      // the first visit of the owner: the recommended analyses, once
      if (canEdit && !ctx.defaults_added && !cards.length) addDefaults(true);
    } catch (err) {
      if (!alive) return;
      const noTable = err.status === 404;
      mount(el, noTable ? h('div', { class: 'card' }, emptyState({
        icon: 'chart', title: 'Nothing to analyse yet',
        text: 'The analysis tools work on the per-bin table of a finished run, and this run has none (it stopped before writing it).',
      })) : errorPanel(err, { retry: start }));
    }
  }

  if (!Array.isArray(store.cards)) store.cards = [];
  start();
  return {
    el,
    destroy() {
      alive = false;
      if (poller) clearInterval(poller);
      if (seen) seen.disconnect();
      for (const view of views.values()) view.destroy();
      removeTips();
    },
  };
}
