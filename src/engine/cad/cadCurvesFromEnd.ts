import {
  cadAzimuthDeg,
  cadBuildArcFromStartEndDirection,
  cadBuildArcFromStartTangentRadiusDelta,
  cadDistance,
  cadNormalizeAngleDeg,
  cadSignedSweepDeg,
  type CadArcDefinition,
  type CadWorldPoint,
} from './cadGeometry';
import { cadArcEndTangentAzimuthDeg } from './cadGeometryArcPrimitives';
import { CAD_XY_DEGENERATE_FLOOR } from './cadGeometryShapeBuilders';
import {
  buildCadCurveMetricsSummaryFromRadiusDeltaDeg,
  solveCadCurveMetricsFromRadius,
  type CadCurveMetricMode,
} from './cadCurveMetricsSolver';
import type { CadCurveMetricsSummary } from './cadCogoCurveMetrics';

/**
 * Phase F1 — contract 5: From End.
 *
 * A line pick selects the nearest endpoint and the outward direction from it.
 * An arc end-side pick continues forward; a start-side pick continues from the
 * arc start with reversed orientation. Point mode builds the circle through
 * start/end tangent to the outgoing direction (collinear input rejected).
 * Radius mode takes a signed radius (positive = right/clockwise, negative =
 * left) plus one extent metric; the persisted arc radius is always positive.
 */

export type CadCurveContinuationSource =
  | { kind: 'line'; start: CadWorldPoint; end: CadWorldPoint }
  | { kind: 'arc'; center: CadWorldPoint; radius: number; startAngleDeg: number; endAngleDeg: number };

export interface CadCurveFromEndBase {
  point: CadWorldPoint;
  outgoingAzimuthDeg: number;
  reversed: boolean;
}

export interface CadCurveContinuationResult {
  arc: CadArcDefinition;
  start: CadWorldPoint;
  end: CadWorldPoint;
  metrics: CadCurveMetricsSummary | null;
}

export interface CadCurveFromEndRadiusRequest {
  /** Signed radius: positive = right/clockwise, negative = left. */
  signedRadius: number;
  mode: CadCurveMetricMode;
  value: number;
}

const isFinitePoint = (point: CadWorldPoint): boolean =>
  Number.isFinite(point.x) && Number.isFinite(point.y);

/** Forward tangent azimuth at the arc start for the oriented sweep. */
const arcStartTangentAzimuthDeg = (startAngleDeg: number, endAngleDeg: number): number => {
  const sweep = cadSignedSweepDeg(startAngleDeg, endAngleDeg);
  if (sweep >= 0) return cadNormalizeAngleDeg(-startAngleDeg);
  return cadNormalizeAngleDeg(180 - startAngleDeg);
};

const arcPointAt = (
  center: CadWorldPoint,
  radius: number,
  angleDeg: number,
): CadWorldPoint => ({
  x: center.x + Math.cos((angleDeg * Math.PI) / 180) * radius,
  y: center.y + Math.sin((angleDeg * Math.PI) / 180) * radius,
});

export const resolveCadCurveFromEndBase = (
  source: CadCurveContinuationSource,
  pick: CadWorldPoint,
): CadCurveFromEndBase | null => {
  if (!isFinitePoint(pick)) return null;
  if (source.kind === 'line') {
    if (!isFinitePoint(source.start) || !isFinitePoint(source.end)) return null;
    if (cadDistance(source.start, source.end) <= CAD_XY_DEGENERATE_FLOOR) return null;
    const startDistance = cadDistance(pick, source.start);
    const endDistance = cadDistance(pick, source.end);
    const atStart = startDistance < endDistance;
    const point = atStart ? { ...source.start } : { ...source.end };
    const other = atStart ? source.end : source.start;
    const outward = { x: point.x - other.x, y: point.y - other.y };
    const length = Math.hypot(outward.x, outward.y);
    if (length <= CAD_XY_DEGENERATE_FLOOR) return null;
    return {
      point,
      outgoingAzimuthDeg: cadAzimuthDeg({ x: 0, y: 0 }, outward),
      reversed: false,
    };
  }
  if (!isFinitePoint(source.center) || source.radius <= CAD_XY_DEGENERATE_FLOOR) return null;
  const startPoint = arcPointAt(source.center, source.radius, source.startAngleDeg);
  const endPoint = arcPointAt(source.center, source.radius, source.endAngleDeg);
  const startDistance = cadDistance(pick, startPoint);
  const endDistance = cadDistance(pick, endPoint);
  if (endDistance <= startDistance) {
    return {
      point: endPoint,
      outgoingAzimuthDeg: cadArcEndTangentAzimuthDeg(source),
      reversed: false,
    };
  }
  return {
    point: startPoint,
    outgoingAzimuthDeg: cadNormalizeAngleDeg(
      arcStartTangentAzimuthDeg(source.startAngleDeg, source.endAngleDeg) + 180,
    ),
    reversed: true,
  };
};

/** Point mode: circle through start and end tangent to the outgoing direction. */
export const buildCadCurveFromEndPoint = (
  source: CadCurveContinuationSource,
  pick: CadWorldPoint,
  endPoint: CadWorldPoint,
): CadCurveContinuationResult | null => {
  const base = resolveCadCurveFromEndBase(source, pick);
  if (!base || !isFinitePoint(endPoint)) return null;
  if (cadDistance(base.point, endPoint) <= CAD_XY_DEGENERATE_FLOOR) return null;
  const arc = cadBuildArcFromStartEndDirection(
    base.point,
    endPoint,
    base.outgoingAzimuthDeg,
    false,
  );
  if (!arc) return null;
  return {
    arc,
    start: { ...arc.startPoint },
    end: { ...arc.endPoint },
    metrics: buildCadCurveMetricsSummaryFromRadiusDeltaDeg(arc.radius, arc.deltaDeg),
  };
};

/** Radius mode: signed radius + one extent metric (T/C/D/L/E/M). */
export const buildCadCurveFromEndRadius = (
  source: CadCurveContinuationSource,
  pick: CadWorldPoint,
  request: CadCurveFromEndRadiusRequest,
): CadCurveContinuationResult | null => {
  const base = resolveCadCurveFromEndBase(source, pick);
  if (!base) return null;
  if (!Number.isFinite(request.signedRadius) || request.signedRadius === 0) return null;
  const radius = Math.abs(request.signedRadius);
  const metrics = solveCadCurveMetricsFromRadius({
    radius,
    mode: request.mode,
    value: request.value,
  });
  if (!metrics) return null;
  const arc = cadBuildArcFromStartTangentRadiusDelta(
    base.point,
    base.outgoingAzimuthDeg,
    radius,
    metrics.deltaDeg,
    request.signedRadius > 0 ? 'right' : 'left',
  );
  if (!arc) return null;
  return {
    arc,
    start: { ...arc.startPoint },
    end: { ...arc.endPoint },
    metrics,
  };
};
