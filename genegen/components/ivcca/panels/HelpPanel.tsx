'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Check, ChevronDown, Keyboard, Layers, LifeBuoy, Lock, Rocket } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FAQ, GLOSSARY, QUICK_START, SCOPE_HELP, SHORTCUTS, TOOL_HELP } from '../help';
import type { ToolHelp } from '../help';
import { pendingGuideSection } from '../helpContext';
import { useIvcca } from '../store';
import { GROUPS, TOOLS } from '../tools';
import type { ToolId } from '../types';
import { Btn, Card, SearchInput, ToolHeader } from '../ui';

function matches(q: string, ...texts: Array<string | string[] | undefined>) {
  if (!q) return true;
  const needle = q.toLowerCase();
  return texts.some((t) => (Array.isArray(t) ? t.join(' ') : t ?? '').toLowerCase().includes(needle));
}

/** Small picture of a pathway matrix: a gene list's rows and columns cut out of the full matrix. */
function ScopeDiagram() {
  const n = 9;
  const picked = new Set([1, 4, 6]);
  const cell = 14;
  return (
    <svg viewBox="0 0 300 140" className="h-auto w-full max-w-[320px]" role="img" aria-label="Three genes' rows and columns cut from a 9 × 9 matrix form a 3 × 3 pathway matrix">
      {Array.from({ length: n * n }, (_, k) => {
        const r = Math.floor(k / n);
        const c = k % n;
        const hit = picked.has(r) && picked.has(c);
        const band = picked.has(r) || picked.has(c);
        return (
          <rect
            key={k}
            x={6 + c * cell}
            y={6 + r * cell}
            width={cell - 2}
            height={cell - 2}
            rx={2}
            fill={hit ? '#7c3aed' : band ? '#ddd6fe' : '#e2e8f0'}
          />
        );
      })}
      <path d="M150 70 h40" stroke="#94a3b8" strokeWidth={2} markerEnd="url(#arrow)" />
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0 0 L10 5 L0 10 z" fill="#94a3b8" />
        </marker>
      </defs>
      {Array.from({ length: 9 }, (_, k) => (
        <rect key={k} x={212 + (k % 3) * 24} y={34 + Math.floor(k / 3) * 24} width={21} height={21} rx={3} fill="#7c3aed" />
      ))}
      <text x={68} y={136} textAnchor="middle" fontSize={10} fill="#64748b">
        full matrix
      </text>
      <text x={246} y={120} textAnchor="middle" fontSize={10} fill="#64748b">
        pathway matrix
      </text>
    </svg>
  );
}

function ToolGuide({ id, help, open, onToggle }: { id: ToolId; help: ToolHelp; open: boolean; onToggle: () => void }) {
  const { setActiveTool } = useIvcca();
  const Icon = TOOLS.find((t) => t.id === id)?.icon;
  return (
    <li id={`help-${id}`} className="scroll-mt-36 border-b border-slate-100 last:border-0">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50">
        {Icon && (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
            <Icon className="h-4 w-4" />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-slate-900">{help.title}</span>
          <span className="block text-xs text-slate-500">{help.summary}</span>
        </span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="grid gap-5 px-4 pb-4 pl-[3.75rem] md:grid-cols-2">
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">Steps</p>
            <ol className="list-decimal space-y-1.5 pl-4 text-sm leading-relaxed text-slate-700 marker:text-slate-400">
              {help.steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          </div>
          <div className="space-y-4">
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">Reading the results</p>
              <ul className="list-disc space-y-1.5 pl-4 text-sm leading-relaxed text-slate-700 marker:text-slate-300">
                {help.reading.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
            {help.tips?.length ? (
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">Tips</p>
                <ul className="list-disc space-y-1.5 pl-4 text-sm leading-relaxed text-slate-700 marker:text-slate-300">
                  {help.tips.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
          <div className="md:col-span-2">
            <Btn size="sm" icon={<ArrowRight className="h-3.5 w-3.5" />} onClick={() => setActiveTool(id)}>
              Open {help.title}
            </Btn>
          </div>
        </div>
      )}
    </li>
  );
}

export function HelpPanel() {
  const { session, setActiveTool } = useIvcca();
  const [query, setQuery] = useState('');
  const [openTools, setOpenTools] = useState<Set<ToolId>>(new Set());
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const q = query.trim();

  // Arriving from the help drawer: expand the requested tool and scroll to it (or to the glossary / FAQ).
  useEffect(() => {
    const section = pendingGuideSection.current;
    if (!section) return;
    const tool = section.replace(/^help-/, '') as ToolId;
    if (tool in TOOL_HELP) setOpenTools(new Set([tool]));
    // the request is consumed only once the scroll runs (effects may be re-run before the timer fires)
    const t = setTimeout(() => {
      pendingGuideSection.current = null;
      document.getElementById(section)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
    return () => clearTimeout(t);
  }, []);

  const toolIds = useMemo(
    () =>
      TOOLS.filter((t) => t.id !== 'help')
        .map((t) => t.id as Exclude<ToolId, 'help'>)
        .filter((id) => {
          const h = TOOL_HELP[id];
          return matches(q, h.title, h.summary, h.steps, h.reading, h.tips);
        }),
    [q],
  );
  const glossary = GLOSSARY.filter((g) => matches(q, g.term, g.definition));
  const faq = FAQ.filter((f) => matches(q, f.q, f.a));

  const stepStatus = (tool: ToolId) => {
    if (tool === 'data') return session ? 'done' : 'todo';
    if (tool === 'correlation') return session?.correlation ? 'done' : session ? 'todo' : 'locked';
    return session?.correlation ? 'todo' : 'locked';
  };

  return (
    <div>
      <ToolHeader
        eyebrow="Help"
        title="Help & guide"
        hideHelp
        description="How to run an IVCCA analysis, what every tool does, and how to read its results. Press ? on any page for help with the tool you are using."
        actions={<SearchInput value={query} onChange={setQuery} placeholder="Search the guide…" className="w-64" />}
      />

      {!q && (
        <>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Rocket className="h-4 w-4 text-teal-700" />
            Quick start
          </h3>
          <ol className="mb-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {QUICK_START.map((s, i) => {
              const status = stepStatus(s.tool);
              return (
                <li key={s.tool}>
                  <button
                    type="button"
                    onClick={() => setActiveTool(s.tool)}
                    className="group flex h-full w-full items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-[0_1px_2px_rgba(16,24,40,0.05)] transition hover:border-teal-600/40 hover:shadow-md"
                  >
                    <span
                      className={cn(
                        'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                        status === 'done' ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-600',
                      )}
                    >
                      {status === 'done' ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : i + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                        {s.title}
                        {status === 'locked' && <Lock className="h-3 w-3 text-slate-400" aria-label="Needs the earlier steps" />}
                        <ArrowRight className="h-3.5 w-3.5 opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
                      </span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">{s.text}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>

          <Card className="mb-8" title={SCOPE_HELP.title} subtitle="Analyse any gene list as its own matrix">
            <div className="grid items-center gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
              <ul className="space-y-2">
                {SCOPE_HELP.points.map((p, i) => (
                  <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-slate-700">
                    <Layers className="mt-1 h-3.5 w-3.5 shrink-0 text-violet-600" />
                    {p}
                  </li>
                ))}
              </ul>
              <ScopeDiagram />
            </div>
          </Card>
        </>
      )}

      <h3 className="mb-3 text-sm font-semibold text-slate-900">Tools</h3>
      {toolIds.length === 0 ? (
        <p className="mb-8 text-sm text-slate-500">No tool matches “{q}”.</p>
      ) : (
        <div className="mb-8 space-y-4">
          {GROUPS.filter((g) => g !== 'Help').map((group) => {
            const ids = toolIds.filter((id) => TOOLS.find((t) => t.id === id)?.group === group);
            if (!ids.length) return null;
            return (
              <Card key={group} title={group} bodyClassName="p-0">
                <ul>
                  {ids.map((id) => (
                    <ToolGuide
                      key={id}
                      id={id}
                      help={TOOL_HELP[id]}
                      open={Boolean(q) || openTools.has(id)}
                      onToggle={() =>
                        setOpenTools((prev) => {
                          const next = new Set(prev);
                          if (next.has(id)) next.delete(id);
                          else next.add(id);
                          return next;
                        })
                      }
                    />
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
      )}

      <div className="grid items-start gap-4 xl:grid-cols-2">
        <section id="help-glossary" className="scroll-mt-36">
          <Card title="Glossary" subtitle={`${glossary.length} terms`}>
            {glossary.length === 0 ? (
              <p className="text-sm text-slate-500">No term matches “{q}”.</p>
            ) : (
              <dl className="divide-y divide-slate-100">
                {glossary.map((g) => (
                  <div key={g.term} className="grid gap-1 py-2.5 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4">
                    <dt className="text-sm font-semibold text-slate-900">{g.term}</dt>
                    <dd className="text-sm leading-relaxed text-slate-600">{g.definition}</dd>
                  </div>
                ))}
              </dl>
            )}
          </Card>
        </section>

        <div className="space-y-4">
          <section id="help-faq" className="scroll-mt-36">
            <Card title={<span className="inline-flex items-center gap-2"><LifeBuoy className="h-4 w-4 text-teal-700" />Troubleshooting & FAQ</span>} bodyClassName="p-0">
              {faq.length === 0 ? (
                <p className="p-4 text-sm text-slate-500">No question matches “{q}”.</p>
              ) : (
                <ul>
                  {faq.map((f, i) => {
                    const open = Boolean(q) || openFaq === i;
                    return (
                      <li key={f.q} className="border-b border-slate-100 last:border-0">
                        <button
                          type="button"
                          aria-expanded={open}
                          onClick={() => setOpenFaq(open ? null : i)}
                          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-medium text-slate-900 hover:bg-slate-50"
                        >
                          {f.q}
                          <ChevronDown className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform', open && 'rotate-180')} />
                        </button>
                        {open && <p className="px-4 pb-3 text-sm leading-relaxed text-slate-600">{f.a}</p>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </section>

          {!q && (
            <Card title={<span className="inline-flex items-center gap-2"><Keyboard className="h-4 w-4 text-teal-700" />Shortcuts & gestures</span>}>
              <dl className="space-y-2">
                {SHORTCUTS.map((s) => (
                  <div key={s.keys} className="flex items-center gap-3 text-sm">
                    <dt className="w-36 shrink-0">
                      <kbd className="rounded-md border border-slate-300 bg-slate-50 px-1.5 py-0.5 font-sans text-xs text-slate-700 shadow-[0_1px_0_#cbd5e1]">
                        {s.keys}
                      </kbd>
                    </dt>
                    <dd className="text-slate-600">{s.action}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
