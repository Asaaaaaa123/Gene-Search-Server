// spatial-viewer.js — the spatial viewer: every bin of a section drawn at its position (x, y in µm, y down, equal
// aspect), gray or colored by the summed UMI counts of the genes typed (there is no "Color by": the labels and numbers
// of a bin and every gene detected in it show in the tooltip, and a click on a bin lists its genes), with layers drawn on
// top (genes, each in its own color where it is detected, and yes/no fields: positivity calls, region of interest,
// quality control; added with the "+ Add layer" button, stored as the panel's "overlays") and the H&E image
// underneath. One, two or four panels side by side,
// each with its own section and coloring; pan and zoom are linked across the panels (toggle), and the position under
// the mouse shows as a crosshair in the other panels. Used by the Viewer tab of a run (runSource below) and by the data
// explorer of a project (a projectSource on the same interface).
//
// Data source: every method receives an AbortSignal and may reject with an ApiError (a 404 from samples() shows the
// empty state).
//   source = {
//     name?                        file name stem of Save PNG (run id, project name)
//     emptyText?                   text of the empty state when there is nothing to map (the emptyText option wins)
//     samples(signal)              -> [{id, label, n}]  sections in display order; n = number of bins or null
//                                     (n_bins is accepted for n)
//     bins(sampleId, signal)       -> bin payload {sample, n, x[], y[] (µm, y down), fields: {name: {type: 'number',
//                                     values[]} | {type: 'bool', values[0|1|null]} | {type: 'category', categories[],
//                                     codes[] (-1 = no value)}}, colors: {field: {category: '#hex'}}, barcodes?: []}
//     genes?: {                    optional: coloring by genes and "detected" overlays
//       search(sampleId, query, signal, {offset, limit}?) -> [{gene, total_umi, n_bins_detected, pct_bins_detected}]:
//                                     `limit` matches from the offset-th on (the gene boxes' lists, page by page)
//       values(sampleId, genes[], signal) -> {genes_used[], genes_missing[], n, indices[], values[], total,
//                                     n_detected, max, n_unmatched?}: summed UMIs per bin in the bin payload's order
//       bin?(sampleId, index, signal) -> {index, matched, n_genes, total, genes: [[gene, UMIs], ...] by UMIs}: every
//                                     gene detected in one bin (index in the bin payload's order), for the tooltip
//       top?(sampleId, signal) -> {n, genes[] (top genes, the most bins first), bins[], codes[] (-1 = none), n_tied,
//                                     n_empty, pooled, n_unmatched}: the top gene of every bin (the most UMIs in it
//                                     and the 8 bins around it), for the "Top gene" coloring
//       overlapGenes?(sampleId, indices[], {min_r, max_fdr, min_bins, limit}, signal) -> {n_bins, n_overlap,
//                                     n_tested, n_pass, thresholds, genes: [{gene, r, p, fdr, bins_in, pct_in,
//                                     pct_out, mean_in, mean_out}]}: genes correlated with a region (an overlap of
//                                     cell types), for "Correlated genes"
//     }
//     image?(sampleId, signal, {retry}) -> {url, px_per_um, width, height} | null: H&E under the bins, image pixel
//                                     (u, v) at (u / px_per_um, v / px_per_um) µm; retry: asked again after the image
//                                     failed to load (a source may then get a new address from its server)
//   }
// Store (owned by the caller and kept between visits, so leaving the tab and coming back restores everything):
//   layout 1 | 2 | 4; link (pan and zoom shared by the panels); view {cx, cy, scale, auto?} = the linked view (centre in
//   µm, css px per µm; auto = a fit nobody has moved since, fitted again when the sections or the sizes change);
//   sameScale (panels colored by the same genes or number share one color range: the smallest low end, the largest
//   99th percentile); pointSize; image {on, opacity (how much of the image shows through the bins)};
//   panels [{sample, field (field name of a label or number | '__gene__' | '__top__' | '__none__'; a yes/no field found here is
//            made a layer), genes [names, summed], overlays (the layers) [bool field | 'gene:a,b'],
//            dim (dim the coloring under the layers), hidden {field: [legend keys]}, views {sample: {cx, cy, scale,
//            auto?}} (views when not linked)}];
//   caches shared by the panels: samples, data (Map sample -> prepared bins), geneData (Map 'sample\ngenes' ->
//   prepared counts, the last 40 used), topData (Map sample -> prepared top genes), images (Map sample -> loaded H&E |
//   {none: true}).
// Bins are drawn into one offscreen layer per panel (one fillRect batch per color) only when the data, the zoom or the
// style change; panning and hovering only copy the layers, so four panels of 100,000 bins or more stay smooth.
import { h, api, apiUrl, mount, icon, emptyState, errorPanel, loading, fmt, toast, debounce, switchToggle, modal } from '../core.js';
import { downloadBlob } from './log-view.js';
import { formatNumber } from './table-viewer.js';
import { parseTokens } from './chips.js';

const FIELD_LABELS = {
  tissue_class: 'Tissue class',
  assigned_signature: 'Cell type (assigned signature)',
  leiden_domain: 'Leiden domain',
  in_region_of_interest: 'In region of interest',
  passes_qc: 'Passes quality control',
  total_umi: 'UMIs per bin',
  n_genes: 'Genes per bin',
  pct_mt: 'Mitochondrial UMIs (%)',
  lesion_umi_pooled: 'Lesion UMIs (pooled)',
};
const CATEGORY_ORDER = ['tissue_class', 'assigned_signature', 'leiden_domain'];
const NUMBER_ORDER = ['total_umi', 'n_genes', 'pct_mt'];
const LOG_FIELDS = new Set(['total_umi', 'n_genes']);
const BOOL_TEXT = { in_region_of_interest: ['Inside', 'Outside'], passes_qc: ['Passes', 'Fails'] };
// suffix of pooled calls in the per-bin table: _pooled_depthmatched (uncoupling.calls "pooled_dm") or _pooled ("pooled")
const POOLED_RE = /_pooled(_depthmatched)?$/;
// categories without a configured color (Leiden domains, ...): Tableau 20 without its grays
const PALETTE = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b', '#e377c2', '#bcbd22', '#17becf',
  '#aec7e8', '#ffbb78', '#98df8a', '#ff9896', '#c5b0d5', '#c49c94', '#f7b6d2', '#dbdb8d', '#9edae5'];
const GRAY_NAMES = { unassigned: '#dedede', ambiguous: '#dedede', removed: '#b8b8b8', unresolved: '#c4c4c4' };
const BOOL_COLORS = { in_region_of_interest: '#1f78b4', passes_qc: '#2ca02c' };
const POSITIVE_COLOR = '#d62728';
// overlays without a configured color: well separated colors (from Sasha Trubetskoy's list of 20; the pale ones, too
// close to the color of bins in several overlays, left out)
const OVERLAY_PALETTE = ['#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#42d4f4', '#f032e6', '#bfef45',
  '#911eb4', '#469990', '#9a6324'];
const VIRIDIS = ['#440154', '#472c7a', '#3b518b', '#2c718e', '#21908d', '#27ad81', '#5cc863', '#aadc32', '#fde725'];
const LEVELS = 64; // color steps of a numeric field (one fillRect batch each)
const NEUTRAL = 'neutral'; // group color token: the theme's neutral (negatives, missing values, genes not detected)
// group color token: bins in two or more overlays, in the color with the most contrast to what lies under the bins: the
// theme's text color on the dark plot background, the dark text color of the exported image over the H&E image (mostly
// white) and in the exported image itself
const SEVERAL = 'several';
const MISSING = '__missing__'; // legend key of bins without a value
const ZERO = '__zero__'; // legend key of bins where none of the genes is detected
const GENE_FIELD = '__gene__'; // "Color by" value of the gene coloring
const NONE_FIELD = '__none__'; // "Color by" value of no coloring: every bin in the neutral color, under the layers
const TOP_FIELD = '__top__'; // "Color by" value of the top gene of every bin (most UMIs in it and the 8 bins around it)
// "Color by" value of the cell types of "Color by cells": the per-bin table's assigned signature (a run's bins only)
const CELL_FIELD = 'assigned_signature';
const ALL_CELLS = '*'; // the line "All cell types" of Color by cells: every cell type in its color
const ALL_CELLS_TEXT = 'All cell types';
const OTHER_CELLS = '__othercells__'; // legend key of the bins of the cell types not picked (gray)
// the outline of the overlap clusters of the picked cell types: a bright line over a dark halo (shows on any bin)
const OUTLINE_COLOR = '#ffffff';
const OUTLINE_HALO = 'rgba(0, 0, 0, 0.85)';
// the shape of each overlap combination, in the order of the combinations (pairs first, then triples, ...; by the
// picked types' order): with three picked, 1 + 2 a circle, 1 + 3 a triangle, 2 + 3 a diamond, 1 + 2 + 3 a star
const SHAPES = ['circle', 'triangle', 'diamond', 'star', 'cross', 'hexagon', 'triangle-down'];
const SHAPE_MIN_PX = 4; // half a bin (css px) from which an overlap bin shows its shape; smaller, a square
const comboCount = (n) => Math.max(0, 2 ** Math.min(n, 12) - n - 1); // combinations of two or more of n sets

// ---- colors that contrast: every overlap combination has one color (its bins, its shapes and its cluster outline),
// and the colors of the gene lines and of the combinations are chosen together so that each differs as much as it
// can from every other color on the map: the background, the gray bins, the picked cell types (configured colors,
// fixed) and each other. "Differs" is measured as people see it: the distance in CIELAB (ΔE*ab), not in RGB.
/** CIELAB (D65) of a CSS color (hex or rgb()); null when it cannot be read. */
function toLab(c) {
  const p = parseColor(c);
  if (!p) return null;
  const lin = (v) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  const [r, g, b] = p.map(lin);
  const X = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const Y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const Z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const fx = f(X);
  const fy = f(Y);
  const fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
const deltaE = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** #rrggbb of hue h (degrees), saturation s and lightness l (0..1). */
function hslHex(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const ch = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
  return `#${[ch(0), ch(8), ch(4)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

// candidates: 30 hues at several saturation/lightness steps, kept when bright enough to stand out on the dark map and
// not so pale that they look white (CIELAB lightness 55 to 92): a saturated dark blue differs from the background by
// its hue alone, which ΔE counts but the eye hardly sees there
const COLOR_CANDIDATES = (() => {
  const out = [];
  for (let h = 0; h < 360; h += 12) {
    for (const [s, l] of [[1, 0.5], [1, 0.6], [1, 0.7], [0.9, 0.8], [0.8, 0.55]]) out.push(hslHex(h, s, l));
  }
  return [...new Set(out)].map((hex) => ({ hex, lab: toLab(hex) })).filter((c) => c.lab[0] >= 55 && c.lab[0] <= 92);
})();

/**
 * `count` colors far apart (greedy farthest point): each is the candidate whose smallest ΔE to the fixed colors and
 * to the colors picked before it is the largest, so every new color is as different as it can be from all the
 * others. Deterministic: the same fixed colors give the same colors in the same order.
 */
function farColors(count, fixed = []) {
  const fixedLab = fixed.map(toLab).filter(Boolean);
  const nearest = COLOR_CANDIDATES.map((c) => (fixedLab.length ? Math.min(...fixedLab.map((f) => deltaE(c.lab, f))) : Infinity));
  const taken = new Uint8Array(COLOR_CANDIDATES.length);
  const out = [];
  for (let k = 0; k < count; k += 1) {
    let best = -1;
    for (let j = 0; j < COLOR_CANDIDATES.length; j += 1) {
      if (!taken[j] && (best < 0 || nearest[j] > nearest[best])) best = j;
    }
    if (best < 0) break;
    taken[best] = 1;
    out.push(COLOR_CANDIDATES[best].hex);
    const lab = COLOR_CANDIDATES[best].lab;
    for (let j = 0; j < COLOR_CANDIDATES.length; j += 1) nearest[j] = Math.min(nearest[j], deltaE(COLOR_CANDIDATES[j].lab, lab));
  }
  return out;
}
/** Rank of combination `mask` among all the combinations of n sets (two or more): pairs first, then by mask. */
function comboRank(mask, n) {
  const all = [];
  for (let m = 1; m < 1 << n; m += 1) if (m & (m - 1)) all.push(m);
  const bits = (m) => { let c = 0; for (let v = m; v; v &= v - 1) c += 1; return c; };
  all.sort((a, b) => bits(a) - bits(b) || a - b);
  return Math.max(0, all.indexOf(mask));
}
const shapeOf = (mask, n) => SHAPES[comboRank(mask, n) % SHAPES.length];
const TOP_COLORS = PALETTE.length; // top genes in a color of their own (the ones topping the most bins); 18
const OTHER = '__other__'; // legend key of the bins whose top gene has no color of its own
const OTHER_COLOR = '#8f8f8f';
const EMPTY = '__empty__'; // legend key of the bins without a top gene (no UMIs in them or around them)
const BASE = '__base__'; // legend key of the gray bins of no coloring (hidden: the layers alone)
const GENE_OVERLAY = 'gene:'; // overlay key prefix: 'gene:Ctsk,Acp5' = bins where the summed count is above 0
const MAX_GENES = 50;
const BIN_GENES_TIP = 150; // genes of a bin listed in the tooltip (all of them in the dialog a click on the bin opens)
const BIN_GENES_KEPT = 300; // bins whose genes a panel keeps per section
const BIN_GENES_DELAY_MS = 90; // the pointer stops this long on a bin before its genes are asked for
const MAX_OVERLAYS = OVERLAY_PALETTE.length; // per panel: one palette color each (11), still told apart
const LOADING = 'loading…'; // status of a gene overlay whose counts are on their way
const isGeneLayer = (l) => l.key.startsWith(GENE_OVERLAY);
const GENE_CACHE = 40;
const DIM = 0.72; // share of the background mixed into the coloring under overlays
// panels: 1 up to the number of sections (at most MAX_PANELS); 2 and 3 side by side, 4 in 2 × 2, 5 and 6 in 3 × 2
const MAX_PANELS = 6;
const panelCols = (k) => (k <= 3 ? k : (k === 4 ? 2 : 3));
const panelRows = (k) => Math.ceil(k / panelCols(k));
const layoutTitle = (k) => {
  if (k === 1) return 'One panel';
  if (panelRows(k) === 1) return `${k} panels side by side`;
  return `${k} panels (${panelCols(k)} × ${panelRows(k)})`;
};
// css px: a panel at least this wide has its legend beside the map; four panels need the height (two rows), two keep
// the width of their maps unless there is plenty
// panel width (css px) from which the legend stands beside the map: panels in one row, panels in two rows
const wideFrom = (k) => (k === 1 ? Infinity : (panelRows(k) === 1 ? 700 : 500));
const MIN_SIDE = 1.5; // css px: bins never vanish when zoomed out
const HOVER_PX = 6;
const MARGIN = 160; // css px drawn around the viewport, so short pans need no redraw
const MAX_LAYER_PX = 16e6;
const EXPORT_PALETTE = { bg: '#ffffff', neutral: '#d0d5dc', text: '#18212c', muted: '#5b6675', several: '#18212c' };
// the dark map's colors, for choosing contrasting colors before the theme has been read
const DARK_MAP = { bg: '#0e1116', neutral: '#39414d', text: '#e6edf3' };
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';

let uidSeq = 0;
const uid = (prefix) => `${prefix}-${(uidSeq += 1)}`;
const isColor = (c) => typeof c === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(c.trim());
const goodView = (v) => !!v && Number.isFinite(v.cx) && Number.isFinite(v.cy) && Number.isFinite(v.scale) && v.scale > 0;
const geneText = (genes) => genes.join(' + ');
const genesKey = (genes) => genes.join(',');
const clampedMark = (scale) => (scale && scale.clamped ? '≥ ' : ''); // a scale cut below the largest value
const rangeText = (r) => (r ? `${r.lo}\n${r.hi}` : ''); // a shared color range, '' = none

/** [r, g, b] of '#rgb', '#rrggbb' or 'rgb(r, g, b)'; null for anything else. */
function parseColor(c) {
  const s = String(c || '').trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) return [...m[1]].map((ch) => parseInt(ch + ch, 16));
  m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) {
    const v = parseInt(m[1], 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Color c mixed with bg (t = share of bg) as an opaque color; c itself when either cannot be read. */
function mixColor(c, bg, t) {
  const a = parseColor(c);
  const b = parseColor(bg);
  if (!a || !b) return c;
  const m = (k) => Math.round(a[k] + (b[k] - a[k]) * t);
  return `rgb(${m(0)}, ${m(1)}, ${m(2)})`;
}

/** True when color c is hard to tell from one of `colors` (RGB distance below 90 of 441). */
function tooClose(c, colors) {
  const a = parseColor(c);
  if (!a) return false;
  return colors.some((o) => {
    const b = parseColor(o);
    return !!b && Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 90;
  });
}

/** Color at t in [0, 1] along a list of hex stops. */
function ramp(stops, t) {
  const x = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const a = parseColor(stops[i]);
  const b = parseColor(stops[i + 1]);
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)}, ${Math.round(a[1] + (b[1] - a[1]) * f)}, ${Math.round(a[2] + (b[2] - a[2]) * f)})`;
}
// numbers and gene counts: viridis from its quarter point, so that the lowest step (often 1 UMI, the commonest count of
// a sparse gene) is brighter than the neutral color of the bins without a count on the dark plot background, and still
// dark on the white of the exported image
const LUT_START = 0.25;
const LUT = Array.from({ length: LEVELS }, (_, k) => ramp(VIRIDIS, LUT_START + ((1 - LUT_START) * k) / (LEVELS - 1)));

export function fieldLabel(key) {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  // sensitivity analysis: the share (0 to 1) of the depth-matching draws in which a bin is pooled-positive
  const share = /^positive_fraction_(.+)_pooled_depthmatched_draws$/.exec(key);
  if (share) return `Share of draws positive: ${share[1].replace(/_/g, ' ')} (pooled, depth-matched)`;
  if (key.startsWith('positive_')) {
    const raw = key.slice('positive_'.length);
    const m = raw.match(POOLED_RE);
    const name = m ? raw.slice(0, -m[0].length) : raw;
    const suffix = m ? (m[1] ? ' (pooled, depth-matched)' : ' (pooled)') : '';
    return `Positive: ${name.replace(/_/g, ' ')}${suffix}`;
  }
  const text = key.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function boolText(key) {
  if (BOOL_TEXT[key]) return BOOL_TEXT[key];
  return key.startsWith('positive_') ? ['Positive', 'Negative'] : ['Yes', 'No'];
}

/** Name of an overlay as stored: its gene names ('Ctsk', 'Ctsk + Acp5') or the label of its yes/no field. */
function overlayLabel(key) {
  return key.startsWith(GENE_OVERLAY) ? geneText(key.slice(GENE_OVERLAY.length).split(',')) : fieldLabel(key);
}

/** Gene names of typed text (commas, semicolons, spaces or + separate), case-insensitive duplicates dropped. */
function parseGenes(text) {
  const seen = new Set();
  const out = [];
  for (const t of parseTokens(String(text ?? '').replace(/\+/g, ' '))) {
    const k = t.toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(t); }
  }
  return out;
}

/** The same genes whatever their case and order: 'Acp5,Ctsk' for Ctsk + acp5. */
const foldGenes = (genes) => genes.map((g) => g.toLowerCase()).sort().join(',');

/**
 * Gene overlays of typed text: one per gene (commas, semicolons or spaces separate), and one for genes joined by +
 * (the bins detecting any of them): 'Ctsk, Acp5 + Mmp9' -> [['Ctsk'], ['Acp5', 'Mmp9']]. Case-insensitive duplicates
 * dropped; at most MAX_GENES genes in one overlay.
 */
function parseGeneLayers(text) {
  const seen = new Set();
  const out = [];
  for (const tok of parseTokens(String(text ?? '').replace(/\s*\+\s*/g, '+'))) {
    const genes = parseGenes(tok).slice(0, MAX_GENES);
    const k = foldGenes(genes);
    if (!genes.length || seen.has(k)) continue;
    seen.add(k);
    out.push(genes);
  }
  return out;
}

/**
 * Changes of a panel state from viewer.show(): {sample?, field?, genes? (array or text), overlays?}. Overlays the panel
 * has stay; new ones are added up to MAX_OVERLAYS, the others pushed to `dropped`.
 */
function patchState(st, patch, dropped = []) {
  if (patch.sample !== undefined && patch.sample !== null) st.sample = String(patch.sample);
  const genes = typeof patch.genes === 'string' ? parseGenes(patch.genes)
    : Array.isArray(patch.genes) ? parseGenes(patch.genes.join(',')) : null;
  if (genes) {
    st.genes = genes.slice(0, MAX_GENES);
    st.field = GENE_FIELD;
  } else if (typeof patch.field === 'string') {
    st.field = patch.field;
  }
  if (Array.isArray(patch.overlays)) {
    const had = Array.isArray(st.overlays) ? st.overlays : [];
    const next = [];
    for (const k of new Set(patch.overlays.map(String))) {
      if (had.includes(k) || next.length < MAX_OVERLAYS) next.push(k);
      else dropped.push(k);
    }
    st.overlays = next;
  }
  return st;
}

/** The warning when overlays were not added: a panel has at most MAX_OVERLAYS. */
function tooManyOverlays(keys) {
  const names = keys.map(overlayLabel).join(', ');
  toast(`A panel shows at most ${MAX_OVERLAYS} layers (one color each)${names ? `; not added: ${names}` : ': remove one to add another'}.`, 'warning');
}

function normalizeSamples(res) {
  return (Array.isArray(res) ? res : []).filter((s) => s && s.id !== null && s.id !== undefined).map((s) => {
    const n = Number.isFinite(s.n) ? s.n : (Number.isFinite(s.n_bins) ? s.n_bins : null);
    return { ...s, id: String(s.id), label: s.label === null || s.label === undefined ? '' : String(s.label), n };
  });
}

// ------------------------------------------------------------------------------------------------ data
function toFloat32(values, n) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const v = values ? values[i] : null;
    out[i] = v === null || v === undefined || v === '' ? NaN : Number(v);
  }
  return out;
}

function orderFields(fields) {
  const rank = (k) => {
    const f = fields.get(k);
    if (f.type === 'category') {
      const i = CATEGORY_ORDER.indexOf(k);
      return [0, i < 0 ? CATEGORY_ORDER.length : i];
    }
    if (f.type === 'bool') return [1, BOOL_TEXT[k] ? 0 : (POOLED_RE.test(k) ? 2 : 1)];
    const i = NUMBER_ORDER.indexOf(k);
    return [2, i < 0 ? NUMBER_ORDER.length : i];
  };
  return [...fields.keys()].map((k, i) => ({ k, i, r: rank(k) }))
    .sort((a, b) => a.r[0] - b.r[0] || a.r[1] - b.r[1] || a.i - b.i)
    .map((e) => e.k);
}

/** Bin payload -> typed arrays, bounding box and per-field summaries. */
function prepare(raw) {
  const xs = raw && Array.isArray(raw.x) ? raw.x : [];
  const ys = raw && Array.isArray(raw.y) ? raw.y : [];
  const n = Math.min(xs.length, ys.length);
  const x = toFloat32(xs, n);
  const y = toFloat32(ys, n);
  const ok = new Uint8Array(n);
  const bbox = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  let valid = 0;
  for (let i = 0; i < n; i += 1) {
    if (!Number.isFinite(x[i]) || !Number.isFinite(y[i])) continue;
    ok[i] = 1;
    valid += 1;
    if (x[i] < bbox.x0) bbox.x0 = x[i];
    if (x[i] > bbox.x1) bbox.x1 = x[i];
    if (y[i] < bbox.y0) bbox.y0 = y[i];
    if (y[i] > bbox.y1) bbox.y1 = y[i];
  }
  const fields = new Map();
  for (const [key, f] of Object.entries((raw && raw.fields) || {})) {
    if (!f || typeof f !== 'object') continue;
    if (f.type === 'category') {
      const categories = Array.isArray(f.categories) ? f.categories.map((c) => String(c)) : [];
      const src = Array.isArray(f.codes) ? f.codes : [];
      const codes = new Int32Array(n);
      for (let i = 0; i < n; i += 1) {
        const c = src[i];
        codes[i] = Number.isInteger(c) && c >= 0 && c < categories.length ? c : -1;
      }
      fields.set(key, { key, type: 'category', categories, codes });
    } else if (f.type === 'bool') {
      const src = Array.isArray(f.values) ? f.values : [];
      const values = new Uint8Array(n); // 0 no, 1 yes, 2 no value
      for (let i = 0; i < n; i += 1) {
        const v = src[i];
        values[i] = v === null || v === undefined ? 2 : (v === true || Number(v) === 1 ? 1 : 0);
      }
      fields.set(key, { key, type: 'bool', values });
    } else if (f.type === 'number') {
      const values = toFloat32(f.values, n);
      const finite = new Float32Array(n);
      let m = 0;
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < n; i += 1) {
        const v = values[i];
        if (!ok[i] || !Number.isFinite(v)) continue;
        finite[m] = v;
        m += 1;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      // the color scale stops at the 99th percentile, as for genes: a few extreme bins do not flatten the map
      const sorted = finite.subarray(0, m).sort();
      fields.set(key, { key, type: 'number', values, min, max, q99: m ? sorted[Math.floor(0.99 * (m - 1))] : NaN });
    }
  }
  return {
    sample: raw && raw.sample, n, x, y, ok, valid, bbox, fields, order: orderFields(fields),
    colors: raw && raw.colors && typeof raw.colors === 'object' ? raw.colors : {},
    barcodes: raw && Array.isArray(raw.barcodes) && raw.barcodes.length >= n ? raw.barcodes : null,
  };
}

/** Uniform grid over the bins (CSR layout): the bins of cell c are items[start[c] .. start[c + 1]). */
function buildIndex(d, cellSize) {
  if (!d.valid) return null;
  const { x, y, ok, n, bbox } = d;
  let cell = cellSize > 0 && Number.isFinite(cellSize) ? cellSize : 1;
  let nx;
  let ny;
  for (;;) {
    nx = Math.floor((bbox.x1 - bbox.x0) / cell) + 1;
    ny = Math.floor((bbox.y1 - bbox.y0) / cell) + 1;
    if (nx * ny <= 4e6) break;
    cell *= 2;
  }
  const cells = nx * ny;
  const start = new Int32Array(cells + 1);
  const cellOf = new Int32Array(n);
  for (let i = 0; i < n; i += 1) {
    if (!ok[i]) { cellOf[i] = -1; continue; }
    const c = Math.floor((y[i] - bbox.y0) / cell) * nx + Math.floor((x[i] - bbox.x0) / cell);
    cellOf[i] = c;
    start[c + 1] += 1;
  }
  for (let c = 0; c < cells; c += 1) start[c + 1] += start[c];
  const items = new Int32Array(start[cells]);
  const fill = start.slice(0, cells);
  for (let i = 0; i < n; i += 1) {
    const c = cellOf[i];
    if (c >= 0) { items[fill[c]] = i; fill[c] += 1; }
  }
  return { x0: bbox.x0, y0: bbox.y0, cell, nx, ny, start, items };
}

/** Index of the bin nearest to (px, py) within radius r (data units), or -1. */
function nearest(g, d, px, py, r, visible, exclude = -1) {
  if (!g) return -1;
  const c0 = Math.max(0, Math.floor((px - r - g.x0) / g.cell));
  const c1 = Math.min(g.nx - 1, Math.floor((px + r - g.x0) / g.cell));
  const r0 = Math.max(0, Math.floor((py - r - g.y0) / g.cell));
  const r1 = Math.min(g.ny - 1, Math.floor((py + r - g.y0) / g.cell));
  if (c1 < c0 || r1 < r0 || (c1 - c0 + 1) * (r1 - r0 + 1) > 250000) return -1;
  const { x, y } = d;
  let best = -1;
  let bestD = r * r;
  for (let row = r0; row <= r1; row += 1) {
    for (let col = c0; col <= c1; col += 1) {
      const c = row * g.nx + col;
      for (let k = g.start[c]; k < g.start[c + 1]; k += 1) {
        const i = g.items[k];
        if (i === exclude || (visible && !visible[i])) continue;
        const dx = x[i] - px;
        const dy = y[i] - py;
        const dd = dx * dx + dy * dy;
        if (dd <= bestD) { bestD = dd; best = i; }
      }
    }
  }
  return best;
}

/** Bin pitch (µm) estimated as the median nearest-neighbor distance of up to ~300 bins. */
function estimatePitch(d) {
  const { bbox, n, ok, x, y } = d;
  const area = Math.max(1e-9, (bbox.x1 - bbox.x0) * (bbox.y1 - bbox.y0));
  const guess = Math.sqrt(area / Math.max(1, d.valid)) || 1;
  const g = buildIndex(d, guess * 2);
  const step = Math.max(1, Math.floor(n / 300));
  const dist = [];
  for (let i = 0; i < n; i += step) {
    if (!ok[i]) continue;
    const j = nearest(g, d, x[i], y[i], guess * 4, null, i);
    if (j >= 0) dist.push(Math.hypot(x[j] - x[i], y[j] - y[i]));
  }
  dist.sort((a, b) => a - b);
  return dist.length && dist[dist.length >> 1] > 0 ? dist[dist.length >> 1] : guess;
}

/**
 * Sparse gene vector -> dense counts in the bin order of the map, with the numbers of the legend: bins detecting the
 * genes, smallest and largest nonzero count, and the color clamp (99th percentile of the nonzero counts).
 */
function prepareGene(raw, genes, n) {
  if (!raw || typeof raw !== 'object') throw new Error('The server returned no gene counts.');
  if (Number.isFinite(raw.n) && raw.n !== n) {
    throw new Error(`The gene counts cover ${fmt.int(raw.n)} bins but the map has ${fmt.int(n)}; reload the page.`);
  }
  const counts = new Float32Array(n);
  const idx = Array.isArray(raw.indices) ? raw.indices : [];
  const vals = Array.isArray(raw.values) ? raw.values : [];
  for (let k = 0; k < idx.length; k += 1) {
    const i = idx[k];
    const v = Number(vals[k]);
    if (Number.isInteger(i) && i >= 0 && i < n && v > 0) counts[i] = v;
  }
  let detected = 0;
  let max = 0;
  let lo = Infinity;
  let total = 0;
  for (let i = 0; i < n; i += 1) {
    const v = counts[i];
    if (!(v > 0)) continue;
    detected += 1;
    total += v;
    if (v > max) max = v;
    if (v < lo) lo = v;
  }
  const nz = new Float32Array(detected);
  let k = 0;
  for (let i = 0; i < n; i += 1) if (counts[i] > 0) { nz[k] = counts[i]; k += 1; }
  nz.sort();
  return {
    requested: genes.slice(),
    used: Array.isArray(raw.genes_used) ? raw.genes_used.map(String) : genes.slice(),
    missing: Array.isArray(raw.genes_missing) ? raw.genes_missing.map(String) : [],
    unmatched: Number.isFinite(raw.n_unmatched) ? raw.n_unmatched : 0,
    counts, detected, total, max,
    lo: detected ? lo : 0,
    clamp: detected ? nz[Math.floor(0.99 * (detected - 1))] : 0,
  };
}

// ------------------------------------------------------------------------------------------------ styles
function categoryColors(f, colors) {
  const configured = colors[f.key] && typeof colors[f.key] === 'object' ? colors[f.key] : {};
  let next = 0;
  return f.categories.map((name) => {
    if (isColor(configured[name])) return configured[name].trim();
    const gray = GRAY_NAMES[name.toLowerCase()];
    if (gray) return gray;
    const c = PALETTE[next % PALETTE.length];
    next += 1;
    return c;
  });
}

/** Configured signature color of a positive_<slug> field (from the payload's colors), else null. */
function signatureColor(key, colors) {
  if (!key.startsWith('positive_')) return null;
  const slug = key.slice('positive_'.length).replace(POOLED_RE, '');
  const sig = colors.assigned_signature && colors.assigned_signature[slug];
  return isColor(sig) ? sig.trim() : null;
}

function boolColor(key, colors) {
  return BOOL_COLORS[key] || signatureColor(key, colors) || POSITIVE_COLOR;
}

/**
 * Bins of `d` sorted into nG groups by groupOf(i) in [0, nG): counts per group, the bin indices of every group not
 * hidden by off(g) (null for hidden ones), visible = 1 per drawn bin.
 */
function sortIntoGroups(d, nG, groupOf, off) {
  const { n, ok } = d;
  const counts = new Int32Array(nG);
  const groupIdx = new Int32Array(n);
  for (let i = 0; i < n; i += 1) {
    const g = ok[i] ? groupOf(i) : -1;
    groupIdx[i] = g;
    if (g >= 0) counts[g] += 1;
  }
  const idx = Array.from({ length: nG }, (_, g) => (off(g) ? null : new Int32Array(counts[g])));
  const fill = new Int32Array(nG);
  const visible = new Uint8Array(n);
  let shown = 0;
  for (let i = 0; i < n; i += 1) {
    const g = groupIdx[i];
    if (g < 0 || !idx[g]) continue;
    idx[g][fill[g]] = i;
    fill[g] += 1;
    visible[i] = 1;
    shown += 1;
  }
  return { counts, idx, visible, shown };
}

/** Color range {lo, hi} of a number field on its own: its smallest value to its 99th percentile; null without values. */
function numberRange(f) {
  if (!Number.isFinite(f.min)) return null;
  return { lo: f.min, hi: Number.isFinite(f.q99) && f.q99 > f.min ? f.q99 : f.max };
}

/**
 * Draw groups and legend of one field: groups = [{color, idx}] in drawing order (color may be NEUTRAL),
 * legend = [{key, label, color, count, off}], visible = 1 per drawn bin, scale = color bar of a number.
 * range {lo, hi}: the color range of a number shared with other panels (default: numberRange(f)).
 */
function buildStyle(d, f, hidden, range = null, base = false) {
  if (!f) {
    // no coloring: every bin in the neutral color; as the base map of "Color by: None" (base) it is one legend entry
    // that can be hidden, which leaves the layers alone (e.g. only the bins passing quality control, over the H&E image)
    const off = base && hidden.has(BASE);
    const s = sortIntoGroups(d, 1, () => 0, () => off);
    return {
      kind: 'none', groups: s.idx[0] ? [{ color: NEUTRAL, idx: s.idx[0] }] : [], visible: s.visible, shown: s.shown, scale: null,
      legend: base ? [{ key: BASE, label: 'Every bin (gray)', color: NEUTRAL, count: s.counts[0], off }] : [],
    };
  }
  // group of every bin, its color and legend entry; the last group holds bins without a value
  let groupOf;
  let entries;
  let scale = null;
  if (f.type === 'category') {
    const colors = categoryColors(f, d.colors);
    entries = f.categories.map((name, c) => ({ key: name, label: name, color: colors[c], gray: !!GRAY_NAMES[name.toLowerCase()] }));
    groupOf = (i) => (f.codes[i] < 0 ? entries.length : f.codes[i]);
  } else if (f.type === 'bool') {
    const [yes, no] = boolText(f.key);
    entries = [
      { key: 'yes', label: yes, color: boolColor(f.key, d.colors) },
      { key: 'no', label: no, color: NEUTRAL, gray: true },
    ];
    groupOf = (i) => (f.values[i] === 2 ? 2 : 1 - f.values[i]);
  } else {
    const r = range || numberRange(f);
    const log = LOG_FIELDS.has(f.key) && !!r && r.lo >= 0;
    const tf = log ? Math.log1p : (v) => v;
    const lo = r ? tf(r.lo) : 0;
    const span = r && r.hi > r.lo ? tf(r.hi) - lo : 0;
    entries = LUT.map((color, k) => ({ key: `level-${k}`, color }));
    groupOf = (i) => {
      const v = f.values[i];
      if (!Number.isFinite(v)) return LEVELS;
      return span > 0 ? Math.min(LEVELS - 1, Math.max(0, Math.floor(((tf(v) - lo) / span) * LEVELS))) : 0;
    };
    if (r) scale = { min: r.lo, max: r.hi, log, clamped: f.max > r.hi, shared: !!range };
  }
  const nG = entries.length + 1;
  const off = (g) => (g === nG - 1 ? hidden.has(MISSING) : f.type !== 'number' && hidden.has(entries[g].key));
  const s = sortIntoGroups(d, nG, groupOf, off);
  // drawing order: missing values, then gray / negative groups, then the rest (categories: larger first, so the rarer
  // ones stay visible on top; numbers: low to high)
  const order = [nG - 1];
  const rest = entries.map((e, g) => g);
  if (f.type === 'category') {
    rest.sort((a, b) => (entries[b].gray ? 1 : 0) - (entries[a].gray ? 1 : 0) || s.counts[b] - s.counts[a]);
  } else if (f.type === 'bool') {
    rest.reverse();
  }
  order.push(...rest);
  const groups = order.filter((g) => s.idx[g] && s.idx[g].length)
    .map((g) => ({ color: g === nG - 1 ? NEUTRAL : entries[g].color, idx: s.idx[g] }));
  const legend = f.type === 'number' ? [] : entries.map((e, g) => ({ key: e.key, label: e.label, color: e.color, count: s.counts[g], off: off(g) }));
  if (s.counts[nG - 1]) legend.push({ key: MISSING, label: 'no value', color: NEUTRAL, count: s.counts[nG - 1], off: off(nG - 1) });
  return { kind: f.type, groups, legend, visible: s.visible, shown: s.shown, scale };
}

/**
 * The answer of source.genes.top checked: {genes (top genes, the most bins first), bins (bins each tops), codes
 * (Int32Array: every bin's position in genes, -1 none), tied, empty, pooled, unmatched}.
 */
function prepareTop(raw, n) {
  if (!raw || typeof raw !== 'object') throw new Error('The server returned no top genes.');
  if (Number.isFinite(raw.n) && raw.n !== n) {
    throw new Error(`The top genes cover ${fmt.int(raw.n)} bins but the map has ${fmt.int(n)}; reload the page.`);
  }
  const genes = Array.isArray(raw.genes) ? raw.genes.map(String) : [];
  const src = Array.isArray(raw.codes) ? raw.codes : [];
  const codes = new Int32Array(n);
  for (let i = 0; i < n; i += 1) {
    const c = src[i];
    codes[i] = Number.isInteger(c) && c >= 0 && c < genes.length ? c : -1;
  }
  const num = (v) => (Number.isFinite(v) ? v : 0);
  return {
    genes, bins: Array.isArray(raw.bins) ? raw.bins.map(Number) : [], codes,
    tied: num(raw.n_tied), empty: num(raw.n_empty), pooled: raw.pooled !== false, unmatched: num(raw.n_unmatched),
  };
}

/**
 * Coloring by the top gene of every bin: the TOP_COLORS genes topping the most bins in a color of their own (PALETTE),
 * the other top genes in OTHER_COLOR, the bins without a top gene in the neutral color.
 */
function buildTopStyle(d, tv, hidden) {
  const k = Math.min(TOP_COLORS, tv.genes.length);
  const entries = tv.genes.slice(0, k).map((g, c) => ({ key: g, label: g, color: PALETTE[c] }));
  const nOther = tv.genes.length - k;
  const iOther = nOther > 0 ? entries.length : -1;
  if (nOther > 0) entries.push({ key: OTHER, label: `Other genes (${fmt.int(nOther)})`, color: OTHER_COLOR });
  const iEmpty = entries.length;
  entries.push({ key: EMPTY, label: 'No UMIs', color: NEUTRAL });
  const groupOf = (i) => {
    const c = tv.codes[i];
    if (c < 0) return iEmpty;
    return c < k ? c : iOther;
  };
  const off = (g) => hidden.has(entries[g].key);
  const s = sortIntoGroups(d, entries.length, groupOf, off);
  // drawing order: no UMIs, other genes, then the genes from the one topping the most bins (the rarer ones on top)
  const order = [iEmpty, ...(iOther >= 0 ? [iOther] : []), ...entries.slice(0, k).map((e, g) => g)];
  const groups = order.filter((g) => s.idx[g] && s.idx[g].length).map((g) => ({ color: entries[g].color, idx: s.idx[g] }));
  const legend = entries.map((e, g) => ({ key: e.key, label: e.label, color: e.color, count: s.counts[g], off: off(g) }))
    .filter((e) => e.key !== EMPTY || e.count);
  return { kind: 'top', top: tv, groups, legend, visible: s.visible, shown: s.shown, scale: null };
}

/**
 * Coloring by the cell types picked in "Color by cells" (f: the cell type field, a category): each picked type in its
 * color (configured signature color, else palette; categoryColors), the bins of every other type, and those without
 * one, in the neutral color ("Other cell types"). picked = null: every type in its color (buildStyle of the field).
 */
function buildCellStyle(d, f, picked, hidden, combos = []) {
  if (!picked) return buildStyle(d, f, hidden);
  const colors = categoryColors(f, d.colors);
  const codeOf = new Map(f.categories.map((name, c) => [name, c]));
  const entries = [];
  const slot = new Map(); // category code -> group
  for (const name of picked) {
    const c = codeOf.get(name);
    if (c === undefined || slot.has(c)) continue;
    slot.set(c, entries.length);
    entries.push({ key: name, label: name, color: colors[c] });
  }
  const nTypes = entries.length;
  // the overlap combinations of the picked types (cellOverlap): each in its own color, whatever type the bin has
  let comboOf = null;
  const firstCombo = entries.length;
  if (combos.length) {
    comboOf = new Int16Array(d.n).fill(-1);
    combos.forEach((c, j) => {
      for (const i of c.idx) comboOf[i] = firstCombo + j;
      entries.push({ key: c.key, label: `${c.label} (${fmt.int(c.clusters)} ${c.clusters === 1 ? 'cluster' : 'clusters'})`, color: c.color, shape: c.shape, edge: c.edge, combo: true });
    });
  }
  const iOther = entries.length;
  entries.push({ key: OTHER_CELLS, label: 'Other cell types', color: NEUTRAL });
  const groupOf = (i) => {
    if (comboOf && comboOf[i] >= 0) return comboOf[i];
    const g = slot.get(f.codes[i]);
    return g === undefined ? iOther : g;
  };
  const off = (g) => hidden.has(entries[g].key);
  const s = sortIntoGroups(d, entries.length, groupOf, off);
  // drawing order: the gray bins, then the picked types from the largest (the rarer ones stay visible on top), then
  // the combinations, the largest first
  const order = [iOther, ...entries.slice(0, nTypes).map((e, g) => g).sort((a, b) => s.counts[b] - s.counts[a])];
  for (let j = 0; j < combos.length; j += 1) order.push(firstCombo + j);
  const groups = order.filter((g) => s.idx[g] && s.idx[g].length)
    .map((g) => ({ color: entries[g].color, idx: s.idx[g], shape: entries[g].shape, edge: entries[g].edge, combo: !!entries[g].combo }));
  const legend = entries.map((e, g) => ({ key: e.key, label: e.label, color: e.color, shape: e.shape, edge: e.edge, count: s.counts[g], off: off(g) }));
  return { kind: 'category', groups, legend, visible: s.visible, shown: s.shown, scale: null };
}

/**
 * Coloring by the summed counts of genes: 0 in the neutral color, detected bins on viridis with a log(1 + x) scale
 * from the smallest nonzero count to the 99th percentile of the nonzero counts (higher counts take the top color), or
 * over `range` {lo, hi} shared with other panels.
 */
function buildGeneStyle(d, gv, hidden, range = null) {
  const { counts } = gv;
  const r = range || { lo: gv.lo, hi: gv.clamp };
  const lo = Math.log1p(r.lo);
  const span = Math.log1p(r.hi) - lo;
  // group 0: not detected; groups 1 .. LEVELS: detected, low to high
  const groupOf = (i) => {
    const v = counts[i];
    if (!(v > 0)) return 0;
    if (!(span > 0)) return LEVELS;
    return 1 + Math.min(LEVELS - 1, Math.max(0, Math.floor(((Math.log1p(v) - lo) / span) * LEVELS)));
  };
  const off = (g) => g === 0 && hidden.has(ZERO);
  const s = sortIntoGroups(d, LEVELS + 1, groupOf, off);
  const groups = [];
  for (let g = 0; g <= LEVELS; g += 1) {
    if (s.idx[g] && s.idx[g].length) groups.push({ color: g === 0 ? NEUTRAL : LUT[g - 1], idx: s.idx[g] });
  }
  return {
    kind: 'gene', gene: gv, groups, visible: s.visible, shown: s.shown,
    scale: gv.detected ? { min: r.lo, max: r.hi, log: true, clamped: gv.max > r.hi, shared: !!range } : null,
    legend: [{ key: ZERO, label: 'Not detected (0 UMIs)', color: NEUTRAL, count: s.counts[0], off: off(0) }],
  };
}

/**
 * Overlap combinations: the bins in two or more of `sets` ([{label, color}]; bitsOf(i) -> bitmask, bit k = set k),
 * grouped by their exact combination (1 + 2, 1 + 3, 2 + 3, 1 + 2 + 3 apart). Each has one color (its bins, its shapes
 * and its cluster outline): edges, the colors by combination order (farColors); nRank: the sets the combinations are
 * counted over (shape and color: comboRank). -> [{mask, key ('combo:<mask>'), label ('a + b'), color (= edge),
 * shape, edge, combo: true, idx, clusters, outline}], the most bins first.
 */
function overlapCombos(d, sets, bitsOf, edges = [OUTLINE_COLOR], nRank = sets.length) {
  const by = new Map();
  for (let i = 0; i < d.n; i += 1) {
    if (!d.ok[i]) continue;
    const m = bitsOf(i);
    if (!m || (m & (m - 1)) === 0) continue; // in no set or in one only
    let list = by.get(m);
    if (!list) { list = []; by.set(m, list); }
    list.push(i);
  }
  const combos = [];
  for (const [mask, list] of by) {
    const members = sets.filter((s, k) => mask & (1 << k));
    const idx = Int32Array.from(list);
    const edge = edges[comboRank(mask, nRank) % edges.length];
    combos.push({
      mask, key: `combo:${mask}`, label: members.map((s) => s.label).join(' + '),
      color: edge, shape: shapeOf(mask, nRank), edge, combo: true, idx, // one color: bins, shapes and outline
      clusters: countClusters(d, idx), outline: overlapOutline(d, idx),
    });
  }
  return combos.sort((a, b) => b.idx.length - a.idx.length || a.mask - b.mask);
}

/**
 * Overlays drawn on top of the coloring. layers = [{key, label, color, mask: (i) => bool | null (not available),
 * status}]. A bin in exactly one layer takes that layer's color; a bin in two or more gene layers (and no yes/no
 * layer) takes the color of its exact combination of genes, one group per combination (overlapCombos, outlined as
 * clusters); a bin in a yes/no layer and in another layer takes the SEVERAL color.
 * -> {layers (+ count: bins drawn in the layer's color, total: bins in the layer, overlap included), groups, combos,
 *     several (bins in the SEVERAL color), mixed (the same), active, member (Int16Array: first layer, -1 = none)}
 */
function buildOverlays(d, layers, edges = [OUTLINE_COLOR]) {
  const { n, ok } = d;
  const member = new Int16Array(n).fill(-1);
  const nIn = new Uint8Array(n); // layers the bin is in
  const geneBits = new Uint32Array(n); // gene layers the bin is in (bit k = layer k)
  const inBool = new Uint8Array(n); // in a yes/no layer
  const totals = layers.map(() => 0);
  layers.forEach((l, k) => {
    if (!l.mask) return;
    const m = l.mask;
    const gene = l.key.startsWith(GENE_OVERLAY);
    let c = 0;
    for (let i = 0; i < n; i += 1) {
      if (!ok[i] || !m(i)) continue;
      c += 1;
      if (member[i] < 0) member[i] = k;
      nIn[i] += 1;
      if (gene) geneBits[i] |= 1 << k; else inBool[i] = 1;
    }
    totals[k] = c;
  });
  // the gene layers come first (storeLines), so their combinations are ranked over them alone, as overlayLayers counts
  const nGenes = layers.filter((l) => l.key.startsWith(GENE_OVERLAY)).length;
  const combos = overlapCombos(d, layers.map((l) => ({ label: l.label, color: l.color })), (i) => (inBool[i] ? 0 : geneBits[i]),
    edges, nGenes);
  const inCombo = new Uint8Array(n);
  for (const c of combos) for (const i of c.idx) inCombo[i] = 1;
  const singles = layers.map(() => []);
  const mixed = [];
  for (let i = 0; i < n; i += 1) {
    if (member[i] < 0 || inCombo[i]) continue;
    if (nIn[i] >= 2) mixed.push(i); // a yes/no layer and another layer
    else singles[member[i]].push(i);
  }
  // larger layers first, so the rarer ones stay visible on top; then the combinations; mixed bins last
  const groups = layers.map((l, k) => k).filter((k) => singles[k].length).sort((a, b) => singles[b].length - singles[a].length)
    .map((k) => ({ color: layers[k].color, idx: Int32Array.from(singles[k]) }));
  for (const c of combos) groups.push({ color: c.color, idx: c.idx, shape: c.shape, edge: c.edge, combo: true });
  if (mixed.length) groups.push({ color: SEVERAL, idx: Int32Array.from(mixed) });
  return {
    layers: layers.map((l, k) => ({ ...l, count: l.mask ? singles[k].length : null, total: l.mask ? totals[k] : null })),
    groups, combos, several: mixed.length, mixed: mixed.length, member, active: layers.some((l) => l.mask),
  };
}

/** Legend label of the bins in the SEVERAL color (see buildOverlays). */
function severalLabel() {
  return 'Yes/no layer + another layer';
}

// ------------------------------------------------------------------------------------------------ drawing
function groupColor(c, palette) {
  if (c === NEUTRAL) return palette.neutral;
  if (c === SEVERAL) return palette.several || palette.text;
  return c;
}

/**
 * The overlap of the cell types picked in "Color by cells": the bins called positive (positivity call positive_<type>,
 * native depth) for two or more of them, one group per exact combination (overlapCombos), each in a color far from
 * the picked types' colors, from `fixed` (background, gray bins) and from the other combinations (farColors).
 * -> {combos, n (overlap bins), types (picked types with a call), without (picked types without one)}.
 */
function cellOverlap(d, picked, colorOf, fixed = []) {
  const types = [];
  const without = [];
  const fields = [];
  for (const t of picked) {
    const f = d.fields.get(`positive_${t}`);
    if (f && f.type === 'bool') { types.push(t); fields.push(f); } else without.push(t);
  }
  if (fields.length < 2) return { combos: [], n: 0, types, without };
  const sets = types.map((t) => ({ label: t, color: colorOf(t) }));
  // the cell types keep their own (configured) colors; the combinations take colors as far as can be from them, from
  // the background and gray bins, and from each other
  const edges = farColors(comboCount(types.length), [...picked.map(colorOf), ...fixed]);
  const combos = overlapCombos(d, sets, (i) => {
    let m = 0;
    for (let k = 0; k < fields.length; k += 1) if (fields[k].values[i] === 1) m |= 1 << k;
    return m;
  }, edges);
  return { combos, n: combos.reduce((s, c) => s + c.idx.length, 0), types, without };
}

/** Clusters of the overlap bins: groups of bins joined side by side on the bin grid (as their outline draws them). */
function countClusters(d, idx) {
  const p = d.pitch || 16;
  const KEY = 1 << 20;
  const at = new Map();
  for (const i of idx) at.set((Math.round(d.x[i] / p) + 8) * KEY + (Math.round(d.y[i] / p) + 8), i);
  const seen = new Set();
  let n = 0;
  for (const k0 of at.keys()) {
    if (seen.has(k0)) continue;
    n += 1;
    const stack = [k0];
    seen.add(k0);
    while (stack.length) {
      const k = stack.pop();
      for (const nk of [k - KEY, k + KEY, k - 1, k + 1]) {
        if (at.has(nk) && !seen.has(nk)) { seen.add(nk); stack.push(nk); }
      }
    }
  }
  return n;
}

/**
 * The outline of the overlap clusters: the squares of the overlap bins (one bin pitch wide) joined into shapes, and
 * the sides of a square that no other overlap bin shares, in µm: Float32Array [x1, y1, x2, y2, ...]. Neighbors are
 * found on the bin grid (centre / pitch, rounded), so touching bins make one cluster with one outline.
 */
function overlapOutline(d, idx) {
  const p = d.pitch || 16;
  const h = p / 2;
  const cell = (i) => [Math.round(d.x[i] / p), Math.round(d.y[i] / p)];
  const KEY = 1 << 20;
  const key = (gx, gy) => (gx + 8) * KEY + (gy + 8);
  const inside = new Set();
  for (const i of idx) { const [gx, gy] = cell(i); inside.add(key(gx, gy)); }
  const out = [];
  for (const i of idx) {
    const [gx, gy] = cell(i);
    const x = d.x[i];
    const y = d.y[i];
    if (!inside.has(key(gx - 1, gy))) out.push(x - h, y - h, x - h, y + h);
    if (!inside.has(key(gx + 1, gy))) out.push(x + h, y - h, x + h, y + h);
    if (!inside.has(key(gx, gy - 1))) out.push(x - h, y - h, x + h, y - h);
    if (!inside.has(key(gx, gy + 1))) out.push(x - h, y + h, x + h, y + h);
  }
  return Float32Array.from(out);
}

/**
 * The outline of the overlap clusters (overlapOutline) as a bright line: a dark halo under it, then the line in
 * `color`, so that it shows over light and dark bins alike; one path, stroked twice.
 */
function drawOutline(g, segs, view, ratio, color, halo) {
  if (!segs || !segs.length) return;
  const s = view.scale * ratio;
  const tx = view.tx * ratio;
  const ty = view.ty * ratio;
  const W = g.canvas.width;
  const H = g.canvas.height;
  g.save();
  g.beginPath();
  for (let k = 0; k < segs.length; k += 4) {
    const x1 = segs[k] * s + tx;
    const y1 = segs[k + 1] * s + ty;
    const x2 = segs[k + 2] * s + tx;
    const y2 = segs[k + 3] * s + ty;
    if (Math.max(x1, x2) < -4 || Math.min(x1, x2) > W + 4 || Math.max(y1, y2) < -4 || Math.min(y1, y2) > H + 4) continue;
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
  }
  const w = Math.max(2.5 * ratio, Math.min(4 * ratio, 0.22 * (s * 16)));
  g.lineCap = "square";
  g.lineJoin = "miter";
  g.strokeStyle = halo;
  g.lineWidth = w + 2 * ratio;
  g.stroke();
  g.strokeStyle = color;
  g.lineWidth = w;
  g.stroke();
  g.restore();
}

/**
 * Bins of `groups` as squares of `side` css px; view {scale, tx, ty} in css px; ratio = device px per css px;
 * dim = share of the background mixed into every color. Square edges snap outward to whole pixels: squares stay crisp
 * and neighboring bins always meet (no seams).
 */
function drawBins(g, groups, d, view, ratio, side, palette, dim = 0) {
  const W = g.canvas.width;
  const H = g.canvas.height;
  const s = view.scale * ratio;
  const tx = view.tx * ratio;
  const ty = view.ty * ratio;
  const half = Math.max(0.5, (side * ratio) / 2);
  const { x, y } = d;
  for (const grp of groups) {
    if (grp.combo) {
      // an overlap combination: its one color, never dimmed; once a bin is big enough, the bin in a dark shade of that
      // color with the combination's shape (circle, triangle, ...) in the color itself; smaller, a square in the color
      if (grp.shape && half >= SHAPE_MIN_PX * ratio) {
        g.fillStyle = mixColor(grp.color, palette.bg, 0.62);
        for (const i of grp.idx) {
          const cx = x[i] * s + tx;
          const cy = y[i] * s + ty;
          if (cx + half < 0 || cx - half > W || cy + half < 0 || cy - half > H) continue;
          g.fillRect(Math.floor(cx - half), Math.floor(cy - half), Math.ceil(cx + half) - Math.floor(cx - half), Math.ceil(cy + half) - Math.floor(cy - half));
        }
        g.fillStyle = grp.color;
        drawShapes(g, grp, d, s, tx, ty, half, ratio);
        continue;
      }
      g.fillStyle = grp.color;
    } else {
      const c = groupColor(grp.color, palette);
      g.fillStyle = dim ? mixColor(c, palette.bg, dim) : c;
    }
    const idx = grp.idx;
    for (let k = 0; k < idx.length; k += 1) {
      const i = idx[k];
      const cx = x[i] * s + tx;
      const left = Math.floor(cx - half);
      const right = Math.ceil(cx + half);
      if (right < 0 || left > W) continue;
      const cy = y[i] * s + ty;
      const top = Math.floor(cy - half);
      const bottom = Math.ceil(cy + half);
      if (bottom < 0 || top > H) continue;
      g.fillRect(left, top, right - left, bottom - top);
    }
  }
}

/**
 * The bins of an overlap combination as its shape (grp.shape, see SHAPES), centred on each bin and as wide as it,
 * filled with the current fill style (its color) and edged in dark, so that 1 + 2, 1 + 3, 2 + 3 and 1 + 2 + 3
 * differ by their shape as well as by their colors. One path, filled and stroked once.
 */
function drawShapes(g, grp, d, s, tx, ty, half, ratio) {
  const W = g.canvas.width;
  const H = g.canvas.height;
  const r = half * 0.98;
  g.beginPath();
  for (const i of grp.idx) {
    const cx = d.x[i] * s + tx;
    const cy = d.y[i] * s + ty;
    if (cx + r < 0 || cx - r > W || cy + r < 0 || cy - r > H) continue;
    shapePath(g, grp.shape, cx, cy, r);
  }
  g.fill(); // in the combination's color (the fill style set by drawBins)
  g.save();
  g.lineJoin = 'round';
  g.lineWidth = Math.max(ratio, Math.min(1.6 * ratio, 0.1 * r)); // a thin dark edge: the shape stands off its bin
  g.strokeStyle = OUTLINE_HALO;
  g.stroke();
  g.restore();
}

/** Add one shape (SHAPES) of radius r centred on (cx, cy) to the current path. */
function shapePath(g, shape, cx, cy, r) {
  const poly = (pts) => {
    g.moveTo(cx + pts[0][0] * r, cy + pts[0][1] * r);
    for (let k = 1; k < pts.length; k += 1) g.lineTo(cx + pts[k][0] * r, cy + pts[k][1] * r);
    g.closePath();
  };
  const ring = (n, rot, inner = null) => {
    const pts = [];
    const steps = inner ? 2 * n : n;
    for (let k = 0; k < steps; k += 1) {
      const a = rot + (k * 2 * Math.PI) / steps;
      const rr = inner && k % 2 ? inner : 1;
      pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
    }
    poly(pts);
  };
  switch (shape) {
    case 'circle':
      g.moveTo(cx + r * 0.9, cy);
      g.arc(cx, cy, r * 0.9, 0, 2 * Math.PI);
      break;
    case 'triangle': poly([[0, -1], [0.95, 0.75], [-0.95, 0.75]]); break;
    case 'triangle-down': poly([[0, 1], [0.95, -0.75], [-0.95, -0.75]]); break;
    case 'diamond': poly([[0, -1], [1, 0], [0, 1], [-1, 0]]); break;
    case 'star': ring(5, -Math.PI / 2, 0.45); break;
    case 'cross': {
      const t = 0.34;
      poly([[-t, -1], [t, -1], [t, -t], [1, -t], [1, t], [t, t], [t, 1], [-t, 1], [-t, t], [-1, t], [-1, -t], [-t, -t]]);
      break;
    }
    case 'hexagon': ring(6, 0); break;
    default: poly([[-0.8, -0.8], [0.8, -0.8], [0.8, 0.8], [-0.8, 0.8]]);
  }
}

/** A legend swatch of an overlap combination: its shape in its color, with a dark edge, on a canvas of `px` css px. */
function shapeSwatch(color, shape, px = 14) {
  const k = 2; // drawn at twice the size, shown at px
  const c = document.createElement('canvas');
  c.width = px * k;
  c.height = px * k;
  c.className = 'sv-shape-swatch';
  c.style.width = `${px}px`;
  c.style.height = `${px}px`;
  const g = c.getContext('2d');
  g.beginPath();
  shapePath(g, shape, (px * k) / 2, (px * k) / 2, (px * k) / 2 - 2);
  g.fillStyle = color; // the combination's one color, as its bins and outline on the map
  g.fill();
  g.lineJoin = 'round';
  g.lineWidth = 2;
  g.strokeStyle = OUTLINE_HALO;
  g.stroke();
  return c;
}

/**
 * The part of the H&E image inside the css px rectangle (x0, y0, w, h) for the view t {scale, tx, ty}: image pixel u
 * is at u / pxPerUm µm, so at u * scale / pxPerUm + tx css px. Only the visible pixels are read.
 */
function drawImageUnder(g, im, t, x0, y0, w, h) {
  const k = t.scale / im.pxPerUm; // css px per image pixel
  if (!(k > 0)) return;
  const sx0 = Math.max(0, Math.floor((x0 - t.tx) / k));
  const sy0 = Math.max(0, Math.floor((y0 - t.ty) / k));
  const sx1 = Math.min(im.width, Math.ceil((x0 + w - t.tx) / k));
  const sy1 = Math.min(im.height, Math.ceil((y0 + h - t.ty) / k));
  if (sx1 <= sx0 || sy1 <= sy0) return;
  g.drawImage(im.img, sx0, sy0, sx1 - sx0, sy1 - sy0, t.tx + sx0 * k, t.ty + sy0 * k, (sx1 - sx0) * k, (sy1 - sy0) * k);
}

/** Scale bar of a "nice" length (1, 2 or 5 x 10^k µm, about 120 px long) with its bottom-left corner at (x, y). */
function drawScaleBar(g, scale, x, y, palette) {
  const raw = 120 / scale;
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  const um = Number(((m >= 5 ? 5 : m >= 2 ? 2 : 1) * p).toPrecision(3));
  const len = um * scale;
  const label = um >= 1000 ? `${Number((um / 1000).toPrecision(3))} mm` : `${um} µm`;
  g.save();
  g.font = `600 11px ${FONT}`;
  const boxW = Math.max(len, g.measureText(label).width) + 16;
  g.globalAlpha = 0.85;
  g.fillStyle = palette.bg;
  g.fillRect(x, y - 34, boxW, 34);
  g.globalAlpha = 1;
  g.strokeStyle = palette.text;
  g.fillStyle = palette.text;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(x + 8, y - 13);
  g.lineTo(x + 8, y - 8);
  g.lineTo(x + 8 + len, y - 8);
  g.lineTo(x + 8 + len, y - 13);
  g.stroke();
  g.textBaseline = 'alphabetic';
  g.fillText(label, x + 8, y - 17);
  g.restore();
}

/** Dashed crosshair through (x, y) across a w x h css px canvas, with a ring at the point. */
function drawCrosshair(g, x, y, w, hgt, palette) {
  const px = Math.round(x) + 0.5;
  const py = Math.round(y) + 0.5;
  g.save();
  g.globalAlpha = 0.7;
  g.lineWidth = 1;
  g.strokeStyle = palette.text;
  g.setLineDash([4, 4]);
  g.beginPath();
  g.moveTo(0, py);
  g.lineTo(w, py);
  g.moveTo(px, 0);
  g.lineTo(px, hgt);
  g.stroke();
  g.setLineDash([]);
  g.globalAlpha = 1;
  g.beginPath();
  g.arc(x, y, 6, 0, Math.PI * 2);
  g.lineWidth = 3;
  g.strokeStyle = palette.bg;
  g.stroke();
  g.lineWidth = 1.5;
  g.strokeStyle = palette.text;
  g.stroke();
  g.restore();
}

function readTheme(el) {
  const cs = getComputedStyle(el);
  const v = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
  const text = v('--text', '#18212c');
  return {
    bg: v('--plot-bg', '#ffffff'), neutral: v('--plot-neutral', '#c9d0da'),
    text, muted: v('--text-muted', '#566273'), several: text,
  };
}

/** css px per µm that fits the box b (plus one bin) into a z.w x z.h area with a small padding. */
function fitScaleFor(b, pitch, z) {
  const pad = Math.min(24, z.w / 8, z.h / 8);
  const s = Math.min((z.w - 2 * pad) / (b.x1 - b.x0 + pitch), (z.h - 2 * pad) / (b.y1 - b.y0 + pitch));
  return Number.isFinite(s) && s > 0 ? s : 1;
}

/** The image at url, loaded (rejects with an AbortError when signal aborts). */
function fetchImage(url, signal) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const done = () => {
      img.onload = null;
      img.onerror = null;
      signal.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      done();
      img.removeAttribute('src');
      reject(new DOMException('The request was aborted.', 'AbortError'));
    };
    img.onload = () => { done(); resolve(img); };
    img.onerror = () => { done(); reject(new Error('The H&E image could not be loaded.')); };
    if (signal.aborted) { onAbort(); return; }
    signal.addEventListener('abort', onAbort);
    img.decoding = 'async';
    img.src = url;
  });
}

// ------------------------------------------------------------------------------------------------ gene box
const GENE_PAGE = 100; // genes per page of a gene box's list; the next page comes as the list scrolls to its end

/**
 * Text box for gene names with suggestions: names separated by commas, spaces or +; the last one is completed from
 * search(query, signal, offset) -> [{gene, total_umi, pct_bins_detected}], GENE_PAGE matches from the offset-th on
 * (debounced, stale requests aborted; an empty query lists every gene, the most abundant first, on focus unless
 * suggestOnFocus is false). The list holds every match: scrolled (or ↓) to its end it asks for the next page, until
 * a page comes short. ↑ / ↓ pick a suggestion, Enter or a click takes it and submits, Enter alone (or the button)
 * submits onSubmit(names, text typed), Esc closes the list (then calls onCancel when given).
 * Returns {el, input, set(text), focus(), destroy()}.
 */
export function geneInput({
  id, label = 'Genes', placeholder = 'e.g. Ctsk, Acp5', submitLabel = 'Show', search, onSubmit, onCancel, suggestOnFocus = true,
} = {}) {
  const inputId = id || uid('sv-genes');
  const listId = `${inputId}-list`;
  const input = h('input', {
    class: 'input mono', type: 'text', id: inputId, placeholder, spellcheck: false, autocomplete: 'off',
    role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': listId,
  });
  const list = h('ul', { class: 'sv-suggest', id: listId, role: 'listbox', 'aria-label': `${label}: suggestions`, hidden: true });
  const el = h('div', { class: 'sv-gene-box' },
    h('div', { class: 'sv-gene-field' }, input, list),
    h('button', { class: 'btn small', type: 'button', onClick: () => submit() }, submitLabel),
    onCancel ? h('button', {
      class: 'btn small ghost icon-only', type: 'button', title: 'Cancel', 'aria-label': 'Cancel', onClick: () => onCancel(),
    }, icon('x', { size: 14 })) : null);
  let items = [];
  let active = -1;
  let ctrl = null;
  let seq = 0;
  let asked = ''; // the name the list was asked for
  let more = false; // the last page was full: more matches may follow
  let loadingMore = false;
  // the end of the list: "Loading more genes…" while a page is on its way (not an option)
  const moreEl = h('li', { class: 'sv-suggest-more', role: 'presentation', hidden: true });

  const lastToken = () => {
    const m = /[^\s,;+]*$/.exec(input.value);
    return m ? m[0] : '';
  };

  const genesOf = (res) => (Array.isArray(res) ? res : []).filter((r) => r && r.gene);

  const lookup = debounce(async () => {
    if (!search || document.activeElement !== input) return;
    const my = ++seq;
    if (ctrl) ctrl.abort();
    const c = new AbortController();
    ctrl = c;
    const q = lastToken();
    try {
      const page = genesOf(await search(q, c.signal, 0));
      if (my !== seq || document.activeElement !== input) return;
      items = page;
      asked = q;
      more = page.length >= GENE_PAGE;
      active = -1;
      paintList();
      list.scrollTop = 0;
    } catch (err) {
      // suggestions are a help only: names can still be typed
      if (my === seq && !(err && err.name === 'AbortError')) close();
    } finally {
      if (ctrl === c) ctrl = null;
    }
  }, 180);

  /** The next page of the list (scrolled to its end, or ↓ near it). */
  async function loadMore() {
    if (!search || !more || loadingMore || list.hidden) return;
    const my = seq;
    loadingMore = true;
    paintMore();
    const c = new AbortController();
    ctrl = c;
    try {
      const page = genesOf(await search(asked, c.signal, items.length));
      if (my !== seq) return;
      more = page.length >= GENE_PAGE;
      const start = items.length;
      items = items.concat(page);
      for (let k = start; k < items.length; k += 1) list.insertBefore(itemEl(items[k], k), moreEl);
    } catch (err) {
      if (my === seq && !(err && err.name === 'AbortError')) more = false; // the list keeps what it has
    } finally {
      if (ctrl === c) ctrl = null;
      if (my === seq) {
        loadingMore = false;
        paintMore();
      }
    }
  }

  function meta(r) {
    const parts = [];
    if (Number.isFinite(r.n_bins)) parts.push(`${fmt.int(r.n_bins)} bins`); // a cell type (Color by cells)
    if (Number.isFinite(r.total_umi)) parts.push(`${fmt.int(r.total_umi)} UMIs`);
    if (Number.isFinite(r.pct_bins_detected)) parts.push(`${fmt.num(r.pct_bins_detected, 1)}% of bins`);
    return parts.join(' · ');
  }

  function itemEl(r, k) {
    return h('li', {
      id: `${inputId}-opt-${k}`, role: 'option', class: k === active ? 'active' : null,
      'aria-selected': k === active ? 'true' : 'false',
      onMousedown: (e) => { e.preventDefault(); take(k); }, // before the input's blur
    }, h('span', { class: 'sv-suggest-gene' }, String(r.gene)), h('span', { class: 'sv-suggest-meta' }, meta(r)));
  }

  function paintMore() {
    moreEl.hidden = !loadingMore;
    moreEl.textContent = loadingMore ? 'Loading more genes…' : '';
  }

  function paintList() {
    if (!items.length) { close(); return; }
    mount(list, items.map((r, k) => itemEl(r, k)), moreEl);
    paintMore();
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    markActive(-1);
  }

  /** Move the highlight from item `prev` to item `active` (no list made again: it may hold thousands of genes). */
  function markActive(prev) {
    const lis = list.children;
    if (prev >= 0 && prev < items.length && lis[prev]) {
      lis[prev].classList.remove('active');
      lis[prev].setAttribute('aria-selected', 'false');
    }
    if (active >= 0 && lis[active]) {
      lis[active].classList.add('active');
      lis[active].setAttribute('aria-selected', 'true');
      input.setAttribute('aria-activedescendant', `${inputId}-opt-${active}`);
      lis[active].scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  function close() {
    items = [];
    active = -1;
    more = false;
    loadingMore = false;
    list.hidden = true;
    mount(list);
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }

  function stop() {
    lookup.cancel();
    seq += 1;
    if (ctrl) ctrl.abort();
    ctrl = null;
  }

  function take(k) {
    const r = items[k];
    if (!r) return;
    const tok = lastToken();
    input.value = `${input.value.slice(0, input.value.length - tok.length)}${r.gene}`;
    submit();
  }

  function submit() {
    stop();
    close();
    if (onSubmit) onSubmit(parseGenes(input.value), input.value);
  }

  // the list scrolled near its end: the next page
  list.addEventListener('scroll', () => {
    if (list.scrollTop + list.clientHeight >= list.scrollHeight - 48) loadMore();
  });
  // a press on the list (its scroll bar, a gap) keeps the focus in the box, so the list stays open
  list.addEventListener('mousedown', (e) => e.preventDefault());
  input.addEventListener('input', () => lookup());
  input.addEventListener('focus', () => { if (suggestOnFocus) lookup(); });
  input.addEventListener('blur', () => { stop(); close(); });
  input.addEventListener('keydown', (e) => {
    const open = !list.hidden && items.length > 0;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { lookup(); return; }
      const prev = active;
      const next = active + (e.key === 'ArrowDown' ? 1 : -1);
      active = next < -1 ? items.length - 1 : (next >= items.length ? -1 : next);
      markActive(prev);
      if (active >= items.length - 5) loadMore();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && active >= 0) take(active);
      else submit();
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        stop();
        close();
      } else if (onCancel) {
        e.preventDefault();
        onCancel();
      }
    }
  });
  return {
    el,
    input,
    set(text) { input.value = text; },
    focus() { input.focus(); },
    destroy() { stop(); },
  };
}

// ------------------------------------------------------------------------------------------------ sources
/** Data source of the Viewer tab of a run: the per-bin table of its results and the raw data of its config.json. */
export function runSource(runId) {
  const enc = encodeURIComponent(runId);
  return {
    name: runId,
    emptyText: 'This run has no per-bin table (per_bin_signature_calls), so there is nothing to map.',
    samples: (signal) => api(`/api/runs/${enc}/bins/samples`, { signal }),
    bins: (sampleId, signal) => api(`/api/runs/${enc}/bins`, { query: { sample: sampleId }, signal }),
    genes: {
      async search(sampleId, query, signal, { offset = 0, limit = 50 } = {}) {
        const res = await api(`/api/runs/${enc}/genes`, { query: { sample: sampleId, query, limit, offset }, signal });
        return res && Array.isArray(res.genes) ? res.genes : [];
      },
      values: (sampleId, genes, signal) => api(`/api/runs/${enc}/gene`, { method: 'POST', body: { sample: sampleId, genes }, signal }),
      bin: (sampleId, index, signal) => api(`/api/runs/${enc}/bin`, { query: { sample: sampleId, index }, signal }),
      top: (sampleId, signal) => api(`/api/runs/${enc}/top-genes`, { query: { sample: sampleId }, signal }),
      overlapGenes: (sampleId, indices, thresholds, signal) => api(`/api/runs/${enc}/overlap-genes`, {
        method: 'POST', body: { sample: sampleId, indices, ...thresholds }, signal,
      }),
    },
    async image(sampleId, signal) {
      try {
        return await api(`/api/runs/${enc}/bins/image`, { query: { sample: sampleId }, signal });
      } catch (err) {
        if (err && err.status === 404) return null;
        throw err;
      }
    },
  };
}

// ------------------------------------------------------------------------------------------------ component
function initStore(store) {
  if (!Number.isInteger(store.layout) || store.layout < 1 || store.layout > MAX_PANELS) store.layout = 1;
  // each panel pans and zooms on its own unless "Linked" is turned on
  if (typeof store.link !== 'boolean') store.link = false;
  if (typeof store.sameScale !== 'boolean') store.sameScale = true;
  if (!Number.isFinite(store.pointSize)) store.pointSize = 1;
  if (!store.image || typeof store.image !== 'object') store.image = { on: false, opacity: 0.5 };
  if (!Number.isFinite(store.image.opacity)) store.image.opacity = 0.5;
  if (!(store.data instanceof Map)) store.data = new Map();
  if (!(store.geneData instanceof Map)) store.geneData = new Map();
  if (!(store.topData instanceof Map)) store.topData = new Map();
  if (!(store.images instanceof Map)) store.images = new Map();
  if (!Array.isArray(store.panels)) store.panels = [];
  if (!goodView(store.view)) store.view = null;
}

/**
 * spatialViewer({source, store, binUm, emptyText}) -> {el, destroy(), show(patch)}
 * source and store: see the top of this file. binUm: bin size in µm (estimated from the positions when missing).
 * emptyText: text of the empty state (no sections, or samples() answered 404).
 * show({panel = 0, sample?, field?, genes? (names or text; colors the panel by their summed counts), overlays?})
 * changes what a panel shows, e.g. after a click in a gene list.
 */
export function spatialViewer({ source, store, binUm: binUmOption, emptyText }) {
  initStore(store);
  const hasGenes = !!(source.genes && typeof source.genes.search === 'function' && typeof source.genes.values === 'function');
  const hasBinGenes = hasGenes && typeof source.genes.bin === 'function';
  const hasTop = hasGenes && typeof source.genes.top === 'function';
  const hasOverlapGenes = hasGenes && typeof source.genes.overlapGenes === 'function';
  const hasImage = typeof source.image === 'function';

  let destroyed = false;
  let samples = Array.isArray(store.samples) && store.samples.length ? store.samples : null;
  let theme = null;
  let frame = 0;
  let pointer = null; // {panel, x, y}: the position (µm) under the mouse, a crosshair in the other panels
  let lastPanel = 0; // the panel used last: its view becomes the linked one when linking is turned on
  let startCtrl = null;
  const panels = [];
  const inflight = new Map(); // request key -> {ctrl, promise}; one request per key, shared by the panels

  // ---- toolbar
  // "Panels": one button per count from 1 to the number of sections (at most MAX_PANELS), made once they are known
  let layoutBtns = [];
  const layoutGroup = h('div', { class: 'btn-group sv-layout', role: 'group', 'aria-label': 'Number of panels' });
  const layoutCtl = h('div', { class: 'sv-control sv-control-auto', hidden: true },
    h('span', { class: 'sv-control-label' }, 'Panels'), layoutGroup);
  /** The most panels this viewer offers: one per section, at most MAX_PANELS. */
  const maxPanels = () => Math.max(1, Math.min(MAX_PANELS, samples ? samples.length : 1));
  function paintLayoutBtns() {
    const n = maxPanels();
    layoutBtns = Array.from({ length: n }, (_, j) => j + 1).map((k) => h('button', {
      class: 'btn small', type: 'button', title: layoutTitle(k), 'aria-label': layoutTitle(k), 'aria-pressed': 'false',
      dataset: { k: String(k) }, onClick: () => setLayout(k),
    }, String(k)));
    mount(layoutGroup, layoutBtns);
    layoutCtl.hidden = n < 2; // one section: one panel, nothing to choose
  }
  const linkWrap = h('div', { class: 'sv-control sv-control-auto' },
    h('span', { class: 'sv-control-label' }, 'Pan and zoom'),
    h('div', { class: 'sv-switch-row' }, switchToggle({
      checked: store.link, label: 'Linked', title: 'Pan and zoom every panel together', onChange: (on) => setLink(on),
    })));
  const scaleWrap = h('div', { class: 'sv-control sv-control-auto' },
    h('span', { class: 'sv-control-label' }, 'Color scales'),
    h('div', { class: 'sv-switch-row' }, switchToggle({
      checked: store.sameScale, label: 'Shared',
      title: 'Panels colored by the same genes or the same number use one color scale, so that their colors compare',
      onChange: (on) => {
        store.sameScale = on;
        for (const p of panels) p.restyle();
      },
    })));
  const sizeId = uid('sv-size');
  const sizeOut = h('output', { class: 'sv-size-out', for: sizeId });
  const sizeInput = h('input', {
    type: 'range', id: sizeId, min: 0.5, max: 3, step: 0.25, value: store.pointSize, class: 'sv-range',
    onInput: () => {
      store.pointSize = Number(sizeInput.value) || 1;
      sizeOut.textContent = `${store.pointSize}×`;
      for (const p of panels) p.requestRender();
    },
  });
  sizeOut.textContent = `${store.pointSize}×`;
  let imageCtl = null;
  if (hasImage) {
    const opacity = h('input', {
      type: 'range', min: 0, max: 1, step: 0.05, value: store.image.opacity, class: 'sv-range', disabled: !store.image.on,
      'aria-label': 'H&E image: how much of it shows through the bins', title: 'How much of the image shows through the bins',
      onInput: () => {
        const v = Number(opacity.value);
        store.image.opacity = Number.isFinite(v) ? v : 0.5;
        for (const p of panels) p.queuePaint();
      },
    });
    imageCtl = h('div', { class: 'sv-control sv-control-auto' },
      h('span', { class: 'sv-control-label' }, 'H&E image'),
      h('div', { class: 'sv-range-row' }, switchToggle({
        checked: store.image.on, label: 'Show', title: 'Draw the H&E image under the bins',
        onChange: (on) => {
          store.image.on = on;
          opacity.disabled = !on;
          for (const p of panels) p.imageChanged();
          prune();
        },
      }), opacity));
  }
  // a quiet button at the end of the toolbar: the viewer's controls come first
  const saveBtn = h('button', {
    class: 'btn small ghost sv-save', type: 'button', onClick: savePng, disabled: true,
    title: 'Save the panels, with their legends, as a PNG image',
  }, icon('download', { size: 14 }), 'Save PNG');
  const toolbar = h('div', { class: 'sv-toolbar' },
    layoutCtl,
    linkWrap,
    scaleWrap,
    h('div', { class: 'sv-control' }, h('label', { for: sizeId }, 'Point size'), h('div', { class: 'sv-range-row' }, sizeInput, sizeOut)),
    imageCtl,
    h('span', { class: 'spacer' }),
    saveBtn);
  const panelsEl = h('div', { class: 'sv-panels' });
  const el = h('div', { class: 'sv', dataset: { layout: String(store.layout) } }, toolbar, panelsEl,
    h('p', { class: 'sv-note' }, 'Drag to pan, scroll or double-click to zoom (Shift + double-click zooms out); with a map focused, the arrow keys pan, + and − zoom and 0 fits. Hover a bin for its values; click a legend entry to hide or show it, Alt + click to show only that entry.'));

  // ---- shared observers
  const resizeObserver = new ResizeObserver((entries) => {
    for (const e of entries) {
      const p = panels.find((q) => q.stage === e.target);
      if (p) p.resize();
      const q = panels.find((x) => x.el === e.target);
      if (q) q.markWidth();
    }
    if (store.link && store.view && store.view.auto) fitLinked();
  });
  const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const onTheme = () => {
    theme = null;
    for (const p of panels) p.requestRender();
  };
  darkQuery.addEventListener('change', onTheme);
  const themeObserver = new MutationObserver(onTheme);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // ---- frames
  function schedule() {
    if (!frame && !destroyed) frame = requestAnimationFrame(tick);
  }

  function tick() {
    frame = 0;
    if (destroyed) return;
    if (!theme && el.isConnected) theme = readTheme(el);
    for (const p of panels) p.step();
  }

  // ---- requests (shared by the panels; aborted once no panel waits for them)
  function request(key, fn) {
    let entry = inflight.get(key);
    if (!entry) {
      const ctrl = new AbortController();
      const mine = { ctrl, promise: null };
      inflight.set(key, mine);
      mine.promise = (async () => {
        try {
          return await fn(ctrl.signal);
        } finally {
          if (inflight.get(key) === mine) inflight.delete(key);
        }
      })();
      entry = mine;
    }
    return entry.promise;
  }

  function prune() {
    const wanted = new Set();
    for (const p of panels) for (const k of p.wants()) wanted.add(k);
    for (const [key, r] of inflight) {
      if (wanted.has(key)) continue;
      r.ctrl.abort();
      inflight.delete(key);
    }
  }

  function loadBins(sid) {
    const cached = store.data.get(sid);
    if (cached) return Promise.resolve(cached);
    return request(`bins\n${sid}`, async (signal) => {
      const d = prepare(await source.bins(sid, signal));
      d.pitch = Number.isFinite(binUmOption) && binUmOption > 0 ? binUmOption : (d.valid > 1 ? estimatePitch(d) : 16);
      d.grid = d.valid ? buildIndex(d, d.pitch * 2) : null;
      store.data.set(sid, d);
      return d;
    });
  }

  /** A gene vector of the store's cache, made the most recently used one; undefined when not cached. */
  function cachedGene(ck) {
    const gv = store.geneData.get(ck);
    if (gv) {
      store.geneData.delete(ck);
      store.geneData.set(ck, gv);
    }
    return gv;
  }

  function loadGene(sid, d, genes) {
    const ck = `${sid}\n${genesKey(genes)}`;
    const cached = cachedGene(ck);
    if (cached) return Promise.resolve(cached);
    return request(`gene\n${ck}`, async (signal) => {
      const gv = prepareGene(await source.genes.values(sid, genes, signal), genes, d.n);
      store.geneData.set(ck, gv);
      while (store.geneData.size > GENE_CACHE) store.geneData.delete(store.geneData.keys().next().value);
      return gv;
    });
  }

  /** The top gene of every bin of a section (kept like the bins: one answer per section). */
  function loadTop(sid, d) {
    const cached = store.topData.get(sid);
    if (cached) return Promise.resolve(cached);
    return request(`top\n${sid}`, async (signal) => {
      const tv = prepareTop(await source.genes.top(sid, signal), d.n);
      store.topData.set(sid, tv);
      return tv;
    });
  }

  /** The H&E image of a section; retry: after a failure (a source may then ask its server for a new address). */
  function loadImage(sid, retry = false) {
    const cached = store.images.get(sid);
    if (cached) return Promise.resolve(cached);
    return request(`image\n${sid}`, async (signal) => {
      const meta = await source.image(sid, signal, { retry });
      const ppu = meta ? Number(meta.px_per_um) : NaN;
      if (!meta || !meta.url || !(ppu > 0)) {
        const none = { none: true };
        store.images.set(sid, none);
        return none;
      }
      const img = await fetchImage(apiUrl(String(meta.url)), signal);
      // a server that sent a smaller copy of the image than its stated size: scale px_per_um with it
      const k = Number(meta.width) > 0 && img.naturalWidth ? img.naturalWidth / Number(meta.width) : 1;
      const entry = { img, pxPerUm: ppu * k, width: img.naturalWidth, height: img.naturalHeight };
      store.images.set(sid, entry);
      return entry;
    });
  }

  // ---- linked views
  /** View that fits the sections of every panel into the smallest panel, or null before any section is loaded. */
  function linkedFit() {
    let b = null;
    let pitch = 0;
    for (const p of panels) {
      const d = p.data();
      if (!d || !d.valid) continue;
      b = b ? {
        x0: Math.min(b.x0, d.bbox.x0), y0: Math.min(b.y0, d.bbox.y0),
        x1: Math.max(b.x1, d.bbox.x1), y1: Math.max(b.y1, d.bbox.y1),
      } : { ...d.bbox };
      pitch = Math.max(pitch, d.pitch);
    }
    if (!b) return null;
    let s = Infinity;
    for (const p of panels) {
      const z = p.size();
      if (z.w && z.h) s = Math.min(s, fitScaleFor(b, pitch, z));
    }
    return Number.isFinite(s) ? { cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, scale: s } : null;
  }

  function fitLinked() {
    const v = linkedFit();
    if (!v) return null;
    store.view = { ...v, auto: true };
    for (const p of panels) p.requestRender();
    return store.view;
  }

  /** The view of `from` moved: copy the layers now (all panels when linked); a zoom also redraws once it settles. */
  function viewMoved(from, zooming) {
    for (const p of store.link ? panels : [from]) {
      p.queuePaint();
      if (zooming) p.crisp();
    }
  }

  function viewSettled(from) {
    for (const p of store.link ? panels : [from]) p.requestRender();
  }

  function setPointer(next) {
    if (!next && !pointer) return;
    const from = next ? next.panel : pointer.panel;
    pointer = next;
    if (store.link) for (const p of panels) if (p.index !== from) p.queuePaint();
  }

  function setLink(on) {
    if (on === store.link) return;
    setPointer(null);
    if (on) {
      const src = panels[lastPanel] || panels[0];
      const v = src ? src.ownView() : null;
      store.link = true;
      store.view = null;
      if (goodView(v) && !v.auto) store.view = { cx: v.cx, cy: v.cy, scale: v.scale };
      else fitLinked();
    } else {
      store.link = false;
      if (goodView(store.view)) for (const p of panels) p.adoptView(store.view);
    }
    for (const p of panels) p.requestRender();
  }

  // ---- shared color scales: panels colored by the same genes or the same number use the widest of their ranges
  let syncingScales = false;

  /** {lo, hi, n} over the panels whose coloring has the scale key `key` (see panel.ownScale), or null. */
  function sharedRange(key) {
    let r = null;
    for (const p of panels) {
      const s = p.ownScale();
      if (!s || s.key !== key) continue;
      r = r ? { lo: Math.min(r.lo, s.lo), hi: Math.max(r.hi, s.hi), n: r.n + 1 } : { lo: s.lo, hi: s.hi, n: 1 };
    }
    return r;
  }

  /** The range a panel colors with: shared when another panel shows the same thing, else null (its own). */
  function scaleRangeFor(own) {
    if (!own || !store.sameScale || panels.length < 2) return null;
    const r = sharedRange(own.key);
    return r && r.n > 1 ? { lo: r.lo, hi: r.hi } : null;
  }

  /** The coloring of `from` changed (or a panel came or went): restyle the panels whose shared range moved. */
  function syncScales(from) {
    if (syncingScales) return;
    syncingScales = true;
    try {
      for (const p of panels) if (p !== from) p.restyleIfScaleMoved();
    } finally {
      syncingScales = false;
    }
  }

  // ---- room on screen: the maps take the height of the window, less what has to be seen with them
  /**
   * --sv-lead: the space above the first maps once the viewer is in view: its place on the page when one row of
   * panels starts in the top half of the first screen (all of it then fits without scrolling), else its toolbar and
   * the panels' controls (the viewer scrolled to the top); --sv-row: what a second row of panels adds above its maps
   * (panel head, controls, overlays, gap), measured on that row (with four panels its rows differ when one shows a gene
   * box or overlays and the other does not).
   */
  function measureRoom() {
    const first = panels[0];
    if (destroyed || !first || !el.isConnected) return;
    if (!pageWatched) {
      const page = el.closest('.page') || el.parentElement;
      if (page) { pageObserver.observe(page); pageWatched = true; }
    }
    const top = el.getBoundingClientRect().top + window.scrollY;
    measuredTop = Math.round(top);
    const stageTop = first.stage.getBoundingClientRect().top + window.scrollY;
    if (!(stageTop > top)) return; // not laid out (hidden)
    const twoRows = panelRows(store.layout) > 1;
    const lead = !twoRows && top < window.innerHeight / 2 ? stageTop : stageTop - top + 12;
    const second = twoRows && panels[panelCols(store.layout)] ? panels[panelCols(store.layout)] : first;
    const row = second.stage.getBoundingClientRect().top - second.el.getBoundingClientRect().top + 16;
    el.style.setProperty('--sv-lead', `${Math.round(lead)}px`);
    el.style.setProperty('--sv-row', `${Math.round(row)}px`);
  }
  let roomFrame = 0;
  const measureSoon = () => {
    if (!roomFrame && !destroyed) roomFrame = requestAnimationFrame(() => { roomFrame = 0; measureRoom(); });
  };
  window.addEventListener('resize', measureSoon);
  // the page above the viewer grows or shrinks (a table filling in, a banner): measure again once the viewer moved
  let pageWatched = false;
  let measuredTop = NaN;
  const pageObserver = new ResizeObserver(() => {
    if (el.isConnected && Math.round(el.getBoundingClientRect().top + window.scrollY) !== measuredTop) measureSoon();
  });
  // the tooltip is placed in the window (so that no panel edge cuts it): hide it when the page scrolls under it
  const onScroll = () => { for (const p of panels) p.hideTip(); };
  document.addEventListener('scroll', onScroll, { capture: true, passive: true });

  // ---- panels
  function sampleText(sid) {
    const s = samples && samples.find((x) => x.id === sid);
    if (!s) return String(sid ?? '');
    return s.label && s.label !== s.id ? `${s.label} (${s.id})` : s.id;
  }

  /** Section of a new panel i: the first one that none of the panels before it shows (else they cycle). */
  function freshSample(i) {
    const ids = samples.map((s) => s.id);
    const shown = store.panels.slice(0, i).map((p) => (p && typeof p === 'object' ? p.sample : null));
    return ids.find((id) => !shown.includes(id)) ?? ids[i % ids.length];
  }

  function ensurePanelState(i) {
    const ids = samples.map((s) => s.id);
    let st = store.panels[i];
    if (!st || typeof st !== 'object') {
      // a new panel shows a section not shown yet, with the coloring of the first panel
      const base = i > 0 && store.panels[0] && typeof store.panels[0] === 'object' ? store.panels[0] : null;
      st = {
        sample: freshSample(i), field: base ? base.field : '', genes: base && Array.isArray(base.genes) ? base.genes.slice() : [],
        cells: base && Array.isArray(base.cells) ? base.cells.slice() : [],
        overlays: base && Array.isArray(base.overlays) ? base.overlays.slice() : [], dim: base ? base.dim !== false : true,
        hidden: {}, views: {},
      };
      store.panels[i] = st;
    }
    if (!ids.includes(st.sample)) st.sample = freshSample(i);
    if (typeof st.field !== 'string') st.field = '';
    st.genes = Array.isArray(st.genes) ? st.genes.map(String).slice(0, MAX_GENES) : [];
    st.cells = Array.isArray(st.cells) ? [...new Set(st.cells.map(String))] : [];
    st.overlays = Array.isArray(st.overlays) ? [...new Set(st.overlays.map(String))] : [];
    if (typeof st.dim !== 'boolean') st.dim = true;
    if (!st.hidden || typeof st.hidden !== 'object') st.hidden = {};
    if (!st.views || typeof st.views !== 'object') st.views = {};
    return st;
  }

  function markLayout(k) {
    el.dataset.layout = String(k);
    el.dataset.cols = String(panelCols(k));
    el.dataset.rows = String(panelRows(k));
    el.style.setProperty('--sv-cols', String(panelCols(k)));
    for (const b of layoutBtns) {
      const on = Number(b.dataset.k) === k;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    linkWrap.hidden = k === 1;
    scaleWrap.hidden = k === 1;
  }

  function setLayout(k) {
    if (!Number.isInteger(k) || k < 1) return;
    k = Math.min(k, maxPanels()); // no more panels than sections
    store.layout = k;
    markLayout(k);
    if (!samples || !samples.length) return;
    for (let i = 0; i < k; i += 1) ensurePanelState(i);
    while (panels.length > k) panels.pop().destroy();
    const added = [];
    while (panels.length < k) {
      const p = createPanel(panels.length);
      panels.push(p);
      added.push(p);
    }
    if (pointer && pointer.panel >= k) pointer = null;
    if (lastPanel >= k) lastPanel = 0;
    mount(panelsEl, panels.map((p) => p.el));
    for (const p of added) p.start();
    prune();
    updateSave();
    // a panel that went or came may change a shared color scale (and the legends say whose scale they show)
    for (const p of panels) if (!added.includes(p)) p.restyle();
    for (const p of panels) p.markWidth();
    for (const p of panels) p.requestRender();
    measureRoom();
  }

  function updateSave() {
    saveBtn.disabled = !panels.some((p) => p.hasData());
  }

  function showEmpty() {
    mount(el, h('div', { class: 'card' }, emptyState({
      icon: 'map', title: 'No per-bin data', text: emptyText || source.emptyText || 'There are no bins to map.',
    })));
  }

  async function start() {
    if (!samples) {
      mount(panelsEl, h('div', { class: 'card' }, loading('Loading sections…')));
      const my = new AbortController();
      startCtrl = my;
      try {
        const res = await source.samples(my.signal);
        if (destroyed) return;
        samples = normalizeSamples(res);
        if (samples.length) store.samples = samples;
      } catch (err) {
        if (destroyed || (err && err.name === 'AbortError')) return;
        if (err && err.status === 404) { showEmpty(); return; }
        mount(panelsEl, h('div', { class: 'card' }, h('div', { class: 'card-body' }, errorPanel(err, { retry: start }))));
        return;
      } finally {
        if (startCtrl === my) startCtrl = null;
      }
    }
    if (!samples.length) { showEmpty(); return; }
    paintLayoutBtns();
    setLayout(store.layout);
  }

  // ---- export
  function savePng() {
    if (!panels.some((p) => p.canExport())) return;
    const multi = panels.length > 1;
    const ratio = multi ? 2 : Math.min(3, Math.max(2, window.devicePixelRatio || 1));
    const legendW = 240;
    const titleH = 40;
    const gap = 24;
    const cols = multi ? 2 : 1;
    const rows = Math.ceil(panels.length / cols);
    const mapW = Math.max(200, ...panels.map((p) => p.size().w));
    const mapH = Math.max(200, ...panels.map((p) => Math.max(p.size().h, p.legendHeight())));
    const cellW = mapW + legendW;
    const cellH = titleH + mapH;
    const W = cols * cellW + (cols - 1) * gap;
    const H = rows * cellH + (rows - 1) * gap;
    const out = document.createElement('canvas');
    out.width = Math.round(W * ratio);
    out.height = Math.round(H * ratio);
    const g = out.getContext('2d');
    if (!g) { toast('This browser cannot create the image', 'error'); return; }
    g.fillStyle = EXPORT_PALETTE.bg;
    g.fillRect(0, 0, out.width, out.height);
    panels.forEach((p, i) => p.exportTo(g, (i % cols) * (cellW + gap), Math.floor(i / cols) * (cellH + gap), ratio, legendW, titleH));
    const stem = source.name || 'spatial';
    const name = `${stem}_${multi ? `${panels.length}_panels` : panels[0].fileTag()}.png`.replace(/[^\w.-]+/g, '_');
    out.toBlob((blob) => {
      if (blob) downloadBlob(name, blob);
      else toast('The image could not be created', 'error');
    }, 'image/png');
  }

  // ------------------------------------------------------------------------------------------------ one panel
  function createPanel(index) {
    const st = store.panels[index];
    const self = { index };
    let alive = true;
    let loadToken = 0;
    let data = null;
    let style = null;
    let scaleUsed = ''; // rangeText of the shared color range the style was built with ('' = its own range)
    let ovl = null;
    let rings = null; // the overlap combinations of the picked cell types (cellOverlap), or null
    let geneEdges = []; // the colors of the gene lines' overlap combinations, by combination order (overlayLayers)
    let corrThresholds = null; // the thresholds of "Correlated genes" last used in this panel
    /** The colors the map is drawn on (background, gray bins, text), for choosing colors that contrast with them. */
    const mapPalette = () => theme || (el.isConnected ? readTheme(el) : null) || DARK_MAP;

    /** Outlines drawn: the overlap combinations of the cell types (those not hidden in the legend) and of the genes. */
    function outlinesDrawn() {
      const out = [];
      if (rings) {
        const hidden = new Set(st.hidden[CELL_FIELD] || []);
        for (const c of rings.combos) if (!hidden.has(c.key)) out.push(c);
      }
      if (ovl && ovl.combos) for (const c of ovl.combos) out.push(c);
      return out; // [{outline, edge}]: each combination in its own outline color
    }
    let vis = null; // 1 per bin drawn by the coloring or by a layer (hover targets)
    let shownCount = 0; // bins drawn (by the coloring or a layer)
    let geneVecs = new Map(); // genes key -> prepared counts of the current section
    let geneErrors = new Map(); // genes key -> error message
    let genePending = new Set();
    let topVec = null; // top genes of the current section (prepareTop), when colored by them
    let topError = null;
    let topPending = false;
    let imageEntry = null;
    let imageError = null;
    let imagePending = false;
    let size = { w: 0, h: 0 };
    let dpr = window.devicePixelRatio || 1;
    let hover = -1;
    let tipAt = null; // {px, py}: where the tooltip was placed (placed again when the genes of its bin arrive)
    let binCtrl = null; // the request of the genes of a bin on its way
    const binGeneCache = new WeakMap(); // prepared bins (data) -> Map bin index -> answer of source.genes.bin
    let dirty = true;
    let needPaint = true;
    let crispTimer = null;
    let layerState = null; // the view the layer was drawn with
    const layer = document.createElement('canvas');
    const pointers = new Map();
    let drag = null;
    let pinch = null;

    // ---- DOM
    const ids = { sample: uid('sv-sample'), genes: uid('sv-genes') };
    const titleEl = h('h3', { class: 'sv-panel-title' });
    const sampleSel = h('select', { class: 'select', id: ids.sample, onChange: () => setSample(sampleSel.value) });
    // no "Color by": the bins are gray, or colored by the genes typed here (summed); the labels and numbers of a bin
    // and every gene detected in it show when the pointer is over it, and a click lists its genes
    const searchGenes = (q, signal, offset = 0) => source.genes.search(st.sample, q, signal, { offset, limit: GENE_PAGE });
    // "Color by genes": one line per gene (genes joined by + on one line are summed); "+ Add layer" adds a line under
    // the last. One line colors the bins by its UMIs; two or more draw every gene in its own color (see geneLines)
    const linesEl = h('div', { class: 'sv-lines', role: 'group', 'aria-labelledby': ids.genes });
    const linesNote = h('p', { class: 'sv-hint sv-lines-note', hidden: true });
    let lineBoxes = []; // geneInput of every line shown, in order
    let blankLine = false; // an empty line added with "+ Add layer", stored once a gene is typed in it
    const geneCtl = hasGenes ? h('div', { class: 'sv-control sv-control-wide' },
      h('span', { class: 'sv-control-label', id: ids.genes }, 'Color by genes (one per line; two or more: each in its own color)'),
      linesEl, linesNote) : null;
    // or every bin in the color of its top gene (the most UMIs in it and the 8 bins around it); a toggle
    const topBtn = hasTop ? h('button', {
      class: 'btn toggle sv-top', type: 'button', 'aria-pressed': 'false', onClick: toggleTop,
      title: 'Color every bin by its top gene: the gene with the most UMIs in the bin and the 8 bins around it',
    }, 'Top gene') : null;
    const topCtl = topBtn ? h('div', { class: 'sv-control sv-control-auto' },
      h('span', { class: 'sv-control-label' }, 'Or color by'), topBtn) : null;
    // "Color by cells": one cell type per line (the gene signature the analysis assigned each bin), picked from the
    // section's types; the picked types in their colors, every other bin gray; "All cell types" colors them all. Shown
    // when the section's bins have a cell type (a run's per-bin table; not the data explorer's raw data)
    const cellIds = { label: uid('sv-cells') };
    const cellLinesEl = h('div', { class: 'sv-lines', role: 'group', 'aria-labelledby': cellIds.label });
    const cellNote = h('p', { class: 'sv-hint sv-lines-note', hidden: true });
    let cellBoxes = []; // geneInput of every cell line shown, in order
    let cellBlank = false; // an empty cell line added with "+ Add cell type"
    const addCellBtn = h('button', {
      class: 'btn small ghost sv-add-line', type: 'button', onClick: addCellLine,
      title: 'Add a line for one more cell type',
    }, icon('plus', { size: 14 }), 'Add cell type');
    const cellsCtl = h('div', { class: 'sv-control sv-control-wide', hidden: true },
      h('span', { class: 'sv-control-label', id: cellIds.label }, 'Color by cells (one cell type per line)'),
      cellLinesEl, cellNote, addCellBtn);
    // "+ Add layer": one more line under "Color by genes", focused, to type a gene in and Show it. A yes/no layer (call,
    // region, quality control) kept from an older view is a chip of the row under the controls, with its remove button
    const addBtn = h('button', {
      class: 'btn sv-add', type: 'button', disabled: !hasGenes, onClick: addLine,
      title: 'Add one more line under Color by genes: type a gene and Show it (two or more lines: each gene in its own color)',
    }, icon('plus', { size: 15 }), 'Add layer');
    const dimInput = h('input', { type: 'checkbox', checked: st.dim, onChange: () => { st.dim = dimInput.checked; requestRender(); } });
    const ovlChips = h('ul', { class: 'chip-list sv-ovl-chips', 'aria-label': 'Layers' });
    const ovlRow = h('div', { class: 'sv-ovl-row', hidden: true }, ovlChips,
      h('label', { class: 'check sv-dim' }, dimInput, 'Dim the coloring under the layers'));
    const controls = h('div', { class: 'sv-panel-controls' },
      h('div', { class: 'sv-control' }, h('label', { for: ids.sample }, 'Section'), sampleSel),
      geneCtl,
      cellsCtl,
      topCtl,
      h('div', { class: 'sv-control sv-control-auto' }, h('span', { class: 'sv-control-label' }, 'Layers'), addBtn));
    const canvas = h('canvas', {
      class: 'sv-canvas', tabIndex: 0, role: 'img',
      'aria-label': 'Map of the bins of the section. Drag or use the arrow keys to pan; scroll, + and − to zoom; 0 fits the section.',
    });
    const ctx = canvas.getContext('2d');
    // placed in the window (position: fixed) next to the pointer, so that the edges of a small panel do not cut it
    const tip = h('div', { class: 'sv-tip', hidden: true, role: 'tooltip' });
    const msg = h('div', { class: 'sv-msg', hidden: true });
    // compact icon buttons in one floating group on the map (run.css), named by aria-label and explained by title
    const zoomBtn = (iconName, title, onClick) => h('button', { class: 'btn small ghost icon-only', type: 'button', title, 'aria-label': title, onClick }, icon(iconName, { size: 14 }));
    const stage = h('div', { class: 'sv-stage' }, canvas,
      h('div', { class: 'sv-zoom', role: 'group', 'aria-label': 'Zoom' },
        zoomBtn('zoom-in', 'Zoom in (+)', () => zoomBy(1.6)),
        zoomBtn('zoom-out', 'Zoom out (−)', () => zoomBy(1 / 1.6)),
        zoomBtn('maximize', 'Fit (0); linked views fit every panel\'s section', fit)),
      tip, msg);
    const legendEl = h('div', { class: 'sv-legend-body' });
    const el = h('section', { class: 'card sv-panel', 'aria-label': `Panel ${index + 1}` },
      h('div', { class: 'sv-panel-head' }, titleEl), controls, ovlRow, h('div', { class: 'sv-panel-body' }, stage, legendEl));

    mount(sampleSel, samples.map((s) => h('option', { value: s.id },
      `${sampleText(s.id)}${Number.isFinite(s.n) ? ` — ${fmt.int(s.n)} bins` : ''}`)));
    sampleSel.disabled = samples.length < 2;
    sampleSel.value = st.sample;
    paintTitle();

    // ---- events
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('pointerleave', () => {
      if (pointers.size) return;
      setHover(-1);
      if (pointer && pointer.panel === index) setPointer(null);
    });
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('dblclick', (e) => {
      if (!data) return;
      const p = local(e);
      zoomAt(e.shiftKey ? 1 / 2 : 2, p.x, p.y);
      viewMoved(self, true);
    });
    canvas.addEventListener('keydown', onKey);
    canvas.addEventListener('blur', () => setHover(-1));
    resizeObserver.observe(stage);
    resizeObserver.observe(el);

    /** A panel wide enough has its legend in a narrow column beside the map (two or four panels; see run.css). */
    function markWidth() {
      const w = el.clientWidth;
      if (w) el.classList.toggle('sv-wide', w >= wideFrom(store.layout));
    }

    // ---- view geometry: a view is {cx, cy (µm at the centre of the canvas), scale (css px per µm)}
    function getView() {
      if (store.link) return goodView(store.view) ? store.view : fitLinked();
      const v = st.views[st.sample];
      return goodView(v) ? v : fitOwn();
    }

    function xf(v) {
      return { scale: v.scale, tx: size.w / 2 - v.cx * v.scale, ty: size.h / 2 - v.cy * v.scale };
    }

    function setView(v) {
      if (store.link) store.view = v;
      else st.views[st.sample] = v;
    }

    function fitOwn() {
      if (!data || !data.valid || !size.w || !size.h) return null;
      const b = data.bbox;
      const v = { cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, scale: fitScaleFor(b, data.pitch, size), auto: true };
      st.views[st.sample] = v;
      return v;
    }

    const sidePx = (scale) => Math.max(MIN_SIDE, (data ? data.pitch : 16) * scale * store.pointSize);

    function local(e) {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    function clampScale(s) {
      let fitS = 1;
      if (store.link) {
        const f = linkedFit();
        if (f) fitS = f.scale;
      } else if (data && data.valid && size.w && size.h) {
        fitS = fitScaleFor(data.bbox, data.pitch, size);
      }
      return Math.min(Math.max(s, fitS / 4), Math.max(fitS, 240 / (data ? data.pitch : 16)));
    }

    function zoomAt(factor, px, py) {
      const v = data ? getView() : null;
      if (!v) return;
      const t = xf(v);
      const s1 = clampScale(v.scale * factor);
      const mx = (px - t.tx) / t.scale;
      const my = (py - t.ty) / t.scale;
      // the point under (px, py) stays there
      setView({ scale: s1, cx: mx + (size.w / 2 - px) / s1, cy: my + (size.h / 2 - py) / s1 });
    }

    function panBy(dx, dy) {
      const v = data ? getView() : null;
      if (!v) return;
      setView({ scale: v.scale, cx: v.cx - dx / v.scale, cy: v.cy - dy / v.scale });
    }

    function zoomBy(factor) {
      lastPanel = index;
      zoomAt(factor, size.w / 2, size.h / 2);
      viewMoved(self, true);
    }

    function fit() {
      if (!data || !data.valid) return;
      lastPanel = index;
      setHover(-1);
      if (store.link) fitLinked();
      else { fitOwn(); requestRender(); }
    }

    function resize() {
      // the drawable area inside the stage's border (the canvas fills it)
      const w = Math.max(0, Math.floor(stage.clientWidth));
      const hh = Math.max(0, Math.floor(stage.clientHeight));
      const ratio = window.devicePixelRatio || 1;
      if (!w || !hh) return; // hidden or detached: keep the current geometry
      if (w === size.w && hh === size.h && ratio === dpr) return;
      size = { w, h: hh };
      dpr = ratio;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(hh * dpr));
      if (!store.link) {
        const v = st.views[st.sample];
        if (v && v.auto) fitOwn();
      }
      requestRender();
    }

    // ---- rendering
    function requestRender() {
      dirty = true;
      needPaint = true;
      schedule();
    }

    function queuePaint() {
      needPaint = true;
      schedule();
    }

    function crisp() {
      clearTimeout(crispTimer);
      crispTimer = setTimeout(requestRender, 140);
    }

    function step() {
      if (!alive) return;
      if ((window.devicePixelRatio || 1) !== dpr) resize(); // moved to a screen with another pixel density
      if (!size.w || !size.h) return;
      if (dirty) renderLayer();
      if (needPaint) {
        needPaint = false;
        paint();
      }
    }

    const dimOf = () => (ovl && ovl.active && st.dim ? DIM : 0);

    function showImage() {
      return hasImage && store.image.on && imageEntry && imageEntry.img ? imageEntry : null;
    }

    /** Draw every visible bin into the offscreen layer for the current view (plus a margin around it). */
    function renderLayer() {
      dirty = false;
      clearTimeout(crispTimer);
      const v = data && style ? getView() : null;
      if (!v) { layerState = null; return; }
      const t = xf(v);
      let margin = MARGIN;
      while (margin > 0 && (size.w + 2 * margin) * (size.h + 2 * margin) * dpr * dpr > MAX_LAYER_PX) margin = Math.floor(margin / 2);
      const lw = Math.round((size.w + 2 * margin) * dpr);
      const lh = Math.round((size.h + 2 * margin) * dpr);
      if (layer.width !== lw || layer.height !== lh) { layer.width = lw; layer.height = lh; }
      const g = layer.getContext('2d');
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, lw, lh);
      const base = theme || EXPORT_PALETTE;
      // over the H&E image (mostly white) the bins in several overlays take the dark color of the exported image
      const palette = showImage() ? { ...base, several: EXPORT_PALETTE.several } : base;
      const lt = { scale: t.scale, tx: t.tx + margin, ty: t.ty + margin };
      const side = sidePx(t.scale);
      drawBins(g, style.groups, data, lt, dpr, side, palette, dimOf());
      if (ovl) drawBins(g, ovl.groups, data, lt, dpr, side, palette, 0);
      for (const c of outlinesDrawn()) drawOutline(g, c.outline, lt, dpr, c.edge || OUTLINE_COLOR, OUTLINE_HALO);
      layerState = { scale: t.scale, tx: t.tx, ty: t.ty, margin, dpr, w: size.w, h: size.h };
    }

    /**
     * Visible canvas = background + H&E image + the layer moved / scaled to the current view (see-through when the
     * image is shown) + hover marker + the crosshair of another panel + scale bar.
     */
    function paint() {
      const palette = theme || EXPORT_PALETTE;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.fillStyle = palette.bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const v = data ? getView() : null;
      if (!v) return;
      const t = xf(v);
      const im = showImage();
      if (im) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.imageSmoothingEnabled = true;
        drawImageUnder(ctx, im, t, 0, 0, size.w, size.h);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
      if (layerState && layerState.dpr === dpr) {
        const k = t.scale / layerState.scale;
        const left = t.tx - (layerState.tx + layerState.margin) * k; // css px
        const top = t.ty - (layerState.ty + layerState.margin) * k;
        const lw = (layerState.w + 2 * layerState.margin) * k;
        const lh = (layerState.h + 2 * layerState.margin) * k;
        ctx.imageSmoothingEnabled = k !== 1;
        ctx.globalAlpha = im ? Math.max(0, 1 - store.image.opacity) : 1;
        ctx.drawImage(layer, left * dpr, top * dpr, lw * dpr, lh * dpr);
        ctx.globalAlpha = 1;
        // the layer no longer covers the viewport (long pan, zooming out): redraw on the next frame
        if (left > 0.5 || top > 0.5 || left + lw < size.w - 0.5 || top + lh < size.h - 0.5) requestRender();
      } else if (style) {
        requestRender();
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (hover >= 0 && hover < data.n) {
        const half = Math.max(sidePx(t.scale) / 2, 3) + 2;
        const cx = data.x[hover] * t.scale + t.tx;
        const cy = data.y[hover] * t.scale + t.ty;
        ctx.lineWidth = 3;
        ctx.strokeStyle = palette.bg;
        ctx.strokeRect(cx - half, cy - half, half * 2, half * 2);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = palette.text;
        ctx.strokeRect(cx - half, cy - half, half * 2, half * 2);
      }
      if (store.link && pointer && pointer.panel !== index) {
        const cx = pointer.x * t.scale + t.tx;
        const cy = pointer.y * t.scale + t.ty;
        if (cx >= 0 && cx <= size.w && cy >= 0 && cy <= size.h) drawCrosshair(ctx, cx, cy, size.w, size.h, palette);
      }
      drawScaleBar(ctx, t.scale, 10, size.h - 10, palette);
    }

    // ---- pointer, wheel and keyboard
    function onDown(e) {
      if (!data) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      lastPanel = index;
      try { canvas.setPointerCapture(e.pointerId); } catch { /* pointer already released */ }
      const p = local(e);
      pointers.set(e.pointerId, p);
      if (pointers.size === 1) {
        drag = { x: p.x, y: p.y, moved: false };
      } else if (pointers.size === 2) {
        drag = null;
        pinch = pinchState();
      }
    }

    function pinchState() {
      const [a, b] = [...pointers.values()];
      return { d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }

    function onMove(e) {
      const p = local(e);
      if (pointers.has(e.pointerId)) {
        pointers.set(e.pointerId, p);
        if (pinch && pointers.size === 2) {
          const now = pinchState();
          zoomAt(now.d / pinch.d, now.x, now.y);
          panBy(now.x - pinch.x, now.y - pinch.y);
          pinch = now;
          viewMoved(self, true);
        } else if (drag) {
          const dx = p.x - drag.x;
          const dy = p.y - drag.y;
          if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
          if (!drag.moved) {
            drag.moved = true;
            stage.classList.add('dragging');
            setHover(-1);
            setPointer(null);
          }
          panBy(dx, dy);
          drag.x = p.x;
          drag.y = p.y;
          viewMoved(self, false);
        }
        return;
      }
      if (e.pointerType !== 'touch') hoverAt(p.x, p.y);
    }

    function onUp(e) {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 1) {
        const [p] = pointers.values();
        drag = { x: p.x, y: p.y, moved: true };
        return;
      }
      if (pointers.size) return;
      const moved = drag ? drag.moved : true;
      drag = null;
      stage.classList.remove('dragging');
      if (moved) {
        viewSettled(self);
      } else if (e.type === 'pointerup') {
        const p = local(e); // a click or tap shows the bin under it; on the bin shown already, it lists its genes
        const before = hover;
        hoverAt(p.x, p.y);
        if (hasBinGenes && hover >= 0 && hover === before) openBinGenes(hover);
      }
    }

    function onWheel(e) {
      if (!data) return;
      e.preventDefault();
      lastPanel = index;
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const p = local(e);
      // trackpad pinches arrive as ctrl + wheel with small deltas
      zoomAt(Math.exp(-e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.0015)), p.x, p.y);
      viewMoved(self, true);
      hoverAt(p.x, p.y);
    }

    function onKey(e) {
      if (!data || e.altKey || e.ctrlKey || e.metaKey) return;
      const stepPx = 60;
      lastPanel = index;
      switch (e.key) {
        case '+': case '=': zoomBy(1.4); break;
        case '-': case '_': zoomBy(1 / 1.4); break;
        case '0': fit(); break;
        case 'ArrowLeft': panBy(stepPx, 0); viewMoved(self, true); break;
        case 'ArrowRight': panBy(-stepPx, 0); viewMoved(self, true); break;
        case 'ArrowUp': panBy(0, stepPx); viewMoved(self, true); break;
        case 'ArrowDown': panBy(0, -stepPx); viewMoved(self, true); break;
        case 'Escape': setHover(-1); setPointer(null); return;
        default: return;
      }
      e.preventDefault();
    }

    // ---- hover
    function hoverAt(px, py) {
      const v = data ? getView() : null;
      if (!v) { setHover(-1); return; }
      const t = xf(v);
      const mx = (px - t.tx) / t.scale;
      const my = (py - t.ty) / t.scale;
      setPointer({ panel: index, x: mx, y: my });
      if (!style || !vis || !data.grid) { setHover(-1); return; }
      const r = Math.max(HOVER_PX, sidePx(t.scale) * 0.71 + 1) / t.scale;
      setHover(nearest(data.grid, data, mx, my, r, vis), px, py);
    }

    function valueText(f, i) {
      if (f.type === 'category') return f.codes[i] < 0 ? '—' : f.categories[f.codes[i]];
      if (f.type === 'bool') return f.values[i] === 2 ? '—' : (f.values[i] ? 'yes' : 'no');
      return Number.isFinite(f.values[i]) ? formatNumber(f.values[i]) : '—';
    }

    /**
     * Tooltip: position, barcode, the counts of the genes shown, the field colored by and the layers (in bold), the
     * other labels and numbers, and the positivity calls that are not shown, on one line (the ones the bin has).
     */
    function tipContent(i) {
      const rows = [];
      const row = (label, value, on, cls) => {
        rows.push(h('dt', { class: on ? 'on' : null }, label), h('dd', { class: [on ? 'on' : null, cls] }, value));
      };
      if (data.barcodes) row('Barcode', String(data.barcodes[i] ?? '—'), false, 'mono');
      const colorKey = st.field === GENE_FIELD && st.genes.length ? genesKey(st.genes) : null;
      for (const gk of neededGeneKeys()) {
        const gv = geneVecs.get(gk);
        if (gv) row(`${geneText(gv.used.length ? gv.used : gk.split(','))} (UMIs)`, formatNumber(gv.counts[i]), gk === colorKey || st.overlays.includes(GENE_OVERLAY + gk));
      }
      if (st.field === TOP_FIELD && topVec) {
        const c = topVec.codes[i];
        row(topVec.pooled ? 'Top gene (bin + 8 around)' : 'Top gene', c >= 0 ? topVec.genes[c] : '—', true);
      }
      const calls = [];
      let anyCall = false;
      for (const key of data.order) {
        const f = data.fields.get(key);
        const on = key === st.field || st.overlays.includes(key);
        if (!on && f.type === 'bool' && key.startsWith('positive_')) {
          anyCall = true;
          if (f.values[i] === 1) calls.push(fieldLabel(key).replace(/^Positive: /, ''));
        } else {
          row(fieldLabel(key), valueText(f, i), on);
        }
      }
      if (anyCall) row('Positive for', calls.length ? calls.join(', ') : 'none of the other calls', false, 'sv-tip-calls');
      const genes = binGenesPart(i);
      tip.classList.toggle('sv-tip-wide', !!genes && genes.wide);
      return [
        h('div', { class: 'sv-tip-head' }, `x ${fmt.int(data.x[i])} µm · y ${fmt.int(data.y[i])} µm`),
        rows.length ? h('dl', { class: 'sv-tip-grid' }, rows) : null,
        genes ? genes.el : null,
      ];
    }

    // ---- the genes of a bin (source.genes.bin): asked for a moment after the pointer stops on it, kept per section
    // payload (the last BIN_GENES_KEPT bins); the tooltip lists the first BIN_GENES_TIP, a click on the bin all of them
    function binGeneStore() {
      let m = binGeneCache.get(data);
      if (!m) { m = new Map(); binGeneCache.set(data, m); }
      return m;
    }

    function keepBinGenes(d, i, answer) {
      let m = binGeneCache.get(d);
      if (!m) { m = new Map(); binGeneCache.set(d, m); }
      m.set(i, answer);
      while (m.size > BIN_GENES_KEPT) m.delete(m.keys().next().value);
    }

    async function loadBinGenes(i) {
      if (!hasBinGenes || !alive || !data || i < 0 || binGeneStore().has(i)) return null;
      if (binCtrl) binCtrl.abort();
      const ctrl = new AbortController();
      binCtrl = ctrl;
      const d = data;
      const sample = st.sample;
      let answer;
      try {
        const res = await source.genes.bin(sample, i, ctrl.signal);
        answer = res && Array.isArray(res.genes) ? res : { genes: [], n_genes: 0, total: 0 };
      } catch (err) {
        if (err && err.name === 'AbortError') return null;
        answer = { error: err && err.message ? err.message : String(err) };
      } finally {
        if (binCtrl === ctrl) binCtrl = null;
      }
      keepBinGenes(d, i, answer);
      if (alive && data === d && hover === i) {
        mount(tip, tipContent(i));
        if (tipAt) placeTip(tipAt.px, tipAt.py);
      }
      return answer;
    }

    const fetchBinGenes = debounce(() => { loadBinGenes(hover); }, BIN_GENES_DELAY_MS);

    /** {el, wide} of the tooltip's gene list of bin i, or null when the source has no genes. */
    function binGenesPart(i) {
      if (!hasBinGenes) return null;
      const res = binGeneStore().get(i);
      const note = (text) => ({ el: h('div', { class: 'sv-tip-genes muted' }, text), wide: false });
      if (!res) return note('Genes in this bin: loading…');
      if (res.error) return note(`Genes in this bin: ${res.error}`);
      if (res.matched === false) return note('This bin is not in the raw data, so its genes are unknown.');
      if (!res.genes.length) return note('No gene is detected in this bin.');
      const shown = res.genes.slice(0, BIN_GENES_TIP);
      const more = res.genes.length - shown.length;
      return {
        wide: shown.length > 8,
        el: h('div', { class: 'sv-tip-genes' },
          h('div', { class: 'sv-tip-genes-head' }, `${fmt.int(res.n_genes)} gene${res.n_genes === 1 ? '' : 's'} · ${fmt.int(res.total)} UMIs`,
            h('span', { class: 'muted' }, ' — UMIs of each')),
          h('ul', { class: 'sv-tip-gene-list' }, shown.map(([g, n]) => h('li', null, h('span', { class: 'sv-g' }, g), h('span', { class: 'sv-n' }, String(n))))),
          h('div', { class: 'muted' }, more > 0 ? `+ ${fmt.int(more)} more. Click the bin to list them all.` : 'Click the bin to search or copy them.')),
      };
    }

    /** Every gene of bin i in a dialog: a filter, the table (gene, UMIs, share of the bin's UMIs), Copy. */
    async function openBinGenes(i) {
      const d = data;
      const where = `${sampleText(st.sample)} · x ${fmt.int(d.x[i])} µm, y ${fmt.int(d.y[i])} µm`
        + (d.barcodes && d.barcodes[i] ? ` · ${d.barcodes[i]}` : '');
      const filter = h('input', { class: 'input', type: 'search', placeholder: 'Filter the genes', 'aria-label': 'Filter the genes', spellcheck: false, autocomplete: 'off' });
      const summary = h('p', { class: 'muted small' }, 'Loading the genes…');
      const tbody = h('tbody');
      const table = h('div', { class: 'table-wrap sv-bin-genes' }, h('table', { class: 'table compact' },
        h('thead', null, h('tr', null, h('th', { class: 'num' }, '#'), h('th', null, 'Gene'), h('th', { class: 'num' }, 'UMIs'), h('th', { class: 'num' }, '% of the bin\'s UMIs'))),
        tbody));
      let res = binGeneStore().get(i) || null;
      const paint = () => {
        if (!res) return;
        if (res.error) { summary.textContent = `The genes could not be loaded: ${res.error}`; return; }
        if (res.matched === false) { summary.textContent = 'This bin is not in the raw data, so its genes are unknown.'; return; }
        const q = filter.value.trim().toLowerCase();
        const rows = res.genes.map(([g, n], k) => ({ g, n, k })).filter((r) => !q || r.g.toLowerCase().includes(q));
        summary.textContent = `${fmt.int(res.n_genes)} gene${res.n_genes === 1 ? '' : 's'} detected, ${fmt.int(res.total)} UMIs, by UMIs`
          + (q ? `; ${fmt.int(rows.length)} match “${filter.value.trim()}”` : '') + '.';
        mount(tbody, rows.map((r) => h('tr', null, h('td', { class: 'num muted' }, String(r.k + 1)), h('td', { class: 'mono' }, r.g),
          h('td', { class: 'num' }, fmt.int(r.n)), h('td', { class: 'num' }, res.total ? fmt.num((100 * r.n) / res.total, 1) : '—'))));
      };
      filter.addEventListener('input', paint);
      modal({
        title: 'Genes in this bin', size: 'wide',
        body: h('div', { class: 'stack' }, h('p', null, where), summary, filter, table),
        actions: [
          {
            label: 'Copy list', icon: 'copy',
            onClick: async () => {
              if (!res || !Array.isArray(res.genes) || !res.genes.length) return false;
              const text = ['gene\tumi', ...res.genes.map(([g, n]) => `${g}\t${n}`)].join('\n');
              try {
                await navigator.clipboard.writeText(text);
                toast(`${fmt.int(res.genes.length)} genes copied (gene and UMIs, tab-separated)`, 'success', { timeout: 2500 });
              } catch {
                toast('The browser did not allow copying', 'error');
              }
              return false;
            },
          },
          { label: 'Close', kind: 'primary' },
        ],
      });
      setTimeout(() => filter.focus(), 0);
      if (!res) {
        fetchBinGenes.cancel();
        res = await loadBinGenes(i) || binGeneStore().get(i) || { error: 'no answer' };
      }
      paint();
    }

    function hideTip() {
      if (hover >= 0) setHover(-1);
    }

    /**
     * Tooltip next to the pointer (px, py: css px in the canvas), in window coordinates: beside it when it fits on the
     * right or the left, else above or below it, never over it when the window has room.
     */
    function placeTip(px, py) {
      const r = canvas.getBoundingClientRect();
      const ax = r.left + px;
      const ay = r.top + py;
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      const pad = 14;
      const edge = 8;
      const tw = tip.offsetWidth;
      const th = tip.offsetHeight;
      const clampTo = (v, lo, hi) => Math.max(lo, Math.min(v, hi));
      let left;
      let top;
      if (ax + pad + tw <= vw - edge || ax - pad - tw >= edge) {
        left = ax + pad + tw <= vw - edge ? ax + pad : ax - pad - tw;
        top = clampTo(ay + pad, edge, vh - th - edge);
      } else {
        left = clampTo(ax - tw / 2, edge, vw - tw - edge);
        if (ay + pad + th <= vh - edge) top = ay + pad;
        else if (ay - pad - th >= edge) top = ay - pad - th;
        else top = ay > vh / 2 ? edge : vh - th - edge;
      }
      tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    }

    function setHover(i, px, py) {
      if (i !== hover) {
        hover = i;
        queuePaint();
        if (i < 0) {
          tip.hidden = true;
          tipAt = null;
          fetchBinGenes.cancel();
          return;
        }
        mount(tip, tipContent(i));
        tip.hidden = false;
        if (hasBinGenes && !binGeneStore().has(i)) fetchBinGenes();
      }
      if (i >= 0 && px !== undefined) {
        tipAt = { px, py };
        placeTip(px, py);
      }
    }

    // ---- title and legend
    function geneNames() {
      const gv = st.genes.length ? geneVecs.get(genesKey(st.genes)) : null;
      return gv && gv.used.length ? gv.used : st.genes;
    }

    /** What the panel shows: its coloring and its layers ('Tissue class + Ctsk, Acp5'; 'Ctsk, Acp5' over no coloring). */
    function shownText() {
      let what;
      if (st.field === GENE_FIELD) what = st.genes.length ? `${geneText(geneNames())} (UMIs)` : 'gene expression';
      else if (st.field === TOP_FIELD) what = 'top gene per bin';
      else if (st.field === CELL_FIELD) {
        const picked = pickedCells();
        what = !picked ? 'cell types' : (picked.length <= 2 ? picked.join(', ') : `${picked.length} cell types`);
      }
      else if (st.field === NONE_FIELD) what = '';
      else what = st.field && data.fields.has(st.field) ? fieldLabel(st.field) : 'bins';
      const drawn = drawnOverlays();
      const n = drawn.length;
      let layers = '';
      if (n === 1 || n === 2) layers = drawn.map(layerLabel).join(', ');
      else if (n > 2) layers = drawn.every(isGeneKey) ? `${n} genes` : `${n} layers`;
      if (!what) return layers || 'bins (no coloring)';
      return layers ? `${what} + ${layers}` : what;
    }

    function titleText() {
      return data ? `${sampleText(st.sample)} — ${shownText()}` : sampleText(st.sample);
    }

    function paintTitle() {
      const text = titleText();
      titleEl.textContent = text;
      titleEl.title = text;
    }

    function legendTitle() {
      if (st.field === GENE_FIELD) return st.genes.length ? `${geneText(geneNames())} (UMIs)` : 'Gene expression';
      if (st.field === TOP_FIELD) return 'Top gene per bin';
      if (st.field === CELL_FIELD) return pickedCells() ? 'Cell types picked' : 'Cell type';
      if (st.field === NONE_FIELD) return drawnOverlays().some(isGeneKey) ? 'Genes, each in its own color' : 'No coloring';
      return st.field && data.fields.has(st.field) ? fieldLabel(st.field) : 'Bins';
    }

    /** Color bar of a scale; whose range it is when there are several panels (shared or this panel's own). */
    function colorbar(scale) {
      const { min, max, log, shared } = scale;
      const bar = h('canvas', { class: 'sv-colorbar', width: 256, height: 1, 'aria-hidden': 'true' });
      const g = bar.getContext('2d');
      for (let k = 0; k < 256; k += 1) {
        g.fillStyle = LUT[Math.min(LEVELS - 1, Math.floor((k / 256) * LEVELS))];
        g.fillRect(k, 0, 1, 1);
      }
      // the value at the middle of the bar; log scales are counts (UMIs, genes): a whole number, left out when it
      // would repeat an end
      let mid = log ? Math.round(Math.expm1((Math.log1p(min) + Math.log1p(max)) / 2))
        : Math.round(((min + max) / 2) * 100) / 100;
      if (!(mid > min && mid < max)) mid = null;
      const whose = panels.length < 2 ? '' : (shared ? '; the same in the panels showing it' : '; this panel’s own');
      return [bar,
        h('div', { class: 'sv-colorbar-labels' },
          h('span', null, formatNumber(min)), h('span', null, mid === null ? '' : formatNumber(mid)),
          h('span', null, `${clampedMark(scale)}${formatNumber(max)}`)),
        h('div', { class: 'sv-note' }, `${log ? 'Logarithmic color scale (log 1 + x)' : 'Linear color scale'}${whose}`)];
    }

    /** "Colors stop at x, ..." when the scale is cut below the largest value. */
    function clampFact(scale, whose) {
      if (!scale || !scale.clamped) return null;
      return h('li', null, scale.shared
        ? `Colors stop at ${formatNumber(scale.max)}, the largest 99th percentile of the panels showing it`
        : `Colors stop at ${formatNumber(scale.max)}, the 99th percentile of ${whose}`);
    }

    function retryLine(text, retry) {
      return h('div', { class: 'sv-error' }, icon('alert', { size: 14 }), h('span', null, text),
        h('button', { class: 'btn ghost small', type: 'button', onClick: retry }, 'Retry'));
    }

    function busyLine(text) {
      return h('div', { class: 'sv-busy' }, h('span', { class: 'spinner' }), text);
    }

    function retryGenes(gk) {
      geneErrors.delete(gk);
      ensureGenes();
      restyle();
    }

    function geneLegend() {
      if (!st.genes.length) return h('p', { class: 'sv-hint' }, 'Type one or more genes above; the counts of several genes are summed per bin.');
      const gk = genesKey(st.genes);
      const err = geneErrors.get(gk);
      if (err) return retryLine(err, () => retryGenes(gk));
      const gv = geneVecs.get(gk);
      if (!gv) return busyLine('Loading the counts…');
      const facts = [
        h('li', null, `Detected in ${fmt.int(gv.detected)} of ${fmt.int(data.n)} bins (${fmt.pct(data.n ? (100 * gv.detected) / data.n : 0, 1)})`),
      ];
      if (gv.detected) facts.push(h('li', null, `Up to ${formatNumber(gv.max)} UMIs in a bin, ${formatNumber(gv.total)} in all`));
      const scale = style && style.kind === 'gene' ? style.scale : null;
      const cut = clampFact(scale, 'the bins detecting it');
      if (cut) facts.push(cut);
      if (gv.missing.length) facts.push(h('li', { class: 'sv-warn' }, `Not in the data: ${gv.missing.join(', ')}`));
      if (!gv.used.length) facts.push(h('li', { class: 'sv-warn' }, 'None of these genes is in the data.'));
      if (gv.unmatched) facts.push(h('li', { class: 'sv-warn' }, `${fmt.int(gv.unmatched)} bins of the map were not found in the raw data (counted as 0)`));
      return [scale ? colorbar(scale) : null, h('ul', { class: 'sv-facts' }, facts)];
    }

    function topLegend() {
      if (topError) return retryLine(topError, retryTop);
      if (!topVec) return busyLine('Finding the top gene of every bin…');
      const tv = topVec;
      const n = tv.codes.length;
      const facts = [
        h('li', null, tv.pooled ? 'The gene with the most UMIs in the bin and the 8 bins around it'
          : 'The gene with the most UMIs in the bin (the barcodes give no grid, so no neighbors are added)'),
        h('li', null, `${fmt.int(tv.genes.length)} genes top a bin; the ${fmt.int(Math.min(TOP_COLORS, tv.genes.length))} topping the most have a color of their own`),
      ];
      if (tv.tied) facts.push(h('li', null, `${fmt.int(tv.tied)} bins (${fmt.pct(n ? (100 * tv.tied) / n : 0, 1)}) had a tie: the gene with the most UMIs in the section was taken`));
      if (tv.unmatched) facts.push(h('li', { class: 'sv-warn' }, `${fmt.int(tv.unmatched)} bins of the map were not found in the raw data (no top gene)`));
      return h('ul', { class: 'sv-facts' }, facts);
    }

    /** What the shaded overlap is (its entry is in the legend above), and the picked types without a positivity call. */
    function overlapLegend() {
      const facts = [];
      if (rings.types.length < 2) {
        facts.push(h('li', { class: 'sv-warn' }, `No overlap to show: positivity calls exist for ${rings.types.length ? rings.types.join(', ') : 'none'} of the picked types only`));
      } else {
        facts.push(h('li', null, `Overlap: the ${fmt.int(rings.n)} bins called positive (native depth) for two or more of ${rings.types.join(', ')}, in ${fmt.int(rings.combos.length)} ${rings.combos.length === 1 ? 'combination' : 'combinations'}, each in one color of its own (bins, shape and outline), chosen to contrast with every other color on the map`));
        if (rings.without.length) facts.push(h('li', null, `No positivity call for ${rings.without.join(', ')}: not counted`));
      }
      // "Correlated genes…": per combination, the genes whose expression follows its bins (openOverlapGenes)
      const finds = hasOverlapGenes && rings.combos.length ? h('ul', { class: 'sv-corr-list' }, rings.combos.map((c) => h('li', null,
        shapeSwatch(c.color, c.shape),
        h('span', { class: 'sv-item-label' }, c.label),
        h('button', {
          class: 'btn small', type: 'button', onClick: () => openOverlapGenes(c),
          title: `Find the genes whose expression follows the ${fmt.int(c.idx.length)} bins of ${c.label} (correlation, with thresholds you can change)`,
        }, 'Correlated genes…')))) : null;
      return h('div', { class: 'sv-legend-section' }, h('h4', null, 'Overlap'), h('ul', { class: 'sv-facts' }, facts), finds);
    }

    /**
     * "Correlated genes" of an overlap combination: a dialog with the thresholds (suggested r >= 0.1, FDR <= 0.05, 3
     * bins of the overlap; each can be changed, "Find genes" asks again), the genes that pass by r (source.genes.
     * overlapGenes: Pearson r of each gene's log-normalised expression with in the overlap or not), and buttons that
     * show one gene, or the top three as gene lines, on the map.
     */
    function openOverlapGenes(combo) {
      const sid = st.sample;
      const indices = Array.from(combo.idx);
      const num = (label, value, attrs, hint) => {
        const id = uid('sv-corr');
        const input = h('input', { class: 'input', type: 'number', id, value: String(value), ...attrs });
        return { input, el: h('div', { class: 'sv-corr-field' }, h('label', { for: id }, label), input, h('span', { class: 'muted small' }, hint)) };
      };
      // the thresholds last used in this panel, else the suggested ones
      const last = corrThresholds || { min_r: 0.1, max_fdr: 0.05, min_bins: 3 };
      const minR = num('Correlation r at least', last.min_r, { min: -1, max: 1, step: 0.05 }, 'suggested 0.1 (from −1 to 1)');
      const maxFdr = num('FDR at most', last.max_fdr, { min: 0, max: 1, step: 0.01 }, 'suggested 0.05 (from 0 to 1)');
      const minBins = num('Bins of the overlap at least', Math.min(last.min_bins, indices.length), { min: 0, max: indices.length, step: 1 }, `suggested 3 (of ${fmt.int(indices.length)})`);
      const findBtn = h('button', { class: 'btn primary', type: 'button', onClick: () => run() }, 'Find genes');
      const summary = h('p', { class: 'muted small' }, '');
      const tbody = h('tbody');
      const table = h('div', { class: 'table-wrap sv-corr-table' }, h('table', { class: 'table compact' },
        h('thead', null, h('tr', null,
          h('th', { class: 'num' }, '#'), h('th', null, 'Gene'), h('th', { class: 'num', title: 'Pearson correlation with in the overlap (1) or not (0)' }, 'r'),
          h('th', { class: 'num', title: 'Benjamini–Hochberg corrected p-value' }, 'FDR'),
          h('th', { class: 'num', title: 'Share of the overlap bins detecting the gene' }, 'In overlap'),
          h('th', { class: 'num', title: 'Share of the other bins detecting the gene' }, 'Outside'),
          h('th', null, ''))),
        tbody));
      let res = null;
      let ctrl = null;
      const fmtP = (v) => (!(v > 0) ? '< 1e-300' : (v < 0.001 ? v.toExponential(1) : v.toFixed(3)));
      const read = () => {
        const r = Number(minR.input.value);
        const f = Number(maxFdr.input.value);
        const b = Number(minBins.input.value);
        if (!(r >= -1 && r <= 1)) return 'Correlation r must be a number from −1 to 1.';
        if (!(f >= 0 && f <= 1)) return 'FDR must be a number from 0 to 1.';
        if (!(Number.isInteger(b) && b >= 0 && b <= indices.length)) return `Bins must be a whole number from 0 to ${indices.length}.`;
        return { min_r: r, max_fdr: f, min_bins: b, limit: 200 };
      };
      async function run() {
        const t = read();
        if (typeof t === 'string') { summary.textContent = t; summary.className = 'sv-warn small'; return; }
        corrThresholds = { min_r: t.min_r, max_fdr: t.max_fdr, min_bins: t.min_bins }; // kept for the next time
        if (ctrl) ctrl.abort();
        const my = new AbortController();
        ctrl = my;
        findBtn.disabled = true;
        summary.className = 'muted small';
        summary.textContent = `Correlating every gene with the ${fmt.int(indices.length)} bins of ${combo.label}…`;
        mount(tbody);
        try {
          res = await source.genes.overlapGenes(sid, indices, t, my.signal);
        } catch (err) {
          if (err && err.name === 'AbortError') return;
          res = null;
          summary.className = 'sv-warn small';
          summary.textContent = `The genes could not be found: ${(err && err.message) || err}`;
          return;
        } finally {
          if (ctrl === my) { ctrl = null; findBtn.disabled = false; }
        }
        const shown = res.genes.length;
        summary.textContent = `${fmt.int(res.n_pass)} of ${fmt.int(res.n_tested)} genes pass (r ≥ ${t.min_r}, FDR ≤ ${t.max_fdr}, `
          + `in ≥ ${t.min_bins} of the ${fmt.int(res.n_overlap)} overlap bins), over ${fmt.int(res.n_bins)} bins of the section`
          + (res.n_pass > shown ? `; the ${fmt.int(shown)} with the highest r are listed` : '') + '. '
          + 'Expression: log1p of the UMIs per 10,000 UMIs of the bin.';
        mount(tbody, res.genes.map((g, k) => h('tr', null,
          h('td', { class: 'num muted' }, String(k + 1)),
          h('td', { class: 'mono' }, g.gene),
          h('td', { class: 'num' }, g.r.toFixed(3)),
          h('td', { class: 'num' }, fmtP(g.fdr)),
          h('td', { class: 'num' }, `${fmt.num(g.pct_in, 1)}%`),
          h('td', { class: 'num' }, `${fmt.num(g.pct_out, 1)}%`),
          h('td', null, h('button', {
            class: 'btn small ghost', type: 'button', title: `Color the map by the UMIs of ${g.gene}`,
            onClick: () => { dialog.close(); showGeneLines([g.gene]); },
          }, 'Show')))));
      }
      const dialog = modal({
        title: `Genes correlated with ${combo.label}`, size: 'wide',
        body: h('div', { class: 'stack' },
          h('p', null, `${sampleText(sid)} · ${fmt.int(indices.length)} overlap bins. Each gene is tested over the section's bins: the Pearson correlation of its expression with in the overlap (1) or not (0). The thresholds are suggestions; change them and press Find genes.`),
          h('div', { class: 'sv-corr-thresholds' }, minR.el, maxFdr.el, minBins.el, findBtn),
          summary, table),
        actions: [
          {
            label: 'Show top 3 as gene lines', icon: 'map',
            onClick: () => {
              if (!res || !res.genes.length) return false;
              showGeneLines(res.genes.slice(0, 3).map((g) => g.gene));
              return undefined;
            },
          },
          {
            label: 'Copy list', icon: 'copy',
            onClick: async () => {
              if (!res || !res.genes.length) return false;
              const text = ['gene\tr\tp\tfdr\tbins_in_overlap\tpct_in_overlap\tpct_outside',
                ...res.genes.map((g) => [g.gene, g.r, g.p, g.fdr, g.bins_in, g.pct_in, g.pct_out].join('\t'))].join('\n');
              try {
                await navigator.clipboard.writeText(text);
                toast(`${fmt.int(res.genes.length)} genes copied (tab-separated)`, 'success', { timeout: 2500 });
              } catch {
                toast('The browser did not allow copying', 'error');
              }
              return false;
            },
          },
          { label: 'Close', kind: 'primary' },
        ],
        onClose: () => { if (ctrl) ctrl.abort(); },
      });
      for (const f of [minR, maxFdr, minBins]) f.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } });
      run();
    }

    /** The map colored by these genes, one line each (from "Correlated genes"); the cell lines wait meanwhile. */
    function showGeneLines(genes) {
      if (linesAside()) st.field = NONE_FIELD; // leave the cell (or Top gene) coloring for the genes
      setLines(genes.map((g) => genesKey([g])), 0);
    }

    function retryTop() {
      topError = null;
      ensureTop();
      restyle();
    }

    function numberLegend() {
      const cut = clampFact(style.scale, 'the bins');
      return [colorbar(style.scale), cut ? h('ul', { class: 'sv-facts' }, cut) : null];
    }

    /** Color of the bins in two or more overlays as drawn now (see SEVERAL; its swatch has a visible rim when dark). */
    const severalColor = () => (showImage() ? EXPORT_PALETTE.several : 'var(--text)');

    /** Name of an overlay as shown: the gene names of the data once its counts are there ('Ctsk' for 'ctsk'). */
    function layerLabel(key) {
      const l = ovl ? ovl.layers.find((x) => x.key === key) : null;
      return l ? l.label : overlayLabel(key);
    }

    function overlayLegend() {
      const layers = ovl ? ovl.layers : [];
      const items = layers.map((l) => h('li', {
        class: 'sv-ovl',
        title: l.total !== null && l.total !== undefined
          ? `${l.label}: drawn on ${fmt.int(l.count)} bins; in ${fmt.int(l.total)} bins (overlap included)` : null,
      },
      h('span', { class: 'swatch', style: { background: l.color } }),
      h('span', { class: 'sv-item-label' }, l.label),
      h('span', { class: l.count === null && l.status !== LOADING ? 'sv-item-count sv-warn' : 'sv-item-count' },
        l.count === null ? l.status : fmt.int(l.count))));
      // the overlap combinations of the genes: each in its own color, outlined as clusters
      for (const c of ovl && ovl.combos ? ovl.combos : []) {
        items.push(h('li', { class: 'sv-ovl', title: `Bins detecting ${c.label}` },
          shapeSwatch(c.color, c.shape),
          h('span', { class: 'sv-item-label' }, `${c.label} (${fmt.int(c.clusters)} ${c.clusters === 1 ? 'cluster' : 'clusters'})`),
          h('span', { class: 'sv-item-count' }, fmt.int(c.idx.length))));
      }
      if (ovl && ovl.several) {
        items.push(h('li', { class: 'sv-ovl' },
          h('span', { class: 'swatch sv-swatch-ink', style: { background: severalColor() } }),
          h('span', { class: 'sv-item-label' }, severalLabel()),
          h('span', { class: 'sv-item-count' }, fmt.int(ovl.several))));
      }
      const errors = drawnOverlays().filter(isGeneKey).map((k) => k.slice(GENE_OVERLAY.length))
        .filter((gk) => geneErrors.has(gk) && !(st.field === GENE_FIELD && genesKey(st.genes) === gk))
        .map((gk) => retryLine(`${geneText(gk.split(','))}: ${geneErrors.get(gk)}`, () => retryGenes(gk)));
      const notes = layers.filter((l) => l.note).map((l) => h('li', { class: 'sv-warn' }, `${l.label}: ${l.note}`));
      return h('div', { class: 'sv-legend-section' },
        h('h4', null, layers.length && layers.every(isGeneLayer) ? 'Genes' : 'Layers'),
        layers.some(isGeneLayer) ? h('p', { class: 'sv-hint' }, 'A gene marks the bins detecting it (1 UMI or more); a bin detecting several takes the color of its combination of genes (each combination its own color and shape), outlined with its neighbors.') : null,
        h('ul', { class: 'sv-ovl-list', title: 'Bins drawn in each color' }, items),
        notes.length ? h('ul', { class: 'sv-facts' }, notes) : null,
        errors);
    }

    function imageLegend() {
      if (!hasImage || !store.image.on) return null;
      if (imageError) {
        return retryLine(`H&E image: ${imageError}`, () => {
          imageError = null;
          ensureImage(true);
          paintLegend();
        });
      }
      if (imagePending) return busyLine('Loading the H&E image…');
      if (imageEntry && imageEntry.none) return h('p', { class: 'sv-hint' }, 'No H&E image was found for this section.');
      return null;
    }

    function paintLegend() {
      if (!data) { mount(legendEl); return; }
      const parts = [h('h3', { class: 'sv-legend-title' }, legendTitle())];
      if (st.field === GENE_FIELD) parts.push(geneLegend());
      else if (st.field === TOP_FIELD) parts.push(topLegend());
      else if (style && style.kind === 'number' && style.scale) parts.push(numberLegend());
      if (style && style.legend.length) {
        parts.push(h('div', { class: 'sv-legend', role: 'group', 'aria-label': `${legendTitle()}: click an entry to hide or show it` },
          style.legend.map((e) => h('button', {
            class: e.off ? 'sv-item off' : 'sv-item', type: 'button', 'aria-pressed': e.off ? 'false' : 'true',
            dataset: { key: e.key }, title: 'Click to hide or show; Alt+click to show only this entry',
            onClick: (ev) => toggle(e.key, ev.altKey),
          },
          e.shape ? shapeSwatch(e.color, e.shape)
            : h('span', { class: 'swatch', style: { background: e.color === NEUTRAL ? 'var(--plot-neutral)' : e.color } }),
          h('span', { class: 'sv-item-label' }, e.label),
          h('span', { class: 'sv-item-count' }, fmt.int(e.count))))));
      }
      if (style) {
        const anyOff = style.legend.some((e) => e.off);
        parts.push(h('div', { class: 'sv-legend-foot' },
          h('span', null, `${fmt.int(shownCount)} of ${fmt.int(data.valid)} bins shown`),
          anyOff ? h('button', { class: 'btn ghost small', type: 'button', onClick: showAll }, 'Show all') : null));
      }
      if (rings) parts.push(overlapLegend());
      if (drawnOverlays().length) parts.push(overlayLegend());
      parts.push(imageLegend());
      mount(legendEl, parts);
    }

    const fieldKey = () => (st.field === GENE_FIELD ? GENE_FIELD : st.field);

    function toggle(key, solo) {
      if (!style) return;
      const fk = fieldKey();
      let hidden = new Set(st.hidden[fk] || []);
      if (solo) {
        const keys = style.legend.map((e) => e.key);
        const alone = keys.every((k) => (k === key ? !hidden.has(k) : hidden.has(k)));
        hidden = alone ? new Set() : new Set(keys.filter((k) => k !== key));
      } else if (hidden.has(key)) {
        hidden.delete(key);
      } else {
        hidden.add(key);
      }
      st.hidden[fk] = [...hidden];
      restyle();
      const again = [...legendEl.querySelectorAll('.sv-item')].find((b) => b.dataset.key === key);
      if (again) again.focus();
    }

    function showAll() {
      st.hidden[fieldKey()] = [];
      restyle();
      canvas.focus();
    }

    /**
     * The chips of the overlays (row under the controls): its color, its name and a remove button each; a chip whose
     * overlay cannot be drawn (gene not in the data, counts that failed to load) is marked.
     */
    function paintOverlayRow() {
      // the chips of the calls, region and quality control (the genes are the lines of "Color by genes"); the row also
      // holds "Dim the coloring under the layers", so it shows while anything is drawn on top
      ovlRow.hidden = !drawnOverlays().length;
      const layers = ovl ? ovl.layers : [];
      // a focused remove button keeps the focus when the chips are made again (gene counts arriving, a rename)
      const focused = ovlChips.contains(document.activeElement)
        ? [...ovlChips.querySelectorAll('button')].indexOf(document.activeElement) : -1;
      mount(ovlChips, st.overlays.filter((k) => !isGeneKey(k)).map((key) => {
        const l = layers.find((x) => x.key === key);
        const label = l ? l.label : overlayLabel(key);
        const bad = !!l && ((l.count === null && l.status !== LOADING) || !!l.note);
        const what = l && l.count === null ? `${label}: ${l.status}` : (l && l.note ? `${label}: ${l.note}` : label);
        return h('li', { class: bad ? 'chip sv-chip warn' : 'chip sv-chip', title: what, dataset: { key } },
          h('span', { class: 'swatch', style: { background: l ? l.color : 'transparent' } }),
          h('span', { class: 'chip-text' }, label),
          h('button', { type: 'button', 'aria-label': `Remove the layer ${label}`, title: 'Remove', onClick: () => removeOverlay(key) },
            icon('x', { size: 12 })));
      }));
      if (focused >= 0) {
        const btns = ovlChips.querySelectorAll('button');
        (btns.length ? btns[Math.min(focused, btns.length - 1)] : addBtn).focus();
      }
    }

    // ---- coloring and overlays
    /** Overlay layers of this panel with their colors: the configured signature color when free, else the palette. */
    function overlayLayers() {
      const layers = drawnOverlays().map((key) => {
        if (key.startsWith(GENE_OVERLAY)) {
          const gk = key.slice(GENE_OVERLAY.length);
          const gv = geneVecs.get(gk);
          const none = !!gv && !gv.used.length; // none of its genes is in the data
          return {
            key, label: geneText(gv && gv.used.length ? gv.used : gk.split(',')), color: null,
            mask: gv && !none ? (i) => gv.counts[i] > 0 : null,
            value: gv && !none ? (i) => gv.counts[i] : null,
            status: none ? 'not in the data' : (gv ? '' : (geneErrors.has(gk) ? 'failed' : LOADING)),
            note: gv && !none && gv.missing.length ? `not in the data: ${gv.missing.join(', ')}` : '',
          };
        }
        const f = data.fields.get(key);
        const isBool = !!f && f.type === 'bool';
        return {
          key, label: overlayLabel(key), color: BOOL_COLORS[key] || signatureColor(key, data.colors),
          mask: isBool ? (i) => f.values[i] === 1 : null, status: isBool ? '' : 'not in this section',
        };
      });
      const used = [];
      for (const l of layers) {
        if (l.color && !tooClose(l.color, used)) used.push(l.color);
        else l.color = null; // e.g. the pooled and the native call of one signature: the second takes a palette color
      }
      // the gene lines and the combinations of their overlaps: colors chosen together, each as far as can be (CIELAB)
      // from the others and from everything else on the map: background, gray bins, the coloring under them, the
      // configured colors of the other layers (farColors); the genes take the first, the combinations the rest
      const genes = layers.filter(isGeneLayer);
      const under = style ? style.legend.map((e) => e.color).filter((c) => c !== NEUTRAL) : [];
      const pal = mapPalette();
      const far = farColors(genes.length + comboCount(genes.length), [pal.bg, pal.neutral, pal.text, ...used, ...under]);
      genes.forEach((l, k) => { l.color = far[k] || OVERLAY_PALETTE[k % OVERLAY_PALETTE.length]; });
      geneEdges = far.slice(genes.length);
      // a yes/no layer without a configured color (rare): a palette color apart from all of those
      const free = OVERLAY_PALETTE.filter((c) => !tooClose(c, [...used, ...far]));
      let next = 0;
      for (const l of layers) {
        if (l.color) continue;
        l.color = free.length ? free[next % free.length] : OVERLAY_PALETTE[next % OVERLAY_PALETTE.length];
        next += 1;
      }
      return layers;
    }

    /**
     * What the color scale of this panel's coloring is fitted to, on its own: {key (genes summed or number field),
     * lo, hi} or null (labels, calls, nothing loaded yet).
     */
    function ownScale() {
      if (!data) return null;
      if (st.field === GENE_FIELD) {
        const gv = st.genes.length ? geneVecs.get(genesKey(st.genes)) : null;
        if (!gv || !gv.detected) return null;
        const names = (gv.used.length ? gv.used : st.genes).map((g) => g.toLowerCase()).sort();
        return { key: `gene\n${genesKey(names)}`, lo: gv.lo, hi: gv.clamp };
      }
      const f = data.fields.get(st.field);
      const r = f && f.type === 'number' ? numberRange(f) : null;
      return r ? { key: `field\n${f.key}`, lo: r.lo, hi: r.hi } : null;
    }

    function restyleIfScaleMoved() {
      if (data && rangeText(scaleRangeFor(ownScale())) !== scaleUsed) restyle();
    }

    function restyle() {
      if (!data) {
        style = null;
        ovl = null;
        rings = null;
        vis = null;
        scaleUsed = '';
        paintTitle();
        paintLegend();
        requestRender();
        syncScales(self);
        return;
      }
      const range = scaleRangeFor(ownScale());
      scaleUsed = rangeText(range);
      // two or more cell types picked: the bins positive for two or more of them are shaded (not in a type's color)
      // and outlined as clusters
      const picked = st.field === CELL_FIELD && cellField() ? pickedCells() : null;
      if (picked && picked.length >= 2) {
        const f = cellField();
        const colors = categoryColors(f, data.colors);
        const codeOf = new Map(f.categories.map((name, c) => [name, c]));
        const pal = mapPalette();
        rings = cellOverlap(data, picked, (t) => colors[codeOf.get(t)] || OUTLINE_COLOR, [pal.bg, pal.neutral, pal.text]);
      } else {
        rings = null;
      }
      if (st.field === GENE_FIELD) {
        const gv = st.genes.length ? geneVecs.get(genesKey(st.genes)) : null;
        style = gv ? buildGeneStyle(data, gv, new Set(st.hidden[GENE_FIELD] || []), range) : buildStyle(data, null, new Set());
      } else if (st.field === TOP_FIELD) {
        style = topVec ? buildTopStyle(data, topVec, new Set(st.hidden[TOP_FIELD] || [])) : buildStyle(data, null, new Set());
      } else if (st.field === CELL_FIELD && cellField()) {
        style = buildCellStyle(data, cellField(), pickedCells(), new Set(st.hidden[CELL_FIELD] || []), rings ? rings.combos : []);
      } else {
        const f = data.fields.get(st.field) || null;
        style = buildStyle(data, f, new Set(st.hidden[f ? f.key : st.field] || []), range, st.field === NONE_FIELD);
      }
      if (drawnOverlays().length) {
        const layers = overlayLayers(); // the gene lines' colors and their combinations' (geneEdges), far apart
        ovl = buildOverlays(data, layers, geneEdges.length ? geneEdges : [OUTLINE_COLOR]);
      } else {
        ovl = null;
      }
      if (ovl && ovl.groups.length) {
        vis = style.visible.slice();
        shownCount = 0;
        for (let i = 0; i < data.n; i += 1) {
          if (ovl.member[i] >= 0) vis[i] = 1;
          shownCount += vis[i];
        }
      } else {
        vis = style.visible;
        shownCount = style.shown;
      }
      if (hover >= 0 && !vis[hover]) setHover(-1);
      paintTitle();
      paintLegend();
      paintOverlayRow();
      paintLineSwatches();
      requestRender();
      syncScales(self);
      measureSoon(); // the overlay row may have come or gone
    }

    /**
     * The coloring checked against the section's fields. There is no "Color by": the bins are gray (NONE_FIELD) or
     * colored by the genes typed (GENE_FIELD). A yes/no field (calls, region, quality control) asked for (a view kept
     * from before, a viewer.show()) becomes a layer over the gray bins, the same picture; a label or number gives way
     * to the gray bins (its values show in the tooltip).
     */
    function normalizeField() {
      const kept = (st.field === GENE_FIELD && hasGenes && st.genes.length) || (st.field === TOP_FIELD && hasTop)
        || (st.field === CELL_FIELD && !!cellField());
      if (st.field === CELL_FIELD && kept && !st.cells.length) st.cells = [ALL_CELLS]; // a view from the Cell type toggle
      if (!kept) {
        const f = data.fields.get(st.field);
        if (f && f.type === 'bool') {
          if (!st.overlays.includes(st.field) && st.overlays.length < MAX_OVERLAYS) st.overlays.push(st.field);
          // its negative bins hidden (only the positive or passing bins shown): the gray bins hidden, the same picture
          if (st.hidden && Array.isArray(st.hidden[st.field]) && st.hidden[st.field].includes('no')) st.hidden[NONE_FIELD] = [BASE];
        }
        st.field = NONE_FIELD;
      }
      // the gene lines in their stored form (a gene added from the data explorer, a view kept from before)
      if (hasGenes) storeLines(geneLines());
    }

    /** "+ Add layer" adds a gene line: there is room for one more (the source has genes). */
    function paintAddBtn() {
      addBtn.disabled = !hasGenes || geneLines().length + st.overlays.filter((k) => !isGeneKey(k)).length >= MAX_OVERLAYS;
    }

    function syncControls(focusLine = -1) {
      paintLines(focusLine);
      if (topBtn) topBtn.setAttribute('aria-pressed', st.field === TOP_FIELD ? 'true' : 'false');
      paintCellLines();
      paintAddBtn();
      dimInput.checked = st.dim;
    }

    /** The "Top gene" toggle: every bin in the color of its top gene, or back to the gene lines (none: gray bins). */
    function toggleTop() {
      const lines = geneLines();
      if (st.field === TOP_FIELD) {
        st.field = NONE_FIELD;
      } else {
        st.field = TOP_FIELD;
        topError = null; // a failed load is tried again
      }
      storeLines(lines); // kept while Top gene is on, shown again when it is off
      if (!data) return;
      syncControls();
      ensureTop();
      ensureGenes();
      prune();
      restyle();
      tellPage();
    }

    // ---- gene lines. "Color by genes" is a list of lines, one gene each (or genes joined by +, summed). The panel's
    // state keeps them as before, so that saved views, viewer.show() and the data explorer's gene table go on working:
    // one line is the gene coloring (field GENE_FIELD, st.genes: the bins colored by its UMIs); two or more are gene
    // overlays ('gene:Ctsk'), each in its own color, a bin detecting several in the color of its combination (one group per
    // combination of genes, outlined as clusters)
    // (buildOverlays). While Top gene is on the lines are kept as gene overlays and not drawn (drawnOverlays).
    const isGeneKey = (k) => k.startsWith(GENE_OVERLAY);
    // the colorings that take the place of the gene lines (kept as gene overlays, not drawn, while one is on)
    const linesAside = () => st.field === TOP_FIELD || st.field === CELL_FIELD;
    /** The section's cell type field (a category), null when its bins have none (raw data). */
    const cellField = () => {
      const f = data ? data.fields.get(CELL_FIELD) : null;
      return f && f.type === 'category' ? f : null;
    };

    /** Genes keys of the lines, in order: the genes coloring the panel, then its gene overlays (duplicates once). */
    function geneLines() {
      const keys = [];
      if (st.field === GENE_FIELD && st.genes.length) keys.push(genesKey(st.genes));
      for (const k of st.overlays) if (isGeneKey(k)) keys.push(k.slice(GENE_OVERLAY.length));
      const seen = new Set();
      return keys.filter((gk) => {
        const f = foldGenes(gk.split(','));
        if (seen.has(f)) return false;
        seen.add(f);
        return true;
      });
    }

    /** Store `lines` (genes keys) in the panel's state: one line as the gene coloring, else as gene overlays. */
    function storeLines(lines) {
      const others = st.overlays.filter((k) => !isGeneKey(k));
      if (lines.length === 1 && !linesAside()) {
        st.genes = lines[0].split(',');
        st.field = GENE_FIELD;
        st.overlays = others;
        return;
      }
      if (st.field === GENE_FIELD) st.field = NONE_FIELD;
      st.genes = [];
      st.overlays = [...lines.map((gk) => GENE_OVERLAY + gk), ...others];
    }

    /** The overlays drawn: all of them, but not the gene lines while Top gene is on. */
    function drawnOverlays() {
      return linesAside() ? st.overlays.filter((k) => !isGeneKey(k)) : st.overlays;
    }

    /** New gene lines (genes keys) for the panel; focusLine: the line that keeps the focus. */
    function setLines(lines, focusLine = -1) {
      let next = lines;
      const room = Math.max(0, MAX_OVERLAYS - st.overlays.filter((k) => !isGeneKey(k)).length);
      if (next.length > room) {
        tooManyOverlays(next.slice(room).map((gk) => GENE_OVERLAY + gk));
        next = next.slice(0, room);
      }
      storeLines(next);
      for (const gk of next) geneErrors.delete(gk); // genes that failed before are tried again
      if (!data) { paintLines(focusLine); return; }
      syncControls(focusLine);
      ensureGenes();
      prune();
      restyle();
      tellPage();
    }

    /** Line k submitted: its genes replace it (one line each; genes joined by + stay one line); empty: it goes. */
    function submitLine(k, text) {
      const lines = geneLines();
      const typed = parseGeneLayers(text).map((genes) => genesKey(genes));
      if (typed.length && linesAside()) st.field = NONE_FIELD; // showing genes ends the Top gene or Cell type coloring
      if (k >= lines.length) blankLine = false;
      const next = [...lines.slice(0, k), ...typed, ...lines.slice(k + 1)];
      const seen = new Set();
      const unique = next.filter((gk) => {
        const f = foldGenes(gk.split(','));
        if (seen.has(f)) return false;
        seen.add(f);
        return true;
      });
      if (unique.length < next.length) toast('A gene already on a line is shown once.', 'info', { timeout: 2500 });
      setLines(unique, Math.min(k, Math.max(0, unique.length - 1)));
    }

    function removeLine(k) {
      const lines = geneLines();
      if (k >= lines.length) { // the empty line added last
        blankLine = false;
        paintLines();
        addBtn.focus();
        return;
      }
      lines.splice(k, 1);
      setLines(lines, lines.length ? Math.min(k, lines.length - 1) : 0);
    }

    /** "+ Add layer": an empty line under the last one, focused (the first line when there is none). */
    function addLine() {
      const lines = geneLines();
      if (!lines.length || blankLine) { // the first line, or the empty line already there
        paintLines(lines.length);
        return;
      }
      if (lines.length + st.overlays.filter((k) => !isGeneKey(k)).length >= MAX_OVERLAYS) {
        tooManyOverlays([]);
        return;
      }
      blankLine = true;
      paintLines(lines.length);
    }

    /** Make the lines again from the panel's state (plus the empty one); focusLine: the line whose box gets the focus. */
    function paintLines(focusLine = -1) {
      if (!hasGenes) return;
      // a line being typed in keeps its text and the focus (its genes renamed meanwhile, another line's genes loaded)
      const typing = lineBoxes.findIndex((b) => b.input === document.activeElement);
      const typed = typing >= 0 ? lineBoxes[typing].input.value : null;
      for (const b of lineBoxes) b.destroy();
      const lines = geneLines();
      const shown = lines.map((gk) => gk.split(',').join(' + '));
      if (!lines.length || blankLine) shown.push('');
      lineBoxes = [];
      mount(linesEl, shown.map((text, k) => {
        const box = geneInput({
          label: `Gene line ${k + 1}`, placeholder: k ? 'one more gene, e.g. Acp5' : 'e.g. Ctsk', submitLabel: 'Show',
          search: searchGenes, suggestOnFocus: !text, onSubmit: (names, typed) => submitLine(k, typed),
        });
        box.set(text);
        box.input.setAttribute('aria-label', `Gene line ${k + 1}`);
        lineBoxes.push(box);
        const removable = k < lines.length || k > 0; // every line but the one empty line of a panel without genes
        return h('div', { class: 'sv-line', dataset: { key: k < lines.length ? lines[k] : '' } },
          h('span', { class: 'swatch sv-line-swatch', 'aria-hidden': 'true' }),
          box.el,
          removable ? h('button', {
            class: 'btn small ghost icon-only', type: 'button', title: 'Remove this line',
            'aria-label': `Remove gene line ${k + 1}${text ? ` (${text})` : ''}`, onClick: () => removeLine(k),
          }, icon('x', { size: 14 })) : null);
      }));
      paintLineSwatches();
      if (focusLine >= 0 && lineBoxes.length) {
        lineBoxes[Math.min(focusLine, lineBoxes.length - 1)].focus();
      } else if (typing >= 0 && typing < lineBoxes.length) {
        lineBoxes[typing].set(typed);
        lineBoxes[typing].focus();
      }
    }

    /**
     * The swatch of every line as drawn now: the viridis ramp for one line (bins colored by its UMIs), the gene's own
     * color for two or more, nothing while Top gene is on; a line that cannot be drawn says why in its title.
     */
    function paintLineSwatches() {
      if (!hasGenes) return;
      const lines = geneLines();
      const top = linesAside(); // Top gene or Cell type on: the lines are not drawn
      const which = st.field === CELL_FIELD ? 'Color by cells' : 'Top gene';
      linesNote.hidden = !(top && lines.length);
      linesNote.textContent = top && lines.length ? `Not drawn while ${which} is on; Show on a line draws the genes again.` : '';
      for (const row of linesEl.children) {
        const gk = row.dataset.key;
        const sw = row.querySelector('.sv-line-swatch');
        let bg = 'transparent';
        let title = '';
        if (gk && !top) {
          if (lines.length === 1) {
            bg = `linear-gradient(90deg, ${VIRIDIS.join(', ')})`;
            title = 'The bins are colored by the UMIs of this line (dark: few, bright: many)';
          } else {
            const l = ovl ? ovl.layers.find((x) => x.key === GENE_OVERLAY + gk) : null;
            if (l && l.color) bg = l.color;
            title = l && l.count === null && l.status !== LOADING ? `${l.label}: ${l.status}` : (l && l.note ? `${l.label}: ${l.note}` : '');
          }
        }
        sw.style.background = bg;
        sw.style.visibility = bg === 'transparent' ? 'hidden' : 'visible'; // an empty swatch would look like a checkbox
        sw.title = title;
        row.classList.toggle('warn', !!title && lines.length > 1);
      }
    }

    // ---- "Color by cells": st.cells holds the cell types picked, one per line (ALL_CELLS: every type); the panel is
    // colored by them while st.field is CELL_FIELD (Show on a cell line). The gene lines wait meanwhile, as for Top
    // gene; Show on a gene line (or Top gene) colors by genes again and leaves the cell lines waiting in turn.
    /** The section's cell types with their bins, the most bins first: [{name, n}]. */
    function cellTypes() {
      const f = cellField();
      if (!f) return [];
      const n = new Int32Array(f.categories.length);
      for (let i = 0; i < data.n; i += 1) if (data.ok[i] && f.codes[i] >= 0) n[f.codes[i]] += 1;
      return f.categories.map((name, c) => ({ name, n: n[c] })).filter((t) => t.n > 0).sort((a, b) => b.n - a.n);
    }

    /** Suggestions of a cell line: "All cell types", then the section's types containing the text typed. */
    async function searchCells(q, signal, offset = 0) {
      if (offset > 0) return [];
      const text = String(q || '').toLowerCase();
      const out = cellTypes().filter((t) => t.name.toLowerCase().includes(text)).map((t) => ({ gene: t.name, n_bins: t.n }));
      if (ALL_CELLS_TEXT.toLowerCase().startsWith(text)) out.unshift({ gene: ALL_CELLS_TEXT, n_bins: data ? data.valid : null });
      return out;
    }

    /** The cell types picked, null for all of them (the panel colored by every type). */
    function pickedCells() {
      return !st.cells.length || st.cells.includes(ALL_CELLS) ? null : st.cells;
    }

    /** Cell line k submitted: "All cell types", or the cell types typed (one line each); empty: the line goes. */
    function submitCellLine(k, text) {
      const f = cellField();
      if (!f) return;
      const cells = st.cells.slice();
      const words = String(text || '').trim();
      let typed;
      if (/^all( cell types)?$/i.test(words)) {
        typed = [ALL_CELLS];
      } else {
        const byName = new Map(f.categories.map((c) => [c.toLowerCase(), c]));
        const names = parseTokens(words);
        const unknown = names.filter((t) => !byName.has(t.toLowerCase()));
        if (unknown.length) toast(`Not a cell type of this section: ${unknown.join(', ')}.`, 'warning');
        typed = names.map((t) => byName.get(t.toLowerCase())).filter(Boolean);
        if (names.length && !typed.length) return; // nothing usable typed: the line stays as it was
      }
      if (k >= cells.length) cellBlank = false;
      let next = [...cells.slice(0, k), ...typed, ...cells.slice(k + 1)];
      // "All cell types" stands alone: picking it drops the other lines, picking a type drops it
      if (typed.includes(ALL_CELLS)) next = [ALL_CELLS];
      else if (typed.length) next = next.filter((c) => c !== ALL_CELLS);
      st.cells = [...new Set(next)];
      // Show with a cell type colors the map by the cell lines; an emptied line only goes
      setCellColoring(typed.length > 0 || st.field === CELL_FIELD, Math.min(k, Math.max(0, st.cells.length - 1)));
    }

    function removeCellLine(k) {
      if (k >= st.cells.length) { // the empty line added last
        cellBlank = false;
        paintCellLines();
        addCellBtn.focus();
        return;
      }
      st.cells.splice(k, 1);
      setCellColoring(st.field === CELL_FIELD, st.cells.length ? Math.min(k, st.cells.length - 1) : 0);
    }

    /** "+ Add cell type": an empty cell line under the last one, focused (the first line when there is none). */
    function addCellLine() {
      if (!st.cells.length || cellBlank) { paintCellLines(st.cells.length); return; }
      cellBlank = true;
      paintCellLines(st.cells.length);
    }

    /**
     * Color the panel by the picked cell types (on), or stop (off, or nothing picked: back to the gene lines, which
     * waited meanwhile). focusLine: the cell line that keeps the focus.
     */
    function setCellColoring(on, focusLine = -1) {
      const lines = geneLines();
      if (on && st.cells.length) st.field = CELL_FIELD;
      else if (st.field === CELL_FIELD) st.field = NONE_FIELD;
      storeLines(lines);
      syncControls();
      if (focusLine >= 0) paintCellLines(focusLine);
      ensureGenes();
      prune();
      restyle();
      tellPage();
    }

    /** Make the cell lines again from the panel's state (plus the empty one); hidden without cell types. */
    function paintCellLines(focusLine = -1) {
      const f = cellField();
      cellsCtl.hidden = !f;
      const typing = cellBoxes.findIndex((b) => b.input === document.activeElement);
      const typed = typing >= 0 ? cellBoxes[typing].input.value : null;
      for (const b of cellBoxes) b.destroy();
      cellBoxes = [];
      if (!f) { mount(cellLinesEl); return; }
      const on = st.field === CELL_FIELD;
      const colors = categoryColors(f, data.colors);
      const codeOf = new Map(f.categories.map((name, c) => [name, c]));
      const shown = st.cells.map((c) => (c === ALL_CELLS ? ALL_CELLS_TEXT : c));
      if (!st.cells.length || cellBlank) shown.push('');
      mount(cellLinesEl, shown.map((text, k) => {
        const box = geneInput({
          label: `Cell type line ${k + 1}`, placeholder: k ? 'one more cell type' : 'e.g. osteoclast', submitLabel: 'Show',
          search: searchCells, suggestOnFocus: !text, onSubmit: (names, t) => submitCellLine(k, t),
        });
        box.set(text);
        box.input.setAttribute('aria-label', `Cell type line ${k + 1}`);
        cellBoxes.push(box);
        const c = k < st.cells.length ? codeOf.get(st.cells[k]) : undefined;
        const bg = on && c !== undefined && pickedCells() ? colors[c] : 'transparent';
        return h('div', { class: 'sv-line' },
          h('span', { class: 'swatch sv-line-swatch', 'aria-hidden': 'true', style: { background: bg, visibility: bg === 'transparent' ? 'hidden' : 'visible' } }),
          box.el,
          k < st.cells.length || k > 0 ? h('button', {
            class: 'btn small ghost icon-only', type: 'button', title: 'Remove this line',
            'aria-label': `Remove cell type line ${k + 1}${text ? ` (${text})` : ''}`, onClick: () => removeCellLine(k),
          }, icon('x', { size: 14 })) : null);
      }));
      cellNote.hidden = on || !st.cells.length;
      cellNote.textContent = cellNote.hidden ? '' : 'Not drawn while the map is colored by genes or Top gene; Show on a line draws the cell types again.';
      if (focusLine >= 0 && cellBoxes.length) {
        cellBoxes[Math.min(focusLine, cellBoxes.length - 1)].focus();
      } else if (typing >= 0 && typing < cellBoxes.length) {
        cellBoxes[typing].set(typed);
        cellBoxes[typing].focus();
      }
    }

    /** Load the top genes of the section while the panel is colored by them. */
    function ensureTop() {
      if (!data || !hasTop || st.field !== TOP_FIELD || topVec || topPending || topError) return;
      const sid = st.sample;
      const cached = store.topData.get(sid);
      if (cached) { topVec = cached; return; }
      topPending = true;
      const token = loadToken;
      loadTop(sid, data).then((tv) => {
        if (!alive || token !== loadToken) return;
        topPending = false;
        topVec = tv;
        restyle();
      }, (err) => {
        if (!alive || token !== loadToken) return;
        topPending = false;
        if (err && err.name === 'AbortError') return;
        topError = (err && err.message) || String(err);
        restyle();
      });
    }

    function removeOverlay(key) {
      const at = st.overlays.indexOf(key);
      st.overlays = st.overlays.filter((k) => k !== key);
      overlaysChanged();
      // the focus goes to the remove button of the chip now in its place (else the one before), else to "+ Add layer"
      const btns = ovlChips.querySelectorAll('button');
      const next = btns.length ? btns[Math.min(Math.max(at, 0), btns.length - 1)] : null;
      (next || addBtn).focus();
    }

    /** After overlays were added, removed or renamed: load what they need, repaint, and tell the page (sv-change). */
    function overlaysChanged() {
      if (data) {
        ensureGenes();
        prune();
        restyle();
      } else {
        paintOverlayRow(); // a section is loading: the chips follow now, the map once it is there
        measureSoon();
      }
      paintAddBtn();
      tellPage();
    }

    /**
     * An overlay typed in another case ('ctsk') takes the names the data has ('Ctsk') once its counts are there: the
     * gene list of a page marks it, and the same gene typed again in yet another case is seen as shown. False when
     * nothing changed.
     */
    function canonicalize(gk, gv) {
      const at = st.overlays.indexOf(GENE_OVERLAY + gk);
      if (at < 0 || gv.missing.length || !gv.used.length) return false;
      const ck = genesKey(gv.used);
      if (ck === gk) return false;
      if (st.overlays.includes(GENE_OVERLAY + ck)) st.overlays.splice(at, 1);
      else st.overlays[at] = GENE_OVERLAY + ck;
      geneVecs.set(ck, gv);
      return true;
    }

    // ---- data
    function neededGeneKeys() {
      const keys = [];
      if (st.field === GENE_FIELD && st.genes.length) keys.push(genesKey(st.genes));
      for (const k of drawnOverlays()) if (isGeneKey(k)) keys.push(k.slice(GENE_OVERLAY.length));
      return [...new Set(keys)];
    }

    /** Request keys this panel waits for (requests nobody waits for are aborted). */
    function wants() {
      const keys = [`bins\n${st.sample}`];
      for (const gk of neededGeneKeys()) keys.push(`gene\n${st.sample}\n${gk}`);
      if (hasTop && st.field === TOP_FIELD) keys.push(`top\n${st.sample}`);
      if (hasImage && store.image.on) keys.push(`image\n${st.sample}`);
      return keys;
    }

    /** Load the counts of the genes shown (color and overlays) that are not loaded yet. */
    function ensureGenes() {
      if (!data || !hasGenes) return;
      const sid = st.sample;
      const d = data;
      const token = loadToken;
      let renamed = false;
      for (const gk of neededGeneKeys()) {
        if (geneVecs.has(gk)) { // loaded before (e.g. 'ctsk' added, renamed, removed and typed again)
          renamed = canonicalize(gk, geneVecs.get(gk)) || renamed;
          continue;
        }
        if (geneErrors.has(gk) || genePending.has(gk)) continue;
        const cached = cachedGene(`${sid}\n${gk}`);
        if (cached) {
          geneVecs.set(gk, cached);
          renamed = canonicalize(gk, cached) || renamed;
          continue;
        }
        genePending.add(gk);
        loadGene(sid, d, gk.split(',')).then((gv) => {
          if (!alive || token !== loadToken) return;
          genePending.delete(gk);
          geneVecs.set(gk, gv);
          const moved = canonicalize(gk, gv);
          restyle();
          if (moved) {
            paintLines();
            tellPage();
          }
        }, (err) => {
          if (!alive || token !== loadToken) return;
          genePending.delete(gk);
          if (err && err.name === 'AbortError') return;
          geneErrors.set(gk, (err && err.message) || String(err));
          restyle();
        });
      }
      if (renamed) {
        paintLines();
        tellPage();
      }
    }

    /** The overlays of this panel changed (added, removed, renamed): an sv-change event for the page (data explorer). */
    function tellPage() {
      el.dispatchEvent(new CustomEvent('sv-change', { bubbles: true }));
    }

    /** Load the H&E image of the section when it is shown; retry: after the Retry of a failed load. */
    function ensureImage(retry = false) {
      if (!hasImage || !store.image.on || !data) return;
      const sid = st.sample;
      const cached = store.images.get(sid);
      if (cached) { imageEntry = cached; return; }
      if (imagePending || imageError) return;
      imagePending = true;
      const token = loadToken;
      loadImage(sid, retry).then((e) => {
        if (!alive || token !== loadToken) return;
        imagePending = false;
        imageEntry = e;
        paintLegend();
        requestRender(); // the bins in several overlays change color over the image
      }, (err) => {
        if (!alive || token !== loadToken) return;
        imagePending = false;
        if (err && err.name === 'AbortError') return;
        imageError = (err && err.message) || String(err);
        paintLegend();
      });
    }

    function imageChanged() {
      ensureImage();
      paintLegend();
      requestRender();
    }

    function showMsg(content) {
      mount(msg, h('div', { class: 'sv-msg-body' }, content));
      msg.hidden = false;
    }

    function hideMsg() {
      mount(msg);
      msg.hidden = true;
    }

    function setSample(sid) {
      st.sample = sid;
      if (sampleSel.value !== sid) sampleSel.value = sid;
      return load();
    }

    async function load() {
      const token = ++loadToken;
      const sid = st.sample;
      setHover(-1);
      geneVecs = new Map();
      geneErrors = new Map();
      genePending = new Set();
      topVec = null;
      topError = null;
      topPending = false;
      imageEntry = null;
      imageError = null;
      imagePending = false;
      prune();
      let d = store.data.get(sid);
      if (!d) {
        data = null;
        layerState = null;
        restyle();
        updateSave();
        const meta = samples.find((s) => s.id === sid);
        showMsg(loading(meta && Number.isFinite(meta.n) ? `Loading ${fmt.int(meta.n)} bins…` : 'Loading bins…'));
        try {
          d = await loadBins(sid);
        } catch (err) {
          if (!alive || token !== loadToken || (err && err.name === 'AbortError')) return;
          showMsg(errorPanel(err, { retry: load }));
          return;
        }
        if (!alive || token !== loadToken) return;
      }
      data = d;
      layerState = null;
      normalizeField();
      syncControls();
      if (d.valid) hideMsg();
      else showMsg(emptyState({ icon: 'map', title: 'No bins to draw', text: 'This section has no bins with coordinates.' }));
      // the linked view fits the sections shown until someone moves it
      if (store.link && (!goodView(store.view) || store.view.auto)) fitLinked();
      ensureGenes();
      ensureTop();
      ensureImage();
      prune();
      restyle();
      updateSave();
    }

    /** viewer.show(): change the section, the coloring or the overlays of this panel. */
    function apply(patch) {
      const before = st.sample;
      const dropped = [];
      const genesBefore = new Set(st.overlays.filter(isGeneKey));
      patchState(st, patch, dropped);
      // a gene added as a line (the data explorer's +) is drawn: it ends the Top gene coloring
      if ((st.field === TOP_FIELD || st.field === CELL_FIELD) && st.overlays.some((k) => isGeneKey(k) && !genesBefore.has(k))) {
        st.field = NONE_FIELD;
      }
      if (dropped.length) tooManyOverlays(dropped);
      if (!samples.some((s) => s.id === st.sample)) st.sample = before;
      if (Array.isArray(patch.genes) || typeof patch.genes === 'string') geneErrors.delete(genesKey(st.genes));
      if (st.sample !== before || !data) {
        sampleSel.value = st.sample;
        load();
        return;
      }
      normalizeField();
      syncControls();
      ensureGenes();
      ensureTop();
      prune();
      restyle();
    }

    // ---- export
    function fileTag() {
      const what = st.field === GENE_FIELD ? genesKey(st.genes) || 'genes'
        : (st.field === TOP_FIELD ? 'top_gene' : st.field === CELL_FIELD ? `cells_${(pickedCells() || ['all']).join('_')}`
          : (st.field === NONE_FIELD ? st.overlays.map(overlayLabel).join('_') || 'bins' : st.field || 'bins'));
      return `${st.sample}_${what}`;
    }

    function legendHeight() {
      if (!data) return 0;
      let hgt = 8 + 24;
      if (style && style.scale) hgt += 36 + 18 + (style.scale.clamped ? 18 : 0);
      if (style && style.kind === 'gene') hgt += 18 * (1 + (style.gene.missing.length ? 1 : 0));
      if (style && style.kind === 'top') hgt += 18;
      hgt += 19 * (style ? style.legend.filter((e) => !e.off).length : 0);
      if (ovl && ovl.layers.length) {
        hgt += 26 + 19 * (ovl.layers.length + (ovl.combos || []).length + (ovl.several ? 1 : 0)) + (ovl.layers.some(isGeneLayer) ? 18 : 0);
      }
      return hgt + 8;
    }

    function drawLegendTo(g, x, y, width, P) {
      g.save();
      g.textBaseline = 'top';
      let top = y;
      const swatchRow = (color, label, count, shape = null) => {
        if (shape) { // an overlap combination: its shape in its one color, with a dark edge
          g.beginPath();
          shapePath(g, shape, x + 6, top + 7, 6);
          g.fillStyle = color;
          g.fill();
          g.lineJoin = 'round';
          g.strokeStyle = OUTLINE_HALO;
          g.lineWidth = 1.2;
          g.stroke();
        } else {
          g.fillStyle = groupColor(color, P);
          g.fillRect(x, top + 1, 12, 12);
        }
        g.font = `12px ${FONT}`;
        const text = count === null || count === undefined ? '—' : fmt.int(count);
        const cw = g.measureText(text).width;
        g.fillStyle = P.text;
        g.fillText(label, x + 18, top, Math.max(10, width - 26 - cw));
        g.fillStyle = P.muted;
        g.fillText(text, x + width - cw, top);
        top += 19;
      };
      g.fillStyle = P.text;
      g.font = `600 13px ${FONT}`;
      g.fillText(legendTitle(), x, top, width);
      top += 24;
      g.font = `12px ${FONT}`;
      if (style && style.scale) {
        for (let k = 0; k < width; k += 1) {
          g.fillStyle = LUT[Math.min(LEVELS - 1, Math.floor((k / width) * LEVELS))];
          g.fillRect(x + k, top, 1, 12);
        }
        g.fillStyle = P.muted;
        g.fillText(formatNumber(style.scale.min), x, top + 16);
        const maxText = `${clampedMark(style.scale)}${formatNumber(style.scale.max)}`;
        g.fillText(maxText, x + width - g.measureText(maxText).width, top + 16);
        top += 36;
        // what the screen's legend says under its color bar, in short
        const { log, shared, clamped } = style.scale;
        g.fillText(`${log ? 'log' : 'linear'} color scale${shared ? ', shared by the panels' : ''}`, x, top, width);
        top += 18;
        if (clamped) { g.fillText('colors stop at the 99th percentile', x, top, width); top += 18; }
      }
      if (style && style.kind === 'gene') {
        const gv = style.gene;
        g.fillStyle = P.muted;
        g.fillText(`detected in ${fmt.int(gv.detected)} of ${fmt.int(data.n)} bins`, x, top, width);
        top += 18;
        if (gv.missing.length) {
          g.fillText(`not in the data: ${gv.missing.join(', ')}`, x, top, width);
          top += 18;
        }
      }
      if (style && style.kind === 'top') {
        g.fillStyle = P.muted;
        g.fillText(style.top.pooled ? 'most UMIs in the bin and the 8 around it' : 'most UMIs in the bin', x, top, width);
        top += 18;
      }
      for (const e of style ? style.legend : []) if (!e.off) swatchRow(e.color, e.label, e.count, e.shape);
      if (ovl && ovl.layers.length) {
        top += 6;
        g.fillStyle = P.text;
        g.font = `600 12px ${FONT}`;
        g.fillText('Layers', x, top, width);
        top += 20;
        if (ovl.layers.some(isGeneLayer)) {
          g.fillStyle = P.muted;
          g.font = `12px ${FONT}`;
          g.fillText('genes: the one with most UMIs per bin', x, top, width);
          top += 18;
        }
        for (const l of ovl.layers) swatchRow(l.color, l.label, l.count);
        for (const c of ovl.combos || []) swatchRow(c.color, `${c.label} (${c.clusters} clusters)`, c.idx.length, c.shape);
        if (ovl.several) swatchRow(SEVERAL, severalLabel(), ovl.several);
      }
      g.restore();
    }

    /** This panel into the composite PNG: title, map (H&E, bins, frame, scale bar) and legend, at (ox, oy) css px. */
    function exportTo(g, ox, oy, ratio, legendW, titleH) {
      const P = EXPORT_PALETTE;
      g.setTransform(ratio, 0, 0, ratio, 0, 0);
      g.fillStyle = P.text;
      g.font = `600 15px ${FONT}`;
      g.textBaseline = 'middle';
      g.fillText(titleText(), ox + 12, oy + titleH / 2, Math.max(40, size.w + legendW - 24));
      const v = data && style ? getView() : null;
      if (!v || !size.w || !size.h) return;
      const t = xf(v);
      const mx = ox;
      const my = oy + titleH;
      g.save();
      g.beginPath();
      g.rect(mx, my, size.w, size.h);
      g.clip();
      const im = showImage();
      if (im) {
        g.imageSmoothingEnabled = true;
        drawImageUnder(g, im, { scale: t.scale, tx: t.tx + mx, ty: t.ty + my }, mx, my, size.w, size.h);
      }
      // the bins are drawn apart and copied in one go, so that a see-through layer has no darker seams
      const tmp = document.createElement('canvas');
      tmp.width = Math.round(size.w * ratio);
      tmp.height = Math.round(size.h * ratio);
      const tg = tmp.getContext('2d');
      const side = sidePx(t.scale);
      drawBins(tg, style.groups, data, t, ratio, side, P, dimOf());
      if (ovl) drawBins(tg, ovl.groups, data, t, ratio, side, P, 0);
      for (const c of outlinesDrawn()) drawOutline(tg, c.outline, t, ratio, c.edge || OUTLINE_COLOR, OUTLINE_HALO);
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = im ? Math.max(0, 1 - store.image.opacity) : 1;
      g.drawImage(tmp, Math.round(mx * ratio), Math.round(my * ratio));
      g.restore();
      tmp.width = 0;
      tmp.height = 0;
      g.strokeStyle = P.neutral;
      g.lineWidth = 1;
      g.strokeRect(mx + 0.5, my + 0.5, size.w - 1, size.h - 1);
      drawScaleBar(g, t.scale, mx + 10, my + size.h - 10, P);
      drawLegendTo(g, mx + size.w + 16, my + 8, legendW - 32, P);
    }

    function destroy() {
      alive = false;
      loadToken += 1;
      clearTimeout(crispTimer);
      resizeObserver.unobserve(stage);
      resizeObserver.unobserve(el);
      tip.hidden = true;
      fetchBinGenes.cancel();
      if (binCtrl) binCtrl.abort();
      for (const b of lineBoxes) b.destroy();
      for (const b of cellBoxes) b.destroy();
      layer.width = 0;
      layer.height = 0;
    }

    return Object.assign(self, {
      el,
      stage,
      start: load,
      data: () => data,
      size: () => size,
      hasData: () => !!(data && data.valid),
      canExport: () => !!(data && data.valid && style && size.w && size.h),
      ownView: () => st.views[st.sample],
      adoptView(v) { st.views[st.sample] = { cx: v.cx, cy: v.cy, scale: v.scale }; },
      wants,
      resize,
      requestRender,
      queuePaint,
      crisp,
      step,
      imageChanged,
      ownScale,
      restyle,
      restyleIfScaleMoved,
      hideTip,
      markWidth,
      apply,
      fileTag,
      legendHeight,
      exportTo,
      destroy,
    });
  }

  markLayout(store.layout);
  start();

  return {
    el,
    show(patch = {}) {
      const i = Number.isInteger(patch.panel) && patch.panel >= 0 && patch.panel < MAX_PANELS ? patch.panel : 0;
      if (panels[i]) {
        panels[i].apply(patch);
        return;
      }
      // a panel not shown (yet): remember the change for when it is
      const dropped = [];
      store.panels[i] = patchState(store.panels[i] && typeof store.panels[i] === 'object' ? store.panels[i] : {}, patch, dropped);
      if (dropped.length) tooManyOverlays(dropped);
    },
    destroy() {
      destroyed = true;
      if (startCtrl) startCtrl.abort();
      for (const r of inflight.values()) r.ctrl.abort();
      inflight.clear();
      cancelAnimationFrame(frame);
      cancelAnimationFrame(roomFrame);
      for (const p of panels) p.destroy();
      window.removeEventListener('resize', measureSoon);
      document.removeEventListener('scroll', onScroll, { capture: true });
      resizeObserver.disconnect();
      pageObserver.disconnect();
      themeObserver.disconnect();
      darkQuery.removeEventListener('change', onTheme);
    },
  };
}
