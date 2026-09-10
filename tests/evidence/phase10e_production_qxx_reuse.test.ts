/**
 * Phase 10E evidence: automatic production Qxx reuse on gps-3d-32/64/128.
 *
 * Evidence-only manual campaign (never runs in CI). Exercises the
 * production default (automatic reuse on the eligible cohort) against
 * the test-only `forceLegacyStatisticsQxx` oracle with 1 warm-up + 5
 * measured timing runs per mode. Wall medians come from clean solves
 * with neither `qxxReuseProbe` nor `detailedSolveProfiler` attached; a
 * separate instrumented solve per mode supplies probe call counts,
 * final-vs-statistics N/Qxx equivalence, full-result parity, and
 * profiler proof that reuse skips the statistics accumulation and
 * inversion while still assembling equations. Writes machine artifacts
 * only to `artifacts/evidence/phase10e/` (gitignored); never touches
 * the committed report under `reports/phase10e/`.
 *
 * No UI, protocol, formula, or routing changes.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../../src/engine/adjust';
import {
  createDetailedSolveProfiler,
  type DetailedSolveProfile,
} from '../../src/engine/adjustDetailedSolveProfile';
import { buildPhase6LargeBenchmarkCases } from '../../src/engine/phase6BenchmarkNetworks';
import type { QxxReuseProbeEvent } from '../../src/engine/qxxReuseEvidence';

const MEASURED_RUNS = 5;

const generated = buildPhase6LargeBenchmarkCases(false).filter((item) =>
  ['gps-3d-32', 'gps-3d-64', 'gps-3d-128'].includes(item.id),
);
if (generated.length !== 3) throw new Error('Missing gps-3d-32/64/128 fixtures.');

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

const maxAbsDiff = (a: number[][], b: number[][]): number => {
  let max = 0;
  for (let i = 0; i < a.length; i += 1) {
    for (let j = 0; j < a[i].length; j += 1) {
      const diff = Math.abs(a[i][j] - b[i][j]);
      if (diff > max) max = diff;
    }
  }
  return max;
};

const stableResultJson = (result: ReturnType<LSAEngine['solve']>): string => {
  const logs = result.logs.filter((line) => !line.startsWith('Solve timing (ms):'));
  // solveTimingProfile carries wall-clock timings; everything else must match.
  const { solveTimingProfile: _volatile, logs: _logs, ...stable } = result;
  return JSON.stringify({ ...stable, logs });
};

interface ModeEvidence {
  wallMedianMs: number;
  finalAccumulations: number;
  finalInversions: number;
  statisticsReused: boolean;
  statisticsReason: string;
  statisticsAccumulations: number;
  statisticsInversions: number;
  statisticsQxxInversionMs: number;
  statisticsNormalAccumulationMs: number;
}

interface CaseEvidence {
  fixture: string;
  success: boolean;
  converged: boolean;
  iterations: number;
  totalParameters: number;
  oracle: ModeEvidence;
  production: ModeEvidence;
  finalVsStatisticsNormalMaxDiff: number;
  finalVsStatisticsQxxMaxDiff: number;
  fullResultParity: boolean;
}

describe('Phase 10E production Qxx reuse evidence', () => {
  it('proves automatic reuse parity and skipped work on gps-3d-32/64/128', async () => {
    const caseEvidence: CaseEvidence[] = [];

    for (const { id, input } of generated) {
      const solveMode = (
        forceLegacy: boolean,
      ): {
        result: ReturnType<LSAEngine['solve']>;
        events: QxxReuseProbeEvent[];
        profile: DetailedSolveProfile;
        wallMedianMs: number;
      } => {
        // Warm-up (unmeasured, uninstrumented).
        new LSAEngine({ input, forceLegacyStatisticsQxx: forceLegacy }).solve();
        // Measured wall times: clean solves with neither qxxReuseProbe nor
        // detailedSolveProfiler attached, so instrumentation overhead never
        // leaks into the reported medians.
        const walls: number[] = [];
        let spotCheck: ReturnType<LSAEngine['solve']> | null = null;
        for (let run = 0; run < MEASURED_RUNS; run += 1) {
          const started = performance.now();
          const measured = new LSAEngine({
            input,
            forceLegacyStatisticsQxx: forceLegacy,
          }).solve();
          walls.push(performance.now() - started);
          spotCheck ??= measured;
        }
        // Cheap guard: clean timing solves must be successful converged
        // solves, otherwise the medians are meaningless.
        expect(spotCheck?.success, `${id} clean timing solve succeeds`).toBe(true);
        expect(spotCheck?.converged, `${id} clean timing solve converges`).toBe(true);
        // Separate instrumented solve for events/profile/parity (not timed).
        const runEvents: QxxReuseProbeEvent[] = [];
        const profiler = createDetailedSolveProfiler();
        const result = new LSAEngine({
          input,
          forceLegacyStatisticsQxx: forceLegacy,
          qxxReuseProbe: (event) => {
            runEvents.push(event);
          },
          detailedSolveProfiler: profiler,
        }).solve();
        return {
          result,
          events: runEvents,
          profile: profiler.profile,
          wallMedianMs: median(walls),
        };
      };

      const oracle = solveMode(true);
      const production = solveMode(false);
      const ref = oracle.result;

      const totalParameters =
        (Object.keys(ref.stations).length -
          Object.values(ref.stations).filter((s) => s.fixed).length) *
          3 +
        (ref.directionSetDiagnostics?.length ?? 0);

      const oracleFinal = oracle.events.find((e) => e.stage === 'final-covariance');
      const oracleStats = oracle.events.find((e) => e.stage === 'statistics');
      const productionStats = production.events.find((e) => e.stage === 'statistics');

      const toMode = (
        solved: ReturnType<typeof solveMode>,
        statsEvent: QxxReuseProbeEvent | undefined,
      ): ModeEvidence => ({
        wallMedianMs: solved.wallMedianMs,
        finalAccumulations:
          solved.events.find((e) => e.stage === 'final-covariance')?.normalAccumulations ?? -1,
        finalInversions:
          solved.events.find((e) => e.stage === 'final-covariance')?.inversions ?? -1,
        statisticsReused: statsEvent?.reused ?? false,
        statisticsReason: statsEvent?.reason ?? 'no-event',
        statisticsAccumulations: statsEvent?.normalAccumulations ?? -1,
        statisticsInversions: statsEvent?.inversions ?? -1,
        statisticsQxxInversionMs:
          solved.profile.standardizedResidualDetail.statisticsQxxInversionMs,
        statisticsNormalAccumulationMs:
          solved.profile.standardizedResidualDetail.statisticsNormalAccumulationMs,
      });

      caseEvidence.push({
        fixture: id,
        success: ref.success,
        converged: ref.converged,
        iterations: ref.iterations,
        totalParameters,
        oracle: toMode(oracle, oracleStats),
        production: toMode(production, productionStats),
        finalVsStatisticsNormalMaxDiff:
          oracleFinal?.normal != null && oracleStats?.normal != null
            ? maxAbsDiff(oracleFinal.normal, oracleStats.normal)
            : Number.NaN,
        finalVsStatisticsQxxMaxDiff:
          oracleFinal?.qxx != null && oracleStats?.qxx != null
            ? maxAbsDiff(oracleFinal.qxx, oracleStats.qxx)
            : Number.NaN,
        fullResultParity:
          stableResultJson(oracle.result) === stableResultJson(production.result),
      });
    }

    const artifactDir = join(process.cwd(), 'artifacts/evidence/phase10e');
    mkdirSync(artifactDir, { recursive: true });
    const payload = {
      status: 'complete',
      method:
        'per fixture: uninstrumented warm-up solve, then 5 clean measured solves per mode (force-legacy oracle vs production automatic reuse) with neither qxxReuseProbe nor detailedSolveProfiler attached; medians reported; one separate instrumented solve per mode captures probe events and the profiler profile for N/Qxx comparison (matrices not serialized, only max diffs)',
      measuredRuns: MEASURED_RUNS,
      cases: caseEvidence,
    };
    writeFileSync(join(artifactDir, 'phase10e-evidence.json'), `${JSON.stringify(payload, null, 2)}\n`);

    // Generated markdown goes only under artifacts/evidence/phase10e; the
    // committed report under reports/phase10e is never overwritten by reruns.
    const markdown = [
      '# Phase 10E production Qxx reuse evidence',
      '',
      'Evidence-only dense TypeScript campaign on gps-3d-32/64/128. Per fixture: uninstrumented warm-up solve, then 5 clean measured solves per mode (force-legacy oracle vs production automatic reuse) with neither qxxReuseProbe nor detailedSolveProfiler attached; medians reported. One separate instrumented solve per mode captures probe events and the profiler profile. Production default automatically reuses the recovered final dense Qxx as the standardized-residual statistics Qxx on this cohort; equations are still assembled, only the statistics normal accumulation and inversion are skipped.',
      '',
      '| Fixture | params | iters | oracle wall ms | production wall ms | N max diff | Qxx max diff | full parity | oracle stats inv | production stats inv | production reason |',
      '|---|---:|---:|---:|---:|---:|---:|---|---|---:|---|',
      ...caseEvidence.map(
        (c) =>
          `| ${c.fixture} | ${c.totalParameters} | ${c.iterations} | ${c.oracle.wallMedianMs.toFixed(2)} | ${c.production.wallMedianMs.toFixed(2)} | ${c.finalVsStatisticsNormalMaxDiff.toExponential(2)} | ${c.finalVsStatisticsQxxMaxDiff.toExponential(2)} | ${c.fullResultParity ? 'BIT-IDENTICAL' : 'MISMATCH'} | ${c.oracle.statisticsInversions} | ${c.production.statisticsInversions} | ${c.production.statisticsReason} |`,
      ),
      '',
      '## Cohort and fail-closed bounds',
      '',
      '- Automatic reuse only: normal converged 3D dense TypeScript final Qxx with finite correct dimension; no preanalysis, robust weighting, covariance augmentation, final-recovery damping, selected-covariance store, active sparse selected-covariance solver, or sparse row products. TS correlation is admissible.',
      '- 2D solves and non-converged solves keep the legacy rebuild-and-invert path; the test-only `forceLegacyStatisticsQxx` oracle forces legacy on any input.',
      '- Gate: `src/engine/statisticsQxxReuse.ts` (`decideStatisticsQxxReuse`); probes stay separate in `src/engine/qxxReuseEvidence.ts`.',
      '- No UI, protocol, formula, or routing changes.',
    ].join('\n');
    writeFileSync(join(artifactDir, 'phase10e-evidence.md'), `${markdown}\n`);

    expect(caseEvidence.map((c) => c.fixture)).toEqual([
      'gps-3d-32',
      'gps-3d-64',
      'gps-3d-128',
    ]);
    for (const c of caseEvidence) {
      expect(c.success && c.converged, `${c.fixture} reference solves`).toBe(true);
      expect(c.oracle.statisticsReused, `${c.fixture} oracle recomputes`).toBe(false);
      expect(c.oracle.statisticsReason, `${c.fixture} oracle reason`).toBe(
        'force-legacy-oracle',
      );
      expect(c.oracle.statisticsInversions, `${c.fixture} oracle statistics inversion`).toBe(1);
      expect(c.finalVsStatisticsNormalMaxDiff, `${c.fixture} N equivalence`).toBe(0);
      expect(c.finalVsStatisticsQxxMaxDiff, `${c.fixture} Qxx equivalence`).toBe(0);
      expect(c.production.statisticsReused, `${c.fixture} production reuses`).toBe(true);
      expect(c.production.statisticsReason, `${c.fixture} production reason`).toBe(
        'reused-final-dense-qxx',
      );
      expect(c.production.statisticsAccumulations, `${c.fixture} reuse skips accumulation`).toBe(0);
      expect(c.production.statisticsInversions, `${c.fixture} reuse skips inversion`).toBe(0);
      expect(
        c.production.statisticsNormalAccumulationMs,
        `${c.fixture} reuse profiler accumulation`,
      ).toBe(0);
      expect(c.production.statisticsQxxInversionMs, `${c.fixture} reuse profiler inversion`).toBe(0);
      expect(c.fullResultParity, `${c.fixture} full-result parity`).toBe(true);
    }
  }, 600000);
});
