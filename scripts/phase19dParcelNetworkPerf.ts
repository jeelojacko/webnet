/**
 * Phase 19D perf evidence (§§106-109). Measurement only, no src/ changes.
 *
 * Times the parcel-network pipeline at 10 / 100 / 1,000 parcels (10,000 is
 * attempted only under `--large` and documented as impractical otherwise):
 *   - course extraction   : resolveCadParcelCourses over every parcel
 *   - bbox discovery      : buildCadBounds over every parcel (one pass)
 *   - candidate discovery : bbox-overlap pair enumeration (harness mirror of
 *                           buildParcelNetwork's inner loop)
 *   - exact comparison    : matchParcelCourses over candidate pairs
 *   - full network        : buildParcelNetwork (components + overlap + findings)
 *   - report              : buildCadParcelNetworkReport
 *   - schedule            : buildCadParcelSchedule at 10/100/1k/10k rows
 *
 * The harness ALSO measures a uniform-grid candidate index (harness-only
 * projection, never production) so the evidence quantifies the gap between
 * the shipped all-pairs bbox loop and an indexed candidate discovery.
 *
 * Layouts: dense (adjacent 10x10 parcels sharing edges), sparse (10x10 at
 * 100 m spacing, no bbox overlap), overlap-dense (20x20 at 10 m spacing) and
 * overlap-sparse (20x20 at 100 m spacing). No timing gates; numbers are
 * indicative, not a budget.
 *
 * Usage: `npx tsx scripts/phase19dParcelNetworkPerf.ts [--quick] [--large]`
 */
import { performance } from 'node:perf_hooks';

import { buildCadBounds } from '../src/engine/cad/cadProjectState';
import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import { buildParcelCourseIds, resolveCadParcelCourses } from '../src/engine/cad/cadParcelCourses';
import {
  buildParcelNetwork,
  detectParcelOverlapAreaSquareMeters,
  matchParcelCourses,
} from '../src/engine/cad/cadParcelNetwork';
import { buildCadParcelNetworkReport } from '../src/engine/cad/cadParcelNetworkReport';
import { buildCadParcelSchedule } from '../src/engine/cad/cadParcelSchedule';
import type { CadBounds, CadEntity, CadParcelEntity, CadProject } from '../src/engine/cad/cadTypes';

const QUICK = process.argv.includes('--quick');
const LARGE = process.argv.includes('--large');
const SCALES = QUICK ? [10, 100] : [10, 100, 1_000];
const SCHEDULE_SCALES = QUICK ? [10, 100, 1_000] : [10, 100, 1_000, 10_000];
const REPS = QUICK ? 2 : 3;

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

const timedMs = (fn: () => void): number => {
  fn(); // warmup outside the measurement
  const samples: number[] = [];
  for (let i = 0; i < REPS; i += 1) {
    const start = performance.now();
    fn();
    samples.push(performance.now() - start);
  }
  return median(samples);
};

/** Scaling exponent between two (n, ms) points: 1 = linear, 2 = quadratic. */
const exponent = (n1: number, t1: number, n2: number, t2: number): number =>
  t1 <= 0 || t2 <= 0 ? Number.NaN : Math.log(t2 / t1) / Math.log(n2 / n1);

// ---------------------------------------------------------------------------
// Parcel fixtures
// ---------------------------------------------------------------------------

type Layout = 'dense' | 'sparse' | 'overlap-dense' | 'overlap-sparse';

const layoutGeometry = (layout: Layout): { size: number; spacing: number; role: 'lot' | 'easement' } => {
  switch (layout) {
    case 'dense':
      return { size: 10, spacing: 10, role: 'lot' };
    case 'sparse':
      return { size: 10, spacing: 100, role: 'lot' };
    case 'overlap-dense':
      return { size: 20, spacing: 10, role: 'lot' };
    case 'overlap-sparse':
      return { size: 20, spacing: 100, role: 'lot' };
  }
};

const buildParcels = (layout: Layout, count: number): CadParcelEntity[] => {
  const { size, spacing } = layoutGeometry(layout);
  const cols = Math.ceil(Math.sqrt(count));
  const parcels: CadParcelEntity[] = [];
  for (let i = 0; i < count; i += 1) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = col * spacing;
    const y = row * spacing;
    const id = `perf-${layout}-${i}`;
    parcels.push({
      id,
      type: 'parcel',
      layerId: 'parcels',
      visible: true,
      locked: false,
      parcelName: `Lot ${i + 1}`,
      planInfo: { designation: `Lot ${i + 1}`, role: 'lot' },
      vertices: [
        { x, y },
        { x: x + size, y },
        { x: x + size, y: y + size },
        { x, y: y + size },
      ],
      vertexLabels: ['1', '2', '3', '4'],
      courseIds: buildParcelCourseIds(id, 4),
    });
  }
  return parcels;
};

const buildProject = (layout: Layout, count: number): CadProject => {
  const project = createBlankCadProject({ name: `Perf 19D ${layout} ${count}`, units: 'm' });
  return { ...project, entities: [...project.entities, ...buildParcels(layout, count)] as CadEntity[] };
};

const boundsOverlap = (a: CadBounds, b: CadBounds, tolerance = 1e-6): boolean =>
  a.minX - tolerance <= b.maxX &&
  b.minX - tolerance <= a.maxX &&
  a.minY - tolerance <= b.maxY &&
  b.minY - tolerance <= a.maxY;

const boundsByParcel = (parcels: readonly CadParcelEntity[]): CadBounds[] =>
  parcels.map((parcel) => buildCadBounds([parcel]) as CadBounds);

/** All bbox-overlapping pairs — the shipped buildParcelNetwork inner loop. */
const allPairsCandidates = (
  parcels: readonly CadParcelEntity[],
  bounds: readonly CadBounds[],
): Array<[number, number]> => {
  const candidates: Array<[number, number]> = [];
  for (let i = 0; i < parcels.length; i += 1) {
    for (let j = i + 1; j < parcels.length; j += 1) {
      if (boundsOverlap(bounds[i]!, bounds[j]!)) candidates.push([i, j]);
    }
  }
  return candidates;
};

/**
 * Harness-only uniform-grid candidate discovery (NOT production code). Cell
 * size = the largest parcel bbox dimension; each parcel only scans its 3x3
 * neighbouring cells, then bbox-confirms. Included purely to quantify the
 * cost an indexed discovery would remove.
 */
const gridCandidates = (
  parcels: readonly CadParcelEntity[],
  bounds: readonly CadBounds[],
): Array<[number, number]> => {
  let cell = 1;
  for (const bound of bounds) cell = Math.max(cell, bound.maxX - bound.minX, bound.maxY - bound.minY);
  const buckets = new Map<string, number[]>();
  const key = (cx: number, cy: number): string => `${cx}:${cy}`;
  for (let i = 0; i < parcels.length; i += 1) {
    const bound = bounds[i]!;
    const cx = Math.floor((bound.minX + bound.maxX) / 2 / cell);
    const cy = Math.floor((bound.minY + bound.maxY) / 2 / cell);
    const bucket = buckets.get(key(cx, cy));
    if (bucket) bucket.push(i);
    else buckets.set(key(cx, cy), [i]);
  }
  const seen = new Set<string>();
  const candidates: Array<[number, number]> = [];
  for (let i = 0; i < parcels.length; i += 1) {
    const bound = bounds[i]!;
    const cx = Math.floor((bound.minX + bound.maxX) / 2 / cell);
    const cy = Math.floor((bound.minY + bound.maxY) / 2 / cell);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (const j of buckets.get(key(cx + dx, cy + dy)) ?? []) {
          if (j <= i) continue;
          if (!boundsOverlap(bound, bounds[j]!)) continue;
          const pairKey = `${i}:${j}`;
          if (seen.has(pairKey)) continue;
          seen.add(pairKey);
          candidates.push([i, j]);
        }
      }
    }
  }
  return candidates;
};

interface StageRow {
  layout: Layout;
  parcels: number;
  resolveMs: number;
  bboxMs: number;
  candidatePairs: number;
  candidatesMs: number;
  indexedCandidatesMs: number;
  exactMs: number;
  networkMs: number;
  reportMs: number;
  overlapMs: number;
  components: number;
  pairs: number;
}

const measureStages = (layout: Layout, count: number): StageRow => {
  const project = buildProject(layout, count);
  const parcels = project.entities.filter(
    (entity): entity is CadParcelEntity => entity.type === 'parcel',
  );

  const resolveMs = timedMs(() => {
    for (const parcel of parcels) resolveCadParcelCourses(parcel);
  });
  const bboxMs = timedMs(() => {
    for (const parcel of parcels) buildCadBounds([parcel]);
  });

  const bounds = boundsByParcel(parcels);
  const allPairs = allPairsCandidates(parcels, bounds);
  const candidatesMs = timedMs(() => {
    allPairsCandidates(parcels, bounds);
  });
  const indexedCandidatesMs = timedMs(() => {
    gridCandidates(parcels, bounds);
  });

  const exactMs = timedMs(() => {
    for (const [i, j] of allPairs) matchParcelCourses(parcels[i]!, parcels[j]!);
  });

  const network = buildParcelNetwork(project);
  const networkMs = timedMs(() => {
    buildParcelNetwork(project);
  });
  const reportMs = timedMs(() => {
    buildCadParcelNetworkReport(project, network);
  });
  const overlapMs = timedMs(() => {
    for (const [i, j] of allPairs) detectParcelOverlapAreaSquareMeters(parcels[i]!, parcels[j]!);
  });

  return {
    layout,
    parcels: count,
    resolveMs,
    bboxMs,
    candidatePairs: allPairs.length,
    candidatesMs,
    indexedCandidatesMs,
    exactMs,
    networkMs,
    reportMs,
    overlapMs,
    components: network.components.length,
    pairs: network.pairs.length,
  };
};

const printStages = (label: string, rows: readonly StageRow[]): void => {
  console.log(`[19D-PERF] ${label} (ms median; candidate pairs = bbox-overlapping)`);
  for (const row of rows) {
    console.log(
      `  parcels=${String(row.parcels).padStart(5)}` +
        `  resolve=${row.resolveMs.toFixed(2)}` +
        `  bbox=${row.bboxMs.toFixed(2)}` +
        `  cand=${row.candidatesMs.toFixed(2)}` +
        `  indexedCand=${row.indexedCandidatesMs.toFixed(2)}` +
        `  candidates=${String(row.candidatePairs).padStart(7)}` +
        `  exact=${row.exactMs.toFixed(2)}` +
        `  overlap=${row.overlapMs.toFixed(2)}` +
        `  network=${row.networkMs.toFixed(2)}` +
        `  report=${row.reportMs.toFixed(2)}` +
        `  pairs=${row.pairs}` +
        `  components=${row.components}`,
    );
  }
};

const printExponents = (label: string, rows: readonly StageRow[]): void => {
  console.log(`[19D-PERF] ${label} scaling exponents (1.00 = linear, 2.00 = quadratic)`);
  for (let i = 1; i < rows.length; i += 1) {
    const prev = rows[i - 1]!;
    const curr = rows[i]!;
    console.log(
      `  ${prev.parcels}->${curr.parcels}:` +
        ` cand x${exponent(prev.parcels, prev.candidatesMs, curr.parcels, curr.candidatesMs).toFixed(2)}` +
        ` indexedCand x${exponent(prev.parcels, prev.indexedCandidatesMs, curr.parcels, curr.indexedCandidatesMs).toFixed(2)}` +
        ` exact x${exponent(prev.parcels, prev.exactMs, curr.parcels, curr.exactMs).toFixed(2)}` +
        ` overlap x${exponent(prev.parcels, prev.overlapMs, curr.parcels, curr.overlapMs).toFixed(2)}` +
        ` network x${exponent(prev.parcels, prev.networkMs, curr.parcels, curr.networkMs).toFixed(2)}` +
        ` report x${exponent(prev.parcels, prev.reportMs, curr.parcels, curr.reportMs).toFixed(2)}`,
    );
  }
};

const LAYOUTS: Layout[] = ['dense', 'sparse', 'overlap-dense', 'overlap-sparse'];
const stageRows: Record<Layout, StageRow[]> = {
  dense: [],
  sparse: [],
  'overlap-dense': [],
  'overlap-sparse': [],
};

for (const layout of LAYOUTS) {
  if (QUICK && (layout === 'overlap-dense' || layout === 'overlap-sparse')) continue;
  const rows = SCALES.map((count) => measureStages(layout, count));
  stageRows[layout] = rows;
  printStages(layout, rows);
  printExponents(layout, rows);
}

// ---------------------------------------------------------------------------
// Schedule derive at 10 / 100 / 1,000 / 10,000 rows
// ---------------------------------------------------------------------------
console.log('[19D-PERF] schedule derive (ms median)');
const scheduleRows: Array<{ rows: number; totalMs: number; perRowUs: number }> = [];
for (const count of SCHEDULE_SCALES) {
  const project = buildProject('dense', count);
  const ids = project.entities
    .filter((entity): entity is CadParcelEntity => entity.type === 'parcel')
    .map((parcel) => parcel.id);
  const totalMs = timedMs(() => {
    buildCadParcelSchedule(project, ids);
  });
  scheduleRows.push({ rows: count, totalMs, perRowUs: (totalMs * 1000) / count });
  console.log(
    `  rows=${String(count).padStart(6)}  total=${totalMs.toFixed(2)}  perRow=${((totalMs * 1000) / count).toFixed(3)}us`,
  );
}

// ---------------------------------------------------------------------------
// 10,000-parcel attempt (opt-in)
// ---------------------------------------------------------------------------
let largeNote = 'skipped';
if (LARGE) {
  console.log('[19D-PERF] 10,000-parcel attempt (--large)');
  try {
    const start = performance.now();
    const row = measureStages('dense', 10_000);
    const wall = performance.now() - start;
    stageRows.dense.push(row);
    printStages('dense @10,000', [row]);
    largeNote = `completed in ${wall.toFixed(0)}ms`;
    console.log(`  10,000 dense completed; total probe wall ${wall.toFixed(0)}ms`);
  } catch (error) {
    largeNote = `failed: ${String(error)}`;
    console.log(`  10,000 dense failed: ${String(error)}`);
  }
} else {
  console.log(
    '[19D-PERF] 10,000-parcel network skipped: the shipped all-pairs bbox loop is O(P^2),' +
      ' so 50M pair iterations with per-pair buildCadBounds is impractical here (rerun with --large to attempt).',
  );
}

console.log('[19D-PERF] JSON');
console.log(
  JSON.stringify({
    scales: SCALES,
    reps: REPS,
    stages: stageRows,
    schedule: scheduleRows,
    largeTenThousand: largeNote,
    notes: [
      'cand = harness mirror of buildParcelNetwork bbox-overlap pair enumeration (all-pairs).',
      'indexedCand = harness-only uniform-grid discovery projection; NOT production code.',
      'buildParcelNetwork precomputes bounds/courses/vertices once per parcel (19D fix wave);',
      'the pair loop stays all-pairs bbox compares, so sparse plans are ~ms, not ~P^2 geometry.',
    ],
  }),
);
