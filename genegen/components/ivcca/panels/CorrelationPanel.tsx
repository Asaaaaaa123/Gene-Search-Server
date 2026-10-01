'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, ChartColumn, Check, GitFork, Grid3x3, Orbit, Share2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useIvcca } from '../store';
import { fmt } from '../theme';
import type { CorrelationMethod, ToolId } from '../types';
import { Btn, Card, InlineError, LockedState, Notice, StatTile, ToolHeader } from '../ui';

const METHODS: Array<{ id: CorrelationMethod; name: string; summary: string; detail: string }> = [
  {
    id: 'pearson',
    name: 'Pearson',
    summary: 'Linear association',
    detail: 'Standard IVCCA choice. Sensitive to outliers; assumes roughly linear relationships.',
  },
  {
    id: 'spearman',
    name: 'Spearman',
    summary: 'Rank-based, monotonic',
    detail: 'Robust to outliers and non-linear monotonic trends. Good default for noisy expression data.',
  },
  {
    id: 'kendall',
    name: 'Kendall τ',
    summary: 'Rank concordance',
    detail: 'Most conservative; well-behaved with few samples. Slowest on large gene sets.',
  },
];

const NEXT: Array<{ tool: ToolId; title: string; text: string; icon: typeof Grid3x3 }> = [
  { tool: 'heatmap', title: 'Heatmap', text: 'Original, sorted and clustered views', icon: Grid3x3 },
  { tool: 'distribution', title: 'Distribution & pairs', text: 'Histogram and strongest gene pairs', icon: ChartColumn },
  { tool: 'dendrogram', title: 'Dendrogram', text: 'Hierarchical gene modules', icon: GitFork },
  { tool: 'pca', title: 'PCA', text: 'Genes in principal-component space', icon: Orbit },
  { tool: 'network', title: 'Network', text: 'Co-expression graph above a threshold', icon: Share2 },
];

export function CorrelationPanel() {
  const { session, computeCorrelation, busy, errors, clearError, setActiveTool } = useIvcca();
  const [method, setMethod] = useState<CorrelationMethod>(session?.correlation?.method ?? 'pearson');

  useEffect(() => {
    if (session?.correlation) setMethod(session.correlation.method);
  }, [session?.correlation]);

  if (!session) {
    return (
      <>
        <ToolHeader eyebrow="Step 2" title="Correlation matrix" />
        <LockedState
          title="Load a dataset first"
          description="The correlation matrix is computed from your expression data."
          action={
            <Btn variant="primary" onClick={() => setActiveTool('data')}>
              Go to dataset
            </Btn>
          }
        />
      </>
    );
  }

  const corr = session.correlation;
  const n = session.dataset.nGenes;
  const changed = corr && corr.method !== method;

  return (
    <div>
      <ToolHeader
        eyebrow="Step 2"
        title="Correlation matrix"
        description={`Correlate all ${n.toLocaleString()} genes pairwise across ${session.dataset.nSamples} samples — ${(
          (n * (n - 1)) /
          2
        ).toLocaleString()} gene pairs.`}
      />
      <InlineError message={errors.correlation} onDismiss={() => clearError('correlation')} />

      <Card title="Method">
        <div role="radiogroup" aria-label="Correlation method" className="grid gap-3 md:grid-cols-3">
          {METHODS.map((m) => {
            const active = method === m.id;
            return (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setMethod(m.id)}
                className={cn(
                  'relative rounded-xl border p-4 text-left transition-all',
                  active
                    ? 'border-teal-600 bg-teal-50/50 ring-1 ring-teal-600'
                    : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50',
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-900">{m.name}</span>
                  <span
                    className={cn(
                      'flex h-4 w-4 items-center justify-center rounded-full border',
                      active ? 'border-teal-600 bg-teal-600 text-white' : 'border-slate-300',
                    )}
                  >
                    {active && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                  </span>
                </div>
                <p className="mt-1 text-xs font-medium text-teal-800">{m.summary}</p>
                <p className="mt-2 text-xs leading-relaxed text-slate-600">{m.detail}</p>
              </button>
            );
          })}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Btn
            variant="primary"
            loading={busy.correlation}
            disabled={Boolean(corr) && !changed}
            onClick={() => void computeCorrelation(method)}
          >
            {!corr ? 'Compute correlation matrix' : changed ? `Recompute with ${METHODS.find((m) => m.id === method)?.name}` : 'Computed'}
          </Btn>
          {changed && (
            <span className="text-xs text-slate-500">Recomputing clears downstream results (tool settings are kept) and re-extracts any pathway matrices.</span>
          )}
          {n > 3000 && (
            <Notice tone="warn">
              {n.toLocaleString()} genes is a large matrix. Heatmaps show the top genes by default; consider a gene filter.
            </Notice>
          )}
        </div>
      </Card>

      {corr && (
        <>
          <h3 className="mb-3 mt-7 text-sm font-semibold text-slate-900">
            Summary · {session.scope.kind === 'pathway' ? `${session.scope.label} (pathway matrix)` : 'Full dataset'} ·{' '}<span className="font-normal capitalize text-slate-500">{corr.method}</span>
          </h3>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <StatTile label="Matrix" value={`${corr.size[0]} × ${corr.size[1]}`} sub="genes × genes" />
            <StatTile label="Mean r" value={fmt.r(corr.stats.mean)} sub="off-diagonal" />
            <StatTile label="Median r" value={fmt.r(corr.stats.median)} />
            <StatTile label="Standard deviation" value={fmt.num(corr.stats.std)} />
            <StatTile label="Minimum" value={fmt.r(corr.stats.min)} sub="most negative pair" />
            <StatTile label="Maximum" value={fmt.r(corr.stats.max)} sub="most positive pair" />
          </div>

          <h3 className="mb-3 mt-7 text-sm font-semibold text-slate-900">Continue with</h3>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {NEXT.map(({ tool, title, text, icon: Icon }) => (
              <button
                key={tool}
                type="button"
                onClick={() => setActiveTool(tool)}
                className="group flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-[0_1px_2px_rgba(16,24,40,0.05)] transition hover:border-teal-600/40 hover:shadow-md"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600 group-hover:bg-teal-50 group-hover:text-teal-700">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1 text-sm font-semibold text-slate-900">
                    {title}
                    <ArrowRight className="h-3.5 w-3.5 opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
                  </span>
                  <span className="mt-0.5 block text-xs text-slate-500">{text}</span>
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
