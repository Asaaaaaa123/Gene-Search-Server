'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { ApiError, ivccaApi } from './api';
import { buildMatrixData } from './matrix';
import type {
  ActivityEntry,
  AnalysisScope,
  CorrelationInfo,
  CorrelationMethod,
  DatasetInfo,
  GeneSet,
  MatrixData,
  ToolId,
} from './types';

export const ROOT_SCOPE = 'root';

/** The dataset plus every matrix (full or pathway) the tools can run on. */
type Workspace = {
  dataset: DatasetInfo;
  scopes: AnalysisScope[];
  activeScopeId: string;
};

/**
 * What panels see: the active scope's analyzer, correlation and matrix, alongside
 * the dataset it came from. Panels written for the full matrix work unchanged on a pathway.
 */
type Session = {
  analyzerId: string;
  dataset: DatasetInfo;
  correlation: CorrelationInfo | null;
  matrix: MatrixData | null;
  matrixStatus: AnalysisScope['matrixStatus'];
  scope: AnalysisScope;
  /** genes in the active matrix */
  nGenes: number;
};

type RunOptions = { key: string; label: string };

type IvccaContextValue = {
  session: Session | null;
  sessionExpired: boolean;
  /** false until a saved session (if any) has been restored after a page load */
  hydrated: boolean;
  activeTool: ToolId;
  setActiveTool: (tool: ToolId) => void;

  loadDataset: (file: File, filter: { name: string; genes: string[] } | null) => Promise<boolean>;
  computeCorrelation: (method: CorrelationMethod) => Promise<boolean>;
  retryMatrix: () => void;
  restoreSession: () => Promise<void>;
  resetSession: () => void;
  canRestore: boolean;

  scopes: AnalysisScope[];
  setActiveScope: (id: string) => void;
  createPathwayScope: (input: { name: string; genes: string[]; sourceSetId?: string }) => Promise<AnalysisScope | null>;
  removeScope: (id: string) => void;
  /** The full-dataset matrix, used to match gene lists before extracting a pathway. */
  rootMatrix: MatrixData | null;
  ensureMatrix: (scopeId: string) => void;

  run: <T>(opts: RunOptions, fn: (analyzerId: string) => Promise<T>) => Promise<T | undefined>;
  busy: Record<string, boolean>;
  errors: Record<string, string | null>;
  clearError: (key: string) => void;
  activity: ActivityEntry[];

  toolState: Record<string, unknown>;
  setToolState: (key: string, value: unknown | ((prev: unknown) => unknown)) => void;

  geneSets: GeneSet[];
  addGeneSets: (sets: Array<Omit<GeneSet, 'id' | 'createdAt'>>) => GeneSet[];
  updateGeneSet: (id: string, patch: Partial<Pick<GeneSet, 'name' | 'genes'>>) => void;
  removeGeneSet: (id: string) => void;
};

const IvccaContext = createContext<IvccaContextValue | null>(null);

const GENE_SET_STORAGE_KEY = 'ivcca.geneSets.v1';
const SESSION_STORAGE_KEY = 'ivcca.session.v2';
const LEGACY_SESSION_STORAGE_KEY = 'ivcca.session.v1';

const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/* Busy flags, errors and tool state are stored per scope as "<scopeId>::<key>";
   keys without a prefix (data, correlation, subset) belong to the whole workspace. */
const scopedKey = (scopeId: string, key: string) => (GLOBAL_KEYS.has(key) ? key : `${scopeId}::${key}`);

/** Gene-set tools always work against the original dataset, so their state is shared by every scope. */
export const GLOBAL_KEYS = new Set(['pathway', 'gene-genes', 'gene-pathways', 'ceci', 'compare']);

function viewForScope<V>(map: Record<string, V>, scopeId: string): Record<string, V> {
  const out: Record<string, V> = {};
  for (const [k, v] of Object.entries(map)) {
    const sep = k.indexOf('::');
    if (sep === -1) out[k] = v;
    else if (k.slice(0, sep) === scopeId) out[k.slice(sep + 2)] = v;
  }
  return out;
}

function readStoredSets(): GeneSet[] {
  try {
    const raw = window.localStorage.getItem(GENE_SET_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((s) => s && typeof s.name === 'string' && Array.isArray(s.genes))
      : [];
  } catch {
    return [];
  }
}

function readStoredWorkspace(): Workspace | null {
  try {
    const raw = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (raw) {
      const ws = JSON.parse(raw) as Workspace;
      if (ws?.dataset && Array.isArray(ws.scopes) && ws.scopes.length) return ws;
    }
    // Sessions saved before pathway scopes existed hold a single analyzer.
    const legacy = window.sessionStorage.getItem(LEGACY_SESSION_STORAGE_KEY);
    if (legacy) {
      const old = JSON.parse(legacy) as { analyzerId: string; dataset: DatasetInfo; correlation: CorrelationInfo | null };
      if (old?.analyzerId && old.dataset) return { dataset: old.dataset, scopes: [rootScope(old.analyzerId, old.dataset, old.correlation)], activeScopeId: ROOT_SCOPE };
    }
  } catch {
    /* unreadable — start fresh */
  }
  return null;
}

function rootScope(analyzerId: string, dataset: DatasetInfo, correlation: CorrelationInfo | null): AnalysisScope {
  return {
    id: ROOT_SCOPE,
    kind: 'dataset',
    label: 'Full dataset',
    analyzerId,
    nGenes: dataset.nGenes,
    correlation,
    matrix: null,
    matrixStatus: 'idle',
    createdAt: Date.now(),
  };
}

function countMissing(preview: DatasetInfo['preview']) {
  if (!preview) return 0;
  let missing = 0;
  for (const row of preview.rows) {
    for (let c = 1; c < row.length; c += 1) if (row[c] === null) missing += 1;
  }
  return missing;
}

/** Tool results depend on the correlation matrix; drop them but keep each tool's parameters. */
function withoutResults(state: Record<string, unknown>, onlyScope?: string) {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(state)) {
    const inScope = !onlyScope || key.startsWith(`${onlyScope}::`);
    next[key] =
      inScope && value && typeof value === 'object' && 'result' in (value as object)
        ? { ...(value as object), result: null }
        : value;
  }
  return next;
}

const geneListKey = (genes: string[]) => genes.map((g) => g.trim().toLowerCase()).join('\n');

export function IvccaProvider({ children }: { children: ReactNode }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [activeTool, setActiveToolState] = useState<ToolId>('data');
  const [busyMap, setBusy] = useState<Record<string, boolean>>({});
  const [errorMap, setErrors] = useState<Record<string, string | null>>({});
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [toolStateMap, setToolStateMap] = useState<Record<string, unknown>>({});
  const [geneSets, setGeneSets] = useState<GeneSet[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const lastUpload = useRef<{ file: File; filter: { name: string; genes: string[] } | null } | null>(null);
  const workspaceRef = useRef<Workspace | null>(null);
  workspaceRef.current = workspace;
  const setsHydrated = useRef(false);
  const fetchMatrixRef = useRef<
    ((scopeId: string, known?: Pick<AnalysisScope, 'analyzerId' | 'kind' | 'label'>) => Promise<void>) | null
  >(null);

  const activeScopeId = workspace?.activeScopeId ?? ROOT_SCOPE;

  /* ---------------------------------------------------------------- */
  /* Restore & persist                                                 */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    setGeneSets(readStoredSets());
    setsHydrated.current = true;
    const fromHash = () => {
      const hash = window.location.hash.replace('#', '') as ToolId;
      if (hash) setActiveToolState(hash);
    };
    fromHash();
    // Back/forward between tools
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, []);

  // Survive a page refresh: the backend keeps analyzers in memory, so reattach to them.
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current) return;
    resumed.current = true;
    const saved = readStoredWorkspace();
    if (saved) {
      const scopes = saved.scopes.map((s) => ({ ...s, matrix: null, matrixStatus: 'idle' as const }));
      const activeId = scopes.some((s) => s.id === saved.activeScopeId) ? saved.activeScopeId : ROOT_SCOPE;
      setWorkspace({ dataset: saved.dataset, scopes, activeScopeId: activeId });
      const active = scopes.find((s) => s.id === activeId);
      if (active?.correlation) void fetchMatrixRef.current?.(activeId, active);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    try {
      window.sessionStorage.removeItem(LEGACY_SESSION_STORAGE_KEY);
      if (!workspace) window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
      else {
        const preview = workspace.dataset.preview;
        window.sessionStorage.setItem(
          SESSION_STORAGE_KEY,
          JSON.stringify({
            dataset: {
              ...workspace.dataset,
              // keep the preview only when it is small enough for sessionStorage
              preview: preview && preview.rows.length * preview.columns.length < 60000 ? preview : null,
            },
            scopes: workspace.scopes.map((s) => ({ ...s, matrix: null, matrixStatus: 'idle' })),
            activeScopeId: workspace.activeScopeId,
          }),
        );
      }
    } catch {
      /* storage full or blocked — refresh simply starts a new session */
    }
  }, [workspace]);

  useEffect(() => {
    if (!setsHydrated.current) return;
    try {
      window.localStorage.setItem(GENE_SET_STORAGE_KEY, JSON.stringify(geneSets));
    } catch {
      /* storage unavailable (private mode / blocked) — the library still works for this visit */
    }
  }, [geneSets]);

  /* ---------------------------------------------------------------- */
  /* Navigation & activity                                            */
  /* ---------------------------------------------------------------- */

  const setActiveTool = useCallback((tool: ToolId) => {
    setActiveToolState(tool);
    try {
      if (window.location.hash !== `#${tool}`) window.history.pushState(null, '', `#${tool}`);
    } catch {
      /* ignore */
    }
    window.scrollTo({ top: 0 });
  }, []);

  const log = useCallback((entry: ActivityEntry) => {
    setActivity((prev) => {
      const idx = prev.findIndex((e) => e.id === entry.id);
      if (idx === -1) return [entry, ...prev].slice(0, 60);
      const next = [...prev];
      next[idx] = entry;
      return next;
    });
  }, []);

  /** Runs `fn`, recording it in the activity log and the busy/error maps (scoped when `scopeId` is given). */
  const track = useCallback(
    async <T,>(opts: RunOptions & { scopeId?: string }, fn: () => Promise<T>): Promise<T> => {
      const key = opts.scopeId ? scopedKey(opts.scopeId, opts.key) : opts.key;
      const entry: ActivityEntry = {
        id: newId(),
        key,
        label: opts.label,
        status: 'running',
        startedAt: performance.now(),
      };
      log(entry);
      setBusy((b) => ({ ...b, [key]: true }));
      setErrors((e) => ({ ...e, [key]: null }));
      try {
        const result = await fn();
        log({ ...entry, status: 'done', endedAt: performance.now() });
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log({ ...entry, status: 'error', endedAt: performance.now(), message });
        setErrors((e) => ({ ...e, [key]: message }));
        if (err instanceof ApiError && err.isSessionMissing) setSessionExpired(true);
        throw err;
      } finally {
        setBusy((b) => ({ ...b, [key]: false }));
      }
    },
    [log],
  );

  const updateScope = useCallback((scopeId: string, patch: Partial<AnalysisScope> | ((s: AnalysisScope) => Partial<AnalysisScope>)) => {
    setWorkspace((ws) =>
      ws
        ? {
            ...ws,
            scopes: ws.scopes.map((s) => (s.id === scopeId ? { ...s, ...(typeof patch === 'function' ? patch(s) : patch) } : s)),
          }
        : ws,
    );
  }, []);

  const run = useCallback(
    async <T,>(opts: RunOptions, fn: (analyzerId: string) => Promise<T>) => {
      const ws = workspaceRef.current;
      // Gene-set tools run on the full dataset whatever scope is active.
      const targetId = GLOBAL_KEYS.has(opts.key) ? ROOT_SCOPE : ws?.activeScopeId;
      const scope = ws?.scopes.find((s) => s.id === targetId);
      if (!scope) return undefined;
      const label = scope.kind === 'pathway' ? `${opts.label} · ${scope.label}` : opts.label;
      try {
        return await track({ ...opts, label, scopeId: GLOBAL_KEYS.has(opts.key) ? undefined : scope.id }, () =>
          fn(scope.analyzerId),
        );
      } catch {
        return undefined;
      }
    },
    [track],
  );

  /* ---------------------------------------------------------------- */
  /* Matrices                                                          */
  /* ---------------------------------------------------------------- */

  /** `known` lets callers pass a scope that was just created/updated and may not have rendered yet. */
  const fetchMatrix = useCallback(
    async (scopeId: string, known?: Pick<AnalysisScope, 'analyzerId' | 'kind' | 'label'>) => {
      const scope = known ?? workspaceRef.current?.scopes.find((s) => s.id === scopeId);
      if (!scope) return;
      const analyzerId = scope.analyzerId;
      updateScope(scopeId, { matrixStatus: 'loading' });
      try {
        const payload = await track(
          {
            key: 'matrix',
            scopeId,
            label: scope.kind === 'pathway' ? `Load ${scope.label} matrix` : 'Load correlation matrix',
          },
          () => ivccaApi.matrix(analyzerId),
        );
        const matrix = buildMatrixData(payload);
        updateScope(scopeId, (s) => (s.analyzerId === analyzerId ? { matrix, matrixStatus: 'ready' } : {}));
      } catch {
        updateScope(scopeId, (s) => (s.analyzerId === analyzerId ? { matrixStatus: 'error' } : {}));
      }
    },
    [track, updateScope],
  );
  fetchMatrixRef.current = fetchMatrix;

  const ensureMatrix = useCallback(
    (scopeId: string) => {
      const scope = workspaceRef.current?.scopes.find((s) => s.id === scopeId);
      if (scope?.correlation && !scope.matrix && scope.matrixStatus !== 'loading') void fetchMatrix(scopeId);
    },
    [fetchMatrix],
  );

  /** (Re-)extract a pathway sub-matrix from the root analyzer. */
  const extractPathway = useCallback(
    async (rootAnalyzerId: string, method: CorrelationMethod, genes: string[], label: string) => {
      const res = await track({ key: 'subset', label: `Extract pathway matrix: ${label}` }, () =>
        ivccaApi.subset(rootAnalyzerId, genes),
      );
      return {
        analyzerId: res.analyzer_id,
        nGenes: res.n_genes,
        missing: res.missing_genes,
        correlation: { method, size: res.matrix_size, stats: res.statistics, computedAt: Date.now() } as CorrelationInfo,
        matrix: null,
        matrixStatus: 'idle' as const,
      };
    },
    [track],
  );

  /* ---------------------------------------------------------------- */
  /* Dataset & correlation                                             */
  /* ---------------------------------------------------------------- */

  const loadDataset = useCallback(
    async (file: File, filter: { name: string; genes: string[] } | null) => {
      try {
        const filterFile = filter
          ? new File([filter.genes.join('\n')], filter.name.endsWith('.txt') ? filter.name : `${filter.name}.txt`, {
              type: 'text/plain',
            })
          : null;
        const res = await track({ key: 'data', label: `Load ${file.name}` }, () => ivccaApi.loadData(file, filterFile));
        lastUpload.current = { file, filter };
        const preview = res.preview ?? null;
        const dataset: DatasetInfo = {
          fileName: file.name,
          fileSize: file.size,
          nSamples: res.n_samples,
          nGenes: res.n_genes,
          preview,
          missing: countMissing(preview),
          filter: filter ? { name: filter.name, requested: filter.genes.length } : null,
          loadedAt: Date.now(),
        };
        setWorkspace({ dataset, scopes: [rootScope(res.analyzer_id, dataset, null)], activeScopeId: ROOT_SCOPE });
        setSessionExpired(false);
        // A new dataset invalidates every pathway scope; keep full-dataset and gene-set tool settings.
        setToolStateMap((s) =>
          withoutResults(
            Object.fromEntries(Object.entries(s).filter(([k]) => k.startsWith(`${ROOT_SCOPE}::`) || !k.includes('::'))),
          ),
        );
        return true;
      } catch {
        return false;
      }
    },
    [track],
  );

  const computeCorrelation = useCallback(
    async (method: CorrelationMethod) => {
      const ws = workspaceRef.current;
      const root = ws?.scopes.find((s) => s.id === ROOT_SCOPE);
      if (!ws || !root) return false;
      try {
        const res = await track(
          { key: 'correlation', label: `Compute ${method[0].toUpperCase()}${method.slice(1)} correlation` },
          () => ivccaApi.correlation(root.analyzerId, method),
        );
        updateScope(ROOT_SCOPE, {
          correlation: { method, size: res.matrix_size, stats: res.statistics, computedAt: Date.now() },
          matrix: null,
          matrixStatus: 'idle',
        });
        setToolStateMap((s) => withoutResults(s));

        // Pathway matrices were cut from the old correlation matrix — cut them again.
        const refreshed = new Map<string, AnalysisScope>([[ROOT_SCOPE, root]]);
        for (const p of ws.scopes.filter((s) => s.kind === 'pathway')) {
          try {
            const fresh = await extractPathway(root.analyzerId, method, p.requested ?? [], p.label);
            updateScope(p.id, fresh);
            refreshed.set(p.id, { ...p, ...fresh });
          } catch {
            updateScope(p.id, { matrixStatus: 'error' });
          }
        }
        const active = workspaceRef.current?.activeScopeId ?? ROOT_SCOPE;
        void fetchMatrix(ROOT_SCOPE, root);
        const activeScope = refreshed.get(active);
        if (active !== ROOT_SCOPE && activeScope) void fetchMatrix(active, activeScope);
        return true;
      } catch {
        return false;
      }
    },
    [track, updateScope, extractPathway, fetchMatrix],
  );

  const retryMatrix = useCallback(() => {
    const ws = workspaceRef.current;
    if (ws) void fetchMatrix(ws.activeScopeId);
  }, [fetchMatrix]);

  const restoreSession = useCallback(async () => {
    const last = lastUpload.current;
    const ws = workspaceRef.current;
    if (!last || !ws) return;
    const method = ws.scopes.find((s) => s.id === ROOT_SCOPE)?.correlation?.method;
    const pathways = ws.scopes.filter((s) => s.kind === 'pathway');
    const activeId = ws.activeScopeId;
    const ok = await loadDataset(last.file, last.filter);
    if (!ok || !method) return;
    // Bring the pathway scopes back (same ids, so their tool settings still apply), then recompute.
    setWorkspace((cur) =>
      cur ? { ...cur, scopes: [...cur.scopes, ...pathways.map((p) => ({ ...p, matrix: null, matrixStatus: 'idle' as const }))], activeScopeId: activeId } : cur,
    );
    setTimeout(() => void computeCorrelation(method), 0);
  }, [loadDataset, computeCorrelation]);

  const resetSession = useCallback(() => {
    setWorkspace(null);
    setSessionExpired(false);
    setToolStateMap({});
    setErrors({});
    lastUpload.current = null;
    setActiveTool('data');
  }, [setActiveTool]);

  /* ---------------------------------------------------------------- */
  /* Pathway scopes                                                    */
  /* ---------------------------------------------------------------- */

  const setActiveScope = useCallback(
    (id: string) => {
      setWorkspace((ws) => (ws && ws.scopes.some((s) => s.id === id) ? { ...ws, activeScopeId: id } : ws));
      ensureMatrix(id);
    },
    [ensureMatrix],
  );

  const createPathwayScope = useCallback(
    async (input: { name: string; genes: string[]; sourceSetId?: string }) => {
      const ws = workspaceRef.current;
      const root = ws?.scopes.find((s) => s.id === ROOT_SCOPE);
      if (!ws || !root?.correlation) return null;

      // Re-opening the same gene list just switches to the existing matrix.
      const existing = ws.scopes.find((s) => s.kind === 'pathway' && geneListKey(s.requested ?? []) === geneListKey(input.genes));
      if (existing) {
        setActiveScope(existing.id);
        return existing;
      }

      try {
        const fresh = await extractPathway(root.analyzerId, root.correlation.method, input.genes, input.name);
        const scope: AnalysisScope = {
          id: newId(),
          kind: 'pathway',
          label: input.name,
          requested: input.genes,
          sourceSetId: input.sourceSetId,
          createdAt: Date.now(),
          ...fresh,
        };
        setWorkspace((cur) => (cur ? { ...cur, scopes: [...cur.scopes, scope], activeScopeId: scope.id } : cur));
        void fetchMatrix(scope.id, scope);
        return scope;
      } catch {
        return null;
      }
    },
    [extractPathway, fetchMatrix, setActiveScope],
  );

  const removeScope = useCallback((id: string) => {
    if (id === ROOT_SCOPE) return;
    setWorkspace((ws) =>
      ws
        ? {
            ...ws,
            scopes: ws.scopes.filter((s) => s.id !== id),
            activeScopeId: ws.activeScopeId === id ? ROOT_SCOPE : ws.activeScopeId,
          }
        : ws,
    );
    const prefix = `${id}::`;
    const drop = <V,>(m: Record<string, V>) => Object.fromEntries(Object.entries(m).filter(([k]) => !k.startsWith(prefix)));
    setToolStateMap((s) => drop(s));
    setBusy((b) => drop(b));
    setErrors((e) => drop(e));
    ensureMatrix(ROOT_SCOPE);
  }, [ensureMatrix]);

  /* ---------------------------------------------------------------- */
  /* Scoped views                                                      */
  /* ---------------------------------------------------------------- */

  const clearError = useCallback(
    (key: string) =>
      setErrors((e) => ({ ...e, [key]: null, [scopedKey(workspaceRef.current?.activeScopeId ?? ROOT_SCOPE, key)]: null })),
    [],
  );

  const setToolState = useCallback((key: string, value: unknown | ((prev: unknown) => unknown)) => {
    const full = scopedKey(workspaceRef.current?.activeScopeId ?? ROOT_SCOPE, key);
    setToolStateMap((prev) => ({
      ...prev,
      [full]: typeof value === 'function' ? (value as (p: unknown) => unknown)(prev[full]) : value,
    }));
  }, []);

  const busy = useMemo(() => viewForScope(busyMap, activeScopeId), [busyMap, activeScopeId]);
  const errors = useMemo(() => viewForScope(errorMap, activeScopeId), [errorMap, activeScopeId]);
  const toolState = useMemo(() => viewForScope(toolStateMap, activeScopeId), [toolStateMap, activeScopeId]);

  const session = useMemo<Session | null>(() => {
    if (!workspace) return null;
    const scope = workspace.scopes.find((s) => s.id === workspace.activeScopeId) ?? workspace.scopes[0];
    if (!scope) return null;
    return {
      analyzerId: scope.analyzerId,
      dataset: workspace.dataset,
      correlation: scope.correlation,
      matrix: scope.matrix,
      matrixStatus: scope.matrixStatus,
      scope,
      nGenes: scope.nGenes,
    };
  }, [workspace]);

  const rootMatrix = workspace?.scopes.find((s) => s.id === ROOT_SCOPE)?.matrix ?? null;

  /* ---------------------------------------------------------------- */
  /* Gene set library                                                  */
  /* ---------------------------------------------------------------- */

  const addGeneSets = useCallback((sets: Array<Omit<GeneSet, 'id' | 'createdAt'>>) => {
    const created = sets.map((s) => ({ ...s, id: newId(), createdAt: Date.now() }));
    setGeneSets((prev) => [...prev, ...created]);
    return created;
  }, []);

  const updateGeneSet = useCallback((id: string, patch: Partial<Pick<GeneSet, 'name' | 'genes'>>) => {
    setGeneSets((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }, []);

  const removeGeneSet = useCallback((id: string) => {
    setGeneSets((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const value = useMemo<IvccaContextValue>(
    () => ({
      session,
      sessionExpired,
      hydrated,
      activeTool,
      setActiveTool,
      loadDataset,
      computeCorrelation,
      retryMatrix,
      restoreSession,
      resetSession,
      canRestore: Boolean(lastUpload.current),
      scopes: workspace?.scopes ?? [],
      setActiveScope,
      createPathwayScope,
      removeScope,
      rootMatrix,
      ensureMatrix,
      run,
      busy,
      errors,
      clearError,
      activity,
      toolState,
      setToolState,
      geneSets,
      addGeneSets,
      updateGeneSet,
      removeGeneSet,
    }),
    [
      session,
      sessionExpired,
      hydrated,
      activeTool,
      setActiveTool,
      loadDataset,
      computeCorrelation,
      retryMatrix,
      restoreSession,
      resetSession,
      workspace?.scopes,
      setActiveScope,
      createPathwayScope,
      removeScope,
      rootMatrix,
      ensureMatrix,
      run,
      busy,
      errors,
      clearError,
      activity,
      toolState,
      setToolState,
      geneSets,
      addGeneSets,
      updateGeneSet,
      removeGeneSet,
    ],
  );

  return <IvccaContext.Provider value={value}>{children}</IvccaContext.Provider>;
}

export function useIvcca() {
  const ctx = useContext(IvccaContext);
  if (!ctx) throw new Error('useIvcca must be used inside <IvccaProvider>');
  return ctx;
}

/**
 * Per-tool state that survives switching tools, kept separately for each analysis
 * scope. Objects with a `result` field have it cleared when the correlation changes.
 */
export function useToolState<T extends object>(key: string, initial: T) {
  const { toolState, setToolState } = useIvcca();
  // Other tools may pre-seed a partial state (e.g. "apply k = 4 to PCA"), so always layer it over the defaults.
  const stored = toolState[key] as Partial<T> | undefined;
  const state = (stored ? { ...initial, ...stored } : initial) as T;
  const update = useCallback(
    (patch: Partial<T> | ((prev: T) => Partial<T>)) => {
      setToolState(key, (prev: unknown) => {
        const base = { ...initial, ...((prev as Partial<T> | undefined) ?? {}) } as T;
        const delta = typeof patch === 'function' ? patch(base) : patch;
        return { ...base, ...delta };
      });
    },
    // `initial` is a fresh literal each render; the key identifies the slot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, setToolState],
  );
  return [state, update] as const;
}

/** Common pattern: the active scope's correlation matrix, once loaded. */
export function useMatrix() {
  const { session } = useIvcca();
  return session?.matrix ?? null;
}
