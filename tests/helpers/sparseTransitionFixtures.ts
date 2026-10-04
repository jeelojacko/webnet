/**
 * Phase 20P study helper — sparse collinear transition-set fixtures.
 *
 * STUDY ONLY, zero `src/` changes. Builds minimal honest full-group
 * geometry over REAL member arrays + criteria whose transition joints are
 * a sparse subset of `joint:<n>` (e.g. [0,2], [0,2,4], [0,1,3], [0,2,3,5]).
 *
 * Production authorities reused read-only (never copied, never re-derived):
 * admitGradingTransition / evaluateTransitionLinearV1 (per-joint law +
 * admission), resolveAnalyticCriterionAt (native offsets), gradingSideNormal
 * (frame), transitionDaylightAt (tile interior daylight),
 * buildGradingStripMesh (mesh), countPositiveWidthRegions (MEASURED
 * regions), deriveGradingTopologyExpectation (expectation shape),
 * buildGradingTopologyCertificateExact + exact/production revalidation.
 *
 * Topology independence: the 1/1/1 declaration comes from the study-side
 * sparse predicate (ordered-with-gaps joints + per-joint admission +
 * strict GLOBAL station-interval separation + native-valid skipped joints)
 * BEFORE any mesh. `meshSparseGroup` asserts measured == declared before it
 * certifies, and never feeds a measured count back into the expectation.
 *
 * The per-joint admission and strict separation are delegated to the
 * production authorities wherever a production authority exists
 * (`checkGroupTransitionSeparation` for the consecutive reduction). The
 * generalized station-gap arithmetic is the study's proposed delta and is
 * isolated here.
 */
import { resolveAnalyticCriterionAt } from '../../src/engine/cad/grading/gradingAnalyticCriterion';
import { gradingSideNormal } from '../../src/engine/cad/grading/gradingCourseFrame';
import {
  buildGradingStripMesh,
  type GradingStripMesh,
} from '../../src/engine/cad/grading/gradingMesh';
import {
  buildGradingTopologyCertificateExact,
  countPositiveWidthRegions,
  gradingTopologyCertificateExactError,
  gradingTopologyCertificateProductionError,
  type GradingTopologyCertificate,
} from '../../src/engine/cad/grading/gradingTopologyCertificate';
import {
  deriveGradingTopologyExpectation,
  type GradingTopologyExpectation,
} from '../../src/engine/cad/grading/gradingTopologyExpectation';
import {
  transitionDaylightAt,
  transitionLegOf,
  type PlannedTransition,
} from '../../src/engine/cad/grading/gradingGroupTransitionTile';
import type {
  CadGradingGroupTransitionLeg,
  CadGradingTransition,
} from '../../src/engine/cad/grading/gradingGroupTypes';
import {
  TRANSITION_LAW_KIND,
  TRANSITION_LAW_VERSION,
  TRANSITION_POLICY_VERSION,
  admitGradingTransition,
  checkGroupTransitionSeparation,
  evaluateTransitionLinearV1,
} from '../../src/engine/cad/grading/gradingTransitionPolicy';
import type { GradingCriterion, GradingSide } from '../../src/engine/cad/grading/gradingTypes';
import type { GroupTransitionPlan } from '../../src/workers/surfaceGradingCompute';
import type { GradingGroupComputeRequest } from '../../src/workers/surfaceWorkerHandler';

export type SparseFamily = 'distance' | 'relative-elevation' | 'elevation';

export interface SparseTransitionSpec {
  /** Sparse joint index (between member j and j+1). */
  joint: number;
  /** Explicit total symmetric width W, source-line meters. */
  width: number;
}

export interface SparseFixtureSpec {
  fixtureId: string;
  family: SparseFamily;
  /** Real shared-member lengths (>= 3 members). */
  memberLengths: number[];
  /** Sparse joints, strictly increasing (gaps allowed). */
  transitions: SparseTransitionSpec[];
}

export const GRADE = 0.5;
const SCALAR_PAIR = (family: SparseFamily): [number, number] =>
  family === 'distance' ? [5, 7] : family === 'relative-elevation' ? [1.5, 2] : [0.5, 1];

export const jointZOf = (family: SparseFamily): number => (family === 'elevation' ? 0 : 10);
export const maxSearchOf = (family: SparseFamily): number => (family === 'elevation' ? 100 : 50);

const memberCriterion = (family: SparseFamily, scalar: number): GradingCriterion => {
  if (family === 'distance') return { kind: 'distance', gradeRatio: GRADE, distance: scalar };
  if (family === 'relative-elevation')
    return { kind: 'relative-elevation', gradeRatio: GRADE, relativeElevation: scalar };
  return { kind: 'elevation', gradeRatio: GRADE, targetElevation: scalar };
};

export interface SparseMember {
  index: number;
  id: string;
  criterion: GradingCriterion;
  scalar: number;
  length: number;
  startStation: number;
}

export interface SparseTransition {
  intent: CadGradingTransition;
  joint: number;
  station: number;
  width: number;
  sL: number;
  sR: number;
  vL: number;
  vR: number;
  memberL: number;
  memberR: number;
  interval: { lo: number; hi: number };
}

export interface SparseGeometry {
  spec: SparseFixtureSpec;
  family: SparseFamily;
  side: GradingSide;
  jointZ: number;
  grade: number;
  members: SparseMember[];
  transitions: SparseTransition[];
  /** Joints with no transition (native joints): no checkpoints may exist. */
  skippedJoints: number[];
  total: number;
}

export type SparseOutcome<T> = { ok: true; value: T } | { ok: false; code: string; detail: string };

const fail = (code: string, detail: string): { ok: false; code: string; detail: string } => ({
  ok: false,
  code,
  detail,
});

/** Member identity via the real joint chain (never fake L/R). */
const memberId = (i: number): string => `S${i}>S${i + 1}`;

/**
 * Build full-group geometry from a sparse spec. Member stations are
 * cumulative; each transition is admitted with the REAL adjacent member
 * pair; skipped joints are NOT admitted and carry no interval.
 */
export const buildSparseGroup = (spec: SparseFixtureSpec): SparseOutcome<SparseGeometry> => {
  const n = spec.memberLengths.length;
  if (n < 3) return fail('MALFORMED', 'sparse group needs at least 3 members');
  for (const length of spec.memberLengths) {
    if (!Number.isFinite(length) || !(length > 0)) return fail('MALFORMED', 'member lengths must be finite > 0');
  }
  const family = spec.family;
  const jointZ = jointZOf(family);
  const grade = GRADE;
  const pair = SCALAR_PAIR(family);
  const scalars = spec.memberLengths.map((_, i) => pair[i % 2]!);
  const members: SparseMember[] = spec.memberLengths.map((length, i) => ({
    index: i,
    id: memberId(i),
    criterion: memberCriterion(family, scalars[i]!),
    scalar: scalars[i]!,
    length,
    startStation: spec.memberLengths.slice(0, i).reduce((a, b) => a + b, 0),
  }));
  const total = members[n - 1]!.startStation + members[n - 1]!.length;
  // Strictly increasing, in range, no duplicates (fail closed, never sorted).
  const jointsSeen: number[] = [];
  for (const t of spec.transitions) {
    if (!Number.isInteger(t.joint) || t.joint < 0 || t.joint > n - 2) {
      return fail('MALFORMED', `joint ${t.joint} out of range for ${n} members`);
    }
    if (jointsSeen.length > 0 && !(t.joint > jointsSeen[jointsSeen.length - 1]!)) {
      return fail('MALFORMED', 'sparse joints must be strictly increasing');
    }
    jointsSeen.push(t.joint);
  }
  const transitions: SparseTransition[] = [];
  for (const t of spec.transitions) {
    const memberL = members[t.joint]!;
    const memberR = members[t.joint + 1]!;
    const admitted = admitGradingTransition({
      policyVersion: TRANSITION_POLICY_VERSION,
      lawKind: TRANSITION_LAW_KIND,
      lawVersion: TRANSITION_LAW_VERSION,
      criterionFamily: family,
      jointId: `joint:${t.joint}`,
      memberIds: [memberL.id, memberR.id],
      width: t.width,
      side: 'left',
      groupSide: 'left',
      isOpen: true,
      transitionCount: 1,
      jointZ,
      members: [
        {
          memberId: memberL.id,
          criterion: memberL.criterion,
          length: memberL.length,
          dirX: 1,
          dirY: 0,
          startZ: jointZ,
          endZ: jointZ,
          isArc: false,
          maxSearchDistance: maxSearchOf(family),
        },
        {
          memberId: memberR.id,
          criterion: memberR.criterion,
          length: memberR.length,
          dirX: 1,
          dirY: 0,
          startZ: jointZ,
          endZ: jointZ,
          isArc: false,
          maxSearchDistance: maxSearchOf(family),
        },
      ],
    });
    if (!admitted.ok) return fail(admitted.code, admitted.detail);
    const station = memberL.startStation + memberL.length;
    const intent: CadGradingTransition = {
      policyVersion: TRANSITION_POLICY_VERSION,
      jointId: `joint:${t.joint}`,
      memberIds: [memberL.id, memberR.id],
      width: t.width,
      lawKind: TRANSITION_LAW_KIND,
      lawVersion: TRANSITION_LAW_VERSION,
      criterionFamily: family,
      side: 'left',
    };
    transitions.push({
      intent,
      joint: t.joint,
      station,
      width: admitted.width,
      sL: admitted.sL,
      sR: admitted.sR,
      vL: admitted.vL,
      vR: admitted.vR,
      memberL: t.joint,
      memberR: t.joint + 1,
      interval: { lo: station - admitted.width / 2, hi: station + admitted.width / 2 },
    });
  }
  const skippedJoints: number[] = [];
  for (let j = 0; j <= n - 2; j += 1) {
    if (!transitions.some((t) => t.joint === j)) skippedJoints.push(j);
  }
  return {
    ok: true,
    value: { spec, family, side: 'left', jointZ, grade, members, transitions, skippedJoints, total },
  };
};

export interface SparsePredicateOutcome {
  ok: boolean;
  code: string;
  detail: string;
}

/**
 * Study-side sparse-set predicate (the proposed generalization):
 * - ordered sparse joints (already enforced at build);
 * - every transition admitted per joint (already enforced at build);
 * - strict GLOBAL station-interval separation `W_i/2 + W_j/2 < gap` where
 *   gap is the station difference (all skipped members included);
 * - each skipped native joint is native-valid (flat, collinear, resolvable).
 */
export const sparsePredicate = (geometry: SparseGeometry): SparsePredicateOutcome => {
  const t = geometry.transitions;
  if (t.length === 0) return { ok: false, code: 'MALFORMED', detail: 'no transitions' };
  for (let i = 0; i + 1 < t.length; i += 1) {
    const a = t[i]!;
    const b = t[i + 1]!;
    const gap = b.station - a.station;
    if (!(Number.isFinite(gap) && gap > 0)) {
      return { ok: false, code: 'MALFORMED', detail: `non-positive station gap between joint:${a.joint} and joint:${b.joint}` };
    }
    const halfSpan = a.width / 2 + b.width / 2;
    if (halfSpan === gap) {
      return { ok: false, code: 'TOUCHING_NOT_AUTHORIZED', detail: `touching intervals at joint:${a.joint}/joint:${b.joint}` };
    }
    if (halfSpan > gap) {
      return { ok: false, code: 'OVERLAP_REJECTED', detail: `overlapping intervals at joint:${a.joint}/joint:${b.joint}` };
    }
  }
  for (const joint of geometry.skippedJoints) {
    const memberL = geometry.members[joint];
    const memberR = geometry.members[joint + 1];
    if (!memberL || !memberR) return { ok: false, code: 'MALFORMED', detail: `skipped joint ${joint} does not resolve` };
    if (!(memberL.length > 0) || !(memberR.length > 0)) {
      return { ok: false, code: 'MALFORMED', detail: `skipped joint ${joint} has a non-positive member` };
    }
    const resolvedL = resolveAnalyticCriterionAt(memberL.criterion, geometry.jointZ, maxSearchOf(geometry.family));
    const resolvedR = resolveAnalyticCriterionAt(memberR.criterion, geometry.jointZ, maxSearchOf(geometry.family));
    if (!resolvedL.ok || !resolvedR.ok) {
      return { ok: false, code: 'NATIVE_CRITERION', detail: `skipped joint ${joint} native does not resolve` };
    }
  }
  return { ok: true, code: 'OK', detail: 'sparse set strictly separated with native-valid skipped joints' };
};

/**
 * Consecutive reduction control: for joints [j, j+1] the gap is the shared
 * member length, so the study predicate reduces EXACTLY to the production
 * `checkGroupTransitionSeparation` authority (no second separation rule).
 */
export const consecutiveReductionMatchesProduction = (
  geometry: SparseGeometry,
): boolean => {
  // Maximal consecutive runs; each run reduces to the production rule with
  // shared-member-length gaps (the 20N.1 `checkGroupTransitionSeparation`).
  const runs: SparseTransition[][] = [];
  let run: SparseTransition[] = [];
  for (const t of geometry.transitions) {
    if (run.length === 0 || t.joint === run[run.length - 1]!.joint + 1) run.push(t);
    else {
      if (run.length > 1) runs.push(run);
      run = [t];
    }
  }
  if (run.length > 1) runs.push(run);
  for (const group of runs) {
    const widths = group.map((t) => t.width);
    const gaps = group.slice(0, -1).map((t) => geometry.members[t.joint + 1]!.length);
    if (!checkGroupTransitionSeparation(widths, gaps)) return false;
  }
  return true;
};

export interface SparsePreMesh {
  /** The pre-mesh declaration: 1 region / 1 component / 1 boundary cycle. */
  expectedPositiveWidthRegions: 1;
  expectedComponents: 1;
  expectedBoundaryCycles: 1;
  expectation: GradingTopologyExpectation;
  predicate: SparsePredicateOutcome;
}

export type SparsePreMeshOutcome = SparseOutcome<SparsePreMesh>;

/**
 * Declare the merged open-strip 1/1/1 topology from the sparse predicate
 * BEFORE any mesh. `deriveGradingTopologyExpectation` is fed the STUDY'S
 * declared region count (1), never a measured count.
 */
export const deriveSparsePreMeshExpectation = (
  geometry: SparseGeometry,
): SparsePreMeshOutcome => {
  const predicate = sparsePredicate(geometry);
  if (!predicate.ok) return fail(predicate.code, predicate.detail);
  return {
    ok: true,
    value: {
      expectedPositiveWidthRegions: 1,
      expectedComponents: 1,
      expectedBoundaryCycles: 1,
      expectation: deriveGradingTopologyExpectation({ scope: 'group', closed: false, positiveWidthRegions: 1 }),
      predicate,
    },
  };
};

export interface SparsePoint {
  x: number;
  y: number;
  z: number;
}

export type SparseStationOwner =
  | { kind: 'transition'; index: number }
  | { kind: 'boundary'; index: number }
  | { kind: 'native'; member: number };

/** Strictly inside a transition interval -> transition; on bound -> boundary; else native. */
export const classifySparseStation = (station: number, geometry: SparseGeometry): SparseStationOwner => {
  for (let i = 0; i < geometry.transitions.length; i += 1) {
    const iv = geometry.transitions[i]!.interval;
    if (station > iv.lo && station < iv.hi) return { kind: 'transition', index: i };
    if (station === iv.lo || station === iv.hi) return { kind: 'boundary', index: i };
  }
  for (let k = 0; k < geometry.members.length; k += 1) {
    const m = geometry.members[k]!;
    if (station >= m.startStation && station <= m.startStation + m.length) return { kind: 'native', member: k };
  }
  throw new Error(`station ${station} outside group span`);
};

const nativeOffsetAt = (geometry: SparseGeometry, member: number): { off: number; z: number } => {
  const resolved = resolveAnalyticCriterionAt(
    geometry.members[member]!.criterion,
    geometry.jointZ,
    maxSearchOf(geometry.family),
  );
  if (!resolved.ok) throw new Error(`native must resolve (member ${member})`);
  return { off: resolved.value.horizontalDistance, z: resolved.value.limitElevation };
};

const transitionOffsetAt = (geometry: SparseGeometry, index: number, station: number): { off: number; z: number } => {
  const t = geometry.transitions[index]!;
  const v = evaluateTransitionLinearV1(t.vL, t.vR, t.sL, t.sR, station - t.station);
  const normal = gradingSideNormal(1, 0, geometry.side)!;
  const daylight = transitionDaylightAt(geometry.family, v, geometry.grade, geometry.jointZ, station, 0, normal.nx, normal.ny);
  return { off: daylight.d, z: daylight.z };
};

const toSource = (geometry: SparseGeometry, station: number): SparsePoint => ({
  x: station,
  y: 0,
  z: geometry.jointZ,
});

const toDaylight = (geometry: SparseGeometry, station: number, off: number, z: number): SparsePoint => {
  const normal = gradingSideNormal(1, 0, geometry.side)!;
  return { x: station, y: normal.ny * off, z };
};

export interface SparseTiled {
  stations: number[];
  owners: SparseStationOwner[];
  source: SparsePoint[];
  daylight: SparsePoint[];
}

/**
 * Tiled source/daylight polylines over ordered global stations. Native
 * points use the production native authority; transition points use the
 * production linear law + `transitionDaylightAt`; skipped joints are plain
 * native members (interval-free).
 */
export const tileSparseGroup = (geometry: SparseGeometry): SparseTiled => {
  const base = new Set<number>([0, geometry.total]);
  for (const m of geometry.members) {
    base.add(m.startStation);
    base.add(m.startStation + m.length);
  }
  for (const t of geometry.transitions) {
    base.add(t.interval.lo);
    base.add(t.station - t.width / 4);
    base.add(t.station);
    base.add(t.station + t.width / 4);
    base.add(t.interval.hi);
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
    if (om.kind === 'native' && oa.kind !== 'transition' && ob.kind !== 'transition') extra.push(mid);
  }
  const stations = [...ordered, ...extra].sort((a, b) => a - b);
  const owners = stations.map((s) => classifySparseStation(s, geometry));
  const source = stations.map((s) => toSource(geometry, s));
  const daylight = stations.map((s, i) => {
    const owner = owners[i]!;
    if (owner.kind === 'transition') {
      const p = transitionOffsetAt(geometry, owner.index, s);
      return toDaylight(geometry, s, p.off, p.z);
    }
    if (owner.kind === 'native') {
      const p = nativeOffsetAt(geometry, owner.member);
      return toDaylight(geometry, s, p.off, p.z);
    }
    const p = transitionOffsetAt(geometry, owner.index, s);
    return toDaylight(geometry, s, p.off, p.z);
  });
  return { stations, owners, source, daylight };
};

export interface SparseMeshFacts {
  mesh: GradingStripMesh;
  measuredPositiveWidthRegions: number;
  certificate: GradingTopologyCertificate | null;
  exactError: string | null;
  productionError: string | null;
}

/**
 * Mesh + certify against the DECLARED pre-mesh expectation. Throws when the
 * production measured count disagrees with the declaration: the measured
 * count is never allowed to re-define the expectation (no laundering).
 */
export const meshSparseGroup = (tiled: SparseTiled, preMesh: SparsePreMesh): SparseMeshFacts => {
  const measured = countPositiveWidthRegions(tiled.source, tiled.daylight);
  if (measured !== preMesh.expectedPositiveWidthRegions) {
    throw new Error(
      `pre-mesh vs measured topology mismatch: declared ${preMesh.expectedPositiveWidthRegions}, measured ${measured}`,
    );
  }
  const built = buildGradingStripMesh(tiled.source, tiled.daylight);
  if (!built.ok) throw new Error(`mesh refused: ${built.code}`);
  const flat = (pts: readonly SparsePoint[]): number[] => pts.flatMap((p) => [p.x, p.y, p.z]);
  const certificate = buildGradingTopologyCertificateExact({
    scope: 'group',
    points: built.points,
    triangles: built.triangles,
    expectation: preMesh.expectation,
    sourceBoundaryPoints: flat(tiled.source),
    gradingBoundaryPoints: flat(tiled.daylight),
  });
  const mesh = { points: built.points, triangles: built.triangles };
  const boundaries = { sourceBoundaryPoints: flat(tiled.source), gradingBoundaryPoints: flat(tiled.daylight) };
  return {
    mesh: built,
    measuredPositiveWidthRegions: measured,
    certificate,
    exactError: gradingTopologyCertificateExactError(certificate ?? undefined, 'group', mesh, boundaries),
    productionError: gradingTopologyCertificateProductionError(certificate ?? undefined, 'group', mesh, boundaries),
  };
};

export const flatPoints = (pts: readonly SparsePoint[]): number[] => pts.flatMap((p) => [p.x, p.y, p.z]);

/** Worker plans in the geometry's canonical order (one per transition). */
export const sparsePlans = (geometry: SparseGeometry, revision: string): GroupTransitionPlan[] =>
  geometry.transitions.map((t) => ({
    policyVersion: TRANSITION_POLICY_VERSION,
    lawKind: TRANSITION_LAW_KIND,
    lawVersion: TRANSITION_LAW_VERSION,
    criterionFamily: geometry.family,
    jointId: t.intent.jointId,
    memberIds: [t.intent.memberIds[0]!, t.intent.memberIds[1]!],
    width: t.width,
    side: geometry.side,
    groupSide: geometry.side,
    isOpen: true,
    transitionCount: 1,
    jointZ: geometry.jointZ,
    endpointEvidence: { vL: t.vL, vR: t.vR, gL: geometry.grade, gR: geometry.grade },
    jointStation: t.station,
    recordedRevision: revision,
  }));

/** Worker request for the sparse group (same authoritative member sources). */
export const sparseWorkerRequest = (
  geometry: SparseGeometry,
  plans: GroupTransitionPlan[],
): GradingGroupComputeRequest => ({
  groupId: geometry.spec.fixtureId,
  revision: plans[0]?.recordedRevision ?? 'ggrev1:sparse',
  memberSources: geometry.members.map((m) => ({
    startX: m.startStation,
    startY: 0,
    endX: m.startStation + m.length,
    endY: 0,
    startZ: geometry.jointZ,
    endZ: geometry.jointZ,
    length: m.length,
    reoriented: false,
    isArc: false,
  })),
  side: geometry.side,
  criterion: geometry.members[0]!.criterion,
  memberCriteria: geometry.members.map((m) => m.criterion),
  transitionMemberKeys: geometry.members.map((m) => m.id),
  maxSearchDistance: maxSearchOf(geometry.family),
  curveChordTolerance: 0.05,
  closed: false,
  transitions: plans,
});

/** Result-owned transition legs built from the study tiling (one per transition). */
export const sparseLegs = (geometry: SparseGeometry, revision: string): CadGradingGroupTransitionLeg[] =>
  geometry.transitions.map((t) => {
    const stations = [t.interval.lo, t.station, t.interval.hi];
    const source = stations.map((s) => toSource(geometry, s));
    const daylight = stations.map((s) => {
      const p = transitionOffsetAt(geometry, geometry.transitions.indexOf(t), s);
      return toDaylight(geometry, s, p.off, p.z);
    });
    const plan: PlannedTransition = {
      joint: t.joint,
      tx: 1,
      ty: 0,
      d0: 0,
      tieXyz: [daylight[1]!.x, daylight[1]!.y, daylight[1]!.z],
      runFlat: flatPoints(daylight),
      law: { sL: t.sL, sR: t.sR, vL: t.vL, vR: t.vR, family: geometry.family },
      srcFlat: flatPoints(source),
      jointStation: t.station,
    };
    return transitionLegOf(t.intent, plan, geometry.grade, geometry.grade, revision);
  });
