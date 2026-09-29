/**
 * Phase 20F engine core: target-free distance/elevation criteria.
 *
 * Analytic chord solve exactness, dispatcher routing, authoring
 * validation, termination helpers, revision shape, snapshot compute
 * without a target mesh, and resolve-without-target.
 */
import { describe, expect, it } from 'vitest';

import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import type {
  CadFeatureLineEntity,
  CadProject,
} from '../src/engine/cad/cadTypes';
import type { CadGrading } from '../src/engine/cad/grading/gradingTypes';
import { validateGradingCriterion } from '../src/engine/cad/grading/gradingAuthoring';
import { buildGradingRevision } from '../src/engine/cad/grading/gradingRevision';
import { resolveGradingInputs } from '../src/engine/cad/grading/gradingResolve';
import {
  gradingBoundaryLabel,
  gradingBoundaryShortLabel,
  gradingCriterionRequiresSurface,
  gradingTerminationKind,
  isTargetFreeCriterion,
} from '../src/engine/cad/grading/gradingTypes';
import type { GradingComputeSource } from '../src/engine/cad/grading/gradingComputeTypes';
import {
  solveAnalyticGradingChord,
  solveGradingChord,
} from '../src/engine/cad/grading/solveAnalyticGradingChord';
import { computeGradingFromSnapshots } from '../src/workers/surfaceGradingCompute';

/** Source A(0,0,10) → B(10,0,12); left normal is +Y. */
const source = (): GradingComputeSource => ({
  startX: 0,
  startY: 0,
  endX: 10,
  endY: 0,
  startZ: 10,
  endZ: 12,
  length: 10,
  reoriented: false,
  isArc: false,
});

describe('grading termination helpers (20F)', () => {
  it('classifies surface vs analytic criteria', () => {
    expect(gradingTerminationKind({ kind: 'fixed', gradeRatio: -0.5 })).toBe('surface');
    expect(gradingTerminationKind({ kind: 'cut-fill', cutGradeRatio: 0.5, fillGradeRatio: -0.5 })).toBe('surface');
    expect(gradingTerminationKind({ kind: 'distance', gradeRatio: -0.1, distance: 5 })).toBe('distance');
    expect(gradingTerminationKind({ kind: 'elevation', gradeRatio: -0.5, targetElevation: 9 })).toBe('elevation');
    expect(gradingCriterionRequiresSurface({ kind: 'fixed', gradeRatio: -0.5 })).toBe(true);
    expect(isTargetFreeCriterion({ kind: 'distance', gradeRatio: -0.1, distance: 5 })).toBe(true);
    expect(isTargetFreeCriterion({ kind: 'elevation', gradeRatio: -0.5, targetElevation: 9 })).toBe(true);
  });

  it('labels the boundary polyline', () => {
    expect(gradingBoundaryLabel({ kind: 'fixed', gradeRatio: -0.5 })).toBe('Daylight');
    expect(gradingBoundaryLabel({ kind: 'distance', gradeRatio: -0.1, distance: 5 })).toBe('Grading Limit');
    expect(gradingBoundaryShortLabel({ kind: 'elevation', gradeRatio: -0.5, targetElevation: 9 })).toBe('Limit');
    expect(gradingBoundaryShortLabel({ kind: 'cut-fill', cutGradeRatio: 0.5, fillGradeRatio: -0.5 })).toBe('Daylight');
  });
});

describe('validateGradingCriterion (20F branches)', () => {
  it('keeps fixed/cut-fill rules identical', () => {
    expect(validateGradingCriterion({ kind: 'fixed', gradeRatio: -0.5 })).toBeNull();
    expect(validateGradingCriterion({ kind: 'fixed', gradeRatio: NaN })).not.toBeNull();
    expect(validateGradingCriterion({ kind: 'cut-fill', cutGradeRatio: 0.5, fillGradeRatio: -0.5 })).toBeNull();
    expect(validateGradingCriterion({ kind: 'cut-fill', cutGradeRatio: -0.5, fillGradeRatio: -0.5 })).not.toBeNull();
  });

  it('validates distance criteria', () => {
    expect(validateGradingCriterion({ kind: 'distance', gradeRatio: -0.1, distance: 5 })).toBeNull();
    expect(validateGradingCriterion({ kind: 'distance', gradeRatio: NaN, distance: 5 })).not.toBeNull();
    expect(validateGradingCriterion({ kind: 'distance', gradeRatio: -0.1, distance: 0 })).not.toBeNull();
    expect(validateGradingCriterion({ kind: 'distance', gradeRatio: -0.1, distance: -2 })).not.toBeNull();
    expect(validateGradingCriterion({ kind: 'distance', gradeRatio: -0.1, distance: NaN })).not.toBeNull();
  });

  it('validates elevation criteria with machine-zero (not survey tolerance)', () => {
    expect(validateGradingCriterion({ kind: 'elevation', gradeRatio: -0.5, targetElevation: 9 })).toBeNull();
    expect(validateGradingCriterion({ kind: 'elevation', gradeRatio: 0, targetElevation: 9 })).not.toBeNull();
    expect(validateGradingCriterion({ kind: 'elevation', gradeRatio: NaN, targetElevation: 9 })).not.toBeNull();
    expect(validateGradingCriterion({ kind: 'elevation', gradeRatio: -0.5, targetElevation: NaN })).not.toBeNull();
  });
});

describe('solveAnalyticGradingChord', () => {
  it('solves constant-distance chords exactly', () => {
    const out = solveAnalyticGradingChord({
      source: source(),
      side: 'left',
      criterion: { kind: 'distance', gradeRatio: -0.1, distance: 5 },
      maxSearchDistance: 100,
    });
    if (!out.ok) throw new Error(`analytic distance failed: ${out.code}`);
    expect(out.solve.distances).toEqual([5, 5]);
    expect(out.solve.daylightFlat).toEqual([0, 5, 9.5, 10, 5, 11.5]);
    expect(out.solve.nodeStations).toEqual([0, 10]);
    expect(out.solve.regions).toEqual([{ classification: 'FIXED', stationSpan: [0, 10] }]);
    expect(out.solve.diagnostics).toEqual([]);
    expect(out.solve.candidateTriangleCount).toBe(0);
    expect(out.solve.intersectionSegmentCount).toBe(0);
    expect(out.solve.multipleSolutionCount).toBe(0);
  });

  it('maps stations through base/scale', () => {
    const out = solveAnalyticGradingChord({
      source: source(),
      side: 'left',
      criterion: { kind: 'distance', gradeRatio: -0.1, distance: 5 },
      maxSearchDistance: 100,
      stationBase: 100,
      stationScale: 2,
    });
    if (!out.ok) throw new Error(`analytic station map failed: ${out.code}`);
    expect(out.solve.nodeStations).toEqual([100, 120]);
  });

  it('solves elevation chords linearly to the target elevation', () => {
    const out = solveAnalyticGradingChord({
      source: source(),
      side: 'left',
      criterion: { kind: 'elevation', gradeRatio: -0.5, targetElevation: 9 },
      maxSearchDistance: 100,
    });
    if (!out.ok) throw new Error(`analytic elevation failed: ${out.code}`);
    expect(out.solve.distances).toEqual([2, 6]);
    // Daylight Z equals the target elevation at both ends by construction.
    expect(out.solve.daylightFlat[2]).toBe(9);
    expect(out.solve.daylightFlat[5]).toBe(9);
  });

  it('fails closed on wrong direction, over-search, and zero grade', () => {
    const src = source();
    const wrong = solveAnalyticGradingChord({
      source: src, side: 'left',
      criterion: { kind: 'elevation', gradeRatio: -0.5, targetElevation: 13 },
      maxSearchDistance: 100,
    });
    expect(wrong.ok).toBe(false);
    const far = solveAnalyticGradingChord({
      source: src, side: 'left',
      criterion: { kind: 'distance', gradeRatio: -0.1, distance: 500 },
      maxSearchDistance: 100,
    });
    expect(far.ok).toBe(false);
    if (far.ok) throw new Error('expected MAX_DISTANCE_REACHED');
    expect(far.code).toBe('MAX_DISTANCE_REACHED');
    const zero = solveAnalyticGradingChord({
      source: src, side: 'left',
      criterion: { kind: 'elevation', gradeRatio: 0, targetElevation: 9 },
      maxSearchDistance: 100,
    });
    expect(zero.ok).toBe(false);
  });
});

describe('solveGradingChord dispatcher', () => {
  it('routes analytic criteria without a target, surface criteria to the mesh solver', () => {
    const analytic = solveGradingChord({
      source: source(),
      side: 'left',
      criterion: { kind: 'distance', gradeRatio: -0.1, distance: 5 },
      maxSearchDistance: 100,
    });
    expect(analytic.ok).toBe(true);
    const surface = solveGradingChord({
      source: source(),
      side: 'left',
      criterion: { kind: 'fixed', gradeRatio: -0.5 },
      maxSearchDistance: 100,
    });
    expect(surface.ok).toBe(false);
  });
});

describe('analytic snapshot compute + revision + resolve', () => {
  it('computes a distance grading with no target mesh', () => {
    const outcome = computeGradingFromSnapshots({
      gradingId: 'g-analytic',
      revision: 'grev1:test',
      source: source(),
      side: 'left',
      criterion: { kind: 'distance', gradeRatio: -0.1, distance: 5 },
      maxSearchDistance: 100,
      curveChordTolerance: 0.01,
    });
    if (!outcome.ok) throw new Error(`analytic compute failed: ${outcome.code}`);
    expect(outcome.result.accuracy).toBe('EXACT');
    expect(outcome.result.gradingPlanArea).toBeCloseTo(50, 9);
    expect(outcome.result.grading3dArea).toBeGreaterThan(0);
    expect(outcome.result.minProjectionDistance).toBe(5);
    expect(outcome.result.maxProjectionDistance).toBe(5);
    expect(outcome.result.meanProjectionDistance).toBe(5);
    expect(outcome.result.candidateTriangleCount).toBe(0);
    expect(outcome.result.cutSourceLength).toBe(0);
    expect(outcome.result.fillSourceLength).toBe(0);
    expect(outcome.result.tiedSourceLength).toBe(0);
  });

  it('revises analytic criteria without a target leg', () => {
    const resolved = { ...source(), arc: undefined };
    const analytic = buildGradingRevision({
      sourceFeatureLineId: 'fl',
      vertexAId: 'a',
      vertexBId: 'b',
      resolvedSource: { ...resolved, isArc: false },
      side: 'left',
      criterion: { kind: 'distance', gradeRatio: -0.1, distance: 5 },
      maxSearchDistance: 100,
      curveChordTolerance: 0.01,
    });
    const surface = buildGradingRevision({
      sourceFeatureLineId: 'fl',
      vertexAId: 'a',
      vertexBId: 'b',
      resolvedSource: { ...resolved, isArc: false },
      targetSurfaceId: 'tgt',
      targetRevision: 'srev1:x',
      side: 'left',
      criterion: { kind: 'fixed', gradeRatio: -0.5 },
      maxSearchDistance: 100,
      curveChordTolerance: 0.01,
    });
    expect(analytic.startsWith('grev1:')).toBe(true);
    expect(analytic).not.toBe(surface);
    expect(buildGradingRevision({
      sourceFeatureLineId: 'fl',
      vertexAId: 'a',
      vertexBId: 'b',
      resolvedSource: { ...resolved, isArc: false },
      side: 'left',
      criterion: { kind: 'distance', gradeRatio: -0.1, distance: 6 },
      maxSearchDistance: 100,
      curveChordTolerance: 0.01,
    })).not.toBe(analytic);
  });

  it('resolves analytic definitions with no target surface', () => {
    const drawing = createBlankCadDrawingDocument({ name: 'Analytic', units: 'm' });
    const flId = 'fl-analytic';
    const fl: CadFeatureLineEntity = {
      id: flId,
      type: 'feature-line',
      layerId: 'general',
      visible: true,
      locked: false,
      name: 'FL analytic',
      vertices: [
        { id: `${flId}:a`, x: 0, y: 0, z: 10 },
        { id: `${flId}:b`, x: 10, y: 0, z: 12 },
      ],
    };
    const grading: CadGrading = {
      id: 'g-analytic',
      name: 'G analytic',
      sourceFeatureLineId: flId,
      sourceCourse: { vertexAId: `${flId}:a`, vertexBId: `${flId}:b` },
      side: 'left',
      criterion: { kind: 'distance', gradeRatio: -0.1, distance: 5 },
      maxSearchDistance: 100,
      curveChordTolerance: 0.01,
    };
    const project: CadProject = {
      ...drawing.project,
      entities: [fl],
      surfaces: [],
      gradings: [grading],
    };
    const inputs = resolveGradingInputs(project, 'g-analytic');
    expect(inputs).not.toBeNull();
    expect(inputs!.target).toBeUndefined();
    expect(inputs!.targetRevision).toBeUndefined();
    expect(inputs!.resolvedSource.length).toBeCloseTo(10, 9);
  });
});
