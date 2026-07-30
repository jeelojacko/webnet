/** @vitest-environment jsdom */
/* eslint-disable react-refresh/only-export-components */

import { LSAEngine } from '../../src/engine/adjust';
import type { AdjustmentResult } from '../../src/types';

export { default as React, act } from 'react';
export { createRoot } from 'react-dom/client';
export type { Root } from 'react-dom/client';
export { default as MapView } from '../../src/components/MapView';
export { DEFAULT_PLANNING_MAP_STATE } from '../../src/engine/planningMapState';
export type { PlanningMapState } from '../../src/types';

export const input = [
  '.2D',
  'C A 0 0 0 ! !',
  'C B 100 0 0 ! !',
  'C C 60 40 0',
  'D A-C 72.1110255 0.005',
  'D B-C 56.5685425 0.005',
  'A C-A-B 90-00-00 3',
].join('\n');

export const result = new LSAEngine({ input, maxIterations: 8 }).solve();
if (!result.parseState) {
  throw new Error('Expected solve result parse state for map interaction tests');
}
export const georeferencedResult = {
  ...result,
  parseState: {
    ...result.parseState,
    coordSystemMode: result.parseState.coordSystemMode,
    originLatDeg: 45,
    originLonDeg: -63,
    crsProjectionModel: 'legacy-equirectangular' as const,
    inputStationSnapshots: Object.entries(result.stations).map(([stationId, station]) => ({
      stationId,
      x: station.x,
      y: station.y,
      h: station.h,
      coordInputClass: station.coordInputClass ?? 'unknown',
      constraintModeX: station.constraintModeX,
      constraintModeY: station.constraintModeY,
      constraintModeH: station.constraintModeH,
    })),
  },
} as AdjustmentResult;
export type RafCallback = (_timestamp: number) => void;

export const setSvgRect = (svg: SVGSVGElement) => {
  Object.defineProperty(svg, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      left: 0,
      top: 0,
      width: 1000,
      height: 700,
      right: 1000,
      bottom: 700,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  });
};

export const setMutableSvgRect = (
  svg: SVGSVGElement,
  rectState: { left: number; top: number; width: number; height: number },
) => {
  Object.defineProperty(svg, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      left: rectState.left,
      top: rectState.top,
      width: rectState.width,
      height: rectState.height,
      right: rectState.left + rectState.width,
      bottom: rectState.top + rectState.height,
      x: rectState.left,
      y: rectState.top,
      toJSON: () => ({}),
    }),
  });
};

export const projectMapPoint2d = (
  stations: Record<string, { x: number; y: number }>,
  point: { x: number; y: number },
) => {
  const rows = Object.values(stations);
  const xs = rows.map((station) => station.x);
  const ys = rows.map((station) => station.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const pad = Math.max((maxX - minX) * 0.1, (maxY - minY) * 0.1, 1);
  const width = maxX - minX + pad * 2;
  const height = maxY - minY + pad * 2;
  const scale = Math.min(1000 / width, 700 / height);
  const offsetX = (1000 - width * scale) * 0.5;
  const offsetY = (700 - height * scale) * 0.5;
  return {
    x: offsetX + (point.x - (minX - pad)) * scale,
    y: 700 - (offsetY + (point.y - (minY - pad)) * scale),
  };
};

export const setTextInputValue = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setter) throw new Error('Missing HTMLInputElement value setter');
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

export const setSelectValue = (select: HTMLSelectElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  if (!setter) throw new Error('Missing HTMLSelectElement value setter');
  setter.call(select, value);
  select.dispatchEvent(new Event('change', { bubbles: true }));
};

