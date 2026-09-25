import { describe, expect, it } from 'vitest';
import {
  computeDepthBands,
  type DepthBand,
  type DepthBandResult,
} from '../src/engine/cad/surfaceAnalysis/depthBands';
import { classifyAnalysisValue } from '../src/engine/cad/surfaceAnalysis/scalarClip';
import { computeVolumeQuantities } from '../src/engine/cad/surfaces/volume/computeVolume';
import type { VolumeMesh } from '../src/engine/cad/surfaces/volume/volumeTypes';

type Diagonal = 0 | 1;

const mesh = (pts: number[][], tris: number[][]): VolumeMesh => ({
  points: pts.flat(),
  triangles: tris.flat(),
});

/**
 * Flat square with a linear height field. diagonal 0 splits 0–2, diagonal 1
 * splits 1–3: same planes, different triangulation.
 */
const squareMesh = (
  zAt: (_x: number, _y: number) => number,
  diagonal: Diagonal = 0,
  size = 1,
): VolumeMesh => {
  const corners: Array<[number, number]> = [
    [0, 0],
    [size, 0],
    [size, size],
    [0, size],
  ];
  const pts = corners.map(([x, y]) => [x, y, zAt(x, y)]);
  const tris = diagonal === 0 ? [[0, 1, 2], [0, 2, 3]] : [[0, 1, 3], [1, 2, 3]];
  return mesh(pts, tris);
};

const close = (actual: number, expected: number, tol = 1e-9): void => {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(expected)));
};

const bandById = (result: DepthBandResult, id: string) => {
  const band = result.bands.find((b) => b.bandId === id);
  if (!band) throw new Error(`missing band ${id}`);
  return band;
};

const CROSS_BANDS: DepthBand[] = [
  { id: 'cut', lower: -0.5, upper: 0 },
  { id: 'fill', lower: 0, upper: 0.5 },
];

const QUANTITY_KEYS = [
  'overlapArea',
  'cutVolume',
  'fillVolume',
  'netVolume',
  'classifiedArea',
  'unclassifiedArea',
  'minDelta',
  'maxDelta',
] as const;

describe('18U depth bands: crossing-plane oracle (base 0, cmp x-0.5)', () => {
  const base = squareMesh(() => 0);
  const cmp = squareMesh((x) => x - 0.5);
  const volume = computeVolumeQuantities(base, cmp).quantities;

  it('analytic per-band areas and cut/fill volumes', () => {
    const result = computeDepthBands(base, cmp, CROSS_BANDS);
    const cut = bandById(result, 'cut');
    const fill = bandById(result, 'fill');
    close(cut.planArea, 0.5);
    close(cut.cutArea, 0.5);
    close(cut.cutVolume, 0.125);
    expect(cut.fillVolume).toBe(0);
    close(fill.planArea, 0.5);
    close(fill.fillArea, 0.5);
    close(fill.fillVolume, 0.125);
    expect(fill.cutVolume).toBe(0);
    close(result.totals.overlapArea, 1);
    close(result.totals.cutVolume, 0.125);
    close(result.totals.fillVolume, 0.125);
    close(result.totals.netVolume, 0);
    close(result.totals.classifiedArea, 1);
    close(result.totals.unclassifiedArea, 0);
  });

  it('reconciles with computeVolumeQuantities', () => {
    const { totals } = computeDepthBands(base, cmp, CROSS_BANDS);
    close(totals.overlapArea, volume.overlapArea);
    close(totals.cutVolume, volume.cutVolume);
    close(totals.fillVolume, volume.fillVolume);
    close(totals.netVolume, volume.netVolume);
  });
});

describe('18U depth bands: constant-offset oracle (cmp = base + 1)', () => {
  it('puts all 10x10 area in the band containing +1 with fill = area', () => {
    const base = squareMesh(() => 0, 0, 10);
    const cmp = squareMesh(() => 1, 0, 10);
    const result = computeDepthBands(base, cmp, [
      { id: 'nearzero', lower: -0.5, upper: 0.5 },
      { id: 'fill', lower: 0.5, upper: 2 },
    ]);
    const zero = bandById(result, 'nearzero');
    const fill = bandById(result, 'fill');
    expect(zero.planArea).toBe(0);
    close(fill.planArea, 100);
    close(fill.fillVolume, 100);
    expect(fill.cutVolume).toBe(0);
    close(result.totals.fillVolume, 100);
    close(result.totals.netVolume, 100);
  });
});

describe('18U depth bands: different-topology oracle', () => {
  it('different triangulations of the same plane give the same band totals', () => {
    const base = squareMesh(() => 0);
    const cmpA = squareMesh((x) => x - 0.5, 0);
    const cmpB = squareMesh((x) => x - 0.5, 1);
    const a = computeDepthBands(base, cmpA, CROSS_BANDS);
    const b = computeDepthBands(base, cmpB, CROSS_BANDS);
    for (const key of QUANTITY_KEYS) close(b.totals[key], a.totals[key]);
    for (const id of ['cut', 'fill']) {
      close(bandById(b, id).planArea, bandById(a, id).planArea);
      close(bandById(b, id).cutVolume, bandById(a, id).cutVolume);
      close(bandById(b, id).fillVolume, bandById(a, id).fillVolume);
    }
  });
});

describe('18U depth bands: void/partial overlap', () => {
  it('smaller comparison square reconciles to computeVolumeQuantities', () => {
    const base = squareMesh(() => 0, 0, 10);
    const cmp = squareMesh(() => 2, 0, 5);
    const volume = computeVolumeQuantities(base, cmp).quantities;
    const result = computeDepthBands(base, cmp, [
      { id: 'all', lower: 0, upper: 5 },
    ]);
    close(result.totals.overlapArea, 25);
    close(result.totals.fillVolume, 50);
    expect(result.totals.cutVolume).toBe(0);
    close(result.totals.overlapArea, volume.overlapArea);
    close(result.totals.fillVolume, volume.fillVolume);
    close(result.totals.cutVolume, volume.cutVolume);
  });

  it('band gaps leave the gap area UNCLASSIFIED', () => {
    const base = squareMesh(() => 0, 0, 10);
    const cmp = squareMesh((x) => 0.2 * x - 1, 0, 10);
    const result = computeDepthBands(base, cmp, [{ id: 'cut', lower: -2, upper: 0 }]);
    close(result.totals.overlapArea, 100);
    close(result.totals.classifiedArea, bandById(result, 'cut').planArea);
    close(result.totals.unclassifiedArea, 100 - result.totals.classifiedArea);
    expect(result.totals.unclassifiedArea).toBeGreaterThan(0);
  });
});

describe('18U depth bands: full-coverage conservation', () => {
  const base = squareMesh(() => 0, 0, 10);
  const cmp = squareMesh((x) => 0.3 * x - 1.5, 0, 10);
  const bands: DepthBand[] = [
    { id: 'b-2', lower: -2, upper: -1 },
    { id: 'b-1', lower: -1, upper: 0 },
    { id: 'b0', lower: 0, upper: 1 },
    { id: 'b1', lower: 1, upper: 2 },
  ];

  it('sums band area and cut/fill to computeVolumeQuantities', () => {
    const volume = computeVolumeQuantities(base, cmp).quantities;
    const result = computeDepthBands(base, cmp, bands);
    const sum = (pick: (_band: DepthBandResult['bands'][number]) => number) =>
      result.bands.reduce((s, b) => s + pick(b), 0);
    close(sum((b) => b.planArea), result.totals.overlapArea);
    close(result.totals.unclassifiedArea, 0);
    close(sum((b) => b.cutVolume), volume.cutVolume);
    close(sum((b) => b.fillVolume), volume.fillVolume);
    close(sum((b) => b.cutArea), volume.cutArea);
    close(sum((b) => b.fillArea), volume.fillArea);
    close(result.totals.cutVolume, volume.cutVolume);
    close(result.totals.fillVolume, volume.fillVolume);
    close(result.totals.netVolume, volume.netVolume);
  });

  it('a band spanning zero splits its own cut and fill', () => {
    const result = computeDepthBands(base, cmp, [
      { id: 'neg', lower: -2, upper: -0.5 },
      { id: 'mixed', lower: -0.5, upper: 0.5 },
      { id: 'pos', lower: 0.5, upper: 2 },
    ]);
    const mixed = bandById(result, 'mixed');
    expect(mixed.cutVolume).toBeGreaterThan(0);
    expect(mixed.fillVolume).toBeGreaterThan(0);
    expect(mixed.cutArea).toBeGreaterThan(0);
    expect(mixed.fillArea).toBeGreaterThan(0);
    close(mixed.netVolume, mixed.fillVolume - mixed.cutVolume);
  });
});

describe('18U depth bands: display mode', () => {
  const base = squareMesh(() => 0, 0, 10);
  const cmp = squareMesh((x) => 0.3 * x - 1.5, 0, 10);
  const bands: DepthBand[] = [
    { id: 'cut', lower: -2, upper: 0 },
    { id: 'fill', lower: 0, upper: 2 },
  ];

  it('quantity-only mode is identical to display mode (same code path)', () => {
    const withDisplay = computeDepthBands(base, cmp, bands, { includeDisplay: true });
    const quantityOnly = computeDepthBands(base, cmp, bands, { includeDisplay: false });
    const strip = (band: DepthBandResult['bands'][number]) => {
      const { regions: _regions, ...rest } = band;
      return rest;
    };
    expect(quantityOnly.bands.map(strip)).toEqual(withDisplay.bands.map(strip));
    expect(quantityOnly.totals).toEqual(withDisplay.totals);
    expect(withDisplay.bands.some((b) => (b.regions?.length ?? 0) > 0)).toBe(true);
    expect(quantityOnly.bands.every((b) => b.regions === undefined)).toBe(true);
    expect(quantityOnly.bands.every((b) => b.regionCount > 0)).toBe(true);
  });
});

describe('18U depth bands: zero-measure and classification', () => {
  it('a near-zero band is classification-only and does not move cut/fill totals', () => {
    const base = squareMesh(() => 0, 0, 10);
    const cmp = squareMesh((x) => 0.3 * x - 1.5, 0, 10);
    const broad = computeDepthBands(base, cmp, [
      { id: 'cut', lower: -2, upper: 0 },
      { id: 'fill', lower: 0, upper: 2 },
    ]);
    const split = computeDepthBands(base, cmp, [
      { id: 'cut', lower: -2, upper: -0.1 },
      { id: 'nearzero', lower: -0.1, upper: 0.1 },
      { id: 'fill', lower: 0.1, upper: 2 },
    ]);
    close(split.totals.cutVolume, broad.totals.cutVolume);
    close(split.totals.fillVolume, broad.totals.fillVolume);
    close(split.totals.netVolume, broad.totals.netVolume);
    const volume = computeVolumeQuantities(base, cmp).quantities;
    close(split.totals.cutVolume, volume.cutVolume);
    close(split.totals.fillVolume, volume.fillVolume);
    expect(bandById(split, 'nearzero').planArea).toBeGreaterThan(0);
  });

  it('constant-zero delta stays entirely in no cut/fill', () => {
    const base = squareMesh(() => 0, 0, 10);
    const cmp = squareMesh(() => 0, 0, 10);
    const result = computeDepthBands(base, cmp, [
      { id: 'neg', lower: -1, upper: 0 },
      { id: 'pos', lower: 0, upper: 1 },
    ]);
    close(result.totals.overlapArea, 100);
    expect(result.totals.cutVolume).toBe(0);
    expect(result.totals.fillVolume).toBe(0);
  });

  it('classify determinism at the delta=0 boundary: last band claims 0', () => {
    const bands: DepthBand[] = [
      { id: 'neg', lower: -1, upper: 0 },
      { id: 'pos', lower: 0, upper: 1 },
    ];
    expect(classifyAnalysisValue(-0.5, bands)).toBe('neg');
    expect(classifyAnalysisValue(-1, bands)).toBe('neg');
    expect(classifyAnalysisValue(0, bands)).toBe('pos');
    expect(classifyAnalysisValue(1, bands)).toBe('pos');
    expect(classifyAnalysisValue(1.0001, bands)).toBeNull();
    expect(classifyAnalysisValue(-1.0001, bands)).toBeNull();
  });

  it('rejects overlapping depth bands instead of silently fixing them', () => {
    const base = squareMesh(() => 0);
    const cmp = squareMesh((x) => x - 0.5);
    expect(() =>
      computeDepthBands(base, cmp, [
        { id: 'a', lower: -1, upper: 0 },
        { id: 'b', lower: -0.5, upper: 1 },
      ]),
    ).toThrow(/invalid depth bands/);
  });
});
