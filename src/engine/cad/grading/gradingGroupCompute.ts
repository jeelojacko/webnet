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
import { classifySourceDelta } from './gradingCutFill';
import type { GradingComputeSource, GradingTargetMeshSnapshot, TargetQuery } from './gradingComputeTypes';
import {
  classifyCorner,
  cutFillSideAtCorner,
  gradingPlaneGradient,
  miterExtent,
  miterSeam,
  planeElevationAt,
  selectMiterRay,
  type CornerGradingPlane,
} from './gradingCornerMath';
import { isZeroWidthPair } from './gradingMesh';
import {
  clipPolylineToHalfPlane,
  solveMiterTie,
  solveSectorPath,
  type SectorLine,
  type SectorPoint,
} from './gradingGroupSectors';
import {
  clipTriangleToHalfPlane,
  groupMeshStats,
  joinDaylightRuns,
  mergeGroupTriangles,
  ringIsSimple,
  validateGroupMesh,
  type MergePoint,
  type MergeTriangle,
} from './gradingGroupMerge';
import { buildTargetQuery, candidateTriangles } from './gradingTargetIndex';
import { solveGradingChord } from './solveAnalyticGradingChord';
import { solveAnalyticCorner } from './gradingGroupAnalyticCorners';
import { solveStraightChord, type StraightChordSolve } from './solveStraightChord';
import { gradingTerminationDomain, isTargetFreeCriterion } from './gradingTypes';
import type {
  GradingCriterion,
  GradingSide,
  ResolvedGradingSource,
} from './gradingTypes';
import type {
  CadGradingGroupResult,
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

/** Corner grading plane through V: gradient gs*T + g*N via the 20B helper. */
const cornerPlane = (
  vx: number, vy: number, vz: number,
  t: PlanVector, side: GradingSide, gCross: number, gsLong: number,
): CornerGradingPlane | null => {
  const pseudo: ResolvedGradingSource = {
    startX: vx, startY: vy, endX: vx + t.nx, endY: vy + t.ny,
    startZ: vz, endZ: vz + gsLong, length: 1, reoriented: false, isArc: false,
  };
  return gradingPlaneGradient(pseudo, side, gCross, gsLong);
};

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

/** Cross-grade active at V: fixed ratio, or the single-scalar cut/fill pick. */
const crossGradeAtV = (
  criterion: GradingCriterion,
  deltaAtV: number,
): number | null => {
  if (criterion.kind === 'fixed') {
    return Number.isFinite(criterion.gradeRatio) ? criterion.gradeRatio : null;
  }
  // Phase 20F: corner miters stay surface-only; target-free criteria on a
  // multi-course group fail closed at the corner (single-course analytic
  // groups never reach the corner path).
  if (criterion.kind !== 'cut-fill') return null;
  if (!Number.isFinite(criterion.cutGradeRatio) || !Number.isFinite(criterion.fillGradeRatio)) return null;
  const cls = classifySourceDelta(deltaAtV);
  return cls === 'CUT' ? criterion.cutGradeRatio : cls === 'FILL' ? criterion.fillGradeRatio : 0;
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
  // Phase 20H: same-domain defense before any partial solve. A
  // surface+analytic mix fails closed with MEMBER_NO_SOLUTION (never a
  // half-solved mesh); the domain branch below replaces any per-side
  // `||` check so every member/corner follows one termination domain.
  const domains = new Set([gradingTerminationDomain(criterion)]);
  for (let mi = 0; mi < members.length; mi += 1) domains.add(gradingTerminationDomain(criterionAt(mi)));
  if (domains.size > 1) {
    return fail('MEMBER_NO_SOLUTION', undefined, 'GRADING_GROUP_MIXED_TERMINATION_DOMAIN');
  }
  const jointCount = closed ? members.length : members.length - 1;
  for (let j = 0; j < jointCount; j += 1) {
    if (!exactXyz(members[j]!, members[(j + 1) % members.length]!)) {
      return fail('CORNER_INVERTED', j, 'GRADING_GROUP_CORNER_MISMATCH');
    }
  }
  // Surface members share ONE target index; analytic families carry no target
  // (same-domain is enforced above; this is the domain branch).
  const needsSurface = domains.has('surface');
  const query = needsSurface ? buildTargetQuery(target!) : null;
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
    const stitched = stitchChords(chordSolves);
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
    const incoming = solved[inIdx]!;
    const outgoing = solved[outIdx]!;
    const vMember = members[inIdx]!;
    const vx = vMember.endX;
    const vy = vMember.endY;
    const vz = vMember.endZ;
    const turn = classifyCorner(incoming.tOut, outgoing.tIn, side);
    if (!turn) return fail('CORNER_INVERTED', j, 'GRADING_CORNER_DEGENERATE');
    // Phase 20H: under the same-domain gate an all-analytic group routes
    // EVERY joint through the analytic corner solver (no target query, no
    // walls, no bridging, no interpolation).
    if (!needsSurface) {
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
    const plane1 = cornerPlane(vx, vy, vz, incoming.tOut, side, gCrossIn, incoming.gsOut);
    const plane2 = cornerPlane(vx, vy, vz, outgoing.tIn, side, gCrossOut, outgoing.gsOut);
    if (!plane1 || !plane2) return fail('CORNER_INVERTED', j, 'GRADING_CORNER_PLANE');
    const seam = miterSeam(plane1, plane2);
    if (!seam) return fail('CORNER_INVERTED', j, 'GRADING_CORNER_SEAM');
    const classification = turn as GroupCornerClassification;
    if ('coincident' in seam) {
      // §77 same-plane merge: coincident gradients share one plane, so the
      // joint needs no patch even when the two criteria differ on paper.
      if (classification !== 'TANGENT') return fail('CORNER_COINCIDENT_PLANES', j);
      corners.push({ cornerIndex: j, vertexId: `joint:${j}`, classification, diagnostics: [] });
      continue;
    }
    // §76: collinear courses on different planes have no miter wedge —
    // fail closed rather than invent a seam.
    if (classification === 'TANGENT') return fail('CORNER_COINCIDENT_PLANES', j);
    const ray = selectMiterRay(seam, incoming.nOut, outgoing.nIn);
    if (!ray || 'inverted' in ray) return fail('CORNER_INVERTED', j, 'GRADING_CORNER_RAY');
    if ('ambiguous' in ray) return fail('CORNER_AMBIGUOUS', j, 'GRADING_CORNER_RAY');
    const tMax = miterExtent(ray, incoming.nOut, outgoing.nIn, maxSearchDistance);
    if (tMax === null) return fail('CORNER_MAX_DISTANCE', j, 'GRADING_CORNER_EXTENT');
    const tie = solveMiterTie(target!, candidates, query!, plane1, vx, vy, ray.mx, ray.my, tMax);
    if (!tie.ok) return fail(tie.code, j, 'GRADING_CORNER_TIE');
    multipleSolutions += Math.max(0, tie.rootCount - 1);
    intersectionSegments += 1;
    const tieZ2 = planeElevationAt(plane2, tie.x, tie.y);
    if (tieZ2 === null || Math.abs(tieZ2 - tie.z) > zeroDelta(tieZ2, tie.z)) {
      return fail('CORNER_NO_SOLUTION', j, 'GRADING_CORNER_SEAM_DISAGREE');
    }
    const q1 = incoming.stitched.daylightPts[incoming.stitched.daylightPts.length - 1]!;
    const q2 = outgoing.stitched.daylightPts[0]!;
    // Sector bounds: strip half-planes + corner-normal wall + miter half-plane.
    // GAP sectors are the corner wedges (wall keeps the tie side); OVERLAP
    // sectors stay member-side (wall keeps the member mid) and start at the
    // trimmed seam crossing, so the locus graph holds exactly one path.
    const miterLine: SectorLine = { vx, vy, mx: ray.mx, my: ray.my };
    const sectorBounds = (
      t: PlanVector, n: PlanVector, wallKeep: SectorPoint, keepN: SectorPoint,
    ): Array<{ line: SectorLine; keep: SectorPoint }> => [
      { line: { vx, vy, mx: t.nx, my: t.ny }, keep: keepN },
      {
        line: { vx: vx + n.nx * maxSearchDistance, vy: vy + n.ny * maxSearchDistance, mx: t.nx, my: t.ny },
        keep: { x: vx, y: vy },
      },
      { line: { vx, vy, mx: n.nx, my: n.ny }, keep: wallKeep },
      { line: miterLine, keep: keepN },
    ];
    const midIn: SectorPoint = {
      x: (members[inIdx]!.startX + vx) / 2,
      y: (members[inIdx]!.startY + vy) / 2,
    };
    const midOut: SectorPoint = {
      x: (vx + members[outIdx]!.endX) / 2,
      y: (vy + members[outIdx]!.endY) / 2,
    };
    const keepN1: SectorPoint = { x: vx + incoming.nOut.nx, y: vy + incoming.nOut.ny };
    const keepN2: SectorPoint = { x: vx + outgoing.nIn.nx, y: vy + outgoing.nIn.ny };
    const tiePoint = { x: tie.x, y: tie.y, z: tie.z };
    if (classification === 'OVERLAP') {
      // OVERLAP: trim both member meshes + daylight to the miter seam first;
      // sector paths then run from the trimmed seam crossings to the tie.
      const trimWith = (tris: MergeTriangle[], keep: SectorPoint): MergeTriangle[] => {
        const out: MergeTriangle[] = [];
        for (const t of tris) out.push(...clipTriangleToHalfPlane(t, miterLine, keep));
        return out;
      };
      memberTris[inIdx] = trimWith(memberTris[inIdx]!, midIn);
      memberTris[outIdx] = trimWith(memberTris[outIdx]!, midOut);
      memberDaylight[inIdx] = clipPolylineToHalfPlane(memberDaylight[inIdx]!, miterLine, midIn);
      memberDaylight[outIdx] = clipPolylineToHalfPlane(memberDaylight[outIdx]!, miterLine, midOut);
      if (memberDaylight[inIdx]!.length === 0 || memberDaylight[outIdx]!.length === 0) {
        return fail('CORNER_NO_SOLUTION', j, 'GRADING_CORNER_TRIM');
      }
    }
    const from1 = classification === 'GAP'
      ? q1
      : memberDaylight[inIdx]![memberDaylight[inIdx]!.length - 1]!;
    const from2 = classification === 'GAP'
      ? q2
      : memberDaylight[outIdx]![0]!;
    const wall1: SectorPoint = classification === 'GAP' ? tiePoint : midIn;
    const wall2: SectorPoint = classification === 'GAP' ? tiePoint : midOut;
    const path1 = solveSectorPath(
      target!, candidates, query!, plane1,
      sectorBounds(incoming.tOut, incoming.nOut, wall1, keepN1),
      from1, tie,
    );
    if (!path1.ok) return fail(path1.code, j, 'GRADING_CORNER_SECTOR');
    const path2 = solveSectorPath(
      target!, candidates, query!, plane2,
      sectorBounds(outgoing.tIn, outgoing.nIn, wall2, keepN2),
      from2, tie,
    );
    if (!path2.ok) return fail(path2.code, j, 'GRADING_CORNER_SECTOR');
    intersectionSegments += path1.segmentCount + path2.segmentCount;
    let cornerRun: MergePoint[];
    if (classification === 'GAP') {
      // Two planar patch polygons fanned deterministically from V.
      const ring: MergePoint[] = [...path1.path.map((p) => ({ ...p }))];
      for (let k = path2.path.length - 2; k >= 0; k -= 1) ring.push({ ...path2.path[k]! });
      const v: MergePoint = { x: vx, y: vy, z: vz };
      for (let k = 0; k + 1 < ring.length; k += 1) {
        const tri: MergeTriangle = { a: v, b: ring[k]!, c: ring[k + 1]! };
        const area2 = (tri.b.x - tri.a.x) * (tri.c.y - tri.a.y) - (tri.c.x - tri.a.x) * (tri.b.y - tri.a.y);
        if (Math.abs(area2) <= zeroDelta(area2, 0)) continue;
        patchTris.push(tri);
      }
      cornerRun = [...path1.path.map((p) => ({ ...p }))];
      for (let k = path2.path.length - 2; k >= 0; k -= 1) cornerRun.push({ ...path2.path[k]! });
    } else {
      // OVERLAP: meshes and daylight already trimmed; the corner run joins
      // the two seam-crossing sector paths through the tie.
      cornerRun = [...path1.path.map((p) => ({ ...p }))];
      for (let k = path2.path.length - 2; k >= 0; k -= 1) cornerRun.push({ ...path2.path[k]! });
    }
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

  // Merge into ONE mesh under the normal validator.
  const allTris = [...memberTris.flat(), ...patchTris];
  const merged = mergeGroupTriangles(allTris);
  const meshError = validateGroupMesh(merged);
  if (meshError) return fail('GROUP_NON_MANIFOLD', undefined, meshError);

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
  };
  return { ok: true, result };
}
