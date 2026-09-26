/**
 * Phase 18Z — exact-composition performance evidence (manual/evidence tier).
 *
 * Measures the PRODUCTION `composeSurfaceMeshes` (fast paths + indexed
 * recovery) across 1k/10k/50k/100k total-vertex pairs, and the frozen 18Y
 * `composeSurfaceMeshesReference` at 1k/10k ONLY (it is the O(n²) oracle —
 * never run it above 10k).
 *
 * Cases (grid builders mirror tests/evidence/phase18y_compose_perf.test.ts):
 *   - disjoint       strict disjoint (fast-path oracle)
 *   - full-overlay   overlay contains the base (fast-path oracle)
 *   - partial-seam   small overlay island nested in a large base (seam-local oracle)
 *   - half-seam      18Y right-half seam (old-vs-new continuity)
 *   - complex-seam   L-shaped intersecting seam (18Y intersecting-seam)
 *
 * NO CI timing thresholds: this suite records numbers and asserts only that
 * every case still returns a valid result. Run with
 * `npx vitest run --config vitest.evidence.config.ts` plus env filters:
 *
 *   PHASE18Z_PERF_SIZES=1000,10000        size list (default all four)
 *   PHASE18Z_PERF_CASES=disjoint,full-overlay
 *   PHASE18Z_PERF_STAGE_SIZES=1000,10000  sub-stage timings (default 1k/10k)
 *   PHASE18Z_PERF_REFERENCE=0             skip the old reference oracle
 *   PHASE18Z_PERF_REPS / _REF_REPS        repetition counts
 *   PHASE18Z_PERF_OUT=/tmp/table.md
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { execFileSync } from 'node:child_process';

import { composeSurfaceMeshes, type ComposeResult, type ComposeSourceMesh } from '../../src/engine/cad/surfaceCompose';
import { composeSurfaceMeshesReference } from '../../src/engine/cad/surfaces/compose/composeReference18y';
import {
  extractRetainedComponents,
  tryFullOverlayFastPath,
  tryStrictDisjointFastPath,
} from '../../src/engine/cad/surfaces/compose/composeFastPaths';
import { createMeshView, locateInMesh } from '../../src/engine/cad/surfaces/compose/coverage';
import type { ComposeMeshView } from '../../src/engine/cad/surfaces/compose/coverage';
import { buildComposePslg, extractBoundaryEdges } from '../../src/engine/cad/surfaces/compose/pslg';
import { buildTinTopology } from '../../src/engine/cad/tin/tinTopology';

interface Grid {
  points: Array<{ x: number; y: number; z: number }>;
  triangles: Array<[number, number, number]>;
}

const baseZ = (x: number, y: number): number => 100 + 0.1 * x + 0.2 * y;

/** Structured CCW grid; `flip` swaps the diagonal, `skip` drops a cell (18Y builder). */
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

/** 18Y-compatible geometry plus the nested-island seam-local oracle. */
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
      // Nested-domain oracle: a small overlay island centered in a large base.
      const islandSide = Math.max(2, Math.round(side / 4));
      const offset = Math.floor((side - islandSide) / 2);
      return {
        base: grid(0, 0, side, cell, baseZ),
        overlay: grid(offset * cell, offset * cell, islandSide, cell, baseZ),
      };
    },
  },
  {
    name: 'half-seam',
    build: (side, cell) => {
      const half = Math.max(1, Math.floor(side / 2));
      return {
        base: grid(0, 0, side, cell, baseZ),
        overlay: grid(half * cell, 0, side - half, cell, baseZ),
      };
    },
  },
  {
    name: 'complex-seam',
    build: (side, cell) => {
      const mid = Math.floor(side / 2);
      return {
        base: grid(0, 0, side, cell, baseZ),
        overlay: grid(0, 0, side, cell, baseZ, { skip: (i, j) => i >= mid && j >= mid }),
      };
    },
  },
];

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

const ms = (fn: () => void): number => {
  const t = performance.now();
  fn();
  return performance.now() - t;
};

const timeReps = (reps: number, fn: () => void): number => {
  const samples: number[] = [];
  for (let r = 0; r < reps; r += 1) samples.push(ms(fn));
  return median(samples);
};

const heapDeltaMb = (): { before: number; after: () => number } => {
  const g = globalThis as { gc?: () => void };
  g.gc?.();
  const before = process.memoryUsage().heapUsed;
  return { before, after: () => (process.memoryUsage().heapUsed - before) / 1e6 };
};

const adjacencyOf = (triangles: ReadonlyArray<readonly [number, number, number]>) =>
  buildTinTopology(
    triangles.map(([a, b, c]) => ({ a, b, c })),
    new Map(),
  ).adjacency;

interface ClassCounts {
  outside: number;
  inside: number;
  touched: number;
}

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const boxOf = (points: ReadonlyArray<{ x: number; y: number }>): Box => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
};

/**
 * ESTIMATE of base-triangle coverage class from overlay coverage views:
 * centroid + vertices located via the grid index, with the O(T) whole-view
 * fallback suppressed (a missing cell counts as not-located). Exact area
 * clipping per triangle is deliberately not used here — it would dominate
 * the measured runtime at 100k. `inside` = fully covered by overlay,
 * `outside` = no sample inside, `touched` = boundary-straddling.
 */
const classifyBaseTriangles = (
  base: ComposeSourceMesh,
  overlayView: ComposeMeshView,
  overlayBox: Box,
): ClassCounts => {
  const eps = 1e-9;
  const inBox = (x: number, y: number): boolean =>
    x >= overlayBox.minX - eps && x <= overlayBox.maxX + eps
    && y >= overlayBox.minY - eps && y <= overlayBox.maxY + eps;
  const located = (x: number, y: number): boolean => {
    if (!inBox(x, y)) return false;
    const key = `${Math.floor((x - overlayView.minX) / overlayView.cellSize)},${Math.floor((y - overlayView.minY) / overlayView.cellSize)}`;
    if (!overlayView.cells.has(key)) return false;
    return locateInMesh(overlayView, x, y) != null;
  };
  let outside = 0;
  let inside = 0;
  let touched = 0;
  for (const tri of base.triangles) {
    const a = base.points[tri[0]]!;
    const b = base.points[tri[1]]!;
    const c = base.points[tri[2]]!;
    const cen = located((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3);
    const va = located(a.x, a.y);
    const vb = located(b.x, b.y);
    const vc = located(c.x, c.y);
    if (!cen && !va && !vb && !vc) outside += 1;
    else if (cen && va && vb && vc) inside += 1;
    else touched += 1;
  }
  return { outside, inside, touched };
};

interface Row {
  size: number;
  caseName: string;
  baseV: number;
  baseT: number;
  overlayV: number;
  overlayT: number;
  baseComponents: number;
  overlayComponents: number;
  boundaryEdges: number;
  counts: ClassCounts;
  seamCandidates: number;
  outputV: number;
  outputT: number;
  resultArea: number;
  fastFullOverlay: { hit: boolean; ms: number };
  fastDisjoint: { hit: boolean; ms: number };
  totalMs: number;
  stages: { viewMs: number; boundaryMs: number; pslgMs: number; pslgSegments: number } | null;
  heapMb: number;
  referenceMs: number | null;
}

const envList = (name: string, fallback: string): number[] =>
  (process.env[name] ?? fallback)
    .split(',')
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isFinite(value));

const measureCase = (size: number, perfCase: PerfCase, opts: {
  stageSizes: Set<number>;
  reference: boolean;
  reps: number;
  refReps: number;
}): Row => {
  const side = Math.max(2, Math.round(Math.sqrt(size / 2)));
  const { base: baseGrid, overlay: overlayGrid } = perfCase.build(side, 1);
  const base = source('base', baseGrid);
  const overlay = source('overlay', overlayGrid);

  // Warm the JIT only where it is cheap; above 10k a single run is itself
  // long enough that cold-start skew is negligible (and a warm-up rep would
  // double the campaign wall time).
  for (let warm = 0; warm < (size <= 10_000 ? 2 : 0); warm += 1) composeSurfaceMeshes(base, overlay);

  const baseView = createMeshView(base.points, base.triangles);
  const overlayView = createMeshView(overlay.points, overlay.triangles);

  let fullHit = false;
  const fullMs = ms(() => {
    fullHit = tryFullOverlayFastPath(base, overlay, baseView, overlayView) != null;
  });
  let disjointHit = false;
  const disjointMs = ms(() => {
    disjointHit = tryStrictDisjointFastPath(base, overlay) != null;
  });

  const heap = heapDeltaMb();
  const samples: number[] = [];
  let result: ComposeResult | null = null;
  for (let r = 0; r < opts.reps; r += 1) {
    const t = performance.now();
    const rep = composeSurfaceMeshes(base, overlay);
    samples.push(performance.now() - t);
    expect(rep.ok, `${perfCase.name} @ ${size}`).toBe(true);
    result = rep;
  }
  const totalMs = median(samples);
  const heapMb = heap.after();

  if (result == null || !result.ok) throw new Error('unexpected reject');
  const diag = result.diagnostics;

  const baseAdjacency = adjacencyOf(base.triangles);
  const overlayAdjacency = adjacencyOf(overlay.triangles);
  const baseComponents = extractRetainedComponents(base.points, base.triangles, baseAdjacency).length;
  const overlayComponents = extractRetainedComponents(overlay.points, overlay.triangles, overlayAdjacency).length;
  const boundaryEdges = extractBoundaryEdges(overlay.triangles, overlayAdjacency).length;
  const overlayBox = boxOf(overlay.points);
  const counts = classifyBaseTriangles(base, overlayView, overlayBox);

  let stages: Row['stages'] = null;
  if (opts.stageSizes.has(size)) {
    const viewMs = ms(() => {
      createMeshView(base.points, base.triangles);
      createMeshView(overlay.points, overlay.triangles);
    });
    const boundaryMs = ms(() => {
      const adjacency = adjacencyOf(overlay.triangles);
      extractBoundaryEdges(overlay.triangles, adjacency);
    });
    const boundarySegments = extractBoundaryEdges(overlay.triangles, overlayAdjacency);
    let pslgSegments = 0;
    const pslgMs = ms(() => {
      pslgSegments = buildComposePslg(
        base.points, base.triangles, overlay.points, overlay.triangles, boundarySegments,
      ).segments.length;
    });
    stages = { viewMs, boundaryMs, pslgMs, pslgSegments };
  }

  let referenceMs: number | null = null;
  if (opts.reference && size <= 10_000) {
    referenceMs = timeReps(opts.refReps, () => {
      const ref = composeSurfaceMeshesReference(base, overlay);
      expect(ref.ok, `reference ${perfCase.name} @ ${size}`).toBe(true);
    });
  }

  return {
    size,
    caseName: perfCase.name,
    baseV: base.points.length,
    baseT: base.triangles.length,
    overlayV: overlay.points.length,
    overlayT: overlay.triangles.length,
    baseComponents,
    overlayComponents,
    boundaryEdges,
    counts,
    seamCandidates: boundaryEdges,
    outputV: diag.outputVertexCount,
    outputT: diag.outputTriangleCount,
    resultArea: diag.resultArea,
    fastFullOverlay: { hit: fullHit, ms: fullMs },
    fastDisjoint: { hit: disjointHit, ms: disjointMs },
    totalMs,
    stages,
    heapMb,
    referenceMs,
  };
};

const fixed = (value: number, digits = 1): string => value.toFixed(digits);
const hit = (probe: { hit: boolean; ms: number }): string => `${probe.hit ? 'yes' : 'no'} ${fixed(probe.ms)}`;

const renderRow = (row: Row): string => {
  const speedup = row.referenceMs != null && row.totalMs > 0 ? `${fixed(row.referenceMs / row.totalMs)}x` : '—';
  return `| ${row.size} | ${row.caseName} | ${row.baseV} | ${row.baseT} | ${row.overlayV} | ${row.overlayT} | `
    + `${row.baseComponents} | ${row.overlayComponents} | ${row.boundaryEdges} | `
    + `${row.counts.outside}/${row.counts.inside}/${row.counts.touched} | ${row.seamCandidates} | `
    + `${row.outputV} | ${row.outputT} | ${hit(row.fastFullOverlay)} | ${hit(row.fastDisjoint)} | `
    + `${fixed(row.totalMs)} | ${row.referenceMs == null ? '—' : fixed(row.referenceMs)} | ${speedup} | `
    + `${fixed(row.heapMb)} |`;
};

const renderStageRow = (row: Row): string => {
  if (!row.stages) return '';
  const residual = Math.max(0, row.totalMs - row.stages.viewMs - row.stages.boundaryMs - row.stages.pslgMs);
  return `| ${row.size} | ${row.caseName} | ${fixed(row.stages.viewMs)} | ${fixed(row.stages.boundaryMs)} | `
    + `${fixed(row.stages.pslgMs)} | ${row.stages.pslgSegments} | ${fixed(residual)} | ${fixed(row.totalMs)} |`;
};

const describeEnvironment = (): string[] => {
  let head = 'unknown';
  try {
    head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: process.cwd() }).toString().trim();
  } catch {
    head = 'unknown';
  }
  const dirty = process.env.PHASE18Z_PERF_DIRTY ?? 'see git status at capture time';
  return [
    `- measured: ${new Date().toISOString()}`,
    `- git HEAD: \`${head}\` (${dirty})`,
    `- node: ${process.version}`,
    `- cpu: ${os.cpus()[0]?.model ?? 'unknown'} (${os.cpus().length} logical)`,
    `- loadavg at capture (end of run): ${os.loadavg().map((v) => v.toFixed(2)).join(' / ')} (1/5/15 min) — concurrent host load inflates absolute ms, see doc caveat`,
  ];
};

const buildMarkdown = (rows: Row[], title: string): string => {
  const main = [
    '## Main table (production)',
    '',
    '| size | case | baseV | baseT | ovlV | ovlT | baseComp | ovlComp | boundaryEdges | cls out/in/touch | seamCand | outV | outT | fastFullOverlay | fastDisjoint | total ms | ref ms | speedup | heap MB |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | ---: | ---: | ---: | ---: |',
    ...rows.map(renderRow),
  ];
  const stageRows = rows.filter((row) => row.stages != null);
  const stages = stageRows.length === 0 ? [] : [
    '',
    '## Sub-stage table (production, stage sizes only)',
    '',
    '| size | case | view ms | boundary ms | pslg ms | pslg segments | residual ms | total ms |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...stageRows.map(renderStageRow),
  ];
  return `# ${title}\n\n${describeEnvironment().join('\n')}\n\n${[...main, ...stages].join('\n')}\n`;
};

describe('Phase 18Z compose performance evidence', () => {
  it('records production timings, base-triangle classification, and fast-path hits', () => {
    const sizes = envList('PHASE18Z_PERF_SIZES', '1000,10000,50000,100000');
    const caseFilter = process.env.PHASE18Z_PERF_CASES;
    const cases = CASES.filter((entry) => caseFilter == null || caseFilter.includes(entry.name));
    const stageSizes = new Set(envList('PHASE18Z_PERF_STAGE_SIZES', '1000,10000'));
    const reference = (process.env.PHASE18Z_PERF_REFERENCE ?? '1') !== '0';
    const repsOverride = Number.parseInt(process.env.PHASE18Z_PERF_REPS ?? '', 10);
    const refRepsOverride = Number.parseInt(process.env.PHASE18Z_PERF_REF_REPS ?? '', 10);

    // One cheap 1k pass per case warms the JIT before any large-size row, so
    // the >10k fast-path rows are not dominated by cold-start compilation.
    const warmSide = Math.max(2, Math.round(Math.sqrt(1000 / 2)));
    for (const perfCase of cases) {
      const warmGrid = perfCase.build(warmSide, 1);
      composeSurfaceMeshes(source('base', warmGrid.base), source('overlay', warmGrid.overlay));
    }

    const rows: Row[] = [];
    for (const size of sizes) {
      for (const perfCase of cases) {
        rows.push(measureCase(size, perfCase, {
          stageSizes,
          reference,
          reps: Number.isFinite(repsOverride) && repsOverride > 0 ? repsOverride : size <= 10_000 ? 3 : 1,
          refReps: Number.isFinite(refRepsOverride) && refRepsOverride > 0 ? refRepsOverride : size <= 1000 ? 3 : 1,
        }));
      }
    }

    const title = `Phase 18Z composition performance — sizes [${sizes.join(', ')}] cases [${cases.map((c) => c.name).join(', ')}]`;
    const markdown = buildMarkdown(rows, title);
    const out = process.env.PHASE18Z_PERF_OUT
      ?? `/tmp/phase18z-compose-perf-${sizes.join('-')}-${cases.length}.md`;
    fs.writeFileSync(out, markdown);
    fs.writeFileSync(`${out}.json`, JSON.stringify(rows, null, 2));
    expect(rows).toHaveLength(sizes.length * cases.length);
  }, 3_600_000);
});
