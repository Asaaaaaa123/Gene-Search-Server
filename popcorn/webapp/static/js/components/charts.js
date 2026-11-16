// charts.js — the charts of the Analysis tab, drawn as SVG without a library. Every chart function takes its data, a
// width and a theme and returns one <svg> element that carries everything it shows (title, axes, legend), so that the
// picture on the page and the exported file are the same drawing: on the page in the colors of the interface
// (screenTheme()), exported on white (PAPER) as SVG or PNG (exportSvg, exportPng). A mark with a `data-tip` attribute
// shows that text in a tooltip (attachTips); spatialMap() draws the bins of a section on a canvas.
import { svg as el, h } from '../core.js';
import { formatNumber } from './table-viewer.js';

export const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
// categories without a configured color (as the spatial viewer: Tableau 20 without its grays)
export const PALETTE = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b', '#e377c2', '#bcbd22', '#17becf',
  '#aec7e8', '#ffbb78', '#98df8a', '#ff9896', '#c5b0d5', '#c49c94', '#f7b6d2', '#dbdb8d', '#9edae5'];
const GRAY_NAMES = { unassigned: '#9aa3af', ambiguous: '#9aa3af', removed: '#7d8794', unresolved: '#8b95a3' };
const VIRIDIS = ['#440154', '#472c7a', '#3b518b', '#2c718e', '#21908d', '#27ad81', '#5cc863', '#aadc32', '#fde725'];
const UP = '#e5604f';
const DOWN = '#4a90d9';
export const PAPER = {
  name: 'paper', bg: '#ffffff', text: '#18212c', muted: '#5b6675', faint: '#8a94a3', grid: '#e7eaee', axis: '#aab2bd',
  neutral: '#c9cfd8', accent: '#2f6fed', zero: '#f4f6f9', rampStart: 0,
};

/** The colors of the interface's theme (read from its CSS variables). */
export function screenTheme() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
  return {
    name: 'screen', bg: 'none', text: v('--text', '#e6e9ed'), muted: v('--text-muted', '#9aa3af'),
    faint: v('--text-faint', '#6a7381'), grid: v('--border', '#232832'), axis: v('--border-strong', '#2f3642'),
    neutral: v('--plot-neutral', '#353c48'), accent: v('--accent-text', '#8db4ff'), zero: v('--surface-3', '#20252e'),
    rampStart: 0.22,   // the darkest viridis steps vanish on the dark background
  };
}

// ------------------------------------------------------------------------------------------------ helpers
let measureCtx = null;
export function textWidth(text, size = 11, weight = 400) {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  measureCtx.font = `${weight} ${size}px ${FONT}`;
  return measureCtx.measureText(String(text)).width;
}

/** `text` cut to `max` pixels with an ellipsis. */
export function fit(text, max, size = 11, weight = 400) {
  const s = String(text ?? '');
  if (textWidth(s, size, weight) <= max) return s;
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (textWidth(`${s.slice(0, mid)}…`, size, weight) <= max) lo = mid; else hi = mid - 1;
  }
  return `${s.slice(0, lo)}…`;
}

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

function mix(a, b, t) {
  const x = parseColor(a);
  const y = parseColor(b);
  if (!x || !y) return a;
  const m = (k) => Math.round(x[k] + (y[k] - x[k]) * t);
  return `rgb(${m(0)}, ${m(1)}, ${m(2)})`;
}

function ramp(stops, t) {
  const x = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  return mix(stops[i], stops[i + 1], x - i);
}

/** Sequential color of t in [0, 1] (viridis; on the dark theme from its brighter part on). */
export function sequential(t, theme) {
  const start = theme.rampStart || 0;
  return ramp(VIRIDIS, start + (1 - start) * Math.min(1, Math.max(0, t)));
}

/** Diverging color of t in [-1, 1]: blue below 0, the theme's neutral at 0, red above. */
export function diverging(t, theme) {
  const x = Math.min(1, Math.max(-1, t));
  return mix(theme.zero, x < 0 ? DOWN : UP, Math.abs(x) ** 0.8);
}

/** Text color readable on the fill `c`. */
function inkOn(c, theme) {
  const rgb = parseColor(c);
  if (!rgb) return theme.text;
  return (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) > 150 ? '#18212c' : '#f2f4f6';
}

/** A configured color as it can be seen: on the dark screen a very dark color (black, navy) is lightened. */
function seen(color, theme) {
  const rgb = parseColor(color);
  if (!rgb || !theme || theme.name !== 'screen') return color;
  const light = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
  return light < 70 ? mix(color, '#ffffff', 0.5 - light / 280) : color;
}

/**
 * A color per item: its own when it has one (made visible on the theme), a gray for the names that mean "none", else
 * the palette in turn.
 */
export function colorsOf(items, theme) {
  let k = 0;
  return items.map((it) => {
    if (it && typeof it.color === 'string' && parseColor(it.color)) return seen(it.color, theme);
    const gray = it && GRAY_NAMES[String(it.key ?? it.label ?? '').toLowerCase()];
    if (gray) return gray;
    const c = PALETTE[k % PALETTE.length];
    k += 1;
    return c;
  });
}

function niceStep(span, n) {
  const raw = span / Math.max(1, n);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
}

/** Tick values covering lo..hi, about n of them: {ticks, lo, hi, step} (lo and hi widened to ticks when `nice`). */
export function ticksOf(lo, hi, n = 5, nice = true) {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { ticks: [0, 1], lo: 0, hi: 1, step: 1 };
  if (hi === lo) { hi = lo + (Math.abs(lo) || 1); }
  const step = niceStep(hi - lo, n);
  const a = nice ? Math.floor(lo / step + 1e-9) * step : lo;
  const b = nice ? Math.ceil(hi / step - 1e-9) * step : hi;
  const ticks = [];
  for (let v = Math.ceil(a / step - 1e-9) * step; v <= b + step * 1e-9; v += step) ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return { ticks, lo: a, hi: b, step };
}

function tickText(v, step) {
  if (!Number.isFinite(v)) return '';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e6 || a < 1e-4) return v.toExponential(1).replace('e+', 'e');
  const digits = Math.max(0, Math.min(6, -Math.floor(Math.log10(step || a) + 1e-9)));
  return v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export const num = (v, digits = 3) => (v === null || v === undefined || Number.isNaN(Number(v)) ? '—'
  : (Math.abs(v) !== 0 && (Math.abs(v) < 10 ** -digits || Math.abs(v) >= 1e6) ? Number(v).toExponential(2)
    : Number(v).toLocaleString(undefined, { maximumFractionDigits: digits })));

const scale = (d0, d1, r0, r1) => (v) => r0 + (d1 === d0 ? 0.5 : (v - d0) / (d1 - d0)) * (r1 - r0);

function text(x, y, str, { size = 11, fill, anchor = 'start', weight, rotate, baseline, tip } = {}) {
  const t = el('text', {
    x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, 'font-size': size, fill, 'text-anchor': anchor,
    'font-weight': weight, 'dominant-baseline': baseline,
    transform: rotate ? `rotate(${rotate} ${Math.round(x * 10) / 10} ${Math.round(y * 10) / 10})` : null,
    'data-tip': tip,
  });
  t.textContent = String(str);
  return t;
}

const line = (x1, y1, x2, y2, stroke, width = 1, extra) => el('line', {
  x1, y1, x2, y2, stroke, 'stroke-width': width, 'shape-rendering': 'crispEdges', ...extra,
});

function root(width, height, theme, label) {
  const w = Math.max(120, Math.round(width));
  const hgt = Math.max(60, Math.round(height));
  const s = el('svg', {
    xmlns: 'http://www.w3.org/2000/svg', width: w, height: hgt, viewBox: `0 0 ${w} ${hgt}`, 'font-family': FONT,
    role: 'img', 'aria-label': label || 'Chart', class: 'ch',
  });
  if (theme.bg && theme.bg !== 'none') s.append(el('rect', { x: 0, y: 0, width: w, height: hgt, fill: theme.bg }));
  return s;
}

/** Left axis with horizontal grid lines over x0..x1; returns the scale value -> y. */
function leftAxis(g, { x0, x1, y0, y1, lo, hi, label, theme, n = 5, ticks }) {
  const t = ticks || ticksOf(lo, hi, n);
  const sy = scale(t.lo, t.hi, y1, y0);
  for (const v of t.ticks) {
    const y = Math.round(sy(v)) + 0.5;
    g.append(line(x0, y, x1, y, theme.grid));
    g.append(text(x0 - 6, y, tickText(v, t.step), { size: 10.5, fill: theme.muted, anchor: 'end', baseline: 'middle' }));
  }
  if (label) g.append(text(x0 - 34, (y0 + y1) / 2, label, { size: 11, fill: theme.muted, anchor: 'middle', rotate: -90 }));
  return Object.assign(sy, { domain: [t.lo, t.hi] });
}

/** Bottom axis of numbers; returns the scale value -> x. */
function bottomAxis(g, { x0, x1, y, y0, lo, hi, label, theme, n = 6, ticks, grid = false }) {
  const t = ticks || ticksOf(lo, hi, n);
  const sx = scale(t.lo, t.hi, x0, x1);
  g.append(line(x0, y + 0.5, x1, y + 0.5, theme.axis));
  for (const v of t.ticks) {
    const x = Math.round(sx(v)) + 0.5;
    if (grid) g.append(line(x, y0, x, y, theme.grid));
    g.append(line(x, y, x, y + 4, theme.axis));
    g.append(text(x, y + 15, tickText(v, t.step), { size: 10.5, fill: theme.muted, anchor: 'middle' }));
  }
  if (label) g.append(text((x0 + x1) / 2, y + 32, label, { size: 11, fill: theme.muted, anchor: 'middle' }));
  return Object.assign(sx, { domain: [t.lo, t.hi] });
}

/** Height the labels of a band axis need, and whether they are turned: {height, rotate, max}. */
function bandLabelSpace(labels, band, size = 10.5, maxWidth = 150) {
  const widest = Math.min(maxWidth, Math.max(0, ...labels.map((l) => textWidth(l, size))));
  if (widest <= band - 4) return { height: 18, rotate: false, max: band - 4 };
  return { height: Math.min(maxWidth, widest) * 0.71 + 14, rotate: true, max: maxWidth };
}

function bandLabels(g, labels, centers, y, space, theme, size = 10.5) {
  labels.forEach((l, i) => {
    const shown = fit(l, space.max, size);
    const tip = shown !== String(l) ? String(l) : null;
    if (space.rotate) g.append(text(centers[i] + 3, y + 10, shown, { size, fill: theme.muted, anchor: 'end', rotate: -45, tip }));
    else g.append(text(centers[i], y + 14, shown, { size, fill: theme.muted, anchor: 'middle', tip }));
  });
}

/** A legend of color swatches flowing in rows from (x, y) within `width`; returns the height it took. */
function legend(g, items, x, y, width, theme, { size = 11, title } = {}) {
  let cx = x;
  let cy = y;
  if (title) {
    g.append(text(x, y + 9, title, { size, fill: theme.muted, weight: 600 }));
    cx += textWidth(title, size, 600) + 12;
  }
  for (const it of items) {
    const label = fit(it.label, 220, size);
    const w = 16 + textWidth(label, size) + 16;
    if (cx + w > x + width && cx > x) { cx = x; cy += 18; }
    if (it.shape === 'line') g.append(line(cx, cy + 5.5, cx + 11, cy + 5.5, it.color, 2));
    else g.append(el('rect', { x: cx, y: cy, width: 11, height: 11, rx: 2, fill: it.color, opacity: it.opacity }));
    g.append(text(cx + 16, cy + 9.5, label, { size, fill: theme.text, tip: it.tip }));
    cx += w;
  }
  return cy - y + 18;
}

/** A horizontal color bar with its end labels; returns its height. */
function colorBar(g, x, y, width, colorAt, lo, hi, label, theme, id) {
  const gid = `ch-grad-${id}-${Math.random().toString(36).slice(2, 8)}`;
  const grad = el('linearGradient', { id: gid, x1: 0, y1: 0, x2: 1, y2: 0 });
  for (let k = 0; k <= 10; k += 1) grad.append(el('stop', { offset: k / 10, 'stop-color': colorAt(k / 10) }));
  g.append(el('defs', null, grad));
  if (label) g.append(text(x, y + 9, label, { size: 10.5, fill: theme.muted, weight: 600 }));
  const top = y + (label ? 15 : 0);
  g.append(el('rect', { x, y: top, width, height: 9, rx: 2, fill: `url(#${gid})` }));
  g.append(text(x, top + 21, lo, { size: 10, fill: theme.muted }));
  g.append(text(x + width, top + 21, hi, { size: 10, fill: theme.muted, anchor: 'end' }));
  return (label ? 15 : 0) + 26;
}

function titleOf(g, title, width, theme) {
  if (!title) return 0;
  g.append(text(0, 13, fit(title, width, 12.5, 600), { size: 12.5, fill: theme.text, weight: 600 }));
  return 24;
}

function empty(width, theme, message) {
  const s = root(width, 90, theme, message);
  s.append(text(width / 2, 48, message, { size: 12, fill: theme.muted, anchor: 'middle' }));
  return s;
}

// ------------------------------------------------------------------------------------------------ distributions
/**
 * Violins or boxes of several groups, one panel per measure (gene):
 * panels: [{title, lo, hi, groups: [{q: [min, p5, p25, p50, p75, p95, max], mean, density: [...], n, tip}]}],
 * groups: [{label, color}] (the same in every panel), mode: 'violin' | 'box', yLabel.
 */
export function distributions({ panels, groups, mode = 'violin', yLabel, width, theme }) {
  if (!panels.length || !groups.length) return empty(width, theme, 'Nothing to draw');
  const colors = colorsOf(groups, theme);
  const band = Math.max(26, Math.min(64, (width - 70) / groups.length));
  const panelW = Math.min(width, Math.max(190, 54 + band * groups.length));
  const cols = Math.max(1, Math.min(panels.length, Math.floor(width / panelW)));
  const rows = Math.ceil(panels.length / cols);
  const cellW = Math.floor(width / cols);
  const plotH = panels.length > 4 ? 150 : 190;
  const space = bandLabelSpace(groups.map((g) => g.label), Math.min(64, (cellW - 62) / groups.length), 10.5, 130);
  const labelRows = (r) => (panels.length <= cols || r === rows - 1 ? space.height : 6);
  let total = 0;
  const tops = [];
  for (let r = 0; r < rows; r += 1) { tops.push(total); total += 22 + plotH + labelRows(r) + 10; }
  const s = root(width, total + 30, theme, 'Distributions by group');
  panels.forEach((p, k) => {
    const r = Math.floor(k / cols);
    const c = k % cols;
    const g = el('g', { transform: `translate(${c * cellW}, ${tops[r]})` });
    const x0 = 50;
    const x1 = cellW - 12;
    const y0 = 22;
    const y1 = y0 + plotH;
    g.append(text(x0, 13, fit(p.title, x1 - x0, 12, 600), { size: 12, fill: theme.text, weight: 600 }));
    const lo = Number.isFinite(p.lo) ? p.lo : 0;
    const hi = Number.isFinite(p.hi) && p.hi > lo ? p.hi : lo + 1;
    const sy = leftAxis(g, { x0, x1, y0, y1, lo, hi, theme, n: 4, label: c === 0 ? yLabel : null });
    const [d0, d1] = sy.domain;
    const bw = (x1 - x0) / groups.length;
    const centers = groups.map((_, i) => x0 + bw * (i + 0.5));
    p.groups.forEach((d, i) => {
      if (!d || !d.n) return;
      const cx = centers[i];
      const half = Math.min(24, bw * 0.42);
      const color = colors[i];
      const q = d.q || [];
      const yv = (v) => sy(Math.min(d1, Math.max(d0, v)));
      if (mode === 'violin' && Array.isArray(d.density) && d.density.length) {
        const n = d.density.length;
        const peak = Math.max(...d.density) || 1;
        const pts = d.density.map((v, j) => [half * (v / peak), sy(lo + ((j + 0.5) / n) * (hi - lo))]);
        const right = pts.map(([w, y]) => `${(cx + w).toFixed(1)},${y.toFixed(1)}`);
        const left = pts.slice().reverse().map(([w, y]) => `${(cx - w).toFixed(1)},${y.toFixed(1)}`);
        g.append(el('path', {
          d: `M${cx},${sy(lo).toFixed(1)} L${right.join(' L')} L${cx},${sy(hi).toFixed(1)} L${left.join(' L')} Z`,
          fill: color, 'fill-opacity': 0.55, stroke: color, 'stroke-width': 1, 'data-tip': d.tip,
        }));
        if (q[2] !== null && q[2] !== undefined) {
          g.append(line(cx, yv(q[1]), cx, yv(q[5]), theme.text, 1, { 'shape-rendering': 'auto', opacity: 0.7 }));
          g.append(el('rect', { x: cx - 2.5, y: yv(q[4]), width: 5, height: Math.max(1, yv(q[2]) - yv(q[4])), fill: theme.text, opacity: 0.8, 'data-tip': d.tip }));
          g.append(el('circle', { cx, cy: yv(q[3]), r: 2.4, fill: theme.name === 'paper' ? '#ffffff' : '#0b0d11', stroke: theme.text, 'stroke-width': 1 }));
        }
      } else if (q[2] !== null && q[2] !== undefined) {
        const w = Math.min(half, 16);
        g.append(line(cx, yv(q[1]), cx, yv(q[5]), color, 1.2, { 'shape-rendering': 'auto' }));
        g.append(line(cx - w / 2, yv(q[1]), cx + w / 2, yv(q[1]), color, 1.2));
        g.append(line(cx - w / 2, yv(q[5]), cx + w / 2, yv(q[5]), color, 1.2));
        g.append(el('rect', { x: cx - w, y: yv(q[4]), width: 2 * w, height: Math.max(1, yv(q[2]) - yv(q[4])), fill: color, 'fill-opacity': 0.5, stroke: color, 'stroke-width': 1.2, 'data-tip': d.tip }));
        g.append(line(cx - w, yv(q[3]), cx + w, yv(q[3]), theme.text, 1.6));
        if (d.mean !== null && d.mean !== undefined) g.append(el('path', { d: `M${cx},${yv(d.mean) - 3.5} l3.5,3.5 l-3.5,3.5 l-3.5,-3.5 Z`, fill: theme.text }));
      }
    });
    g.append(line(x0, y1 + 0.5, x1, y1 + 0.5, theme.axis));
    if (labelRows(r) > 6) bandLabels(g, groups.map((x) => x.label), centers, y1, space, theme);
    s.append(g);
  });
  const lg = el('g', { transform: `translate(8, ${total + 6})` });
  const used = legend(lg, groups.map((g, i) => ({ label: g.label, color: colors[i] })), 0, 0, width - 16, theme);
  s.append(lg);
  s.setAttribute('height', total + 8 + used);
  s.setAttribute('viewBox', `0 0 ${s.getAttribute('width')} ${total + 8 + used}`);
  return s;
}

// ------------------------------------------------------------------------------------------------ dot plot and heatmap
/**
 * Dot plot: one row per gene, one column per group; the dot's area is `size` (0 to 100, % of bins detecting), its color
 * `color` (mean expression), on one scale or, with perRow, each row on its own.
 */
export function dotPlot({ rows, cols, size, color, perRow = false, sizeLabel = '% detecting', colorLabel = 'Mean expression', width, theme }) {
  if (!rows.length || !cols.length) return empty(width, theme, 'Nothing to draw');
  const left = Math.min(150, Math.max(40, ...rows.map((r) => textWidth(r, 11))) + 12);
  const cell = Math.max(18, Math.min(34, (width - left - 20) / cols.length));
  const space = bandLabelSpace(cols, cell, 10.5, 140);
  const gridW = cell * cols.length;
  const gridH = cell * rows.length;
  const s = root(width, gridH + space.height + 78, theme, 'Dot plot');
  const g = el('g', { transform: 'translate(0, 8)' });
  const flat = color.flat().filter((v) => Number.isFinite(v));
  const top = Math.max(1e-9, ...flat);
  const rMax = cell / 2 - 2;
  rows.forEach((r, i) => {
    const y = i * cell + cell / 2;
    g.append(text(left - 8, y, fit(r, left - 12, 11), { size: 11, fill: theme.text, anchor: 'end', baseline: 'middle' }));
    g.append(line(left, y + 0.5, left + gridW, y + 0.5, theme.grid));
    const rowTop = perRow ? Math.max(1e-9, ...color[i].filter((v) => Number.isFinite(v))) : top;
    cols.forEach((c, j) => {
      const pct = size[i][j];
      const v = color[i][j];
      if (!Number.isFinite(pct) || pct <= 0) return;
      g.append(el('circle', {
        cx: left + j * cell + cell / 2, cy: y, r: Math.max(1.2, rMax * Math.sqrt(pct / 100)).toFixed(2),
        fill: sequential(Number.isFinite(v) ? v / rowTop : 0, theme),
        'data-tip': `${r} · ${c}\n${sizeLabel}: ${num(pct, 1)}\n${colorLabel}: ${num(v)}`,
      }));
    });
  });
  bandLabels(g, cols, cols.map((_, j) => left + j * cell + cell / 2), gridH, space, theme);
  const ly = gridH + space.height + 10;
  let lx = left;
  g.append(text(lx, ly + 9, sizeLabel, { size: 10.5, fill: theme.muted, weight: 600 }));
  lx += textWidth(sizeLabel, 10.5, 600) + 12;
  for (const p of [25, 50, 100]) {
    const r = Math.max(1.2, rMax * Math.sqrt(p / 100));
    g.append(el('circle', { cx: lx + rMax, cy: ly + 6, r: r.toFixed(2), fill: theme.muted }));
    g.append(text(lx + 2 * rMax + 4, ly + 9.5, `${p}`, { size: 10, fill: theme.muted }));
    lx += 2 * rMax + 26;
  }
  colorBar(g, Math.min(lx + 18, width - 170), ly - 3, 150, (t) => sequential(t, theme), '0',
    perRow ? 'row maximum' : num(top), perRow ? `${colorLabel} (each row on its own scale)` : colorLabel, theme, 'dot');
  s.append(g);
  return s;
}

/**
 * Heatmap of values[row][col]: kind 'sequential' (0 or the minimum to the maximum) or 'diverging' (around 0), the
 * values written in the cells when they fit and `annotate` is on.
 */
export function heatmap({ rows, cols, values, kind = 'sequential', label, annotate = true, digits = 2, rowTitle, colTitle, tips, width, theme }) {
  if (!rows.length || !cols.length) return empty(width, theme, 'Nothing to draw');
  const left = Math.min(170, Math.max(40, ...rows.map((r) => textWidth(r, 11))) + 12 + (rowTitle ? 16 : 0));
  const cell = Math.max(16, Math.min(46, (width - left - 16) / cols.length));
  const cellH = Math.min(cell, 34);
  const space = bandLabelSpace(cols, cell, 10.5, 140);
  const gridH = cellH * rows.length;
  const s = root(width, gridH + space.height + (colTitle ? 16 : 0) + 62, theme, 'Heatmap');
  const g = el('g', { transform: 'translate(0, 6)' });
  const flat = values.flat().filter((v) => Number.isFinite(v));
  const hi = flat.length ? Math.max(...flat) : 1;
  const lo = flat.length ? Math.min(...flat) : 0;
  const amp = Math.max(Math.abs(hi), Math.abs(lo)) || 1;
  const base = kind === 'sequential' ? Math.min(0, lo) : 0;
  const colorOf = (v) => (!Number.isFinite(v) ? theme.neutral
    : kind === 'diverging' ? diverging(v / amp, theme) : sequential((v - base) / ((hi - base) || 1), theme));
  rows.forEach((r, i) => {
    g.append(text(left - 8, i * cellH + cellH / 2, fit(r, left - 14 - (rowTitle ? 16 : 0), 11), { size: 11, fill: theme.text, anchor: 'end', baseline: 'middle' }));
    cols.forEach((c, j) => {
      const v = values[i][j];
      const fill = colorOf(v);
      g.append(el('rect', {
        x: left + j * cell, y: i * cellH, width: cell - 1, height: cellH - 1, fill, rx: 1.5,
        'data-tip': tips ? tips(i, j) : `${r} · ${c}\n${label || 'Value'}: ${Number.isFinite(v) ? num(v) : 'not available'}`,
      }));
      if (annotate && cell >= 30 && cellH >= 16 && Number.isFinite(v)) {
        g.append(text(left + j * cell + (cell - 1) / 2, i * cellH + cellH / 2, num(v, digits), {
          size: 9.5, fill: inkOn(fill, theme), anchor: 'middle', baseline: 'middle',
        }));
      }
    });
  });
  if (rowTitle) g.append(text(10, gridH / 2, rowTitle, { size: 10.5, fill: theme.muted, anchor: 'middle', rotate: -90 }));
  bandLabels(g, cols, cols.map((_, j) => left + j * cell + cell / 2), gridH, space, theme);
  let y = gridH + space.height + 4;
  if (colTitle) {
    g.append(text(left + (cell * cols.length) / 2, y + 8, colTitle, { size: 10.5, fill: theme.muted, anchor: 'middle' }));
    y += 16;
  }
  if (kind === 'diverging') colorBar(g, left, y, 170, (t) => diverging(2 * t - 1, theme), num(-amp, digits), num(amp, digits), label, theme, 'heat');
  else colorBar(g, left, y, 170, (t) => sequential(t, theme), num(base, digits), num(hi, digits), label, theme, 'heat');
  s.append(g);
  return s;
}

// ------------------------------------------------------------------------------------------------ bars
/**
 * Bars of several series over categories: stacked (shares that add up) or side by side, with error bars when a series
 * has lo and hi. categories: [labels]; series: [{label, color, values, lo, hi, tips}].
 */
export function bars({ categories, series, stacked = false, yLabel, max, width, theme, title }) {
  if (!categories.length || !series.length) return empty(width, theme, 'Nothing to draw');
  const colors = colorsOf(series, theme);
  const x0 = 54;
  const x1 = width - 12;
  const band = (x1 - x0) / categories.length;
  const space = bandLabelSpace(categories, band, 10.5, 150);
  const s = root(width, 0, theme, title || 'Bar chart');
  const g = el('g');
  const y0 = 8 + titleOf(g, title, width, theme);
  const plotH = 220;
  const y1 = y0 + plotH;
  let top = Number.isFinite(max) ? max : 0;
  if (!Number.isFinite(max)) {
    categories.forEach((_, i) => {
      const vals = series.map((sr) => Math.max(sr.values[i] || 0, (sr.hi && sr.hi[i]) || 0));
      top = Math.max(top, stacked ? series.reduce((a, sr) => a + (sr.values[i] || 0), 0) : Math.max(...vals));
    });
  }
  const sy = leftAxis(g, { x0, x1, y0, y1, lo: 0, hi: top || 1, label: yLabel, theme });
  const inner = Math.min(band * 0.8, stacked ? 96 : 28 * series.length);
  categories.forEach((c, i) => {
    const left = x0 + band * i + (band - inner) / 2;
    let acc = 0;
    series.forEach((sr, k) => {
      const v = sr.values[i];
      if (!Number.isFinite(v)) return;
      const tip = sr.tips ? sr.tips[i] : `${c} · ${sr.label}\n${num(v)}`;
      if (stacked) {
        const ya = sy(acc + v);
        g.append(el('rect', { x: left, y: ya, width: inner, height: Math.max(0, sy(acc) - ya), fill: colors[k], 'data-tip': tip }));
        acc += v;
        return;
      }
      const w = inner / series.length;
      const x = left + k * w;
      g.append(el('rect', { x: x + 0.5, y: sy(v), width: Math.max(1, w - 1), height: Math.max(0, sy(0) - sy(v)), fill: colors[k], rx: 1, 'data-tip': tip }));
      if (sr.lo && sr.hi && Number.isFinite(sr.lo[i]) && Number.isFinite(sr.hi[i])) {
        const cx = x + w / 2;
        g.append(line(cx, sy(sr.lo[i]), cx, sy(sr.hi[i]), theme.text, 1, { 'shape-rendering': 'auto' }));
        g.append(line(cx - 3, sy(sr.lo[i]), cx + 3, sy(sr.lo[i]), theme.text));
        g.append(line(cx - 3, sy(sr.hi[i]), cx + 3, sy(sr.hi[i]), theme.text));
      }
    });
  });
  g.append(line(x0, y1 + 0.5, x1, y1 + 0.5, theme.axis));
  bandLabels(g, categories, categories.map((_, i) => x0 + band * (i + 0.5)), y1, space, theme);
  let height = y1 + space.height + 8;
  if (series.length > 1 || series[0].label) {
    const lg = el('g', { transform: `translate(${x0}, ${height})` });
    height += legend(lg, series.map((sr, k) => ({ label: sr.label, color: colors[k] })), 0, 0, x1 - x0, theme);
    g.append(lg);
  }
  s.append(g);
  s.setAttribute('height', height + 6);
  s.setAttribute('viewBox', `0 0 ${s.getAttribute('width')} ${height + 6}`);
  return s;
}

/** Horizontal bars of ranked items: [{label, value, color, tip}], from a zero line (values may be negative). */
export function rankedBars({ items, xLabel, width, theme, title }) {
  if (!items.length) return empty(width, theme, 'Nothing to draw');
  const left = Math.min(170, Math.max(40, ...items.map((it) => textWidth(it.label, 11))) + 12);
  const rowH = items.length > 30 ? 15 : 18;
  const s = root(width, 0, theme, title || 'Ranked values');
  const g = el('g');
  const y0 = 6 + titleOf(g, title, width, theme);
  const x0 = left;
  const x1 = width - 48;
  const vals = items.map((it) => it.value).filter(Number.isFinite);
  const t = ticksOf(Math.min(0, ...vals), Math.max(0, ...vals), 5);
  const y1 = y0 + rowH * items.length;
  const sx = bottomAxis(g, { x0, x1, y: y1 + 2, y0, lo: t.lo, hi: t.hi, ticks: t, label: xLabel, theme, grid: true });
  items.forEach((it, i) => {
    const y = y0 + i * rowH;
    g.append(text(left - 8, y + rowH / 2, fit(it.label, left - 12, 11), { size: 11, fill: theme.text, anchor: 'end', baseline: 'middle', tip: it.tip }));
    if (!Number.isFinite(it.value)) return;
    const a = sx(Math.min(0, it.value));
    const b = sx(Math.max(0, it.value));
    g.append(el('rect', { x: a, y: y + 2, width: Math.max(1, b - a), height: rowH - 4, rx: 1.5, fill: it.color || theme.accent, 'data-tip': it.tip }));
    g.append(text(it.value < 0 ? a - 4 : b + 4, y + rowH / 2, num(it.value), { size: 10, fill: theme.muted, anchor: it.value < 0 ? 'end' : 'start', baseline: 'middle' }));
  });
  g.append(line(sx(0) + 0.5, y0, sx(0) + 0.5, y1 + 2, theme.axis));
  s.append(g);
  const height = y1 + (xLabel ? 44 : 26);
  s.setAttribute('height', height);
  s.setAttribute('viewBox', `0 0 ${s.getAttribute('width')} ${height}`);
  return s;
}

// ------------------------------------------------------------------------------------------------ volcano and scatter
/**
 * Volcano plot: x = effect (log2 fold change), y = -log10(P). points: {x: [], p: [], label: [], fdr: []}; a point is
 * colored when fdr <= maxFdr and |x| >= minEffect; the `nLabels` most significant colored points are named.
 * tip(i) gives the tooltip of point i.
 */
export function volcano({ points, maxFdr = 0.05, minEffect = 1, nLabels = 12, xLabel, yLabel = '−log10(P)', aLabel, bLabel, tip, width, theme }) {
  const n = points.x.length;
  if (!n) return empty(width, theme, 'No gene was tested');
  const x0 = 54;
  const x1 = width - 14;
  const y0 = 26;
  const height = Math.max(300, Math.min(440, width * 0.52));
  const y1 = y0 + height;
  const s = root(width, y1 + 66, theme, 'Volcano plot');
  const g = el('g');
  const finiteP = points.p.filter((p) => Number.isFinite(p) && p > 0);
  const floor = finiteP.length ? Math.min(...finiteP) : 1e-300;
  const ys = points.p.map((p) => (Number.isFinite(p) ? -Math.log10(Math.max(p, floor / 10)) : 0));
  const xs = points.x.map((v) => (Number.isFinite(v) ? v : 0));
  const xm = Math.max(1.2 * minEffect, ...xs.map(Math.abs)) * 1.04;
  const sy = leftAxis(g, { x0, x1, y0, y1, lo: 0, hi: Math.max(2, ...ys) * 1.04, label: yLabel, theme });
  const sx = bottomAxis(g, { x0, x1, y: y1, y0, lo: -xm, hi: xm, label: xLabel, theme, ticks: ticksOf(-xm, xm, 6, false) });
  for (const v of [-minEffect, minEffect]) g.append(line(sx(v), y0, sx(v), y1, theme.axis, 1, { 'stroke-dasharray': '3 3' }));
  const kinds = new Array(n);
  const dots = el('g');
  const order = [];
  for (let i = 0; i < n; i += 1) {
    const sig = Number.isFinite(points.fdr[i]) && points.fdr[i] <= maxFdr && Math.abs(xs[i]) >= minEffect;
    kinds[i] = sig ? (xs[i] > 0 ? 1 : -1) : 0;
    order.push(i);
  }
  order.sort((a, b) => Math.abs(kinds[a]) - Math.abs(kinds[b]));   // the colored points on top
  for (const i of order) {
    dots.append(el('circle', {
      cx: sx(xs[i]).toFixed(1), cy: sy(ys[i]).toFixed(1), r: kinds[i] ? 2.6 : 1.8,
      fill: kinds[i] > 0 ? UP : kinds[i] < 0 ? DOWN : theme.neutral, 'fill-opacity': kinds[i] ? 0.9 : 0.7, 'data-i': i,
    }));
  }
  g.append(dots);
  // names of the most significant colored genes, kept apart from each other
  const named = order.filter((i) => kinds[i]).sort((a, b) => ys[b] - ys[a] || Math.abs(xs[b]) - Math.abs(xs[a])).slice(0, nLabels);
  const boxes = [];
  for (const i of named) {
    const label = String(points.label[i]);
    const w = textWidth(label, 10.5) + 4;
    const right = xs[i] >= 0;
    let bx = sx(xs[i]) + (right ? 5 : -5 - w);
    bx = Math.max(x0 + 2, Math.min(x1 - w, bx));
    let by = sy(ys[i]) - 5;
    for (let tries = 0; tries < 14 && boxes.some((b) => bx < b.x + b.w && bx + w > b.x && by < b.y + 12 && by + 12 > b.y); tries += 1) by -= 12;
    if (by < y0) continue;
    boxes.push({ x: bx, y: by, w });
    g.append(text(bx + 2, by + 9, label, { size: 10.5, fill: theme.text }));
  }
  const up = kinds.filter((k) => k > 0).length;
  const down = kinds.filter((k) => k < 0).length;
  g.append(text(x1, 14, `${up.toLocaleString()} higher${aLabel ? ` in ${fit(aLabel, 220, 11)}` : ''}`, { size: 11, fill: UP, anchor: 'end', weight: 600 }));
  g.append(text(x0, 14, `${down.toLocaleString()} higher${bLabel ? ` in ${fit(bLabel, 220, 11)}` : ''}`, { size: 11, fill: DOWN, weight: 600 }));
  g.append(text(x0, y1 + 56, `Colored: FDR ≤ ${maxFdr} and |${xLabel || 'effect'}| ≥ ${minEffect}; ${n.toLocaleString()} genes`, { size: 10.5, fill: theme.faint }));
  s.append(g);
  s.chartTip = (target) => {
    const i = target && target.dataset ? target.dataset.i : undefined;
    return i === undefined || !tip ? null : tip(Number(i));
  };
  return s;
}

/**
 * Points, a line or bars of two columns: x (numbers or texts), y (numbers), an optional color column (texts: one color
 * per value; numbers: a color scale) and labels for the tooltips.
 */
export function xyChart({ x, y, color, labels, kind = 'points', xLabel, yLabel, colorLabel, width, theme }) {
  const idx = y.map((v, i) => i).filter((i) => Number.isFinite(y[i]) && x[i] !== null && x[i] !== undefined);
  if (!idx.length) return empty(width, theme, 'No row has both values');
  const numericX = idx.every((i) => typeof x[i] === 'number');
  const x0 = 58;
  const x1 = width - 14;
  const y0 = 10;
  const plotH = Math.max(260, Math.min(380, width * 0.45));
  const y1 = y0 + plotH;
  const s = root(width, 0, theme, 'Chart');
  const g = el('g');
  const ys = idx.map((i) => y[i]);
  const sy = leftAxis(g, { x0, x1, y0, y1, lo: Math.min(kind === 'bars' ? 0 : Infinity, ...ys), hi: Math.max(kind === 'bars' ? 0 : -Infinity, ...ys), label: yLabel, theme });
  let fillOf = () => theme.accent;
  let legendItems = null;
  let numericColor = null;
  if (color) {
    const vals = idx.map((i) => color[i]);
    if (vals.every((v) => v === null || typeof v === 'number')) {
      const fin = vals.filter(Number.isFinite);
      const lo = Math.min(...fin);
      const hi = Math.max(...fin);
      numericColor = { lo, hi };
      fillOf = (i) => (Number.isFinite(color[i]) ? sequential((color[i] - lo) / ((hi - lo) || 1), theme) : theme.neutral);
    } else {
      const names = [...new Set(vals.map((v) => String(v)))].slice(0, 40);
      const cols = colorsOf(names.map((k) => ({ key: k, label: k })), theme);
      const at = new Map(names.map((k, j) => [k, cols[j]]));
      fillOf = (i) => at.get(String(color[i])) || theme.neutral;
      legendItems = names.map((k, j) => ({ label: k, color: cols[j] }));
    }
  }
  const tipOf = (i) => [labels ? labels[i] : null, `${xLabel || 'x'}: ${typeof x[i] === 'number' ? num(x[i]) : x[i]}`,
    `${yLabel || 'y'}: ${num(y[i])}`, color ? `${colorLabel || 'color'}: ${typeof color[i] === 'number' ? num(color[i]) : color[i]}` : null]
    .filter((v) => v !== null && v !== undefined && v !== '').join('\n');
  let bottom = y1 + 40;
  if (numericX && kind !== 'bars') {
    const xs = idx.map((i) => x[i]);
    const sx = bottomAxis(g, { x0, x1, y: y1, y0, lo: Math.min(...xs), hi: Math.max(...xs), label: xLabel, theme });
    if (kind === 'line') {
      const sorted = idx.slice().sort((a, b) => x[a] - x[b]);
      g.append(el('path', { d: `M${sorted.map((i) => `${sx(x[i]).toFixed(1)},${sy(y[i]).toFixed(1)}`).join(' L')}`, fill: 'none', stroke: theme.accent, 'stroke-width': 1.6 }));
    }
    const r = idx.length > 3000 ? 1.6 : idx.length > 400 ? 2.2 : 3;
    for (const i of idx) {
      g.append(el('circle', { cx: sx(x[i]).toFixed(1), cy: sy(y[i]).toFixed(1), r, fill: fillOf(i), 'fill-opacity': 0.85, 'data-tip': tipOf(i) }));
    }
  } else {
    const shown = idx.slice(0, 200);
    const band = (x1 - x0) / shown.length;
    const names = shown.map((i) => String(x[i]));
    const space = bandLabelSpace(names, band, 10.5, 140);
    const centers = shown.map((_, k) => x0 + band * (k + 0.5));
    g.append(line(x0, y1 + 0.5, x1, y1 + 0.5, theme.axis));
    if (kind === 'line') {
      g.append(el('path', { d: `M${shown.map((i, k) => `${centers[k].toFixed(1)},${sy(y[i]).toFixed(1)}`).join(' L')}`, fill: 'none', stroke: theme.accent, 'stroke-width': 1.6 }));
    }
    shown.forEach((i, k) => {
      if (kind === 'bars') {
        const a = sy(Math.max(0, y[i]));
        const b = sy(Math.min(0, y[i]));
        const w = Math.max(1, Math.min(42, band * 0.78));
        g.append(el('rect', { x: centers[k] - w / 2, y: a, width: w, height: Math.max(1, b - a), fill: fillOf(i), rx: 1, 'data-tip': tipOf(i) }));
      } else {
        g.append(el('circle', { cx: centers[k], cy: sy(y[i]), r: 3, fill: fillOf(i), 'data-tip': tipOf(i) }));
      }
    });
    if (band >= 9) bandLabels(g, names, centers, y1, space, theme);
    bottom = y1 + (band >= 9 ? space.height : 8) + (xLabel ? 20 : 4);
    if (xLabel) g.append(text((x0 + x1) / 2, bottom - 6, xLabel, { size: 11, fill: theme.muted, anchor: 'middle' }));
    if (idx.length > shown.length) {
      g.append(text(x1, y0 + 10, `the first ${shown.length} of ${idx.length.toLocaleString()} rows`, { size: 10.5, fill: theme.faint, anchor: 'end' }));
    }
  }
  if (legendItems) {
    const lg = el('g', { transform: `translate(${x0}, ${bottom})` });
    bottom += legend(lg, legendItems, 0, 0, x1 - x0, theme, { title: colorLabel });
    g.append(lg);
  } else if (numericColor) {
    bottom += colorBar(g, x0, bottom, 170, (t) => sequential(t, theme), num(numericColor.lo), num(numericColor.hi), colorLabel, theme, 'xy');
  }
  s.append(g);
  s.setAttribute('height', bottom + 6);
  s.setAttribute('viewBox', `0 0 ${s.getAttribute('width')} ${bottom + 6}`);
  return s;
}

/** Joint distribution of two measures on a grid of counts (grid[ix][iy]), colored on a log scale. */
export function density2d({ grid, maxX, maxY, xLabel, yLabel, width, theme }) {
  const n = grid.length;
  if (!n) return empty(width, theme, 'Nothing to draw');
  const side = Math.max(220, Math.min(380, width - 120));
  const x0 = 58;
  const y0 = 10;
  const x1 = x0 + side;
  const y1 = y0 + side;
  const s = root(width, y1 + 84, theme, 'Joint distribution');
  const g = el('g');
  const top = Math.max(1, ...grid.flat());
  const sy = leftAxis(g, { x0, x1, y0, y1, lo: 0, hi: maxY || 1, label: yLabel, theme, ticks: ticksOf(0, maxY || 1, 5, false) });
  const sx = bottomAxis(g, { x0, x1, y: y1, y0, lo: 0, hi: maxX || 1, label: xLabel, theme, ticks: ticksOf(0, maxX || 1, 5, false) });
  const cw = side / n;
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < grid[i].length; j += 1) {
      const c = grid[i][j];
      if (!c) continue;
      g.append(el('rect', {
        x: (x0 + i * cw).toFixed(1), y: (y1 - (j + 1) * cw).toFixed(1), width: (cw + 0.3).toFixed(1), height: (cw + 0.3).toFixed(1),
        fill: sequential(Math.log1p(c) / Math.log1p(top), theme),
        'data-tip': `${xLabel}: ${num((i / n) * maxX, 2)}–${num(((i + 1) / n) * maxX, 2)}\n${yLabel}: ${num((j / n) * maxY, 2)}–${num(((j + 1) / n) * maxY, 2)}\n${c.toLocaleString()} bins`,
      }));
    }
  }
  void sx; void sy;
  colorBar(g, x0, y1 + 40, 170, (t) => sequential(t, theme), '1', top.toLocaleString(), 'Bins (log scale)', theme, 'd2');
  s.append(g);
  return s;
}

// ------------------------------------------------------------------------------------------------ distances
/** Histograms of observed distances with the null's as a line, one panel per section: [{title, edges, observed, null}]. */
export function histograms({ panels, xLabel, yLabel = 'Bins', width, theme }) {
  if (!panels.length) return empty(width, theme, 'Nothing to draw');
  const cols = Math.max(1, Math.min(panels.length, Math.floor(width / 300)));
  const cellW = Math.floor(width / cols);
  const plotH = 170;
  const rowH = plotH + 74;
  const rows = Math.ceil(panels.length / cols);
  const s = root(width, rows * rowH + 24, theme, 'Distance distributions');
  panels.forEach((p, k) => {
    const g = el('g', { transform: `translate(${(k % cols) * cellW}, ${Math.floor(k / cols) * rowH})` });
    const x0 = 50;
    const x1 = cellW - 12;
    const y0 = 24;
    const y1 = y0 + plotH;
    g.append(text(x0, 14, fit(p.title, x1 - x0, 12, 600), { size: 12, fill: theme.text, weight: 600 }));
    const top = Math.max(1, ...p.observed, ...(p.null || []));
    const sy = leftAxis(g, { x0, x1, y0, y1, lo: 0, hi: top, theme, n: 4, label: k % cols === 0 ? yLabel : null });
    const lo = p.edges[0];
    const hi = p.edges[p.edges.length - 1];
    const sx = bottomAxis(g, { x0, x1, y: y1, y0, lo, hi, label: xLabel, theme, ticks: ticksOf(lo, hi, 5, false) });
    p.observed.forEach((c, i) => {
      if (!c) return;
      const a = sx(p.edges[i]);
      const b = sx(p.edges[i + 1]);
      g.append(el('rect', {
        x: a + 0.5, y: sy(c), width: Math.max(1, b - a - 1), height: sy(0) - sy(c), fill: theme.accent, 'fill-opacity': 0.75,
        'data-tip': `${num(p.edges[i], 1)}–${num(p.edges[i + 1], 1)} µm\nobserved: ${c.toLocaleString()}${p.null ? `\nrandom placement: ${num(p.null[i], 1)}` : ''}`,
      }));
    });
    if (p.null) {
      let d = '';
      p.null.forEach((c, i) => {
        const a = sx(p.edges[i]).toFixed(1);
        const b = sx(p.edges[i + 1]).toFixed(1);
        d += `${i ? ' L' : 'M'}${a},${sy(c).toFixed(1)} L${b},${sy(c).toFixed(1)}`;
      });
      g.append(el('path', { d, fill: 'none', stroke: UP, 'stroke-width': 1.6 }));
    }
    s.append(g);
  });
  const lg = el('g', { transform: `translate(50, ${rows * rowH})` });
  legend(lg, [{ label: 'Observed', color: theme.accent, opacity: 0.75 },
    ...(panels.some((p) => p.null) ? [{ label: 'Random placement (mean of the draws)', color: UP, shape: 'line' }] : [])], 0, 0, width - 60, theme);
  s.append(lg);
  return s;
}

/** Values with an interval against a reference line, one row each: [{label, value, lo, hi, note}] (a log axis). */
export function forest({ rows, reference = 1, xLabel, width, theme }) {
  const ok = rows.filter((r) => Number.isFinite(r.value) && r.value > 0);
  if (!ok.length) return empty(width, theme, 'No section could be estimated');
  const left = Math.min(180, Math.max(50, ...rows.map((r) => textWidth(r.label, 11))) + 14);
  const x0 = left;
  const x1 = width - 150;
  const rowH = 30;
  const y0 = 10;
  const y1 = y0 + rowH * rows.length;
  const s = root(width, y1 + 44, theme, 'Observed over null');
  const g = el('g');
  const all = ok.flatMap((r) => [r.value, r.lo, r.hi]).filter((v) => Number.isFinite(v) && v > 0).concat([reference]);
  const span = Math.max(Math.log2(Math.max(...all) / reference), Math.log2(reference / Math.min(...all)), 0.3) * 1.15;
  const sx = scale(-span, span, x0, x1);
  const xv = (v) => sx(Math.log2(v / reference));
  g.append(line(x0, y1 + 0.5, x1, y1 + 0.5, theme.axis));
  const marks = [reference / 2 ** Math.ceil(span), reference];
  for (let e = -Math.floor(span); e <= Math.floor(span); e += 1) marks.push(reference * 2 ** e);
  if (span < 1) marks.push(reference * 2 ** -0.5, reference * 2 ** 0.5, reference * 2 ** -0.25, reference * 2 ** 0.25);
  for (const v of [...new Set(marks)]) {
    const x = xv(v);
    if (x < x0 - 0.5 || x > x1 + 0.5) continue;
    g.append(line(x, y0, x, y1, v === reference ? theme.axis : theme.grid, 1, v === reference ? { 'stroke-dasharray': '3 3' } : undefined));
    g.append(text(x, y1 + 15, num(v, 2), { size: 10.5, fill: theme.muted, anchor: 'middle' }));
  }
  if (xLabel) g.append(text((x0 + x1) / 2, y1 + 32, xLabel, { size: 11, fill: theme.muted, anchor: 'middle' }));
  rows.forEach((r, i) => {
    const y = y0 + i * rowH + rowH / 2;
    g.append(text(left - 10, y, fit(r.label, left - 14, 11), { size: 11, fill: theme.text, anchor: 'end', baseline: 'middle' }));
    if (!Number.isFinite(r.value) || r.value <= 0) {
      g.append(text(x0 + 6, y, r.note || 'not estimable', { size: 10.5, fill: theme.faint, baseline: 'middle' }));
      return;
    }
    const color = r.value < reference ? DOWN : UP;
    if (Number.isFinite(r.lo) && Number.isFinite(r.hi)) g.append(line(xv(r.lo), y, xv(r.hi), y, color, 2, { 'shape-rendering': 'auto' }));
    g.append(el('circle', { cx: xv(r.value), cy: y, r: 4.5, fill: color, 'data-tip': r.tip }));
    g.append(text(x1 + 10, y, r.note || num(r.value, 2), { size: 10.5, fill: theme.muted, baseline: 'middle' }));
  });
  s.append(g);
  return s;
}

// ------------------------------------------------------------------------------------------------ maps
/**
 * Spacing of points (µm): the median distance from up to 300 of them to their nearest neighbour (cells and spots,
 * whose size is not a bin size). 16 when there are fewer than two points.
 */
export function pointPitch(x, y) {
  const idx = [];
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  for (let i = 0; i < x.length; i += 1) {
    const a = x[i];
    const b = y[i];
    if (a === null || b === null || !Number.isFinite(a) || !Number.isFinite(b)) continue;
    idx.push(i);
    if (a < minX) minX = a;
    if (a > maxX) maxX = a;
    if (b < minY) minY = b;
    if (b > maxY) maxY = b;
  }
  if (idx.length < 2) return 16;
  const cell = Math.sqrt(Math.max(1e-9, (maxX - minX) * (maxY - minY)) / idx.length) * 2 || 1;
  const keyOf = (cx, cy) => `${cx},${cy}`;
  const grid = new Map();
  for (const i of idx) {
    const k = keyOf(Math.floor((x[i] - minX) / cell), Math.floor((y[i] - minY) / cell));
    const list = grid.get(k);
    if (list) list.push(i); else grid.set(k, [i]);
  }
  const step = Math.max(1, Math.floor(idx.length / 300));
  const dist = [];
  for (let s = 0; s < idx.length; s += step) {
    const i = idx[s];
    const cx = Math.floor((x[i] - minX) / cell);
    const cy = Math.floor((y[i] - minY) / cell);
    let best = Infinity;
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (const j of grid.get(keyOf(cx + dx, cy + dy)) || []) {
          const d = Math.hypot(x[j] - x[i], y[j] - y[i]);
          if (d > 0 && d < best) best = d;
        }
      }
    }
    if (Number.isFinite(best)) dist.push(best);
  }
  dist.sort((a, b) => a - b);
  return dist.length ? dist[dist.length >> 1] : cell / 2;
}

/**
 * The bins of a section on a canvas, colored by a value: {x, y, values (null: no value), binUm, lo, hi, title}; the
 * canvas is `width` wide and as high as the section's shape asks (at most maxHeight). diverging: a scale around 0.
 */
export function spatialMap({ x, y, values, binUm, lo, hi, width, maxHeight = 420, theme, isDiverging = false }) {
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  for (let i = 0; i < x.length; i += 1) {
    if (x[i] === null || y[i] === null) continue;
    if (x[i] < minX) minX = x[i];
    if (x[i] > maxX) maxX = x[i];
    if (y[i] < minY) minY = y[i];
    if (y[i] > maxY) maxY = y[i];
  }
  const pitch = Number.isFinite(binUm) && binUm > 0 ? binUm : pointPitch(x, y);  // cells and spots: their spacing
  const spanX = Math.max(pitch, maxX - minX + pitch);
  const spanY = Math.max(pitch, maxY - minY + pitch);
  const k = Math.min(width / spanX, maxHeight / spanY);
  const w = Math.max(40, Math.round(spanX * k));
  const hgt = Math.max(40, Math.round(spanY * k));
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const canvas = h('canvas', { class: 'ch-map', width: Math.round(w * ratio), height: Math.round(hgt * ratio), style: { width: `${w}px`, height: `${hgt}px` } });
  const ctx = canvas.getContext('2d');
  ctx.scale(ratio, ratio);
  if (theme.bg && theme.bg !== 'none') { ctx.fillStyle = theme.bg; ctx.fillRect(0, 0, w, hgt); }
  const side = Math.max(1, pitch * k);
  const amp = Math.max(Math.abs(lo), Math.abs(hi)) || 1;
  const LEVELS = 48;
  const lut = Array.from({ length: LEVELS }, (_, j) => (isDiverging ? diverging((2 * j) / (LEVELS - 1) - 1, theme) : sequential(j / (LEVELS - 1), theme)));
  const buckets = Array.from({ length: LEVELS + 1 }, () => []);
  for (let i = 0; i < x.length; i += 1) {
    if (x[i] === null || y[i] === null) continue;
    const v = values[i];
    let b = LEVELS;
    if (v !== null && v !== undefined && Number.isFinite(v)) {
      const t = isDiverging ? (v / amp + 1) / 2 : (v - lo) / ((hi - lo) || 1);
      b = Math.max(0, Math.min(LEVELS - 1, Math.round(t * (LEVELS - 1))));
    }
    buckets[b].push(i);
  }
  const draw = (list, color) => {
    ctx.fillStyle = color;
    for (const i of list) ctx.fillRect((x[i] - minX) * k, (y[i] - minY) * k, side, side);
  };
  draw(buckets[LEVELS], theme.neutral);
  for (let b = 0; b < LEVELS; b += 1) if (buckets[b].length) draw(buckets[b], lut[b]);
  return canvas;
}

// ------------------------------------------------------------------------------------------------ tooltips and export
/**
 * One tooltip for the charts inside `host`: a mark with data-tip shows that text (lines split at \n); a chart with a
 * chartTip(target) function is asked for the text of the mark under the pointer. Returns a function that removes it.
 */
export function attachTips(host) {
  const tip = h('div', { class: 'ch-tip', hidden: true, role: 'tooltip' });
  document.body.append(tip);
  const hide = () => { tip.hidden = true; };
  const move = (e) => {
    const target = e.target instanceof Element ? e.target : null;
    let textOf = target ? target.getAttribute('data-tip') : null;
    if (!textOf && target) {
      const chart = target.closest('svg.ch');
      if (chart && typeof chart.chartTip === 'function') textOf = chart.chartTip(target);
    }
    if (!textOf) { hide(); return; }
    if (tip.dataset.text !== textOf) {
      tip.dataset.text = textOf;
      tip.replaceChildren(...textOf.split('\n').map((l, i) => h('div', { class: i ? null : 'ch-tip-head' }, l)));
    }
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    let left = e.clientX + 14;
    let top = e.clientY + 14;
    if (left + r.width > window.innerWidth - 8) left = e.clientX - r.width - 12;
    if (top + r.height > window.innerHeight - 8) top = e.clientY - r.height - 12;
    tip.style.left = `${Math.max(8, left)}px`;
    tip.style.top = `${Math.max(8, top)}px`;
  };
  host.addEventListener('pointermove', move);
  host.addEventListener('pointerleave', hide);
  window.addEventListener('scroll', hide, true);
  return () => {
    host.removeEventListener('pointermove', move);
    host.removeEventListener('pointerleave', hide);
    window.removeEventListener('scroll', hide, true);
    tip.remove();
  };
}

function save(blob, name) {
  const href = URL.createObjectURL(blob);
  const a = h('a', { href, download: name, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 60000);
}

/** The text of an SVG file of a chart drawn on paper. */
export function svgText(svgEl) {
  const clone = svgEl.cloneNode(true);
  clone.removeAttribute('class');
  for (const node of clone.querySelectorAll('[data-tip], [data-i]')) { node.removeAttribute('data-tip'); node.removeAttribute('data-i'); }
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}\n`;
}

export function exportSvg(svgEl, name) {
  save(new Blob([svgText(svgEl)], { type: 'image/svg+xml' }), name);
}

/** A PNG of an SVG chart (drawn `scale` times its size) or of a canvas. */
export async function exportPng(node, name, scale = 2) {
  let canvas = node;
  if (!(node instanceof HTMLCanvasElement)) {
    const w = Number(node.getAttribute('width'));
    const hgt = Number(node.getAttribute('height'));
    const url = URL.createObjectURL(new Blob([svgText(node)], { type: 'image/svg+xml' }));
    try {
      const img = new Image();
      await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error('the chart could not be drawn as an image')); img.src = url; });
      canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(hgt * scale);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('the image could not be written');
  save(blob, name);
}

export { formatNumber };
