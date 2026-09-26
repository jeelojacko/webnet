/**
 * Phase 18Z — randomized composition parity corpus: frozen 18Y oracle vs
 * production `composeSurfaceMeshes`.
 *
 * Mission §§33-42: a seeded deterministic PRNG (mulberry32) generates small
 * grid-based Base/Overlay pairs across every composition shape class and the
 * two engines are compared geometrically/semantically — never by
 * implementation detail. Production may route a case through the
 * full-overlay / strict-disjoint fast paths or (once promoted) the exact
 * indexed constraint recovery, so the assertions are:
 *
 *   1. success/failure agreement (+ failure reason, + mismatch magnitude);
 *   2. result-domain area parity (relative 1e-9) and the overlap identity
 *      A(result) = A(base) + A(overlay) - A(overlap) on BOTH engines;
 *   3. dense XY probe sampling: inside/outside parity and Z parity (1e-9 rel)
 *      between the engines, plus an independent owner-plane check
 *      (overlay wins, else base, else outside);
 *   4. seamLength / maxSeamMismatch parity (true seam = a step, hidden
 *      boundary = an owner change whose planes agree — both must be reported
 *      identically);
 *   5. void parity (generated cases + explicit tags);
 *   6. no T-junctions in either output mesh (a vertex strictly inside another
 *      edge would mean the retriangulation is non-conforming);
 *   7. explicit `validateExplicitTinPayload` pass for both outputs.
 *
 * DIGEST RULE (deliberate): the two exact fast paths return canonical INPUT
 * topology (the overlay mesh, or the base-then-overlay concatenation) and
 * therefore legitimately differ from the 18Y oracle, which always
 * retriangulates. So digest equality is asserted ONLY for non-fast-path
 * cases. A case is treated as fast-path when its diagnostics match the
 * closed-form shapes exactly: full overlay ⇒ seamLength 0 ∧ overlap ==
 * A(base) ∧ result == A(overlay); strict disjoint ⇒ seamLength 0 ∧ overlap
 * == 0 ∧ result == A(base)+A(overlay). This is a conservative detector (a
 * vertex-only touch also suppresses the digest assert) and never weakens the
 * geometric comparisons.
 *
 * Agent tier: ~32 tiny cases, total runtime well under 60 s.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { orient2d } from 'robust-predicates';
import {
  createMeshView,
  locateInMesh,
  meshPlanimetricArea,
} from '../src/engine/cad/surfaces/compose/coverage';
import { buildTinTopology } from '../src/engine/cad/tin/tinTopology';
import {
  makeWebnetComposeProvenance,
  validateExplicitTinPayload,
} from '../src/engine/cad/cadImportedTin';
import type { ComposeMeshPoint, ComposeMeshTriangle } from '../src/engine/cad/surfaces/compose/coverage';
import type { ComposeResult, ComposeSourceMesh, ComposeSuccess } from '../src/engine/cad/surfaceCompose';

// The two engines are imported dynamically so a parallel indexed-recovery
// promotion (or any internal rework of the production module) never affects
// this corpus: only the exported behaviour is pinned.
type ComposeFn = (_base: ComposeSourceMesh, _overlay: ComposeSourceMesh) => ComposeResult;

let composeSurfaceMeshes!: ComposeFn;
let composeSurfaceMeshesReference!: ComposeFn;

// ---------------------------------------------------------------------------
// Deterministic PRNG + small grid builders
// ---------------------------------------------------------------------------

/** mulberry32 — fixed-seed deterministic PRNG. */
const mulberry32 = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const randInt = (rng: () => number, lo: number, hi: number): number =>
  lo + Math.floor(rng() * (hi - lo + 1));

const pick = <T>(rng: () => number, values: readonly T[]): T =>
  values[Math.floor(rng() * values.length)]!;

const SEED = 0x5eed_18;

interface GridSpec {
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

const gridPoints = (spec: GridSpec): ComposeMeshPoint[] => {
  const points: ComposeMeshPoint[] = [];
  for (let j = 0; j <= spec.ny; j += 1) {
    for (let i = 0; i <= spec.nx; i += 1) {
      const x = spec.x0 + i * spec.dx;
      const y = spec.y0 + j * spec.dy;
      points.push({ x, y, z: spec.z(x, y) });
    }
  }
  return points;
};

const gridTriangles = (spec: GridSpec): ComposeMeshTriangle[] => {
  const at = (i: number, j: number): number => j * (spec.nx + 1) + i;
  const triangles: ComposeMeshTriangle[] = [];
  for (let j = 0; j < spec.ny; j += 1) {
    for (let i = 0; i < spec.nx; i += 1) {
      if (spec.drop?.(i, j)) continue;
      const a = at(i, j);
      const b = at(i + 1, j);
      const c = at(i + 1, j + 1);
      const d = at(i, j + 1);
      if (spec.flip) triangles.push([a, b, d], [b, c, d]);
      else triangles.push([a, b, c], [a, c, d]);
    }
  }
  return triangles;
};

/** Build a ComposeSourceMesh from one grid block (adjacency derived). */
const meshFrom = (spec: GridSpec): ComposeSourceMesh => {
  const triangles = gridTriangles(spec);
  const points = gridPoints(spec);
  const { adjacency } = buildTinTopology(triangles.map(([a, b, c]) => ({ a, b, c })), new Map());
  return { surfaceId: spec.id, surfaceName: spec.id, revision: `rev:${spec.id}`, points, triangles, adjacency };
};

/** Build one mesh from several disjoint grid blocks (multiple islands). */
const meshFromParts = (id: string, specs: readonly GridSpec[]): ComposeSourceMesh => {
  const points: ComposeMeshPoint[] = [];
  const triangles: ComposeMeshTriangle[] = [];
  for (const spec of specs) {
    const offset = points.length;
    points.push(...gridPoints(spec));
    for (const [a, b, c] of gridTriangles(spec)) triangles.push([a + offset, b + offset, c + offset]);
  }
  const { adjacency } = buildTinTopology(triangles.map(([a, b, c]) => ({ a, b, c })), new Map());
  return { surfaceId: id, surfaceName: id, revision: `rev:${id}`, points, triangles, adjacency };
};

const plane = (a: number, b: number, c: number) =>
  (x: number, y: number): number => a + b * x + c * y;

const randomPlane = (rng: () => number): GridSpec['z'] =>
  plane(randInt(rng, 0, 40), pick(rng, [0, 0.05, 0.1, 0.2]), pick(rng, [0, 0.1, 0.25]));

// ---------------------------------------------------------------------------
// Case model
// ---------------------------------------------------------------------------

interface CorpusCase {
  name: string;
  category: string;
  base: ComposeSourceMesh;
  overlay: ComposeSourceMesh;
  expectation: 'ok' | 'seam';
  tags: string[];
  note: string;
}

type CaseBody = Omit<CorpusCase, 'name' | 'category'>;

const LARGE_X = 2_000_000;
const LARGE_Y = 7_000_000;

const buildCase = (category: string, rng: () => number, index: number): CaseBody => {
  switch (category) {
    case 'convex overlay': {
      const nx = randInt(rng, 3, 4);
      const ny = randInt(rng, 3, 4);
      const dx = randInt(rng, 2, 6);
      const dy = randInt(rng, 2, 6);
      const cw = randInt(rng, 1, nx - 2);
      const ch = randInt(rng, 1, ny - 2);
      const oi = randInt(rng, 1, nx - 1 - cw);
      const oj = randInt(rng, 1, ny - 1 - ch);
      const z = randomPlane(rng);
      return {
        base: meshFrom({ id: 'B', x0: 0, y0: 0, nx, ny, dx, dy, z }),
        overlay: meshFrom({ id: 'O', x0: oi * dx, y0: oj * dy, nx: cw, ny: ch, dx, dy, z, flip: rng() < 0.5 }),
        expectation: 'ok',
        tags: ['overlap', 'matching-seam'],
        note: 'strictly interior rectangular block on a matching plane',
      };
    }
    case 'concave overlay': {
      const nx = randInt(rng, 3, 4);
      const ny = randInt(rng, 3, 4);
      const dx = randInt(rng, 3, 6);
      const dy = randInt(rng, 3, 6);
      const z = randomPlane(rng);
      const corner = randInt(rng, 0, 3);
      const lastI = nx - 2;
      const lastJ = ny - 2;
      const drop = (i: number, j: number): boolean =>
        (corner === 0 && i === 0 && j === 0)
        || (corner === 1 && i === lastI && j === 0)
        || (corner === 2 && i === 0 && j === lastJ)
        || (corner === 3 && i === lastI && j === lastJ);
      return {
        base: meshFrom({ id: 'B', x0: 0, y0: 0, nx, ny, dx, dy, z }),
        overlay: meshFrom({ id: 'O', x0: dx, y0: dy, nx: nx - 1, ny: ny - 1, dx, dy, z, drop, flip: rng() < 0.5 }),
        expectation: 'ok',
        tags: ['overlap', 'matching-seam', 'concave'],
        note: 'interior block with a corner cell removed (concave ring)',
      };
    }
    case 'overlay void': {
      const dx = randInt(rng, 3, 6);
      const dy = randInt(rng, 3, 6);
      const z = randomPlane(rng);
      const vi = randInt(rng, 1, 1);
      const vj = randInt(rng, 1, 1);
      return {
        base: meshFrom({ id: 'B', x0: 0, y0: 0, nx: 3, ny: 3, dx, dy, z }),
        overlay: meshFrom({
          id: 'O', x0: 0, y0: 0, nx: 3, ny: 3, dx, dy, z, flip: rng() < 0.5,
          drop: (i, j) => i === vi && j === vj,
        }),
        expectation: 'ok',
        tags: ['overlay-void', 'overlap'],
        note: 'overlay void exposes the base underneath',
      };
    }
    case 'base void filled': {
      const dx = randInt(rng, 3, 6);
      const dy = randInt(rng, 3, 6);
      const z = randomPlane(rng);
      return {
        base: meshFrom({ id: 'B', x0: 0, y0: 0, nx: 3, ny: 3, dx, dy, z, drop: (i, j) => i === 1 && j === 1 }),
        overlay: meshFrom({ id: 'O', x0: dx, y0: dy, nx: 1, ny: 1, dx, dy, z, flip: rng() < 0.5 }),
        expectation: 'ok',
        tags: ['base-void-filled', 'touch'],
        note: 'overlay fills a base interior void exactly',
      };
    }
    case 'multiple islands': {
      const dx = randInt(rng, 4, 6);
      const dy = randInt(rng, 4, 6);
      const z = randomPlane(rng);
      return {
        base: meshFrom({ id: 'B', x0: 0, y0: 0, nx: 4, ny: 4, dx, dy, z }),
        overlay: meshFromParts('O', [
          { id: 'O1', x0: dx, y0: dy, nx: 1, ny: 1, dx, dy, z },
          { id: 'O2', x0: 3 * dx, y0: 3 * dy, nx: 1, ny: 1, dx, dy, z },
        ]),
        expectation: 'ok',
        tags: ['overlap', 'islands'],
        note: 'overlay is two disjoint islands over one base',
      };
    }
    case 'disjoint': {
      const nx = randInt(rng, 2, 3);
      const ny = randInt(rng, 2, 3);
      const dx = randInt(rng, 2, 5);
      const dy = randInt(rng, 2, 5);
      const z = randomPlane(rng);
      const gap = dx * (2 + randInt(rng, 1, 3));
      return {
        base: meshFrom({ id: 'B', x0: 0, y0: 0, nx, ny, dx, dy, z }),
        overlay: meshFrom({ id: 'O', x0: nx * dx + gap, y0: 0, nx, ny, dx, dy, z }),
        expectation: 'ok',
        tags: ['disjoint'],
        note: 'separated footprints, no interaction',
      };
    }
    case 'full overlay': {
      const nx = randInt(rng, 2, 3);
      const ny = randInt(rng, 2, 3);
      const dx = randInt(rng, 3, 6);
      const dy = randInt(rng, 3, 6);
      const z = randomPlane(rng);
      return {
        base: meshFrom({ id: 'B', x0: 0, y0: 0, nx, ny, dx, dy, z }),
        overlay: meshFrom({ id: 'O', x0: 0, y0: 0, nx, ny, dx, dy, z, flip: rng() < 0.5 }),
        expectation: 'ok',
        tags: ['full'],
        note: 'overlay covers the whole base footprint',
      };
    }
    case 'partial overlay': {
      const nx = 4;
      const ny = randInt(rng, 2, 3);
      const dx = randInt(rng, 3, 6);
      const dy = randInt(rng, 3, 6);
      const z = randomPlane(rng);
      const half = Math.floor(nx / 2);
      return {
        base: meshFrom({ id: 'B', x0: 0, y0: 0, nx, ny, dx, dy, z }),
        overlay: meshFrom({ id: 'O', x0: half * dx, y0: 0, nx: nx - half, ny, dx, dy, z, flip: rng() < 0.5 }),
        expectation: 'ok',
        tags: ['overlap', 'matching-seam'],
        note: 'overlay owns the right half; single internal seam',
      };
    }
    case 'narrow strip': {
      const dx = randInt(rng, 3, 6);
      const dy = randInt(rng, 3, 6);
      const z = randomPlane(rng);
      const oi = randInt(rng, 1, 2);
      return {
        base: meshFrom({ id: 'B', x0: 0, y0: 0, nx: 4, ny: 2, dx, dy, z }),
        overlay: meshFrom({ id: 'O', x0: oi * dx, y0: 0, nx: 1, ny: 2, dx, dy, z, flip: rng() < 0.5 }),
        expectation: 'ok',
        tags: ['overlap', 'matching-seam'],
        note: 'one-cell-wide overlay strip',
      };
    }
    case 'overlay edge through base vertex': {
      const dx = 2 * randInt(rng, 3, 6);
      const z = randomPlane(rng);
      const oi = randInt(rng, 1, 2);
      return {
        base: meshFrom({ id: 'B', x0: 0, y0: 0, nx: 4, ny: 2, dx, dy: dx, z }),
        overlay: meshFrom({ id: 'O', x0: oi * dx, y0: dx / 2, nx: 2, ny: 2, dx, dy: dx, z, flip: rng() < 0.5 }),
        expectation: 'ok',
        tags: ['overlap', 'matching-seam', 'vertex-touch'],
        note: 'overlay boundary passes exactly through base grid vertices',
      };
    }
    case 'collinear edges': {
      const dx = randInt(rng, 3, 6);
      const dy = randInt(rng, 3, 6);
      const z = randomPlane(rng);
      const base = meshFrom({ id: 'B', x0: 0, y0: 0, nx: 4, ny: 2, dx, dy, z });
      const overlay: ComposeSourceMesh = rng() < 0.5
        ? meshFrom({ id: 'O', x0: 4 * dx, y0: 0, nx: randInt(rng, 1, 2), ny: 2, dx, dy, z })
        : meshFrom({ id: 'O', x0: 4 * dx, y0: 0, nx: 1, ny: 1, dx: 2 * dx, dy: 2 * dy, z });
      return {
        base,
        overlay,
        expectation: 'ok',
        tags: ['touch', 'matching-seam', 'collinear'],
        note: 'shared right edge, matched or differently subdivided',
      };
    }
    case 'flipped diagonals': {
      const nx = randInt(rng, 3, 4);
      const ny = randInt(rng, 3, 4);
      const dx = randInt(rng, 3, 6);
      const dy = randInt(rng, 3, 6);
      const z = randomPlane(rng);
      const baseFlip = rng() < 0.5;
      const cw = randInt(rng, 1, nx - 2);
      const ch = randInt(rng, 1, ny - 2);
      const oi = randInt(rng, 1, nx - 1 - cw);
      const oj = randInt(rng, 1, ny - 1 - ch);
      return {
        base: meshFrom({ id: 'B', x0: 0, y0: 0, nx, ny, dx, dy, z, flip: baseFlip }),
        overlay: meshFrom({ id: 'O', x0: oi * dx, y0: oj * dy, nx: cw, ny: ch, dx, dy, z, flip: !baseFlip }),
        expectation: 'ok',
        tags: ['overlap', 'matching-seam'],
        note: 'same plane, opposite diagonal orientation',
      };
    }
    case 'ridge': {
      const dx = 6;
      const dy = 6;
      const base = randInt(rng, 10, 30);
      const xc = 2 * dx;
      const yc = 2 * dy;
      const z = (x: number, y: number): number =>
        base + 0.05 * x + 0.1 * y + 0.002 * ((x - xc) * (x - xc) + (y - yc) * (y - yc));
      const cw = randInt(rng, 1, 2);
      const ch = randInt(rng, 1, 2);
      const oi = randInt(rng, 1, 4 - 1 - cw);
      const oj = randInt(rng, 1, 4 - 1 - ch);
      return {
        base: meshFrom({ id: 'B', x0: 0, y0: 0, nx: 4, ny: 4, dx, dy, z }),
        overlay: meshFrom({ id: 'O', x0: oi * dx, y0: oj * dy, nx: cw, ny: ch, dx, dy, z, flip: rng() < 0.5 }),
        expectation: 'ok',
        tags: ['overlap', 'matching-seam', 'ridge'],
        note: 'nonlinear base (ridge); overlay shares grid vertices so the seam agrees',
      };
    }
    case 'matching seam': {
      const nx = 4;
      const ny = randInt(rng, 2, 3);
      const dx = randInt(rng, 3, 6);
      const dy = randInt(rng, 3, 6);
      const z = randomPlane(rng);
      return {
        base: meshFrom({ id: 'B', x0: 0, y0: 0, nx, ny, dx, dy, z }),
        overlay: meshFrom({ id: 'O', x0: 2 * dx, y0: -dy, nx: 3, ny: ny + 1, dx, dy, z, flip: rng() < 0.5 }),
        expectation: 'ok',
        tags: ['overlap', 'matching-seam'],
        note: 'overlay crosses the base boundary on one side (hidden boundary)',
      };
    }
    case 'mismatching seam': {
      const nx = 4;
      const ny = randInt(rng, 2, 3);
      const dx = randInt(rng, 3, 6);
      const dy = randInt(rng, 3, 6);
      const a = randInt(rng, 0, 20);
      const b = pick(rng, [0, 0.1]);
      const c = pick(rng, [0, 0.2]);
      return {
        base: meshFrom({ id: 'B', x0: 0, y0: 0, nx, ny, dx, dy, z: plane(a, b, c) }),
        overlay: meshFrom({ id: 'O', x0: 2 * dx, y0: 0, nx: 2, ny, dx, dy, z: plane(a + 0.5, b, c), flip: rng() < 0.5 }),
        expectation: 'seam',
        tags: ['mismatch'],
        note: 'partial overlap with a 0.5 m step at the seam',
      };
    }
    case 'large-coordinate shift': {
      const dx = randInt(rng, 3, 6);
      const dy = randInt(rng, 3, 6);
      const z = plane(randInt(rng, 50, 150), pick(rng, [0, 0.1]), pick(rng, [0, 0.2]));
      const voidVariant = index % 2 === 1;
      return {
        base: meshFrom({ id: 'B', x0: LARGE_X, y0: LARGE_Y, nx: 4, ny: 3, dx, dy, z }),
        overlay: voidVariant
          ? meshFrom({
            id: 'O', x0: LARGE_X, y0: LARGE_Y, nx: 4, ny: 3, dx, dy, z,
            drop: (i, j) => i === 1 && j === 1,
          })
          : meshFrom({ id: 'O', x0: LARGE_X + 2 * dx, y0: LARGE_Y, nx: 2, ny: 3, dx, dy, z, flip: rng() < 0.5 }),
        expectation: 'ok',
        tags: voidVariant ? ['overlay-void', 'overlap', 'large-coordinate'] : ['overlap', 'matching-seam', 'large-coordinate'],
        note: 'same shapes shifted to E=2e6 / N=7e6',
      };
    }
    default:
      throw new Error(`unknown corpus category: ${category}`);
  }
};

const CATEGORY_COUNTS: ReadonlyArray<readonly [string, number]> = [
  ['convex overlay', 2],
  ['concave overlay', 2],
  ['overlay void', 2],
  ['base void filled', 1],
  ['multiple islands', 1],
  ['disjoint', 2],
  ['full overlay', 2],
  ['partial overlay', 2],
  ['narrow strip', 1],
  ['overlay edge through base vertex', 1],
  ['collinear edges', 1],
  ['flipped diagonals', 2],
  ['ridge', 1],
  ['matching seam', 2],
  ['mismatching seam', 2],
  ['large-coordinate shift', 2],
];

const handPickedCases = (): CorpusCase[] => {
  const z0 = plane(5, 0, 0);
  const z3 = plane(3, 0, 0);
  return [
    {
      name: 'hand #1 vertex touch only',
      category: 'hand-picked',
      base: meshFrom({ id: 'B', x0: 0, y0: 0, nx: 2, ny: 2, dx: 10, dy: 10, z: z0 }),
      overlay: meshFrom({ id: 'O', x0: 20, y0: 20, nx: 2, ny: 2, dx: 10, dy: 10, z: z0 }),
      expectation: 'ok',
      tags: ['touch'],
      note: 'single shared corner vertex, no shared edge',
    },
    {
      name: 'hand #2 corner notch bridged',
      category: 'hand-picked',
      base: meshFrom({ id: 'B', x0: 0, y0: 0, nx: 3, ny: 3, dx: 10, dy: 10, z: z3, drop: (i, j) => i === 2 && j === 2 }),
      overlay: meshFrom({ id: 'O', x0: 20, y0: 20, nx: 1, ny: 1, dx: 10, dy: 10, z: z3 }),
      expectation: 'ok',
      tags: ['base-void-filled', 'touch'],
      note: 'overlay fills a base corner notch exactly',
    },
    {
      name: 'hand #3 overlay corner void',
      category: 'hand-picked',
      base: meshFrom({ id: 'B', x0: 0, y0: 0, nx: 3, ny: 3, dx: 10, dy: 10, z: z3 }),
      overlay: meshFrom({ id: 'O', x0: 0, y0: 0, nx: 3, ny: 3, dx: 10, dy: 10, z: z3, drop: (i, j) => i === 0 && j === 0 }),
      expectation: 'ok',
      tags: ['overlay-void'],
      note: 'void on the overlay boundary exposes the base corner',
    },
    {
      name: 'hand #4 base vertex mid overlay edge',
      category: 'hand-picked',
      base: meshFrom({ id: 'B', x0: 0, y0: 0, nx: 4, ny: 1, dx: 5, dy: 5, z: z0 }),
      overlay: meshFrom({ id: 'O', x0: 20, y0: 0, nx: 1, ny: 1, dx: 10, dy: 10, z: z0 }),
      expectation: 'ok',
      tags: ['touch', 'matching-seam', 'collinear'],
      note: 'collinear shared edge, different subdivision (T-junction stressor)',
    },
    {
      name: 'hand #5 sub-epsilon seam delta',
      category: 'hand-picked',
      base: meshFrom({ id: 'B', x0: 0, y0: 0, nx: 4, ny: 3, dx: 10, dy: 10, z: plane(0, 0, 0) }),
      overlay: meshFrom({ id: 'O', x0: 20, y0: 0, nx: 2, ny: 3, dx: 10, dy: 10, z: plane(5e-16, 0, 0), flip: true }),
      expectation: 'ok',
      tags: ['overlap', 'matching-seam', 'epsilon'],
      note: 'Z delta 5e-16 inside the numerical zero floor snaps to 0',
    },
    {
      name: 'hand #6 large-coordinate mismatching seam',
      category: 'hand-picked',
      base: meshFrom({ id: 'B', x0: LARGE_X, y0: LARGE_Y, nx: 4, ny: 3, dx: 5, dy: 5, z: plane(100, 0.1, 0.2) }),
      overlay: meshFrom({ id: 'O', x0: LARGE_X + 10, y0: LARGE_Y, nx: 2, ny: 3, dx: 5, dy: 5, z: plane(100.5, 0.1, 0.2) }),
      expectation: 'seam',
      tags: ['large-coordinate', 'mismatch'],
      note: '0.5 m step at E=2e6 / N=7e6 must still fail closed',
    },
  ];
};

const buildCorpus = (seed: number): CorpusCase[] => {
  const cases: CorpusCase[] = [];
  for (const [category, count] of CATEGORY_COUNTS) {
    const rng = mulberry32(seed + cases.length * 0x9e3779b1);
    for (let index = 0; index < count; index += 1) {
      const body = buildCase(category, rng, index);
      cases.push({ ...body, category, name: `${category} #${index + 1}` });
    }
  }
  return [...cases, ...handPickedCases()];
};

const CORPUS = buildCorpus(SEED);

// ---------------------------------------------------------------------------
// Comparison harness
// ---------------------------------------------------------------------------

const isClose = (a: number, b: number, rel = 1e-9): boolean =>
  Math.abs(a - b) <= rel * Math.max(1, Math.abs(a), Math.abs(b));

const pointsOf = (vertices: readonly number[]): ComposeMeshPoint[] => {
  const points: ComposeMeshPoint[] = [];
  for (let i = 0; i < vertices.length; i += 3) {
    points.push({ x: vertices[i]!, y: vertices[i + 1]!, z: vertices[i + 2]! });
  }
  return points;
};

const trianglesOf = (faces: readonly number[]): ComposeMeshTriangle[] => {
  const triangles: ComposeMeshTriangle[] = [];
  for (let i = 0; i < faces.length; i += 3) {
    triangles.push([faces[i]!, faces[i + 1]!, faces[i + 2]!]);
  }
  return triangles;
};

const successView = (result: ComposeSuccess) =>
  createMeshView(pointsOf(result.vertices), trianglesOf(result.faces));

/**
 * Conforming-mesh check: no used vertex may lie strictly inside another
 * output edge (a T-junction). Exact orientation via robust-predicates;
 * collinear-and-between is the only failure. Edges are deduplicated.
 */
const hasTJunction = (vertices: readonly number[], faces: readonly number[]): boolean => {
  const used = Array.from(new Set(faces));
  const edges = new Map<string, readonly [number, number]>();
  for (let i = 0; i < faces.length; i += 3) {
    const a = faces[i]!;
    const b = faces[i + 1]!;
    const c = faces[i + 2]!;
    for (const [p, q] of [[a, b], [b, c], [c, a]] as const) {
      const key = p < q ? `${p}|${q}` : `${q}|${p}`;
      if (!edges.has(key)) edges.set(key, [Math.min(p, q), Math.max(p, q)]);
    }
  }
  for (const [a, b] of edges.values()) {
    const ax = vertices[a * 3]!;
    const ay = vertices[a * 3 + 1]!;
    const bx = vertices[b * 3]!;
    const by = vertices[b * 3 + 1]!;
    for (const v of used) {
      if (v === a || v === b) continue;
      const vx = vertices[v * 3]!;
      const vy = vertices[v * 3 + 1]!;
      if ((vx === ax && vy === ay) || (vx === bx && vy === by)) continue;
      if (orient2d(ax, ay, bx, by, vx, vy) !== 0) continue;
      if ((vx - ax) * (bx - vx) + (vy - ay) * (by - vy) > 0) return true;
    }
  }
  return false;
};

interface ProbeStats { baseOnly: number; overlayOnly: number; both: number; outside: number; }

const unionBox = (meshes: readonly ComposeSourceMesh[]) => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const mesh of meshes) {
    for (const p of mesh.points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  return { minX, minY, maxX, maxY };
};

/**
 * Dense probe parity: inside/outside and Z (relative 1e-9) agreement between
 * the two engines, plus an independent owner-plane expectation. Probe
 * coordinates sit at fractional offsets of the union bbox so they never
 * coincide with mesh vertices or edges.
 */
const probeParity = (
  c: CorpusCase,
  baseView: ReturnType<typeof createMeshView>,
  overlayView: ReturnType<typeof createMeshView>,
  prod: ComposeSuccess,
  ref: ComposeSuccess,
): ProbeStats => {
  const prodView = successView(prod);
  const refView = successView(ref);
  const box = unionBox([c.base, c.overlay]);
  const spanX = Math.max(box.maxX - box.minX, 1e-9);
  const spanY = Math.max(box.maxY - box.minY, 1e-9);
  const n = 7;
  const stats: ProbeStats = { baseOnly: 0, overlayOnly: 0, both: 0, outside: 0 };
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      const x = box.minX + (i + 0.37) * (spanX / n);
      const y = box.minY + (j + 0.41) * (spanY / n);
      const zo = locateInMesh(overlayView, x, y);
      const zb = locateInMesh(baseView, x, y);
      const expectedInside = zo != null || zb != null;
      const expectedZ = zo != null ? zo.z : zb?.z ?? null;
      if (zo && zb) stats.both += 1;
      else if (zo) stats.overlayOnly += 1;
      else if (zb) stats.baseOnly += 1;
      else stats.outside += 1;

      const prodGot = locateInMesh(prodView, x, y);
      const refGot = locateInMesh(refView, x, y);
      const at = `${x.toFixed(3)},${y.toFixed(3)}`;
      expect(prodGot != null, `${c.name} engine domain @${at}`).toBe(refGot != null);
      expect(prodGot != null, `${c.name} owner domain @${at}`).toBe(expectedInside);
      if (prodGot && refGot) {
        expect(Math.abs(prodGot.z - refGot.z), `${c.name} cross-engine Z @${at}`)
          .toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(prodGot.z), Math.abs(refGot.z)));
      }
      if (prodGot && expectedZ != null) {
        expect(Math.abs(prodGot.z - expectedZ), `${c.name} owner Z @${at}`)
          .toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(expectedZ)));
      }
    }
  }
  return stats;
};

const checkCase = (c: CorpusCase): void => {
  const baseView = createMeshView(c.base.points, c.base.triangles);
  const overlayView = createMeshView(c.overlay.points, c.overlay.triangles);
  const baseArea = meshPlanimetricArea(baseView);
  const overlayArea = meshPlanimetricArea(overlayView);

  const prod = composeSurfaceMeshes(c.base, c.overlay);
  const ref = composeSurfaceMeshesReference(c.base, c.overlay);

  // 1. success/failure agreement (+ failure reason)
  expect(prod.ok, `${c.name} production ok`).toBe(ref.ok);
  if (c.expectation === 'seam') {
    expect(prod.ok, `${c.name} expected seam failure`).toBe(false);
    expect(ref.ok, `${c.name} expected reference seam failure`).toBe(false);
    if (!prod.ok) expect(prod.reason).toBe('SURFACE_COMPOSE_SEAM_Z_MISMATCH');
    if (!ref.ok) expect(ref.reason).toBe('SURFACE_COMPOSE_SEAM_Z_MISMATCH');
  } else {
    expect(prod.ok, `${c.name} expected success`).toBe(true);
    expect(ref.ok, `${c.name} expected reference success`).toBe(true);
  }
  if (!prod.ok || !ref.ok) {
    if (!prod.ok && !ref.ok) {
      expect(prod.reason, `${c.name} failure reason`).toBe(ref.reason);
      if (prod.reason === 'SURFACE_COMPOSE_SEAM_Z_MISMATCH' && ref.reason === 'SURFACE_COMPOSE_SEAM_Z_MISMATCH') {
        expect(isClose(prod.maxMismatch, ref.maxMismatch), `${c.name} mismatch magnitude`).toBe(true);
      }
    }
    return;
  }

  // 2. result-domain area parity + overlap identity on BOTH engines
  for (const [engine, result] of [['production', prod], ['reference', ref]] as const) {
    const d = result.diagnostics;
    expect(isClose(d.overlayArea, overlayArea), `${c.name} ${engine} overlay area`).toBe(true);
    expect(isClose(d.resultArea, meshPlanimetricArea(successView(result))), `${c.name} ${engine} result area`).toBe(true);
    expect(isClose(d.overlapArea, baseArea + overlayArea - d.resultArea), `${c.name} ${engine} overlap identity`).toBe(true);
    expect(isClose(d.baseOnlyArea, d.resultArea - d.overlayArea), `${c.name} ${engine} base-only area`).toBe(true);
    expect(d.outputVertexCount).toBe(result.vertices.length / 3);
    expect(d.outputTriangleCount).toBe(result.faces.length / 3);
  }
  expect(isClose(prod.diagnostics.resultArea, ref.diagnostics.resultArea), `${c.name} cross-engine result area`).toBe(true);
  expect(isClose(prod.diagnostics.overlapArea, ref.diagnostics.overlapArea), `${c.name} cross-engine overlap area`).toBe(true);
  expect(isClose(prod.diagnostics.baseOnlyArea, ref.diagnostics.baseOnlyArea), `${c.name} cross-engine base-only area`).toBe(true);

  // 3. dense probe parity (also void/ownership parity)
  const stats = probeParity(c, baseView, overlayView, prod, ref);

  // 4. seam parity: true seam (a step) vs hidden boundary (matching planes)
  expect(isClose(prod.diagnostics.seamLength, ref.diagnostics.seamLength), `${c.name} seam length`).toBe(true);
  expect(isClose(prod.diagnostics.maxSeamMismatch, ref.diagnostics.maxSeamMismatch), `${c.name} max seam mismatch`).toBe(true);
  if (c.tags.includes('matching-seam')) {
    expect(prod.diagnostics.seamLength, `${c.name} seam exposed`).toBeGreaterThan(0);
    expect(ref.diagnostics.seamLength, `${c.name} reference seam exposed`).toBeGreaterThan(0);
    expect(prod.diagnostics.maxSeamMismatch, `${c.name} hidden boundary agrees`).toBe(0);
  }
  if (c.tags.includes('full') || c.tags.includes('disjoint')) {
    expect(prod.diagnostics.seamLength, `${c.name} no seam`).toBe(0);
  }
  if (c.tags.includes('overlay-void')) {
    expect(prod.diagnostics.baseOnlyArea, `${c.name} void exposes base`).toBeGreaterThan(0);
    expect(stats.baseOnly, `${c.name} void probed`).toBeGreaterThan(0);
  }
  if (c.tags.includes('base-void-filled')) {
    expect(isClose(prod.diagnostics.overlapArea, 0), `${c.name} filled void has no overlap`).toBe(true);
    expect(isClose(prod.diagnostics.resultArea, baseArea + overlayArea), `${c.name} filled void sums`).toBe(true);
  }

  // 5. conforming output: no T-junctions (every edge intersects only at shared vertices)
  expect(hasTJunction(prod.vertices, prod.faces), `${c.name} production T-junction`).toBe(false);
  expect(hasTJunction(ref.vertices, ref.faces), `${c.name} reference T-junction`).toBe(false);

  // 6. explicit validation pass
  const provenance = makeWebnetComposeProvenance({
    baseSurfaceId: c.base.surfaceId,
    baseSurfaceName: c.base.surfaceName,
    baseRevision: c.base.revision,
    overlaySurfaceId: c.overlay.surfaceId,
    overlaySurfaceName: c.overlay.surfaceName,
    overlayRevision: c.overlay.revision,
  });
  expect(validateExplicitTinPayload({ vertices: prod.vertices, faces: prod.faces, provenance })).toBeNull();
  expect(validateExplicitTinPayload({ vertices: ref.vertices, faces: ref.faces, provenance })).toBeNull();

  // 7. digest equality ONLY for non-fast-path cases (see header DIGEST RULE)
  const fullOverlayFast = prod.diagnostics.seamLength === 0
    && isClose(prod.diagnostics.overlapArea, baseArea)
    && isClose(prod.diagnostics.resultArea, overlayArea);
  const strictDisjointFast = prod.diagnostics.seamLength === 0
    && isClose(prod.diagnostics.overlapArea, 0)
    && isClose(prod.diagnostics.resultArea, baseArea + overlayArea);
  if (!fullOverlayFast && !strictDisjointFast) {
    expect(prod.digest, `${c.name} non-fast-path digest`).toBe(ref.digest);
  }
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Phase 18Z randomized composition parity corpus', () => {
  beforeAll(async () => {
    const production = await import('../src/engine/cad/surfaceCompose');
    const reference = await import('../src/engine/cad/surfaces/compose/composeReference18y');
    composeSurfaceMeshes = production.composeSurfaceMeshes;
    composeSurfaceMeshesReference = reference.composeSurfaceMeshesReference;
  });

  it('covers every required category with a deterministic seeded corpus', () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(30);
    const categories = new Set(CORPUS.map((c) => c.category));
    for (const [category] of CATEGORY_COUNTS) expect(categories.has(category)).toBe(true);
    expect(categories.has('hand-picked')).toBe(true);
    expect(new Set(CORPUS.map((c) => c.name)).size).toBe(CORPUS.length);
    // Same seed ⇒ identical case list (determinism contract).
    expect(buildCorpus(SEED).map((c) => c.name)).toEqual(CORPUS.map((c) => c.name));
  });

  it.each(CORPUS)('$category :: $name', (c) => {
    checkCase(c);
  });
});