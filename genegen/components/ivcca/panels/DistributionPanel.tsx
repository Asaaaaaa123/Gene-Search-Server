'use client';

import { useMemo } from 'react';
import { Grid3x3 } from 'lucide-react';
import { Chart, ExportMenu, useChartExport } from '../Chart';
import { histogram, summarize, thresholdCounts, topPairs, upperTriangle } from '../matrix';
import type { Pair } from '../matrix';
import { GeneCombobox } from '../pickers';
import { useIvcca, useToolState } from '../store';
import { INK, SERIES, fmt } from '../theme';
import type { MatrixData } from '../types';
import { Btn, Card, ControlBar, DataTable, Field, Segmented, Slider, StatTile, ToolHeader, ValueBar } from '../ui';
import { RequireMatrix } from './common';

type DistState = {
  values: 'signed' | 'abs';
  bins: number;
  yScale: 'linear' | 'log';
  sign: 'both' | 'positive' | 'negative';
  limit: number;
  gene: number | null;
};

const INITIAL: DistState = { values: 'signed', bins: 60, yScale: 'linear', sign: 'both', limit: 200, gene: null };
const THRESHOLDS = [0.3, 0.5, 0.7, 0.8, 0.9, 0.95];

function Distribution({ matrix }: { matrix: MatrixData }) {
  const { setToolState, setActiveTool } = useIvcca();
  const [state, update] = useToolState<DistState>('distribution', INITIAL);
  const { onInitialized, exportAs } = useChartExport('ivcca_correlation_distribution');
  const abs = state.values === 'abs';

  const signed = useMemo(() => upperTriangle(matrix), [matrix]);
  const values = useMemo(() => (abs ? signed.map(Math.abs) : signed), [signed, abs]);
  const stats = useMemo(() => summarize(values), [values]);
  const hist = useMemo(() => histogram(values, state.bins, abs ? 0 : -1, 1), [values, state.bins, abs]);
  const thresholds = useMemo(() => thresholdCounts(signed, THRESHOLDS), [signed]);
  const pairs = useMemo(
    () => topPairs(matrix, state.limit, state.sign, state.gene),
    [matrix, state.limit, state.sign, state.gene],
  );

  const total = signed.length;
  const maxCount = Math.max(...hist.counts);

  const data = useMemo(
    () => [
      {
        type: 'bar',
        x: hist.centers,
        y: hist.counts,
        width: hist.width * 0.86,
        marker: { color: SERIES[0] },
        hovertemplate: `${abs ? '|r|' : 'r'} %{x:.3f}<br>%{y:,} pairs<extra></extra>`,
        name: 'Gene pairs',
      },
    ],
    [hist, abs],
  );

  const layout = useMemo(() => {
    const lo = abs ? 0 : -1;
    // Labels sit on the side with more room, staggered vertically so they never collide.
    const marker = (x: number, label: string, row: number) => {
      const labelLeft = (x - lo) / (1 - lo) > 0.6;
      return {
        shape: {
          type: 'line', xref: 'x', yref: 'paper', x0: x, x1: x, y0: 0, y1: 1,
          line: { color: INK.primary, width: 1.5 },
        },
        annotation: {
          x, y: 1, xref: 'x', yref: 'paper', yanchor: 'bottom', xanchor: labelLeft ? 'right' : 'left',
          yshift: row * 16, text: `${label} ${fmt.r(x)}`, showarrow: false, font: { size: 11, color: INK.secondary },
          xshift: labelLeft ? 3 : -3,
        },
      };
    };
    const m1 = marker(stats.mean, 'Mean', 0);
    const m2 = marker(stats.median, 'Median', 1);
    return {
      margin: { l: 64, r: 16, t: 44, b: 52 },
      bargap: 0,
      xaxis: {
        title: { text: abs ? 'Absolute correlation |r|' : 'Correlation coefficient r' },
        range: abs ? [0, 1] : [-1, 1],
        showgrid: false,
        zeroline: false,
      },
      yaxis: {
        title: { text: 'Gene pairs' },
        type: state.yScale,
        rangemode: 'tozero',
        range: state.yScale === 'linear' ? [0, maxCount * 1.08] : undefined,
      },
      shapes: [m1.shape, m2.shape],
      annotations: [m1.annotation, m2.annotation],
      showlegend: false,
    };
  }, [abs, stats, state.yScale, maxCount]);

  const openInHeatmap = (p: Pair) => {
    setToolState('heatmap', (prev: unknown) => ({
      ...((prev as object) ?? {}),
      focus: p.a,
      pair: { a: p.a, b: p.b },
      inspector: 'gene',
    }));
    setActiveTool('heatmap');
  };

  return (
    <div>
      <ToolHeader
        eyebrow="Explore"
        title="Distribution & strongest pairs"
        description={`All ${total.toLocaleString()} off-diagonal gene pairs. Use the thresholds to choose cut-offs for networks and pathway analyses.`}
      />

      <ControlBar>
        <Field label="Values">
          <Segmented
            ariaLabel="Values"
            value={state.values}
            onChange={(values) => update({ values })}
            options={[
              { value: 'signed', label: 'r' },
              { value: 'abs', label: '|r|' },
            ]}
          />
        </Field>
        <Field label="Bins" className="w-56">
          <Slider ariaLabel="Bins" min={10} max={150} step={5} value={state.bins} onChange={(bins) => update({ bins })} />
        </Field>
        <Field label="Count axis">
          <Segmented
            ariaLabel="Count axis scale"
            value={state.yScale}
            onChange={(yScale) => update({ yScale })}
            options={[
              { value: 'linear', label: 'Linear' },
              { value: 'log', label: 'Log' },
            ]}
          />
        </Field>
      </ControlBar>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card
          title={`Distribution of ${abs ? '|r|' : 'r'}`}
          subtitle={`${state.bins} bins · ${total.toLocaleString()} pairs`}
          actions={<ExportMenu onExport={exportAs} />}
        >
          <Chart data={data} layout={layout} height={400} onInitialized={onInitialized} />
        </Card>

        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <StatTile label="Mean" value={fmt.r(stats.mean)} />
            <StatTile label="Median" value={fmt.r(stats.median)} />
            <StatTile label="Standard deviation" value={fmt.num(stats.std)} />
            <StatTile label="Interquartile range" value={`${fmt.num(stats.q1, 2)} – ${fmt.num(stats.q3, 2)}`} />
          </div>
          <Card title="Pairs above threshold" bodyClassName="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-xs text-slate-500">
                  <th className="px-4 py-2 text-left font-semibold">|r| ≥</th>
                  <th className="px-2 py-2 text-right font-semibold">Positive</th>
                  <th className="px-2 py-2 text-right font-semibold">Negative</th>
                  <th className="px-4 py-2 text-right font-semibold">Share</th>
                </tr>
              </thead>
              <tbody>
                {thresholds.map((t) => (
                  <tr key={t.threshold} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-1.5 font-medium tabular-nums text-slate-800">{t.threshold.toFixed(2)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-slate-700">{t.positive.toLocaleString()}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-slate-700">{t.negative.toLocaleString()}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums text-slate-500">{fmt.pct(t.total / total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      </div>

      <Card
        className="mt-4"
        title="Strongest gene pairs"
        subtitle="Click a row to open the pair in the heatmap"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <GeneCombobox
              matrix={matrix}
              value={state.gene}
              onChange={(gene) => update({ gene })}
              placeholder="Only pairs with gene…"
              className="w-52"
            />
            <Segmented
              size="sm"
              ariaLabel="Direction"
              value={state.sign}
              onChange={(sign) => update({ sign })}
              options={[
                { value: 'both', label: 'Both' },
                { value: 'positive', label: 'Positive' },
                { value: 'negative', label: 'Negative' },
              ]}
            />
            <Segmented
              size="sm"
              ariaLabel="Number of pairs"
              value={state.limit}
              onChange={(limit) => update({ limit })}
              options={[
                { value: 100, label: '100' },
                { value: 200, label: '200' },
                { value: 1000, label: '1,000' },
              ]}
            />
          </div>
        }
      >
        <DataTable<Pair & { rank: number }>
          rows={pairs.map((p, i) => ({ ...p, rank: i + 1 }))}
          rowKey={(r) => `${r.a}-${r.b}`}
          exportName={`ivcca_top_pairs_${state.sign}`}
          searchKeys={[(r) => matrix.genes[r.a], (r) => matrix.genes[r.b]]}
          onRowClick={openInHeatmap}
          columns={[
            { key: 'rank', header: '#', align: 'right', width: '4rem', value: (r) => r.rank },
            { key: 'a', header: 'Gene A', value: (r) => matrix.genes[r.a], render: (r) => <span className="font-medium text-slate-900">{matrix.genes[r.a]}</span> },
            { key: 'b', header: 'Gene B', value: (r) => matrix.genes[r.b], render: (r) => <span className="font-medium text-slate-900">{matrix.genes[r.b]}</span> },
            {
              key: 'r',
              header: 'r',
              align: 'right',
              value: (r) => Number(r.r.toFixed(4)),
              render: (r) => (
                <span className="inline-flex items-center gap-2">
                  <ValueBar value={r.r} signed />
                  <span className="w-14 text-right">{fmt.r(r.r)}</span>
                </span>
              ),
            },
            {
              key: 'go',
              header: '',
              align: 'right',
              width: '3rem',
              value: () => null,
              render: (r) => (
                <Btn
                  size="sm"
                  variant="ghost"
                  aria-label="Open in heatmap"
                  onClick={(e) => {
                    e.stopPropagation();
                    openInHeatmap(r);
                  }}
                >
                  <Grid3x3 className="h-3.5 w-3.5" />
                </Btn>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}

export function DistributionPanel() {
  return <RequireMatrix>{(matrix) => <Distribution matrix={matrix} />}</RequireMatrix>;
}
