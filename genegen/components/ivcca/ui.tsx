'use client';

import { forwardRef, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  CircleQuestionMark,
  Download,
  Info,
  LoaderCircle,
  Lock,
  Search,
  TriangleAlert,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useHelp } from './helpContext';
import { downloadText, toCsv } from './matrix';

/* ------------------------------------------------------------------ */
/* Buttons                                                             */
/* ------------------------------------------------------------------ */

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  loading?: boolean;
  icon?: ReactNode;
};

export const Btn = forwardRef<HTMLButtonElement, BtnProps>(function Btn(
  { variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || loading}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-2 rounded-lg font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/50 focus-visible:ring-offset-1',
        'disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-8 px-3 text-xs' : 'h-9 px-4 text-sm',
        variant === 'primary' && 'bg-slate-900 text-white shadow-sm hover:bg-slate-800',
        variant === 'secondary' &&
          'border border-slate-200 bg-white text-slate-700 shadow-sm hover:border-slate-300 hover:bg-slate-50',
        variant === 'ghost' && 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
        variant === 'danger' && 'border border-red-200 bg-white text-red-600 hover:bg-red-50',
        className,
      )}
      {...props}
    >
      {loading ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

export function ToolHeader({
  title,
  description,
  actions,
  eyebrow,
  hideHelp,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: string;
  /** The guide page itself has no "How to use" button. */
  hideHelp?: boolean;
}) {
  const help = useHelp();
  const showHelp = Boolean(help) && !hideHelp;
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 max-w-3xl">
        {eyebrow && (
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-teal-700">{eyebrow}</p>
        )}
        <h2 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h2>
        {description && <p className="mt-1 text-sm leading-relaxed text-slate-600">{description}</p>}
      </div>
      {(actions || showHelp) && (
        <div className="flex flex-wrap items-center gap-2">
          {showHelp && (
            <Btn size="sm" variant="ghost" icon={<CircleQuestionMark className="h-3.5 w-3.5" />} onClick={() => help?.openHelp()}>
              How to use
            </Btn>
          )}
          {actions}
        </div>
      )}
    </div>
  );
}

export function Card({
  title,
  subtitle,
  actions,
  children,
  className,
  bodyClassName,
  style,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  style?: React.CSSProperties;
}) {
  return (
    <section
      style={style}
      className={cn(
        'min-w-0 rounded-xl border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)]',
        className,
      )}
    >
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="min-w-0 pt-0.5">
            {title && <h3 className="text-sm font-semibold text-slate-900">{title}</h3>}
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn('p-4', bodyClassName)}>{children}</div>
    </section>
  );
}

/** A horizontal strip of parameter controls that scopes everything below it. */
export function ControlBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'mb-4 flex flex-wrap items-end gap-x-5 gap-y-3 rounded-xl border border-slate-200/90 bg-white px-4 py-3 shadow-[0_1px_2px_rgba(16,24,40,0.05)]',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
        {label}
        {hint && <HintIcon text={hint} />}
      </span>
      {children}
    </div>
  );
}

export function HintIcon({ text }: { text: ReactNode }) {
  return (
    <span className="group relative inline-flex">
      <Info className="h-3.5 w-3.5 text-slate-400" aria-hidden />
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-5 z-40 w-64 -translate-x-1/2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-normal normal-case leading-relaxed tracking-normal text-slate-100 opacity-0 shadow-lg transition-opacity group-hover:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Inputs                                                              */
/* ------------------------------------------------------------------ */

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  disabled,
  size = 'md',
  ariaLabel,
}: {
  value: T;
  options: Array<{ value: T; label: ReactNode; disabled?: boolean; title?: string }>;
  onChange: (v: T) => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
  ariaLabel?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn('inline-flex rounded-lg bg-slate-100 p-0.5', disabled && 'opacity-50')}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            role="radio"
            aria-checked={active}
            title={opt.title}
            disabled={disabled || opt.disabled}
            onClick={() => onChange(opt.value)}
            className={cn(
              'whitespace-nowrap rounded-md font-medium transition-all',
              size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm',
              active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800',
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

const inputClass =
  'h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 disabled:bg-slate-50 disabled:text-slate-400';

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  disabled,
  placeholder,
  className,
  allowEmpty,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  allowEmpty?: boolean;
}) {
  const [draft, setDraft] = useState(value === null ? '' : String(value));
  useEffect(() => setDraft(value === null ? '' : String(value)), [value]);
  const commit = () => {
    if (draft.trim() === '') {
      if (allowEmpty) onChange(null);
      else setDraft(value === null ? '' : String(value));
      return;
    }
    let n = Number(draft);
    if (!Number.isFinite(n)) {
      setDraft(value === null ? '' : String(value));
      return;
    }
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    onChange(n);
    setDraft(String(n));
  };
  return (
    <input
      type="number"
      inputMode="decimal"
      value={draft}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
      className={cn(inputClass, 'w-24 tabular-nums', className)}
    />
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(inputClass, props.className)} />;
}

export function SelectInput({
  value,
  onChange,
  options,
  disabled,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('relative', className)}>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={cn(inputClass, 'w-full appearance-none pr-8')}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-2.5 h-4 w-4 text-slate-400" aria-hidden />
    </div>
  );
}

export function Slider({
  value,
  onChange,
  min,
  max,
  step = 1,
  format = (v: number) => String(v),
  disabled,
  className,
  ariaLabel,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div className={cn('flex h-9 items-center gap-3', className)}>
      <input
        type="range"
        aria-label={ariaLabel}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full min-w-24 cursor-pointer appearance-auto accent-teal-600 disabled:cursor-not-allowed"
      />
      <span className="min-w-[3.25rem] rounded-md bg-slate-100 px-2 py-1 text-center text-xs font-medium tabular-nums text-slate-700">
        {format(value)}
      </span>
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className={cn('flex h-9 cursor-pointer items-center gap-2.5 text-sm text-slate-700', disabled && 'opacity-50')}>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors',
          checked ? 'bg-teal-600' : 'bg-slate-300',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-[18px]' : 'translate-x-0.5',
          )}
        />
      </button>
      {label}
    </label>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" aria-hidden />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(inputClass, 'w-full pl-8 pr-7')}
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange('')}
          className="absolute right-2 top-2.5 text-slate-400 hover:text-slate-600"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Feedback                                                            */
/* ------------------------------------------------------------------ */

export function StatTile({
  label,
  value,
  sub,
  className,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('rounded-xl border border-slate-200/90 bg-white px-4 py-3 shadow-[0_1px_2px_rgba(16,24,40,0.05)]', className)}>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold tracking-tight text-slate-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

export function InlineError({ message, onDismiss }: { message: string | null | undefined; onDismiss?: () => void }) {
  if (!message) return null;
  return (
    <div role="alert" className="mb-4 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden />
      <p className="min-w-0 flex-1 break-words">{message}</p>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss error" className="text-red-500 hover:text-red-700">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' }) {
  return (
    <div
      className={cn(
        'flex items-start gap-2.5 rounded-lg px-3 py-2 text-xs leading-relaxed',
        tone === 'info' ? 'bg-slate-100 text-slate-600' : 'bg-amber-50 text-amber-800',
      )}
    >
      {tone === 'info' ? (
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      ) : (
        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      )}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white/60 px-6 py-14 text-center',
        className,
      )}
    >
      {icon && (
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-slate-500">{icon}</div>
      )}
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      {description && <p className="mt-1 max-w-md text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function LockedState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <EmptyState icon={<Lock className="h-5 w-5" />} title={title} description={description} action={action} />;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-slate-500">
      <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
      {label}
    </span>
  );
}

/** Keeps the previous render visible (dimmed) while a recomputation runs — no layout jump. */
export function BusyOverlay({ busy, label, children }: { busy: boolean; label?: string; children: ReactNode }) {
  return (
    <div className="relative" aria-busy={busy}>
      <div className={cn('transition-opacity', busy && 'pointer-events-none opacity-40')}>{children}</div>
      {busy && (
        <div className="absolute inset-0 flex items-start justify-center pt-24">
          <div className="rounded-full border border-slate-200 bg-white px-4 py-2 shadow-md">
            <Spinner label={label ?? 'Computing…'} />
          </div>
        </div>
      )}
    </div>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'teal' | 'amber' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium',
        tone === 'neutral' && 'bg-slate-100 text-slate-600',
        tone === 'teal' && 'bg-teal-50 text-teal-700 ring-1 ring-teal-600/15',
        tone === 'amber' && 'bg-amber-50 text-amber-700 ring-1 ring-amber-600/15',
      )}
    >
      {children}
    </span>
  );
}

/** A small popover menu (used for export options). */
export function Menu({
  label,
  icon,
  items,
  align = 'right',
}: {
  label: ReactNode;
  icon?: ReactNode;
  items: Array<{ label: string; onSelect: () => void; hint?: string }>;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <Btn size="sm" icon={icon} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu">
        {label}
        <ChevronDown className="h-3.5 w-3.5 text-slate-400" aria-hidden />
      </Btn>
      {open && (
        <div
          role="menu"
          className={cn(
            'absolute z-40 mt-1 min-w-[12rem] overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className="flex w-full items-center justify-between gap-4 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
            >
              {item.label}
              {item.hint && <span className="text-xs text-slate-400">{item.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Data table                                                          */
/* ------------------------------------------------------------------ */

export type Column<Row> = {
  key: string;
  header: string;
  align?: 'left' | 'right';
  /** Value used for sorting & CSV export. */
  value: (row: Row) => string | number | null;
  render?: (row: Row) => ReactNode;
  width?: string;
  mono?: boolean;
};

export function DataTable<Row>({
  columns,
  rows,
  searchKeys,
  exportName,
  maxHeight = 420,
  initialSort,
  onRowClick,
  rowKey,
  emptyText = 'No rows',
  title,
  isRowActive,
}: {
  columns: Column<Row>[];
  rows: Row[];
  searchKeys?: Array<(row: Row) => string>;
  exportName?: string;
  maxHeight?: number;
  initialSort?: { key: string; dir: 'asc' | 'desc' };
  onRowClick?: (row: Row) => void;
  rowKey: (row: Row, index: number) => string;
  emptyText?: string;
  title?: ReactNode;
  isRowActive?: (row: Row) => boolean;
}) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState(initialSort ?? null);

  const visible = useMemo(() => {
    let out = rows;
    if (query.trim() && searchKeys?.length) {
      const q = query.trim().toLowerCase();
      out = out.filter((r) => searchKeys.some((k) => k(r).toLowerCase().includes(q)));
    }
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      if (col) {
        out = [...out].sort((a, b) => {
          const va = col.value(a);
          const vb = col.value(b);
          if (va === null || va === undefined) return 1;
          if (vb === null || vb === undefined) return -1;
          const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
          return sort.dir === 'asc' ? cmp : -cmp;
        });
      }
    }
    return out;
  }, [rows, query, searchKeys, sort, columns]);

  const exportCsv = () => {
    if (!exportName) return;
    const cols = columns.filter((c) => c.header !== '');
    downloadText(toCsv([cols.map((c) => c.header), ...visible.map((r) => cols.map((c) => c.value(r)))]), `${exportName}.csv`);
  };

  return (
    <div className="min-w-0">
      {(title || searchKeys || exportName) && (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-slate-500">
            {title ?? (
              <>
                {visible.length.toLocaleString()} {visible.length === 1 ? 'row' : 'rows'}
                {query && rows.length !== visible.length ? ` of ${rows.length.toLocaleString()}` : ''}
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {searchKeys && <SearchInput value={query} onChange={setQuery} className="w-48" placeholder="Filter…" />}
            {exportName && (
              <Btn size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={exportCsv} disabled={!visible.length}>
                CSV
              </Btn>
            )}
          </div>
        </div>
      )}
      <div className="overflow-auto rounded-lg border border-slate-200" style={{ maxHeight }}>
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50">
            <tr>
              {columns.map((c) => {
                const active = sort?.key === c.key;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    style={{ width: c.width }}
                    className={cn(
                      'border-b border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600',
                      c.align === 'right' ? 'text-right' : 'text-left',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setSort((s) =>
                          s?.key === c.key ? { key: c.key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: 'desc' },
                        )
                      }
                      className={cn('inline-flex items-center gap-1 hover:text-slate-900', c.align === 'right' && 'flex-row-reverse')}
                    >
                      {c.header}
                      {active &&
                        (sort?.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-3 py-8 text-center text-sm text-slate-400">
                  {emptyText}
                </td>
              </tr>
            ) : (
              visible.map((row, i) => (
                <tr
                  key={rowKey(row, i)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    'border-b border-slate-100 last:border-0',
                    onRowClick && 'cursor-pointer hover:bg-slate-50',
                    isRowActive?.(row) && 'bg-teal-50/70 hover:bg-teal-50',
                  )}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={cn(
                        'px-3 py-1.5 text-slate-700',
                        c.align === 'right' && 'text-right tabular-nums',
                        c.mono && 'font-mono text-[13px]',
                      )}
                    >
                      {c.render ? c.render(row) : c.value(row) ?? '—'}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** A thin horizontal magnitude bar used inside tables and lists. */
export function ValueBar({ value, max = 1, signed }: { value: number; max?: number; signed?: boolean }) {
  const pct = Math.min(100, (Math.abs(value) / (max || 1)) * 100);
  const color = !signed ? '#2a78d6' : value >= 0 ? '#e34948' : '#2a78d6';
  return (
    <span className="inline-block h-1.5 w-16 overflow-hidden rounded-full bg-slate-100 align-middle">
      <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
    </span>
  );
}
