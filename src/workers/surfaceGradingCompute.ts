/**
 * Phase 20C Wave-1A — worker-side grade-to-surface entry point.
 *
 * Thin orchestrator over the engine kernel in
 * `src/engine/cad/grading/`: `solveStraightChord.ts` (exact straight-chord
 * solve + result assembly) and `arcSolve.ts` (arc subdivision driver).
 * Snapshot types and the compute outcome live in the kernel and are
 * re-exported here so existing worker/test import sites keep working.
 */
import { resolveAnalyticCriterionAt } from '../engine/cad/grading/gradingAnalyticCriterion';
import { gradingSideNormal } from '../engine/cad/grading/gradingCourseFrame';
import { solveArcGrading } from '../engine/cad/grading/arcSolve';
import {
  assembleAnalyticGradingResult,
  assembleGradingResult,
} from '../engine/cad/grading/gradingResultAssemble';
import { buildTargetQuery } from '../engine/cad/grading/gradingTargetIndex';
import { solveGradingChord } from '../engine/cad/grading/solveAnalyticGradingChord';
import {
  admitGradingTransition,
  checkGroupTransitionSeparation,
  evaluateTransitionLinearV1,
  parseCanonicalJointIndex,
  TRANSITION_LAW_KIND,
  TRANSITION_LAW_VERSION,
  TRANSITION_POLICY_VERSION,
  type TransitionFamily,
} from '../engine/cad/grading/gradingTransitionPolicy';
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
import type { CadGradingTransition, CadGradingGroupTransitionLeg } from '../engine/cad/grading/gradingGroupTypes';

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
 * Phase 20M.2 WAVE F — transition agreement (worker independent re-evaluation).
 *
 * The plan carries law/ref/station data only (never geometry snapshots as
 * input): lawKind/lawVersion/family/width, endpoint member refs, pinned
 * endpoint evidence at the recorded `ggrev1:`, and the joint station origin.
 * The worker rechecks family/grade/admission via `admitGradingTransition`
 * (which re-resolves native endpoint criteria), reconstructs v(s), and
 * validates transition-owned vertices at their own source station under the
 * CURRENT coordinate/elevation authorities. Source boundary check unchanged.
 * Every mismatch fails closed with a bounded GRADING_AGREEMENT_TRANSITION_*
 * code. No epsilon is introduced or widened anywhere.
 *
 * Worker-side transition envelope: the canonical persisted intent
 * (`CadGradingTransition`) plus the agreement-only fields the worker needs
 * (group context, joint Z/station, pinned evidence, recorded revision).
 * Evidence outputs are never geometric input (persisted-model §§4–5).
 */
export interface GroupTransitionPlan extends CadGradingTransition {
  memberIds: string[];
  groupSide: GradingSide;
  isOpen: boolean;
  transitionCount: number;
  /** Authoritative joint Z the endpoint natives resolve at. */
  jointZ: number;
  /** Pinned endpoint scalars + gradeRatios as evidence (never input). */
  endpointEvidence: { vL: number; vR: number; gL: number; gR: number };
  /** Persisted joint station origin (s = 0 at the joint). */
  jointStation: number;
  /** `ggrev1:` recorded when the evidence was pinned. */
  recordedRevision: string;
}

/** Native member geometry resolved from the endpoint refs (service side). */
export interface GroupTransitionMemberView {
  memberId: string;
  criterion: GradingCriterion;
  length: number;
  dirX: number;
  dirY: number;
  startZ: number;
  endZ: number;
  isArc: boolean;
  maxSearchDistance: number;
}

export interface GroupTransitionAgreement {
  vL: number;
  vR: number;
  sL: number;
  sR: number;
  family: TransitionFamily;
}

export type GroupTransitionAgreementOutcome =
  | ({ ok: true } & GroupTransitionAgreement)
  | { ok: false; code: string };

const transitionFail = (code: string): GroupTransitionAgreementOutcome => ({ ok: false, code });

/**
 * Request-level agreement: rechecks admission (re-resolving natives),
 * then compares re-resolved scalars against the pinned evidence AND the
 * recorded revision against the live revision. Null-equivalent ok object
 * on agreement, else the bounded reject code.
 */
export const checkGroupTransitionAgreement = (
  plan: GroupTransitionPlan,
  members: readonly GroupTransitionMemberView[],
  liveRevision: string,
): GroupTransitionAgreementOutcome => {
  if (!plan || !Array.isArray(plan.memberIds) || plan.memberIds.length !== 2) {
    return transitionFail('GRADING_AGREEMENT_TRANSITION_MALFORMED');
  }
  if (!Array.isArray(members) || members.length !== 2) {
    return transitionFail('GRADING_AGREEMENT_TRANSITION_MALFORMED');
  }
  const mL = members[0]!;
  const mR = members[1]!;
  if (mL.memberId !== plan.memberIds[0] || mR.memberId !== plan.memberIds[1]) {
    return transitionFail('GRADING_AGREEMENT_TRANSITION_STALE');
  }
  if (plan.policyVersion !== TRANSITION_POLICY_VERSION) {
    return transitionFail('GRADING_AGREEMENT_TRANSITION_VERSION_UNKNOWN');
  }
  if (plan.lawKind !== TRANSITION_LAW_KIND || plan.lawVersion !== TRANSITION_LAW_VERSION) {
    return transitionFail('GRADING_AGREEMENT_TRANSITION_LAW_UNKNOWN');
  }
  if (plan.transitionCount !== 1) {
    return transitionFail('GRADING_AGREEMENT_TRANSITION_OVERLAP');
  }
  if (plan.recordedRevision !== liveRevision) {
    return transitionFail('GRADING_AGREEMENT_TRANSITION_STALE');
  }
  const admitted = admitGradingTransition({
    policyVersion: plan.policyVersion,
    lawKind: plan.lawKind,
    lawVersion: plan.lawVersion,
    criterionFamily: plan.criterionFamily,
    jointId: plan.jointId,
    memberIds: [plan.memberIds[0]!, plan.memberIds[1]!],
    width: plan.width,
    side: plan.side,
    groupSide: plan.groupSide,
    isOpen: plan.isOpen,
    transitionCount: plan.transitionCount,
    jointZ: plan.jointZ,
    members: [
      {
        memberId: mL.memberId,
        criterion: mL.criterion,
        length: mL.length,
        dirX: mL.dirX,
        dirY: mL.dirY,
        startZ: mL.startZ,
        endZ: mL.endZ,
        isArc: mL.isArc,
        maxSearchDistance: mL.maxSearchDistance,
      },
      {
        memberId: mR.memberId,
        criterion: mR.criterion,
        length: mR.length,
        dirX: mR.dirX,
        dirY: mR.dirY,
        startZ: mR.startZ,
        endZ: mR.endZ,
        isArc: mR.isArc,
        maxSearchDistance: mR.maxSearchDistance,
      },
    ],
  });
  if (!admitted.ok) {
    switch (admitted.code) {
      case 'MALFORMED':
      case 'WIDTH_INVALID':
        return transitionFail('GRADING_AGREEMENT_TRANSITION_MALFORMED');
      case 'VERSION_UNKNOWN':
        return transitionFail('GRADING_AGREEMENT_TRANSITION_VERSION_UNKNOWN');
      case 'LAW_UNKNOWN':
        return transitionFail('GRADING_AGREEMENT_TRANSITION_LAW_UNKNOWN');
      case 'CARDINALITY':
        return transitionFail('GRADING_AGREEMENT_TRANSITION_OVERLAP');
      case 'WIDTH_INFEASIBLE':
        return transitionFail('GRADING_AGREEMENT_TRANSITION_WIDE');
      case 'MEMBER_REF_STALE':
        return transitionFail('GRADING_AGREEMENT_TRANSITION_STALE');
      case 'FAMILY_MISMATCH':
      case 'GRADE_MISMATCH':
        return transitionFail('GRADING_AGREEMENT_TRANSITION_FAMILY_MISMATCH');
      case 'NATIVE_CRITERION':
      case 'MAX_SEARCH':
        return transitionFail('GRADING_AGREEMENT_TRANSITION_OFF_LAW');
      default:
        return transitionFail('GRADING_AGREEMENT_TRANSITION_GEOMETRY');
    }
  }
  // Pinned evidence is deterministic same-build output: exact comparison.
  const ev = plan.endpointEvidence;
  if (!ev || !(ev.vL === admitted.vL && ev.vR === admitted.vR)) {
    return transitionFail('GRADING_AGREEMENT_TRANSITION_STALE');
  }
  return { ok: true, vL: admitted.vL, vR: admitted.vR, sL: admitted.sL, sR: admitted.sR, family: admitted.family };
};

/** Null on agreement, else the bounded reject code. */
export const validateGroupTransitionAgreement = (
  plan: GroupTransitionPlan,
  members: readonly GroupTransitionMemberView[],
  liveRevision: string,
): string | null => {
  const out = checkGroupTransitionAgreement(plan, members, liveRevision);
  return out.ok ? null : out.code;
};

export interface TransitionInteriorVertex {
  /** Joint-local source-line station: interior is [sL, sR]. */
  s: number;
  x: number;
  y: number;
  z: number;
  /** Source-line point at the same station (transition never moves source). */
  srcX: number;
  srcY: number;
  srcZ: number;
}

/**
 * Mesh-level agreement: each transition-owned vertex independently
 * re-evaluates the legislated TRANSITION_LINEAR_V1 law at its own station
 * under the shared authorities (coordinate for plan distance, elevation
 * for Z families). Mis-assigned stations and non-finite nodes fail closed.
 */
export const validateTransitionInteriorVertices = (
  law: GroupTransitionAgreement,
  vertices: readonly TransitionInteriorVertex[],
): string | null => {
  for (const v of vertices) {
    if (!Number.isFinite(v.s) || !Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.z) ||
        !Number.isFinite(v.srcX) || !Number.isFinite(v.srcY) || !Number.isFinite(v.srcZ)) {
      return 'GRADING_AGREEMENT_TRANSITION_MALFORMED';
    }
    if (!(v.s >= law.sL && v.s <= law.sR)) {
      return 'GRADING_AGREEMENT_TRANSITION_GEOMETRY';
    }
    const expected = evaluateTransitionLinearV1(law.vL, law.vR, law.sL, law.sR, v.s);
    if (law.family === 'distance') {
      const observed = Math.hypot(v.x - v.srcX, v.y - v.srcY);
      const scale = Math.max(1, Math.abs(v.x), Math.abs(v.srcX), Math.abs(v.y), Math.abs(v.srcY));
      if (Math.abs(observed - expected) > coordinateAgreementTol(observed, expected, scale) + AGREEMENT_FLOOR) {
        return 'GRADING_AGREEMENT_TRANSITION_OFF_LAW';
      }
    } else if (law.family === 'relative-elevation') {
      const observed = v.z - v.srcZ;
      if (Math.abs(observed - expected) > elevationAgreementTol(observed, expected, []) + AGREEMENT_FLOOR) {
        return 'GRADING_AGREEMENT_TRANSITION_OFF_LAW';
      }
    } else if (Math.abs(v.z - expected) > elevationAgreementTol(v.z, expected, []) + AGREEMENT_FLOOR) {
      return 'GRADING_AGREEMENT_TRANSITION_OFF_LAW';
    }
  }
  return null;
};

/**
 * Post-solve mesh agreement: the result-owned transition leg carries the
 * three transition-owned checkpoint pairs (daylight qCutL/q0/qCutR with
 * source pCutL/V/pCutR at joint-local stations sL/0/sR). Every checkpoint
 * is re-evaluated against the legislated TRANSITION_LINEAR_V1 law under
 * the shared authorities, and the two boundary checkpoints are
 * additionally re-checked against their own re-resolved native criterion
 * (outside-interval native law via `resolveAnalyticCriterionAt`, shared
 * tols, no widening). Any mismatch fails closed with a bounded
 * GRADING_AGREEMENT_TRANSITION_* code.
 */
export interface TransitionResultMeshInput {
  family: TransitionFamily;
  sL: number;
  sR: number;
  vL: number;
  vR: number;
  /** Flat XYZ triplets: qCutL, q0, qCutR. */
  daylightCheckpoints: readonly number[];
  /** Flat XYZ triplets: pCutL, V, pCutR. */
  sourceCheckpoints: readonly number[];
  criterionL: GradingCriterion;
  criterionR: GradingCriterion;
  /** Authoritative joint Z the endpoint natives resolve at. */
  jointZ: number;
  maxSearchDistance: number;
  /** Result-owned daylight boundary: every checkpoint must occur in it. */
  daylightPoints: readonly number[];
  /** Result-owned source boundary: every source mate must occur in it. */
  sourceBoundaryPoints: readonly number[];
  /** Grading side: the plan offset must leave toward this side. */
  side: GradingSide;
}

const meshPoint = (flat: readonly number[], index: number): { x: number; y: number; z: number } | null => {
  const x = flat[index * 3];
  const y = flat[index * 3 + 1];
  const z = flat[index * 3 + 2];
  if (x === undefined || y === undefined || z === undefined) return null;
  return { x, y, z };
};

/** Boundary checkpoint against its own native criterion (never the law). */
const checkNativeBoundary = (
  criterion: GradingCriterion,
  daylight: { x: number; y: number; z: number },
  source: { x: number; y: number; z: number },
  jointZ: number,
  maxSearchDistance: number,
  family: TransitionFamily,
): string | null => {
  const resolved = resolveAnalyticCriterionAt(criterion, jointZ, maxSearchDistance);
  if (!resolved.ok) return 'GRADING_AGREEMENT_TRANSITION_OFF_LAW';
  if (family === 'distance') {
    const observed = Math.hypot(daylight.x - source.x, daylight.y - source.y);
    const expected = resolved.value.horizontalDistance;
    const scale = Math.max(1, Math.abs(daylight.x), Math.abs(source.x), Math.abs(daylight.y), Math.abs(source.y));
    if (Math.abs(observed - expected) > coordinateAgreementTol(observed, expected, scale) + AGREEMENT_FLOOR) {
      return 'GRADING_AGREEMENT_TRANSITION_OFF_LAW';
    }
    return null;
  }
  if (family === 'relative-elevation') {
    const observed = daylight.z - source.z;
    const expected = resolved.value.limitElevation - jointZ;
    if (Math.abs(observed - expected) > elevationAgreementTol(observed, expected, []) + AGREEMENT_FLOOR) {
      return 'GRADING_AGREEMENT_TRANSITION_OFF_LAW';
    }
    return null;
  }
  if (Math.abs(daylight.z - resolved.value.limitElevation) > elevationAgreementTol(daylight.z, resolved.value.limitElevation, []) + AGREEMENT_FLOOR) {
    return 'GRADING_AGREEMENT_TRANSITION_OFF_LAW';
  }
  return null;
};

/** Result-owned flat XYZ array contains the vertex (shared authorities). */
const flatContainsVertex = (
  flat: readonly number[],
  p: { x: number; y: number; z: number },
): boolean => {
  for (let i = 0; i + 2 < flat.length; i += 3) {
    const cx = flat[i]!;
    const cy = flat[i + 1]!;
    const cz = flat[i + 2]!;
    const plan = Math.hypot(p.x - cx, p.y - cy);
    const scale = Math.max(1, Math.abs(p.x), Math.abs(cx), Math.abs(p.y), Math.abs(cy));
    if (plan > coordinateAgreementTol(plan, 0, scale) + AGREEMENT_FLOOR) continue;
    if (Math.abs(p.z - cz) > elevationAgreementTol(p.z, cz, []) + AGREEMENT_FLOOR) continue;
    return true;
  }
  return false;
};

const gradeOf = (criterion: GradingCriterion): number | null => {
  const g = (criterion as { gradeRatio?: unknown }).gradeRatio;
  return typeof g === 'number' && Number.isFinite(g) && g !== 0 ? g : null;
};

export const validateTransitionResultMesh = (input: TransitionResultMeshInput): string | null => {
  if (!Number.isFinite(input.sL) || !Number.isFinite(input.sR) || !(input.sL < input.sR)) {
    return 'GRADING_AGREEMENT_TRANSITION_MALFORMED';
  }
  if (input.daylightCheckpoints.length !== 9 || input.sourceCheckpoints.length !== 9) {
    return 'GRADING_AGREEMENT_TRANSITION_MALFORMED';
  }
  const law = { vL: input.vL, vR: input.vR, sL: input.sL, sR: input.sR, family: input.family };
  const stations = [input.sL, 0, input.sR];
  const vertices: TransitionInteriorVertex[] = [];
  for (let i = 0; i < 3; i += 1) {
    const daylight = meshPoint(input.daylightCheckpoints, i);
    const source = meshPoint(input.sourceCheckpoints, i);
    if (!daylight || !source) return 'GRADING_AGREEMENT_TRANSITION_MALFORMED';
    vertices.push({ s: stations[i]!, ...daylight, srcX: source.x, srcY: source.y, srcZ: source.z });
  }
  // Inside: every checkpoint obeys the legislated law at its own station.
  const onLaw = validateTransitionInteriorVertices(law, vertices);
  if (onLaw) return onLaw;
  // Outside: boundary checkpoints obey their own native criterion.
  const left = checkNativeBoundary(input.criterionL, meshPoint(input.daylightCheckpoints, 0)!, meshPoint(input.sourceCheckpoints, 0)!, input.jointZ, input.maxSearchDistance, input.family);
  if (left) return left;
  const right = checkNativeBoundary(input.criterionR, meshPoint(input.daylightCheckpoints, 2)!, meshPoint(input.sourceCheckpoints, 2)!, input.jointZ, input.maxSearchDistance, input.family);
  if (right) return right;
  // Direction + Z: the plan offset must leave along the production side
  // normal (never magnitude-only), with the family-mapped Z. The tangent
  // comes from the source mates (collinear admission), the normal from the
  // production `gradingSideNormal` convention — shared tols, no widening.
  const pCutL = meshPoint(input.sourceCheckpoints, 0)!;
  const pCutR = meshPoint(input.sourceCheckpoints, 2)!;
  const normal = gradingSideNormal(pCutR.x - pCutL.x, pCutR.y - pCutL.y, input.side);
  if (!normal) return 'GRADING_AGREEMENT_TRANSITION_MALFORMED';
  const gL = gradeOf(input.criterionL);
  const gR = gradeOf(input.criterionR);
  if (gL === null || gR === null) return 'GRADING_AGREEMENT_TRANSITION_MALFORMED';
  const grades = [gL, gL, gR];
  for (let i = 0; i < 3; i += 1) {
    const g = grades[i]!;
    const expectedV = evaluateTransitionLinearV1(input.vL, input.vR, input.sL, input.sR, stations[i]!);
    const d = input.family === 'distance' ? expectedV
      : input.family === 'relative-elevation' ? expectedV / g
      : (expectedV - input.jointZ) / g;
    if (!Number.isFinite(d)) return 'GRADING_AGREEMENT_TRANSITION_MALFORMED';
    const daylight = meshPoint(input.daylightCheckpoints, i)!;
    const source = meshPoint(input.sourceCheckpoints, i)!;
    const ox = daylight.x - source.x;
    const oy = daylight.y - source.y;
    const ex = d * normal.nx;
    const ey = d * normal.ny;
    if (Math.abs(ox - ex) > coordinateAgreementTol(ox, ex, Math.max(1, Math.abs(ox), Math.abs(ex))) + AGREEMENT_FLOOR) {
      return 'GRADING_AGREEMENT_TRANSITION_OFF_LAW';
    }
    if (Math.abs(oy - ey) > coordinateAgreementTol(oy, ey, Math.max(1, Math.abs(oy), Math.abs(ey))) + AGREEMENT_FLOOR) {
      return 'GRADING_AGREEMENT_TRANSITION_OFF_LAW';
    }
    if (input.family === 'distance') {
      const expectedZ = input.jointZ + g * expectedV;
      if (Math.abs(daylight.z - expectedZ) > elevationAgreementTol(daylight.z, expectedZ, []) + AGREEMENT_FLOOR) {
        return 'GRADING_AGREEMENT_TRANSITION_OFF_LAW';
      }
    }
  }
  // Mesh anchoring: the checkpoints must occur in the result-owned
  // boundary arrays — a tampered boundary/mesh with an intact leg fails.
  for (let i = 0; i < 3; i += 1) {
    if (!flatContainsVertex(input.daylightPoints, meshPoint(input.daylightCheckpoints, i)!)) {
      return 'GRADING_AGREEMENT_TRANSITION_GEOMETRY';
    }
    if (!flatContainsVertex(input.sourceBoundaryPoints, meshPoint(input.sourceCheckpoints, i)!)) {
      return 'GRADING_AGREEMENT_TRANSITION_GEOMETRY';
    }
  }
  return null;
};

/**
 * Phase 20N.1 Wave F — plural worker pre-solve agreement (canonical joint
 * order, never re-sorted). Every plan is re-admitted via
 * `checkGroupTransitionAgreement` against worker re-resolved views, then
 * strict separation is verified from the authoritative view lengths
 * (shared member exactness included). One failure rejects the group.
 */
export interface GroupTransitionPlansAgreementInput {
  plans: readonly GroupTransitionPlan[];
  /** Per-joint member views in plan order (worker re-resolved, authoritative). */
  views: readonly (readonly GroupTransitionMemberView[])[];
  liveRevision: string;
}

export type GroupTransitionPlansAgreementOutcome =
  | { ok: true; agreements: GroupTransitionAgreement[] }
  | { ok: false; code: string; joint?: number };

export const checkGroupTransitionPlansAgreement = (
  input: GroupTransitionPlansAgreementInput,
): GroupTransitionPlansAgreementOutcome => {
  const { plans, views, liveRevision } = input;
  if (plans.length !== views.length) {
    return { ok: false, code: 'GRADING_AGREEMENT_TRANSITION_MALFORMED' };
  }
  let prev = -1;
  for (const plan of plans) {
    const index = parseCanonicalJointIndex(plan.jointId);
    if (index === null || (prev >= 0 && index !== prev + 1)) {
      return { ok: false, code: 'GRADING_AGREEMENT_TRANSITION_MALFORMED', joint: index ?? undefined };
    }
    prev = index;
  }
  const agreements: GroupTransitionAgreement[] = [];
  for (let i = 0; i < plans.length; i += 1) {
    const plan = plans[i]!;
    const members = views[i]!;
    const out = checkGroupTransitionAgreement(plan, members, liveRevision);
    if (!out.ok) {
      const joint = parseCanonicalJointIndex(plan.jointId);
      return { ok: false, code: out.code, ...(joint === null ? {} : { joint }) };
    }
    agreements.push({ vL: out.vL, vR: out.vR, sL: out.sL, sR: out.sR, family: out.family });
  }
  if (plans.length > 1) {
    const widths = plans.map((plan) => plan.width);
    const gaps: number[] = [];
    for (let i = 0; i + 1 < views.length; i += 1) {
      const left = views[i]![1];
      const right = views[i + 1]![0];
      if (left === undefined || right === undefined || !(left.length === right.length)) {
        return { ok: false, code: 'GRADING_AGREEMENT_TRANSITION_STALE' };
      }
      gaps.push(left.length);
    }
    if (!checkGroupTransitionSeparation(widths, gaps)) {
      return { ok: false, code: 'GRADING_AGREEMENT_TRANSITION_OVERLAP' };
    }
  }
  return { ok: true, agreements };
};

/**
 * Phase 20N.1 Wave F — plural worker post-solve mesh agreement. EVERY
 * plan is validated against its OWN result-owned leg positionally
 * (legs[i] ↔ plans[i] in canonical joint order, never re-matched by
 * jointId): agreement recheck plus exact leg↔plan/pinned-evidence
 * metadata plus the full result-mesh gate on that leg's ACTUAL
 * checkpoints — never first-only, never flattened triples. Length
 * mismatch (missing/extra legs), order swaps, and forged citations all
 * fail closed. No tolerance changes.
 */
export interface GroupTransitionLegsMeshInput {
  plans: readonly GroupTransitionPlan[];
  legs: readonly CadGradingGroupTransitionLeg[];
  /** Per-joint member views in plan order (worker re-resolved, authoritative). */
  views: readonly (readonly GroupTransitionMemberView[])[];
  /** Authoritative joint Z per plan order (request's own member sources). */
  jointZs: readonly number[];
  liveRevision: string;
  maxSearchDistance: number;
  /** Result-owned daylight boundary: every checkpoint must occur in it. */
  daylightPoints: readonly number[];
  /** Result-owned source boundary: every source mate must occur in it. */
  sourceBoundaryPoints: readonly number[];
  /** Grading side: the plan offset must leave toward this side. */
  side: GradingSide;
}

export const validateGroupTransitionLegsMesh = (input: GroupTransitionLegsMeshInput): string | null => {
  const { plans, legs, views, jointZs, liveRevision } = input;
  if (plans.length !== legs.length || plans.length !== views.length || plans.length !== jointZs.length) {
    return 'GRADING_AGREEMENT_TRANSITION_STALE';
  }
  for (let i = 0; i < plans.length; i += 1) {
    const plan = plans[i]!;
    // Canonical one-to-one positional correspondence: the i-th leg cites
    // the i-th plan. A find-by-jointId would accept reversed/duplicated
    // legs with intact checkpoints.
    const leg = legs[i]!;
    if (!leg || leg.jointId !== plan.jointId) return 'GRADING_AGREEMENT_TRANSITION_STALE';
    const members = views[i]!;
    const agreement = checkGroupTransitionAgreement(plan, members, liveRevision);
    if (!agreement.ok) return agreement.code;
    if (leg.policyVersion !== plan.policyVersion) return 'GRADING_AGREEMENT_TRANSITION_VERSION_UNKNOWN';
    if (leg.lawKind !== plan.lawKind || leg.lawVersion !== plan.lawVersion) {
      return 'GRADING_AGREEMENT_TRANSITION_LAW_UNKNOWN';
    }
    if (leg.criterionFamily !== plan.criterionFamily || leg.criterionFamily !== agreement.family) {
      return 'GRADING_AGREEMENT_TRANSITION_FAMILY_MISMATCH';
    }
    const joint = parseCanonicalJointIndex(plan.jointId);
    if (joint === null || leg.joint !== joint) return 'GRADING_AGREEMENT_TRANSITION_MALFORMED';
    if (
      leg.width !== plan.width ||
      leg.side !== plan.side ||
      leg.memberIds[0] !== plan.memberIds[0] ||
      leg.memberIds[1] !== plan.memberIds[1] ||
      leg.jointStation !== plan.jointStation ||
      leg.recordedRevision !== plan.recordedRevision ||
      leg.interval.sL !== agreement.sL ||
      leg.interval.sR !== agreement.sR ||
      leg.endpointScalars.vL !== agreement.vL ||
      leg.endpointScalars.vR !== agreement.vR ||
      leg.endpointScalars.vL !== plan.endpointEvidence.vL ||
      leg.endpointScalars.vR !== plan.endpointEvidence.vR ||
      leg.endpointScalars.gL !== plan.endpointEvidence.gL ||
      leg.endpointScalars.gR !== plan.endpointEvidence.gR
    ) {
      return 'GRADING_AGREEMENT_TRANSITION_STALE';
    }
    if (leg.agreementCode !== null) return leg.agreementCode;
    const family = leg.criterionFamily;
    if (family !== 'distance' && family !== 'relative-elevation' && family !== 'elevation') {
      return 'GRADING_AGREEMENT_TRANSITION_FAMILY_MISMATCH';
    }
    const jointZ = jointZs[i]!;
    if (!Number.isFinite(jointZ)) return 'GRADING_AGREEMENT_TRANSITION_STALE';
    const reject = validateTransitionResultMesh({
      family,
      sL: leg.interval.sL,
      sR: leg.interval.sR,
      vL: leg.endpointScalars.vL,
      vR: leg.endpointScalars.vR,
      daylightCheckpoints: leg.daylightCheckpoints,
      sourceCheckpoints: leg.sourceCheckpoints,
      criterionL: members[0]!.criterion,
      criterionR: members[1]!.criterion,
      jointZ,
      maxSearchDistance: input.maxSearchDistance,
      daylightPoints: input.daylightPoints,
      sourceBoundaryPoints: input.sourceBoundaryPoints,
      side: input.side,
    });
    if (reject !== null) return reject;
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
