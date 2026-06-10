'use client';

import { Download, RefreshCw } from 'lucide-react';
import {
  CHART_TEXT_TARGET_LABELS,
  getActiveTextStyle,
  updateActiveTextStyle,
  type ChartExportFormat,
  type ChartStyleOptions,
  type ChartTextTarget,
} from '@/lib/chart-style';
import { VisualStyleControls } from './VisualStyleControls';

type ThematicGoChartPanelProps = {
  title: string;
  subtitle?: string;
  /** Default in-chart title shown when chartTitleText is empty */
  defaultChartTitle?: string;
  chartSrc: string | null;
  loading?: boolean;
  exportLoading?: boolean;
  variant: 'summary' | 'theme';
  style: ChartStyleOptions;
  onStyleChange: (style: ChartStyleOptions) => void;
  onApply: () => void;
  onExport: (format: ChartExportFormat) => void;
};

const EXPORT_FORMATS: { format: ChartExportFormat; label: string }[] = [
  { format: 'png', label: 'PNG' },
  { format: 'pdf', label: 'PDF' },
  { format: 'svg', label: 'SVG' },
];

const CHART_TARGETS = (Object.keys(CHART_TEXT_TARGET_LABELS) as ChartTextTarget[]).map(
  (value) => ({ value, label: CHART_TEXT_TARGET_LABELS[value] }),
);

export function ThematicGoChartPanel({
  title,
  subtitle,
  defaultChartTitle,
  chartSrc,
  loading = false,
  exportLoading = false,
  variant,
  style,
  onStyleChange,
  onApply,
  onExport,
}: ThematicGoChartPanelProps) {
  const busy = loading || exportLoading;
  const activeStyle = getActiveTextStyle(style.selectedTarget, style.textStyles);

  return (
    <div className="light-surface bg-white rounded-2xl shadow-lg border border-gray-100 p-6 md:p-8">
      <div className="text-center mb-6 md:text-left">
        <h3 className="text-xl md:text-2xl font-bold text-gray-900 mb-1">{title}</h3>
        {subtitle ? <p className="text-gray-600 text-sm md:text-base">{subtitle}</p> : null}
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        <div className="flex-1 min-w-0">
          <div className="flex justify-center items-center rounded-xl border border-gray-200 bg-gray-50/80 p-4 min-h-[320px]">
            {loading ? (
              <div className="flex flex-col items-center gap-3 text-gray-500">
                <RefreshCw className="h-8 w-8 animate-spin text-indigo-500" />
                <span className="text-sm">Generating chart…</span>
              </div>
            ) : chartSrc ? (
              // eslint-disable-next-line @next/next/no-img-element -- matplotlib PNG preview
              <img
                key={chartSrc.slice(-48)}
                src={chartSrc}
                alt={title}
                className="max-w-full h-auto rounded-lg shadow-md"
                style={{ minHeight: '280px', maxHeight: '640px' }}
              />
            ) : (
              <p className="text-sm text-gray-500">No chart available yet.</p>
            )}
          </div>
        </div>

        <aside className="w-full lg:w-72 shrink-0 rounded-xl border border-gray-200 bg-gray-50 p-5 space-y-5">
          <VisualStyleControls
            idPrefix={`chart-${variant}`}
            targetLabel="chart"
            targetOptions={CHART_TARGETS}
            selectedTarget={style.selectedTarget}
            onTargetChange={(target) =>
              onStyleChange({ ...style, selectedTarget: target as ChartTextTarget })
            }
            activeStyle={activeStyle}
            onStyleChange={(patch) => onStyleChange(updateActiveTextStyle(style, patch))}
            extraControls={
              <>
                {style.selectedTarget === 'title' ? (
                  <div>
                    <label
                      htmlFor={`chart-title-text-${variant}`}
                      className="block text-sm font-medium text-gray-700 mb-2"
                    >
                      Title text
                    </label>
                    <input
                      id={`chart-title-text-${variant}`}
                      type="text"
                      value={style.chartTitleText ?? defaultChartTitle ?? ''}
                      onChange={(e) =>
                        onStyleChange({ ...style, chartTitleText: e.target.value })
                      }
                      placeholder={defaultChartTitle ?? 'Chart title'}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    />
                  </div>
                ) : null}
                {variant === 'summary' ? (
                  <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={style.multiColor}
                      onChange={(e) =>
                        onStyleChange({ ...style, multiColor: e.target.checked })
                      }
                      className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    Use distinct colors per theme
                  </label>
                ) : null}
              </>
            }
            graphColorLabel={
              variant === 'summary' && style.multiColor
                ? 'Accent bar color (multi-color mode)'
                : 'Bar / graph color'
            }
            graphColor={style.barColor}
            onGraphColorChange={(barColor) => onStyleChange({ ...style, barColor })}
          />

          <button
            type="button"
            onClick={onApply}
            disabled={busy || !chartSrc}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden />
            Apply changes
          </button>

          <div className="border-t border-gray-200 pt-4 space-y-3">
            <div className="flex items-center gap-2 text-gray-900 font-semibold text-sm">
              <Download className="h-4 w-4 text-indigo-600" aria-hidden />
              Save chart
            </div>
            <div className="grid grid-cols-3 gap-2">
              {EXPORT_FORMATS.map(({ format, label }) => (
                <button
                  key={format}
                  type="button"
                  onClick={() => onExport(format)}
                  disabled={busy || !chartSrc}
                  className="rounded-lg border border-gray-300 bg-white px-2 py-2 text-xs font-semibold text-gray-800 hover:border-indigo-400 hover:bg-indigo-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {exportLoading ? '…' : label}
                </button>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
