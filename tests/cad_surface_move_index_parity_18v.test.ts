/**
 * Phase 18V — dynamic edge spatial index + single Move Point parity
 * (architecture §9, §31-32, §92-96). AGENT tier.
 *
 * The reference here is a TEST-ONLY brute-force oracle: a verbatim copy of
 * the legacy global per-triangle crossing scan. The indexed production
 * validator must agree on 100% of proposals (PASS/BLOCK + exact reason +
 * resulting coordinates) for a deterministic randomized corpus, and the
 * candidate sieve must never lose a real crossing (fail-closed superset
 * contract) — including after topology changes between moves.
 */
import { describe, expect, it } from 'vitest';
import { orient2d } from 'robust-predicates';
import { applyCadSurfaceEdits, type CadSurfaceEditBaseline } from '../src/engine/cad/cadSurfaceEdits';
import {
  ccwEditTri,
  EditHalt,
  indexEditTri,
  refreshEditEdges,
  unindexEditTri,
  type EditMeshState,
  type EditTri,
} from '../src/engine/cad/cadSurfaceEditMesh';
import { applyAddLine } from '../src/engine/cad/cadSurfaceEditAddLine';
import { applyAddPoint } from '../src/engine/cad/cadSurfaceEditPointAdd';
import { applyDeletePoint, applyMovePoint } from '../src/engine/cad/cadSurfaceEditPointModify';
import { applyMovePointsVertices } from '../src/engine/cad/cadSurfaceEditBulk';
import { ensureEditEdgeSpatialIndex, invalidateEditEdgeSpatialIndex, type EditEdgeSpatialIndex } from '../src/engine/cad/cadEditEdgeSpatialIndex';
import { ensureEditPointLocationIndex } from '../src/engine/cad/cadEditPointLocationIndex';
import { tinEdgeKey } from '../src/engine/cad/tin/tinTopology';
import { TIN_EDGE_FREE, type TinEdgeKinds } from '../src/engine/cad/tin/tinTypes';
import type { CadSurfaceEdit } from '../src/engine/cad/cadTypes';

// ---------------------------------------------------------------------------
// Deterministic PRNG + mesh fixtures
// ---------------------------------------------------------------------------

const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Hand-built baseline; triangles are CCW-normalized exactly like ccwEditTri. */
const meshOf = (
  coords: Array<[number, number, number?]>,
  triangles: Array<[number, number, number]>,
  kinds?: TinEdgeKinds[],
): CadSurfaceEditBaseline => ({
  points: coords.map(([x, y, z], i) => ({ id: `p${i}`, x, y, z: z ?? 0 })),
  triangles: triangles.map(([a, b, c]): [number, number, number] => {
    const o = orient2d(coords[a][0], coords[a][1], coords[b][0], coords[b][1], coords[c][0], coords[c][1]);
    return o < 0 ? [a, b, c] : [a, c, b];
  }),
  edgeKinds: kinds ?? triangles.map((): TinEdgeKinds => [TIN_EDGE_FREE, TIN_EDGE_FREE, TIN_EDGE_FREE]),
  constrainedKindMap: new Map(),
});

/** Mirrors applyCadSurfaceEdits' state construction (test-side, no production seam). */
const stateOf = (baseline: CadSurfaceEditBaseline): EditMeshState => {
  const state: EditMeshState = {
    surfaceId: baseline.surfaceId ?? 'idx18v',
    pts: baseline.points.map((p) => ({ ...p })),
    active: baseline.points.map(() => true),
    byId: new Map(baseline.points.map((p, index) => [p.id, index])),
    tris: new Map(baseline.triangles.map((t, index) => [index, [t[0], t[1], t[2]] as EditTri])),
    nextTri: baseline.triangles.length,
    edgeMap: new Map(),
    edgeKind: new Map(),
    vertTris: new Map(),
    userLines: new Set(),
  };
  baseline.triangles.forEach((tri, index) => {
    const kinds = baseline.edgeKinds[index] ?? [TIN_EDGE_FREE, TIN_EDGE_FREE, TIN_EDGE_FREE];
    const edges = [
      [tri[1], tri[2]],
      [tri[2], tri[0]],
      [tri[0], tri[1]],
    ] as const;
    edges.forEach(([u, v], k) => {
      const key = tinEdgeKey(u, v);
      const prior = state.edgeKind.get(key) ?? TIN_EDGE_FREE;
      if (kinds[k] > prior) state.edgeKind.set(key, kinds[k]);
    });
  });
  refreshEditEdges(state);
  return state;
};

interface GridOptions {
  offsetX?: number;
  offsetY?: number;
  drop?: (_i: number, _j: number) => boolean;
}

const gridBaseline = (side: number, options: GridOptions = {}): CadSurfaceEditBaseline => {
  const ox = options.offsetX ?? 0;
  const oy = options.offsetY ?? 0;
  const coords: Array<[number, number]> = [];
  for (let i = 0; i < side; i += 1) for (let j = 0; j < side; j += 1) coords.push([ox + i, oy + j]);
  const at = (i: number, j: number): number => i * side + j;
  const triangles: Array<[number, number, number]> = [];
  for (let i = 0; i + 1 < side; i += 1) {
    for (let j = 0; j + 1 < side; j += 1) {
      if (options.drop?.(i, j)) continue;
      triangles.push([at(i, j), at(i + 1, j), at(i + 1, j + 1)]);
      triangles.push([at(i, j), at(i + 1, j + 1), at(i, j + 1)]);
    }
  }
  return meshOf(coords, triangles);
};

/** Star-shaped ring (star-shaped by construction) + a few interior splits. */
const irregularBaseline = (seed: number, ring: number, splits: number, offsetX = 0, offsetY = 0): CadSurfaceEditBaseline => {
  const rng = mulberry32(seed);
  const coords: Array<[number, number]> = [[offsetX, offsetY]];
  for (let k = 0; k < ring; k += 1) {
    const angle = (2 * Math.PI * k) / ring + (rng() - 0.5) * (Math.PI / ring) * 0.6;
    const radius = 4 + rng() * 5;
    coords.push([offsetX + Math.cos(angle) * radius, offsetY + Math.sin(angle) * radius]);
  }
  let triangles: Array<[number, number, number]> = [];
  for (let k = 0; k < ring; k += 1) triangles.push([0, 1 + k, 1 + ((k + 1) % ring)]);
  for (let s = 0; s < splits; s += 1) {
    const at = Math.floor(rng() * triangles.length);
    const tri = triangles[at];
    const cx = (coords[tri[0]][0] + coords[tri[1]][0] + coords[tri[2]][0]) / 3;
    const cy = (coords[tri[0]][1] + coords[tri[1]][1] + coords[tri[2]][1]) / 3;
    const p = coords.push([cx + (rng() - 0.5) * 0.4, cy + (rng() - 0.5) * 0.4]) - 1;
    triangles = triangles.filter((_, i) => i !== at).concat([
      [tri[0], tri[1], p],
      [tri[1], tri[2], p],
      [tri[2], tri[0], p],
    ]);
  }
  return meshOf(coords, triangles);
};

/**
 * Diamond star around v=0 plus a DISCONNECTED foreign triangle whose long
 * edge (5,6) crosses the diamond interior at y=6. In a planar connected TIN
 * a kernel-valid move cannot cross another edge, so this is the honest way to
 * reach the INTERSECTION branch: moving v to (5,0) keeps every incident
 * triangle positive but sweeps edge (0,2) across (5,6).
 */
const crossingBaseline = (): CadSurfaceEditBaseline =>
  meshOf(
    [
      [0, 0],
      [-10, 0],
      [0, 10],
      [10, 0],
      [0, -10],
      [-9, 6],
      [9, 6],
      [0, 20],
    ],
    [
      [0, 1, 2],
      [0, 2, 3],
      [0, 3, 4],
      [0, 4, 1],
      [5, 6, 7],
    ],
  );

/** Replay topology-only edits, then re-baseline the compacted result. */
const prefixBaseline = (edits: CadSurfaceEdit[]): CadSurfaceEditBaseline => {
  const out = applyCadSurfaceEdits(gridBaseline(4), edits);
  return meshOf(
    out.points.map((p): [number, number, number] => [p.x, p.y, p.z]),
    out.triangles.map((t): [number, number, number] => [t[0], t[1], t[2]]),
    out.edgeKinds,
  );
};

const SWAP_P0_P5: CadSurfaceEdit = {
  id: 'sw',
  kind: 'swap-edge',
  edge: { a: { key: 'source:p0' }, b: { key: 'source:p5' } },
};
const DELETE_P0_P5: CadSurfaceEdit = {
  id: 'dl',
  kind: 'delete-line',
  edge: { a: { key: 'source:p0' }, b: { key: 'source:p5' } },
};
const ADD_POINT: CadSurfaceEdit = { id: 'ap', kind: 'add-point', x: 1.3, y: 1.6, z: 0 };

// ---------------------------------------------------------------------------
// TEST-ONLY oracle: verbatim legacy global-scan Move Point
// ---------------------------------------------------------------------------

const oracleIncident = (state: EditMeshState, v: number): Array<[number, number]> => {
  const out: Array<[number, number]> = [];
  for (const id of state.vertTris.get(v) ?? []) {
    const tri = state.tris.get(id);
    if (!tri) continue;
    for (const [u, w] of [
      [tri[0], tri[1]],
      [tri[1], tri[2]],
      [tri[2], tri[0]],
    ] as const) {
      if (u === v || w === v) out.push([u, w]);
    }
  }
  return out;
};

const oracleHasBoundary = (state: EditMeshState, v: number): boolean =>
  oracleIncident(state, v).some(([u, w]) => (state.edgeMap.get(tinEdgeKey(u, w)) ?? []).length < 2);

const oracleHasConstrained = (state: EditMeshState, v: number): boolean =>
  oracleIncident(state, v).some(([u, w]) => (state.edgeKind.get(tinEdgeKey(u, w)) ?? TIN_EDGE_FREE) !== TIN_EDGE_FREE);

const oracleNeighbors = (state: EditMeshState, v: number): number[] => {
  const set = new Set<number>();
  for (const [u, w] of oracleIncident(state, v)) set.add(u === v ? w : u);
  return [...set];
};

const properlyCrosses = (
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): boolean => {
  const o1 = orient2d(ax, ay, bx, by, cx, cy);
  const o2 = orient2d(ax, ay, bx, by, dx, dy);
  const o3 = orient2d(cx, cy, dx, dy, ax, ay);
  const o4 = orient2d(cx, cy, dx, dy, bx, by);
  return o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0 && (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
};

/** Legacy applyMovePoint: global per-triangle scan, no index, no behavior change. */
const legacyApplyMovePoint = (state: EditMeshState, v: number, x: number, y: number): void => {
  if (!state.active[v]) throw new EditHalt('SURFACE_EDIT_VERTEX_MISSING');
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new EditHalt('SURFACE_EDIT_MOVE_POINT_INVALID_STAR');
  if (oracleHasBoundary(state, v)) throw new EditHalt('SURFACE_EDIT_MOVE_POINT_BOUNDARY');
  if (oracleHasConstrained(state, v)) throw new EditHalt('SURFACE_EDIT_MOVE_POINT_CONSTRAINED');
  for (let i = 0; i < state.pts.length; i += 1) {
    if (i !== v && state.active[i] && state.pts[i].x === x && state.pts[i].y === y) {
      throw new EditHalt('SURFACE_EDIT_MOVE_POINT_INVALID_STAR');
    }
  }
  const ring = state.vertTris.get(v);
  if (!ring || ring.size === 0) throw new EditHalt('SURFACE_EDIT_MOVE_POINT_INVALID_STAR');
  const vertex = state.pts[v];
  const oldX = vertex.x;
  const oldY = vertex.y;
  vertex.x = x;
  vertex.y = y;
  try {
    for (const id of ring) {
      const tri = state.tris.get(id) as EditTri;
      const at = tri.indexOf(v);
      if (at < 0) throw new EditHalt('SURFACE_EDIT_MOVE_POINT_INVALID_STAR');
      const sub = tri.map((w) => (w === v ? { x, y } : state.pts[w]));
      if (orient2d(sub[0].x, sub[0].y, sub[1].x, sub[1].y, sub[2].x, sub[2].y) >= 0) {
        throw new EditHalt('SURFACE_EDIT_MOVE_POINT_INVALID_STAR');
      }
    }
    for (const w of oracleNeighbors(state, v)) {
      const pw = state.pts[w];
      for (const [, tri] of state.tris) {
        for (const [u1, u2] of [
          [tri[0], tri[1]],
          [tri[1], tri[2]],
          [tri[2], tri[0]],
        ] as const) {
          if (u1 === v || u2 === v) continue;
          const p1 = state.pts[u1];
          const p2 = state.pts[u2];
          if (properlyCrosses(x, y, pw.x, pw.y, p1.x, p1.y, p2.x, p2.y)) {
            throw new EditHalt('SURFACE_EDIT_MOVE_POINT_INTERSECTION');
          }
        }
      }
    }
  } catch (error) {
    vertex.x = oldX;
    vertex.y = oldY;
    throw error;
  }
};

// ---------------------------------------------------------------------------
// Parity harness
// ---------------------------------------------------------------------------

const attempt = (run: () => void): string => {
  try {
    run();
    return 'APPLIED';
  } catch (error) {
    if (error instanceof EditHalt) return error.reason;
    return `UNEXPECTED:${error instanceof Error ? error.message : String(error)}`;
  }
};

const movableVertices = (state: EditMeshState): number[] => {
  const out: number[] = [];
  for (let v = 0; v < state.pts.length; v += 1) {
    if (!state.active[v] || !state.vertTris.has(v)) continue;
    if (oracleHasBoundary(state, v) || oracleHasConstrained(state, v)) continue;
    out.push(v);
  }
  return out;
};

const coordSignature = (state: EditMeshState): string =>
  state.pts.map((p) => `${p.x},${p.y}`).join('|');

/**
 * Fail-closed superset probe: every edge that PROPERLY CROSSES the query
 * segment must be returned by the candidate query. A bbox miss short-circuits
 * (a proper crossing implies overlapping bboxes), so this stays cheap.
 */
const probeNoFalseNegatives = (state: EditMeshState, index: EditEdgeSpatialIndex, rng: () => number): void => {
  if (state.pts.length < 4) return;
  const a = state.pts[Math.floor(rng() * state.pts.length)];
  const b = state.pts[Math.floor(rng() * state.pts.length)];
  if (a === b) return;
  const candidates = new Set(
    index
      .queryCandidates(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y))
      .map((rec) => rec.edgeKey),
  );
  for (const key of state.edgeMap.keys()) {
    if (candidates.has(key)) continue;
    const [u, v] = key.split('>').map(Number) as [number, number];
    const p1 = state.pts[u];
    const p2 = state.pts[v];
    if (Math.max(p1.x, p2.x) < Math.min(a.x, b.x) || Math.min(p1.x, p2.x) > Math.max(a.x, b.x)) continue;
    if (Math.max(p1.y, p2.y) < Math.min(a.y, b.y) || Math.min(p1.y, p2.y) > Math.max(a.y, b.y)) continue;
    expect(
      properlyCrosses(a.x, a.y, b.x, b.y, p1.x, p1.y, p2.x, p2.y),
      `candidate index missed properly-crossing edge ${key}`,
    ).toBe(false);
  }
};

interface ParityCounts {
  proposals: number;
  applied: number;
  blocked: number;
  reasons: Map<string, number>;
}

const newCounts = (): ParityCounts => ({ proposals: 0, applied: 0, blocked: 0, reasons: new Map() });

type TargetStrategy = (_state: EditMeshState, _rng: () => number, _movable: number[]) => { v: number; x: number; y: number };

const mixedTarget: TargetStrategy = (state, rng, movable) => {
  const v = movable[Math.floor(rng() * movable.length)];
  const p = state.pts[v];
  const pick = rng();
  if (pick < 0.25) return { v, x: p.x + (rng() - 0.5) * 1e-4, y: p.y + (rng() - 0.5) * 1e-4 };
  if (pick < 0.5) return { v, x: p.x + (rng() - 0.5) * 0.2, y: p.y + (rng() - 0.5) * 0.2 };
  if (pick < 0.7) return { v, x: p.x + (rng() - 0.5) * 9, y: p.y + (rng() - 0.5) * 9 };
  if (pick < 0.8) return { v, x: p.x, y: p.y };
  if (pick < 0.9) {
    const w = oracleNeighbors(state, v)[Math.floor(rng() * oracleNeighbors(state, v).length)];
    const pw = state.pts[w];
    return { v, x: pw.x, y: pw.y };
  }
  return { v, x: Number.NaN, y: p.y };
};

/** Stepwise indexed-vs-legacy parity over a shared evolving state pair. */
const runParity = (
  label: string,
  baseline: CadSurfaceEditBaseline,
  seed: number,
  steps: number,
  target: TargetStrategy,
  counts: ParityCounts,
): void => {
  const indexed = stateOf(baseline);
  const reference = stateOf(baseline);
  const rng = mulberry32(seed);
  for (let step = 0; step < steps; step += 1) {
    const movable = movableVertices(indexed);
    if (movable.length === 0) break;
    const { v, x, y } = target(indexed, rng, movable);
    const got = attempt(() => applyMovePoint(indexed, v, x, y));
    const want = attempt(() => legacyApplyMovePoint(reference, v, x, y));
    expect(got, `${label} step ${step}: v=${v} -> (${x},${y})`).toBe(want);
    expect(coordSignature(indexed), `${label} step ${step}: coords diverged`).toBe(coordSignature(reference));
    expect(indexed.edgeMap.size, `${label} step ${step}: topology diverged`).toBe(reference.edgeMap.size);
    counts.proposals += 1;
    if (got === 'APPLIED') counts.applied += 1;
    else {
      counts.blocked += 1;
      counts.reasons.set(got, (counts.reasons.get(got) ?? 0) + 1);
    }
    if (step % 8 === 0) probeNoFalseNegatives(indexed, ensureEditEdgeSpatialIndex(indexed), rng);
  }
};

/** Test-side topology mutation (same primitives applySwap uses) — hooks only. */
const swapDiagonal = (state: EditMeshState, a: number, b: number): void => {
  const adj = [...(state.edgeMap.get(tinEdgeKey(a, b)) ?? [])].sort((x, y) => x - y);
  const t1 = state.tris.get(adj[0]) as EditTri;
  const t2 = state.tris.get(adj[1]) as EditTri;
  const p = t1.find((w) => w !== a && w !== b) as number;
  const q = t2.find((w) => w !== a && w !== b) as number;
  state.tris.delete(adj[0]);
  state.tris.delete(adj[1]);
  unindexEditTri(state, adj[0], t1);
  unindexEditTri(state, adj[1], t2);
  for (const next of [ccwEditTri(state.pts, p, q, a), ccwEditTri(state.pts, p, q, b)]) {
    const id = state.nextTri++;
    state.tris.set(id, next);
    indexEditTri(state, id, next);
  }
};

const centerMostMovable = (state: EditMeshState): number => {
  const movable = movableVertices(state);
  expect(movable.length).toBeGreaterThan(0);
  return movable[0];
};

// ---------------------------------------------------------------------------
// Candidate contract
// ---------------------------------------------------------------------------

describe('18V edge spatial index — candidate contract', () => {
  it('no random query ever misses a properly crossing edge', () => {
    const rng = mulberry32(20260925);
    const states = [
      stateOf(gridBaseline(6)),
      stateOf(gridBaseline(9, { drop: (i, j) => (i + j * 3) % 11 === 0 })),
      stateOf(irregularBaseline(7, 14, 4)),
      stateOf(irregularBaseline(11, 22, 6, 2_000_000, 7_000_000)),
    ];
    for (const state of states) {
      const index = ensureEditEdgeSpatialIndex(state);
      expect(index.edgeCount).toBe(state.edgeMap.size);
      for (let i = 0; i < 120; i += 1) probeNoFalseNegatives(state, index, rng);
    }
  });

  it('edgeMap refcount transitions: 0→1 add, 1→2 and 2→1 no-op, 1→0 remove', () => {
    const state = stateOf(meshOf([[0, 0], [1, 0], [1, 1], [0, 1]], [[0, 1, 2], [0, 2, 3]]));
    const index = ensureEditEdgeSpatialIndex(state);
    const total = state.edgeMap.size;
    const shared = tinEdgeKey(0, 2);
    expect(index.edgeCount).toBe(total);

    // 1→0 for the two unique edges + 2→1 keep for the shared diagonal.
    const tri = state.tris.get(0) as EditTri;
    state.tris.delete(0);
    unindexEditTri(state, 0, tri);
    expect(index.edgeCount).toBe(total - 2);
    const bboxOf = (key: string): [number, number, number, number] => {
      const [u, v] = key.split('>').map(Number) as [number, number];
      const a = state.pts[u];
      const b = state.pts[v];
      return [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y)];
    };
    expect(index.queryCandidates(...bboxOf(shared)).some((rec) => rec.edgeKey === shared)).toBe(true);

    // 0→1 re-add: the two unique edges come back, the shared edge stays 1→2 no-op.
    state.tris.set(0, tri);
    indexEditTri(state, 0, tri);
    expect(index.edgeCount).toBe(total);
    // 1→0 for everything.
    for (const [id, t] of [...state.tris]) {
      state.tris.delete(id);
      unindexEditTri(state, id, t);
    }
    expect(index.edgeCount).toBe(0);
    expect(state.edgeMap.size).toBe(0);
    expect(index.queryCandidates(-1e9, -1e9, 1e9, 1e9)).toHaveLength(0);
  });

  it('deleted edges stop being candidates; added edges participate', () => {
    const state = stateOf(gridBaseline(5));
    const index = ensureEditEdgeSpatialIndex(state);
    const bboxOf = (key: string): [number, number, number, number] => {
      const [u, v] = key.split('>').map(Number) as [number, number];
      const a = state.pts[u];
      const b = state.pts[v];
      return [Math.min(a.x, b.x) - 0.01, Math.min(a.y, b.y) - 0.01, Math.max(a.x, b.x) + 0.01, Math.max(a.y, b.y) + 0.01];
    };
    const assertAllEdgesQueryable = (): void => {
      for (const key of state.edgeMap.keys()) {
        expect(
          index.queryCandidates(...bboxOf(key)).some((rec) => rec.edgeKey === key),
          `edge ${key} not queryable`,
        ).toBe(true);
      }
      expect(index.edgeCount).toBe(state.edgeMap.size);
    };
    assertAllEdgesQueryable();

    // delete-point retriangulates the cavity: spokes 1→0 vanish, diagonals 0→1 appear.
    const v = centerMostMovable(state);
    const spoke = tinEdgeKey(v, oracleNeighbors(state, v)[0]);
    expect(state.edgeMap.has(spoke)).toBe(true);
    applyDeletePoint(state, v);
    expect(state.edgeMap.has(spoke)).toBe(false);
    expect(index.queryCandidates(...bboxOf(spoke)).some((rec) => rec.edgeKey === spoke)).toBe(false);
    assertAllEdgesQueryable();

    applyAddPoint(state, 'ap', 1.4, 2.6, 0);
    assertAllEdgesQueryable();

    // 1→0 on one triangle's edges only; shared edges keep their record.
    const id = [...state.tris.keys()][0] as number;
    const tri = state.tris.get(id) as EditTri;
    const before = index.edgeCount;
    state.tris.delete(id);
    unindexEditTri(state, id, tri);
    expect(index.edgeCount).toBe(state.edgeMap.size);
    expect(index.edgeCount).toBeLessThan(before);
    assertAllEdgesQueryable();
  });

  it('layout and query order are deterministic for the same mesh', () => {
    const baseline = irregularBaseline(3, 16, 5);
    const first = ensureEditEdgeSpatialIndex(stateOf(baseline));
    const second = ensureEditEdgeSpatialIndex(stateOf(baseline));
    expect(second.cellSize).toBe(first.cellSize);
    expect(second.originX).toBe(first.originX);
    expect(second.cellCount).toBe(first.cellCount);
    const keys = (index: EditEdgeSpatialIndex): string[] =>
      index.queryCandidates(-100, -100, 100, 100).map((rec) => rec.edgeKey);
    expect(keys(second)).toEqual(keys(first));
  });

  it('lazy: Z/add/delete/topology stacks pay nothing until the first move', () => {
    const state = stateOf(gridBaseline(5));
    expect(state.edgeHooks).toBeUndefined();
    applyAddPoint(state, 'ap', 1.4, 2.6, 0);
    applyDeletePoint(state, centerMostMovable(state));
    expect(state.edgeHooks).toBeUndefined();
    const v = centerMostMovable(state);
    applyMovePoint(state, v, state.pts[v].x + 0.03, state.pts[v].y + 0.03);
    const index = ensureEditEdgeSpatialIndex(state);
    expect(state.edgeHooks).toBe(index);
    expect(index.edgeCount).toBe(state.edgeMap.size);

    // A full topology rebuild detaches the incremental index; the next ensure rebuilds.
    refreshEditEdges(state);
    expect(state.edgeHooks).toBeUndefined();
    const rebuilt = ensureEditEdgeSpatialIndex(state);
    expect(rebuilt).not.toBe(index);
    expect(rebuilt.edgeCount).toBe(state.edgeMap.size);
  });

  it('external XY writes are handled by explicit invalidation (bulk-move seam)', () => {
    const state = stateOf(gridBaseline(5));
    const index = ensureEditEdgeSpatialIndex(state);
    const v = centerMostMovable(state);
    const [su, sv] = [v, oracleNeighbors(state, v)[0]];
    const key = tinEdgeKey(su, sv);
    const bboxBefore = index.queryCandidates(state.pts[su].x, state.pts[su].y, state.pts[su].x, state.pts[su].y);
    expect(bboxBefore.some((rec) => rec.edgeKey === key)).toBe(true);

    // A bulk kernel writing coordinates directly makes the records stale...
    state.pts[v].x += 3.25;
    expect(index.queryCandidates(state.pts[v].x, state.pts[v].y, state.pts[v].x, state.pts[v].y).some((rec) => rec.edgeKey === key)).toBe(false);
    // ...so the seam drops it and the next ensure rebuilds from real geometry.
    invalidateEditEdgeSpatialIndex(state);
    expect(state.edgeHooks).toBeUndefined();
    const rebuilt = ensureEditEdgeSpatialIndex(state);
    expect(rebuilt).not.toBe(index);
    expect(rebuilt.edgeCount).toBe(state.edgeMap.size);
    const moved = state.pts[v];
    expect(rebuilt.queryCandidates(moved.x, moved.y, moved.x, moved.y).some((rec) => rec.edgeKey === key)).toBe(true);
    probeNoFalseNegatives(state, rebuilt, mulberry32(5));
  });
});

// ---------------------------------------------------------------------------
// Indexed vs legacy Move Point parity
// ---------------------------------------------------------------------------

describe('18V move-point parity (legacy global scan vs indexed)', () => {
  it('randomized corpus: thousands of proposals, 100% PASS/BLOCK parity', () => {
    const counts = newCounts();
    const corpus: Array<[string, CadSurfaceEditBaseline, number]> = [
      ['grid6', gridBaseline(6), 240],
      ['grid8', gridBaseline(8), 240],
      ['grid6-holes', gridBaseline(6, { drop: (i, j) => (i * 7 + j * 5) % 9 === 0 }), 200],
      ['irregular12', irregularBaseline(21, 12, 3), 200],
      ['irregular20', irregularBaseline(22, 20, 6), 200],
      ['prefix-swap', prefixBaseline([SWAP_P0_P5]), 200],
      ['prefix-delete-line', prefixBaseline([DELETE_P0_P5]), 200],
      ['prefix-add-point', prefixBaseline([ADD_POINT]), 200],
      ['prefix-add-point+swap', prefixBaseline([ADD_POINT, SWAP_P0_P5]), 200],
      ['foreign-crossing', crossingBaseline(), 120],
    ];
    corpus.forEach(([label, baseline, steps], i) => runParity(label, baseline, 1000 + i, steps, mixedTarget, counts));
    expect(counts.proposals).toBeGreaterThanOrEqual(2000);
    expect(counts.applied).toBeGreaterThan(0);
    expect(counts.blocked).toBeGreaterThan(0);
    expect(counts.reasons.get('SURFACE_EDIT_MOVE_POINT_INVALID_STAR') ?? 0).toBeGreaterThan(0);
    console.info(
      `18V parity corpus: ${counts.proposals} proposals, ${counts.applied} applied, ${counts.blocked} blocked ` +
        `(${[...counts.reasons].map(([r, n]) => `${r}=${n}`).join(', ')})`,
    );
  });

  it('large projected coordinates E≈2M / N≈7M stay bit-identical', () => {
    const counts = newCounts();
    runParity('grid6-big', gridBaseline(6, { offsetX: 2_000_000, offsetY: 7_000_000 }), 31, 300, mixedTarget, counts);
    runParity('irregular16-big', irregularBaseline(32, 16, 5, 2_000_000, 7_000_000), 32, 240, mixedTarget, counts);
    expect(counts.proposals).toBeGreaterThanOrEqual(500);
    expect(counts.applied).toBeGreaterThan(0);
    expect(counts.blocked).toBeGreaterThan(0);
  });

  it('a kernel-valid move across a foreign edge is INTERSECTION in both validators', () => {
    const indexed = stateOf(crossingBaseline());
    const reference = stateOf(crossingBaseline());
    const index = ensureEditEdgeSpatialIndex(indexed);
    const got = attempt(() => applyMovePoint(indexed, 0, 5, 0));
    const want = attempt(() => legacyApplyMovePoint(reference, 0, 5, 0));
    expect(got).toBe('SURFACE_EDIT_MOVE_POINT_INTERSECTION');
    expect(want).toBe(got);
    // The foreign edge really was found through the candidate query.
    const foreign = tinEdgeKey(5, 6);
    const candidates = index.queryCandidates(0, 0, 5, 10).map((rec) => rec.edgeKey);
    expect(candidates).toContain(foreign);
    expect(coordSignature(indexed)).toBe(coordSignature(reference));
  });

  it('index-after-move: chained moves depend on the previous move’s bboxes', () => {
    const baseline = irregularBaseline(41, 18, 6);
    const indexed = stateOf(baseline);
    const reference = stateOf(baseline);
    const rng = mulberry32(41);
    let applied = 0;
    for (let step = 0; step < 300; step += 1) {
      const movable = movableVertices(indexed);
      if (!movable.length) break;
      const { v, x, y } = mixedTarget(indexed, rng, movable);
      const got = attempt(() => applyMovePoint(indexed, v, x, y));
      const want = attempt(() => legacyApplyMovePoint(reference, v, x, y));
      expect(got, `chained step ${step} v=${v}`).toBe(want);
      expect(coordSignature(indexed)).toBe(coordSignature(reference));
      if (got === 'APPLIED') applied += 1;
      probeNoFalseNegatives(indexed, ensureEditEdgeSpatialIndex(indexed), rng);
    }
    expect(applied).toBeGreaterThan(20);
  });

  it('index-after-topology: swap / add-line / delete-point between moves keep parity', () => {
    const baseline = gridBaseline(6);
    const indexed = stateOf(baseline);
    const reference = stateOf(baseline);
    const rng = mulberry32(97);

    const moveBoth = (v: number, x: number, y: number, label: string): void => {
      const got = attempt(() => applyMovePoint(indexed, v, x, y));
      const want = attempt(() => legacyApplyMovePoint(reference, v, x, y));
      expect(got, label).toBe(want);
      expect(coordSignature(indexed), `${label}: coords`).toBe(coordSignature(reference));
      probeNoFalseNegatives(indexed, ensureEditEdgeSpatialIndex(indexed), rng);
    };
    const topologyBoth = (run: (_state: EditMeshState) => void, label: string): void => {
      run(indexed);
      run(reference);
      expect(indexed.edgeMap.size, `${label}: topology`).toBe(reference.edgeMap.size);
      expect(indexed.edgeMap.size, `${label}: index tracked edgeMap`).toBe(ensureEditEdgeSpatialIndex(indexed).edgeCount);
    };

    // First move attaches the index; later topology changes must maintain it.
    moveBoth(centerMostMovable(indexed), 1.05, 1.05, 'move before swap');
    topologyBoth((state) => swapDiagonal(state, 7, 13), 'swap'); // 2→1 keep on the shared edge
    moveBoth(centerMostMovable(indexed), 2.04, 1.96, 'move after swap');

    topologyBoth((state) => applyAddLine(state, 1, 11), 'add-line'); // crossed edges removed, new inserted
    moveBoth(centerMostMovable(indexed), 2.02, 2.02, 'move after add-line');

    topologyBoth((state) => applyDeletePoint(state, 8), 'delete-point'); // cavity retriangulation
    moveBoth(centerMostMovable(indexed), 0.96, 3.04, 'move after delete-point');

    topologyBoth((state) => applyAddPoint(state, 'ap2', 3.3, 2.4, 0), 'add-point');
    moveBoth(centerMostMovable(indexed), 4.02, 1.98, 'move after add-point');
  });

  it('a failed move leaves no stale bboxes behind', () => {
    const baseline = gridBaseline(5);
    const state = stateOf(baseline);
    const index = ensureEditEdgeSpatialIndex(state);
    const v = centerMostMovable(state);
    const before = index.queryCandidates(0, 0, 5, 5).map((rec) => `${rec.edgeKey}:${rec.minX},${rec.minY},${rec.maxX},${rec.maxY}`);

    // INVALID_STAR: target inside a neighbor triangle (kernel flips) but finite.
    const w = state.pts[oracleNeighbors(state, v)[0]];
    expect(attempt(() => applyMovePoint(state, v, w.x, w.y))).toBe('SURFACE_EDIT_MOVE_POINT_INVALID_STAR');
    // INTERSECTION-shaped failure on the foreign fixture is covered above; here
    // the point is that the revert restored coordinates AND bbox records.
    expect(state.pts[v].x).toBe(baseline.points[v].x);
    expect(index.queryCandidates(0, 0, 5, 5).map((rec) => `${rec.edgeKey}:${rec.minX},${rec.minY},${rec.maxX},${rec.maxY}`)).toEqual(before);

    // A later move still validates correctly against the untouched index.
    const p = state.pts[v];
    expect(attempt(() => applyMovePoint(state, v, p.x + 0.05, p.y + 0.05))).toBe('APPLIED');
    const moved = state.pts[v];
    const around = index.queryCandidates(moved.x, moved.y, moved.x, moved.y);
    expect(around.length).toBeGreaterThan(0);
    expect(around.every((rec) => rec.u === v || rec.v === v)).toBe(true);
    expect(around.length).toBe(oracleNeighbors(state, v).length);
  });
});

// ---------------------------------------------------------------------------
// Evidence: candidate-set reduction
// ---------------------------------------------------------------------------

describe('18V index evidence', () => {
  it('mid-size fixtures: candidates per move vs all unique edges (size-independent)', () => {
    for (const side of [60, 100]) {
      const baseline = gridBaseline(side);
      const state = stateOf(baseline);
      const index = ensureEditEdgeSpatialIndex(state);
      const allEdges = state.edgeMap.size;
      const movable = movableVertices(state);
      let tested = 0;
      let moves = 0;
      const rng = mulberry32(2026);
      for (let step = 0; step < 60; step += 1) {
        const v = movable[Math.floor(rng() * movable.length)];
        const p = state.pts[v];
        const x = p.x + (rng() - 0.5) * 0.02;
        const y = p.y + (rng() - 0.5) * 0.02;
        let stepCandidates = 0;
        for (const w of oracleNeighbors(state, v)) {
          const pw = state.pts[w];
          stepCandidates += index.queryCandidates(
            Math.min(x, pw.x),
            Math.min(y, pw.y),
            Math.max(x, pw.x),
            Math.max(y, pw.y),
          ).length;
        }
        tested += stepCandidates;
        moves += 1;
        expect(attempt(() => applyMovePoint(state, v, x, y))).toBe('APPLIED');
      }
      const perMove = tested / moves;
      console.info(
        `18V index: ${side}x${side} grid, ${allEdges} unique edges, ${index.cellCount} occupied cells, ` +
          `cellSize=${index.cellSize.toFixed(4)}, wide=${index.wideCount}, ` +
          `candidates tested/move=${perMove.toFixed(1)} (all edges ${allEdges}, reduction ${(allEdges / perMove).toFixed(0)}x)`,
      );
      expect(allEdges).toBeGreaterThan(10_000);
      expect(index.wideCount).toBe(0);
      expect(perMove).toBeLessThan(allEdges / 20);
      expect(perMove).toBeLessThan(300);
    }
  });
});

// ---------------------------------------------------------------------------
// Exact active-point location index (reviewer gate 10)
// ---------------------------------------------------------------------------

/** Brute-force active scan — the pre-index coincidence oracle. */
const scanCoincident = (state: EditMeshState, x: number, y: number): number => {
  for (let i = 0; i < state.pts.length; i += 1) {
    if (!state.active[i]) continue;
    const p = state.pts[i];
    if (p.x === x && p.y === y) return i;
  }
  return -1;
};

const distinctActivePositions = (state: EditMeshState): Set<string> => {
  const out = new Set<string>();
  for (let i = 0; i < state.pts.length; i += 1) {
    if (state.active[i]) out.add(`${state.pts[i].x},${state.pts[i].y}`);
  }
  return out;
};

/** After any op the map must agree with a full active scan, with no stale keys. */
const assertPointIndexMatchesScan = (state: EditMeshState): void => {
  const index = ensureEditPointLocationIndex(state);
  const positions = distinctActivePositions(state);
  for (let i = 0; i < state.pts.length; i += 1) {
    if (!state.active[i]) continue;
    const { x, y } = state.pts[i];
    expect(index.find(x, y), `active v${i} not locatable`).toBeGreaterThanOrEqual(0);
  }
  for (const key of positions) {
    const [x, y] = key.split(',').map(Number) as [number, number];
    expect(index.find(x, y) >= 0, `position ${key}`).toBe(scanCoincident(state, x, y) >= 0);
  }
  // No missing and no stale entries: map size === distinct active positions.
  expect(index.size, 'map size must equal distinct active positions').toBe(positions.size);
};

const refsOfIndices = (indices: number[]): Array<{ key: string }> =>
  indices.map((v) => ({ key: `source:p${v}` }));

describe('18V exact active-point location index', () => {
  it('mixed add/delete/move/bulk stack keeps the map exact after every op', () => {
    const state = stateOf(gridBaseline(6));
    assertPointIndexMatchesScan(state);

    applyAddPoint(state, 'a1', 1.4, 1.6, 0);
    assertPointIndexMatchesScan(state);

    const removed = centerMostMovable(state);
    const removedX = state.pts[removed].x;
    const removedY = state.pts[removed].y;
    applyDeletePoint(state, removed);
    assertPointIndexMatchesScan(state);
    if (scanCoincident(state, removedX, removedY) < 0) {
      expect(ensureEditPointLocationIndex(state).find(removedX, removedY)).toBe(-1);
    }

    const moved = centerMostMovable(state);
    const oldX = state.pts[moved].x;
    const oldY = state.pts[moved].y;
    const newX = oldX + 0.03;
    const newY = oldY + 0.017;
    applyMovePoint(state, moved, newX, newY);
    expect(ensureEditPointLocationIndex(state).find(newX, newY)).toBe(moved);
    expect(ensureEditPointLocationIndex(state).find(oldX, oldY)).toBeLessThan(0);
    assertPointIndexMatchesScan(state);

    // Simultaneous bulk move: the shared commit seam must re-key every mover.
    const bulk = movableVertices(state).slice(0, 3);
    expect(bulk.length).toBe(3);
    const before = bulk.map((v) => [state.pts[v].x, state.pts[v].y] as const);
    applyMovePointsVertices(state, refsOfIndices(bulk), 0.02, 0.01);
    for (const [at, v] of bulk.entries()) {
      expect(ensureEditPointLocationIndex(state).find(before[at][0], before[at][1])).toBeLessThan(0);
      expect(ensureEditPointLocationIndex(state).find(state.pts[v].x, state.pts[v].y)).toBeGreaterThanOrEqual(0);
    }
    assertPointIndexMatchesScan(state);
  });

  it('rekey handles simultaneous position swaps (bulk collision seam)', () => {
    const state = stateOf(meshOf([[0, 0], [1, 0], [2, 0]], [[0, 1, 2]]));
    const index = ensureEditPointLocationIndex(state);
    // A->B, B->C, C->A in one commit, in each order: the new position of one
    // mover is the old position of the next. Unconditional overwrite is what
    // keeps all three locatable afterwards.
    index.rekey(0, 1, 0);
    index.rekey(1, 2, 0);
    index.rekey(2, 0, 0);
    expect(index.find(1, 0)).toBe(0);
    expect(index.find(2, 0)).toBe(1);
    expect(index.find(0, 0)).toBe(2);
    expect(index.size).toBe(3);
  });

  it('randomized exact-coincidence move targets: full BLOCK/reason parity', () => {
    const indexed = stateOf(irregularBaseline(51, 16, 6));
    const reference = stateOf(irregularBaseline(51, 16, 6));
    const rng = mulberry32(51);
    let coincidenceBlocks = 0;
    for (let step = 0; step < 400; step += 1) {
      const movable = movableVertices(indexed);
      if (movable.length < 2) break;
      const v = movable[Math.floor(rng() * movable.length)];
      const others = movable.filter((w) => w !== v);
      const w = others[Math.floor(rng() * others.length)];
      const target = indexed.pts[w];
      const got = attempt(() => applyMovePoint(indexed, v, target.x, target.y));
      const want = attempt(() => legacyApplyMovePoint(reference, v, target.x, target.y));
      expect(got, `step ${step} v=${v} w=${w} -> (${target.x},${target.y})`).toBe(want);
      expect(coordSignature(indexed), `step ${step}: coords`).toBe(coordSignature(reference));
      if (got === 'SURFACE_EDIT_MOVE_POINT_INVALID_STAR') coincidenceBlocks += 1;
    }
    expect(coincidenceBlocks).toBeGreaterThan(0);
  });

  it('add-point coincidence uses the maintained map (POINT_ALREADY_EXISTS)', () => {
    const state = stateOf(gridBaseline(6));
    let probe = 0;
    for (let v = 0; v < state.pts.length; v += 1) {
      if (!state.active[v]) continue;
      const p = state.pts[v];
      const got = attempt(() => applyAddPoint(state, `dup${probe++}`, p.x, p.y, 0));
      expect(got, `v=${v} must be coincident`).toBe('SURFACE_EDIT_POINT_ALREADY_EXISTS');
    }

    // Delete-point maintenance: the freed position is no longer a coincidence.
    const removed = centerMostMovable(state);
    const { x, y } = state.pts[removed];
    applyDeletePoint(state, removed);
    expect(attempt(() => applyAddPoint(state, 'after-del', x, y, 0))).not.toBe('SURFACE_EDIT_POINT_ALREADY_EXISTS');

    // Move maintenance: old position free, new position occupied.
    const w = centerMostMovable(state);
    const oldX = state.pts[w].x;
    const oldY = state.pts[w].y;
    const newX = oldX + 0.03;
    const newY = oldY + 0.017;
    applyMovePoint(state, w, newX, newY);
    expect(attempt(() => applyAddPoint(state, 'at-old', oldX, oldY, 0))).not.toBe('SURFACE_EDIT_POINT_ALREADY_EXISTS');
    expect(attempt(() => applyAddPoint(state, 'at-new', newX, newY, 0))).toBe('SURFACE_EDIT_POINT_ALREADY_EXISTS');
  });

  it('keys are exact Float64 (no tolerance), including projected coordinates', () => {
    const exact = 0.1 + 0.2; // 0.30000000000000004
    const state = stateOf(meshOf([[exact, 0], [1, 0], [1, 1], [0, 1]], [[0, 1, 2], [0, 2, 3]]));
    const index = ensureEditPointLocationIndex(state);
    expect(index.find(exact, 0)).toBe(0);
    expect(index.find(0.3, 0)).toBe(-1);
    expect(index.find(exact + 1e-12, 0)).toBe(-1);

    const big = stateOf(
      meshOf(
        [[2_000_000, 7_000_000], [2_000_001, 7_000_000], [2_000_001, 7_000_001], [2_000_000, 7_000_001]],
        [[0, 1, 2], [0, 2, 3]],
      ),
    );
    const bigIndex = ensureEditPointLocationIndex(big);
    expect(bigIndex.find(2_000_000, 7_000_000)).toBe(0);
    expect(bigIndex.find(2_000_000 + 1e-9, 7_000_000)).toBe(-1);
  });

  it('lazy rebuild from current coordinates after bulk-style invalidation', () => {
    const state = stateOf(gridBaseline(5));
    const index = ensureEditPointLocationIndex(state);
    expect(index.find(0, 0)).toBe(0);
    // Simulate an untracked external XY write: the map is stale...
    const v = centerMostMovable(state);
    state.pts[v].x += 3.25;
    expect(index.find(state.pts[v].x, state.pts[v].y)).toBeLessThan(0);
    // ...so the explicit invalidation seam drops it and the next ensure rebuilds.
    invalidateEditEdgeSpatialIndex(state);
    const rebuilt = ensureEditPointLocationIndex(state);
    expect(rebuilt).not.toBe(index);
    expect(rebuilt.find(state.pts[v].x, state.pts[v].y)).toBe(v);
    assertPointIndexMatchesScan(state);
  });
});
