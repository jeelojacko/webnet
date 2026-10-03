/**
 * Phase 20C Wave-2A — grading-group compute engine (pure, no worker/React).
 *
 * `computeGradingGroupFromSnapshots` grades an ordered A->B member chain
 * against ONE target snapshot: each member solves through the exact Wave-1A
 * chord path standalone 20B uses (one shared target index, never rebuilt
 * per member), corners resolve through the Wave-1B corner-math module plus
 * the half-sector solver, and everything merges into ONE validated mesh.
 * Every failure is fail-closed with an honest group diagnostic; agreement
 * gates keep the strict 20B zeroDelta floor (never loosened for corners).
 */
import { zeroDelta } from '../surfaces/volume/zero';
import { seamEquals } from './arcSolve';
import type { PlanVector } from './gradingCourseFrame';
import { gradingSideNormal } from './gradingCourseFrame';
import { linearizeGradingArc } from './gradingCurve';
import type { GradingComputeSource, GradingTargetMeshSnapshot, TargetQuery } from './gradingComputeTypes';
import {
  classifyCorner,
  cutFillSideAtCorner,
} from './gradingCornerMath';
import { isZeroWidthPair } from './gradingMesh';
import {
  clipPolylineToHalfPlane,
  samePlanNode,
  type SectorLine,
  type SectorPoint,
} from './gradingGroupSectors';
import {
  crossGradeAtV,
  solveSurfaceCorner,
} from './gradingGroupSurfaceCorners';
import {
  clipTriangleToHalfPlane,
  groupMeshStats,
  joinDaylightRuns,
  mergeGroupTriangles,
  ringIsSimple,
  validateGroupMesh,
  validateMergedGroupTopology,
  shareMiterSeam,
  type MergePoint,
  type MergeTriangle,
} from './gradingGroupMerge';
import { buildTargetQuery, candidateTriangles } from './gradingTargetIndex';
import {
  assembleSolvedGradingChain,
  assembleSurfaceChain,
  type ChordSeamChord,
  type SurfaceSeamChord,
} from './gradingChordSeam';
import { solveGradingChord } from './solveAnalyticGradingChord';
import { solveAnalyticCorner } from './gradingGroupAnalyticCorners';
import {
  admitGradingTransition,
  evaluateTransitionLinearV1,
  type TransitionRejectCode,
} from './gradingTransitionPolicy';
import { solveHybridCorner } from './gradingGroupHybridCorners';
import { groupTerminationMode } from './gradingGroupTermination';
import { buildGradingTopologyCertificateExact, countPositiveWidthRegions } from './gradingTopologyCertificate';
import { deriveGradingTopologyExpectation } from './gradingTopologyExpectation';
import { solveStraightChord, type StraightChordSolve } from './solveStraightChord';
import { tryExactOffsetGroup } from './gradingGroupExactOffset';
import { gradingTerminationDomain, isTargetFreeCriterion } from './gradingTypes';
import type {
  GradingCriterion,
  GradingSide,
  ResolvedGradingSource,
} from './gradingTypes';
import type {
  CadGradingGroupResult,
  CadGradingTransition,
  GroupCornerClassification,
  GroupCornerResult,
  GroupDiagnostic,
  GroupDiagnosticCode,
  GroupMemberRegion,
} from './gradingGroupTypes';

export interface GroupSolveInput {
  groupId: string;
  revision: string;
  /** Ordered persisted traversal, A->B oriented. */
  members: ResolvedGradingSource[];
  side: GradingSide;
  criterion: GradingCriterion;
  /**
   * Phase 20E: effective criterion per member in traversal order
   * (override or group default). Absent/short = legacy shared criterion.
   */
  memberCriteria?: GradingCriterion[];
  maxSearchDistance: number;
  curveChordTolerance: number;
  closed: boolean;
  /** Target TIN snapshot; required for surface criteria, absent for analytic. */
  target?: GradingTargetMeshSnapshot;
  /**
   * Phase 20M.2 Wave D — single retained transition intent (absent = exact
   * legacy path). Admitted via `admitGradingTransition` against live member
   * geometry/criteria; any reject fails closed. Cardinality (>1) is decided
   * before the call via `selectGroupTransition`.
   */
  transition?: CadGradingTransition;
  /**
   * Stable member identity per member in traversal order
   * (`courseCriterionKey`); required when `transition` is present (refs
   * verify against these, never against positional indices alone).
   */
  transitionMemberKeys?: string[];
}

export type GradingGroupComputeOutcome =
  | { ok: true; result: CadGradingGroupResult }
  | { ok: false; code: GroupDiagnosticCode; cornerIndex?: number; detail?: string };

interface MemberChord {
  source: GradingComputeSource;
  base: number;
  scale: number;
}

interface MemberSolve {
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
 * Maximal non-tied runs across the whole member chain (pre-merge topology
 * expectation for an open group). Each member drops its final station except
 * the last, exactly like the assembled source boundary, so source/daylight
 * stay index-aligned.
 */
const countGroupPositiveWidthRegions = (members: ReadonlyArray<MemberSolve>): number => {
  const src: Array<{ x: number; y: number; z: number }> = [];
  const dst: Array<{ x: number; y: number; z: number }> = [];
  members.forEach((member, index) => {
    const sp = member.stitched.sourcePts;
    const dp = member.stitched.daylightPts;
    const upto = index === members.length - 1 ? sp.length : Math.max(0, sp.length - 1);
    for (let i = 0; i < upto; i += 1) {
      src.push(sp[i]!);
      dst.push(dp[i]!);
    }
  });
  return countPositiveWidthRegions(src, dst);
};

const exactXyz = (a: ResolvedGradingSource, b: ResolvedGradingSource): boolean =>
  a.endX === b.startX && a.endY === b.startY && a.endZ === b.startZ;

const chordDir = (source: GradingComputeSource): PlanVector | null => {
  const dx = source.endX - source.startX;
  const dy = source.endY - source.startY;
  const len = Math.hypot(dx, dy);
  if (!(len > 0) || !Number.isFinite(len)) return null;
  return { nx: dx / len, ny: dy / len };
};

/** Linearize one member exactly like the 20B arc path (straights: 1 chord). */
const linearizeMember = (
  member: ResolvedGradingSource,
  tolerance: number,
): MemberChord[] | null => {
  const base: GradingComputeSource = { ...member };
  if (!member.isArc || !member.arc) return [{ source: { ...base, isArc: false }, base: 0, scale: 1 }];
  if (!Number.isFinite(tolerance) || !(tolerance > 0)) return null;
  const linearized = linearizeGradingArc(
    member.arc.centerX, member.arc.centerY, member.arc.radius,
    member.arc.startAngle, member.arc.endAngle, member.arc.sweepCCW,
    member.startZ, member.endZ, tolerance,
  );
  if (!linearized) return null;
  const segArc = member.length / linearized.subdivisions;
  const chords: MemberChord[] = [];
  for (let k = 0; k < linearized.subdivisions; k += 1) {
    const p0 = linearized.points[k]!;
    const p1 = linearized.points[k + 1]!;
    const chordLen = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    if (!(chordLen > 0) || !Number.isFinite(chordLen)) return null;
    chords.push({
      source: {
        startX: p0.x, startY: p0.y, endX: p1.x, endY: p1.y,
        startZ: p0.z, endZ: p1.z, length: chordLen,
        reoriented: member.reoriented, isArc: false,
      },
      base: k * segArc,
      scale: segArc / chordLen,
    });
  }
  return chords;
};

/** Stitch chord solves in order (the 20B arc seam convention). */
const stitchChords = (solves: StraightChordSolve[]): StraightChordSolve => {
  const out: StraightChordSolve = {
    regions: [], diagnostics: [], nodeStations: [],
    sourcePts: [], daylightPts: [], daylightFlat: [],
    distances: [], candidateTriangleCount: 0,
    intersectionSegmentCount: 0, multipleSolutionCount: 0,
  };
  for (const chord of solves) {
    let skipFirst = 0;
    if (
      out.sourcePts.length > 0 &&
      seamEquals(out.sourcePts[out.sourcePts.length - 1]!, chord.sourcePts[0]!) &&
      seamEquals(out.daylightPts[out.daylightPts.length - 1]!, chord.daylightPts[0]!)
    ) {
      skipFirst = 1;
    }
    out.regions.push(...chord.regions);
    out.diagnostics.push(...chord.diagnostics);
    for (let i = skipFirst; i < chord.sourcePts.length; i += 1) {
      out.sourcePts.push(chord.sourcePts[i]!);
      out.daylightPts.push(chord.daylightPts[i]!);
      out.distances.push(chord.distances[i]!);
      out.nodeStations.push(chord.nodeStations[i]!);
    }
    for (let i = skipFirst * 3; i < chord.daylightFlat.length; i += 1) out.daylightFlat.push(chord.daylightFlat[i]!);
    out.candidateTriangleCount += chord.candidateTriangleCount;
    out.intersectionSegmentCount += chord.intersectionSegmentCount;
    out.multipleSolutionCount += chord.multipleSolutionCount;
  }
  return out;
};

const fail = (code: GroupDiagnosticCode, cornerIndex?: number, detail?: string): GradingGroupComputeOutcome =>
  cornerIndex === undefined && detail === undefined
    ? { ok: false, code }
    : { ok: false, code, ...(cornerIndex === undefined ? {} : { cornerIndex }), ...(detail === undefined ? {} : { detail }) };

/** Cut/fill source lengths sampled at member stations (20B sign convention). */
const splitMemberCutFill = (
  sourcePts: Array<{ x: number; y: number; z: number }>,
  nodeStations: number[],
  query: TargetQuery,
): { cut: number; fill: number; tied: number } => {
  let cut = 0;
  let fill = 0;
  let tied = 0;
  for (let i = 0; i + 1 < sourcePts.length; i += 1) {
    const width = Math.max(0, nodeStations[i + 1]! - nodeStations[i]!);
    if (!(width > 0)) continue;
    const pa = sourcePts[i]!;
    const pb = sourcePts[i + 1]!;
    const za = query.elevationAt(pa.x, pa.y);
    const zb = query.elevationAt(pb.x, pb.y);
    if (za === null || zb === null) continue;
    const da = za - pa.z;
    const db = zb - pb.z;
    const aZero = Math.abs(da) <= zeroDelta(da, 0);
    const bZero = Math.abs(db) <= zeroDelta(db, 0);
    if (aZero && bZero) tied += width;
    else if (!aZero && !bZero && (da > 0) === (db > 0)) {
      if (da > 0) cut += width;
      else fill += width;
    } else {
      const t = Math.abs(da - db) <= zeroDelta(da, db) ? 0.5 : Math.abs(da) / (Math.abs(da) + Math.abs(db));
      if (da > 0) { cut += width * t; fill += width * (1 - t); }
      else if (da < 0) { fill += width * t; cut += width * (1 - t); }
      else { tied += width * t; if (db > 0) cut += width * (1 - t); else fill += width * (1 - t); }
    }
  }
  return { cut, fill, tied };
};

/**
 * Phase 20M.2 Wave D — transition selection over retained intents.
 *
 * Absent/empty (or only structurally non-object entries) = exact legacy
 * path. Exactly one object = the candidate. More than one = CARDINALITY
 * reject under `trp1` (fail closed, never a silent pick). Content validity
 * (malformed/stale/inadmissible) is decided at admission, not here.
 */
export type TransitionSelection =
  | { kind: 'absent' }
  | { kind: 'single'; transition: CadGradingTransition }
  | { kind: 'rejected'; code: GroupDiagnosticCode; detail: string };

export const selectGroupTransition = (transitions: unknown): TransitionSelection => {
  if (transitions === undefined) return { kind: 'absent' };
  if (!Array.isArray(transitions)) return { kind: 'absent' };
  const intents = transitions.filter(
    (entry): entry is CadGradingTransition => entry !== null && typeof entry === 'object',
  );
  if (intents.length === 0) return { kind: 'absent' };
  if (intents.length > 1) {
    return {
      kind: 'rejected',
      code: 'TRANSITION_REJECTED',
      detail: 'GRADING_AGREEMENT_TRANSITION_CARDINALITY',
    };
  }
  return { kind: 'single', transition: intents[0]! };
};

/** Policy reject → bounded group diagnostic (fail closed, never fallback). */
const transitionPolicyToGroupCode = (code: TransitionRejectCode): GroupDiagnosticCode => {
  if (code === 'MALFORMED') return 'TRANSITION_MALFORMED';
  if (code === 'VERSION_UNKNOWN' || code === 'LAW_UNKNOWN') return 'TRANSITION_LAW_UNKNOWN';
  if (code === 'MEMBER_REF_STALE' || code === 'NATIVE_CRITERION' || code === 'MAX_SEARCH') {
    return 'TRANSITION_STALE';
  }
  return 'TRANSITION_REJECTED';
};

/** Admitted + tiled transition interval (C0 by shared vertex refs). */
interface PlannedTransition {
  joint: number;
  tx: number;
  ty: number;
  /** Plan distance at the joint station (miter extent, >= 0). */
  d0: number;
  tieXyz: [number, number, number];
  runFlat: number[];
}

/** Interior daylight of the legislated TRANSITION_LINEAR_V1 law at scalar v. */
const transitionDaylightAt = (
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

type PlannedTransitionOutcome =
  | { ok: true; plan: PlannedTransition }
  | Extract<GradingGroupComputeOutcome, { ok: false }>;

/** fail-closed constructor with a narrow type (fail() never returns ok:true). */
const transitionFail = (
  code: GroupDiagnosticCode,
  cornerIndex: number | undefined,
  detail: string,
): Extract<GradingGroupComputeOutcome, { ok: false }> =>
  fail(code, cornerIndex, detail) as Extract<GradingGroupComputeOutcome, { ok: false }>;

/**
 * Admit the retained intent against live geometry/criteria, then re-tile
 * the two incident members: natives outside `[-W/2,+W/2]` (production
 * `solveGradingChord` sub-solves, station-preserving), the legislated
 * linear scalar law inside. Interval endpoints are shared object refs, so
 * natives meet the transition law exactly (C0 by construction). No C1.
 */
const planTransitionJoint = (
  input: GroupSolveInput,
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
  if (t.provenance?.revision !== undefined && t.provenance.revision !== input.revision) {
    return transitionFail(
      'TRANSITION_STALE',
      joint,
      'GRADING_AGREEMENT_TRANSITION_STALE: recorded revision mismatch',
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
  const Z = mL.endZ;
  const frameL = solved[L]!;
  const frameR = solved[R]!;
  const tx = frameL.tOut.nx;
  const ty = frameL.tOut.ny;
  const nx = frameL.nOut.nx;
  const ny = frameL.nOut.ny;
  const Lj = mL.length;
  const cutLStation = Lj - width / 2;
  const cutRStation = width / 2;
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
    const PcL = { x: V.x - tx * (width / 2), y: V.y - ty * (width / 2), z: Z };
    const sub = solveGradingChord({
      source: {
        startX: mL.startX,
        startY: mL.startY,
        endX: PcL.x,
        endY: PcL.y,
        startZ: Z,
        endZ: Z,
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
    const PcR = { x: V.x + tx * (width / 2), y: V.y + ty * (width / 2), z: Z };
    const sub = solveGradingChord({
      source: {
        startX: PcR.x,
        startY: PcR.y,
        endX: mR.endX,
        endY: mR.endY,
        startZ: Z,
        endZ: Z,
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
    },
  };
};

/**
 * Grade an ordered member chain against one target snapshot (pure engine).
 * Member strips ARE standalone chord solves; corners add planar patches
 * (gap) or trim to the analytic miter seam (overlap); the merged mesh must
 * pass the normal explicit-TIN validator.
 */
export const computeGradingGroupFromSnapshots = (input: GroupSolveInput): GradingGroupComputeOutcome => {
  const { groupId, revision, members, side, criterion, maxSearchDistance, curveChordTolerance, closed, target } = input;
  /** Phase 20E: per-member effective criterion (sparse override or default). */
  const criterionAt = (memberIndex: number): GradingCriterion =>
    input.memberCriteria?.[memberIndex] ?? criterion;
  if (members.length < 1) return fail('MEMBER_NO_SOLUTION', undefined, 'GRADING_GROUP_EMPTY');
  if (closed && members.length < 3) return fail('MEMBER_NO_SOLUTION', undefined, 'GRADING_GROUP_CLOSED_TOO_SHORT');
  if (!(maxSearchDistance > 0) || !Number.isFinite(maxSearchDistance)) {
    return fail('MEMBER_NO_SOLUTION', undefined, 'GRADING_BAD_SEARCH_DISTANCE');
  }
  // Phase 20J Wave B: the termination MODE derives from the effective
  // criteria (surface-only, analytic-only, or hybrid). Hybrid joints solve
  // through the exact-common-tie helper below; malformed states still fail
  // closed at their own gates (never a half-solved mesh).
  const effectiveCriteria = members.map((_, mi) => criterionAt(mi));
  const terminationMode = groupTerminationMode(criterion, effectiveCriteria);
  const jointCount = closed ? members.length : members.length - 1;
  for (let j = 0; j < jointCount; j += 1) {
    if (!exactXyz(members[j]!, members[(j + 1) % members.length]!)) {
      return fail('CORNER_INVERTED', j, 'GRADING_GROUP_CORNER_MISMATCH');
    }
  }
  // Phase 20L.2: exact-offset fast path — plausible open curved analytic
  // groups only. EXACT returns; FALLBACK falls through to the chord path
  // semantically unchanged below (never ok:false). Closed-with-arc and
  // line-only groups stay on the chord path without an attempt, as do
  // single-member groups: with no joint there is no offset join to solve
  // exactly, and the pinned single-arc chord oracles (20f §H, 20g §K) stay
  // on their studied path.
  if (!closed && members.length > 1 && members.some((m) => m.isArc)) {
    const attempt = tryExactOffsetGroup({
      groupId, revision, members, side, criterion, maxSearchDistance, curveChordTolerance,
      ...(input.memberCriteria !== undefined ? { memberCriteria: input.memberCriteria } : {}),
    });
    if (attempt.kind === 'exact') return { ok: true, result: attempt.result };
  }
  // Surface and hybrid members share ONE target index; all-analytic
  // families carry no target (mode branch: hybrid always queries).
  const needsSurface = terminationMode !== 'analytic';
  const query = needsSurface ? (target === undefined ? null : buildTargetQuery(target)) : null;
  if (needsSurface && !query) return fail('MEMBER_NO_SOLUTION', undefined, 'GRADING_BAD_TARGET_MESH');
  let candidates: number[] = [];
  if (needsSurface) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const m of members) {
      minX = Math.min(minX, m.startX, m.endX);
      minY = Math.min(minY, m.startY, m.endY);
      maxX = Math.max(maxX, m.startX, m.endX);
      maxY = Math.max(maxY, m.startY, m.endY);
    }
    const built = candidateTriangles(target!, [
      { x: minX - maxSearchDistance, y: minY - maxSearchDistance },
      { x: maxX + maxSearchDistance, y: minY - maxSearchDistance },
      { x: maxX + maxSearchDistance, y: maxY + maxSearchDistance },
      { x: minX - maxSearchDistance, y: maxY + maxSearchDistance },
    ]);
    if (!built) return fail('MEMBER_NO_SOLUTION', undefined, 'GRADING_BAD_TARGET_MESH');
    candidates = built;
  }

  // Member strips: the exact standalone chord path, sharing one query.
  const solved: MemberSolve[] = [];
  let curved = false;
  for (let mi = 0; mi < members.length; mi += 1) {
    const member = members[mi]!;
    if (member.isArc) curved = true;
    const chords = linearizeMember(member, curveChordTolerance);
    if (!chords) return fail('MEMBER_NO_SOLUTION', undefined, 'GRADING_ARC_LINEARIZE');
    const chordSolves: StraightChordSolve[] = [];
    for (const chord of chords) {
      // Phase 20F: target-free members solve analytically; the dispatcher
      // keeps the exact straight-chord path for surface criteria.
      const out = isTargetFreeCriterion(criterionAt(mi))
        ? solveGradingChord({
          source: chord.source, side, criterion: criterionAt(mi), maxSearchDistance,
          ...(target !== undefined ? { target } : {}),
          ...(query !== null ? { query } : {}),
          stationBase: chord.base, stationScale: chord.scale,
        })
        : solveStraightChord({
          source: chord.source, side, criterion: criterionAt(mi), maxSearchDistance,
          target: target!, query: query!, stationBase: chord.base, stationScale: chord.scale,
        });
      if (!out.ok) {
        // Honest R1 path: strict-gate daylight failures fail the member closed.
        return fail(out.code === 'TARGET_GAP' ? 'MEMBER_TARGET_GAP' : 'MEMBER_NO_SOLUTION', undefined, out.detail);
      }
      chordSolves.push(out.solve);
    }
    // Phase 20K.1 Wave C1: curved analytic members stitch internal chord
    // seams through the shared assembly (exact V, analytic tie); every
    // other member keeps the exact standalone stitch byte-identical.
    let stitched: StraightChordSolve;
    if (member.isArc && isTargetFreeCriterion(criterionAt(mi))) {
      const seamChords: ChordSeamChord[] = [];
      for (let ci = 0; ci < chords.length; ci += 1) {
        const chord = chords[ci]!;
        const solve = chordSolves[ci]!;
        const t = chordDir(chord.source);
        const n = t ? gradingSideNormal(t.nx, t.ny, side) : null;
        if (!t || !n) return fail('MEMBER_NO_SOLUTION', undefined, 'GRADING_DEGENERATE_SOURCE');
        seamChords.push({
          t, n,
          gs: (chord.source.endZ - chord.source.startZ) / chord.source.length,
          criterion: criterionAt(mi),
          source: [
            { x: chord.source.startX, y: chord.source.startY, z: chord.source.startZ },
            { x: chord.source.endX, y: chord.source.endY, z: chord.source.endZ },
          ],
          daylight: [{ ...solve.daylightPts[0]! }, { ...solve.daylightPts[solve.daylightPts.length - 1]! }],
          nodeStations: [solve.nodeStations[0]!, solve.nodeStations[solve.nodeStations.length - 1]!],
          distances: [solve.distances[0]!, solve.distances[solve.distances.length - 1]!],
        });
      }
      const assembled = assembleSolvedGradingChain(seamChords, maxSearchDistance, side);
      if (!assembled.ok) return fail('MEMBER_NO_SOLUTION', undefined, assembled.detail);
      // Joint canonicalization: member ends are bitwise-shared across the
      // joint (exactXyz gate above) while linearized arc endpoints differ
      // by ulps per arc. Snap the boundary source vertices to the member
      // ends so both sides + the corner patch share one index; internal
      // stations keep their exact linearized samples.
      const canonFirst = { x: member.startX, y: member.startY, z: member.startZ };
      const canonLast = { x: member.endX, y: member.endY, z: member.endZ };
      assembled.value.sourcePts[0] = { ...canonFirst };
      assembled.value.sourcePts[assembled.value.sourcePts.length - 1] = { ...canonLast };
      const daylightFlat: number[] = [];
      for (const p of assembled.value.daylightPts) daylightFlat.push(p.x, p.y, p.z);
      const regions: StraightChordSolve['regions'] = [];
      const diagnostics: StraightChordSolve['diagnostics'] = [];
      let candidateTriangleCount = 0;
      let intersectionSegmentCount = 0;
      let multipleSolutionCount = 0;
      for (const solve of chordSolves) {
        regions.push(...solve.regions);
        diagnostics.push(...solve.diagnostics);
        candidateTriangleCount += solve.candidateTriangleCount;
        intersectionSegmentCount += solve.intersectionSegmentCount;
        multipleSolutionCount += solve.multipleSolutionCount;
      }
      stitched = {
        regions, diagnostics,
        nodeStations: assembled.value.nodeStations,
        sourcePts: assembled.value.sourcePts,
        daylightPts: assembled.value.daylightPts,
        daylightFlat,
        distances: assembled.value.distances,
        candidateTriangleCount, intersectionSegmentCount, multipleSolutionCount,
      };
    } else if (member.isArc && !isTargetFreeCriterion(criterionAt(mi))) {
      // Phase 20K.1 Wave C2: curved Surface members stitch internal chord
      // seams through the shared Surface assembly (active-grade planes,
      // miter tie, sector paths); every other member keeps the exact
      // standalone stitch byte-identical.
      if (!query) return fail('MEMBER_NO_SOLUTION', undefined, 'GRADING_BAD_TARGET_MESH');
      const seamChords: SurfaceSeamChord[] = [];
      for (let ci = 0; ci < chords.length; ci += 1) {
        const chord = chords[ci]!;
        const solve = chordSolves[ci]!;
        const t = chordDir(chord.source);
        const n = t ? gradingSideNormal(t.nx, t.ny, side) : null;
        if (!t || !n) return fail('MEMBER_NO_SOLUTION', undefined, 'GRADING_DEGENERATE_SOURCE');
        seamChords.push({
          t, n,
          gs: (chord.source.endZ - chord.source.startZ) / chord.source.length,
          chord: chord.source,
          solve,
        });
      }
      const assembled = assembleSurfaceChain(seamChords, {
        side, criterion: criterionAt(mi), maxSearchDistance,
        target: target!, candidates, query,
      });
      if (!assembled.ok) return fail('MEMBER_NO_SOLUTION', undefined, assembled.detail);
      // Joint canonicalization (same convention as the analytic path).
      const canonFirst = { x: member.startX, y: member.startY, z: member.startZ };
      const canonLast = { x: member.endX, y: member.endY, z: member.endZ };
      assembled.value.sourcePts[0] = { ...canonFirst };
      assembled.value.sourcePts[assembled.value.sourcePts.length - 1] = { ...canonLast };
      const daylightFlat: number[] = [];
      for (const p of assembled.value.daylightPts) daylightFlat.push(p.x, p.y, p.z);
      const regions: StraightChordSolve['regions'] = [];
      const diagnostics: StraightChordSolve['diagnostics'] = [];
      let candidateTriangleCount = 0;
      let intersectionSegmentCount = 0;
      let multipleSolutionCount = 0;
      for (const solve of chordSolves) {
        regions.push(...solve.regions);
        diagnostics.push(...solve.diagnostics);
        candidateTriangleCount += solve.candidateTriangleCount;
        intersectionSegmentCount += solve.intersectionSegmentCount;
        multipleSolutionCount += solve.multipleSolutionCount;
      }
      intersectionSegmentCount += assembled.value.ties.length;
      stitched = {
        regions, diagnostics,
        nodeStations: assembled.value.nodeStations,
        sourcePts: assembled.value.sourcePts,
        daylightPts: assembled.value.daylightPts,
        daylightFlat,
        distances: assembled.value.distances,
        candidateTriangleCount, intersectionSegmentCount, multipleSolutionCount,
      };
    } else {
      stitched = stitchChords(chordSolves);
      // Straight members carry the same joint-vertex rounding as arcs (the
      // chord solve re-derives each endpoint as start + t·length). Snap the
      // boundary source endpoints to the exact member geometry so adjacent
      // members + the corner patch share one bit-identical index; otherwise
      // a rotated GAP joint carries ULP twins -> degree-4 boundary pinch.
      stitched.sourcePts[0] = { x: member.startX, y: member.startY, z: member.startZ };
      stitched.sourcePts[stitched.sourcePts.length - 1] = { x: member.endX, y: member.endY, z: member.endZ };
    }
    const tIn = chordDir(chords[0]!.source);
    const tOut = chordDir(chords[chords.length - 1]!.source);
    if (!tIn || !tOut) return fail('MEMBER_NO_SOLUTION', undefined, 'GRADING_DEGENERATE_SOURCE');
    const nIn = gradingSideNormal(tIn.nx, tIn.ny, side);
    const nOut = gradingSideNormal(tOut.nx, tOut.ny, side);
    if (!nIn || !nOut) return fail('MEMBER_NO_SOLUTION', undefined, 'GRADING_BAD_SIDE');
    const gs = (chord: MemberChord): number => (chord.source.endZ - chord.source.startZ) / chord.source.length;
    solved.push({
      chords, stitched, tIn, tOut, nIn, nOut,
      gsIn: gs(chords[0]!), gsOut: gs(chords[chords.length - 1]!),
      nodeStations: stitched.nodeStations,
    });
  }
  // Phase 20M.2 Wave D: transition admission + interval surgery. Natives
  // outside [-W/2,+W/2] stay production solves; the interval is re-tiled by
  // the legislated TRANSITION_LINEAR_V1 law. Any reject fails closed.
  let transitionPlan: PlannedTransition | null = null;
  if (input.transition !== undefined) {
    const planned = planTransitionJoint(input, members, criterionAt, solved, jointCount);
    if (!planned.ok) return planned;
    transitionPlan = planned.plan;
  }

  // Per-member triangle soup + daylight runs (trimmed below near overlaps).
  const memberTris: MergeTriangle[][] = solved.map((s) => {
    const tris: MergeTriangle[] = [];
    const src = s.stitched.sourcePts;
    const dst = s.stitched.daylightPts;
    for (let i = 0; i + 1 < src.length; i += 1) {
      const a = src[i]!;
      const b = src[i + 1]!;
      const c = dst[i + 1]!;
      const d = dst[i]!;
      if (isZeroWidthPair(a, d) && isZeroWidthPair(b, c)) continue;
      tris.push({ a, b, c }, { a, b: c, c: d });
    }
    return tris;
  });
  const memberDaylight: MergePoint[][] = solved.map((s) => s.stitched.daylightPts.map((p) => ({ ...p })));
  const corners: GroupCornerResult[] = [];
  const patchTris: MergeTriangle[] = [];
  const memberRegions: GroupMemberRegion[] = [];
  solved.forEach((s, mi) => {
    for (const region of s.stitched.regions) {
      memberRegions.push({ memberIndex: mi, classification: region.classification, stationSpan: region.stationSpan });
    }
  });
  let intersectionSegments = 0;
  let multipleSolutions = 0;
  const diagnostics: GroupDiagnostic[] = [];
  if (curved) diagnostics.push({ code: 'CURVE_CORNER_APPROXIMATED' });

  // Interior joints (every joint when closed).
  for (let j = 0; j < jointCount; j += 1) {
    const inIdx = j;
    const outIdx = (j + 1) % members.length;
    // Phase 20M.2 Wave D: the transitioned joint is already tiled (C0 by
    // shared refs); record its TANGENT corner and never re-patch it.
    if (transitionPlan !== null && j === transitionPlan.joint) {
      corners.push({
        cornerIndex: j,
        vertexId: `joint:${j}`,
        classification: 'TANGENT',
        miterRay: { mx: transitionPlan.tx, my: transitionPlan.ty },
        miterExtent: transitionPlan.d0,
        tiePointXyz: transitionPlan.tieXyz,
        daylightPoints: transitionPlan.runFlat,
        diagnostics: [],
      });
      continue;
    }
    const incoming = solved[inIdx]!;
    const outgoing = solved[outIdx]!;
    const vMember = members[inIdx]!;
    const vx = vMember.endX;
    const vy = vMember.endY;
    const vz = vMember.endZ;
    const turn = classifyCorner(incoming.tOut, outgoing.tIn, side);
    if (!turn) return fail('CORNER_INVERTED', j, 'GRADING_CORNER_DEGENERATE');
    // Phase 20J Wave B: per-joint dispatch on the EFFECTIVE member domains.
    // S↔S keeps the surface path byte-identical, A↔A keeps the analytic
    // path byte-identical, and S↔A/A↔S joints resolve through the hybrid
    // exact-common-tie helper (hybrid groups always carry a target query).
    const inDom = gradingTerminationDomain(criterionAt(inIdx));
    const outDom = gradingTerminationDomain(criterionAt(outIdx));
    const analyticJoint = inDom === 'analytic' && outDom === 'analytic';
    if (inDom !== outDom) {
      if (!query) return fail('CORNER_NO_SOLUTION', j, 'GRADING_SURFACE_ANALYTIC_LINE');
      const surfaceIncoming = inDom === 'surface';
      const qsStitched = surfaceIncoming
        ? incoming.stitched.daylightPts[incoming.stitched.daylightPts.length - 1]!
        : outgoing.stitched.daylightPts[0]!;
      const qaStitched = surfaceIncoming
        ? outgoing.stitched.daylightPts[0]!
        : incoming.stitched.daylightPts[incoming.stitched.daylightPts.length - 1]!;
      const hybrid = solveHybridCorner({
        vx, vy, vz,
        inT: incoming.tOut, inN: incoming.nOut, inGs: incoming.gsOut,
        outT: outgoing.tIn, outN: outgoing.nIn, outGs: outgoing.gsIn,
        side, inCriterion: criterionAt(inIdx), outCriterion: criterionAt(outIdx),
        query, target: target!, candidates, maxSearchDistance,
        qs: { x: qsStitched.x, y: qsStitched.y, z: qsStitched.z },
        qa: { x: qaStitched.x, y: qaStitched.y, z: qaStitched.z },
        inIsArc: members[inIdx]!.isArc, outIsArc: members[outIdx]!.isArc,
        inStrip: memberTris[inIdx]!, outStrip: memberTris[outIdx]!,
        inDaylight: memberDaylight[inIdx]!, outDaylight: memberDaylight[outIdx]!,
        midIn: { x: (members[inIdx]!.startX + vx) / 2, y: (members[inIdx]!.startY + vy) / 2 },
        midOut: { x: (vx + members[outIdx]!.endX) / 2, y: (vy + members[outIdx]!.endY) / 2 },
      });
      if (!hybrid.ok) return fail(hybrid.code, j, hybrid.detail);
      if (hybrid.classification === 'GAP') {
        patchTris.push(...hybrid.patchTris);
      } else {
        memberTris[inIdx] = hybrid.inTris;
        memberTris[outIdx] = hybrid.outTris;
        memberDaylight[inIdx] = hybrid.inDaylight;
        memberDaylight[outIdx] = hybrid.outDaylight;
      }
      multipleSolutions += Math.max(0, hybrid.rootCount - 1);
      intersectionSegments += 1;
      const hybridRunFlat: number[] = [];
      for (const p of hybrid.cornerRun) hybridRunFlat.push(p.x, p.y, p.z);
      corners.push({
        cornerIndex: j,
        vertexId: `joint:${j}`,
        classification: hybrid.classification,
        miterRay: { mx: hybrid.ray.mx, my: hybrid.ray.my },
        miterExtent: hybrid.extent,
        tiePointXyz: [hybrid.tie.x, hybrid.tie.y, hybrid.tie.z],
        daylightPoints: hybridRunFlat,
        diagnostics: [],
      });
      const hybridIncomingRun = memberDaylight[inIdx]!;
      const hybridJoint = joinDaylightRuns([hybridIncomingRun.slice(-1), hybrid.cornerRun]);
      memberDaylight[inIdx] = [...hybridIncomingRun.slice(0, -1), ...hybridJoint];
      continue;
    }
    // Analytic↔analytic joints always take the analytic corner solver
    // (target-free), even inside a hybrid group; surface↔surface joints
    // fall through to the surface path below.
    if (analyticJoint) {
      const analytic = solveAnalyticCorner({
        vx, vy, vz,
        inT: incoming.tOut, inN: incoming.nOut, inGs: incoming.gsOut,
        outT: outgoing.tIn, outN: outgoing.nIn, outGs: outgoing.gsIn,
        inCriterion: criterionAt(inIdx), outCriterion: criterionAt(outIdx),
        maxSearchDistance,
      });
      if (!analytic.ok) return fail('CORNER_NO_SOLUTION', j, analytic.detail);
      const classification = turn as GroupCornerClassification;
      if (analytic.kind === 'coincident') {
        corners.push({ cornerIndex: j, vertexId: `joint:${j}`, classification, diagnostics: [] });
        continue;
      }
      const tie = analytic.tie;
      const q1 = incoming.stitched.daylightPts[incoming.stitched.daylightPts.length - 1]!;
      const q2 = outgoing.stitched.daylightPts[0]!;
      let cornerRun: MergePoint[];
      if (classification === 'GAP') {
        // Outside turn: fan the corner wedge from V across the limit tie on
        // the two exact grading planes (never a vertical wall).
        const ring: MergePoint[] = [
          { x: q1.x, y: q1.y, z: q1.z },
          { x: tie.x, y: tie.y, z: tie.z },
          { x: q2.x, y: q2.y, z: q2.z },
        ];
        const v: MergePoint = { x: vx, y: vy, z: vz };
        for (let k = 0; k + 1 < ring.length; k += 1) {
          const tri: MergeTriangle = { a: v, b: ring[k]!, c: ring[k + 1]! };
          const area2 = (tri.b.x - tri.a.x) * (tri.c.y - tri.a.y) - (tri.c.x - tri.a.x) * (tri.b.y - tri.a.y);
          if (Math.abs(area2) <= zeroDelta(area2, 0)) continue;
          patchTris.push(tri);
        }
        cornerRun = ring;
      } else {
        // Inside turn: trim both member strips + limit polylines to the miter
        // line V–tie so the overlap is tiled exactly once.
        const span = Math.hypot(tie.x - vx, tie.y - vy);
        if (!(span > 0)) return fail('CORNER_NO_SOLUTION', j, 'GRADING_ANALYTIC_CORNER_DEGENERATE');
        const miterLine: SectorLine = { vx, vy, mx: (tie.x - vx) / span, my: (tie.y - vy) / span };
        const midIn: SectorPoint = {
          x: (members[inIdx]!.startX + vx) / 2,
          y: (members[inIdx]!.startY + vy) / 2,
        };
        const midOut: SectorPoint = {
          x: (vx + members[outIdx]!.endX) / 2,
          y: (vy + members[outIdx]!.endY) / 2,
        };
        const trimTriangles = (tris: MergeTriangle[], keep: SectorPoint): MergeTriangle[] => {
          const out: MergeTriangle[] = [];
          for (const t of tris) out.push(...clipTriangleToHalfPlane(t, miterLine, keep));
          return out;
        };
        memberTris[inIdx] = trimTriangles(memberTris[inIdx]!, midIn);
        memberTris[outIdx] = trimTriangles(memberTris[outIdx]!, midOut);
        // Phase 20K.3 Wave B: the two independent trims discretize the same
        // miter seam with different stations (doubled seam = PINCH). Share
        // the union station set so the seam turns interior; areas, ties,
        // and corner provenance are untouched (collinear splits only).
        const shared = shareMiterSeam(memberTris[inIdx]!, memberTris[outIdx]!, miterLine);
        memberTris[inIdx] = shared.inTris;
        memberTris[outIdx] = shared.outTris;
        memberDaylight[inIdx] = clipPolylineToHalfPlane(memberDaylight[inIdx]!, miterLine, midIn);
        memberDaylight[outIdx] = clipPolylineToHalfPlane(memberDaylight[outIdx]!, miterLine, midOut);
        if (memberDaylight[inIdx]!.length === 0 || memberDaylight[outIdx]!.length === 0) {
          return fail('CORNER_NO_SOLUTION', j, 'GRADING_ANALYTIC_CORNER_TRIM');
        }
        cornerRun = [
          memberDaylight[inIdx]![memberDaylight[inIdx]!.length - 1]!,
          { x: tie.x, y: tie.y, z: tie.z },
          memberDaylight[outIdx]![0]!,
        ];
      }
      const cornerDaylightFlat: number[] = [];
      for (const p of cornerRun) cornerDaylightFlat.push(p.x, p.y, p.z);
      corners.push({
        cornerIndex: j,
        vertexId: `joint:${j}`,
        classification,
        miterRay: { mx: analytic.ray.mx, my: analytic.ray.my },
        miterExtent: analytic.extent,
        tiePointXyz: [tie.x, tie.y, tie.z],
        daylightPoints: cornerDaylightFlat,
        diagnostics: [],
      });
      const analyticIncomingRun = memberDaylight[inIdx]!;
      const analyticJoint = joinDaylightRuns([analyticIncomingRun.slice(-1), cornerRun]);
      memberDaylight[inIdx] = [...analyticIncomingRun.slice(0, -1), ...analyticJoint];
      continue;
    }
    const ztV = query!.elevationAt(vx, vy);
    if (ztV === null) return fail('CORNER_TARGET_GAP', j, 'GRADING_CORNER_V_COVERAGE');
    const cutFill = cutFillSideAtCorner(ztV, vz);
    if (!cutFill) return fail('CORNER_TARGET_GAP', j, 'GRADING_CORNER_V_COVERAGE');
    const gCrossIn = crossGradeAtV(criterionAt(inIdx), ztV - vz);
    const gCrossOut = crossGradeAtV(criterionAt(outIdx), ztV - vz);
    if (gCrossIn === null || gCrossOut === null) {
      return fail('CORNER_NO_SOLUTION', j, 'GRADING_BAD_CRITERION');
    }
    // Phase 20K.1 Wave C2: surface joints resolve through the shared
    // Surface-corner authority (planes, seam, ray, extent, nearest outward
    // root, sector paths). §76/§77 gates preserved below.
    const classification = turn as GroupCornerClassification;
    const q1 = incoming.stitched.daylightPts[incoming.stitched.daylightPts.length - 1]!;
    const q2 = outgoing.stitched.daylightPts[0]!;
    const corner = solveSurfaceCorner({
      vx, vy, vz, side,
      tIn: incoming.tOut, nIn: incoming.nOut, gsIn: incoming.gsOut, gIn: gCrossIn,
      tOut: outgoing.tIn, nOut: outgoing.nIn, gsOut: outgoing.gsIn, gOut: gCrossOut,
      classification,
      target: target!, candidates, query: query!, maxSearchDistance,
      q1: { ...q1 }, q2: { ...q2 },
      midIn: { x: (members[inIdx]!.startX + vx) / 2, y: (members[inIdx]!.startY + vy) / 2 },
      midOut: { x: (vx + members[outIdx]!.endX) / 2, y: (vy + members[outIdx]!.endY) / 2 },
      inDaylight: memberDaylight[inIdx]!,
      outDaylight: memberDaylight[outIdx]!,
      inTris: memberTris[inIdx]!,
      outTris: memberTris[outIdx]!,
    });
    if (!corner.ok) return fail(corner.code, j, corner.detail);
    const surface = corner.value;
    if (surface.coincident) {
      // §77 same-plane merge: coincident gradients share one plane, so the
      // joint needs no patch even when the two criteria differ on paper.
      if (classification !== 'TANGENT') return fail('CORNER_COINCIDENT_PLANES', j);
      corners.push({ cornerIndex: j, vertexId: `joint:${j}`, classification, diagnostics: [] });
      continue;
    }
    // §76: collinear courses on different planes have no miter wedge —
    // fail closed rather than invent a seam.
    if (classification === 'TANGENT') return fail('CORNER_COINCIDENT_PLANES', j);
    multipleSolutions += Math.max(0, surface.rootCount - 1);
    intersectionSegments += surface.segmentCount;
    patchTris.push(...surface.patchTris);
    memberTris[inIdx] = surface.inTris;
    memberTris[outIdx] = surface.outTris;
    memberDaylight[inIdx] = surface.inDaylight;
    memberDaylight[outIdx] = surface.outDaylight;
    const cornerRun = surface.cornerRun;
    const tie = surface.tie;
    const ray = surface.ray;
    const tMax = surface.extent;
    const cornerDaylightFlat: number[] = [];
    for (const p of cornerRun) cornerDaylightFlat.push(p.x, p.y, p.z);
    corners.push({
      cornerIndex: j,
      vertexId: `joint:${j}`,
      classification,
      miterRay: { mx: ray.mx, my: ray.my },
      miterExtent: tMax,
      tiePointXyz: [tie.x, tie.y, tie.z],
      daylightPoints: cornerDaylightFlat,
      diagnostics: [],
    });
    // Splice the corner run between the member daylight runs.
    const incomingRun = memberDaylight[inIdx]!;
    const joint = joinDaylightRuns([incomingRun.slice(-1), cornerRun]);
    memberDaylight[inIdx] = [...incomingRun.slice(0, -1), ...joint];
  }

  // Global daylight: open path or simple closed ring.
  const runs: MergePoint[][] = [];
  for (let mi = 0; mi < members.length; mi += 1) runs.push(memberDaylight[mi]!);
  let daylight = joinDaylightRuns(runs);
  if (closed) {
    if (daylight.length > 1) {
      const first = daylight[0]!;
      const last = daylight[daylight.length - 1]!;
      if (
        Math.abs(first.x - last.x) <= zeroDelta(first.x, last.x) &&
        Math.abs(first.y - last.y) <= zeroDelta(first.y, last.y) &&
        Math.abs(first.z - last.z) <= zeroDelta(first.z, last.z)
      ) {
        daylight = daylight.slice(0, -1);
      }
    }
    if (!ringIsSimple(daylight)) return fail('GROUP_SELF_INTERSECTION', undefined, 'GRADING_GROUP_DAYLIGHT_RING');
  }

  // Merge into ONE mesh under the normal validator, then the 20K.1 Wave B2
  // fail-closed seam gate (pinched/non-manifold shared-index topology
  // fails the revision; fully-tied members legitimately split components).
  const allTris = [...memberTris.flat(), ...patchTris];
  const merged = mergeGroupTriangles(allTris);
  const meshError = validateGroupMesh(merged);
  if (meshError) {
    // Phase 20M.2 Wave D NARROW: a transitioned mesh that fails proof fails
    // closed (no heuristic repair) under the transition code.
    if (transitionPlan !== null) {
      return fail('TRANSITION_REJECTED', transitionPlan.joint, 'GRADING_AGREEMENT_TRANSITION_MESH');
    }
    return fail('GROUP_NON_MANIFOLD', undefined, meshError);
  }
  const tiedCoords: number[] = [];
  memberTris.forEach((tris, mi) => {
    if (tris.length !== 0) return;
    for (const p of solved[mi]!.stitched.sourcePts) tiedCoords.push(p.x, p.y, p.z);
  });
  // Phase 20K.2: tied runs inside a member (daylight back on the source,
  // CUT→TIED→FILL) legitimately split the merged mesh; record EVERY tied
  // station as a real coordinate so whichever side of the split ends up as
  // the attributed extra touches one (a single run-start is one-sided).
  for (const s of solved) {
    for (let i = 0; i < s.stitched.sourcePts.length; i += 1) {
      if (!samePlanNode(s.stitched.daylightPts[i]!, s.stitched.sourcePts[i]!)) continue;
      const p = s.stitched.sourcePts[i]!;
      tiedCoords.push(p.x, p.y, p.z);
    }
  }
  for (const corner of corners) {
    if (corner.classification === 'OVERLAP' && corner.tiePointXyz) tiedCoords.push(...corner.tiePointXyz);
  }
  // Phase 20K.3 Wave B: explicit pre-mesh expectation derived from the
  // member tilings (never the merged mesh's own topology). Closed groups
  // pin the 1/2 annulus; open groups pin the maximal non-tied runs (N/N).
  const groupExpectation = deriveGradingTopologyExpectation({
    scope: 'group',
    closed,
    positiveWidthRegions: closed ? 1 : countGroupPositiveWidthRegions(solved),
    tiedSplitCoords: tiedCoords,
    empty: merged.triangles.length === 0,
  });
  // Same semantic seam gate for straight and curved groups (the `if
  // (curved)` bypass is removed). Straight courses trim exactly along miter
  // seams and share corner indices, so honest GAP/OVERLAP tilings still
  // hold; anything else fails the revision against the declared budget.
  const groupTopoError = validateMergedGroupTopology(merged, tiedCoords, {
    expectedComponents: groupExpectation.expectedFaceComponents,
    expectedBoundaryLoops: groupExpectation.expectedBoundaryCycles,
  });
  if (groupTopoError) {
    if (transitionPlan !== null) {
      return fail('TRANSITION_REJECTED', transitionPlan.joint, 'GRADING_AGREEMENT_TRANSITION_MESH');
    }
    return fail('GROUP_NON_MANIFOLD', undefined, groupTopoError);
  }

  let cutSourceLength = 0;
  let fillSourceLength = 0;
  let tiedSourceLength = 0;
  const distances: number[] = [];
  let sourceLength = 0;
  solved.forEach((s, mi) => {
    sourceLength += members[mi]!.length;
    distances.push(...s.stitched.distances);
    // Phase 20F: source/target relation lengths are unavailable without a
    // target solve — never faked from the analytic strip.
    if (!isTargetFreeCriterion(criterionAt(mi))) {
      const split = splitMemberCutFill(s.stitched.sourcePts, s.nodeStations, query!);
      cutSourceLength += split.cut;
      fillSourceLength += split.fill;
      tiedSourceLength += split.tied;
    }
    intersectionSegments += s.stitched.intersectionSegmentCount;
    multipleSolutions += s.stitched.multipleSolutionCount;
  });
  const stats = groupMeshStats(merged, distances);
  const daylightFlat: number[] = [];
  for (const p of daylight) daylightFlat.push(p.x, p.y, p.z);
  //
  // Phase 20E §10: observe the exact source discretization the solver
  // consumed (stitched member sourcePts in traversal order, each member
  // dropping its final point, closed by the last member's final point).
  // Pure export for Design Patch; no numeric input to anything above.
  const sourceBoundaryPoints: number[] = [];
  solved.forEach((s) => {
    const pts = s.stitched.sourcePts;
    for (let i = 0; i + 1 < pts.length; i += 1) {
      const p = pts[i]!;
      sourceBoundaryPoints.push(p.x, p.y, p.z);
    }
  });
  const lastPts = solved[solved.length - 1]!.stitched.sourcePts;
  if (lastPts.length > 0) {
    const p = lastPts[lastPts.length - 1]!;
    sourceBoundaryPoints.push(p.x, p.y, p.z);
  }
  // Phase 20K.3 Wave B: certify the final merged mesh against the same
  // explicit pre-mesh expectation (closed 1/2 annulus; open N/N). A nonempty
  // merged mesh without a valid gtop2 certificate fails closed.
  const topologyCertificate = buildGradingTopologyCertificateExact({
    scope: 'group',
    points: merged.points,
    triangles: merged.triangles,
    expectation: groupExpectation,
    sourceBoundaryPoints,
    gradingBoundaryPoints: daylightFlat,
  });
  if (!topologyCertificate && merged.triangles.length > 0) {
    if (transitionPlan !== null) {
      return fail('TRANSITION_REJECTED', transitionPlan.joint, 'GRADING_AGREEMENT_TRANSITION_MESH');
    }
    return fail('GROUP_NON_MANIFOLD', undefined, 'GRADING_TOPOLOGY_CERTIFICATE_MISSING');
  }
  const result: CadGradingGroupResult = {
    groupId,
    revision,
    accuracy: curved ? 'CURVE_APPROXIMATED' : 'EXACT',
    memberCount: members.length,
    cornerCount: jointCount,
    memberRegions,
    corners,
    daylightPoints: daylightFlat,
    sourceBoundaryPoints,
    gradingMesh: { points: merged.points, triangles: merged.triangles },
    sourceLength,
    gradingPlanArea: stats.planArea,
    grading3dArea: stats.area3d,
    minProjectionDistance: stats.min,
    maxProjectionDistance: stats.max,
    meanProjectionDistance: stats.mean,
    cutSourceLength,
    fillSourceLength,
    tiedSourceLength,
    candidateTriangleCount: candidates.length,
    intersectionSegmentCount: intersectionSegments,
    multipleSolutionCount: multipleSolutions,
    diagnostics,
    ...(topologyCertificate ? { topologyCertificate } : {}),
  };
  return { ok: true, result };
}
