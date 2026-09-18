import { describe, expect, it } from 'vitest';
import { computeVolumeQuantities } from '../src/engine/cad/surfaces/volume/computeVolume';
import type {
  VolumeMesh,
  VolumeQuantities,
} from '../src/engine/cad/surfaces/volume/volumeTypes';

const mesh = (pts: number[][], tris: number[][]): VolumeMesh => ({
  points: pts.flat(),
  triangles: tris.flat(),
});

/** Flat square [x0,x1]×[y0,y1] at height z (two math-CCW triangles). */
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
    expect(q.maxCutDepth).toBeGreaterThanOrEqual(q.averageCutDepth);
  } else {
    expect(q.averageCutDepth).toBe(0);
  }
  if (q.fillArea > 0) {
    expect(q.averageFillDepth * q.fillArea).toBeCloseTo(q.fillVolume, 9);
    expect(q.maxFillDepth).toBeGreaterThanOrEqual(q.averageFillDepth);
  } else {
    expect(q.averageFillDepth).toBe(0);
  }
  expect(q.maxCutDepth).toBe(Math.max(0, -q.minDelta));
  expect(q.maxFillDepth).toBe(Math.max(0, q.maxDelta));
};

describe('volume analytic oracles', () => {
  it('flat +1 fill oracle: 10x10 gives overlap 100, fill 100, net +100', () => {
    const q = computeVolumeQuantities(flatSquare(0), flatSquare(1)).quantities;
    expect(q.overlapArea).toBe(100);
    expect(q.fillArea).toBe(100);
    expect(q.fillVolume).toBe(100);
    expect(q.cutArea).toBe(0);
    expect(q.cutVolume).toBe(0);
    expect(q.netVolume).toBe(100);
    expect(q.averageFillDepth).toBe(1);
    expect(q.maxFillDepth).toBe(1);
    expect(q.minDelta).toBe(0);
    expect(q.maxDelta).toBe(1);
    expectConservation(q);
  });

  it('flat -1 cut oracle: 10x10 gives cut 100, net -100', () => {
    const q = computeVolumeQuantities(flatSquare(0), flatSquare(-1)).quantities;
    expect(q.overlapArea).toBe(100);
    expect(q.cutArea).toBe(100);
    expect(q.cutVolume).toBe(100);
    expect(q.fillArea).toBe(0);
    expect(q.fillVolume).toBe(0);
    expect(q.netVolume).toBe(-100);
    expect(q.averageCutDepth).toBe(1);
    expect(q.maxCutDepth).toBe(1);
    expectConservation(q);
  });

  it('crossing plane z=x-0.5 over unit square: cut 0.125, fill 0.125, net 0', () => {
    const base = flatSquare(0, 0, 0, 1, 1);
    const cmp = mesh(
      [
        [0, 0, -0.5],
        [1, 0, 0.5],
        [1, 1, 0.5],
        [0, 1, -0.5],
      ],
      [
        [0, 1, 2],
        [0, 2, 3],
      ],
    );
    const q = computeVolumeQuantities(base, cmp).quantities;
    expect(q.overlapArea).toBeCloseTo(1, 12);
    expect(q.cutVolume).toBeCloseTo(0.125, 12);
    expect(q.fillVolume).toBeCloseTo(0.125, 12);
    expect(q.netVolume).toBeCloseTo(0, 12);
    expect(q.cutArea).toBeCloseTo(0.5, 12);
    expect(q.fillArea).toBeCloseTo(0.5, 12);
    expectConservation(q);
  });

  it('different triangulation of the same plane yields exactly zero', () => {
    const base = flatSquare(2.5, 0, 0, 1, 1);
    const cmp = mesh(
      [
        [0, 0, 2.5],
        [1, 0, 2.5],
        [1, 1, 2.5],
        [0, 1, 2.5],
        [0.5, 0.5, 2.5],
      ],
      [
        [0, 1, 4],
        [1, 2, 4],
        [2, 3, 4],
        [3, 0, 4],
      ],
    );
    const q = computeVolumeQuantities(base, cmp).quantities;
    expect(q.overlapArea).toBe(1);
    expect(q.cutVolume).toBe(0);
    expect(q.fillVolume).toBe(0);
    expect(q.netVolume).toBe(0);
    expectConservation(q);
  });

  it('offset +2 over a different TIN gives fill = area * 2', () => {
    const base = flatSquare(5, 0, 0, 10, 10);
    const cmp = mesh(
      [
        [0, 0, 7],
        [10, 0, 7],
        [10, 10, 7],
        [0, 10, 7],
        [5, 5, 7],
      ],
      [
        [0, 1, 4],
        [1, 2, 4],
        [2, 3, 4],
        [3, 0, 4],
      ],
    );
    const q = computeVolumeQuantities(base, cmp).quantities;
    expect(q.fillVolume).toBe(200);
    expect(q.cutVolume).toBe(0);
    expect(q.netVolume).toBe(200);
    expect(q.averageFillDepth).toBe(2);
    expectConservation(q);
  });

  it('partial overlap: shifted comparison clips to the common window', () => {
    const q = computeVolumeQuantities(flatSquare(0), flatSquare(1, 5, 0, 15, 10)).quantities;
    expect(q.overlapArea).toBe(50);
    expect(q.fillVolume).toBe(50);
    expect(q.cutVolume).toBe(0);
    expect(q.netVolume).toBe(50);
    expectConservation(q);
  });

  it('void exclusion: absent base triangles do not overlap', () => {
    const base = mesh(
      [
        [0, 0, 0],
        [2, 0, 0],
        [2, 2, 0],
        [0, 2, 0],
      ],
      [[0, 1, 2]],
    );
    const cmp = flatSquare(1, 0, 0, 2, 2);
    const q = computeVolumeQuantities(base, cmp).quantities;
    expect(q.overlapArea).toBe(2);
    expect(q.fillVolume).toBe(2);
    expect(q.netVolume).toBe(2);
    expectConservation(q);
  });

  it('display mode returns identical quantities plus regions', () => {
    const base = flatSquare(0, 0, 0, 1, 1);
    const cmp = mesh(
      [
        [0, 0, -0.5],
        [1, 0, 0.5],
        [1, 1, 0.5],
        [0, 1, -0.5],
      ],
      [
        [0, 1, 2],
        [0, 2, 3],
      ],
    );
    const plain = computeVolumeQuantities(base, cmp);
    const display = computeVolumeQuantities(base, cmp, { includeDisplay: true });
    expect(display.quantities).toEqual(plain.quantities);
    expect(plain.regions).toEqual([]);
    expect(display.regions.length).toBeGreaterThan(0);
    let cutRingArea = 0;
    let fillRingArea = 0;
    for (const r of display.regions) {
      expect(r.kind === 'cut' || r.kind === 'fill').toBe(true);
      let a2 = 0;
      for (let i = 0; i < r.rings.length; i += 2) {
        const px = r.rings[i];
        const py = r.rings[i + 1];
        const qx = r.rings[(i + 2) % r.rings.length];
        const qy = r.rings[(i + 3) % r.rings.length];
        a2 += px * qy - qx * py;
      }
      if (r.kind === 'cut') cutRingArea += Math.abs(a2) / 2;
      else fillRingArea += Math.abs(a2) / 2;
    }
    expect(cutRingArea).toBeCloseTo(display.quantities.cutArea, 9);
    expect(fillRingArea).toBeCloseTo(display.quantities.fillArea, 9);
    expectConservation(display.quantities);
  });
});
