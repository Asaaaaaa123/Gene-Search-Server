'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Maximize2, Save } from 'lucide-react';
import { Chart, ExportMenu, loadPlotly, useChartExport } from '../Chart';
import { useDraft, useViewportHeight } from '../hooks';
import { downloadText, matchGenes, toCsv, topPairs } from '../matrix';
import {
  DEFAULT_CAMERA,
  EDGE_PX,
  NODE_PX,
  WHOLE_VIEW_DISTANCE,
  buildGraph,
  cameraLookingAt,
  distance3,
  easeInOutCubic,
  forceLayout,
  interpolateCamera,
  lerp,
  networkEncoding,
  toSceneCoords,
} from '../network';
import type { Camera, Graph } from '../network';
import { GeneCombobox, GeneSetPicker, selectedSets } from '../pickers';
import { useIvcca, useToolState } from '../store';
import { INK, SERIES, clusterColor, fmt } from '../theme';
import type { MatrixData } from '../types';
import {
  Btn,
  Card,
  ControlBar,
  DataTable,
  EmptyState,
  Field,
  Menu,
  Notice,
  Segmented,
  Slider,
  StatTile,
  Toggle,
  ToolHeader,
} from '../ui';
import { RequireMatrix } from './common';

type NetworkState = {
  scope: 'all' | 'set';
  setIds: string[];
  /** null = automatic: chosen from the data so the network stays readable */
  threshold: number | null;
  sign: 'both' | 'positive' | 'negative';
  view: '2d' | '3d';
  colorBy: 'component' | 'degree';
  keepIsolates: boolean;
  selected: number | null;
};

const INITIAL: NetworkState = {
  scope: 'all',
  setIds: [],
  threshold: null,
  sign: 'both',
  view: '2d',
  colorBy: 'component',
  keepIsolates: false,
  selected: null,
};

const MAX_EDGES_2D = 6000;
const MAX_EDGES_3D = 20000;
const DEGREE_RAMP = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];

function nodeColor(graph: Graph, g: number, colorBy: NetworkState['colorBy'], maxDegree: number) {
  if (colorBy === 'degree') {
    const d = graph.degree.get(g) ?? 0;
    const t = maxDegree ? d / maxDegree : 0;
    return DEGREE_RAMP[Math.min(DEGREE_RAMP.length - 1, Math.floor(t * (DEGREE_RAMP.length - 1) + 0.5))];
  }
  const c = graph.component.get(g) ?? 0;
  // singletons and small components beyond the 8 largest fold to neutral
  return (graph.componentSizes[c - 1] ?? 0) > 1 ? clusterColor(c) : INK.other;
}

/* ------------------------------------------------------------------ */
/* 2D — Cytoscape                                                      */
/* ------------------------------------------------------------------ */

type CyCore = {
  destroy: () => void;
  png: (opts: Record<string, unknown>) => string;
  fit: (eles?: unknown, padding?: number) => void;
  $id: (id: string) => { length: number; closedNeighborhood: () => { addClass: (c: string) => void }; select: () => void };
  elements: () => { removeClass: (c: string) => void; addClass: (c: string) => void };
  on: (evt: string, selectorOrHandler: unknown, handler?: unknown) => void;
  animate: (opts: Record<string, unknown>) => void;
};

function Network2D({
  matrix,
  graph,
  state,
  height,
  onSelect,
  cyRef,
}: {
  matrix: MatrixData;
  graph: Graph;
  state: NetworkState;
  height: number;
  onSelect: (g: number | null) => void;
  cyRef: React.MutableRefObject<CyCore | null>;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [laying, setLaying] = useState(true);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const maxDegree = Math.max(1, ...graph.degree.values());

  useEffect(() => {
    let cancelled = false;
    setLaying(true);
    const hubs = new Set(
      [...graph.nodes].sort((a, b) => (graph.degree.get(b) ?? 0) - (graph.degree.get(a) ?? 0)).slice(0, 25),
    );
    void import('cytoscape').then(({ default: cytoscape }) => {
      if (cancelled || !container.current) return;
      cyRef.current?.destroy();
      const enc = networkEncoding(graph);
      const elements = [
        ...graph.nodes.map((g) => {
          const t = enc.sizeT(graph.degree.get(g) ?? 0);
          return {
            data: {
              id: `n${g}`,
              gene: g,
              label: matrix.genes[g],
              degree: graph.degree.get(g) ?? 0,
              color: nodeColor(graph, g, state.colorBy, maxDegree),
              // dot area ∝ number of correlated genes
              size: lerp(NODE_PX['2d'], t),
              fontSize: Math.round(9 + 5 * t),
            },
            classes: hubs.has(g) ? 'hub' : '',
          };
        }),
        ...graph.edges.map((e, i) => {
          const t = enc.widthT(Math.abs(e.r));
          return {
            data: {
              id: `e${i}`,
              source: `n${e.s}`,
              target: `n${e.t}`,
              sign: e.r >= 0 ? 'pos' : 'neg',
              // thicker, darker and on top for stronger correlations
              width: lerp(EDGE_PX['2d'], t),
              opacity: 0.3 + 0.55 * t,
              z: Math.round(t * 100),
            },
          };
        }),
      ];
      const options = {
        container: container.current,
        elements,
        minZoom: 0.1,
        maxZoom: 6,
        wheelSensitivity: 0.25,
        style: [
          {
            selector: 'node',
            style: {
              'background-color': 'data(color)',
              width: 'data(size)',
              height: 'data(size)',
              'border-width': 1.5,
              'border-color': '#ffffff',
              label: '',
              'font-size': 'data(fontSize)',
              'font-family': 'ui-sans-serif, system-ui, sans-serif',
              color: INK.primary,
              'text-valign': 'top',
              'text-margin-y': -3,
              'text-background-color': '#ffffff',
              'text-background-opacity': 0.8,
              'text-background-padding': '1px',
              'z-index': 200,
            },
          },
          { selector: 'node.hub', style: { label: 'data(label)' } },
          {
            selector: 'edge',
            style: {
              width: 'data(width)',
              'line-color': SERIES[7],
              opacity: 'data(opacity)',
              'z-index': 'data(z)',
              'curve-style': 'haystack',
            },
          },
          { selector: 'edge[sign = "neg"]', style: { 'line-color': SERIES[0] } },
          { selector: '.faded', style: { opacity: 0.08 } },
          { selector: 'node.focus', style: { label: 'data(label)', 'border-color': INK.primary, 'border-width': 2.5, 'z-index': 10 } },
          { selector: 'node.neighbour', style: { label: 'data(label)' } },
        ],
        layout: {
          name: 'cose',
          animate: false,
          randomize: true,
          // compact layout so dot sizes stay readable after fitting the whole network on screen
          nodeRepulsion: () => 7000,
          nodeOverlap: 16,
          idealEdgeLength: () => 40,
          edgeElasticity: () => 80,
          gravity: 0.6,
          numIter: graph.nodes.length > 600 ? 600 : 1200,
          componentSpacing: 30,
          nodeDimensionsIncludeLabels: false,
        },
      };
      // mapData() strings are valid Cytoscape style values but not in its typings
      const cy = cytoscape(options as unknown as import('cytoscape').CytoscapeOptions) as unknown as CyCore;
      cyRef.current = cy;
      cy.on('tap', 'node', (evt: { target: { data: (k: string) => number } }) => onSelectRef.current(evt.target.data('gene')));
      cy.on('tap', (evt: { target: unknown }) => {
        if (evt.target === cy) onSelectRef.current(null);
      });
      setLaying(false);
    });
    return () => {
      cancelled = true;
    };
    // Rebuild when the graph or colouring changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, state.colorBy]);

  useEffect(() => () => cyRef.current?.destroy(), [cyRef]);

  // Highlight the selected gene's neighbourhood.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || laying) return;
    cy.elements().removeClass('faded');
    cy.elements().removeClass('focus');
    cy.elements().removeClass('neighbour');
    if (state.selected === null) return;
    const node = cy.$id(`n${state.selected}`);
    if (!node.length) return;
    cy.elements().addClass('faded');
    const hood = node.closedNeighborhood();
    hood.addClass('neighbour');
    (hood as unknown as { removeClass: (c: string) => void }).removeClass('faded');
    (node as unknown as { addClass: (c: string) => void }).addClass('focus');
    cy.animate({ fit: { eles: hood, padding: 60 }, duration: 350 });
  }, [state.selected, laying, cyRef]);

  return (
    <div className="relative" style={{ height }}>
      {/* Cytoscape forces position: relative on its container, so size it explicitly */}
      <div ref={container} style={{ height, width: '100%' }} />
      {laying && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/70 text-sm text-slate-500">Laying out network…</div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Legend                                                              */
/* ------------------------------------------------------------------ */

/** Explains the encodings with sample dots and lines drawn at their real on-screen scale. */
function NetworkLegend({ graph, view }: { graph: Graph; view: '2d' | '3d' }) {
  const enc = useMemo(() => networkEncoding(graph), [graph]);
  const [dMin, dMax] = enc.degreeRange;
  const [rMin, rMax] = enc.rRange;
  const degrees = [...new Set([dMin, Math.round((dMin + dMax) / 2), dMax])];
  const rs = rMax - rMin < 1e-4 ? [rMax] : [rMin, (rMin + rMax) / 2, rMax];
  return (
    <div className="flex flex-wrap items-end gap-x-10 gap-y-4 border-t border-slate-100 px-4 py-3 text-xs text-slate-600">
      <div>
        <p className="mb-2 font-semibold text-slate-700">Dot size · number of correlated genes</p>
        <div className="flex items-end gap-5">
          {degrees.map((d) => {
            const px = lerp(NODE_PX[view], enc.sizeT(d));
            return (
              <span key={d} className="flex flex-col items-center gap-1">
                <span className="rounded-full bg-slate-400 ring-2 ring-white" style={{ width: px, height: px }} />
                <span className="tabular-nums">{d}</span>
              </span>
            );
          })}
        </div>
      </div>
      <div>
        <p className="mb-2 font-semibold text-slate-700">Line width · correlation strength |r|</p>
        <div className="flex items-end gap-5">
          {rs.map((r) => (
            <span key={r} className="flex flex-col items-center gap-1.5">
              <span className="block w-10 rounded-full bg-slate-500" style={{ height: Math.max(1, lerp(EDGE_PX[view], enc.widthT(r))) }} />
              <span className="tabular-nums">{r.toFixed(3)}</span>
            </span>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-2 font-semibold text-slate-700">Line colour</p>
        <div className="flex items-center gap-4">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-[3px] w-6 rounded-full" style={{ background: SERIES[7] }} />
            positive r
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-[3px] w-6 rounded-full" style={{ background: SERIES[0] }} />
            negative r
          </span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 3D — Plotly                                                         */
/* ------------------------------------------------------------------ */

const EDGE_BANDS = 5;

type Point3 = number[];

/**
 * Edge traces for the 3D view. Plotly draws one line width per trace, so edges are
 * grouped into |r| bands (thin → thick) per sign; each sign gets exactly one legend entry.
 */
function edgeTraces(edges: Graph['edges'], positions: Map<number, Point3>, enc: ReturnType<typeof networkEncoding>) {
  const traces: Array<Record<string, unknown>> = [];
  for (const sign of ['pos', 'neg'] as const) {
    let legendShown = false;
    for (let band = 0; band < EDGE_BANDS; band += 1) {
      const x: Array<number | null> = [];
      const y: Array<number | null> = [];
      const z: Array<number | null> = [];
      for (const e of edges) {
        if ((e.r >= 0) !== (sign === 'pos')) continue;
        if (Math.min(EDGE_BANDS - 1, Math.floor(enc.widthT(Math.abs(e.r)) * EDGE_BANDS)) !== band) continue;
        const p = positions.get(e.s)!;
        const q = positions.get(e.t)!;
        x.push(p[0], q[0], null);
        y.push(p[1], q[1], null);
        z.push(p[2], q[2], null);
      }
      if (!x.length) continue;
      const t = (band + 0.5) / EDGE_BANDS;
      traces.push({
        type: 'scatter3d',
        mode: 'lines',
        name: sign === 'pos' ? 'Positive r' : 'Negative r',
        legendgroup: sign,
        // the first non-empty band of each sign carries the legend entry
        showlegend: !legendShown,
        x,
        y,
        z,
        line: { color: sign === 'pos' ? SERIES[7] : SERIES[0], width: lerp(EDGE_PX['3d'], t) },
        opacity: 0.3 + 0.5 * t,
        hoverinfo: 'skip',
      });
      legendShown = true;
    }
  }
  return traces;
}

const FLY_MS = 900;

function Network3D({
  matrix,
  graph,
  state,
  height,
  onSelect,
}: {
  matrix: MatrixData;
  graph: Graph;
  state: NetworkState;
  height: number;
  onSelect: (g: number | null) => void;
}) {
  const { onInitialized: registerExport, exportAs } = useChartExport('ivcca_network_3d');
  const gdRef = useRef<HTMLElement | null>(null);
  const positions = useMemo(() => forceLayout(graph.nodes, graph.edges, 3, graph.nodes.length > 500 ? 120 : 200), [graph]);
  const maxDegree = Math.max(1, ...graph.degree.values());
  const enc = useMemo(() => networkEncoding(graph), [graph]);

  // The scene box always spans the whole network, so camera coordinates stay valid while zooming onto one gene.
  const ranges = useMemo<Array<[number, number]>>(() => {
    return [0, 1, 2].map((k) => {
      let lo = Infinity;
      let hi = -Infinity;
      for (const g of graph.nodes) {
        const v = positions.get(g)![k];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (!Number.isFinite(lo)) return [-1, 1] as [number, number];
      const pad = Math.max(0.05, (hi - lo) * 0.08);
      return [lo - pad, hi + pad] as [number, number];
    });
  }, [graph, positions]);

  // A selected gene with edges is the focus: its own network is drawn on top and the camera flies to it.
  const focus = state.selected !== null && graph.degree.has(state.selected) ? state.selected : null;
  const ego = useMemo(() => {
    if (focus === null) return null;
    const partners = new Map<number, number>();
    for (const e of graph.edges) {
      if (e.s === focus) partners.set(e.t, e.r);
      else if (e.t === focus) partners.set(e.s, e.r);
    }
    const members = new Set([focus, ...partners.keys()]);
    const own = graph.edges.filter((e) => e.s === focus || e.t === focus);
    const between = graph.edges.filter((e) => e.s !== focus && e.t !== focus && members.has(e.s) && members.has(e.t));
    return { partners, own, between };
  }, [focus, graph]);

  /* Camera & fade state. While a flight runs, frames are applied imperatively;
     when it lands, the resting camera and context visibility are committed to React state. */
  const [restCamera, setRestCamera] = useState<Camera>(DEFAULT_CAMERA);
  const [contextShown, setContextShown] = useState(true);
  const flight = useRef(0);
  const shownFocus = useRef<number | null>(null);

  const sizeOf = (g: number) => lerp(NODE_PX['3d'], enc.sizeT(graph.degree.get(g) ?? 0));
  const colorOf = (g: number) => nodeColor(graph, g, state.colorBy, maxDegree);
  const at = (genes: number[], k: number) => genes.map((g) => positions.get(g)![k]);

  // Whole network ("context"): always the first traces, so a flight can fade them by index.
  const context = useMemo(() => {
    const traces = edgeTraces(graph.edges, positions, enc);
    traces.push({
      type: 'scatter3d',
      mode: 'markers',
      name: 'Genes',
      x: at(graph.nodes, 0),
      y: at(graph.nodes, 1),
      z: at(graph.nodes, 2),
      text: graph.nodes.map((g) => `<b>${matrix.genes[g]}</b><br>correlated with ${graph.degree.get(g) ?? 0} genes<br>click to fly to its network`),
      // dot area ∝ number of correlated genes
      marker: { size: graph.nodes.map(sizeOf), color: graph.nodes.map(colorOf), line: { width: 0 }, opacity: 0.95 },
      opacity: 1,
      hovertemplate: '%{text}<extra></extra>',
      showlegend: false,
    });
    return traces;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, positions, enc, matrix, state.colorBy, maxDegree]);
  const contextOpacity = useMemo(() => context.map((t) => (t.opacity as number | undefined) ?? 1), [context]);

  // The focused gene's own network, drawn above the context.
  const egoTraces = useMemo(() => {
    if (focus === null || !ego) return [];
    const traces: Array<Record<string, unknown>> = [];
    if (ego.between.length) {
      const x: Array<number | null> = [];
      const y: Array<number | null> = [];
      const z: Array<number | null> = [];
      for (const e of ego.between) {
        const p = positions.get(e.s)!;
        const q = positions.get(e.t)!;
        x.push(p[0], q[0], null);
        y.push(p[1], q[1], null);
        z.push(p[2], q[2], null);
      }
      traces.push({ type: 'scatter3d', mode: 'lines', name: 'Between partners', x, y, z, line: { color: INK.other, width: 1.5 }, opacity: 0.35, hoverinfo: 'skip' });
    }
    // while focused, the gene's own links carry the Positive/Negative legend entries
    traces.push(...edgeTraces(ego.own, positions, enc));
    const partners = [...ego.partners.keys()];
    traces.push({
      type: 'scatter3d',
      mode: 'markers+text',
      name: 'Correlated genes',
      x: at(partners, 0),
      y: at(partners, 1),
      z: at(partners, 2),
      text: partners.map((g) => matrix.genes[g]),
      customdata: partners.map((g) => [ego.partners.get(g) ?? 0, graph.degree.get(g) ?? 0]),
      textposition: 'top center',
      textfont: { size: 11, color: INK.primary },
      marker: { size: partners.map(sizeOf), color: partners.map(colorOf), line: { width: 0 }, opacity: 0.95 },
      hovertemplate: `<b>%{text}</b><br>r with ${matrix.genes[focus]} = %{customdata[0]:.3f}<br>correlated with %{customdata[1]} genes<extra></extra>`,
      showlegend: false,
    });
    traces.push({
      type: 'scatter3d',
      mode: 'markers+text',
      name: matrix.genes[focus],
      x: at([focus], 0),
      y: at([focus], 1),
      z: at([focus], 2),
      text: [`<b>${matrix.genes[focus]}</b>`],
      textposition: 'top center',
      textfont: { size: 14, color: INK.primary },
      marker: { size: sizeOf(focus) + 4, color: colorOf(focus), line: { color: INK.primary, width: 3 }, opacity: 1 },
      hovertemplate: `<b>${matrix.genes[focus]}</b><br>correlated with ${ego.partners.size} genes<extra></extra>`,
      showlegend: false,
    });
    return traces;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, ego, positions, enc, matrix, state.colorBy, maxDegree]);

  const data = useMemo(
    () => [
      ...context.map((t, i) => ({
        ...t,
        visible: contextShown,
        opacity: contextShown ? contextOpacity[i] : 0,
        showlegend: focus === null ? t.showlegend : false,
      })),
      ...egoTraces,
    ],
    [context, contextOpacity, contextShown, egoTraces, focus],
  );

  // Clicked dots map back to genes through these per-trace gene lists.
  const nodeTraces = useMemo(() => {
    const map = new Map<number, number[]>();
    map.set(context.length - 1, graph.nodes);
    if (ego && focus !== null) {
      map.set(data.length - 2, [...ego.partners.keys()]);
      map.set(data.length - 1, [focus]);
    }
    return map;
  }, [context.length, graph.nodes, ego, focus, data.length]);

  /**
   * Camera that frames the focus gene and all its partners (like the 2D "fit to neighbourhood"):
   * aimed at the centre of their bounding box, far enough back that every labelled dot fits.
   */
  const cameraFor = (g: number | null, from: Camera): Camera => {
    if (g === null) return cameraLookingAt({ x: 0, y: 0, z: 0 }, WHOLE_VIEW_DISTANCE, from);
    const pts = [g, ...(ego?.partners.keys() ?? [])].map((n) => toSceneCoords(positions.get(n)!, ranges));
    const mid = (k: 'x' | 'y' | 'z') => (Math.min(...pts.map((p) => p[k])) + Math.max(...pts.map((p) => p[k]))) / 2;
    const center = { x: mid('x'), y: mid('y'), z: mid('z') };
    const reach = Math.max(0.06, ...pts.map((p) => distance3(center, p)));
    return cameraLookingAt(center, Math.max(0.35, reach * 3.4), from);
  };

  // Fly whenever the focus changes: zoom onto a gene, between genes, or back out to the whole network.
  useEffect(() => {
    const from = shownFocus.current;
    shownFocus.current = focus;
    if (from === focus) return;
    const id = ++flight.current;
    const contextIdx = context.map((_, i) => i);
    const fadeFrom = from === null ? 1 : 0;
    const fadeTo = focus === null ? 1 : 0;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    void (async () => {
      const Plotly = await loadPlotly();
      // the chart may still be loading (e.g. a gene picked in 2D before switching to 3D)
      for (let i = 0; i < 60 && !gdRef.current; i += 1) await new Promise((r) => setTimeout(r, 100));
      // let react-plotly finish drawing the new traces before animating over them
      await new Promise((r) => setTimeout(r, 60));
      const gd = gdRef.current as (HTMLElement & { _fullLayout?: { scene?: { _scene?: { getCamera?: () => Camera } } } }) | null;
      if (!gd || id !== flight.current) return;
      const start = gd._fullLayout?.scene?._scene?.getCamera?.() ?? restCamera;
      const target = cameraFor(focus, start);
      const frame = async (t: number) => {
        const cam = interpolateCamera(start, target, t);
        const f = fadeFrom + (fadeTo - fadeFrom) * t;
        if (fadeFrom !== fadeTo) {
          await Plotly.update(
            gd,
            { visible: true, opacity: contextOpacity.map((o) => o * f) },
            { 'scene.camera': cam },
            contextIdx,
          );
        } else {
          await Plotly.relayout(gd, { 'scene.camera': cam });
        }
      };
      if (reduceMotion) {
        await frame(1);
      } else {
        const t0 = performance.now();
        for (;;) {
          if (id !== flight.current) return; // a newer flight took over
          const raw = Math.min(1, (performance.now() - t0) / FLY_MS);
          await frame(easeInOutCubic(raw));
          if (raw >= 1) break;
          await new Promise((r) => requestAnimationFrame(r));
        }
      }
      if (id !== flight.current) return;
      setRestCamera(target);
      setContextShown(focus === null);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  // A new threshold re-lays out the network; re-frame the focused gene without a flight.
  const lastGraph = useRef(graph);
  useEffect(() => {
    if (lastGraph.current === graph) return;
    lastGraph.current = graph;
    if (focus !== null && shownFocus.current === focus) setRestCamera((cam) => cameraFor(focus, cam));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  const axis = (k: number) => ({
    showgrid: false,
    zeroline: false,
    showticklabels: false,
    showbackground: false,
    showspikes: false,
    title: { text: '' },
    range: ranges[k],
    autorange: false,
  });

  return (
    <div className="relative">
      {focus !== null && ego && (
        <div className="absolute bottom-3 left-1/2 z-10 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-3 whitespace-nowrap rounded-full border border-slate-200 bg-white/95 py-1 pl-4 pr-1 text-xs text-slate-700 shadow-sm">
          <span>
            <span className="font-semibold text-slate-900">{matrix.genes[focus]}</span> and its {ego.partners.size} correlated gene
            {ego.partners.size === 1 ? '' : 's'}
          </span>
          <Btn size="sm" onClick={() => onSelect(null)}>
            Show whole network
          </Btn>
        </div>
      )}
      <div className="absolute right-2 top-2 z-10">
        <ExportMenu onExport={exportAs} />
      </div>
      <Chart
        data={data}
        height={height}
        onInitialized={(figure, gd) => {
          gdRef.current = gd;
          registerExport(figure, gd);
        }}
        onClick={(e) => {
          const pt = e.points?.[0] as { curveNumber?: number; pointNumber?: number } | undefined;
          if (pt?.curveNumber === undefined || pt.pointNumber === undefined) return;
          const gene = nodeTraces.get(pt.curveNumber)?.[pt.pointNumber];
          if (gene !== undefined && gene !== focus) onSelect(gene);
        }}
        layout={{
          margin: { l: 0, r: 0, t: 0, b: 0 },
          scene: { xaxis: axis(0), yaxis: axis(1), zaxis: axis(2), aspectmode: 'cube', camera: restCamera },
          // keeps the user's own rotation across re-renders; the flights set the camera explicitly
          uirevision: 'network-3d',
          legend: { x: 0, y: 1, bgcolor: 'rgba(255,255,255,0.85)' },
          showlegend: true,
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Panel                                                               */
/* ------------------------------------------------------------------ */

function NetworkView({ matrix }: { matrix: MatrixData }) {
  const { geneSets, addGeneSets } = useIvcca();
  const [state, update] = useToolState<NetworkState>('network', INITIAL);
  const cyRef = useRef<CyCore | null>(null);
  const vh = useViewportHeight();
  const [saved, setSaved] = useState(false);

  const set = selectedSets(geneSets, state.setIds)[0];
  const scope = useMemo(() => {
    if (state.scope === 'set' && set) return matchGenes(matrix, set.genes).matched;
    return Array.from({ length: matrix.n }, (_, i) => i);
  }, [state.scope, set, matrix]);

  // Automatic threshold: the |r| that keeps roughly three edges per gene (at least 0.5).
  const autoThreshold = useMemo(() => {
    const target = Math.max(50, Math.min(2000, scope.length * 3));
    const inScope = new Set(scope);
    const strongest = topPairs(matrix, target * 4, 'both').filter((p) => inScope.has(p.a) && inScope.has(p.b));
    const cut = strongest[Math.min(strongest.length - 1, target - 1)];
    return cut ? Math.max(0.5, Math.min(0.99, Math.ceil(Math.abs(cut.r) * 100) / 100)) : 0.75;
  }, [matrix, scope]);
  const threshold = state.threshold ?? autoThreshold;
  const view = { ...state, threshold };
  // rebuild the graph once the slider settles, not on every tick
  const [draftThreshold, setDraftThreshold] = useDraft(threshold, (v) => update({ threshold: v }), 250);

  const maxEdges = state.view === '3d' ? MAX_EDGES_3D : MAX_EDGES_2D;
  const graph = useMemo(
    () => buildGraph(matrix, scope, threshold, state.sign, state.keepIsolates, maxEdges),
    [matrix, scope, threshold, state.sign, state.keepIsolates, maxEdges],
  );

  const possible = (scope.length * (scope.length - 1)) / 2;
  const density = possible ? graph.edges.length / possible : 0;
  const hubs = useMemo(
    () =>
      graph.nodes
        .map((g) => ({ g, degree: graph.degree.get(g) ?? 0, strength: graph.strength.get(g) ?? 0, component: graph.component.get(g) ?? 0 }))
        .sort((a, b) => b.degree - a.degree || b.strength - a.strength),
    [graph],
  );
  const height = Math.max(480, Math.min(760, vh - 250));
  const tooMany = graph.truncated;

  const exportEdges = () =>
    downloadText(
      toCsv([['source', 'target', 'r'], ...graph.edges.map((e) => [matrix.genes[e.s], matrix.genes[e.t], Number(e.r.toFixed(4))])]),
      `ivcca_network_edges_r${threshold.toFixed(2)}.csv`,
    );
  const exportNodes = () =>
    downloadText(
      toCsv([['gene', 'degree', 'strength', 'component'], ...hubs.map((h) => [matrix.genes[h.g], h.degree, Number(h.strength.toFixed(4)), h.component])]),
      `ivcca_network_nodes_r${threshold.toFixed(2)}.csv`,
    );
  const exportPng = () => {
    const cy = cyRef.current;
    if (!cy) return;
    const uri = cy.png({ full: true, scale: 3, bg: '#ffffff' });
    const a = document.createElement('a');
    a.href = uri;
    a.download = `ivcca_network_r${threshold.toFixed(2)}.png`;
    a.click();
  };
  const saveLargestComponent = () => {
    const members = graph.nodes.filter((g) => graph.component.get(g) === 1);
    addGeneSets([{ name: `Network module 1 (|r| ≥ ${threshold.toFixed(2)}, ${members.length} genes)`, genes: members.map((g) => matrix.genes[g]), source: 'cluster' }]);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <div>
      <ToolHeader
        eyebrow="Network"
        title="Correlation network"
        description="Genes are nodes; an edge joins two genes whose correlation passes the threshold. A gene correlated with many genes is drawn as a large dot, one with few as a small dot; stronger correlations are drawn as thicker lines. The most connected hubs are labelled."
        actions={
          <Menu
            label="Export"
            icon={<Download className="h-3.5 w-3.5" />}
            items={[
              ...(state.view === '2d' ? [{ label: 'Network image', hint: 'PNG 3×', onSelect: exportPng }] : []),
              { label: 'Edge list', hint: 'CSV', onSelect: exportEdges },
              { label: 'Node table', hint: 'CSV', onSelect: exportNodes },
            ]}
          />
        }
      />

      <ControlBar>
        <Field label="Genes">
          <Segmented
            ariaLabel="Gene scope"
            value={state.scope}
            onChange={(scopeValue) => update({ scope: scopeValue })}
            options={[
              { value: 'all', label: `All ${matrix.n.toLocaleString()}` },
              { value: 'set', label: 'Gene set' },
            ]}
          />
        </Field>
        <Field
          label={`Edge threshold |r| ≥ ${draftThreshold.toFixed(2)}${state.threshold === null ? ' (auto)' : ''}`}
          hint="Auto picks the |r| that keeps about three edges per gene, so the network stays readable. Drag to set your own."
          className="w-72"
        >
          <div className="flex items-center gap-2">
            <Slider
              className="flex-1"
              ariaLabel="Edge threshold"
              min={0.3}
              max={0.99}
              step={0.01}
              value={draftThreshold}
              onChange={setDraftThreshold}
              format={(v) => v.toFixed(2)}
            />
            {state.threshold !== null && (
              <Btn size="sm" variant="ghost" onClick={() => update({ threshold: null })}>
                Auto
              </Btn>
            )}
          </div>
        </Field>
        <Field label="Direction">
          <Segmented
            ariaLabel="Edge direction"
            value={state.sign}
            onChange={(sign) => update({ sign })}
            options={[
              { value: 'both', label: 'Both' },
              { value: 'positive', label: 'Positive' },
              { value: 'negative', label: 'Negative' },
            ]}
          />
        </Field>
        <Field label="View">
          <Segmented
            ariaLabel="View"
            value={state.view}
            onChange={(view) => update({ view })}
            options={[
              { value: '2d', label: '2D' },
              { value: '3d', label: '3D' },
            ]}
          />
        </Field>
        <Field label="Colour nodes by">
          <Segmented
            ariaLabel="Node colour"
            value={state.colorBy}
            onChange={(colorBy) => update({ colorBy })}
            options={[
              { value: 'component', label: 'Module' },
              { value: 'degree', label: 'Degree' },
            ]}
          />
        </Field>
        <Toggle checked={state.keepIsolates} onChange={(keepIsolates) => update({ keepIsolates })} label="Show unconnected genes" />
        {state.scope === 'set' && (
          <div className="basis-full">
            <GeneSetPicker mode="single" value={state.setIds} onChange={(setIds) => update({ setIds })} matrix={matrix} />
          </div>
        )}
      </ControlBar>

      {tooMany && (
        <div className="mb-4">
          <Notice tone="warn">
            More than {maxEdges.toLocaleString()} edges pass |r| ≥ {threshold.toFixed(2)} — only the first {maxEdges.toLocaleString()} are drawn. Raise the threshold or restrict to a gene set for a readable network.
          </Notice>
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatTile label="Genes in network" value={graph.nodes.length.toLocaleString()} sub={`of ${scope.length.toLocaleString()} in scope`} />
        <StatTile label="Edges" value={graph.edges.length.toLocaleString()} sub={`${graph.edges.filter((e) => e.r < 0).length.toLocaleString()} negative`} />
        <StatTile label="Density" value={fmt.pct(density, 2)} sub="of possible gene pairs" />
        <StatTile label="Modules" value={graph.componentSizes.filter((s) => s > 1).length.toLocaleString()} sub="connected components" />
        <StatTile label="Largest module" value={(graph.componentSizes[0] ?? 0).toLocaleString()} sub="genes" />
      </div>

      {state.scope === 'set' && !set ? (
        <EmptyState title="Choose a gene set" description="Pick a set above to build its sub-network." />
      ) : graph.nodes.length === 0 ? (
        <EmptyState title="No edges at this threshold" description="Lower the |r| threshold to connect more genes." />
      ) : (
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <Card
            title={`${state.view === '2d' ? 'Force-directed layout' : '3D force layout'} · |r| ≥ ${threshold.toFixed(2)}`}
            subtitle={
              state.view === '2d'
                ? 'Scroll to zoom · drag nodes · click a gene to highlight its neighbours'
                : 'Drag to rotate · scroll to zoom · click a gene to show its own network'
            }
            actions={
              state.view === '2d' ? (
                <Btn size="sm" icon={<Maximize2 className="h-3.5 w-3.5" />} onClick={() => { update({ selected: null }); cyRef.current?.fit(undefined, 30); }}>
                  Fit
                </Btn>
              ) : undefined
            }
            bodyClassName="p-0"
          >
            {state.view === '2d' ? (
              <Network2D matrix={matrix} graph={graph} state={view} height={height} onSelect={(g) => update({ selected: g })} cyRef={cyRef} />
            ) : (
              <Network3D matrix={matrix} graph={graph} state={view} height={height} onSelect={(g) => update({ selected: g })} />
            )}
            <NetworkLegend graph={graph} view={state.view} />
          </Card>

          <div className="flex min-w-0 flex-col gap-4">
            <Card title="Find a gene" bodyClassName="p-3">
              <GeneCombobox matrix={matrix} value={state.selected} onChange={(selected) => update({ selected })} placeholder="Highlight a gene…" />
              {state.selected !== null && (
                <p className="mt-2 text-xs text-slate-600">
                  {graph.degree.has(state.selected) ? (
                    <>
                      <span className="font-semibold text-slate-900">{matrix.genes[state.selected]}</span> has {graph.degree.get(state.selected)} neighbours in module{' '}
                      {graph.component.get(state.selected)}.
                    </>
                  ) : (
                    <>{matrix.genes[state.selected]} has no edges at this threshold.</>
                  )}
                </p>
              )}
            </Card>
            <Card
              title="Hub genes"
              subtitle="Ranked by degree, then strength (sum of |r|)"
              actions={
                <Btn size="sm" variant="ghost" icon={<Save className="h-3.5 w-3.5" />} onClick={saveLargestComponent}>
                  {saved ? 'Saved' : 'Save module 1'}
                </Btn>
              }
              bodyClassName="p-3"
            >
              <DataTable
                rows={hubs}
                rowKey={(r) => String(r.g)}
                maxHeight={height - 150}
                searchKeys={[(r) => matrix.genes[r.g]]}
                onRowClick={(r) => update({ selected: r.g })}
                isRowActive={(r) => r.g === state.selected}
                columns={[
                  {
                    key: 'gene',
                    header: 'Gene',
                    value: (r) => matrix.genes[r.g],
                    render: (r) => (
                      <span className="inline-flex items-center gap-2 font-medium text-slate-900">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: nodeColor(graph, r.g, state.colorBy, Math.max(1, ...graph.degree.values())) }} />
                        {matrix.genes[r.g]}
                      </span>
                    ),
                  },
                  { key: 'degree', header: 'Degree', align: 'right', value: (r) => r.degree },
                  { key: 'strength', header: 'Strength', align: 'right', value: (r) => Number(r.strength.toFixed(3)), render: (r) => r.strength.toFixed(2) },
                ]}
              />
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

export function NetworkPanel() {
  return <RequireMatrix>{(matrix) => <NetworkView matrix={matrix} />}</RequireMatrix>;
}
