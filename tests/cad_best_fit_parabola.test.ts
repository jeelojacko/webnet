/** CAD best-fit parabola (E1, Worker A): rotated geometric-fit oracles. */
import { describe, expect, it } from 'vitest';
import {
  cadBestFitParabola,
  type BestFitParabolaInput,
} from '../src/engine/cad/cadBestFitParabola';
import {
  cadParabolaArcLength,
  cadParabolaBoundsAnalytic,
  cadParabolaClosestParameterFinite,
  cadParabolaCurveLength,
  cadParabolaHalfLengthMidpointT,
  cadParabolaLineIntersection,
  cadParabolaParamPoint,
  cadParabolaSpeed,
  type CanonicalParabola,
} from '../src/engine/cad/cadParabolaGeometry';

interface ParabolaFixture {
  vx: number;
  vy: number;
  axisDeg: number;
  focal: number;
  tValues: readonly number[];
}

/** Independent generator (test-local) using P = a f t^2 + b 2 f t. */
const sampleParabola = (fixture: ParabolaFixture): BestFitParabolaInput[] => {
  const radians = (fixture.axisDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return fixture.tValues.map((t) => ({
    x: fixture.vx + cos * fixture.focal * t * t + sin * 2 * fixture.focal * t,
    y: fixture.vy + sin * fixture.focal * t * t - cos * 2 * fixture.focal * t,
  }));
};

const angleDistance = (first: number, second: number): number => {
  const delta = Math.abs((((first - second) % 360) + 360) % 360);
  return Math.min(delta, 360 - delta);
};

const assertCanonicalClose = (
  canonical: CanonicalParabola,
  fixture: ParabolaFixture,
  lengthTolerance: number,
  focalTolerance: number,
  axisToleranceDeg: number,
): void => {
  expect(Math.abs(canonical.vertexX - fixture.vx)).toBeLessThan(lengthTolerance);
  expect(Math.abs(canonical.vertexY - fixture.vy)).toBeLessThan(lengthTolerance);
  expect(Math.abs(canonical.focalLength - fixture.focal)).toBeLessThan(focalTolerance);
  const axisDistance = angleDistance(canonical.axisAngleDeg, fixture.axisDeg);
  const flippedDistance = Math.abs(axisDistance - 180);
  expect(Math.min(axisDistance, flippedDistance)).toBeLessThan(axisToleranceDeg);
};

const axisFixture = (axisDeg: number): ParabolaFixture => ({
  vx: 2,
  vy: -3,
  axisDeg,
  focal: 1.5,
  tValues: [-4, -2, -1, 0, 1, 2, 3, 5],
});

describe('cadBestFitParabola exact recovery', () => {
  it.each([0, 37, 89, 143])('recovers an axis %i fixture', (axisDeg) => {
    const fixture = axisFixture(axisDeg);
    const result = cadBestFitParabola(sampleParabola(fixture));
    expect(result).not.toBeNull();
    expect(result?.maxAbs).toBeLessThan(1e-5);
    assertCanonicalClose(result!.canonical, fixture, 1e-4, 1e-4, 0.05);
  });

  it('recovers asymmetric t ranges, focals and large translations', () => {
    const fixtures: ParabolaFixture[] = [
      { vx: 0, vy: 0, axisDeg: 12, focal: 0.5, tValues: [-1, 0, 0.5, 3, 9] },
      { vx: 1e6, vy: -2e6, axisDeg: 37, focal: 3, tValues: [-5, -1, 0, 2, 6] },
      { vx: -500, vy: 250, axisDeg: 89, focal: 20, tValues: [-3, -2, 1, 4, 8] },
      { vx: 7, vy: 9, axisDeg: 143, focal: 0.25, tValues: [-8, -6, -4.5, -4, -3.5] },
    ];
    for (const fixture of fixtures) {
      const result = cadBestFitParabola(sampleParabola(fixture));
      expect(result).not.toBeNull();
      const scale = Math.max(1, Math.abs(fixture.vx), Math.abs(fixture.vy));
      expect(result!.maxAbs).toBeLessThan(1e-5 * scale);
      assertCanonicalClose(result!.canonical, fixture, 1e-4 * scale, 1e-4 * fixture.focal, 0.1);
    }
  });

  it('recovers a rotated fixture that a world-axis regression cannot', () => {
    const fixture: ParabolaFixture = {
      vx: -4,
      vy: 11,
      axisDeg: 90,
      focal: 2,
      tValues: [-3, -1, 0, 1, 2, 4],
    };
    const result = cadBestFitParabola(sampleParabola(fixture));
    expect(result).not.toBeNull();
    expect(result?.maxAbs).toBeLessThan(1e-5);
    assertCanonicalClose(result!.canonical, fixture, 1e-4, 1e-4, 0.05);
  });

  it('is uniform-scale invariant', () => {
    const fixture: ParabolaFixture = {
      vx: 1,
      vy: 2,
      axisDeg: 25,
      focal: 2,
      tValues: [-3, -1, 0, 2, 4],
    };
    const base = cadBestFitParabola(sampleParabola(fixture));
    const scaled = cadBestFitParabola(
      sampleParabola({
        vx: 10,
        vy: 20,
        axisDeg: 25,
        focal: 20,
        tValues: [-3, -1, 0, 2, 4],
      }),
    );
    expect(scaled).not.toBeNull();
    expect((scaled?.canonical.focalLength ?? 0) / (base?.canonical.focalLength ?? 1)).toBeCloseTo(10, 3);
    expect(angleDistance(scaled!.canonical.axisAngleDeg, base!.canonical.axisAngleDeg)).toBeLessThan(0.1);
  });

  it('recovers a reflected fixture', () => {
    const fixture = axisFixture(37);
    const reflected = sampleParabola(fixture).map((point) => ({ x: point.x, y: -point.y }));
    const result = cadBestFitParabola(reflected);
    expect(result).not.toBeNull();
    assertCanonicalClose(
      result!.canonical,
      { ...fixture, vy: -fixture.vy, axisDeg: 360 - fixture.axisDeg },
      1e-4,
      1e-4,
      0.1,
    );
  });
});

describe('cadBestFitParabola noisy data', () => {
  const noisyFixture: ParabolaFixture = {
    vx: 1,
    vy: -1,
    axisDeg: 30,
    focal: 2,
    tValues: [-5, -3.5, -2, -0.5, 1, 2.5, 4, 5],
  };
  const points = sampleParabola(noisyFixture).map((point, index) => ({
    x: point.x + 0.01 * Math.sin(index * 1.7),
    y: point.y + 0.01 * Math.cos(index * 2.1),
  }));

  it('fits small normal noise', () => {
    const result = cadBestFitParabola(points);
    expect(result).not.toBeNull();
    expect(result?.rms ?? 1).toBeLessThan(0.05);
    assertCanonicalClose(result!.canonical, noisyFixture, 0.2, 0.2, 2);
  });

  it('matches a dense brute-force closest-point oracle', () => {
    const result = cadBestFitParabola(points);
    expect(result).not.toBeNull();
    const canonical = result!.canonical;
    const samples = 40001;
    for (let index = 0; index < points.length; index += 1) {
      let best = Infinity;
      for (let step = 0; step < samples; step += 1) {
        const t = canonical.tStart + ((canonical.tEnd - canonical.tStart) * step) / (samples - 1);
        const projected = cadParabolaParamPoint(canonical, t);
        const distance = Math.hypot(points[index].x - projected.x, points[index].y - projected.y);
        if (distance < best) best = distance;
      }
      expect(Math.abs(result!.residuals[index])).toBeLessThan(best + 1e-3);
      expect(Math.abs(result!.residuals[index])).toBeGreaterThan(best - 1e-3);
    }
  });
});

describe('cadBestFitParabola fail-closed', () => {
  it('rejects fewer than five distinct points', () => {
    expect(cadBestFitParabola([])).toBeNull();
    expect(cadBestFitParabola(sampleParabola({ ...axisFixture(0), tValues: [0, 1, 2] }))).toBeNull();
    const duplicate = Array.from({ length: 6 }, () => ({ x: 1, y: 1 }));
    expect(cadBestFitParabola(duplicate)).toBeNull();
  });

  it('rejects line-like / collinear data', () => {
    const collinear = Array.from({ length: 7 }, (_, index) => ({ x: index, y: 2 * index + 1 }));
    expect(cadBestFitParabola(collinear)).toBeNull();
  });

  it('rejects non-finite samples but still fits the finite remainder', () => {
    const points = sampleParabola(axisFixture(37));
    const withNonFinite = [...points, { x: Number.NaN, y: 0 }, { x: 0, y: Number.POSITIVE_INFINITY }];
    const result = cadBestFitParabola(withNonFinite);
    expect(result).not.toBeNull();
    expect(result?.residuals.length).toBe(points.length);
  });
});

describe('cadParabolaGeometry helpers', () => {
  const canonical = (
    axisDeg: number,
    focal: number,
    tStart: number,
    tEnd: number,
  ): CanonicalParabola => ({
    vertexX: 0,
    vertexY: 0,
    axisAngleDeg: axisDeg,
    focalLength: focal,
    tStart,
    tEnd,
  });

  it('matches the closed-form arc length of a dense speed integral', () => {
    const parabola = canonical(23, 1.7, -2, 3);
    const exact = cadParabolaCurveLength(parabola);
    let numeric = 0;
    const steps = 200000;
    for (let index = 0; index < steps; index += 1) {
      const t = parabola.tStart + ((parabola.tEnd - parabola.tStart) * (index + 0.5)) / steps;
      numeric += cadParabolaSpeed(parabola, t) * ((parabola.tEnd - parabola.tStart) / steps);
    }
    expect(exact).not.toBeNull();
    expect(exact ?? 0).toBeCloseTo(numeric, 6);
  });

  it('computes analytic bounds including interior extrema', () => {
    // a = (0, 1), b = (1, 0): P = (2t, t^2).
    const parabola = canonical(90, 1, -2, 2);
    const bounds = cadParabolaBoundsAnalytic(parabola);
    expect(bounds?.minX).toBeCloseTo(-4, 9);
    expect(bounds?.maxX).toBeCloseTo(4, 9);
    expect(bounds?.minY).toBeCloseTo(0, 9);
    expect(bounds?.maxY).toBeCloseTo(4, 9);
  });

  it('splits the finite arc into equal half lengths', () => {
    const parabola = canonical(61, 0.8, -1.5, 4);
    const midpoint = cadParabolaHalfLengthMidpointT(parabola);
    expect(midpoint).not.toBeNull();
    const first = cadParabolaArcLength(parabola, parabola.tStart, midpoint ?? 0) ?? 0;
    const second = cadParabolaArcLength(parabola, midpoint ?? 0, parabola.tEnd) ?? 0;
    expect(first).toBeCloseTo(second, 6);
  });

  it('intersects a finite parabola with a segment and clamps the extent', () => {
    // a = (1, 0), b = (0, -1): P = (t^2, -2t), t in [-2, 2].
    const parabola = canonical(0, 1, -2, 2);
    const horizontal = cadParabolaLineIntersection(parabola, { x: -1, y: 0 }, { x: 5, y: 0 });
    expect(horizontal).toHaveLength(1);
    expect(horizontal[0].x).toBeCloseTo(0, 9);
    expect(horizontal[0].y).toBeCloseTo(0, 9);
    const offset = cadParabolaLineIntersection(parabola, { x: -1, y: 2 }, { x: 3, y: 2 });
    expect(offset).toHaveLength(1);
    expect(offset[0].x).toBeCloseTo(1, 9);
    expect(offset[0].y).toBeCloseTo(2, 9);
    const outside = cadParabolaLineIntersection(parabola, { x: -1, y: -5 }, { x: 5, y: -5 });
    expect(outside).toHaveLength(0);
  });

  it('clamps the finite closest parameter to the extent', () => {
    const parabola = canonical(0, 1, 0, 1);
    const beyond = cadParabolaClosestParameterFinite(parabola, { x: 100, y: -100 });
    expect(beyond).toBeCloseTo(1, 9);
    const before = cadParabolaClosestParameterFinite(parabola, { x: 100, y: 100 });
    expect(before).toBeCloseTo(0, 9);
  });
});

describe('cadBestFitParabola performance', () => {
  it('fits 500 samples interactively without runaway iteration', () => {
    const fixture: ParabolaFixture = {
      vx: 100,
      vy: -50,
      axisDeg: 61,
      focal: 4,
      tValues: Array.from({ length: 500 }, (_, index) => -6 + (12 * index) / 499),
    };
    const points = sampleParabola(fixture).map((point, index) => ({
      x: point.x + 0.005 * Math.sin(index),
      y: point.y + 0.005 * Math.cos(index),
    }));
    const started = performance.now();
    const result = cadBestFitParabola(points);
    const elapsed = performance.now() - started;
    expect(result).not.toBeNull();
    expect(result?.rms ?? 1).toBeLessThan(0.05);
    expect(elapsed).toBeLessThan(2000);
  });
});
