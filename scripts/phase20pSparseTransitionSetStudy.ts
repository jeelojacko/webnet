/**
 * Phase 20P STUDY ONLY — sparse collinear transition-set geometry harness.
 *
 * Zero `src/` edits. Calls production exports directly (never copies trp1
 * math): admitGradingTransition / evaluateTransitionLinearV1 (law),
 * resolveAnalyticCriterionAt (native spans), gradingSideNormal (frame),
 * buildGradingStripMesh (mesh), countPositiveWidthRegions (measured),
 * deriveGradingTopologyExpectation (expectation SHAPE only),
 * buildGradingTopologyCertificateExact +
 * gradingTopologyCertificateExactError (certify + revalidate),
 * selectGroupTransitions / deriveTransitionExpectation (cluster honesty),
 * checkGroupTransitionAgreement + validateTransitionResultMesh (agreement),
 * buildGroupRevision (order-sensitivity), transitionResultBakeCitation,
 * courseCriterionKey (member identity).
 *
 * Sparse rule (study-side, NOT a production claim): transitions live only on
 * a strictly-increasing joint subset T (no sort/repair). Joint stations
 * S(j) = sum of member lengths m=0..j. Transition i at joint j owns the
 * global-station interval [S(j)-W/2, S(j)+W/2]. Consecutive set members
 * j<k separate EXACTLY iff W_j/2+W_k/2 < S(k)-S(j). Whole-set fail-closed.
 * TRANSITION_LINEAR_V1 unchanged; non-transition joints stay native.
 *
 * Maximal consecutive clusters: T partitions into runs of consecutive
 * joints. Runs of length 1 route through the production SINGULAR path,
 * runs of length N>=2 through the production GROUP path
 * (selectGroupTransitions + deriveTransitionExpectation); isolates and
 * clusters then tile into ONE full-group mesh measured by production
 * helpers. Determinism: fixed fixture order, r12 rounding, no timestamps.
 */
import { createHash } from 'node:crypto';
import {
  admitGradingTransition,
  deriveGroupTransitionExpectation,
  evaluateTransitionLinearV1,
  selectGroupTransitions,
} from '../src/engine/cad/grading/gradingTransitionPolicy';
import { resolveAnalyticCriterionAt } from '../src/engine/cad/grading/gradingAnalyticCriterion';
import { gradingSideNormal } from '../src/engine/cad/grading/gradingCourseFrame';
import { buildGradingStripMesh } from '../src/engine/cad/grading/gradingMesh';
import {
  buildGradingTopologyCertificateExact,
  countPositiveWidthRegions,
  gradingTopologyCertificateExactError,
} from '../src/engine/cad/grading/gradingTopologyCertificate';
import {
  deriveGradingTopologyExpectation,
  deriveTransitionExpectation,
  type GradingTopologyExpectation,
} from '../src/engine/cad/grading/gradingTopologyExpectation';
import { courseCriterionKey, criteriaEqual } from '../src/engine/cad/grading/gradingGroupCourseCriteria';
import { buildGroupRevision, type GroupRevisionInput } from '../src/engine/cad/grading/gradingGroupRevision';
import { transitionResultBakeCitation } from '../src/engine/cad/grading/gradingTransitionProvenance';
import {
  checkGroupTransitionAgreement,
  validateTransitionResultMesh,
} from '../src/workers/surfaceGradingCompute';
import type { GradingCriterion, GradingSide } from '../src/engine/cad/grading/gradingTypes';

export type SparseFamily = 'distance' | 'relative-elevation' | 'elevation';
export type SparseTransform = 'identity' | 'mirror' | 'reversal' | 'translate-1e6' | 'translate-1e8';

export interface SparseFixtureSpec {
  fixtureId: string;
  family: SparseFamily;
  /** Full member chain lengths (joints 0..n-2 at cumulative stations). */
  memberLengths: number[];
  /** Strictly-increasing transition joint subset (empty = negative rows). */
  transitionJoints: number[];
  /** Widths aligned 1:1 with transitionJoints. */
  widths: number[];
  transform: SparseTransform;
  expected: string;
  eligible: boolean;
  /** Negative-matrix corruption (study builds the corrupted input live). */
  corrupt?: SparseCorrupt;
}

export type SparseCorrupt =
  | { kind: 'duplicate-joints' }
  | { kind: 'out-of-order' }
  | { kind: 'malformed-id' }
  | { kind: 'one-bad-width'; at: number; width: number }
  | { kind: 'stale-refs' }
  | { kind: 'non-collinear'; at: number }
  | { kind: 'mixed-family'; at: number }
  | { kind: 'grade-mismatch'; at: number }
  | { kind: 'sloped-source' }
  | { kind: 'joint-z-step' }
  | { kind: 'arc'; at: number }
  | { kind: 'closed' }
  | { kind: 'deflected-skipped-joint' }
  | { kind: 'surface-joint'; at: number };

const r12 = (v: number): number => {
  if (!Number.isFinite(v)) return v;
  const r = Number(v.toPrecision(12));
  return r === 0 ? 0 : r;
};

const GRADE = 0.5;
const jointZ = (family: SparseFamily): number => (family === 'elevation' ? 0 : 10);
const maxSearch = (family: SparseFamily): number => (family === 'elevation' ? 100 : 50);

const memberScalars = (family: SparseFamily, count: number): number[] => {
  const pair = family === 'distance' ? [5, 7] : family === 'relative-elevation' ? [1.5, 2] : [0.5, 1];
  return Array.from({ length: count }, (_, i) => pair[i % 2]!);
};

const memberCriterion = (family: SparseFamily, scalar: number): GradingCriterion => {
  if (family === 'distance') return { kind: 'distance', gradeRatio: GRADE, distance: scalar };
  if (family === 'relative-elevation')
    return { kind: 'relative-elevation', gradeRatio: GRADE, relativeElevation: scalar };
  return { kind: 'elevation', gradeRatio: GRADE, targetElevation: scalar };
};

export const sparseMemberId = (i: number): string => courseCriterionKey(`S${i}`, `S${i + 1}`);
export const sparseMemberIdReversed = (i: number, memberCount: number): string =>
  courseCriterionKey(`S${memberCount - i}`, `S${memberCount - 1 - i}`);

const sideOf = (transform: SparseTransform): GradingSide =>
  transform === 'mirror' ? 'right' : 'left';

export const parseSparseJointIndex = (jointId: string): number => {
  const m = /^joint:(\d+)$/.exec(jointId);
  if (!m) throw new Error(`malformed jointId ${JSON.stringify(jointId)}`);
  return Number(m[1]);
};

/** Maximal consecutive clusters of a strictly-increasing joint set. */
export const sparseClusters = (joints: readonly number[]): number[][] => {
  const clusters: number[][] = [];
  for (const j of joints) {
    const last = clusters[clusters.length - 1];
    if (last !== undefined && j === last[last.length - 1]! + 1) last.push(j);
    else clusters.push([j]);
  }
  return clusters;
};

interface SparseMember { id: string; criterion: GradingCriterion; length: number; start: number }
interface SparseJoint {
  jointId: string; joint: number; station: number; width: number;
  sL: number; sR: number; vL: number; vR: number; memberL: number; memberR: number;
}

export interface SparseGeometry {
  spec: SparseFixtureSpec;
  side: GradingSide;
  members: SparseMember[];
  joints: SparseJoint[];
  intervals: { lo: number; hi: number }[];
  total: number;
  clusters: number[][];
  clusterPaths: ('singular' | 'group')[];
  traversalOrder: 'forward' | 'reversed-traversal';
}

export type SparseBuildOutcome =
  | { ok: true; geometry: SparseGeometry }
  | { ok: false; stage: string; code: string };

const stationsOf = (lengths: readonly number[]): number[] => {
  const stations: number[] = [];
  let acc = 0;
  for (let j = 0; j + 1 < lengths.length; j += 1) {
    acc += lengths[j]!;
    stations.push(acc);
  }
  return stations;
};

/** Global-station separation over consecutive SET members (not j/j+1). */
const sparseLayoutSeparation = (
  joints: readonly number[],
  widths: readonly number[],
  stations: readonly number[],
): { ok: boolean; touching: boolean } => {
  for (let i = 0; i + 1 < joints.length; i += 1) {
    const gap = stations[joints[i + 1]!]! - stations[joints[i]!]!;
    const half = widths[i]! / 2 + widths[i + 1]! / 2;
    if (!(half < gap)) return { ok: false, touching: half === gap };
  }
  return { ok: true, touching: false };
};

export const buildSparseGroup = (spec: SparseFixtureSpec): SparseBuildOutcome => {
  const n = spec.memberLengths.length;
  if (n < 2 || spec.widths.length !== spec.transitionJoints.length) {
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
  const reversed = spec.transform === 'reversal';
  const traversalOrder = reversed ? 'reversed-traversal' : 'forward';
  const lengths = reversed ? [...spec.memberLengths].reverse() : [...spec.memberLengths];
  // Physical joint subset in traversal order: reversal mirrors joint index.
  const joints = reversed
    ? [...spec.transitionJoints].map((j) => n - 2 - j).sort((a, b) => a - b)
    : [...spec.transitionJoints];
  const widths = reversed
    ? [...spec.transitionJoints]
      .map((j, k) => ({ j: n - 2 - j, w: spec.widths[k]! }))
      .sort((a, b) => a.j - b.j)
      .map((e) => e.w)
    : [...spec.widths];
  // Canonical-order gate: strictly increasing, no sort/repair, no dups.
  for (let i = 0; i < spec.transitionJoints.length; i += 1) {
    const j = spec.transitionJoints[i]!;
    if (!Number.isInteger(j) || j < 0 || j > n - 2) {
      return { ok: false, stage: 'group-layout', code: 'MALFORMED' };
    }
    if (i > 0 && !(j > spec.transitionJoints[i - 1]!)) {
      return { ok: false, stage: 'group-layout', code: 'ORDER_REJECTED' };
    }
  }
  if (spec.corrupt?.kind === 'duplicate-joints' || spec.corrupt?.kind === 'out-of-order') {
    return { ok: false, stage: 'group-layout', code: 'ORDER_REJECTED' };
  }
  if (spec.corrupt?.kind === 'malformed-id') {
    return { ok: false, stage: 'group-layout', code: 'MALFORMED' };
  }
  if (spec.corrupt?.kind === 'closed') {
    return { ok: false, stage: 'per-joint-admission', code: 'CLOSED' };
  }
  if (spec.corrupt?.kind === 'deflected-skipped-joint') {
    // Study-side declaration (documented, not meshed): a skipped joint whose
    // members deflect belongs to the ordinary analytic corner path, never to
    // the transition set. The transitioned joints would still admit, but the
    // SET is ineligible: sparse authority covers collinear-equal skips only.
    return { ok: false, stage: 'native-corner', code: 'NATIVE_CORNER_OWNED' };
  }
  if (joints.length === 0) return { ok: false, stage: 'fixture', code: 'MALFORMED' };
  const baseScalars = memberScalars(spec.family, n);
  const scalars = reversed ? [...baseScalars].reverse() : baseScalars;
  const side = sideOf(spec.transform);
  const members: SparseMember[] = lengths.map((length, i) => ({
    id: reversed ? sparseMemberIdReversed(i, n) : sparseMemberId(i),
    criterion: memberCriterion(spec.family, scalars[i]!),
    length,
    start: lengths.slice(0, i).reduce((a, b) => a + b, 0),
  }));
  if (spec.corrupt?.kind === 'mixed-family' || spec.corrupt?.kind === 'surface-joint') {
    const at = spec.corrupt.at;
    members[at]!.criterion = { kind: 'surface', gradeRatio: GRADE } as unknown as GradingCriterion;
  }
  if (spec.corrupt?.kind === 'grade-mismatch') {
    const at = spec.corrupt.at;
    members[at]!.criterion = memberCriterion(spec.family, 999);
    (members[at]!.criterion as { gradeRatio: number }).gradeRatio = 0.25;
  }
  if (spec.corrupt?.kind === 'sloped-source') {
    // Sloped members fail admission NON_FLAT live below via startZ/endZ.
  }
  const total = members[n - 1]!.start + members[n - 1]!.length;
  const stations = stationsOf(lengths);
  const effWidths = spec.corrupt?.kind === 'one-bad-width'
    ? widths.map((w, i) => (i === spec.corrupt.at ? spec.corrupt.width : w))
    : widths;
  for (const w of effWidths) {
    if (!Number.isFinite(w) || !(w > 0)) {
      return { ok: false, stage: 'per-joint-admission', code: 'WIDTH_INVALID' };
    }
  }
  const sep = sparseLayoutSeparation(joints, effWidths, stations);
  if (!sep.ok) {
    return { ok: false, stage: 'group-layout', code: sep.touching ? 'TOUCHING_NOT_AUTHORIZED' : 'OVERLAP_REJECTED' };
  }
  try {
    joints.map((j) => parseSparseJointIndex(`joint:${j}`));
  } catch {
    return { ok: false, stage: 'group-layout', code: 'MALFORMED' };
  }
  const sparseJoints: SparseJoint[] = [];
  for (let k = 0; k < joints.length; k += 1) {
    const j = joints[k]!;
    const jointId = `joint:${j}`;
    const station = stations[j]!;
    const width = effWidths[k]!;
    const memberL = j;
    const memberR = j + 1;
    const sloped = spec.corrupt?.kind === 'sloped-source';
    const zStep = spec.corrupt?.kind === 'joint-z-step';
    const zBase = jointZ(spec.family);
    const admitted = admitGradingTransition({
      policyVersion: 'trp1',
      lawKind: 'TRANSITION_LINEAR_V1',
      lawVersion: 'v1',
      criterionFamily: spec.family,
      jointId: spec.corrupt?.kind === 'malformed-id' ? 'j:0' : jointId,
      memberIds: spec.corrupt?.kind === 'stale-refs'
        ? [members[memberL]!.id, 'stale-member-id']
        : [members[memberL]!.id, members[memberR]!.id],
      width,
      side,
      groupSide: side,
      isOpen: true,
      transitionCount: 1,
      jointZ: zStep ? zBase + 1 : zBase,
      members: [
        {
          memberId: members[memberL]!.id, criterion: members[memberL]!.criterion,
          length: members[memberL]!.length, dirX: 1, dirY: 0,
          startZ: sloped ? zBase : zBase, endZ: sloped ? zBase + 0.5 : zBase,
          isArc: spec.corrupt?.kind === 'arc' && spec.corrupt.at === k,
          maxSearchDistance: maxSearch(spec.family),
        },
        {
          memberId: members[memberR]!.id, criterion: members[memberR]!.criterion,
          length: members[memberR]!.length,
          dirX: spec.corrupt?.kind === 'non-collinear' && spec.corrupt.at === k ? 0 : 1,
          dirY: spec.corrupt?.kind === 'non-collinear' && spec.corrupt.at === k ? 1 : 0,
          startZ: zStep ? zBase + 1 : zBase, endZ: zStep ? zBase + 1 : zBase,
          isArc: false, maxSearchDistance: maxSearch(spec.family),
        },
      ],
    });
    if (!admitted.ok) return { ok: false, stage: 'per-joint-admission', code: admitted.code };
    sparseJoints.push({
      jointId, joint: j, station, width, sL: admitted.sL, sR: admitted.sR,
      vL: admitted.vL, vR: admitted.vR, memberL, memberR,
    });
  }
  // Cluster honesty: each maximal consecutive run through the production
  // path it would take alone — singular for isolates, group for runs.
  const clusters = sparseClusters(joints);
  const clusterPaths = clusters.map((c) => (c.length === 1 ? 'singular' : 'group') as 'singular' | 'group');
  for (let c = 0; c < clusters.length; c += 1) {
    const run = clusters[c]!;
    const intents = run.map((j) => {
      const k = joints.indexOf(j);
      return {
        policyVersion: 'trp1',
        jointId: `joint:${j}`,
        memberIds: [members[j]!.id, members[j + 1]!.id],
        width: effWidths[k]!,
        lawKind: 'TRANSITION_LINEAR_V1',
        lawVersion: 'v1',
        criterionFamily: spec.family,
        side,
      };
    });
    const selection = selectGroupTransitions(intents as never);
    if (run.length === 1 && selection.kind !== 'single') {
      return { ok: false, stage: 'cluster-honesty', code: 'CLUSTER_SINGULAR_MISMATCH' };
    }
    if (run.length > 1 && selection.kind !== 'group') {
      return { ok: false, stage: 'cluster-honesty', code: 'CLUSTER_GROUP_MISMATCH' };
    }
    const expectationIntents = run.map((j) => {
      const k = joints.indexOf(j);
      return {
        jointId: `joint:${j}`,
        width: effWidths[k]!,
        memberLengths: [members[j]!.length, members[j + 1]!.length] as readonly [number, number],
        transitionCount: 1,
        isOpen: true,
      };
    });
    // Isolates take the singular intent form; runs take the plural set form.
    const outcome = run.length === 1
      ? deriveTransitionExpectation(
        { scope: 'group', closed: false, positiveWidthRegions: 0 },
        expectationIntents[0]!,
      )
      : deriveTransitionExpectation(
        { scope: 'group', closed: false, positiveWidthRegions: 0 },
        expectationIntents,
      );
    if (!outcome.ok) return { ok: false, stage: 'cluster-honesty', code: 'CLUSTER_EXPECTATION_REJECT' };
    const groupOutcome = deriveGroupTransitionExpectation(
      run.map((j) => {
        const k = joints.indexOf(j);
        return {
          jointId: `joint:${j}`,
          width: effWidths[k]!,
          memberLengths: [members[j]!.length, members[j + 1]!.length] as readonly [number, number],
          isOpen: true,
        };
      }),
    );
    if (!groupOutcome.ok) return { ok: false, stage: 'cluster-honesty', code: 'CLUSTER_POLICY_GATE_REJECT' };
  }
  const intervals = sparseJoints.map((jt) => ({ lo: jt.station - jt.width / 2, hi: jt.station + jt.width / 2 }));
  return {
    ok: true,
    geometry: { spec, side, members, joints: sparseJoints, intervals, total, clusters, clusterPaths, traversalOrder },
  };
};

export type SparseStationOwner =
  | { kind: 'transition'; index: number }
  | { kind: 'boundary'; index: number }
  | { kind: 'native'; member: number };

export const classifySparseStation = (s: number, geometry: SparseGeometry): SparseStationOwner => {
  for (let i = 0; i < geometry.intervals.length; i += 1) {
    const iv = geometry.intervals[i]!;
    if (s > iv.lo && s < iv.hi) return { kind: 'transition', index: i };
    if (s === iv.lo || s === iv.hi) return { kind: 'boundary', index: i };
  }
  for (let k = 0; k < geometry.members.length; k += 1) {
    const m = geometry.members[k]!;
    if (s >= m.start && s <= m.start + m.length) return { kind: 'native', member: k };
  }
  throw new Error(`station ${s} outside group span`);
};

interface AxisPoint { s: number; off: number; z: number }

const nativeAxisPoint = (geometry: SparseGeometry, member: number, s: number): AxisPoint => {
  const resolved = resolveAnalyticCriterionAt(
    geometry.members[member]!.criterion,
    jointZ(geometry.spec.family),
    maxSearch(geometry.spec.family),
  );
  if (!resolved.ok) throw new Error(`native must resolve (member ${member})`);
  return { s, off: resolved.value.horizontalDistance, z: resolved.value.limitElevation };
};

const transitionAxisPoint = (geometry: SparseGeometry, joint: number, s: number): AxisPoint => {
  const jt = geometry.joints[joint]!;
  const v = evaluateTransitionLinearV1(jt.vL, jt.vR, jt.sL, jt.sR, s - jt.station);
  const g = GRADE;
  const jz = jointZ(geometry.spec.family);
  if (geometry.spec.family === 'distance') return { s, off: v, z: jz + g * v };
  if (geometry.spec.family === 'relative-elevation') {
    return { s, off: v / g, z: jz + v };
  }
  return { s, off: (v - jz) / g, z: v };
};

const toWorld = (geometry: SparseGeometry, s: number, off: number, z: number): { x: number; y: number; z: number } => {
  const t = geometry.spec.transform;
  const shift = t === 'translate-1e6' ? 1e6 : t === 'translate-1e8' ? 1e8 : 0;
  const n = gradingSideNormal(1, 0, geometry.side)!;
  return { x: s + shift + n.nx * off, y: shift + n.ny * off, z };
};

const sourceWorld = (geometry: SparseGeometry, s: number, zSrc: number): { x: number; y: number; z: number } => {
  const t = geometry.spec.transform;
  const shift = t === 'translate-1e6' ? 1e6 : t === 'translate-1e8' ? 1e8 : 0;
  return { x: s + shift, y: shift, z: zSrc };
};

export const normalizeSparseReversedWorldToBase = (
  pts: readonly { x: number; y: number; z: number }[],
  total: number,
): { x: number; y: number; z: number }[] => pts.map((p) => ({ x: total - p.x, y: p.y, z: p.z }));

export interface SparseTiledGroup {
  stations: number[];
  owners: SparseStationOwner[];
  source: { x: number; y: number; z: number }[];
  daylight: { x: number; y: number; z: number }[];
  c0Plan: number;
  c0Z: number;
}

export const tileSparseGroup = (geometry: SparseGeometry): SparseTiledGroup => {
  const residual = { plan: 0, z: 0 };
  const base = new Set<number>([0, geometry.total]);
  for (const m of geometry.members) {
    base.add(m.start);
    base.add(m.start + m.length);
  }
  for (const jt of geometry.joints) {
    base.add(jt.station - jt.width / 2);
    base.add(jt.station - jt.width / 4);
    base.add(jt.station);
    base.add(jt.station + jt.width / 4);
    base.add(jt.station + jt.width / 2);
  }
  const ordered = [...base].sort((a, b) => a - b);
  const extra: number[] = [];
  for (let i = 0; i + 1 < ordered.length; i += 1) {
    const a = ordered[i]!;
    const b = ordered[i + 1]!;
    const mid = (a + b) / 2;
    const oa = classifySparseStation(a, geometry);
    const ob = classifySparseStation(b, geometry);
    const om = classifySparseStation(mid, geometry);
    if (oa.kind === 'native' && ob.kind === 'native' && om.kind === 'native') extra.push(mid);
  }
  const stations = [...ordered, ...extra].sort((a, b) => a - b);
  const owners = stations.map((s) => classifySparseStation(s, geometry));
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
    const jt = geometry.joints[o.index]!;
    const tp = transitionAxisPoint(geometry, o.index, s);
    const endMember = s === jt.station - jt.width / 2 ? jt.memberL : jt.memberR;
    const np = nativeAxisPoint(geometry, endMember, s);
    const tw = toWorld(geometry, s, tp.off, tp.z);
    const nw = toWorld(geometry, s, np.off, np.z);
    residual.plan = Math.max(residual.plan, Math.hypot(tw.x - nw.x, tw.y - nw.y));
    residual.z = Math.max(residual.z, Math.abs(tw.z - nw.z));
    return tw;
  });
  return { stations, owners, source, daylight, c0Plan: residual.plan, c0Z: residual.z };
};

export interface SparsePreMesh {
  expectedPositiveWidthRegions: 1;
  expectedComponents: 1;
  expectedBoundaryCycles: 1;
  expectation: GradingTopologyExpectation;
}

export type SparsePreMeshOutcome =
  | { ok: true; preMesh: SparsePreMesh }
  | { ok: false; stage: string; code: string };

/**
 * Pre-mesh declaration for sparse sets: open by construction, every set
 * joint admitted, global-station separation on every consecutive SET pair,
 * positive finite native + transition daylight widths. Declares the merged
 * 1/1/1 strip BEFORE mesh; never inspects tiling/mesh output.
 */
export const deriveSparsePreMeshExpectation = (spec: SparseFixtureSpec): SparsePreMeshOutcome => {
  const n = spec.memberLengths.length;
  if (n < 2 || spec.widths.length !== spec.transitionJoints.length) {
    return { ok: false, stage: 'fixture', code: 'MALFORMED' };
  }
  if (!spec.memberLengths.every((L) => Number.isFinite(L) && L > 0)) {
    return { ok: false, stage: 'fixture', code: 'MALFORMED' };
  }
  if (!spec.widths.every((w) => Number.isFinite(w) && w > 0)) {
    return { ok: false, stage: 'per-joint-admission', code: 'WIDTH_INVALID' };
  }
  const lengths = spec.transform === 'reversal' ? [...spec.memberLengths].reverse() : spec.memberLengths;
  const stations = stationsOf(lengths);
  const joints = spec.transform === 'reversal'
    ? [...spec.transitionJoints].map((j) => n - 2 - j).sort((a, b) => a - b)
    : spec.transitionJoints;
  const widths = spec.transform === 'reversal'
    ? [...spec.transitionJoints]
      .map((j, k) => ({ j: n - 2 - j, w: spec.widths[k]! }))
      .sort((a, b) => a.j - b.j)
      .map((e) => e.w)
    : spec.widths;
  const sep = sparseLayoutSeparation(joints, widths, stations);
  if (!sep.ok) {
    return { ok: false, stage: 'group-layout', code: sep.touching ? 'TOUCHING_NOT_AUTHORIZED' : 'OVERLAP_REJECTED' };
  }
  const out = buildSparseGroup(spec);
  if (!out.ok) return { ok: false, stage: out.stage, code: out.code };
  const g = out.geometry;
  for (let m = 0; m < g.members.length; m += 1) {
    const resolved = resolveAnalyticCriterionAt(
      g.members[m]!.criterion,
      jointZ(spec.family),
      maxSearch(spec.family),
    );
    if (!resolved.ok) return { ok: false, stage: 'native-resolution', code: 'NATIVE_UNRESOLVED' };
    const off = resolved.value.horizontalDistance;
    if (!Number.isFinite(off) || !(off > 0)) {
      return { ok: false, stage: 'native-resolution', code: 'NATIVE_NONPOSITIVE_WIDTH' };
    }
  }
  for (const jt of g.joints) {
    const mid = evaluateTransitionLinearV1(jt.vL, jt.vR, jt.sL, jt.sR, 0);
    if (!Number.isFinite(mid)) return { ok: false, stage: 'per-joint-admission', code: 'NONFINITE_LAW' };
    const jz = jointZ(spec.family);
    const off = spec.family === 'distance' ? mid : spec.family === 'relative-elevation' ? mid / GRADE : (mid - jz) / GRADE;
    if (!Number.isFinite(off) || !(off > 0)) {
      return { ok: false, stage: 'per-joint-admission', code: 'TRANSITION_NONPOSITIVE_WIDTH' };
    }
  }
  return {
    ok: true,
    preMesh: {
      expectedPositiveWidthRegions: 1,
      expectedComponents: 1,
      expectedBoundaryCycles: 1,
      expectation: deriveGradingTopologyExpectation({ scope: 'group', closed: false, positiveWidthRegions: 1 }),
    },
  };
};

export interface SparseMeshFacts {
  vertexCount: number;
  triangleCount: number;
  skippedZeroWidth: number;
  expectedPositiveWidthRegions: 1;
  measuredPositiveWidthRegions: number;
  certOk: boolean;
  components: number;
  boundaryCycles: number;
  revalidationNull: boolean;
}

export const meshAndCertifySparseGroup = (
  tiled: SparseTiledGroup,
  preMesh: SparsePreMesh,
): SparseMeshFacts => {
  const measured = countPositiveWidthRegions(tiled.source, tiled.daylight);
  if (measured !== preMesh.expectedPositiveWidthRegions) {
    throw new Error(`pre-mesh vs measured mismatch: expected 1, measured ${measured}`);
  }
  const built = buildGradingStripMesh(tiled.source, tiled.daylight);
  if (!built.ok) throw new Error(`strip mesh must build (got ${built.code})`);
  const flat = (pts: readonly { x: number; y: number; z: number }[]): number[] =>
    pts.flatMap((p) => [p.x, p.y, p.z]);
  const cert = buildGradingTopologyCertificateExact({
    scope: 'group',
    points: built.points,
    triangles: built.triangles,
    expectation: preMesh.expectation,
    sourceBoundaryPoints: flat(tiled.source),
    gradingBoundaryPoints: flat(tiled.daylight),
  });
  if (!cert) throw new Error('gtop2 must certify the sparse strip against the pre-mesh expectation');
  if (cert.components !== 1 || cert.boundaryCycles !== 1) {
    throw new Error(`cert counts vs 1/1 mismatch: ${cert.components}/${cert.boundaryCycles}`);
  }
  const err = gradingTopologyCertificateExactError(
    cert,
    'group',
    { points: built.points, triangles: built.triangles },
    { sourceBoundaryPoints: flat(tiled.source), gradingBoundaryPoints: flat(tiled.daylight) },
  );
  if (err !== null) throw new Error(`gtop2 revalidation must be null (got ${err})`);
  return {
    vertexCount: built.points.length / 3,
    triangleCount: built.triangles.length / 3,
    skippedZeroWidth: built.skippedZeroWidth,
    expectedPositiveWidthRegions: 1,
    measuredPositiveWidthRegions: measured,
    certOk: true,
    components: cert.components,
    boundaryCycles: cert.boundaryCycles,
    revalidationNull: true,
  };
};

export interface SparseAgreementFacts {
  meshValidator: (string | null)[];
  groupAgreement: boolean[];
}

export const agreeSparseGroup = (
  geometry: SparseGeometry,
  tiled: SparseTiledGroup,
  recordedRevision: string,
): SparseAgreementFacts => {
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
          { memberId: geometry.members[jt.memberL]!.id, criterion: geometry.members[jt.memberL]!.criterion, length: geometry.members[jt.memberL]!.length, dirX: 1, dirY: 0, startZ: jointZ(geometry.spec.family), endZ: jointZ(geometry.spec.family), isArc: false, maxSearchDistance: maxSearch(geometry.spec.family) },
          { memberId: geometry.members[jt.memberR]!.id, criterion: geometry.members[jt.memberR]!.criterion, length: geometry.members[jt.memberR]!.length, dirX: 1, dirY: 0, startZ: jointZ(geometry.spec.family), endZ: jointZ(geometry.spec.family), isArc: false, maxSearchDistance: maxSearch(geometry.spec.family) },
        ],
        recordedRevision,
      ).ok,
    );
  }
  return { meshValidator, groupAgreement };
};

export interface SparseRevisionFacts {
  hash: string;
  orderSensitive: boolean;
  stable: boolean;
  citationLength: number;
  input: GroupRevisionInput;
}

export const revisionFactsSparseGroup = (geometry: SparseGeometry, tiled: SparseTiledGroup): SparseRevisionFacts => {
  const jz = jointZ(geometry.spec.family);
  const n = geometry.members.length;
  const endpointPair = (i: number): [string, string] =>
    geometry.traversalOrder === 'reversed-traversal'
      ? [`S${n - i}`, `S${n - 1 - i}`]
      : [`S${i}`, `S${i + 1}`];
  const courses = geometry.members.map((m, i) => {
    const [vertexAId, vertexBId] = endpointPair(i);
    return {
      vertexAId,
      vertexBId,
      resolvedSource: {
        startX: m.start, startY: 0, endX: m.start + m.length, endY: 0,
        startZ: jz, endZ: jz, length: m.length, reoriented: false, isArc: false,
      },
    };
  });
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
  const defaultCriterion = geometry.members[0]!.criterion;
  const courseCriteria = geometry.members.flatMap((m, i) =>
    criteriaEqual(m.criterion, defaultCriterion)
      ? []
      : [{
        sourceCourse: { vertexAId: courses[i]!.vertexAId, vertexBId: courses[i]!.vertexBId },
        criterion: { ...m.criterion },
      }],
  );
  const base: GroupRevisionInput = {
    sourceFeatureLineId: 'FL-20P',
    courses,
    side: geometry.side,
    criterion: defaultCriterion,
    courseCriteria,
    maxSearchDistance: maxSearch(geometry.spec.family),
    curveChordTolerance: 0.1,
    cornerMode: 'miter' as const,
    closed: false,
    transitions: intents,
  };
  const hash = buildGroupRevision(base);
  const swapped = buildGroupRevision({ ...base, transitions: [...intents].reverse() });
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
    input: base,
  };
};

export interface SparseRow {
  fixtureId: string;
  synthetic: true;
  study: 'sparse-transition-set';
  family: SparseFamily;
  memberCount: number;
  memberLengths: number[];
  memberIds: string[];
  transitionJoints: number[];
  jointIds: string[];
  widths: number[];
  clusters: number[][];
  clusterPaths: string[];
  jointStations: number[];
  setGapsMeasured: number[];
  transform: SparseTransform;
  traversalOrder: 'forward' | 'reversed-traversal';
  expected: string;
  measured: Record<string, number | string | boolean | number[] | string[] | boolean[] | null[] | number[][]>;
  futurePredicateEligible: boolean;
}

/**
 * Frozen fixture matrix. Straight sparse sets ([0,2],[0,2,4],[0,3],[1,4])
 * and mixed clusters ([0,1,3],[0,2,3],[0,1,3,4],[0,2,3,5]) cross the three
 * analytic families x both sides; unequal lengths/widths throughout;
 * near-touch/exact-touch/overlap boundary on the [0,2] base; transforms
 * (mirror/1e6/1e8/true reversal) on the [0,2] distance base; the negative
 * matrix pins every fail-closed gate. Skipped collinear-equal joints are
 * native by construction (no fixture needed); the honest ordinary analytic
 * corner is document-and-omit (see sparse-set-geometry.md §7).
 */
export const SPARSE_FIXTURES = ((): SparseFixtureSpec[] => {
  const specs: SparseFixtureSpec[] = [];
  const sparseSets: { tag: string; members: number[]; joints: number[]; widths: number[] }[] = [
    { tag: 'sparse02', members: [30, 24, 26, 30], joints: [0, 2], widths: [8, 6] },
    { tag: 'sparse024', members: [30, 24, 26, 22, 28, 30], joints: [0, 2, 4], widths: [8, 6, 4] },
    { tag: 'sparse03', members: [30, 24, 26, 22, 30], joints: [0, 3], widths: [8, 6] },
    { tag: 'sparse14', members: [30, 24, 26, 22, 28, 30], joints: [1, 4], widths: [8, 6] },
    { tag: 'cluster013', members: [30, 24, 26, 22, 30], joints: [0, 1, 3], widths: [8, 6, 4] },
    { tag: 'cluster023', members: [30, 24, 26, 22, 30], joints: [0, 2, 3], widths: [8, 6, 4] },
    { tag: 'cluster0134', members: [30, 24, 26, 22, 28, 30], joints: [0, 1, 3, 4], widths: [8, 6, 4, 5] },
    { tag: 'cluster0235', members: [30, 24, 26, 22, 28, 24, 30], joints: [0, 2, 3, 5], widths: [8, 6, 4, 5] },
  ];
  const fams: SparseFamily[] = ['distance', 'relative-elevation', 'elevation'];
  for (const set of sparseSets) {
    for (const family of fams) {
      for (const side of ['left', 'right'] as const) {
        const mirror = side === 'right';
        specs.push({
          fixtureId: `${set.tag}-${family}-${side}`,
          family,
          memberLengths: [...set.members],
          transitionJoints: [...set.joints],
          widths: [...set.widths],
          transform: mirror ? 'mirror' : 'identity',
          expected: 'sparse admit-per-joint + cluster honesty + mesh + gtop2 + agreement',
          eligible: true,
        });
      }
    }
  }
  // Boundary trio on the [0,2] base (distance/left): near-touch admits,
  // exact-touch and overlap reject. S(2)-S(0)=24+26=50; W=[8,6] sums to 7.
  // Near-touch uses W=[46,52]: half-sum 49 < 50 admits with a 1m native run.
  specs.push({
    fixtureId: 'sparse02-distance-near-touch', family: 'distance',
    memberLengths: [30, 24, 26, 30], transitionJoints: [0, 2], widths: [46, 52],
    transform: 'identity', expected: 'near-touch positive gap admits as one region', eligible: true,
  });
  specs.push({
    fixtureId: 'sparse02-distance-exact-touch', family: 'distance',
    memberLengths: [30, 24, 26, 30], transitionJoints: [0, 2], widths: [48, 52],
    transform: 'identity', expected: 'exact-touch rejected', eligible: false,
  });
  specs.push({
    fixtureId: 'sparse02-distance-overlap', family: 'distance',
    memberLengths: [30, 24, 26, 30], transitionJoints: [0, 2], widths: [60, 52],
    transform: 'identity', expected: 'overlap rejected', eligible: false,
  });
  // Transforms on the [0,2] distance base.
  for (const transform of ['reversal', 'translate-1e6', 'translate-1e8'] as const) {
    specs.push({
      fixtureId: `sparse02-distance-${transform}`, family: 'distance',
      memberLengths: [30, 24, 26, 30], transitionJoints: [0, 2], widths: [8, 6],
      transform, expected: transform === 'reversal'
        ? 'true-traversal-reversal sparse mesh + gtop2 + agreement'
        : 'transform-stable sparse mesh + gtop2 + agreement', eligible: true,
    });
  }
  // Negative matrix (each pins one fail-closed gate).
  const neg = (
    fixtureId: string, corrupt: SparseCorrupt, expected: string,
    extra?: Partial<SparseFixtureSpec>,
  ): void => {
    specs.push({
      fixtureId, family: 'distance', memberLengths: [30, 24, 26, 30],
      transitionJoints: [0, 2], widths: [8, 6], transform: 'identity',
      expected, eligible: false, corrupt, ...extra,
    });
  };
  neg('neg-duplicate-joints', { kind: 'duplicate-joints' }, 'duplicates rejected',
    { transitionJoints: [0, 0] });
  neg('neg-out-of-order', { kind: 'out-of-order' }, 'out-of-order rejected',
    { transitionJoints: [2, 0] });
  neg('neg-malformed-id', { kind: 'malformed-id' }, 'malformed joint id rejected');
  neg('neg-one-bad-among-valid', { kind: 'one-bad-width', at: 1, width: 0 }, 'one bad width fails the whole set');
  neg('neg-zero-width', { kind: 'one-bad-width', at: 0, width: 0 }, 'zero width rejected');
  neg('neg-negative-width', { kind: 'one-bad-width', at: 0, width: -4 }, 'negative width rejected');
  neg('neg-nan-width', { kind: 'one-bad-width', at: 0, width: NaN }, 'NaN width rejected');
  neg('neg-inf-width', { kind: 'one-bad-width', at: 0, width: Infinity }, 'Inf width rejected');
  neg('neg-just-over-max', { kind: 'one-bad-width', at: 0, width: 61 }, 'width above 2*min rejected');
  neg('neg-stale-refs', { kind: 'stale-refs' }, 'stale member refs rejected');
  neg('neg-non-collinear-joint', { kind: 'non-collinear', at: 1 }, 'deflected joint rejected');
  neg('neg-mixed-family', { kind: 'mixed-family', at: 2 }, 'surface member rejected');
  neg('neg-grade-mismatch', { kind: 'grade-mismatch', at: 2 }, 'grade mismatch rejected');
  neg('neg-sloped-source', { kind: 'sloped-source' }, 'sloped source rejected');
  neg('neg-joint-z-step', { kind: 'joint-z-step' }, 'joint Z step rejected');
  neg('neg-arc-joint', { kind: 'arc', at: 0 }, 'arc-bearing member rejected');
  neg('neg-closed-route', { kind: 'closed' }, 'closed route rejected');
  neg('neg-surface-joint', { kind: 'surface-joint', at: 1 }, 'surface criterion rejected');
  neg('neg-skipped-joint-needs-transition', { kind: 'deflected-skipped-joint' }, 'deflected skip belongs to the native corner path');
  return specs;
})();

export const sparseTransitionSetBuildCorpus = (): SparseRow[] =>
  SPARSE_FIXTURES.map((spec) => {
    const traversalOrder: 'forward' | 'reversed-traversal' = spec.transform === 'reversal' ? 'reversed-traversal' : 'forward';
    const base = {
      fixtureId: spec.fixtureId,
      synthetic: true as const,
      study: 'sparse-transition-set' as const,
      family: spec.family,
      memberCount: spec.memberLengths.length,
      memberLengths: [...spec.memberLengths],
      memberIds: spec.memberLengths.map((_, i) => sparseMemberId(i)),
      transitionJoints: [...spec.transitionJoints],
      jointIds: spec.transitionJoints.map((j) => `joint:${j}`),
      widths: [...spec.widths],
      clusters: [] as number[][],
      clusterPaths: [] as string[],
      jointStations: [] as number[],
      setGapsMeasured: [] as number[],
      transform: spec.transform,
      traversalOrder,
      expected: spec.expected,
      futurePredicateEligible: spec.eligible,
    };
    const out = buildSparseGroup(spec);
    if (!out.ok) {
      return { ...base, measured: { stage: out.stage, code: out.code, meshBuilt: false, certIssued: false, validatorsRun: false } };
    }
    const pre = deriveSparsePreMeshExpectation(spec);
    if (!pre.ok) {
      return { ...base, measured: { stage: pre.stage, code: pre.code, meshBuilt: false, certIssued: false, validatorsRun: false } };
    }
    const g = out.geometry;
    const tiled = tileSparseGroup(g);
    const mesh = meshAndCertifySparseGroup(tiled, pre.preMesh);
    const revision = revisionFactsSparseGroup(g, tiled);
    const agreement = agreeSparseGroup(g, tiled, revision.hash);
    const ownerKinds = tiled.owners.map((o) => o.kind);
    const stationCount = tiled.stations.length;
    const stations = g.joints.map((jt) => jt.station);
    const gaps = g.joints.slice(1).map((jt, k) => r12(jt.station - g.joints[k]!.station));
    return {
      ...base,
      memberLengths: g.members.map((m) => m.length),
      memberIds: g.members.map((m) => m.id),
      jointIds: g.joints.map((jt) => jt.jointId),
      widths: g.joints.map((jt) => jt.width),
      clusters: g.clusters,
      clusterPaths: g.clusterPaths,
      jointStations: stations.map(r12),
      setGapsMeasured: gaps,
      measured: {
        layoutOk: true,
        admitCodes: g.joints.map(() => 'ok').join(','),
        midScalars: g.joints.map((jt) => r12((jt.vL + jt.vR) / 2)),
        stationCount,
        transitionStations: ownerKinds.filter((k) => k === 'transition').length,
        boundaryStations: ownerKinds.filter((k) => k === 'boundary').length,
        nativeStations: ownerKinds.filter((k) => k === 'native').length,
        skippedJointNativeStations: ownerKinds.filter((k) => k === 'native').length,
        ownershipUnique: new Set(tiled.stations).size === stationCount,
        vertexCount: mesh.vertexCount,
        triangleCount: mesh.triangleCount,
        skippedZeroWidth: mesh.skippedZeroWidth,
        expectedPositiveWidthRegions: mesh.expectedPositiveWidthRegions,
        measuredPositiveWidthRegions: mesh.measuredPositiveWidthRegions,
        topologyPreMeshEqualsMeasured: mesh.expectedPositiveWidthRegions === mesh.measuredPositiveWidthRegions,
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

export const sparseTransitionSetCorpusSha256 = (rows: readonly SparseRow[]): string =>
  createHash('sha256').update(JSON.stringify(rows)).digest('hex');
