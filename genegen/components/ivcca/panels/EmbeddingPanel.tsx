'use client';

import { useMemo, useState } from 'react';
import { Download, FolderPlus, Play } from 'lucide-react';
import { Chart, ExportMenu, useChartExport } from '../Chart';
import { ivccaApi } from '../api';
import type { PcaResponse, TsneResponse } from '../api';
import { useViewportHeight } from '../hooks';
import { clusterLookup, downloadText, toCsv } from '../matrix';
import { GeneCombobox } from '../pickers';
import { useIvcca, useToolState } from '../store';
import { INK, SERIES, SYMBOLS_2D, SYMBOLS_3D, clusterColor, fmt } from '../theme';
import type { ClusterAssignments, MatrixData } from '../types';
import {
  Badge,
  BusyOverlay,
  Btn,
  Card,
  ControlBar,
  EmptyState,
  Field,
  InlineError,
  Menu,
  NumberInput,
  Segmented,
  Slider,
  ToolHeader,
} from '../ui';
import { RequireMatrix } from './common';

type Kind = 'pca' | 'tsne';

type EmbeddingResult = {
  scores: number[][];
  dims: 2 | 3;
  clusters: number | null;
  perplexity?: number;
  assignments?: ClusterAssignments;
  explained?: number[];
  cumulative?: number[];
};

type EmbeddingState = {
  dims: 2 | 3;
  clusters: number | null;
  perplexity: number;
  highlight: number | null;
  result: EmbeddingResult | null;
};

const INITIAL: Record<Kind, EmbeddingState> = {
  pca: { dims: 3, clusters: null, perplexity: 30, highlight: null, result: null },
  tsne: { dims: 2, clusters: null, perplexity: 30, highlight: null, result: null },
};

const AXIS: Record<Kind, string> = { pca: 'PC', tsne: 't-SNE ' };

/* ------------------------------------------------------------------ */
/* Scatter                                                             */
/* ------------------------------------------------------------------ */

function EmbeddingScatter({
  kind,
  matrix,
  result,
  highlight,
  height,
}: {
  kind: Kind;
  matrix: MatrixData;
  result: EmbeddingResult;
  highlight: number | null;
  height: number;
}) {
  const { onInitialized, exportAs } = useChartExport(`ivcca_${kind}_${result.dims}d`);
  const is3d = result.dims === 3 && result.scores[0]?.length >= 3;
  const axisLabel = (i: number) =>
    kind === 'pca' && result.explained ? `PC${i + 1} (${fmt.pct(result.explained[i])})` : `${AXIS[kind]}${i + 1}`;

  const traces = useMemo(() => {
    const lookup = clusterLookup(result.assignments);
    const groups = new Map<number, number[]>();
    result.scores.forEach((_, i) => {
      const c = lookup.get(matrix.genes[i]) ?? 0;
      if (!groups.has(c)) groups.set(c, []);
      groups.get(c)!.push(i);
    });
    const ids = [...groups.keys()].sort((a, b) => a - b);
    const many = ids.length > 3;
    const markerSize = is3d ? Math.max(2.5, Math.min(5, 400 / result.scores.length + 2)) : Math.max(5, Math.min(9, 900 / result.scores.length + 4));
    const out: Array<Record<string, unknown>> = ids.map((c, idx) => {
      const pts = groups.get(c)!;
      const color = c === 0 ? SERIES[0] : clusterColor(c);
      const symbols = is3d ? SYMBOLS_3D : SYMBOLS_2D;
      return {
        type: is3d ? 'scatter3d' : 'scattergl',
        mode: 'markers',
        name: c === 0 ? 'Genes' : `Cluster ${c} (${pts.length})`,
        x: pts.map((i) => result.scores[i][0]),
        y: pts.map((i) => result.scores[i][1]),
        ...(is3d ? { z: pts.map((i) => result.scores[i][2]) } : {}),
        text: pts.map((i) => matrix.genes[i]),
        marker: {
          color,
          size: markerSize,
          symbol: many ? symbols[idx % symbols.length] : 'circle',
          opacity: is3d ? 0.85 : 0.8,
          line: is3d ? { width: 0 } : { color: '#ffffff', width: 1 },
        },
        hovertemplate: `<b>%{text}</b>${c ? `<br>Cluster ${c}` : ''}<br>${axisLabel(0)}: %{x:.3f}<br>${axisLabel(1)}: %{y:.3f}${
          is3d ? `<br>${axisLabel(2)}: %{z:.3f}` : ''
        }<extra></extra>`,
      };
    });
    if (highlight !== null && result.scores[highlight]) {
      const p = result.scores[highlight];
      out.push({
        type: is3d ? 'scatter3d' : 'scatter',
        mode: 'markers+text',
        name: matrix.genes[highlight],
        x: [p[0]],
        y: [p[1]],
        ...(is3d ? { z: [p[2]] } : {}),
        text: [matrix.genes[highlight]],
        textposition: 'top center',
        textfont: { size: 13, color: INK.primary },
        marker: {
          size: is3d ? 9 : 16,
          color: 'rgba(0,0,0,0)',
          symbol: is3d ? 'circle-open' : 'circle-open',
          line: { color: INK.primary, width: 2.5 },
        },
        hoverinfo: 'skip',
        showlegend: false,
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, matrix, highlight, is3d]);

  const layout = useMemo(() => {
    const axis3 = (i: number) => ({
      title: { text: axisLabel(i), font: { size: 12, color: INK.secondary } },
      gridcolor: INK.grid,
      zerolinecolor: INK.axis,
      backgroundcolor: '#ffffff',
      showbackground: true,
      tickfont: { size: 10, color: INK.muted },
    });
    return is3d
      ? {
          margin: { l: 0, r: 0, t: 0, b: 0 },
          scene: {
            xaxis: axis3(0),
            yaxis: axis3(1),
            zaxis: axis3(2),
            aspectmode: 'cube',
            camera: { eye: { x: 1.45, y: 1.45, z: 1.1 } },
          },
          legend: { x: 0, y: 1, bgcolor: 'rgba(255,255,255,0.85)' },
          showlegend: traces.length > 1,
        }
      : {
          margin: { l: 64, r: 16, t: 16, b: 52 },
          xaxis: { title: { text: axisLabel(0) }, zeroline: false },
          yaxis: { title: { text: axisLabel(1) }, zeroline: false },
          legend: { orientation: 'h', x: 0, y: 1.02, yanchor: 'bottom' },
          showlegend: traces.length > 1,
          hovermode: 'closest',
          hoverdistance: 12,
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [is3d, traces.length, result]);

  return (
    <Card
      title={`${kind === 'pca' ? 'PCA' : 't-SNE'} ${is3d ? '3D' : '2D'} · ${result.scores.length.toLocaleString()} genes`}
      subtitle={is3d ? 'Drag to rotate · scroll to zoom · click legend entries to isolate clusters' : 'Drag to zoom · double-click to reset · click legend entries to toggle clusters'}
      actions={<ExportMenu onExport={exportAs} />}
      bodyClassName="p-2"
    >
      <Chart data={traces} layout={layout} height={height} onInitialized={onInitialized} />
    </Card>
  );
}

function ScreePlot({ explained, cumulative }: { explained: number[]; cumulative: number[] }) {
  const { onInitialized, exportAs } = useChartExport('ivcca_pca_scree');
  const count = Math.min(25, explained.length);
  const x = Array.from({ length: count }, (_, i) => i + 1);
  const data = [
    {
      type: 'bar',
      name: 'Per component',
      x,
      y: explained.slice(0, count).map((v) => v * 100),
      marker: { color: SERIES[0] },
      width: 0.7,
      hovertemplate: 'PC%{x}: %{y:.1f}%<extra></extra>',
    },
    {
      type: 'scatter',
      mode: 'lines+markers',
      name: 'Cumulative',
      x,
      y: cumulative.slice(0, count).map((v) => v * 100),
      line: { color: SERIES[1], width: 2 },
      marker: { color: SERIES[1], size: 7, line: { color: '#ffffff', width: 1.5 } },
      hovertemplate: 'PC1–%{x}: %{y:.1f}%<extra></extra>',
    },
  ];
  const layout = {
    margin: { l: 52, r: 12, t: 12, b: 44 },
    bargap: 0.25,
    xaxis: { title: { text: 'Principal component' }, dtick: count > 12 ? 2 : 1, showgrid: false },
    yaxis: { title: { text: 'Variance explained (%)' }, range: [0, 100] },
    legend: { orientation: 'h', x: 0, y: 1.02, yanchor: 'bottom' },
  };
  return (
    <Card title="Scree plot" subtitle={`First ${count} components`} actions={<ExportMenu onExport={exportAs} />} bodyClassName="p-2">
      <Chart data={data} layout={layout} height={300} onInitialized={onInitialized} />
    </Card>
  );
}

function ClusterMembership({ kind, result, matrix }: { kind: Kind; result: EmbeddingResult; matrix: MatrixData }) {
  const { addGeneSets } = useIvcca();
  const [saved, setSaved] = useState<string | null>(null);
  const clusters = useMemo(
    () =>
      Object.entries(result.assignments ?? {})
        .map(([id, genes]) => ({ id: Number(id), genes }))
        .sort((a, b) => a.id - b.id),
    [result.assignments],
  );
  if (!clusters.length) return null;

  const label = kind === 'pca' ? 'PCA' : 't-SNE';
  const save = (ids: number[]) => {
    const created = addGeneSets(
      clusters
        .filter((c) => ids.includes(c.id))
        .map((c) => ({ name: `${label} k=${clusters.length} · cluster ${c.id}`, genes: c.genes, source: 'cluster' as const })),
    );
    setSaved(`${created.length} gene set${created.length === 1 ? '' : 's'} added to the library`);
    setTimeout(() => setSaved(null), 3000);
  };
  const exportCsv = () =>
    downloadText(
      toCsv([['cluster', 'gene'], ...clusters.flatMap((c) => c.genes.map((g) => [c.id, g]))]),
      `ivcca_${kind}_clusters_k${clusters.length}.csv`,
    );

  return (
    <Card
      className="mt-4"
      title={`Cluster membership · k-means on ${label} coordinates`}
      subtitle={saved ?? `${clusters.length} clusters · ${matrix.n.toLocaleString()} genes`}
      actions={
        <>
          <Btn size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={exportCsv}>
            CSV
          </Btn>
          <Btn size="sm" icon={<FolderPlus className="h-3.5 w-3.5" />} onClick={() => save(clusters.map((c) => c.id))}>
            Save all as gene sets
          </Btn>
        </>
      }
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {clusters.map((c) => (
          <div key={c.id} className="rounded-lg border border-slate-200 p-3">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-sm" style={{ background: clusterColor(c.id) }} />
              <span className="text-sm font-semibold text-slate-900">Cluster {c.id}</span>
              <span className="text-xs tabular-nums text-slate-500">
                {c.genes.length} genes · {fmt.pct(c.genes.length / matrix.n, 0)}
              </span>
              <button type="button" onClick={() => save([c.id])} className="ml-auto text-xs font-medium text-teal-700 hover:text-teal-900">
                Save as set
              </button>
            </div>
            <div className="mt-2 flex max-h-28 flex-wrap gap-1 overflow-auto">
              {c.genes.map((g) => (
                <span key={g} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700">
                  {g}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Panel                                                               */
/* ------------------------------------------------------------------ */

function Embedding({ kind, matrix }: { kind: Kind; matrix: MatrixData }) {
  const { run, busy, errors, clearError, toolState } = useIvcca();
  const [state, update] = useToolState<EmbeddingState>(kind, INITIAL[kind]);
  const vh = useViewportHeight();
  const res = state.result;
  const optimal = (toolState['optimal-k'] as { result?: { optimal_k_silhouette: number; optimal_k_elbow: number } } | undefined)?.result;
  // mirrors the backend cap: at most (genes − 1) / 3 (floor 5) and always below the gene count
  const effectivePerplexity = Math.max(
    1,
    Math.min(state.perplexity, Math.max(5, Math.floor((matrix.n - 1) / 3)), matrix.n - 1),
  );

  const stale =
    res &&
    (res.dims !== state.dims ||
      (res.clusters ?? null) !== (state.clusters && state.clusters > 1 ? state.clusters : null) ||
      (kind === 'tsne' && res.perplexity !== state.perplexity));

  const compute = async () => {
    const clusters = state.clusters && state.clusters > 1 ? state.clusters : null;
    const label =
      kind === 'pca'
        ? `PCA ${state.dims}D${clusters ? `, k = ${clusters}` : ''}`
        : `t-SNE ${state.dims}D, perplexity ${state.perplexity}${clusters ? `, k = ${clusters}` : ''}`;
    if (kind === 'pca') {
      const out: PcaResponse | undefined = await run({ key: kind, label }, (id) => ivccaApi.pca(id, state.dims, clusters));
      if (out)
        update({
          result: {
            scores: out.scores,
            dims: state.dims,
            clusters,
            assignments: out.cluster_assignments,
            explained: out.explained_variance,
            cumulative: out.cumulative_variance,
          },
        });
    } else {
      const out: TsneResponse | undefined = await run({ key: kind, label }, (id) =>
        ivccaApi.tsne(id, state.dims, state.perplexity, clusters),
      );
      if (out)
        update({
          result: { scores: out.scores, dims: state.dims, clusters, perplexity: state.perplexity, assignments: out.cluster_assignments },
        });
    }
  };

  const exportScores = () => {
    if (!res) return;
    const lookup = clusterLookup(res.assignments);
    const dims = res.scores[0]?.length ?? 0;
    downloadText(
      toCsv([
        ['gene', ...Array.from({ length: dims }, (_, i) => `${kind === 'pca' ? 'PC' : 'tSNE'}${i + 1}`), 'cluster'],
        ...res.scores.map((s, i) => [matrix.genes[i], ...s.map((v) => Number(v.toFixed(6))), lookup.get(matrix.genes[i]) ?? '']),
      ]),
      `ivcca_${kind}_coordinates.csv`,
    );
  };

  const title = kind === 'pca' ? 'Principal component analysis' : 't-SNE embedding';
  const description =
    kind === 'pca'
      ? 'Each gene is a point, positioned by its correlation profile (rows of |r|). Genes that correlate with the same partners land together.'
      : 'Non-linear embedding of gene correlation profiles (PCA-initialised, as in IVCCA MATLAB). Distances between far-apart groups are not meaningful — focus on local neighbourhoods.';
  const scatterHeight = Math.max(460, Math.min(720, vh - 260));

  return (
    <div>
      <ToolHeader
        eyebrow="Structure"
        title={title}
        description={description}
        actions={
          res && (
            <Menu
              label="Data"
              icon={<Download className="h-3.5 w-3.5" />}
              items={[{ label: 'Gene coordinates', hint: 'CSV', onSelect: exportScores }]}
            />
          )
        }
      />
      <InlineError message={errors[kind]} onDismiss={() => clearError(kind)} />

      <ControlBar>
        <Field label="Dimensions">
          <Segmented
            ariaLabel="Dimensions"
            value={state.dims}
            onChange={(dims) => update({ dims })}
            options={[
              { value: 2, label: '2D' },
              { value: 3, label: '3D' },
            ]}
          />
        </Field>
        {kind === 'tsne' && (
          <Field
            label={`Perplexity${effectivePerplexity !== state.perplexity ? ` (used: ${effectivePerplexity})` : ''}`}
            hint="Roughly the number of neighbours each gene considers. Capped at (genes − 1) / 3."
            className="w-56"
          >
            <Slider ariaLabel="Perplexity" min={5} max={100} value={state.perplexity} onChange={(perplexity) => update({ perplexity })} />
          </Field>
        )}
        <Field label="Colour by k-means clusters" hint={`K-means on the ${kind === 'pca' ? 'principal component' : 't-SNE'} coordinates. Leave empty for no clustering.`}>
          <div className="flex items-center gap-2">
            <NumberInput value={state.clusters} allowEmpty min={2} max={20} placeholder="None" onChange={(clusters) => update({ clusters })} />
            {optimal && (
              <button
                type="button"
                onClick={() => update({ clusters: optimal.optimal_k_silhouette })}
                className="rounded-md bg-teal-50 px-2 py-1 text-xs font-medium text-teal-800 ring-1 ring-teal-600/15 hover:bg-teal-100"
              >
                Suggested k = {optimal.optimal_k_silhouette}
              </button>
            )}
          </div>
        </Field>
        <Btn variant="primary" icon={<Play className="h-4 w-4" />} loading={busy[kind]} onClick={() => void compute()}>
          {res ? 'Run again' : `Run ${kind === 'pca' ? 'PCA' : 't-SNE'}`}
        </Btn>
        {stale && <Badge tone="amber">Parameters changed — run again to update</Badge>}
        <div className="basis-full border-t border-slate-100 xl:hidden" />
        <Field label="Find gene" className="w-56 xl:ml-auto">
          <GeneCombobox matrix={matrix} value={state.highlight} onChange={(highlight) => update({ highlight })} />
        </Field>
      </ControlBar>

      {!res ? (
        <EmptyState
          title={`No ${kind === 'pca' ? 'PCA' : 't-SNE'} result yet`}
          description={
            kind === 'pca'
              ? `Project ${matrix.n.toLocaleString()} genes onto their principal components.`
              : `Embed ${matrix.n.toLocaleString()} genes. Runs in a few seconds for hundreds of genes; thousands take longer.`
          }
          action={
            <Btn variant="primary" icon={<Play className="h-4 w-4" />} loading={busy[kind]} onClick={() => void compute()}>
              Run {kind === 'pca' ? 'PCA' : 't-SNE'}
            </Btn>
          }
        />
      ) : (
        <BusyOverlay busy={Boolean(busy[kind])}>
          {kind === 'pca' && res.explained && res.cumulative ? (
            <div className="grid items-start gap-4 2xl:grid-cols-[minmax(0,1fr)_400px]">
              <EmbeddingScatter kind={kind} matrix={matrix} result={res} highlight={state.highlight} height={scatterHeight} />
              <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-1">
                <ScreePlot explained={res.explained} cumulative={res.cumulative} />
                <Card title="Variance by component" bodyClassName="p-0">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 text-xs text-slate-500">
                        <th className="px-4 py-2 text-left font-semibold">Component</th>
                        <th className="px-2 py-2 text-right font-semibold">Explained</th>
                        <th className="px-4 py-2 text-right font-semibold">Cumulative</th>
                      </tr>
                    </thead>
                    <tbody>
                      {res.explained.slice(0, 6).map((v, i) => (
                        <tr key={i} className="border-b border-slate-100 last:border-0">
                          <td className="px-4 py-1.5 font-medium text-slate-800">PC{i + 1}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-slate-700">{fmt.pct(v)}</td>
                          <td className="px-4 py-1.5 text-right tabular-nums text-slate-500">{fmt.pct(res.cumulative![i])}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              </div>
            </div>
          ) : (
            <EmbeddingScatter kind={kind} matrix={matrix} result={res} highlight={state.highlight} height={scatterHeight} />
          )}
          <ClusterMembership kind={kind} result={res} matrix={matrix} />
        </BusyOverlay>
      )}
    </div>
  );
}

export function EmbeddingPanel({ kind }: { kind: Kind }) {
  return <RequireMatrix>{(matrix) => <Embedding key={kind} kind={kind} matrix={matrix} />}</RequireMatrix>;
}
