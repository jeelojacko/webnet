import { describe, expect, it } from 'vitest';
import { computeVolumeQuantities } from '../src/engine/cad/surfaces/volume/computeVolume';
import type {
  VolumeMesh,
  VolumeQuantities,
} from '../src/engine/cad/surfaces/volume/volumeTypes';
import { VolumeError } from '../src/engine/cad/surfaces/volume/volumeTypes';

const mesh = (pts: number[][], tris: number[][]): VolumeMesh => ({
  points: pts.flat(),
  triangles: tris.flat(),
});

const flatSquare = (
  z: number,
  x0 = 0,
  y0 = 0,
  x1 = 10,
  y1 = 10,
): VolumeMesh =>
  mesh(
    [
      [x0, y0, z],
      [x1, y0, z],
      [x1, y1, z],
      [x0, y1, z],
    ],
    [
      [0, 1, 2],
      [0, 2, 3],
    ],
  );

/** Conservation gates required on EVERY success test. */
const expectConservation = (q: VolumeQuantities): void => {
  expect(q.netVolume).toBe(q.fillVolume - q.cutVolume);
  for (const v of [q.overlapArea, q.cutArea, q.fillArea, q.cutVolume, q.fillVolume]) {
    expect(v).toBeGreaterThanOrEqual(0);
  }
  const tol = 1e-9 * Math.max(1, q.overlapArea);
  expect(q.cutArea + q.fillArea).toBeLessThanOrEqual(q.overlapArea + tol);
  // Areas sum to overlap; the only permitted gap is zero-measure (§26),
  // which by definition carries no volume.
  const gap = q.overlapArea - (q.cutArea + q.fillArea);
  expect(gap).toBeGreaterThanOrEqual(-tol);
  if (gap > tol) {
    expect(q.cutVolume + q.fillVolume).toBeLessThanOrEqual(tol);
  }
  if (q.cutArea > 0) {
    expect(q.averageCutDepth * q.cutArea).toBeCloseTo(q.cutVolume, 9);
  }
  if (q.fillArea > 0) {
    expect(q.averageFillDepth * q.fillArea).toBeCloseTo(q.fillVolume, 9);
  }
};

const shifted = (m: VolumeMesh, dx: number, dy: number): VolumeMesh => {
  const points = [...m.points];
  for (let i = 0; i < points.length; i += 3) {
    points[i] += dx;
    points[i + 1] += dy;
  }
  return { points, triangles: [...m.triangles] };
};

describe('volume robustness', () => {
  it('concave L base against a full square clips to the L area', () => {
    const base = mesh(
      [
        [0, 0, 0],
        [2, 0, 0],
        [2, 1, 0],
        [1, 1, 0],
        [1, 2, 0],
        [0, 2, 0],
      ],
      [
        [0, 1, 2],
        [0, 2, 3],
        [0, 3, 4],
        [0, 4, 5],
      ],
    );
    const q = computeVolumeQuantities(base, flatSquare(1, 0, 0, 2, 2)).quantities;
    expect(q.overlapArea).toBe(3);
    expect(q.fillVolume).toBe(3);
    expect(q.cutVolume).toBe(0);
    expectConservation(q);
  });

  it('zero line through vertices: z=x+y-1 gives sixth-volumes, net 0', () => {
    const base = flatSquare(0, 0, 0, 1, 1);
    const cmp = mesh(
      [
        [0, 0, -1],
        [1, 0, 0],
        [1, 1, 1],
        [0, 1, 0],
      ],
      [
        [0, 1, 2],
        [0, 2, 3],
      ],
    );
    const q = computeVolumeQuantities(base, cmp).quantities;
    expect(q.fillVolume).toBeCloseTo(1 / 6, 12);
    expect(q.cutVolume).toBeCloseTo(1 / 6, 12);
    expect(q.netVolume).toBeCloseTo(0, 12);
    expectConservation(q);
  });

  it('zero line along an edge: z=y is all fill with no cut', () => {
    const base = flatSquare(0, 0, 0, 1, 1);
    const cmp = mesh(
      [
        [0, 0, 0],
        [1, 0, 0],
        [1, 1, 1],
        [0, 1, 1],
      ],
      [
        [0, 1, 2],
        [0, 2, 3],
      ],
    );
    const q = computeVolumeQuantities(base, cmp).quantities;
    expect(q.fillVolume).toBeCloseTo(0.5, 12);
    expect(q.fillArea).toBeCloseTo(1, 12);
    expect(q.cutVolume).toBe(0);
    expect(q.cutArea).toBe(0);
    expectConservation(q);
  });

  it('+2e6/+7e6 translation preserves quantities', () => {
    const ref = computeVolumeQuantities(flatSquare(0), flatSquare(1)).quantities;
    const moved = computeVolumeQuantities(
      shifted(flatSquare(0), 2e6, 7e6),
      shifted(flatSquare(1), 2e6, 7e6),
    ).quantities;
    for (const k of ['overlapArea', 'fillVolume', 'netVolume'] as const) {
      expect(Math.abs(moved[k] - ref[k])).toBeLessThanOrEqual(1e-6 * Math.max(1, Math.abs(ref[k])));
    }
    expect(moved.fillVolume).toBeCloseTo(100, 6);
    expectConservation(moved);
  });

  it('shuffled triangle order gives identical quantities', () => {
    const base = flatSquare(0);
    const cmp = flatSquare(1);
    const ref = computeVolumeQuantities(base, cmp).quantities;
    const reversed: VolumeMesh = {
      points: [...cmp.points],
      triangles: [...cmp.triangles.slice(3), ...cmp.triangles.slice(0, 3)],
    };
    const q = computeVolumeQuantities(base, reversed).quantities;
    expect(q).toEqual(ref);
    expectConservation(q);
  });

  it('thin sliver overlap integrates to its exact area', () => {
    const base = flatSquare(0, 0, 0, 1, 1);
    const cmp = mesh(
      [
        [0, 0, 1],
        [1, 0, 1],
        [1, 0.001, 1],
      ],
      [[0, 1, 2]],
    );
    const q = computeVolumeQuantities(base, cmp).quantities;
    expect(q.overlapArea).toBeCloseTo(0.0005, 12);
    expect(q.fillVolume).toBeCloseTo(0.0005, 12);
    expect(q.cutVolume).toBe(0);
    expectConservation(q);
  });

  it('edge touch yields zero area and zero volumes', () => {
    const q = computeVolumeQuantities(
      flatSquare(0, 0, 0, 1, 1),
      flatSquare(5, 1, 0, 2, 1),
    ).quantities;
    expect(q.overlapArea).toBe(0);
    expect(q.cutVolume).toBe(0);
    expect(q.fillVolume).toBe(0);
    expect(q.netVolume).toBe(0);
    expect(q.polygonCount).toBe(0);
    expectConservation(q);
  });

  it('tilted identical plane on different triangulations is ~0', () => {
    const tilted = (cx: number, cy: number): number => cx + 2 * cy + 3;
    const base = mesh(
      [
        [0, 0, tilted(0, 0)],
        [1, 0, tilted(1, 0)],
        [1, 1, tilted(1, 1)],
        [0, 1, tilted(0, 1)],
      ],
      [
        [0, 1, 2],
        [0, 2, 3],
      ],
    );
    const cmp = mesh(
      [
        [0, 0, tilted(0, 0)],
        [1, 0, tilted(1, 0)],
        [1, 1, tilted(1, 1)],
        [0, 1, tilted(0, 1)],
        [0.5, 0.5, tilted(0.5, 0.5)],
      ],
      [
        [0, 1, 4],
        [1, 2, 4],
        [2, 3, 4],
        [3, 0, 4],
      ],
    );
    const q = computeVolumeQuantities(base, cmp).quantities;
    expect(q.cutVolume).toBeLessThan(1e-9);
    expect(q.fillVolume).toBeLessThan(1e-9);
    expectConservation(q);
  });

  it('non-finite input fails closed with VolumeError', () => {
    const bad = flatSquare(0);
    const nan: VolumeMesh = { points: [...bad.points], triangles: [...bad.triangles] };
    nan.points[2] = NaN;
    expect(() => computeVolumeQuantities(nan, flatSquare(1))).toThrow(VolumeError);
    const badIdx: VolumeMesh = { points: [...bad.points], triangles: [0, 1, 99] };
    expect(() => computeVolumeQuantities(badIdx, flatSquare(1))).toThrow(VolumeError);
    expect(() => computeVolumeQuantities(flatSquare(0), nan)).toThrow(VolumeError);
  });
});
