'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, CircleQuestionMark, Lightbulb, ListChecks, Telescope, X } from 'lucide-react';
import { QUICK_START, SCOPE_HELP, TOOL_HELP } from './help';
import { pendingGuideSection } from './helpContext';
import { useIvcca } from './store';
import { TOOLS, toolLabel } from './tools';
import type { ToolId } from './types';
import { Btn } from './ui';

const SCOPED_TOOLS: ToolId[] = ['heatmap', 'distribution', 'dendrogram', 'optimal-k', 'pca', 'tsne', 'network'];

function Section({ icon, title, items, ordered }: { icon: React.ReactNode; title: string; items?: string[]; ordered?: boolean }) {
  if (!items?.length) return null;
  const List = ordered ? 'ol' : 'ul';
  return (
    <section className="mt-5">
      <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">
        {icon}
        {title}
      </h3>
      <List className="space-y-2">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-slate-700">
            <span
              className={
                ordered
                  ? 'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-teal-50 text-[11px] font-semibold text-teal-800 ring-1 ring-teal-600/15'
                  : 'mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300'
              }
            >
              {ordered ? i + 1 : null}
            </span>
            <span className="min-w-0">{item}</span>
          </li>
        ))}
      </List>
    </section>
  );
}

/** Side panel with help for one tool, opened from the session bar, a tool header or the “?” key. */
export function HelpDrawer({ tool, onClose }: { tool: ToolId | null; onClose: () => void }) {
  const { setActiveTool, session, activeTool } = useIvcca();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!tool) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [tool, onClose]);

  if (!tool || typeof document === 'undefined') return null;
  const help = tool === 'help' ? null : TOOL_HELP[tool];
  const Icon = TOOLS.find((t) => t.id === tool)?.icon ?? CircleQuestionMark;
  const openGuide = (section?: string) => {
    onClose();
    if (activeTool === 'help') {
      // the guide is already open, so it won't remount — scroll straight to the section
      if (section) document.getElementById(section)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    pendingGuideSection.current = section ?? null;
    setActiveTool('help');
  };

  // Portalled to <body>: the workspace sits in a z-indexed <main>, which would keep the drawer under the site navbar.
  return createPortal(
    <div className="fixed inset-0 z-[70] flex justify-end" role="dialog" aria-modal="true" aria-label={`Help: ${toolLabel(tool)}`}>
      <button type="button" aria-label="Close help" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-md flex-col bg-white text-slate-900 shadow-2xl">
        <header className="flex items-start gap-3 border-b border-slate-200 px-5 py-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700">
            <Icon className="h-4.5 w-4.5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-teal-700">How to use</p>
            <h2 className="text-base font-semibold text-slate-900">{help ? help.title : 'Getting started'}</h2>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 pb-6 pt-4">
          {help ? (
            <>
              <p className="text-sm leading-relaxed text-slate-600">{help.summary}</p>
              <Section icon={<ListChecks className="h-3.5 w-3.5" />} title="Steps" items={help.steps} ordered />
              <Section icon={<Telescope className="h-3.5 w-3.5" />} title="Reading the results" items={help.reading} />
              <Section icon={<Lightbulb className="h-3.5 w-3.5" />} title="Tips" items={help.tips} />
              {SCOPED_TOOLS.includes(tool) && session?.scope.kind === 'pathway' && (
                <p className="mt-5 rounded-lg bg-violet-50 px-3 py-2 text-xs leading-relaxed text-violet-900">
                  Running on the pathway matrix <span className="font-semibold">{session.scope.label}</span> ({session.scope.nGenes} genes).
                  Switch back to the full dataset from the sidebar.
                </p>
              )}
            </>
          ) : (
            <>
              <p className="text-sm leading-relaxed text-slate-600">A typical IVCCA analysis, in order:</p>
              <ol className="mt-4 space-y-2">
                {QUICK_START.map((s, i) => (
                  <li key={s.tool}>
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        setActiveTool(s.tool);
                      }}
                      className="flex w-full gap-3 rounded-lg border border-slate-200 px-3 py-2.5 text-left hover:border-teal-600/40 hover:bg-slate-50"
                    >
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-teal-50 text-[11px] font-semibold text-teal-800">
                        {i + 1}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-slate-900">{s.title}</span>
                        <span className="block text-xs text-slate-500">{s.text}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
              <Section icon={<Lightbulb className="h-3.5 w-3.5" />} title={SCOPE_HELP.title} items={SCOPE_HELP.points} />
            </>
          )}
        </div>

        <footer className="flex flex-wrap items-center gap-2 border-t border-slate-200 px-5 py-3">
          <Btn size="sm" variant="primary" icon={<BookOpen className="h-3.5 w-3.5" />} onClick={() => openGuide(help ? `help-${tool}` : undefined)}>
            Full guide
          </Btn>
          <Btn size="sm" variant="ghost" onClick={() => openGuide('help-glossary')}>
            Glossary
          </Btn>
          <Btn size="sm" variant="ghost" onClick={() => openGuide('help-faq')}>
            Troubleshooting
          </Btn>
          <span className="ml-auto text-[11px] text-slate-400">
            Press <kbd className="rounded border border-slate-300 bg-slate-50 px-1 font-sans">?</kbd> anywhere
          </span>
        </footer>
      </aside>
    </div>,
    document.body,
  );
}
