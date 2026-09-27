/**
 * Phase 20C Wave-5B — grading-GROUP performance evidence (measurement only).
 *
 * Runs the authoritative group engine `computeGradingGroupFromSnapshots`
 * (the same function the worker handler's `computeGroupGradingResultFromRequest`
 * executes) on deterministic synthetic grid TINs at 1k / 10k / 50k / **100k**
 * triangles — ACTUAL runs, no extrapolation — across group sizes
 * 4 / 20 / 100 (1000 for the completing flat chain at 1k/10k) and eight
 * case geometries (mission §107).
 *
 * Per run it reports: total wall ms (median), and a V8-sampling-profiler
 * self-time attribution into target index build, member solve, corner
 * classification/miter math, miter tie solve, corner zero-locus graph,
 * member clipping, mesh merge, validation, arc linearize and engine glue.
 * Candidate / daylight / vertex / triangle / corner-segment counts and heap
 * delta are recorded too. Fail-closed outcomes are RECORDED (not thrown):
 * group corner + member agreement gates inherit the 20B snap-vs-floor
 * sensitivity (R1) and the kink crossover branch issue (R2), so most
 * non-flat / many-plane-break / closed-concave geometries fail exactly as
 * 20B cases C/D/F do. No engine, worker, UI or test file is modified.
 *
 * The script also asserts the EXACT number of target grid constructions per
 * group run (via a length-read-counting proxy over the snapshot points):
 * `gridBuilds = 3 + Σ member chords` — the shared query adapter is built
 * once, but candidate discovery rebuilds the grid once per member chord,
 * so the §106 "one index per group" goal is only partially realized. That
 * is reported as a finding, never "fixed" by changing numerics.
 *
 * Usage: `npx tsx scripts/phase20cGradingGroupPerf.ts [--quick]`
 *   --quick = 1k/10k, sizes 4/20, fewer reps (smoke check).
 */
import { performance } from 'node:perf_hooks';

import {
  computeGradingGroupFromSnapshots,
  type GroupSolveInput,
} from '../src/engine/cad/grading/gradingGroupCompute';
import { linearizeGradingArc } from '../src/engine/cad/grading/gradingCurve';
import { candidateTriangles } from '../src/engine/cad/grading/gradingTargetIndex';
import type {
  GradingCriterion,
  GradingSide,
  ResolvedGradingSource,
} from '../src/engine/cad/grading/gradingTypes';
import {
  computeGroupGradingResultFromRequest,
  toGroupSolveInput,
  type GradingGroupComputeRequest,
} from '../src/workers/surfaceWorkerHandler';
import {
  arcChain,
  buildGridTin,
  countingPoints,
  exponent,
  fmt,
  heapMB,
  median,
  membersBbox,
  notchedRing,
  profileRun,
  sawtooth,
  staircase,
  type StageKey,
} from './phase20cPerfHelpers';

const QUICK = process.argv.includes('--quick');
const SCALES = QUICK ? [1000, 10000] : [1000, 10000, 50000, 100000];
const SIZES = QUICK ? [4, 20] : [4, 20, 100];
const REPLICAS = (scale: number): number => (QUICK ? 2 : scale >= 100000 ? 1 : scale >= 50000 ? 2 : 3);

interface CaseDef {
  id: string;
  label: string;
  members: (_n: number) => ResolvedGradingSource[];
  closed: boolean;
  domain: [number, number, number, number];
  z: (_x: number, _y: number) => number;
  side: GradingSide;
  criterion: GradingCriterion;
  maxSearch: number;
  tolerance: number;
  expectOk: (_size: number) => boolean;
}

const FIX = (gradeRatio: number): GradingCriterion => ({ kind: 'fixed', gradeRatio });
const CUT_FILL: GradingCriterion = { kind: 'cut-fill', cutGradeRatio: 0.5, fillGradeRatio: -0.5 };

const CASES: CaseDef[] = [
  { id: 'A', label: 'flat closed pad', members: (n) => notchedRing(n, 6, 8), closed: true,
    domain: [-200, 600, -200, 500], z: () => 0, side: 'right', criterion: FIX(-0.5), maxSearch: 20, tolerance: 0.05, expectOk: () => false },
  { id: 'B', label: 'sloped target', members: (n) => staircase(n, 5), closed: false,
    domain: [-300, 2400, -300, 2400], z: (x) => 0.001 * x, side: 'right', criterion: FIX(-0.5), maxSearch: 15, tolerance: 0.05, expectOk: () => false },
  { id: 'C', label: 'many plane breaks', members: (n) => staircase(n, 5), closed: false,
    domain: [-300, 2400, -300, 2400], z: (x) => sawtooth(x, 40), side: 'right', criterion: FIX(-0.5), maxSearch: 15, tolerance: 0.05, expectOk: () => false },
  { id: 'D', label: 'concave closed shape', members: (n) => notchedRing(n, 8, 40), closed: true,
    domain: [-200, 600, -200, 500], z: () => 0, side: 'right', criterion: FIX(-0.5), maxSearch: 30, tolerance: 0.05, expectOk: () => false },
  { id: 'E', label: 'cut/fill transition', members: (n) => staircase(n, 0), closed: false,
    domain: [-300, 2400, -300, 2400], z: (x) => 0.5 * Math.sin(x / 150), side: 'right', criterion: CUT_FILL, maxSearch: 15, tolerance: 0.05, expectOk: () => false },
  { id: 'F', label: 'curved-member group', members: (n) => arcChain(n, 6), closed: false,
    domain: [-200, 5300, -200, 2300], z: () => 0, side: 'right', criterion: FIX(-0.5), maxSearch: 20, tolerance: 0.05, expectOk: (n) => n === 4 },
  { id: 'G', label: 'no-solution corner stress', members: (n) => staircase(n, 6), closed: false,
    domain: [-300, 2400, -300, 2400], z: () => 0, side: 'right', criterion: FIX(-0.5), maxSearch: 1, tolerance: 0.05, expectOk: () => false },
  { id: 'H', label: 'flat chain (completing ref)', members: (n) => staircase(n, 5), closed: false,
    domain: [-500, 21000, -500, 21000], z: () => 0, side: 'right', criterion: FIX(-0.5), maxSearch: 15, tolerance: 0.05, expectOk: () => true },
];

interface RunRow {
  scale: number;
  caseId: string;
  size: number;
  actualMembers: number;
  outcome: string;
  asExpected: boolean;
  totalMs: number;
  heapMB: number;
  candidates: number;
  groupCandidates: number;
  daylightPts: number;
  outVerts: number;
  outTris: number;
  cornerSegments: number;
  corners: number;
  multipleSolutions: number;
  stages: Partial<Record<StageKey, number>>;
  profiledMs: number;
  samples: number;
}

const chordsOf = (members: ResolvedGradingSource[], tolerance: number): number => {
  let chords = 0;
  for (const m of members) {
    if (!m.isArc || !m.arc) { chords += 1; continue; }
    const lin = linearizeGradingArc(
      m.arc.centerX, m.arc.centerY, m.arc.radius,
      m.arc.startAngle, m.arc.endAngle, m.arc.sweepCCW,
      m.startZ, m.endZ, tolerance,
    );
    chords += lin ? lin.subdivisions : 0;
  }
  return chords;
};

const solveInput = (
  def: CaseDef, groupId: string, members: ResolvedGradingSource[], target: { points: number[]; triangles: number[] },
): GroupSolveInput => ({
  groupId,
  revision: 'ggrev1:perf',
  members,
  side: def.side,
  criterion: def.criterion,
  maxSearchDistance: def.maxSearch,
  curveChordTolerance: def.tolerance,
  closed: def.closed,
  target,
});

const outcomeOf = (out: ReturnType<typeof computeGradingGroupFromSnapshots>): {
  outcome: string; result: Extract<ReturnType<typeof computeGradingGroupFromSnapshots>, { ok: true }>['result'] | null;
} => (out.ok ? { outcome: out.result.accuracy, result: out.result } : { outcome: `${out.code}${out.cornerIndex === undefined ? '' : `@c${out.cornerIndex}`}`, result: null });

const measure = (
  def: CaseDef, scale: number, size: number,
): { row: RunRow; input: GroupSolveInput; target: { points: number[]; triangles: number[] } } => {
  const members = def.members(size);
  const [x0, x1, y0, y1] = def.domain;
  const tin = buildGridTin(scale, x0, x1, y0, y1, def.z);
  const target = { points: tin.points, triangles: tin.triangles };
  const input = solveInput(def, `${def.id}-${size}`, members, target);

  // Warm-up (JIT + grid shape); timed medians measure only subsequent runs.
  const warm = computeGradingGroupFromSnapshots(input);
  const { outcome, result } = outcomeOf(warm);
  // Group-level candidate count (recorded even for fail-closed runs).
  const bb = membersBbox(members);
  const pad = def.maxSearch + 1;
  const groupCandidates = candidateTriangles(target, [
    { x: bb.minX - pad, y: bb.minY - pad },
    { x: bb.maxX + pad, y: bb.minY - pad },
    { x: bb.maxX + pad, y: bb.maxY + pad },
    { x: bb.minX - pad, y: bb.maxY + pad },
  ])?.length ?? 0;

  const reps = REPLICAS(scale);
  const totals: number[] = [];
  const heaps: number[] = [];
  for (let run = 0; run < reps; run += 1) {
    const before = heapMB();
    const start = performance.now();
    const out = computeGradingGroupFromSnapshots(input);
    const elapsed = performance.now() - start;
    void out;
    totals.push(elapsed);
    heaps.push(heapMB() - before);
  }

  return {
    row: {
      scale, caseId: def.id, size, actualMembers: members.length,
      outcome, asExpected: def.expectOk(size) === warm.ok,
      totalMs: median(totals), heapMB: median(heaps),
      candidates: result?.candidateTriangleCount ?? 0,
      groupCandidates,
      daylightPts: result ? result.daylightPoints.length / 3 : 0,
      outVerts: result ? result.gradingMesh.points.length / 3 : 0,
      outTris: result ? result.gradingMesh.triangles.length / 3 : 0,
      cornerSegments: result ? result.corners.reduce((sum, c) => sum + (c.daylightPoints ? c.daylightPoints.length / 3 - 1 : 0), 0) : 0,
      corners: result ? result.cornerCount : 0,
      multipleSolutions: result?.multipleSolutionCount ?? 0,
      stages: {}, profiledMs: 0, samples: 0,
    },
    input,
    target,
  };
};

// The profiler run is async; keep the measurement loop synchronous and
// resolve profiling afterwards so warm/timed medians stay unperturbed.
const pendingProfiles: Array<{ row: RunRow; input: GroupSolveInput }> = [];

const runMatrix = async (): Promise<RunRow[]> => {
  const rows: RunRow[] = [];
  for (const scale of SCALES) {
    for (const def of CASES) {
      const sizes = def.id === 'H' && scale <= 10000 && !QUICK ? [...SIZES, 1000] : SIZES;
      for (const size of sizes) {
        const { row, input } = measure(def, scale, size);
        rows.push(row);
        pendingProfiles.push({ row, input });
      }
    }
  }
  for (const { row, input } of pendingProfiles) {
    const prof = await profileRun(() => { computeGradingGroupFromSnapshots(input); });
    row.stages = prof.stages;
    row.profiledMs = prof.totalMs;
    row.samples = prof.samples;
  }
  return rows;
};

// ---------------------------------------------------------------------------
// Grid-build assertion (one run per case/size at 10k)
// ---------------------------------------------------------------------------

interface BuildRow { caseId: string; size: number; measured: number; expected: number; chords: number; completed: boolean }

const assertGridBuilds = (): BuildRow[] => {
  const out: BuildRow[] = [];
  for (const def of CASES) {
    for (const size of SIZES) {
      const members = def.members(size);
      const [x0, x1, y0, y1] = def.domain;
      const tin = buildGridTin(10000, x0, x1, y0, y1, def.z);
      const { points, reads } = countingPoints(tin.points);
      const outcome = computeGradingGroupFromSnapshots(solveInput(def, `${def.id}-count`, members, { points, triangles: tin.triangles }));
      const chords = chordsOf(members, def.tolerance);
      const expected = 3 + chords;
      const measured = reads();
      // A fail-closed run stops early, so it builds fewer grids; a completing
      // run must build exactly one per member chord plus the two group passes.
      if (measured < 3 || measured > expected) {
        throw new Error(`${def.id}@${size}: grid builds ${measured} outside [3, ${expected}]`);
      }
      if (outcome.ok && measured !== expected) {
        throw new Error(`${def.id}@${size}: completing run built ${measured} grids, expected ${expected}`);
      }
      out.push({ caseId: def.id, size, measured, expected, chords, completed: outcome.ok });
    }
  }
  return out;
};

// ---------------------------------------------------------------------------
// Worker entry vs pure engine (one representative cell)
// ---------------------------------------------------------------------------

const workerVsEngine = (): { engineMs: number; workerMs: number } => {
  const def = CASES[7]!;
  const members = def.members(20);
  const [x0, x1, y0, y1] = def.domain;
  const tin = buildGridTin(10000, x0, x1, y0, y1, def.z);
  const request: GradingGroupComputeRequest = {
    groupId: 'worker-vs-engine', revision: 'ggrev1:perf', memberSources: members,
    side: def.side, criterion: def.criterion, maxSearchDistance: def.maxSearch,
    curveChordTolerance: def.tolerance, closed: def.closed,
    target: { points: tin.points, triangles: tin.triangles },
  };
  const reps = QUICK ? 2 : 4;
  const engineSamples: number[] = [];
  const workerSamples: number[] = [];
  for (let i = 0; i < reps + 1; i += 1) {
    let start = performance.now();
    computeGradingGroupFromSnapshots(toGroupSolveInput(request));
    if (i > 0) engineSamples.push(performance.now() - start);
    start = performance.now();
    computeGroupGradingResultFromRequest(request);
    if (i > 0) workerSamples.push(performance.now() - start);
  }
  return { engineMs: median(engineSamples), workerMs: median(workerSamples) };
};

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

const printMatrix = (rows: RunRow[]): void => {
  console.log('\nPhase 20C grading-GROUP perf — median wall ms + profiled stage self-time (synthetic grid TINs)\n');
  console.log('| tris | case | n | outcome | total | idx | grid | member | corner | miter | locus | clip | merge | valid | arc | glue | grpCand | outCand | dl | verts/tris |');
  console.log('|---:|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|');
  for (const r of rows) {
    const s = r.stages;
    const g = (k: StageKey): string => fmt(s[k] ?? 0);
    console.log(
      `| ${r.scale.toLocaleString('en-US')} | ${r.caseId} | ${r.size} | ${r.outcome} | ${fmt(r.totalMs)} | ${g('targetIndexBuild')} | ${g('gridBuild')} | ${g('memberSolve')} | ${g('cornerClassifyMiter')} | ${g('miterTieSolve')} | ${g('cornerLocusGraph')} | ${g('memberClipping')} | ${g('meshMerge')} | ${g('validation')} | ${g('arcLinearize')} | ${g('engineGlue')} | ${r.groupCandidates.toLocaleString('en-US')} | ${r.candidates.toLocaleString('en-US')} | ${r.daylightPts} | ${r.outVerts}/${r.outTris} |`,
    );
  }
};

const stageKeys: StageKey[] = ['targetIndexBuild', 'gridBuild', 'memberSolve', 'cornerClassifyMiter', 'miterTieSolve', 'cornerLocusGraph', 'memberClipping', 'meshMerge', 'validation', 'arcLinearize'];

const printScaling = (rows: RunRow[]): void => {
  console.log('\nScaling exponents vs previous scale (1.00 = linear). total = median wall; stage = profiled self-time (>2 ms floor):');
  for (const caseId of new Set(rows.map((r) => r.caseId))) {
    for (const size of SIZES) {
      const series = rows.filter((r) => r.caseId === caseId && r.size === size);
      const anyOk = series.some((r) => r.outcome === 'EXACT' || r.outcome === 'CURVE_APPROXIMATED');
      const parts: string[] = [];
      for (let i = 1; i < series.length; i += 1) {
        const prev = series[i - 1]!;
        const curr = series[i]!;
        const inner = stageKeys
          .map((k) => {
            const a = prev.stages[k] ?? 0;
            const b = curr.stages[k] ?? 0;
            return a > 2 && b > 2 ? `${k}=${exponent(a, b, prev.scale, curr.scale)}` : null;
          })
          .filter((v): v is string => v !== null)
          .join(' ');
        parts.push(`${fmt(prev.scale)}→${fmt(curr.scale)} total=${exponent(prev.totalMs, curr.totalMs, prev.scale, curr.scale)}${inner ? ` · ${inner}` : ''}`);
      }
      console.log(`  ${caseId} n=${size}${anyOk ? '' : ' [all fail-closed]'}: ${parts.join('  |  ')}`);
    }
  }
};

const printOutputScaling = (rows: RunRow[]): void => {
  console.log('\nOutput-size scaling (case H flat chain — completing reference; mission §110):');
  console.log('| tris | n | daylight pts | verts | tris | corner segs | dl/n | tris/n |');
  console.log('|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const r of rows.filter((row) => row.caseId === 'H')) {
    console.log(`| ${r.scale.toLocaleString('en-US')} | ${r.size} | ${r.daylightPts} | ${r.outVerts} | ${r.outTris} | ${r.cornerSegments} | ${(r.daylightPts / r.size).toFixed(2)} | ${(r.outTris / r.size).toFixed(2)} |`);
  }
  const h = rows.filter((r) => r.caseId === 'H' && r.scale === SCALES[SCALES.length - 1]);
  if (h.length >= 2) {
    const first = h[0]!;
    const last = h[h.length - 1]!;
    console.log(`  H @${last.scale.toLocaleString('en-US')} output exponents n=${first.size}→${last.size}: daylight ${exponent(first.daylightPts, last.daylightPts, first.size, last.size)}, verts ${exponent(first.outVerts, last.outVerts, first.size, last.size)}, tris ${exponent(first.outTris, last.outTris, first.size, last.size)}`);
  }
};

const printBuilds = (builds: BuildRow[]): void => {
  console.log('\nGrid-construction count per group run (points-length reads; 1 query x2 + 1 group candidate pass + 1 per member chord):\n');
  console.log('| case | n | chords | measured | full (=3+chords) | completed |');
  console.log('|---|---:|---:|---:|---:|---|');
  for (const b of builds) console.log(`| ${b.caseId} | ${b.size} | ${b.chords} | ${b.measured} | ${b.expected} | ${b.completed ? 'yes' : 'fail-closed'} |`);
  console.log('  => candidate discovery rebuilds the full target grid once per member chord; §106 "one index per group" is NOT met (query adapter itself is built once).');
};

const summarize = (rows: RunRow[], builds: BuildRow[], worker: { engineMs: number; workerMs: number }): object => ({
  generatedAt: new Date().toISOString(),
  quick: QUICK,
  scales: SCALES,
  sizes: SIZES,
  cases: CASES.map((c) => ({ id: c.id, label: c.label, closed: c.closed, maxSearch: c.maxSearch, criterion: c.criterion.kind })),
  runs: rows,
  gridBuilds: builds,
  workerVsEngine: worker,
});

const main = async (): Promise<void> => {
  const harnessStart = performance.now();
  const rows = await runMatrix();
  const builds = assertGridBuilds();
  const worker = workerVsEngine();

  printMatrix(rows);
  printScaling(rows);
  printOutputScaling(rows);
  printBuilds(builds);
  console.log(`\nworker entry vs pure engine (H n=20 @10k): engine ${fmt(worker.engineMs)} ms, worker ${fmt(worker.workerMs)} ms (delta ${((worker.workerMs / worker.engineMs - 1) * 100).toFixed(1)}%)`);

  const okCount = rows.filter((r) => r.outcome === 'EXACT' || r.outcome === 'CURVE_APPROXIMATED').length;
  console.log(`\ncompleting runs: ${okCount}/${rows.length}; fail-closed outcomes recorded above (R1/R2 inheritance, no numerics changed)`);
  console.log(`\ntotal harness runtime ${((performance.now() - harnessStart) / 1000).toFixed(1)} s`);
  console.log(`\nJSON_SUMMARY ${JSON.stringify(summarize(rows, builds, worker))}`);
  console.log('');
};

void main();
