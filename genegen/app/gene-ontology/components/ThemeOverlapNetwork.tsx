'use client';

import * as d3 from 'd3';
import { useEffect, useRef, useCallback, useMemo, useState, useId } from 'react';
import dynamic from 'next/dynamic';

export interface ThemeOverlapNode {
  id: string;
  label: string;
}

export interface ThemeOverlapEdge {
  source: string;
  target: string;
  weight: number;
  /** Sorted gene symbols shared between the two themes (from API). */
  genes?: string[];
}

export interface ThemeOverlapData {
  nodes: ThemeOverlapNode[];
  edges: ThemeOverlapEdge[];
  min_shared: number;
  max_shared: number;
}

/** Distinct, colorblind-friendly qualitative palette (publication-style) */
const THEME_COLORS = [
  '#0173B2',
  '#DE8F05',
  '#029E73',
  '#CC78BC',
  '#CA9161',
  '#949494',
  '#ECE133',
  '#56B4E9',
  '#D55E00',
  '#882255',
  '#009E73',
  '#F0E442',
  '#0072B2',
  '#E69F00',
  '#000000',
  '#00798c',
  '#73a942',
  '#d1495b',
  '#edadc7',
];

const Plot = dynamic(() => import('react-plotly.js'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[460px] items-center justify-center rounded-xl border border-gray-200 bg-white text-sm text-gray-600">
      Loading figure…
    </div>
  ),
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Plotly wrapper props include callbacks not in minimal typing
}) as unknown as React.ComponentType<any>;

/** Interpolate weight to color: dark blue (low) -> yellow/orange -> dark red (high) */
function weightToColor(weight: number, minW: number, maxW: number): string {
  if (maxW <= minW) return '#2166ac';
  const t = Math.max(0, Math.min(1, (weight - minW) / (maxW - minW)));
  const hex = (r: number, g: number, b: number) =>
    '#' + [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');
  if (t <= 0.33) {
    const u = t / 0.33;
    const r = 33 + u * (78 - 33);
    const g = 102 + u * (205 - 102);
    const b = 172 + u * (230 - 172);
    return hex(r, g, b);
  }
  if (t <= 0.66) {
    const u = (t - 0.33) / 0.33;
    const r = 78 + u * (252 - 78);
    const g = 205 + u * (174 - 205);
    const b = 230 + u * (96 - 230);
    return hex(r, g, b);
  }
  const u = (t - 0.66) / 0.34;
  const r = 252 + u * (178 - 252);
  const g = 174 + u * (24 - 174);
  const b = 96 + u * (43 - 96);
  return hex(r, g, b);
}

/** Directed chord matrix: flow only from lower index → higher index (avoids duplicate ribbons for symmetric overlap). */
function buildChordFlowMatrix(
  nodes: ThemeOverlapNode[],
  edges: ThemeOverlapEdge[]
): number[][] {
  const n = nodes.length;
  const idToIdx = new Map(nodes.map((node, i) => [node.id, i] as const));
  const M: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  for (const e of edges) {
    const ia = idToIdx.get(e.source);
    const ib = idToIdx.get(e.target);
    if (ia === undefined || ib === undefined) continue;
    const lo = Math.min(ia, ib);
    const hi = Math.max(ia, ib);
    M[lo][hi] = e.weight;
  }
  return M;
}

/** Symmetric matrix for heatmap (includes zeros on diagonal). */
function buildSymmetricMatrix(
  nodes: ThemeOverlapNode[],
  edges: ThemeOverlapEdge[]
): number[][] {
  const n = nodes.length;
  const idToIdx = new Map(nodes.map((node, i) => [node.id, i] as const));
  const M: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  for (const e of edges) {
    const i = idToIdx.get(e.source);
    const j = idToIdx.get(e.target);
    if (i === undefined || j === undefined) continue;
    M[i][j] = e.weight;
    M[j][i] = e.weight;
  }
  return M;
}

function abbrevLabel(s: string, maxLen: number): string {
  const t = s.trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, Math.max(0, maxLen - 1))}…`;
}

/**
 * Acronym-style label from a theme title (e.g. "Stress & Cytokine Response" → "SCR").
 * Uses the first letter of each whitespace-separated word after normalizing "&" and "/".
 */
function themeAcronym(name: string, maxLetters: number): string {
  const stripped = name.replace(/\([^)]*\)/g, '').trim();
  const normalized = stripped.replace(/&/g, ' ').replace(/\//g, ' ').replace(/\s+/g, ' ').trim();
  const words = normalized.split(/\s+/).filter(Boolean);
  const initials = words
    .map((w) => {
      const m = w.match(/[A-Za-z]/);
      return m ? m[0].toUpperCase() : '';
    })
    .filter(Boolean);
  let out = initials.join('');
  if (out.length > maxLetters) out = out.slice(0, maxLetters);
  if (out.length >= 2) return out;
  if (out.length === 1 && words.length === 1 && words[0].length > 1) {
    return abbrevLabel(words[0], Math.min(maxLetters, 4)).replace(/…\s*$/, '');
  }
  return out || abbrevLabel(stripped, Math.min(maxLetters, 6));
}

/** Rim labels: acronym when possible; shorter max letters when many sectors. */
function abbrevChordRim(name: string, sectorCount: number): string {
  const maxLetters = sectorCount > 14 ? 3 : sectorCount > 11 ? 4 : sectorCount > 8 ? 4 : 5;
  return themeAcronym(name, maxLetters);
}

/**
 * Circular arc path for SVG textPath — follows the chord sector on the outer rim.
 * Uses the same angle convention as d3.arc / chord (angles radians; layout matches lx/ly math).
 */
function chordSectorArcPath(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number
): string {
  const s = startAngle - Math.PI / 2;
  const e = endAngle - Math.PI / 2;
  const x0 = cx + r * Math.cos(s);
  const y0 = cy + r * Math.sin(s);
  const x1 = cx + r * Math.cos(e);
  const y1 = cy + r * Math.sin(e);
  const delta = endAngle - startAngle;
  const largeArc = delta > Math.PI ? 1 : 0;
  return `M ${x0} ${y0} A ${r} ${r} 0 ${largeArc} 1 ${x1} ${y1}`;
}

/** Themes that appear in at least one overlap edge (omit isolated themes from chord). */
function nodesParticipatingInEdges(nodes: ThemeOverlapNode[], edges: ThemeOverlapEdge[]): ThemeOverlapNode[] {
  if (!edges.length) return [];
  const incident = new Set<string>();
  for (const e of edges) {
    incident.add(e.source);
    incident.add(e.target);
  }
  return nodes.filter((n) => incident.has(n.id));
}

interface ThemeOverlapNetworkProps {
  data: ThemeOverlapData | null;
  loading?: boolean;
  className?: string;
}

type VizMode = 'network' | 'chord' | 'heatmap';

/** Pixel position for the edge callout (relative to the graph wrapper). */
/** Selected theme pair: shared count + gene list (sidebar). Optional px/py kept for future use. */
type OverlapPairSelection = {
  sourceLabel: string;
  targetLabel: string;
  weight: number;
  genes: string[];
};

function findOverlapEdge(
  edges: ThemeOverlapEdge[],
  themeIdA: string,
  themeIdB: string
): ThemeOverlapEdge | undefined {
  return edges.find(
    (e) =>
      (e.source === themeIdA && e.target === themeIdB) ||
      (e.source === themeIdB && e.target === themeIdA)
  );
}

function ribbonKeyFromIndices(si: number, ti: number): string {
  return si < ti ? `${si}-${ti}` : `${ti}-${si}`;
}

function SharedGenesAside({ pair, onClose }: { pair: OverlapPairSelection; onClose: () => void }) {
  return (
    <aside className="flex w-full shrink-0 flex-col rounded-xl border border-indigo-100 bg-indigo-50/60 p-4 shadow-sm xl:max-w-sm xl:sticky xl:top-4">
      <h3 className="text-sm font-semibold tracking-tight text-gray-900">Shared genes</h3>
      <p className="mt-1 text-xs leading-snug text-gray-600">
        <span className="font-medium text-gray-800">{pair.sourceLabel}</span>
        <span className="mx-1.5 text-indigo-500">↔</span>
        <span className="font-medium text-gray-800">{pair.targetLabel}</span>
      </p>
      <p className="mt-3 text-sm text-indigo-900">
        <span className="text-lg font-bold tabular-nums">{pair.weight}</span>
        <span className="ml-1.5 text-xs font-medium text-indigo-700">
          shared {pair.weight === 1 ? 'gene' : 'genes'}
        </span>
      </p>
      {pair.genes.length > 0 ? (
        <ul className="mt-3 max-h-[min(480px,55vh)] space-y-1 overflow-y-auto rounded-lg border border-white/90 bg-white px-3 py-2 font-mono text-xs text-gray-900 shadow-inner">
          {pair.genes.map((symbol) => (
            <li key={symbol} className="border-b border-gray-100 py-1 last:border-b-0">
              {symbol}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs leading-relaxed text-amber-800">
          No gene list in this response. Restart the backend and click &quot;Generate Network&quot; again so edges include gene symbols.
        </p>
      )}
      <div className="mt-4 flex justify-center border-t border-indigo-200/60 pt-3">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-1"
        >
          Close
        </button>
      </div>
    </aside>
  );
}

export default function ThemeOverlapNetwork({ data, loading, className = '' }: ThemeOverlapNetworkProps) {
  const chordTextPathIdPrefix = useId().replace(/:/g, '');
  const containerRef = useRef<HTMLDivElement>(null);
  const chordSvgRef = useRef<SVGSVGElement>(null);
  const cyRef = useRef<{ destroy: () => void; png: (opts?: { scale?: number; full?: boolean }) => string } | null>(null);
  const [downloadReady, setDownloadReady] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [threshold, setThreshold] = useState(0);
  const [overlapPair, setOverlapPair] = useState<OverlapPairSelection | null>(null);
  const [vizMode, setVizMode] = useState<VizMode>('network');
  const [chordDims, setChordDims] = useState({ w: 560, h: 520 });
  const [heatmapPlotReady, setHeatmapPlotReady] = useState(false);
  /** Chord sector click: show full theme name (no rim labels). */
  const [chordSelectedIndex, setChordSelectedIndex] = useState<number | null>(null);
  /** Chord ribbon selection for highlighting + pairing with overlapPair. */
  const [selectedRibbonKey, setSelectedRibbonKey] = useState<string | null>(null);

  const filteredEdges = useMemo(() => {
    if (!data || !data.edges.length) return [];
    return data.edges.filter((e) => e.weight >= threshold);
  }, [data, threshold]);

  const closeOverlapPanel = useCallback(() => {
    setOverlapPair(null);
    setSelectedRibbonKey(null);
  }, []);

  const { minS, maxS } = useMemo(() => {
    if (!data || filteredEdges.length === 0) return { minS: 0, maxS: 1 };
    const weights = filteredEdges.map((e) => e.weight);
    const minW = Math.min(...weights);
    const maxW = Math.max(...weights);
    return { minS: minW, maxS: Math.max(maxW, minW + 1) };
  }, [data, filteredEdges]);

  const chordParticipatingNodes = useMemo(
    () => (data ? nodesParticipatingInEdges(data.nodes, filteredEdges) : []),
    [data, filteredEdges]
  );

  const chordMatrix = useMemo(() => {
    if (!data || chordParticipatingNodes.length < 2) return [];
    return buildChordFlowMatrix(chordParticipatingNodes, filteredEdges);
  }, [data, chordParticipatingNodes, filteredEdges]);

  useEffect(() => {
    setChordSelectedIndex(null);
    setSelectedRibbonKey(null);
    setOverlapPair(null);
  }, [threshold, vizMode, filteredEdges.length, chordParticipatingNodes.length]);

  const heatmapMatrix = useMemo(
    () => (data ? buildSymmetricMatrix(data.nodes, filteredEdges) : []),
    [data, filteredEdges]
  );

  const chordWrapRef = useRef<HTMLDivElement>(null);

  const chordPaths = useMemo(() => {
    const chordNodes = chordParticipatingNodes;
    if (!data || chordNodes.length < 2) return null;
    const sum = chordMatrix.flat().reduce((a, b) => a + b, 0);
    if (sum <= 0) return null;

    const n = chordNodes.length;
    const wrapW = chordDims.w;
    const wrapH = chordDims.h;
    const size = Math.min(wrapW, wrapH);
    const marginForLabels = 58;
    const outerRadius = size / 2 - marginForLabels;
    const innerRadius = outerRadius - 22;

    const padAngle = Math.min(0.085, Math.max(0.038, 0.03 + n * 0.0035));
    const chordLay = d3.chord().padAngle(padAngle)(chordMatrix);
    const arcGen = d3.arc().innerRadius(innerRadius).outerRadius(outerRadius);
    const ribbonGen = d3.ribbon().radius(innerRadius - 2);
    const centerX = wrapW / 2;
    const centerY = wrapH / 2;

    const labelArcRadius = outerRadius + 14;

    const groups = chordLay.groups.map((g, i) => {
      const d = arcGen(g as never) ?? '';
      const midAngle = (g.startAngle + g.endAngle) / 2;
      const angle = midAngle - Math.PI / 2;
      const raw = chordNodes[i]?.label ?? chordNodes[i]?.id ?? '';
      const short = abbrevChordRim(raw, n);
      const tipR = outerRadius + 42;
      const lx = centerX + tipR * Math.cos(angle);
      const ly = centerY + tipR * Math.sin(angle);
      const labelArcD = chordSectorArcPath(centerX, centerY, labelArcRadius, g.startAngle, g.endAngle);
      return {
        path: d,
        fill: THEME_COLORS[i % THEME_COLORS.length],
        labelArcD,
        short,
        lx,
        ly,
        full: raw,
        index: i,
      };
    });

    const ribbons = chordLay.map((c) => {
      const path = ribbonGen(c as never);
      const colorIndex = c.source.index;
      const fill = THEME_COLORS[colorIndex % THEME_COLORS.length];
      const si = c.source.index;
      const ti = c.target.index;
      const lo = Math.min(si, ti);
      const hi = Math.max(si, ti);
      const w = chordMatrix[lo]?.[hi] ?? 0;
      return {
        path: path ?? '',
        fill,
        weight: w,
        sourceIdx: si,
        targetIdx: ti,
      };
    });

    return { groups, ribbons, centerX, centerY, outerRadius, chordNodes };
  }, [data, chordParticipatingNodes, chordMatrix, chordDims]);

  useEffect(() => {
    const el = chordWrapRef.current;
    if (!el || vizMode !== 'chord') return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (!cr) return;
      const w = Math.max(320, cr.width - 32);
      const h = Math.max(420, Math.min(640, w));
      setChordDims({ w, h });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [vizMode]);

  const initCy = useCallback(() => {
    if (!data || !containerRef.current || typeof window === 'undefined') return;
    if (vizMode !== 'network') return;

    const nodes = data.nodes;
    const edges = filteredEdges;
    if (nodes.length === 0) return;

    const strength: Record<string, number> = {};
    nodes.forEach((n) => {
      strength[n.id] = 0;
    });
    edges.forEach((e) => {
      strength[e.source] = (strength[e.source] ?? 0) + e.weight;
      strength[e.target] = (strength[e.target] ?? 0) + e.weight;
    });
    const maxStr = Math.max(...Object.values(strength), 1);

    import('cytoscape').then((cytoscapeLib) => {
      const cy = cytoscapeLib.default;
      if (!cy || !containerRef.current) return;

      const edgeElements = edges.map((e, i) => {
        const w = e.weight;
        const lineColor = weightToColor(w, minS, maxS);
        const t = maxS > minS ? (w - minS) / (maxS - minS) : 0.5;
        const lineWidth = 1.2 + t * 5;
        const genes = e.genes ?? [];
        return {
          data: {
            id: `e-${e.source}-${e.target}-${i}`,
            source: e.source,
            target: e.target,
            weight: w,
            genes,
            lineColor,
            lineWidth,
          },
        };
      });

      const elements = [
        ...nodes.map((n, idx) => {
          const s = strength[n.id] ?? 0;
          const nodeSize = 22 + 38 * (s / maxStr);
          return {
            data: {
              id: n.id,
              label: n.label || n.id,
              fillColor: THEME_COLORS[idx % THEME_COLORS.length],
              nodeSize,
            },
          };
        }),
        ...edgeElements,
      ];

      const n = nodes.length;
      const radius = 300;
      const positions: Record<string, { x: number; y: number }> = {};
      for (let i = 0; i < n; i++) {
        const angle = -Math.PI / 2 + (2 * Math.PI * i) / n;
        positions[nodes[i].id] = {
          x: radius * Math.cos(angle),
          y: radius * Math.sin(angle),
        };
      }

      if (cyRef.current) {
        cyRef.current.destroy();
        cyRef.current = null;
      }

      const instance = cy({
        container: containerRef.current,
        elements,
        style: [
          {
            selector: 'node',
            style: {
              label: 'data(label)',
              'background-color': 'data(fillColor)',
              color: '#1a1a1a',
              'font-size': '11px',
              'font-family': 'Helvetica Neue, Arial, sans-serif',
              'text-valign': 'bottom',
              'text-halign': 'center',
              'text-margin-y': 6,
              width: 'data(nodeSize)',
              height: 'data(nodeSize)',
              'text-wrap': 'wrap',
              'text-max-width': '140px',
              'border-width': 1,
              'border-color': '#ffffff',
            },
          },
          {
            selector: 'edge',
            style: {
              width: 'data(lineWidth)',
              'line-color': 'data(lineColor)',
              'curve-style': 'bezier',
              opacity: 0.88,
            },
          },
          { selector: 'edge:selected', style: { width: 'data(lineWidth)', 'line-color': '#0f172a', opacity: 1 } },
          { selector: 'edge.highlight', style: { width: 'data(lineWidth)', 'line-color': '#0f172a', opacity: 1 } },
          { selector: ':selected', style: { 'border-width': 2, 'border-color': '#0f172a' } },
          { selector: ':hover', style: { 'border-width': 2 } },
        ],
        layout: {
          name: 'preset',
          positions,
          fit: true,
          padding: 72,
        },
      });

      const idToLabel: Record<string, string> = {};
      nodes.forEach((node) => {
        idToLabel[node.id] = node.label || node.id;
      });

      const readEdgeGenes = (edge: { data: (attr: string) => unknown }): string[] => {
        const raw = edge.data('genes');
        if (Array.isArray(raw)) return raw.map(String);
        return [];
      };

      instance.on('tap', 'edge', (evt) => {
        const edge = evt.target;
        const weight = edge.data('weight') as number;
        const sourceId = edge.data('source') as string;
        const targetId = edge.data('target') as string;
        const genes = readEdgeGenes(edge);
        setOverlapPair({
          sourceLabel: idToLabel[sourceId] ?? sourceId,
          targetLabel: idToLabel[targetId] ?? targetId,
          weight,
          genes,
        });
        instance.elements().removeClass('highlight');
        instance.elements().unselect();
        edge.select();
      });

      instance.on('mouseover', 'edge', (evt) => {
        const edge = evt.target;
        edge.addClass('highlight');
        const weight = edge.data('weight') as number;
        const sourceId = edge.data('source') as string;
        const targetId = edge.data('target') as string;
        const genes = readEdgeGenes(edge);
        setOverlapPair({
          sourceLabel: idToLabel[sourceId] ?? sourceId,
          targetLabel: idToLabel[targetId] ?? targetId,
          weight,
          genes,
        });
      });

      instance.on('mouseout', 'edge', (evt) => {
        const edge = evt.target;
        edge.removeClass('highlight');
        if (edge.selected()) return;
        setOverlapPair((prev) => {
          if (!prev) return null;
          const sourceId = edge.data('source') as string;
          const targetId = edge.data('target') as string;
          const stillHover =
            prev.sourceLabel === (idToLabel[sourceId] ?? sourceId) &&
            prev.targetLabel === (idToLabel[targetId] ?? targetId);
          return stillHover ? null : prev;
        });
      });

      instance.on('tap', (evt) => {
        if (evt.target === instance) {
          instance.elements().unselect();
          instance.elements().removeClass('highlight');
          setOverlapPair(null);
        }
      });

      cyRef.current = instance;
      setDownloadReady(true);
    }).catch((e) => console.warn('Cytoscape init failed:', e));
  }, [data, minS, maxS, filteredEdges, vizMode]);

  useEffect(() => {
    if (!data || data.nodes.length === 0) {
      setDownloadReady(false);
      return;
    }
    initCy();
    return () => {
      if (cyRef.current) {
        cyRef.current.destroy();
        cyRef.current = null;
      }
      if (vizMode === 'network') setDownloadReady(false);
    };
  }, [initCy, data?.nodes?.length, data?.edges?.length, filteredEdges.length, vizMode]);

  const legendTicks = useMemo(() => {
    const out: number[] = [];
    const step = maxS > minS ? Math.ceil((maxS - minS) / 8) || 1 : 1;
    for (let v = minS; v <= maxS; v += step) out.push(v);
    if (out[out.length - 1] !== maxS) out.push(maxS);
    return out;
  }, [minS, maxS]);

  const gradientStops = useMemo(() => {
    const steps = 20;
    const stops: string[] = [];
    for (let i = 0; i <= steps; i++) {
      const w = minS + (i / steps) * (maxS - minS);
      stops.push(`${weightToColor(w, minS, maxS)} ${(i / steps) * 100}%`);
    }
    return stops.join(', ');
  }, [minS, maxS]);

  const heatmapPlotData = useMemo(() => {
    if (!data || data.nodes.length === 0) return null;
    const labels = data.nodes.map((n) => abbrevLabel(n.label || n.id, 36));
    const zRaw = heatmapMatrix.map((row) => [...row]);
    /** log₁₀(n+1): zeros → 0; spans orders of magnitude like typical log heatmaps */
    const zLog = zRaw.map((row) => row.map((v) => Math.log10(v + 1)));
    const flatLog = zLog.flat();
    const zMin = Math.min(...flatLog);
    let zMax = Math.max(...flatLog);
    if (zMax <= zMin) zMax = zMin + 1e-9;
    const maxCount = Math.max(...zRaw.flat(), 1);
    /** Colorbar: tick positions in log₁₀(n+1), labels = raw gene counts (readable log axis) */
    const countTicks = [0, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000].filter(
      (c) => c === 0 || c <= maxCount
    );
    const tickvals = countTicks.map((c) => Math.log10(c + 1));
    const ticktext = countTicks.map((c) => String(c));

    return [
      {
        z: zLog,
        zmin: zMin,
        zmax: zMax,
        customdata: zRaw,
        x: labels,
        y: labels,
        type: 'heatmap',
        /** Perceptually uniform (purple → teal → yellow); standard for log-scaled intensity data */
        colorscale: 'Viridis',
        hovertemplate: '%{y} × %{x}<br>Shared genes: %{customdata}<extra></extra>',
        colorbar: {
          title: {
            text: 'Shared genes (log₁₀[n+1] scale)',
            font: { size: 12, family: 'Arial, sans-serif' },
          },
          tickfont: { size: 11, family: 'Arial, sans-serif' },
          tickmode: 'array',
          tickvals,
          ticktext,
          len: 0.85,
        },
        showscale: true,
      },
    ];
  }, [data, heatmapMatrix]);

  const heatmapLayout = useMemo(
    () =>
      ({
        title: {
          text: 'Theme–theme overlap (shared genes, log-scaled intensity)',
          font: { family: 'Arial, Helvetica, sans-serif', size: 15, color: '#222' },
          x: 0.5,
          xanchor: 'center',
        },
        paper_bgcolor: '#ffffff',
        plot_bgcolor: '#ffffff',
        font: { family: 'Arial, Helvetica, sans-serif', size: 11, color: '#333' },
        margin: { l: 140, r: 28, t: 56, b: 120 },
        xaxis: {
          tickangle: -45,
          side: 'bottom',
          showgrid: false,
          tickfont: { size: 10 },
        },
        yaxis: {
          autorange: 'reversed',
          showgrid: false,
          tickfont: { size: 10 },
        },
        height: Math.min(720, 420 + (data?.nodes.length ?? 0) * 12),
      }) as Record<string, unknown>,
    [data]
  );

  const heatmapConfig = useMemo(
    () => ({
      responsive: true,
      displayModeBar: true,
      displaylogo: false,
      modeBarButtonsToRemove: ['lasso2d', 'select2d'],
      toImageButtonOptions: {
        format: 'png' as const,
        filename: 'theme-overlap-heatmap',
        height: 900,
        width: 1100,
        scale: 2,
      },
    }),
    []
  );

  const heatmapGdRef = useRef<HTMLElement | null>(null);

  const handleDownload = useCallback(() => {
    if (vizMode === 'heatmap') {
      const gd = heatmapGdRef.current;
      if (!gd) return;
      import('plotly.js')
        .then((Plotly) => {
          return Plotly.downloadImage(gd, {
            format: 'png',
            filename: `theme-overlap-heatmap-${Date.now()}`,
            width: null,
            height: null,
          });
        })
        .catch((e) => console.error('Heatmap export failed:', e));
      return;
    }

    if (vizMode === 'chord') {
      const svg = chordSvgRef.current;
      if (!svg) return;
      const serializer = new XMLSerializer();
      const src = serializer.serializeToString(svg);
      const blob = new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n`, src], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `theme-overlap-chord-${Date.now()}.svg`;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return;
    }

    const cy = cyRef.current;
    if (!cy || typeof cy.png !== 'function') return;
    const opts = { scale: 2, full: true, bg: '#ffffff' };
    const filename = `theme-overlap-network-${Date.now()}.png`;

    const tryBlob = () => {
      const blobPromise = cy.png({ ...opts, output: 'blob-promise' } as { scale?: number; full?: boolean }) as unknown as Promise<Blob>;
      if (blobPromise && typeof blobPromise.then === 'function') {
        setDownloading(true);
        blobPromise
          .then((blob: Blob) => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.rel = 'noopener';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          })
          .catch((e: unknown) => {
            console.error('Download (blob) failed:', e);
            tryDataUri();
          })
          .finally(() => setDownloading(false));
        return;
      }
      tryDataUri();
    };

    const tryDataUri = () => {
      try {
        const dataUri = cy.png(opts);
        if (!dataUri || typeof dataUri !== 'string') return;
        const href = dataUri.startsWith('data:') ? dataUri : `data:image/png;base64,${dataUri}`;
        const a = document.createElement('a');
        a.href = href;
        a.download = filename;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } catch (e) {
        console.error('Download failed:', e);
      }
    };

    tryBlob();
  }, [vizMode]);

  useEffect(() => {
    heatmapGdRef.current = null;
    setHeatmapPlotReady(false);
  }, [vizMode]);

  useEffect(() => {
    setHeatmapPlotReady(false);
  }, [heatmapPlotData]);

  if (loading) {
    return (
      <div className={`rounded-xl border border-gray-200 bg-gray-50 p-12 text-center ${className}`}>
        <p className="text-gray-600">Generating theme overlap network...</p>
      </div>
    );
  }

  if (!data || data.nodes.length === 0) {
    return (
      <div className={`rounded-xl border border-gray-200 bg-gray-50 p-8 text-center text-gray-500 ${className}`}>
        No nodes to draw: no enriched GO terms matched your selected themes&apos; keywords, or there was no
        gene overlap between themes. Try more themes, adjust keywords, or use a larger gene list.
      </div>
    );
  }

  const dataMax = data ? Math.max(data.max_shared, data.min_shared + 1) : 100;
  const totalChordWeight = chordMatrix.flat().reduce((a, b) => a + b, 0);

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-slate-50/80 p-2">
        <span className="px-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Figure style</span>
        {(
          [
            ['network', 'Circular network'],
            ['chord', 'Chord diagram'],
            ['heatmap', 'Overlap heatmap'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              setVizMode(key);
              setDownloadReady(false);
            }}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              vizMode === key ? 'bg-white text-gray-900 shadow-sm ring-1 ring-gray-200' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto hidden text-xs text-gray-500 md:inline">
          Journal-style layouts; export PNG/SVG from the button or Plotly toolbar (heatmap).
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-4 mb-2">
        <label className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-700">Min overlap (threshold):</span>
          <input
            type="number"
            min={0}
            max={dataMax}
            step={1}
            value={threshold}
            onChange={(e) => setThreshold(Math.max(0, Math.min(dataMax, Number(e.target.value) || 0)))}
            className="w-20 px-2 py-1.5 rounded border border-gray-300 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
        </label>
        <span className="text-sm text-gray-500">
          Showing {filteredEdges.length} connection{filteredEdges.length !== 1 ? 's' : ''} (≥ {threshold})
        </span>
        {filteredEdges.length === 0 && data.edges.length > 0 && (
          <span className="text-sm text-amber-600">No connections at this threshold. Lower it to see edges.</span>
        )}
        {vizMode === 'network' && (
          <span className="text-xs text-gray-400">
            Click or hover a connection to select it—the count and gene list appear on the right.
          </span>
        )}
      </div>

      {vizMode === 'network' && (
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
          <div className="flex flex-col gap-4 lg:flex-row lg:flex-1 lg:min-w-0">
            <div className="relative min-h-[440px] flex-1 rounded-xl border border-gray-200 bg-white">
              <div ref={containerRef} className="absolute inset-0 h-full w-full min-h-[440px]" />
            </div>
            <div className="flex shrink-0 flex-col items-center lg:w-auto">
              <span className="mb-2 text-xs font-semibold text-gray-700">Overlap scale</span>
              <div className="flex items-stretch gap-1">
                <div
                  className="h-48 w-5 shrink-0 rounded border border-gray-300"
                  style={{ background: `linear-gradient(to top, ${gradientStops})` }}
                />
                <div className="flex h-48 flex-col justify-between py-0.5 text-xs text-gray-600">
                  {legendTicks
                    .slice()
                    .reverse()
                    .map((v) => (
                      <span key={v}>{v}</span>
                    ))}
                </div>
              </div>
            </div>
          </div>
          {overlapPair ? <SharedGenesAside pair={overlapPair} onClose={closeOverlapPanel} /> : null}
        </div>
      )}

      {vizMode === 'chord' && (
        <div ref={chordWrapRef} className="rounded-xl border border-gray-200 bg-white p-4">
          {chordParticipatingNodes.length < 2 || totalChordWeight <= 0 || !chordPaths ? (
            <div className="py-16 text-center text-sm text-gray-600">
              {chordParticipatingNodes.length < 2
                ? 'Chord diagram needs at least two themes that share genes with another theme (isolated themes are omitted).'
                : 'No weighted overlaps to draw at this threshold. Lower the minimum overlap or add themes.'}
            </div>
          ) : (
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
              <div className="flex min-w-0 flex-1 flex-col items-center gap-3">
                <p className="max-w-xl text-center text-xs text-gray-500">
                  Abbreviations curve along each colored arc on the rim (hover for full name). Click a{' '}
                  <strong className="font-medium text-gray-700">ribbon</strong> for shared genes on the right, or an{' '}
                  <strong className="font-medium text-gray-700">arc</strong> for the full theme name. Click the same ribbon again to clear.
                </p>
                <div className="relative mx-auto w-full" style={{ maxWidth: chordDims.w }}>
                  <svg
                    ref={chordSvgRef}
                    width={chordDims.w}
                    height={chordDims.h}
                    style={{ maxWidth: '100%', height: 'auto', display: 'block' }}
                    className="font-sans"
                  >
                    <rect width="100%" height="100%" fill="#ffffff" />
                    <defs>
                      {chordPaths.groups.map((g) => (
                        <path
                          key={`rim-arc-def-${g.index}`}
                          id={`${chordTextPathIdPrefix}-rim-${g.index}`}
                          d={g.labelArcD}
                          fill="none"
                        />
                      ))}
                    </defs>
                    <g transform={`translate(${chordPaths.centerX},${chordPaths.centerY})`}>
                      <g className="groups">
                        {chordPaths.groups.map((g) => {
                          const selected = chordSelectedIndex === g.index;
                          return (
                            <path
                              key={`g-${g.index}`}
                              role="button"
                              tabIndex={0}
                              d={g.path}
                              fill={g.fill}
                              stroke={selected ? '#0f172a' : '#ffffff'}
                              strokeWidth={selected ? 2.4 : 1.2}
                              style={{ cursor: 'pointer' }}
                              onClick={(e) => {
                                e.stopPropagation();
                                setChordSelectedIndex((prev) => (prev === g.index ? null : g.index));
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  setChordSelectedIndex((prev) => (prev === g.index ? null : g.index));
                                }
                              }}
                            >
                              <title>{g.full}</title>
                            </path>
                          );
                        })}
                      </g>
                      <g className="ribbons">
                        {chordPaths.ribbons.map((r, i) => {
                          const rk = ribbonKeyFromIndices(r.sourceIdx, r.targetIdx);
                          const ribbonSelected = selectedRibbonKey === rk;
                          const srcNode = chordPaths.chordNodes[r.sourceIdx];
                          const tgtNode = chordPaths.chordNodes[r.targetIdx];
                          return (
                            <path
                              key={`r-${i}`}
                              d={r.path}
                              fill={r.fill}
                              fillOpacity={ribbonSelected ? 0.72 : 0.48}
                              stroke={ribbonSelected ? '#0f172a' : '#ffffff'}
                              strokeWidth={ribbonSelected ? 1.8 : 0.6}
                              style={{ cursor: 'pointer' }}
                              onClick={(e) => {
                                e.stopPropagation();
                                const idA = srcNode?.id;
                                const idB = tgtNode?.id;
                                if (!idA || !idB) return;
                                if (selectedRibbonKey === rk) {
                                  setSelectedRibbonKey(null);
                                  setOverlapPair(null);
                                  return;
                                }
                                setSelectedRibbonKey(rk);
                                const edgeRow = findOverlapEdge(filteredEdges, idA, idB);
                                setOverlapPair({
                                  sourceLabel: srcNode?.label ?? idA,
                                  targetLabel: tgtNode?.label ?? idB,
                                  weight: r.weight,
                                  genes: edgeRow?.genes ?? [],
                                });
                              }}
                              onKeyDown={(e) => {
                                if (e.key !== 'Enter' && e.key !== ' ') return;
                                e.preventDefault();
                                const idA = srcNode?.id;
                                const idB = tgtNode?.id;
                                if (!idA || !idB) return;
                                if (selectedRibbonKey === rk) {
                                  setSelectedRibbonKey(null);
                                  setOverlapPair(null);
                                  return;
                                }
                                setSelectedRibbonKey(rk);
                                const edgeRow = findOverlapEdge(filteredEdges, idA, idB);
                                setOverlapPair({
                                  sourceLabel: srcNode?.label ?? idA,
                                  targetLabel: tgtNode?.label ?? idB,
                                  weight: r.weight,
                                  genes: edgeRow?.genes ?? [],
                                });
                              }}
                              role="button"
                              tabIndex={0}
                            >
                              <title>
                                {srcNode?.label ?? ''} ↔ {tgtNode?.label ?? ''}: {r.weight} shared genes (click for list)
                              </title>
                            </path>
                          );
                        })}
                      </g>
                    </g>
                    <g className="chord-rim-labels" style={{ pointerEvents: 'none' }}>
                      {chordPaths.groups.map((g) => (
                        <text
                          key={`rim-arctp-${g.index}`}
                          style={{
                            fontSize: chordPaths.chordNodes.length > 12 ? 9 : 10,
                            fill: '#0f172a',
                            fontFamily: 'Helvetica Neue, Arial, sans-serif',
                            fontWeight: 500,
                          }}
                        >
                          <textPath
                            href={`#${chordTextPathIdPrefix}-rim-${g.index}`}
                            startOffset="50%"
                            textAnchor="middle"
                          >
                            <title>{g.full}</title>
                            {g.short}
                          </textPath>
                        </text>
                      ))}
                    </g>
                  </svg>
                  {chordSelectedIndex !== null && chordPaths.groups[chordSelectedIndex] ? (
                    <div
                      className="pointer-events-none absolute z-10 max-w-[min(340px,calc(100%-16px))] rounded-lg border border-slate-300 bg-white px-3 py-2 text-center text-sm font-medium leading-snug text-slate-900 shadow-lg"
                      style={{
                        left: chordPaths.groups[chordSelectedIndex].lx,
                        top: chordPaths.groups[chordSelectedIndex].ly,
                        transform: 'translate(-50%, calc(-100% - 10px))',
                      }}
                    >
                      {chordPaths.groups[chordSelectedIndex].full}
                    </div>
                  ) : null}
                </div>
              </div>
              {overlapPair ? <SharedGenesAside pair={overlapPair} onClose={closeOverlapPanel} /> : null}
            </div>
          )}
        </div>
      )}

      {vizMode === 'heatmap' && heatmapPlotData && (
        <div className="rounded-xl border border-gray-200 bg-white p-2 overflow-x-auto">
          <Plot
            data={heatmapPlotData}
            layout={heatmapLayout}
            config={heatmapConfig}
            style={{ width: '100%', minHeight: 460 }}
            useResizeHandler
            onInitialized={(_figure: unknown, graphDiv: HTMLElement) => {
              heatmapGdRef.current = graphDiv;
              setHeatmapPlotReady(true);
            }}
          />
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={handleDownload}
          disabled={
            downloading ||
            (vizMode === 'network' && !downloadReady) ||
            (vizMode === 'chord' && (!chordPaths || totalChordWeight <= 0)) ||
            (vizMode === 'heatmap' && !heatmapPlotReady)
          }
          className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {downloading ? 'Downloading...' : vizMode === 'chord' ? 'Download SVG' : 'Download PNG'}
        </button>
        {vizMode === 'heatmap' && (
          <span className="self-center text-xs text-gray-500">High-res PNG (or use the Plotly toolbar).</span>
        )}
      </div>
    </div>
  );
}
