import type { CadEntityId } from './cadTypes';
import type { CadWorldPoint } from './cadGeometry';
import type { CadCurveChainSegmentInput } from './cadCurvesMultiple';
import type { CadCurveMetricMode } from './cadCurveMetricsSolver';

/**
 * Phase CAD Curves F1 — typed payloads for the six atomic curve commands.
 *
 * Lives in its own module so `cadTransactions.types.ts` can add the keys to
 * the `CadCommand` union without importing the command implementations (no
 * runtime cycle). All geometry is meters/degrees at this boundary.
 */

export interface CadCurveF1Metric {
  mode: CadCurveMetricMode;
  value: number;
}

/** Contract 1 — Between (trim): tangent arc + both lines trimmed to PC/PT. */
export interface CadCurveBetweenLinesCommand {
  key: 'CURVE_BETWEEN_TWO_LINES_CREATE';
  firstEntityId: CadEntityId;
  firstPickPoint: CadWorldPoint;
  secondEntityId: CadEntityId;
  secondPickPoint: CadWorldPoint;
  metric: CadCurveF1Metric;
}

/** Contract 2 — On (no trim): identical arc, sources byte-unchanged. */
export interface CadCurveOnLinesCommand {
  key: 'CURVE_ON_TWO_LINES_CREATE';
  firstEntityId: CadEntityId;
  firstPickPoint: CadWorldPoint;
  secondEntityId: CadEntityId;
  secondPickPoint: CadWorldPoint;
  metric: CadCurveF1Metric;
}

/** Contract 3 — Through point (trim): unique tangent circle through a pick. */
export interface CadCurveThroughPointCommand {
  key: 'CURVE_THROUGH_POINT_CREATE';
  firstEntityId: CadEntityId;
  firstPickPoint: CadWorldPoint;
  secondEntityId: CadEntityId;
  secondPickPoint: CadWorldPoint;
  throughPoint: CadWorldPoint;
  /**
   * Operator-selected side when the kernel reports more than one candidate.
   * Absent means "unique only" — a multi-solution outcome is refused rather
   * than picked by array order.
   */
  candidateSide?: 'left' | 'right';
}

/** Contract 4 — Multiple 2..10: one floating curve, sources unchanged. */
export interface CadMultipleCurvesCommand {
  key: 'MULTIPLE_CURVES_CREATE';
  firstEntityId: CadEntityId;
  firstPickPoint: CadWorldPoint;
  secondEntityId: CadEntityId;
  secondPickPoint: CadWorldPoint;
  segments: CadCurveChainSegmentInput[];
}

/** Contract 5 — From End: one continuation arc, source never modified. */
export interface CadCurveFromEndCommand {
  key: 'CURVE_FROM_END_CREATE';
  sourceEntityId: CadEntityId;
  pickPoint: CadWorldPoint;
  /** Point mode endpoint; when set, radius/metric are ignored. */
  endPoint?: CadWorldPoint;
  /** Radius mode signed radius (positive = right/CW, negative = left/CCW). */
  signedRadius?: number;
  metric?: CadCurveF1Metric;
}

/** Contract 6 — Reverse/Compound G1 continuation, source never modified. */
export interface CadReverseCompoundCurveCommand {
  key: 'REVERSE_COMPOUND_CURVE_CREATE';
  sourceEntityId: CadEntityId;
  mode: 'reverse' | 'compound';
  end: 'start' | 'end';
  radius: number;
  /** New extent metric path. */
  extent?: CadCurveF1Metric;
  /** Legacy `L/Rradius,delta` compatibility fast path (degrees). */
  deltaDeg?: number;
  /** Optional point-mode endpoint (then extent/deltaDeg are ignored). */
  pointEnd?: CadWorldPoint;
}

/** Atomic subdivision: every interior point in ONE history entry. */
export interface CadSubdivideCurveCommand {
  key: 'SUBDIVIDE_CURVE_CREATE';
  arcEntityId: CadEntityId;
  mode: 'equal' | 'arc' | 'chord';
  value: number;
}
