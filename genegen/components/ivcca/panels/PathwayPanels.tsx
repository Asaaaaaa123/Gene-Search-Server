'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowRight, Copy, Grid3x3, Layers, Play, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Chart, ExportMenu, useChartExport } from '../Chart';
import { ivccaApi } from '../api';
import type { ComparePathwaysResponse, MultiPathwayResponse, MultiPathwayRow } from '../api';
import {
  blockGrid,
  crossStats,
  histogram,
  matchGenes,
  pathwayRanking,
  withinStats,
} from '../matrix';
import { GeneCombobox, GeneSetPicker, selectedSets } from '../pickers';
import { useIvcca, useToolState } from '../store';
import { INK, PALETTES, SERIES, fmt } from '../theme';
import type { GeneSet, MatrixData } from '../types';
import {
  Badge,
  BusyOverlay,
  Btn,
  Card,
  DataTable,
  EmptyState,
  Field,
  InlineError,
  NumberInput,
  Notice,
  Segmented,
  StatTile,
  Toggle,
  ToolHeader,
  ValueBar,
} from '../ui';
import { RequireRootMatrix } from './common';

const stripExt = (name: string) => name.replace(/\.txt$/i, '');

/* ------------------------------------------------------------------ */
/* Shared pieces                                                       */
/* ------------------------------------------------------------------ */

/** Inputs on the left, results on the right. */
function ToolLayout({ inputs, children }: { inputs: ReactNode; children: ReactNode }) {
  return (
    <div className="grid items-start gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
      <Card title="Inputs" className="xl:sticky xl:top-[8.5rem]">
        <div className="space-y-5">{inputs}</div>
      </Card>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function FullDatasetNote({ matrix }: { matrix: MatrixData }) {
  return (
    <p className="text-xs leading-relaxed text-slate-500">
      Genes are looked up in the original dataset ({matrix.n.toLocaleString()} genes), case-insensitively.
    </p>
  );
}

/**
 * Turns a gene list into its own pathway matrix (rows/columns cut from the full matrix)
 * and switches the workspace to it, so every analysis tool runs on it.
 */
function useOpenPathwayMatrix() {
  const { createPathwayScope, setActiveTool, busy } = useIvcca();
  const open = async (name: string, genes: string[], sourceSetId?: string) => {
    const scope = await createPathwayScope({ name, genes, sourceSetId });
    if (scope) setActiveTool('heatmap');
    return scope;
  };
  return { open, opening: Boolean(busy.subset) };
}

function OpenMatrixButton({
  name,
  genes,
  found,
  sourceSetId,
  variant = 'primary',
  label,
  className,
}: {
  name: string;
  genes: string[];
  found: number;
  sourceSetId?: string;
  variant?: 'primary' | 'secondary';
  label?: string;
  className?: string;
}) {
  const { open, opening } = useOpenPathwayMatrix();
  return (
    <Btn
      variant={variant}
      className={className}
      icon={<Grid3x3 className="h-4 w-4" />}
      loading={opening}
      disabled={found < 2}
      title={found < 2 ? 'At least two genes must be in the dataset' : undefined}
      onClick={() => void open(name, genes, sourceSetId)}
    >
      {label ?? `Build ${found} × ${found} matrix`}
    </Btn>
  );
}

/** Existing pathway matrices in this session, with open / remove. */
function PathwayMatrices() {
  const { scopes, session, setActiveScope, removeScope, setActiveTool } = useIvcca();
  const pathways = scopes.filter((s) => s.kind === 'pathway');
  if (!pathways.length) return null;
  return (
    <Field label="Pathway matrices in this session">
      <ul className="overflow-hidden rounded-lg border border-slate-200">
        {pathways.map((s) => (
          <li key={s.id} className="flex items-center gap-2 border-b border-slate-100 px-3 py-2 text-sm last:border-0">
            <Layers className={cn('h-3.5 w-3.5 shrink-0', s.id === session?.scope.id ? 'text-violet-600' : 'text-slate-400')} />
            <span className="min-w-0 flex-1 truncate font-medium text-slate-800">{s.label}</span>
            <span className="shrink-0 text-xs tabular-nums text-slate-500">
              {s.nGenes}×{s.nGenes}
            </span>
            <button
              type="button"
              onClick={() => {
                setActiveScope(s.id);
                setActiveTool('heatmap');
              }}
              className="text-xs font-medium text-teal-700 hover:text-teal-900"
            >
              Open
            </button>
            <button
              type="button"
              aria-label={`Remove ${s.label}`}
              onClick={() => window.confirm(`Remove the pathway matrix “${s.label}”?`) && removeScope(s.id)}
              className="text-slate-400 hover:text-red-600"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>
    </Field>
  );
}

function MissingGenes({ missing }: { missing: string[] }) {
  if (!missing.length) return null;
  return (
    <Notice tone="warn">
      {missing.length} gene{missing.length === 1 ? ' is' : 's are'} not in the dataset:{' '}
      <span className="font-mono">{missing.slice(0, 40).join(', ')}{missing.length > 40 ? ` … +${missing.length - 40}` : ''}</span>
    </Notice>
  );
}

/** Horizontal bar chart of signed values (red positive / blue negative), or one hue for magnitudes. */
function SignedBars({
  labels,
  values,
  title,
  subtitle,
  xTitle,
  exportName,
  range,
  magnitude,
}: {
  labels: string[];
  values: number[];
  title: string;
  subtitle?: string;
  xTitle: string;
  exportName: string;
  range?: [number, number];
  magnitude?: boolean;
}) {
  const { onInitialized, exportAs } = useChartExport(exportName);
  const height = Math.max(240, Math.min(900, labels.length * 22 + 80));
  return (
    <Card title={title} subtitle={subtitle} actions={<ExportMenu onExport={exportAs} />} bodyClassName="p-2">
      <Chart
        onInitialized={onInitialized}
        height={height}
        data={[
          {
            type: 'bar',
            orientation: 'h',
            y: labels,
            x: values,
            marker: { color: magnitude ? SERIES[0] : values.map((v) => (v >= 0 ? SERIES[7] : SERIES[0])) },
            width: 0.7,
            hovertemplate: '<b>%{y}</b><br>%{x:.3f}<extra></extra>',
          },
        ]}
        layout={{
          margin: { l: 12, r: 24, t: 8, b: 48 },
          xaxis: { title: { text: xTitle }, range, zeroline: true, zerolinecolor: INK.axis },
          yaxis: { type: 'category', autorange: 'reversed', automargin: true, showgrid: false, tickfont: { size: 11, color: INK.primary } },
          bargap: 0.2,
          showlegend: false,
        }}
      />
    </Card>
  );
}

/** Heatmap of a block of the full matrix (a pathway against itself, or one group against another). */
function BlockHeatmap({
  matrix,
  rows,
  cols,
  title,
  subtitle,
  exportName,
  lowerTriangle,
  rowTitle,
  colTitle,
}: {
  matrix: MatrixData;
  rows: number[];
  cols: number[];
  title: string;
  subtitle?: string;
  exportName: string;
  lowerTriangle?: boolean;
  rowTitle?: string;
  colTitle?: string;
}) {
  const { onInitialized, exportAs } = useChartExport(exportName);
  const grid = useMemo(() => blockGrid(matrix, rows, cols, lowerTriangle), [matrix, rows, cols, lowerTriangle]);
  const maxDim = Math.max(rows.length, cols.length);
  const labels = maxDim <= 70;
  const height = Math.min(640, Math.max(300, rows.length * (labels ? 15 : 4) + 130));
  return (
    <Card title={title} subtitle={subtitle} actions={<ExportMenu onExport={exportAs} />} bodyClassName="p-2">
      <Chart
        onInitialized={onInitialized}
        height={height}
        data={[
          {
            type: 'heatmap',
            z: grid.z,
            x: grid.x,
            y: grid.y,
            zmin: -1,
            zmax: 1,
            zmid: 0,
            colorscale: PALETTES['blue-red'].scale,
            hoverongaps: false,
            xgap: maxDim <= 40 ? 1 : 0,
            ygap: maxDim <= 40 ? 1 : 0,
            hovertemplate: '<b>%{y}</b> × <b>%{x}</b><br>r = %{z:.3f}<extra></extra>',
            colorbar: { thickness: 10, len: 0.7, outlinewidth: 0, title: { text: 'r', side: 'top' } },
          },
        ]}
        layout={{
          margin: { l: 8, r: 8, t: 8, b: 8 },
          xaxis: {
            type: 'category',
            tickangle: -90,
            showgrid: false,
            zeroline: false,
            tickfont: { size: 10 },
            showticklabels: labels,
            title: { text: colTitle ?? '' },
          },
          yaxis: {
            type: 'category',
            autorange: 'reversed',
            showgrid: false,
            zeroline: false,
            scaleanchor: rows.length === cols.length ? 'x' : undefined,
            tickfont: { size: 10 },
            showticklabels: labels,
            title: { text: rowTitle ?? '' },
          },
        }}
      />
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Single pathway → its own matrix                                     */
/* ------------------------------------------------------------------ */

type SinglePathwayState = { setIds: string[]; order: 'list' | 'ranked' };

function SinglePathway({ matrix }: { matrix: MatrixData }) {
  const { geneSets } = useIvcca();
  const [state, update] = useToolState<SinglePathwayState>('pathway', { setIds: [], order: 'list' });
  const set = selectedSets(geneSets, state.setIds)[0];

  const match = useMemo(() => (set ? matchGenes(matrix, set.genes) : null), [set, matrix]);
  const ranking = useMemo(() => (match ? pathwayRanking(matrix, match.matched) : []), [match, matrix]);
  const stats = useMemo(() => (match ? withinStats(matrix, match.matched) : null), [match, matrix]);
  const order = state.order === 'ranked' ? ranking.map((r) => r.gene) : match?.matched ?? [];
  const found = match?.matched.length ?? 0;

  return (
    <div>
      <ToolHeader
        eyebrow="Gene sets"
        title="Single pathway"
        description="Give a gene list: its genes are found in the original dataset and cut out of the correlation matrix as their own pathway matrix — then run the heatmap, distribution, dendrogram, optimal k, PCA, t-SNE and network on it."
      />
      <ToolLayout
        inputs={
          <>
            <Field label="Pathway gene list">
              <GeneSetPicker mode="single" value={state.setIds} onChange={(setIds) => update({ setIds })} matrix={matrix} minMatched={2} />
            </Field>
            <FullDatasetNote matrix={matrix} />
            {set && match && (
              <OpenMatrixButton className="w-full" name={set.name} genes={set.genes} found={found} sourceSetId={set.id} />
            )}
            <PathwayMatrices />
          </>
        }
      >
        {!set || !match ? (
          <EmptyState
            icon={<Layers className="h-5 w-5" />}
            title="Choose or paste a pathway gene list"
            description="For example 25 genes → a 25 × 25 matrix extracted from the full correlation matrix, ready for every IVCCA tool."
          />
        ) : found < 2 ? (
          <EmptyState title="Too few genes found" description={`Only ${found} of ${set.genes.length} genes are in the dataset — at least 2 are needed.`} />
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatTile label="Pathway matrix" value={`${found} × ${found}`} sub={set.name} />
              <StatTile label="Genes found" value={`${found} / ${set.genes.length}`} sub={`${fmt.pct(found / set.genes.length, 0)} coverage`} />
              <StatTile label="Mean |r| within pathway" value={fmt.num(stats?.meanAbs)} sub={`${stats?.pairs.toLocaleString()} gene pairs`} />
              <StatTile label="Mean r within pathway" value={fmt.r(stats?.mean)} />
            </div>
            <MissingGenes missing={match.missing} />

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-violet-200 bg-violet-50/70 px-4 py-3">
              <p className="min-w-0 text-sm text-violet-950">
                <span className="font-semibold">Analyse this pathway on its own.</span>{' '}
                <span className="text-violet-900/80">
                  The {found} × {found} matrix becomes the active scope; switch back to the full dataset any time from the sidebar.
                </span>
              </p>
              <OpenMatrixButton name={set.name} genes={set.genes} found={found} sourceSetId={set.id} label={`Open ${found} × ${found} matrix in all tools`} />
            </div>

            <div className="grid items-start gap-4 2xl:grid-cols-2">
              <BlockHeatmap
                matrix={matrix}
                rows={order}
                cols={order}
                lowerTriangle
                title={`${set.name} · ${found} × ${found}`}
                subtitle={state.order === 'list' ? 'Genes in list order' : 'Genes ranked by mean |r| within the pathway'}
                exportName={`ivcca_pathway_matrix_${set.name}`}
              />
              <SignedBars
                title="Genes by connectivity within the pathway"
                subtitle={ranking.length > 40 ? 'Top 40 · mean |r| to the other pathway genes' : 'Mean |r| to the other pathway genes'}
                labels={ranking.slice(0, 40).map((r) => matrix.genes[r.gene])}
                values={ranking.slice(0, 40).map((r) => r.score)}
                xTitle="Mean |r| within pathway"
                exportName="ivcca_pathway_ranking"
                range={[0, 1]}
                magnitude
              />
            </div>
            <div className="flex justify-end">
              <Segmented
                size="sm"
                ariaLabel="Matrix order"
                value={state.order}
                onChange={(o) => update({ order: o })}
                options={[
                  { value: 'list', label: 'List order' },
                  { value: 'ranked', label: 'Ranked order' },
                ]}
              />
            </div>
            <Card title="Pathway genes">
              <DataTable
                rows={ranking.map((r, i) => ({ ...r, rank: i + 1, global: matrix.rankOf[r.gene] + 1 }))}
                rowKey={(r) => String(r.gene)}
                exportName={`ivcca_pathway_${stripExt(set.name)}`}
                searchKeys={[(r) => matrix.genes[r.gene]]}
                columns={[
                  { key: 'rank', header: '#', align: 'right', width: '4rem', value: (r) => r.rank },
                  { key: 'g', header: 'Gene', value: (r) => matrix.genes[r.gene], render: (r) => <span className="font-medium text-slate-900">{matrix.genes[r.gene]}</span> },
                  {
                    key: 'score',
                    header: 'Mean |r| in pathway',
                    align: 'right',
                    value: (r) => Number(r.score.toFixed(4)),
                    render: (r) => (
                      <span className="inline-flex items-center gap-2">
                        <ValueBar value={r.score} />
                        <span className="w-12">{fmt.num(r.score)}</span>
                      </span>
                    ),
                  },
                  { key: 'global', header: 'Rank in full dataset', align: 'right', value: (r) => r.global },
                ]}
              />
            </Card>
          </div>
        )}
      </ToolLayout>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Gene → all genes                                                    */
/* ------------------------------------------------------------------ */

type GeneGenesState = { gene: number | null; sign: 'both' | 'positive' | 'negative'; limitIds: string[]; partners: number };

function GeneToGenes({ matrix }: { matrix: MatrixData }) {
  const { geneSets } = useIvcca();
  const [state, update] = useToolState<GeneGenesState>('gene-genes', { gene: null, sign: 'both', limitIds: [], partners: 25 });
  const { onInitialized, exportAs } = useChartExport('ivcca_gene_r_distribution');
  const limitSet = selectedSets(geneSets, state.limitIds)[0];

  const rows = useMemo(() => {
    if (state.gene === null) return [];
    const g = state.gene;
    const allowed = limitSet ? new Set(matchGenes(matrix, limitSet.genes).matched) : null;
    const out: Array<{ gene: number; r: number }> = [];
    for (let j = 0; j < matrix.n; j += 1) {
      if (j === g || (allowed && !allowed.has(j))) continue;
      out.push({ gene: j, r: matrix.values[g * matrix.n + j] });
    }
    return out.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
  }, [state.gene, matrix, limitSet]);

  const shown = rows.filter((r) => (state.sign === 'both' ? true : state.sign === 'positive' ? r.r > 0 : r.r < 0));
  const strong = rows.filter((r) => Math.abs(r.r) >= 0.7);
  const meanAbs = rows.length ? rows.reduce((s, r) => s + Math.abs(r.r), 0) / rows.length : NaN;
  const geneName = state.gene !== null ? matrix.genes[state.gene] : '';
  const hist = useMemo(() => histogram(Float32Array.from(rows.map((r) => r.r)), 40, -1, 1), [rows]);
  const partnerGenes = state.gene !== null ? [geneName, ...rows.slice(0, state.partners).map((r) => matrix.genes[r.gene])] : [];

  return (
    <div>
      <ToolHeader
        eyebrow="Gene sets"
        title="Gene → genes"
        description="Pick one gene and get its correlation with every other gene in the original dataset, ranked by |r|."
      />
      <ToolLayout
        inputs={
          <>
            <Field label="Gene">
              <GeneCombobox matrix={matrix} value={state.gene} onChange={(gene) => update({ gene })} />
            </Field>
            <Field label="Direction">
              <Segmented
                ariaLabel="Direction"
                value={state.sign}
                onChange={(sign) => update({ sign })}
                options={[
                  { value: 'both', label: 'Both' },
                  { value: 'positive', label: 'Positive' },
                  { value: 'negative', label: 'Negative' },
                ]}
              />
            </Field>
            <Field label="Compare against" hint="By default the gene is compared with every gene in the dataset. Pick a set to restrict the comparison.">
              <Segmented
                ariaLabel="Compare against"
                value={state.limitIds.length ? 'set' : 'all'}
                onChange={(v) => update({ limitIds: v === 'all' ? [] : geneSets[0] ? [geneSets[0].id] : [] })}
                options={[
                  { value: 'all', label: `All ${matrix.n.toLocaleString()} genes` },
                  { value: 'set', label: 'A gene set', disabled: geneSets.length === 0 },
                ]}
              />
            </Field>
            {state.limitIds.length > 0 && (
              <GeneSetPicker mode="single" value={state.limitIds} onChange={(limitIds) => update({ limitIds })} matrix={matrix} />
            )}
            <FullDatasetNote matrix={matrix} />
          </>
        }
      >
        {state.gene === null ? (
          <EmptyState title="Pick a gene" description="Its correlation with every other gene in the dataset appears here." />
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatTile label="Gene" value={geneName} sub={`rank #${matrix.rankOf[state.gene] + 1} of ${matrix.n} by mean |r|`} />
              <StatTile label="Compared with" value={rows.length.toLocaleString()} sub={limitSet ? limitSet.name : 'all other genes'} />
              <StatTile label="Mean |r|" value={fmt.num(meanAbs)} />
              <StatTile
                label="|r| ≥ 0.7"
                value={strong.length.toLocaleString()}
                sub={`${strong.filter((r) => r.r > 0).length} positive · ${strong.filter((r) => r.r < 0).length} negative`}
              />
            </div>
            <div className="grid items-start gap-4 2xl:grid-cols-2">
              <SignedBars
                title={`Strongest partners of ${geneName}`}
                subtitle={`Top ${Math.min(30, shown.length)} by |r| · red positive, blue negative`}
                labels={shown.slice(0, 30).map((r) => matrix.genes[r.gene])}
                values={shown.slice(0, 30).map((r) => r.r)}
                xTitle={`r with ${geneName}`}
                exportName={`ivcca_${geneName}_partners`}
                range={[-1, 1]}
              />
              <Card title={`Distribution of r with ${geneName}`} subtitle={`${rows.length.toLocaleString()} genes`} actions={<ExportMenu onExport={exportAs} />} bodyClassName="p-2">
                <Chart
                  onInitialized={onInitialized}
                  height={320}
                  data={[
                    {
                      type: 'bar',
                      x: hist.centers,
                      y: hist.counts,
                      width: hist.width * 0.86,
                      marker: { color: hist.centers.map((c) => (c >= 0 ? SERIES[7] : SERIES[0])) },
                      hovertemplate: 'r %{x:.2f}<br>%{y} genes<extra></extra>',
                    },
                  ]}
                  layout={{
                    margin: { l: 56, r: 16, t: 12, b: 48 },
                    xaxis: { title: { text: `r with ${geneName}` }, range: [-1, 1], showgrid: false, zeroline: false },
                    yaxis: { title: { text: 'Genes' }, rangemode: 'tozero' },
                    bargap: 0,
                  }}
                />
              </Card>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-violet-200 bg-violet-50/70 px-4 py-3">
              <p className="text-sm text-violet-950">
                <span className="font-semibold">Neighbourhood matrix.</span>{' '}
                <span className="text-violet-900/80">
                  {geneName} plus its {state.partners} strongest partners as a {partnerGenes.length} × {partnerGenes.length} matrix for every tool.
                </span>
              </p>
              <div className="flex items-center gap-2">
                <NumberInput value={state.partners} min={2} max={500} onChange={(v) => update({ partners: v ?? 25 })} className="w-20" />
                <OpenMatrixButton name={`${geneName} + ${state.partners} partners`} genes={partnerGenes} found={partnerGenes.length} />
              </div>
            </div>
            <Card title={`${geneName} vs every gene`}>
              <DataTable
                rows={shown.map((r, i) => ({ ...r, rank: i + 1 }))}
                rowKey={(r) => String(r.gene)}
                exportName={`ivcca_${geneName}_gene_to_genes`}
                searchKeys={[(r) => matrix.genes[r.gene]]}
                maxHeight={520}
                columns={[
                  { key: 'rank', header: '#', align: 'right', width: '4rem', value: (r) => r.rank },
                  { key: 'g', header: 'Gene', value: (r) => matrix.genes[r.gene], render: (r) => <span className="font-medium text-slate-900">{matrix.genes[r.gene]}</span> },
                  {
                    key: 'r',
                    header: 'r',
                    align: 'right',
                    value: (r) => Number(r.r.toFixed(4)),
                    render: (r) => (
                      <span className="inline-flex items-center gap-2">
                        <ValueBar value={r.r} signed />
                        <span className="w-14">{fmt.r(r.r)}</span>
                      </span>
                    ),
                  },
                  { key: 'abs', header: '|r|', align: 'right', value: (r) => Number(Math.abs(r.r).toFixed(4)), render: (r) => fmt.num(Math.abs(r.r)) },
                ]}
              />
            </Card>
          </div>
        )}
      </ToolLayout>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Gene → pathways                                                     */
/* ------------------------------------------------------------------ */

type GenePathwaysState = { gene: number | null; setIds: string[]; detail: string | null };

type PathwayCoupling = {
  set: GeneSet;
  idx: number[];
  missing: string[];
  containsGene: boolean;
  values: Array<{ gene: number; r: number }>;
  mean: number;
  meanAbs: number;
  strong: number;
};

function GeneToPathways({ matrix }: { matrix: MatrixData }) {
  const { geneSets } = useIvcca();
  const [state, update] = useToolState<GenePathwaysState>('gene-pathways', { gene: null, setIds: [], detail: null });
  const sets = selectedSets(geneSets, state.setIds);
  const { onInitialized, exportAs } = useChartExport('ivcca_gene_to_pathways');

  const couplings = useMemo<PathwayCoupling[]>(() => {
    if (state.gene === null) return [];
    const g = state.gene;
    return sets
      .map((set) => {
        const { matched, missing } = matchGenes(matrix, set.genes);
        const idx = matched.filter((j) => j !== g);
        const values = idx.map((j) => ({ gene: j, r: matrix.values[g * matrix.n + j] })).sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
        const mean = values.length ? values.reduce((s, v) => s + v.r, 0) / values.length : NaN;
        const meanAbs = values.length ? values.reduce((s, v) => s + Math.abs(v.r), 0) / values.length : NaN;
        return {
          set,
          idx: matched,
          missing,
          containsGene: matched.includes(g),
          values,
          mean,
          meanAbs,
          strong: values.filter((v) => Math.abs(v.r) >= 0.7).length,
        };
      })
      .sort((a, b) => (b.meanAbs || 0) - (a.meanAbs || 0));
  }, [state.gene, sets, matrix]);

  const geneName = state.gene !== null ? matrix.genes[state.gene] : '';
  const detail = couplings.find((c) => c.set.id === state.detail) ?? couplings[0];
  const labels = couplings.map((c) => c.set.name);

  return (
    <div>
      <ToolHeader
        eyebrow="Gene sets"
        title="Gene → pathways"
        description="Each pathway is first found in the original dataset (its own matrix); then the gene's correlation with every gene of that pathway is reported."
      />
      <ToolLayout
        inputs={
          <>
            <Field label="Gene">
              <GeneCombobox matrix={matrix} value={state.gene} onChange={(gene) => update({ gene })} />
            </Field>
            <Field label="Pathways">
              <GeneSetPicker mode="multi" value={state.setIds} onChange={(setIds) => update({ setIds })} matrix={matrix} />
            </Field>
            <FullDatasetNote matrix={matrix} />
          </>
        }
      >
        {state.gene === null || !sets.length ? (
          <EmptyState title="Choose a gene and one or more pathways" description="The gene is correlated with every member of each pathway found in the dataset." />
        ) : (
          <div className="space-y-4">
            {couplings.length > 1 && (
              <Card title={`${geneName} · coupling to ${couplings.length} pathways`} subtitle="Click a pathway in the table below for gene-level detail" actions={<ExportMenu onExport={exportAs} />} bodyClassName="p-2">
                <Chart
                  onInitialized={onInitialized}
                  height={Math.max(240, Math.min(900, couplings.length * 40 + 110))}
                  data={[
                    { type: 'bar', orientation: 'h', name: 'Mean |r|', y: labels, x: couplings.map((c) => c.meanAbs), marker: { color: SERIES[0] }, hovertemplate: '<b>%{y}</b><br>Mean |r| %{x:.3f}<extra></extra>' },
                    { type: 'bar', orientation: 'h', name: 'Mean r', y: labels, x: couplings.map((c) => c.mean), marker: { color: SERIES[1] }, hovertemplate: '<b>%{y}</b><br>Mean r %{x:.3f}<extra></extra>' },
                  ]}
                  layout={{
                    barmode: 'group',
                    bargap: 0.3,
                    bargroupgap: 0.08,
                    margin: { l: 12, r: 24, t: 8, b: 48 },
                    xaxis: { title: { text: `Correlation with ${geneName}` }, range: [-1, 1], zerolinecolor: INK.axis },
                    yaxis: { type: 'category', autorange: 'reversed', automargin: true, showgrid: false, tickfont: { size: 11, color: INK.primary } },
                    legend: { orientation: 'h', x: 0, y: 1.02, yanchor: 'bottom' },
                  }}
                />
              </Card>
            )}
            <Card title="Pathways">
              <DataTable
                rows={couplings}
                rowKey={(r) => r.set.id}
                exportName={`ivcca_${geneName}_gene_to_pathways`}
                onRowClick={(r) => update({ detail: r.set.id })}
                isRowActive={(r) => r.set.id === detail?.set.id}
                columns={[
                  {
                    key: 'p',
                    header: 'Pathway',
                    value: (r) => r.set.name,
                    render: (r) => (
                      <span className="inline-flex items-center gap-2 font-medium text-slate-900">
                        {r.set.name}
                        {r.containsGene && <Badge tone="teal">contains {geneName}</Badge>}
                      </span>
                    ),
                  },
                  { key: 'listed', header: 'Listed', align: 'right', value: (r) => r.set.genes.length },
                  { key: 'found', header: 'In data', align: 'right', value: (r) => r.idx.length },
                  { key: 'mean', header: 'Mean r', align: 'right', value: (r) => Number((r.mean || 0).toFixed(4)), render: (r) => fmt.r(r.mean) },
                  { key: 'abs', header: 'Mean |r|', align: 'right', value: (r) => Number((r.meanAbs || 0).toFixed(4)), render: (r) => fmt.num(r.meanAbs) },
                  { key: 'strong', header: '|r| ≥ 0.7', align: 'right', value: (r) => r.strong },
                ]}
              />
            </Card>

            {detail && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-violet-200 bg-violet-50/70 px-4 py-3">
                  <p className="min-w-0 text-sm text-violet-950">
                    <span className="font-semibold">{detail.set.name}</span>{' '}
                    <span className="text-violet-900/80">
                      — {detail.idx.length} of {detail.set.genes.length} genes in the dataset
                      {detail.containsGene ? ` (including ${geneName}, excluded from its own average)` : ''}.
                    </span>
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <OpenMatrixButton
                      variant="secondary"
                      name={detail.set.name}
                      genes={detail.set.genes}
                      found={detail.idx.length}
                      sourceSetId={detail.set.id}
                      label={`Pathway matrix (${detail.idx.length}×${detail.idx.length})`}
                    />
                    {!detail.containsGene && (
                      <OpenMatrixButton
                        name={`${detail.set.name} + ${geneName}`}
                        genes={[geneName, ...detail.set.genes]}
                        found={detail.idx.length + 1}
                        label={`With ${geneName} (${detail.idx.length + 1}×${detail.idx.length + 1})`}
                      />
                    )}
                  </div>
                </div>
                <MissingGenes missing={detail.missing} />
                <SignedBars
                  title={`${geneName} vs each gene of ${detail.set.name}`}
                  subtitle={`${detail.values.length > 60 ? 'Strongest 60 by |r|' : 'Sorted by |r|'} · red positive, blue negative`}
                  labels={detail.values.slice(0, 60).map((v) => matrix.genes[v.gene])}
                  values={detail.values.slice(0, 60).map((v) => v.r)}
                  xTitle={`r with ${geneName}`}
                  exportName={`ivcca_${geneName}_vs_${detail.set.name}`}
                  range={[-1, 1]}
                />
                <Card title={`${geneName} × ${detail.set.name}`}>
                  <DataTable
                    rows={detail.values.map((v, i) => ({ ...v, rank: i + 1 }))}
                    rowKey={(r) => String(r.gene)}
                    exportName={`ivcca_${geneName}_vs_${stripExt(detail.set.name)}`}
                    searchKeys={[(r) => matrix.genes[r.gene]]}
                    columns={[
                      { key: 'rank', header: '#', align: 'right', width: '4rem', value: (r) => r.rank },
                      { key: 'g', header: 'Pathway gene', value: (r) => matrix.genes[r.gene], render: (r) => <span className="font-medium text-slate-900">{matrix.genes[r.gene]}</span> },
                      {
                        key: 'r',
                        header: 'r',
                        align: 'right',
                        value: (r) => Number(r.r.toFixed(4)),
                        render: (r) => (
                          <span className="inline-flex items-center gap-2">
                            <ValueBar value={r.r} signed />
                            <span className="w-14">{fmt.r(r.r)}</span>
                          </span>
                        ),
                      },
                    ]}
                  />
                </Card>
              </>
            )}
          </div>
        )}
      </ToolLayout>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Multi-pathway CECI                                                  */
/* ------------------------------------------------------------------ */

type CeciState = { setIds: string[]; minGenes: number; useSorted: boolean; result: (MultiPathwayResponse & { requested: string[] }) | null };

function Ceci({ matrix }: { matrix: MatrixData }) {
  const { geneSets, run, busy, errors, clearError } = useIvcca();
  const [state, update] = useToolState<CeciState>('ceci', { setIds: [], minGenes: 5, useSorted: false, result: null });
  const sets = selectedSets(geneSets, state.setIds);
  const res = state.result;
  const { onInitialized, exportAs } = useChartExport('ivcca_ceci');

  const compute = async () => {
    if (!sets.length) return;
    const out = await run({ key: 'ceci', label: `CECI for ${sets.length} pathways` }, (id) =>
      ivccaApi.multiPathway(id, sets, state.minGenes, state.useSorted),
    );
    if (out) update({ result: { ...out, requested: sets.map((s) => s.name) } });
  };

  const rows = res?.pathways ?? [];
  const skipped = res ? res.requested.filter((name) => !rows.some((r) => stripExt(r.pathway_file) === name.replace(/[\\/:*?"<>|]+/g, '_').trim())) : [];
  const significant = rows.filter((r) => (r.z_score ?? 0) >= 1.96).length;
  const zLine = 7.908 + 1.96 * 2.0605;

  return (
    <div>
      <ToolHeader
        eyebrow="Gene sets"
        title="Multi-pathway analysis (CECI)"
        description="Correlation–Expression Composite Index per pathway: coverage of the pathway in your data (PAI) × internal correlation (PCI), scaled ×100 and standardised to a z-score."
      />
      <InlineError message={errors.ceci} onDismiss={() => clearError('ceci')} />
      <ToolLayout
        inputs={
          <>
            <Field label="Pathways">
              <GeneSetPicker mode="multi" value={state.setIds} onChange={(setIds) => update({ setIds })} matrix={matrix} />
            </Field>
            <Field label="Minimum genes found" hint="Pathways with fewer genes in the dataset are skipped.">
              <NumberInput value={state.minGenes} min={2} max={100} onChange={(v) => update({ minGenes: v ?? 5 })} />
            </Field>
            <Toggle
              checked={state.useSorted}
              onChange={(useSorted) => update({ useSorted })}
              label={
                <span>
                  Use PCI-B <span className="text-xs text-slate-500">(scores from the sorted matrix)</span>
                </span>
              }
            />
            <Btn variant="primary" className="w-full" icon={<Play className="h-4 w-4" />} loading={Boolean(busy.ceci)} disabled={!sets.length} onClick={() => void compute()}>
              Compute CECI for {sets.length || ''} pathway{sets.length === 1 ? '' : 's'}
            </Btn>
            <FullDatasetNote matrix={matrix} />
          </>
        }
      >
        {!res ? (
          <EmptyState title="Select pathways to score" description="CECI ranks pathways by how completely and how coherently they are represented in your correlation structure." />
        ) : (
          <BusyOverlay busy={Boolean(busy.ceci)}>
            <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatTile label="Pathways scored" value={rows.length} sub={`${res.requested.length} submitted`} />
              <StatTile label="z ≥ 1.96" value={significant} sub="above the reference distribution" />
              <StatTile label="Top pathway" value={<span className="block truncate text-base">{rows[0] ? stripExt(rows[0].pathway_file) : '—'}</span>} />
              <StatTile label="Top CECI" value={fmt.num(rows[0]?.ceci, 2)} />
            </div>
            {skipped.length > 0 && (
              <div className="mb-4">
                <Notice tone="warn">Skipped (fewer than {state.minGenes} genes in the data): {skipped.join(', ')}</Notice>
              </div>
            )}
            {rows.length > 0 && (
              <Card title="CECI by pathway" subtitle="Dark bars: z ≥ 1.96 · dotted line marks z = 1.96" actions={<ExportMenu onExport={exportAs} />} bodyClassName="p-2">
                <Chart
                  onInitialized={onInitialized}
                  height={Math.max(260, Math.min(900, rows.length * 30 + 100))}
                  data={[
                    {
                      type: 'bar',
                      orientation: 'h',
                      y: rows.map((r) => stripExt(r.pathway_file)),
                      x: rows.map((r) => r.ceci ?? 0),
                      customdata: rows.map((r) => [r.z_score ?? 0, r.pai, r.pci_b ?? r.pci_a]),
                      marker: { color: rows.map((r) => ((r.z_score ?? 0) >= 1.96 ? SERIES[0] : '#9ec5f4')) },
                      width: 0.65,
                      hovertemplate: '<b>%{y}</b><br>CECI %{x:.2f}<br>z = %{customdata[0]:.2f}<br>PAI %{customdata[1]:.3f} · PCI %{customdata[2]:.3f}<extra></extra>',
                    },
                  ]}
                  layout={{
                    margin: { l: 12, r: 24, t: 24, b: 48 },
                    xaxis: { title: { text: 'CECI' }, zeroline: false, rangemode: 'tozero' },
                    yaxis: { type: 'category', autorange: 'reversed', automargin: true, showgrid: false, tickfont: { size: 11, color: INK.primary } },
                    shapes: [{ type: 'line', xref: 'x', yref: 'paper', x0: zLine, x1: zLine, y0: 0, y1: 1, line: { color: INK.primary, width: 1, dash: 'dot' } }],
                    annotations: [{ x: zLine, y: 1, xref: 'x', yref: 'paper', yanchor: 'bottom', text: 'z = 1.96', showarrow: false, font: { size: 11, color: INK.secondary } }],
                    showlegend: false,
                  }}
                />
              </Card>
            )}
            <Card className="mt-4" title="Pathway scores">
              <DataTable<MultiPathwayRow>
                rows={rows}
                rowKey={(r) => r.pathway_file}
                exportName="ivcca_ceci"
                searchKeys={[(r) => r.pathway_file]}
                initialSort={{ key: 'ceci', dir: 'desc' }}
                columns={[
                  { key: 'p', header: 'Pathway', value: (r) => stripExt(r.pathway_file), render: (r) => <span className="font-medium text-slate-900">{stripExt(r.pathway_file)}</span> },
                  { key: 'total', header: 'Listed', align: 'right', value: (r) => r.total_genes_in_pathway },
                  { key: 'found', header: 'In data', align: 'right', value: (r) => r.genes_found_in_set },
                  { key: 'pai', header: 'PAI', align: 'right', value: (r) => Number(r.pai.toFixed(4)), render: (r) => fmt.num(r.pai) },
                  { key: 'pcia', header: 'PCI-A', align: 'right', value: (r) => Number(r.pci_a.toFixed(4)), render: (r) => fmt.num(r.pci_a) },
                  { key: 'pcib', header: 'PCI-B', align: 'right', value: (r) => (r.pci_b === null ? null : Number(r.pci_b.toFixed(4))), render: (r) => fmt.num(r.pci_b) },
                  { key: 'ceci', header: 'CECI', align: 'right', value: (r) => (r.ceci === null ? null : Number(r.ceci.toFixed(3))), render: (r) => <span className="font-semibold text-slate-900">{fmt.num(r.ceci, 2)}</span> },
                  {
                    key: 'z',
                    header: 'z-score',
                    align: 'right',
                    value: (r) => (r.z_score === null ? null : Number(r.z_score.toFixed(3))),
                    render: (r) => (
                      <span className="inline-flex items-center gap-1.5">
                        {fmt.num(r.z_score, 2)}
                        {(r.z_score ?? 0) >= 1.96 && <Badge tone="teal">z ≥ 1.96</Badge>}
                      </span>
                    ),
                  },
                ]}
              />
            </Card>
          </BusyOverlay>
        )}
      </ToolLayout>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pathway ↔ pathway                                                   */
/* ------------------------------------------------------------------ */

type CompareState = {
  a: string[];
  b: string[];
  basis: 'listed' | 'dataset';
  cosine: (ComparePathwaysResponse & { a: string; b: string; key: string }) | null;
};

type Relationship = 'identical' | 'a-in-b' | 'b-in-a' | 'partial' | 'disjoint';

function relationshipOf(onlyA: number, both: number, onlyB: number): Relationship {
  if (both === 0) return 'disjoint';
  if (onlyA === 0 && onlyB === 0) return 'identical';
  if (onlyA === 0) return 'a-in-b';
  if (onlyB === 0) return 'b-in-a';
  return 'partial';
}

/** Area-proportional two-circle Venn: solve the centre distance for the overlap area by bisection. */
function vennGeometry(sizeA: number, sizeB: number, overlap: number) {
  const rA = Math.sqrt(sizeA / Math.PI);
  const rB = Math.sqrt(sizeB / Math.PI);
  const lens = (d: number) => {
    if (d >= rA + rB) return 0;
    if (d <= Math.abs(rA - rB)) return Math.PI * Math.min(rA, rB) ** 2;
    const a = rA * rA * Math.acos((d * d + rA * rA - rB * rB) / (2 * d * rA));
    const b = rB * rB * Math.acos((d * d + rB * rB - rA * rA) / (2 * d * rB));
    const c = 0.5 * Math.sqrt((-d + rA + rB) * (d + rA - rB) * (d - rA + rB) * (d + rA + rB));
    return a + b - c;
  };
  if (overlap <= 0) return { rA, rB, d: rA + rB + Math.max(rA, rB) * 0.15 };
  let lo = Math.abs(rA - rB);
  let hi = rA + rB;
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    if (lens(mid) > overlap) lo = mid;
    else hi = mid;
  }
  return { rA, rB, d: (lo + hi) / 2 };
}

function Venn({ nameA, nameB, onlyA, both, onlyB }: { nameA: string; nameB: string; onlyA: number; both: number; onlyB: number }) {
  const W = 520;
  const H = 260;
  const g = vennGeometry(Math.max(1, onlyA + both), Math.max(1, onlyB + both), both);
  // Circle A is centred at 0, circle B at d; fit their combined extent into the canvas.
  const left = Math.min(-g.rA, g.d - g.rB);
  const right = Math.max(g.rA, g.d + g.rB);
  const scale = Math.min((W - 40) / (right - left), (H - 24) / (2 * Math.max(g.rA, g.rB)));
  const cx0 = W / 2 - ((left + right) / 2) * scale;
  const cx1 = cx0 + g.d * scale;
  const cy = H / 2;
  const leftA = cx0 - g.rA * scale;
  const rightA = cx0 + g.rA * scale;
  const leftB = cx1 - g.rB * scale;
  const rightB = cx1 + g.rB * scale;
  // Label positions: the exclusive part of each circle and the lens between them.
  const xOnlyA = (leftA + Math.min(leftB, rightA)) / 2;
  const xBoth = (Math.max(leftA, leftB) + Math.min(rightA, rightB)) / 2;
  const xOnlyB = (Math.max(rightA, leftB) + rightB) / 2;
  const nested = onlyA === 0 || onlyB === 0;
  return (
    <div className="flex w-full flex-col items-center">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full max-w-[520px]" role="img" aria-label={`Venn diagram: ${onlyA} only in ${nameA}, ${both} shared, ${onlyB} only in ${nameB}`}>
        <circle cx={cx0} cy={cy} r={g.rA * scale} fill={SERIES[0]} fillOpacity={0.16} stroke={SERIES[0]} strokeWidth={2} />
        <circle cx={cx1} cy={cy} r={g.rB * scale} fill={SERIES[1]} fillOpacity={0.16} stroke={SERIES[1]} strokeWidth={2} />
        {onlyA > 0 && (
          <text x={nested && onlyB === 0 ? cx0 - g.rA * scale * 0.55 : xOnlyA} y={cy + 6} textAnchor="middle" fontSize={20} fontWeight={600} fill={INK.primary}>
            {onlyA}
          </text>
        )}
        {both > 0 && (
          <text x={xBoth} y={cy + 6} textAnchor="middle" fontSize={20} fontWeight={600} fill={INK.primary}>
            {both}
          </text>
        )}
        {onlyB > 0 && (
          <text x={nested && onlyA === 0 ? cx1 + g.rB * scale * 0.55 : xOnlyB} y={cy + 6} textAnchor="middle" fontSize={20} fontWeight={600} fill={INK.primary}>
            {onlyB}
          </text>
        )}
      </svg>
      <div className="mt-2 flex flex-wrap justify-center gap-x-6 gap-y-1 text-sm text-slate-700">
        {[
          { name: nameA, color: SERIES[0], size: onlyA + both },
          { name: nameB, color: SERIES[1], size: onlyB + both },
        ].map((s, i) => (
          <span key={i} className="inline-flex items-center gap-2">
            <span className="h-3 w-3 rounded-full border-2" style={{ borderColor: s.color, background: `${s.color}2e` }} />
            <span className="font-medium">{s.name}</span>
            <span className="tabular-nums text-slate-500">{s.size}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function GeneList({ title, genes }: { title: string; genes: string[] }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="min-w-0 rounded-lg border border-slate-200 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="truncate text-xs font-semibold text-slate-700" title={title}>
          {title} <span className="font-normal text-slate-400">({genes.length})</span>
        </p>
        <button
          type="button"
          disabled={!genes.length}
          onClick={() => {
            void navigator.clipboard?.writeText(genes.join('\n'));
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
          className="inline-flex shrink-0 items-center gap-1 text-xs text-slate-500 hover:text-slate-900 disabled:opacity-40"
        >
          <Copy className="h-3 w-3" />
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="flex max-h-40 flex-wrap gap-1 overflow-auto">
        {genes.length === 0 ? (
          <span className="text-xs text-slate-400">None</span>
        ) : (
          genes.map((g) => (
            <span key={g} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700">
              {g}
            </span>
          ))
        )}
      </div>
    </div>
  );
}

const RELATIONSHIP_TEXT: Record<Relationship, (a: string, b: string) => { title: string; detail: string }> = {
  identical: (a, b) => ({ title: 'Identical sets', detail: `${a} and ${b} contain exactly the same genes.` }),
  'a-in-b': (a, b) => ({ title: `${a} is inside ${b}`, detail: `Every gene of ${a} is also in ${b}.` }),
  'b-in-a': (a, b) => ({ title: `${b} is inside ${a}`, detail: `Every gene of ${b} is also in ${a}.` }),
  partial: (a, b) => ({ title: 'Partial overlap', detail: `${a} and ${b} share some genes; each also has genes of its own.` }),
  disjoint: (a, b) => ({ title: 'No overlap', detail: `${a} and ${b} share no genes.` }),
};

function CompareSets({ matrix }: { matrix: MatrixData }) {
  const { geneSets, run, busy, errors, clearError } = useIvcca();
  const [state, update] = useToolState<CompareState>('compare', { a: [], b: [], basis: 'listed', cosine: null });
  const setA = selectedSets(geneSets, state.a)[0];
  const setB = selectedSets(geneSets, state.b)[0];
  const ready = Boolean(setA && setB && setA.id !== setB.id);
  const pairKey = ready ? `${setA!.id}|${setB!.id}` : '';
  const cosine = state.cosine?.key === pairKey ? state.cosine : null;

  const computeCosine = async () => {
    if (!setA || !setB) return;
    const out = await run({ key: 'compare', label: `Cosine similarity ${setA.name} vs ${setB.name}` }, (id) => ivccaApi.comparePathways(id, setA, setB));
    if (out) update({ cosine: { ...out, a: setA.name, b: setB.name, key: `${setA.id}|${setB.id}` } });
  };

  // The IVCCA cosine similarity comes from the backend; fetch it as soon as a new pair is chosen.
  useEffect(() => {
    if (ready && state.cosine?.key !== pairKey && !busy.compare && !errors.compare) void computeCosine();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairKey]);

  const analysis = useMemo(() => {
    if (!setA || !setB || setA.id === setB.id) return null;
    const mA = matchGenes(matrix, setA.genes);
    const mB = matchGenes(matrix, setB.genes);

    // Membership — by listed symbol (case-insensitive) or by dataset gene
    let onlyA: string[];
    let both: string[];
    let onlyB: string[];
    if (state.basis === 'listed') {
      const lowerB = new Set(setB.genes.map((g) => g.toLowerCase()));
      const lowerA = new Set(setA.genes.map((g) => g.toLowerCase()));
      both = setA.genes.filter((g) => lowerB.has(g.toLowerCase()));
      onlyA = setA.genes.filter((g) => !lowerB.has(g.toLowerCase()));
      onlyB = setB.genes.filter((g) => !lowerA.has(g.toLowerCase()));
    } else {
      const inB = new Set(mB.matched);
      const inA = new Set(mA.matched);
      both = mA.matched.filter((i) => inB.has(i)).map((i) => matrix.genes[i]);
      onlyA = mA.matched.filter((i) => !inB.has(i)).map((i) => matrix.genes[i]);
      onlyB = mB.matched.filter((i) => !inA.has(i)).map((i) => matrix.genes[i]);
    }

    const cross = crossStats(matrix, mA.matched, mB.matched);
    const within = { a: withinStats(matrix, mA.matched), b: withinStats(matrix, mB.matched) };
    const union = [...mA.matched, ...mB.matched.filter((i) => !mA.matched.includes(i))];
    const shared = mA.matched.filter((i) => mB.matched.includes(i));
    // Order heatmap rows/columns by similarity to the other group
    const rows = cross.aToB.map((x) => x.gene);
    const cols = cross.bToA.map((x) => x.gene);
    return { mA, mB, onlyA, both, onlyB, cross, within, union, shared, rows, cols, relationship: relationshipOf(onlyA.length, both.length, onlyB.length) };
  }, [setA, setB, matrix, state.basis]);

  const jaccard = analysis ? analysis.both.length / Math.max(1, analysis.both.length + analysis.onlyA.length + analysis.onlyB.length) : 0;
  const rel = analysis && setA && setB ? RELATIONSHIP_TEXT[analysis.relationship](setA.name, setB.name) : null;

  return (
    <div>
      <ToolHeader
        eyebrow="Gene sets"
        title="Pathway ↔ pathway"
        description="Compare two gene groups: do they overlap (Venn), how similar are their correlation profiles, which genes tie them together — and open either group, their union or their overlap as a matrix for every tool."
      />
      <InlineError message={errors.compare} onDismiss={() => clearError('compare')} />
      <ToolLayout
        inputs={
          <>
            <Field label="Pathway A">
              <GeneSetPicker mode="single" value={state.a} onChange={(a) => update({ a })} matrix={matrix} />
            </Field>
            <Field label="Pathway B">
              <GeneSetPicker mode="single" value={state.b} onChange={(b) => update({ b })} matrix={matrix} />
            </Field>
            {setA && setB && setA.id === setB.id && <Notice tone="warn">Pick two different gene sets.</Notice>}
            <FullDatasetNote matrix={matrix} />
          </>
        }
      >
        {!analysis || !setA || !setB || !rel ? (
          <EmptyState title="Pick two gene sets" description="Results appear as soon as both pathways are selected." />
        ) : (
          <div className="space-y-4">
            <div className="grid items-start gap-4 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <Card
                title="Overlap"
                subtitle={state.basis === 'listed' ? 'Gene symbols as listed' : 'Only genes found in the dataset'}
                actions={
                  <Segmented
                    size="sm"
                    ariaLabel="Venn basis"
                    value={state.basis}
                    onChange={(basis) => update({ basis })}
                    options={[
                      { value: 'listed', label: 'Listed genes' },
                      { value: 'dataset', label: 'In dataset' },
                    ]}
                  />
                }
              >
                <div className="mb-3 rounded-lg bg-slate-50 px-3 py-2">
                  <p className="text-base font-semibold text-slate-900">{rel.title}</p>
                  <p className="text-xs text-slate-600">{rel.detail}</p>
                </div>
                <Venn nameA={setA.name} nameB={setB.name} onlyA={analysis.onlyA.length} both={analysis.both.length} onlyB={analysis.onlyB.length} />
              </Card>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <StatTile label="Mean |r| between A and B" value={fmt.num(analysis.cross.meanAbs)} sub={`${analysis.cross.pairs.toLocaleString()} cross pairs · mean r ${fmt.r(analysis.cross.mean)}`} />
                  <StatTile
                    label="Cosine similarity"
                    value={cosine ? fmt.num(cosine.cosine_similarity) : '—'}
                    sub={
                      cosine ? (
                        'of mean-|r| profiles (IVCCA)'
                      ) : (
                        <button type="button" onClick={() => void computeCosine()} className="font-medium text-teal-700 hover:text-teal-900" disabled={busy.compare}>
                          {busy.compare ? 'Computing…' : 'Compute'}
                        </button>
                      )
                    }
                  />
                  <StatTile label={`Mean |r| within A`} value={fmt.num(analysis.within.a.meanAbs)} sub={`${analysis.mA.matched.length} of ${setA.genes.length} genes in data`} />
                  <StatTile label={`Mean |r| within B`} value={fmt.num(analysis.within.b.meanAbs)} sub={`${analysis.mB.matched.length} of ${setB.genes.length} genes in data`} />
                  <StatTile label="Shared genes" value={analysis.both.length} sub={`Jaccard ${fmt.num(jaccard, 2)}`} />
                  <StatTile
                    label="Between vs within"
                    value={fmt.num(analysis.cross.meanAbs / Math.max(1e-9, (analysis.within.a.meanAbs + analysis.within.b.meanAbs) / 2), 2)}
                    sub="≈ 1: the groups co-vary as one"
                  />
                </div>
                <Card title="Open as a matrix" subtitle="Genes from the original dataset — every tool then runs on the chosen matrix">
                  <div className="flex flex-wrap gap-2">
                    <OpenMatrixButton name={`${setA.name} ∪ ${setB.name}`} genes={analysis.union.map((i) => matrix.genes[i])} found={analysis.union.length} label={`A ∪ B (${analysis.union.length})`} />
                    <OpenMatrixButton
                      variant="secondary"
                      name={`${setA.name} ∩ ${setB.name}`}
                      genes={analysis.shared.map((i) => matrix.genes[i])}
                      found={analysis.shared.length}
                      label={`A ∩ B (${analysis.shared.length})`}
                    />
                    <OpenMatrixButton variant="secondary" name={setA.name} genes={setA.genes} found={analysis.mA.matched.length} sourceSetId={setA.id} label={`A (${analysis.mA.matched.length})`} />
                    <OpenMatrixButton variant="secondary" name={setB.name} genes={setB.genes} found={analysis.mB.matched.length} sourceSetId={setB.id} label={`B (${analysis.mB.matched.length})`} />
                  </div>
                </Card>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <GeneList title={`Only in ${setA.name}`} genes={analysis.onlyA} />
              <GeneList title="In both" genes={analysis.both} />
              <GeneList title={`Only in ${setB.name}`} genes={analysis.onlyB} />
            </div>

            {analysis.rows.length > 0 && analysis.cols.length > 0 && (
              <BlockHeatmap
                matrix={matrix}
                rows={analysis.rows}
                cols={analysis.cols}
                title={`Cross-correlation · ${setA.name} (rows) × ${setB.name} (columns)`}
                subtitle="Genes ordered by mean |r| to the other pathway — the top-left corner holds the genes linking the two groups"
                exportName="ivcca_pathway_cross_correlation"
                rowTitle={setA.name}
                colTitle={setB.name}
              />
            )}

            <div className="grid items-start gap-4 xl:grid-cols-2">
              {[
                { title: `${setA.name} genes most similar to ${setB.name}`, list: analysis.cross.aToB },
                { title: `${setB.name} genes most similar to ${setA.name}`, list: analysis.cross.bToA },
              ].map((block) => (
                <Card key={block.title} title={block.title} subtitle="Mean |r| to the genes of the other pathway">
                  <DataTable
                    rows={block.list.map((x, i) => ({ ...x, rank: i + 1, shared: analysis.shared.includes(x.gene) }))}
                    rowKey={(r) => String(r.gene)}
                    exportName="ivcca_pathway_similar_genes"
                    searchKeys={[(r) => matrix.genes[r.gene]]}
                    maxHeight={360}
                    columns={[
                      { key: 'rank', header: '#', align: 'right', width: '3.5rem', value: (r) => r.rank },
                      {
                        key: 'g',
                        header: 'Gene',
                        value: (r) => matrix.genes[r.gene],
                        render: (r) => (
                          <span className="inline-flex items-center gap-2 font-medium text-slate-900">
                            {matrix.genes[r.gene]}
                            {r.shared && <Badge tone="teal">in both</Badge>}
                          </span>
                        ),
                      },
                      {
                        key: 's',
                        header: 'Mean |r|',
                        align: 'right',
                        value: (r) => Number(r.score.toFixed(4)),
                        render: (r) => (
                          <span className="inline-flex items-center gap-2">
                            <ValueBar value={r.score} />
                            <span className="w-12">{fmt.num(r.score)}</span>
                          </span>
                        ),
                      },
                    ]}
                  />
                </Card>
              ))}
            </div>
            <p className="flex items-center gap-1.5 text-xs text-slate-500">
              <ArrowRight className="h-3.5 w-3.5" />
              Open any of the matrices above to run the heatmap, PCA, t-SNE, dendrogram or network on it.
            </p>
          </div>
        )}
      </ToolLayout>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function SinglePathwayPanel() {
  return <RequireRootMatrix>{(m) => <SinglePathway matrix={m} />}</RequireRootMatrix>;
}
export function GeneToGenesPanel() {
  return <RequireRootMatrix>{(m) => <GeneToGenes matrix={m} />}</RequireRootMatrix>;
}
export function GeneToPathwaysPanel() {
  return <RequireRootMatrix>{(m) => <GeneToPathways matrix={m} />}</RequireRootMatrix>;
}
export function CeciPanel() {
  return <RequireRootMatrix>{(m) => <Ceci matrix={m} />}</RequireRootMatrix>;
}
export function CompareSetsPanel() {
  return <RequireRootMatrix>{(m) => <CompareSets matrix={m} />}</RequireRootMatrix>;
}
