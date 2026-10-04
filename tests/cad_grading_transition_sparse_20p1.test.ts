/**
 * Phase 20P.1 — sparse collinear transition-set PRODUCTION matrix.
 *
 * Implementation landed: strictly-increasing-with-gaps now ADMITS
 * (policy/topology/plural station authority, service/worker gates,
 * authoring/UI). This suite pins the production behavior through the REAL
 * kernel (`computeGradingGroupFromSnapshots` via worker-shaped
 * `GradingGroupComputeRequest` + `toGroupSolveInput`) + worker validators +
 * gtop2. Fixtures are modeled on the 20P study helpers
 * (`tests/helpers/sparseTransitionFixtures.ts`,
 * `scripts/phase20pSparseTransitionSetStudy.ts`) with one honest
 * restriction: production solves native corners at skipped joints, so
 * positives use UNIFORM member scalars (a skipped joint with mismatched
 * native offsets has no miter solution — see the CORNER_NO_SOLUTION pins in
 * the 20N.1 suites). No new geometry law, no new tolerance.
 */
import { describe, expect, it } from 'vitest';
import {
  computeGradingGroupFromSnapshots,
  type GradingGroupComputeOutcome,
} from '../src/engine/cad/grading/gradingGroupCompute';
import {
  computeJointStations,
  selectGroupTransitions,
  transitionSetStationGaps,
} from '../src/engine/cad/grading/gradingTransitionPolicy';
import { deriveGroupTransitionExpectation } from '../src/engine/cad/grading/gradingTransitionPolicy';
import { evaluateTransitionLinearV1 } from '../src/engine/cad/grading/gradingTransitionPolicy';
import { gradingTopologyCertificateExactError } from '../src/engine/cad/grading/gradingTopologyCertificate';
import { buildGroupRevision, type GroupRevisionInput } from '../src/engine/cad/grading/gradingGroupRevision';
import { transitionResultBakeCitations } from '../src/engine/cad/grading/gradingTransitionProvenance';
import { deriveGradingStatus } from '../src/engine/cad/grading/gradingStatus';
import {
  AGREEMENT_FLOOR,
  coordinateAgreementTol,
  elevationAgreementTol,
} from '../src/engine/cad/grading/gradingGroupSectors';
import {
  checkGroupTransitionPlansAgreement,
  validateGroupTransitionLegsMesh,
  type GroupTransitionPlan,
} from '../src/workers/surfaceGradingCompute';
import {
  resolveGroupTransitionMemberViews,
  toGroupSolveInput,
  type GradingGroupComputeRequest,
} from '../src/workers/surfaceWorkerHandler';
import type { CadGradingGroupResult } from '../src/engine/cad/grading/gradingGroupTypes';
import type { GradingCriterion, GradingSide, ResolvedGradingSource } from '../src/engine/cad/grading/gradingTypes';

const GRADE = 0.5;
const REV = 'ggrev1:20p1';
const Z = 10;
type Family = 'distance' | 'relative-elevation' | 'elevation';

/** Uniform scalar per family: skipped joints stay native-clean. */
const scalarOf = (family: Family): number =>
  family === 'distance' ? 5 : family === 'relative-elevation' ? 1.5 : 12;

const criterionOf = (family: Family, scalar: number): GradingCriterion => {
  if (family === 'distance') return { kind: 'distance', gradeRatio: GRADE, distance: scalar };
  if (family === 'relative-elevation') {
    return { kind: 'relative-elevation', gradeRatio: GRADE, relativeElevation: scalar };
  }
  return { kind: 'elevation', gradeRatio: GRADE, targetElevation: scalar };
};

interface SparseCase {
  family: Family;
  lengths: readonly number[];
  joints: readonly number[];
  widths: readonly number[];
  side: GradingSide;
  shiftX: number;
  shiftY: number;
  westward?: boolean;
}

const memberChain = (c: SparseCase): ResolvedGradingSource[] => {
  const dir = c.westward === true ? -1 : 1;
  const origin = c.westward === true ? c.lengths.reduce((a, b) => a + b, 0) : 0;
  let acc = 0;
  return c.lengths.map((length) => {
    const start = origin + dir * acc;
    acc += length;
    return {
      startX: start + c.shiftX,
      startY: c.shiftY,
      endX: origin + dir * acc + c.shiftX,
      endY: c.shiftY,
      startZ: Z,
      endZ: Z,
      length,
      reoriented: false,
      isArc: false,
    };
  });
};

const memberKeys = (n: number, westward = false): string[] =>
  westward
    ? Array.from({ length: n }, (_, i) => `M${n - i}>M${n - i - 1}`)
    : Array.from({ length: n }, (_, i) => `M${i}>M${i + 1}`);

const plansOf = (c: SparseCase, keys: string[]): GroupTransitionPlan[] => {
  const stations = computeJointStations(c.lengths);
  const scalar = scalarOf(c.family);
  return c.joints.map((joint, k) => ({
    policyVersion: 'trp1',
    lawKind: 'TRANSITION_LINEAR_V1',
    lawVersion: 'v1',
    criterionFamily: c.family,
    jointId: `joint:${joint}`,
    memberIds: [keys[joint]!, keys[joint + 1]!],
    width: c.widths[k]!,
    side: c.side,
    groupSide: c.side,
    isOpen: true,
    transitionCount: 1,
    jointZ: Z,
    endpointEvidence: { vL: scalar, vR: scalar, gL: GRADE, gR: GRADE },
    jointStation: stations[joint]!,
    recordedRevision: REV,
  }));
};

interface Built {
  c: SparseCase;
  keys: string[];
  plans: GroupTransitionPlan[];
  request: GradingGroupComputeRequest;
}

const build = (c: SparseCase, patch: Partial<GradingGroupComputeRequest> = {}): Built => {
  const keys = memberKeys(c.lengths.length, c.westward);
  const plans = plansOf(c, keys);
  const criteria = c.lengths.map(() => criterionOf(c.family, scalarOf(c.family)));
  const request: GradingGroupComputeRequest = {
    groupId: 'g',
    revision: REV,
    memberSources: memberChain(c),
    side: c.side,
    criterion: criteria[0]!,
    memberCriteria: criteria,
    maxSearchDistance: 50,
    curveChordTolerance: 0.01,
    closed: false,
    transitions: plans,
    transitionMemberKeys: keys,
    ...patch,
  };
  return { c, keys, plans, request };
};

const solve = (b: Built): GradingGroupComputeOutcome =>
  computeGradingGroupFromSnapshots(toGroupSolveInput(b.request));

const okOf = (b: Built): CadGradingGroupResult => {
  const outcome = solve(b);
  if (!outcome.ok) throw new Error(`expected ok, got ${outcome.code}: ${outcome.detail ?? ''}`);
  return outcome.result;
};

const codeOf = (b: Built): string => {
  const outcome = solve(b);
  expect(outcome.ok).toBe(false);
  return (outcome as { ok: false; code: string }).code;
};

const revisionInput = (b: Built, plans: GroupTransitionPlan[] = b.plans): GroupRevisionInput => ({
  sourceFeatureLineId: 'fl-sparse-20p1',
  courses: b.c.lengths.map((length, i) => ({
    vertexAId: `S${i}`,
    vertexBId: `S${i + 1}`,
    resolvedSource: {
      startX: b.request.memberSources[i]!.startX,
      startY: b.request.memberSources[i]!.startY,
      endX: b.request.memberSources[i]!.endX,
      endY: b.request.memberSources[i]!.endY,
      startZ: Z,
      endZ: Z,
      length,
      reoriented: false,
      isArc: false,
    },
  })),
  side: b.c.side,
  criterion: criterionOf(b.c.family, scalarOf(b.c.family)),
  courseCriteria: [],
  maxSearchDistance: 50,
  curveChordTolerance: 0.01,
  cornerMode: 'miter',
  closed: false,
  transitions: plans.map((p) => ({
    policyVersion: 'trp1',
    jointId: p.jointId,
    memberIds: [p.memberIds[0]!, p.memberIds[1]!],
    width: p.width,
    lawKind: 'TRANSITION_LINEAR_V1',
    lawVersion: 'v1',
    criterionFamily: b.c.family,
    side: b.c.side,
  })),
});

/** Full production gate for a sparse positive: kernel + gtop2 + worker + provenance. */
const assertSparseCurrent = (b: Built): CadGradingGroupResult => {
  // Authorized: strictly-increasing selection + 1/1/1 declared on the true station gaps.
  expect(selectGroupTransitions(b.plans.map((p) => ({ jointId: p.jointId }))).kind).toBe('group');
  const stations = computeJointStations(b.c.lengths);
  const gaps = transitionSetStationGaps(stations, b.c.joints);
  const declared = deriveGroupTransitionExpectation(
    b.plans.map((p, k) => ({
      jointId: p.jointId,
      width: p.width,
      memberLengths: [b.c.lengths[b.c.joints[k]!]!, b.c.lengths[b.c.joints[k]! + 1]!] as [number, number],
      isOpen: true,
    })),
    gaps,
  );
  expect(declared.ok).toBe(true);
  if (!declared.ok) throw new Error(`sparse set not declared: ${declared.code}`);
  expect(declared.expectation).toMatchObject({
    expectedFaceComponents: 1, expectedBoundaryCycles: 1, positiveWidthRegionCount: 1,
  });

  const result = okOf(b);
  // Leg count/order == intent order; no leg at any skipped joint.
  expect(result.transitions?.map((leg) => leg.jointId)).toEqual(b.c.joints.map((j) => `joint:${j}`));
  expect(result.transitions?.map((leg) => leg.joint)).toEqual(b.c.joints);
  const skipped = result.corners.filter((corner) => !b.c.joints.includes(corner.cornerIndex));
  expect(skipped.length).toBe(b.c.lengths.length - 1 - b.c.joints.length);
  for (const corner of skipped) {
    // Collinear native skips keep native runs: TANGENT with no transition tie.
    expect(corner.classification).toBe('TANGENT');
    expect((corner as { tiePointXyz?: readonly number[] }).tiePointXyz ?? null).toBeNull();
  }
  // Exact C0 at every cut: the legislated law reproduces endpoint scalars (no epsilon).
  for (const leg of result.transitions!) {
    const { vL, vR } = leg.endpointScalars;
    expect(evaluateTransitionLinearV1(vL, vR, leg.interval.sL, leg.interval.sR, leg.interval.sL)).toBe(vL);
    expect(evaluateTransitionLinearV1(vL, vR, leg.interval.sL, leg.interval.sR, leg.interval.sR)).toBe(vR);
    expect(leg.jointStation).toBe(stations[leg.joint]!);
  }
  // Measured == declared 1; gtop2 1/1/1 + null revalidation.
  expect(result.topologyCertificate).toMatchObject({
    version: 'gtop2', scope: 'group', components: 1, boundaryCycles: 1,
    expectedComponents: 1, expectedBoundaryCycles: 1, positiveWidthRegionCount: 1,
  });
  expect(
    gradingTopologyCertificateExactError(result.topologyCertificate!, 'group', result.gradingMesh, {
      sourceBoundaryPoints: result.sourceBoundaryPoints!,
      gradingBoundaryPoints: result.daylightPoints,
    }),
  ).toBeNull();
  // Worker pre-solve (plans agreement) + post-solve (legs mesh) both ok.
  const views = resolveGroupTransitionMemberViews(b.request)!;
  expect(views).not.toBeNull();
  expect(checkGroupTransitionPlansAgreement({ plans: b.plans, views, liveRevision: REV }).ok).toBe(true);
  expect(
    validateGroupTransitionLegsMesh({
      plans: b.plans,
      legs: result.transitions!,
      views,
      jointZs: b.plans.map((_, k) => b.request.memberSources[b.c.joints[k]!]!.endZ),
      liveRevision: REV,
      maxSearchDistance: 50,
      daylightPoints: result.daylightPoints,
      sourceBoundaryPoints: result.sourceBoundaryPoints!,
      side: b.request.side,
    }),
  ).toBeNull();
  // Revision deterministic + order-sensitive (no silent sort); citations == intent count.
  expect(buildGroupRevision(revisionInput(b))).toBe(buildGroupRevision(revisionInput(b)));
  const reversedPlans = [...b.plans].reverse();
  expect(buildGroupRevision(revisionInput(b, reversedPlans))).not.toBe(buildGroupRevision(revisionInput(b)));
  expect(transitionResultBakeCitations(result.transitions!)?.length).toBe(b.c.joints.length);
  // Fresh exact result derives CURRENT.
  expect(
    deriveGradingStatus({ courseResolved: true, targetExists: true, sourceExists: true, building: false, hasResult: true, targetCurrent: true, resultRevision: REV, currentRevision: REV }),
  ).toBe('CURRENT');
  return result;
};

/* The 8 study joint sets, uniform-scalar production fixtures. */
const SETS: { tag: string; lengths: number[]; joints: number[]; widths: number[] }[] = [
  { tag: 'sparse02', lengths: [30, 24, 26, 30], joints: [0, 2], widths: [8, 6] },
  { tag: 'sparse024', lengths: [30, 24, 26, 22, 28, 30], joints: [0, 2, 4], widths: [8, 6, 4] },
  { tag: 'sparse03', lengths: [30, 24, 26, 22, 30], joints: [0, 3], widths: [8, 6] },
  { tag: 'sparse14', lengths: [30, 24, 26, 22, 28, 30], joints: [1, 4], widths: [8, 6] },
  { tag: 'cluster013', lengths: [30, 24, 26, 22, 30], joints: [0, 1, 3], widths: [8, 6, 4] },
  { tag: 'cluster023', lengths: [30, 24, 26, 22, 30], joints: [0, 2, 3], widths: [8, 6, 4] },
  { tag: 'cluster0134', lengths: [30, 24, 26, 22, 28, 30], joints: [0, 1, 3, 4], widths: [8, 6, 4, 5] },
  { tag: 'cluster0235', lengths: [30, 24, 26, 22, 28, 24, 30], joints: [0, 2, 3, 5], widths: [8, 6, 4, 5] },
];

describe('20P.1 positives: all 8 sparse/mixed-cluster sets reach CURRENT/CERTIFIED (distance/left)', () => {
  it.each(SETS.map((s) => s.tag))('%s solves with full gates', (tag) => {
    const spec = SETS.find((s) => s.tag === tag)!;
    const result = assertSparseCurrent(
      build({ family: 'distance', lengths: spec.lengths, joints: spec.joints, widths: spec.widths, side: 'left', shiftX: 0, shiftY: 0 }),
    );
    // Uniform distance scalar: the whole strip (native runs included) sits at offset 5.
    for (let i = 1; i < result.daylightPoints.length; i += 3) {
      expect(result.daylightPoints[i]).toBe(5);
    }
  });
});

describe('20P.1 positives: family x side representative (not exhaustive)', () => {
  it.each(['distance', 'relative-elevation', 'elevation'] as const)('[0,2] %s/left solves', (family) => {
    assertSparseCurrent(build({ family, lengths: [30, 24, 26, 30], joints: [0, 2], widths: [8, 6], side: 'left', shiftX: 0, shiftY: 0 }));
  });

  it.each(['distance', 'relative-elevation', 'elevation'] as const)('[0,2] %s/right solves', (family) => {
    assertSparseCurrent(build({ family, lengths: [30, 24, 26, 30], joints: [0, 2], widths: [8, 6], side: 'right', shiftX: 0, shiftY: 0 }));
  });

  it('mixed cluster [0,1,3,4] relative-elevation/right solves', () => {
    assertSparseCurrent(build({
      family: 'relative-elevation', lengths: [30, 24, 26, 22, 28, 30],
      joints: [0, 1, 3, 4], widths: [8, 6, 4, 5], side: 'right', shiftX: 0, shiftY: 0,
    }));
  });

  it('mixed cluster [0,2,3] elevation/left solves', () => {
    assertSparseCurrent(build({
      family: 'elevation', lengths: [30, 24, 26, 22, 30],
      joints: [0, 2, 3], widths: [8, 6, 4], side: 'left', shiftX: 0, shiftY: 0,
    }));
  });
});

describe('20P.1 boundaries: touch/overlap fail, station gap (not member length) decides', () => {
  it('sparse near-touch admits with a 1m native run', () => {
    // Gap S(2)-S(0) = 24+26 = 50; half-span 23+26 = 49 < 50.
    const result = assertSparseCurrent(
      build({ family: 'distance', lengths: [30, 24, 26, 30], joints: [0, 2], widths: [46, 52], side: 'left', shiftX: 0, shiftY: 0 }),
    );
    expect(result.transitions).toHaveLength(2);
  });

  it('sparse exact-touch rejects; consecutive exact-touch still rejects', () => {
    // Half-span 24+26 = 50 == gap 50.
    expect(codeOf(build({ family: 'distance', lengths: [30, 24, 26, 30], joints: [0, 2], widths: [48, 52], side: 'left', shiftX: 0, shiftY: 0 }))).toBe('TRANSITION_REJECTED');
    // Consecutive control unchanged: half-span 4+3 = 7 == shared member 7.
    expect(codeOf(build({ family: 'distance', lengths: [30, 7, 30], joints: [0, 1], widths: [8, 6], side: 'left', shiftX: 0, shiftY: 0 }))).toBe('TRANSITION_REJECTED');
  });

  it('overlap rejects; per-joint feasibility fires before separation on naive sparse overlap', () => {
    // Consecutive overlap: both widths feasible, separation rejects.
    expect(codeOf(build({ family: 'distance', lengths: [30, 24, 30], joints: [0, 1], widths: [40, 20], side: 'left', shiftX: 0, shiftY: 0 }))).toBe('TRANSITION_REJECTED');
    // Naive sparse overlap [60,52]: joint 0 width 60 exceeds 2*min(30,24)=48,
    // so per-joint WIDTH_INFEASIBLE rejects before the separation check runs.
    const outcome = solve(build({ family: 'distance', lengths: [30, 24, 26, 30], joints: [0, 2], widths: [60, 52], side: 'left', shiftX: 0, shiftY: 0 }));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe('TRANSITION_REJECTED');
      expect(outcome.detail).toMatch(/WIDTH_INFEASIBLE/);
    }
  });

  it('wide-gap [0,2] proves the station difference, not the immediate member length', () => {
    // Members [100,5,100,100]: gap S(2)-S(0) = 5+100 = 105 >> immediate L1 = 5.
    const b = build({ family: 'distance', lengths: [100, 5, 100, 100], joints: [0, 2], widths: [10, 190], side: 'left', shiftX: 0, shiftY: 0 });
    expect(transitionSetStationGaps(computeJointStations(b.c.lengths), [0, 2])).toEqual([105]);
    expect(assertSparseCurrent(b).transitions).toHaveLength(2);
  });
});

describe('20P.1 negatives: whole-set fail-closed, trp1 unchanged', () => {
  const base = { family: 'distance', lengths: [30, 24, 26, 30], widths: [8, 6], side: 'left', shiftX: 0, shiftY: 0 } as const;

  it.each([
    ['duplicate joints', [0, 0]],
    ['out-of-order joints', [2, 0]],
  ])('%s reject', (_label: string, joints: number[]) => {
    expect(codeOf(build({ ...base, joints }))).toBe('TRANSITION_REJECTED');
  });

  it('malformed joint id rejects', () => {
    const b = build({ ...base, joints: [0, 2] });
    expect(codeOf({ ...b, request: { ...b.request, transitions: [{ ...b.plans[0]! }, { ...b.plans[1]!, jointId: 'bogus' }] } })).toBe('TRANSITION_REJECTED');
  });

  it('stale memberIds fail the whole set', () => {
    const b = build({ ...base, joints: [0, 2] });
    const stale = [...b.plans];
    stale[1] = { ...stale[1]!, memberIds: ['STALE-A', 'STALE-B'] };
    expect(codeOf({ ...b, request: { ...b.request, transitions: stale } })).toBe('TRANSITION_STALE');
  });

  it('stale recorded revision fails the worker pre-solve gate', () => {
    const b = build({ ...base, joints: [0, 2] });
    const stale = [...b.plans];
    stale[1] = { ...stale[1]!, recordedRevision: 'ggrev1:other' };
    const views = resolveGroupTransitionMemberViews(b.request)!;
    const out = checkGroupTransitionPlansAgreement({ plans: stale, views, liveRevision: REV });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe('GRADING_AGREEMENT_TRANSITION_STALE');
  });

  it.each([[0], [-4], [Number.NaN], [Number.POSITIVE_INFINITY]])('width %s rejects (one bad among valid)', (width: number) => {
    expect(codeOf(build({ ...base, joints: [0, 2], widths: [width, 6] }))).toBe('TRANSITION_REJECTED');
  });

  it('just-over-max width rejects (48.000001 > 2*min(30,24))', () => {
    expect(codeOf(build({ ...base, joints: [0, 2], widths: [48.000001, 6] }))).toBe('TRANSITION_REJECTED');
  });

  it('deflected ACTUAL transition joint rejects (NON_COLLINEAR gate intact)', () => {
    const b = build({ ...base, joints: [0, 2] });
    const bent = memberChain(b.c);
    bent[3] = { ...bent[3]!, endX: bent[3]!.startX, endY: bent[3]!.startY + 30 };
    expect(codeOf({ ...b, request: { ...b.request, memberSources: bent } })).toBe('TRANSITION_REJECTED');
  });

  it('surface member rejects before transition admission', () => {
    const b = build({ ...base, joints: [0, 2] });
    const criteria = b.request.memberCriteria!.map((criterion, i) =>
      i === 2 ? ({ kind: 'surface', gradeRatio: GRADE } as unknown as GradingCriterion) : criterion,
    );
    const outcome = solve({ ...b, request: { ...b.request, memberCriteria: criteria } });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe('MEMBER_NO_SOLUTION');
  });

  it('grade mismatch rejects (exact equal gradeRatio required)', () => {
    const b = build({ ...base, joints: [0, 2] });
    const criteria = b.request.memberCriteria!.map((criterion, i) =>
      i === 2 ? { ...criterion, gradeRatio: 0.25 } : criterion,
    );
    expect(codeOf({ ...b, request: { ...b.request, memberCriteria: criteria } })).toBe('TRANSITION_REJECTED');
  });

  it('arc-bearing member at a transition joint rejects', () => {
    const b = build({ ...base, joints: [0, 2] });
    const arced = memberChain(b.c);
    arced[0] = { ...arced[0]!, isArc: true };
    expect(codeOf({ ...b, request: { ...b.request, memberSources: arced } })).toBe('TRANSITION_REJECTED');
  });

  it('closed group with sparse intents fails closed', () => {
    const loop: ResolvedGradingSource[] = [
      { startX: 0, startY: 0, endX: 30, endY: 0, startZ: 10, endZ: 10, length: 30, reoriented: false, isArc: false },
      { startX: 30, startY: 0, endX: 30, endY: 30, startZ: 10, endZ: 10, length: 30, reoriented: false, isArc: false },
      { startX: 30, startY: 30, endX: 0, endY: 30, startZ: 10, endZ: 10, length: 30, reoriented: false, isArc: false },
      { startX: 0, startY: 30, endX: 0, endY: 0, startZ: 10, endZ: 10, length: 30, reoriented: false, isArc: false },
    ];
    const b = build({ ...base, joints: [0, 2] });
    expect(codeOf({ ...b, request: { ...b.request, memberSources: loop, closed: true } })).toBe('TRANSITION_REJECTED');
  });

  it('sloped source / joint-Z step confined to a skipped-only member fail at the native corner', () => {
    // Joints [0,3]: member 2 is incident only to skipped joints 1 and 2, so
    // the transition gate passes and the failure is purely the native corner.
    const spec = { family: 'distance', lengths: [30, 24, 26, 22, 30], joints: [0, 3], widths: [8, 6], side: 'left', shiftX: 0, shiftY: 0 } as const;
    for (const variant of ['sloped', 'zstep'] as const) {
      const probe = build(spec);
      const members = memberChain(probe.c);
      members[2] = {
        ...members[2]!,
        endZ: variant === 'sloped' ? 10.5 : 11,
        startZ: variant === 'sloped' ? 10 : 11,
      };
      const outcome = solve({ ...probe, request: { ...probe.request, memberSources: members } });
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.code).toBe('CORNER_INVERTED');
        // Failing corner is a skipped joint in both variants (slope breaks
        // joint 1 first, Z-step breaks joint 2 first); the transition
        // joints themselves stay admitted.
        expect([1, 2]).toContain((outcome as { cornerIndex: number }).cornerIndex);
        expect(outcome.detail).toBe('GRADING_GROUP_CORNER_MISMATCH');
      }
    }
  });
});

describe('20P.1 skipped joints: one honest ordinary-analytic bent corner', () => {
  it('deflected skipped-only member fails closed at the native corner (no auto-transition)', () => {
    // Joints [0,3] on [30,24,26,22,30]: bending member 2 deflects skipped
    // joints 1 and 2 only. The ordinary analytic corner path owns deflected
    // skips (sparse authority covers collinear-equal skips); production
    // refuses fail-closed instead of auto-transitioning the bent joint.
    const probe = build({ family: 'distance', lengths: [30, 24, 26, 22, 30], joints: [0, 3], widths: [8, 6], side: 'left', shiftX: 0, shiftY: 0 });
    const members = memberChain(probe.c);
    members[2] = { ...members[2]!, endX: members[2]!.startX, endY: members[2]!.startY + 26 };
    const outcome = solve({ ...probe, request: { ...probe.request, memberSources: members } });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe('CORNER_INVERTED');
      expect(outcome).toMatchObject({ cornerIndex: 2, detail: 'GRADING_GROUP_CORNER_MISMATCH' });
    }
  });
});

describe('20P.1 transforms: mirror / translate / true reversal cohere', () => {
  const agreeTriple = (a: readonly number[], f: number, b: readonly number[], r: number): void => {
    const sx = Math.max(1, Math.abs(a[f]!), Math.abs(b[r]!));
    const sy = Math.max(1, Math.abs(a[f + 1]!), Math.abs(b[r + 1]!));
    expect(Math.abs(a[f]! - b[r]!)).toBeLessThanOrEqual(coordinateAgreementTol(a[f]!, b[r]!, sx) + AGREEMENT_FLOOR);
    expect(Math.abs(a[f + 1]! - b[r + 1]!)).toBeLessThanOrEqual(coordinateAgreementTol(a[f + 1]!, b[r + 1]!, sy) + AGREEMENT_FLOOR);
    expect(Math.abs(a[f + 2]! - b[r + 2]!)).toBeLessThanOrEqual(elevationAgreementTol(a[f + 2]!, b[r + 2]!, []) + AGREEMENT_FLOOR);
  };

  it('mirror negates plan daylight exactly ([0,2] + mixed [0,1,3])', () => {
    for (const spec of [
      { lengths: [30, 24, 26, 30], joints: [0, 2], widths: [8, 6] },
      { lengths: [30, 24, 26, 22, 30], joints: [0, 1, 3], widths: [8, 6, 4] },
    ]) {
      const left = assertSparseCurrent(build({ family: 'distance', ...spec, side: 'left', shiftX: 0, shiftY: 0 }));
      const right = assertSparseCurrent(build({ family: 'distance', ...spec, side: 'right', shiftX: 0, shiftY: 0 }));
      expect(right.daylightPoints).toHaveLength(left.daylightPoints.length);
      for (let i = 0; i < left.daylightPoints.length; i += 3) {
        expect(right.daylightPoints[i]).toBe(left.daylightPoints[i]);
        expect(right.daylightPoints[i + 1]).toBe(-left.daylightPoints[i + 1]!);
        expect(right.daylightPoints[i + 2]).toBe(left.daylightPoints[i + 2]);
      }
    }
  });

  it('translate 1e6 / 1e8 is a rigid shift ([0,2] + mixed [0,1,3])', () => {
    for (const spec of [
      { lengths: [30, 24, 26, 30], joints: [0, 2], widths: [8, 6] },
      { lengths: [30, 24, 26, 22, 30], joints: [0, 1, 3], widths: [8, 6, 4] },
    ]) {
      const baseResult = assertSparseCurrent(build({ family: 'distance', ...spec, side: 'left', shiftX: 0, shiftY: 0 }));
      for (const t of [1e6, 1e8]) {
        const shifted = assertSparseCurrent(build({ family: 'distance', ...spec, side: 'left', shiftX: t, shiftY: t }));
        for (let i = 0; i < baseResult.daylightPoints.length; i += 3) {
          expect(shifted.daylightPoints[i]).toBe(baseResult.daylightPoints[i]! + t);
          expect(shifted.daylightPoints[i + 1]).toBe(baseResult.daylightPoints[i + 1]! + t);
          expect(shifted.daylightPoints[i + 2]).toBe(baseResult.daylightPoints[i + 2]);
        }
      }
    }
  });

  it('true traversal reversal (rebuilt order, reindexed joints, mapped widths) coheres', () => {
    // Same route walked total→0: reversed lengths/widths/criteria, directed
    // endpoint identities, opposite side. ggrev1 equality across reversal is
    // NOT required (different persisted courses hash differently).
    const fwd = { family: 'distance', lengths: [30, 24, 26, 30], joints: [0, 2], widths: [8, 6], side: 'left', shiftX: 0, shiftY: 0 } as const;
    const forward = okOf(build({ ...fwd }));
    const rev = build({
      family: 'distance',
      lengths: [...fwd.lengths].reverse(),
      // Positional joints in the reversed walk: fwd joints [0,2] become
      // [0,2] with physically-mapped widths [6,8].
      joints: [0, 2],
      widths: [...fwd.widths].reverse(),
      side: 'right',
      shiftX: 0,
      shiftY: 0,
      westward: true,
    });
    expect(rev.plans.map((p) => p.width)).toEqual([6, 8]);
    expect(rev.keys).toEqual(['M4>M3', 'M3>M2', 'M2>M1', 'M1>M0']);
    const reversed = okOf(rev);
    const pairs = [
      [forward.daylightPoints, reversed.daylightPoints],
      [forward.sourceBoundaryPoints!, reversed.sourceBoundaryPoints!],
    ] as const;
    for (const [a, b] of pairs) {
      expect(b.length).toBe(a.length);
      const n = a.length / 3;
      for (let k = 0; k < n; k += 1) agreeTriple(a, k * 3, b, (n - 1 - k) * 3);
    }
    expect(reversed.topologyCertificate!.components).toBe(1);
    expect(reversed.topologyCertificate!.boundaryCycles).toBe(1);
  });
});

describe('20P.1 compatibility: no-transition / singular / consecutive unchanged', () => {
  it('no-transition group solves the legacy path (see 20M suites; cheap pin)', () => {
    const b = build({ family: 'distance', lengths: [30, 24, 30], joints: [0, 1], widths: [8, 6], side: 'left', shiftX: 0, shiftY: 0 });
    const outcome = solve({ ...b, request: { ...b.request, transitions: [], transitionMemberKeys: b.keys } });
    expect(outcome.ok).toBe(true);
  });

  it('singular intent still takes the single path with one leg', () => {
    const b = build({ family: 'distance', lengths: [30, 24, 30], joints: [0], widths: [8], side: 'left', shiftX: 0, shiftY: 0 });
    const single = { ...b, request: { ...b.request, transitions: [b.plans[0]!] } };
    expect(selectGroupTransitions([{ jointId: 'joint:0' }]).kind).toBe('single');
    const result = okOf(single);
    // Singular path keeps the single `transition` object (never a legs array).
    expect(result.transition).toBeDefined();
    expect(result.transitions).toBeUndefined();
    expect(result.topologyCertificate).toMatchObject({ components: 1, boundaryCycles: 1 });
  });

  it('consecutive 20N.1 pair unchanged (reference suites own the pins)', () => {
    const result = assertSparseCurrent(
      build({ family: 'distance', lengths: [30, 24, 30], joints: [0, 1], widths: [8, 6], side: 'left', shiftX: 0, shiftY: 0 }),
    );
    expect(result.transitions).toHaveLength(2);
  });
});

describe('20P.1 perf: single cumulative-station pass, no repeated prefix sums', () => {
  it('500-member sparse group solves; stations/gaps are one pass each', () => {
    // computeJointStations is one left-to-right cumulative pass by
    // construction; transitionSetStationGaps is one pass over the ordered
    // joints — O(members + transitions + vertices), no repeated prefix sums.
    const lengths = Array.from({ length: 500 }, (_, i) => 20 + (i % 3));
    const stations = computeJointStations(lengths);
    expect(stations).toHaveLength(500);
    let acc = 0;
    for (let i = 0; i < lengths.length; i += 1) {
      acc += lengths[i]!;
      expect(stations[i]).toBe(acc);
    }
    expect(transitionSetStationGaps(stations, [0, 498])).toEqual([stations[498]! - stations[0]!]);
    const b = build({ family: 'distance', lengths, joints: [0, 498], widths: [8, 6], side: 'left', shiftX: 0, shiftY: 0 });
    const result = okOf(b);
    expect(result.transitions?.map((leg) => leg.jointId)).toEqual(['joint:0', 'joint:498']);
    expect(result.transitions?.map((leg) => leg.jointStation)).toEqual([stations[0], stations[498]]);
    expect(result.topologyCertificate).toMatchObject({ components: 1, positiveWidthRegionCount: 1 });
  });
});
