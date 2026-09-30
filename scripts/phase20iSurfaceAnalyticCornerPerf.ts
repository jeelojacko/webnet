/**
 * Phase 20I — surface↔analytic grading corner performance evidence.
 *
 * MEASUREMENT ONLY. No production routing, no `src/` change, no timing
 * threshold anywhere. Every figure printed is an actual run. Fixture
 * construction (course chains, criteria arrays, target TINs, arc
 * linearization plans, corpus generation) happens OUTSIDE the timed region;
 * only the solve / validation calls are timed.
 *
 * Controls are real engine seams and always run:
 *   - Surface↔Surface  : computeGradingGroupFromSnapshots (fixed, target TIN)
 *   - Analytic↔Analytic: computeGradingGroupFromSnapshots (Distance/Elevation/
 *                        Relative Elevation, no target)
 *
 * Candidate (surface↔analytic) cases call the core worker's adapter
 * `resolveSurfaceAnalyticCorner`, imported DYNAMICALLY from
 * `./phase20iSurfaceAnalyticCornerCore`. The input/result shapes are mirrored
 * structurally below so this harness has no static dependency on the core
 * file: if the module or the adapter is absent, every candidate row prints
 * `skip-TBD` and the harness still completes with exit 0.
 *
 * Usage: `npx tsx scripts/phase20iSurfaceAnalyticCornerPerf.ts [--quick]`
 */
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';
import { linearizeGradingArc } from '../src/engine/cad/grading/gradingCurve';
import { validateGroupMesh } from '../src/engine/cad/grading/gradingGroupMerge';
import {
  buildGridTin,
  fmt,
  heapMB,
  median,
  mulberry32,
  staircase,
  straight,
} from './phase20cPerfHelpers';
import type { GradingCriterion, GradingSide, ResolvedGradingSource } from '../src/engine/cad/grading/gradingTypes';

const QUICK = process.argv.includes('--quick');

// ---------------------------------------------------------------------------
// Criteria + fixtures (built outside every timed region)
// ---------------------------------------------------------------------------
const FIXED = (g: number): GradingCriterion => ({ kind: 'fixed', gradeRatio: g });
const CUTFILL = (c: number, f: number): GradingCriterion => ({ kind: 'cut-fill', cutGradeRatio: c, fillGradeRatio: f });
const DIST = (g: number, d: number): GradingCriterion => ({ kind: 'distance', gradeRatio: g, distance: d });
const ELEV = (g: number, e: number): GradingCriterion => ({ kind: 'elevation', gradeRatio: g, targetElevation: e });
const REL = (g: number, dz: number): GradingCriterion => ({ kind: 'relative-elevation', gradeRatio: g, relativeElevation: dz });

interface Target {
  points: number[];
  triangles: number[];
}

const flatTarget = (tris: number, x0: number, x1: number, y0: number, y1: number, z: number): Target => {
  const tin = buildGridTin(tris, x0, x1, y0, y1, () => z);
  return { points: tin.points, triangles: tin.triangles };
};

const PAD: ResolvedGradingSource[] = [
  straight(0, 0, 100, 0, 10, 10),
  straight(100, 0, 100, 100, 10, 10),
  straight(100, 100, 0, 100, 10, 10),
  straight(0, 100, 0, 0, 10, 10),
];

// Surface pad at Z=110 grading down to a flat target at Z=100 with g = -0.5:
// the daylight tie sits 20 m out. A Z≈100 working elevation keeps the shared
// 18I `zeroDelta` large enough (≈9e-14) to absorb the seam rounding that a
// Z≈0 target would expose (the same convention the Phase 20H/20C harnesses use).
const PAD_SURFACE: ResolvedGradingSource[] = [
  straight(0, 0, 100, 0, 110, 110),
  straight(100, 0, 100, 100, 110, 110),
  straight(100, 100, 0, 100, 110, 110),
  straight(0, 100, 0, 0, 110, 110),
];

const FLAT = flatTarget(200, -100, 200, -100, 200, 0);
const FLAT_SURFACE = flatTarget(200, -100, 200, -100, 200, 100);
const FINE = flatTarget(2000, -100, 200, -100, 200, 0);
const VOID: Target = flatTarget(200, 900, 1100, 900, 1100, 0);

const L = 100;

interface CornerInput {
  vx: number;
  vy: number;
  vz: number;
  surfaceMember: ResolvedGradingSource;
  surfaceIncoming: boolean;
  analyticMember: ResolvedGradingSource;
  analyticIncoming: boolean;
  side: GradingSide;
  surfaceCriterion: GradingCriterion;
  analyticCriterion: GradingCriterion;
  maxSearchDistance: number;
  target: Target;
  buildMesh?: boolean;
}

interface CornerMesh {
  points: number[];
  triangles: number[];
  planArea: number;
  area3d: number;
  valid: boolean;
}

interface CornerResult {
  outcome: string;
  detail?: string;
  turn: 'GAP' | 'OVERLAP' | 'TANGENT' | null;
  cutFill: 'CUT' | 'FILL' | 'TIED' | null;
  rootCount: number;
  extent: number | null;
  xyGap: number | null;
  zGap: number | null;
  mesh: CornerMesh | null;
}

type CornerSolve = (_input: CornerInput) => CornerResult;

/**
 * Base square corner: surface incoming (-100,0)->(0,0), analytic outgoing
 * (0,0)->(0,100), side right. With a flat target at Z=0, FIXED(-0.5) and any
 * of REL(-0.5,-10) / DIST(-0.5,20) / ELEV(-0.5,0), the surface daylight tie
 * and the analytic limit tie both land at (20,-20,0) — the exact fixture.
 */
const cornerCase = (
  surfaceCriterion: GradingCriterion,
  analyticCriterion: GradingCriterion,
  target: Target,
  over: Partial<CornerInput> = {},
): CornerInput => ({
  vx: 0, vy: 0, vz: 10,
  surfaceMember: straight(-L, 0, 0, 0, 10, 10),
  surfaceIncoming: true,
  analyticMember: straight(0, 0, 0, L, 10, 10),
  analyticIncoming: false,
  side: 'right',
  surfaceCriterion,
  analyticCriterion,
  maxSearchDistance: 50,
  target,
  buildMesh: false,
  ...over,
});

// ---------------------------------------------------------------------------
// Timing + rendering helpers
// ---------------------------------------------------------------------------
const digest = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

const timed = <T>(fn: () => T): { value: T; ms: number } => {
  const start = performance.now();
  const value = fn();
  return { value, ms: performance.now() - start };
};

const repMedian = <T>(count: number, fn: () => T): { value: T; ms: number } => {
  const runs: Array<{ value: T; ms: number }> = [];
  for (let i = 0; i < count; i += 1) runs.push(timed(fn));
  return { value: runs[runs.length - 1]!.value, ms: median(runs.map((run) => run.ms)) };
};

const repsFor = (scale: number): number => (QUICK ? 3 : scale >= 1000 ? 3 : 7);

// ---------------------------------------------------------------------------
// Core adapter loading (dynamic; an absent module must not crash the harness)
// ---------------------------------------------------------------------------
const CORE_EXPORTS = [
  'resolveSurfaceAnalyticCorner',
  'solveSurfaceAnalyticCorner',
  'solvePhase20iSurfaceAnalyticCorner',
  'solveHybridCorner',
];

interface CoreLoad {
  solve: CornerSolve | null;
  note: string;
}

const loadCore = async (): Promise<CoreLoad> => {
  try {
    const mod = (await import('./phase20iSurfaceAnalyticCornerCore')) as Record<string, unknown>;
    for (const name of CORE_EXPORTS) {
      const candidate = mod[name];
      if (typeof candidate === 'function') {
        return { solve: candidate as CornerSolve, note: `adapter ${name}` };
      }
    }
    return { solve: null, note: 'core module present but no recognized adapter export' };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { solve: null, note: `core module absent (${reason})` };
  }
};

const asResult = (value: unknown): CornerResult | null =>
  typeof value === 'object' && value !== null && 'outcome' in value
    ? (value as CornerResult)
    : null;

interface HybridRow {
  label: string;
  solveMs: number | null;
  meshVerts: number | null;
  validateMs: number | null;
  roots: number | null;
  xyGap: number | null;
  zGap: number | null;
  turn: string;
  outcome: string;
  note: string;
}

const runHybrid = (core: CoreLoad, label: string, input: CornerInput): HybridRow => {
  const solve = core.solve;
  if (!solve) {
    return {
      label, solveMs: null, meshVerts: null, validateMs: null,
      roots: null, xyGap: null, zGap: null, turn: '—', outcome: 'skip-TBD', note: core.note,
    };
  }
  try {
    const run = repMedian(repsFor(1), () => solve(input));
    const out = asResult(run.value);
    if (!out) {
      return {
        label, solveMs: run.ms, meshVerts: null, validateMs: null,
        roots: null, xyGap: null, zGap: null, turn: '—', outcome: 'skip-TBD',
        note: 'unrecognized result shape',
      };
    }
    let meshVerts: number | null = null;
    let validateMs: number | null = null;
    if (out.mesh) {
      const mesh = out.mesh;
      meshVerts = mesh.points.length / 3;
      validateMs = timed(() => validateGroupMesh({ points: mesh.points, triangles: mesh.triangles })).ms;
    }
    return {
      label,
      solveMs: run.ms,
      meshVerts,
      validateMs,
      roots: out.rootCount,
      xyGap: out.xyGap,
      zGap: out.zGap,
      turn: out.turn ?? '—',
      outcome: `${out.outcome}${out.detail ? `/${out.detail}` : ''}${out.mesh && !out.mesh.valid ? ' (mesh INVALID)' : ''}`,
      note: '',
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      label, solveMs: null, meshVerts: null, validateMs: null,
      roots: null, xyGap: null, zGap: null, turn: '—', outcome: 'skip-TBD',
      note: `adapter threw (${reason})`,
    };
  }
};

const hybridTable = (rows: HybridRow[], title: string): void => {
  console.log(`\n## ${title}\n`);
  console.log('| case | solve ms | mesh verts | validate ms | roots | xy gap | z gap | turn | outcome | note |');
  console.log('|---|---:|---:|---:|---:|---:|---:|---|---|---|');
  for (const row of rows) {
    const num = (v: number | null, digits = 4): string => (v === null ? '—' : v.toFixed(digits));
    console.log(
      `| ${row.label} | ${num(row.solveMs)} | ${num(row.meshVerts, 1)} | ${num(row.validateMs)} | ` +
      `${row.roots ?? '—'} | ${num(row.xyGap, 9)} | ${num(row.zGap, 9)} | ${row.turn} | ${row.outcome} | ${row.note} |`,
    );
  }
  console.log('\n> Mesh assembly is inside the adapter solve (the adapter returns the assembled mesh);');
  console.log('> `validate ms` times `validateGroupMesh` on that mesh separately. No timing gate.');
};

// ---------------------------------------------------------------------------
// A. Controls — Surface↔Surface vs Analytic↔Analytic
// ---------------------------------------------------------------------------
const controlMatrix = (): void => {
  console.log('\n## A. Controls — Surface↔Surface vs Analytic↔Analytic\n');
  console.log('| case | courses | solve ms | validate ms | verts | tris | corners | outcome | digest |');
  console.log('|---|---:|---:|---:|---:|---:|---:|---|---|');
  const controls: Array<[string, ResolvedGradingSource[], GradingCriterion[], Target | undefined, boolean]> = [
    ['surface closed square (fixed)', PAD_SURFACE, PAD_SURFACE.map(() => FIXED(-0.5)), FLAT_SURFACE, true],
    ['surface closed square (cut-fill)', PAD_SURFACE, PAD_SURFACE.map(() => CUTFILL(-0.5, -0.5)), FLAT_SURFACE, true],
    ['analytic closed square (Distance)', PAD, PAD.map(() => DIST(-0.5, 20)), undefined, true],
    ['analytic closed square (D/E/Rel)', PAD, [DIST(-0.5, 20), ELEV(-0.5, 0), REL(-0.5, -10), DIST(-0.5, 20)], undefined, true],
    ['analytic open staircase', staircase(20, 10), staircase(20, 10).map((_, i) => (i % 2 === 0 ? DIST(-0.5, 20) : REL(-0.5, -10))), undefined, false],
  ];
  for (const [label, members, memberCriteria, target, closed] of controls) {
    const run = repMedian(repsFor(members.length), () =>
      computeGradingGroupFromSnapshots({
        groupId: 'g20i-control', revision: 'ggrev1:perf', members, side: 'right',
        criterion: memberCriteria[0]!, memberCriteria,
        maxSearchDistance: 50, curveChordTolerance: 0.05, closed,
        ...(target ? { target } : {}),
      }),
    );
    const out = run.value;
    if (!out.ok) {
      console.log(`| ${label} | ${members.length} | ${fmt(run.ms)} | — | — | — | — | ${out.code}${out.detail ? `/${out.detail}` : ''} | — |`);
      continue;
    }
    const validateMs = timed(() => validateGroupMesh(out.result.gradingMesh)).ms;
    console.log(
      `| ${label} | ${members.length} | ${fmt(run.ms)} | ${fmt(validateMs)} | ` +
      `${out.result.gradingMesh.points.length / 3} | ${out.result.gradingMesh.triangles.length / 3} | ` +
      `${out.result.corners.length} | ok | ${digest(out.result)} |`,
    );
  }
  console.log('\n> Controls are the real engine seams; candidate rows below are measured against them.');
};

// ---------------------------------------------------------------------------
// B–G. Candidate (surface↔analytic) cases
// ---------------------------------------------------------------------------
const candidateMatrix = (core: CoreLoad): void => {
  console.log(`\n## Candidate cases (core: ${core.note})\n`);

  hybridTable([
    runHybrid(core, 'B exact fixed/Relative', cornerCase(FIXED(-0.5), REL(-0.5, -10), FLAT)),
    runHybrid(core, 'B exact fixed/Distance', cornerCase(FIXED(-0.5), DIST(-0.5, 20), FLAT)),
    runHybrid(core, 'C exact fixed/Elevation', cornerCase(FIXED(-0.5), ELEV(-0.5, 0), FLAT)),
    runHybrid(core, 'B reversed (Relative/fixed)', cornerCase(FIXED(-0.5), REL(-0.5, -10), FLAT, {
      surfaceMember: straight(0, 0, L, 0, 10, 10), surfaceIncoming: false,
      analyticMember: straight(0, -L, 0, 0, 10, 10), analyticIncoming: true,
    })),
  ], 'B/C. Exact + analytic-kind variants');

  hybridTable([
    runHybrid(core, 'D residual mismatch (Δ=-12)', cornerCase(FIXED(-0.5), REL(-0.5, -12), FLAT)),
    runHybrid(core, 'D target void', cornerCase(FIXED(-0.5), REL(-0.5, -10), VOID)),
    runHybrid(core, 'D parallel seam/limit', cornerCase(FIXED(-0.5), REL(-0.5, -10), FLAT, {
      analyticMember: straight(0, 0, 0, L, 10, 10 + 0.5 * L),
    })),
  ], 'D. Fail-closed prototypes');

  hybridTable([
    runHybrid(core, 'E GAP (outside turn)', cornerCase(FIXED(-0.5), REL(-0.5, -10), FLAT, { buildMesh: true })),
    runHybrid(core, 'E OVERLAP (inside turn)', cornerCase(FIXED(-0.5), REL(-0.5, -10), FLAT, {
      analyticMember: straight(0, 0, 0, -L, 10, 10), buildMesh: true,
    })),
    runHybrid(core, 'E multi-root (fine TIN)', cornerCase(FIXED(-0.5), REL(-0.5, -10), FINE)),
  ], 'E. GAP/OVERLAP prototype + multi-root');

  const arc = { arc: { centerX: 100, centerY: 100, radius: 100, startAngle: Math.PI, endAngle: Math.PI * 1.5, sweepCCW: true } };
  const arcPlan = linearizeGradingArc(
    arc.arc.centerX, arc.arc.centerY, arc.arc.radius,
    arc.arc.startAngle, arc.arc.endAngle, arc.arc.sweepCCW, 10, 10, 0.05,
  );
  const arcRows: HybridRow[] = [];
  if (arcPlan) {
    for (let i = 1; i + 1 < arcPlan.points.length; i += 1) {
      const a = arcPlan.points[i - 1]!;
      const b = arcPlan.points[i]!;
      const c = arcPlan.points[i + 1]!;
      arcRows.push(runHybrid(core, `arc joint ${i}`, cornerCase(FIXED(-0.5), REL(-0.5, -10), FLAT, {
        vx: b.x, vy: b.y, vz: b.z,
        surfaceMember: straight(a.x, a.y, b.x, b.y, a.z, b.z),
        analyticMember: straight(b.x, b.y, c.x, c.y, b.z, c.z),
      })));
    }
  }
  hybridTable(arcRows, `F. Arc ladder (${arcPlan ? arcPlan.subdivisions : 0} segments)`);

  const far = 2_000_000;
  const north = 7_000_000;
  const shifted = flatTarget(200, far - 100, far + 200, north - 100, north + 200, 0);
  hybridTable([
    runHybrid(core, 'F triangulation A (coarse)', cornerCase(FIXED(-0.5), REL(-0.5, -10), FLAT)),
    runHybrid(core, 'F triangulation B (fine)', cornerCase(FIXED(-0.5), REL(-0.5, -10), FINE)),
    runHybrid(core, 'G large coords (E≈2M/N≈7M)', cornerCase(FIXED(-0.5), REL(-0.5, -10), shifted, {
      vx: far, vy: north, vz: 10,
      surfaceMember: straight(far - L, north, far, north, 10, 10),
      analyticMember: straight(far, north, far, north + L, 10, 10),
    })),
  ], 'F/G. Triangulation variants + large coordinates');
};

// ---------------------------------------------------------------------------
// H. Corpus batch (cases/sec)
// ---------------------------------------------------------------------------
const corpusMatrix = (core: CoreLoad): void => {
  const size = QUICK ? 200 : 2000;
  const rand = mulberry32(202011);
  const inputs: CornerInput[] = [];
  for (let i = 0; i < size; i += 1) {
    const angle = (rand() - 0.5) * Math.PI;
    const kind = i % 3;
    const analyticCriterion =
      kind === 0 ? DIST(-0.5, 15 + rand() * 10)
        : kind === 1 ? ELEV(-0.5, 9 + rand())
          : REL(-0.5, -(5 + rand() * 10));
    const ex = Math.cos(angle) * L;
    const ey = Math.sin(angle) * L;
    inputs.push(cornerCase(FIXED(-0.5), analyticCriterion, FLAT, {
      analyticMember: straight(0, 0, ex, ey, 10, 10),
    }));
  }
  console.log(`\n## H. Corpus batch (${size} deterministic cases)\n`);
  console.log('| corpus | cases | total ms | cases/sec | exact | transition | gap | parallel | other |');
  console.log('|---|---:|---:|---:|---:|---:|---:|---:|---:|');
  if (!core.solve) {
    console.log(`| ${QUICK ? 'quick' : 'full'} | ${size} | skip-TBD | skip-TBD | — | — | — | — | — |`);
    console.log(`\n> ${core.note}.`);
    return;
  }
  const tally = { exact: 0, transition: 0, gap: 0, parallel: 0, other: 0 };
  const solve: CornerSolve = core.solve;
  const start = performance.now();
  for (const input of inputs) {
    let out: CornerResult | null = null;
    try {
      out = asResult(solve(input));
    } catch {
      out = null;
    }
    if (!out) { tally.other += 1; continue; }
    if (out.outcome === 'EXACT_COMMON_TIE') tally.exact += 1;
    else if (out.outcome === 'TRANSITION_REQUIRED') tally.transition += 1;
    else if (out.outcome.includes('GAP')) tally.gap += 1;
    else if (out.outcome.includes('PARALLEL')) tally.parallel += 1;
    else tally.other += 1;
  }
  const totalMs = performance.now() - start;
  console.log(
    `| ${QUICK ? 'quick' : 'full'} | ${size} | ${fmt(totalMs)} | ${(size / (totalMs / 1000)).toFixed(1)} | ` +
    `${tally.exact} | ${tally.transition} | ${tally.gap} | ${tally.parallel} | ${tally.other} |`,
  );
  console.log('\n> No timing threshold; cases/sec is reported for information only.');
};

// ---------------------------------------------------------------------------
// I. Deterministic repeats
// ---------------------------------------------------------------------------
const determinismMatrix = (core: CoreLoad): void => {
  console.log('\n## I. Deterministic repeats (byte-digest stability)\n');
  console.log('| case | repeats | unique digests | first digest |');
  console.log('|---|---:|---:|---|');
  const cases: Array<[string, CornerInput]> = [
    ['B exact fixed/Relative', cornerCase(FIXED(-0.5), REL(-0.5, -10), FLAT)],
    ['B exact fixed/Distance', cornerCase(FIXED(-0.5), DIST(-0.5, 20), FLAT)],
  ];
  for (const [label, input] of cases) {
    if (!core.solve) {
      console.log(`| ${label} | 15 | skip-TBD | — |`);
      continue;
    }
    const solve: CornerSolve = core.solve;
    const seen = new Set<string>();
    for (let i = 0; i < 15; i += 1) {
      try {
        seen.add(digest(solve(input)));
      } catch (error) {
        seen.add(`err:${error instanceof Error ? error.message : String(error)}`);
      }
    }
    console.log(`| ${label} | 15 | ${seen.size} | ${[...seen][0]} |`);
  }
};

const main = async (): Promise<void> => {
  console.log('# Phase 20I surface↔analytic grading corner performance evidence (measured)');
  console.log(`\n- node ${process.version}; ${process.platform} ${process.arch}`);
  console.log(`- quick mode: ${QUICK}`);
  console.log(`- heap at start: ${heapMB().toFixed(1)} MB`);
  console.log('- fixtures: flat grid targets at Z=0 / Z=100 (coarse/fine/far), two 100x100 closed pads');
  console.log('  (Z=10 analytic, Z=110 surface), a staircase chain, and a radius-100 quarter-arc linearization ladder;');
  console.log('  fixture construction is outside the timed region.');
  console.log('\n> No timing gate exists anywhere in this harness; every figure is an actual run.');
  console.log('> Controls use the real engine seams. Candidate rows require the core worker adapter');
  console.log('> (scripts/phase20iSurfaceAnalyticCornerCore.ts) and report skip-TBD without it.');
  const core = await loadCore();
  controlMatrix();
  candidateMatrix(core);
  corpusMatrix(core);
  determinismMatrix(core);
  console.log(`\n- heap at end: ${heapMB().toFixed(1)} MB`);
  console.log('\nDONE (exit 0)');
};

void main();
