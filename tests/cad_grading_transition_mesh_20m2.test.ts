/**
 * Phase 20M.2 Wave D — transition-aware solve: 3 families, C0, mesh proof.
 *
 * Admitted collinear same-family groups tile natives outside [-W/2,+W/2]
 * and the legislated TRANSITION_LINEAR_V1 law inside, meeting exactly (C0
 * by shared vertex refs; proven by pinned daylight arrays). Meshes are
 * finite/oriented/no-fold (every triangle strictly positive plan area).
 * Every inadmissible class fails closed with a bounded TRANSITION_* code
 * (Z-step reads the pre-existing CORNER_INVERTED gate). No C1 is claimed.
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

const seg = (
  sx: number,
  sy: number,
  ex: number,
  ey: number,
  sz = 10,
  ez = 10,
  extra: Partial<ResolvedGradingSource> = {},
): ResolvedGradingSource => ({
  startX: sx,
  startY: sy,
  endX: ex,
  endY: ey,
  startZ: sz,
  endZ: ez,
  length: Math.hypot(ex - sx, ey - sy),
  reoriented: false,
  isArc: false,
  ...extra,
});

const members = (r: Partial<ResolvedGradingSource> = {}): ResolvedGradingSource[] => [
  seg(-20, 0, 0, 0),
  seg(0, 0, 20, 0, 10, 10, r),
];

const trp = (o: Partial<CadGradingTransition> = {}): CadGradingTransition => ({
  policyVersion: 'trp1',
  jointId: 'joint:0',
  memberIds: ['A>B', 'B>C'],
  width: 8,
  lawKind: 'TRANSITION_LINEAR_V1',
  lawVersion: 'v1',
  criterionFamily: 'distance',
  side: 'left',
  ...o,
});

const solve = (
  criteria: [GradingCriterion, GradingCriterion],
  o: {
    transition?: CadGradingTransition;
    keys?: string[];
    members?: ResolvedGradingSource[];
    closed?: boolean;
    family?: string;
  } = {},
): GradingGroupComputeOutcome => {
  const input: GroupSolveInput = {
    groupId: 'g',
    revision: 'ggrev1:t',
    members: o.members ?? members(),
    side: 'left',
    criterion: criteria[0]!,
    memberCriteria: criteria,
    maxSearchDistance: 50,
    curveChordTolerance: 0.01,
    closed: o.closed ?? false,
    ...(o.transition !== undefined
      ? {
          transition: { ...o.transition, criterionFamily: o.family ?? o.transition.criterionFamily },
          transitionMemberKeys: o.keys ?? ['A>B', 'B>C'],
        }
      : {}),
  };
  return computeGradingGroupFromSnapshots(input);
};

const okOf = (o: GradingGroupComputeOutcome) => {
  expect(o.ok).toBe(true);
  if (!o.ok) throw new Error('expected ok');
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

describe('20M.2 transition mesh', () => {
  it('distance: C0 daylight pin, regions, corner, oriented mesh', () => {
    const result = okOf(solve([DIST(0.5, 5), DIST(0.5, 7)], { transition: trp() }));
    expect(result.daylightPoints).toEqual([-20, 5, 12.5, -4, 5, 12.5, 0, 6, 13, 4, 7, 13.5, 20, 7, 13.5]);
    // Result-owned leg: only a solve with an admitted transition carries it.
    expect(result.transition).toMatchObject({
      joint: 0,
      jointId: 'joint:0',
      memberIds: ['A>B', 'B>C'],
      criterionFamily: 'distance',
      interval: { sL: -4, sR: 4 },
      endpointScalars: { vL: 5, vR: 7, gL: 0.5, gR: 0.5 },
      recordedRevision: 'ggrev1:t',
      agreementCode: null,
    });
    expect(result.transition!.daylightCheckpoints).toHaveLength(9);
    expect(result.transition!.sourceCheckpoints).toHaveLength(9);
    expect(result.memberRegions).toEqual([
      { memberIndex: 0, classification: 'FIXED', stationSpan: [0, 16] },
      { memberIndex: 0, classification: 'FIXED', stationSpan: [16, 20] },
      { memberIndex: 1, classification: 'FIXED', stationSpan: [0, 4] },
      { memberIndex: 1, classification: 'FIXED', stationSpan: [4, 20] },
    ]);
    expect(result.corners).toHaveLength(1);
    expect(result.corners[0]).toMatchObject({
      cornerIndex: 0, vertexId: 'joint:0', classification: 'TANGENT', tiePointXyz: [0, 6, 13],
    });
    expect(result.gradingMesh.triangles).toHaveLength(8 * 3);
    assertOriented(result.gradingMesh.points, result.gradingMesh.triangles);
    expect(result.topologyCertificate).toBeDefined();
  });

  it('relative-elevation and flat elevation agree with the station law', () => {
    const rel = okOf(solve([REL(0.5, 2), REL(0.5, 4)], { transition: trp(), family: 'relative-elevation' }));
    expect(rel.daylightPoints).toEqual([-20, 4, 12, -4, 4, 12, 0, 6, 13, 4, 8, 14, 20, 8, 14]);
    assertOriented(rel.gradingMesh.points, rel.gradingMesh.triangles);
    const elev = okOf(solve([ELEV(0.5, 12), ELEV(0.5, 14)], { transition: trp(), family: 'elevation' }));
    expect(elev.daylightPoints).toEqual([-20, 4, 12, -4, 4, 12, 0, 6, 13, 4, 8, 14, 20, 8, 14]);
    assertOriented(elev.gradingMesh.points, elev.gradingMesh.triangles);
  });

  it('width == max tiles with no outer strips (C0 holds, deterministic)', () => {
    const first = okOf(solve([DIST(0.5, 5), DIST(0.5, 7)], { transition: trp({ width: 40 }) }));
    expect(first.daylightPoints).toEqual([-20, 5, 12.5, 0, 6, 13, 20, 7, 13.5]);
    expect(first.gradingMesh.triangles).toHaveLength(4 * 3);
    assertOriented(first.gradingMesh.points, first.gradingMesh.triangles);
    const second = okOf(solve([DIST(0.5, 5), DIST(0.5, 7)], { transition: trp({ width: 40 }) }));
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('legacy groups without transition keep the pre-existing fail-closed (parallel corner)', () => {
    // The 20M gap: a collinear different-offset joint has no native corner
    // (parallel terminal lines). The transition path above fills exactly
    // this joint; the legacy path stays failed, never silently bridged.
    const outcome = solve([DIST(0.5, 5), DIST(0.5, 7)]);
    expect(outcome).toEqual({
      ok: false,
      code: 'CORNER_NO_SOLUTION',
      cornerIndex: 0,
      detail: 'GRADING_ANALYTIC_CORNER_PARALLEL',
    });
  });

  it('fails every inadmissible class closed with a bounded code', () => {
    const D = (): [GradingCriterion, GradingCriterion] => [DIST(0.5, 5), DIST(0.5, 7)];
    expect(codeOf(solve(D(), { transition: trp({ lawKind: 'NOPE' }) }))).toBe('TRANSITION_LAW_UNKNOWN');
    expect(codeOf(solve(D(), { transition: trp({ policyVersion: 'trp0' }) }))).toBe('TRANSITION_LAW_UNKNOWN');
    expect(codeOf(solve(D(), { transition: trp({ jointId: 'bogus' }) }))).toBe('TRANSITION_MALFORMED');
    expect(codeOf(solve(D(), { transition: trp({ jointId: 'joint:5' }) }))).toBe('TRANSITION_MALFORMED');
    expect(codeOf(solve(D(), { transition: trp({ memberIds: ['A>B', 'X>Y'] }) }))).toBe('TRANSITION_STALE');
    expect(codeOf(solve(D(), { transition: trp(), keys: [] }))).toBe('TRANSITION_STALE');
    expect(codeOf(solve(D(), { transition: trp({ width: 41 }) }))).toBe('TRANSITION_REJECTED');
    // Retained invalid intent (sanitizer marker shape) fails closed at solve.
    expect(codeOf(solve(D(), {
      transition: { policyVersion: '', jointId: '', memberIds: [], width: NaN, lawKind: '', lawVersion: '', criterionFamily: '', side: 'left' },
      keys: [],
    }))).toBe('TRANSITION_MALFORMED');
    expect(codeOf(solve(D(), { transition: trp({ width: 0 }) }))).toBe('TRANSITION_REJECTED');
    // Geometry exclusions.
    expect(codeOf(solve(D(), {
      transition: trp(),
      members: [seg(-20, 0, 0, 0), seg(0, 0, 0, 20)],
    }))).toBe('TRANSITION_REJECTED');
    expect(codeOf(solve(D(), {
      transition: trp(),
      members: [seg(-20, 0, 0, 0, 10, 11), seg(0, 0, 20, 0, 11, 11)],
    }))).toBe('TRANSITION_REJECTED');
    expect(codeOf(solve(D(), {
      transition: trp(),
      members: [seg(-20, 0, 0, 0), seg(0, 0, 20, 0, 11, 11)],
    }))).toBe('CORNER_INVERTED');
    expect(codeOf(solve(D(), {
      transition: trp(),
      members: [seg(-20, 0, 0, 0), seg(0, 0, 20, 0, 10, 10, {
        isArc: true,
        arc: { centerX: 10, centerY: 0, radius: 10, startAngle: Math.PI, endAngle: 0, sweepCCW: true },
      })],
    }))).toBe('TRANSITION_REJECTED');
    // Family / grade / side / closed.
    expect(codeOf(solve([DIST(0.5, 5), REL(0.5, 2)], { transition: trp() }))).toBe('TRANSITION_REJECTED');
    expect(codeOf(solve([DIST(0.5, 5), DIST(0.75, 7)], { transition: trp() }))).toBe('TRANSITION_REJECTED');
    expect(codeOf(solve(D(), { transition: trp({ side: 'right' }) }))).toBe('TRANSITION_REJECTED');
    expect(codeOf(solve(D(), {
      transition: trp({ jointId: 'joint:0' }),
      closed: true,
      members: [seg(0, 0, 20, 0), seg(20, 0, 20, 20), seg(20, 20, 0, 0)],
      keys: ['A>B', 'B>C', 'C>A'],
    }))).toBe('TRANSITION_REJECTED');
    // Stale evidence: revision stamp and pinned scalars.
    expect(codeOf(solve(D(), {
      transition: trp({ provenance: { jointId: 'joint:0', memberIds: ['A>B', 'B>C'], width: 8, lawKind: 'TRANSITION_LINEAR_V1', lawVersion: 'v1', criterionFamily: 'distance', side: 'left', revision: 'ggrev1:old' } }),
    }))).toBe('TRANSITION_STALE');
    expect(codeOf(solve(D(), {
      transition: trp({ endpoints: { refs: ['A>B', 'B>C'], values: [5, 8] } }),
    }))).toBe('TRANSITION_STALE');
    // Fresh evidence that matches admits.
    const admitted = okOf(solve(D(), {
      transition: trp({
        endpoints: { refs: ['A>B', 'B>C'], values: [5, 7] },
        provenance: { jointId: 'joint:0', memberIds: ['A>B', 'B>C'], width: 8, lawKind: 'TRANSITION_LINEAR_V1', lawVersion: 'v1', criterionFamily: 'distance', side: 'left', revision: 'ggrev1:t' },
      }),
    }));
    expect(admitted.daylightPoints).toEqual([-20, 5, 12.5, -4, 5, 12.5, 0, 6, 13, 4, 7, 13.5, 20, 7, 13.5]);
  });
});
