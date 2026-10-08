/** CAD best-fit arc (E1, Worker A): geometric circle-fit and span-law oracles. */
import { describe, expect, it } from 'vitest';
import {
  cadBestFitArc,
  type BestFitArcInput,
} from '../src/engine/cad/cadBestFitArc';

interface ArcFixture {
  center: { x: number; y: number };
  radius: number;
  startDeg: number;
  endDeg: number;
  count: number;
  noise?: number;
}

const arcSamples = (fixture: ArcFixture): BestFitArcInput[] => {
  const points: BestFitArcInput[] = [];
  for (let index = 0; index < fixture.count; index += 1) {
    const fraction = fixture.count === 1 ? 0 : index / (fixture.count - 1);
    const angleDeg = fixture.startDeg + (fixture.endDeg - fixture.startDeg) * fraction;
    const radians = (angleDeg * Math.PI) / 180;
    const jitter = fixture.noise ? fixture.noise * Math.sin(index * 2.3) : 0;
    const radius = fixture.radius + jitter;
    points.push({
      x: fixture.center.x + Math.cos(radians) * radius,
      y: fixture.center.y + Math.sin(radians) * radius,
    });
  }
  return points;
};

const shuffled = (
  points: readonly BestFitArcInput[],
  permutation: readonly number[],
): BestFitArcInput[] => permutation.map((index) => points[index]);

describe('cadBestFitArc exact geometry', () => {
  it('reproduces the circumcircle from three exact points', () => {
    const points = arcSamples({ center: { x: 3, y: -2 }, radius: 5, startDeg: 10, endDeg: 200, count: 3 });
    const result = cadBestFitArc(points);
    expect(result).not.toBeNull();
    expect(result?.centerX).toBeCloseTo(3, 9);
    expect(result?.centerY).toBeCloseTo(-2, 9);
    expect(result?.radius).toBeCloseTo(5, 9);
    expect(result?.maxAbs).toBeLessThan(1e-9);
    expect(result?.startAngleDeg).toBeCloseTo(10, 6);
    expect(result?.endAngleDeg).toBeCloseTo(200, 6);
    expect(result?.sweepDeg).toBeCloseTo(190, 6);
  });

  it('recovers a noisy minor arc', () => {
    const points = arcSamples({
      center: { x: 0, y: 0 },
      radius: 5,
      startDeg: 0,
      endDeg: 80,
      count: 9,
      noise: 0.01,
    });
    const result = cadBestFitArc(points);
    expect(result).not.toBeNull();
    expect(result?.radius).toBeCloseTo(5, 1);
    expect(result?.sweepDeg).toBeCloseTo(80, 0);
    expect(result?.rms ?? 1).toBeLessThan(0.02);
  });

  it('recovers a noisy major arc', () => {
    const points = arcSamples({
      center: { x: -1, y: 4 },
      radius: 8,
      startDeg: 0,
      endDeg: 300,
      count: 21,
      noise: 0.02,
    });
    const result = cadBestFitArc(points);
    expect(result).not.toBeNull();
    expect(result?.radius).toBeCloseTo(8, 1);
    expect(result?.sweepDeg).toBeCloseTo(300, 0);
  });

  it('handles large coordinates', () => {
    const fixture: ArcFixture = {
      center: { x: 1e6, y: -2e6 },
      radius: 50,
      startDeg: 20,
      endDeg: 140,
      count: 9,
    };
    const result = cadBestFitArc(arcSamples(fixture));
    expect(result).not.toBeNull();
    expect(result?.centerX).toBeCloseTo(1e6, 3);
    expect(result?.centerY).toBeCloseTo(-2e6, 3);
    expect(result?.radius).toBeCloseTo(50, 6);
    expect(result?.maxAbs).toBeLessThan(1e-6);
  });

  it('is scale invariant', () => {
    const fixture: ArcFixture = { center: { x: 2, y: 1 }, radius: 6, startDeg: 5, endDeg: 120, count: 9 };
    const base = cadBestFitArc(arcSamples(fixture));
    const scaled = cadBestFitArc(
      arcSamples({
        center: { x: 20, y: 10 },
        radius: 60,
        startDeg: 5,
        endDeg: 120,
        count: 9,
      }),
    );
    expect(scaled?.radius).toBeCloseTo((base?.radius ?? 0) * 10, 6);
    expect(scaled?.startAngleDeg).toBeCloseTo(base?.startAngleDeg ?? 0, 6);
    expect(scaled?.endAngleDeg).toBeCloseTo(base?.endAngleDeg ?? 0, 6);
  });

  it('is independent of sample order (span law)', () => {
    const points = arcSamples({ center: { x: 1, y: 2 }, radius: 7, startDeg: 15, endDeg: 250, count: 10 });
    const first = cadBestFitArc(points);
    const second = cadBestFitArc(shuffled(points, [9, 3, 0, 7, 1, 5, 2, 8, 4, 6]));
    expect(second?.centerX).toBeCloseTo(first?.centerX ?? 0, 9);
    expect(second?.centerY).toBeCloseTo(first?.centerY ?? 0, 9);
    expect(second?.radius).toBeCloseTo(first?.radius ?? 0, 9);
    expect(second?.startAngleDeg).toBeCloseTo(first?.startAngleDeg ?? 0, 9);
    expect(second?.endAngleDeg).toBeCloseTo(first?.endAngleDeg ?? 0, 9);
  });
});

describe('cadBestFitArc fail-closed', () => {
  it('rejects fewer than three distinct points', () => {
    expect(cadBestFitArc([])).toBeNull();
    expect(
      cadBestFitArc([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]),
    ).toBeNull();
    expect(
      cadBestFitArc([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 1, y: 1 },
      ]),
    ).toBeNull();
  });

  it('rejects nearly collinear points', () => {
    expect(
      cadBestFitArc([
        { x: 0, y: 0 },
        { x: 1, y: 1e-12 },
        { x: 2, y: 0 },
      ]),
    ).toBeNull();
    expect(
      cadBestFitArc([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
      ]),
    ).toBeNull();
  });

  it('refuses a full circle sampled densely', () => {
    const points: BestFitArcInput[] = [];
    for (let index = 0; index < 720; index += 1) {
      const radians = (index * 2 * Math.PI) / 720;
      points.push({ x: Math.cos(radians) * 5, y: Math.sin(radians) * 5 });
    }
    expect(cadBestFitArc(points)).toBeNull();
  });
});
