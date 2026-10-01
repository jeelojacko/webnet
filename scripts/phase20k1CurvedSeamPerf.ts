/**
 * Phase 20K.1 Wave D1 — curved-seam production performance (measurement only).
 *
 * No thresholds. All fixtures are built ONCE outside every timed region.
 * Each row times the ACTUAL production engine:
 *   standalone arcs via `computeGradingFromSnapshots`,
 *   groups via `computeGradingGroupFromSnapshots`.
 * `chordMs` times arc linearization alone (same `linearizeGradingArc` the
 * engine uses); `totalMs` is the whole production call. Seam / merge /
 * topology stages are internal to that call and not separately instrumented,
 * so the whole-call solve is reported as the dominant stage.
 *
 * Usage: npx tsx scripts/phase20k1CurvedSeamPerf.ts [--quick]
 */
import type { GradingTargetMeshSnapshot } from '../src/engine/cad/grading/gradingComputeTypes';
import { linearizeGradingArc } from '../src/engine/cad/grading/gradingCurve';
import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';
import type { GradingCriterion, ResolvedGradingSource } from '../src/engine/cad/grading/gradingTypes';
import { computeGradingFromSnapshots } from '../src/workers/surfaceGradingCompute';
import {
  DIST,
  ELEV,
  FIXED,
  REL,
  flatTin,
  primaryArcPair,
  roundedSquareMembers,
  translateArcMember,
  translateTarget,
} from './phase20kHybridArcPairGroups';

const QUICK = process.argv.includes('--quick');
const REPS = QUICK ? 1 : 5;
const SEARCH = 100;

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};
const fmt = (v: number): string => (v >= 100 ? v.toFixed(1) : v.toFixed(3));

interface PerfRow {
  label: string; chords: number; seams: number; ok: string;
  chordMs: number; totalMs: number; verts: number; tris: number;
  msPerChord: number; detail: string;
}

const arcChords = (m: ResolvedGradingSource, tol: number): number => {
  if (!m.isArc || !m.arc) return 1;
  const lin = linearizeGradingArc(
    m.arc.centerX, m.arc.centerY, m.arc.radius,
    m.arc.startAngle, m.arc.endAngle, m.arc.sweepCCW,
    m.startZ, m.endZ, tol,
  );
  return lin ? lin.subdivisions : -1;
};

const timeLinearize = (members: ResolvedGradingSource[], tol: number): number => {
  const ts: number[] = [];
  for (let r = 0; r < REPS; r += 1) {
    const t = performance.now();
    for (const m of members) arcChords(m, tol);
    ts.push(performance.now() - t);
  }
  return median(ts);
};

// --- fixtures (built once, outside timed regions) ---
const tin0 = flatTin(0);
const [bottom] = primaryArcPair(10);
const square = roundedSquareMembers(10);
const squareSources = square.map((m) => m.source);
const straight = (ax: number, ay: number, bx: number, by: number, z = 10): ResolvedGradingSource => ({
  startX: ax, startY: ay, startZ: z, endX: bx, endY: by, endZ: z,
  length: Math.hypot(bx - ax, by - ay), reoriented: false, isArc: false,
});
const oneArcSources: ResolvedGradingSource[] = [
  squareSources[0]!,
  straight(100, 0, 100, 100), straight(100, 100, 0, 100), straight(0, 100, 0, 0),
];
const DX = 2_000_000;
const DY = 7_000_000;
const largeSquare = square.map((m) => translateArcMember(m, DX, DY));
const largeTin = translateTarget(tin0, DX, DY);

const HYBRID_CRIT: GradingCriterion[] = [FIXED(-0.5), DIST(-0.5, 20), FIXED(-0.5), REL(-0.5, -10)];
const ALL_DIST: GradingCriterion[] = [DIST(-0.5, 20), DIST(-0.5, 20), DIST(-0.5, 20), DIST(-0.5, 20)];
const MIXED: GradingCriterion[] = [DIST(-0.5, 20), ELEV(-0.5, 0), DIST(-0.5, 20), REL(-0.5, -10)];

const runStandalone = (
  label: string, source: ResolvedGradingSource,
  criterion: GradingCriterion, tol: number, target?: GradingTargetMeshSnapshot,
): PerfRow => {
  const chords = arcChords(source, tol);
  const chordMs = timeLinearize([source], tol);
  const totals: number[] = [];
  let ok = ''; let verts = 0; let tris = 0; let detail = '';
  for (let r = 0; r < REPS; r += 1) {
    const t = performance.now();
    const out = computeGradingFromSnapshots({
      gradingId: 'perf', revision: 'perf', source, side: 'right',
      criterion, maxSearchDistance: SEARCH, curveChordTolerance: tol,
      ...(target ? { target } : {}),
    });
    totals.push(performance.now() - t);
    if (out.ok) { ok = 'ok'; verts = out.result.gradingMesh.points.length / 3; tris = out.result.gradingMesh.triangles.length / 3; }
    else { ok = `fail:${out.code}`; detail = out.detail ?? ''; }
  }
  const totalMs = median(totals);
  return { label, chords, seams: 0, ok, chordMs, totalMs, verts, tris, msPerChord: chords > 0 ? totalMs / chords : 0, detail };
};

const runGroup = (
  label: string, members: ResolvedGradingSource[], criteria: GradingCriterion[],
  tol: number, closed: boolean, target?: GradingTargetMeshSnapshot,
): PerfRow => {
  const chords = members.reduce((a, m) => a + Math.max(0, arcChords(m, tol)), 0);
  const chordMs = timeLinearize(members, tol);
  const totals: number[] = [];
  let ok = ''; let verts = 0; let tris = 0; let seams = 0; let detail = '';
  for (let r = 0; r < REPS; r += 1) {
    const t = performance.now();
    const out = computeGradingGroupFromSnapshots({
      groupId: 'perf', revision: 'perf', members, side: 'right',
      criterion: criteria[0]!, memberCriteria: criteria,
      maxSearchDistance: SEARCH, curveChordTolerance: tol, closed,
      ...(target ? { target } : {}),
    });
    totals.push(performance.now() - t);
    if (out.ok) {
      ok = 'ok'; seams = out.result.corners.length;
      verts = out.result.gradingMesh.points.length / 3;
      tris = out.result.gradingMesh.triangles.length / 3;
    } else { ok = `fail:${out.code}`; detail = out.detail ?? ''; }
  }
  const totalMs = median(totals);
  return { label, chords, seams, ok, chordMs, totalMs, verts, tris, msPerChord: chords > 0 ? totalMs / chords : 0, detail };
};

const rows: PerfRow[] = [];
const TOLS = [25, 10, 1, 0.1, 0.01, 0.001, 0.0001];

// Standalone arcs × tolerance ladder.
for (const tol of TOLS) {
  rows.push(runStandalone(`standalone.analytic.tol-${tol}`, bottom.source, DIST(-0.5, 20), tol));
  if (rows.length > 40) break;
}
for (const tol of TOLS) rows.push(runStandalone(`standalone.surface.tol-${tol}`, bottom.source, FIXED(-0.5), tol, tin0));
// Group squares × tolerance ladder (all-Distance + mixed-analytic).
for (const tol of TOLS) rows.push(runGroup(`square.alldist.tol-${tol}`, squareSources, ALL_DIST, tol, true));
for (const tol of TOLS) rows.push(runGroup(`square.mixed.tol-${tol}`, squareSources, MIXED, tol, true));
// One-arc hybrid, tied case (fully-tied ALREADY_TIED probe uses a straight
// zero-offset pair), failure/topology-rejection (arc×arc hybrid blocked),
// large coords.
rows.push(runGroup('square.onearc-hybrid.tol-0.1', oneArcSources, HYBRID_CRIT, 0.1, true, tin0));
const tiedSrc: ResolvedGradingSource = { ...bottom.source, startZ: 0, endZ: 0 };
rows.push(runStandalone('standalone.surface.tied-flat', tiedSrc, FIXED(-0.5), 0.1, tin0));
rows.push(runGroup('square.arcxarc-blocked.tol-0.1', squareSources, HYBRID_CRIT, 0.1, true, tin0));
rows.push(runGroup('square.alldist.large.tol-0.1', largeSquare.map((m) => m.source), ALL_DIST, 0.1, true));
rows.push(runGroup('square.alldist.large-surface.tol-0.1',
  largeSquare.map((m) => m.source),
  [FIXED(-0.5), FIXED(-0.5), FIXED(-0.5), FIXED(-0.5)], 0.1, true, largeTin));

const header = ['label', 'chords', 'seams', 'result', 'chordMs', 'totalMs', 'verts', 'tris', 'ms/chord', 'detail'];
const cells = (r: PerfRow): string[] => [r.label, String(r.chords), String(r.seams), r.ok,
  fmt(r.chordMs), fmt(r.totalMs), String(r.verts), String(r.tris), r.msPerChord.toFixed(4), r.detail];
const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => cells(r)[i]!.length)));
const line = (cs: string[]): string => cs.map((c, i) => c.padEnd(widths[i]!)).join('  ');
console.log(`phase20k1 curved-seam perf (${QUICK ? 'quick 1 rep' : `${REPS} reps, median`}) — times in ms`);
console.log(line(header));
console.log(widths.map((w) => '-'.repeat(w)).join('  '));
for (const r of rows) console.log(line(cells(r)));
console.log('\ndominant stage: whole-call production solve (seam/merge/topology internal, not separately instrumented).');
const mem = process.memoryUsage();
console.log(`memory: heapUsed=${(mem.heapUsed / 1024 / 1024).toFixed(1)} MB rss=${(mem.rss / 1024 / 1024).toFixed(1)} MB`);
