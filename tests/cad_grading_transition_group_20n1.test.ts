/**
 * Phase 20N.1 Wave E — multi-transition engine tiling (2T/3T full solves).
 *
 * THEN Wave A RED gap (group solve rejected on cardinality) turns GREEN:
 * strictly-separated collinear same-family joint pairs/triples solve as ONE
 * group — every intent validated against the immutable original solves
 * first, each affected member rebuilt atomically once, each transitioned
 * joint recorded TANGENT exactly as 20M.2. One bad intent fails the whole
 * group with no partial solve. The exactly-1 path stays byte-identical
 * (length-1 array === singular object; per-joint legs match standalone
 * single-transition solves).
 */
import { describe, expect, it } from 'vitest';
import {
  computeGradingGroupFromSnapshots,
  type GradingGroupComputeOutcome,
  type GroupSolveInput,
} from '../src/engine/cad/grading/gradingGroupCompute';
import type { CadGradingTransition } from '../src/engine/cad/grading/gradingGroupTypes';
import type { GradingCriterion, ResolvedGradingSource } from '../src/engine/cad/grading/gradingTypes';

const DIST = (g: number, d: number): GradingCriterion => ({ kind: 'distance', gradeRatio: g, distance: d });
const REL = (g: number, dz: number): GradingCriterion => ({
  kind: 'relative-elevation', gradeRatio: g, relativeElevation: dz,
});
const ELEV = (g: number, e: number): GradingCriterion => ({ kind: 'elevation', gradeRatio: g, targetElevation: e });

/** Collinear flat members on the x-axis from a length list. */
const chain = (lengths: number[]): ResolvedGradingSource[] => {
  let x = 0;
  return lengths.map((length) => {
    const startX = x;
    x += length;
    return {
      startX, startY: 0, endX: x, endY: 0,
      startZ: 10, endZ: 10, length,
      reoriented: false, isArc: false,
    };
  });
};

const keysFor = (n: number): string[] => Array.from({ length: n }, (_, i) => `M${i}>M${i + 1}`);

const intent = (
  joint: number,
  width: number,
  memberKeys: string[],
  family: string,
): CadGradingTransition => ({
  policyVersion: 'trp1',
  jointId: `joint:${joint}`,
  memberIds: [memberKeys[joint]!, memberKeys[joint + 1]!],
  width,
  lawKind: 'TRANSITION_LINEAR_V1',
  lawVersion: 'v1',
  criterionFamily: family,
  side: 'left',
});

const solveGroup = (
  lengths: number[],
  criteria: GradingCriterion[],
  intents: CadGradingTransition[],
  extra: Partial<GroupSolveInput> = {},
): GradingGroupComputeOutcome => {
  const keys = keysFor(lengths.length);
  return computeGradingGroupFromSnapshots({
    groupId: 'g',
    revision: 'ggrev1:t',
    members: chain(lengths),
    side: 'left',
    criterion: criteria[0]!,
    memberCriteria: criteria,
    maxSearchDistance: 50,
    curveChordTolerance: 0.01,
    closed: false,
    transitions: intents,
    transitionMemberKeys: keys,
    ...extra,
  });
};

const okOf = (o: GradingGroupComputeOutcome) => {
  expect(o.ok).toBe(true);
  if (!o.ok) throw new Error(`expected ok, got ${JSON.stringify(o)}`);
  return o.result;
};

const codeOf = (o: GradingGroupComputeOutcome): string => {
  expect(o.ok).toBe(false);
  return (o as { ok: false; code: string }).code;
};

/** Every triangle strictly positive plan area (oriented, no fold). */
const assertOriented = (points: number[], triangles: number[]): void => {
  expect(triangles.length).toBeGreaterThan(0);
  for (let i = 0; i < triangles.length; i += 3) {
    const [a, b, c] = [triangles[i]! * 3, triangles[i + 1]! * 3, triangles[i + 2]! * 3];
    const area2 = (points[b]! - points[a]!) * (points[c + 1]! - points[a + 1]!) -
      (points[c]! - points[a]!) * (points[b + 1]! - points[a + 1]!);
    expect(area2).toBeGreaterThan(0);
  }
  for (const v of points) expect(Number.isFinite(v)).toBe(true);
};

describe('20N.1 Wave E: 2T full solve (lengths [30,24,30], widths 8/6)', () => {
  it('distance: exact daylight pin, TANGENT corners, plural legs, certificate', () => {
    const keys = keysFor(3);
    const result = okOf(solveGroup(
      [30, 24, 30],
      [DIST(0.5, 5), DIST(0.5, 7), DIST(0.5, 9)],
      [intent(0, 8, keys, 'distance'), intent(1, 6, keys, 'distance')],
    ));
    expect(result.daylightPoints).toEqual([
      0, 5, 12.5, 26, 5, 12.5, 30, 6, 13, 34, 7, 13.5,
      51, 7, 13.5, 54, 8, 14, 57, 9, 14.5, 84, 9, 14.5,
    ]);
    expect(result.corners).toHaveLength(2);
    expect(result.corners[0]).toMatchObject({
      cornerIndex: 0, vertexId: 'joint:0', classification: 'TANGENT', tiePointXyz: [30, 6, 13],
    });
    expect(result.corners[1]).toMatchObject({
      cornerIndex: 1, vertexId: 'joint:1', classification: 'TANGENT', tiePointXyz: [54, 8, 14],
    });
    // Plural legs in canonical joint order; no singular leg on the N>1 path.
    expect(result.transition).toBeUndefined();
    expect(result.transitions).toHaveLength(2);
    expect(result.transitions![0]).toMatchObject({
      joint: 0, jointId: 'joint:0', memberIds: ['M0>M1', 'M1>M2'],
      criterionFamily: 'distance', interval: { sL: -4, sR: 4 },
      endpointScalars: { vL: 5, vR: 7, gL: 0.5, gR: 0.5 },
      jointStation: 30, recordedRevision: 'ggrev1:t', agreementCode: null,
    });
    expect(result.transitions![1]).toMatchObject({
      joint: 1, jointId: 'joint:1', memberIds: ['M1>M2', 'M2>M3'],
      criterionFamily: 'distance', interval: { sL: -3, sR: 3 },
      endpointScalars: { vL: 7, vR: 9, gL: 0.5, gR: 0.5 },
      jointStation: 54, recordedRevision: 'ggrev1:t', agreementCode: null,
    });
    for (const leg of result.transitions!) {
      expect(leg.daylightCheckpoints).toHaveLength(9);
      expect(leg.sourceCheckpoints).toHaveLength(9);
    }
    // Shared middle keeps ONE native subsolve between the cuts.
    expect(result.memberRegions).toEqual([
      { memberIndex: 0, classification: 'FIXED', stationSpan: [0, 26] },
      { memberIndex: 0, classification: 'FIXED', stationSpan: [26, 30] },
      { memberIndex: 1, classification: 'FIXED', stationSpan: [0, 4] },
      { memberIndex: 1, classification: 'FIXED', stationSpan: [4, 21] },
      { memberIndex: 1, classification: 'FIXED', stationSpan: [21, 24] },
      { memberIndex: 2, classification: 'FIXED', stationSpan: [0, 3] },
      { memberIndex: 2, classification: 'FIXED', stationSpan: [3, 30] },
    ]);
    expect(result.gradingMesh.triangles).toHaveLength(14 * 3);
    assertOriented(result.gradingMesh.points, result.gradingMesh.triangles);
    expect(result.topologyCertificate).toBeDefined();
    // Deterministic: re-solve is byte-identical.
    const again = okOf(solveGroup(
      [30, 24, 30],
      [DIST(0.5, 5), DIST(0.5, 7), DIST(0.5, 9)],
      [intent(0, 8, keys, 'distance'), intent(1, 6, keys, 'distance')],
    ));
    expect(JSON.stringify(again)).toBe(JSON.stringify(result));
  });

  it('per-joint legs match standalone single-transition solves (20M.2 parity)', () => {
    const keys = keysFor(3);
    const group = okOf(solveGroup(
      [30, 24, 30],
      [DIST(0.5, 5), DIST(0.5, 7), DIST(0.5, 9)],
      [intent(0, 8, keys, 'distance'), intent(1, 6, keys, 'distance')],
    ));
    // Standalone 2-member solve around joint 0 only.
    const single = okOf(computeGradingGroupFromSnapshots({
      groupId: 'g', revision: 'ggrev1:t',
      members: chain([30, 24]), side: 'left',
      criterion: DIST(0.5, 5), memberCriteria: [DIST(0.5, 5), DIST(0.5, 7)],
      maxSearchDistance: 50, curveChordTolerance: 0.01, closed: false,
      transition: intent(0, 8, keys, 'distance'),
      transitionMemberKeys: keys.slice(0, 2),
    }));
    expect(single.transition).toBeDefined();
    expect(group.transitions![0]).toEqual(single.transition);
  });

  it('length-1 array solves byte-identical to the singular object path', () => {
    const keys = keysFor(2);
    const viaArray = okOf(solveGroup(
      [20, 20], [DIST(0.5, 5), DIST(0.5, 7)], [intent(0, 8, keys, 'distance')],
    ));
    const viaSingle = okOf(computeGradingGroupFromSnapshots({
      groupId: 'g', revision: 'ggrev1:t',
      members: chain([20, 20]), side: 'left',
      criterion: DIST(0.5, 5), memberCriteria: [DIST(0.5, 5), DIST(0.5, 7)],
      maxSearchDistance: 50, curveChordTolerance: 0.01, closed: false,
      transition: intent(0, 8, keys, 'distance'),
      transitionMemberKeys: keys,
    }));
    expect(JSON.stringify(viaArray)).toBe(JSON.stringify(viaSingle));
  });

  it('relative-elevation and elevation 2T solve green (structure + determinism)', () => {
    for (const [criteria, family] of [
      [[REL(0.5, 2), REL(0.5, 4), REL(0.5, 6)], 'relative-elevation'],
      [[ELEV(0.5, 12), ELEV(0.5, 14), ELEV(0.5, 16)], 'elevation'],
    ] as const) {
      const keys = keysFor(3);
      const list = [...criteria] as GradingCriterion[];
      const result = okOf(solveGroup(
        [30, 24, 30], list,
        [intent(0, 8, keys, family), intent(1, 6, keys, family)],
      ));
      expect(result.corners.map((c) => c.classification)).toEqual(['TANGENT', 'TANGENT']);
      expect(result.transitions).toHaveLength(2);
      expect(result.transitions![0]).toMatchObject({ joint: 0, interval: { sL: -4, sR: 4 } });
      expect(result.transitions![1]).toMatchObject({ joint: 1, interval: { sL: -3, sR: 3 } });
      assertOriented(result.gradingMesh.points, result.gradingMesh.triangles);
      expect(result.topologyCertificate).toBeDefined();
      const again = okOf(solveGroup(
        [30, 24, 30], list,
        [intent(0, 8, keys, family), intent(1, 6, keys, family)],
      ));
      expect(JSON.stringify(again)).toBe(JSON.stringify(result));
    }
  });
});

describe('20N.1 Wave E: 3T full solve (lengths [30,24,26,30], widths 8/6/4)', () => {
  it('distance: three TANGENT joints, one merged strip, deterministic', () => {
    const keys = keysFor(4);
    const intents = [intent(0, 8, keys, 'distance'), intent(1, 6, keys, 'distance'), intent(2, 4, keys, 'distance')];
    const result = okOf(solveGroup([30, 24, 26, 30], [DIST(0.5, 5), DIST(0.5, 7), DIST(0.5, 9), DIST(0.5, 11)], intents));
    expect(result.corners.map((c) => [c.cornerIndex, c.classification])).toEqual([
      [0, 'TANGENT'], [1, 'TANGENT'], [2, 'TANGENT'],
    ]);
    expect(result.transitions!.map((leg) => leg.joint)).toEqual([0, 1, 2]);
    expect(result.transitions![2]).toMatchObject({
      jointId: 'joint:2', interval: { sL: -2, sR: 2 },
      endpointScalars: { vL: 9, vR: 11, gL: 0.5, gR: 0.5 },
      jointStation: 80,
    });
    assertOriented(result.gradingMesh.points, result.gradingMesh.triangles);
    expect(result.topologyCertificate).toBeDefined();
    const again = okOf(solveGroup([30, 24, 26, 30], [DIST(0.5, 5), DIST(0.5, 7), DIST(0.5, 9), DIST(0.5, 11)], intents));
    expect(JSON.stringify(again)).toBe(JSON.stringify(result));
  });
});

describe('20N.1 Wave E: whole-group fail-closed (no partial solve)', () => {
  const D3 = (): GradingCriterion[] => [DIST(0.5, 5), DIST(0.5, 7), DIST(0.5, 9)];

  it('touching (==) and overlap reject the group', () => {
    const keys = keysFor(3);
    expect(codeOf(solveGroup(
      [30, 7, 30], D3(),
      [intent(0, 8, keys, 'distance'), intent(1, 6, keys, 'distance')],
    ))).toBe('TRANSITION_REJECTED');
    expect(codeOf(solveGroup(
      [30, 5, 30], D3(),
      [intent(0, 8, keys, 'distance'), intent(1, 6, keys, 'distance')],
    ))).toBe('TRANSITION_REJECTED');
  });

  it('one stale joint fails the group (no partial solve)', () => {
    const keys = keysFor(3);
    const bad = intent(1, 6, keys, 'distance');
    bad.memberIds = ['STALE-A', 'STALE-B'];
    expect(codeOf(solveGroup(
      [30, 24, 30], D3(),
      [intent(0, 8, keys, 'distance'), bad],
    ))).toBe('TRANSITION_STALE');
  });

  it('out-of-order / duplicate / sparse / malformed intent lists reject, never sort', () => {
    const keys = keysFor(4);
    const pair = [intent(0, 8, keys, 'distance'), intent(1, 6, keys, 'distance')];
    expect(codeOf(solveGroup([30, 24, 26, 30], [...D3(), DIST(0.5, 11)], [pair[1]!, pair[0]!]))).toBe('TRANSITION_REJECTED');
    expect(codeOf(solveGroup([30, 24, 30], D3(), [pair[0]!, pair[0]!]))).toBe('TRANSITION_REJECTED');
    const sparse = [intent(0, 8, keys, 'distance'), intent(2, 4, keysFor(4), 'distance')];
    expect(codeOf(solveGroup([30, 24, 26, 30], [...D3(), DIST(0.5, 11)], sparse))).toBe('TRANSITION_REJECTED');
    const malformed = [intent(0, 8, keys, 'distance'), { ...intent(1, 6, keys, 'distance'), jointId: 'bogus' }];
    expect(codeOf(solveGroup([30, 24, 30], D3(), malformed))).toBe('TRANSITION_REJECTED');
  });

  it('bent / sloped / closed / dual-field intents fail closed', () => {
    const keys = keysFor(3);
    // Joint 1 bent 90° (m2 heads +y): NON_COLLINEAR fails the group.
    const bentM2: ResolvedGradingSource = {
      startX: 54, startY: 0, endX: 54, endY: 30, startZ: 10, endZ: 10,
      length: 30, reoriented: false, isArc: false,
    };
    const bent = solveGroup([30, 24, 30], D3(),
      [intent(0, 8, keys, 'distance'), intent(1, 6, keys, 'distance')],
      { members: [...chain([30, 24]), bentM2] });
    expect(codeOf(bent)).toBe('TRANSITION_REJECTED');
    // Closed routes excluded: a real 4-member cycle reaches the transition
    // closed gate (the continuity gate passes, the group gate refuses).
    const loop: ResolvedGradingSource[] = [
      { startX: 0, startY: 0, endX: 30, endY: 0, startZ: 10, endZ: 10, length: 30, reoriented: false, isArc: false },
      { startX: 30, startY: 0, endX: 30, endY: 30, startZ: 10, endZ: 10, length: 30, reoriented: false, isArc: false },
      { startX: 30, startY: 30, endX: 0, endY: 30, startZ: 10, endZ: 10, length: 30, reoriented: false, isArc: false },
      { startX: 0, startY: 30, endX: 0, endY: 0, startZ: 10, endZ: 10, length: 30, reoriented: false, isArc: false },
    ];
    const loopKeys = keysFor(4);
    expect(codeOf(solveGroup(
      [30, 30, 30, 30], [DIST(0.5, 5), DIST(0.5, 7), DIST(0.5, 9), DIST(0.5, 11)],
      [intent(0, 8, loopKeys, 'distance'), intent(1, 6, loopKeys, 'distance')],
      { closed: true, members: loop },
    ))).toBe('TRANSITION_REJECTED');
    // Singular + plural together is malformed, never merged.
    const dual = solveGroup([30, 24, 30], D3(),
      [intent(0, 8, keys, 'distance'), intent(1, 6, keys, 'distance')],
      { transition: intent(0, 8, keys, 'distance') });
    expect(codeOf(dual)).toBe('TRANSITION_MALFORMED');
  });
});
