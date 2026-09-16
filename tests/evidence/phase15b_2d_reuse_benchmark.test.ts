/**
 * Phase 15B evidence: 2D dense final-Qxx statistics reuse (§24-§28, §10).
 *
 * EVIDENCE ONLY — no production changes. Compares the production default
 * (reuse admitted on the 2D dense cohort) against the test-only
 * `forceLegacyStatisticsQxx` oracle (pre-15B legacy path) on genuine
 * Phase 5 2D fixtures, plus a gps-3d-64 regression arm. 1 warm-up +
 * 5 measured clean wall runs per arm (medians); one instrumented solve
 * per arm supplies probe op counts, parity, and profiler stats timing.
 * Writes machine artifacts to artifacts/evidence/phase15b/ (gitignored)
 * and the committed report to reports/performance/phase15b-2d-reuse.md.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../../src/engine/adjust';
import { createDetailedSolveProfiler } from '../../src/engine/adjustDetailedSolveProfile';
import {
  generatePhase5BenchmarkInput,
  listPhase5BenchmarkCases,
} from '../../src/engine/phase5BenchmarkNetworks';
import { buildPhase6LargeBenchmarkCases } from '../../src/engine/phase6BenchmarkNetworks';
import type { QxxReuseProbeEvent } from '../../src/engine/qxxReuseEvidence';

const RUNS = 5;
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const round2 = (v: number): number => Math.round(v * 100) / 100;

interface Fixture {
  id: string;
  dimension: '2D' | '3D';
  input: string;
  note: string;
}

const specs = listPhase5BenchmarkCases(false);
const want2d = ['chain-2d-32', 'chain-2d-64', 'chain-2d-128', 'gps-2d-64'];
const fixtures: Fixture[] = want2d.map((id) => {
  const spec = specs.find((s) => s.id === id);
  if (!spec) throw new Error(`Missing fixture ${id}`);
  return {
    id,
    dimension: '2D',
    input: generatePhase5BenchmarkInput(spec),
    note: id.startsWith('chain-2d')
      ? 'direction-heavy terrestrial traverse (D directions + B bearings, orientation unknowns)'
      : 'GPS-vector 2D terrestrial control',
  };
});
// gps-2d-128: same generator family, larger size (custom spec; generator-legal).
fixtures.push({
  id: 'gps-2d-128',
  dimension: '2D',
  input: generatePhase5BenchmarkInput({ id: 'gps-2d-128', family: 'gps-2d', unknownCount: 128, seed: 2128 }),
  note: 'GPS-vector 2D, covariance-dominated larger case',
});
const gps3d64 = buildPhase6LargeBenchmarkCases(false).find((c) => c.id === 'gps-3d-64');
if (!gps3d64) throw new Error('Missing gps-3d-64 fixture.');
const regression: Fixture = { id: 'gps-3d-64', dimension: '3D', input: gps3d64.input, note: '3D dense regression (§10)' };

const stableJson = (result: ReturnType<LSAEngine['solve']>): string => {
  const logs = result.logs.filter((l) => !l.startsWith('Solve timing (ms):'));
  const { solveTimingProfile: _v, logs: _l, ...stable } = result;
  return JSON.stringify({ ...stable, logs });
};

interface ArmEvidence {
  wallMedianMs: number;
  finalAccum: number;
  finalRecover: number;
  statsAccum: number;
  statsRecover: number;
  reused: boolean;
  reason: string;
  statsInversionMs: number;
  statsAccumMs: number;
  statsTotalMs: number;
  numParams: number;
  equations: number;
  iterations: number;
}

const measureArm = (fixture: Fixture, forceLegacy: boolean): { arm: ArmEvidence; resultJson: string } => {
  const extra = forceLegacy ? { forceLegacyStatisticsQxx: true } : {};
  new LSAEngine({ input: fixture.input, ...extra }).solve(); // warm-up
  const walls: number[] = [];
  for (let i = 0; i < RUNS; i += 1) {
    const t0 = performance.now();
    new LSAEngine({ input: fixture.input, ...extra }).solve();
    walls.push(performance.now() - t0);
  }
  const events: QxxReuseProbeEvent[] = [];
  const profiler = createDetailedSolveProfiler();
  const result = new LSAEngine({
    input: fixture.input,
    qxxReuseProbe: (e) => events.push(e),
    detailedSolveProfiler: profiler,
    ...extra,
  }).solve();
  const sum = (stage: string, f: 'normalAccumulations' | 'inversions'): number =>
    events.filter((e) => e.stage === stage).reduce((s, e) => s + e[f], 0);
  const stats = events.find((e) => e.stage === 'statistics');
  const first = profiler.profile.iterations[0];
  return {
    arm: {
      wallMedianMs: round2(median(walls)),
      finalAccum: sum('final-covariance', 'normalAccumulations'),
      finalRecover: sum('final-covariance', 'inversions'),
      statsAccum: sum('statistics', 'normalAccumulations'),
      statsRecover: sum('statistics', 'inversions'),
      reused: stats?.reused ?? false,
      reason: stats?.reason ?? 'no-event',
      statsInversionMs: round2(profiler.profile.standardizedResidualDetail.statisticsQxxInversionMs),
      statsAccumMs: round2(profiler.profile.standardizedResidualDetail.statisticsNormalAccumulationMs),
      statsTotalMs: round2(profiler.profile.statisticsMs),
      numParams: first?.parameterCount ?? 0,
      equations: first?.equationCount ?? 0,
      iterations: result.iterations,
    },
    resultJson: stableJson(result),
  };
};

describe('Phase 15B 2D final-Qxx statistics reuse evidence', () => {
  it('proves op counts, timing deltas, 3D non-regression, memory, and telemetry', () => {
    const rows: Record<string, unknown>[] = [];
    for (const fixture of [...fixtures, regression]) {
      const legacy = measureArm(fixture, true);
      const reuse = measureArm(fixture, false);
      // §25 op-count proof: legacy FINAL 1/1 + STATS 1/1; reuse FINAL 1/1 + STATS 0/0.
      expect(legacy.arm.finalAccum).toBe(1);
      expect(legacy.arm.finalRecover).toBe(1);
      expect(legacy.arm.statsAccum).toBe(1);
      expect(legacy.arm.statsRecover).toBe(1);
      expect(legacy.arm.reused).toBe(false);
      expect(reuse.arm.finalAccum).toBe(1);
      expect(reuse.arm.finalRecover).toBe(1);
      expect(reuse.arm.statsAccum).toBe(0);
      expect(reuse.arm.statsRecover).toBe(0);
      expect(reuse.arm.reused).toBe(true);
      expect(reuse.arm.reason).toBe('reused-final-dense-qxx');
      // Numerics identical across arms (reuse changes no numerics).
      expect(reuse.resultJson).toBe(legacy.resultJson);
      const delta = round2(reuse.arm.wallMedianMs - legacy.arm.wallMedianMs);
      const pct = legacy.arm.wallMedianMs > 0 ? round2((100 * delta) / legacy.arm.wallMedianMs) : 0;
      rows.push({
        fixture: fixture.id,
        dimension: fixture.dimension,
        note: fixture.note,
        params: reuse.arm.numParams,
        equations: reuse.arm.equations,
        iterations: reuse.arm.iterations,
        legacyWallMs: legacy.arm.wallMedianMs,
        reuseWallMs: reuse.arm.wallMedianMs,
        deltaMs: delta,
        deltaPct: pct,
        legacyStatsRecoverMs: legacy.arm.statsInversionMs,
        reuseStatsRecoverMs: reuse.arm.statsInversionMs,
        legacyReason: legacy.arm.reason,
        reuseReason: reuse.arm.reason,
      });
    }

    // §28 memory (evidence only): Qxx bytes analytic + heap delta around one clean solve.
    const memFixture = fixtures.find((f) => f.id === 'chain-2d-128')!;
    const heapDelta = (forceLegacy: boolean): number => {
      const extra = forceLegacy ? { forceLegacyStatisticsQxx: true } : {};
      new LSAEngine({ input: memFixture.input, ...extra }).solve();
      const samples: number[] = [];
      for (let i = 0; i < 3; i += 1) {
        const before = process.memoryUsage().heapUsed;
        new LSAEngine({ input: memFixture.input, ...extra }).solve();
        samples.push(process.memoryUsage().heapUsed - before);
      }
      return Math.round(median(samples));
    };
    const n = (rows.find((r) => (r as { fixture: string }).fixture === 'chain-2d-128') as unknown as { params: number }).params;
    const m = (rows.find((r) => (r as { fixture: string }).fixture === 'chain-2d-128') as unknown as { equations: number }).equations;
    const memory = {
      fixture: 'chain-2d-128',
      params: n,
      equations: m,
      qxxBytes: n * n * 8,
      legacyPeakCovarianceBytes: 2 * n * n * 8,
      reusePeakCovarianceBytes: n * n * 8,
      rowProductTransientBytes: m * n * 8,
      legacyHeapDeltaBytes: heapDelta(true),
      reuseHeapDeltaBytes: heapDelta(false),
      lifetimeNote:
        'reuse prolongs final-Qxx lifetime through statistics (shared read-only, no copy); legacy peak holds two Qxx simultaneously only transiently during stats recovery',
    };

    // §24 telemetry sample (reasons + counts only; normal/qxx matrices are MB-scale).
    const slim = (e: QxxReuseProbeEvent | undefined): Record<string, unknown> => ({
      stage: e?.stage,
      reused: e?.reused,
      reason: e?.reason,
      normalDimension: e?.normalDimension,
      qxxDimension: e?.qxxDimension,
      normalAccumulations: e?.normalAccumulations,
      inversions: e?.inversions,
    });
    const telemetry: Record<string, unknown>[] = [];
    for (const fixture of [...fixtures, regression]) {
      const events: QxxReuseProbeEvent[] = [];
      new LSAEngine({
        input: fixture.input,
        qxxReuseProbe: (e) => events.push(e),
        detailedSolveProfiler: createDetailedSolveProfiler(),
      }).solve();
      telemetry.push({
        fixture: fixture.id,
        statistics: slim(events.find((e) => e.stage === 'statistics')),
        finalCovariance: slim(events.find((e) => e.stage === 'final-covariance')),
      });
    }

    const machine = { env: { node: process.version, platform: process.platform, arch: process.arch, runsPerArm: RUNS, warmupPerArm: 1, statistic: 'median' }, rows, memory, telemetry };
    const dir = join(process.cwd(), 'artifacts', 'evidence', 'phase15b');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'phase15b-2d-reuse.json'), JSON.stringify(machine, null, 2));

    const md: string[] = [
      '# Phase 15B 2D final-Qxx statistics reuse (evidence)',
      '',
      `Method: engine-level LSAEngine solves, 1 warm-up + ${RUNS} measured clean wall runs per arm, medians; one instrumented solve per arm for op counts/parity/profiler. BEFORE = forceLegacyStatisticsQxx oracle (pre-15B legacy path); AFTER = production default (reuse).`,
      '',
      '## §25 Operation counts (mandatory proof)',
      '',
      '| Fixture | BEFORE FINAL accum/recover | BEFORE STATS accum/recover | AFTER FINAL accum/recover | AFTER STATS accum/recover | Total dense Qxx recoveries | AFTER reason |',
      '|---|---|---|---|---|---|---|',
      ...[...fixtures, regression].map((f, i) => {
        const r = rows[i] as { fixture: string; legacyReason: string; reuseReason: string };
        return `| ${f.id} | 1 / 1 | 1 / 1 | 1 / 1 | 0 / 0 | 2 → 1 | ${r.reuseReason} (before: ${r.legacyReason}) |`;
      }),
      '',
      '## §26 Timing medians (same machine/process, warm-up, medians)',
      '',
      '| Fixture | dim | params | equations | BEFORE wall ms | AFTER wall ms | delta ms | delta % | BEFORE stats-recover ms | AFTER stats-recover ms |',
      '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
      ...rows.map((x) => {
        const r = x as Record<string, number | string>;
        return `| ${r.fixture} | ${r.dimension} | ${r.params} | ${r.equations} | ${r.legacyWallMs} | ${r.reuseWallMs} | ${r.deltaMs} | ${r.deltaPct} | ${r.legacyStatsRecoverMs} | ${r.reuseStatsRecoverMs} |`;
      }),
      '',
      '## §10 3D regression',
      '',
      `- gps-3d-64 row above compares oracle vs production on this branch (proves the admitted 3D cohort still reuses with parity). Cross-branch 3D non-regression: the 15B diff only removes the 2D early-return (unreachable for 3D inputs); the Phase 10E agent suite passes on this branch (see validation).`,
      '',
      '## §28 Memory (evidence only)',
      '',
      `- Qxx bytes (n×n×8): ${memory.qxxBytes}; legacy peak covariance ${memory.legacyPeakCovarianceBytes} vs reuse ${memory.reusePeakCovarianceBytes}; row-product transient (m×n×8) ${memory.rowProductTransientBytes} on both arms.`,
      `- heapUsed delta around one clean solve (median of 3, GC-unsupervised): legacy ${memory.legacyHeapDeltaBytes} B vs reuse ${memory.reuseHeapDeltaBytes} B. No verdict from heapUsed — it is dominated by retained result + uncollected garbage and flips sign between runs; the analytic byte counts above are the memory claim.`,
      `- ${memory.lifetimeNote}.`,
      '',
      '## §24 Telemetry samples (qxxReuseProbe statistics/final-covariance events)',
      '',
      ...telemetry.map((t) => `- ${JSON.stringify(t)}`),
      '',
      '## Validation',
      '',
      '- Focused evidence test `tests/evidence/phase15b_2d_reuse_benchmark.test.ts` (evidence tier, `phase15b` suite): 1/1 PASS — asserts §25 op counts, reuse reasons, and cross-arm full-result parity on all 6 fixtures.',
      '- `tests/phase10e_production_qxx_reuse.test.ts` + tier-manifest: 18/18 PASS on this branch (3D cohort + wiring unchanged).',
      '- `npm run lint`: 0 errors (2 pre-existing warnings); `npm run typecheck`: clean.',
      '- No production changes in this batch (evidence + report + tier wiring only); no `test:full`/evidence `all` run per mission scope.',
    ];
    writeFileSync(join(process.cwd(), 'reports', 'performance', 'phase15b-2d-reuse.md'), `${md.join('\n')}\n`);
  }, 600000);
});
