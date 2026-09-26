/**
 * Phase 18Z — exact composition fast paths: full-overlay + strict-disjoint.
 *
 * Asserts the fast paths fire only on proven shapes, match the canonical
 * overlay / concatenated topology, and that every other shape still matches
 * the frozen 18Y reference byte for byte.
 */
import { describe, expect, it } from 'vitest';
import {
  composeSurfaceMeshes,
  type ComposeSourceMesh,
} from '../src/engine/cad/surfaceCompose';
import { composeSurfaceMeshesReference } from '../src/engine/cad/surfaces/compose/composeReference18y';
import {
  extractRetainedComponents,
  tryFullOverlayFastPath,
  tryStrictDisjointFastPath,
} from '../src/engine/cad/surfaces/compose/composeFastPaths';
import { createMeshView, meshPlanimetricArea } from '../src/engine/cad/surfaces/compose/coverage';
import { canonicalizeBakedTin } from '../src/engine/cad/cadExplicitBake';
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
  flip?: boolean;
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
      const c = at(i + 1, j + 1);
      const d = at(i, j + 1);
      if (opts.flip) triangles.push([a, b, d], [b, c, d]);
      else triangles.push([a, b, c], [a, c, d]);
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

/** Canonical overlay topology with faces in deterministic sorted order. */
const canonicalOverlay = (mesh: ComposeSourceMesh): { vertices: number[]; faces: number[] } => {
  const vertices: number[] = [];
  for (const p of mesh.points) vertices.push(p.x, p.y, p.z);
  const faces = mesh.triangles
    .map((t): [number, number, number] => [t[0], t[1], t[2]])
    .sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]);
  const flat: number[] = [];
  for (const f of faces) flat.push(f[0], f[1], f[2]);
  return canonicalizeBakedTin(vertices, flat);
};

/** Order/rotation-independent geometry signature: sorted "x,y|x,y|x,y". */
const faceSignature = (vertices: number[], faces: number[]): string[] => {
  const out: string[] = [];
  for (let i = 0; i < faces.length; i += 3) {
    out.push([faces[i]!, faces[i + 1]!, faces[i + 2]!]
      .map((v) => `${vertices[v * 3]!},${vertices[v * 3 + 1]!}`)
      .sort()
      .join('|'));
  }
  return out.sort();
};

const fastFull = (base: ComposeSourceMesh, overlay: ComposeSourceMesh) =>
  tryFullOverlayFastPath(
    base,
    overlay,
    createMeshView(base.points, base.triangles),
    createMeshView(overlay.points, overlay.triangles),
  );

describe('18Z full-overlay fast path', () => {
  it('accepts a covering overlay with different topology and elevation', () => {
    const base = gridMesh({ id: 'B', x0: 0, y0: 0, nx: 1, ny: 1, dx: 5, dy: 5, z: () => 0 });
    const overlay = gridMesh({ id: 'O', x0: 0, y0: 0, nx: 1, ny: 1, dx: 10, dy: 10, z: () => 7 });
    const fast = fastFull(base, overlay);
    expect(fast).not.toBeNull();
    if (!fast) return;
    const expected = canonicalOverlay(overlay);
    expect(fast.vertices).toEqual(expected.vertices);
    expect(fast.faces).toEqual(expected.faces);
    expect(fast.diagnostics.baseOnlyArea).toBe(0);
    expect(fast.diagnostics.overlapArea).toBeCloseTo(25, 12);
    expect(fast.diagnostics.resultArea).toBeCloseTo(100, 12);
    expect(fast.diagnostics.seamLength).toBe(0);
    expect(fast.diagnostics.maxSeamMismatch).toBe(0);
    expect(fast.provenance.kind).toBe('webnet-compose');
  });

  it('dispatches the canonical overlay through composeSurfaceMeshes', () => {
    const base = gridMesh({ id: 'B', x0: 0, y0: 0, nx: 1, ny: 1, dx: 5, dy: 5, z: () => 0 });
    const overlay = gridMesh({ id: 'O', x0: 0, y0: 0, nx: 1, ny: 1, dx: 10, dy: 10, z: () => 7 });
    const prod = composeSurfaceMeshes(base, overlay);
    expect(prod.ok).toBe(true);
    if (!prod.ok) return;
    const expected = canonicalOverlay(overlay);
    expect(prod.vertices).toEqual(expected.vertices);
    expect(prod.faces).toEqual(expected.faces);
    expect(prod.diagnostics.seamLength).toBe(0);
    expect(prod.diagnostics.baseOnlyArea).toBe(0);
  });
});

describe('18Z full-coverage-with-void rejection', () => {
  it('rejects a covering overlay that leaves a void over the base', () => {
    const base = gridMesh({ id: 'B', x0: 0, y0: 0, nx: 3, ny: 3, dx: 10, dy: 10, z: () => 3 });
    const overlay = gridMesh({
      id: 'O', x0: 0, y0: 0, nx: 3, ny: 3, dx: 10, dy: 10, z: () => 3,
      drop: (i, j) => i === 1 && j === 1,
    });
    expect(fastFull(base, overlay)).toBeNull();
    const prod = composeSurfaceMeshes(base, overlay);
    const ref = composeSurfaceMeshesReference(base, overlay);
    expect(prod).toEqual(ref);
    expect(prod.ok).toBe(true);
    if (!prod.ok) return;
    // Void exposes the base → normal path retains the full area.
    expect(prod.diagnostics.resultArea).toBeCloseTo(900, 9);
    expect(prod.diagnostics.baseOnlyArea).toBeCloseTo(100, 9);
  });
});

describe('18Z strict-disjoint fast path', () => {
  const base = gridMesh({ id: 'B', x0: 0, y0: 0, nx: 2, ny: 2, dx: 5, dy: 5, z: () => 0 });
  const overlay = gridMesh({ id: 'O', x0: 20, y0: 0, nx: 2, ny: 2, dx: 5, dy: 5, z: () => 5 });

  it('accepts separated meshes with summed areas and no bridge', () => {
    const fast = tryStrictDisjointFastPath(base, overlay);
    expect(fast).not.toBeNull();
    if (!fast) return;
    expect(fast.diagnostics.overlapArea).toBe(0);
    expect(fast.diagnostics.seamLength).toBe(0);
    expect(fast.diagnostics.resultArea).toBeCloseTo(200, 9);
    expect(fast.diagnostics.baseOnlyArea).toBeCloseTo(100, 9);
    expect(fast.diagnostics.outputTriangleCount).toBe(
      base.triangles.length + overlay.triangles.length,
    );
  });

  it('accepts overlapping AABBs whose geometry is strictly disjoint', () => {
    // L-shaped base (top-right quadrant dropped) and a corner block beyond
    // the notch: AABBs overlap at [12,20]^2, geometry has a real gap.
    const lBase = gridMesh({
      id: 'B', x0: 0, y0: 0, nx: 4, ny: 4, dx: 5, dy: 5, z: () => 0,
      drop: (i, j) => i >= 2 && j >= 2,
    });
    const corner = gridMesh({ id: 'O', x0: 12, y0: 12, nx: 2, ny: 2, dx: 5, dy: 5, z: () => 5 });
    const fast = tryStrictDisjointFastPath(lBase, corner);
    expect(fast).not.toBeNull();
    if (!fast) return;
    expect(fast.diagnostics.resultArea).toBeCloseTo(300 + 100, 9);
    expect(fast.diagnostics.overlapArea).toBe(0);
    const prod = composeSurfaceMeshes(lBase, corner);
    const ref = composeSurfaceMeshesReference(lBase, corner);
    expect(prod.ok && ref.ok).toBe(true);
    if (!prod.ok || !ref.ok) return;
    // Same retained domain and area; the reference may split overlay facets
    // with base's stray (unretained) vertices, so counts are not the oracle.
    expect(prod.diagnostics.resultArea).toBe(ref.diagnostics.resultArea);
    expect(prod.diagnostics.overlapArea).toBe(ref.diagnostics.overlapArea);
    expect(prod.diagnostics.seamLength).toBe(0);
    expect(prod.diagnostics.baseOnlyArea).toBe(300);
  });

  it('matches the frozen 18Y reference geometry', () => {
    const prod = composeSurfaceMeshes(base, overlay);
    const ref = composeSurfaceMeshesReference(base, overlay);
    expect(prod.ok && ref.ok).toBe(true);
    if (!prod.ok || !ref.ok) return;
    expect(prod.vertices).toEqual(ref.vertices);
    expect(prod.diagnostics).toEqual(ref.diagnostics);
    expect(faceSignature(prod.vertices, prod.faces)).toEqual(faceSignature(ref.vertices, ref.faces));
  });

  it('retains both input triangulations', () => {
    const prod = composeSurfaceMeshes(base, overlay);
    expect(prod.ok).toBe(true);
    if (!prod.ok) return;
    // Triangle signature = sorted "x,y|x,y|x,y" per face, order-independent.
    const signature = (
      points: ReadonlyArray<{ x: number; y: number }>,
      faces: ReadonlyArray<readonly [number, number, number]>,
    ): string[] => {
      const out = faces.map((face) => face
        .map((v) => `${points[v]!.x},${points[v]!.y}`)
        .sort()
        .join('|'));
      return out.sort();
    };
    const composedPoints: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < prod.vertices.length; i += 3) {
      composedPoints.push({ x: prod.vertices[i]!, y: prod.vertices[i + 1]! });
    }
    const composedFaces: Array<readonly [number, number, number]> = [];
    for (let i = 0; i < prod.faces.length; i += 3) {
      composedFaces.push([prod.faces[i]!, prod.faces[i + 1]!, prod.faces[i + 2]!]);
    }
    expect(signature(composedPoints, composedFaces)).toEqual([
      ...signature(base.points, base.triangles),
      ...signature(overlay.points, overlay.triangles),
    ].sort());
  });
});

describe('18Z edge/vertex touch falls back to the normal path', () => {
  it('rejects the disjoint helper on a shared edge and keeps the seam', () => {
    const base = gridMesh({ id: 'B', x0: 0, y0: 0, nx: 2, ny: 2, dx: 5, dy: 5, z: () => 0 });
    const overlay = gridMesh({ id: 'O', x0: 10, y0: 0, nx: 2, ny: 2, dx: 5, dy: 5, z: () => 0 });
    expect(tryStrictDisjointFastPath(base, overlay)).toBeNull();
    const prod = composeSurfaceMeshes(base, overlay);
    const ref = composeSurfaceMeshesReference(base, overlay);
    expect(prod).toEqual(ref);
    expect(prod.ok).toBe(true);
    if (!prod.ok) return;
    // A touch is a seam: the disjoint fast path would have reported zero.
    expect(prod.diagnostics.seamLength).toBeCloseTo(10, 9);
  });

  it('rejects the disjoint helper on a shared vertex', () => {
    const base = gridMesh({ id: 'B', x0: 0, y0: 0, nx: 1, ny: 1, dx: 10, dy: 10, z: () => 0 });
    const overlay = gridMesh({ id: 'O', x0: 10, y0: 10, nx: 1, ny: 1, dx: 10, dy: 10, z: () => 0 });
    expect(tryStrictDisjointFastPath(base, overlay)).toBeNull();
  });
});

describe('18Z input-order determinism', () => {
  it('is invariant to triangle permutation for both fast paths', () => {
    const base = gridMesh({ id: 'B', x0: 0, y0: 0, nx: 2, ny: 2, dx: 5, dy: 5, z: () => 0 });
    const overlay = gridMesh({ id: 'O', x0: 20, y0: 0, nx: 2, ny: 2, dx: 5, dy: 5, z: () => 5 });
    const shuffled = { ...overlay, triangles: [...overlay.triangles].reverse() };
    const a = composeSurfaceMeshes(base, overlay);
    const b = composeSurfaceMeshes(base, shuffled);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(b.digest).toBe(a.digest);
    expect(b.vertices).toEqual(a.vertices);
    expect(b.faces).toEqual(a.faces);

    const overlayCover = gridMesh({ id: 'O2', x0: 0, y0: 0, nx: 1, ny: 1, dx: 10, dy: 10, z: () => 7 });
    const shuffledCover = { ...overlayCover, triangles: [...overlayCover.triangles].reverse() };
    const c = composeSurfaceMeshes(base, overlayCover);
    const d = composeSurfaceMeshes(base, shuffledCover);
    expect(c.ok && d.ok).toBe(true);
    if (!c.ok || !d.ok) return;
    expect(d.digest).toBe(c.digest);
  });
});

describe('18Z component extraction', () => {
  it('labels disjoint islands with exact bbox and area', () => {
    const west = gridMesh({ id: 'W', x0: 0, y0: 0, nx: 1, ny: 1, dx: 10, dy: 10, z: () => 0 });
    const east = gridMesh({ id: 'E', x0: 100, y0: 0, nx: 1, ny: 1, dx: 10, dy: 10, z: () => 0 });
    const offset = west.points.length;
    const points = [...west.points, ...east.points];
    const triangles: Array<[number, number, number]> = [
      ...west.triangles.map((t): [number, number, number] => [t[0], t[1], t[2]]),
      ...east.triangles.map((t): [number, number, number] => [t[0] + offset, t[1] + offset, t[2] + offset]),
    ];
    const { adjacency } = buildTinTopology(
      triangles.map(([a, b, c]) => ({ a, b, c })),
      new Map(),
    );
    const components = extractRetainedComponents(points, triangles, adjacency);
    expect(components).toHaveLength(2);
    expect(components[0]!.triangles).toEqual([0, 1]);
    expect(components[1]!.triangles).toEqual([2, 3]);
    expect(components[0]!.bbox).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
    expect(components[1]!.bbox).toEqual({ minX: 100, minY: 0, maxX: 110, maxY: 10 });
    expect(components[0]!.area).toBeCloseTo(100, 12);
    expect(components[1]!.area).toBeCloseTo(100, 12);
    // Sum of component areas equals the full planimetric area.
    expect(components.reduce((sum, c) => sum + c.area, 0)).toBeCloseTo(
      meshPlanimetricArea(createMeshView(points, triangles)),
      9,
    );
  });
});

describe('18Z non-fast shapes keep reference parity', () => {
  it.each([
    ['partial-seam', () => gridMesh({ id: 'B', x0: 0, y0: 0, nx: 4, ny: 4, dx: 5, dy: 5, z: () => 0 }),
      () => gridMesh({ id: 'O', x0: 5, y0: 5, nx: 2, ny: 2, dx: 5, dy: 5, z: () => 0 })],
    ['intersecting', () => gridMesh({ id: 'B', x0: 0, y0: 0, nx: 4, ny: 4, dx: 5, dy: 5, z: () => 0 }),
      () => gridMesh({ id: 'O', x0: 0, y0: 0, nx: 4, ny: 4, dx: 5, dy: 5, z: () => 0, drop: (i, j) => i >= 2 && j >= 2 })],
    ['flipped-diagonal-overlay', () => gridMesh({ id: 'B', x0: 0, y0: 0, nx: 3, ny: 3, dx: 5, dy: 5, z: () => 1 }),
      () => gridMesh({ id: 'O', x0: 5, y0: 5, nx: 2, ny: 2, dx: 5, dy: 5, z: () => 1, flip: true })],
  ])('%s matches the frozen reference', (_name, baseFn, overlayFn) => {
    const base = baseFn();
    const overlay = overlayFn();
    expect(composeSurfaceMeshes(base, overlay)).toEqual(composeSurfaceMeshesReference(base, overlay));
  });
});
