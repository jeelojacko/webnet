/**
 * Phase 20K — hybrid arc×arc MEASUREMENT harness (no thresholds, evidence only).
 *
 * Fixtures are built OUTSIDE every timed region. Each hybrid case is run
 * through `assembleHybridArcGroup({ measure: true })`, which records the
 * production member-solve, corner-resolve, mesh-merge, and validator times.
 * Production comparators (straight hybrid, one-arc hybrid, analytic arc×arc,
 * surface arc×arc) are timed whole.
 *
 * Usage:
 *   npx tsx scripts/phase20kHybridArcPairPerf.ts [--quick]
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { GradingTargetMeshSnapshot } from '../src/engine/cad/grading/gradingComputeTypes';
import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';
import type { GradingCriterion, GradingSide, ResolvedGradingSource } from '../src/engine/cad/grading/gradingTypes';
import {
  DIST,
  FIXED,
  REL,
  SQUARE_CORNERS,
  anchoredRadiusArc,
  assembleHybridArcGroup,
  auditMesh,
  buildCorpus,
  flatTin,
  primaryArcPair,
  roundedSquareMembers,
  translateArcMember,
  translateTarget,
  type HybridArcGroupInput,
  type HybridArcGroupResult,
} from './phase20kHybridArcPairGroups';

const QUICK = process.argv.includes('--quick');
const REPS = QUICK ? 1 : 5;

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};

const fmt = (v: number): string => (v >= 100 ? v.toFixed(1) : v.toFixed(3));

interface PerfRow {
  label: string;
  kind: 'hybrid' | 'production';
  model: string;
  joints: number;
  chords: number;
  srcPts: number;
  candidates: number;
  roots: number;
  solveMs: number;
  cornerMs: number;
  mergeMs: number;
  validateMs: number;
  totalMs: number;
  verts: number;
  tris: number;
  msPerJoint: number;
  audit: string;
  digest: string;
  detail?: string;
}

const measureHybrid = (label: string, input: HybridArcGroupInput): PerfRow => {
  const total: number[] = [];
  const solve: number[] = [];
  const corner: number[] = [];
  const merge: number[] = [];
  const validate: number[] = [];
  let last: HybridArcGroupResult | null = null;
  let failed = '';
  for (let r = 0; r < REPS; r += 1) {
    const t = performance.now();
    const out = assembleHybridArcGroup({ ...input, measure: true });
    total.push(performance.now() - t);
    if (!out.ok) { failed = `${out.code}/${out.detail}`; continue; }
    last = out;
    if (out.stageMs) {
      solve.push(out.stageMs.solve);
      corner.push(out.stageMs.corner);
      merge.push(out.stageMs.merge);
      validate.push(out.stageMs.validate);
    }
  }
  if (!last) {
    return {
      label, kind: 'hybrid', model: input.models[0]!, joints: 0, chords: 0, srcPts: 0,
      candidates: 0, roots: 0, solveMs: 0, cornerMs: 0, mergeMs: 0, validateMs: 0,
      totalMs: median(total), verts: 0, tris: 0, msPerJoint: 0, audit: 'n/a',
      digest: '-', detail: failed || 'failed',
    };
  }
  const audit = auditMesh(last.mesh, last.daylight, input.closed, last.planArea);
  const totalMs = median(total);
  const joints = input.closed ? input.members.length : input.members.length - 1;
  return {
    label, kind: 'hybrid', model: input.models[0]!,
    joints, chords: last.memberChords, srcPts: last.memberSourcePoints,
    candidates: last.candidateCount, roots: last.rootCounts.reduce((a, b) => a + b, 0),
    solveMs: median(solve), cornerMs: median(corner), mergeMs: median(merge), validateMs: median(validate),
    totalMs, verts: last.mesh.points.length / 3, tris: last.mesh.triangles.length / 3,
    msPerJoint: joints > 0 ? totalMs / joints : 0,
    audit: audit.pass ? 'pass' : `fail(${audit.issues.join(';')})`,
    digest: last.meshDigest,
    ...(failed ? { detail: failed } : {}),
  };
};

const measureProduction = (label: string, members: ResolvedGradingSource[], criteria: GradingCriterion[], target?: GradingTargetMeshSnapshot): PerfRow => {
  const times: number[] = [];
  let verts = 0;
  let tris = 0;
  let digest = '-';
  let detail = '';
  for (let r = 0; r < REPS; r += 1) {
    const t = performance.now();
    const out = computeGradingGroupFromSnapshots({
      groupId: 'perf', revision: 'perf', members, side: 'right', criterion: criteria[0]!,
      memberCriteria: criteria, maxSearchDistance: 100, curveChordTolerance: 0.1,
      closed: true, ...(target ? { target } : {}),
    });
    times.push(performance.now() - t);
    if (out.ok) {
      verts = out.result.gradingMesh.points.length / 3;
      tris = out.result.gradingMesh.triangles.length / 3;
      digest = `${out.result.corners.length} ties`;
    } else {
      detail = `${out.code}/${out.detail}`;
    }
  }
  return {
    label, kind: 'production', model: 'chord', joints: members.length, chords: 0, srcPts: 0,
    candidates: 0, roots: 0, solveMs: 0, cornerMs: 0, mergeMs: 0, validateMs: 0,
    totalMs: median(times), verts, tris,
    msPerJoint: members.length > 0 ? median(times) / members.length : 0,
    audit: 'n/a', digest, ...(detail ? { detail } : {}),
  };
};

// ---------------------------------------------------------------------------
// Fixtures (built outside timed regions).

const [bottom, right] = primaryArcPair(10);
const square = roundedSquareMembers(10);
const hybridCriteria: GradingCriterion[] = [FIXED(-0.5), DIST(-0.5, 20), FIXED(-0.5), REL(-0.5, -10)];
const allDist: GradingCriterion[] = [DIST(-0.5, 20), DIST(-0.5, 20), DIST(-0.5, 20), DIST(-0.5, 20)];
const allSurf: GradingCriterion[] = [FIXED(-0.5), FIXED(-0.5), FIXED(-0.5), FIXED(-0.5)];
const tin0 = flatTin(0);

const twoMember = (criteria: GradingCriterion[], tol: number, model: 'chord' | 'true-tangent', side: GradingSide = 'right'): HybridArcGroupInput => ({
  members: [bottom, right], criteria, models: [model, model], side,
  maxSearchDistance: 100, curveChordTolerance: tol, closed: false, target: tin0,
});

const straightFrom = (a: [number, number], b: [number, number], z = 10): ResolvedGradingSource => ({
  startX: a[0], startY: a[1], startZ: z, endX: b[0], endY: b[1], endZ: z,
  length: Math.hypot(b[0] - a[0], b[1] - a[1]), reoriented: false, isArc: false,
});
const straightSquare: ResolvedGradingSource[] = [
  straightFrom(SQUARE_CORNERS[0]!, SQUARE_CORNERS[1]!),
  straightFrom(SQUARE_CORNERS[1]!, SQUARE_CORNERS[2]!),
  straightFrom(SQUARE_CORNERS[2]!, SQUARE_CORNERS[3]!),
  straightFrom(SQUARE_CORNERS[3]!, SQUARE_CORNERS[0]!),
];
// One-arc hybrid: member 0 arc, members 1-3 straight (arc×arc never adjacent).
const oneArc: ResolvedGradingSource[] = [square[0]!.source, ...straightSquare.slice(1)];

const rows: PerfRow[] = [];

// GAP tolerance ladder (open pair).
rows.push(measureHybrid('gap.tol-25.chord', twoMember(hybridCriteria.slice(0, 2), 25, 'chord')));
rows.push(measureHybrid('gap.tol-10.chord', twoMember(hybridCriteria.slice(0, 2), 10, 'chord')));
rows.push(measureHybrid('gap.tol-0.1.chord', twoMember(hybridCriteria.slice(0, 2), 0.1, 'chord')));
rows.push(measureHybrid('gap.tol-0.01.chord', twoMember(hybridCriteria.slice(0, 2), 0.01, 'chord')));
rows.push(measureHybrid('gap.tol-0.1.true-tangent', twoMember(hybridCriteria.slice(0, 2), 0.1, 'true-tangent')));
// OVERLAP: mirrored side.
rows.push(measureHybrid('overlap.tol-0.1.chord', twoMember(hybridCriteria.slice(0, 2), 0.1, 'chord', 'left')));
// Open group + closed square + mismatch.
rows.push(measureHybrid('open.pair.tol-0.1', twoMember(hybridCriteria.slice(0, 2), 0.1, 'chord')));
rows.push(measureHybrid('closed.square.hybrid', {
  members: square, criteria: hybridCriteria, models: ['chord', 'chord', 'chord', 'chord'],
  side: 'right', maxSearchDistance: 100, curveChordTolerance: 0.1, closed: true, target: tin0,
}));
rows.push(measureHybrid('closed.square.mismatch.d24', {
  members: square, criteria: [FIXED(-0.5), DIST(-0.5, 24), FIXED(-0.5), REL(-0.5, -10)],
  models: ['chord', 'chord', 'chord', 'chord'],
  side: 'right', maxSearchDistance: 100, curveChordTolerance: 0.1, closed: true, target: tin0,
}));
// Radius matrix on the primary pair (honest endpoint-anchored arcs; the
// outgoing member is rigidly anchored at the arc's natural end).
for (const radius of [120, 252.5, 500]) {
  const arc = anchoredRadiusArc(radius);
  if (!arc) continue;
  const out = translateArcMember(right, arc.end.x - 100, arc.end.y);
  rows.push(measureHybrid(`radius-${radius}.tol-0.1`, {
    members: [arc, out], criteria: hybridCriteria.slice(0, 2), models: ['chord', 'chord'],
    side: 'right', maxSearchDistance: 100, curveChordTolerance: 0.1, closed: false, target: tin0,
  }));
}
// Offset matrix on the closed square (D and Δ that stay comparable on flat Z=0).
for (const d of [10, 20, 40]) {
  rows.push(measureHybrid(`closed.square.offset-D${d}`, {
    members: square, criteria: [FIXED(-0.5), DIST(-0.5, d), FIXED(-0.5), REL(-0.5, -d / 2)],
    models: ['chord', 'chord', 'chord', 'chord'],
    side: 'right', maxSearchDistance: 100, curveChordTolerance: 0.1, closed: true, target: tin0,
  }));
}
// Projected: same group translated to E≈2M N≈7M.
{
  const dx = 2_000_000;
  const dy = 7_000_000;
  rows.push(measureHybrid('projected.closed.square', {
    members: square.map((m) => translateArcMember(m, dx, dy)), criteria: hybridCriteria,
    models: ['chord', 'chord', 'chord', 'chord'],
    side: 'right', maxSearchDistance: 100, curveChordTolerance: 0.1, closed: true,
    target: translateTarget(tin0, dx, dy),
  }));
}
// Production comparators.
rows.push(measureProduction('prod.straight-hybrid', straightSquare, hybridCriteria, tin0));
rows.push(measureProduction('prod.one-arc-hybrid', oneArc, hybridCriteria, tin0));
rows.push(measureProduction('prod.analytic-arc-pair', square.map((m) => m.source), allDist));
rows.push(measureProduction('prod.surface-arc-pair', square.map((m) => m.source), allSurf, tin0));

// Full corpus batch.
{
  const batches = 5;
  const times: number[] = [];
  let payload = buildCorpus();
  for (let i = 0; i < batches; i += 1) {
    const t = performance.now();
    payload = buildCorpus();
    times.push(performance.now() - t);
  }
  const t = median(times);
  rows.push({
    label: 'corpus.batch', kind: 'hybrid', model: 'mixed', joints: payload.rows.length,
    chords: 0, srcPts: 0, candidates: 0, roots: 0, solveMs: 0, cornerMs: 0, mergeMs: 0, validateMs: 0,
    totalMs: t, verts: 0, tris: 0, msPerJoint: t / payload.rows.length,
    audit: `${payload.summary.mismatched.length} mismatches`,
    digest: `${payload.summary.digests} digests`, detail: `${payload.rows.length} rows (${batches} runs, median)`,
  });
}

// ---------------------------------------------------------------------------
// Report.

const header = ['label', 'kind', 'model', 'joints', 'chords', 'srcPts', 'cand', 'roots', 'solve', 'corner', 'merge', 'valid', 'total', 'verts', 'tris', 'ms/joint', 'audit', 'digest'];
const cells = (r: PerfRow): string[] => [
  r.label, r.kind, r.model, String(r.joints), String(r.chords), String(r.srcPts),
  String(r.candidates), String(r.roots), fmt(r.solveMs), fmt(r.cornerMs), fmt(r.mergeMs), fmt(r.validateMs),
  fmt(r.totalMs), String(r.verts), String(r.tris), r.msPerJoint.toFixed(4), r.audit, r.digest,
];
const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => cells(r)[i]!.length)));
const line = (cs: string[]): string => cs.map((c, i) => c.padEnd(widths[i]!)).join('  ');
console.log(`phase20k perf (${QUICK ? 'quick 1 rep' : `${REPS} reps, median`}) — times in ms`);
console.log(line(header));
console.log(widths.map((w) => '-'.repeat(w)).join('  '));
for (const r of rows) {
  console.log(line(cells(r)));
  if (r.detail) console.log(`${' '.repeat(widths[0]!)}  detail: ${r.detail}`);
}

// Dominant stage per hybrid row.
console.log('\ndominant stage (hybrid rows):');
for (const r of rows.filter((x) => x.kind === 'hybrid' && x.chords > 0)) {
  const stages = { solve: r.solveMs, corner: r.cornerMs, merge: r.mergeMs, validate: r.validateMs };
  const top = Object.entries(stages).sort((a, b) => b[1] - a[1])[0]!;
  console.log(`  ${r.label.padEnd(widths[0]!)}  ${top[0]} (${top[1].toFixed(3)} ms)`);
}

const MEMORY = process.memoryUsage();
console.log(`\nmemory: heapUsed=${(MEMORY.heapUsed / 1024 / 1024).toFixed(1)} MB rss=${(MEMORY.rss / 1024 / 1024).toFixed(1)} MB`);

const outArg = process.argv.includes('--write') ? join(dirname(process.argv[1] ?? '.'), '..', 'docs', 'evidence', 'phase20k', 'perf.json') : null;
if (outArg) {
  writeFileSync(outArg, `${JSON.stringify({ generated: 'phase20k-hybrid-arc-pair-perf', reps: REPS, rows, memory: MEMORY }, null, 2)}\n`);
  console.log(`wrote ${outArg}`);
}
