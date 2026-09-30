/**
 * Phase 20G — shared relative-elevation authority + overflow fail-closed.
 *
 * One focused contract: the corner terminal line never re-derives Δ/g, and
 * the shared resolver rejects non-finite limit sums instead of returning
 * ok-with-Infinity.
 */
import { describe, expect, it } from 'vitest';

import { resolveAnalyticCriterionAt } from '../src/engine/cad/grading/gradingAnalyticCriterion';
import { createGradingDefinition } from '../src/engine/cad/grading/gradingAuthoring';
import { analyticTerminalLine } from '../src/engine/cad/grading/gradingGroupAnalyticCorners';
import { sanitizeCadGradings } from '../src/engine/cad/grading/gradingPersistence';
import { computeGradingFromSnapshots } from '../src/workers/surfaceGradingCompute';
import { solveAnalyticGradingChord } from '../src/engine/cad/grading/solveAnalyticGradingChord';

const tangent = { nx: 1, ny: 0 };
const normal = { nx: 0, ny: -1 };

describe('relative-elevation single authority + overflow gate', () => {
  it('rejects a non-finite limit sum instead of ok-with-Infinity', () => {
    const out = resolveAnalyticCriterionAt(
      { kind: 'relative-elevation', gradeRatio: 1e308, relativeElevation: 1e308 },
      1e308,
      2,
    );
    expect(out.ok).toBe(false);
  });

  it('routes the corner line through the shared resolver when the search bound is available', () => {
    const legacy = analyticTerminalLine(0, 0, 10, tangent, normal, 0, {
      kind: 'relative-elevation', gradeRatio: -0.5, relativeElevation: -10,
    });
    const routed = analyticTerminalLine(0, 0, 10, tangent, normal, 0, {
      kind: 'relative-elevation', gradeRatio: -0.5, relativeElevation: -10,
    }, 50);
    expect(routed).toEqual(legacy);
    expect(routed).toEqual({ ox: 0, oy: -20, oz: 0, dx: 1, dy: 0, dz: 0 });
  });

  it('fails the corner line closed past the shared search bound', () => {
    expect(analyticTerminalLine(0, 0, 10, tangent, normal, 0, {
      kind: 'relative-elevation', gradeRatio: -0.5, relativeElevation: -10,
    }, 10)).toBeNull();
  });
});

describe('chord daylight carries the shared signed-Δ limit', () => {
  const flat = (z: number) => ({
    startX: 0, startY: 0, endX: 100, endY: 0, startZ: z, endZ: z,
    length: 100, reoriented: false, isArc: false as const,
  });

  it('fails closed end-to-end on a non-finite limit sum', () => {
    const out = solveAnalyticGradingChord({
      source: flat(1e308), side: 'right',
      criterion: { kind: 'relative-elevation', gradeRatio: 1e308, relativeElevation: 1e308 },
      maxSearchDistance: 2,
    });
    expect(out.ok).toBe(false);
  });

  it('daylights at exactly sourceZ + Δ per station', () => {
    // Non-roundtrip pair: (Δ/g)*g differs from Δ by ~1.455e-11, so only the
    // shared helper's exact limit passes this assertion.
    const g = -21.993788965464354;
    const dz = -126270.5120729265;
    expect((dz / g) * g).not.toBe(dz);
    const out = solveAnalyticGradingChord({
      source: flat(0), side: 'right',
      criterion: { kind: 'relative-elevation', gradeRatio: g, relativeElevation: dz },
      maxSearchDistance: 10000,
    });
    if (!out.ok) throw new Error('expected ok');
    expect(out.solve.daylightPts[0]!.z).toBe(0 + dz);
    expect(out.solve.daylightPts[1]!.z).toBe(0 + dz);
  });

  it('leaves the legacy Distance construction untouched', () => {
    const out = solveAnalyticGradingChord({
      source: flat(10), side: 'right',
      criterion: { kind: 'distance', gradeRatio: -0.5, distance: 20 },
      maxSearchDistance: 50,
    });
    if (!out.ok) throw new Error('expected ok');
    expect(out.solve.daylightPts[0]!.z).toBe(10 + -0.5 * 20);
    expect(out.solve.daylightPts[1]!.z).toBe(10 + -0.5 * 20);
  });
});

describe('elevation terminal line through the shared helper', () => {
  const elev = { kind: 'elevation', gradeRatio: -0.5, targetElevation: 0 } as const;

  it('matches the legacy line with and without an explicit bound', () => {
    const expected = { ox: 0, oy: -20, oz: 0, dx: 1, dy: 0, dz: 0 };
    expect(analyticTerminalLine(0, 0, 10, tangent, normal, 0, elev)).toEqual(expected);
    expect(analyticTerminalLine(0, 0, 10, tangent, normal, 0, elev, 50)).toEqual(expected);
  });

  it('fails closed over-search and wrong-side', () => {
    expect(analyticTerminalLine(0, 0, 10, tangent, normal, 0, elev, 10)).toBeNull();
    expect(analyticTerminalLine(0, 0, 10, tangent, normal, 0, {
      kind: 'elevation', gradeRatio: -0.5, targetElevation: 20,
    })).toBeNull();
  });
});

describe('relative fresh-create omits the target id; load preserves it', () => {
  const rel = { kind: 'relative-elevation', gradeRatio: -0.5, relativeElevation: -10 } as const;
  const fresh = {
    id: 'g', name: 'g', sourceFeatureLineId: 'fl', vertexAId: 'a', vertexBId: 'b',
    side: 'right' as const, maxSearchDistance: 50, curveChordTolerance: 0.05,
  };

  it('fresh relative create never writes a passed target id', () => {
    const created = createGradingDefinition({ ...fresh, targetSurfaceId: 'surf', criterion: rel });
    if (!created.ok) throw new Error(created.error);
    expect('targetSurfaceId' in created.value).toBe(false);
  });

  it('load preserves a stored relative dormant id verbatim without gating', () => {
    const loaded = sanitizeCadGradings([{
      id: 'g', name: 'g', sourceFeatureLineId: 'fl',
      sourceCourse: { vertexAId: 'a', vertexBId: 'b' },
      targetSurfaceId: 'surf', side: 'right', criterion: rel,
      maxSearchDistance: 50, curveChordTolerance: 0.05,
    }]);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.targetSurfaceId).toBe('surf');
  });

  it('legacy Distance dormant-id create semantics are unchanged', () => {
    const created = createGradingDefinition({
      ...fresh, targetSurfaceId: 'surf',
      criterion: { kind: 'distance', gradeRatio: -0.5, distance: 20 },
    });
    if (!created.ok) throw new Error(created.error);
    expect(created.value.targetSurfaceId).toBe('surf');
  });

  it('fails closed end-to-end when the frame grade overflows finite endpoints', () => {
    const out = computeGradingFromSnapshots({
      gradingId: 'g20g-overflow', revision: 'grev1:test', side: 'right',
      source: {
        startX: 0, startY: 0, endX: 100, endY: 0,
        startZ: 1e308, endZ: -1e308, length: 100,
        reoriented: false, isArc: false as const,
      },
      criterion: { kind: 'relative-elevation', gradeRatio: -0.5, relativeElevation: -1 },
      maxSearchDistance: 5, curveChordTolerance: 0.01,
    });
    expect(out.ok).toBe(false);
  });
});
