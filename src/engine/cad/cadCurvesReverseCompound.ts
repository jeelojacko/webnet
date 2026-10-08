import {
  cadBuildContinuedArc,
  type CadArcDefinition,
  type CadWorldPoint,
} from './cadGeometry';
import { cadArcEndPoint, cadArcEndTangentAzimuthDeg } from './cadGeometryArcPrimitives';
import {
  cadBuildCompoundCurve,
  cadBuildReverseCurve,
} from './cadCogoCurveMath';
import {
  buildCadCurveMetricsSummaryFromRadiusDeltaDeg,
  solveCadCurveMetricsFromRadius,
  type CadCurveMetricMode,
} from './cadCurveMetricsSolver';
import type { CadCurveMetricsSummary } from './cadCogoCurveMetrics';

/**
 * Phase F1 — contract 6: Reverse-or-Compound G1 continuation.
 *
 * Shares the existing `cadBuildReverseCurve` / `cadBuildCompoundCurve` /
 * `cadBuildContinuedArc` law so combined and separate calls agree. A compound
 * continuation keeps the oriented source's turn sign; a reverse continuation
 * flips it. `end: 'start'` orients the source backwards before continuing.
 */

export type CadCurveReverseCompoundMode = 'reverse' | 'compound';

export interface CadCurveReverseCompoundSource {
  centerX: number;
  centerY: number;
  radius: number;
  startAngleDeg: number;
  endAngleDeg: number;
}

export interface CadCurveReverseCompoundRequest {
  mode: CadCurveReverseCompoundMode;
  end: 'start' | 'end';
  /** Known new radius. */
  radius: number;
  /** Extent metric used to derive the new delta from `radius`. */
  extent: { mode: CadCurveMetricMode; value: number };
  /** Explicit delta (legacy `L/Rradius,delta` compatibility); when set it
   *  overrides `extent` so the call reproduces the direct build bit-for-bit. */
  deltaDeg?: number;
  /** Optional point-mode endpoint (then `extent`/`deltaDeg` are ignored). */
  pointEnd?: CadWorldPoint;
}

export interface CadCurveReverseCompoundResult {
  arc: CadArcDefinition;
  start: CadWorldPoint;
  end: CadWorldPoint;
  metrics: CadCurveMetricsSummary | null;
  orientedSource: CadCurveReverseCompoundSource;
}

export const orientCadCurveReverseCompoundSource = (
  source: CadCurveReverseCompoundSource,
  end: 'start' | 'end',
): CadCurveReverseCompoundSource => {
  if (end === 'end') return { ...source };
  return {
    centerX: source.centerX,
    centerY: source.centerY,
    radius: source.radius,
    startAngleDeg: source.endAngleDeg,
    endAngleDeg: source.startAngleDeg,
  };
};

export const buildCadCurveReverseOrCompound = (
  source: CadCurveReverseCompoundSource,
  request: CadCurveReverseCompoundRequest,
): CadCurveReverseCompoundResult | null => {
  const orientedSource = orientCadCurveReverseCompoundSource(source, request.end);

  if (request.pointEnd) {
    const arc = cadBuildContinuedArc(orientedSource, request.pointEnd, request.mode === 'reverse');
    if (!arc) return null;
    return {
      arc,
      start: { ...arc.startPoint },
      end: { ...arc.endPoint },
      metrics: buildCadCurveMetricsSummaryFromRadiusDeltaDeg(arc.radius, arc.deltaDeg),
      orientedSource,
    };
  }

  const metrics =
    request.deltaDeg != null
      ? buildCadCurveMetricsSummaryFromRadiusDeltaDeg(request.radius, request.deltaDeg)
      : solveCadCurveMetricsFromRadius({
          radius: request.radius,
          mode: request.extent.mode,
          value: request.extent.value,
        });
  if (!metrics) return null;

  const arc =
    request.mode === 'compound'
      ? cadBuildCompoundCurve({
          sourceArc: orientedSource,
          radius: request.radius,
          deltaDeg: metrics.deltaDeg,
        })
      : cadBuildReverseCurve({
          sourceArc: orientedSource,
          radius: request.radius,
          deltaDeg: metrics.deltaDeg,
        });
  if (!arc) return null;

  return {
    arc,
    start: { ...arc.startPoint },
    end: { ...arc.endPoint },
    metrics,
    orientedSource,
  };
};

/** Exposed for tests: the oriented source end point / tangent the continuation uses. */
export const cadCurveReverseCompoundSourceEnd = (
  orientedSource: CadCurveReverseCompoundSource,
): { point: CadWorldPoint; tangentAzimuthDeg: number } => ({
  point: cadArcEndPoint(orientedSource),
  tangentAzimuthDeg: cadArcEndTangentAzimuthDeg(orientedSource),
});
