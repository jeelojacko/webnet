/**
 * Phase 20M.2 Wave D (+ shared tile kernel) — single-joint transition
 * admit-and-tile (pure, no worker/React).
 *
 * Admits ONE retained intent against live geometry/criteria, then re-tiles
 * the two incident members: natives outside `[-W/2,+W/2]` (production
 * `solveGradingChord` sub-solves, station-preserving), the legislated
 * linear scalar law inside. Also owns the shared tile kernel
 * (`MemberSolve`, `PlannedTransition`, `transitionLegOf`) imported by the
 * plural group tiler and the group compute.
 */
import { solveGradingChord } from './solveAnalyticGradingChord';
import {
  admitGradingTransition,
  evaluateTransitionLinearV1,
  transitionRejectGroupCode as transitionPolicyToGroupCode,
  transitionSourceZAt,
} from './gradingTransitionPolicy';
import type { GradingComputeSource } from './gradingComputeTypes';
import { transitionEvidenceMatchesIntent } from './gradingTransitionProvenance';
import type { PlanVector } from './gradingCourseFrame';
import type { StraightChordSolve } from './solveStraightChord';
import type { GradingCriterion, GradingSide, ResolvedGradingSource } from './gradingTypes';
import type { CadGradingGroupTransitionLeg, CadGradingTransition } from './gradingGroupTypes';
import type { GroupDiagnosticCode } from './gradingGroupTypes';
export interface MemberChord {
  source: GradingComputeSource;
  base: number;
  scale: number;
}

export interface MemberSolve {
  chords: MemberChord[];
  stitched: StraightChordSolve;
  /** Terminal-chord direction/normal/grade at each end (arc-aware). */
  tIn: PlanVector;
  tOut: PlanVector;
  nIn: PlanVector;
  nOut: PlanVector;
  gsIn: number;
  gsOut: number;
  nodeStations: number[];
}

/**
 * Narrow group context the tiling needs (structural subset of
 * `GroupSolveInput`, so the compute passes its input straight through).
 * Keeps this module importable without cycling back into the compute.
 */
export interface TransitionTileInput {
  side: GradingSide;
  revision: string;
  maxSearchDistance: number;
  closed?: boolean;
  transition?: CadGradingTransition;
  transitionMemberKeys?: string[];
}

/** Fail-closed tile failure (structurally the compute fail branch). */
export type TransitionTileFailure = {
  ok: false;
  code: GroupDiagnosticCode;
  cornerIndex?: number;
  detail?: string;
};

/** fail-closed constructor (mirrors the compute `fail` shape exactly). */
export const transitionFail = (
  code: GroupDiagnosticCode,
  cornerIndex: number | undefined,
  detail: string,
): TransitionTileFailure =>
  cornerIndex === undefined && detail === undefined
    ? { ok: false, code }
    : {
        ok: false,
        code,
        ...(cornerIndex === undefined ? {} : { cornerIndex }),
        ...(detail === undefined ? {} : { detail }),
      };

/** Admitted + tiled transition interval (C0 by shared vertex refs). */
export interface PlannedTransition {
  joint: number;
  tx: number;
  ty: number;
  /** Plan distance at the joint station (miter extent, >= 0). */
  d0: number;
  tieXyz: [number, number, number];
  runFlat: number[];
  /** Admitted law for the result-owned leg + worker recheck. */
  law: { sL: number; sR: number; vL: number; vR: number; family: 'distance' | 'relative-elevation' | 'elevation' };
  /** Flat XYZ: pCutL, V, pCutR (source mates of runFlat). */
  srcFlat: number[];
  /** Persisted joint station origin (sum of member lengths before R). */
  jointStation: number;
}

/** Interior daylight of the legislated TRANSITION_LINEAR_V1 law at scalar v. */
export const transitionDaylightAt = (
  family: 'distance' | 'relative-elevation' | 'elevation',
  v: number,
  g: number,
  Z: number,
  Px: number,
  Py: number,
  nx: number,
  ny: number,
): { x: number; y: number; z: number; d: number } => {
  const d = family === 'distance' ? v : family === 'relative-elevation' ? v / g : (v - Z) / g;
  const z = family === 'distance' ? Z + g * d : family === 'relative-elevation' ? Z + v : v;
  return { x: Px + nx * d, y: Py + ny * d, z, d };
};

export type PlannedTransitionOutcome =
  | { ok: true; plan: PlannedTransition }
  | TransitionTileFailure;

/**
 * Admit the retained intent against live geometry/criteria, then re-tile
 * the two incident members: natives outside `[-W/2,+W/2]` (production
 * `solveGradingChord` sub-solves, station-preserving), the legislated
 * linear scalar law inside. Interval endpoints are shared object refs, so
 * natives meet the transition law exactly (C0 by construction). No C1.
 */
export const planTransitionJoint = (
  input: TransitionTileInput,
  members: ResolvedGradingSource[],
  criterionAt: (_memberIndex: number) => GradingCriterion,
  solved: MemberSolve[],
  jointCount: number,
): PlannedTransitionOutcome => {
  const t = input.transition!;
  const jointed = /^joint:(\d+)$/.exec(typeof t.jointId === 'string' ? t.jointId : '');
  const joint =
    jointed !== null && jointed[1] === String(Number(jointed[1])) ? Number(jointed[1]) : null;
  if (joint === null || !(joint >= 0) || !(joint < jointCount)) {
    return transitionFail(
      'TRANSITION_MALFORMED',
      joint ?? undefined,
      'GRADING_AGREEMENT_TRANSITION_MALFORMED: jointId must be joint:<joint index>',
    );
  }
  if (input.closed === true) {
    return transitionFail(
      'TRANSITION_REJECTED',
      joint,
      'GRADING_AGREEMENT_TRANSITION_CLOSED: closed routes excluded',
    );
  }
  const keys = input.transitionMemberKeys;
  const L = joint;
  const R = joint + 1;
  const refL = Array.isArray(t.memberIds) ? t.memberIds[0] : undefined;
  const refR = Array.isArray(t.memberIds) ? t.memberIds[1] : undefined;
  if (!Array.isArray(keys) || keys.length < R + 1 || keys[L] !== refL || keys[R] !== refR) {
    return transitionFail(
      'TRANSITION_STALE',
      joint,
      'GRADING_AGREEMENT_TRANSITION_STALE: memberIds do not resolve to adjacent members',
    );
  }
  const mL = members[L]!;
  const mR = members[R]!;
  const cL = criterionAt(L);
  const cR = criterionAt(R);
  const admitted = admitGradingTransition({
    policyVersion: t.policyVersion,
    lawKind: t.lawKind,
    lawVersion: t.lawVersion,
    criterionFamily: t.criterionFamily,
    jointId: t.jointId,
    memberIds: [keys[L]!, keys[R]!],
    width: t.width,
    side: t.side,
    groupSide: input.side,
    isOpen: true,
    transitionCount: 1,
    jointZ: mL.endZ,
    members: [
      {
        memberId: keys[L]!,
        criterion: cL,
        length: mL.length,
        dirX: mL.endX - mL.startX,
        dirY: mL.endY - mL.startY,
        startZ: mL.startZ,
        endZ: mL.endZ,
        isArc: mL.isArc,
        maxSearchDistance: input.maxSearchDistance,
      },
      {
        memberId: keys[R]!,
        criterion: cR,
        length: mR.length,
        dirX: mR.endX - mR.startX,
        dirY: mR.endY - mR.startY,
        startZ: mR.startZ,
        endZ: mR.endZ,
        isArc: mR.isArc,
        maxSearchDistance: input.maxSearchDistance,
      },
    ],
  });
  if (!admitted.ok) {
    return transitionFail(
      transitionPolicyToGroupCode(admitted.code),
      joint,
      `GRADING_AGREEMENT_TRANSITION_${admitted.code}: ${admitted.detail}`,
    );
  }
  if (!transitionEvidenceMatchesIntent(t, input.revision)) {
    return transitionFail('TRANSITION_STALE', joint, 'GRADING_AGREEMENT_TRANSITION_STALE: provenance malformed');
  }
  if (t.endpoints !== undefined && (t.endpoints === null || typeof t.endpoints !== 'object' || Array.isArray(t.endpoints))) {
    return transitionFail(
      'TRANSITION_STALE',
      joint,
      'GRADING_AGREEMENT_TRANSITION_STALE: endpoint evidence malformed',
    );
  }
  if (t.endpoints !== undefined) {
    const refs = t.endpoints.refs;
    const values = t.endpoints.values;
    if (
      !Array.isArray(refs) ||
      !Array.isArray(values) ||
      refs.length !== 2 ||
      values.length !== 2 ||
      refs[0] !== keys[L] ||
      refs[1] !== keys[R] ||
      values[0] !== admitted.vL ||
      values[1] !== admitted.vR
    ) {
      return transitionFail(
        'TRANSITION_STALE',
        joint,
        'GRADING_AGREEMENT_TRANSITION_STALE: endpoint evidence mismatch',
      );
    }
  }
  const { vL, vR, sL, sR, width, family } = admitted;
  const g = (cL as { gradeRatio: number }).gradeRatio;
  // Joint Z (exact by admission). Cut Zs are the physical per-station
  // source Z on their own member half (flat reduces bitwise to Z).
  const Z = mL.endZ;
  const Lj = mL.length;
  const cutLStation = Lj - width / 2;
  const cutRStation = width / 2;
  const cutLZ = transitionSourceZAt({ startZ: mL.startZ, endZ: mL.endZ, length: Lj }, cutLStation);
  const cutRZ = transitionSourceZAt({ startZ: mR.startZ, endZ: mR.endZ, length: mR.length }, cutRStation);
  if (!Number.isFinite(cutLZ) || !Number.isFinite(cutRZ)) {
    return transitionFail(
      'TRANSITION_REJECTED',
      joint,
      'GRADING_AGREEMENT_TRANSITION_MESH: non-finite cut source Z',
    );
  }
  const frameL = solved[L]!;
  const frameR = solved[R]!;
  const tx = frameL.tOut.nx;
  const ty = frameL.tOut.ny;
  const nx = frameL.nOut.nx;
  const ny = frameL.nOut.ny;
  const vAt = (s: number): number => evaluateTransitionLinearV1(vL, vR, sL, sR, s);
  const V = { x: mL.endX, y: mL.endY, z: mL.endZ };
  const q0raw = transitionDaylightAt(family, vAt(0), g, Z, V.x, V.y, nx, ny);
  if (![q0raw.x, q0raw.y, q0raw.z, q0raw.d].every(Number.isFinite)) {
    return transitionFail(
      'TRANSITION_REJECTED',
      joint,
      'GRADING_AGREEMENT_TRANSITION_MESH: non-finite joint daylight',
    );
  }
  // Outer natives: production analytic sub-solves (station-preserving).
  // Zero-length outers (width == max) reuse the full-solve endpoint refs.
  let outerL: StraightChordSolve | null = null;
  if (cutLStation !== 0) {
    const PcL = { x: V.x - tx * (width / 2), y: V.y - ty * (width / 2), z: cutLZ };
    const sub = solveGradingChord({
      source: {
        startX: mL.startX,
        startY: mL.startY,
        endX: PcL.x,
        endY: PcL.y,
        startZ: mL.startZ,
        endZ: cutLZ,
        length: cutLStation,
        reoriented: mL.reoriented,
        isArc: false,
      },
      side: input.side,
      criterion: cL,
      maxSearchDistance: input.maxSearchDistance,
      stationBase: 0,
      stationScale: 1,
    });
    if (!sub.ok) {
      return transitionFail(
        'TRANSITION_STALE',
        joint,
        `GRADING_AGREEMENT_TRANSITION_OFF_LAW: ${sub.detail ?? 'outer native failed'}`,
      );
    }
    outerL = sub.solve;
  }
  let outerR: StraightChordSolve | null = null;
  if (mR.length - width / 2 !== 0) {
    const PcR = { x: V.x + tx * (width / 2), y: V.y + ty * (width / 2), z: cutRZ };
    const sub = solveGradingChord({
      source: {
        startX: PcR.x,
        startY: PcR.y,
        endX: mR.endX,
        endY: mR.endY,
        startZ: cutRZ,
        endZ: mR.endZ,
        length: mR.length - width / 2,
        reoriented: mR.reoriented,
        isArc: false,
      },
      side: input.side,
      criterion: cR,
      maxSearchDistance: input.maxSearchDistance,
      stationBase: cutRStation,
      stationScale: 1,
    });
    if (!sub.ok) {
      return transitionFail(
        'TRANSITION_STALE',
        joint,
        `GRADING_AGREEMENT_TRANSITION_OFF_LAW: ${sub.detail ?? 'outer native failed'}`,
      );
    }
    outerR = sub.solve;
  }
  const fullL = frameL.stitched;
  const fullR = frameR.stitched;
  const pCutL = outerL !== null ? outerL.sourcePts[outerL.sourcePts.length - 1]! : fullL.sourcePts[0]!;
  const qCutL =
    outerL !== null ? outerL.daylightPts[outerL.daylightPts.length - 1]! : fullL.daylightPts[0]!;
  const pCutR = outerR !== null ? outerR.sourcePts[0]! : fullR.sourcePts[fullR.sourcePts.length - 1]!;
  const qCutR = outerR !== null ? outerR.daylightPts[0]! : fullR.daylightPts[fullR.daylightPts.length - 1]!;
  const vPt = { x: V.x, y: V.y, z: V.z };
  const q0 = { x: q0raw.x, y: q0raw.y, z: q0raw.z };
  const flatOf = (pts: Array<{ x: number; y: number; z: number }>): number[] => {
    const flat: number[] = [];
    for (const p of pts) flat.push(p.x, p.y, p.z);
    return flat;
  };
  const stL: StraightChordSolve = {
    regions: [
      ...(outerL !== null ? outerL.regions : []),
      { classification: 'FIXED', stationSpan: [cutLStation, Lj] },
    ],
    diagnostics: [...(outerL !== null ? outerL.diagnostics : [])],
    nodeStations:
      outerL !== null
        ? [...outerL.nodeStations.slice(0, -1), cutLStation, Lj]
        : [0, Lj],
    sourcePts: outerL !== null ? [...outerL.sourcePts.slice(0, -1), pCutL, vPt] : [pCutL, vPt],
    daylightPts: outerL !== null ? [...outerL.daylightPts.slice(0, -1), qCutL, q0] : [qCutL, q0],
    daylightFlat: [],
    distances:
      outerL !== null
        ? [...outerL.distances.slice(0, -1), outerL.distances[outerL.distances.length - 1]!, q0raw.d]
        : [fullL.distances[0]!, q0raw.d],
    candidateTriangleCount: outerL !== null ? outerL.candidateTriangleCount : 0,
    intersectionSegmentCount: outerL !== null ? outerL.intersectionSegmentCount : 0,
    multipleSolutionCount: outerL !== null ? outerL.multipleSolutionCount : 0,
  };
  stL.daylightFlat = flatOf(stL.daylightPts);
  const stR: StraightChordSolve = {
    regions: [
      { classification: 'FIXED', stationSpan: [0, cutRStation] },
      ...(outerR !== null ? outerR.regions : []),
    ],
    diagnostics: [...(outerR !== null ? outerR.diagnostics : [])],
    nodeStations:
      outerR !== null ? [0, cutRStation, ...outerR.nodeStations.slice(1)] : [0, cutRStation],
    sourcePts: outerR !== null ? [vPt, pCutR, ...outerR.sourcePts.slice(1)] : [vPt, pCutR],
    daylightPts: outerR !== null ? [q0, qCutR, ...outerR.daylightPts.slice(1)] : [q0, qCutR],
    daylightFlat: [],
    distances:
      outerR !== null
        ? [q0raw.d, outerR.distances[0]!, ...outerR.distances.slice(1)]
        : [q0raw.d, fullR.distances[fullR.distances.length - 1]!],
    candidateTriangleCount: outerR !== null ? outerR.candidateTriangleCount : 0,
    intersectionSegmentCount: outerR !== null ? outerR.intersectionSegmentCount : 0,
    multipleSolutionCount: outerR !== null ? outerR.multipleSolutionCount : 0,
  };
  stR.daylightFlat = flatOf(stR.daylightPts);
  solved[L] = { ...frameL, stitched: stL, nodeStations: stL.nodeStations };
  solved[R] = { ...frameR, stitched: stR, nodeStations: stR.nodeStations };
  return {
    ok: true,
    plan: {
      joint,
      tx,
      ty,
      d0: q0raw.d,
      tieXyz: [q0.x, q0.y, q0.z],
      runFlat: [qCutL.x, qCutL.y, qCutL.z, q0.x, q0.y, q0.z, qCutR.x, qCutR.y, qCutR.z],
      law: { sL, sR, vL, vR, family },
      srcFlat: [pCutL.x, pCutL.y, pCutL.z, vPt.x, vPt.y, vPt.z, pCutR.x, pCutR.y, pCutR.z],
      jointStation: members.slice(0, R).reduce((sum, m) => sum + m.length, 0),
    },
  };
};

/**
 * Result-owned transition leg from an admitted intent + its solved tile
 * (shared by the legacy singular leg and the Wave E plural legs array;
 * key order is the 20M.2 pinned shape). Session-only, never persisted.
 */
export const transitionLegOf = (
  intent: CadGradingTransition,
  plan: PlannedTransition,
  gL: number,
  gR: number,
  revision: string,
): CadGradingGroupTransitionLeg => ({
  policyVersion: intent.policyVersion,
  lawKind: intent.lawKind,
  lawVersion: intent.lawVersion,
  width: intent.width,
  joint: plan.joint,
  jointId: intent.jointId,
  memberIds: [intent.memberIds[0]!, intent.memberIds[1]!] as [string, string],
  criterionFamily: intent.criterionFamily,
  side: intent.side,
  interval: { sL: plan.law.sL, sR: plan.law.sR },
  endpointScalars: { vL: plan.law.vL, vR: plan.law.vR, gL, gR },
  jointStation: plan.jointStation,
  recordedRevision: revision,
  agreementCode: null,
  daylightCheckpoints: [...plan.runFlat],
  sourceCheckpoints: [...plan.srcFlat],
});
