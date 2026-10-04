'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  Check,
  CircleQuestionMark,
  Copy,
  FileSpreadsheet,
  Grid3x3,
  History,
  Layers,
  LoaderCircle,
  Lock,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RotateCcw,
  TriangleAlert,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { HelpContext } from './helpContext';
import { HelpDrawer } from './HelpDrawer';
import { IvccaProvider, ROOT_SCOPE, useIvcca } from './store';
import { GROUPS, TOOLS } from './tools';
import type { ToolDef } from './tools';
import type { ToolId } from './types';
import { fmt } from './theme';
import { Btn } from './ui';
import { HelpPanel } from './panels/HelpPanel';
import { DataPanel } from './panels/DataPanel';
import { CorrelationPanel } from './panels/CorrelationPanel';
import { HeatmapPanel } from './panels/HeatmapPanel';
import { DistributionPanel } from './panels/DistributionPanel';
import { DendrogramPanel } from './panels/DendrogramPanel';
import { OptimalKPanel } from './panels/OptimalKPanel';
import { EmbeddingPanel } from './panels/EmbeddingPanel';
import { GeneSetsPanel } from './panels/GeneSetsPanel';
import {
  CeciPanel,
  CompareSetsPanel,
  GeneToGenesPanel,
  GeneToPathwaysPanel,
  SinglePathwayPanel,
} from './panels/PathwayPanels';
import { NetworkPanel } from './panels/NetworkPanel';


function useToolStatus() {
  const { session, busy, toolState } = useIvcca();
  return (tool: ToolDef): 'locked' | 'ready' | 'running' | 'done' => {
    const unlocked =
      tool.requires === 'none' ||
      (tool.requires === 'dataset' && Boolean(session)) ||
      (tool.requires === 'correlation' && Boolean(session?.correlation));
    if (!unlocked) return 'locked';
    const busyKey = tool.stateKey ?? tool.id;
    if (busy[busyKey] || (tool.id === 'correlation' && busy.correlation) || (tool.id === 'data' && busy.data)) return 'running';
    if (tool.id === 'data' && session) return 'done';
    if (tool.id === 'correlation' && session?.correlation) return 'done';
    const st = tool.stateKey ? (toolState[tool.stateKey] as { result?: unknown } | undefined) : undefined;
    if (st?.result) return 'done';
    return 'ready';
  };
}

function StatusMark({ status }: { status: ReturnType<ReturnType<typeof useToolStatus>> }) {
  if (status === 'running') return <LoaderCircle className="h-3.5 w-3.5 animate-spin text-[#00FFAA]" aria-label="Running" />;
  if (status === 'done') return <Check className="h-3.5 w-3.5 text-[#00FFAA]" aria-label="Done" />;
  if (status === 'locked') return <Lock className="h-3 w-3 text-zinc-600" aria-label="Locked" />;
  return null;
}

/** Which matrix the tools run on: the full dataset or a pathway sub-matrix. */
function ScopeSwitcher({ collapsed }: { collapsed: boolean }) {
  const { session, scopes, setActiveScope, removeScope, setActiveTool } = useIvcca();
  if (!session?.correlation && scopes.length <= 1) return null;
  const active = session?.scope;

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setActiveTool('pathway')}
        title={active ? `Analysing: ${active.label} (${active.nGenes} genes)` : 'Analysis scope'}
        className="mx-auto mb-3 flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-zinc-300 hover:bg-white/5"
      >
        <Layers className={cn('h-4 w-4', active?.kind === 'pathway' && 'text-violet-300')} />
      </button>
    );
  }

  return (
    <div className="mb-4">
      <p className="px-2.5 pb-1.5 pt-1 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-zinc-500">Analysing</p>
      <ul className="max-h-56 overflow-y-auto rounded-lg border border-white/10 bg-white/[0.02] py-1">
        {scopes.map((s) => {
          const isActive = s.id === active?.id;
          return (
            <li key={s.id} className="group flex items-center">
              <button
                type="button"
                onClick={() => setActiveScope(s.id)}
                aria-current={isActive ? 'true' : undefined}
                title={s.kind === 'pathway' ? `${s.label}: ${s.nGenes} × ${s.nGenes} sub-matrix` : 'Full correlation matrix'}
                className={cn(
                  'flex min-w-0 flex-1 items-center gap-2 px-2.5 py-1.5 text-left text-[13px] transition-colors',
                  isActive ? 'text-white' : 'text-zinc-400 hover:text-zinc-100',
                )}
              >
                <span
                  className={cn(
                    'h-2 w-2 shrink-0 rounded-full',
                    s.kind === 'dataset' ? 'bg-[#00FFAA]' : 'bg-violet-400',
                    !isActive && 'opacity-40',
                  )}
                />
                <span className={cn('min-w-0 flex-1 truncate', isActive && 'font-medium')}>{s.label}</span>
                <span className="shrink-0 text-[11px] tabular-nums text-zinc-500">{s.nGenes.toLocaleString()}</span>
              </button>
              {s.kind === 'pathway' && (
                <button
                  type="button"
                  aria-label={`Remove ${s.label}`}
                  onClick={() => {
                    if (window.confirm(`Remove the pathway matrix “${s.label}”? Its results will be cleared.`)) removeScope(s.id);
                  }}
                  className="mr-1.5 rounded p-0.5 text-zinc-600 opacity-0 hover:bg-white/10 hover:text-zinc-200 focus:opacity-100 group-hover:opacity-100"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          );
        })}
        <li>
          <button
            type="button"
            onClick={() => setActiveTool('pathway')}
            className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] text-zinc-500 hover:text-zinc-200"
          >
            <Plus className="h-3.5 w-3.5" />
            Pathway matrix
          </button>
        </li>
      </ul>
    </div>
  );
}

function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { activeTool, setActiveTool } = useIvcca();
  const statusOf = useToolStatus();

  return (
    <nav
      aria-label="IVCCA tools"
      className={cn(
        'sticky top-[7.5rem] hidden h-[calc(100vh-7.5rem)] shrink-0 flex-col border-r border-white/10 bg-[#0b0c0f]/90 backdrop-blur-xl transition-[width] duration-200 lg:flex',
        collapsed ? 'w-[60px]' : 'w-[244px]',
      )}
    >
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-3">
        <ScopeSwitcher collapsed={collapsed} />
        {GROUPS.map((group) => (
          <div key={group} className="mb-3">
            {!collapsed && (
              <p className="px-2.5 pb-1.5 pt-1 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-zinc-500">{group}</p>
            )}
            {collapsed && <div className="mx-3 mb-2 mt-1 h-px bg-white/10" />}
            <ul className="space-y-0.5">
              {TOOLS.filter((t) => t.group === group).map((tool) => {
                const status = statusOf(tool);
                const active = activeTool === tool.id;
                const Icon = tool.icon;
                return (
                  <li key={tool.id}>
                    <button
                      type="button"
                      onClick={() => setActiveTool(tool.id)}
                      title={collapsed ? tool.label : status === 'locked' ? 'Compute the correlation matrix first' : undefined}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'group relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-left text-[13px] transition-colors',
                        active ? 'bg-white/[0.09] text-white' : 'text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-100',
                        status === 'locked' && !active && 'text-zinc-600 hover:text-zinc-400',
                        collapsed && 'justify-center px-0',
                      )}
                    >
                      {active && <span className="absolute left-0 top-1.5 h-[calc(100%-12px)] w-[2px] rounded-full bg-[#00FFAA]" />}
                      <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-[#00FFAA]' : '')} />
                      {!collapsed && (
                        <>
                          <span className="min-w-0 flex-1 truncate">{tool.label}</span>
                          <StatusMark status={status} />
                        </>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-white/10 p-2">
        <button
          type="button"
          onClick={onToggle}
          className={cn(
            'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-zinc-500 hover:bg-white/5 hover:text-zinc-200',
            collapsed && 'justify-center px-0',
          )}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          {!collapsed && 'Collapse'}
        </button>
      </div>
    </nav>
  );
}

/** Tool switcher for narrow screens, where the sidebar is hidden. */
function MobileToolBar() {
  const { activeTool, setActiveTool, scopes, session, setActiveScope } = useIvcca();
  const statusOf = useToolStatus();
  return (
    <div className="sticky top-[7.5rem] z-20 space-y-2 border-b border-slate-200 bg-white/95 px-4 py-2 backdrop-blur lg:hidden">
      {scopes.length > 1 && (
        <select
          value={session?.scope.id ?? ROOT_SCOPE}
          onChange={(e) => setActiveScope(e.target.value)}
          className="h-9 w-full rounded-lg border border-violet-200 bg-violet-50 px-3 text-sm"
          aria-label="Analysis scope"
        >
          {scopes.map((s) => (
            <option key={s.id} value={s.id}>
              {s.kind === 'dataset' ? `Full dataset (${s.nGenes} genes)` : `Pathway: ${s.label} (${s.nGenes} × ${s.nGenes})`}
            </option>
          ))}
        </select>
      )}
      <select
        value={activeTool}
        onChange={(e) => setActiveTool(e.target.value as ToolId)}
        className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
        aria-label="Choose tool"
      >
        {GROUPS.map((g) => (
          <optgroup key={g} label={g}>
            {TOOLS.filter((t) => t.group === g).map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
                {statusOf(t) === 'done' ? ' ✓' : statusOf(t) === 'locked' ? ' (locked)' : ''}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}

function ActivityDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { activity } = useIvcca();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open || typeof document === 'undefined') return null;
  // Portalled to <body> so the drawer covers the site navbar (the workspace sits in a z-indexed <main>).
  return createPortal(
    <div className="fixed inset-0 z-[70] flex justify-end" role="dialog" aria-label="Activity log">
      <button type="button" aria-label="Close activity log" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-sm flex-col bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Activity</h2>
            <p className="text-xs text-slate-500">Every computation in this session</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700">
            <X className="h-5 w-5" />
          </button>
        </header>
        <ol className="flex-1 overflow-auto px-5 py-3">
          {activity.length === 0 && <li className="py-10 text-center text-sm text-slate-400">Nothing has run yet.</li>}
          {activity.map((a) => (
            <li key={a.id} className="flex gap-3 border-b border-slate-100 py-3 last:border-0">
              <span className="mt-0.5">
                {a.status === 'running' && <LoaderCircle className="h-4 w-4 animate-spin text-teal-600" />}
                {a.status === 'done' && <Check className="h-4 w-4 text-teal-600" />}
                {a.status === 'error' && <TriangleAlert className="h-4 w-4 text-red-600" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-800">{a.label}</p>
                {a.message && <p className="mt-0.5 break-words text-xs text-red-600">{a.message}</p>}
              </div>
              <span className="shrink-0 text-xs tabular-nums text-slate-400">
                {a.endedAt ? fmt.duration(a.endedAt - a.startedAt) : '…'}
              </span>
            </li>
          ))}
        </ol>
      </aside>
    </div>,
    document.body,
  );
}

function SessionBar({ onOpenActivity, onOpenHelp }: { onOpenActivity: () => void; onOpenHelp: () => void }) {
  const { session, activity, resetSession } = useIvcca();
  const [copied, setCopied] = useState(false);
  const latest = activity[0];
  const running = activity.filter((a) => a.status === 'running');

  return (
    <div className="sticky top-16 z-30 border-b border-white/10 bg-[#0A0A0A]/90 backdrop-blur-xl">
      <div className="flex h-14 items-center gap-4 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#00FFAA] to-[#22D3EE] text-[#0A0A0A]">
            <Grid3x3 className="h-4 w-4" />
          </span>
          <div className="min-w-0 leading-tight">
            <p className="text-sm font-semibold text-white">IVCCA</p>
            <p className="hidden truncate text-[11px] text-zinc-500 sm:block">Inter-Variability Cross-Correlation Analysis</p>
          </div>
        </div>

        {session && (
          <div className="hidden min-w-0 items-center gap-2 border-l border-white/10 pl-4 md:flex">
            <span className="inline-flex min-w-0 items-center gap-1.5 rounded-md bg-white/[0.06] px-2 py-1 text-xs text-zinc-200">
              <FileSpreadsheet className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
              <span className="max-w-[14rem] truncate">{session.dataset.fileName}</span>
            </span>
            <span className="whitespace-nowrap rounded-md bg-white/[0.06] px-2 py-1 text-xs tabular-nums text-zinc-300">
              {session.dataset.nSamples.toLocaleString()} samples × {session.dataset.nGenes.toLocaleString()} genes
            </span>
            {session.correlation && (
              <span className="whitespace-nowrap rounded-md bg-[#00FFAA]/10 px-2 py-1 text-xs capitalize text-[#00FFAA]">
                {session.correlation.method}
              </span>
            )}
            {session.scope.kind === 'pathway' && (
              <span className="inline-flex min-w-0 items-center gap-1.5 rounded-md bg-violet-500/15 px-2 py-1 text-xs text-violet-200">
                <Layers className="h-3.5 w-3.5 shrink-0" />
                <span className="max-w-[12rem] truncate">{session.scope.label}</span>
                <span className="tabular-nums text-violet-300/80">
                  {session.scope.nGenes} × {session.scope.nGenes}
                </span>
              </span>
            )}
            <button
              type="button"
              title="Copy session ID"
              onClick={() => {
                void navigator.clipboard?.writeText(session.analyzerId);
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              }}
              className="hidden items-center gap-1 rounded-md px-2 py-1 font-mono text-[11px] text-zinc-500 hover:bg-white/5 hover:text-zinc-300 xl:inline-flex"
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {session.analyzerId.slice(0, 8)}
            </button>
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenActivity}
            className="hidden max-w-[16rem] items-center gap-2 rounded-md px-2 py-1 text-xs text-zinc-400 hover:bg-white/5 hover:text-zinc-200 sm:inline-flex"
          >
            {running.length > 0 ? (
              <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-[#00FFAA]" />
            ) : latest?.status === 'error' ? (
              <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-red-400" />
            ) : (
              <History className="h-3.5 w-3.5 shrink-0" />
            )}
            <span className="truncate">
              {running.length > 0
                ? `${running[0].label}…`
                : latest
                  ? `${latest.label}${latest.endedAt ? ` · ${fmt.duration(latest.endedAt - latest.startedAt)}` : ''}`
                  : 'Activity'}
            </span>
          </button>
          <button
            type="button"
            onClick={onOpenHelp}
            title="Help for this tool (?)"
            className="inline-flex items-center gap-1.5 rounded-md border border-white/15 px-2.5 py-1.5 text-xs font-medium text-zinc-200 hover:border-white/30 hover:bg-white/5"
          >
            <CircleQuestionMark className="h-3.5 w-3.5" />
            Help
          </button>
          {session && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm('Start a new session? Results from this dataset will be cleared (your gene set library is kept).')) resetSession();
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-white/15 px-2.5 py-1.5 text-xs font-medium text-zinc-200 hover:border-white/30 hover:bg-white/5"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              New session
            </button>
          )}
          <Link
            href="/ivcca/classic"
            className="hidden rounded-md px-2 py-1.5 text-xs text-zinc-500 hover:text-zinc-300 xl:inline"
          >
            Classic view
          </Link>
        </div>
      </div>
    </div>
  );
}

/** Shown while a pathway sub-matrix is the active scope. */
function ScopeBanner() {
  const { session, setActiveScope, activeTool } = useIvcca();
  const [showMissing, setShowMissing] = useState(false);
  const scope = session?.scope;
  if (!session || !scope || scope.kind !== 'pathway' || activeTool === 'help') return null;
  // Gene-set tools always read the full dataset; say so instead of implying they use the pathway.
  const geneSetTool = ['pathway', 'gene-genes', 'gene-pathways', 'ceci', 'compare', 'gene-sets', 'data'].includes(activeTool);
  const missing = scope.missing ?? [];
  return (
    <div className="mb-5 rounded-xl border border-violet-200 bg-violet-50/80 px-4 py-3 text-sm text-violet-950">
      <div className="flex flex-wrap items-center gap-3">
        <Layers className="h-4 w-4 shrink-0 text-violet-600" />
        <p className="min-w-0 flex-1">
          <span className="font-semibold">Pathway matrix · {scope.label}</span>
          <span className="text-violet-900/80">
            {' '}— {scope.nGenes} × {scope.nGenes} genes extracted from the full {session.dataset.nGenes.toLocaleString()}-gene matrix.{' '}
            {geneSetTool ? 'This tool always uses the full dataset.' : 'This tool is running on the pathway matrix.'}
          </span>
          {missing.length > 0 && (
            <>
              {' '}
              <button type="button" onClick={() => setShowMissing((v) => !v)} className="font-medium text-violet-700 underline underline-offset-2">
                {missing.length} listed gene{missing.length === 1 ? '' : 's'} not in the dataset
              </button>
            </>
          )}
        </p>
        <Btn size="sm" onClick={() => setActiveScope(ROOT_SCOPE)}>
          Back to full dataset
        </Btn>
      </div>
      {showMissing && missing.length > 0 && (
        <p className="mt-2 break-words pl-7 font-mono text-xs text-violet-800">{missing.join(', ')}</p>
      )}
    </div>
  );
}

function ExpiredBanner() {
  const { sessionExpired, canRestore, restoreSession, resetSession, busy } = useIvcca();
  if (!sessionExpired) return null;
  return (
    <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <TriangleAlert className="h-4 w-4 shrink-0 text-amber-600" />
      <p className="min-w-0 flex-1">
        The analysis server no longer has this session (it may have restarted). Reload the dataset to continue.
      </p>
      {canRestore ? (
        <Btn size="sm" variant="primary" loading={busy.data || busy.correlation} onClick={() => void restoreSession()}>
          Restore session
        </Btn>
      ) : (
        <Btn size="sm" onClick={resetSession}>
          Start over
        </Btn>
      )}
    </div>
  );
}

const PANELS: Record<ToolId, () => ReactNode> = {
  data: () => <DataPanel />,
  correlation: () => <CorrelationPanel />,
  heatmap: () => <HeatmapPanel />,
  distribution: () => <DistributionPanel />,
  dendrogram: () => <DendrogramPanel />,
  'optimal-k': () => <OptimalKPanel />,
  pca: () => <EmbeddingPanel kind="pca" />,
  tsne: () => <EmbeddingPanel kind="tsne" />,
  'gene-sets': () => <GeneSetsPanel />,
  pathway: () => <SinglePathwayPanel />,
  'gene-genes': () => <GeneToGenesPanel />,
  'gene-pathways': () => <GeneToPathwaysPanel />,
  ceci: () => <CeciPanel />,
  compare: () => <CompareSetsPanel />,
  network: () => <NetworkPanel />,
  help: () => <HelpPanel />,
};

function WorkspaceBody() {
  const { activeTool, setActiveTool, hydrated } = useIvcca();
  const [collapsed, setCollapsed] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [helpTool, setHelpTool] = useState<ToolId | null>(null);

  const openHelp = useCallback((tool?: ToolId) => setHelpTool(tool ?? activeTool), [activeTool]);
  const closeHelp = useCallback(() => setHelpTool(null), []);
  const helpValue = useMemo(() => ({ openHelp }), [openHelp]);

  // "?" opens help for the current tool, unless the user is typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return;
      e.preventDefault();
      setHelpTool((open) => (open ? null : activeTool));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [activeTool]);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem('ivcca.sidebarCollapsed') === '1');
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!TOOLS.some((t) => t.id === activeTool)) setActiveTool('data');
  }, [activeTool, setActiveTool]);

  const render = PANELS[activeTool] ?? PANELS.data;

  return (
    <HelpContext.Provider value={helpValue}>
    <div className="relative">
      <SessionBar onOpenActivity={() => setActivityOpen(true)} onOpenHelp={() => openHelp()} />
      <div className="flex">
        <Sidebar
          collapsed={collapsed}
          onToggle={() => {
            setCollapsed((c) => {
              try {
                window.localStorage.setItem('ivcca.sidebarCollapsed', c ? '0' : '1');
              } catch {
                /* ignore */
              }
              return !c;
            });
          }}
        />
        <div className="min-h-[calc(100vh-7.5rem)] min-w-0 flex-1 bg-[#f4f5f7] text-slate-900">
          <MobileToolBar />
          <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
            <ExpiredBanner />
            {hydrated && <ScopeBanner />}
            {hydrated ? (
              render()
            ) : (
              <div className="flex h-64 items-center justify-center">
                <LoaderCircle className="h-6 w-6 animate-spin text-slate-400" aria-label="Restoring session" />
              </div>
            )}
          </div>
        </div>
      </div>
      <ActivityDrawer open={activityOpen} onClose={() => setActivityOpen(false)} />
      <HelpDrawer tool={helpTool} onClose={closeHelp} />
    </div>
    </HelpContext.Provider>
  );
}

export function IvccaWorkspace() {
  return (
    <IvccaProvider>
      <WorkspaceBody />
    </IvccaProvider>
  );
}
