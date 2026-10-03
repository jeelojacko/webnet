/**
 * Phase 20L.2 exact-offset production performance (measurement only).
 *
 * No thresholds. Fixtures are built ONCE outside every timed region.
 * Each row times the ACTUAL production entry points on P0-admitted open
 * chains (no arc×arc): `tryExactOffsetGroup` (exact route) and
 * `computeGradingGroupFromSnapshots` (dispatcher: exact for A1/B/C5,
 * chord fallback for the arc-pair). Per-engine-stage splits are internal
 * to those calls and not separately instrumented, so the whole-call solve
 * is reported as the dominant stage; tessellation cost is represented by
 * the shared `featureLineArcSubdivisions` count plus emitted points/tris.
 *
 * Usage: npx tsx scripts/phase20l2ExactOffsetPerf.ts [--quick] \
 *   | tee docs/evidence/phase20l2/perf-output.txt
 */
import { featureLineArcSubdivisions } from '../src/engine/cad/cadSurfaceRevision';
import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';
import { tryExactOffsetGroup } from '../src/engine/cad/grading/gradingGroupExactOffset';
import type {
  GradingCriterion,
  GradingSide,
  ResolvedGradingSource,
} from '../src/engine/cad/grading/gradingTypes';

const QUICK = process.argv.includes('--quick');
const REPS = QUICK ? 1 : 5;
const DIST: GradingCriterion = { kind: 'distance', gradeRatio: 1, distance: 5 };

interface Pt { x: number; y: number }
interface Spec { p0: Pt; p1: Pt; arc?: { cx: number; cy: number; ccw: boolean } }
const N = (x: number, y: number): Pt => ({ x, y });

const toSource = (s: Spec): ResolvedGradingSource => {
  if (!s.arc) {
    return {
      startX: s.p0.x, startY: s.p0.y, endX: s.p1.x, endY: s.p1.y,
      startZ: 0, endZ: 0, length: Math.hypot(s.p1.x - s.p0.x, s.p1.y - s.p0.y),
      reoriented: false, isArc: false,
    };
  }
  const radius = Math.hypot(s.p0.x - s.arc.cx, s.p0.y - s.arc.cy);
  const a0 = Math.atan2(s.p0.y - s.arc.cy, s.p0.x - s.arc.cx);
  let a1 = Math.atan2(s.p1.y - s.arc.cy, s.p1.x - s.arc.cx);
  if (s.arc.ccw) { while (a1 <= a0) a1 += 2 * Math.PI; } else { while (a1 >= a0) a1 -= 2 * Math.PI; }
  return {
    startX: s.p0.x, startY: s.p0.y, endX: s.p1.x, endY: s.p1.y,
    startZ: 0, endZ: 0, length: radius * Math.abs(a1 - a0),
    reoriented: false, isArc: true,
    arc: { centerX: s.arc.cx, centerY: s.arc.cy, radius, startAngle: a0, endAngle: a1, sweepCCW: s.arc.ccw },
  };
};

const line = (p0: Pt, p1: Pt): Spec => ({ p0, p1 });
const arc = (p0: Pt, p1: Pt, cx: number, cy: number, ccw: boolean): Spec =>
  ({ p0, p1, arc: { cx, cy, ccw } });

const A1: Spec[] = [line(N(-40, 0), N(0, 0)), arc(N(0, 0), N(50, 50), 50, 0, false)];
const B: Spec[] = [...A1, line(N(50, 50), N(50, 90))];
// Alternating 5-chain: B + 90°-rotated copy of the study corner (no arc×arc).
const C5: Spec[] = [
  ...B,
  arc(N(50, 90), N(0, 140), 50, 140, false),
  line(N(0, 140), N(-40, 140)),
];
// Chord-path reference: arc-pair fallback (existing behavior).
const PAIR: Spec[] = [...A1, arc(N(50, 50), N(10, 90), 10, 50, true)];

const CHAINS: Array<{ id: string; specs: Spec[]; side: GradingSide }> = [
  { id: 'A1-2member', specs: A1, side: 'left' },
  { id: 'B-3member', specs: B, side: 'left' },
  { id: 'C5-5member', specs: C5, side: 'left' },
  { id: 'PAIR-chord', specs: PAIR, side: 'left' },
];
const TOLS = [0.1, 0.01, 0.001];

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};
const fmt = (v: number): string => (v >= 100 ? v.toFixed(1) : v.toFixed(3));

for (const chain of CHAINS) {
  const members = chain.specs.map(toSource);
  // Shared-helper subdivision budget per arc member (source-R side only;
  // the exact route takes the stricter of source/offset over each sweep).
  const arcBudgets = members
    .filter((m) => m.isArc && m.arc)
    .map((m) => {
      const sweep = Math.abs(m.arc!.endAngle - m.arc!.startAngle);
      return TOLS.map((tol) => featureLineArcSubdivisions(m.arc!.radius, sweep, tol));
    });
  for (const tol of TOLS) {
    const exactMs: number[] = [];
    const dispatchMs: number[] = [];
    let route = '?';
    let pts = 0;
    let tris = 0;
    for (let r = 0; r < REPS; r += 1) {
      let t0 = performance.now();
      const attempt = tryExactOffsetGroup({
        groupId: chain.id, revision: `${chain.id}/1`, members,
        side: chain.side, criterion: DIST,
        maxSearchDistance: 100, curveChordTolerance: tol,
      });
      exactMs.push(performance.now() - t0);
      route = attempt.kind;
      t0 = performance.now();
      const out = computeGradingGroupFromSnapshots({
        groupId: chain.id, revision: `${chain.id}/1`, members,
        side: chain.side, criterion: DIST,
        maxSearchDistance: 100, curveChordTolerance: tol, closed: false,
      });
      dispatchMs.push(performance.now() - t0);
      if (out.ok) {
        pts = out.result.gradingMesh.points.length / 3;
        tris = out.result.gradingMesh.triangles.length / 3;
      }
    }
    const ti = TOLS.indexOf(tol);
    const budget = arcBudgets.map((b) => b[ti]).join('+');
    console.log(
      `${chain.id} tol=${tol} route=${route} ` +
      `exactMs=${fmt(median(exactMs))} dispatchMs=${fmt(median(dispatchMs))} ` +
      `arcSubdiv=[${budget}] pts=${pts} tris=${tris}`,
    );
  }
}
