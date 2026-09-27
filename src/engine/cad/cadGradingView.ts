/**
 * Phase 20B UI — grading live-viewport display layers (UI-owned, pure).
 *
 * One aggregated layer per CURRENT grading: triangle-fill path + daylight
 * tie-line path, derived from the CURRENT session result (never CAD
 * entities, never persisted). Stale/failed/unbuilt rows emit NO layer —
 * the manager/inquiry already label those states; the viewport never shows
 * superseded geometry as current (volume-layer precedent). Layer OFF/FROZEN
 * hides via the existing viewport filter (layerId pass-through).
 */
import {
  DEFAULT_GRADING_LAYER,
  GRADING_DAYLIGHT_COLOR,
  GRADING_FILL_COLOR,
  GRADING_FILL_OPACITY,
} from './cadGradingExportScene';
import type { GradingAccuracy } from './grading/gradingTypes';

export { DEFAULT_GRADING_LAYER };

export interface CadGradingDisplayLayer {
  gradingId: string;
  gradingName: string;
  layerId: string;
  /** Always 'Current' — only CURRENT rows produce layers. */
  statusText: string;
  /** Aggregated triangle-fill path data in drawing units ('' when none). */
  trianglesD: string;
  /** Daylight tie-line path data in drawing units ('' when none). */
  daylightD: string;
  daylightStroke: string;
  fillStroke: string;
  opacity: number;
  /** True only for CURVE_APPROXIMATED results (canvas badge, never color-only). */
  curveApproximated: boolean;
  badgeAnchor: { x: number; y: number } | null;
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null;
}

/** Structural display-pass input (shell-owned pass shape, engine-safe). */
export interface GradingDisplayLayerEntry {
  gradingId: string;
  gradingName: string;
  layerId?: string;
  /** False (stale/failed/unbuilt) = no layer, never withheld silently. */
  current: boolean;
  accuracy: GradingAccuracy | null;
  daylight: ReadonlyArray<{ x: number; y: number }>;
  triangles: ReadonlyArray<{
    a: { x: number; y: number };
    b: { x: number; y: number };
    c: { x: number; y: number };
  }>;
}

const trianglesPathD = (
  triangles: GradingDisplayLayerEntry['triangles'],
): string => {
  let d = '';
  for (const triangle of triangles) {
    d += `M${triangle.a.x} ${triangle.a.y}L${triangle.b.x} ${triangle.b.y}L${triangle.c.x} ${triangle.c.y}Z`;
  }
  return d;
};

const daylightPathD = (daylight: GradingDisplayLayerEntry['daylight']): string => {
  if (daylight.length === 0) return '';
  const head = daylight[0]!;
  let d = `M${head.x} ${head.y}`;
  for (let index = 1; index < daylight.length; index += 1) {
    d += `L${daylight[index]!.x} ${daylight[index]!.y}`;
  }
  return d;
};

/**
 * Every CURRENT entry with daylight geometry, in input order. Non-current
 * entries (stale/failed/unbuilt) and empty daylight emit no layer.
 */
export const buildGradingDisplayLayers = (
  entries: ReadonlyArray<GradingDisplayLayerEntry>,
): CadGradingDisplayLayer[] => {
  const layers: CadGradingDisplayLayer[] = [];
  for (const entry of entries) {
    if (!entry.current || entry.daylight.length === 0) continue;
    const daylightD = daylightPathD(entry.daylight);
    const trianglesD = trianglesPathD(entry.triangles);
    if (daylightD === '' && trianglesD === '') continue;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const point of entry.daylight) {
      if (point.x < minX) minX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.x > maxX) maxX = point.x;
      if (point.y > maxY) maxY = point.y;
    }
    layers.push({
      gradingId: entry.gradingId,
      gradingName: entry.gradingName,
      layerId: entry.layerId ?? DEFAULT_GRADING_LAYER,
      statusText: 'Current',
      trianglesD,
      daylightD,
      daylightStroke: GRADING_DAYLIGHT_COLOR,
      fillStroke: GRADING_FILL_COLOR,
      opacity: GRADING_FILL_OPACITY,
      curveApproximated: entry.accuracy === 'CURVE_APPROXIMATED',
      badgeAnchor: entry.daylight.length > 0 ? { ...entry.daylight[0]! } : null,
      bounds: minX === Infinity ? null : { minX, minY, maxX, maxY },
    });
  }
  return layers;
};
