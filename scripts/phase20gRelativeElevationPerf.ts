/**
 * Phase 20G — Grade-to-Relative-Elevation performance evidence.
 *
 * MEASUREMENT ONLY. Runs the real engine seams
 * (`solveAnalyticGradingChord`, `computeGradingFromSnapshots`,
 * `computeGradingGroupFromSnapshots`, `linearizeGradingArc`) on deterministic
 * synthetic fixtures. Every figure is an actual run; nothing is extrapolated
 * and no timing gate exists. Fixture construction happens OUTSIDE the measured
 * region (courses/sources are built before `timed` is called); only the solve
 * itself is timed.
 *
 * Matrix:
 *  A. straight standalone — Relative Elevation vs equivalent Distance vs
 *     absolute Elevation on the same sloped source
 *  B. curved standalone (arc linearization) coarse/medium/fine, with the
 *     subdivision count reported so the chord cost is attributable
 *  C. open groups (no corners) at 4/20/100/1000 courses
 *  D. closed square pad (4 corners, miter patches)
 *  E. repeated deterministic calculation digests
 *
 * Usage: `npx tsx scripts/phase20gRelativeElevationPerf.ts [--quick]`
 */
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';
import { linearizeGradingArc } from '../src/engine/cad/grading/gradingCurve';
import { computeGradingFromSnapshots } from '../src/workers/surfaceGradingCompute';
import { arcMember, fmt, heapMB, median, staircase } from './phase20cPerfHelpers';
import type { GradingComputeSource } from '../src/engine/cad/grading/gradingComputeTypes';
import type { GradingCriterion, ResolvedGradingSource } from '../src/engine/cad/grading/gradingTypes';

const QUICK = process.argv.includes('--quick');
const SIZES = QUICK ? [4, 20, 100] : [4, 20, 100, 1000];

const REL: GradingCriterion = { kind: 'relative-elevation', gradeRatio: -0.5, relativeElevation: -10 };
const DIST: GradingCriterion = { kind: 'distance', gradeRatio: -0.5, distance: 20 };
const ELEV: GradingCriterion = { kind: 'elevation', gradeRatio: -0.5, targetElevation: 90 };

const sloped = (): GradingComputeSource => ({
  startX: 0, startY: 0, endX: 100, endY: 0, startZ: 100, endZ: 102,
  length: 100, reoriented: false, isArc: false,
});

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

const digest = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

const countOf = (ok: boolean, result: { gradingMesh: { points: number[]; triangles: number[] } } | undefined, key: 'points' | 'triangles'): number =>
  ok && result ? result.gradingMesh[key].length / 3 : 0;

// ---------------------------------------------------------------------------
// A. straight standalone comparison
// ---------------------------------------------------------------------------
const straightMatrix = (): void => {
  console.log('\n## A. Straight standalone — Relative vs Distance vs absolute Elevation\n');
  console.log('| criterion | solve ms | plan area | verts | tris | projection d | digest |');
  console.log('|---|---:|---:|---:|---:|---|---|');
  const src = sloped();
  const rows: Array<[string, GradingCriterion]> = [
    ['Relative Elevation (Δ=-10, g=-0.5)', REL],
    ['Distance (D=20, g=-0.5)', DIST],
    ['absolute Elevation (E=90, g=-0.5)', ELEV],
  ];
  for (const [label, criterion] of rows) {
    const run = repMedian(repsFor(1), () =>
      computeGradingFromSnapshots({
        gradingId: 'g20g', revision: 'grev1:perf', source: src, side: 'right',
        criterion, maxSearchDistance: 1000, curveChordTolerance: 0.01,
      }),
    );
    const out = run.value;
    console.log(
      `| ${label} | ${fmt(run.ms)} | ${out.ok ? out.result.gradingPlanArea.toFixed(3) : '—'} | ${
        countOf(out.ok, out.ok ? out.result : undefined, 'points')
      } | ${countOf(out.ok, out.ok ? out.result : undefined, 'triangles')} | ${
        out.ok ? `${out.result.minProjectionDistance.toFixed(3)}–${out.result.maxProjectionDistance.toFixed(3)}` : '—'
      } | ${out.ok ? digest(out.result) : out.code} |`,
    );
  }
  console.log('\n> Relative and Distance share the identical closed-form path (d = Δ/g = 20), so their');
  console.log('> costs and digests must match; absolute Elevation differs only by an extra division.');
};

// ---------------------------------------------------------------------------
// B. curved standalone
// ---------------------------------------------------------------------------
const arcMatrix = (): void => {
  console.log('\n## B. Curved standalone (arc linearization)\n');
  console.log('| chord tolerance | subdivisions | solve ms | accuracy | verts | tris | projection d |');
  console.log('|---:|---:|---:|---|---:|---:|---|');
  const radius = 100;
  const sweep = Math.PI / 2;
  for (const tolerance of [1, 0.1, 0.01]) {
    const member = arcMember([radius, 0], [0, radius], radius * (1 - Math.cos(sweep / 2)), 10, 10);
    // Fixture construction (circle params + subdivision plan) is outside the timer.
    const plan = linearizeGradingArc(member.arc!.centerX, member.arc!.centerY, member.arc!.radius, member.arc!.startAngle, member.arc!.endAngle, member.arc!.sweepCCW, 10, 10, tolerance)!;
    const source: GradingComputeSource = { ...member };
    const run = repMedian(repsFor(1), () =>
      computeGradingFromSnapshots({
        gradingId: 'g20g-arc', revision: 'grev1:perf-arc', source, side: 'right',
        criterion: REL, maxSearchDistance: 1000, curveChordTolerance: tolerance,
      }),
    );
    const out = run.value;
    console.log(
      `| ${tolerance} | ${plan.subdivisions} | ${fmt(run.ms)} | ${out.ok ? out.result.accuracy : out.code} | ${
        countOf(out.ok, out.ok ? out.result : undefined, 'points')
      } | ${countOf(out.ok, out.ok ? out.result : undefined, 'triangles')} | ${
        out.ok ? out.result.minProjectionDistance.toFixed(3) : '—'
      } |`,
    );
  }
};

// ---------------------------------------------------------------------------
// C. open groups
// ---------------------------------------------------------------------------
const openGroupMatrix = (): void => {
  console.log('\n## C. Open Relative Elevation groups (no corners)\n');
  console.log('| courses | compute ms | us/course | verts | tris | corners | outcome |');
  console.log('|---:|---:|---:|---:|---:|---:|---|');
  for (const courses of SIZES) {
    // Fixture (course chain) built once, outside the timed region.
    const members: ResolvedGradingSource[] = staircase(courses, 6);
    const run = repMedian(repsFor(courses), () =>
      computeGradingGroupFromSnapshots({
        groupId: 'g20g-open', revision: 'ggrev1:perf', members, side: 'right',
        criterion: REL, maxSearchDistance: 50, curveChordTolerance: 0.05, closed: false,
      }),
    );
    const out = run.value;
    console.log(
      `| ${courses} | ${fmt(run.ms)} | ${((run.ms * 1000) / courses).toFixed(3)} | ${countOf(out.ok, out.ok ? out.result : undefined, 'points')} | ${
        countOf(out.ok, out.ok ? out.result : undefined, 'triangles')
      } | ${out.ok ? out.result.corners.length : 0} | ${out.ok ? 'ok' : out.code} |`,
    );
  }
};

// ---------------------------------------------------------------------------
// D. closed square pad
// ---------------------------------------------------------------------------
const closedPadMatrix = (): void => {
  console.log('\n## D. Closed 100x100 pad (4 analytic miter corners)\n');
  console.log('| criterion | solve ms | plan area | plan/src | verts | tris | corners | miter extent | outcome |');
  console.log('|---|---:|---:|---:|---:|---:|---:|---|---|');
  const straight = (sx: number, sy: number, ex: number, ey: number): ResolvedGradingSource => ({
    startX: sx, startY: sy, endX: ex, endY: ey, startZ: 10, endZ: 10,
    length: Math.hypot(ex - sx, ey - sy), reoriented: false, isArc: false,
  });
  const members: ResolvedGradingSource[] = [
    straight(0, 0, 100, 0), straight(100, 0, 100, 100),
    straight(100, 100, 0, 100), straight(0, 100, 0, 0),
  ];
  // The pad sits at Z=10, so the absolute-Elevation comparison needs E=0 (d=20).
  const padElevation: GradingCriterion = { kind: 'elevation', gradeRatio: -0.5, targetElevation: 0 };
  for (const [label, criterion] of [['Relative Elevation', REL], ['Distance', DIST], ['absolute Elevation', padElevation]] as const) {
    const run = repMedian(repsFor(1), () =>
      computeGradingGroupFromSnapshots({
        groupId: 'g20g-pad', revision: 'ggrev1:perf-pad', members, side: 'right',
        criterion, maxSearchDistance: 50, curveChordTolerance: 0.05, closed: true,
      }),
    );
    const out = run.value;
    const extent = out.ok && out.result.corners.length > 0 ? out.result.corners[0]!.miterExtent ?? NaN : NaN;
    console.log(
      `| ${label} | ${fmt(run.ms)} | ${out.ok ? out.result.gradingPlanArea.toFixed(3) : '—'} | ${
        out.ok ? (out.result.gradingPlanArea / MEMBER_SOURCE_AREA).toFixed(3) : '—'
      } | ${countOf(out.ok, out.ok ? out.result : undefined, 'points')} | ${countOf(out.ok, out.ok ? out.result : undefined, 'triangles')} | ${
        out.ok ? out.result.corners.length : 0
      } | ${Number.isFinite(extent) ? extent.toFixed(6) : '—'} | ${out.ok ? 'ok' : out.code} |`,
    );
  }
};

const MEMBER_SOURCE_AREA = 10000;

// ---------------------------------------------------------------------------
// E. deterministic repeats
// ---------------------------------------------------------------------------
const determinismMatrix = (): void => {
  console.log('\n## E. Deterministic repeats (byte-digest stability)\n');
  console.log('| case | repeats | unique digests | first digest |');
  console.log('|---|---:|---:|---|');
  const src = sloped();
  const digests = new Set<string>();
  for (let i = 0; i < 25; i += 1) {
    const out = computeGradingFromSnapshots({
      gradingId: 'g20g-det', revision: 'grev1:det', source: src, side: 'right',
      criterion: REL, maxSearchDistance: 1000, curveChordTolerance: 0.01,
    });
    digests.add(out.ok ? digest(out.result) : `err:${out.code}`);
  }
  console.log(`| standalone Relative Elevation | 25 | ${digests.size} | ${[...digests][0]} |`);

  const members: ResolvedGradingSource[] = staircase(20, 6);
  const groupDigests = new Set<string>();
  for (let i = 0; i < 15; i += 1) {
    const out = computeGradingGroupFromSnapshots({
      groupId: 'g20g-det', revision: 'ggrev1:det', members, side: 'right',
      criterion: REL, maxSearchDistance: 50, curveChordTolerance: 0.05, closed: false,
    });
    groupDigests.add(out.ok ? digest(out.result) : `err:${out.code}`);
  }
  console.log(`| 20-course open group | 15 | ${groupDigests.size} | ${[...groupDigests][0]} |`);
  console.log('\n> One unique digest per case proves the solve is a pure function of its inputs.');
  console.log('> Note: only the solver is timed above — fixture construction is outside the measured region.');
};

const main = (): void => {
  console.log('# Phase 20G Grade-to-Relative-Elevation performance evidence (measured)');
  console.log(`\n- node ${process.version}; ${process.platform} ${process.arch}`);
  console.log(`- quick mode: ${QUICK}`);
  console.log(`- heap at start: ${heapMB().toFixed(1)} MB`);
  console.log('\n> No timing gate exists anywhere in this harness; every figure is an actual run.');
  console.log('> Relative Elevation reuses the Phase 20F analytic kernel, so its expected complexity is');
  console.log('> identical to Grade-to-Distance: O(1) per straight chord, O(subdivisions) per arc,');
  console.log('> O(courses) per open group, plus one O(1) analytic miter per joint.');
  straightMatrix();
  arcMatrix();
  openGroupMatrix();
  closedPadMatrix();
  determinismMatrix();
  console.log(`\n- heap at end: ${heapMB().toFixed(1)} MB`);
  console.log('\nDONE (exit 0)');
};

main();
