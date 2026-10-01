'use client';

import { useMemo, useState } from 'react';
import { Crosshair, Download, Save, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Chart, ExportMenu, useChartExport } from '../Chart';
import type { ChartEvent } from '../Chart';
import { useDraft, useElementWidth, useViewportHeight } from '../hooks';
import {
  autoRange,
  buildHeatmapGrid,
  corr,
  downloadText,
  orderFor,
  partners,
  toCsv,
} from '../matrix';
import type { HeatmapGrid, HeatmapOrder } from '../matrix';
import { GeneCombobox } from '../pickers';
import { useIvcca, useToolState } from '../store';
import { INK, PALETTES, fmt } from '../theme';
import type { PaletteId } from '../theme';
import type { MatrixData } from '../types';
import {
  Btn,
  Card,
  ControlBar,
  Field,
  Menu,
  Notice,
  SearchInput,
  Segmented,
  SelectInput,
  Slider,
  ToolHeader,
  ValueBar,
} from '../ui';
import { RequireMatrix } from './common';

type HeatmapState = {
  layout: 'single' | 'compare';
  order: HeatmapOrder;
  values: 'signed' | 'abs';
  valuesTouched: boolean;
  triangle: 'lower' | 'full';
  divergingPalette: PaletteId;
  sequentialPalette: PaletteId;
  range: 'full' | 'auto';
  topN: number | null;
  minAbs: number;
  labels: 'auto' | 'all' | 'none';
  focus: number | null;
  pair: { a: number; b: number } | null;
  inspector: 'gene' | 'ranking';
};

const INITIAL: HeatmapState = {
  layout: 'single',
  order: 'original',
  values: 'signed',
  valuesTouched: false,
  triangle: 'lower',
  divergingPalette: 'blue-red',
  sequentialPalette: 'blues',
  range: 'full',
  topN: null,
  minAbs: 0,
  labels: 'auto',
  focus: null,
  pair: null,
  inspector: 'ranking',
};

const DEFAULT_MAX_GENES = 600;

const ORDER_LABEL: Record<HeatmapOrder, string> = {
  original: 'Original order',
  sorted: 'Sorted by mean |r|',
  clustered: 'Hierarchically clustered',
};

type View = { order: HeatmapOrder; abs: boolean };

function viewTitle(v: View) {
  return `${ORDER_LABEL[v.order]} · ${v.abs ? '|r|' : 'r'}`;
}

/* ------------------------------------------------------------------ */
/* One heatmap figure                                                  */
/* ------------------------------------------------------------------ */

function HeatmapFigure({
  matrix,
  grid,
  view,
  state,
  width,
  height,
  onCellClick,
  exportName,
}: {
  matrix: MatrixData;
  grid: HeatmapGrid;
  view: View;
  state: HeatmapState;
  width: number;
  height: number;
  onCellClick: (a: number, b: number) => void;
  exportName: string;
}) {
  const { onInitialized, exportAs } = useChartExport(exportName);
  const k = grid.indices.length;
  const paletteId = view.abs ? state.sequentialPalette : state.divergingPalette;
  const palette = PALETTES[paletteId];

  const [zmin, zmax] = useMemo(() => {
    if (state.range === 'auto') return autoRange(grid, view.abs);
    return view.abs ? [0, 1] : [-1, 1];
  }, [grid, view.abs, state.range]);

  const plotSide = Math.max(200, height - 24);
  const cellPx = plotSide / Math.max(1, k);
  const showLabels = state.labels === 'all' || (state.labels === 'auto' && cellPx >= 5);
  const tickSize = Math.max(6, Math.min(11, Math.floor(cellPx * 0.8)));

  const position = useMemo(() => {
    const map = new Map<number, number>();
    grid.indices.forEach((g, i) => map.set(g, i));
    return map;
  }, [grid]);

  const shapes = useMemo(() => {
    const out: Array<Record<string, unknown>> = [];
    const line = { color: INK.primary, width: 1.25 };
    if (state.focus !== null && position.has(state.focus)) {
      const p = position.get(state.focus)!;
      const lower = state.triangle === 'lower';
      out.push({
        type: 'rect', xref: 'x', yref: 'y', line, fillcolor: 'rgba(0,0,0,0)',
        x0: -0.5, x1: lower ? p + 0.5 : k - 0.5, y0: p - 0.5, y1: p + 0.5,
      });
      out.push({
        type: 'rect', xref: 'x', yref: 'y', line, fillcolor: 'rgba(0,0,0,0)',
        x0: p - 0.5, x1: p + 0.5, y0: lower ? p - 0.5 : -0.5, y1: k - 0.5,
      });
    }
    if (state.pair && position.has(state.pair.a) && position.has(state.pair.b)) {
      let row = position.get(state.pair.a)!;
      let col = position.get(state.pair.b)!;
      if (state.triangle === 'lower' && col > row) [row, col] = [col, row];
      const pad = Math.max(0.5, k / 120);
      out.push({
        type: 'rect', xref: 'x', yref: 'y', line: { color: INK.primary, width: 2 }, fillcolor: 'rgba(0,0,0,0)',
        x0: col - pad, x1: col + pad, y0: row - pad, y1: row + pad,
      });
    }
    return out;
  }, [state.focus, state.pair, state.triangle, position, k]);

  const data = useMemo(
    () => [
      {
        type: 'heatmap',
        z: grid.z,
        x: grid.labels,
        y: grid.labels,
        zmin,
        zmax,
        zmid: view.abs ? undefined : 0,
        colorscale: palette.scale,
        xgap: k <= 40 ? 1 : 0,
        ygap: k <= 40 ? 1 : 0,
        hoverongaps: false,
        hovertemplate: `<b>%{y}</b> × <b>%{x}</b><br>${view.abs ? '|r|' : 'r'} = %{z:.3f}<extra></extra>`,
        colorbar: {
          title: { text: view.abs ? '|r|' : 'r', side: 'top', font: { size: 12, color: INK.secondary } },
          thickness: 12,
          len: 0.75,
          outlinewidth: 0,
          tickfont: { size: 11, color: INK.secondary },
          x: 1.02,
          xanchor: 'left',
        },
      },
    ],
    [grid, zmin, zmax, view.abs, palette.scale, k],
  );

  const layout = useMemo(
    () => ({
      // r reserves the colour bar; width − height = 56 keeps the plot area square
      margin: { l: 12, r: 64, t: 8, b: 12 },
      xaxis: {
        type: 'category',
        showticklabels: showLabels,
        tickfont: { size: tickSize, color: INK.secondary },
        tickangle: -90,
        tickmode: state.labels === 'all' ? 'linear' : 'auto',
        dtick: state.labels === 'all' ? 1 : undefined,
        showgrid: false,
        zeroline: false,
        showline: false,
        ticks: '',
        constrain: 'domain',
        automargin: true,
      },
      yaxis: {
        type: 'category',
        autorange: 'reversed',
        showticklabels: showLabels,
        tickfont: { size: tickSize, color: INK.secondary },
        tickmode: state.labels === 'all' ? 'linear' : 'auto',
        dtick: state.labels === 'all' ? 1 : undefined,
        showgrid: false,
        zeroline: false,
        showline: false,
        ticks: '',
        scaleanchor: 'x',
        constrain: 'domain',
        automargin: true,
      },
      shapes,
      dragmode: 'zoom',
    }),
    [showLabels, tickSize, state.labels, shapes],
  );

  return (
    <Card
      title={viewTitle(view)}
      subtitle={`${k.toLocaleString()} of ${matrix.n.toLocaleString()} genes${
        state.minAbs > 0 ? ` · |r| ≥ ${state.minAbs.toFixed(2)}` : ''
      } · scale ${fmt.num(zmin, 2)} to ${fmt.num(zmax, 2)}`}
      actions={<ExportMenu onExport={exportAs} />}
      bodyClassName="p-2"
      className="shrink-0"
      style={{ width: width + 18 }}
    >
      <Chart
        data={data}
        layout={layout}
        height={height}
        width={width}
        onInitialized={onInitialized}
        config={{ scrollZoom: false, doubleClick: 'reset' }}
        onClick={(e: ChartEvent) => {
          const pt = e.points?.[0] as { pointIndex?: number[]; pointNumber?: number[] } | undefined;
          const idx = pt?.pointIndex ?? pt?.pointNumber;
          if (Array.isArray(idx) && idx.length === 2) onCellClick(grid.indices[idx[0]], grid.indices[idx[1]]);
        }}
      />
      <p className="px-2 pb-1 pt-1 text-[11px] text-slate-400">
        Drag to zoom · double-click to reset · click a cell to inspect the gene pair
      </p>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Inspector                                                           */
/* ------------------------------------------------------------------ */

function PartnerList({
  title,
  items,
  matrix,
  onPick,
}: {
  title: string;
  items: Array<{ b: number; r: number }>;
  matrix: MatrixData;
  onPick: (b: number) => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      {items.length === 0 ? (
        <p className="text-xs text-slate-400">None</p>
      ) : (
        <ul className="space-y-0.5">
          {items.map((p) => (
            <li key={p.b}>
              <button
                type="button"
                onClick={() => onPick(p.b)}
                className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm hover:bg-slate-50"
              >
                <span className="min-w-0 flex-1 truncate font-medium text-slate-800">{matrix.genes[p.b]}</span>
                <ValueBar value={p.r} signed />
                <span className="w-12 text-right text-xs tabular-nums text-slate-600">{fmt.r(p.r)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Inspector({
  matrix,
  state,
  update,
  wide,
}: {
  matrix: MatrixData;
  state: HeatmapState;
  update: (p: Partial<HeatmapState>) => void;
  /** Full-width row under the figures instead of a docked column. */
  wide: boolean;
}) {
  const { addGeneSets } = useIvcca();
  const [query, setQuery] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const focus = state.focus;
  const partnerData = useMemo(() => (focus === null ? null : partners(matrix, focus, 8)), [matrix, focus]);

  const ranking = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = matrix.sortedOrder.map((g, rank) => ({ g, rank, score: matrix.sortedScores[rank] }));
    return q ? rows.filter((r) => matrix.genes[r.g].toLowerCase().includes(q)) : rows;
  }, [matrix, query]);
  const maxScore = matrix.sortedScores[0] || 1;

  const saveNeighbourhood = () => {
    if (focus === null) return;
    const row: Array<{ j: number; r: number }> = [];
    for (let j = 0; j < matrix.n; j += 1) if (j !== focus) row.push({ j, r: Math.abs(corr(matrix, focus, j)) });
    row.sort((x, y) => y.r - x.r);
    const genes = [matrix.genes[focus], ...row.slice(0, 25).map((x) => matrix.genes[x.j])];
    const name = `${matrix.genes[focus]} + 25 partners`;
    addGeneSets([{ name, genes, source: 'selection' }]);
    setSaved(name);
    setTimeout(() => setSaved(null), 2500);
  };

  const pairCard = state.pair ? (
    <Card
      title="Selected cell"
      actions={
        <button type="button" aria-label="Clear selection" onClick={() => update({ pair: null })} className="text-slate-400 hover:text-slate-700">
          <X className="h-4 w-4" />
        </button>
      }
    >
      <p className="truncate text-sm font-medium text-slate-900">
        {matrix.genes[state.pair.a]} <span className="text-slate-400">×</span> {matrix.genes[state.pair.b]}
      </p>
      <p className="mt-1 text-3xl font-semibold tracking-tight text-slate-900">{fmt.r(corr(matrix, state.pair.a, state.pair.b))}</p>
      <p className="text-xs text-slate-500">correlation coefficient r</p>
      <div className="mt-3 flex gap-2">
        {[state.pair.a, state.pair.b].map((g) => (
          <Btn key={g} size="sm" onClick={() => update({ focus: g, inspector: 'gene' })} icon={<Crosshair className="h-3.5 w-3.5" />}>
            <span className="max-w-[6rem] truncate">{matrix.genes[g]}</span>
          </Btn>
        ))}
      </div>
    </Card>
  ) : null;

  const profile = (
    <div className="p-4">
      {focus === null || !partnerData ? (
        <p className="py-6 text-center text-sm text-slate-500">
          Search for a gene above, click a cell, or pick one from the ranking to see its strongest partners.
        </p>
      ) : (
        <div className="space-y-4">
          <div>
            <div className="flex items-start justify-between gap-2">
              <p className="text-lg font-semibold text-slate-900">{matrix.genes[focus]}</p>
              <button type="button" aria-label="Clear gene" onClick={() => update({ focus: null })} className="mt-1 text-slate-400 hover:text-slate-700">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-slate-50 px-3 py-2">
                <p className="text-[11px] text-slate-500">Rank by mean |r|</p>
                <p className="text-sm font-semibold text-slate-900">
                  #{(matrix.rankOf[focus] + 1).toLocaleString()} <span className="font-normal text-slate-400">/ {matrix.n.toLocaleString()}</span>
                </p>
              </div>
              <div className="rounded-lg bg-slate-50 px-3 py-2">
                <p className="text-[11px] text-slate-500">Mean |r|</p>
                <p className="text-sm font-semibold text-slate-900">{fmt.num(matrix.scoreOf[focus])}</p>
              </div>
            </div>
          </div>
          <PartnerList title="Strongest positive" items={partnerData.positive} matrix={matrix} onPick={(b) => update({ pair: { a: focus, b } })} />
          <PartnerList title="Strongest negative" items={partnerData.negative} matrix={matrix} onPick={(b) => update({ pair: { a: focus, b } })} />
          <Btn size="sm" className="w-full" icon={<Save className="h-3.5 w-3.5" />} onClick={saveNeighbourhood}>
            {saved ? 'Saved to gene set library' : 'Save gene + top 25 partners as set'}
          </Btn>
        </div>
      )}
    </div>
  );

  const rankingList = (
    <div className="p-3">
      <SearchInput value={query} onChange={setQuery} placeholder="Filter genes…" />
      <ul className="mt-2 max-h-[520px] overflow-auto">
        {ranking.slice(0, 1500).map((r) => (
          <li key={r.g}>
            <button
              type="button"
              onClick={() => update({ focus: r.g, inspector: 'gene' })}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-slate-50',
                state.focus === r.g && 'bg-teal-50',
              )}
            >
              <span className="w-9 shrink-0 text-right text-xs tabular-nums text-slate-400">{r.rank + 1}</span>
              <span className="min-w-0 flex-1 truncate font-medium text-slate-800">{matrix.genes[r.g]}</span>
              <ValueBar value={r.score} max={maxScore} />
              <span className="w-11 text-right text-xs tabular-nums text-slate-600">{r.score.toFixed(3)}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-slate-400">Ranked by mean |r| with all other genes — the order used by the sorted heatmap.</p>
    </div>
  );

  if (wide) {
    return (
      <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4">
          {pairCard ?? (
            <Card title="Selected cell">
              <p className="py-4 text-center text-sm text-slate-500">Click a heatmap cell to inspect a gene pair.</p>
            </Card>
          )}
        </div>
        <Card title="Gene profile" bodyClassName="p-0">
          {profile}
        </Card>
        <Card title="Gene ranking" bodyClassName="p-0">
          {rankingList}
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {pairCard}
      <Card bodyClassName="p-0">
        <div className="border-b border-slate-100 px-3 pt-3">
          <Segmented
            size="sm"
            value={state.inspector}
            onChange={(v) => update({ inspector: v })}
            options={[
              { value: 'ranking', label: 'Gene ranking' },
              { value: 'gene', label: 'Gene profile' },
            ]}
          />
          <div className="h-3" />
        </div>
        {state.inspector === 'gene' ? profile : rankingList}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Panel                                                               */
/* ------------------------------------------------------------------ */

function HeatmapWorkspace({ matrix }: { matrix: MatrixData }) {
  const [state, update] = useToolState<HeatmapState>('heatmap', INITIAL);
  const [areaRef, areaWidth] = useElementWidth<HTMLDivElement>();
  const vh = useViewportHeight();

  const maxGenes = state.topN ?? Math.min(matrix.n, DEFAULT_MAX_GENES);
  const topN = Math.min(matrix.n, maxGenes);
  const compare = state.layout === 'compare';
  const rightOrder: HeatmapOrder = compare && state.order === 'original' ? 'sorted' : state.order;
  const abs = state.values === 'abs';
  // Large matrices re-render slowly, so the heavy sliders commit once they settle.
  const [draftTopN, setDraftTopN] = useDraft(topN, (v) => update({ topN: v }));
  const [draftMinAbs, setDraftMinAbs] = useDraft(state.minAbs, (v) => update({ minAbs: v }));

  const mainView: View = { order: rightOrder, abs };
  const leftView: View = { order: 'original', abs: false };

  const makeGrid = (v: View) =>
    buildHeatmapGrid(matrix, orderFor(matrix, v.order).slice(0, topN), {
      abs: v.abs,
      triangle: state.triangle,
      minAbs: state.minAbs,
    });

  const mainGrid = useMemo(
    () => makeGrid(mainView),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [matrix, mainView.order, mainView.abs, topN, state.triangle, state.minAbs],
  );
  const leftGrid = useMemo(
    () => (compare ? makeGrid(leftView) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [compare, matrix, topN, state.triangle, state.minAbs],
  );

  // Figures are sized to stay square and fit the viewport; the inspector docks beside them when there is room.
  const gap = 16;
  const INSPECTOR = 320;
  const sideBySideInspector = areaWidth >= (compare ? 1500 : 1000);
  const CARD_CHROME = 20; // p-2 padding + 1px borders around each figure
  const available = sideBySideInspector ? areaWidth - INSPECTOR - gap : areaWidth;
  const perFigure = compare ? (available - gap) / 2 : available;
  const figureWidth = Math.floor(Math.max(320, Math.min(perFigure - CARD_CHROME, vh - 150, 1200)));
  const figureHeight = figureWidth - 56;

  const setOrder = (order: HeatmapOrder) => {
    if (state.valuesTouched) update({ order });
    else update({ order, values: order === 'original' ? 'signed' : 'abs' });
  };

  const focusOutside = state.focus !== null && !mainGrid.indices.includes(state.focus);

  const exportMatrixCsv = () => {
    const header = ['gene', ...mainGrid.labels];
    const rows = mainGrid.indices.map((gi) => [
      matrix.genes[gi],
      ...mainGrid.indices.map((gj) => Number(corr(matrix, gi, gj).toFixed(4))),
    ]);
    downloadText(toCsv([header, ...rows]), `ivcca_matrix_${rightOrder}_${topN}genes.csv`);
  };
  const exportRankingCsv = () => {
    downloadText(
      toCsv([
        ['rank', 'gene', 'mean_abs_r'],
        ...matrix.sortedOrder.map((g, i) => [i + 1, matrix.genes[g], Number(matrix.sortedScores[i].toFixed(5))]),
      ]),
      'ivcca_gene_ranking.csv',
    );
  };

  const onCellClick = (a: number, b: number) => update({ pair: { a, b }, focus: a, inspector: 'gene' });

  return (
    <div>
      <ToolHeader
        eyebrow="Explore"
        title="Correlation heatmap"
        description="Gene × gene correlation. Sorting by mean |r| pulls the most connected genes to the top-left; clustering groups co-regulated modules."
        actions={
          <Menu
            label="Data"
            icon={<Download className="h-3.5 w-3.5" />}
            items={[
              { label: 'Displayed matrix', hint: 'CSV', onSelect: exportMatrixCsv },
              { label: 'Gene ranking', hint: 'CSV', onSelect: exportRankingCsv },
            ]}
          />
        }
      />

      <ControlBar>
        <Field label="View">
          <Segmented
            ariaLabel="View"
            value={state.layout}
            onChange={(layout) => update({ layout })}
            options={[
              { value: 'single', label: 'Single' },
              { value: 'compare', label: 'Side by side' },
            ]}
          />
        </Field>
        <Field label={compare ? 'Order (right)' : 'Order'} hint="Sorted: descending mean |r| (as in IVCCA MATLAB). Clustered: leaf order of Ward linkage on 1 − |r|.">
          <Segmented
            ariaLabel="Order"
            value={rightOrder}
            onChange={setOrder}
            options={[
              { value: 'original', label: 'Original', disabled: compare },
              { value: 'sorted', label: 'Sorted' },
              { value: 'clustered', label: 'Clustered', disabled: !matrix.clusterOrder },
            ]}
          />
        </Field>
        <Field label="Values">
          <Segmented
            ariaLabel="Values"
            value={state.values}
            onChange={(values) => update({ values, valuesTouched: true })}
            options={[
              { value: 'signed', label: 'r' },
              { value: 'abs', label: '|r|' },
            ]}
          />
        </Field>
        <Field label="Show">
          <Segmented
            ariaLabel="Triangle"
            value={state.triangle}
            onChange={(triangle) => update({ triangle })}
            options={[
              { value: 'lower', label: 'Lower triangle' },
              { value: 'full', label: 'Full' },
            ]}
          />
        </Field>
        <Field label="Find gene" className="w-56">
          <GeneCombobox
            matrix={matrix}
            value={state.focus}
            onChange={(g) => update({ focus: g, inspector: g === null ? state.inspector : 'gene' })}
          />
        </Field>

        <div className="basis-full border-t border-slate-100" />

        <Field label="Palette" className="w-40">
          <SelectInput
            value={abs ? state.sequentialPalette : state.divergingPalette}
            onChange={(v) => update(abs ? { sequentialPalette: v as PaletteId } : { divergingPalette: v as PaletteId })}
            options={(Object.keys(PALETTES) as PaletteId[])
              .filter((p) => PALETTES[p].kind === (abs ? 'sequential' : 'diverging'))
              .map((p) => ({ value: p, label: PALETTES[p].label }))}
          />
        </Field>
        <Field label="Colour range" hint="Auto-contrast stretches the palette over the 2nd–98th percentile of the displayed values — useful when most correlations are strong.">
          <Segmented
            ariaLabel="Colour range"
            value={state.range}
            onChange={(range) => update({ range })}
            options={[
              { value: 'full', label: abs ? '0 – 1' : '−1 – 1' },
              { value: 'auto', label: 'Auto-contrast' },
            ]}
          />
        </Field>
        <Field label={`Genes shown (${draftTopN.toLocaleString()} of ${matrix.n.toLocaleString()})`} className="w-56">
          <Slider
            ariaLabel="Genes shown"
            min={Math.min(10, matrix.n)}
            max={matrix.n}
            step={1}
            value={draftTopN}
            onChange={setDraftTopN}
            format={(v) => (v === matrix.n ? 'All' : String(v))}
          />
        </Field>
        <Field label="Hide |r| below" className="w-48">
          <Slider
            ariaLabel="Hide weak correlations"
            min={0}
            max={0.95}
            step={0.05}
            value={draftMinAbs}
            onChange={setDraftMinAbs}
            format={(v) => (v === 0 ? 'Off' : v.toFixed(2))}
          />
        </Field>
        <Field label="Gene labels">
          <Segmented
            ariaLabel="Gene labels"
            value={state.labels}
            onChange={(labels) => update({ labels })}
            size="sm"
            options={[
              { value: 'auto', label: 'Auto' },
              { value: 'all', label: 'All' },
              { value: 'none', label: 'None' },
            ]}
          />
        </Field>
      </ControlBar>

      {matrix.n > DEFAULT_MAX_GENES && state.topN === null && (
        <div className="mb-4">
          <Notice>
            Showing the first {DEFAULT_MAX_GENES} genes of the current order for responsiveness. Drag “Genes shown” to the right to display all {matrix.n.toLocaleString()}.
          </Notice>
        </div>
      )}
      {focusOutside && state.focus !== null && (
        <div className="mb-4">
          <Notice tone="warn">
            {matrix.genes[state.focus]} is outside the {topN} genes shown (it is #{matrix.rankOf[state.focus] + 1} by mean |r|).{' '}
            <button type="button" className="font-semibold underline" onClick={() => update({ topN: matrix.n })}>
              Show all genes
            </button>
          </Notice>
        </div>
      )}

      <div ref={areaRef} className="flex flex-wrap items-start gap-4">
        {areaWidth > 0 && compare && leftGrid && (
          <HeatmapFigure
            matrix={matrix}
            grid={leftGrid}
            view={leftView}
            state={state}
            width={figureWidth}
            height={figureHeight}
            onCellClick={onCellClick}
            exportName="ivcca_heatmap_original"
          />
        )}
        {areaWidth > 0 && (
          <HeatmapFigure
            matrix={matrix}
            grid={mainGrid}
            view={mainView}
            state={state}
            width={figureWidth}
            height={figureHeight}
            onCellClick={onCellClick}
            exportName={`ivcca_heatmap_${rightOrder}`}
          />
        )}
        <div className={cn('min-w-0', sideBySideInspector ? 'w-[320px] shrink-0' : 'w-full')}>
          <Inspector matrix={matrix} state={state} update={update} wide={!sideBySideInspector} />
        </div>
      </div>
    </div>
  );
}

export function HeatmapPanel() {
  return <RequireMatrix>{(matrix) => <HeatmapWorkspace matrix={matrix} />}</RequireMatrix>;
}
