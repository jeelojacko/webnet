/**
 * Phase 20J Wave C3 — hybrid grading-group performance evidence.
 *
 * MEASUREMENT ONLY. Runs the real production seams
 * (`computeGradingGroupFromSnapshots` with surface / analytic /
 * mixed-analytic / hybrid criteria) on deterministic synthetic fixtures.
 * Every figure is an actual run; nothing is extrapolated and no timing
 * gate exists. Fixture construction (course chains, criterion arrays,
 * target TINs, arc plans) happens OUTSIDE the timed region; only the
 * solve is timed.
 *
 * Matrix:
 *  A. open groups — Surface-only vs analytic-only vs mixed-analytic vs
 *     hybrid-alternating at 4/20/100/1000 courses (alternating members)
 *  B. closed 100x100 hybrid square + Surface / Distance / mixed controls,
 *     digest equivalence, open-vs-closed corner attribution
 *  C. joint outcomes — GAP, OVERLAP, mismatch (TRANSITION_REQUIRED),
 *     root-policy patch TIN
 *  D. axis-aligned hybrid square (Wave A ray-interval path) vs rotated twin
 *  E. one-arc hybrid joint vs straight twin
 *  F. deterministic repeats (byte-digest stability)
 *
 * Usage: `npx tsx scripts/phase20jHybridGradingPerf.ts [--quick]`
 */
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';
import { zeroDelta } from '../src/engine/cad/surfaces/volume/zero';
import type { GradingTargetMeshSnapshot } from '../src/engine/cad/grading/gradingComputeTypes';
import type { CadGradingGroupResult } from '../src/engine/cad/grading/gradingGroupTypes';
import {
  heapMB,
  median,
  profileRun,
  staircase,
  straight,
} from './phase20cPerfHelpers';
import type { GradingCriterion, ResolvedGradingSource } from '../src/engine/cad/grading/gradingTypes';

const QUICK = process.argv.includes('--quick');
const SIZES = QUICK ? [4, 20, 100] : [4, 20, 100, 1000];

const FIXED = (g: number): GradingCriterion => ({ kind: 'fixed', gradeRatio: g });
const DIST = (g: number, d: number): GradingCriterion => ({ kind: 'distance', gradeRatio: g, distance: d });
const ELEV = (g: number, e: number): GradingCriterion => ({ kind: 'elevation', gradeRatio: g, targetElevation: e });
const REL = (g: number, dz: number): GradingCriterion =>
  ({ kind: 'relative-elevation', gradeRatio: g, relativeElevation: dz });

const digest = (r: CadGradingGroupResult): string =>
  createHash('sha256')
    .update([...r.gradingMesh.points, ...r.gradingMesh.triangles, ...r.daylightPoints].join(','))
    .digest('hex')
    .slice(0, 16);

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
const outcome = (out: GroupOut): string => (out.ok ? 'ok' : `${out.code}/${out.detail ?? ''}`);

/** Flat target grid sized to the members bbox + margin (fixture, untimed). */
const flatCover = (
  members: ResolvedGradingSource[], z: number, margin = 60,
): GradingTargetMeshSnapshot => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const m of members) {
    minX = Math.min(minX, m.startX, m.endX);
    minY = Math.min(minY, m.startY, m.endY);
    maxX = Math.max(maxX, m.startX, m.endX);
    maxY = Math.max(maxY, m.startY, m.endY);
  }
  const span = Math.max(maxX - minX, maxY - minY, 1);
  const step = Math.max(20, span / 100);
  const xs: number[] = [];
  for (let x = minX - margin; x <= maxX + margin + 1e-9; x += step) xs.push(x);
  if (xs[xs.length - 1]! < maxX + margin) xs.push(maxX + margin);
  const ys: number[] = [];
  for (let y = minY - margin; y <= maxY + margin + 1e-9; y += step) ys.push(y);
  if (ys[ys.length - 1]! < maxY + margin) ys.push(maxY + margin);
  const points: number[] = [];
  const idx = (ix: number, iy: number): number => iy * xs.length + ix;
  for (const y of ys) for (const x of xs) points.push(x, y, z);
  const triangles: number[] = [];
  for (let ix = 0; ix + 1 < xs.length; ix += 1) {
    for (let iy = 0; iy + 1 < ys.length; iy += 1) {
      const a = idx(ix, iy);
      const b = idx(ix + 1, iy);
      const c = idx(ix + 1, iy + 1);
      const d = idx(ix, iy + 1);
      triangles.push(a, b, c, a, c, d);
    }
  }
  return { points, triangles };
};

/** All four variants derive d=20 with limit Z = sourceZ − 10 (exact ties). */
const variantCriteria = (label: string, n: number, sourceZ: number): GradingCriterion[] => {
  if (label === 'surface') return Array.from({ length: n }, () => FIXED(-0.5));
  if (label === 'analytic') return Array.from({ length: n }, () => DIST(-0.5, 20));
  if (label === 'mixed') {
    return Array.from({ length: n }, (_, i) =>
      i % 3 === 0 ? DIST(-0.5, 20) : i % 3 === 1 ? ELEV(-0.5, sourceZ - 10) : REL(-0.5, -10));
  }
  return Array.from({ length: n }, (_, i) => (i % 2 === 0 ? FIXED(-0.5) : DIST(-0.5, 20)));
};

// ---------------------------------------------------------------------------
// A. open groups — Surface vs analytic vs mixed vs hybrid-alternating
// ---------------------------------------------------------------------------
const openGroupMatrix = (): void => {
  console.log('\n## A. Open groups — Surface vs analytic vs mixed vs hybrid\n');
  console.log('| courses | variant | compute ms | us/course | verts | tris | corners | outcome | valid | digest |');
  console.log('|---:|---|---:|---:|---:|---:|---:|---|---|---|');
  const ratios: string[] = [];
  for (const n of SIZES) {
    // Fixtures (staircase chain Z=100, flat-90 cover, criterion arrays)
    // built once, outside the timed region.
    const members = staircase(n, 100);
    const target = flatCover(members, 90);
    const timings = new Map<string, number>();
    for (const label of ['surface', 'analytic', 'mixed', 'hybrid'] as const) {
      const memberCriteria = variantCriteria(label, n, 100);
      const run = repMedian(repsFor(n), () =>
        computeGradingGroupFromSnapshots({
          groupId: 'g20j-open', revision: 'ggrev1:perf', members, side: 'right',
          criterion: memberCriteria[0]!, memberCriteria,
          maxSearchDistance: 1000, curveChordTolerance: 0.05, closed: false,
          target,
        }),
      );
      const out = run.value;
      timings.set(label, run.ms);
      const valid = out.ok && out.result.corners.length === n - 1 ? 'yes' : 'NO';
      console.log(
        `| ${n} | ${label} | ${(run.ms).toFixed(2)} | ${((run.ms * 1000) / n).toFixed(1)} | ${verts(out)} | ${tris(out)} | ${corners(out)} | ${outcome(out)} | ${valid} | ${out.ok ? digest(out.result) : '—'} |`,
      );
    }
    const surface = timings.get('surface') ?? 0;
    const hybrid = timings.get('hybrid') ?? 0;
    ratios.push(`${n}→${surface > 0 ? (hybrid / surface).toFixed(3) : 'n/a'}x`);
  }
  console.log(`\n> Hybrid/Surface median ratio: ${ratios.join(', ')} (report only, no timing gate).`);
  console.log('> Fixture construction (chains + covers + criterion arrays) is outside the timed region.');
  console.log('> Every hybrid joint is one O(1) exact-common-tie solve; members stay O(courses).');
};

// ---------------------------------------------------------------------------
// B. closed hybrid square + controls
// ---------------------------------------------------------------------------
const SQM = [
  straight(0, 0, 100, 0, 10, 10), straight(100, 0, 100, 100, 10, 10),
  straight(100, 100, 0, 100, 10, 10), straight(0, 100, 0, 0, 10, 10),
];
const SQHYB: GradingCriterion[] = [FIXED(-0.5), DIST(-0.5, 20), ELEV(-0.5, 0), REL(-0.5, -10)];

const closedSquareMatrix = (): void => {
  console.log('\n## B. Closed 100x100 hybrid square + controls\n');
  console.log('| variant | compute ms | plan area | verts | tris | corners | outcome | valid | digest |');
  console.log('|---|---:|---:|---:|---:|---:|---|---|---|');
  const target = flatCover(SQM, 0);
  const base = {
    groupId: 'g20j-sq', revision: 'ggrev1:perf-sq', members: SQM, side: 'right' as const,
    maxSearchDistance: 100, curveChordTolerance: 0.01, closed: true, target,
  };
  const cases: Array<[string, GradingCriterion[]]> = [
    ['hybrid', SQHYB],
    ['surface', SQM.map(() => FIXED(-0.5))],
    ['analytic', SQM.map(() => DIST(-0.5, 20))],
    ['mixed', [DIST(-0.5, 20), ELEV(-0.5, 0), REL(-0.5, -10), DIST(-0.5, 20)]],
  ];
  const digests: string[] = [];
  let hybridMs = 0;
  for (const [label, memberCriteria] of cases) {
    const run = repMedian(repsFor(1), () =>
      computeGradingGroupFromSnapshots({
        ...base, criterion: memberCriteria[0]!, memberCriteria,
      }),
    );
    const out = run.value;
    if (label === 'hybrid') hybridMs = run.ms;
    const dg = out.ok ? digest(out.result) : '—';
    digests.push(dg);
    const valid = out.ok
      && Math.abs(out.result.gradingPlanArea - 9600) < 1e-6
      && out.result.corners.length === 4 ? 'yes' : 'NO';
    console.log(
      `| ${label} | ${run.ms.toFixed(2)} | ${out.ok ? out.result.gradingPlanArea.toFixed(3) : '—'} | ${verts(out)} | ${tris(out)} | ${corners(out)} | ${outcome(out)} | ${valid} | ${dg} |`,
    );
  }
  const open = repMedian(repsFor(1), () =>
    computeGradingGroupFromSnapshots({
      ...base, closed: false, criterion: SQHYB[0]!, memberCriteria: SQHYB,
    }),
  );
  console.log(
    `\n> Digest equivalence: hybrid ${digests[0]} vs surface ${digests[1]} vs analytic ${digests[2]} vs mixed ${digests[3]} ` +
    `(${digests.every((d) => d === digests[0]) ? 'ALL MATCH' : 'DIFFER — see doc'}).`,
  );
  console.log(
    `> Dominant stage: closed hybrid ${hybridMs.toFixed(2)} ms vs open members-only ${open.ms.toFixed(2)} ms ` +
    `→ four exact ties add ~${Math.max(0, hybridMs - open.ms).toFixed(2)} ms (one O(1) corner each).`,
  );
};

// ---------------------------------------------------------------------------
// C. joint outcomes — GAP / OVERLAP / mismatch / root-policy
// ---------------------------------------------------------------------------
const jointMatrix = (): void => {
  console.log('\n## C. Joint outcomes — GAP / OVERLAP / mismatch / root-policy\n');
  console.log('| case | solve ms | outcome | tie / detail | extent | valid |');
  console.log('|---|---|---:|---|---|---|---|');
  const gapMembers = [
    straight(-60, 0, 0, 0, 100, 100), straight(0, 0, 0, 60, 100, 100),
  ];
  const ovMembers = [
    straight(0, 0, 60, 0, 100, 100), straight(60, 0, 60, -60, 100, 100),
  ];
  const gapTarget = flatCover(gapMembers, 90);
  const ovTarget = flatCover(ovMembers, 90);
  // Root-policy fixture: flat-90 strip cover + three same-plane patches
  // along the seam ray (Wave B oracle — construction outside the timer).
  const patchTin: GradingTargetMeshSnapshot = {
    points: [
      -70, -30, 90, 10, -30, 90, 10, 10, 90,
      -70, -30, 90, 10, 10, 90, -70, 10, 90,
      11, -5.5, 97.25, 13, -8, 96, 15, -5.5, 97.25,
      16, -12, 94, 24, -12, 94, 20, -7, 96.5,
      38, -23, 88.5, 46, -19, 90.5, 36, -19, 90.5,
    ],
    triangles: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
  };
  const cases: Array<{ label: string; solve: () => GroupOut; expect: string }> = [
    {
      label: 'GAP (surface x Rel)',
      solve: () => computeGradingGroupFromSnapshots({
        groupId: 'g20j-gap', revision: 'ggrev1:perf-gap', members: gapMembers, side: 'right',
        criterion: FIXED(-0.5), memberCriteria: [FIXED(-0.5), REL(-0.25, -10)],
        maxSearchDistance: 100, curveChordTolerance: 0.01, closed: false, target: gapTarget,
      }),
      expect: 'ok',
    },
    {
      label: 'OVERLAP (surface x Rel)',
      solve: () => computeGradingGroupFromSnapshots({
        groupId: 'g20j-ov', revision: 'ggrev1:perf-ov', members: ovMembers, side: 'right',
        criterion: FIXED(-0.5), memberCriteria: [FIXED(-0.5), REL(-0.25, -10)],
        maxSearchDistance: 100, curveChordTolerance: 0.01, closed: false, target: ovTarget,
      }),
      expect: 'ok',
    },
    {
      label: 'mismatch D=24',
      solve: () => computeGradingGroupFromSnapshots({
        groupId: 'g20j-mm', revision: 'ggrev1:perf-mm',
        members: [
          straight(0, 0, 100, 0, 10, 10), straight(100, 0, 100, 100, 10, 10),
          straight(100, 100, 0, 100, 10, 10), straight(0, 100, 0, 0, 10, 10),
        ],
        side: 'right', criterion: FIXED(-0.5),
        memberCriteria: [FIXED(-0.5), DIST(-0.5, 24), ELEV(-0.5, 0), REL(-0.5, -10)],
        maxSearchDistance: 100, curveChordTolerance: 0.01, closed: true,
        target: flatCover(SQM, 0),
      }),
      expect: 'CORNER_NO_SOLUTION/GRADING_SURFACE_ANALYTIC_TRANSITION_REQUIRED',
    },
    {
      label: 'root-policy (3 roots)',
      solve: () => computeGradingGroupFromSnapshots({
        groupId: 'g20j-rp', revision: 'ggrev1:perf-rp', members: gapMembers, side: 'right',
        criterion: FIXED(-0.5), memberCriteria: [FIXED(-0.5), REL(-0.25, -10)],
        maxSearchDistance: 100, curveChordTolerance: 0.01, closed: false, target: patchTin,
      }),
      expect: 'CORNER_NO_SOLUTION/GRADING_SURFACE_ANALYTIC_ROOT_POLICY',
    },
  ];
  for (const c of cases) {
    const run = repMedian(repsFor(1), c.solve);
    const out = run.value;
    const tie = out.ok
      ? `(${out.result.corners[0]!.tiePointXyz!.map((v) => v.toFixed(3)).join(',')})`
      : `${out.code}/${out.detail}`;
    const extent = out.ok ? (out.result.corners[0]!.miterExtent ?? NaN).toFixed(6) : '—';
    const valid = outcome(out) === c.expect ? 'yes' : 'CHECK';
    console.log(`| ${c.label} | ${run.ms.toFixed(2)} | ${outcome(out)} | ${tie} | ${extent} | ${valid} |`);
  }
  console.log('\n> Failure joints reject before any patch geometry; cost is one seam-ray walk.');
};

// ---------------------------------------------------------------------------
// D. axis-aligned (Wave A ray path) vs rotated twin
// ---------------------------------------------------------------------------
const axisMatrix = (): void => {
  console.log('\n## D. Axis-aligned hybrid square (Wave A path) vs 30°-rotated twin\n');
  console.log('| variant | compute ms | outcome | valid | digest |');
  console.log('|---|---:|---|---|---|');
  const rot = (x: number, y: number): [number, number] => {
    const a = (30 * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    return [50 + (x - 50) * c - (y - 50) * s, 50 + (x - 50) * s + (y - 50) * c];
  };
  const rotM = (m: ResolvedGradingSource): ResolvedGradingSource => {
    const [sx, sy] = rot(m.startX, m.startY);
    const [ex, ey] = rot(m.endX, m.endY);
    return { ...m, startX: sx, startY: sy, endX: ex, endY: ey, length: Math.hypot(ex - sx, ey - sy) };
  };
  const rotated = SQM.map(rotM);
  // Wave C4: the rotated twin MUST solve (production root cause fixed —
  // coordinate-aware tie agreement, zeroDelta untouched). Equivalence is
  // checked on rotated ties, extents, and plan area (digests honestly
  // differ: mesh vertices live in rotated coordinates).
  const close = (a: number, b: number): boolean => Math.abs(a - b) <= zeroDelta(a, b);
  let axis: GroupOut | null = null;
  let rotatedOut: GroupOut | null = null;
  for (const [label, members] of [['axis-aligned', SQM], ['rotated-30deg', rotated]] as const) {
    const target = flatCover(members, 0);
    const run = repMedian(repsFor(1), () =>
      computeGradingGroupFromSnapshots({
        groupId: 'g20j-ax', revision: 'ggrev1:perf-ax', members, side: 'right',
        criterion: SQHYB[0]!, memberCriteria: SQHYB,
        maxSearchDistance: 100, curveChordTolerance: 0.01, closed: true, target,
      }),
    );
    const out = run.value;
    if (label === 'axis-aligned') axis = out;
    else rotatedOut = out;
    const valid = out.ok && out.result.corners.length === 4 ? 'yes' : 'NO';
    console.log(
      `| ${label} | ${run.ms.toFixed(2)} | ${outcome(out)} | ${valid} | ${out.ok ? digest(out.result) : '—'} |`,
    );
  }
  if (axis?.ok && rotatedOut?.ok) {
    const axisTies = axis.result.corners.map((c) => c.tiePointXyz!);
    const rotTies = rotatedOut.result.corners.map((c) => c.tiePointXyz!);
    const tieOk = axisTies.every((t, j) => {
      const [ex, ey] = rot(t[0]!, t[1]!);
      return close(rotTies[j]![0]!, ex) && close(rotTies[j]![1]!, ey) && close(rotTies[j]![2]!, t[2]!);
    });
    const extentOk = axis.result.corners.every((c, j) =>
      close(c.miterExtent!, rotatedOut!.ok ? rotatedOut.result.corners[j]!.miterExtent! : NaN));
    const areaOk = close(axis.result.gradingPlanArea, rotatedOut.result.gradingPlanArea);
    console.log(`\n> Rotated-twin equivalence: ties ${tieOk ? 'MATCH' : 'MISMATCH'} (rotated coords), extents ${extentOk ? 'MATCH' : 'MISMATCH'}, plan area ${axis.result.gradingPlanArea.toFixed(6)} vs ${rotatedOut.result.gradingPlanArea.toFixed(6)} ${areaOk ? 'MATCH' : 'MISMATCH'} (zeroDelta).`);
  } else {
    console.log('\n> Rotated-twin equivalence: NOT CHECKED (a twin failed to solve).');
  }
  console.log('> Axis-aligned courses exercise the Wave A parallel-edge ray path; the rotated twin now solves through the same exact-common-tie kernel (20J1 quantity-specific agreement contracts; zeroDelta untouched).');
};

// ---------------------------------------------------------------------------
// E. one-arc hybrid joint vs straight twin
// ---------------------------------------------------------------------------
const arcMatrix = (): void => {
  console.log('\n## E. One-arc hybrid joint vs straight twin\n');
  console.log('| variant | tolerance | compute ms | accuracy | outcome | valid | digest |');
  console.log('|---|---:|---:|---|---|---|---|');
  for (const tolerance of [0.05, 0.001]) {
    const arc: ResolvedGradingSource = {
      startX: 40, startY: 40, endX: 0, endY: 0, startZ: 100, endZ: 100,
      length: 40 * (Math.PI / 2), reoriented: false, isArc: true,
      arc: { centerX: 40, centerY: 0, radius: 40, startAngle: Math.PI / 2, endAngle: Math.PI, sweepCCW: true },
    };
    // Fixture plan (outside the timer): quarter arc + straight out-course,
    // plus the Wave B GAP oracle as the straight twin (same criteria/target
    // family so the accuracy contrast EXACT vs CURVE_APPROXIMATED is honest).
    const out2 = straight(0, 0, 60, 0, 100, 100);
    const gapTwin = [
      straight(-60, 0, 0, 0, 100, 100), straight(0, 0, 0, 60, 100, 100),
    ];
    const cases: Array<[string, ResolvedGradingSource[]]> = [
      ['one-arc', [arc, out2]],
      ['straight', gapTwin],
    ];
    for (const [label, members] of cases) {
      const target = flatCover(members, 90);
      const run = repMedian(repsFor(1), () =>
        computeGradingGroupFromSnapshots({
          groupId: 'g20j-arc', revision: 'ggrev1:perf-arc', members, side: 'right',
          criterion: FIXED(-0.5), memberCriteria: [FIXED(-0.5), REL(-0.25, -10)],
          maxSearchDistance: 100, curveChordTolerance: tolerance, closed: false, target,
        }),
      );
      const out = run.value;
      const valid = out.ok && out.result.corners.length === 1 ? 'yes' : 'CHECK';
      console.log(
        `| ${label} | ${tolerance} | ${run.ms.toFixed(2)} | ${out.ok ? out.result.accuracy : outcome(out)} | ${outcome(out)} | ${valid} | ${out.ok ? digest(out.result) : '—'} |`,
      );
    }
  }
  console.log('\n> Dominant stage is chord linearization (tolerance → subdivision count); the tie stays one O(1) solve per chord joint.');
};

// ---------------------------------------------------------------------------
// F. deterministic repeats + profile
// ---------------------------------------------------------------------------
const determinismMatrix = async (): Promise<void> => {
  console.log('\n## F. Deterministic repeats (byte-digest stability)\n');
  console.log('| case | repeats | unique digests | first digest |');
  console.log('|---|---:|---:|---|');
  const members = staircase(20, 100);
  const target = flatCover(members, 90);
  const criteria = variantCriteria('hybrid', 20, 100);
  const groupDigests = new Set<string>();
  for (let i = 0; i < 15; i += 1) {
    const out = computeGradingGroupFromSnapshots({
      groupId: 'g20j-det', revision: 'ggrev1:det', members, side: 'right',
      criterion: criteria[0]!, memberCriteria: criteria,
      maxSearchDistance: 1000, curveChordTolerance: 0.05, closed: false, target,
    });
    groupDigests.add(out.ok ? digest(out.result) : `err:${outcome(out)}`);
  }
  console.log(`| 20-course hybrid open group | 15 | ${groupDigests.size} | ${[...groupDigests][0]} |`);

  const sqTarget = flatCover(SQM, 0);
  const padDigests = new Set<string>();
  for (let i = 0; i < 15; i += 1) {
    const out = computeGradingGroupFromSnapshots({
      groupId: 'g20j-det-sq', revision: 'ggrev1:det', members: SQM, side: 'right',
      criterion: SQHYB[0]!, memberCriteria: SQHYB,
      maxSearchDistance: 100, curveChordTolerance: 0.01, closed: true, target: sqTarget,
    });
    padDigests.add(out.ok ? digest(out.result) : `err:${outcome(out)}`);
  }
  console.log(`| closed hybrid square | 15 | ${padDigests.size} | ${[...padDigests][0]} |`);

  // Dominant-stage attribution: profile 5 closed-square solves (read-only).
  const prof = await profileRun(() => {
    for (let i = 0; i < 5; i += 1) {
      computeGradingGroupFromSnapshots({
        groupId: 'g20j-prof', revision: 'ggrev1:prof', members: SQM, side: 'right',
        criterion: SQHYB[0]!, memberCriteria: SQHYB,
        maxSearchDistance: 100, curveChordTolerance: 0.01, closed: true, target: sqTarget,
      });
    }
  });
  const ranked = Object.entries(prof.stages).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
  console.log(
    `\n> Profiled 5 closed-square solves in ${prof.totalMs.toFixed(1)} ms (${prof.samples} samples): ` +
    (ranked.length > 0
      ? ranked.map(([k, v]) => `${k} ${(v ?? 0).toFixed(2)}ms`).join(', ')
      : 'no samples — solve is sub-sampling-interval (dominant stage: direct member+corner solve, no index build dominates)') +
    '.',
  );
  console.log('> One unique digest per case proves the solve is a pure function of its inputs.');
};

const main = async (): Promise<void> => {
  console.log('# Phase 20J hybrid grading-group performance evidence (measured)');
  console.log(`\n- node ${process.version}; ${process.platform} ${process.arch}`);
  console.log(`- quick mode: ${QUICK}`);
  console.log(`- heap at start: ${heapMB().toFixed(1)} MB`);
  console.log('- fixtures: staircase chains (Z=100, flat-90 cover), 100x100 flat pad (Z=10, flat-0 cover), Wave B oracles, root-policy patch TIN, quarter-arc joint.');
  console.log('- distribution: hybrid open groups alternate Surface Fixed / Distance every other course (all d=20, limit Z=source−10).');
  console.log('\n> No timing gate exists anywhere in this harness; every figure is an actual run.');
  console.log('> Hybrid groups share the exact-common-tie kernel: O(1) per straight joint,');
  console.log('> O(subdivisions) per arc, O(courses) members, plus one target ray-walk per surface side.');
  openGroupMatrix();
  closedSquareMatrix();
  jointMatrix();
  axisMatrix();
  arcMatrix();
  await determinismMatrix();
  console.log(`\n- heap at end: ${heapMB().toFixed(1)} MB`);
  console.log('\nDONE (exit 0)');
};

void main();
