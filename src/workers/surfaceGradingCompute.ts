/**
 * Phase 20C Wave-1A — worker-side grade-to-surface entry point.
 *
 * Thin orchestrator over the engine kernel in
 * `src/engine/cad/grading/`: `solveStraightChord.ts` (exact straight-chord
 * solve + result assembly) and `arcSolve.ts` (arc subdivision driver).
 * Snapshot types and the compute outcome live in the kernel and are
 * re-exported here so existing worker/test import sites keep working.
 */
import { solveArcGrading } from '../engine/cad/grading/arcSolve';
import {
  assembleAnalyticGradingResult,
  assembleGradingResult,
} from '../engine/cad/grading/gradingResultAssemble';
import { buildTargetQuery } from '../engine/cad/grading/gradingTargetIndex';
import { solveGradingChord } from '../engine/cad/grading/solveAnalyticGradingChord';
import {
  finiteSource,
} from '../engine/cad/grading/solveStraightChord';
import { isTargetFreeCriterion } from '../engine/cad/grading/gradingTypes';
import type {
  GradingComputeOutcome,
  GradingComputeSource,
  GradingTargetMeshSnapshot,
} from '../engine/cad/grading/gradingComputeTypes';
import {
  AGREEMENT_FLOOR,
  anchoredElevationAgreementTol,
  coordinateAgreementTol,
  elevationAgreementTol,
  planeLeverage,
  type AnchoredPlane,
} from '../engine/cad/grading/gradingGroupSectors';
import type {
  GradingCriterion,
  GradingSide,
} from '../engine/cad/grading/gradingTypes';

export type {
  GradingComputeSource,
  GradingComputeOutcome,
  GradingTargetMeshSnapshot,
};

export interface GradingComputeRequest {
  gradingId: string;
  /** `grev1:` content revision the result is calculated at. */
  revision: string;
  drawingId?: string;
  source: GradingComputeSource;
  side: GradingSide;
  criterion: GradingCriterion;
  maxSearchDistance: number;
  curveChordTolerance: number;
  /** Omitted for target-free (analytic) criteria — never a fake TIN. */
  target?: GradingTargetMeshSnapshot;
}

/**
 * Grade-to-surface calculation on flat snapshots. Arc sources with circle
 * parameters subdivide via linearizeGradingArc at the definition's
 * curveChordTolerance and run the exact straight-chord solve per chord;
 * arc sources WITHOUT parameters keep the legacy single-chord solve
 * (CURVE_APPROXIMATED accuracy); straight sources are EXACT. Cut/fill
 * splits stations at exact zero crossings and solves each span under its
 * classified slope; any null source coverage BLOCKS cut/fill.
 */
export const computeGradingFromSnapshots = (
  request: GradingComputeRequest,
): GradingComputeOutcome => {
  const { source, side, criterion, maxSearchDistance, target } = request;
  if (!finiteSource(source)) return { ok: false, code: 'NO_SOLUTION', detail: 'GRADING_BAD_SOURCE' };
  if (!(maxSearchDistance > 0) || !Number.isFinite(maxSearchDistance)) {
    return { ok: false, code: 'NO_SOLUTION', detail: 'GRADING_BAD_SEARCH_DISTANCE' };
  }
  // Phase 20F: analytic criteria never build a target query (no TIN).
  if (isTargetFreeCriterion(criterion)) {
    if (source.isArc && source.arc) {
      return solveArcGrading({
        gradingId: request.gradingId,
        revision: request.revision,
        source,
        side,
        criterion,
        maxSearchDistance,
        tolerance: request.curveChordTolerance,
      });
    }
    const solved = solveGradingChord({
      source,
      side,
      criterion,
      maxSearchDistance,
      stationBase: 0,
      stationScale: 1,
    });
    if (!solved.ok) return solved;
    const analytic = solved.solve;
    return assembleAnalyticGradingResult({
      gradingId: request.gradingId,
      revision: request.revision,
      sourceLength: source.length,
      accuracy: source.isArc ? 'CURVE_APPROXIMATED' : 'EXACT',
      regions: analytic.regions,
      diagnostics: analytic.diagnostics,
      sourcePts: analytic.sourcePts,
      daylightPts: analytic.daylightPts,
      daylightFlat: analytic.daylightFlat,
      distances: analytic.distances,
      nodeStations: analytic.nodeStations,
      candidateTriangleCount: analytic.candidateTriangleCount,
      intersectionSegmentCount: analytic.intersectionSegmentCount,
      multipleSolutionCount: analytic.multipleSolutionCount,
    });
  }
  if (!target) return { ok: false, code: 'NO_SOLUTION', detail: 'GRADING_BAD_TARGET_MESH' };
  const query = buildTargetQuery(target);
  if (!query) return { ok: false, code: 'NO_SOLUTION', detail: 'GRADING_BAD_TARGET_MESH' };

  if (source.isArc && source.arc) {
    return solveArcGrading({
      gradingId: request.gradingId,
      revision: request.revision,
      source,
      side,
      criterion,
      maxSearchDistance,
      tolerance: request.curveChordTolerance,
      target,
      query,
    });
  }

  const solved = solveGradingChord({
    source,
    side,
    criterion,
    maxSearchDistance,
    target,
    query,
    stationBase: 0,
    stationScale: 1,
  });
  if (!solved.ok) return solved;
  const chord = solved.solve;
  return assembleGradingResult({
    gradingId: request.gradingId,
    revision: request.revision,
    sourceLength: source.length,
    accuracy: source.isArc ? 'CURVE_APPROXIMATED' : 'EXACT',
    regions: chord.regions,
    diagnostics: chord.diagnostics,
    sourcePts: chord.sourcePts,
    daylightPts: chord.daylightPts,
    daylightFlat: chord.daylightFlat,
    distances: chord.distances,
    nodeStations: chord.nodeStations,
    query,
    candidateTriangleCount: chord.candidateTriangleCount,
    intersectionSegmentCount: chord.intersectionSegmentCount,
    multipleSolutionCount: chord.multipleSolutionCount,
  });
};

// ---------------------------------------------------------------------------
// Daylight/target agreement gate (GO-gate logic, service-side before CURRENT)
// ---------------------------------------------------------------------------

export interface GradingTargetQuery {
  elevationAt: (_x: number, _y: number) => number | null;
  /**
   * Anchored target triangle plane at (x, y) for the agreement leverage.
   * Optional so analytic/target-free and test doubles keep working; when
   * absent the gate falls back to the 1 nm floor only.
   */
  planeAt?: (_x: number, _y: number) => (AnchoredPlane & { z: number }) | null;
}

export interface GradingSourceBoundaryCheck {
  /** First/last source-boundary XYZ of the cached strip mesh. */
  first: { x: number; y: number; z: number };
  last: { x: number; y: number; z: number };
  /** Feature Line evaluated at the same persisted stations. */
  expectedFirst: { x: number; y: number; z: number };
  expectedLast: { x: number; y: number; z: number };
  /**
   * Optional source-evaluation scale (arc centre/radius extent). The arc
   * linearization rounds at that magnitude, not at the endpoint magnitude,
   * so the shared coordinate agreement must use it to avoid false rejects at
   * an arc endpoint that sits near the origin.
   */
  coordinateScale?: number;
}

/**
 * Shared coordinate agreement (single world magnitude per axis, no x·y
 * product) — never the bare `zeroDelta` classification floor. Genuine
 * endpoint drift (the old `start + chordDir·arcLength` overshoot) fails by
 * orders; arc-evaluation ULP rounding passes.
 */
const boundaryPlanarTol = (
  a: { x: number; y: number },
  b: { x: number; y: number },
  coordinateScale: number,
): { x: number; y: number } => {
  const scale = Math.max(1, coordinateScale, Math.abs(a.x), Math.abs(b.x), Math.abs(a.y), Math.abs(b.y));
  return {
    x: coordinateAgreementTol(a.x, b.x, scale),
    y: coordinateAgreementTol(a.y, b.y, scale),
  };
};

const boundaryEquals = (
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
  coordinateScale: number,
): boolean => {
  const planar = boundaryPlanarTol(a, b, coordinateScale);
  return (
    Math.abs(a.x - b.x) <= planar.x &&
    Math.abs(a.y - b.y) <= planar.y &&
    Math.abs(a.z - b.z) <= elevationAgreementTol(a.z, b.z, []) + AGREEMENT_FLOOR
  );
};

/**
 * Phase 20K.3 — daylight vertices vs the CURRENT target mesh under the single
 * shared anchored elevation-agreement authority. A void/off-target node and a
 * genuinely mismatched Z return distinct codes; a non-finite node fails
 * closed. The global `zeroDelta` classification floor is never the gate.
 */
export const validateDaylightAgainstTarget = (
  daylightPoints: number[],
  targetMeshQuery: GradingTargetQuery,
): string | null => {
  if (daylightPoints.length % 3 !== 0) return 'GRADING_AGREEMENT_MALFORMED_DAYLIGHT';
  for (let i = 0; i + 2 < daylightPoints.length; i += 3) {
    const x = daylightPoints[i]!;
    const y = daylightPoints[i + 1]!;
    const z = daylightPoints[i + 2]!;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      return 'GRADING_AGREEMENT_MALFORMED_DAYLIGHT';
    }
    const zt = targetMeshQuery.elevationAt(x, y);
    if (zt === null) return 'GRADING_AGREEMENT_DAYLIGHT_OFF_TARGET';
    if (!Number.isFinite(zt)) return 'GRADING_AGREEMENT_DAYLIGHT_Z';
    const plane = targetMeshQuery.planeAt?.(x, y) ?? null;
    const leverage = plane ? planeLeverage(plane, x, y) : [];
    const gradientSum = plane ? Math.abs(plane.gx) + Math.abs(plane.gy) : 0;
    const tolerance = anchoredElevationAgreementTol(zt, z, leverage, gradientSum, x, y);
    if (!Number.isFinite(tolerance) || Math.abs(zt - z) > tolerance) {
      return 'GRADING_AGREEMENT_DAYLIGHT_Z';
    }
  }
  return null;
};

/**
 * Source-boundary half of the agreement gate (target-independent): the
 * strip source boundary must equal the Feature Line at the same persisted
 * stations under the shared coordinate authority. Analytic (target-free)
 * results gate on this half only.
 * Returns null on agreement, else the reject reason.
 */
export const validateGradingSourceBoundary = (
  sourceCheck: GradingSourceBoundaryCheck,
): string | null => {
  const scale = sourceCheck.coordinateScale ?? 0;
  if (!boundaryEquals(sourceCheck.first, sourceCheck.expectedFirst, scale)) {
    return 'GRADING_AGREEMENT_SOURCE_BOUNDARY';
  }
  if (!boundaryEquals(sourceCheck.last, sourceCheck.expectedLast, scale)) {
    return 'GRADING_AGREEMENT_SOURCE_BOUNDARY';
  }
  return null;
};

/**
 * GO-gate before a worker result becomes CURRENT: every daylight vertex
 * must agree with the CURRENT target mesh under the shared anchored
 * elevation-agreement authority, and the strip source boundary must equal the
 * Feature Line at the same persisted stations. Returns null on agreement,
 * else the reject reason.
 */
export const validateGradingResultAgainstTarget = (
  daylightPoints: number[],
  targetMeshQuery: GradingTargetQuery,
  sourceCheck: GradingSourceBoundaryCheck,
): string | null => {
  if (daylightPoints.length % 3 !== 0) return 'GRADING_AGREEMENT_MALFORMED_DAYLIGHT';
  const boundary = validateGradingSourceBoundary(sourceCheck);
  if (boundary) return boundary;
  return validateDaylightAgainstTarget(daylightPoints, targetMeshQuery);
};
