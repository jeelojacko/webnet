/**
 * Phase 20B geometry slice oracles: course frame, curve linearization,
 * revision stability, status precedence, authoring validation.
 */
import { describe, expect, it } from 'vitest';
import {
  createBothSidesGrading,
  createGradingDefinition,
  editGradingCriteria,
  reassignGradingTarget,
} from '../src/engine/cad/grading/gradingAuthoring';
import {
  fromLocalFrame,
  gradingSideNormal,
  resolveGradingSourceCourse,
  toLocalFrame,
  type GradingCourseLike,
} from '../src/engine/cad/grading/gradingCourseFrame';
import {
  linearizeGradingArc,
  straightGradingChord,
} from '../src/engine/cad/grading/gradingCurve';
import { buildGradingRevision } from '../src/engine/cad/grading/gradingRevision';
import { deriveGradingStatus } from '../src/engine/cad/grading/gradingStatus';
import type { ResolvedGradingSource } from '../src/engine/cad/grading/gradingTypes';

const straightCourses = (reversed: boolean): GradingCourseLike[] => {
  const base: GradingCourseLike = {
    fromVertexId: 'A',
    toVertexId: 'B',
    startX: 0,
    startY: 0,
    endX: 10,
    endY: 0,
    startZ: 100,
    endZ: 101,
    planLength: 10,
    isArc: false,
  };
  if (!reversed) return [base];
  return [
    {
      ...base,
      fromVertexId: 'B',
      toVertexId: 'A',
      startX: 10,
      startY: 0,
      endX: 0,
      endY: 0,
      startZ: 101,
      endZ: 100,
    },
  ];
};

describe('grading side normals', () => {
  it('left/right of +X tangent', () => {
    expect(gradingSideNormal(1, 0, 'left')).toEqual({ nx: 0, ny: 1 });
    expect(gradingSideNormal(1, 0, 'right')).toEqual({ nx: 0, ny: -1 });
  });
  it('left/right of diagonal tangent (unit, exact 45°)', () => {
    const h = Math.SQRT1_2;
    const left = gradingSideNormal(1, 1, 'left') as { nx: number; ny: number };
    const right = gradingSideNormal(1, 1, 'right') as { nx: number; ny: number };
    expect(left.nx).toBeCloseTo(-h, 12);
    expect(left.ny).toBeCloseTo(h, 12);
    expect(right.nx).toBeCloseTo(h, 12);
    expect(right.ny).toBeCloseTo(-h, 12);
  });
  it('normalizes non-unit tangents defensively', () => {
    expect(gradingSideNormal(0, 5, 'left')).toEqual({ nx: -1, ny: 0 });
  });
  it('fail-closes on degenerate tangents', () => {
    expect(gradingSideNormal(0, 0, 'left')).toBeNull();
    expect(gradingSideNormal(NaN, 1, 'right')).toBeNull();
    expect(gradingSideNormal(Infinity, 0, 'left')).toBeNull();
  });
});

describe('source-course resolution', () => {
  it('resolves A->B without reorientation', () => {
    const src = resolveGradingSourceCourse(straightCourses(false), 'A', 'B');
    expect(src).toMatchObject({
      startX: 0,
      endX: 10,
      startZ: 100,
      endZ: 101,
      length: 10,
      reoriented: false,
      isArc: false,
    });
  });
  it('reorients B->A storage to the persisted A->B direction', () => {
    const src = resolveGradingSourceCourse(straightCourses(true), 'A', 'B');
    expect(src).toMatchObject({
      startX: 0,
      endX: 10,
      startZ: 100,
      endZ: 101,
      reoriented: true,
    });
  });
  it('keeps the identical world side across reversal (source-reverse)', () => {
    const fwd = resolveGradingSourceCourse(straightCourses(false), 'A', 'B') as ResolvedGradingSource;
    const rev = resolveGradingSourceCourse(straightCourses(true), 'A', 'B') as ResolvedGradingSource;
    const nFwd = gradingSideNormal(1, 0, 'left') as { nx: number; ny: number };
    const nRev = gradingSideNormal(1, 0, 'left') as { nx: number; ny: number };
    // Both oriented A->B: the same query point maps to the same local frame.
    expect(toLocalFrame(5, 2, fwd, nFwd)).toEqual(toLocalFrame(5, 2, rev, nRev));
    expect(fromLocalFrame(5, 2, fwd, nFwd)).toEqual(fromLocalFrame(5, 2, rev, nRev));
  });
  it('inserted vertex breaks adjacency (A->V, V->B no longer match A,B)', () => {
    const split: GradingCourseLike[] = [
      { ...straightCourses(false)[0] as GradingCourseLike, toVertexId: 'V', endX: 5, endZ: 100.5, planLength: 5 },
      {
        fromVertexId: 'V',
        toVertexId: 'B',
        startX: 5,
        startY: 0,
        endX: 10,
        endY: 0,
        startZ: 100.5,
        endZ: 101,
        planLength: 5,
        isArc: false,
      },
    ];
    expect(resolveGradingSourceCourse(split, 'A', 'B')).toBeNull();
  });
  it('deleted endpoint resolves to null', () => {
    expect(resolveGradingSourceCourse(straightCourses(false), 'A', 'ZZ')).toBeNull();
    expect(resolveGradingSourceCourse([], 'A', 'B')).toBeNull();
    expect(resolveGradingSourceCourse(straightCourses(false), 'A', 'A')).toBeNull();
  });
});

describe('grading revision', () => {
  const inputFor = (reversed: boolean) => {
    const resolved = resolveGradingSourceCourse(straightCourses(reversed), 'A', 'B') as ResolvedGradingSource;
    return {
      sourceFeatureLineId: 'FL1',
      vertexAId: 'A',
      vertexBId: 'B',
      resolvedSource: resolved,
      targetSurfaceId: 'S1',
      targetRevision: 'srev1:abc',
      side: 'left' as const,
      criterion: { kind: 'fixed' as const, gradeRatio: 3 },
      maxSearchDistance: 50,
      curveChordTolerance: 0.01,
    };
  };
  it('is stable across storage reversal with identical geometry', () => {
    expect(buildGradingRevision(inputFor(false))).toBe(buildGradingRevision(inputFor(true)));
  });
  it('changes on endpoint move', () => {
    const base = inputFor(false);
    const moved = {
      ...base,
      resolvedSource: { ...base.resolvedSource, endX: 11, length: 11 },
    };
    expect(buildGradingRevision(moved)).not.toBe(buildGradingRevision(base));
  });
  it('produces grev1:hex shape', () => {
    expect(buildGradingRevision(inputFor(false))).toMatch(/^grev1:[0-9a-f]{8}$/);
  });
});

describe('grading status precedence', () => {
  const healthy = {
    courseResolved: true,
    targetCurrent: true,
    targetExists: true,
    sourceExists: true,
    hasResult: true,
    resultRevision: 'grev1:deadbeef',
    currentRevision: 'grev1:deadbeef',
    building: false,
  };
  it('derives CURRENT when everything agrees', () => {
    expect(deriveGradingStatus(healthy)).toBe('CURRENT');
  });
  it('BROKEN_REFERENCE outranks everything', () => {
    expect(deriveGradingStatus({ ...healthy, building: true, courseResolved: false })).toBe(
      'BROKEN_REFERENCE',
    );
    expect(deriveGradingStatus({ ...healthy, sourceExists: false })).toBe('BROKEN_REFERENCE');
    expect(deriveGradingStatus({ ...healthy, targetExists: false })).toBe('BROKEN_REFERENCE');
  });
  it('BUILDING > UNBUILT', () => {
    expect(deriveGradingStatus({ ...healthy, building: true, hasResult: false })).toBe('BUILDING');
  });
  it('UNBUILT > SOURCE_NOT_CURRENT > NEEDS_RECALC', () => {
    expect(deriveGradingStatus({ ...healthy, hasResult: false })).toBe('UNBUILT');
    expect(
      deriveGradingStatus({ ...healthy, targetCurrent: false, resultRevision: 'grev1:old' }),
    ).toBe('SOURCE_NOT_CURRENT');
    expect(deriveGradingStatus({ ...healthy, resultRevision: 'grev1:old' })).toBe('NEEDS_RECALC');
  });
});

describe('grading authoring validation', () => {
  const valid = {
    id: 'G1',
    name: 'Daylight A-B',
    sourceFeatureLineId: 'FL1',
    vertexAId: 'A',
    vertexBId: 'B',
    targetSurfaceId: 'S1',
    side: 'left' as const,
    criterion: { kind: 'fixed' as const, gradeRatio: 3 },
    maxSearchDistance: 50,
    curveChordTolerance: 0.01,
  };
  it('creates a valid definition', () => {
    const out = createGradingDefinition(valid);
    expect(out.ok).toBe(true);
  });
  it('rejects zero max distance, bad cut/fill signs, equal vertex ids', () => {
    expect(createGradingDefinition({ ...valid, maxSearchDistance: 0 }).ok).toBe(false);
    expect(
      createGradingDefinition({
        ...valid,
        criterion: { kind: 'cut-fill', cutGradeRatio: -2, fillGradeRatio: -3 },
      }).ok,
    ).toBe(false);
    expect(
      createGradingDefinition({
        ...valid,
        criterion: { kind: 'cut-fill', cutGradeRatio: 2, fillGradeRatio: 3 },
      }).ok,
    ).toBe(false);
    expect(createGradingDefinition({ ...valid, vertexBId: 'A' }).ok).toBe(false);
    expect(createGradingDefinition({ ...valid, id: '' }).ok).toBe(false);
    expect(createGradingDefinition({ ...valid, curveChordTolerance: -1 }).ok).toBe(false);
  });
  it('edits criteria and reassigns targets purely', () => {
    const created = createGradingDefinition(valid);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const edited = editGradingCriteria(created.value, {
      kind: 'cut-fill',
      cutGradeRatio: 2,
      fillGradeRatio: -3,
    });
    expect(edited.ok).toBe(true);
    if (edited.ok) expect(edited.value.criterion).toEqual({ kind: 'cut-fill', cutGradeRatio: 2, fillGradeRatio: -3 });
    expect(created.value.criterion).toEqual({ kind: 'fixed', gradeRatio: 3 });
    const moved = reassignGradingTarget(created.value, 'S2');
    expect(moved.ok).toBe(true);
    expect(reassignGradingTarget(created.value, '').ok).toBe(false);
  });
  it('creates Both-Sides atomically (both or error)', () => {
    const pair = createBothSidesGrading({ ...valid, leftId: 'GL', rightId: 'GR' });
    expect(pair.ok).toBe(true);
    if (pair.ok) {
      expect(pair.value.left.side).toBe('left');
      expect(pair.value.right.side).toBe('right');
    }
    expect(
      createBothSidesGrading({ ...valid, leftId: 'G', rightId: 'G' }).ok,
    ).toBe(false);
    expect(
      createBothSidesGrading({ ...valid, leftId: 'GL', rightId: 'GR', maxSearchDistance: 0 }).ok,
    ).toBe(false);
  });
});

describe('arc linearization', () => {
  it('honors the sagitta bound with on-arc nodes', () => {
    const radius = 50;
    const tol = 0.01;
    const out = linearizeGradingArc(0, 0, radius, 0, Math.PI / 2, true, 100, 101, tol);
    expect(out).not.toBeNull();
    if (!out) return;
    expect(out.maxSagitta).toBeLessThanOrEqual(tol + 1e-12);
    for (const p of out.points) {
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(radius, 9);
    }
    expect(out.points[0]).toMatchObject({ x: 50, y: 0, z: 100 });
    const last = out.points[out.points.length - 1] as { x: number; y: number; z: number };
    expect(last.x).toBeCloseTo(0, 9);
    expect(last.y).toBeCloseTo(50, 9);
    expect(last.z).toBeCloseTo(101, 12);
    // Z interpolates linearly in arc fraction (midpoint check).
    const mid = out.points[Math.floor(out.points.length / 2)] as { z: number };
    expect(mid.z).toBeGreaterThan(100);
    expect(mid.z).toBeLessThan(101);
  });
  it('fail-closes on degenerate input', () => {
    expect(linearizeGradingArc(0, 0, 0, 0, 1, true, 0, 0, 0.01)).toBeNull();
    expect(linearizeGradingArc(0, 0, 10, 0, 0, true, 0, 0, 0.01)).toBeNull();
    expect(linearizeGradingArc(0, 0, 10, 0, 1, true, 0, 0, 0)).toBeNull();
  });
  it('passes straight chords through exactly', () => {
    const chord = straightGradingChord(0, 0, 100, 10, 0, 101);
    expect(chord?.points).toHaveLength(2);
    expect(straightGradingChord(1, 1, 5, 1, 1, 5)).toBeNull();
  });
});

describe('fixed-slope ratio convention', () => {
  // Slice convention: gradeRatio = horizontal : vertical (run over rise),
  // so H:V D:H and percent grade interconvert as ratio = 100/percent.
  it('H:V and percent examples agree as pure ratios', () => {
    const fromHV = (h: number, v: number): number => h / v;
    const fromPercent = (pct: number): number => 100 / pct;
    expect(fromHV(3, 1)).toBeCloseTo(3, 12);
    expect(fromPercent(100 / 3)).toBeCloseTo(3, 12);
    expect(fromHV(2, 1)).toBeCloseTo(fromPercent(50), 12);
    expect(fromHV(4, 1)).toBeCloseTo(fromPercent(25), 12);
  });
});
