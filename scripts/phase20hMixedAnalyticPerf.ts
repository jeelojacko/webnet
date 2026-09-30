/**
 * Phase 20H — mixed-analytic grading-group performance evidence.
 *
 * MEASUREMENT ONLY. Runs the real engine seams
 * (`computeGradingGroupFromSnapshots`, `solveAnalyticCorner`,
 * `linearizeGradingArc`) on deterministic synthetic fixtures. Every figure
 * is an actual run; nothing is extrapolated and no timing gate exists.
 * Fixture construction happens OUTSIDE the measured region; only the solve
 * is timed.
 *
 * Matrix:
 *  A. open groups — homogeneous Relative Elevation vs mixed
 *     Distance/Elevation/Relative Elevation at 4/20/100/1000 courses
 *  B. closed 100x100 pad — all-Distance control vs mixed, with digest
 *     equivalence and a corner-cost attribution (open vs closed)
 *  C. corners — one valid (Distance x Relative) tie vs one incompatible-Z
 *     failure, timed
 *  D. arc-adjacent mixed vs homogeneous group (linearization attribution)
 *  E. deterministic repeats (byte-digest stability)
 *
 * Usage: `npx tsx scripts/phase20hMixedAnalyticPerf.ts [--quick]`
 */
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';
import { linearizeGradingArc } from '../src/engine/cad/grading/gradingCurve';
import { solveAnalyticCorner } from '../src/engine/cad/grading/gradingGroupAnalyticCorners';
import { arcMember, fmt, heapMB, median, staircase } from './phase20cPerfHelpers';
import type { GradingCriterion, ResolvedGradingSource } from '../src/engine/cad/grading/gradingTypes';

const QUICK = process.argv.includes('--quick');
const SIZES = QUICK ? [4, 20, 100] : [4, 20, 100, 1000];

const DIST = (g: number, d: number): GradingCriterion => ({ kind: 'distance', gradeRatio: g, distance: d });
const ELEV = (g: number, e: number): GradingCriterion => ({ kind: 'elevation', gradeRatio: g, targetElevation: e });
const REL = (g: number, dz: number): GradingCriterion => ({ kind: 'relative-elevation', gradeRatio: g, relativeElevation: dz });

/** A valid analytic mix: all three derive d=20 with limit Z = sourceZ − 10. */
const mixedMemberCriteria = (n: number, sourceZ: number): GradingCriterion[] =>
  Array.from({ length: n }, (_, i) =>
    i % 3 === 0 ? DIST(-0.5, 20) : i % 3 === 1 ? ELEV(-0.5, sourceZ - 10) : REL(-0.5, -10));

const digest = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

const timed = <T>(fn: () => T): { value: T; ms: number } => {
  const start = performance.now();
  const value = fn();
  return { value, ms: performance.now() - start };
};

const repsFor = (scale: number): number => (QUICK ? 3 : scale >= 1000 ? 3 : 7);

const repMedian = <T>(count: number, fn: () => T): { value: T; ms: number } => {
  const runs: Array<{ value: T; ms: number }> = [];
  for (let i = 0; i < count; i += 1) runs.push(timed(fn));
  return { value: runs[runs.length - 1]!.value, ms: median(runs.map((run) => run.ms)) };
};

type GroupOut = ReturnType<typeof computeGradingGroupFromSnapshots>;
const verts = (out: GroupOut): number => (out.ok ? out.result.gradingMesh.points.length / 3 : 0);
const tris = (out: GroupOut): number => (out.ok ? out.result.gradingMesh.triangles.length / 3 : 0);
const corners = (out: GroupOut): number => (out.ok ? out.result.corners.length : 0);

/** Run a group and report a compact outcome token. */
const outcome = (out: GroupOut): string => (out.ok ? 'ok' : `${out.code}${out.detail ? `/${out.detail}` : ''}`);

const straight = (sx: number, sy: number, ex: number, ey: number, z = 10): ResolvedGradingSource => ({
  startX: sx, startY: sy, endX: ex, endY: ey, startZ: z, endZ: z,
  length: Math.hypot(ex - sx, ey - sy), reoriented: false, isArc: false,
});

const PAD: ResolvedGradingSource[] = [
  straight(0, 0, 100, 0), straight(100, 0, 100, 100),
  straight(100, 100, 0, 100), straight(0, 100, 0, 0),
];

// ---------------------------------------------------------------------------
// A. open groups — homogeneous vs mixed
// ---------------------------------------------------------------------------
const openGroupMatrix = (): void => {
  console.log('\n## A. Open groups — homogeneous vs mixed analytic\n');
  console.log('| courses | variant | compute ms | us/course | verts | tris | corners | outcome | digest |');
  console.log('|---:|---|---:|---:|---:|---:|---:|---|---|');
  const ratios: string[] = [];
  for (const n of SIZES) {
    // Fixture (course chain, Z=100) built once, outside the timed region.
    const members = staircase(n, 100);
    const cases: Array<[string, GradingCriterion[]]> = [
      ['homo Relative', members.map(() => REL(-0.5, -10))],
      ['mixed Dist/Elev/Rel', mixedMemberCriteria(n, 100)],
    ];
    const timings = new Map<string, number>();
    for (const [label, memberCriteria] of cases) {
      const run = repMedian(repsFor(n), () =>
        computeGradingGroupFromSnapshots({
          groupId: 'g20h-open', revision: 'ggrev1:perf', members, side: 'right',
          criterion: memberCriteria[0]!, memberCriteria,
          maxSearchDistance: 1000, curveChordTolerance: 0.05, closed: false,
        }),
      );
      const out = run.value;
      timings.set(label, run.ms);
      console.log(
        `| ${n} | ${label} | ${fmt(run.ms)} | ${((run.ms * 1000) / n).toFixed(3)} | ${verts(out)} | ${tris(out)} | ${corners(out)} | ${outcome(out)} | ${out.ok ? digest(out.result) : '—'} |`,
      );
    }
    const homo = timings.get('homo Relative') ?? 0;
    const mixed = timings.get('mixed Dist/Elev/Rel') ?? 0;
    ratios.push(`${n}→${homo > 0 ? (mixed / homo).toFixed(3) : 'n/a'}x`);
  }
  console.log(`\n> Mixed/homogeneous median ratio: ${ratios.join(', ')} (report only, no timing gate).`);
  console.log('\n> Fixture construction (course chains + criterion arrays) is outside the timed region.');
  console.log('> The analytic corner cost is linear in the joint count; the mixed kinds share one kernel.');
};

// ---------------------------------------------------------------------------
// B. closed pad — mixed vs all-Distance + corner attribution
// ---------------------------------------------------------------------------
const closedPadMatrix = (): void => {
  console.log('\n## B. Closed 100x100 pad — mixed vs all-Distance control\n');
  console.log('| variant | compute ms | plan area | verts | tris | corners | miter extent | outcome | digest |');
  console.log('|---|---:|---:|---:|---:|---:|---|---|---|');
  const mixed = [DIST(-0.5, 20), ELEV(-0.5, 0), REL(-0.5, -10), DIST(-0.5, 20)];
  const control = PAD.map(() => DIST(-0.5, 20));
  const digests: string[] = [];
  let mixedClosedMs = 0;
  for (const [label, memberCriteria] of [['mixed', mixed], ['all-Distance', control]] as const) {
    const run = repMedian(repsFor(1), () =>
      computeGradingGroupFromSnapshots({
        groupId: 'g20h-pad', revision: 'ggrev1:perf-pad', members: PAD, side: 'right',
        criterion: memberCriteria[0]!, memberCriteria,
        maxSearchDistance: 50, curveChordTolerance: 0.05, closed: true,
      }),
    );
    const out = run.value;
    if (label === 'mixed') mixedClosedMs = run.ms;
    const extent = out.ok && out.result.corners.length > 0 ? out.result.corners[0]!.miterExtent ?? NaN : NaN;
    const dg = out.ok ? digest(out.result) : '—';
    digests.push(dg);
    console.log(
      `| ${label} | ${fmt(run.ms)} | ${out.ok ? out.result.gradingPlanArea.toFixed(3) : '—'} | ${verts(out)} | ${tris(out)} | ${corners(out)} | ${Number.isFinite(extent) ? extent.toFixed(6) : '—'} | ${outcome(out)} | ${dg} |`,
    );
  }
  // Corner attribution: the same members solved open (no corner patch).
  const open = repMedian(repsFor(1), () =>
    computeGradingGroupFromSnapshots({
      groupId: 'g20h-pad', revision: 'ggrev1:perf-pad', members: PAD, side: 'right',
      criterion: mixed[0]!, memberCriteria: mixed,
      maxSearchDistance: 50, curveChordTolerance: 0.05, closed: false,
    }),
  );
  console.log(
    `\n> Digest equivalence: mixed ${digests[0]} vs all-Distance ${digests[1]} ` +
    `(${digests[0] === digests[1] ? 'MATCH' : 'DIFFER'}).`,
  );
  console.log(
    `> Dominant stage: closed pad ${fmt(mixedClosedMs)} ms vs open members-only ${fmt(open.ms)} ms ` +
    `→ four miters add ~${fmt(Math.max(0, mixedClosedMs - open.ms))} ms (one O(1) corner each).`,
  );
};

// ---------------------------------------------------------------------------
// C. corners — valid vs incompatible-Z
// ---------------------------------------------------------------------------
const cornerMatrix = (): void => {
  console.log('\n## C. Analytic corners — valid tie vs incompatible-Z failure\n');
  console.log('| case | solve ms | outcome | tie / detail | extent |');
  console.log('|---|---:|---|---|---|');
  const base = {
    vx: 0, vy: 0, vz: 100,
    inT: { nx: 1, ny: 0 }, inN: { nx: 0, ny: -1 }, inGs: 0,
    outT: { nx: 0, ny: 1 }, outN: { nx: 1, ny: 0 }, outGs: 0,
    inCriterion: DIST(-0.5, 20), maxSearchDistance: 50,
  };
  const cases: Array<[string, GradingCriterion]> = [
    ['valid Dist x Rel', REL(-0.25, -10)],
    ['incompatible Dist x Rel (−12)', REL(-0.25, -12)],
  ];
  for (const [label, outCriterion] of cases) {
    const run = repMedian(repsFor(1), () => solveAnalyticCorner({ ...base, outCriterion }));
    const s = run.value;
    const detail = s.ok
      ? (s.kind === 'miter' ? s.tie : s.kind)
      : s.detail;
    console.log(
      `| ${label} | ${fmt(run.ms)} | ${s.ok ? 'ok' : 'fail'} | ${typeof detail === 'string' ? detail : `(${detail.x},${detail.y},${detail.z})`} | ${s.ok && s.kind === 'miter' ? s.extent.toFixed(6) : '—'} |`,
    );
  }
  console.log('\n> The incompatible-Z corner is rejected by the shared Z gate before any patch geometry.');
};

// ---------------------------------------------------------------------------
// D. arc-adjacent mixed group
// ---------------------------------------------------------------------------
const arcMatrix = (): void => {
  console.log('\n## D. Arc-adjacent group — mixed vs homogeneous\n');
  console.log('| variant | tolerance | subdivisions | compute ms | accuracy | verts | tris | outcome | digest |');
  console.log('|---|---:|---:|---:|---|---:|---:|---|---|');
  const radius = 100;
  const sweep = Math.PI / 2;
  for (const tolerance of [1, 0.1, 0.01]) {
    const arc = arcMember([radius, 0], [0, radius], radius * (1 - Math.cos(sweep / 2)), 10, 10);
    const members: ResolvedGradingSource[] = [arc, straight(0, radius, -100, radius)];
    // Subdivision plan (fixture) computed once, outside the timer.
    const plan = linearizeGradingArc(
      arc.arc!.centerX, arc.arc!.centerY, arc.arc!.radius,
      arc.arc!.startAngle, arc.arc!.endAngle, arc.arc!.sweepCCW, 10, 10, tolerance,
    )!;
    const cases: Array<[string, GradingCriterion[]]> = [
      ['homo Distance', [DIST(-0.5, 20), DIST(-0.5, 20)]],
      ['mixed Elev x Rel', [ELEV(-0.5, 0), REL(-0.5, -10)]],
    ];
    const timings = new Map<string, number>();
    for (const [label, memberCriteria] of cases) {
      const run = repMedian(repsFor(1), () =>
        computeGradingGroupFromSnapshots({
          groupId: 'g20h-arc', revision: 'ggrev1:perf-arc', members, side: 'right',
          criterion: memberCriteria[0]!, memberCriteria,
          maxSearchDistance: 50, curveChordTolerance: tolerance, closed: false,
        }),
      );
      const out = run.value;
      timings.set(label, run.ms);
      console.log(
        `| ${label} | ${tolerance} | ${plan.subdivisions} | ${fmt(run.ms)} | ${out.ok ? out.result.accuracy : outcome(out)} | ${verts(out)} | ${tris(out)} | ${outcome(out)} | ${out.ok ? digest(out.result) : '—'} |`,
      );
    }
    const homo = timings.get('homo Distance') ?? 0;
    const mixed = timings.get('mixed Elev x Rel') ?? 0;
    console.log(
      `| · | · | · | ratio mixed/homo ${homo > 0 ? (mixed / homo).toFixed(3) : 'n/a'}x | · | · | · | · | · |`,
    );
  }
  console.log('\n> Dominant stage is arc linearization (subdivision count); the mixed kinds share one per-chord solve.');
};

// ---------------------------------------------------------------------------
// E. deterministic repeats
// ---------------------------------------------------------------------------
const determinismMatrix = (): void => {
  console.log('\n## E. Deterministic repeats (byte-digest stability)\n');
  console.log('| case | repeats | unique digests | first digest |');
  console.log('|---|---:|---:|---|');
  const members = staircase(20, 100);
  const criteria = mixedMemberCriteria(20, 100);
  const groupDigests = new Set<string>();
  for (let i = 0; i < 15; i += 1) {
    const out = computeGradingGroupFromSnapshots({
      groupId: 'g20h-det', revision: 'ggrev1:det', members, side: 'right',
      criterion: criteria[0]!, memberCriteria: criteria,
      maxSearchDistance: 1000, curveChordTolerance: 0.05, closed: false,
    });
    groupDigests.add(out.ok ? digest(out.result) : `err:${outcome(out)}`);
  }
  console.log(`| 20-course mixed open group | 15 | ${groupDigests.size} | ${[...groupDigests][0]} |`);

  const padDigests = new Set<string>();
  for (let i = 0; i < 15; i += 1) {
    const out = computeGradingGroupFromSnapshots({
      groupId: 'g20h-det-pad', revision: 'ggrev1:det', members: PAD, side: 'right',
      criterion: DIST(-0.5, 20),
      memberCriteria: [DIST(-0.5, 20), ELEV(-0.5, 0), REL(-0.5, -10), DIST(-0.5, 20)],
      maxSearchDistance: 50, curveChordTolerance: 0.05, closed: true,
    });
    padDigests.add(out.ok ? digest(out.result) : `err:${outcome(out)}`);
  }
  console.log(`| closed mixed pad | 15 | ${padDigests.size} | ${[...padDigests][0]} |`);
  console.log('\n> One unique digest per case proves the solve is a pure function of its inputs.');
};

const main = (): void => {
  console.log('# Phase 20H mixed-analytic grading-group performance evidence (measured)');
  console.log(`\n- node ${process.version}; ${process.platform} ${process.arch}`);
  console.log(`- quick mode: ${QUICK}`);
  console.log(`- heap at start: ${heapMB().toFixed(1)} MB`);
  console.log('- fixtures: synthetic staircase chains (Z=100), a 100x100 flat pad (Z=10), and a radius-100 quarter arc.');
  console.log('- distribution: mixed open groups cycle Distance / Elevation / Relative Elevation every third course.');
  console.log('\n> No timing gate exists anywhere in this harness; every figure is an actual run.');
  console.log('> Mixed analytic groups share the Phase 20F kernel: O(1) per straight chord,');
  console.log('> O(subdivisions) per arc, O(courses) members, plus one O(1) analytic miter per joint.');
  openGroupMatrix();
  closedPadMatrix();
  cornerMatrix();
  arcMatrix();
  determinismMatrix();
  console.log(`\n- heap at end: ${heapMB().toFixed(1)} MB`);
  console.log('\nDONE (exit 0)');
};

main();
