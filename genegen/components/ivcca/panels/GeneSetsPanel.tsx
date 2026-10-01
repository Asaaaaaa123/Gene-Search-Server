'use client';

import { useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, ClipboardPaste, Download, Grid3x3, Library, Pencil, Trash2, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import { downloadText, matchGenes, parseGeneList } from '../matrix';
import { useGeneSetUpload } from '../pickers';
import { useIvcca } from '../store';
import type { GeneSet } from '../types';
import { Badge, Btn, Card, EmptyState, Notice, SearchInput, TextInput, ToolHeader } from '../ui';

const SOURCE_LABEL: Record<GeneSet['source'], string> = {
  upload: 'Uploaded',
  paste: 'Pasted',
  cluster: 'From clusters',
  selection: 'From heatmap',
};

function NewSetForm({ onDone }: { onDone: () => void }) {
  const { addGeneSets, rootMatrix } = useIvcca();
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const genes = useMemo(() => parseGeneList(text), [text]);
  const matched = useMemo(() => matchGenes(rootMatrix, genes).matched.length, [rootMatrix, genes]);

  return (
    <Card title="New gene set" className="mb-4">
      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">Name</span>
            <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Angiogenesis (GO:0001525)" className="w-full" />
          </label>
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <p>
              <span className="font-semibold text-slate-900">{genes.length.toLocaleString()}</span> unique genes
            </p>
            {rootMatrix && (
              <p className="mt-0.5">
                <span className="font-semibold text-slate-900">{matched.toLocaleString()}</span> found in the current dataset
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Btn
              variant="primary"
              disabled={!name.trim() || genes.length === 0}
              onClick={() => {
                addGeneSets([{ name: name.trim(), genes, source: 'paste' }]);
                onDone();
              }}
            >
              Save set
            </Btn>
            <Btn variant="ghost" onClick={onDone}>
              Cancel
            </Btn>
          </div>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">Genes</span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            placeholder={'One symbol per line, or separated by commas / spaces\nCdh5\nPecam1\nVwf'}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 shadow-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
          />
        </label>
      </div>
    </Card>
  );
}

function SetRow({ set }: { set: GeneSet }) {
  const { rootMatrix, updateGeneSet, removeGeneSet, createPathwayScope, setActiveTool, busy } = useIvcca();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(set.name);
  const matrix = rootMatrix;
  const match = useMemo(() => matchGenes(matrix, set.genes), [matrix, set.genes]);
  const missing = useMemo(() => new Set(match.missing.map((g) => g.toLowerCase())), [match.missing]);
  const pct = set.genes.length ? match.matched.length / set.genes.length : 0;

  return (
    <li className="border-b border-slate-100 last:border-0">
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={open ? 'Hide genes' : 'Show genes'}
          className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <div className="min-w-0 flex-1">
          {editing ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (draft.trim()) updateGeneSet(set.id, { name: draft.trim() });
                setEditing(false);
              }}
            >
              <TextInput autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => setEditing(false)} className="h-8 w-full max-w-md" />
            </form>
          ) : (
            <p className="truncate text-sm font-semibold text-slate-900">{set.name}</p>
          )}
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>{set.genes.length.toLocaleString()} genes</span>
            <Badge>{SOURCE_LABEL[set.source]}</Badge>
          </div>
        </div>
        <div className="hidden w-48 sm:block">
          {matrix ? (
            <>
              <div className="flex justify-between text-xs">
                <span className={cn('font-medium', match.matched.length === 0 ? 'text-red-600' : 'text-slate-700')}>
                  {match.matched.length.toLocaleString()} in dataset
                </span>
                <span className="tabular-nums text-slate-400">{Math.round(pct * 100)}%</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-teal-600" style={{ width: `${pct * 100}%` }} />
              </div>
            </>
          ) : (
            <span className="text-xs text-slate-400">Load data to check coverage</span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          <Btn
            size="sm"
            variant="ghost"
            title={matrix ? `Open as a ${match.matched.length} × ${match.matched.length} matrix in every tool` : 'Compute the correlation matrix first'}
            disabled={!matrix || match.matched.length < 2 || busy.subset}
            icon={<Grid3x3 className="h-3.5 w-3.5" />}
            onClick={async () => {
              const scope = await createPathwayScope({ name: set.name, genes: set.genes, sourceSetId: set.id });
              if (scope) setActiveTool('heatmap');
            }}
          >
            Open as matrix
          </Btn>
          <Btn size="sm" variant="ghost" aria-label="Rename" onClick={() => { setDraft(set.name); setEditing(true); }}>
            <Pencil className="h-3.5 w-3.5" />
          </Btn>
          <Btn
            size="sm"
            variant="ghost"
            aria-label="Download as .txt"
            onClick={() => downloadText(set.genes.join('\n'), `${set.name.replace(/[\\/:*?"<>|]+/g, '_')}.txt`, 'text/plain;charset=utf-8')}
          >
            <Download className="h-3.5 w-3.5" />
          </Btn>
          <Btn
            size="sm"
            variant="ghost"
            aria-label="Delete"
            onClick={() => window.confirm(`Delete “${set.name}”?`) && removeGeneSet(set.id)}
          >
            <Trash2 className="h-3.5 w-3.5 text-slate-400 hover:text-red-600" />
          </Btn>
        </div>
      </div>
      {open && (
        <div className="px-12 pb-4">
          <div className="flex max-h-48 flex-wrap gap-1 overflow-auto">
            {set.genes.map((g) => {
              const absent = matrix && missing.has(g.toLowerCase());
              return (
                <span
                  key={g}
                  title={absent ? 'Not in the current dataset' : undefined}
                  className={cn(
                    'rounded px-1.5 py-0.5 font-mono text-[11px]',
                    absent ? 'bg-white text-slate-400 line-through ring-1 ring-slate-200' : 'bg-slate-100 text-slate-700',
                  )}
                >
                  {g}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </li>
  );
}

export function GeneSetsPanel() {
  const { geneSets } = useIvcca();
  const upload = useGeneSetUpload();
  const fileRef = useRef<HTMLInputElement>(null);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? geneSets.filter((s) => s.name.toLowerCase().includes(q) || s.genes.some((g) => g.toLowerCase() === q)) : geneSets;
  }, [geneSets, query]);

  const actions = (
    <>
      <input
        ref={fileRef}
        type="file"
        multiple
        accept=".txt,.csv,.tsv,.lst,.grp"
        className="hidden"
        onChange={async (e) => {
          if (!e.target.files?.length) return;
          const created = await upload(e.target.files);
          e.target.value = '';
          setMessage(`Added ${created.length} gene set${created.length === 1 ? '' : 's'}.`);
          setTimeout(() => setMessage(null), 3000);
        }}
      />
      <Btn icon={<Upload className="h-4 w-4" />} onClick={() => fileRef.current?.click()}>
        Upload .txt files
      </Btn>
      <Btn variant="primary" icon={<ClipboardPaste className="h-4 w-4" />} onClick={() => setCreating(true)}>
        Paste a list
      </Btn>
    </>
  );

  return (
    <div>
      <ToolHeader
        eyebrow="Gene sets"
        title="Gene set library"
        description="Pathways and gene lists used by the pathway tools. Upload once, reuse everywhere — the library is saved in this browser and survives new sessions."
        actions={actions}
      />
      {message && (
        <div className="mb-4">
          <Notice>{message}</Notice>
        </div>
      )}
      {creating && <NewSetForm onDone={() => setCreating(false)} />}

      {geneSets.length === 0 ? (
        !creating && (
          <EmptyState
            icon={<Library className="h-5 w-5" />}
            title="No gene sets yet"
            description="Upload pathway files (one gene symbol per line — several at once is fine), paste a list, or save clusters from PCA, t-SNE, the dendrogram or the heatmap."
            action={<div className="flex gap-2">{actions}</div>}
          />
        )
      ) : (
        <Card
          title={`${geneSets.length} gene set${geneSets.length === 1 ? '' : 's'}`}
          actions={<SearchInput value={query} onChange={setQuery} placeholder="Find a set or gene…" className="w-60" />}
          bodyClassName="p-0"
        >
          <ul>
            {visible.map((s) => (
              <SetRow key={s.id} set={s} />
            ))}
            {visible.length === 0 && <li className="px-4 py-8 text-center text-sm text-slate-400">No set matches “{query}”.</li>}
          </ul>
        </Card>
      )}
    </div>
  );
}
