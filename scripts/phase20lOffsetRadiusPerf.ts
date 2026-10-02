/**
 * Phase 20L — offset-radius MEASUREMENT harness (no thresholds, evidence only).
 *
 * Measures the study primitives: exact offset construction, the chord-normal
 * offset join residual, the full parameter-matrix batch, the independent
 * topology audit of one offset strip, and corpus generation. Fixtures are
 * built outside every timed region. Caches (plan shape / residual) are real
 * study behavior, so each row names whether it hits the cached fast path.
 *
 * Usage:
 *   npx tsx scripts/phase20lOffsetRadiusPerf.ts [--quick]
 */
import {
  DEFAULT_CORPUS_OUT,
  MATRIX_CHORD_TOLERANCE,
  OFFSET_RATIOS,
  OFFSET_RADII,
  OFFSET_SWEEPS_DEG,
  arcPointAt,
  buildOffsetBand,
  buildPhase20lCorpus,
  chordOffsetResidual,
  offsetRadiusMatrix,
  offsetRadiusOf,
  type StudyArc,
} from './phase20lOffsetRadiusAudit';
import type { GradingSide } from '../src/engine/cad/grading/gradingTypes';

const QUICK = process.argv.includes('--quick');
const REPS = QUICK ? 3 : 15;
const DEG = Math.PI / 180;

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};

const fmt = (v: number): string => (v >= 100 ? v.toFixed(1) : v >= 1 ? v.toFixed(3) : v.toExponential(3));

/** Keeps the measured work observable to the JIT (no dead-code elimination). */
let sink = 0;

const arcFor = (radius: number, sweepDeg: number, startAngle: number): StudyArc => ({
  centerX: 0, centerY: 0, radius, startAngle, sweepRad: sweepDeg * DEG,
  sweepCCW: true, startZ: 100, endZ: 100,
});

// Fixtures built OUTSIDE every timed region.
const constructionInputs = OFFSET_RADII.flatMap((radius) =>
  OFFSET_SWEEPS_DEG.flatMap((sweepDeg) =>
    (['left', 'right'] as const).flatMap((side) =>
      OFFSET_RATIOS.map((ratio) => ({ arc: arcFor(radius, sweepDeg, 0.3), side, distance: ratio * radius })),
    ),
  ),
);
const joinArc = arcFor(252.5, 90, 0.3);
const joinSide: GradingSide = 'right';
const joinDistance = 20;

const measure = (fn: () => number): number => {
  const xs: number[] = [];
  for (let r = 0; r < REPS; r += 1) xs.push(fn());
  return median(xs);
};

const rows: Array<{ label: string; ms: number; work: string; note: string }> = [];

rows.push({
  label: 'offset.construction.exact',
  ms: measure(() => {
    const t = performance.now();
    let acc = 0;
    for (const input of constructionInputs) {
      const roff = offsetRadiusOf(input.arc, input.side, input.distance);
      const s = arcPointAt(input.arc, 0, roff, 0);
      const e = arcPointAt(input.arc, 1, roff, 0);
      acc += roff + s.x + s.y + s.z + e.x + e.y + e.z;
    }
    sink += acc;
    return performance.now() - t;
  }),
  work: `${constructionInputs.length} cells`,
  note: 'pure arithmetic, no cache',
});

rows.push({
  label: 'offset.join.chord-residual',
  ms: measure(() => {
    const t = performance.now();
    const residual = chordOffsetResidual(joinArc, joinSide, joinDistance, 0, 0.1);
    sink += residual ?? 0;
    return performance.now() - t;
  }),
  work: '1 shape',
  note: 'plan-shape + residual cache hit after first rep',
});

let coldCounter = 0;
rows.push({
  label: 'offset.join.chord-residual.cold',
  ms: measure(() => {
    // Unique arc per rep so the plan-shape cache misses every time.
    coldCounter += 1;
    const arc = arcFor(252.5, 90, 0.3 + coldCounter * 1e-9);
    const t = performance.now();
    const residual = chordOffsetResidual(arc, joinSide, joinDistance, 0, 0.1);
    sink += residual ?? 0;
    return performance.now() - t;
  }),
  work: '1 shape (cache miss)',
  note: 'linearize + full station residual sweep',
});

rows.push({
  label: 'matrix.batch',
  ms: measure(() => {
    const t = performance.now();
    const cells = offsetRadiusMatrix(MATRIX_CHORD_TOLERANCE);
    sink += cells.length;
    return performance.now() - t;
  }),
  work: `${OFFSET_RADII.length * OFFSET_SWEEPS_DEG.length * 2 * 2 * OFFSET_RATIOS.length * 3 * 2} cells`,
  note: 'fully cached (warm)',
});

rows.push({
  label: 'audit.offset-strip',
  ms: measure(() => {
    const t = performance.now();
    const band = buildOffsetBand(joinArc, joinSide, joinDistance, 0.5, 0);
    sink += band.ok ? band.triangles : 0;
    return performance.now() - t;
  }),
  work: '1 band + independent topology audit',
  note: 'plan-shape cache warm; O(F²) overlap sweep',
});

rows.push({
  label: 'corpus.generation',
  ms: measure(() => {
    const t = performance.now();
    const payload = buildPhase20lCorpus();
    sink += payload.rows.length;
    return performance.now() - t;
  }),
  work: '48 bounded rows',
  note: 'includes topology rows',
});

const width = Math.max(...rows.map((r) => r.label.length));
console.log(`phase20l offset-radius perf (${QUICK ? 'quick' : 'full'}, ${REPS} reps, median) — times in ms`);
console.log(`${'label'.padEnd(width)}  ${'ms'.padStart(11)}  work`);
console.log(`${'-'.repeat(width)}  ${'-'.repeat(11)}  ${'-'.repeat(40)}`);
for (const r of rows) {
  console.log(`${r.label.padEnd(width)}  ${fmt(r.ms).padStart(11)}  ${r.work}`);
  console.log(`${' '.repeat(width)}  ${' '.repeat(11)}  note: ${r.note}`);
}
const MEMORY = process.memoryUsage();
console.log(`\nmemory: heapUsed=${(MEMORY.heapUsed / 1024 / 1024).toFixed(1)} MB rss=${(MEMORY.rss / 1024 / 1024).toFixed(1)} MB`);
console.log(`corpus out: ${DEFAULT_CORPUS_OUT}  (sink=${sink.toFixed(0)})`);
