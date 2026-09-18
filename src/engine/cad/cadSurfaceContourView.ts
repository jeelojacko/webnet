import type { CadSurfaceContourPath, CadSurfaceContourSet, ContourKind } from './surfaceContours/contourTypes';
import type { CadSurfaceContourLabel } from './cadDisplayTypes';
import type { CadSurfaceStyle } from './cadTypes';
import { SURFACE_CONTOUR_STYLE_DEFAULTS } from './cadSurfaceStyles';

/**
 * Phase 18H — contour display derivation (UI-owned, pure).
 *
 * Legacy compat (§10): styles without contour fields show NO contours
 * (display-time default; the stored style is never mutated). Safe defaults
 * backfill only when `showContours` is explicitly true.
 */

export interface ResolvedContourDisplay {
  minorInterval: number;
  majorEvery: number;
  baseElevation: number;
  minorStroke: string;
  minorWidth: number;
  minorOpacity: number;
  majorStroke: string;
  majorWidth: number;
  majorOpacity: number;
  showLabels: boolean;
  labelMajorOnly: boolean;
  labelSpacing: number;
  labelPrecision: number;
  fallbackStroke: string;
}

/** Null = no contour display (legacy sparse style or toggled off). */
export const resolveContourDisplay = (
  style: CadSurfaceStyle | undefined,
  fallbackStroke: string,
): ResolvedContourDisplay | null => {
  if (!style || style.showContours !== true) return null;
  // Explicit opt-in backfills safe defaults; truly legacy styles
  // (showContours absent/false) stay dark without stored mutation.
  const minorInterval = style.minorContourInterval ?? SURFACE_CONTOUR_STYLE_DEFAULTS.minorContourInterval;
  const majorEvery = style.majorContourEvery ?? SURFACE_CONTOUR_STYLE_DEFAULTS.majorContourEvery;
  if (!(minorInterval > 0) || !Number.isInteger(majorEvery) || majorEvery < 1) return null;
  return {
    minorInterval,
    majorEvery,
    baseElevation: style.contourBaseElevation ?? SURFACE_CONTOUR_STYLE_DEFAULTS.contourBaseElevation,
    minorStroke: style.minorContour?.color ?? fallbackStroke,
    minorWidth: style.minorContour?.lineweight ?? 1,
    minorOpacity: style.minorContour?.opacity != null ? 1 - style.minorContour.opacity : 0.85,
    majorStroke: style.majorContour?.color ?? fallbackStroke,
    majorWidth: style.majorContour?.lineweight ?? 2.2,
    majorOpacity: style.majorContour?.opacity != null ? 1 - style.majorContour.opacity : 0.95,
    showLabels: style.showContourLabels ?? SURFACE_CONTOUR_STYLE_DEFAULTS.showContourLabels,
    labelMajorOnly: style.labelMajorOnly ?? SURFACE_CONTOUR_STYLE_DEFAULTS.labelMajorOnly,
    labelSpacing: style.contourLabelSpacing ?? SURFACE_CONTOUR_STYLE_DEFAULTS.contourLabelSpacing,
    labelPrecision: style.contourLabelPrecision ?? SURFACE_CONTOUR_STYLE_DEFAULTS.contourLabelPrecision,
    fallbackStroke,
  };
};

/** Geometry sub-spec for the derivation cache key (appearance excluded). */
export const contourLevelSpecFromStyle = (
  style: CadSurfaceStyle,
): { minorInterval: number; majorEvery: number; baseElevation: number } | null => {
  if (style.showContours !== true) return null;
  const minorInterval = style.minorContourInterval ?? SURFACE_CONTOUR_STYLE_DEFAULTS.minorContourInterval;
  const majorEvery = style.majorContourEvery ?? SURFACE_CONTOUR_STYLE_DEFAULTS.majorContourEvery;
  const baseElevation = style.contourBaseElevation ?? SURFACE_CONTOUR_STYLE_DEFAULTS.contourBaseElevation;
  if (!(minorInterval > 0) || !Number.isInteger(majorEvery) || majorEvery < 1) return null;
  return { minorInterval, majorEvery, baseElevation };
};

/**
 * AGGREGATED: one path string per contour kind (never per-segment nodes).
 * Closed loops terminate with Z; open paths are M…L… runs concatenated.
 */
export const contourPathsToPathD = (paths: readonly CadSurfaceContourPath[]): string => {
  let d = '';
  for (const path of paths) {
    const pts = path.points;
    if (pts.length === 0) continue;
    d += `M${pts[0]!.x} ${pts[0]!.y}`;
    for (let i = 1; i < pts.length; i += 1) d += `L${pts[i]!.x} ${pts[i]!.y}`;
    if (path.closed && pts.length > 2) d += 'Z';
  }
  return d;
};

interface ArcTable {
  total: number;
  cum: number[];
}

const buildArcTable = (pts: ReadonlyArray<{ x: number; y: number }>, closed: boolean): ArcTable => {
  const cum: number[] = [0];
  const n = pts.length;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i += 1) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    cum.push(cum[i]! + Math.hypot(b.x - a.x, b.y - a.y));
  }
  return { total: cum[cum.length - 1]!, cum };
};

const pointAt = (
  pts: ReadonlyArray<{ x: number; y: number }>,
  table: ArcTable,
  closed: boolean,
  dist: number,
): { x: number; y: number; angleDeg: number } => {
  const n = pts.length;
  const segs = closed ? n : n - 1;
  let lo = 0;
  while (lo < segs - 1 && table.cum[lo + 1]! < dist) lo += 1;
  const a = pts[lo]!;
  const b = pts[(lo + 1) % n]!;
  const segLen = table.cum[lo + 1]! - table.cum[lo]!;
  const t = segLen > 0 ? (dist - table.cum[lo]!) / segLen : 0;
  const angleDeg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y), angleDeg };
};

/** Keep text upright: fold (90, 270] back by 180°. */
export const uprightRotation = (angleDeg: number): number => {
  let angle = ((angleDeg % 360) + 360) % 360;
  if (angle > 90 && angle <= 270) angle -= 180;
  return angle > 180 ? angle - 360 : angle;
};

export interface LabelDeriveOptions {
  spacing: number;
  precision: number;
  majorOnly: boolean;
}

/**
 * Deterministic arc-length labels. Open paths: first label at spacing/2,
 * then every spacing, each kept ≥ spacing/4 clear of the far endpoint.
 * Closed loops: floor(len/spacing) labels anchored at path start (stable
 * phase — never viewport-dependent). Same-path separation ≥ spacing holds
 * by construction (loop wrap gap ≥ spacing since n = floor(len/spacing)).
 *
 * No collision engine: labels on different paths may overlap — accepted
 * restriction (documented; manual label groups and annotation scale are
 * explicitly out of scope).
 */
export const deriveContourLabels = (
  set: CadSurfaceContourSet,
  options: LabelDeriveOptions,
): CadSurfaceContourLabel[] => {
  const { spacing, precision, majorOnly } = options;
  if (!(spacing > 0)) return [];
  const labels: CadSurfaceContourLabel[] = [];
  const kinds: ContourKind[] = majorOnly ? ['major'] : ['major', 'minor'];
  for (const kind of kinds) {
    const paths = kind === 'major' ? set.majorPaths : set.minorPaths;
    for (const path of paths) {
      const pts = path.points;
      if (pts.length < 2) continue;
      const table = buildArcTable(pts, path.closed);
      if (!(table.total > 0)) continue;
      const dists: number[] = [];
      if (path.closed) {
        const count = Math.max(1, Math.floor(table.total / spacing));
        if (table.total < spacing / 2 && count <= 1) {
          dists.push(0);
        } else {
          for (let i = 0; i < count; i += 1) dists.push(i * spacing);
        }
      } else {
        for (let d = spacing / 2; d <= table.total - spacing / 4; d += spacing) {
          dists.push(d);
        }
        if (dists.length === 0 && table.total >= spacing / 2) dists.push(table.total / 2);
      }
      for (const d of dists) {
        const at = pointAt(pts, table, path.closed, Math.min(d, table.total - 1e-9));
        labels.push({
          elevation: path.elevation,
          x: at.x,
          y: at.y,
          rotationDeg: uprightRotation(at.angleDeg),
          kind,
          text: path.elevation.toFixed(precision),
        });
      }
    }
  }
  return labels;
};

/** Display-only visible-label cap (geometry stays complete). */
export const SURFACE_CONTOUR_LABEL_CAP = 200;

export interface ContourLabelViewport {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * VIEWPORT culling + cap. Display only: culled labels are dropped from the
 * layer, never from the cached set. Returns the visible labels and whether
 * the cap truncated them.
 */
export const cullContourLabels = (
  labels: readonly CadSurfaceContourLabel[],
  viewport: ContourLabelViewport | null,
  cap = SURFACE_CONTOUR_LABEL_CAP,
): { visible: CadSurfaceContourLabel[]; truncated: boolean } => {
  const inView = viewport
    ? labels.filter(
        (label) =>
          label.x >= viewport.minX && label.x <= viewport.maxX &&
          label.y >= viewport.minY && label.y <= viewport.maxY,
      )
    : [...labels];
  if (inView.length <= cap) return { visible: inView, truncated: false };
  return { visible: inView.slice(0, cap), truncated: true };
};
