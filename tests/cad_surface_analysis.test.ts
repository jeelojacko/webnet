import { describe, expect, it } from 'vitest';

import {
  downslopeAspectDegOf,
  planeGradient,
  querySurfaceSlopeAt,
  slopeAngleDegOf,
  slopePercentOf,
} from '../src/engine/cad/surfaceAnalysis';
import { queryMeshSlope } from '../src/engine/cad/cadSurfaceView';
import type { CachedSurfaceMesh } from '../src/engine/cad/cadSurfaceCache';
import type { CadSurfaceSourcePoint } from '../src/engine/cad/cadSurfaces';

const pt = (x: number, y: number, z: number, id = 'p'): CadSurfaceSourcePoint => ({
  entityId: id,
  x,
  y,
  z,
});

const meshOf = (
  points: CadSurfaceSourcePoint[],
  triangles: Array<[number, number, number]>,
): CachedSurfaceMesh => ({
  revision: 'test',
  points,
  triangles,
  stats: {
    resolvedPointCount: points.length,
    usedPointCount: points.length,
    skippedMissingZCount: 0,
    triangleCount: triangles.length,
    minZ: Math.min(...points.map((p) => p.z)),
    maxZ: Math.max(...points.map((p) => p.z)),
    minX: 0,
    minY: 0,
    maxX: 0,
    maxY: 0,
    planimetricArea: 0,
    surface3DArea: 0,
    meanElevation: null,
    minFaceSlopeRatio: null,
    maxFaceSlopeRatio: null,
    meanFaceSlopeRatio: null,
  },
  grid: { minX: 0, minY: 0, cellSize: 1, cells: new Map() },
  adjacency: [],
  edgeKinds: [],
});

describe('surface slope/aspect oracles', () => {
  it('flat plane: 0%, 0°, null aspect (never 0-by-default)', () => {
    const points = [pt(0, 0, 5, 'a'), pt(10, 0, 5, 'b'), pt(0, 10, 5, 'c')];
    const gradient = planeGradient(points[0]!, points[1]!, points[2]!)!;
    expect(slopePercentOf(gradient)).toBe(0);
    expect(slopeAngleDegOf(gradient)).toBe(0);
    expect(downslopeAspectDegOf(gradient)).toBeNull();
    const hit = querySurfaceSlopeAt(points, [[0, 1, 2]], 1, 1)!;
    expect(hit.slopePercent).toBe(0);
    expect(hit.aspectDeg).toBeNull();
    expect(hit.elevation).toBeCloseTo(5, 9);
    expect(hit.faceNote).toBeNull();
  });

  it.each([
    { name: 'north', z: (_x: number, y: number) => -y, aspect: 0 },
    { name: 'east', z: (x: number, _y: number) => -x, aspect: 90 },
    { name: 'south', z: (_x: number, y: number) => y, aspect: 180 },
    { name: 'west', z: (x: number, _y: number) => x, aspect: 270 },
  ])('$name downhill plane: 100%, 45°, azimuth $aspect', ({ z, aspect }) => {
    const points = [pt(0, 0, z(0, 0), 'a'), pt(10, 0, z(10, 0), 'b'), pt(0, 10, z(0, 10), 'c')];
    const hit = querySurfaceSlopeAt(points, [[0, 1, 2]], 1, 1)!;
    expect(hit.slopePercent).toBeCloseTo(100, 9);
    expect(hit.slopeAngleDeg).toBeCloseTo(45, 9);
    expect(hit.aspectDeg).toBeCloseTo(aspect, 9);
  });

  it('45° diagonal (NE downhill): √2 ratio, 54.74°, azimuth 45', () => {
    const points = [pt(0, 0, 0, 'a'), pt(10, 0, -10, 'b'), pt(0, 10, -10, 'c')];
    const hit = querySurfaceSlopeAt(points, [[0, 1, 2]], 1, 1)!;
    expect(hit.slopePercent).toBeCloseTo(100 * Math.SQRT2, 9);
    expect(hit.slopeAngleDeg).toBeCloseTo((Math.atan(Math.SQRT2) * 180) / Math.PI, 9);
    expect(hit.aspectDeg).toBeCloseTo(45, 9);
  });

  it('known 12% grade reports exact percent and angle', () => {
    const points = [pt(0, 0, 0, 'a'), pt(100, 0, 12, 'b'), pt(0, 100, 0, 'c')];
    const hit = querySurfaceSlopeAt(points, [[0, 1, 2]], 10, 10)!;
    expect(hit.slopePercent).toBeCloseTo(12, 9);
    expect(hit.slopeAngleDeg).toBeCloseTo((Math.atan(0.12) * 180) / Math.PI, 9);
    expect(hit.aspectDeg).toBeCloseTo(270, 9);
  });

  it('edge ambiguity discloses deterministic primary face + range', () => {
    // Ridge quad split on the p0→p2 diagonal; (5,5) sits exactly on it.
    const points = [
      pt(0, 0, 0, 'p0'),
      pt(10, 0, 0, 'p1'),
      pt(10, 10, 10, 'p2'),
      pt(0, 10, 0, 'p3'),
    ];
    const hit = querySurfaceSlopeAt(points, [[0, 1, 2], [0, 2, 3]], 5, 5)!;
    expect(hit.faceCount).toBe(2);
    expect(hit.faceIndex).toBe(0);
    expect(hit.elevation).toBeCloseTo(5, 9);
    expect(hit.slopePercent).toBeCloseTo(100, 9);
    expect(hit.faceNote).toContain('2 faces');
    expect(hit.maxSlopePercent).toBeGreaterThanOrEqual(hit.minSlopePercent);
  });

  it('coplanar neighbors stay silent on shared edges', () => {
    const points = [
      pt(0, 0, 7, 'p0'),
      pt(10, 0, 7, 'p1'),
      pt(10, 10, 7, 'p2'),
      pt(0, 10, 7, 'p3'),
    ];
    const hit = querySurfaceSlopeAt(points, [[0, 1, 2], [0, 2, 3]], 5, 5)!;
    expect(hit.faceCount).toBe(2);
    expect(hit.faceNote).toBeNull();
    expect(hit.slopePercent).toBe(0);
  });

  it('void/outside fail-closed: null, never a stale value', () => {
    const points = [pt(0, 0, 0, 'a'), pt(10, 0, 0, 'b'), pt(0, 10, 0, 'c')];
    expect(querySurfaceSlopeAt(points, [[0, 1, 2]], 50, 50)).toBeNull();
    expect(querySurfaceSlopeAt(points, [], 1, 1)).toBeNull();
    const mesh = meshOf(points, [[0, 1, 2]]);
    expect(queryMeshSlope(mesh, 50, 50)).toBeNull();
    const inside = queryMeshSlope(mesh, 1, 1)!;
    expect(inside.elevation).toBeCloseTo(0, 9);
    expect(inside.slopePercent).toBe(0);
    expect(inside.aspectDeg).toBeNull();
  });
});
