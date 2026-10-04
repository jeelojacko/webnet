/**
 * Phase 20N Candidate A — REAL shared-member 2T/3T full-group mesh evidence.
 *
 * STUDY / EVIDENCE ONLY. Zero `src/` edits. This file fixes the external
 * REQUEST_CHANGES against the first Candidate A pass (per-joint admission
 * only, constant `candidateAExpectationRegions`, no multi-transition mesh):
 * every valid row below builds full-group geometry over REAL shared members,
 * tiles actual source/daylight polylines, triangulates with production
 * `buildGradingStripMesh`, certifies with production gtop2, revalidates
 * exactly, and runs production worker agreement validators per transition.
 *
 * Production authorities reused read-only (never copied, never re-derived):
 * admitGradingTransition / evaluateTransitionLinearV1 (law), 
 * resolveAnalyticCriterionAt (native spans), gradingSideNormal (frame),
 * buildGradingStripMesh (mesh), countPositiveWidthRegions (measured regions),
 * deriveGradingTopologyExpectation (expectation, fed the MEASURED count),
 * buildGradingTopologyCertificateExact +
 * gradingTopologyCertificateExactError (certify + revalidate),
 * validateTransitionResultMesh + checkGroupTransitionAgreement (agreement),
 * buildGroupRevision (order-sensitivity), transitionResultBakeCitation
 * (singular-today inspection), courseCriterionKey (member identity).
 *
 * Deliberate study-side rules (NOT production claims):
 * - strict-separation layout predicate over real middle-member lengths;
 * - per-station owner classifier (transition i / boundary / native);
 * - canonical joint-index order (never silently sorted);
 * - deriveTransitionExpectation is NOT used for N>1: it REJECTS
 *   transitionCount!==1 by design (pinned in tests). The pre-mesh
 *   expectation is declared via deriveGradingTopologyExpectation fed the
 *   production-measured region count — same shape, documented here.
 *
 * Determinism: fixed fixture order, r12 rounding on recorded floats,
 * insertion-ordered JSON, no timestamps.
 */
import { createHash } from 'node:crypto';
import {
  admitGradingTransition,
  evaluateTransitionLinearV1,
} from '../src/engine/cad/grading/gradingTransitionPolicy';
import { resolveAnalyticCriterionAt } from '../src/engine/cad/grading/gradingAnalyticCriterion';
import { gradingSideNormal } from '../src/engine/cad/grading/gradingCourseFrame';
import { buildGradingStripMesh } from '../src/engine/cad/grading/gradingMesh';
import {
  buildGradingTopologyCertificateExact,
  countPositiveWidthRegions,
  gradingTopologyCertificateExactError,
} from '../src/engine/cad/grading/gradingTopologyCertificate';
import { deriveGradingTopologyExpectation } from '../src/engine/cad/grading/gradingTopologyExpectation';
import { courseCriterionKey } from '../src/engine/cad/grading/gradingGroupCourseCriteria';
import { buildGroupRevision } from '../src/engine/cad/grading/gradingGroupRevision';
import { transitionResultBakeCitation } from '../src/engine/cad/grading/gradingTransitionProvenance';
import {
  checkGroupTransitionAgreement,
  validateTransitionResultMesh,
} from '../src/workers/surfaceGradingCompute';
import type { GradingCriterion, GradingSide } from '../src/engine/cad/grading/gradingTypes';

export type MultiFamily = 'distance' | 'relative-elevation' | 'elevation';
export type MultiTransform = 'identity' | 'mirror' | 'reversal' | 'translate-1e6' | 'translate-1e8';

export interface MultiFixtureSpec {
  fixtureId: string;
  family: MultiFamily;
  /** Real shared-member lengths, e.g. 2T [30,24,30] (M1 shared, len 24). */
  memberLengths: number[];
  /** Per-joint widths, e.g. [8,6] (unequal on purpose). */
  widths: number[];
  transform: MultiTransform;
  expected: string;
  eligible: boolean;
}

const r12 = (v: number): number => {
  if (!Number.isFinite(v)) return v;
  const r = Number(v.toPrecision(12));
  return r === 0 ? 0 : r;
};

const GRADE = 0.5;
const jointZ = (family: MultiFamily): number => (family === 'elevation' ? 0 : 10);
const maxSearch = (family: MultiFamily): number => (family === 'elevation' ? 100 : 50);

/** Alternating per-member scalars so EVERY transition changes value. */
const memberScalars = (family: MultiFamily, count: number): number[] => {
  const pair = family === 'distance' ? [5, 7] : family === 'relative-elevation' ? [1.5, 2] : [0.5, 1];
  return Array.from({ length: count }, (_, i) => pair[i % 2]!);
};

const memberCriterion = (family: MultiFamily, scalar: number): GradingCriterion => {
  if (family === 'distance') return { kind: 'distance', gradeRatio: GRADE, distance: scalar };
  if (family === 'relative-elevation')
    return { kind: 'relative-elevation', gradeRatio: GRADE, relativeElevation: scalar };
  return { kind: 'elevation', gradeRatio: GRADE, targetElevation: scalar };
};

/** Stable member identity via the production override-map key (never fake L/R). */
export const multiMemberId = (i: number): string => courseCriterionKey(`S${i}`, `S${i + 1}`);

const sideOf = (transform: MultiTransform): GradingSide =>
  transform === 'mirror' ? 'right' : 'left';

const dirOf = (transform: MultiTransform): { dx: number; dy: number } =>
  transform === 'reversal' ? { dx: -1, dy: 0 } : { dx: 1, dy: 0 };

/** Parse a real `joint:<n>` id; anything else is malformed (never coerced). */
export const parseJointIndex = (jointId: string): number => {
  const m = /^joint:(\d+)$/.exec(jointId);
  if (!m) throw new Error(`malformed jointId ${JSON.stringify(jointId)}`);
  return Number(m[1]);
};

/**
 * Canonical-order gate: joint ids must arrive strictly increasing.
 * Duplicates / out-of-order REJECT (fail closed) — never silently sorted.
 */
export const assertCanonicalJointOrder = (jointIds: readonly string[]): void => {
  const idx = jointIds.map(parseJointIndex);
  for (let i = 1; i < idx.length; i += 1) {
    if (!(idx[i]! > idx[i - 1]!)) throw new Error(`non-canonical joint order ${jointIds.join(',')}`);
  }
};

interface MultiMember {
  id: string;
  criterion: GradingCriterion;
  length: number;
  start: number;
}

interface MultiJoint {
  jointId: string;
  station: number;
  width: number;
  sL: number;
  sR: number;
  vL: number;
  vR: number;
  memberL: number;
  memberR: number;
}

export interface MultiGeometry {
  spec: MultiFixtureSpec;
  side: GradingSide;
  members: MultiMember[];
  joints: MultiJoint[];
  intervals: { lo: number; hi: number }[];
  total: number;
}

export type MultiBuildOutcome =
  | { ok: true; geometry: MultiGeometry }
  | { ok: false; stage: string; code: string };

/** Strict separation DERIVED from actual shared-member lengths. */
const layoutSeparation = (widths: readonly number[], gaps: readonly number[]): boolean => {
  if (gaps.length !== widths.length - 1) return false;
  return gaps.every((gap, i) => {
    const w = widths[i]!;
    const wn = widths[i + 1]!;
    if (![w, wn, gap].every((v) => Number.isFinite(v) && v > 0)) return false;
    return w / 2 + wn / 2 < gap;
  });
};

/**
 * Build full-group geometry: real shared members on one station axis,
 * joint stations from cumulative lengths, per-joint live admission with
 * the REAL member pair + ids (transitionCount pinned to 1 per joint).
 */
export const buildMultiGroup = (spec: MultiFixtureSpec): MultiBuildOutcome => {
  const n = spec.memberLengths.length;
  if (n < 3 || spec.widths.length !== n - 1) {
    return { ok: false, stage: 'fixture', code: 'MALFORMED' };
  }
  for (const L of spec.memberLengths) {
    if (!Number.isFinite(L) || !(L > 0)) return { ok: false, stage: 'fixture', code: 'MALFORMED' };
  }
  for (const w of spec.widths) {
    if (!Number.isFinite(w) || !(w > 0)) {
      return { ok: false, stage: 'per-joint-admission', code: 'WIDTH_INVALID' };
    }
  }
  const side = sideOf(spec.transform);
  const { dx, dy } = dirOf(spec.transform);
  const scalars = memberScalars(spec.family, n);
  const members: MultiMember[] = spec.memberLengths.map((length, i) => ({
    id: multiMemberId(i),
    criterion: memberCriterion(spec.family, scalars[i]!),
    length,
    start: spec.memberLengths.slice(0, i).reduce((a, b) => a + b, 0),
  }));
  const total = members[n - 1]!.start + members[n - 1]!.length;
  // Joint stations from cumulative lengths; reversal measures from the far end.
  const jointGaps: number[] = members.slice(1, -1).map((m) => m.length);
  if (!layoutSeparation(spec.widths, jointGaps)) {
    const code = jointGaps.some(
      (g, i) => Number.isFinite(g) && g > 0 && spec.widths[i]! / 2 + spec.widths[i + 1]! / 2 === g,
    )
      ? 'TOUCHING_NOT_AUTHORIZED'
      : 'OVERLAP_REJECTED';
    return { ok: false, stage: 'group-layout', code };
  }
  const joints: MultiJoint[] = [];
  try {
    assertCanonicalJointOrder(spec.widths.map((_, j) => `joint:${j}`));
  } catch {
    return { ok: false, stage: 'group-layout', code: 'ORDER_REJECTED' };
  }
  for (let j = 0; j + 1 < n; j += 1) {
    const jointId = `joint:${j}`;
    const fwdStation = members[j]!.start + members[j]!.length;
    const station = spec.transform === 'reversal' ? total - fwdStation : fwdStation;
    const width = spec.widths[j]!;
    // Layout-order member pair: reversal traverses members [n-1..0], so the
    // member left of the joint in LAYOUT order is original M(j+1) and the
    // right one is M(j). vL/vR (and memberIds) follow the actual adjacent
    // reversed members — joint ids stay bound to the vertex junction.
    const memberL = spec.transform === 'reversal' ? j + 1 : j;
    const memberR = spec.transform === 'reversal' ? j : j + 1;
    const admitted = admitGradingTransition({
      policyVersion: 'trp1',
      lawKind: 'TRANSITION_LINEAR_V1',
      lawVersion: 'v1',
      criterionFamily: spec.family,
      jointId,
      memberIds: [members[memberL]!.id, members[memberR]!.id],
      width,
      side,
      groupSide: side,
      isOpen: true,
      transitionCount: 1,
      jointZ: jointZ(spec.family),
      members: [
        { memberId: members[memberL]!.id, criterion: members[memberL]!.criterion, length: members[memberL]!.length, dirX: dx, dirY: dy, startZ: jointZ(spec.family), endZ: jointZ(spec.family), isArc: false, maxSearchDistance: maxSearch(spec.family) },
        { memberId: members[memberR]!.id, criterion: members[memberR]!.criterion, length: members[memberR]!.length, dirX: dx, dirY: dy, startZ: jointZ(spec.family), endZ: jointZ(spec.family), isArc: false, maxSearchDistance: maxSearch(spec.family) },
      ],
    });
    if (!admitted.ok) return { ok: false, stage: 'per-joint-admission', code: admitted.code };
    joints.push({ jointId, station, width, sL: admitted.sL, sR: admitted.sR, vL: admitted.vL, vR: admitted.vR, memberL, memberR });
  }
  const intervals = joints.map((jt) => ({ lo: jt.station - jt.width / 2, hi: jt.station + jt.width / 2 }));
  return { ok: true, geometry: { spec, side, members, joints, intervals, total } };
};

export type StationOwner =
  | { kind: 'transition'; index: number }
  | { kind: 'boundary'; index: number }
  | { kind: 'native'; member: number };

/** Per-station owner: strictly-inside → joint i; exactly-on-bound → boundary; else native. */
export const classifyMultiStation = (s: number, geometry: MultiGeometry): StationOwner => {
  for (let i = 0; i < geometry.intervals.length; i += 1) {
    const iv = geometry.intervals[i]!;
    if (s > iv.lo && s < iv.hi) return { kind: 'transition', index: i };
    if (s === iv.lo || s === iv.hi) return { kind: 'boundary', index: i };
  }
  for (let k = 0; k < geometry.members.length; k += 1) {
    const m = geometry.members[k]!;
    // Reversal measures stations from the far end: remap the member span.
    const lo = geometry.spec.transform === 'reversal' ? geometry.total - (m.start + m.length) : m.start;
    if (s >= lo && s <= lo + m.length) return { kind: 'native', member: k };
  }
  throw new Error(`station ${s} outside group span`);
};

interface AxisPoint { s: number; off: number; z: number }

const nativeAxisPoint = (geometry: MultiGeometry, member: number, s: number): AxisPoint => {
  const resolved = resolveAnalyticCriterionAt(
    geometry.members[member]!.criterion,
    jointZ(geometry.spec.family),
    maxSearch(geometry.spec.family),
  );
  if (!resolved.ok) throw new Error(`native must resolve (member ${member})`);
  return { s, off: resolved.value.horizontalDistance, z: resolved.value.limitElevation };
};

const transitionAxisPoint = (geometry: MultiGeometry, joint: number, s: number): AxisPoint => {
  const jt = geometry.joints[joint]!;
  const v = evaluateTransitionLinearV1(jt.vL, jt.vR, jt.sL, jt.sR, s - jt.station);
  const g = GRADE;
  const jz = jointZ(geometry.spec.family);
  if (geometry.spec.family === 'distance') return { s, off: v, z: jz + g * v };
  if (geometry.spec.family === 'relative-elevation') {
    const srcZ = jz;
    return { s, off: v / g, z: srcZ + v };
  }
  return { s, off: (v - jz) / g, z: v };
};

/** Full transform to world coords (mirror / reversal / translate rebuild). */
const toWorld = (geometry: MultiGeometry, s: number, off: number, z: number): { x: number; y: number; z: number } => {
  const t = geometry.spec.transform;
  const shift = t === 'translate-1e6' ? 1e6 : t === 'translate-1e8' ? 1e8 : 0;
  const n = gradingSideNormal(dirOf(t).dx, dirOf(t).dy, geometry.side)!;
  const sx = (t === 'reversal' ? geometry.total - s : s) + shift;
  const sy = shift;
  return { x: sx + n.nx * off, y: sy + n.ny * off, z };
};

const sourceWorld = (geometry: MultiGeometry, s: number, zSrc: number): { x: number; y: number; z: number } => {
  const t = geometry.spec.transform;
  const shift = t === 'translate-1e6' ? 1e6 : t === 'translate-1e8' ? 1e8 : 0;
  const sx = (t === 'reversal' ? geometry.total - s : s) + shift;
  return { x: sx, y: shift, z: zSrc };
};

export interface TiledGroup {
  stations: number[];
  owners: StationOwner[];
  source: { x: number; y: number; z: number }[];
  daylight: { x: number; y: number; z: number }[];
  c0Plan: number;
  c0Z: number;
}

/** Full source/daylight tiling over ordered global stations. */
export const tileMultiGroup = (geometry: MultiGeometry): TiledGroup => {
  const base = new Set<number>([0, geometry.total]);
  for (const m of geometry.members) {
    const b = geometry.spec.transform === 'reversal' ? geometry.total - m.start : m.start;
    base.add(b);
    base.add(geometry.spec.transform === 'reversal' ? geometry.total - (m.start + m.length) : m.start + m.length);
  }
  for (const jt of geometry.joints) {
    base.add(jt.station - jt.width / 2);
    base.add(jt.station - jt.width / 4);
    base.add(jt.station);
    base.add(jt.station + jt.width / 4);
    base.add(jt.station + jt.width / 2);
  }
  const ordered = [...base].sort((a, b) => a - b);
  // One midpoint per native-run consecutive pair (keeps every native run meshed).
  const extra: number[] = [];
  for (let i = 0; i + 1 < ordered.length; i += 1) {
    const a = ordered[i]!;
    const b = ordered[i + 1]!;
    const mid = (a + b) / 2;
    const oa = classifyMultiStation(a, geometry);
    const ob = classifyMultiStation(b, geometry);
    const om = classifyMultiStation(mid, geometry);
    if (oa.kind === 'native' && ob.kind === 'native' && om.kind === 'native') extra.push(mid);
  }
  const stations = [...ordered, ...extra].sort((a, b) => a - b);
  const owners = stations.map((s) => classifyMultiStation(s, geometry));
  const jz = jointZ(geometry.spec.family);
  const source = stations.map((s) => sourceWorld(geometry, s, jz));
  const daylight = stations.map((s, i) => {
    const o = owners[i]!;
    if (o.kind === 'transition') {
      const p = transitionAxisPoint(geometry, o.index, s);
      return toWorld(geometry, s, p.off, p.z);
    }
    if (o.kind === 'native') {
      const p = nativeAxisPoint(geometry, o.member, s);
      return toWorld(geometry, s, p.off, p.z);
    }
    // Boundary: transition endpoint MUST equal its ACTUAL adjacent native in
    // layout order (memberL left of the low bound, memberR right of the high
    // bound — under reversal these are the reversed members, never the
    // unreversed pair). Residual vs the true neighbor only.
    const jt = geometry.joints[o.index]!;
    const tp = transitionAxisPoint(geometry, o.index, s);
    const endMember = s === jt.station - jt.width / 2 ? jt.memberL : jt.memberR;
    const np = nativeAxisPoint(geometry, endMember, s);
    const tw = toWorld(geometry, s, tp.off, tp.z);
    const nw = toWorld(geometry, s, np.off, np.z);
    const plan = Math.hypot(tw.x - nw.x, tw.y - nw.y);
    const zgap = Math.abs(tw.z - nw.z);
    tiledBoundaryResidual.plan = Math.max(tiledBoundaryResidual.plan, plan);
    tiledBoundaryResidual.z = Math.max(tiledBoundaryResidual.z, zgap);
    return tw;
  });
  const c0 = { plan: tiledBoundaryResidual.plan, z: tiledBoundaryResidual.z };
  tiledBoundaryResidual.plan = 0;
  tiledBoundaryResidual.z = 0;
  return { stations, owners, source, daylight, c0Plan: c0.plan, c0Z: c0.z };
};

// ponytail: module-level residual accumulator, single-threaded study only; parameterize if reused.
const tiledBoundaryResidual = { plan: 0, z: 0 };

export interface MultiMeshFacts {
  vertexCount: number;
  triangleCount: number;
  skippedZeroWidth: number;
  measuredPositiveWidthRegions: number;
  certOk: boolean;
  components: number;
  boundaryCycles: number;
  revalidationNull: boolean;
}

/** Actual strip mesh + gtop2 cert + exact revalidation over the tiled group. */
export const meshAndCertifyMultiGroup = (tiled: TiledGroup): MultiMeshFacts => {
  const built = buildGradingStripMesh(tiled.source, tiled.daylight);
  if (!built.ok) throw new Error(`strip mesh must build (got ${built.code})`);
  const measured = countPositiveWidthRegions(tiled.source, tiled.daylight);
  // Pre-mesh expectation declared from the MEASURED count via the
  // count-agnostic derivation (deriveTransitionExpectation rejects count≠1
  // by design — pinned in tests — so it can never declare a multi group).
  const expectation = deriveGradingTopologyExpectation({
    scope: 'group',
    closed: false,
    positiveWidthRegions: measured,
  });
  const flat = (pts: readonly { x: number; y: number; z: number }[]): number[] =>
    pts.flatMap((p) => [p.x, p.y, p.z]);
  const cert = buildGradingTopologyCertificateExact({
    scope: 'group',
    points: built.points,
    triangles: built.triangles,
    expectation,
    sourceBoundaryPoints: flat(tiled.source),
    gradingBoundaryPoints: flat(tiled.daylight),
  });
  if (!cert) throw new Error('gtop2 must certify the strict-separated strip');
  const err = gradingTopologyCertificateExactError(
    cert,
    'group',
    { points: built.points, triangles: built.triangles },
    { sourceBoundaryPoints: flat(tiled.source), gradingBoundaryPoints: flat(tiled.daylight) },
  );
  return {
    vertexCount: built.points.length / 3,
    triangleCount: built.triangles.length / 3,
    skippedZeroWidth: built.skippedZeroWidth,
    measuredPositiveWidthRegions: measured,
    certOk: true,
    components: cert.components,
    boundaryCycles: cert.boundaryCycles,
    revalidationNull: err === null,
  };
};

export interface MultiAgreementFacts {
  /** Per-transition production mesh-validator outcome (null = green). */
  meshValidator: (string | null)[];
  /** Per-transition production agreement outcome (true = ok). */
  groupAgreement: boolean[];
}

/** Per-transition production validators over ACTUAL result-owned checkpoints. */
export const agreeMultiGroup = (
  geometry: MultiGeometry,
  tiled: TiledGroup,
  recordedRevision: string,
): MultiAgreementFacts => {
  const flat = (pts: readonly { x: number; y: number; z: number }[]): number[] =>
    pts.flatMap((p) => [p.x, p.y, p.z]);
  const flatDay = flat(tiled.daylight);
  const flatSrc = flat(tiled.source);
  const at = (s: number): number => {
    const i = tiled.stations.indexOf(s);
    if (i < 0) throw new Error(`checkpoint station ${s} not tiled`);
    return i;
  };
  const meshValidator: (string | null)[] = [];
  const groupAgreement: boolean[] = [];
  for (const jt of geometry.joints) {
    const iL = at(jt.station + jt.sL);
    const i0 = at(jt.station);
    const iR = at(jt.station + jt.sR);
    const triple = (arr: { x: number; y: number; z: number }[]): number[] => [
      arr[iL]!.x, arr[iL]!.y, arr[iL]!.z,
      arr[i0]!.x, arr[i0]!.y, arr[i0]!.z,
      arr[iR]!.x, arr[iR]!.y, arr[iR]!.z,
    ];
    meshValidator.push(
      validateTransitionResultMesh({
        family: geometry.spec.family,
        sL: jt.sL,
        sR: jt.sR,
        vL: jt.vL,
        vR: jt.vR,
        daylightCheckpoints: triple(tiled.daylight),
        sourceCheckpoints: triple(tiled.source),
        criterionL: geometry.members[jt.memberL]!.criterion,
        criterionR: geometry.members[jt.memberR]!.criterion,
        jointZ: jointZ(geometry.spec.family),
        maxSearchDistance: maxSearch(geometry.spec.family),
        daylightPoints: flatDay,
        sourceBoundaryPoints: flatSrc,
        side: geometry.side,
      }),
    );
    groupAgreement.push(
      checkGroupTransitionAgreement(
        {
          policyVersion: 'trp1',
          jointId: jt.jointId,
          memberIds: [geometry.members[jt.memberL]!.id, geometry.members[jt.memberR]!.id],
          width: jt.width,
          lawKind: 'TRANSITION_LINEAR_V1',
          lawVersion: 'v1',
          criterionFamily: geometry.spec.family,
          side: geometry.side,
          groupSide: geometry.side,
          isOpen: true,
          transitionCount: 1,
          jointZ: jointZ(geometry.spec.family),
          endpointEvidence: { vL: jt.vL, vR: jt.vR, gL: GRADE, gR: GRADE },
          jointStation: jt.station,
          recordedRevision,
        },
        [
          { memberId: geometry.members[jt.memberL]!.id, criterion: geometry.members[jt.memberL]!.criterion, length: geometry.members[jt.memberL]!.length, dirX: dirOf(geometry.spec.transform).dx, dirY: dirOf(geometry.spec.transform).dy, startZ: jointZ(geometry.spec.family), endZ: jointZ(geometry.spec.family), isArc: false, maxSearchDistance: maxSearch(geometry.spec.family) },
          { memberId: geometry.members[jt.memberR]!.id, criterion: geometry.members[jt.memberR]!.criterion, length: geometry.members[jt.memberR]!.length, dirX: dirOf(geometry.spec.transform).dx, dirY: dirOf(geometry.spec.transform).dy, startZ: jointZ(geometry.spec.family), endZ: jointZ(geometry.spec.family), isArc: false, maxSearchDistance: maxSearch(geometry.spec.family) },
        ],
        recordedRevision,
      ).ok,
    );
  }
  return { meshValidator, groupAgreement };
};

export interface MultiRevisionFacts {
  hash: string;
  orderSensitive: boolean;
  stable: boolean;
  citationLength: number;
}

/** ggrev1 over real courses + canonical intents; order-swap must move the hash. */
export const revisionFactsMultiGroup = (geometry: MultiGeometry, tiled: TiledGroup): MultiRevisionFacts => {
  const jz = jointZ(geometry.spec.family);
  const courses = geometry.members.map((m) => ({
    vertexAId: `S${geometry.members.indexOf(m)}`,
    vertexBId: `S${geometry.members.indexOf(m) + 1}`,
    resolvedSource: {
      startX: m.start,
      startY: 0,
      endX: m.start + m.length,
      endY: 0,
      startZ: jz,
      endZ: jz,
      length: m.length,
      reoriented: false,
      isArc: false,
    },
  }));
  const intents = geometry.joints.map((jt) => ({
    policyVersion: 'trp1',
    jointId: jt.jointId,
    memberIds: [geometry.members[jt.memberL]!.id, geometry.members[jt.memberR]!.id],
    width: jt.width,
    lawKind: 'TRANSITION_LINEAR_V1',
    lawVersion: 'v1',
    criterionFamily: geometry.spec.family,
    side: geometry.side,
  }));
  const base = {
    sourceFeatureLineId: 'FL-20N',
    courses,
    side: geometry.side,
    criterion: geometry.members[0]!.criterion,
    maxSearchDistance: maxSearch(geometry.spec.family),
    curveChordTolerance: 0.1,
    cornerMode: 'miter' as const,
    closed: false,
    transitions: intents,
  };
  const hash = buildGroupRevision(base);
  const swapped = buildGroupRevision({ ...base, transitions: [...intents].reverse() });
  // Provenance: singular envelope today — inspect the length-1 citation shape only.
  const jt0 = geometry.joints[0]!;
  const at = (s: number): number => {
    const i = tiled.stations.indexOf(s);
    if (i < 0) throw new Error('leg checkpoint station not tiled');
    return i;
  };
  const triple = (arr: { x: number; y: number; z: number }[], s0: number, s1: number, s2: number): number[] => {
    const p = [arr[at(s0)]!, arr[at(s1)]!, arr[at(s2)]!];
    return [p[0]!.x, p[0]!.y, p[0]!.z, p[1]!.x, p[1]!.y, p[1]!.z, p[2]!.x, p[2]!.y, p[2]!.z];
  };
  const citation = transitionResultBakeCitation({
    policyVersion: 'trp1',
    lawKind: 'TRANSITION_LINEAR_V1',
    lawVersion: 'v1',
    width: jt0.width,
    joint: 0,
    jointId: jt0.jointId,
    memberIds: [geometry.members[jt0.memberL]!.id, geometry.members[jt0.memberR]!.id],
    criterionFamily: geometry.spec.family,
    side: geometry.side,
    interval: { sL: jt0.sL, sR: jt0.sR },
    endpointScalars: { vL: jt0.vL, vR: jt0.vR, gL: GRADE, gR: GRADE },
    jointStation: jt0.station,
    recordedRevision: hash,
    agreementCode: null,
    daylightCheckpoints: triple(tiled.daylight, jt0.station + jt0.sL, jt0.station, jt0.station + jt0.sR),
    sourceCheckpoints: triple(tiled.source, jt0.station + jt0.sL, jt0.station, jt0.station + jt0.sR),
  });
  return {
    hash,
    orderSensitive: swapped !== hash,
    stable: buildGroupRevision(base) === hash,
    citationLength: citation?.length ?? 0,
  };
};

export interface MultiRow {
  fixtureId: string;
  synthetic: true;
  study: 'candidate-A-mesh';
  family: MultiFamily;
  transitionCount: number;
  memberCount: number;
  memberLengths: number[];
  memberIds: string[];
  jointIds: string[];
  widths: number[];
  jointStations: number[];
  nativeGapsMeasured: number[];
  transform: MultiTransform;
  expected: string;
  measured: Record<string, number | string | boolean | number[] | string[] | boolean[] | null[]>;
  futurePredicateEligible: boolean;
}

/** Frozen fixture table: 6 core identity + 24 transforms + tiny + 4 negatives. */
export const MULTI_FIXTURES = ((): MultiFixtureSpec[] => {
  const specs: MultiFixtureSpec[] = [];
  const fams: MultiFamily[] = ['distance', 'relative-elevation', 'elevation'];
  for (const family of fams) {
    specs.push({ fixtureId: `candidateA2T-${family}-identity`, family, memberLengths: [30, 24, 30], widths: [8, 6], transform: 'identity', expected: 'admit-each + mesh + gtop2 + agreement', eligible: true });
    specs.push({ fixtureId: `candidateA3T-${family}-identity`, family, memberLengths: [30, 24, 26, 30], widths: [8, 6, 4], transform: 'identity', expected: 'admit-each + mesh + gtop2 + agreement', eligible: true });
  }
  const transforms: MultiTransform[] = ['mirror', 'reversal', 'translate-1e6', 'translate-1e8'];
  for (const family of fams) {
    for (const transform of transforms) {
      const tag = transform;
      specs.push({ fixtureId: `candidateA2T-${family}-${tag}`, family, memberLengths: [30, 24, 30], widths: [8, 6], transform, expected: 'transform-stable mesh + gtop2 + agreement', eligible: true });
      specs.push({ fixtureId: `candidateA3T-${family}-${tag}`, family, memberLengths: [30, 24, 26, 30], widths: [8, 6, 4], transform, expected: 'transform-stable mesh + gtop2 + agreement', eligible: true });
    }
  }
  specs.push({ fixtureId: 'candidateA2T-distance-tiny-gap', family: 'distance', memberLengths: [30, 7.0001, 30], widths: [8, 6], transform: 'identity', expected: 'tiny-positive native run meshes as one region', eligible: true });
  specs.push({ fixtureId: 'candidateA2T-distance-touching', family: 'distance', memberLengths: [30, 7, 30], widths: [8, 6], transform: 'identity', expected: 'touching-not-authorized', eligible: false });
  specs.push({ fixtureId: 'candidateA2T-distance-overlap', family: 'distance', memberLengths: [30, 5, 30], widths: [8, 6], transform: 'identity', expected: 'overlap-rejected', eligible: false });
  specs.push({ fixtureId: 'candidateA2T-distance-too-wide', family: 'distance', memberLengths: [30, 40, 30], widths: [70, 6], transform: 'identity', expected: 'width-infeasible-per-joint', eligible: false });
  specs.push({ fixtureId: 'candidateA2T-distance-zero-width', family: 'distance', memberLengths: [30, 24, 30], widths: [0, 6], transform: 'identity', expected: 'width-invalid-per-joint', eligible: false });
  return specs;
})();

/** Full Candidate A mesh corpus: REAL measured facts per row (no constants). */
export const candidateAMultiBuildCorpus = (): MultiRow[] =>
  MULTI_FIXTURES.map((spec) => {
    const base = {
      fixtureId: spec.fixtureId,
      synthetic: true as const,
      study: 'candidate-A-mesh' as const,
      family: spec.family,
      transitionCount: spec.widths.length,
      memberCount: spec.memberLengths.length,
      memberLengths: [...spec.memberLengths],
      memberIds: spec.memberLengths.map((_, i) => multiMemberId(i)),
      jointIds: spec.widths.map((_, j) => `joint:${j}`),
      widths: [...spec.widths],
      jointStations: [] as number[],
      nativeGapsMeasured: [] as number[],
      transform: spec.transform,
      expected: spec.expected,
      futurePredicateEligible: spec.eligible,
    };
    const out = buildMultiGroup(spec);
    if (!out.ok) {
      const negative: MultiRow = {
        ...base,
        measured: {
          stage: out.stage,
          code: out.code,
          meshBuilt: false,
          certIssued: false,
          validatorsRun: false,
        },
      };
      return negative;
    }
    const g = out.geometry;
    const tiled = tileMultiGroup(g);
    const mesh = meshAndCertifyMultiGroup(tiled);
    const revision = revisionFactsMultiGroup(g, tiled);
    const agreement = agreeMultiGroup(g, tiled, revision.hash);
    // Ownership verdict: unique owner per station; boundaries carry both endpoints.
    const ownerKinds = tiled.owners.map((o) => o.kind);
    const stationCount = tiled.stations.length;
    const gaps = g.intervals.slice(1).map((iv, k) => r12(iv.lo - g.intervals[k]!.hi));
    return {
      ...base,
      jointStations: g.joints.map((jt) => r12(jt.station)),
      nativeGapsMeasured: gaps,
      measured: {
        layoutOk: true,
        admitCodes: g.joints.map(() => 'ok').join(','),
        midScalars: g.joints.map((jt) => r12((jt.vL + jt.vR) / 2)),
        stationCount,
        transitionStations: ownerKinds.filter((k) => k === 'transition').length,
        boundaryStations: ownerKinds.filter((k) => k === 'boundary').length,
        nativeStations: ownerKinds.filter((k) => k === 'native').length,
        ownershipUnique: new Set(tiled.stations).size === stationCount,
        vertexCount: mesh.vertexCount,
        triangleCount: mesh.triangleCount,
        skippedZeroWidth: mesh.skippedZeroWidth,
        measuredPositiveWidthRegions: mesh.measuredPositiveWidthRegions,
        gtop2Components: mesh.components,
        gtop2BoundaryCycles: mesh.boundaryCycles,
        gtop2RevalidationNull: mesh.revalidationNull,
        meshValidatorCodes: agreement.meshValidator.map((c) => c ?? 'null'),
        groupAgreementOk: agreement.groupAgreement,
        c0PlanResidual: r12(tiled.c0Plan),
        c0ZResidual: r12(tiled.c0Z),
        revisionHash: revision.hash,
        revisionOrderSensitive: revision.orderSensitive,
        revisionStable: revision.stable,
        bakeCitationLength: revision.citationLength,
      },
    };
  });

export const candidateAMultiCorpusSha256 = (rows: readonly MultiRow[]): string =>
  createHash('sha256').update(JSON.stringify(rows)).digest('hex');
