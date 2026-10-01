'use client';

import { useMemo, useRef, useState } from 'react';
import { Download, FolderPlus, Play } from 'lucide-react';
import { downloadSvgAsPng, downloadSvgElement } from '@/lib/chart-style';
import { cn } from '@/lib/utils';
import { ivccaApi } from '../api';
import type { LinkageResponse } from '../api';
import { useElementWidth } from '../hooks';
import { downloadText, toCsv } from '../matrix';
import { useIvcca, useToolState } from '../store';
import { FONT_FAMILY, INK, SERIES, fmt } from '../theme';
import {
  BusyOverlay,
  Btn,
  Card,
  ControlBar,
  EmptyState,
  Field,
  InlineError,
  Menu,
  Segmented,
  Slider,
  ToolHeader,
} from '../ui';
import { RequireCorrelation } from './common';

type Method = 'ward' | 'complete' | 'average' | 'single';

type DendroState = {
  method: Method;
  k: number;
  labels: 'fit' | 'all';
  result: LinkageResponse | null;
};

const INITIAL: DendroState = { method: 'ward', k: 4, labels: 'fit', result: null };

const METHODS: Array<{ value: Method; label: string; title: string }> = [
  { value: 'ward', label: 'Ward', title: 'Minimises within-cluster variance — compact, similar-sized modules' },
  { value: 'average', label: 'Average', title: 'UPGMA — mean distance between members' },
  { value: 'complete', label: 'Complete', title: 'Maximum distance — tight, spherical clusters' },
  { value: 'single', label: 'Single', title: 'Minimum distance — tends to chain' },
];

type Cut = {
  /** leaf gene index → cluster number (1-based, in leaf order) */
  clusterOf: Int32Array;
  clusters: Array<{ id: number; genes: number[]; color: string }>;
  cutHeight: number;
  /** merge index → colour of the link */
  linkColor: string[];
};

function cutTree(result: LinkageResponse, k: number): Cut {
  const n = result.genes.length;
  const Z = result.linkage;
  const merges = Math.max(0, n - k);
  const parent = Array.from({ length: 2 * n - 1 }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  for (let i = 0; i < merges; i += 1) {
    const node = n + i;
    parent[find(Z[i][0])] = node;
    parent[find(Z[i][1])] = node;
  }

  // Number clusters top-to-bottom in leaf order.
  const rootToCluster = new Map<number, number>();
  const clusterOf = new Int32Array(n);
  const members: number[][] = [];
  for (const leaf of result.leaves) {
    const root = find(leaf);
    let id = rootToCluster.get(root);
    if (id === undefined) {
      id = rootToCluster.size + 1;
      rootToCluster.set(root, id);
      members.push([]);
    }
    clusterOf[leaf] = id;
    members[id - 1].push(leaf);
  }

  // The eight largest clusters get categorical slots (assigned in leaf order); the rest fold to neutral.
  const bySize = members.map((m, i) => ({ id: i + 1, size: m.length })).sort((a, b) => b.size - a.size);
  const colored = new Set(bySize.slice(0, SERIES.length).map((c) => c.id));
  let slot = 0;
  const colorOf = new Map<number, string>();
  for (let id = 1; id <= members.length; id += 1) {
    colorOf.set(id, colored.has(id) ? SERIES[slot++] : INK.other);
  }

  const linkColor = Z.map((row, i) => (i < merges ? colorOf.get(clusterOf[firstLeaf(Z, n, n + i)])! : INK.secondary));
  const lo = merges > 0 ? Z[merges - 1][2] : 0;
  const hi = merges < Z.length ? Z[merges][2] : lo;
  return {
    clusterOf,
    clusters: members.map((genes, i) => ({ id: i + 1, genes, color: colorOf.get(i + 1)! })),
    cutHeight: (lo + hi) / 2,
    linkColor,
  };
}

function firstLeaf(Z: number[][], n: number, node: number): number {
  let cur = node;
  while (cur >= n) cur = Z[cur - n][0];
  return cur;
}

function DendrogramSvg({
  result,
  cut,
  width,
  labels,
  svgRef,
}: {
  result: LinkageResponse;
  cut: Cut;
  width: number;
  labels: 'fit' | 'all';
  svgRef: React.RefObject<SVGSVGElement | null>;
}) {
  const n = result.genes.length;
  const Z = result.linkage;
  const showLabels = labels === 'all' || n <= 60;
  const rowH = showLabels ? 14 : Math.max(1.2, 640 / n);
  const labelW = showLabels ? Math.min(180, Math.max(70, Math.max(...result.genes.map((g) => g.length)) * 6.6 + 12)) : 0;
  const strip = 10;
  const padTop = 28;
  const padBottom = 52;
  const treeW = Math.max(200, width - labelW - strip - 24);
  const height = padTop + n * rowH + padBottom;
  const maxH = Z.length ? Z[Z.length - 1][2] : 1;
  const xOf = (h: number) => 8 + treeW * (1 - h / (maxH * 1.02));

  const geometry = useMemo(() => {
    const leafPos = new Float64Array(n);
    result.leaves.forEach((leaf, i) => {
      leafPos[leaf] = i;
    });
    const pos = new Float64Array(2 * n - 1);
    const hgt = new Float64Array(2 * n - 1);
    for (let i = 0; i < n; i += 1) pos[i] = leafPos[i];
    const byColor = new Map<string, string[]>();
    Z.forEach((row, i) => {
      const [a, b, d] = row;
      const node = n + i;
      pos[node] = (pos[a] + pos[b]) / 2;
      hgt[node] = d;
      const ya = padTop + (pos[a] + 0.5) * rowH;
      const yb = padTop + (pos[b] + 0.5) * rowH;
      const xa = xOf(hgt[a]);
      const xb = xOf(hgt[b]);
      const xm = xOf(d);
      const path = `M${xa.toFixed(1)},${ya.toFixed(1)}H${xm.toFixed(1)}V${yb.toFixed(1)}H${xb.toFixed(1)}`;
      const color = cut.linkColor[i];
      if (!byColor.has(color)) byColor.set(color, []);
      byColor.get(color)!.push(path);
    });
    return byColor;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, cut, rowH, treeW, maxH]);

  const cutX = xOf(cut.cutHeight);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * maxH);

  return (
    <svg
      ref={svgRef}
      xmlns="http://www.w3.org/2000/svg"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ fontFamily: FONT_FAMILY, display: 'block' }}
      role="img"
      aria-label={`Dendrogram of ${n} genes cut into ${cut.clusters.length} clusters`}
    >
      <rect width={width} height={height} fill="#ffffff" />
      {/* distance axis */}
      <g>
        <line x1={xOf(maxH * 1.02)} x2={xOf(0)} y1={height - padBottom + 8} y2={height - padBottom + 8} stroke={INK.axis} />
        {ticks.map((t) => (
          <g key={t}>
            <line x1={xOf(t)} x2={xOf(t)} y1={height - padBottom + 8} y2={height - padBottom + 12} stroke={INK.axis} />
            <text x={xOf(t)} y={height - padBottom + 24} textAnchor="middle" fontSize={10} fill={INK.muted}>
              {t.toFixed(2)}
            </text>
          </g>
        ))}
        <text x={(xOf(maxH) + xOf(0)) / 2} y={height - 6} textAnchor="middle" fontSize={11} fill={INK.secondary}>
          Linkage distance
        </text>
      </g>
      {[...geometry.entries()].map(([color, paths]) => (
        <path key={color} d={paths.join('')} fill="none" stroke={color} strokeWidth={color === INK.secondary ? 1.25 : 1.5} strokeLinejoin="round" />
      ))}
      {/* cut line */}
      <line x1={cutX} x2={cutX} y1={padTop - 14} y2={height - padBottom + 4} stroke={INK.primary} strokeWidth={1} strokeDasharray="4 3" />
      <text x={cutX + 4} y={padTop - 16} fontSize={10.5} fill={INK.secondary}>
        cut at {cut.cutHeight.toFixed(3)} → {cut.clusters.length} clusters
      </text>
      {/* cluster strip + labels */}
      {result.leaves.map((leaf, i) => {
        const y = padTop + i * rowH;
        const cluster = cut.clusters[cut.clusterOf[leaf] - 1];
        return (
          <g key={leaf}>
            <rect x={8 + treeW + 6} y={y} width={strip} height={Math.max(rowH, 1)} fill={cluster.color} />
            {showLabels && (
              <text x={8 + treeW + strip + 12} y={y + rowH / 2 + 3.5} fontSize={10.5} fill={INK.primary}>
                {result.genes[leaf]}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function Dendrogram() {
  const { session, run, busy, errors, clearError, addGeneSets } = useIvcca();
  const [state, update] = useToolState<DendroState>('dendrogram', INITIAL);
  const [areaRef, width] = useElementWidth<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const n = session?.nGenes ?? 0;
  const result = state.result;
  const k = Math.min(Math.max(2, state.k), Math.max(2, (result?.genes.length ?? n) - 1));
  const cut = useMemo(() => (result ? cutTree(result, k) : null), [result, k]);

  const compute = async (method: Method) => {
    const res = await run({ key: 'dendrogram', label: `Hierarchical clustering (${method})` }, (id) => ivccaApi.linkage(id, method));
    if (res) update({ result: res, method });
  };

  const saveClusters = (ids: number[]) => {
    if (!result || !cut) return;
    const created = addGeneSets(
      ids.map((id) => ({
        name: `Dendrogram ${state.method} k=${cut.clusters.length} · cluster ${id}`,
        genes: cut.clusters[id - 1].genes.map((g) => result.genes[g]),
        source: 'cluster' as const,
      })),
    );
    setSavedMsg(`${created.length} gene set${created.length === 1 ? '' : 's'} added to the library`);
    setTimeout(() => setSavedMsg(null), 3000);
  };

  const exportCsv = () => {
    if (!result || !cut) return;
    downloadText(
      toCsv([
        ['leaf_order', 'gene', 'cluster'],
        ...result.leaves.map((leaf, i) => [i + 1, result.genes[leaf], cut.clusterOf[leaf]]),
      ]),
      `ivcca_dendrogram_${state.method}_k${cut.clusters.length}.csv`,
    );
  };

  return (
    <div>
      <ToolHeader
        eyebrow="Explore"
        title="Hierarchical clustering dendrogram"
        description="Genes clustered on rows of the 1 − |r| distance matrix. Cut the tree into k clusters to define co-expression modules."
        actions={
          result && (
            <Menu
              label="Export"
              icon={<Download className="h-3.5 w-3.5" />}
              items={[
                { label: 'SVG vector', onSelect: () => svgRef.current && downloadSvgElement(svgRef.current, `ivcca_dendrogram_${state.method}`) },
                { label: 'PNG image', hint: '2×', onSelect: () => svgRef.current && downloadSvgAsPng(svgRef.current, `ivcca_dendrogram_${state.method}`) },
                { label: 'Cluster membership', hint: 'CSV', onSelect: exportCsv },
              ]}
            />
          )
        }
      />
      <InlineError message={errors.dendrogram} onDismiss={() => clearError('dendrogram')} />

      <ControlBar>
        <Field label="Linkage" hint="Changing the linkage method recomputes the tree on the server.">
          <Segmented
            ariaLabel="Linkage method"
            value={state.method}
            onChange={(method) => (result ? void compute(method) : update({ method }))}
            disabled={busy.dendrogram}
            options={METHODS}
          />
        </Field>
        <Field label={`Clusters (k = ${k})`} className="w-60">
          <Slider ariaLabel="Number of clusters" min={2} max={Math.max(3, Math.min(30, n - 1))} value={k} onChange={(v) => update({ k: v })} />
        </Field>
        <Field label="Leaves">
          <Segmented
            ariaLabel="Leaf labels"
            value={state.labels}
            onChange={(labels) => update({ labels })}
            options={[
              { value: 'fit', label: 'Fit to view' },
              { value: 'all', label: 'All labels' },
            ]}
          />
        </Field>
        {!result && (
          <Btn variant="primary" icon={<Play className="h-4 w-4" />} loading={busy.dendrogram} onClick={() => void compute(state.method)}>
            Build dendrogram
          </Btn>
        )}
      </ControlBar>

      {!result ? (
        <EmptyState
          title="No dendrogram yet"
          description={`Cluster all ${n.toLocaleString()} genes with ${state.method} linkage. Takes a second for a few hundred genes.`}
          action={
            <Btn variant="primary" icon={<Play className="h-4 w-4" />} loading={busy.dendrogram} onClick={() => void compute(state.method)}>
              Build dendrogram
            </Btn>
          }
        />
      ) : (
        <BusyOverlay busy={Boolean(busy.dendrogram)} label="Re-clustering…">
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
            <Card
              title={`${METHODS.find((m) => m.value === state.method)?.label} linkage · ${result.genes.length.toLocaleString()} genes`}
              subtitle={state.labels === 'fit' && result.genes.length > 60 ? 'Leaf labels hidden to fit — switch to “All labels” to read gene names' : 'Scroll to see all leaves'}
              bodyClassName="p-2"
            >
              <div ref={areaRef} className={cn('overflow-auto', state.labels === 'all' && 'max-h-[760px]')}>
                {cut && width > 0 && (
                  <DendrogramSvg result={result} cut={cut} width={width} labels={state.labels} svgRef={svgRef} />
                )}
              </div>
            </Card>

            <Card
              title={`${cut?.clusters.length ?? 0} clusters`}
              subtitle={savedMsg ?? 'Colours match the tree; the eight largest clusters are coloured'}
              actions={
                <Btn size="sm" icon={<FolderPlus className="h-3.5 w-3.5" />} onClick={() => cut && saveClusters(cut.clusters.map((c) => c.id))}>
                  Save all
                </Btn>
              }
              bodyClassName="p-0"
            >
              <ul className="max-h-[700px] overflow-auto">
                {cut?.clusters.map((c) => (
                  <li key={c.id} className="border-b border-slate-100 px-4 py-3 last:border-0">
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: c.color }} />
                      <span className="text-sm font-semibold text-slate-900">Cluster {c.id}</span>
                      <span className="text-xs tabular-nums text-slate-500">{c.genes.length} genes · {fmt.pct(c.genes.length / result.genes.length, 0)}</span>
                      <button
                        type="button"
                        onClick={() => saveClusters([c.id])}
                        className="ml-auto text-xs font-medium text-teal-700 hover:text-teal-900"
                      >
                        Save as set
                      </button>
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-slate-600">
                      {c.genes.slice(0, 40).map((g) => result.genes[g]).join(', ')}
                      {c.genes.length > 40 ? ` … +${c.genes.length - 40}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </BusyOverlay>
      )}
    </div>
  );
}

export function DendrogramPanel() {
  return (
    <RequireCorrelation>
      <Dendrogram />
    </RequireCorrelation>
  );
}
