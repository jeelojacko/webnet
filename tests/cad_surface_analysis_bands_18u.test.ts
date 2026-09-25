import { describe, expect, it } from 'vitest';

import {
  analyzeElevationBands,
  type ElevationMesh,
} from '../src/engine/cad/surfaceAnalysis/elevationBands';
import {
  analyzeSlopeBands,
  type SlopeMesh,
} from '../src/engine/cad/surfaceAnalysis/slopeBands';
import {
  classifyAnalysisValue,
  clipScalarPolygon,
  validateAnalysisBands,
} from '../src/engine/cad/surfaceAnalysis/scalarClip';
import {
  MAX_ANALYSIS_BANDS,
  generateEqualRanges,
} from '../src/engine/cad/surfaceAnalysis/rangeGenerator';

const meshOf = (xs: number[], ys: number[], zs: number[], tris: number[]): ElevationMesh & SlopeMesh => ({
  xs,
  ys,
  zs,
  tris,
});

const bands4 = () => {
  const v = validateAnalysisBands([
    { id: 'b1', lower: 0, upper: 5 },
    { id: 'b2', lower: 5, upper: 10 },
    { id: 'b3', lower: 10, upper: 15 },
    { id: 'b4', lower: 15, upper: 20 },
  ]);
  expect(v.ok).toBe(true);
  return v.bands;
};

describe('18u elevation plane oracle', () => {
  it('z=0/10/20 triangle splits 4 bands with analytic areas', () => {
    // Right triangle (0,0,0),(10,0,10),(0,10,20): plan=50. z varies linearly;
    // band fractions by elevation: [0,5]=1/8, [5,10]=2/8... use conservation + ordering.
    const mesh = meshOf([0, 10, 0], [0, 0, 10], [0, 10, 20], [0, 1, 2]);
    const res = analyzeElevationBands(mesh, bands4(), { includeDisplay: true });
    expect(res.totals.minZ).toBe(0);
    expect(res.totals.maxZ).toBe(20);
    expect(res.totals.surfacePlanArea).toBeCloseTo(50, 9);
    const sum = res.bands.reduce((s, b) => s + b.planArea, 0);
    expect(sum).toBeCloseTo(50, 9);
    expect(res.totals.unclassifiedPlanArea).toBeCloseTo(0, 12);
    // End caps are congruent small triangles; middle trapezoids are larger.
    expect(res.bands[0]!.planArea).toBeCloseTo(res.bands[3]!.planArea, 9);
    expect(res.bands[0]!.planArea).toBeLessThan(res.bands[1]!.planArea);
    expect(res.bands[0]!.planArea).toBeCloseTo(50 / 8, 9);
    for (const b of res.bands) {
      expect(b.regionCount).toBe(1);
      expect(b.regions).toHaveLength(1);
    }
    // 3D area consistency: sum of band 3D = mesh 3D
    const sum3D = res.bands.reduce((s, b) => s + b.surface3DArea, 0);
    expect(sum3D).toBeCloseTo(res.totals.surface3DArea, 9);
  });

  it('constant-Z triangle lands wholly in one band', () => {
    const mesh = meshOf([0, 4, 0], [0, 0, 3], [100, 100, 100], [0, 1, 2]);
    const v = validateAnalysisBands([{ id: 'a', lower: 99, upper: 101 }]);
    const res = analyzeElevationBands(mesh, v.bands, { includeDisplay: false });
    expect(res.bands[0]!.planArea).toBeCloseTo(6, 12);
    expect(res.bands[0]!.surface3DArea).toBeCloseTo(6, 12); // flat
    expect(res.totals.unclassifiedPlanArea).toBeCloseTo(0, 12);
  });

  it('exact-threshold vertex/edge conserves area', () => {
    // Vertex exactly on 5 and edge along 10.
    const mesh = meshOf([0, 10, 0, 10], [0, 0, 10, 10], [5, 5, 10, 15], [0, 1, 2, 1, 3, 2]);
    const res = analyzeElevationBands(mesh, bands4(), { includeDisplay: true });
    expect(res.totals.surfacePlanArea).toBeCloseTo(100, 9);
    const sum = res.bands.reduce((s, b) => s + b.planArea, 0);
    expect(sum).toBeCloseTo(100, 9);
  });

  it('retained-only input conserves over retained (void excluded)', () => {
    const full = meshOf([0, 10, 0, 10], [0, 0, 10, 10], [0, 10, 20, 20], [0, 1, 2, 1, 3, 2]);
    const retained = meshOf([0, 10, 0, 10], [0, 0, 10, 10], [0, 10, 20, 20], [0, 1, 2]);
    const rFull = analyzeElevationBands(full, bands4(), { includeDisplay: false });
    const rRet = analyzeElevationBands(retained, bands4(), { includeDisplay: false });
    expect(rRet.totals.surfacePlanArea).toBeCloseTo(50, 9);
    expect(rFull.totals.surfacePlanArea).toBeCloseTo(100, 9);
    const sum = rRet.bands.reduce((s, b) => s + b.planArea, 0);
    expect(sum).toBeCloseTo(rRet.totals.surfacePlanArea, 9);
  });

  it('quantity-only mode matches display mode bitwise', () => {
    const mesh = meshOf([0, 10, 0, 10], [0, 0, 10, 10], [0, 10, 20, 7], [0, 1, 2, 1, 3, 2]);
    const a = analyzeElevationBands(mesh, bands4(), { includeDisplay: true });
    const b = analyzeElevationBands(mesh, bands4(), { includeDisplay: false });
    expect(b.bands.map((x) => x.planArea)).toEqual(a.bands.map((x) => x.planArea));
    expect(b.bands.map((x) => x.surface3DArea)).toEqual(a.bands.map((x) => x.surface3DArea));
    expect(b.totals).toEqual(a.totals);
    expect(b.bands[0]!.regions).toBeUndefined();
  });
});

describe('18u slope oracles', () => {
  const slopeBands = () => {
    const v = validateAnalysisBands([
      { id: 'flat', lower: 0, upper: 1 },
      { id: 'ten', lower: 1, upper: 50 },
      { id: 'steep', lower: 50, upper: 200 },
    ]);
    expect(v.ok).toBe(true);
    return v.bands;
  };
  const triForRatio = (ratio: number): ElevationMesh & SlopeMesh => {
    // Plane z = ratio*x over right triangle (0,0),(1,0),(0,1): plan=0.5.
    const z1 = ratio;
    return meshOf([0, 1, 0], [0, 0, 1], [0, z1, 0], [0, 1, 2]);
  };

  it('flat / 10% / 100% classify into the right bands', () => {
    expect(analyzeSlopeBands(triForRatio(0), slopeBands(), 'slope-percent').bands[0]!.planArea)
      .toBeCloseTo(0.5, 12);
    const ten = analyzeSlopeBands(triForRatio(0.1), slopeBands(), 'slope-percent');
    expect(ten.bands[1]!.planArea).toBeCloseTo(0.5, 12);
    const hundred = analyzeSlopeBands(triForRatio(1), slopeBands(), 'slope-percent');
    expect(hundred.bands[2]!.planArea).toBeCloseTo(0.5, 12);
    // 3D area = plan*sqrt(1+r²)
    expect(hundred.bands[2]!.surface3DArea).toBeCloseTo(0.5 * Math.SQRT2, 9);
  });

  it('45° angle boundary is deterministic ([lower,upper) rule)', () => {
    const v = validateAnalysisBands([
      { id: 'low', lower: 0, upper: 45 },
      { id: 'high', lower: 45, upper: 90 },
    ]);
    const res = analyzeSlopeBands(triForRatio(1), v.bands, 'slope-angle');
    expect(res.bands[1]!.planArea).toBeCloseTo(0.5, 9); // atan(1)=45 → upper band
    expect(res.bands[0]!.planArea).toBeCloseTo(0, 12);
  });

  it('slope conservation: classified + unclassified = surface', () => {
    const mesh = meshOf([0, 1, 0, 2, 3, 2], [0, 0, 1, 0, 0, 1], [0, 0, 0, 0, 0.5, 0], [0, 1, 2, 3, 4, 5]);
    const res = analyzeSlopeBands(mesh, slopeBands(), 'slope-percent');
    const sum = res.bands.reduce((s, b) => s + b.planArea, 0);
    expect(sum + res.totals.unclassifiedPlanArea).toBeCloseTo(res.totals.surfacePlanArea, 12);
    expect(res.bands[0]!.percentOfPlan).toBeCloseTo(50, 9);
  });
});

describe('18u clip/classify/validate/generator', () => {
  it('clipScalarPolygon clips a triangle to a mid band', () => {
    const out = clipScalarPolygon(
      [
        { x: 0, y: 0, value: 0 },
        { x: 10, y: 0, value: 10 },
        { x: 0, y: 10, value: 20 },
      ],
      5,
      15,
    );
    expect(out.length).toBeGreaterThanOrEqual(3);
    for (const p of out) {
      expect(p.value).toBeGreaterThanOrEqual(5 - 1e-9);
      expect(p.value).toBeLessThanOrEqual(15 + 1e-9);
    }
  });

  it('classify is [lower,upper), last inclusive', () => {
    const bands = bands4();
    expect(classifyAnalysisValue(5, bands)).toBe('b2');
    expect(classifyAnalysisValue(0, bands)).toBe('b1');
    expect(classifyAnalysisValue(20, bands)).toBe('b4');
    expect(classifyAnalysisValue(20.001, bands)).toBeNull();
    expect(classifyAnalysisValue(-1, bands)).toBeNull();
  });

  it('validation rejects overlaps, non-finite, lower>=upper', () => {
    expect(validateAnalysisBands([{ id: 'a', lower: 0, upper: 10 }, { id: 'b', lower: 5, upper: 15 }]).ok).toBe(false);
    expect(validateAnalysisBands([{ id: 'a', lower: NaN, upper: 10 }]).ok).toBe(false);
    expect(validateAnalysisBands([{ id: 'a', lower: 10, upper: 10 }]).ok).toBe(false);
    expect(validateAnalysisBands([{ id: 'a', lower: 10, upper: 5 }]).ok).toBe(false);
    // touching allowed
    const touch = validateAnalysisBands([{ id: 'b', lower: 10, upper: 20 }, { id: 'a', lower: 0, upper: 10 }]);
    expect(touch.ok).toBe(true);
    expect(touch.bands.map((b) => b.id)).toEqual(['a', 'b']);
  });

  it('generator covers [min,max] exactly, clamps count', () => {
    const bands = generateEqualRanges(0, 10, 4);
    expect(bands).toHaveLength(4);
    expect(bands[0]!.lower).toBe(0);
    expect(bands[3]!.upper).toBe(10);
    for (let i = 1; i < bands.length; i += 1) {
      expect(bands[i]!.lower).toBeCloseTo(bands[i - 1]!.upper, 12);
    }
    expect(generateEqualRanges(0, 10, 0)).toHaveLength(1);
    expect(generateEqualRanges(0, 10, 999)).toHaveLength(MAX_ANALYSIS_BANDS);
    expect(() => generateEqualRanges(5, 5)).toThrow();
  });
});
