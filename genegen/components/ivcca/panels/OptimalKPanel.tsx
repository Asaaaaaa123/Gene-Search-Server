'use client';

import { useMemo } from 'react';
import { ArrowRight, Play } from 'lucide-react';
import { Chart, ExportMenu, useChartExport } from '../Chart';
import { ivccaApi } from '../api';
import type { OptimalClustersResponse } from '../api';
import { useIvcca, useToolState } from '../store';
import { INK, SERIES, fmt } from '../theme';
import {
  BusyOverlay,
  Btn,
  Card,
  ControlBar,
  DataTable,
  EmptyState,
  Field,
  InlineError,
  NumberInput,
  StatTile,
  ToolHeader,
} from '../ui';
import { RequireCorrelation } from './common';

type OptimalKState = { maxK: number; result: OptimalClustersResponse | null };
const INITIAL: OptimalKState = { maxK: 10, result: null };

function CurveChart({
  title,
  subtitle,
  x,
  y,
  best,
  yTitle,
  exportName,
  color,
}: {
  title: string;
  subtitle: string;
  x: number[];
  y: number[];
  best: number;
  yTitle: string;
  exportName: string;
  color: string;
}) {
  const { onInitialized, exportAs } = useChartExport(exportName);
  const bestIdx = x.indexOf(best);
  const data = useMemo(
    () => [
      {
        type: 'scatter',
        mode: 'lines+markers',
        x,
        y,
        line: { color, width: 2 },
        marker: { color, size: 8, line: { color: '#ffffff', width: 2 } },
        hovertemplate: `k = %{x}<br>${yTitle}: %{y:.4f}<extra></extra>`,
        name: yTitle,
      },
      ...(bestIdx >= 0
        ? [
            {
              type: 'scatter',
              mode: 'markers',
              x: [best],
              y: [y[bestIdx]],
              marker: { color: INK.primary, size: 13, symbol: 'circle-open', line: { width: 2, color: INK.primary } },
              hoverinfo: 'skip',
              showlegend: false,
            },
          ]
        : []),
    ],
    [x, y, best, bestIdx, color, yTitle],
  );
  const layout = useMemo(
    () => ({
      margin: { l: 64, r: 16, t: 16, b: 52 },
      showlegend: false,
      xaxis: { title: { text: 'Number of clusters k' }, dtick: 1, showgrid: false, zeroline: false },
      yaxis: { title: { text: yTitle }, zeroline: false },
      annotations:
        bestIdx >= 0
          ? [
              {
                x: best,
                y: y[bestIdx],
                text: `k = ${best}`,
                showarrow: true,
                arrowhead: 0,
                arrowcolor: INK.muted,
                ax: 28,
                ay: -28,
                font: { size: 12, color: INK.primary },
                bgcolor: '#ffffff',
              },
            ]
          : [],
    }),
    [yTitle, best, bestIdx, y],
  );
  return (
    <Card title={title} subtitle={subtitle} actions={<ExportMenu onExport={exportAs} />}>
      <Chart data={data} layout={layout} height={340} onInitialized={onInitialized} />
    </Card>
  );
}

function OptimalK() {
  const { session, run, busy, errors, clearError, setToolState, setActiveTool } = useIvcca();
  const [state, update] = useToolState<OptimalKState>('optimal-k', INITIAL);
  const n = session?.nGenes ?? 0;
  const res = state.result;

  const compute = async () => {
    const out = await run({ key: 'optimal-k', label: `Optimal k (2–${state.maxK})` }, (id) => ivccaApi.optimalClusters(id, state.maxK));
    if (out) update({ result: out });
  };

  const applyK = (k: number, tool: 'pca' | 'tsne' | 'dendrogram') => {
    setToolState(tool, (prev: unknown) => ({
      ...((prev as object) ?? {}),
      ...(tool === 'dendrogram' ? { k } : { clusters: k }),
    }));
    setActiveTool(tool);
  };

  const logInertia = useMemo(() => res?.inertias.map((v) => Math.log(v)) ?? [], [res]);

  return (
    <div>
      <ToolHeader
        eyebrow="Structure"
        title="Optimal number of clusters"
        description="K-means on the 1 − |r| distance matrix for a range of k. The elbow marks diminishing returns in within-cluster spread; the silhouette peak marks the best-separated partition."
      />
      <InlineError message={errors['optimal-k']} onDismiss={() => clearError('optimal-k')} />
      <ControlBar>
        <Field label="Largest k to test" hint="Each k runs k-means with 10 restarts; larger ranges take longer on big gene sets.">
          <NumberInput value={state.maxK} min={3} max={Math.max(3, Math.min(30, n - 1))} onChange={(v) => update({ maxK: v ?? 10 })} />
        </Field>
        <Btn variant="primary" icon={<Play className="h-4 w-4" />} loading={busy['optimal-k']} onClick={() => void compute()}>
          {res ? 'Recompute' : 'Evaluate k'}
        </Btn>
      </ControlBar>

      {!res ? (
        <EmptyState
          title="No cluster evaluation yet"
          description={`Test k = 2 to ${state.maxK} on ${n.toLocaleString()} genes to choose a cluster count for PCA, t-SNE and the dendrogram.`}
          action={
            <Btn variant="primary" icon={<Play className="h-4 w-4" />} loading={busy['optimal-k']} onClick={() => void compute()}>
              Evaluate k
            </Btn>
          }
        />
      ) : (
        <BusyOverlay busy={Boolean(busy['optimal-k'])}>
          <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <StatTile label="Silhouette optimum" value={`k = ${res.optimal_k_silhouette}`} sub={`score ${fmt.num(res.silhouette_scores[res.k_range.indexOf(res.optimal_k_silhouette)])}`} />
            <StatTile label="Elbow" value={`k = ${res.optimal_k_elbow}`} sub="first slowdown in log inertia" />
            <div className="rounded-xl border border-slate-200/90 bg-white px-4 py-3 shadow-[0_1px_2px_rgba(16,24,40,0.05)] md:col-span-2">
              <p className="text-xs font-medium text-slate-500">Apply a cluster count</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {Array.from(new Set([res.optimal_k_silhouette, res.optimal_k_elbow])).map((k) =>
                  (['pca', 'tsne', 'dendrogram'] as const).map((tool) => (
                    <Btn key={`${k}-${tool}`} size="sm" onClick={() => applyK(k, tool)} icon={<ArrowRight className="h-3.5 w-3.5" />}>
                      k = {k} → {tool === 'pca' ? 'PCA' : tool === 'tsne' ? 't-SNE' : 'Dendrogram'}
                    </Btn>
                  )),
                )}
              </div>
            </div>
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <CurveChart
              title="Elbow curve"
              subtitle="log of within-cluster sum of squares"
              x={res.k_range}
              y={logInertia}
              best={res.optimal_k_elbow}
              yTitle="log(inertia)"
              exportName="ivcca_elbow"
              color={SERIES[0]}
            />
            <CurveChart
              title="Silhouette analysis"
              subtitle="mean silhouette width — higher is better separated"
              x={res.k_range}
              y={res.silhouette_scores}
              best={res.optimal_k_silhouette}
              yTitle="Silhouette"
              exportName="ivcca_silhouette"
              color={SERIES[0]}
            />
          </div>
          <Card className="mt-4" title="All tested k">
            <DataTable
              rows={res.k_range.map((k, i) => ({ k, inertia: res.inertias[i], silhouette: res.silhouette_scores[i] }))}
              rowKey={(r) => String(r.k)}
              exportName="ivcca_optimal_k"
              maxHeight={320}
              isRowActive={(r) => r.k === res.optimal_k_silhouette}
              columns={[
                { key: 'k', header: 'k', align: 'right', width: '5rem', value: (r) => r.k },
                { key: 'inertia', header: 'Inertia', align: 'right', value: (r) => Number(r.inertia.toFixed(4)), render: (r) => fmt.num(r.inertia, 2) },
                { key: 'log', header: 'log(inertia)', align: 'right', value: (r) => Number(Math.log(r.inertia).toFixed(4)), render: (r) => fmt.num(Math.log(r.inertia)) },
                { key: 'sil', header: 'Silhouette', align: 'right', value: (r) => Number(r.silhouette.toFixed(4)), render: (r) => fmt.num(r.silhouette) },
              ]}
            />
          </Card>
        </BusyOverlay>
      )}
    </div>
  );
}

export function OptimalKPanel() {
  return (
    <RequireCorrelation>
      <OptimalK />
    </RequireCorrelation>
  );
}
