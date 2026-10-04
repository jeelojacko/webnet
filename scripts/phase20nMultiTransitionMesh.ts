/**
 * Phase 20N Candidate A — REAL shared-member 2T/3T full-group mesh evidence.
 *
 * STUDY / EVIDENCE ONLY. Zero `src/` edits. Every valid row below builds
 * full-group geometry over REAL shared members, tiles actual source/daylight
 * polylines, triangulates with production `buildGradingStripMesh`, certifies
 * with production gtop2, revalidates exactly, and runs production worker
 * agreement validators per transition.
 *
 * Production authorities reused read-only (never copied, never re-derived):
 * admitGradingTransition / evaluateTransitionLinearV1 (law),
 * resolveAnalyticCriterionAt (native spans), gradingSideNormal (frame),
 * buildGradingStripMesh (mesh), countPositiveWidthRegions (measured regions),
 * deriveGradingTopologyExpectation (expectation SHAPE only — the region COUNT
 * is declared by the study pre-mesh predicate below, never fed from measured),
 * buildGradingTopologyCertificateExact +
 * gradingTopologyCertificateExactError (certify + revalidate),
 * validateTransitionResultMesh + checkGroupTransitionAgreement (agreement),
 * buildGroupRevision (order-sensitivity), transitionResultBakeCitation
 * (singular-today inspection), courseCriterionKey (member identity).
 *
 * Topology independence (external review #2, defect 1):
 * 1/1/1 is DECLARED by the bounded candidate predicate BEFORE mesh via
 * `deriveCandidateAPreMeshExpectation(spec)` — derived ONLY from the fixture
 * structure + per-joint admission + strict separation + positive finite
 * native/transition widths — then INDEPENDENTLY measured
 * (`countPositiveWidthRegions` after tiling) and certified (gtop2 against
 * the pre-mesh expectation). `meshAndCertifyMultiGroup` takes the pre-mesh
 * expectation as input, asserts measured == expected BEFORE certifying, and
 * rejects (throws) on mismatch. It is no longer derived from observed count.
 *
 * True traversal reversal (external review #2, defect 2 — PATH B1):
 * `transform: 'reversal'` is a genuine production-like traversal reversal:
 * the source path S0->S1->..->Sn is re-traversed Sn->..->S0, the member
 * array is REBUILT in reversed traversal order with production
 * `courseCriterionKey` reversed endpoint pairs, criteria follow their
 * physical members, directions restart at +x, stations recompute from 0,
 * joints REINDEX `joint:0..` in reversed traversal order, and widths map to
 * their physical joints in reverse order. The reversed fixture then builds /
 * tiles / meshes / certifies / validates exactly as identity. Comparison
 * normalizes reversed world geometry back (`normalizeReversedWorldToBase`:
 * x -> total - x) and compares as continuous polylines under the existing
 * production agreement authorities. ggrev1 legitimately differs (member IDs
 * change) and is NOT required to match.
 *
 * Deliberate study-side rules (NOT production claims):
 * - strict-separation layout predicate over real middle-member lengths;
 * - per-station owner classifier (transition i / boundary / native);
 * - canonical joint-index order (never silently sorted);
 * - deriveTransitionExpectation is NOT used for N>1: it REJECTS
 *   transitionCount!==1 by design (pinned in tests).
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
import {
  deriveGradingTopologyExpectation,
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

/**
 * Reversed-traversal member identity: production `courseCriterionKey` with
 * reversed endpoint pairs for S0->..->Sn re-traversed Sn->..->S0.
 * New index i covers S(n-i)->S(n-1-i).
 */
export const multiMemberIdReversed = (i: number, memberCount: number): string =>
  courseCriterionKey(`S${memberCount - i}`, `S${memberCount - 1 - i}`);

const sideOf = (transform: MultiTransform): GradingSide =>
  transform === 'mirror' ? 'right' : 'left';

/** All traversals run forward (+x) in their own local frame — including the
 *  rebuilt reversed traversal (B1). Mirror flips side, never direction. */
const dirOf = (_transform: MultiTransform): { dx: number; dy: number } => ({ dx: 1, dy: 0 });

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
  /** Forward identity-equivalent layout, or a rebuilt reversed traversal (B1). */
  traversalOrder: 'forward' | 'reversed-traversal';
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
 *
 * Reversal (B1 true traversal reversal): the member array is REBUILT in
 * reversed traversal order — reversed lengths, reversed widths (physical
 * joints in reverse encounter order), physical-member criteria, reversed
 * endpoint-pair ids, stations from 0, joints reindexed `joint:0..` in the
 * new traversal order. No far-end station flip: the reversed fixture IS a
 * forward layout of the reversed traversal.
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
  const reversed = spec.transform === 'reversal';
  const traversalOrder = reversed ? 'reversed-traversal' : 'forward';
  // Physical traversal order: reversed layouts walk the members back to front.
  const lengths = reversed ? [...spec.memberLengths].reverse() : [...spec.memberLengths];
  const widths = reversed ? [...spec.widths].reverse() : [...spec.widths];
  const baseScalars = memberScalars(spec.family, n);
  const scalars = reversed ? [...baseScalars].reverse() : baseScalars;
  const side = sideOf(spec.transform);
  const { dx, dy } = dirOf(spec.transform);
  const members: MultiMember[] = lengths.map((length, i) => ({
    id: reversed ? multiMemberIdReversed(i, n) : multiMemberId(i),
    criterion: memberCriterion(spec.family, scalars[i]!),
    length,
    start: lengths.slice(0, i).reduce((a, b) => a + b, 0),
  }));
  const total = members[n - 1]!.start + members[n - 1]!.length;
  const jointGaps: number[] = members.slice(1, -1).map((m) => m.length);
  if (!layoutSeparation(widths, jointGaps)) {
    const code = jointGaps.some(
      (g, i) => Number.isFinite(g) && g > 0 && widths[i]! / 2 + widths[i + 1]! / 2 === g,
    )
      ? 'TOUCHING_NOT_AUTHORIZED'
      : 'OVERLAP_REJECTED';
    return { ok: false, stage: 'group-layout', code };
  }
  const joints: MultiJoint[] = [];
  try {
    assertCanonicalJointOrder(widths.map((_, j) => `joint:${j}`));
  } catch {
    return { ok: false, stage: 'group-layout', code: 'ORDER_REJECTED' };
  }
  for (let j = 0; j + 1 < n; j += 1) {
    const jointId = `joint:${j}`;
    const station = members[j]!.start + members[j]!.length;
    const width = widths[j]!;
    // Layout-order adjacent pair in the (possibly reversed) traversal.
    const memberL = j;
    const memberR = j + 1;
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
  return { ok: true, geometry: { spec, side, members, joints, intervals, total, traversalOrder } };
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
    if (s >= m.start && s <= m.start + m.length) return { kind: 'native', member: k };
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

/** Full transform to world coords (mirror / translate rebuild; reversal is
 *  already a forward rebuilt traversal so it needs no flip here). */
const toWorld = (geometry: MultiGeometry, s: number, off: number, z: number): { x: number; y: number; z: number } => {
  const t = geometry.spec.transform;
  const shift = t === 'translate-1e6' ? 1e6 : t === 'translate-1e8' ? 1e8 : 0;
  const n = gradingSideNormal(dirOf(t).dx, dirOf(t).dy, geometry.side)!;
  return { x: s + shift + n.nx * off, y: shift + n.ny * off, z };
};

const sourceWorld = (geometry: MultiGeometry, s: number, zSrc: number): { x: number; y: number; z: number } => {
  const t = geometry.spec.transform;
  const shift = t === 'translate-1e6' ? 1e6 : t === 'translate-1e8' ? 1e8 : 0;
  return { x: s + shift, y: shift, z: zSrc };
};

/**
 * Normalize a reversed-traversal tiling back into the base orientation for
 * comparison: x -> total - x (y/z unchanged). The caller reverses point
 * order to restore ascending stations. Identity/mirror/translate rows use
 * the identity (no-op) — only true-reversal rows normalize.
 */
export const normalizeReversedWorldToBase = (
  pts: readonly { x: number; y: number; z: number }[],
  total: number,
): { x: number; y: number; z: number }[] => pts.map((p) => ({ x: total - p.x, y: p.y, z: p.z }));

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
    // traversal order (memberL left of the low bound, memberR right of the
    // high bound). Residual vs the true neighbor only.
    const jt = geometry.joints[o.index]!;
    const tp = transitionAxisPoint(geometry, o.index, s);
    const endMember = s === jt.station - jt.width / 2 ? jt.memberL : jt.memberR;
    const np = nativeAxisPoint(geometry, endMember, s);
    const tw = toWorld(geometry, s, tp.off, tp.z);
    const nw = toWorld(geometry, s, np.off, np.z);
    const plan = Math.hypot(tw.x - nw.x, tw.y - nw.y);
    const zgap = Math.abs(tw.z - nw.z);
    residual.plan = Math.max(residual.plan, plan);
    residual.z = Math.max(residual.z, zgap);
    return tw;
  });
  return { stations, owners, source, daylight, c0Plan: residual.plan, c0Z: residual.z };
};

export interface CandidateAPreMeshExpectation {
  expectedPositiveWidthRegions: 1;
  expectedComponents: 1;
  expectedBoundaryCycles: 1;
  expectation: GradingTopologyExpectation;
}

export type PreMeshOutcome =
  | { ok: true; preMesh: CandidateAPreMeshExpectation }
  | { ok: false; stage: string; code: string };

/**
 * Study-side PRE-MESH policy expectation authority for Candidate A
 * strict-separated valid fixtures. Derived ONLY from the candidate
 * predicate + fixture structure BEFORE any mesh exists: open by
 * construction, finite positive member lengths, every per-joint transition
 * admitted, strict separation on every shared middle member, positive
 * finite native + transition daylight widths under the analytic family, no
 * touching/overlap. NEVER inspects source/daylight arrays,
 * countPositiveWidthRegions, triangle output, or topology results.
 * Failure => no expectation, no certificate (fail closed).
 */
export const deriveCandidateAPreMeshExpectation = (spec: MultiFixtureSpec): PreMeshOutcome => {
  const n = spec.memberLengths.length;
  if (n < 3 || spec.widths.length !== n - 1) return { ok: false, stage: 'fixture', code: 'MALFORMED' };
  if (!spec.memberLengths.every((L) => Number.isFinite(L) && L > 0)) {
    return { ok: false, stage: 'fixture', code: 'MALFORMED' };
  }
  if (!spec.widths.every((w) => Number.isFinite(w) && w > 0)) {
    return { ok: false, stage: 'per-joint-admission', code: 'WIDTH_INVALID' };
  }
  // Group open by construction (all fixtures are ordinary open line strips).
  const isOpen = true;
  if (!isOpen) return { ok: false, stage: 'group-layout', code: 'CLOSED_NOT_AUTHORIZED' };
  // Strict separation on every shared middle member, in traversal order
  // (reversed layouts check the reversed pairing — same predicate).
  const lengths = spec.transform === 'reversal' ? [...spec.memberLengths].reverse() : spec.memberLengths;
  const widths = spec.transform === 'reversal' ? [...spec.widths].reverse() : spec.widths;
  const gaps = lengths.slice(1, -1);
  if (!layoutSeparation(widths, gaps)) {
    const touching = gaps.some(
      (g, i) => Number.isFinite(g) && g > 0 && widths[i]! / 2 + widths[i + 1]! / 2 === g,
    );
    return { ok: false, stage: 'group-layout', code: touching ? 'TOUCHING_NOT_AUTHORIZED' : 'OVERLAP_REJECTED' };
  }
  // Every per-joint transition admitted + positive finite native/transition
  // daylight widths under the analytic family (via the live authorities,
  // still pre-mesh: no tiling, no mesh, no region count).
  const out = buildMultiGroup(spec);
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
    const z = resolved.value.limitElevation;
    if (!Number.isFinite(off) || !(off > 0) || !Number.isFinite(z)) {
      return { ok: false, stage: 'native-resolution', code: 'NATIVE_NONPOSITIVE_WIDTH' };
    }
  }
  for (const jt of g.joints) {
    for (const v of [jt.vL, jt.vR, jt.sL, jt.sR]) {
      if (!Number.isFinite(v)) return { ok: false, stage: 'per-joint-admission', code: 'NONFINITE_LAW' };
    }
    const mid = evaluateTransitionLinearV1(jt.vL, jt.vR, jt.sL, jt.sR, 0);
    if (!Number.isFinite(mid)) return { ok: false, stage: 'per-joint-admission', code: 'NONFINITE_LAW' };
    const jz = jointZ(spec.family);
    const off = spec.family === 'distance' ? mid : spec.family === 'relative-elevation' ? mid / GRADE : (mid - jz) / GRADE;
    if (!Number.isFinite(off) || !(off > 0)) {
      return { ok: false, stage: 'per-joint-admission', code: 'TRANSITION_NONPOSITIVE_WIDTH' };
    }
  }
  // Authorized ordinary open strict-separated all-positive-width line strip:
  // exactly ONE merged positive-width region — declared here, pre-mesh.
  return {
    ok: true,
    preMesh: {
      expectedPositiveWidthRegions: 1,
      expectedComponents: 1,
      expectedBoundaryCycles: 1,
      expectation: deriveGradingTopologyExpectation({
        scope: 'group',
        closed: false,
        positiveWidthRegions: 1,
      }),
    },
  };
};

export interface MultiMeshFacts {
  vertexCount: number;
  triangleCount: number;
  skippedZeroWidth: number;
  expectedPositiveWidthRegions: 1;
  measuredPositiveWidthRegions: number;
  expectedComponents: 1;
  expectedBoundaryCycles: 1;
  certOk: boolean;
  components: number;
  boundaryCycles: number;
  revalidationNull: boolean;
}

/**
 * Actual strip mesh + gtop2 cert + exact revalidation against the
 * INDEPENDENT pre-mesh expectation. Measures `countPositiveWidthRegions`
 * AFTER tiling, asserts measured == independently expected BEFORE
 * certifying, then requires cert non-null, cert counts == expectation,
 * exact revalidation null. Any mismatch throws (fail closed) — the
 * expectation never adapts to the observation.
 */
export const meshAndCertifyMultiGroup = (
  tiled: TiledGroup,
  preMesh: CandidateAPreMeshExpectation,
): MultiMeshFacts => {
  const measured = countPositiveWidthRegions(tiled.source, tiled.daylight);
  if (measured !== preMesh.expectedPositiveWidthRegions) {
    throw new Error(
      `pre-mesh vs measured topology mismatch: expected ${preMesh.expectedPositiveWidthRegions}, measured ${measured}`,
    );
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
  if (!cert) throw new Error('gtop2 must certify the strict-separated strip against the pre-mesh expectation');
  if (cert.components !== preMesh.expectedComponents || cert.boundaryCycles !== preMesh.expectedBoundaryCycles) {
    throw new Error(
      `cert counts vs pre-mesh expectation mismatch: cert ${cert.components}/${cert.boundaryCycles}, expected ${preMesh.expectedComponents}/${preMesh.expectedBoundaryCycles}`,
    );
  }
  const err = gradingTopologyCertificateExactError(
    cert,
    'group',
    { points: built.points, triangles: built.triangles },
    { sourceBoundaryPoints: flat(tiled.source), gradingBoundaryPoints: flat(tiled.daylight) },
  );
  if (err !== null) throw new Error(`gtop2 exact revalidation must be null (got ${err})`);
  return {
    vertexCount: built.points.length / 3,
    triangleCount: built.triangles.length / 3,
    skippedZeroWidth: built.skippedZeroWidth,
    expectedPositiveWidthRegions: preMesh.expectedPositiveWidthRegions,
    measuredPositiveWidthRegions: measured,
    expectedComponents: preMesh.expectedComponents,
    expectedBoundaryCycles: preMesh.expectedBoundaryCycles,
    certOk: true,
    components: cert.components,
    boundaryCycles: cert.boundaryCycles,
    revalidationNull: true,
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
          { memberId: geometry.members[jt.memberL]!.id, criterion: geometry.members[jt.memberL]!.criterion, length: geometry.members[jt.memberL]!.length, dirX: 1, dirY: 0, startZ: jointZ(geometry.spec.family), endZ: jointZ(geometry.spec.family), isArc: false, maxSearchDistance: maxSearch(geometry.spec.family) },
          { memberId: geometry.members[jt.memberR]!.id, criterion: geometry.members[jt.memberR]!.criterion, length: geometry.members[jt.memberR]!.length, dirX: 1, dirY: 0, startZ: jointZ(geometry.spec.family), endZ: jointZ(geometry.spec.family), isArc: false, maxSearchDistance: maxSearch(geometry.spec.family) },
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
  /** Built ggrev1 input (exposed for hash pins; not serialized to corpus). */
  input: GroupRevisionInput;
}

/** ggrev1 over real courses + canonical intents; order-swap must move the hash. */
export const revisionFactsMultiGroup = (geometry: MultiGeometry, tiled: TiledGroup): MultiRevisionFacts => {
  const jz = jointZ(geometry.spec.family);
  const n = geometry.members.length;
  // Actual traversal endpoint pairs: reversed traversals walk Sn->..->S0,
  // so course i covers S(n-i)->S(n-1-i) (matching the real member ids).
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
  // Alternating per-member scalars ride as canonical sparse overrides:
  // the group default covers course 0, every differing course overrides.
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
    sourceFeatureLineId: 'FL-20N',
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
    input: base,
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
  /** Forward identity-equivalent layout, or rebuilt reversed traversal (B1). */
  traversalOrder: 'forward' | 'reversed-traversal';
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
      specs.push({ fixtureId: `candidateA2T-${family}-${tag}`, family, memberLengths: [30, 24, 30], widths: [8, 6], transform, expected: transform === 'reversal' ? 'true-traversal-reversal mesh + gtop2 + agreement' : 'transform-stable mesh + gtop2 + agreement', eligible: true });
      specs.push({ fixtureId: `candidateA3T-${family}-${tag}`, family, memberLengths: [30, 24, 26, 30], widths: [8, 6, 4], transform, expected: transform === 'reversal' ? 'true-traversal-reversal mesh + gtop2 + agreement' : 'transform-stable mesh + gtop2 + agreement', eligible: true });
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
    const traversalOrder: 'forward' | 'reversed-traversal' = spec.transform === 'reversal' ? 'reversed-traversal' : 'forward';
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
      traversalOrder,
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
    // Independent pre-mesh expectation FIRST (fail-closed: no expectation, no cert).
    const pre = deriveCandidateAPreMeshExpectation(spec);
    if (!pre.ok) {
      const negative: MultiRow = {
        ...base,
        measured: {
          stage: pre.stage,
          code: pre.code,
          meshBuilt: false,
          certIssued: false,
          validatorsRun: false,
        },
      };
      return negative;
    }
    const g = out.geometry;
    const tiled = tileMultiGroup(g);
    const mesh = meshAndCertifyMultiGroup(tiled, pre.preMesh);
    const revision = revisionFactsMultiGroup(g, tiled);
    const agreement = agreeMultiGroup(g, tiled, revision.hash);
    // Ownership verdict: unique owner per station; boundaries carry both endpoints.
    const ownerKinds = tiled.owners.map((o) => o.kind);
    const stationCount = tiled.stations.length;
    const gaps = g.intervals.slice(1).map((iv, k) => r12(iv.lo - g.intervals[k]!.hi));
    return {
      ...base,
      // Traversal-order truth: reversed rows record the REBUILT reversed
      // traversal (reversed lengths/ids/widths/stations), not the base spec.
      memberLengths: g.members.map((m) => m.length),
      memberIds: g.members.map((m) => m.id),
      jointIds: g.joints.map((jt) => jt.jointId),
      widths: g.joints.map((jt) => jt.width),
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
        expectedPositiveWidthRegions: mesh.expectedPositiveWidthRegions,
        measuredPositiveWidthRegions: mesh.measuredPositiveWidthRegions,
        expectedComponents: mesh.expectedComponents,
        expectedBoundaryCycles: mesh.expectedBoundaryCycles,
        gtop2Components: mesh.components,
        gtop2BoundaryCycles: mesh.boundaryCycles,
        gtop2RevalidationNull: mesh.revalidationNull,
        topologyPreMeshEqualsMeasured: mesh.expectedPositiveWidthRegions === mesh.measuredPositiveWidthRegions,
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
