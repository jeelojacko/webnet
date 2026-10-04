/**
 * Phase 20N.1 WAVE J — production robustness / transforms / boundaries.
 *
 * PRODUCTION, not study-only: every case solves through the REAL group
 * kernel (`computeGradingGroupFromSnapshots`) via a worker-shaped
 * `GradingGroupComputeRequest` + `toGroupSolveInput`, then re-checks the
 * current worker + topology authorities:
 *   - authorized rows CURRENT: `selectGroupTransitions` (group) and
 *     `deriveGroupTransitionExpectation` (1/1/1 pre-mesh declaration);
 *   - topology 1/1/1: result `topologyCertificate` (gtop2) counts;
 *   - exact gtop2 revalidation via `gradingTopologyCertificateExactError`;
 *   - per-transition worker agreement via `checkGroupTransitionPlansAgreement`
 *     and `validateGroupTransitionLegsMesh` (EVERY leg, not first-only);
 *   - C0 plan/Z via the legislated `evaluateTransitionLinearV1` at both law
 *     endpoints (exact, no new epsilon).
 *
 * Matrix: 2T/3T x Distance/RelativeElevation/flat Elevation, mirror, true
 * traversal reversal (rebuilt order/joint indices/width order), translate
 * 1e6/1e8, unequal widths, tiny positive gap, touching/overlap rejects,
 * max per-joint width boundary (`W == 2*min(L)`, just-over rejects), invalid
 * widths, non-canonical/duplicate/sparse/stale/malformed intents, and 3x
 * deterministic rebuilds.
 */
import { describe, expect, it } from 'vitest';
import {
  computeGradingGroupFromSnapshots,
  type GradingGroupComputeOutcome,
} from '../src/engine/cad/grading/gradingGroupCompute';
import {
  deriveGroupTransitionExpectation,
  evaluateTransitionLinearV1,
  selectGroupTransitions,
} from '../src/engine/cad/grading/gradingTransitionPolicy';
import { gradingTopologyCertificateExactError } from '../src/engine/cad/grading/gradingTopologyCertificate';
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
const REV = 'ggrev1:20n1jw';
const Z = 10;
const FAMILIES = ['distance', 'relative-elevation', 'elevation'] as const;
type Family = (typeof FAMILIES)[number];
type Size = '2T' | '3T';

const criterion = (family: Family, scalar: number): GradingCriterion => {
  if (family === 'distance') return { kind: 'distance', gradeRatio: GRADE, distance: scalar };
  if (family === 'relative-elevation') {
    return { kind: 'relative-elevation', gradeRatio: GRADE, relativeElevation: scalar };
  }
  return { kind: 'elevation', gradeRatio: GRADE, targetElevation: scalar };
};

interface CaseSpec {
  family: Family;
  lengths: number[];
  scalars: number[];
  widths: number[];
  side: GradingSide;
  shiftX: number;
  shiftY: number;
}

/** Per-family member scalars; flat Elevation targets sit above the source Z. */
const scalarSet = (family: Family, size: Size): number[] => {
  if (family === 'elevation') return size === '2T' ? [12, 14, 16] : [12, 14, 16, 18];
  return size === '2T' ? [5, 7, 9] : [5, 7, 9, 11];
};

const baseCase = (family: Family, size: Size): CaseSpec => ({
  family,
  lengths: size === '2T' ? [30, 24, 30] : [30, 24, 26, 30],
  scalars: scalarSet(family, size),
  widths: size === '2T' ? [8, 6] : [8, 6, 4],
  side: 'left',
  shiftX: 0,
  shiftY: 0,
});

const modified = (c: CaseSpec, patch: Partial<CaseSpec>): CaseSpec => ({ ...c, ...patch });
const reversedCase = (c: CaseSpec): CaseSpec =>
  modified(c, {
    lengths: [...c.lengths].reverse(),
    scalars: [...c.scalars].reverse(),
    widths: [...c.widths].reverse(),
  });

const memberChain = (c: CaseSpec): ResolvedGradingSource[] => {
  let acc = 0;
  return c.lengths.map((length) => {
    const start = acc;
    acc += length;
    return {
      startX: start + c.shiftX,
      startY: c.shiftY,
      endX: acc + c.shiftX,
      endY: c.shiftY,
      startZ: Z,
      endZ: Z,
      length,
      reoriented: false,
      isArc: false,
    };
  });
};

const memberKeys = (n: number): string[] => Array.from({ length: n }, (_, i) => `M${i}>M${i + 1}`);

const plansOf = (c: CaseSpec, keys: string[]): GroupTransitionPlan[] => {
  let station = 0;
  return c.widths.map((width, j) => {
    station += c.lengths[j]!;
    return {
      policyVersion: 'trp1',
      lawKind: 'TRANSITION_LINEAR_V1',
      lawVersion: 'v1',
      criterionFamily: c.family,
      jointId: `joint:${j}`,
      memberIds: [keys[j]!, keys[j + 1]!],
      width,
      side: c.side,
      groupSide: c.side,
      isOpen: true,
      transitionCount: 1,
      jointZ: Z,
      endpointEvidence: { vL: c.scalars[j]!, vR: c.scalars[j + 1]!, gL: GRADE, gR: GRADE },
      jointStation: station,
      recordedRevision: REV,
    };
  });
};

interface Built {
  c: CaseSpec;
  keys: string[];
  plans: GroupTransitionPlan[];
  request: GradingGroupComputeRequest;
}

const build = (c: CaseSpec, patch: Partial<GradingGroupComputeRequest> = {}): Built => {
  const keys = memberKeys(c.lengths.length);
  const plans = plansOf(c, keys);
  const memberCriteria = c.scalars.map((s) => criterion(c.family, s));
  const request: GradingGroupComputeRequest = {
    groupId: 'g',
    revision: REV,
    memberSources: memberChain(c),
    side: c.side,
    criterion: memberCriteria[0]!,
    memberCriteria,
    maxSearchDistance: 50,
    curveChordTolerance: 0.01,
    closed: false,
    transitions: plans,
    transitionMemberKeys: keys,
    ...patch,
  };
  return { c, keys, plans, request };
};

const solve = (b: Built): GradingGroupComputeOutcome => computeGradingGroupFromSnapshots(toGroupSolveInput(b.request));

const ok = (b: Built): CadGradingGroupResult => {
  const outcome = solve(b);
  if (!outcome.ok) throw new Error(`expected ok, got ${outcome.code}: ${outcome.detail ?? ''}`);
  expect(outcome.ok).toBe(true);
  return outcome.result;
};

const failCode = (b: Built): string => {
  const outcome = solve(b);
  expect(outcome.ok).toBe(false);
  return (outcome as { ok: false; code: string }).code;
};

/** CURRENT authorization: canonical group + declared 1/1/1 pre-mesh strip. */
const assertAuthorized = (b: Built): void => {
  expect(selectGroupTransitions(b.plans.map((p) => ({ jointId: p.jointId }))).kind).toBe('group');
  const declared = deriveGroupTransitionExpectation(
    b.plans.map((p, j) => ({
      jointId: p.jointId,
      width: p.width,
      memberLengths: [b.c.lengths[j]!, b.c.lengths[j + 1]!] as [number, number],
      isOpen: true,
    })),
  );
  expect(declared.ok).toBe(true);
  if (!declared.ok) return;
  expect(declared.expectation).toMatchObject({
    scope: 'group',
    closed: false,
    expectedFaceComponents: 1,
    expectedBoundaryCycles: 1,
    positiveWidthRegionCount: 1,
  });
};

/** Full production gate: kernel + gtop2 + per-transition worker agreement + C0. */
const assertGates = (b: Built): CadGradingGroupResult => {
  assertAuthorized(b);
  const result = ok(b);
  const n = b.plans.length;
  expect(result.transitions).toHaveLength(n);
  expect(result.transition).toBeUndefined();
  expect(result.corners.map((corner) => corner.classification)).toEqual(new Array(n).fill('TANGENT'));

  const cert = result.topologyCertificate;
  expect(cert).toMatchObject({
    version: 'gtop2',
    scope: 'group',
    components: 1,
    boundaryCycles: 1,
    expectedComponents: 1,
    expectedBoundaryCycles: 1,
    positiveWidthRegionCount: 1,
  });
  expect(
    gradingTopologyCertificateExactError(cert, 'group', result.gradingMesh, {
      sourceBoundaryPoints: result.sourceBoundaryPoints,
      gradingBoundaryPoints: result.daylightPoints,
    }),
  ).toBeNull();

  const views = resolveGroupTransitionMemberViews(b.request);
  expect(views).not.toBeNull();
  expect(checkGroupTransitionPlansAgreement({ plans: b.plans, views: views!, liveRevision: REV }).ok).toBe(true);

  const jointZs = b.plans.map((_, j) => b.request.memberSources[j]!.endZ);
  expect(
    validateGroupTransitionLegsMesh({
      plans: b.plans,
      legs: result.transitions!,
      views: views!,
      jointZs,
      liveRevision: REV,
      maxSearchDistance: b.request.maxSearchDistance,
      daylightPoints: result.daylightPoints,
      sourceBoundaryPoints: result.sourceBoundaryPoints!,
      side: b.request.side,
    }),
  ).toBeNull();

  // C0 plan/Z: the legislated law reproduces the pinned native scalars at
  // both endpoints exactly (no epsilon), and every checkpoint is finite.
  for (const leg of result.transitions!) {
    const { vL, vR } = leg.endpointScalars;
    expect(evaluateTransitionLinearV1(vL, vR, leg.interval.sL, leg.interval.sR, leg.interval.sL)).toBe(vL);
    expect(evaluateTransitionLinearV1(vL, vR, leg.interval.sL, leg.interval.sR, leg.interval.sR)).toBe(vR);
    expect([...leg.daylightCheckpoints, ...leg.sourceCheckpoints].every(Number.isFinite)).toBe(true);
  }
  return result;
};

const assertDeterministic = (b: Built): void => {
  const runs = [0, 1, 2].map(() => JSON.stringify(solve(b)));
  expect(runs[0]).toBe(runs[1]);
  expect(runs[1]).toBe(runs[2]);
};

describe.each(FAMILIES)('20N.1 J: authorized 2T/3T rows CURRENT (%s)', (family) => {
  it.each(['2T', '3T'] as const)('%s solves through the real kernel with full gates + 3x determinism', (size) => {
    const b = build(baseCase(family, size));
    assertGates(b);
    assertDeterministic(b);
  });

  it.each(['2T', '3T'] as const)('%s unequal widths admit (strict separation still holds)', (size) => {
    const b = build(modified(baseCase(family, size), { widths: size === '2T' ? [10, 3] : [10, 4, 3] }));
    assertGates(b);
  });
});

describe('20N.1 J: rigid transforms (mirror / translate 1e6 / 1e8)', () => {
  it.each(FAMILIES)('mirror across the member axis negates plan daylight exactly (%s)', (family) => {
    const base = assertGates(build(baseCase(family, '2T')));
    const mirrored = assertGates(build(modified(baseCase(family, '2T'), { side: 'right' })));
    expect(mirrored.daylightPoints).toHaveLength(base.daylightPoints.length);
    for (let i = 0; i < base.daylightPoints.length; i += 3) {
      expect(mirrored.daylightPoints[i]).toBe(base.daylightPoints[i]);
      expect(mirrored.daylightPoints[i + 1]).toBe(-base.daylightPoints[i + 1]!);
      expect(mirrored.daylightPoints[i + 2]).toBe(base.daylightPoints[i + 2]);
    }
  });

  it.each(FAMILIES)('translate 1e6 / 1e8 is a rigid shift of the admitted strip (%s)', (family) => {
    const base = assertGates(build(baseCase(family, '3T')));
    for (const t of [1e6, 1e8]) {
      const shifted = assertGates(build(modified(baseCase(family, '3T'), { shiftX: t, shiftY: t })));
      expect(shifted.daylightPoints).toHaveLength(base.daylightPoints.length);
      for (let i = 0; i < base.daylightPoints.length; i += 3) {
        expect(shifted.daylightPoints[i]).toBe(base.daylightPoints[i]! + t);
        expect(shifted.daylightPoints[i + 1]).toBe(base.daylightPoints[i + 1]! + t);
        expect(shifted.daylightPoints[i + 2]).toBe(base.daylightPoints[i + 2]);
      }
    }
  });
});

describe('20N.1 J: true traversal reversal (PATH B1 shape)', () => {
  it.each(FAMILIES)('2T rebuilt order/width order admits with full gates (%s)', (family) => {
    const base = baseCase(family, '2T');
    const rev = build(reversedCase(base));
    // Rebuilt order: widths reversed, members laid forward from 0.
    expect(rev.plans.map((p) => p.width)).toEqual([...base.widths].reverse());
    expect(rev.request.memberSources.map((s) => s.length)).toEqual([...base.lengths].reverse());
    expect(rev.request.memberSources.map((s) => s.startX)).toEqual([0, 30, 54]);
    assertGates(rev);
  });

  it.each(FAMILIES)('3T reversed lengths/widths/criteria are physically reversed (%s)', (family) => {
    const base = baseCase(family, '3T');
    const rev = build(reversedCase(base));
    expect(rev.request.memberSources.map((s) => s.length)).toEqual([30, 26, 24, 30]);
    expect(rev.plans.map((p) => p.width)).toEqual([4, 6, 8]);
    expect(rev.plans.map((p) => p.jointId)).toEqual(['joint:0', 'joint:1', 'joint:2']);
    assertGates(rev);
  });
});

describe('20N.1 J: native gap boundaries', () => {
  it.each(FAMILIES)('tiny positive native gap meshes as one certified strip (%s)', (family) => {
    const b = build(modified(baseCase(family, '2T'), { lengths: [30, 7.0001, 30] }));
    const result = assertGates(b);
    expect(result.transitions).toHaveLength(2);
  });

  it('exact touching rejects the whole group (no partial solve)', () => {
    expect(failCode(build(modified(baseCase('distance', '2T'), { lengths: [30, 7, 30] })))).toBe('TRANSITION_REJECTED');
  });

  it('overlap rejects the whole group', () => {
    expect(failCode(build(modified(baseCase('distance', '2T'), { lengths: [30, 5, 30] })))).toBe('TRANSITION_REJECTED');
  });
});

describe('20N.1 J: per-joint width boundaries (exact, no epsilon)', () => {
  it('W == 2*min(LL,LR) admits at a shared joint; just over rejects', () => {
    // lengths [100,200,100]: joint 0 max is 2*min(100,200)=200; separation
    // 100 + 3 = 103 < 200 still holds.
    const atMax = build(modified(baseCase('distance', '2T'), { lengths: [100, 200, 100], widths: [200, 6] }));
    expect(assertGates(atMax).transitions).toHaveLength(2);
    const over = build(modified(baseCase('distance', '2T'), { lengths: [100, 200, 100], widths: [200.000001, 6] }));
    expect(failCode(over)).toBe('TRANSITION_REJECTED');
  });

  it('NaN / Infinity / zero / negative widths all reject', () => {
    for (const width of [Number.NaN, Number.POSITIVE_INFINITY, 0, -6]) {
      const b = build(modified(baseCase('distance', '2T'), { widths: [width, 6] }));
      expect(failCode(b)).toBe('TRANSITION_REJECTED');
    }
  });

  it('invalid SECOND width fails the whole group (never a partial solve)', () => {
    const b = build(modified(baseCase('distance', '3T'), { widths: [8, Number.NaN, 4] }));
    expect(failCode(b)).toBe('TRANSITION_REJECTED');
  });
});

describe('20N.1 J: intent set fail-closed (never sorted, no partial solve)', () => {
  const d3: Family = 'distance';
  const swap = (b: Built): Built => ({ ...b, request: { ...b.request, transitions: [b.plans[1]!, b.plans[0]!] } });

  it('out-of-order, duplicate, and sparse loaded intents reject', () => {
    const b = build(baseCase(d3, '2T'));
    expect(failCode(swap(b))).toBe('TRANSITION_REJECTED');
    const dup = { ...b, request: { ...b.request, transitions: [b.plans[0]!, b.plans[0]!] } };
    expect(failCode(dup)).toBe('TRANSITION_REJECTED');
    const b3 = build(baseCase(d3, '3T'));
    const sparse: Built = { ...b3, request: { ...b3.request, transitions: [b3.plans[0]!, b3.plans[2]!] } };
    expect(failCode(sparse)).toBe('TRANSITION_REJECTED');
  });

  it('one stale intent (memberIds) fails the whole group', () => {
    const b = build(baseCase(d3, '2T'));
    const stale = [...b.plans];
    stale[1] = { ...stale[1]!, memberIds: ['STALE-A', 'STALE-B'] };
    expect(failCode({ ...b, request: { ...b.request, transitions: stale } })).toBe('TRANSITION_STALE');
  });

  it('one malformed endpoint-evidence intent fails the whole group', () => {
    const b = build(baseCase(d3, '2T'));
    const bad = [...b.plans];
    bad[1] = { ...bad[1]!, endpoints: { refs: [b.keys[1]!, b.keys[2]!], values: [b.c.scalars[1]! + 1, b.c.scalars[2]!] } };
    expect(failCode({ ...b, request: { ...b.request, transitions: bad } })).toBe('TRANSITION_STALE');
  });

  it('one non-collinear member fails the whole group', () => {
    const b = build(baseCase(d3, '2T'));
    const bent = memberChain(b.c);
    const last = bent[2]!;
    bent[2] = { ...last, endX: last.startX, endY: last.startY + 30 };
    expect(failCode({ ...b, request: { ...b.request, memberSources: bent } })).toBe('TRANSITION_REJECTED');
  });
});
