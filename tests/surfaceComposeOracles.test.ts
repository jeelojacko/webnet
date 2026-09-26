/** Phase 18Y oracles: ties, touches, ridges, large coordinates, provenance. */
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
import {
  explicitTinTopologyDigest,
  normalizeTinProvenance,
  tinProvenanceKind,
  tinProvenanceRevisionPart,
} from '../src/engine/cad/cadImportedTin';
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

const elevationAt = (vertices: number[], faces: number[], x: number, y: number): number | null => {
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

const slope = (x: number): number => 2 * x + 10;

describe('18Y tie-in plane oracles', () => {
  it('passes a sloped tie with exact inside/outside/seam probes', () => {
    const base = gridMesh({ id: 'B', x0: 0, y0: 0, nx: 4, ny: 4, dx: 5, dy: 5, z: (x) => slope(x) });
    const overlay = gridMesh({ id: 'O', x0: 5, y0: 5, nx: 2, ny: 2, dx: 5, dy: 5, z: (x) => slope(x) });
    const result = composeSurfaceMeshes(base, overlay);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Inside the overlay, outside it, and on the seam: all on the plane.
    expect(elevationAt(result.vertices, result.faces, 10, 10)).toBeCloseTo(slope(10), 9);
    expect(elevationAt(result.vertices, result.faces, 1, 1)).toBeCloseTo(slope(1), 9);
    expect(elevationAt(result.vertices, result.faces, 5, 7)).toBeCloseTo(slope(5), 9);
    expect(result.diagnostics.seamLength).toBeCloseTo(40, 9);
  });

  it('blocks a sloped tie shifted by half a metre', () => {
    const base = gridMesh({ id: 'B', x0: 0, y0: 0, nx: 4, ny: 4, dx: 5, dy: 5, z: (x) => slope(x) });
    const overlay = gridMesh({ id: 'O', x0: 5, y0: 5, nx: 2, ny: 2, dx: 5, dy: 5, z: (x) => slope(x) + 0.5 });
    const result = composeSurfaceMeshes(base, overlay);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('SURFACE_COMPOSE_SEAM_Z_MISMATCH');
    if (result.reason !== 'SURFACE_COMPOSE_SEAM_Z_MISMATCH') return;
    expect(result.maxMismatch).toBeCloseTo(0.5, 12);
  });
});

describe('18Y domain-shape oracles', () => {
  it('handles a concave overlay notch (base shows through)', () => {
    const base = gridMesh({ id: 'B', x0: 0, y0: 0, nx: 3, ny: 3, dx: 10, dy: 10, z: () => 3 });
    const overlay = gridMesh({
      id: 'O', x0: 0, y0: 0, nx: 3, ny: 3, dx: 10, dy: 10, z: () => 3,
      drop: (i, j) => i === 2 && j === 2,
    });
    const result = composeSurfaceMeshes(base, overlay);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics.resultArea).toBeCloseTo(900, 9);
    expect(elevationAt(result.vertices, result.faces, 25, 25)).toBeCloseTo(3, 9);
  });

  it('composes a multi-island overlay in one pass', () => {
    const base = gridMesh({ id: 'B', x0: 0, y0: 0, nx: 6, ny: 2, dx: 5, dy: 5, z: () => 0 });
    const west = gridMesh({ id: 'W', x0: 2, y0: 2, nx: 1, ny: 1, dx: 4, dy: 4, z: () => 0 });
    const east = gridMesh({ id: 'E', x0: 22, y0: 2, nx: 1, ny: 1, dx: 4, dy: 4, z: () => 0 });
    const both = composeSurfaceMeshes(base, west);
    expect(both.ok).toBe(true);
    if (!both.ok) return;
    // Re-overlay: compose the first result against the second island via
    // payload meshes (proves output feeds back as valid input).
    const points = [];
    for (let i = 0; i < both.vertices.length; i += 3) {
      points.push({ x: both.vertices[i]!, y: both.vertices[i + 1]!, z: both.vertices[i + 2]! });
    }
    const triangles = [];
    for (let i = 0; i < both.faces.length; i += 3) {
      triangles.push([both.faces[i]!, both.faces[i + 1]!, both.faces[i + 2]!] as [number, number, number]);
    }
    const { adjacency } = buildTinTopology(
      triangles.map(([a, b, c]) => ({ a, b, c })),
      new Map(),
    );
    const second = composeSurfaceMeshes(
      { surfaceId: 'B+W', surfaceName: 'B+W', revision: both.digest, points, triangles, adjacency },
      east,
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.diagnostics.resultArea).toBeCloseTo(300, 9);
  });
});

describe('18Y ridge + touch oracles', () => {
  const ridge = (x: number): number => Math.abs(x - 10);

  it('preserves a ridge exactly on both sides of a coplanar overlay', () => {
    const base = gridMesh({ id: 'B', x0: 0, y0: 0, nx: 4, ny: 2, dx: 5, dy: 5, z: (x) => ridge(x) });
    const overlay = gridMesh({ id: 'O', x0: 5, y0: 0, nx: 2, ny: 2, dx: 5, dy: 5, z: (x) => ridge(x) });
    const result = composeSurfaceMeshes(base, overlay);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // No raster, no blend: ridge line and flanks evaluate exactly.
    for (const [x, y] of [[10, 5], [7.5, 2.5], [12.5, 7.5], [2, 8], [18, 1]] as const) {
      expect(elevationAt(result.vertices, result.faces, x, y)).toBeCloseTo(ridge(x), 9);
    }
  });

  it('passes a coplanar edge touch and blocks a raised one', () => {
    const base = gridMesh({ id: 'B', x0: 0, y0: 0, nx: 2, ny: 2, dx: 5, dy: 5, z: () => 0 });
    const flat2 = gridMesh({ id: 'O', x0: 10, y0: 0, nx: 2, ny: 2, dx: 5, dy: 5, z: () => 0 });
    const tied = composeSurfaceMeshes(base, flat2);
    expect(tied.ok).toBe(true);
    if (!tied.ok) return;
    expect(tied.diagnostics.resultArea).toBeCloseTo(200, 9);
    const raised = gridMesh({ id: 'O2', x0: 10, y0: 0, nx: 2, ny: 2, dx: 5, dy: 5, z: () => 2 });
    const blocked = composeSurfaceMeshes(base, raised);
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.reason).toBe('SURFACE_COMPOSE_SEAM_Z_MISMATCH');
  });

  it('evaluates exactly at off-vertex facet interiors (no-blend assertion)', () => {
    const base = gridMesh({ id: 'B', x0: 0, y0: 0, nx: 2, ny: 2, dx: 10, dy: 10, z: (x, y) => x + 2 * y });
    const overlay = gridMesh({ id: 'O', x0: 5, y0: 5, nx: 1, ny: 1, dx: 10, dy: 10, z: (x, y) => x + 2 * y });
    const result = composeSurfaceMeshes(base, overlay);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Facet-interior probes (never mesh vertices): any raster/blend would err here.
    for (const [x, y] of [[7.3, 11.7], [12.9, 6.1], [3.7, 3.3], [17.1, 17.7]] as const) {
      expect(elevationAt(result.vertices, result.faces, x, y)).toBeCloseTo(x + 2 * y, 9);
    }
  });
});

describe('18Y large-coordinate equivalence', () => {
  it('matches small-coordinate behavior at E~2e6/N~7e6', () => {
    const EX = 2_000_000;
    const NY = 7_000_000;
    const smallBase = gridMesh({ id: 'B', x0: 0, y0: 0, nx: 4, ny: 4, dx: 5, dy: 5, z: (x) => slope(x) });
    const smallOver = gridMesh({ id: 'O', x0: 5, y0: 5, nx: 2, ny: 2, dx: 5, dy: 5, z: (x) => slope(x) + 0.5 });
    const small = composeSurfaceMeshes(smallBase, smallOver);
    const bigBase = gridMesh({ id: 'B', x0: EX, y0: NY, nx: 4, ny: 4, dx: 5, dy: 5, z: (x) => slope(x - EX) });
    const bigOver = gridMesh({ id: 'O', x0: EX + 5, y0: NY + 5, nx: 2, ny: 2, dx: 5, dy: 5, z: (x) => slope(x - EX) + 0.5 });
    const big = composeSurfaceMeshes(bigBase, bigOver);
    expect(small.ok).toBe(false);
    expect(big.ok).toBe(false);
    if (small.ok || big.ok) return;
    expect(small.reason).toBe('SURFACE_COMPOSE_SEAM_Z_MISMATCH');
    expect(big.reason).toBe('SURFACE_COMPOSE_SEAM_Z_MISMATCH');
    if (small.reason !== 'SURFACE_COMPOSE_SEAM_Z_MISMATCH' || big.reason !== 'SURFACE_COMPOSE_SEAM_Z_MISMATCH') return;
    expect(big.maxMismatch).toBeCloseTo(small.maxMismatch, 12);
    // Passing case agrees on elevations too.
    const bigTied = composeSurfaceMeshes(
      bigBase,
      gridMesh({ id: 'O2', x0: EX + 5, y0: NY + 5, nx: 2, ny: 2, dx: 5, dy: 5, z: (x) => slope(x - EX) }),
    );
    expect(bigTied.ok).toBe(true);
    if (!bigTied.ok) return;
    expect(elevationAt(bigTied.vertices, bigTied.faces, EX + 10, NY + 10)).toBeCloseTo(slope(10), 6);
  });
});

describe('18Y overlay-owned area identity', () => {
  it('owns exactly the overlay domain area', () => {
    const base = gridMesh({ id: 'B', x0: 0, y0: 0, nx: 4, ny: 4, dx: 5, dy: 5, z: () => 1 });
    const overlay = gridMesh({ id: 'O', x0: 5, y0: 5, nx: 2, ny: 2, dx: 5, dy: 5, z: () => 1 });
    const result = composeSurfaceMeshes(base, overlay);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const expected = meshPlanimetricArea(createMeshView(overlay.points, overlay.triangles));
    expect(result.diagnostics.overlayArea).toBeCloseTo(expected, 12);
    expect(result.diagnostics.baseOnlyArea).toBeCloseTo(result.diagnostics.resultArea - expected, 9);
  });
});

describe('18Y compose provenance', () => {
  it('round-trips kind, normalization, and the revision namespace', () => {
    const base = gridMesh({ id: 'B', x0: 0, y0: 0, nx: 1, ny: 1, dx: 10, dy: 10, z: () => 0 });
    const overlay = gridMesh({ id: 'O', x0: 0, y0: 0, nx: 1, ny: 1, dx: 10, dy: 10, z: () => 0 });
    const result = composeSurfaceMeshes(base, overlay);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.provenance.kind).toBe('webnet-compose');
    expect(result.provenance.policy).toBe('overlay-coverage-wins');
    expect(tinProvenanceKind(result.provenance)).toBe('webnet-compose');
    const normalized = normalizeTinProvenance(result.provenance);
    expect(normalized.kind).toBe('webnet-compose');
    expect(tinProvenanceRevisionPart(result.provenance)).toBe(
      `webnet-compose|B|rev:B|O|rev:O|${result.digest}`,
    );
    expect(result.digest).toBe(
      explicitTinTopologyDigest({ vertices: result.vertices, faces: result.faces, provenance: result.provenance }),
    );
    // 18X/18L readers still compile and behave: bake + landxml unchanged.
    expect(tinProvenanceRevisionPart({ format: 'LandXML', fileName: 'a.xml', surfaceName: 'S' })).toBe(
      'LandXML|a.xml|S|',
    );
  });
});
