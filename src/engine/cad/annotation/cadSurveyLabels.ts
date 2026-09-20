/**
 * Phase 18O — pure survey-label derivation (bearing/distance + curve).
 *
 * These helpers produce annotation *content* and placement only. They own no
 * geometry math: bearing strings come from `formatCadBearing`, inverse legs
 * from `buildCadInverseSummary`, and curve metrics from
 * `cadBuildCurveMetricsSummaryFromRadiusDelta`. Reuse is mandatory — do not
 * add a second bearing or curve formatter here.
 *
 * UNITS: this module works in raw drawing coordinates. Distances are
 * formatted with plain `toFixed(decimalPrecision)` and carry NO unit suffix
 * (no hard-coded " m"/"ft"); the drawing's `units` mode is applied by the
 * caller at the display boundary.
 *
 * READABLE ROTATION: text must never render upside down. Placement reuses the
 * shared `uprightRotation` convention from `cadSurfaceContourView`, the same
 * flip the dimension/traverse/contour labels apply.
 */
import {
  cadMidpoint,
  cadSignedSweepDeg,
  type CadWorldPoint,
} from '../cadGeometry';
import { buildCadInverseSummary, formatCadBearing, formatCadSweepDms } from '../cadCogoSummaries';
import { cadBuildCurveMetricsSummaryFromRadiusDelta } from '../cadCogoCurveMetrics';
import { uprightRotation } from '../cadSurfaceContourView';

export type CadSurveyLabelContent =
  | 'bearing'
  | 'distance'
  | 'bearing-distance'
  | 'distance-bearing';

export type CadSurveyLabelSide = 'left' | 'right';

export interface CadBearingDistanceLabelInput {
  from: CadWorldPoint;
  to: CadWorldPoint;
  content: CadSurveyLabelContent;
  /** Joins the composed content lines (e.g. `'\n'` or `'  '`). */
  separator: string;
  /** Decimal places for the distance, in drawing units. */
  distancePrecision: number;
  /** When set, replaces the composed `text` only; derived values still compute. */
  manualTextOverride?: string;
}

export interface CadBearingDistanceLabel {
  /** Bearing string, identical to `formatCadBearing(azimuth)`. */
  bearing: string;
  /** Distance formatted with `toFixed(distancePrecision)`, in drawing units. */
  distance: string;
  /** Composed content (or `manualTextOverride`). */
  text: string;
  midpoint: CadWorldPoint;
  /** Along-line readable rotation in degrees. */
  rotationDeg: number;
}

export interface CadBearingLabelPlacement {
  x: number;
  y: number;
  rotationDeg: number;
}

export type CadCurveLabelField = 'radius' | 'delta' | 'length' | 'chord';

export interface CadCurveLabelInput {
  /** Accepted so callers pass the arc entity verbatim; text is placement-free. */
  center: CadWorldPoint;
  radius: number;
  startAngleDeg: number;
  endAngleDeg: number;
  /** Emit order of the curve lines. */
  fields: readonly CadCurveLabelField[];
  /** Decimal places for radius/length/chord, in drawing units. */
  decimalPrecision: number;
  /** When set, replaces the composed `text` only; metrics still compute. */
  manualTextOverride?: string;
}

export interface CadCurveLabel {
  radius: number;
  deltaDeg: number;
  arcLength: number;
  chordLength: number;
  /** Composed curve lines joined by `'\n'` (or `manualTextOverride`). */
  text: string;
}

/** `toFixed` accepts 0..100 decimals; anything non-finite falls back to 0. */
const clampPrecision = (precision: number): number =>
  Number.isFinite(precision) ? Math.min(100, Math.max(0, Math.trunc(precision))) : 0;

const formatDrawingUnits = (value: number, precision: number): string =>
  value.toFixed(clampPrecision(precision));

const lineRotationDeg = (from: CadWorldPoint, to: CadWorldPoint): number =>
  uprightRotation((Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI);

/**
 * Midpoint of `from`→`to` offset along the line normal, with the readable
 * along-line rotation. `side` defaults to `'left'` (the contour/traverse
 * normal of the y-up geometry convention).
 */
export const bearingLabelPlacement = (
  from: CadWorldPoint,
  to: CadWorldPoint,
  offset: number,
  side: CadSurveyLabelSide = 'left',
): CadBearingLabelPlacement => {
  const midpoint = cadMidpoint(from, to);
  const rotationDeg = lineRotationDeg(from, to);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length <= 1e-12) return { x: midpoint.x, y: midpoint.y, rotationDeg };
  const normalX = side === 'left' ? -dy / length : dy / length;
  const normalY = side === 'left' ? dx / length : -dx / length;
  return {
    x: midpoint.x + normalX * offset,
    y: midpoint.y + normalY * offset,
    rotationDeg,
  };
};

const composeBearingDistanceLines = (
  content: CadSurveyLabelContent,
  bearing: string,
  distance: string,
): string[] => {
  switch (content) {
    case 'bearing':
      return [bearing];
    case 'distance':
      return [distance];
    case 'bearing-distance':
      return [bearing, distance];
    case 'distance-bearing':
      return [distance, bearing];
  }
};

/**
 * Derive a bearing/distance survey label. Bearing text is string-identical to
 * `formatCadBearing`; distance is `buildCadInverseSummary().distance` in
 * drawing units. `manualTextOverride` replaces only the composed `text`.
 */
export const deriveBearingDistanceLabel = (
  input: CadBearingDistanceLabelInput,
): CadBearingDistanceLabel => {
  const { from, to, content, separator, distancePrecision, manualTextOverride } = input;
  const inverse = buildCadInverseSummary(from, to);
  const bearing = formatCadBearing(inverse.azimuthDeg);
  const distance = formatDrawingUnits(inverse.distance, distancePrecision);
  const lines = composeBearingDistanceLines(content, bearing, distance);
  return {
    bearing,
    distance,
    text: manualTextOverride === undefined ? lines.join(separator) : manualTextOverride,
    midpoint: cadMidpoint(from, to),
    rotationDeg: lineRotationDeg(from, to),
  };
};

const formatCurveField = (
  field: CadCurveLabelField,
  metrics: { radius: number; deltaDeg: number; arcLength: number; chordLength: number },
  precision: number,
): string => {
  switch (field) {
    case 'radius':
      return `R ${formatDrawingUnits(metrics.radius, precision)}`;
    case 'delta':
      return `\u0394 ${formatCadSweepDms(metrics.deltaDeg)}`;
    case 'length':
      return `L ${formatDrawingUnits(metrics.arcLength, precision)}`;
    case 'chord':
      return `C ${formatDrawingUnits(metrics.chordLength, precision)}`;
  }
};

/**
 * Derive curve annotation content from center/radius/start/end angles. The
 * delta is the arc's forward sweep magnitude (signed, so CW and CCW arcs
 * both report their true delta) and metrics come exclusively from
 * `cadBuildCurveMetricsSummaryFromRadiusDelta`; returns `null` when that
 * helper rejects the inputs (non-positive radius, delta outside (0, 180)).
 */
export const deriveCurveLabel = (input: CadCurveLabelInput): CadCurveLabel | null => {
  const { radius, startAngleDeg, endAngleDeg, fields, decimalPrecision, manualTextOverride } = input;
  const metrics = cadBuildCurveMetricsSummaryFromRadiusDelta(
    radius,
    Math.abs(cadSignedSweepDeg(startAngleDeg, endAngleDeg)),
  );
  if (metrics === null) return null;
  const lines = fields.map((field) => formatCurveField(field, metrics, decimalPrecision));
  return {
    radius: metrics.radius,
    deltaDeg: metrics.deltaDeg,
    arcLength: metrics.arcLength,
    chordLength: metrics.chordLength,
    text: manualTextOverride === undefined ? lines.join('\n') : manualTextOverride,
  };
};
