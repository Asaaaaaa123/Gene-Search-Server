/**
 * Chart tokens for the IVCCA workspace. Categorical slots are the validated
 * reference palette (fixed order — never cycled); scatter plots with more than
 * three clusters add marker symbols as the secondary encoding.
 */
export const SERIES = [
  '#2a78d6',
  '#eb6834',
  '#1baf7a',
  '#eda100',
  '#e87ba4',
  '#008300',
  '#4a3aa7',
  '#e34948',
] as const;

export const SYMBOLS_2D = ['circle', 'square', 'diamond', 'triangle-up', 'x', 'cross', 'star', 'hexagon'] as const;
export const SYMBOLS_3D = ['circle', 'square', 'diamond', 'cross', 'x', 'circle-open', 'square-open', 'diamond-open'] as const;

export const INK = {
  primary: '#0b0b0b',
  secondary: '#52514e',
  muted: '#898781',
  grid: '#e1e0d9',
  axis: '#c3c2b7',
  surface: '#ffffff',
  other: '#b4b2aa',
} as const;

/** Colour for cluster `id` (1-based). Clusters beyond 8 fold onto a neutral "other" tone. */
export function clusterColor(id: number) {
  return id >= 1 && id <= SERIES.length ? SERIES[id - 1] : INK.other;
}

const BLUE = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];
const RED = ['#fbd6d2', '#f5aea7', '#ee837a', '#e34948', '#bd3232', '#932323', '#6a1616'];
const MID = '#f0efec';

type Scale = Array<[number, string]>;

function ramp(steps: string[], from = '#fbfbfa'): Scale {
  const all = [from, ...steps];
  return all.map((c, i) => [i / (all.length - 1), c]);
}

function diverging(neg: string[], pos: string[]): Scale {
  const left = [...neg].reverse();
  const stops = [...left, MID, ...pos];
  return stops.map((c, i) => [i / (stops.length - 1), c]);
}

export type PaletteId = 'blue-red' | 'purple-green' | 'blues' | 'reds' | 'heat' | 'viridis';

export const PALETTES: Record<PaletteId, { label: string; kind: 'diverging' | 'sequential'; scale: Scale | string }> = {
  'blue-red': { label: 'Blue – red', kind: 'diverging', scale: diverging(BLUE.slice(0, 6), RED.slice(0, 6)) },
  'purple-green': {
    label: 'Purple – green',
    kind: 'diverging',
    scale: diverging(
      ['#e7d4e8', '#c2a5cf', '#9970ab', '#762a83', '#5a1a66', '#40004b'],
      ['#d9f0d3', '#a6dba0', '#5aae61', '#1b7837', '#105a28', '#00441b'],
    ),
  },
  blues: { label: 'Blue', kind: 'sequential', scale: ramp(BLUE) },
  reds: { label: 'Red', kind: 'sequential', scale: ramp(RED) },
  // Semantic heat ramp matching the classic IVCCA sorted heatmap (white → yellow → red)
  heat: {
    label: 'Heat (classic)',
    kind: 'sequential',
    scale: [
      [0, '#ffffff'],
      [0.2, '#fff3b0'],
      [0.4, '#fdc35a'],
      [0.6, '#f5813a'],
      [0.8, '#d7301f'],
      [1, '#7f0000'],
    ],
  },
  viridis: { label: 'Viridis', kind: 'sequential', scale: 'Viridis' },
};

export const FONT_FAMILY =
  'var(--font-geist-sans), ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';

/** Shared Plotly layout: recessive hairline chrome, text in ink tokens. */
export function baseLayout(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const axis = {
    gridcolor: INK.grid,
    linecolor: INK.axis,
    zerolinecolor: INK.axis,
    tickfont: { size: 11, color: INK.secondary },
    title: { font: { size: 12, color: INK.secondary } },
    automargin: true,
  };
  const { xaxis, yaxis, legend, ...rest } = overrides as {
    xaxis?: Record<string, unknown>;
    yaxis?: Record<string, unknown>;
    legend?: Record<string, unknown>;
  };
  // Axis and legend overrides are layered onto the theme rather than replacing it.
  const mergeAxis = (o?: Record<string, unknown>) => ({
    ...axis,
    ...o,
    title: { ...axis.title, ...((o?.title as Record<string, unknown> | undefined) ?? {}) },
  });
  return {
    autosize: true,
    font: { family: FONT_FAMILY, size: 12, color: INK.primary },
    paper_bgcolor: INK.surface,
    plot_bgcolor: INK.surface,
    margin: { l: 56, r: 16, t: 16, b: 48 },
    hoverlabel: {
      bgcolor: '#ffffff',
      bordercolor: '#d4d4d8',
      font: { family: FONT_FAMILY, size: 12, color: INK.primary },
    },
    legend: { font: { size: 12, color: INK.secondary }, bgcolor: 'rgba(255,255,255,0.85)', ...legend },
    xaxis: mergeAxis(xaxis),
    yaxis: mergeAxis(yaxis),
    ...rest,
  };
}

export const fmt = {
  r: (v: number | null | undefined) =>
    v === null || v === undefined || !Number.isFinite(v) ? '—' : (v >= 0 ? '' : '−') + Math.abs(v).toFixed(3),
  num: (v: number | null | undefined, digits = 3) =>
    v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(digits),
  int: (v: number | null | undefined) =>
    v === null || v === undefined || !Number.isFinite(v) ? '—' : Math.round(v).toLocaleString('en-US'),
  pct: (v: number | null | undefined, digits = 1) =>
    v === null || v === undefined || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(digits)}%`,
  bytes: (b: number) =>
    b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`,
  duration: (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`),
};
