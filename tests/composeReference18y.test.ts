/** 18Y reference-oracle parity: reference output equals production exactly. */
import { describe, expect, it } from 'vitest';
import {
  composeSurfaceMeshes,
  type ComposeSourceMesh,
} from '../src/engine/cad/surfaceCompose';
import { composeSurfaceMeshesReference } from '../src/engine/cad/surfaces/compose/composeReference18y';
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
      points.push({ x: opts.x0 + i * opts.dx, y: opts.y0 + j * opts.dy, z: opts.z(opts.x0 + i * opts.dx, opts.y0 + j * opts.dy) });
    }
  }
  const at = (i: number, j: number): number => j * (opts.nx + 1) + i;
  const triangles: Array<[number, number, number]> = [];
  for (let j = 0; j < opts.ny; j += 1) {
    for (let i = 0; i < opts.nx; i += 1) {
      if (opts.drop?.(i, j)) continue;
      triangles.push([at(i, j), at(i + 1, j), at(i + 1, j + 1)], [at(i, j), at(i + 1, j + 1), at(i, j + 1)]);
    }
  }
  const { adjacency } = buildTinTopology(triangles.map(([a, b, c]) => ({ a, b, c })), new Map());
  return { surfaceId: opts.id, surfaceName: opts.id, revision: `rev:${opts.id}`, points, triangles, adjacency };
};

const expectExactParity = (base: ComposeSourceMesh, overlay: ComposeSourceMesh): void => {
  const prod = composeSurfaceMeshes(base, overlay);
  const ref = composeSurfaceMeshesReference(base, overlay);
  expect(ref).toEqual(prod);
};

describe('composeReference18y exact parity', () => {
  it('disjoint edge-touch matches exactly', () => {
    expectExactParity(
      gridMesh({ id: 'B', x0: 0, y0: 0, nx: 2, ny: 2, dx: 5, dy: 5, z: () => 0 }),
      gridMesh({ id: 'O', x0: 10, y0: 0, nx: 2, ny: 2, dx: 5, dy: 5, z: () => 0 }),
    );
  });

  it('overlay-wins interior matches exactly incl. diagnostics + digest', () => {
    const base = gridMesh({ id: 'B', x0: 0, y0: 0, nx: 4, ny: 4, dx: 5, dy: 5, z: (x) => 2 * x + 10 });
    const overlay = gridMesh({ id: 'O', x0: 5, y0: 5, nx: 2, ny: 2, dx: 5, dy: 5, z: (x) => 2 * x + 10 });
    const prod = composeSurfaceMeshes(base, overlay);
    const ref = composeSurfaceMeshesReference(base, overlay);
    expect(ref).toEqual(prod);
    expect(prod.ok).toBe(true);
  });

  it('void show-through (notched overlay) matches exactly', () => {
    expectExactParity(
      gridMesh({ id: 'B', x0: 0, y0: 0, nx: 3, ny: 3, dx: 10, dy: 10, z: () => 3 }),
      gridMesh({ id: 'O', x0: 0, y0: 0, nx: 3, ny: 3, dx: 10, dy: 10, z: () => 3, drop: (i, j) => i === 2 && j === 2 }),
    );
  });

  it('seam mismatch failure reason matches exactly', () => {
    const base = gridMesh({ id: 'B', x0: 0, y0: 0, nx: 4, ny: 4, dx: 5, dy: 5, z: (x) => 2 * x + 10 });
    const overlay = gridMesh({ id: 'O', x0: 5, y0: 5, nx: 2, ny: 2, dx: 5, dy: 5, z: (x) => 2 * x + 10.5 });
    const prod = composeSurfaceMeshes(base, overlay);
    const ref = composeSurfaceMeshesReference(base, overlay);
    expect(ref).toEqual(prod);
    expect(prod.ok).toBe(false);
    if (!prod.ok && prod.reason === 'SURFACE_COMPOSE_SEAM_Z_MISMATCH') {
      expect(prod.maxMismatch).toBeCloseTo(0.5, 12);
    }
  });

  it('area identity holds on both engines', () => {
    const base = gridMesh({ id: 'B', x0: 0, y0: 0, nx: 4, ny: 4, dx: 5, dy: 5, z: () => 1 });
    const overlay = gridMesh({ id: 'O', x0: 5, y0: 5, nx: 2, ny: 2, dx: 5, dy: 5, z: () => 1 });
    const prod = composeSurfaceMeshes(base, overlay);
    const ref = composeSurfaceMeshesReference(base, overlay);
    expect(ref).toEqual(prod);
    if (prod.ok && ref.ok) {
      expect(ref.diagnostics.resultArea).toBe(prod.diagnostics.resultArea);
      expect(ref.diagnostics.baseOnlyArea).toBeCloseTo(ref.diagnostics.resultArea - ref.diagnostics.overlayArea, 9);
      expect(ref.digest).toBe(prod.digest);
    } else {
      expect(prod.ok).toBe(true);
    }
  });
});
