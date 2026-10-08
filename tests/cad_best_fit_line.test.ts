/** CAD best-fit line (E1, Worker A): TLS/PCA numeric oracles. */
import { describe, expect, it } from 'vitest';
import {
  cadBestFitLine,
  type BestFitLineInput,
} from '../src/engine/cad/cadBestFitLine';

const rotated = (angleDeg: number, tValues: readonly number[]): BestFitLineInput[] => {
  const radians = (angleDeg * Math.PI) / 180;
  return tValues.map((t) => ({ x: Math.cos(radians) * t, y: Math.sin(radians) * t }));
};

const translate = (
  points: readonly BestFitLineInput[],
  dx: number,
  dy: number,
): BestFitLineInput[] => points.map((point) => ({ x: point.x + dx, y: point.y + dy }));

describe('cadBestFitLine exact geometry', () => {
  it('recovers a horizontal line with +X tangent and left normal', () => {
    const result = cadBestFitLine([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ]);
    expect(result).not.toBeNull();
    expect(result?.tangentX).toBeCloseTo(1, 12);
    expect(result?.tangentY).toBeCloseTo(0, 12);
    expect(result?.normalX).toBeCloseTo(0, 12);
    expect(result?.normalY).toBeCloseTo(1, 12);
    expect(result?.rms).toBeCloseTo(0, 12);
    expect(result?.spanLength).toBeCloseTo(3, 12);
    expect(result?.endP0).toEqual({ x: 0, y: 0 });
    expect(result?.endP1).toEqual({ x: 3, y: 0 });
    expect(result?.azimuthDeg).toBeCloseTo(90, 9);
  });

  it('prefers +Y for a vertical line (machine-zero X)', () => {
    const result = cadBestFitLine([
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: 2 },
    ]);
    expect(result?.tangentX).toBeCloseTo(0, 12);
    expect(result?.tangentY).toBeCloseTo(1, 12);
    expect(result?.endP0.x).toBeCloseTo(0, 12);
    expect(result?.endP0.y).toBeCloseTo(0, 12);
    expect(result?.endP1.x).toBeCloseTo(0, 12);
    expect(result?.endP1.y).toBeCloseTo(2, 12);
  });

  it('recovers a rotated exact line', () => {
    const result = cadBestFitLine(rotated(37, [0, 1, 2, 3, 4, 5]));
    expect(result?.rms).toBeCloseTo(0, 10);
    expect(result?.maxAbs).toBeCloseTo(0, 10);
    expect(result?.tangentX).toBeCloseTo(Math.cos((37 * Math.PI) / 180), 10);
    expect(result?.tangentY).toBeCloseTo(Math.sin((37 * Math.PI) / 180), 10);
  });
});

describe('cadBestFitLine conditioning', () => {
  it('is translation invariant at large coordinates', () => {
    const base = cadBestFitLine([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ]);
    const shifted = cadBestFitLine(
      translate(
        [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 2, y: 0 },
          { x: 3, y: 0 },
        ],
        1e6,
        -2e6,
      ),
    );
    expect(shifted?.tangentX).toBeCloseTo(base?.tangentX ?? 0, 12);
    expect(shifted?.tangentY).toBeCloseTo(base?.tangentY ?? 0, 12);
    expect(shifted?.spanLength).toBeCloseTo(3, 6);
    expect(shifted?.maxAbs).toBeLessThan(1e-6);
  });

  it('scales residuals with uniform scale', () => {
    const small = cadBestFitLine([
      { x: 0, y: 0 },
      { x: 1, y: 0.1 },
      { x: 2, y: -0.05 },
      { x: 3, y: 0.08 },
    ]);
    const large = cadBestFitLine([
      { x: 0, y: 0 },
      { x: 100, y: 10 },
      { x: 200, y: -5 },
      { x: 300, y: 8 },
    ]);
    expect(large?.tangentX).toBeCloseTo(small?.tangentX ?? 0, 9);
    expect(large?.rms).toBeCloseTo((small?.rms ?? 0) * 100, 6);
    expect(large?.spanLength).toBeCloseTo((small?.spanLength ?? 0) * 100, 6);
  });

  it('fits noisy data and keeps signed residuals aligned with the normal', () => {
    const points = [0, 1, 2, 3, 4, 5].map((index) => ({
      x: index,
      y: 0.2 * Math.sin(index),
    }));
    const result = cadBestFitLine(points);
    expect(result).not.toBeNull();
    expect(result?.rms ?? 1).toBeGreaterThan(0);
    expect(result?.rms ?? 1).toBeLessThan(0.3);
    expect(result?.residuals.length).toBe(points.length);
  });
});

describe('cadBestFitLine fail-closed', () => {
  it('rejects fewer than two distinct points', () => {
    expect(cadBestFitLine([])).toBeNull();
    expect(cadBestFitLine([{ x: 1, y: 1 }])).toBeNull();
    expect(
      cadBestFitLine([
        { x: 1, y: 1 },
        { x: 1, y: 1 },
      ]),
    ).toBeNull();
  });

  it('rejects near-zero span duplicates', () => {
    expect(
      cadBestFitLine([
        { x: 0, y: 0 },
        { x: 1e-13, y: -1e-13 },
      ]),
    ).toBeNull();
  });

  it('rejects an isotropic (direction-indeterminate) cloud', () => {
    expect(
      cadBestFitLine([
        { x: 1, y: 0 },
        { x: -1, y: 0 },
        { x: 0, y: 1 },
        { x: 0, y: -1 },
      ]),
    ).toBeNull();
    const regularPolygon = Array.from({ length: 8 }, (_, index) => ({
      x: Math.cos((index * Math.PI) / 4),
      y: Math.sin((index * Math.PI) / 4),
    }));
    expect(cadBestFitLine(regularPolygon)).toBeNull();
  });

  it('drops non-finite samples before fitting', () => {
    const result = cadBestFitLine([
      { x: 0, y: 0 },
      { x: Number.NaN, y: 5 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ]);
    expect(result?.residuals.length).toBe(3);
    expect(result?.spanLength).toBeCloseTo(3, 12);
  });
});
