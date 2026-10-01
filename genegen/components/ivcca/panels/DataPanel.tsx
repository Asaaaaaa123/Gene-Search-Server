'use client';

import { useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, FileSpreadsheet, FlaskConical, Upload, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { parseGeneList } from '../matrix';
import { useIvcca } from '../store';
import { fmt } from '../theme';
import { Btn, Card, InlineError, Notice, Segmented, StatTile, ToolHeader } from '../ui';

const DATA_ACCEPT = '.csv,.tsv,.xlsx,.xls';
const EXAMPLE_URL = '/data/hero-expression.csv';

function Dropzone({
  accept,
  file,
  onFile,
  title,
  hint,
  compact,
}: {
  accept: string;
  file: File | null;
  onFile: (f: File | null) => void;
  title: string;
  hint: string;
  compact?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) onFile(f);
  };

  if (file) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-teal-700 ring-1 ring-slate-200">
          <FileSpreadsheet className="h-4.5 w-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-900">{file.name}</p>
          <p className="text-xs text-slate-500">{fmt.bytes(file.size)}</p>
        </div>
        <button
          type="button"
          onClick={() => onFile(null)}
          aria-label="Remove file"
          className="rounded-md p-1 text-slate-400 hover:bg-white hover:text-slate-700"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => ref.current?.click()}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && ref.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed text-center transition-colors',
        compact ? 'px-4 py-6' : 'px-6 py-10',
        over ? 'border-teal-500 bg-teal-50/60' : 'border-slate-300 bg-slate-50/50 hover:border-slate-400 hover:bg-slate-50',
      )}
    >
      <input
        ref={ref}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
      <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-white text-slate-500 shadow-sm ring-1 ring-slate-200">
        <Upload className="h-4.5 w-4.5" />
      </span>
      <p className="text-sm font-medium text-slate-800">{title}</p>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </div>
  );
}

function FormatGuide() {
  const rows = [
    ['Sample', 'Gapdh', 'Actb', 'Cdh5', '…'],
    ['S1', '12.41', '15.02', '8.33', '…'],
    ['S2', '12.18', '14.87', '9.10', '…'],
    ['S3', '11.96', '15.21', '7.64', '…'],
  ];
  return (
    <Card title="Expected format">
      <div className="overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full text-xs">
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={i === 0 ? 'bg-slate-50 font-semibold text-slate-700' : 'text-slate-600'}>
                {r.map((c, j) => (
                  <td key={j} className={cn('border-b border-slate-100 px-2 py-1.5', j === 0 && 'font-medium text-slate-800')}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="mt-3 space-y-1.5 text-xs leading-relaxed text-slate-600">
        <li>• One row per sample; the first column holds sample IDs.</li>
        <li>• One column per gene; values are numeric expression levels.</li>
        <li>• CSV, TSV or Excel — as exported from the IVCCA MATLAB tool.</li>
        <li>• Correlations are computed between genes (columns) across samples.</li>
      </ul>
    </Card>
  );
}

function Uploader({ onLoaded }: { onLoaded?: () => void }) {
  const { loadDataset, busy, errors, clearError } = useIvcca();
  const [file, setFile] = useState<File | null>(null);
  const [filterMode, setFilterMode] = useState<'none' | 'upload' | 'paste'>('none');
  const [filterFile, setFilterFile] = useState<File | null>(null);
  const [filterGenes, setFilterGenes] = useState<string[]>([]);
  const [pasted, setPasted] = useState('');
  const [exampleLoading, setExampleLoading] = useState(false);

  const filter = useMemo(() => {
    if (filterMode === 'upload' && filterFile && filterGenes.length) return { name: filterFile.name, genes: filterGenes };
    if (filterMode === 'paste') {
      const genes = parseGeneList(pasted);
      return genes.length ? { name: 'pasted-filter', genes } : null;
    }
    return null;
  }, [filterMode, filterFile, filterGenes, pasted]);

  const submit = async (f: File) => {
    const ok = await loadDataset(f, filter);
    if (ok) onLoaded?.();
  };

  const loadExample = async () => {
    setExampleLoading(true);
    try {
      const res = await fetch(EXAMPLE_URL);
      const blob = await res.blob();
      await submit(new File([blob], 'hero-expression.csv', { type: 'text/csv' }));
    } finally {
      setExampleLoading(false);
    }
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-5">
        <InlineError message={errors.data} onDismiss={() => clearError('data')} />
        <Card title="Expression matrix" subtitle="Samples in rows, genes in columns">
          <Dropzone
            accept={DATA_ACCEPT}
            file={file}
            onFile={setFile}
            title="Drop a CSV, TSV or Excel file here"
            hint="or click to browse · up to a few thousand genes works best in the browser"
          />
        </Card>

        <Card title="Gene filter" subtitle="Optional — restrict the analysis to a list of genes">
          <Segmented
            ariaLabel="Gene filter"
            value={filterMode}
            onChange={setFilterMode}
            size="sm"
            options={[
              { value: 'none', label: 'No filter' },
              { value: 'upload', label: 'Upload list' },
              { value: 'paste', label: 'Paste list' },
            ]}
          />
          {filterMode === 'upload' && (
            <div className="mt-3">
              <Dropzone
                compact
                accept=".txt,.csv,.tsv"
                file={filterFile}
                onFile={async (f) => {
                  setFilterFile(f);
                  setFilterGenes(f ? parseGeneList(await f.text()) : []);
                }}
                title="Drop a .txt gene list"
                hint="one gene symbol per line"
              />
              {filterFile && (
                <p className="mt-2 text-xs text-slate-500">{filterGenes.length.toLocaleString()} unique gene symbols in the list.</p>
              )}
            </div>
          )}
          {filterMode === 'paste' && (
            <div className="mt-3">
              <textarea
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                rows={5}
                placeholder={'Gapdh\nActb\nCdh5\n…'}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 shadow-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
              />
              <p className="mt-1 text-xs text-slate-500">
                {parseGeneList(pasted).length.toLocaleString()} genes · separated by new lines, commas or spaces
              </p>
            </div>
          )}
        </Card>

        <div className="flex flex-wrap items-center gap-3">
          <Btn
            variant="primary"
            disabled={!file || (filterMode !== 'none' && !filter)}
            loading={busy.data && !exampleLoading}
            onClick={() => file && void submit(file)}
            icon={<ArrowRight className="h-4 w-4" />}
          >
            Load dataset
          </Btn>
          <span className="text-xs text-slate-400">or</span>
          <Btn
            icon={<FlaskConical className="h-4 w-4" />}
            onClick={() => void loadExample()}
            loading={exampleLoading}
            disabled={busy.data}
          >
            Use example dataset
          </Btn>
          <span className="text-xs text-slate-500">7 samples × 236 endothelial genes</span>
        </div>
      </div>
      <FormatGuide />
    </div>
  );
}

const PAGE = 20;

function Preview() {
  const { session } = useIvcca();
  const [page, setPage] = useState(0);
  const preview = session?.dataset.preview;
  if (!preview) return null;
  const geneCols = preview.columns.length - 1;
  const pages = Math.max(1, Math.ceil(geneCols / PAGE));
  const start = 1 + page * PAGE;
  const cols = [0, ...Array.from({ length: Math.min(PAGE, geneCols - page * PAGE) }, (_, i) => start + i)];

  const cell = (v: string | number | null) => {
    if (v === null || v === undefined) return <span className="text-slate-300">—</span>;
    if (typeof v === 'number') return Math.abs(v) >= 1e4 ? v.toExponential(2) : v.toFixed(3);
    return v;
  };

  return (
    <Card
      title="Data preview"
      subtitle={`${preview.rows.length.toLocaleString()} samples · genes ${start}–${start + cols.length - 2} of ${geneCols.toLocaleString()}`}
      actions={
        <div className="flex items-center gap-1">
          <Btn size="sm" variant="ghost" aria-label="Previous genes" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Btn>
          <span className="text-xs tabular-nums text-slate-500">
            {page + 1} / {pages}
          </span>
          <Btn size="sm" variant="ghost" aria-label="Next genes" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Btn>
        </div>
      }
      bodyClassName="p-0"
    >
      <div className="max-h-[420px] overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10">
            <tr>
              {cols.map((c) => (
                <th
                  key={c}
                  className={cn(
                    'whitespace-nowrap border-b border-slate-200 bg-slate-50 px-3 py-2 text-left text-xs font-semibold text-slate-600',
                    c === 0 && 'sticky left-0 z-20 border-r',
                  )}
                >
                  {preview.columns[c]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row, r) => (
              <tr key={r} className="hover:bg-slate-50/70">
                {cols.map((c) => (
                  <td
                    key={c}
                    className={cn(
                      'whitespace-nowrap border-b border-slate-100 px-3 py-1.5 tabular-nums text-slate-700',
                      c === 0 && 'sticky left-0 border-r bg-white font-medium text-slate-900',
                    )}
                  >
                    {cell(row[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function DataPanel() {
  const { session, setActiveTool } = useIvcca();
  const [replacing, setReplacing] = useState(false);

  if (!session || replacing) {
    return (
      <div>
        <ToolHeader
          eyebrow="Step 1"
          title={replacing ? 'Load a different dataset' : 'Load your dataset'}
          description="IVCCA correlates every gene with every other gene across your samples. Start with an expression matrix — the current session stays active until the new file loads successfully."
          actions={
            replacing ? (
              <Btn variant="ghost" onClick={() => setReplacing(false)}>
                Cancel
              </Btn>
            ) : undefined
          }
        />
        <Uploader
          onLoaded={() => {
            setReplacing(false);
          }}
        />
      </div>
    );
  }

  const d = session.dataset;
  return (
    <div>
      <ToolHeader
        eyebrow="Step 1"
        title="Dataset"
        description={`${d.fileName} · loaded ${new Date(d.loadedAt).toLocaleTimeString()}`}
        actions={
          <>
            <Btn onClick={() => setReplacing(true)} icon={<Upload className="h-4 w-4" />}>
              Replace dataset
            </Btn>
            {!session.correlation && (
              <Btn variant="primary" onClick={() => setActiveTool('correlation')} icon={<ArrowRight className="h-4 w-4" />}>
                Compute correlation
              </Btn>
            )}
          </>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Samples" value={d.nSamples.toLocaleString()} sub="rows used as observations" />
        <StatTile label="Genes" value={d.nGenes.toLocaleString()} sub="columns to correlate" />
        <StatTile
          label="Missing values"
          value={d.missing.toLocaleString()}
          sub={d.missing ? 'pairs with gaps use available samples' : 'complete matrix'}
        />
        <StatTile
          label="Gene filter"
          value={d.filter ? `${d.nGenes.toLocaleString()} kept` : 'None'}
          sub={d.filter ? `${d.filter.requested.toLocaleString()} requested · ${d.filter.name}` : 'all genes analysed'}
        />
      </div>
      {d.nSamples < 10 && (
        <div className="mb-5">
          <Notice tone="warn">
            Only {d.nSamples} samples: correlation coefficients from so few observations are unstable and tend toward ±1.
            Interpret magnitudes with care and prefer sorted/clustered views over absolute thresholds.
          </Notice>
        </div>
      )}
      <Preview />
    </div>
  );
}
