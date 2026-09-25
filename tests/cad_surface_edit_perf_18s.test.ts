import { describe, expect, it } from 'vitest';
import { orient2d } from 'robust-predicates';
import type { CadSurfaceEdit } from '../src/engine/cad/cadTypes';
import {
  applyCadSurfaceEdits,
  type CadSurfaceEditBaseline,
} from '../src/engine/cad/cadSurfaceEdits';
import type { CadSurfaceEditMeshPoint } from '../src/engine/cad/cadSurfaceEditMesh';
import { TIN_EDGE_FREE } from '../src/engine/cad/tin/tinTypes';

/**
 * Phase 18S incremental edge-map regression (agent tier, small/fast).
 * NOT a benchmark: asserts correctness of local edge-map maintenance
 * (shuffled-input equivalence, determinism, count conservation) plus one
 * bounded timing smoke with a generous budget so CI never flakes.
 */

const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** side x side vertex grid, two triangles per cell, diagonal a-d. */
const gridBaseline = (side: number): CadSurfaceEditBaseline => {
  const points: CadSurfaceEditMeshPoint[] = [];
  for (let j = 0; j < side; j += 1) {
    for (let i = 0; i < side; i += 1) {
      points.push({ id: `p${j * side + i}`, x: i, y: j, z: 0 });
    }
  }
  const at = (i: number, j: number): number => j * side + i;
  const triangles: Array<[number, number, number]> = [];
  for (let j = 0; j < side - 1; j += 1) {
    for (let i = 0; i < side - 1; i += 1) {
      const a = at(i, j);
      const b = at(i + 1, j);
      const c = at(i, j + 1);
      const d = at(i + 1, j + 1);
      triangles.push([a, b, d], [a, d, c]);
    }
  }
  return {
    points,
    triangles,
    edgeKinds: triangles.map(() => [TIN_EDGE_FREE, TIN_EDGE_FREE, TIN_EDGE_FREE]),
    constrainedKindMap: new Map(),
  };
};

/** Cells spaced >=3 apart so local ops never share a triangle. */
const spacedCells = (side: number, count: number, offset: number): Array<[number, number]> => {
  const cells: Array<[number, number]> = [];
  for (let j = offset; j < side - 1 && cells.length < count; j += 3) {
    for (let i = offset; i < side - 1 && cells.length < count; i += 3) {
      cells.push([i, j]);
    }
  }
  return cells;
};

const swapEdits = (side: number, cells: Array<[number, number]>, tag: string): CadSurfaceEdit[] => {
  const at = (i: number, j: number): number => j * side + i;
  return cells.map(([i, j], n) => ({
    id: `${tag}-s${n}`,
    kind: 'swap-edge',
    edge: { a: { key: `source:p${at(i, j)}` }, b: { key: `source:p${at(i + 1, j + 1)}` } },
  }));
};

const triKey = (t: readonly [number, number, number]): string => [...t].sort((x, y) => x - y).join('>');

describe('18S incremental edge map', () => {
  it('shuffled input triangle order replays to the identical mesh', () => {
    const side = 12;
    const base = gridBaseline(side);
    const edits = swapEdits(side, spacedCells(side, 16, 1), 'sh');
    const first = applyCadSurfaceEdits(base, edits);
    expect(first.results.every((r) => r.status === 'applied')).toBe(true);
    // Deterministic: a second run is byte-identical.
    const second = applyCadSurfaceEdits(base, edits);
    expect(second.triangles).toEqual(first.triangles);
    // Shuffled input order reaches the same final triangle set.
    const rand = mulberry32(18);
    const order = base.triangles.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i -= 1) {
      const k = Math.floor(rand() * (i + 1));
      [order[i], order[k]] = [order[k], order[i]];
    }
    const shuffled: CadSurfaceEditBaseline = {
      ...base,
      triangles: order.map((i) => base.triangles[i]),
      edgeKinds: order.map((i) => base.edgeKinds[i]),
    };
    const viaShuffled = applyCadSurfaceEdits(shuffled, edits);
    expect(viaShuffled.results.every((r) => r.status === 'applied')).toBe(true);
    expect(viaShuffled.triangles.map(triKey).sort()).toEqual(first.triangles.map(triKey).sort());
    // Swaps preserve triangle count; output stays math-CCW.
    expect(first.triangles).toHaveLength(base.triangles.length);
    for (const [a, b, c] of first.triangles) {
      const p = base.points;
      expect(orient2d(p[a].x, p[a].y, p[b].x, p[b].y, p[c].x, p[c].y)).toBeLessThan(0);
    }
  });

  it('mixed swap/delete/add-line stack stays consistent', () => {
    const side = 12;
    const base = gridBaseline(side);
    const at = (i: number, j: number): number => j * side + i;
    const swaps = swapEdits(side, spacedCells(side, 8, 1), 'mx');
    // Boundary deletes on the bottom row (1 triangle each), far from swaps/add-lines.
    const deletes: CadSurfaceEdit[] = [1, 4, 7].map((i, n) => ({
      id: `mx-d${n}`,
      kind: 'delete-line',
      edge: { a: { key: `source:p${at(i, 0)}` }, b: { key: `source:p${at(i + 1, 0)}` } },
    }));
    // Add-lines as alternate cell diagonals (2-triangle cavities) in rows the swaps never touch.
    const addLines: CadSurfaceEdit[] = [7, 10].map((j, n) => ({
      id: `mx-a${n}`,
      kind: 'add-line',
      from: { key: `source:p${at(3, j)}` },
      to: { key: `source:p${at(2, j + 1)}` },
    }));
    const out = applyCadSurfaceEdits(base, [...swaps, ...deletes, ...addLines]);
    expect(out.results.every((r) => r.status === 'applied')).toBe(true);
    // Swaps/add-lines preserve count; each boundary delete removes exactly 1.
    expect(out.triangles).toHaveLength(base.triangles.length - deletes.length);
    const again = applyCadSurfaceEdits(base, [...swaps, ...deletes, ...addLines]);
    expect(again.triangles).toEqual(out.triangles);
  });

  it('timing smoke: 1000-edit replay on a 10k-vertex grid stays far under budget', () => {
    const side = 100;
    const base = gridBaseline(side);
    const edits = swapEdits(side, spacedCells(side, 1000, 1), 'perf');
    expect(edits).toHaveLength(1000);
    const start = performance.now();
    const out = applyCadSurfaceEdits(base, edits);
    const elapsed = performance.now() - start;
    expect(out.results.every((r) => r.status === 'applied')).toBe(true);
    expect(out.triangles).toHaveLength(base.triangles.length);
    // Generous guard only (NOT a benchmark gate): the incremental map keeps
    // this run two orders of magnitude below; real numbers live in
    // docs/evidence/phase18s-performance.md.
    expect(elapsed).toBeLessThan(10_000);
  });
});
