'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API_BASE_URL } from '@/lib/api-base';
import {
  fetchGeneListFromUrl,
  genesToTxtFile,
  parseGeneListText,
} from '@/lib/gene-list-utils';
import {
  getSavedGeneListNames,
  loadGeneListByName,
  saveGeneList,
} from '@/lib/gene-list-storage';

const SAMPLE_GENES_URL = '/data/sample-genes-885.txt';
const POPULAR_GENE_COUNT = 100;
/** Max genes shown when browsing the full database (upload / preset lists are not capped). */
const PICKER_BROWSE_LIMIT = 200;

export type GeneListSource = 'upload' | 'picker' | 'sample' | 'popular' | 'database';
export type QuickStartChoice = 'upload' | 'sample' | 'popular' | 'database' | null;

type GeneListSelectorProps = {
  onFileReady: (file: File, source: GeneListSource, geneCount: number, listName: string) => void;
  onClear: () => void;
};

const QUICK_START_NOTICES: Record<Exclude<QuickStartChoice, null>, string> = {
  upload: 'Your uploaded file is loaded into the builder below. You can edit genes, save, or confirm when ready.',
  sample: 'Sample gene list selected — genes loaded into the builder below.',
  popular: 'Popular genes selected — genes loaded into the builder below.',
  database: 'All database genes selected — genes loaded into the builder below.',
};

export function GeneListSelector({ onFileReady, onClear }: GeneListSelectorProps) {
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [allGenes, setAllGenes] = useState<string[]>([]);
  const [sampleGenes, setSampleGenes] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [listName, setListName] = useState('');
  const [loadName, setLoadName] = useState('');
  const [savedNames, setSavedNames] = useState<string[]>([]);
  const [quickChoice, setQuickChoice] = useState<QuickStartChoice>(null);
  /** Genes from upload / preset / saved list — full list used for display and “select all”. */
  const [builderPool, setBuilderPool] = useState<string[] | null>(null);

  const refreshSavedNames = useCallback(() => {
    setSavedNames(getSavedGeneListNames());
  }, []);

  useEffect(() => {
    refreshSavedNames();
    fetchGeneListFromUrl(SAMPLE_GENES_URL)
      .then(setSampleGenes)
      .catch(() => setSampleGenes([]));
    fetch(`${API_BASE_URL}/api/gene/symbols`)
      .then((r) => r.json())
      .then((data) => {
        const list = Array.isArray(data.gene_symbols) ? data.gene_symbols : [];
        setAllGenes([...list].sort((a, b) => a.localeCompare(b)));
      })
      .catch(() => setAllGenes([]));
  }, [refreshSavedNames]);

  const popularGenes = useMemo(
    () => sampleGenes.slice(0, POPULAR_GENE_COUNT),
    [sampleGenes]
  );

  const poolForPicker = useMemo(() => {
    if (builderPool !== null) return builderPool;
    if (allGenes.length > 0) return allGenes;
    return sampleGenes;
  }, [builderPool, allGenes, sampleGenes]);

  const matchingGenes = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return poolForPicker;
    return poolForPicker.filter((g) => g.toLowerCase().includes(q));
  }, [poolForPicker, search]);

  const filteredPool = useMemo(() => {
    if (builderPool !== null) return matchingGenes;
    return matchingGenes.slice(0, PICKER_BROWSE_LIMIT);
  }, [matchingGenes, builderPool]);

  const pickedCount = picked.size;

  const loadGenesIntoBuilder = (
    genes: string[],
    choice: QuickStartChoice,
    suggestedName: string
  ) => {
    setBuilderPool(genes);
    setPicked(new Set(genes));
    setQuickChoice(choice);
    setSearch('');
    setListName((prev) => (prev.trim() ? prev : suggestedName));
    setError('');
    setSuccess('');
  };

  const loadPreset = async (kind: 'sample' | 'popular' | 'database') => {
    setLoading(kind);
    setError('');
    setSuccess('');
    try {
      if (kind === 'database') {
        let list = allGenes;
        if (list.length === 0) {
          const res = await fetch(`${API_BASE_URL}/api/gene/symbols`);
          const data = await res.json();
          list = Array.isArray(data.gene_symbols) ? data.gene_symbols : [];
          if (list.length === 0) throw new Error('No genes returned from database');
        }
        if (
          list.length > 500 &&
          !window.confirm(
            `Load all ${list.length} genes into the builder? You can edit before analyzing.`
          )
        ) {
          return;
        }
        loadGenesIntoBuilder(list, 'database', 'All database genes');
        return;
      }

      const genes =
        kind === 'popular'
          ? popularGenes.length > 0
            ? popularGenes
            : (await fetchGeneListFromUrl(SAMPLE_GENES_URL)).slice(0, POPULAR_GENE_COUNT)
          : await fetchGeneListFromUrl(SAMPLE_GENES_URL);

      loadGenesIntoBuilder(
        genes,
        kind,
        kind === 'popular' ? 'Popular genes' : 'Sample gene list (885)'
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load gene list');
    } finally {
      setLoading(null);
    }
  };

  const handleUploadFile = async (file: File) => {
    setError('');
    setSuccess('');
    try {
      const text = await file.text();
      const genes = parseGeneListText(text);
      if (genes.length === 0) throw new Error('No gene symbols found in file');
      loadGenesIntoBuilder(genes, 'upload', file.name.replace(/\.[^.]+$/, '') || 'Uploaded list');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to read file');
    }
  };

  const toggleGene = (symbol: string) => {
    setQuickChoice(null);
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);
      return next;
    });
  };

  const handleSave = () => {
    setError('');
    setSuccess('');
    try {
      const genes = [...picked].sort((a, b) => a.localeCompare(b));
      saveGeneList(listName, genes);
      refreshSavedNames();
      setLoadName(listName.trim());
      setSuccess(`Saved "${listName.trim()}" (${genes.length} genes)`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    }
  };

  const handleLoad = () => {
    setError('');
    setSuccess('');
    const saved = loadGeneListByName(loadName);
    if (!saved) {
      setError('Choose a saved list to load');
      return;
    }
    setBuilderPool(saved.genes);
    setPicked(new Set(saved.genes));
    setListName(saved.name);
    setQuickChoice(null);
    setSearch('');
    setSuccess(`Loaded "${saved.name}" (${saved.genes.length} genes)`);
  };

  const confirmForAnalysis = () => {
    const genes = [...picked].sort((a, b) => a.localeCompare(b));
    const name = listName.trim() || 'Gene list';
    if (genes.length === 0) {
      setError('Select at least one gene or load a preset first');
      return;
    }
    setError('');
    const source: GeneListSource =
      quickChoice === 'sample'
        ? 'sample'
        : quickChoice === 'popular'
          ? 'popular'
          : quickChoice === 'database'
            ? 'database'
            : quickChoice === 'upload'
              ? 'upload'
              : 'picker';
    const file = genesToTxtFile(genes, `${name.replace(/\s+/g, '-')}.txt`);
    onFileReady(file, source, genes.length, name);
  };

  const handleClear = () => {
    setPicked(new Set());
    setBuilderPool(null);
    setListName('');
    setQuickChoice(null);
    setSearch('');
    setError('');
    setSuccess('');
    onClear();
    if (uploadInputRef.current) uploadInputRef.current.value = '';
  };

  const selectAllMatching = () => {
    setQuickChoice(null);
    setPicked(new Set(matchingGenes));
  };

  const quickBtnClass = (choice: QuickStartChoice) =>
    `rounded-lg px-4 py-2 text-sm font-medium transition-all disabled:opacity-50 ${
      quickChoice === choice
        ? 'ring-2 ring-indigo-500 bg-indigo-100 text-indigo-900 shadow-sm'
        : 'border border-gray-300 bg-white text-black hover:bg-gray-50'
    }`;

  const fieldClass =
    'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-black placeholder:text-gray-500';

  return (
    <div className="light-surface space-y-6 text-black">
      <div>
        <h3 className="text-lg font-semibold text-black mb-2">Quick start</h3>
        <p className="text-sm text-black mb-4">
          Load a starting set into the builder below. You can change genes, name the list, save or load,
          then confirm when you are ready to analyze.
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => uploadInputRef.current?.click()}
            className={quickBtnClass('upload')}
          >
            Upload your own file
          </button>
          <input
            ref={uploadInputRef}
            type="file"
            accept=".txt,.csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleUploadFile(file);
              e.target.value = '';
            }}
          />
          <a
            href={SAMPLE_GENES_URL}
            download="sample-genes-885.txt"
            className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-black hover:bg-gray-50"
          >
            Download sample file
          </a>
          <button
            type="button"
            disabled={!!loading}
            onClick={() => loadPreset('sample')}
            className={quickBtnClass('sample')}
          >
            {loading === 'sample' ? 'Loading…' : 'Use sample gene list'}
          </button>
          <button
            type="button"
            disabled={!!loading}
            onClick={() => loadPreset('popular')}
            className={quickBtnClass('popular')}
          >
            {loading === 'popular' ? 'Loading…' : 'Use popular genes'}
          </button>
          <button
            type="button"
            disabled={!!loading}
            onClick={() => loadPreset('database')}
            className={quickBtnClass('database')}
          >
            {loading === 'database' ? 'Loading…' : 'Use all genes in database'}
          </button>
        </div>

        {quickChoice && (
          <div
            className="mt-4 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900"
            role="status"
          >
            <span className="font-semibold">Selected: </span>
            {quickChoice === 'sample' && `Sample gene list (${sampleGenes.length || 885} genes)`}
            {quickChoice === 'popular' &&
              `Popular genes (${popularGenes.length || POPULAR_GENE_COUNT} genes)`}
            {quickChoice === 'database' && `All database genes (${allGenes.length || pickedCount} genes)`}
            {quickChoice === 'upload' &&
              `Uploaded file (${builderPool?.length ?? pickedCount} genes)`}
            <span className="block mt-1 text-indigo-700">{QUICK_START_NOTICES[quickChoice]}</span>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-gray-200 bg-gray-50/80 p-5">
        <h3 className="text-lg font-semibold text-black mb-2">Build your own list</h3>
        <p className="text-sm text-black mb-4">
          {builderPool !== null
            ? `Showing ${builderPool.length} genes from your loaded list. Search to filter; “Select all” applies to the full list or search results.`
            : `Name your list, search and select genes${allGenes.length > 0 ? ` (${allGenes.length} in database; first ${PICKER_BROWSE_LIMIT} shown)` : ''}, then save for later or confirm for analysis.`}
        </p>

        <label className="block text-sm font-medium text-black mb-1">Gene list name</label>
        <input
          type="text"
          value={listName}
          onChange={(e) => setListName(e.target.value)}
          placeholder="e.g. My hypothalamus panel"
          className={`${fieldClass} mb-4`}
        />

        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search gene symbol (e.g. Gfap, Socs3)…"
          className={`${fieldClass} mb-3`}
        />
        <div className="mb-3 flex flex-wrap gap-2 text-xs text-black">
          <button
            type="button"
            onClick={selectAllMatching}
            className="font-medium text-black underline-offset-2 hover:underline"
          >
            {builderPool !== null
              ? search.trim()
                ? `Select all matching (${matchingGenes.length})`
                : `Select all (${matchingGenes.length})`
              : `Select all shown (${filteredPool.length})`}
          </button>
          <button
            type="button"
            onClick={() => {
              setQuickChoice(null);
              setPicked(new Set());
            }}
            className="font-medium text-black underline-offset-2 hover:underline"
          >
            Clear selection
          </button>
          <span>{pickedCount} genes selected</span>
        </div>
        <div className="max-h-48 overflow-y-auto rounded-lg border border-gray-200 bg-white p-2">
          {filteredPool.length === 0 ? (
            <p className="p-2 text-sm text-black">No genes match your search.</p>
          ) : (
            <ul className="grid grid-cols-2 gap-1 sm:grid-cols-3 md:grid-cols-4">
              {filteredPool.map((symbol) => (
                <li key={symbol}>
                  <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm text-black hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={picked.has(symbol)}
                      onChange={() => toggleGene(symbol)}
                      className="rounded border-gray-300 text-indigo-600"
                    />
                    <span className="truncate font-mono text-xs text-black">{symbol}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <button
            type="button"
            disabled={pickedCount === 0 || !listName.trim()}
            onClick={handleSave}
            className="rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-semibold text-black hover:bg-gray-50 disabled:opacity-50"
          >
            Save gene list
          </button>
          <div className="flex flex-1 flex-col gap-1 sm:min-w-[200px]">
            <label className="text-xs font-medium text-black">Load saved list</label>
            <div className="flex gap-2">
              <select
                value={loadName}
                onChange={(e) => setLoadName(e.target.value)}
                className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-black"
              >
                <option value="" className="text-black">
                  Choose saved list…
                </option>
                {savedNames.map((n) => (
                  <option key={n} value={n} className="text-black">
                    {n}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!loadName}
                onClick={handleLoad}
                className="rounded-lg bg-gray-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
              >
                Load
              </button>
            </div>
          </div>
        </div>

        <button
          type="button"
          disabled={pickedCount === 0}
          onClick={confirmForAnalysis}
          className="mt-6 w-full rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-3 text-base font-bold text-white hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 sm:w-auto"
        >
          Confirm list for analysis ({pickedCount} genes)
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className="text-sm text-green-700" role="status">
          {success}
        </p>
      )}

    </div>
  );
}
