/**
 * Phase 18Y — exact-composition performance evidence (manual/evidence tier).
 *
 * Times `composeSurfaceMeshes` across 1k/10k/50k/100k total-vertex pairs for
 * six seam geometries, plus the exported sub-stages (index build, boundary
 * extraction, PSLG build). NO CI timing thresholds: this suite records
 * numbers and asserts only that every case still returns a valid result.
 * Run with `npm run test:evidence -- phase18y_compose_perf`.
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';

import { composeSurfaceMeshes, type ComposeSourceMesh } from '../../src/engine/cad/surfaceCompose';
import { createMeshView } from '../../src/engine/cad/surfaces/compose/coverage';
import { buildComposePslg, extractBoundaryEdges } from '../../src/engine/cad/surfaces/compose/pslg';
import { buildTinTopology } from '../../src/engine/cad/tin/tinTopology';

interface Grid {
  points: Array<{ x: number; y: number; z: number }>;
  triangles: Array<[number, number, number]>;
}

const baseZ = (x: number, y: number): number => 100 + 0.1 * x + 0.2 * y;

/** Structured CCW grid; `flip` swaps the diagonal, `skip` drops a cell. */
const grid = (
  ox: number,
  oy: number,
  side: number,
  cell: number,
  z: (_x: number, _y: number) => number,
  options: { flip?: boolean; skip?: (_xi: number, _yi: number) => boolean } = {},
): Grid => {
  const points: Grid['points'] = [];
  for (let i = 0; i <= side; i += 1) {
    for (let j = 0; j <= side; j += 1) {
      const x = ox + i * cell;
      const y = oy + j * cell;
      points.push({ x, y, z: z(x, y) });
    }
  }
  const idx = (i: number, j: number): number => i * (side + 1) + j;
  const triangles: Grid['triangles'] = [];
  for (let i = 0; i < side; i += 1) {
    for (let j = 0; j < side; j += 1) {
      if (options.skip?.(i, j)) continue;
      const a = idx(i, j);
      const b = idx(i + 1, j);
      const c = idx(i + 1, j + 1);
      const d = idx(i, j + 1);
      if (options.flip) triangles.push([a, b, d], [b, c, d]);
      else triangles.push([a, b, c], [a, c, d]);
    }
  }
  return { points, triangles };
};

const source = (id: string, g: Grid): ComposeSourceMesh => ({
  surfaceId: id,
  surfaceName: id,
  revision: `${id}-rev`,
  points: g.points,
  triangles: g.triangles,
});

export interface PerfCase {
  name: string;
  build: (_side: number, _cell: number) => { base: Grid; overlay: Grid };
}

export const CASES: PerfCase[] = [
  {
    name: 'disjoint',
    build: (side, cell) => ({
      base: grid(0, 0, side, cell, baseZ),
      overlay: grid(side * cell + cell * 4, 0, side, cell, () => 110),
    }),
  },
  {
    name: 'full-overlay',
    build: (side, cell) => ({
      base: grid(0, 0, side, cell, baseZ),
      overlay: grid(0, 0, side, cell, baseZ),
    }),
  },
  {
    name: 'partial-seam',
    build: (side, cell) => {
      const half = Math.max(1, Math.floor(side / 2));
      return {
        base: grid(0, 0, side, cell, baseZ),
        overlay: grid(half * cell, 0, side - half, cell, baseZ),
      };
    },
  },
  {
    name: 'intersecting-seam',
    build: (side, cell) => {
      // L-shaped overlay: two perpendicular seams meeting at a corner.
      const mid = Math.floor(side / 2);
      return {
        base: grid(0, 0, side, cell, baseZ),
        overlay: grid(0, 0, side, cell, baseZ, { skip: (i, j) => i >= mid && j >= mid }),
      };
    },
  },
  {
    name: 'void',
    build: (side, cell) => {
      const mid = Math.floor(side / 2);
      return {
        base: grid(0, 0, side, cell, baseZ),
        overlay: grid(0, 0, side, cell, baseZ, { skip: (i, j) => i === mid && j === mid }),
      };
    },
  },
  {
    name: 'different-topology',
    build: (side, cell) => ({
      base: grid(0, 0, side, cell, baseZ),
      overlay: grid(0, 0, side, cell, baseZ, { flip: true }),
    }),
  },
];

const ms = (fn: () => void): number => {
  const t = performance.now();
  fn();
  return performance.now() - t;
};

const SIZES = (process.env.PHASE18Y_PERF_SIZES ?? '1000,10000,50000,100000')
  .split(',')
  .map((value) => Number.parseInt(value, 10))
  .filter((value) => Number.isFinite(value));

describe('Phase 18Y compose performance evidence', () => {
  it('records stage timings and output counts for 1k/10k/50k/100k pairs', () => {
    const rows: string[] = [];
    for (const size of SIZES) {
      const side = Math.max(2, Math.round(Math.sqrt(size / 2)));
      const cell = 1;
      const caseFilter = process.env.PHASE18Y_PERF_CASES;
      for (const perfCase of CASES.filter((entry) => caseFilter == null || caseFilter.includes(entry.name))) {
        const { base: bg, overlay: og } = perfCase.build(side, cell);
        const base = source('base', bg);
        const overlay = source('overlay', og);
        // Warm the JIT (first-case cold-start skews small-size rows).
        for (let warm = 0; warm < 3; warm += 1) composeSurfaceMeshes(base, overlay);

        const indexMs = ms(() => {
          createMeshView(base.points, base.triangles);
          createMeshView(overlay.points, overlay.triangles);
        });
        const boundaryMs = ms(() => {
          const { adjacency } = buildTinTopology(
            overlay.triangles.map(([a, b, c]) => ({ a, b, c })),
            new Map(),
          );
          extractBoundaryEdges(overlay.triangles, adjacency);
        });
        const totalMs = ms(() => {
          composeSurfaceMeshes(base, overlay);
        });
        // PSLG sub-stage measured separately (the engine rebuilds it in total).
        const { adjacency: overlayAdjacency } = buildTinTopology(
          overlay.triangles.map(([a, b, c]) => ({ a, b, c })),
          new Map(),
        );
        const boundarySegments = extractBoundaryEdges(overlay.triangles, overlayAdjacency);
        const pslgMs = ms(() => {
          buildComposePslg(base.points, base.triangles, overlay.points, overlay.triangles, boundarySegments);
        });
        const heapBefore = process.memoryUsage().heapUsed;
        const result = composeSurfaceMeshes(base, overlay);
        const heapAfter = process.memoryUsage().heapUsed;
        expect(result.ok, `${perfCase.name} @ ${size}`).toBe(true);
        if (!result.ok) throw new Error(`unexpected reject: ${result.reason}`);
        const diag = result.diagnostics;
        const residual = Math.max(0, totalMs - indexMs - boundaryMs - pslgMs);
        const row =
          `| ${size} | ${perfCase.name} | ${(diag.resultArea).toFixed(1)} | ` +
          `${diag.outputVertexCount} | ${diag.outputTriangleCount} | ` +
          `${indexMs.toFixed(1)} | ${boundaryMs.toFixed(1)} | ${pslgMs.toFixed(1)} | ` +
          `${residual.toFixed(1)} | ${totalMs.toFixed(1)} | ${((heapAfter - heapBefore) / 1e6).toFixed(1)} |`;
        rows.push(row);
      }
    }
    const table =
      '| totalVerts | case | resultArea | outVerts | outTris | index ms | boundary ms | pslg ms | tri+classify ms | total ms | heap delta MB |\n' +
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n' +
      rows.join('\n');
    fs.writeFileSync(process.env.PHASE18Y_PERF_OUT ?? '/tmp/phase18y-compose-perf-table.md', table);
    const caseFilter = process.env.PHASE18Y_PERF_CASES;
    const expectedCases = CASES.filter((entry) => caseFilter == null || caseFilter.includes(entry.name)).length;
    expect(rows).toHaveLength(SIZES.length * expectedCases);
  }, 900_000);
});
