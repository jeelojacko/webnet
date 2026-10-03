/**
 * Phase 20L.2 — exact-offset group builder (production, R0 whole-route only).
 *
 * Whole-route preflight integration + exact member/daylight discretization +
 * strip triangles/merged mesh + standard result assembly + topology
 * certificate. Exact member law: source geometry stays the true source arc,
 * daylight is the true concentric offset arc at Roff, daylight endpoints are
 * the exact joins J (or the exact offset of open ends), source endpoints
 * stay authoritative. One FIXED analytic region per member full station span;
 * the corner J is one shared XYZ object between incident runs — no
 * weld/average/fan/miter-trim/splice anywhere.
 *
 * Tessellation reuses the shared sagitta authority
 * (`featureLineArcSubdivisions`, the same helper `linearizeGradingArc` is
 * built on) without changing legacy fallback behavior: subdivisions are the
 * stricter of the source-R and offset-Roff counts over the actual retained
 * sweep, then proven `sagitta <= tol` on both arcs in floating point.
 *
 * Any construction/topology/cert failure returns fallback (never partial
 * exact). NOT wired into `computeGradingGroupFromSnapshots` — standalone
 * unit-testable module; the dispatcher lands separately.
 */
import { featureLineArcSubdivisions } from '../cadSurfaceRevision';
import { zeroDelta } from '../surfaces/volume/zero';
import { gradingSideNormal } from './gradingCourseFrame';
import { resolveAnalyticCriterionAt } from './gradingAnalyticCriterion';
import { classifyCorner } from './gradingCornerMath';
import {
  groupMeshStats,
  mergeGroupTriangles,
  validateGroupMesh,
  validateMergedGroupTopology,
  type MergePoint,
  type MergeTriangle,
} from './gradingGroupMerge';
import { solveAnalyticCorner } from './gradingGroupAnalyticCorners';
import {
  buildGradingTopologyCertificateExact,
  countPositiveWidthRegions,
} from './gradingTopologyCertificate';
import { deriveGradingTopologyExpectation } from './gradingTopologyExpectation';
import {
  exactRadialSign as geometryRadialSign,
  extentJVWithin,
  gateOffsetRadius,
  solveExactOffsetJoin,
  type ExactMember,
} from './gradingExactOffsetGeometry';
import {
  preflightExactOffsetRoute,
  type ExactOffsetPolicyMember,
} from './gradingExactOffsetPolicy';
import type { GradingSide, ResolvedGradingSource } from './gradingTypes';
import type {
  ExactOffsetAttempt,
  ExactOffsetGroupCorner,
  ExactOffsetGroupInput,
  ExactOffsetGroupResult,
} from './gradingGroupExactOffset.types';

const TAU = Math.PI * 2;

const fail = (reason: string, detail?: string): ExactOffsetAttempt =>
  detail === undefined ? { kind: 'fallback', reason } : { kind: 'fallback', reason, detail };

const finiteXYZ = (p: MergePoint): boolean =>
  Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);

/** Unit travel tangent of a member terminal (null when degenerate). */
const terminalTangent = (
  m: ResolvedGradingSource,
  at: 'start' | 'end',
): { nx: number; ny: number } | null => {
  if (!m.isArc || !m.arc) {
    const dx = m.endX - m.startX;
    const dy = m.endY - m.startY;
    const len = Math.hypot(dx, dy);
    if (!(len > 0) || !Number.isFinite(len)) return null;
    return { nx: dx / len, ny: dy / len };
  }
  const { centerX, centerY, sweepCCW } = m.arc;
  const dir = sweepCCW ? 1 : -1;
  const vx = at === 'start' ? m.startX : m.endX;
  const vy = at === 'start' ? m.startY : m.endY;
  const a = Math.atan2(vy - centerY, vx - centerX);
  if (!Number.isFinite(a)) return null;
  return { nx: dir * -Math.sin(a), ny: dir * Math.cos(a) };
};

/** Direction-preserving sweep in (0, TAU]; null when degenerate/full-circle. */
const dirSweep = (a0: number, a1: number, dir: 1 | -1): number | null => {
  if (!Number.isFinite(a0) || !Number.isFinite(a1)) return null;
  const raw = dir === 1 ? a1 - a0 : a0 - a1;
  const sweep = ((raw % TAU) + TAU) % TAU;
  return sweep > 0 && Number.isFinite(sweep) ? sweep : null;
};

const sagitta = (radius: number, sweep: number, n: number): number =>
  radius * (1 - Math.cos(sweep / (2 * n)));

/**
 * Sagitta-contract subdivisions: the shared helper's count, then bumped
 * until the floating-point sagitta provably sits within tolerance.
 */
const subdivisionsFor = (radius: number, sweep: number, tol: number): number | null => {
  if (!(radius > 0) || !(sweep > 0) || !(tol > 0)) return null;
  if (!Number.isFinite(radius) || !Number.isFinite(sweep) || !Number.isFinite(tol)) return null;
  let n = featureLineArcSubdivisions(radius, sweep, tol);
  if (!Number.isFinite(n) || n < 1) return null;
  n = Math.floor(n);
  while (!(sagitta(radius, sweep, n) <= tol)) {
    n += 1;
    if (n > 1e7) return null;
  }
  return n;
};

/** ExactMember of one chain member at one of its ends (V = that joint). */
const exactMemberAt = (m: ResolvedGradingSource, at: 'start' | 'end'): ExactMember | null => {
  const L = m.length;
  if (!(L > 0) || !Number.isFinite(L)) return null;
  const vx = at === 'start' ? m.startX : m.endX;
  const vy = at === 'start' ? m.startY : m.endY;
  const spanStart = at === 'end' ? -L : 0;
  const spanEnd = at === 'end' ? 0 : L;
  if (!m.isArc || !m.arc) {
    const t = terminalTangent(m, at);
    if (!t) return null;
    return { kind: 'line', vx, vy, tx: t.nx, ty: t.ny, spanStart, spanEnd };
  }
  const { centerX, centerY, radius, sweepCCW } = m.arc;
  if (!(radius > 0) || !Number.isFinite(radius)) return null;
  if (!finiteXYZ({ x: vx, y: vy, z: 0 }) || !Number.isFinite(centerX) || !Number.isFinite(centerY)) return null;
  return {
    kind: 'arc', vx, vy, cx: centerX, cy: centerY, radius,
    dir: sweepCCW ? 1 : -1, spanStart, spanEnd,
  };
};

/**
 * Whole-route exact-offset attempt: policy preflight (OPEN, curved, analytic
 * flat, same-d, Roff>0), per-joint geometry classification + XYZ tie gate,
 * exact discretization, strip/mesh/cert assembly. Fallback carries the
 * bounded gate reason — never a partial exact strip.
 */
export const tryExactOffsetGroup = (input: ExactOffsetGroupInput): ExactOffsetAttempt => {
  const { groupId, revision, members, side, criterion, maxSearchDistance, curveChordTolerance } = input;
  const criterionAt = (mi: number): ExactOffsetGroupInput['criterion'] =>
    input.memberCriteria?.[mi] ?? criterion;
  if (!Array.isArray(members) || members.length < 1) return fail('FALLBACK_DEGENERATE_SOURCE', 'empty-route');
  if (!Number.isFinite(maxSearchDistance) || !(maxSearchDistance > 0)) {
    return fail('FALLBACK_INVALID_CRITERION', 'bad-search-distance');
  }
  if (!Number.isFinite(curveChordTolerance) || !(curveChordTolerance > 0)) {
    return fail('FALLBACK_DEGENERATE_SOURCE', 'bad-chord-tolerance');
  }
  // Exact joint continuity mirror of production exactXyz (XY + Z, ===).
  for (let j = 0; j + 1 < members.length; j += 1) {
    const a = members[j]!;
    const b = members[j + 1]!;
    if (a.endX !== b.startX || a.endY !== b.startY || a.endZ !== b.startZ) {
      return fail('FALLBACK_SOURCE_JOINT_STEP', `joint-${j}-${j + 1}-step`);
    }
  }
  // Policy preflight owns OPEN/curved/analytic-flat/same-d/Roff candidacy.
  const policyMembers: ExactOffsetPolicyMember[] = [];
  for (let i = 0; i < members.length; i += 1) {
    const m = members[i]!;
    const t = terminalTangent(m, 'end');
    if (!t) return fail('FALLBACK_DEGENERATE_SOURCE', `member-${i}-tangent`);
    policyMembers.push({
      criterion: criterionAt(i),
      isArc: m.isArc,
      radius: m.arc?.radius ?? 0,
      startZ: m.startZ,
      endZ: m.endZ,
      tx: t.nx, ty: t.ny, vx: m.endX, vy: m.endY,
      cx: m.arc?.centerX ?? 0, cy: m.arc?.centerY ?? 0,
    });
  }
  const preflight = preflightExactOffsetRoute({ members: policyMembers, closed: false, side, maxSearchDistance });
  if (!preflight.admitted) return fail(preflight.reason, preflight.detail);
  const d = preflight.d;

  // Per-joint solve: exact join J + production analytic-tie XYZ gate.
  const joints = members.length - 1;
  const joins: MergePoint[] = [];
  const corners: ExactOffsetGroupCorner[] = [];
  for (let j = 0; j < joints; j += 1) {
    const inM = members[j]!;
    const outM = members[j + 1]!;
    const incoming = exactMemberAt(inM, 'end');
    const outgoing = exactMemberAt(outM, 'start');
    if (!incoming || !outgoing) return fail('FALLBACK_DEGENERATE_SOURCE', `joint-${j}-member`);
    const tIn = terminalTangent(inM, 'end');
    const tOut = terminalTangent(outM, 'start');
    if (!tIn || !tOut) return fail('FALLBACK_DEGENERATE_SOURCE', `joint-${j}-tangent`);
    const turn = classifyCorner(tIn, tOut, side);
    if (turn !== 'GAP' && turn !== 'OVERLAP') return fail('FALLBACK_BRANCH_REJECT', `joint-${j}-no-turn`);
    const solved = solveExactOffsetJoin({ incoming, outgoing, side, d, maxSearchDistance });
    if (!solved.ok) return fail(solved.reason, `joint-${j}-${solved.detail}`);
    // XYZ gate: production analytic corner is compatibility/provenance
    // authority only — the built node stays the admitted join J, never T.
    const nIn = gradingSideNormal(tIn.nx, tIn.ny, side);
    const nOut = gradingSideNormal(tOut.nx, tOut.ny, side);
    if (!nIn || !nOut) return fail('FALLBACK_DEGENERATE_SOURCE', `joint-${j}-normal`);
    const vx = inM.endX;
    const vy = inM.endY;
    const vz = inM.endZ;
    const inGs = (inM.endZ - inM.startZ) / inM.length;
    const outGs = (outM.endZ - outM.startZ) / outM.length;
    const analytic = solveAnalyticCorner({
      vx, vy, vz,
      inT: tIn, inN: nIn, inGs, outT: tOut, outN: nOut, outGs,
      inCriterion: criterionAt(j), outCriterion: criterionAt(j + 1), maxSearchDistance,
    });
    if (!analytic.ok) return fail('FALLBACK_ANALYTIC_TIE', `joint-${j}-${analytic.detail}`);
    if (analytic.kind !== 'miter') return fail('FALLBACK_ANALYTIC_TIE', `joint-${j}-coincident`);
    const worldScale = Math.max(1, Math.abs(vx), Math.abs(vy));
    const tieJoinDist = Math.hypot(analytic.tie.x - solved.join.x, analytic.tie.y - solved.join.y);
    if (!extentJVWithin(tieJoinDist, maxSearchDistance, worldScale)) {
      return fail('FALLBACK_TIE_OUTSIDE_SEARCH', `joint-${j}-tie-outside-search`);
    }
    const rIn = resolveAnalyticCriterionAt(criterionAt(j), inM.startZ, maxSearchDistance);
    const rOut = resolveAnalyticCriterionAt(criterionAt(j + 1), outM.startZ, maxSearchDistance);
    if (!rIn.ok || !rOut.ok) return fail('FALLBACK_INVALID_CRITERION', `joint-${j}-limit`);
    const limIn = rIn.value.limitElevation;
    const limOut = rOut.value.limitElevation;
    if (Math.abs(limIn - limOut) > zeroDelta(limIn, limOut)) {
      return fail('FALLBACK_JOIN_Z_MISMATCH', `joint-${j}-limit-disagree`);
    }
    // THE shared corner node: one object referenced by both incident runs.
    const J: MergePoint = { x: solved.join.x, y: solved.join.y, z: limIn };
    if (!finiteXYZ(J)) return fail('FALLBACK_DEGENERATE_SOURCE', `joint-${j}-join`);
    joins.push(J);
    corners.push({
      cornerIndex: j,
      vertexId: `joint:${j}`,
      classification: turn,
      miterRay: { mx: analytic.ray.mx, my: analytic.ray.my },
      miterExtent: analytic.extent,
      exactOffsetJoinXyz: [J.x, J.y, J.z],
      daylightPoints: [J.x, J.y, J.z],
      diagnostics: [],
    });
  }

  // Exact discretization: shared source joints V, shared daylight joins J.
  const n = members.length;
  const srcJoints: MergePoint[] = [{ x: members[0]!.startX, y: members[0]!.startY, z: members[0]!.startZ }];
  for (let i = 0; i < n; i += 1) {
    const m = members[i]!;
    srcJoints.push({ x: m.endX, y: m.endY, z: m.endZ });
  }
  const srcRuns: MergePoint[][] = [];
  const dayRuns: MergePoint[][] = [];
  for (let i = 0; i < n; i += 1) {
    const m = members[i]!;
    const inCrit = criterionAt(i);
    const rLim = resolveAnalyticCriterionAt(inCrit, m.startZ, maxSearchDistance);
    if (!rLim.ok) return fail('FALLBACK_INVALID_CRITERION', `member-${i}-limit`);
    const limit = rLim.value.limitElevation;
    const openStart = i === 0 ? offsetOpenEnd(m, 'start', side, d, limit) : null;
    const openEnd = i === n - 1 ? offsetOpenEnd(m, 'end', side, d, limit) : null;
    const dayStart: MergePoint | null = i === 0 ? openStart : joins[i - 1]!;
    const dayEnd: MergePoint | null = i === n - 1 ? openEnd : joins[i]!;
    if (!dayStart || !dayEnd || !finiteXYZ(dayStart) || !finiteXYZ(dayEnd)) {
      return fail('FALLBACK_DEGENERATE_SOURCE', `member-${i}-daylight-end`);
    }
    if (!m.isArc || !m.arc) {
      srcRuns.push([srcJoints[i]!, srcJoints[i + 1]!]);
      dayRuns.push([dayStart, dayEnd]);
      continue;
    }
    const { centerX, centerY, radius, sweepCCW } = m.arc;
    const dir = sweepCCW ? 1 : -1;
    const a0 = Math.atan2(srcJoints[i]!.y - centerY, srcJoints[i]!.x - centerX);
    const a1 = Math.atan2(srcJoints[i + 1]!.y - centerY, srcJoints[i + 1]!.x - centerX);
    const srcSweep = dirSweep(a0, a1, dir);
    if (srcSweep === null) return fail('FALLBACK_DEGENERATE_SOURCE', `member-${i}-sweep`);
    const sign = geometryRadialSign(exactMemberAt(m, 'end')!, side);
    if (sign === null) return fail('FALLBACK_DEGENERATE_SOURCE', `member-${i}-radial-sign`);
    const gated = gateOffsetRadius(radius, sign, d);
    if (!gated.ok) return fail(gated.reason, `member-${i}-roff`);
    const roff = gated.roff;
    const b0 = Math.atan2(dayStart.y - centerY, dayStart.x - centerX);
    const b1 = Math.atan2(dayEnd.y - centerY, dayEnd.x - centerX);
    const daySweep = dirSweep(b0, b1, dir);
    if (daySweep === null) return fail('FALLBACK_OFF_BODY_C0', `member-${i}-daylight-sweep`);
    const count = Math.max(
      subdivisionsFor(radius, srcSweep, curveChordTolerance) ?? NaN,
      subdivisionsFor(roff, daySweep, curveChordTolerance) ?? NaN,
    );
    if (!Number.isFinite(count) || count < 1) return fail('FALLBACK_DEGENERATE_SOURCE', `member-${i}-subdiv`);
    const src: MergePoint[] = [];
    const day: MergePoint[] = [];
    for (let k = 0; k <= count; k += 1) {
      const frac = k / count;
      if (k === 0) { src.push(srcJoints[i]!); day.push(dayStart); continue; }
      if (k === count) { src.push(srcJoints[i + 1]!); day.push(dayEnd); continue; }
      const sa = a0 + dir * srcSweep * frac;
      const da = b0 + dir * daySweep * frac;
      src.push({ x: centerX + radius * Math.cos(sa), y: centerY + radius * Math.sin(sa), z: m.startZ });
      day.push({ x: centerX + roff * Math.cos(da), y: centerY + roff * Math.sin(da), z: limit });
    }
    if (![...src, ...day].every(finiteXYZ)) return fail('FALLBACK_DEGENERATE_SOURCE', `member-${i}-samples`);
    srcRuns.push(src);
    dayRuns.push(day);
  }

  // Strip triangles: one FIXED region per member full span, orientation +
  // nonzero-area discipline, no fan/miter-trim/splice.
  const S: MergePoint[] = [];
  const D: MergePoint[] = [];
  for (let i = 0; i < n; i += 1) {
    const s = srcRuns[i]!;
    const w = dayRuns[i]!;
    for (let k = i === 0 ? 0 : 1; k < s.length; k += 1) { S.push(s[k]!); D.push(w[k]!); }
  }
  if (S.length < 2 || D.length !== S.length || ![...S, ...D].every(finiteXYZ)) {
    return fail('FALLBACK_DEGENERATE_SOURCE', 'strip-runs');
  }
  const tris: MergeTriangle[] = [];
  const pushTri = (a: MergePoint, b: MergePoint, c: MergePoint): void => {
    const area2 = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
    if (area2 === 0) return;
    if (area2 > 0) tris.push({ a, b, c });
    else tris.push({ a, b: c, c: b });
  };
  for (let i = 0; i + 1 < S.length; i += 1) {
    pushTri(S[i]!, S[i + 1]!, D[i + 1]!);
    pushTri(S[i]!, D[i + 1]!, D[i]!);
  }
  if (tris.length === 0) return fail('FALLBACK_STRIP_FAIL', 'no-triangles');
  const merged = mergeGroupTriangles(tris);
  // Pre-mesh expectation FIRST (region count from the built runs, d > 0 open).
  const expectation = deriveGradingTopologyExpectation({
    scope: 'group',
    closed: false,
    positiveWidthRegions: countPositiveWidthRegions(S, D),
    tiedSplitCoords: [],
    empty: merged.triangles.length === 0,
  });
  const meshError = validateGroupMesh(merged);
  if (meshError) return fail('FALLBACK_STRIP_FAIL', meshError);
  const topoError = validateMergedGroupTopology(merged, [], {
    expectedComponents: expectation.expectedFaceComponents,
    expectedBoundaryLoops: expectation.expectedBoundaryCycles,
  });
  if (topoError) return fail('FALLBACK_STRIP_FAIL', topoError);
  const flat = (pts: MergePoint[]): number[] => pts.flatMap((p) => [p.x, p.y, p.z]);
  const sourceBoundaryPoints = flat(S);
  const daylightFlat = flat(D);
  const topologyCertificate = buildGradingTopologyCertificateExact({
    scope: 'group',
    points: merged.points,
    triangles: merged.triangles,
    expectation,
    sourceBoundaryPoints,
    gradingBoundaryPoints: daylightFlat,
  });
  if (!topologyCertificate && merged.triangles.length > 0) {
    return fail('FALLBACK_STRIP_FAIL', 'GRADING_TOPOLOGY_CERTIFICATE_MISSING');
  }
  const distances = S.map(() => d);
  const stats = groupMeshStats(merged, distances);

  let sourceLength = 0;
  for (const m of members) sourceLength += m.length;
  const result: ExactOffsetGroupResult = {
    groupId,
    revision,
    accuracy: 'CURVE_APPROXIMATED',
    memberCount: n,
    cornerCount: joints,
    memberRegions: members.map((m, mi) => ({
      memberIndex: mi,
      classification: 'FIXED',
      stationSpan: [0, m.length],
    })),
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
    cutSourceLength: 0,
    fillSourceLength: 0,
    tiedSourceLength: 0,
    candidateTriangleCount: 0,
    intersectionSegmentCount: 0,
    multipleSolutionCount: 0,
    diagnostics: [],
    ...(topologyCertificate ? { topologyCertificate } : {}),
    curveGeometryMode: 'EXACT_OFFSET_RADIUS',
  };
  return { kind: 'exact', result, d };
};

/**
 * Exact offset of an open member end: parallel line point, or concentric
 * arc point at the gated Roff (centre/traversal preserved).
 */
const offsetOpenEnd = (
  m: ResolvedGradingSource,
  at: 'start' | 'end',
  side: GradingSide,
  d: number,
  limit: number,
): MergePoint | null => {
  const t = terminalTangent(m, at);
  if (!t) return null;
  const v = at === 'start' ? { x: m.startX, y: m.startY } : { x: m.endX, y: m.endY };
  if (!m.isArc || !m.arc) {
    const nr = gradingSideNormal(t.nx, t.ny, side);
    if (!nr) return null;
    return { x: v.x + d * nr.nx, y: v.y + d * nr.ny, z: limit };
  }
  const { centerX, centerY, radius } = m.arc;
  const sign = geometryRadialSign(exactMemberAt(m, at)!, side);
  if (sign === null) return null;
  const gated = gateOffsetRadius(radius, sign, d);
  if (!gated.ok) return null;
  const a = Math.atan2(v.y - centerY, v.x - centerX);
  if (!Number.isFinite(a)) return null;
  return { x: centerX + gated.roff * Math.cos(a), y: centerY + gated.roff * Math.sin(a), z: limit };
};
