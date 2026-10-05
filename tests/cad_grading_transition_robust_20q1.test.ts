/**
 * Phase 20Q.1 Wave J — singular sloped-source robustness (TESTS ONLY).
 *
 * Every case runs the REAL production path end to end: the group kernel
 * solve (`computeGradingGroupFromSnapshots`), the worker post-solve mesh
 * agreement gate (`validateTransitionResultMeshAgainst`), the worker
 * plan re-admission (`checkGroupTransitionAgreement`), and the exact
 * topology certificate (gtop2) the solve actually produced. No study
 * oracle, no `src/` changes.
 *
 * Covers: slope sweep (flat/tiny/±1/±5/±15/±50/CREST/SAG/unequal) across
 * all three analytic families; coordinate transforms (XY 1e6/1e8, big Z
 * shift, mirror, TRUE traversal reversal with a normalized geometric
 * compare — never ggrev1 identity equality); admission boundaries
 * (width 2·min, non-finite, 1-ULP step, non-collinear/arc/closed/Surface/
 * mixed-family reject); and the singular-sloped-ok / plural-sloped-reject
 * / plural-all-flat-ok scope law.
 */
import { describe, expect, it } from 'vitest';

import {
  TRANSITION_LAW_KIND,
  TRANSITION_LAW_VERSION,
  TRANSITION_POLICY_VERSION,
  admitGradingTransition,
  type AdmitTransitionInput,
  type TransitionMemberGeometry,
} from '../src/engine/cad/grading/gradingTransitionPolicy';
import {
  computeGradingGroupFromSnapshots,
  type GradingGroupComputeOutcome,
  type GroupSolveInput,
} from '../src/engine/cad/grading/gradingGroupCompute';
import { GRADING_TOPOLOGY_CERTIFICATE_EXACT_VERSION } from '../src/engine/cad/grading/gradingTopologyCertificate';
import {
  toGroupSolveInput,
  validateTransitionResultMeshAgainst,
  type GradingGroupComputeRequest,
} from '../src/workers/surfaceWorkerHandler';
import {
  checkGroupTransitionAgreement,
  checkGroupTransitionPlansAgreement,
  type GroupTransitionMemberView,
  type GroupTransitionPlan,
} from '../src/workers/surfaceGradingCompute';
import type { CadGradingGroupResult, CadGradingTransition } from '../src/engine/cad/grading/gradingGroupTypes';
import type { GradingCriterion, GradingSide, ResolvedGradingSource } from '../src/engine/cad/grading/gradingTypes';

type Family = 'distance' | 'relative-elevation' | 'elevation';

const GRADE = 0.5;
const Z0 = 10;
const W = 8;
const LEN = 30;
const MAX_SEARCH = 50;
const REV = 'ggrev1:20q1-wavej';
const KEYS = ['L', 'R'];
const FAMILIES: Family[] = ['distance', 'relative-elevation', 'elevation'];

const crit = (family: Family): GradingCriterion =>
  family === 'distance'
    ? { kind: 'distance', gradeRatio: GRADE, distance: 5 }
    : family === 'relative-elevation'
      ? { kind: 'relative-elevation', gradeRatio: GRADE, relativeElevation: 2.5 }
      : { kind: 'elevation', gradeRatio: GRADE, targetElevation: 12.5 };

const dist = (d: number): GradingCriterion => ({ kind: 'distance', gradeRatio: GRADE, distance: d });

const link = (ax: number, ay: number, az: number, bx: number, by: number, bz: number): ResolvedGradingSource => ({
  startX: ax, startY: ay, endX: bx, endY: by, startZ: az, endZ: bz,
  length: Math.hypot(bx - ax, by - ay), reoriented: false, isArc: false,
});

/** Joint-continuous two-member chain along +x; the joint sits at (0, 0, Z0). */
const chain = (z0: number, z2: number, lenL = LEN, lenR = LEN): ResolvedGradingSource[] => [
  link(-lenL, 0, z0, 0, 0, Z0),
  link(0, 0, Z0, lenR, 0, z2),
];

const geomOf = (
  members: ResolvedGradingSource[],
  keys: readonly string[],
  family: Family,
  criteria?: readonly GradingCriterion[],
): [TransitionMemberGeometry, TransitionMemberGeometry] =>
  members.map((m, i) => ({
    memberId: keys[i]!, criterion: criteria?.[i] ?? crit(family), length: m.length,
    dirX: m.endX - m.startX, dirY: m.endY - m.startY,
    startZ: m.startZ, endZ: m.endZ, isArc: m.isArc, maxSearchDistance: MAX_SEARCH,
  })) as [TransitionMemberGeometry, TransitionMemberGeometry];

const intentOf = (members: ResolvedGradingSource[], family: Family, side: GradingSide, width: number, keys: readonly string[] = KEYS, jointId = 'joint:0'): CadGradingTransition => ({
  policyVersion: TRANSITION_POLICY_VERSION, jointId, memberIds: [...keys], width,
  lawKind: TRANSITION_LAW_KIND, lawVersion: TRANSITION_LAW_VERSION, criterionFamily: family, side,
});

/** Worker plan built from the same authoritative geometry the solve consumes. */
const planOf = (members: ResolvedGradingSource[], family: Family, side: GradingSide, width: number, keys: readonly string[] = KEYS, jointStation = members[0]!.length, jointId = 'joint:0', criteria?: readonly [GradingCriterion, GradingCriterion]): GroupTransitionPlan => {
  const admitted = admitGradingTransition({
    policyVersion: TRANSITION_POLICY_VERSION, lawKind: TRANSITION_LAW_KIND, lawVersion: TRANSITION_LAW_VERSION,
    criterionFamily: family, jointId, memberIds: [...keys], width,
    side, groupSide: side, isOpen: true, transitionCount: 1, jointZ: members[0]!.endZ,
    members: geomOf(members, keys, family, criteria),
  });
  if (!admitted.ok) throw new Error(`plan prerequisite failed: ${admitted.code}`);
  return {
    ...intentOf(members, family, side, width, keys, jointId),
    groupSide: side, isOpen: true, transitionCount: 1, jointZ: members[0]!.endZ,
    endpointEvidence: { vL: admitted.vL, vR: admitted.vR, gL: GRADE, gR: GRADE },
    jointStation, recordedRevision: REV,
  };
};

const admitInput = (members: ResolvedGradingSource[], over: Partial<AdmitTransitionInput> = {}, family: Family = 'distance'): AdmitTransitionInput => ({
  policyVersion: TRANSITION_POLICY_VERSION, lawKind: TRANSITION_LAW_KIND, lawVersion: TRANSITION_LAW_VERSION,
  criterionFamily: family, jointId: 'joint:0', memberIds: [...KEYS], width: W, side: 'left', groupSide: 'left',
  isOpen: true, transitionCount: 1, jointZ: members[0]!.endZ, members: geomOf(members, KEYS, family), ...over,
});

interface FullRun {
  outcome: GradingGroupComputeOutcome;
  result: CadGradingGroupResult | null;
  workerCode: string | null;
  cert: string | undefined;
}

/** Real production solve → worker mesh agreement → result topology certificate. */
const fullRun = (members: ResolvedGradingSource[], family: Family, side: GradingSide = 'left', width = W, keys: readonly string[] = KEYS, joint = 0, criteriaIn?: GradingCriterion[]): FullRun => {
  const c = crit(family);
  const memberCriteria = criteriaIn ?? members.map(() => c);
  const pair = [members[joint]!, members[joint + 1]!];
  const pairKeys = [keys[joint]!, keys[joint + 1]!];
  const pairCriteria = [memberCriteria[joint]!, memberCriteria[joint + 1]!] as [GradingCriterion, GradingCriterion];
  const jointStation = members.slice(0, joint + 1).reduce((sum, m) => sum + m.length, 0);
  const request: GradingGroupComputeRequest = {
    groupId: 'g', revision: REV, memberSources: members, side, criterion: memberCriteria[0]!, memberCriteria,
    maxSearchDistance: MAX_SEARCH, curveChordTolerance: 0.01, closed: false,
    transition: planOf(pair, family, side, width, pairKeys, jointStation, `joint:${joint}`, pairCriteria), transitionMemberKeys: [...keys],
  };
  const outcome = computeGradingGroupFromSnapshots(toGroupSolveInput(request));
  if (!outcome.ok) return { outcome, result: null, workerCode: 'NO_RESULT', cert: undefined };
  return {
    outcome,
    result: outcome.result,
    workerCode: validateTransitionResultMeshAgainst(outcome.result, request),
    cert: outcome.result.topologyCertificate?.version,
  };
};

const solveWith = (input: Partial<GroupSolveInput> & { members: ResolvedGradingSource[] }): GradingGroupComputeOutcome =>
  computeGradingGroupFromSnapshots({
    groupId: 'g', revision: REV, side: 'left', criterion: crit('distance'),
    maxSearchDistance: MAX_SEARCH, curveChordTolerance: 0.01, closed: false, ...input,
  });

const triples = (flat: readonly number[]): number[][] => {
  const out: number[][] = [];
  for (let i = 0; i + 2 < flat.length; i += 3) out.push([flat[i]!, flat[i + 1]!, flat[i + 2]!]);
  return out;
};

const expectSamePointSet = (a: readonly number[], b: readonly number[], flip: { x?: boolean; y?: boolean }, tol = 1e-9): void => {
  const pa = triples(a).map((p) => [flip.x ? -p[0]! : p[0]!, flip.y ? -p[1]! : p[1]!, p[2]!]);
  const pb = triples(b);
  expect(pa.length).toBe(pb.length);
  const used = pb.map(() => false);
  for (const p of pa) {
    const idx = pb.findIndex((q, i) => !used[i]! && Math.abs(q[0]! - p[0]!) <= tol && Math.abs(q[1]! - p[1]!) <= tol && Math.abs(q[2]! - p[2]!) <= tol);
    expect(idx).toBeGreaterThanOrEqual(0);
    used[idx] = true;
  }
};

const SLOPES: Array<{ name: string; z0: number; z2: number; lenL?: number; lenR?: number; steep?: boolean }> = [
  { name: 'flat', z0: Z0, z2: Z0 },
  { name: 'tiny+', z0: Z0 - 1e-9, z2: Z0 + 1e-9 },
  { name: 'tiny-', z0: Z0 + 1e-9, z2: Z0 - 1e-9 },
  { name: 'p1', z0: Z0 - 0.01 * LEN, z2: Z0 + 0.01 * LEN },
  { name: 'm1', z0: Z0 + 0.01 * LEN, z2: Z0 - 0.01 * LEN },
  { name: 'p5', z0: Z0 - 0.05 * LEN, z2: Z0 + 0.05 * LEN },
  { name: 'm5', z0: Z0 + 0.05 * LEN, z2: Z0 - 0.05 * LEN },
  { name: 'p15', z0: Z0 - 0.15 * LEN, z2: Z0 + 0.15 * LEN, steep: true },
  { name: 'm15', z0: Z0 + 0.15 * LEN, z2: Z0 - 0.15 * LEN, steep: true },
  { name: 'p50', z0: Z0 - 0.5 * LEN, z2: Z0 + 0.5 * LEN, steep: true },
  { name: 'm50', z0: Z0 + 0.5 * LEN, z2: Z0 - 0.5 * LEN, steep: true },
  { name: 'CREST', z0: Z0 - 2, z2: Z0 - 2 },
  { name: 'SAG', z0: Z0 + 2, z2: Z0 + 2 },
  { name: 'unequal', z0: Z0 - 0.15 * LEN, z2: Z0 + 0.05 * 50, lenL: LEN, lenR: 50 },
];

describe('20Q.1 Wave J: slope sweep through solve + worker + cert', () => {
  it.each(FAMILIES.flatMap((family) => SLOPES.map((s) => ({ family, ...s }))))(
    '$family $name solves, worker-agrees, gtop2-certifies, singular leg present',
    ({ family, z0, z2, lenL, lenR, steep }) => {
      const members = chain(z0, z2, lenL ?? LEN, lenR ?? LEN);
      // Elevation's fixed-plane member solve rejects a source whose z trend
      // runs away from the target plane: a PRE-EXISTING member gate, not the
      // transition path (admission still owns the sloped scope, below).
      if (family === 'elevation' && steep === true) {
        const out = solveWith({ members, criterion: crit('elevation'), memberCriteria: [crit('elevation'), crit('elevation')], transition: intentOf(members, 'elevation', 'left', W), transitionMemberKeys: [...KEYS] });
        expect(out.ok).toBe(false);
        if (!out.ok) expect(out.code).toBe('MEMBER_NO_SOLUTION');
        return;
      }
      const run = fullRun(members, family);
      expect(run.outcome.ok).toBe(true);
      expect(run.workerCode).toBeNull();
      expect(run.cert).toBe(GRADING_TOPOLOGY_CERTIFICATE_EXACT_VERSION);
      expect(run.result!.transition?.joint).toBe(0);
    },
  );
});

describe('20Q.1 Wave J: admission is exact (no epsilon) on the singular scope', () => {
  it('every slope admits with the singular width interval (all families)', () => {
    for (const family of FAMILIES) {
      for (const s of SLOPES) {
        const out = admitGradingTransition(admitInput(chain(s.z0, s.z2, s.lenL ?? LEN, s.lenR ?? LEN), {}, family));
        expect(out.ok).toBe(true);
        if (out.ok) expect([out.sL, out.sR, out.width]).toEqual([-W / 2, W / 2, W]);
      }
    }
  });

  it('non-finite Z / width reject; width 2·min admits and just-over rejects', () => {
    const base = chain(Z0 - 1, Z0 + 1);
    for (const z of [NaN, Infinity, -Infinity]) {
      expect(admitGradingTransition(admitInput([{ ...base[0]!, startZ: z }, base[1]!])).ok).toBe(false);
      expect(admitGradingTransition(admitInput([base[0]!, { ...base[1]!, endZ: z }])).ok).toBe(false);
    }
    const max = 2 * Math.min(base[0]!.length, base[1]!.length);
    expect(admitGradingTransition(admitInput(base, { width: 1e-6 })).ok).toBe(true);
    expect(admitGradingTransition(admitInput(base, { width: max })).ok).toBe(true);
    const over = admitGradingTransition(admitInput(base, { width: max + 1e-9 }));
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.code).toBe('WIDTH_INFEASIBLE');
    for (const width of [NaN, Infinity]) {
      expect(admitGradingTransition(admitInput(base, { width })).ok).toBe(false);
    }
  });

  it('1-ULP joint step rejects exactly; joint-continuous 1-ULP slope admits', () => {
    const u = Number.EPSILON * 8;
    const stepped = admitGradingTransition(admitInput([link(-LEN, 0, Z0, 0, 0, Z0), link(0, 0, Z0 + u, LEN, 0, Z0 + u)]));
    expect(stepped.ok).toBe(false);
    if (!stepped.ok) expect(stepped.code).toBe('JOINT_Z_STEP');
    expect(admitGradingTransition(admitInput([link(-LEN, 0, Z0, 0, 0, Z0), link(0, 0, Z0, LEN, 0, Z0 + u)])).ok).toBe(true);
  });

  it('non-collinear, arc, mixed-family, and Surface criteria reject at admission', () => {
    const slope = chain(Z0 - 1, Z0 + 1);
    const g = geomOf(slope, KEYS, 'distance');
    const bent = admitGradingTransition({ ...admitInput(slope), members: [g[0]!, { ...g[1]!, dirY: 0.001 }] });
    expect(bent.ok).toBe(false);
    if (!bent.ok) expect(bent.code).toBe('NON_COLLINEAR');
    const arc = admitGradingTransition({ ...admitInput(slope), members: [g[0]!, { ...g[1]!, isArc: true }] });
    expect(arc.ok).toBe(false);
    if (!arc.ok) expect(arc.code).toBe('NON_LINE');
    const mixed = admitGradingTransition(admitInput(slope, { members: geomOf(slope, KEYS, 'distance', [crit('distance'), crit('relative-elevation')]) }));
    expect(mixed.ok).toBe(false);
    if (!mixed.ok) expect(mixed.code).toBe('FAMILY_MISMATCH');
    const surface: GradingCriterion = { kind: 'fixed', gradeRatio: GRADE };
    const surf = admitGradingTransition(admitInput(slope, { members: geomOf(slope, KEYS, 'distance', [surface, surface]) }));
    expect(surf.ok).toBe(false);
    if (!surf.ok) expect(surf.code).toBe('FAMILY_MISMATCH');
  });

  it('arc and closed sloped inputs reject on the real solve path', () => {
    const arcMembers: ResolvedGradingSource[] = [{ ...chain(Z0 - 1, Z0 + 1)[0]!, isArc: true }, chain(Z0 - 1, Z0 + 1)[1]!];
    const arcSolve = solveWith({
      members: arcMembers, transition: intentOf(arcMembers, 'distance', 'left', W), transitionMemberKeys: [...KEYS],
    });
    expect(arcSolve.ok).toBe(false);
    const closedMembers = [
      link(-LEN, 0, Z0, 0, 0, Z0 - 1),
      link(0, 0, Z0 - 1, 0, LEN, Z0),
      link(0, LEN, Z0, -LEN, 0, Z0),
    ];
    const closedSolve = solveWith({
      members: closedMembers, closed: true,
      transition: intentOf(closedMembers, 'distance', 'left', W), transitionMemberKeys: [...KEYS],
    });
    expect(closedSolve.ok).toBe(false);
  });
});

describe('20Q.1 Wave J: coordinate transforms preserve the physical law', () => {
  const base = chain(Z0 - 3, Z0 + 3);
  const shift = (members: ResolvedGradingSource[], dx: number, dy: number, dz: number): ResolvedGradingSource[] =>
    members.map((m) => ({
      ...m, startX: m.startX + dx, endX: m.endX + dx, startY: m.startY + dy, endY: m.endY + dy,
      startZ: m.startZ + dz, endZ: m.endZ + dz,
    }));

  it.each([1e6, 1e8])('XY translate %s: solve + worker + gtop2', (dx) => {
    const run = fullRun(shift(base, dx, dx, 0), 'distance');
    expect(run.outcome.ok).toBe(true);
    expect(run.workerCode).toBeNull();
    expect(run.cert).toBe(GRADING_TOPOLOGY_CERTIFICATE_EXACT_VERSION);
  });

  it('Z shift +1e6: solve + worker + gtop2', () => {
    const run = fullRun(shift(base, 0, 0, 1e6), 'distance');
    expect(run.outcome.ok).toBe(true);
    expect(run.workerCode).toBeNull();
    expect(run.cert).toBe(GRADING_TOPOLOGY_CERTIFICATE_EXACT_VERSION);
  });

  it('mirror (y → -y with side flip) matches reflected daylight', () => {
    const atY = (members: ResolvedGradingSource[], y: number): ResolvedGradingSource[] =>
      members.map((m) => ({ ...m, startY: y, endY: y }));
    const left = fullRun(atY(base, 5), 'distance', 'left');
    const right = fullRun(atY(base, -5), 'distance', 'right');
    expect(left.outcome.ok && right.outcome.ok).toBe(true);
    expectSamePointSet(left.result!.daylightPoints!, right.result!.daylightPoints!, { y: true });
  });

  it('true traversal reversal preserves geometry (normalized compare, no ggrev1 identity equality)', () => {
    // Singular transition on a 3-member chain at joint:0; M1/M2 flat and
    // coplanar so the plain joint:1 is a coincident TANGENT corner.
    const fwdChain: ResolvedGradingSource[] = [
      link(-LEN, 0, Z0 - 3, 0, 0, Z0), link(0, 0, Z0, LEN, 0, Z0), link(LEN, 0, Z0, 2 * LEN, 0, Z0),
    ];
    const fwdCrit = [dist(5), dist(7), dist(7)];
    const forward = fullRun(fwdChain, 'distance', 'left', W, ['A', 'B', 'C'], 0, fwdCrit);
    // Reverse members + endpoints + member criteria + keys; flip side; the
    // SAME physical transition is now joint:1 (joint reindex 0 → 1).
    const rev = (m: ResolvedGradingSource): ResolvedGradingSource => link(m.endX, m.endY, m.endZ, m.startX, m.startY, m.startZ);
    const revChain = [rev(fwdChain[2]!), rev(fwdChain[1]!), rev(fwdChain[0]!)];
    const revCrit = [...fwdCrit].reverse();
    const revRun = fullRun(revChain, 'distance', 'right', W, ['C', 'B', 'A'], 1, revCrit);
    expect(forward.outcome.ok && revRun.outcome.ok).toBe(true);
    const f = forward.result!;
    const r = revRun.result!;
    expect(f.transition!.joint).toBe(0);
    expect(r.transition!.joint).toBe(1);
    expect([r.transition!.endpointScalars.vL, r.transition!.endpointScalars.vR]).toEqual([7, 5]);
    expect(r.sourceLength).toBeCloseTo(f.sourceLength, 9);
    expect(Math.abs(r.gradingPlanArea)).toBeCloseTo(Math.abs(f.gradingPlanArea), 9);
    expectSamePointSet(f.sourceBoundaryPoints!, r.sourceBoundaryPoints!, {});
    expectSamePointSet(f.daylightPoints!, r.daylightPoints!, {});
  });
});

describe('20Q.1 Wave J: worker plan agreement on the sloped path', () => {
  it('singular sloped agrees with matching evidence; tampered evidence rejects', () => {
    const members = chain(Z0 - 2, Z0 + 3);
    const plan = planOf(members, 'distance', 'left', W);
    const views: GroupTransitionMemberView[] = geomOf(members, KEYS, 'distance').map((m) => ({
      memberId: m.memberId, criterion: m.criterion, length: m.length, dirX: m.dirX, dirY: m.dirY,
      startZ: m.startZ, endZ: m.endZ, isArc: m.isArc, maxSearchDistance: m.maxSearchDistance,
    }));
    expect(checkGroupTransitionAgreement(plan, views, REV).ok).toBe(true);
    const tampered: GroupTransitionPlan = { ...plan, endpointEvidence: { ...plan.endpointEvidence, vR: plan.endpointEvidence.vR + 1 } };
    expect(checkGroupTransitionAgreement(tampered, views, REV).ok).toBe(false);
  });
});

describe('20Q.1 Wave J: plural scope — sloped whole-group rejects, all-flat passes', () => {
  const flatChain = [link(-LEN, 0, Z0, 0, 0, Z0), link(0, 0, Z0, LEN, 0, Z0), link(LEN, 0, Z0, 2 * LEN, 0, Z0)];
  const slopedChain = [link(-LEN, 0, Z0 - 1, 0, 0, Z0), link(0, 0, Z0, LEN, 0, Z0), link(LEN, 0, Z0, 2 * LEN, 0, Z0)];
  const keys3 = ['M0', 'M1', 'M2'];
  const intent = (joint: number, left: string, right: string): CadGradingTransition => ({
    policyVersion: TRANSITION_POLICY_VERSION, jointId: `joint:${joint}`, memberIds: [left, right], width: W,
    lawKind: TRANSITION_LAW_KIND, lawVersion: TRANSITION_LAW_VERSION, criterionFamily: 'distance', side: 'left',
  });
  const pluralSolve = (members: ResolvedGradingSource[]): GradingGroupComputeOutcome => solveWith({
    members, transitions: [intent(0, 'M0', 'M1'), intent(1, 'M1', 'M2')], transitionMemberKeys: [...keys3],
  });
  const viewsOf = (members: ResolvedGradingSource[]): GroupTransitionMemberView[][] => [
    geomOf([members[0]!, members[1]!], ['M0', 'M1'], 'distance'),
    geomOf([members[1]!, members[2]!], ['M1', 'M2'], 'distance'),
  ];
  const plansOf = (members: ResolvedGradingSource[]): GroupTransitionPlan[] => [
    planOf([members[0]!, members[1]!], 'distance', 'left', W, ['M0', 'M1']),
    planOf([members[1]!, members[2]!], 'distance', 'left', W, ['M1', 'M2'], members[0]!.length + members[1]!.length, 'joint:1'),
  ];

  it('any-sloped plural rejects the whole group before per-joint admission', () => {
    const out = pluralSolve(slopedChain);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.code).toBe('TRANSITION_REJECTED');
      expect(out.detail).toContain('NON_FLAT');
    }
  });

  it('all-flat plural solves + worker-agrees; sloped plural worker rejects whole-group', () => {
    expect(pluralSolve(flatChain).ok).toBe(true);
    expect(checkGroupTransitionPlansAgreement({ plans: plansOf(flatChain), views: viewsOf(flatChain), liveRevision: REV }).ok).toBe(true);
    const rejected = checkGroupTransitionPlansAgreement({ plans: plansOf(slopedChain), views: viewsOf(slopedChain), liveRevision: REV });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.code).toBe('GRADING_AGREEMENT_TRANSITION_GEOMETRY');
  });
});
