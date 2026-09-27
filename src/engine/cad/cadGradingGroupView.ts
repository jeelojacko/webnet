/**
 * Phase 20C Wave-4A — grading-group live-viewport display layers (UI-owned, pure).
 *
 * One aggregated layer per CURRENT group: triangle-fill path + daylight
 * boundary path + miter/corner seam path (screen-only diagnostic, never
 * persisted, excluded from plot/export by construction — export serializers
 * are untouched by this wave). A selected but uncalculated group contributes
 * a ghost layer (grading-side arrows along representative courses); a FAILED
 * group contributes a diagnostic-only layer (offending corner/course markers,
 * no fill). Stale/unbuilt rows emit NO layer — superseded geometry never
 * renders as current. Layer OFF/FROZEN hides via the viewport filter.
 */
import {
  DEFAULT_GRADING_LAYER,
  GRADING_DAYLIGHT_COLOR,
  GRADING_FILL_COLOR,
  GRADING_FILL_OPACITY,
} from './cadGradingExportScene';
import type { GradingAccuracy } from './grading/gradingTypes';

export { DEFAULT_GRADING_LAYER };

export type CadGradingGroupLayerKind = 'result' | 'ghost' | 'failed';

export interface CadGradingGroupDisplayLayer {
  groupId: string;
  groupName: string;
  layerId: string;
  kind: CadGradingGroupLayerKind;
  /** Always 'Current' for result layers; ghost/failed carry their own label. */
  statusText: string;
  /** Aggregated triangle-fill path data in drawing units ('' when none). */
  trianglesD: string;
  /** Daylight boundary path data in drawing units ('' when none). */
  daylightD: string;
  /** Miter/corner seam path data — screen-only, never plotted. */
  seamD: string;
  daylightStroke: string;
  fillStroke: string;
  opacity: number;
  /** Ghost side arrows (screen-only pre/post-calc preview), drawing units. */
  ghostArrows: Array<{ from: { x: number; y: number }; to: { x: number; y: number } }>;
  /** Failed corner/course markers (FAILED layers only), drawing units. */
  failedMarkers: Array<{ x: number; y: number; label: string }>;
  /** True for EXACT-vs-chord results incl. CURVE_CORNER_APPROXIMATED. */
  curveApproximated: boolean;
  badgeAnchor: { x: number; y: number } | null;
  badgeText: string | null;
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null;
}

/** Structural display-pass input (shell-owned pass shape, engine-safe). */
export interface GroupDisplayLayerEntry {
  groupId: string;
  groupName: string;
  layerId?: string;
  kind: CadGradingGroupLayerKind;
  accuracy: GradingAccuracy | null;
  curveCornerApproximated: boolean;
  daylight: ReadonlyArray<{ x: number; y: number }>;
  triangles: ReadonlyArray<{
    a: { x: number; y: number };
    b: { x: number; y: number };
    c: { x: number; y: number };
  }>;
  seam: ReadonlyArray<{ x: number; y: number }>;
  ghostArrows: ReadonlyArray<{ from: { x: number; y: number }; to: { x: number; y: number } }>;
  failedMarkers: ReadonlyArray<{ x: number; y: number; label: string }>;
}

const trianglesPathD = (
  triangles: GroupDisplayLayerEntry['triangles'],
): string => {
  let d = '';
  for (const triangle of triangles) {
    d += `M${triangle.a.x} ${triangle.a.y}L${triangle.b.x} ${triangle.b.y}L${triangle.c.x} ${triangle.c.y}Z`;
  }
  return d;
};

const polylinePathD = (points: ReadonlyArray<{ x: number; y: number }>): string => {
  if (points.length === 0) return '';
  const head = points[0]!;
  let d = `M${head.x} ${head.y}`;
  for (let index = 1; index < points.length; index += 1) {
    d += `L${points[index]!.x} ${points[index]!.y}`;
  }
  return d;
};

/**
 * CURRENT entries with daylight geometry, plus ghost entries (selected,
 * uncalculated) and failed entries (diagnostic markers). Non-current
 * unselected entries emit no layer. Input order is preserved.
 */
export const buildGradingGroupDisplayLayers = (
  entries: ReadonlyArray<GroupDisplayLayerEntry>,
): CadGradingGroupDisplayLayer[] => {
  const layers: CadGradingGroupDisplayLayer[] = [];
  for (const entry of entries) {
    if (entry.kind === 'result' && entry.daylight.length === 0) continue;
    if (entry.kind === 'ghost' && entry.ghostArrows.length === 0) continue;
    if (entry.kind === 'failed' && entry.failedMarkers.length === 0) continue;
    const daylightD = entry.kind === 'result' ? polylinePathD(entry.daylight) : '';
    const trianglesD = entry.kind === 'result' ? trianglesPathD(entry.triangles) : '';
    const seamD = entry.kind === 'result' ? polylinePathD(entry.seam) : '';
    if (entry.kind === 'result' && daylightD === '' && trianglesD === '') continue;
    const anchorSource =
      entry.kind === 'result' ? entry.daylight : entry.failedMarkers;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const point of anchorSource) {
      if (point.x < minX) minX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.x > maxX) maxX = point.x;
      if (point.y > maxY) maxY = point.y;
    }
    const curveApproximated =
      entry.accuracy === 'CURVE_APPROXIMATED' || entry.curveCornerApproximated;
    layers.push({
      groupId: entry.groupId,
      groupName: entry.groupName,
      layerId: entry.layerId ?? DEFAULT_GRADING_LAYER,
      kind: entry.kind,
      statusText: entry.kind === 'result' ? 'Current' : entry.kind === 'ghost' ? 'Preview' : 'Failed',
      trianglesD,
      daylightD,
      seamD,
      daylightStroke: GRADING_DAYLIGHT_COLOR,
      fillStroke: GRADING_FILL_COLOR,
      opacity: GRADING_FILL_OPACITY,
      ghostArrows: entry.kind === 'ghost' ? [...entry.ghostArrows] : [],
      failedMarkers: entry.kind === 'failed' ? [...entry.failedMarkers] : [],
      curveApproximated,
      badgeAnchor: anchorSource.length > 0 ? { ...anchorSource[0]! } : null,
      badgeText:
        entry.kind === 'failed'
          ? 'GROUP FAILED — see manager'
          : curveApproximated
            ? 'CURVE CORNER APPROXIMATED'
            : null,
      bounds: minX === Infinity ? null : { minX, minY, maxX, maxY },
    });
  }
  return layers;
};
