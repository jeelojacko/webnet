import { buildCadCurveMetricsSummary, type CadCurveMetricsSummary } from './cadCogoCurveMetrics';
import { cadCreateCurveMetrics } from './cadGeometryCurveCore';
import { CAD_XY_DEGENERATE_FLOOR } from './cadGeometryShapeBuilders';

/**
 * Phase F1 — one authoritative curve-metric seam.
 *
 * The forward laws already live in `cadGeometryCurveCore` / `cadCogoCurveMetrics`
 * (`cadCreateCurveMetrics`, `cadBuildCurveMetricsFrom*`, `cadSolveCurveMetrics`).
 * This module adds the inverse directions the Civil curve tools need (known
 * `Δ → R` and known `R → Δ`) without introducing a second geometry law:
 * every result is finalized through `cadCreateCurveMetrics` and decorated by
 * the shared `buildCadCurveMetricsSummary`.
 *
 * Units are meters and degrees at this boundary. No coercion is performed:
 * invalid input returns `null`.
 */

export type CadCurveMetricMode =
  | 'radius'
  | 'tangent'
  | 'chord'
  | 'arc'
  | 'external'
  | 'midOrdinate'
  | 'degreeArc'
  | 'degreeChord';

export interface CadCurveMetricFromDeltaInput {
  deltaDeg: number;
  mode: CadCurveMetricMode;
  value: number;
}

export interface CadCurveMetricFromRadiusInput {
  radius: number;
  mode: CadCurveMetricMode;
  value: number;
}

/** 100-model-unit base for the two degree-of-curve definitions. */
export const CAD_CURVE_DEGREE_BASE_LENGTH = 100;
export const CAD_CURVE_DELTA_FLOOR_DEG = 1e-9;
export const CAD_CURVE_DELTA_CAP_DEG = 180 - 1e-9;
export const CAD_CURVE_RADIUS_FLOOR = CAD_XY_DEGENERATE_FLOOR;

const isPositiveFinite = (value: number): boolean => Number.isFinite(value) && value > 0;

export const isValidCadCurveDeltaDeg = (deltaDeg: number): boolean =>
  Number.isFinite(deltaDeg) &&
  deltaDeg > CAD_CURVE_DELTA_FLOOR_DEG &&
  deltaDeg < CAD_CURVE_DELTA_CAP_DEG;

export const isValidCadCurveRadius = (radius: number): boolean =>
  Number.isFinite(radius) && radius > CAD_CURVE_RADIUS_FLOOR;

const finalize = (radius: number, deltaDeg: number): CadCurveMetricsSummary | null => {
  const metrics = cadCreateCurveMetrics(radius, deltaDeg);
  return buildCadCurveMetricsSummary(metrics);
};

/**
 * Known `Δ`, derive `R` from one mode. `degreeArc` / `degreeChord` define `R`
 * from a 100-model-unit arc/chord and ignore `Δ` except for the shared validity
 * gate (the arc still spans the requested `Δ`).
 */
export const solveCadCurveMetricsFromDelta = ({
  deltaDeg,
  mode,
  value,
}: CadCurveMetricFromDeltaInput): CadCurveMetricsSummary | null => {
  if (!isValidCadCurveDeltaDeg(deltaDeg) || !isPositiveFinite(value)) return null;
  const deltaRad = (deltaDeg * Math.PI) / 180;
  const half = deltaRad / 2;
  let radius: number;
  switch (mode) {
    case 'radius':
      radius = value;
      break;
    case 'tangent':
      radius = value / Math.tan(half);
      break;
    case 'chord':
      radius = value / (2 * Math.sin(half));
      break;
    case 'arc':
      radius = value / deltaRad;
      break;
    case 'external':
      radius = value / (1 / Math.cos(half) - 1);
      break;
    case 'midOrdinate':
      radius = value / (1 - Math.cos(half));
      break;
    case 'degreeArc':
      radius = (CAD_CURVE_DEGREE_BASE_LENGTH * 180) / (Math.PI * value);
      break;
    case 'degreeChord': {
      const sinHalfDegree = Math.sin((value * Math.PI) / 360);
      if (sinHalfDegree <= CAD_XY_DEGENERATE_FLOOR) return null;
      radius = CAD_CURVE_DEGREE_BASE_LENGTH / 2 / sinHalfDegree;
      break;
    }
  }
  return finalize(radius, deltaDeg);
};

/** Known `R`, derive `Δ` from one mode. */
export const solveCadCurveMetricsFromRadius = ({
  radius,
  mode,
  value,
}: CadCurveMetricFromRadiusInput): CadCurveMetricsSummary | null => {
  if (!isValidCadCurveRadius(radius) || !isPositiveFinite(value)) return null;
  let deltaDeg: number;
  switch (mode) {
    case 'radius':
      return null;
    case 'tangent':
      deltaDeg = (2 * Math.atan(value / radius) * 180) / Math.PI;
      break;
    case 'chord':
      if (value >= 2 * radius - CAD_XY_DEGENERATE_FLOOR) return null;
      deltaDeg = (2 * Math.asin(value / (2 * radius)) * 180) / Math.PI;
      break;
    case 'arc':
      deltaDeg = (value / radius) * (180 / Math.PI);
      break;
    case 'external':
      deltaDeg = (2 * Math.acos(radius / (radius + value)) * 180) / Math.PI;
      break;
    case 'midOrdinate':
      if (value >= radius - CAD_XY_DEGENERATE_FLOOR) return null;
      deltaDeg = (2 * Math.acos(1 - value / radius) * 180) / Math.PI;
      break;
    case 'degreeArc':
      deltaDeg = ((CAD_CURVE_DEGREE_BASE_LENGTH / radius) * 180) / Math.PI;
      break;
    case 'degreeChord':
      if (CAD_CURVE_DEGREE_BASE_LENGTH / 2 / radius > 1) return null;
      deltaDeg =
        (2 * Math.asin(CAD_CURVE_DEGREE_BASE_LENGTH / 2 / radius) * 180) / Math.PI;
      break;
  }
  if (!isValidCadCurveDeltaDeg(deltaDeg)) return null;
  return finalize(radius, deltaDeg);
};

/** Radius-and-delta helper kept alongside the inverse solvers. */
export const buildCadCurveMetricsSummaryFromRadiusDeltaDeg = (
  radius: number,
  deltaDeg: number,
): CadCurveMetricsSummary | null => finalize(radius, deltaDeg);
