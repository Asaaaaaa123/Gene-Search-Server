'use client';

import dynamic from 'next/dynamic';
import { useCallback, useMemo, useRef } from 'react';
import { ImageDown } from 'lucide-react';
import { baseLayout } from './theme';
import { Menu } from './ui';

const Plot = dynamic(() => import('react-plotly.js'), {
  ssr: false,
  loading: () => <ChartSkeleton />,
}) as unknown as React.ComponentType<Record<string, unknown>>;

export function ChartSkeleton({ height = 360 }: { height?: number }) {
  return (
    <div className="flex items-center justify-center rounded-lg bg-slate-50" style={{ height }}>
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-teal-600" />
    </div>
  );
}

export type PlotlyLike = {
  downloadImage: (gd: HTMLElement, opts: Record<string, unknown>) => Promise<unknown>;
  relayout: (gd: HTMLElement, update: Record<string, unknown>) => Promise<unknown>;
  update: (
    gd: HTMLElement,
    traceUpdate: Record<string, unknown>,
    layoutUpdate: Record<string, unknown>,
    traces?: number[],
  ) => Promise<unknown>;
};

/** The same Plotly instance react-plotly renders with (for imperative updates such as camera animation). */
export async function loadPlotly(): Promise<PlotlyLike> {
  const mod = (await import('plotly.js/dist/plotly')) as unknown as { default?: PlotlyLike } & PlotlyLike;
  return mod.default ?? mod;
}

export type ChartEvent = { points?: Array<Record<string, unknown>> };

export function useChartExport(filename: string) {
  const graph = useRef<HTMLElement | null>(null);
  const onInitialized = useCallback((_: unknown, gd: HTMLElement) => {
    graph.current = gd;
  }, []);
  const exportAs = useCallback(
    async (format: 'png' | 'svg') => {
      if (!graph.current) return;
      const Plotly = await loadPlotly();
      await Plotly.downloadImage(graph.current, {
        format,
        filename,
        scale: format === 'png' ? 3 : 1,
        width: graph.current.clientWidth,
        height: graph.current.clientHeight,
      });
    },
    [filename],
  );
  return { onInitialized, exportAs };
}

export function ExportMenu({ onExport, extra }: {
  onExport: (format: 'png' | 'svg') => void;
  extra?: Array<{ label: string; onSelect: () => void; hint?: string }>;
}) {
  return (
    <Menu
      label="Export"
      icon={<ImageDown className="h-3.5 w-3.5" />}
      items={[
        { label: 'PNG image', hint: '3× resolution', onSelect: () => onExport('png') },
        { label: 'SVG vector', hint: 'for papers', onSelect: () => onExport('svg') },
        ...(extra ?? []),
      ]}
    />
  );
}

/**
 * Responsive Plotly chart on the workspace theme. The container owns the size:
 * width follows the card, height is explicit, so axis bands are never clipped.
 */
export function Chart({
  data,
  layout,
  height,
  width,
  config,
  onClick,
  onInitialized,
  className,
}: {
  data: unknown[];
  layout?: Record<string, unknown>;
  height: number;
  /** Fixed pixel width; omit to fill the container. */
  width?: number;
  config?: Record<string, unknown>;
  onClick?: (e: ChartEvent) => void;
  onInitialized?: (figure: unknown, gd: HTMLElement) => void;
  className?: string;
}) {
  const fullLayout = useMemo(() => baseLayout(layout), [layout]);
  const fullConfig = useMemo(
    () => ({
      responsive: true,
      displaylogo: false,
      displayModeBar: 'hover',
      modeBarButtonsToRemove: ['lasso2d', 'select2d', 'autoScale2d', 'toggleSpikelines', 'toImage'],
      ...config,
    }),
    [config],
  );
  return (
    <div className={className} style={{ height, width: width ?? '100%', maxWidth: '100%' }}>
      <Plot
        data={data}
        layout={fullLayout}
        config={fullConfig}
        useResizeHandler
        style={{ width: '100%', height: '100%' }}
        onClick={onClick}
        onInitialized={onInitialized}
        onUpdate={onInitialized}
      />
    </div>
  );
}
