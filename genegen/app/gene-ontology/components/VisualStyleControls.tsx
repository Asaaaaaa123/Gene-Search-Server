'use client';

import { Palette, Type } from 'lucide-react';
import {
  CHART_FONT_FAMILY_OPTIONS,
  normalizeHexColor,
  type TextElementStyle,
} from '@/lib/chart-style';

type FontOption = { value: string; label: string };

type VisualStyleControlsProps = {
  idPrefix: string;
  targetLabel: string;
  targetOptions: { value: string; label: string }[];
  selectedTarget: string;
  onTargetChange: (target: string) => void;
  activeStyle: TextElementStyle;
  onStyleChange: (patch: Partial<TextElementStyle>) => void;
  fontFamilyOptions?: readonly FontOption[];
  graphColorLabel?: string;
  graphColor?: string;
  onGraphColorChange?: (color: string) => void;
  secondaryGraphColorLabel?: string;
  secondaryGraphColor?: string;
  onSecondaryGraphColorChange?: (color: string) => void;
  extraControls?: React.ReactNode;
};

export function VisualStyleControls({
  idPrefix,
  targetLabel,
  targetOptions,
  selectedTarget,
  onTargetChange,
  activeStyle,
  onStyleChange,
  graphColorLabel,
  graphColor,
  onGraphColorChange,
  secondaryGraphColorLabel,
  secondaryGraphColor,
  onSecondaryGraphColorChange,
  extraControls,
  fontFamilyOptions = CHART_FONT_FAMILY_OPTIONS,
}: VisualStyleControlsProps) {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-gray-900 font-semibold">
        <Palette className="h-4 w-4 text-indigo-600" aria-hidden />
        Appearance
      </div>

      <div>
        <label
          htmlFor={`${idPrefix}-target`}
          className="block text-sm font-medium text-gray-700 mb-2"
        >
          Select text to edit
        </label>
        <select
          id={`${idPrefix}-target`}
          value={selectedTarget}
          onChange={(e) => onTargetChange(e.target.value)}
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
        >
          {targetOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-gray-500">
          Choose a part of the {targetLabel}, then set its font and color below.
        </p>
      </div>

      <div>
        <label
          htmlFor={`${idPrefix}-font-family`}
          className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-2"
        >
          <Type className="h-3.5 w-3.5" aria-hidden />
          Font character
        </label>
        <select
          id={`${idPrefix}-font-family`}
          value={activeStyle.fontFamily}
          onChange={(e) => onStyleChange({ fontFamily: e.target.value })}
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
          style={{ fontFamily: activeStyle.fontFamily }}
        >
          {fontFamilyOptions.map((font) => (
            <option key={font.value} value={font.value} style={{ fontFamily: font.value }}>
              {font.label}
            </option>
          ))}
        </select>
        <p
          className="mt-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm"
          style={{
            fontFamily: activeStyle.fontFamily,
            fontSize: activeStyle.fontSize,
            color: normalizeHexColor(activeStyle.fontColor),
          }}
        >
          Preview — Aa Bb 123
        </p>
      </div>

      <div>
        <label
          htmlFor={`${idPrefix}-font-size`}
          className="block text-sm font-medium text-gray-700 mb-2"
        >
          Font size
        </label>
        <div className="flex items-center gap-3">
          <input
            id={`${idPrefix}-font-size`}
            type="range"
            min={8}
            max={24}
            value={activeStyle.fontSize}
            onChange={(e) => onStyleChange({ fontSize: Number(e.target.value) })}
            className="flex-1 accent-indigo-600"
          />
          <span className="w-8 text-sm font-medium text-gray-900 tabular-nums">
            {activeStyle.fontSize}
          </span>
        </div>
      </div>

      <div>
        <label
          htmlFor={`${idPrefix}-font-color`}
          className="block text-sm font-medium text-gray-700 mb-2"
        >
          Font color
        </label>
        <div className="flex items-center gap-3">
          <input
            id={`${idPrefix}-font-color`}
            type="color"
            value={activeStyle.fontColor}
            onChange={(e) => onStyleChange({ fontColor: e.target.value })}
            className="h-10 w-14 cursor-pointer rounded border border-gray-300 bg-white p-1"
          />
          <input
            type="text"
            value={activeStyle.fontColor}
            onChange={(e) => onStyleChange({ fontColor: e.target.value })}
            onBlur={(e) =>
              onStyleChange({ fontColor: normalizeHexColor(e.target.value, activeStyle.fontColor) })
            }
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono"
            maxLength={7}
          />
        </div>
      </div>

      {graphColorLabel && graphColor && onGraphColorChange ? (
        <div>
          <label
            htmlFor={`${idPrefix}-graph-color`}
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            {graphColorLabel}
          </label>
          <div className="flex items-center gap-3">
            <input
              id={`${idPrefix}-graph-color`}
              type="color"
              value={graphColor}
              onChange={(e) => onGraphColorChange(e.target.value)}
              className="h-10 w-14 cursor-pointer rounded border border-gray-300 bg-white p-1"
            />
            <input
              type="text"
              value={graphColor}
              onChange={(e) => onGraphColorChange(e.target.value)}
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono"
              maxLength={7}
            />
          </div>
        </div>
      ) : null}

      {secondaryGraphColorLabel &&
      secondaryGraphColor &&
      onSecondaryGraphColorChange ? (
        <div>
          <label
            htmlFor={`${idPrefix}-graph-color-2`}
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            {secondaryGraphColorLabel}
          </label>
          <div className="flex items-center gap-3">
            <input
              id={`${idPrefix}-graph-color-2`}
              type="color"
              value={secondaryGraphColor}
              onChange={(e) => onSecondaryGraphColorChange(e.target.value)}
              className="h-10 w-14 cursor-pointer rounded border border-gray-300 bg-white p-1"
            />
            <input
              type="text"
              value={secondaryGraphColor}
              onChange={(e) => onSecondaryGraphColorChange(e.target.value)}
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono"
              maxLength={7}
            />
          </div>
        </div>
      ) : null}

      {extraControls}
    </div>
  );
}
