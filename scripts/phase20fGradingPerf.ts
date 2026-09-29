/**
 * Phase 20F — target-free (Grade-to-Distance / Grade-to-Elevation) performance
 * evidence.
 *
 * MEASUREMENT ONLY. Runs the real engine seams
 * (`solveAnalyticGradingChord`, `computeGradingFromSnapshots`,
 * `computeGradingGroupFromSnapshots`, `resolveGroupMemberCriteria`,
 * `linearizeGradingArc`) on deterministic synthetic fixtures. Every figure is
 * an actual run; nothing is extrapolated. No timing gate exists.
 *
 * Matrix:
 *  1. standalone analytic solves: straight distance/elevation, sloped, large
 *     coordinates, and curved coarse/med/fine (subdivisions + chord cost)
 *  2. analytic groups: 4/20/100/1000 courses x same-width / varying /
 *     elevation / sparse overrides
 *  3. representative surface group (no-regression control): 4/20/100 courses
 *     against a coarse flat TIN through the legacy fixed-criterion path
 *
 * Usage: `npx tsx scripts/phase20fGradingPerf.ts [--quick]`
 */
import { performance } from 'node:perf_hooks';

import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';
import { resolveGroupMemberCriteria } from '../src/engine/cad/grading/gradingGroupCourseCriteria';
import { linearizeGradingArc } from '../src/engine/cad/grading/gradingCurve';
import { solveAnalyticGradingChord } from '../src/engine/cad/grading/solveAnalyticGradingChord';
import { computeGradingFromSnapshots } from '../src/workers/surfaceGradingCompute';
import {
  arcMember,
  buildGridTin,
  fmt,
  heapMB,
  median,
  staircase,
  type Tin,
} from './phase20cPerfHelpers';
import type { GradingComputeSource } from '../src/engine/cad/grading/gradingComputeTypes';
import type { GradingCriterion, ResolvedGradingSource } from '../src/engine/cad/grading/gradingTypes';

const QUICK = process.argv.includes('--quick');
const SIZES = QUICK ? [4, 20, 100] : [4, 20, 100, 1000];

const timed = <T>(fn: () => T): { value: T; ms: number } => {
  const start = performance.now();
  const value = fn();
  return { value, ms: performance.now() - start };
};

const repsFor = (scale: number): number => (QUICK ? 2 : scale >= 1000 ? 3 : 5);

const repMedian = <T>(count: number, fn: () => T): { value: T; ms: number } => {
  const runs: Array<{ value: T; ms: number }> = [];
  for (let i = 0; i < count; i += 1) runs.push(timed(fn));
  return { value: runs[runs.length - 1]!.value, ms: median(runs.map((run) => run.ms)) };
};

const arcSource = (radius: number, sweep: number): GradingComputeSource => {
  const member = arcMember([radius, 0], [0, radius], radius * (1 - Math.cos(sweep / 2)), 10, 10);
  return { ...member };
};

// ---------------------------------------------------------------------------
// 1. standalone analytic solves
// ---------------------------------------------------------------------------

interface ChordCase {
  name: string;
  source: GradingComputeSource;
  criterion: GradingCriterion;
  subdivisions: number;
  maxSearchDistance: number;
  tolerance: number;
}

const chordCases = (): ChordCase[] => {
  const level: GradingComputeSource = {
    startX: 0, startY: 0, endX: 100, endY: 0, startZ: 100, endZ: 100,
    length: 100, reoriented: false, isArc: false,
  };
  const sloped: GradingComputeSource = { ...level, endZ: 102 };
  const large: GradingComputeSource = {
    startX: 2_000_000, startY: 7_000_000, endX: 2_000_100, endY: 7_000_000,
    startZ: 100, endZ: 100, length: 100, reoriented: false, isArc: false,
  };
  const R = 100;
  const sweep = Math.PI / 2;
  const curved = (tolerance: number): ChordCase => ({
    name: `arc tol=${tolerance}`,
    source: arcSource(R, sweep),
    criterion: { kind: 'distance', gradeRatio: -0.5, distance: 20 },
    subdivisions: linearizeGradingArc(0, 0, R, 0, sweep, true, 10, 10, tolerance)!.subdivisions,
    maxSearchDistance: 50,
    tolerance,
  });
  return [
    { name: 'distance level', source: level, criterion: { kind: 'distance', gradeRatio: -0.5, distance: 20 }, subdivisions: 1, maxSearchDistance: 1000, tolerance: 0.01 },
    { name: 'distance sloped', source: sloped, criterion: { kind: 'distance', gradeRatio: -0.5, distance: 20 }, subdivisions: 1, maxSearchDistance: 1000, tolerance: 0.01 },
    { name: 'elevation', source: sloped, criterion: { kind: 'elevation', gradeRatio: -0.1, targetElevation: 98 }, subdivisions: 1, maxSearchDistance: 1000, tolerance: 0.01 },
    { name: 'large coords', source: large, criterion: { kind: 'distance', gradeRatio: -0.5, distance: 20 }, subdivisions: 1, maxSearchDistance: 1000, tolerance: 0.01 },
    curved(1),
    curved(0.1),
    curved(0.01),
  ];
};

const standaloneMatrix = (): void => {
  console.log('\n## 1. Standalone analytic solves\n');
  console.log('| case | chord us | compute ms | verts | tris | subdivisions | accuracy |');
  console.log('|---|---:|---:|---:|---:|---:|---|');
  for (const testCase of chordCases()) {
    const chordUs = repMedian(20, () =>
      solveAnalyticGradingChord({
        source: testCase.source,
        side: 'right',
        criterion: testCase.criterion,
        maxSearchDistance: testCase.maxSearchDistance,
      }),
    );
    const computed = repMedian(repsFor(testCase.subdivisions), () =>
      computeGradingFromSnapshots({
        gradingId: 'standalone',
        revision: 'gre1:perf',
        source: testCase.source,
        side: 'right',
        criterion: testCase.criterion,
        maxSearchDistance: testCase.maxSearchDistance,
        curveChordTolerance: testCase.tolerance,
      }),
    );
    const ok = computed.value.ok;
    console.log(
      `| ${testCase.name} | ${(chordUs.ms * 1000).toFixed(1)} | ${fmt(computed.ms)} | ${
        ok ? computed.value.result.gradingMesh.points.length / 3 : 0
      } | ${ok ? computed.value.result.gradingMesh.triangles.length / 3 : 0} | ${testCase.subdivisions} | ${
        ok ? computed.value.result.accuracy : computed.value.code
      } |`,
    );
  }
};

// ---------------------------------------------------------------------------
// 2. analytic groups
// ---------------------------------------------------------------------------

type GroupMode = 'same-width' | 'varying' | 'elevation' | 'overrides';

const ANALYTIC_MODES: GroupMode[] = ['same-width', 'varying', 'elevation', 'overrides'];

const groupCriteria = (
  mode: GroupMode,
  courses: number,
): { criterion: GradingCriterion; memberCriteria?: GradingCriterion[] } => {
  if (mode === 'same-width') {
    return { criterion: { kind: 'distance', gradeRatio: 0, distance: 20 } };
  }
  if (mode === 'elevation') {
    return { criterion: { kind: 'elevation', gradeRatio: -0.5, targetElevation: 0 } };
  }
  if (mode === 'varying') {
    const memberCriteria = Array.from({ length: courses }, (_entry, index) => ({
      kind: 'distance' as const,
      gradeRatio: 0,
      distance: [15, 20, 25][index % 3]!,
    }));
    return { criterion: { kind: 'distance', gradeRatio: 0, distance: 20 }, memberCriteria };
  }
  const stride = 4;
  const memberCriteria = Array.from({ length: courses }, (_entry, index) =>
    index % stride === 0
      ? ({ kind: 'distance' as const, gradeRatio: 0, distance: 30 })
      : ({ kind: 'distance' as const, gradeRatio: 0, distance: 20 }),
  );
  return { criterion: { kind: 'distance', gradeRatio: 0, distance: 20 }, memberCriteria };
};

const analyticGroupMatrix = (): void => {
  console.log('\n## 2. Analytic groups — courses x mode\n');
  console.log('| courses | mode | resolve us | compute ms | us/course | verts | tris | corners | outcome |');
  console.log('|---:|---|---:|---:|---:|---:|---:|---:|---|');
  for (const courses of SIZES) {
    const members = staircase(courses, 6);
    for (const mode of ANALYTIC_MODES) {
      const spec = groupCriteria(mode, courses);
      const group = {
        id: 'g20f-perf',
        name: 'Perf',
        sourceFeatureLineId: 'fl20f',
        sourceCourses: members.map((_member, index) => ({
          vertexAId: `v${index}`,
          vertexBId: `v${index + 1}`,
        })),
        side: 'right' as const,
        criterion: spec.criterion,
        maxSearchDistance: 50,
        curveChordTolerance: 0.05,
        cornerMode: 'miter' as const,
        ...(spec.memberCriteria !== undefined ? { courseCriteria: spec.memberCriteria.map((criterion, index) => ({ sourceCourse: { vertexAId: `v${index}`, vertexBId: `v${index + 1}` }, criterion })) } : {}),
      };
      const resolved = repMedian(repsFor(courses), () => resolveGroupMemberCriteria(group));
      const memberCriteria = resolved.value;
      const computed = repMedian(repsFor(courses), () =>
        computeGradingGroupFromSnapshots({
          groupId: group.id,
          revision: 'ggrev1:perf',
          members,
          side: group.side,
          criterion: group.criterion,
          memberCriteria,
          maxSearchDistance: group.maxSearchDistance,
          curveChordTolerance: group.curveChordTolerance,
          closed: false,
        }),
      );
      const ok = computed.value.ok;
      console.log(
        `| ${courses} | ${mode} | ${(resolved.ms * 1000).toFixed(1)} | ${fmt(computed.ms)} | ${(
          (computed.ms * 1000) / courses
        ).toFixed(3)} | ${ok ? computed.value.result.gradingMesh.points.length / 3 : 0} | ${
          ok ? computed.value.result.gradingMesh.triangles.length / 3 : 0
        } | ${ok ? computed.value.result.corners.length : 0} | ${ok ? 'ok' : computed.value.code} |`,
      );
    }
  }
};

// ---------------------------------------------------------------------------
// 3. representative surface group (no-regression control)
// ---------------------------------------------------------------------------

const flatSurfaceTin = (): Tin => buildGridTin(QUICK ? 2000 : 4000, -200, 2600, -200, 2600, () => 0);

const surfaceMatrix = (): void => {
  console.log('\n## 3. Surface group control (legacy fixed criterion, no-regression)\n');
  console.log('| courses | compute ms | us/course | verts | tris | corners | outcome |');
  console.log('|---:|---:|---:|---:|---:|---:|---|');
  const target = flatSurfaceTin();
  for (const courses of QUICK ? [4, 20] : [4, 20, 100]) {
    const members: ResolvedGradingSource[] = staircase(courses, 6);
    const computed = repMedian(repsFor(courses), () =>
      computeGradingGroupFromSnapshots({
        groupId: 'g20f-surface',
        revision: 'ggrev1:perf',
        members,
        side: 'right',
        criterion: { kind: 'fixed', gradeRatio: -0.5 },
        maxSearchDistance: 15,
        curveChordTolerance: 0.05,
        closed: false,
        target,
      }),
    );
    const ok = computed.value.ok;
    console.log(
      `| ${courses} | ${fmt(computed.ms)} | ${((computed.ms * 1000) / courses).toFixed(3)} | ${
        ok ? computed.value.result.gradingMesh.points.length / 3 : 0
      } | ${ok ? computed.value.result.gradingMesh.triangles.length / 3 : 0} | ${
        ok ? computed.value.result.corners.length : 0
      } | ${ok ? 'ok' : computed.value.code} |`,
    );
  }
};

const main = (): void => {
  console.log('# Phase 20F target-free grading performance evidence (measured)');
  console.log(`\n- node ${process.version}; ${process.platform} ${process.arch}`);
  console.log(`- quick mode: ${QUICK}`);
  console.log(`- heap at start: ${heapMB().toFixed(1)} MB`);
  console.log('\n> No timing gate exists anywhere in this harness; every figure is an actual run.');
  standaloneMatrix();
  analyticGroupMatrix();
  surfaceMatrix();
  console.log(`\n- heap at end: ${heapMB().toFixed(1)} MB`);
  console.log('\nDONE (exit 0)');
};

main();
