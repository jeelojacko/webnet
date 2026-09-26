/** Phase 18Y engine core: exact two-surface composition behavior. */
import { describe, expect, it } from 'vitest';
import {
  composeSurfaceMeshes,
  type ComposeSourceMesh,
} from '../src/engine/cad/surfaceCompose';
import {
  createMeshView,
  locateInMesh,
  meshPlanimetricArea,
} from '../src/engine/cad/surfaces/compose/coverage';
import { buildTinTopology } from '../src/engine/cad/tin/tinTopology';

interface GridOpts {
  id: string;
  x0: number;
  y0: number;
  nx: number;
  ny: number;
  dx: number;
  dy: number;
  z: (_x: number, _y: number) => number;
  drop?: (_i: number, _j: number) => boolean;
}

/** Math-CCW two-triangles-per-cell grid mesh with derived adjacency. */
const gridMesh = (opts: GridOpts): ComposeSourceMesh => {
  const points: Array<{ x: number; y: number; z: number }> = [];
  for (let j = 0; j <= opts.ny; j += 1) {
    for (let i = 0; i <= opts.nx; i += 1) {
      const x = opts.x0 + i * opts.dx;
      const y = opts.y0 + j * opts.dy;
      points.push({ x, y, z: opts.z(x, y) });
    }
  }
  const at = (i: number, j: number): number => j * (opts.nx + 1) + i;
  const triangles: Array<[number, number, number]> = [];
  for (let j = 0; j < opts.ny; j += 1) {
    for (let i = 0; i < opts.nx; i += 1) {
      if (opts.drop?.(i, j)) continue;
      const a = at(i, j);
      const b = at(i + 1, j);
      const c = at(i, j + 1);
      const d = at(i + 1, j + 1);
      triangles.push([a, b, d], [a, d, c]);
    }
  }
  const { adjacency } = buildTinTopology(
    triangles.map(([a, b, c]) => ({ a, b, c })),
    new Map(),
  );
  return {
    surfaceId: opts.id,
    surfaceName: opts.id,
    revision: `rev:${opts.id}`,
    points,
    triangles,
    adjacency,
  };
};

const flat = (v: number) => (): number => v;

/** Elevation oracle over a composed payload (null = outside/void). */
const elevationAt = (
  vertices: number[],
  faces: number[],
  x: number,
  y: number,
): number | null => {
  const points = [];
  for (let i = 0; i < vertices.length; i += 3) {
    points.push({ x: vertices[i]!, y: vertices[i + 1]!, z: vertices[i + 2]! });
  }
  const triangles = [];
  for (let i = 0; i < faces.length; i += 3) {
    triangles.push([faces[i]!, faces[i + 1]!, faces[i + 2]!] as [number, number, number]);
  }
  return locateInMesh(createMeshView(points, triangles), x, y)?.z ?? null;
};

describe('18Y surface composition core', () => {
  it('unions disjoint meshes with no seam and no overlap', () => {
    const base = gridMesh({ id: 'B', x0: 0, y0: 0, nx: 2, ny: 2, dx: 5, dy: 5, z: flat(0) });
    const overlay = gridMesh({ id: 'O', x0: 20, y0: 0, nx: 2, ny: 2, dx: 5, dy: 5, z: flat(5) });
    const result = composeSurfaceMeshes(base, overlay);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics.overlapArea).toBe(0);
    expect(result.diagnostics.seamLength).toBe(0);
    expect(result.diagnostics.resultArea).toBeCloseTo(200, 9);
    expect(result.diagnostics.overlayArea).toBeCloseTo(100, 9);
    expect(elevationAt(result.vertices, result.faces, 2, 2)).toBeCloseTo(0, 9);
    expect(elevationAt(result.vertices, result.faces, 22, 2)).toBeCloseTo(5, 9);
    expect(elevationAt(result.vertices, result.faces, 15, 2)).toBeNull();
  });

  it('lets an identical-domain overlay win with a vacuous seam gate', () => {
    const base = gridMesh({ id: 'B', x0: 0, y0: 0, nx: 2, ny: 2, dx: 5, dy: 5, z: flat(0) });
    const overlay = gridMesh({ id: 'O', x0: 0, y0: 0, nx: 2, ny: 2, dx: 5, dy: 5, z: flat(0) });
    const result = composeSurfaceMeshes(base, overlay);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics.resultArea).toBeCloseTo(100, 9);
    expect(result.diagnostics.maxSeamMismatch).toBe(0);
    expect(elevationAt(result.vertices, result.faces, 5, 5)).toBeCloseTo(0, 9);
  });

  it('passes a coplanar island inside the base', () => {
    const base = gridMesh({ id: 'B', x0: 0, y0: 0, nx: 4, ny: 4, dx: 5, dy: 5, z: flat(0) });
    const overlay = gridMesh({ id: 'O', x0: 5, y0: 5, nx: 2, ny: 2, dx: 5, dy: 5, z: flat(0) });
    const result = composeSurfaceMeshes(base, overlay);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics.resultArea).toBeCloseTo(400, 9);
    expect(result.diagnostics.overlapArea).toBeCloseTo(100, 9);
    expect(elevationAt(result.vertices, result.faces, 10, 10)).toBeCloseTo(0, 9);
  });

  it('blocks a raised island with a seam-mismatch diagnostic', () => {
    const base = gridMesh({ id: 'B', x0: 0, y0: 0, nx: 4, ny: 4, dx: 5, dy: 5, z: flat(0) });
    const overlay = gridMesh({ id: 'O', x0: 5, y0: 5, nx: 2, ny: 2, dx: 5, dy: 5, z: flat(1) });
    const result = composeSurfaceMeshes(base, overlay);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('SURFACE_COMPOSE_SEAM_Z_MISMATCH');
    if (result.reason !== 'SURFACE_COMPOSE_SEAM_Z_MISMATCH') return;
    expect(result.maxMismatch).toBeCloseTo(1, 12);
    expect(result.baseZ).toBeCloseTo(0, 12);
    expect(result.overlayZ).toBeCloseTo(1, 12);
  });

  it('exposes the base through an overlay void', () => {
    const base = gridMesh({ id: 'B', x0: 0, y0: 0, nx: 3, ny: 3, dx: 10, dy: 10, z: flat(0) });
    const overlay = gridMesh({
      id: 'O', x0: 0, y0: 0, nx: 3, ny: 3, dx: 10, dy: 10, z: flat(0),
      drop: (i, j) => i === 1 && j === 1,
    });
    const result = composeSurfaceMeshes(base, overlay);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics.resultArea).toBeCloseTo(900, 9);
    // Void interior belongs to the base, at base elevation.
    expect(elevationAt(result.vertices, result.faces, 15, 15)).toBeCloseTo(0, 9);
  });

  it('fills a base void with a coplanar overlay', () => {
    const base = gridMesh({
      id: 'B', x0: 0, y0: 0, nx: 3, ny: 3, dx: 10, dy: 10, z: flat(0),
      drop: (i, j) => i === 1 && j === 1,
    });
    const overlay = gridMesh({ id: 'O', x0: 10, y0: 10, nx: 1, ny: 1, dx: 10, dy: 10, z: flat(0) });
    const result = composeSurfaceMeshes(base, overlay);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics.resultArea).toBeCloseTo(900, 9);
    expect(elevationAt(result.vertices, result.faces, 15, 15)).toBeCloseTo(0, 9);
  });

  it('extends a coplanar overlay outside the base domain', () => {
    const base = gridMesh({ id: 'B', x0: 0, y0: 0, nx: 2, ny: 2, dx: 5, dy: 5, z: flat(0) });
    const overlay = gridMesh({ id: 'O', x0: 5, y0: 0, nx: 2, ny: 2, dx: 5, dy: 5, z: flat(0) });
    const result = composeSurfaceMeshes(base, overlay);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics.resultArea).toBeCloseTo(150, 9);
    expect(result.diagnostics.overlapArea).toBeCloseTo(50, 9);
    expect(elevationAt(result.vertices, result.faces, 12, 5)).toBeCloseTo(0, 9);
  });

  it('rejects same-source inputs without triangulating', () => {
    const base = gridMesh({ id: 'S', x0: 0, y0: 0, nx: 1, ny: 1, dx: 10, dy: 10, z: flat(0) });
    const result = composeSurfaceMeshes(base, { ...base });
    expect(result).toEqual({ ok: false, reason: 'SURFACE_COMPOSE_SAME_SOURCE' });
  });

  it('holds area identities and input-order determinism', () => {
    const base = gridMesh({ id: 'B', x0: 0, y0: 0, nx: 4, ny: 4, dx: 5, dy: 5, z: flat(0) });
    const overlay = gridMesh({ id: 'O', x0: 5, y0: 5, nx: 2, ny: 2, dx: 5, dy: 5, z: flat(0) });
    const first = composeSurfaceMeshes(base, overlay);
    const second = composeSurfaceMeshes(base, overlay);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    const d = first.diagnostics;
    expect(d.resultArea).toBeCloseTo(
      meshPlanimetricArea(createMeshView(base.points, base.triangles)) +
      meshPlanimetricArea(createMeshView(overlay.points, overlay.triangles)) -
      d.overlapArea,
      9,
    );
    expect(d.baseOnlyArea).toBeCloseTo(d.resultArea - d.overlayArea, 9);
    expect(first.digest).toBe(second.digest);
    expect(first.vertices).toEqual(second.vertices);
    expect(first.faces).toEqual(second.faces);
  });
});
