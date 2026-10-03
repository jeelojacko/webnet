/**
 * Phase 20M.2 WAVE J — transition perf probe (MEASUREMENT ONLY, no tuning).
 *
 * Compares the legacy no-transition group solve against the admitted
 * collinear transition solve on the same 2x20 m geometry. Correctness
 * first: both solves must succeed (legacy via same-offset members, which
 * keep a native corner; transition via the offset step, which needs it).
 *
 * Run: npx tsx scripts/measureTransition20m2.ts
 */
import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';

const DIST = (g: number, d: number) => ({ kind: 'distance', gradeRatio: g, distance: d });
const seg = (sx: number, sy: number, ex: number, ey: number) => ({
  startX: sx, startY: sy, endX: ex, endY: ey, startZ: 10, endZ: 10,
  length: Math.hypot(ex - sx, ey - sy), reoriented: false, isArc: false,
});
const members = [seg(-20, 0, 0, 0), seg(0, 0, 20, 0)];
const transition = {
  policyVersion: 'trp1', jointId: 'joint:0', memberIds: ['A>B', 'B>C'],
  width: 8, lawKind: 'TRANSITION_LINEAR_V1', lawVersion: 'v1',
  criterionFamily: 'distance', side: 'left',
} as const;

const legacy = () => computeGradingGroupFromSnapshots({
  groupId: 'g', revision: 'ggrev1:t', members, side: 'left' as const,
  criterion: DIST(0.5, 5), memberCriteria: [DIST(0.5, 5), DIST(0.5, 5)],
  maxSearchDistance: 50, curveChordTolerance: 0.01, closed: false,
});
const admitted = () => computeGradingGroupFromSnapshots({
  groupId: 'g', revision: 'ggrev1:t', members, side: 'left' as const,
  criterion: DIST(0.5, 5), memberCriteria: [DIST(0.5, 5), DIST(0.5, 7)],
  maxSearchDistance: 50, curveChordTolerance: 0.01, closed: false,
  transition: { ...transition }, transitionMemberKeys: ['A>B', 'B>C'],
});

const check = (label: string, fn: () => { ok: boolean }): void => {
  const r = fn();
  if (!r.ok) throw new Error(`${label} did not solve — perf comparison is meaningless`);
};

const time = (fn: () => unknown, n: number): number[] => {
  fn();
  const samples: number[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  return samples.sort((a, b) => a - b);
};

check('legacy', legacy);
check('transition', admitted);
const N = 200;
const l = time(legacy, N);
const t = time(admitted, N);
const med = (s: number[]): number => s[Math.floor(s.length / 2)]!;
const p95 = (s: number[]): number => s[Math.floor(s.length * 0.95)]!;
console.log(`20M.2 transition perf (n=${N}, ms/solve):`);
console.log(`  legacy no-transition : median ${med(l).toFixed(3)} p95 ${p95(l).toFixed(3)}`);
console.log(`  admitted transition  : median ${med(t).toFixed(3)} p95 ${p95(t).toFixed(3)}`);
console.log(`  ratio (transition/legacy): ${(med(t) / med(l)).toFixed(2)}x`);
