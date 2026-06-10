export type ChartTextTarget = 'title' | 'axis' | 'ticks' | 'labels';

export type NetworkTextTarget =
  | 'nodeLabels'
  | 'legend'
  | 'chordLabels'
  | 'heatmapTitle'
  | 'heatmapAxis';

export type TextElementStyle = {
  fontFamily: string;
  fontSize: number;
  fontColor: string;
};

export type ChartStyleOptions = {
  selectedTarget: ChartTextTarget;
  textStyles: Record<ChartTextTarget, TextElementStyle>;
  barColor: string;
  multiColor: boolean;
  /** When set, overrides the default matplotlib chart title string. */
  chartTitleText?: string;
};

export type NetworkStyleOptions = {
  selectedTarget: NetworkTextTarget;
  textStyles: Record<NetworkTextTarget, TextElementStyle>;
  nodeColor: string;
  edgeColorLow: string;
  edgeColorHigh: string;
};

export type ChartExportFormat = 'png' | 'pdf' | 'svg';

/** Fonts that matplotlib can render on the Linux backend (visually distinct). */
export const CHART_FONT_FAMILY_OPTIONS = [
  { value: 'DejaVu Sans', label: 'Sans-serif' },
  { value: 'DejaVu Serif', label: 'Serif (Times-style)' },
  { value: 'DejaVu Sans Mono', label: 'Monospace' },
  { value: 'STIXGeneral', label: 'STIX (scientific)' },
] as const;

/** Fonts for browser-rendered network diagrams (Cytoscape / SVG / Plotly). */
export const NETWORK_FONT_FAMILY_OPTIONS = [
  { value: 'Arial', label: 'Arial' },
  { value: 'Helvetica', label: 'Helvetica' },
  { value: 'Times New Roman', label: 'Times New Roman' },
  { value: 'Georgia', label: 'Georgia' },
  { value: 'Courier New', label: 'Courier New' },
  { value: 'Verdana', label: 'Verdana' },
] as const;

/** @deprecated Use CHART_FONT_FAMILY_OPTIONS or NETWORK_FONT_FAMILY_OPTIONS */
export const FONT_FAMILY_OPTIONS = CHART_FONT_FAMILY_OPTIONS;

export function normalizeHexColor(color: string, fallback = '#000000'): string {
  const trimmed = color.trim();
  const six = trimmed.match(/^#?([0-9A-Fa-f]{6})$/);
  if (six) return `#${six[1]}`;
  const three = trimmed.match(/^#?([0-9A-Fa-f]{3})$/);
  if (three) {
    const [r, g, b] = three[1].split('');
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return fallback;
}

export const CHART_TEXT_TARGET_LABELS: Record<ChartTextTarget, string> = {
  title: 'Chart title',
  axis: 'Axis labels',
  ticks: 'Tick / term labels',
  labels: 'Value labels',
};

export const NETWORK_TEXT_TARGET_LABELS: Record<NetworkTextTarget, string> = {
  nodeLabels: 'Node labels',
  legend: 'Legend text',
  chordLabels: 'Arc labels',
  heatmapTitle: 'Chart title',
  heatmapAxis: 'Axis labels',
};

export const NETWORK_TARGETS_BY_MODE: Record<
  'network' | 'chord' | 'heatmap',
  NetworkTextTarget[]
> = {
  network: ['nodeLabels', 'legend'],
  chord: ['chordLabels'],
  heatmap: ['heatmapTitle', 'heatmapAxis'],
};

const defaultText = (size: number): TextElementStyle => ({
  fontFamily: 'DejaVu Sans',
  fontSize: size,
  fontColor: '#000000',
});

export const DEFAULT_THEME_CHART_STYLE: ChartStyleOptions = {
  selectedTarget: 'title',
  textStyles: {
    title: defaultText(14),
    axis: defaultText(12),
    ticks: defaultText(11),
    labels: defaultText(10),
  },
  barColor: '#3CB371',
  multiColor: false,
};

export const DEFAULT_SUMMARY_CHART_STYLE: ChartStyleOptions = {
  selectedTarget: 'title',
  textStyles: {
    title: defaultText(14),
    axis: defaultText(12),
    ticks: defaultText(11),
    labels: defaultText(10),
  },
  barColor: '#4ECDC4',
  multiColor: true,
};

export const DEFAULT_NETWORK_STYLE: NetworkStyleOptions = {
  selectedTarget: 'nodeLabels',
  textStyles: {
    nodeLabels: { fontFamily: 'Helvetica', fontSize: 11, fontColor: '#1a1a1a' },
    legend: { fontFamily: 'Helvetica', fontSize: 11, fontColor: '#374151' },
    chordLabels: { fontFamily: 'Helvetica', fontSize: 10, fontColor: '#0f172a' },
    heatmapTitle: { fontFamily: 'Arial', fontSize: 15, fontColor: '#222222' },
    heatmapAxis: { fontFamily: 'Arial', fontSize: 10, fontColor: '#333333' },
  },
  nodeColor: '#0173B2',
  edgeColorLow: '#2166ac',
  edgeColorHigh: '#b2182b',
};

export function getActiveTextStyle<T extends ChartTextTarget | NetworkTextTarget>(
  selectedTarget: T,
  textStyles: Record<T, TextElementStyle>,
): TextElementStyle {
  return textStyles[selectedTarget];
}

export function updateActiveTextStyle<T extends { selectedTarget: string; textStyles: Record<string, TextElementStyle> }>(
  options: T,
  patch: Partial<TextElementStyle>,
): T {
  const target = options.selectedTarget;
  return {
    ...options,
    textStyles: {
      ...options.textStyles,
      [target]: { ...options.textStyles[target], ...patch },
    },
  };
}

/** Backend expects snake_case keys inside each text style entry. */
export function textStylesForApi(
  textStyles: Record<string, TextElementStyle>,
): Record<string, { font_family: string; font_size: number; font_color: string }> {
  const out: Record<string, { font_family: string; font_size: number; font_color: string }> = {};
  for (const [key, style] of Object.entries(textStyles)) {
    out[key] = {
      font_family: style.fontFamily,
      font_size: Math.max(8, Math.min(24, Math.round(style.fontSize))),
      font_color: normalizeHexColor(style.fontColor),
    };
  }
  return out;
}

export function appendChartStyleToFormData(
  formData: FormData,
  style: ChartStyleOptions,
  format: ChartExportFormat = 'png',
  options?: { isSummary?: boolean },
) {
  formData.append('text_styles', JSON.stringify(textStylesForApi(style.textStyles)));
  formData.append('bar_color', style.barColor);
  formData.append('chart_format', format);
  if (style.chartTitleText?.trim()) {
    formData.append('chart_title_override', style.chartTitleText.trim());
  }
  if (options?.isSummary) {
    formData.append('multi_color', style.multiColor ? 'true' : 'false');
  }
}

export function chartResponseToDataUrl(
  base64: string,
  format: ChartExportFormat,
  mediaType?: string,
): string {
  const mime =
    mediaType ?? (format === 'pdf' ? 'application/pdf' : `image/${format}`);
  return `data:${mime};base64,${base64}`;
}

export function downloadChartFromBase64(
  base64: string,
  format: ChartExportFormat,
  filename: string,
  mediaType?: string,
) {
  const mime =
    mediaType ?? (format === 'pdf' ? 'application/pdf' : `image/${format}`);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.${format}`;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadSvgElement(svgEl: SVGSVGElement, filename: string) {
  const serializer = new XMLSerializer();
  const src = serializer.serializeToString(svgEl);
  const blob = new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n`, src], {
    type: 'image/svg+xml;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.svg`;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadSvgAsPng(svgEl: SVGSVGElement, filename: string, scale = 2) {
  const serializer = new XMLSerializer();
  const svgStr = serializer.serializeToString(svgEl);
  const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => {
    const w = (svgEl.width?.baseVal?.value || svgEl.clientWidth || 800) * scale;
    const h = (svgEl.height?.baseVal?.value || svgEl.clientHeight || 600) * scale;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob((pngBlob) => {
        if (!pngBlob) return;
        const pngUrl = URL.createObjectURL(pngBlob);
        const a = document.createElement('a');
        a.href = pngUrl;
        a.download = `${filename}.png`;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(pngUrl);
      }, 'image/png');
    }
    URL.revokeObjectURL(url);
  };
  img.onerror = () => URL.revokeObjectURL(url);
  img.src = url;
}
