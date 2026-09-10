/**
 * Phase 10D evidence: Qxx comparison and reuse across final covariance and
 * standardized-residual statistics.
 *
 * Historical campaign (Phase 10E promoted the seam to automatic
 * production reuse; this file now exercises the same paths via the
 * test-only `forceLegacyStatisticsQxx` oracle instead of the retired
 * opt-in flag). Evidence-only manual campaign (never runs in CI). Uses the genuine 3D
 * corpus (industry_demo + gps-3d-cov-08/16/32/64/128) on the dense
 * TypeScript path with the `forceLegacyStatisticsQxx` oracle (default
 * automatic production reuse). Records, per fixture and per mode
 * (force-legacy oracle recompute vs automatic reuse):
 *
 * - uninstrumented production-path walls (1 warm-up + 3 measured, median)
 * - probe call counts (final-covariance accumulations/inversions,
 *   statistics accumulations/inversions, reuse decision + reason)
 * - direct structural/numeric comparison of the final normal vs the
 *   statistics normal (dimension, max abs entry diff) and final Qxx vs
 *   statistics Qxx (max abs entry diff)
 * - full-result parity between legacy and reuse solves (bit-identical
 *   JSON modulo the volatile timing log line)
 * - profiler proof that reuse skips the statistics normal accumulation
 *   and Qxx inversion stages while still assembling equations
 * - a robust-Huber inadmissible case proving fail-closed fallback
 *
 * No production defaults, formulas, tolerances, or public result changes.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../../src/engine/adjust';
import {
  createDetailedSolveProfiler,
  type DetailedSolveProfile,
} from '../../src/engine/adjustDetailedSolveProfile';
import { buildPhase6LargeBenchmarkCases } from '../../src/engine/phase6BenchmarkNetworks';
import type { QxxReuseProbeEvent } from '../../src/engine/qxxReuseEvidence';

const MEASURED_RUNS = 3;

const industryDemo = readFileSync(join(process.cwd(), 'public/examples/industry_demo.dat'), 'utf8');
const generated = buildPhase6LargeBenchmarkCases(false).filter((item) =>
  ['gps-3d-cov-08', 'gps-3d-16', 'gps-3d-32', 'gps-3d-64', 'gps-3d-128'].includes(item.id),
);
const cases = [
  { id: 'industry_demo-3d-terrestrial', input: industryDemo },
  ...generated.map((item) => ({ id: item.id, input: item.input })),
];

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
  finalNormalDimension: number | null;
  statisticsReused: boolean;
  statisticsReason: string;
  statisticsAccumulations: number;
  statisticsInversions: number;
  statisticsNormalDimension: number | null;
  statisticsQxxInversionMs: number;
  statisticsNormalAccumulationMs: number;
}

interface CaseEvidence {
  fixture: string;
  dimension: '3D';
  admissible: boolean;
  inadmissibilityReason: string | null;
  success: boolean;
  converged: boolean;
  iterations: number;
  totalParameters: number;
  legacy: ModeEvidence;
  reuse: ModeEvidence;
  finalVsStatisticsNormalMaxDiff: number;
  finalVsStatisticsQxxMaxDiff: number;
  fullResultParity: boolean;
}

const CALL_GRAPH_NOTES = [
  'LSAEngine.solve (src/engine/adjustSolveWorkflow.ts) recovers the final covariance (recoverFinalNormalCovariance, src/engine/adjustCovarianceRecovery.ts) then runs post-solve statistics including computeStandardizedResidualStatistics (src/engine/adjustStatisticsStandardizedResiduals.ts).',
  'Legacy statistics path reassembles statistics equations, accumulates a statistics normal system, and inverts a statistics Qxx before building dense row products (B = A*Qxx) for per-equation standardized residuals.',
  'Production seam (src/engine/statisticsQxxReuse.ts): the dense statistics fallback automatically reuses ctx.Qxx (the recovered final dense Qxx) for B = A*Qxx while still assembling equations; normal accumulation and inversion are skipped. multiplySparseRowsByDenseMatrix never mutates Qxx.',
  'Fail-closed gate (decideStatisticsQxxReuse): any inadmissible shape — flag off, preanalysis, missing Qxx, selected store, sparse row products, non-none robust mode, covariance augmentation rows, damped final recovery, dimension mismatch / non-finite entries — falls back to the legacy rebuild-and-invert path with a machine-readable probe reason.',
  'Instrumentation (qxxReuseProbe, test-only EngineOptions): final-covariance and statistics events carry deep-copied normals/Qxx plus per-stage accumulation/inversion counts; copies are guarded so production solves pay nothing when the probe is absent.',
];

const CONTRACT_NOTES = [
  'Production default reuses automatically on the eligible cohort (converged 3D dense TypeScript solves); the test-only forceLegacyStatisticsQxx oracle forces the legacy recompute path (probe reason force-legacy-oracle). No formulas, tolerances, or public result fields change.',
  'Demand modes A/B/C and any selected/sparse covariance route are NOT involved here; both compared Qxx matrices are dense TypeScript inversions of deterministically assembled normals.',
  'industry_demo is recorded as inadmissible (weak-case observation), never as a parity anchor.',
  'Known log boundary on damped (ill-conditioned) cases: when the final recovery inverts with diagonal damping, reuse falls closed (reason damped-final-recovery) so the legacy statistics path keeps its own damping warning and the full result stays bit-identical including logs (observed on industry_demo). Any future production route must preserve that warning; this seam makes no such change.',
];

describe('Phase 10D Qxx comparison and reuse evidence', () => {
  it('compares final vs statistics N/Qxx and proves reuse parity on the genuine 3D corpus', async () => {
    const caseEvidence: CaseEvidence[] = [];

    for (const { id, input } of cases) {
      const solveMode = (
        reuse: boolean,
      ): {
        result: ReturnType<LSAEngine['solve']>;
        events: QxxReuseProbeEvent[];
        profile: DetailedSolveProfile;
        wallMedianMs: number;
      } => {
        const events: QxxReuseProbeEvent[] = [];
        new LSAEngine({
          input,
          forceLegacyStatisticsQxx: !reuse,
          qxxReuseProbe: (event) => {
            events.push(event);
          },
          detailedSolveProfiler: createDetailedSolveProfiler(),
        }).solve();
        const walls: number[] = [];
        let last: ReturnType<LSAEngine['solve']> | null = null;
        let lastEvents: QxxReuseProbeEvent[] = [];
        let lastProfile: DetailedSolveProfile | null = null;
        for (let run = 0; run < MEASURED_RUNS; run += 1) {
          const runEvents: QxxReuseProbeEvent[] = [];
          const profiler = createDetailedSolveProfiler();
          const started = performance.now();
          last = new LSAEngine({
            input,
            forceLegacyStatisticsQxx: !reuse,
            qxxReuseProbe: (event) => {
              runEvents.push(event);
            },
            detailedSolveProfiler: profiler,
          }).solve();
          walls.push(performance.now() - started);
          lastEvents = runEvents;
          lastProfile = profiler.profile;
        }
        return {
          result: last!,
          events: lastEvents,
          profile: lastProfile!,
          wallMedianMs: median(walls),
        };
      };

      const legacy = solveMode(false);
      const reuse = solveMode(true);
      const ref = legacy.result;

      const totalParameters =
        (Object.keys(ref.stations).length -
          Object.values(ref.stations).filter((s) => s.fixed).length) *
          3 +
        (ref.directionSetDiagnostics?.length ?? 0);

      const legacyFinal = legacy.events.find((e) => e.stage === 'final-covariance');
      const legacyStats = legacy.events.find((e) => e.stage === 'statistics');
      const reuseStats = reuse.events.find((e) => e.stage === 'statistics');

      const finalVsStatisticsNormalMaxDiff =
        legacyFinal?.normal != null && legacyStats?.normal != null
          ? maxAbsDiff(legacyFinal.normal, legacyStats.normal)
          : Number.NaN;
      const finalVsStatisticsQxxMaxDiff =
        legacyFinal?.qxx != null && legacyStats?.qxx != null
          ? maxAbsDiff(legacyFinal.qxx, legacyStats.qxx)
          : Number.NaN;
      const fullResultParity =
        stableResultJson(legacy.result) === stableResultJson(reuse.result);

      const toMode = (
        solved: ReturnType<typeof solveMode>,
        statsEvent: QxxReuseProbeEvent | undefined,
      ): ModeEvidence => ({
        wallMedianMs: solved.wallMedianMs,
        finalAccumulations:
          solved.events.find((e) => e.stage === 'final-covariance')?.normalAccumulations ?? -1,
        finalInversions:
          solved.events.find((e) => e.stage === 'final-covariance')?.inversions ?? -1,
        finalNormalDimension:
          solved.events.find((e) => e.stage === 'final-covariance')?.normalDimension ?? null,
        statisticsReused: statsEvent?.reused ?? false,
        statisticsReason: statsEvent?.reason ?? 'no-event',
        statisticsAccumulations: statsEvent?.normalAccumulations ?? -1,
        statisticsInversions: statsEvent?.inversions ?? -1,
        statisticsNormalDimension: statsEvent?.normalDimension ?? null,
        statisticsQxxInversionMs: solved.profile.standardizedResidualDetail.statisticsQxxInversionMs,
        statisticsNormalAccumulationMs:
          solved.profile.standardizedResidualDetail.statisticsNormalAccumulationMs,
      });

      const admissible =
        id !== 'industry_demo-3d-terrestrial' && ref.success && ref.converged;
      caseEvidence.push({
        fixture: id,
        dimension: '3D',
        admissible,
        inadmissibilityReason: admissible
          ? null
          : id === 'industry_demo-3d-terrestrial'
            ? `weak-case observation excluded by policy: success=${ref.success} converged=${ref.converged}`
            : `non-converged reference: success=${ref.success} converged=${ref.converged}`,
        success: ref.success,
        converged: ref.converged,
        iterations: ref.iterations,
        totalParameters,
        legacy: toMode(legacy, legacyStats),
        reuse: toMode(reuse, reuseStats),
        finalVsStatisticsNormalMaxDiff,
        finalVsStatisticsQxxMaxDiff,
        fullResultParity,
      });
    }

    // Robust-Huber inadmissible case: automatic reuse fails closed.
    const huberInput = `${generated.find((g) => g.id === 'gps-3d-cov-08')!.input}\n.ROBUST HUBER 1.5\n`;
    const huberLegacy = new LSAEngine({ input: huberInput, forceLegacyStatisticsQxx: true }).solve();
    const huberEvents: QxxReuseProbeEvent[] = [];
    const huberReuse = new LSAEngine({
      input: huberInput,
      qxxReuseProbe: (event) => {
        huberEvents.push(event);
      },
    }).solve();
    const huberStats = huberEvents.find((e) => e.stage === 'statistics');
    const huberEvidence = {
      success: huberLegacy.success,
      converged: huberLegacy.converged,
      statisticsReused: huberStats?.reused ?? null,
      statisticsReason: huberStats?.reason ?? 'no-event',
      fullResultParity:
        stableResultJson(huberLegacy) === stableResultJson(huberReuse),
    };

    // TS-correlation admissible case: the same correlation transform runs on
    // both paths, so N/Qxx stay identical and reuse is taken with parity.
    const tscorrInput = `${generated.find((g) => g.id === 'gps-3d-cov-08')!.input}\n.TSCORR ON\n`;
    const tscorrLegacyEvents: QxxReuseProbeEvent[] = [];
    const tscorrLegacy = new LSAEngine({
      input: tscorrInput,
      forceLegacyStatisticsQxx: true,
      qxxReuseProbe: (event) => {
        tscorrLegacyEvents.push(event);
      },
    }).solve();
    const tscorrReuseEvents: QxxReuseProbeEvent[] = [];
    const tscorrReuse = new LSAEngine({
      input: tscorrInput,
      qxxReuseProbe: (event) => {
        tscorrReuseEvents.push(event);
      },
    }).solve();
    const tscorrLegacyFinal = tscorrLegacyEvents.find((e) => e.stage === 'final-covariance');
    const tscorrLegacyStats = tscorrLegacyEvents.find((e) => e.stage === 'statistics');
    const tscorrReuseStats = tscorrReuseEvents.find((e) => e.stage === 'statistics');
    const tscorrEvidence = {
      success: tscorrLegacy.success,
      converged: tscorrLegacy.converged,
      correlationEnabled: tscorrLegacy.tsCorrelationDiagnostics?.enabled ?? false,
      finalVsStatisticsNormalMaxDiff:
        tscorrLegacyFinal?.normal != null && tscorrLegacyStats?.normal != null
          ? maxAbsDiff(tscorrLegacyFinal.normal, tscorrLegacyStats.normal)
          : Number.NaN,
      finalVsStatisticsQxxMaxDiff:
        tscorrLegacyFinal?.qxx != null && tscorrLegacyStats?.qxx != null
          ? maxAbsDiff(tscorrLegacyFinal.qxx, tscorrLegacyStats.qxx)
          : Number.NaN,
      statisticsReused: tscorrReuseStats?.reused ?? null,
      statisticsReason: tscorrReuseStats?.reason ?? 'no-event',
      fullResultParity:
        stableResultJson(tscorrLegacy) === stableResultJson(tscorrReuse),
    };

    const outputDir = join(process.cwd(), 'artifacts/evidence/phase10d');
    mkdirSync(outputDir, { recursive: true });
    const payload = {
      status: 'complete',
      method:
        'per fixture: profiled warm-up solve, then 1 warm-up + 3 measured solves per mode (legacy vs reuse); medians reported; probe captures N/Qxx copies for direct comparison (matrices not serialized, only max diffs)',
      callGraph: CALL_GRAPH_NOTES,
      contracts: CONTRACT_NOTES,
      cases: caseEvidence,
      robustHuberInadmissible: huberEvidence,
      tsCorrelationAdmissible: tscorrEvidence,
    };
    writeFileSync(join(outputDir, 'phase10d-evidence.json'), `${JSON.stringify(payload, null, 2)}\n`);
    const markdown = [
      '# Phase 10D Qxx comparison and reuse evidence',
      '',
      'Evidence-only dense TypeScript campaign on the genuine 3D corpus. Per fixture: profiled warm-up solve, then 1 warm-up + 3 measured solves per mode (legacy recompute vs test-only Qxx reuse); medians reported. industry_demo is inadmissible (weak-case observation).',
      '',
      '| Fixture | params | iters | legacy wall ms | reuse wall ms | N max diff | Qxx max diff | full parity | legacy stats inv | reuse stats inv | reuse reason |',
      '|---|---:|---:|---:|---:|---:|---:|---|---|---:|---|',
      ...caseEvidence.map(
        (c) =>
          `| ${c.fixture} | ${c.totalParameters} | ${c.iterations} | ${c.legacy.wallMedianMs.toFixed(2)} | ${c.reuse.wallMedianMs.toFixed(2)} | ${c.finalVsStatisticsNormalMaxDiff.toExponential(2)} | ${c.finalVsStatisticsQxxMaxDiff.toExponential(2)} | ${c.fullResultParity ? 'BIT-IDENTICAL' : 'MISMATCH'} | ${c.legacy.statisticsInversions} | ${c.reuse.statisticsInversions} | ${c.reuse.statisticsReason} |`,
      ),
      '',
      `Robust-Huber inadmissible case: success=${huberEvidence.success} converged=${huberEvidence.converged} reused=${huberEvidence.statisticsReused} reason=${huberEvidence.statisticsReason} parity=${huberEvidence.fullResultParity ? 'BIT-IDENTICAL' : 'MISMATCH'}.`,
      `TS-correlation admissible case: success=${tscorrEvidence.success} converged=${tscorrEvidence.converged} correlation=${tscorrEvidence.correlationEnabled} N diff=${tscorrEvidence.finalVsStatisticsNormalMaxDiff.toExponential(2)} Qxx diff=${tscorrEvidence.finalVsStatisticsQxxMaxDiff.toExponential(2)} reused=${tscorrEvidence.statisticsReused} reason=${tscorrEvidence.statisticsReason} parity=${tscorrEvidence.fullResultParity ? 'BIT-IDENTICAL' : 'MISMATCH'}.`,
      '',
      '## Call graph',
      '',
      ...CALL_GRAPH_NOTES.map((note) => `- ${note}`),
      '',
      '## Contracts and non-claims',
      '',
      ...CONTRACT_NOTES.map((note) => `- ${note}`),
      '',
      '## Recommendation',
      '',
      'See report: reuse is admissible only where the statistics normal provably equals the final normal (same geometry, same weights). The fail-closed gate plus this bit-identical evidence bounds the candidate set; any production routing change remains a separate decision with its own review.',
    ].join('\n');
    writeFileSync(join(outputDir, 'phase10d-evidence.md'), `${markdown}\n`);

    for (const c of caseEvidence) {
      if (!c.admissible) {
        expect(c.inadmissibilityReason).toContain('weak-case observation');
        continue;
      }
      expect(c.success && c.converged, `${c.fixture} reference solves`).toBe(true);
      expect(c.legacy.finalInversions, `${c.fixture} final inversion`).toBe(1);
      expect(c.legacy.statisticsInversions, `${c.fixture} legacy statistics inversion`).toBe(1);
      expect(c.legacy.finalNormalDimension, `${c.fixture} dimension agreement`).toBe(
        c.legacy.statisticsNormalDimension,
      );
      expect(c.finalVsStatisticsNormalMaxDiff, `${c.fixture} N equivalence`).toBe(0);
      expect(c.finalVsStatisticsQxxMaxDiff, `${c.fixture} Qxx equivalence`).toBe(0);
      expect(c.reuse.statisticsReused, `${c.fixture} reuse taken`).toBe(true);
      expect(c.reuse.statisticsReason, `${c.fixture} reuse reason`).toBe(
        'reused-final-dense-qxx',
      );
      expect(c.reuse.statisticsAccumulations, `${c.fixture} reuse skips accumulation`).toBe(0);
      expect(c.reuse.statisticsInversions, `${c.fixture} reuse skips inversion`).toBe(0);
      expect(
        c.reuse.statisticsNormalAccumulationMs,
        `${c.fixture} reuse profiler accumulation`,
      ).toBe(0);
      expect(c.reuse.statisticsQxxInversionMs, `${c.fixture} reuse profiler inversion`).toBe(0);
      expect(c.fullResultParity, `${c.fixture} full-result parity`).toBe(true);
    }
    expect(caseEvidence.filter((c) => c.admissible).map((c) => c.fixture)).toEqual([
      'gps-3d-cov-08',
      'gps-3d-16',
      'gps-3d-32',
      'gps-3d-64',
      'gps-3d-128',
    ]);
    expect(huberEvidence.statisticsReused).toBe(false);
    expect(huberEvidence.statisticsReason).toBe('robust-mode-inadmissible');
    expect(huberEvidence.fullResultParity).toBe(true);
    expect(tscorrEvidence.success && tscorrEvidence.converged).toBe(true);
    expect(tscorrEvidence.correlationEnabled).toBe(true);
    expect(tscorrEvidence.finalVsStatisticsNormalMaxDiff).toBe(0);
    expect(tscorrEvidence.finalVsStatisticsQxxMaxDiff).toBe(0);
    expect(tscorrEvidence.statisticsReused).toBe(true);
    expect(tscorrEvidence.fullResultParity).toBe(true);
  }, 600000);
});
