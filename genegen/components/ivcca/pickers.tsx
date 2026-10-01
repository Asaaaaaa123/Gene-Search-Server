'use client';

import { useId, useMemo, useRef, useState } from 'react';
import { Check, ClipboardPaste, Library, Search, Upload, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { matchGenes, parseGeneList } from './matrix';
import { useIvcca } from './store';
import type { GeneSet, MatrixData } from './types';
import { Btn } from './ui';

/* ------------------------------------------------------------------ */
/* Gene autocomplete                                                   */
/* ------------------------------------------------------------------ */

export function GeneCombobox({
  matrix,
  value,
  onChange,
  placeholder = 'Find a gene…',
  className,
  showRank = true,
}: {
  matrix: MatrixData | null;
  value: number | null;
  onChange: (gene: number | null) => void;
  placeholder?: string;
  className?: string;
  showRank?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => {
    if (!matrix) return [];
    const q = query.trim().toLowerCase();
    if (!q) return matrix.sortedOrder.slice(0, 30);
    const prefix: number[] = [];
    const contains: number[] = [];
    matrix.genes.forEach((g, i) => {
      const lower = g.toLowerCase();
      if (lower.startsWith(q)) prefix.push(i);
      else if (lower.includes(q)) contains.push(i);
    });
    prefix.sort((a, b) => matrix.genes[a].length - matrix.genes[b].length);
    return [...prefix, ...contains].slice(0, 40);
  }, [matrix, query]);

  const select = (gene: number | null) => {
    onChange(gene);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  };

  const selectedLabel = value !== null && matrix ? matrix.genes[value] : '';

  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" aria-hidden />
      <input
        ref={inputRef}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        disabled={!matrix}
        value={open ? query : selectedLabel}
        placeholder={placeholder}
        onFocus={() => {
          setOpen(true);
          setCursor(0);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={(e) => {
          setQuery(e.target.value);
          setCursor(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setCursor((c) => Math.min(matches.length - 1, c + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setCursor((c) => Math.max(0, c - 1));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (matches[cursor] !== undefined) select(matches[cursor]);
          } else if (e.key === 'Escape') {
            setOpen(false);
            inputRef.current?.blur();
          }
        }}
        className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-8 text-sm text-slate-900 shadow-sm outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 disabled:bg-slate-50"
      />
      {value !== null && !open && (
        <button
          type="button"
          aria-label="Clear gene"
          onClick={() => select(null)}
          className="absolute right-2 top-2.5 text-slate-400 hover:text-slate-600"
        >
          <X className="h-4 w-4" />
        </button>
      )}
      {open && matrix && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-40 mt-1 max-h-72 w-full min-w-[14rem] overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
        >
          {!query && (
            <li className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Most connected genes
            </li>
          )}
          {matches.length === 0 && <li className="px-3 py-2 text-sm text-slate-400">No gene matches “{query}”</li>}
          {matches.map((g, i) => (
            <li
              key={g}
              role="option"
              aria-selected={i === cursor}
              onMouseDown={(e) => {
                e.preventDefault();
                select(g);
              }}
              onMouseEnter={() => setCursor(i)}
              className={cn(
                'flex cursor-pointer items-center justify-between gap-3 px-3 py-1.5 text-sm',
                i === cursor ? 'bg-teal-50 text-teal-900' : 'text-slate-700',
              )}
            >
              <span className="truncate font-medium">{matrix.genes[g]}</span>
              {showRank && (
                <span className="shrink-0 text-xs tabular-nums text-slate-400">
                  #{matrix.rankOf[g] + 1} · {matrix.scoreOf[g].toFixed(3)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Gene set picker                                                     */
/* ------------------------------------------------------------------ */

export function useGeneSetCoverage(sets: GeneSet[], matrix: MatrixData | null) {
  return useMemo(() => {
    const map = new Map<string, { matched: number; total: number }>();
    for (const s of sets) map.set(s.id, { matched: matchGenes(matrix, s.genes).matched.length, total: s.genes.length });
    return map;
  }, [sets, matrix]);
}

function Coverage({ matched, total, known }: { matched: number; total: number; known: boolean }) {
  if (!known) return <span className="text-xs tabular-nums text-slate-400">{total} genes</span>;
  return (
    <span className={cn('text-xs tabular-nums', matched === 0 ? 'text-red-600' : 'text-slate-500')}>
      {matched}/{total} in data
    </span>
  );
}

/** Adds .txt gene-list files to the library and returns the created sets. */
export function useGeneSetUpload() {
  const { addGeneSets } = useIvcca();
  return async (files: FileList | File[]) => {
    const list = Array.from(files);
    const parsed = await Promise.all(
      list.map(async (f) => ({
        name: f.name.replace(/\.(txt|csv|tsv|lst|grp)$/i, ''),
        genes: parseGeneList(await f.text()),
        source: 'upload' as const,
      })),
    );
    return addGeneSets(parsed.filter((p) => p.genes.length > 0));
  };
}

export function GeneSetPicker({
  mode,
  value,
  onChange,
  matrix,
  minMatched = 1,
}: {
  mode: 'single' | 'multi';
  value: string[];
  onChange: (ids: string[]) => void;
  matrix: MatrixData | null;
  minMatched?: number;
}) {
  const { geneSets, setActiveTool, addGeneSets } = useIvcca();
  const coverage = useGeneSetCoverage(geneSets, matrix);
  const upload = useGeneSetUpload();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pasting, setPasting] = useState(false);
  const [pasteName, setPasteName] = useState('');
  const [pasteText, setPasteText] = useState('');
  const pastedGenes = useMemo(() => parseGeneList(pasteText), [pasteText]);

  const savePasted = () => {
    if (!pastedGenes.length) return;
    const [created] = addGeneSets([
      { name: pasteName.trim() || `Gene list (${pastedGenes.length})`, genes: pastedGenes, source: 'paste' },
    ]);
    if (mode === 'single') onChange([created.id]);
    else onChange([...value, created.id]);
    setPasting(false);
    setPasteName('');
    setPasteText('');
  };

  const toggle = (id: string) => {
    if (mode === 'single') onChange(value[0] === id ? [] : [id]);
    else onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  };

  return (
    <div className="min-w-0">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-slate-500">
          {geneSets.length === 0
            ? 'Your gene set library is empty.'
            : mode === 'multi'
              ? `${value.length} of ${geneSets.length} selected`
              : 'Select one set'}
        </span>
        <div className="flex items-center gap-1.5">
          {mode === 'multi' && geneSets.length > 0 && (
            <>
              <Btn size="sm" variant="ghost" onClick={() => onChange(geneSets.map((s) => s.id))}>
                All
              </Btn>
              <Btn size="sm" variant="ghost" onClick={() => onChange([])}>
                None
              </Btn>
            </>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.csv,.tsv,.lst,.grp"
            multiple
            className="hidden"
            onChange={async (e) => {
              if (!e.target.files?.length) return;
              const created = await upload(e.target.files);
              e.target.value = '';
              if (!created.length) return;
              if (mode === 'single') onChange([created[0].id]);
              else onChange([...value, ...created.map((c) => c.id)]);
            }}
          />
          <Btn size="sm" icon={<Upload className="h-3.5 w-3.5" />} onClick={() => fileRef.current?.click()}>
            Upload
          </Btn>
          <Btn size="sm" icon={<ClipboardPaste className="h-3.5 w-3.5" />} onClick={() => setPasting((p) => !p)} aria-expanded={pasting}>
            Paste
          </Btn>
          <Btn size="sm" variant="ghost" icon={<Library className="h-3.5 w-3.5" />} onClick={() => setActiveTool('gene-sets')} aria-label="Open gene set library" />
        </div>
      </div>
      {pasting && (
        <div className="mb-2 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <input
            value={pasteName}
            onChange={(e) => setPasteName(e.target.value)}
            placeholder="Name (e.g. Angiogenesis)"
            className="h-8 w-full rounded-md border border-slate-200 bg-white px-2.5 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
          />
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={4}
            placeholder={'Gene symbols — one per line, or separated by commas / spaces'}
            className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-slate-500">
              {pastedGenes.length} genes
              {matrix && pastedGenes.length > 0 && ` · ${matchGenes(matrix, pastedGenes).matched.length} in data`}
            </span>
            <div className="flex gap-1.5">
              <Btn size="sm" variant="ghost" onClick={() => setPasting(false)}>
                Cancel
              </Btn>
              <Btn size="sm" variant="primary" disabled={!pastedGenes.length} onClick={savePasted}>
                Add & select
              </Btn>
            </div>
          </div>
        </div>
      )}
      {geneSets.length > 0 && (
        <ul className="max-h-60 overflow-auto rounded-lg border border-slate-200 bg-white">
          {geneSets.map((s) => {
            const cov = coverage.get(s.id) ?? { matched: 0, total: s.genes.length };
            const selected = value.includes(s.id);
            const unusable = Boolean(matrix) && cov.matched < minMatched;
            return (
              <li key={s.id} className="border-b border-slate-100 last:border-0">
                <button
                  type="button"
                  onClick={() => toggle(s.id)}
                  className={cn(
                    'flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors',
                    selected ? 'bg-teal-50/80' : 'hover:bg-slate-50',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center border',
                      mode === 'single' ? 'rounded-full' : 'rounded',
                      selected ? 'border-teal-600 bg-teal-600 text-white' : 'border-slate-300 bg-white',
                    )}
                  >
                    {selected && <Check className="h-3 w-3" strokeWidth={3} />}
                  </span>
                  <span className={cn('min-w-0 flex-1 truncate font-medium', unusable ? 'text-slate-400' : 'text-slate-800')}>
                    {s.name}
                  </span>
                  <Coverage matched={cov.matched} total={cov.total} known={Boolean(matrix)} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function selectedSets(geneSets: GeneSet[], ids: string[]) {
  return ids.map((id) => geneSets.find((s) => s.id === id)).filter((s): s is GeneSet => Boolean(s));
}
