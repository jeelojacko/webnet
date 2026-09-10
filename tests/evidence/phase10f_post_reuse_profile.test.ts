/**
 * Phase 10F evidence: post-reuse production profile on the genuine 3D corpus.
 *
 * Evidence-only manual campaign (never runs in CI). Uses the genuine 3D
 * corpus (industry_demo terrestrial + gps-3d-cov-08/16/32/64/128 plus an
 * evidence-only synthetic orientation-heavy 3D case derived from gps-3d-16)
 * on the unmodified dense TypeScript production path (automatic Qxx reuse).
 * Records, per fixture:
 *
 * - 1 warm-up + 5 clean production timing runs (neither `qxxReuseProbe` nor
 *   `detailedSolveProfiler` attached) with `solveTimingProfile` medians
 * - warm-up + 3 measured profiled production runs with per-field
 *   `DetailedSolveProfiler` medians, profiled wall median, and wall
 *   reconciliation (exclusive top-level `solveTimingProfile` bucket sum vs
 *   total; nested profiler stages reported separately, never double-counted)
 * - full `statisticsDetail` / `standardizedResidualDetail` fields, final
 *   covariance calls, design NNZ / normal dimensions (profile/probe), and
 *   the correction-loop aggregate
 * - reuse probe counts, structural metrics (incl. orientation parameter ratio),
 *   all-pairs counts + timing
 * - legacy comparator (`forceLegacyStatisticsQxx` oracle) for 32/64/128 only:
 *   1 warm-up + 5 clean runs plus one instrumented solve, with full-result parity
 *
 * No timing assertions: walls are observational only. industry_demo is
 * recorded as inadmissible (weak-case observation), never as a parity
 * anchor. Writes machine artifacts only to `artifacts/evidence/phase10f/`
 * (gitignored).
 *
 * No production engine changes.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../../src/engine/adjust';
import {
  createDetailedSolveProfiler,
  type DetailedSolveProfile,
} from '../../src/engine/adjustDetailedSolveProfile';
import { buildPhase6LargeBenchmarkCases } from '../../src/engine/phase6BenchmarkNetworks';
import type { QxxReuseProbeEvent } from '../../src/engine/qxxReuseEvidence';
import type { AdjustmentSolveTimingProfile } from '../../src/typesSolveTiming';

const MEASURED_RUNS = 5;
const PROFILED_RUNS = 3;
const LEGACY_COMPARATOR_IDS = ['gps-3d-32', 'gps-3d-64', 'gps-3d-128'];

const industryDemo = readFileSync(join(process.cwd(), 'public/examples/industry_demo.dat'), 'utf8');
const generated = buildPhase6LargeBenchmarkCases(false).filter((item) =>
  ['gps-3d-cov-08', 'gps-3d-16', 'gps-3d-32', 'gps-3d-64', 'gps-3d-128'].includes(item.id),
);
if (generated.length !== 5) throw new Error('Missing genuine 3D corpus fixtures.');
/**
 * Evidence-only synthetic orientation-heavy 3D case: appends 16 deterministic
 * DB/DN direction-set blocks (one setup per unknown station, 3 truth-based
 * DMS bearings each, parsed from the gps-3d-16 C-line coordinates) to the
 * genuine gps-3d-16 input. Recorded as a non-scaling observation only — never
 * part of the scaling ladder or the legacy comparator cohort.
 */
const buildOrientationSynthInput = (baseInput: string): string => {
  const coords = new Map<string, { e: number; n: number }>();
  for (const line of baseInput.split('\n')) {
    const match = line.match(/^C\s+(\S+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)/);
    if (match) coords.set(match[1], { e: Number(match[2]), n: Number(match[3]) });
  }
  const unknowns = Array.from({ length: 16 }, (_, i) => `U${i + 1}`);
  const toDms = (deg: number): string => {
    const totalSec = Math.round((((deg % 360) + 360) % 360) * 3600 * 10) / 10;
    const d = Math.floor(totalSec / 3600);
    const mnt = Math.floor((totalSec - d * 3600) / 60);
    const sec = totalSec - d * 3600 - mnt * 60;
    return `${String(d).padStart(3, '0')}-${String(mnt).padStart(2, '0')}-${sec.toFixed(1).padStart(4, '0')}`;
  };
  const blocks: string[] = [];
  unknowns.forEach((occupy, i) => {
    const o = coords.get(occupy);
    if (!o) throw new Error(`Missing coordinates for ${occupy}.`);
    const targets = [1, 2, 3].map((k) => unknowns[(i + k) % 16]);
    blocks.push(`DB ${occupy} ${targets[0]}`);
    for (const t of targets) {
      const p = coords.get(t);
      if (!p) throw new Error(`Missing coordinates for ${t}.`);
      blocks.push(`DN ${t} ${toDms((Math.atan2(p.e - o.e, p.n - o.n) * 180) / Math.PI)}`);
    }
    blocks.push('DE');
  });
  return `${baseInput}\n${blocks.join('\n')}\n`;
};

const gps16 = generated.find((g) => g.id === 'gps-3d-16');
if (!gps16) throw new Error('Missing gps-3d-16 base fixture.');
const cases: { id: string; input: string; synthetic?: boolean }[] = [
  { id: 'industry_demo-3d-terrestrial', input: industryDemo },
  ...generated.map((item) => ({ id: item.id, input: item.input })),
  {
    id: 'gps-3d-16-orientation-synth',
    input: buildOrientationSynthInput(gps16.input),
    synthetic: true,
  },
];

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

const stableResultJson = (result: ReturnType<LSAEngine['solve']>): string => {
  const logs = result.logs.filter((line) => !line.startsWith('Solve timing (ms):'));
  // solveTimingProfile carries wall-clock timings; everything else must match.
  const { solveTimingProfile: _volatile, logs: _logs, ...stable } = result;
  return JSON.stringify({ ...stable, logs });
};

interface LegacyComparator {
  wallMedianMs: number;
  statisticsReused: boolean;
  statisticsReason: string;
  statisticsAccumulations: number;
  statisticsInversions: number;
  fullResultParity: boolean;
}

interface CaseEvidence {
  fixture: string;
  synthetic: boolean;
  admissible: boolean;
  inadmissibilityReason: string | null;
  success: boolean;
  converged: boolean;
  iterations: number;
  totalParameters: number;
  scalarEquations: number;
  unknownStations: number;
  orientationParameters: number;
  orientationRatio: number;
  dof: number;
  wallMedianMs: number;
  timingMediansMs: AdjustmentSolveTimingProfile;
  wallReconciliationMs: {
    profiledWallMedian: number;
    classifiedBucketSum: number;
    other: number;
    total: number;
    unclassified: number;
  };
  correctionLoopMs: {
    assembly: number;
    accumulate: number;
    factorSolve: number;
    stateUpdate: number;
    total: number;
  };
  covarianceMs: {
    assembly: number;
    accumulate: number;
    invert: number;
    calls: number;
  };
  statisticsMs: number;
  statisticsDetailMs: {
    residuals: number;
    standardizedResiduals: number;
    precisionPropagation: number;
    diagnostics: number;
    calls: number;
  };
  standardizedResidualDetailMs: {
    statisticsEquationAssembly: number;
    robustWeightPreparation: number;
    statisticsNormalAccumulation: number;
    statisticsQxxInversion: number;
    rowProductConstruction: number;
    perEquationStatistics: number;
    gpsCrossProductTransform: number;
    summaryConstruction: number;
    calls: number;
  };
  design: {
    parameterCount: number | null;
    equationCount: number | null;
    designNnzTotal: number;
    weightNnzTotal: number;
    finalNormalDimension: number | null;
    finalQxxDimension: number | null;
    statisticsNormalDimension: number | null;
  };
  reuseProbe: {
    finalAccumulations: number;
    finalInversions: number;
    statisticsReused: boolean;
    statisticsReason: string;
    statisticsAccumulations: number;
    statisticsInversions: number;
  };
  allPairs: {
    rows: number;
    expectedRows: number;
    matchExpected: boolean;
    precisionPropagationMs: number;
  };
  precisionCounts: {
    stationCovarianceRows: number;
    relativeCovarianceRows: number;
    requestedRelPtolPairs: number;
  };
  legacyComparator: LegacyComparator | null;
}

describe('Phase 10F post-reuse production profile evidence', () => {
  it('profiles production reuse and checks the legacy comparator on 32/64/128', () => {
    const caseEvidence: CaseEvidence[] = [];

    for (const { id, input, synthetic = false } of cases) {
      // Warm-up + clean production timing runs (no instrumentation).
      new LSAEngine({ input }).solve();
      const walls: number[] = [];
      const timings: AdjustmentSolveTimingProfile[] = [];
      let spotCheck: ReturnType<LSAEngine['solve']> | null = null;
      for (let run = 0; run < MEASURED_RUNS; run += 1) {
        const started = performance.now();
        const measured = new LSAEngine({ input }).solve();
        walls.push(performance.now() - started);
        if (measured.solveTimingProfile) timings.push(measured.solveTimingProfile);
        spotCheck ??= measured;
      }
      // industry_demo is a known weak-case observation (may not converge);
      // admissibility is asserted per fixture below, not here.
      if (id !== 'industry_demo-3d-terrestrial') {
        expect(spotCheck?.success, `${id} clean timing solve succeeds`).toBe(true);
        expect(spotCheck?.converged, `${id} clean timing solve converges`).toBe(true);
      }
      const timingField = (
        field: keyof AdjustmentSolveTimingProfile,
      ): number => median(timings.map((t) => t[field]));
      const timingMediansMs: AdjustmentSolveTimingProfile = {
        totalMs: timingField('totalMs'),
        parseAndSetupMs: timingField('parseAndSetupMs'),
        equationAssemblyMs: timingField('equationAssemblyMs'),
        matrixFactorizationMs: timingField('matrixFactorizationMs'),
        precisionAndDiagnosticsMs: timingField('precisionAndDiagnosticsMs'),
        precisionPropagationMs: timingField('precisionPropagationMs'),
        reportDiagnosticsMs: timingField('reportDiagnosticsMs'),
        resultPackagingMs: timingField('resultPackagingMs'),
        otherMs: timingField('otherMs'),
      };

      // Warm-up + measured profiled production runs (instrumented).
      new LSAEngine({ input, detailedSolveProfiler: createDetailedSolveProfiler() }).solve();
      const profiledWalls: number[] = [];
      const profiles: DetailedSolveProfile[] = [];
      let profiledResult: ReturnType<LSAEngine['solve']> | null = null;
      let profiledEvents: QxxReuseProbeEvent[] = [];
      for (let run = 0; run < PROFILED_RUNS; run += 1) {
        const runEvents: QxxReuseProbeEvent[] = [];
        const profiler = createDetailedSolveProfiler();
        const started = performance.now();
        const solved = new LSAEngine({
          input,
          qxxReuseProbe: (event) => {
            runEvents.push(event);
          },
          detailedSolveProfiler: profiler,
        }).solve();
        profiledWalls.push(performance.now() - started);
        profiles.push(profiler.profile);
        if (run === 0) {
          profiledResult = solved;
          profiledEvents = runEvents;
        }
      }
      const result = profiledResult!;
      const runEvents = profiledEvents;
      const profMedian = (field: (_p: DetailedSolveProfile) => number): number =>
        median(profiles.map(field));

      const correctionLoopMs = {
        assembly: profMedian((p) => p.assemblyMs),
        accumulate: profMedian((p) => p.accumulateMs),
        factorSolve: profMedian((p) => p.factorSolveMs),
        stateUpdate: profMedian((p) => p.stateUpdateMs),
        total: 0,
      };
      correctionLoopMs.total =
        correctionLoopMs.assembly +
        correctionLoopMs.accumulate +
        correctionLoopMs.factorSolve +
        correctionLoopMs.stateUpdate;
      const covarianceMs = {
        assembly: profMedian((p) => p.covariance.assemblyMs),
        accumulate: profMedian((p) => p.covariance.accumulateMs),
        invert: profMedian((p) => p.covariance.invertMs),
        calls: profiles[0]?.covariance.calls ?? 0,
      };
      const statisticsDetailMs = {
        residuals: profMedian((p) => p.statisticsDetail.residualsMs),
        standardizedResiduals: profMedian((p) => p.statisticsDetail.standardizedResidualsMs),
        precisionPropagation: profMedian((p) => p.statisticsDetail.precisionPropagationMs),
        diagnostics: profMedian((p) => p.statisticsDetail.diagnosticsMs),
        calls: profiles[0]?.statisticsDetail.calls ?? 0,
      };
      const standardizedResidualDetailMs = {
        statisticsEquationAssembly: profMedian((p) => p.standardizedResidualDetail.statisticsEquationAssemblyMs),
        robustWeightPreparation: profMedian((p) => p.standardizedResidualDetail.robustWeightPreparationMs),
        statisticsNormalAccumulation: profMedian((p) => p.standardizedResidualDetail.statisticsNormalAccumulationMs),
        statisticsQxxInversion: profMedian((p) => p.standardizedResidualDetail.statisticsQxxInversionMs),
        rowProductConstruction: profMedian((p) => p.standardizedResidualDetail.rowProductConstructionMs),
        perEquationStatistics: profMedian((p) => p.standardizedResidualDetail.perEquationStatisticsMs),
        gpsCrossProductTransform: profMedian((p) => p.standardizedResidualDetail.gpsCrossProductTransformMs),
        summaryConstruction: profMedian((p) => p.standardizedResidualDetail.summaryConstructionMs),
        calls: profiles[0]?.standardizedResidualDetail.calls ?? 0,
      };

      // Exclusive top-level solveTimingProfile buckets sum to the classified
      // wall; precisionPropagationMs/reportDiagnosticsMs are nested inside
      // precisionAndDiagnosticsMs (see buildSolveTimingProfile) and the
      // profiler stages are nested detail — never added to the bucket sum.
      const classifiedBucketSum =
        timingMediansMs.parseAndSetupMs +
        timingMediansMs.equationAssemblyMs +
        timingMediansMs.matrixFactorizationMs +
        timingMediansMs.precisionAndDiagnosticsMs +
        timingMediansMs.resultPackagingMs;

      const unknowns = Object.values(result.stations).filter((s) => !s.fixed).length;
      const totalParameters =
        unknowns * 3 + (result.directionSetDiagnostics?.length ?? 0);
      const scalarEquations = result.observations.reduce(
        (count, obs) => count + (obs.type === 'gps' ? 3 : 1),
        0,
      );
      const allPairsRows = result.relativePrecision?.length ?? 0;
      const expectedAllPairsRows = (unknowns * (unknowns - 1)) / 2;
      const statsEvent = runEvents.find((e) => e.stage === 'statistics');
      const finalEvent = runEvents.find((e) => e.stage === 'final-covariance');
      const firstIteration = profiles[0]?.iterations[0];

      const reuseEligible =
        (statsEvent?.reused ?? false) && statsEvent?.reason === 'reused-final-dense-qxx';
      const admissible = synthetic
        ? result.success && result.converged && reuseEligible
        : id !== 'industry_demo-3d-terrestrial' && result.success && result.converged;

      // Legacy comparator for 32/64/128 only.
      let legacyComparator: LegacyComparator | null = null;
      if (LEGACY_COMPARATOR_IDS.includes(id)) {
        new LSAEngine({ input, forceLegacyStatisticsQxx: true }).solve();
        const legacyWalls: number[] = [];
        for (let run = 0; run < MEASURED_RUNS; run += 1) {
          const started = performance.now();
          new LSAEngine({ input, forceLegacyStatisticsQxx: true }).solve();
          legacyWalls.push(performance.now() - started);
        }
        const legacyEvents: QxxReuseProbeEvent[] = [];
        const legacyResult = new LSAEngine({
          input,
          forceLegacyStatisticsQxx: true,
          qxxReuseProbe: (event) => {
            legacyEvents.push(event);
          },
        }).solve();
        const legacyStats = legacyEvents.find((e) => e.stage === 'statistics');
        legacyComparator = {
          wallMedianMs: median(legacyWalls),
          statisticsReused: legacyStats?.reused ?? false,
          statisticsReason: legacyStats?.reason ?? 'no-event',
          statisticsAccumulations: legacyStats?.normalAccumulations ?? -1,
          statisticsInversions: legacyStats?.inversions ?? -1,
          fullResultParity: stableResultJson(legacyResult) === stableResultJson(result),
        };
      }

      const orientationParameters = result.directionSetDiagnostics?.length ?? 0;
      caseEvidence.push({
        fixture: id,
        synthetic,
        admissible,
        inadmissibilityReason: admissible
          ? null
          : synthetic
            ? `synthetic orientation observation excluded from scaling: reuse inadmissible (reason=${statsEvent?.reason ?? 'no-event'}); success=${result.success} converged=${result.converged}`
            : id === 'industry_demo-3d-terrestrial'
              ? `weak-case observation excluded by policy: success=${result.success} converged=${result.converged}`
              : `non-converged reference: success=${result.success} converged=${result.converged}`,
        success: result.success,
        converged: result.converged,
        iterations: result.iterations,
        totalParameters,
        scalarEquations,
        unknownStations: unknowns,
        orientationParameters,
        orientationRatio: totalParameters > 0 ? orientationParameters / totalParameters : 0,
        dof: result.dof,
        wallMedianMs: median(walls),
        timingMediansMs,
        wallReconciliationMs: {
          profiledWallMedian: median(profiledWalls),
          classifiedBucketSum,
          other: timingMediansMs.otherMs,
          total: timingMediansMs.totalMs,
          unclassified:
            timingMediansMs.totalMs - classifiedBucketSum - timingMediansMs.otherMs,
        },
        correctionLoopMs,
        covarianceMs,
        statisticsMs: profMedian((p) => p.statisticsMs),
        statisticsDetailMs,
        standardizedResidualDetailMs,
        design: {
          parameterCount: firstIteration?.parameterCount ?? null,
          equationCount: firstIteration?.equationCount ?? null,
          designNnzTotal: median(
            profiles.map((p) => p.iterations.reduce((sum, r) => sum + r.designNnz, 0)),
          ),
          weightNnzTotal: median(
            profiles.map((p) => p.iterations.reduce((sum, r) => sum + r.weightNnz, 0)),
          ),
          finalNormalDimension: finalEvent?.normalDimension ?? null,
          finalQxxDimension: finalEvent?.qxxDimension ?? null,
          statisticsNormalDimension: statsEvent?.normalDimension ?? null,
        },
        reuseProbe: {
          finalAccumulations: finalEvent?.normalAccumulations ?? -1,
          finalInversions: finalEvent?.inversions ?? -1,
          statisticsReused: statsEvent?.reused ?? false,
          statisticsReason: statsEvent?.reason ?? 'no-event',
          statisticsAccumulations: statsEvent?.normalAccumulations ?? -1,
          statisticsInversions: statsEvent?.inversions ?? -1,
        },
        allPairs: {
          rows: allPairsRows,
          expectedRows: expectedAllPairsRows,
          matchExpected: allPairsRows === expectedAllPairsRows,
          precisionPropagationMs: statisticsDetailMs.precisionPropagation,
        },
        precisionCounts: {
          stationCovarianceRows: result.stationCovariances?.length ?? 0,
          relativeCovarianceRows: result.relativeCovariances?.length ?? 0,
          requestedRelPtolPairs:
            result.relativeCovariances?.filter(
              (r) => r.selectedByRelativeDirective || r.selectedByPositionalToleranceDirective,
            ).length ?? 0,
        },
        legacyComparator,
      });
    }

    const artifactDir = join(process.cwd(), 'artifacts/evidence/phase10f');
    mkdirSync(artifactDir, { recursive: true });
    const payload = {
      status: 'complete',
      method:
        'per fixture: uninstrumented warm-up solve, then 5 clean measured production solves (neither qxxReuseProbe nor detailedSolveProfiler attached) with solveTimingProfile medians; warm-up + 3 measured profiled production solves with per-field DetailedSolveProfiler medians and profiled wall median; plus evidence-only synthetic gps-3d-16-orientation-synth (16 deterministic DB/DN direction sets, 3 truth-based bearings each) recorded as a non-scaling observation with orientation ratio; wall reconciliation sums exclusive top-level solveTimingProfile buckets (nested precisionPropagation/reportDiagnostics and profiler stages reported separately); legacy forceLegacyStatisticsQxx comparator (warm-up + 5 clean runs + instrumented solve) runs on gps-3d-32/64/128 only; no timing assertions, walls observational only',
      measuredRuns: MEASURED_RUNS,
      profiledRuns: PROFILED_RUNS,
      legacyComparatorIds: LEGACY_COMPARATOR_IDS,
      cases: caseEvidence,
    };
    writeFileSync(join(artifactDir, 'phase10f-evidence.json'), `${JSON.stringify(payload, null, 2)}\n`);

    const markdown = [
      '# Phase 10F post-reuse production profile evidence',
      '',
      'Evidence-only dense TypeScript campaign on the genuine 3D corpus. Per fixture: uninstrumented warm-up solve, then 5 clean measured production solves (neither qxxReuseProbe nor detailedSolveProfiler attached) with solveTimingProfile medians reported. Warm-up + 3 measured profiled production solves with per-field DetailedSolveProfiler medians. Legacy comparator (force-legacy oracle) runs on gps-3d-32/64/128 only. industry_demo is inadmissible (weak-case observation). No timing assertions; walls are observational only.',
      '',
      'Generated inputs carry no .RELATIVE/.PTOLERANCE directives, so requested REL/PTOL pairs are 0 by construction and relativeCovariance rows are connected pairs only.',
      '',
      '| Fixture | params | orient | orient ratio | rows | iters | stn cov rows | rel cov rows | REL/PTOL req | clean wall ms | profiled wall ms | correction loop ms | cov invert ms | stats ms | stats Qxx inv ms | all-pairs rows | all-pairs expected | reuse reason | legacy wall ms | legacy parity |',
      '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|',
      ...caseEvidence.map(
        (c) =>
          `| ${c.fixture} | ${c.totalParameters} | ${c.orientationParameters} | ${c.orientationRatio.toFixed(3)} | ${c.scalarEquations} | ${c.iterations} | ${c.precisionCounts.stationCovarianceRows} | ${c.precisionCounts.relativeCovarianceRows} | ${c.precisionCounts.requestedRelPtolPairs} | ${c.wallMedianMs.toFixed(2)} | ${c.wallReconciliationMs.profiledWallMedian.toFixed(2)} | ${c.correctionLoopMs.total.toFixed(2)} | ${c.covarianceMs.invert.toFixed(2)} | ${c.statisticsMs.toFixed(2)} | ${c.standardizedResidualDetailMs.statisticsQxxInversion.toFixed(2)} | ${c.allPairs.rows} | ${c.allPairs.expectedRows} | ${c.reuseProbe.statisticsReason} | ${c.legacyComparator ? c.legacyComparator.wallMedianMs.toFixed(2) : 'n/a'} | ${c.legacyComparator ? (c.legacyComparator.fullResultParity ? 'BIT-IDENTICAL' : 'MISMATCH') : 'n/a'} |`,
      ),
      '',
      '## Wall reconciliation (medians, ms)',
      '',
      'Classified = parseAndSetup + equationAssembly + matrixFactorization + precisionAndDiagnostics + resultPackaging (exclusive top-level buckets; nested precisionPropagation/reportDiagnostics and profiler stages excluded).',
      '',
      '| Fixture | clean wall | profiled wall | classified | other | total | unclassified |',
      '|---|---:|---:|---:|---:|---:|---:|',
      ...caseEvidence.map(
        (c) =>
          `| ${c.fixture} | ${c.wallMedianMs.toFixed(2)} | ${c.wallReconciliationMs.profiledWallMedian.toFixed(2)} | ${c.wallReconciliationMs.classifiedBucketSum.toFixed(2)} | ${c.wallReconciliationMs.other.toFixed(2)} | ${c.wallReconciliationMs.total.toFixed(2)} | ${c.wallReconciliationMs.unclassified.toFixed(2)} |`,
      ),
      '',
      '- Production default automatically reuses the recovered final dense Qxx as the standardized-residual statistics Qxx on the eligible cohort; equations are still assembled, only the statistics normal accumulation and inversion are skipped.',
      '- No UI, protocol, formula, or routing changes.',
    ].join('\n');
    writeFileSync(join(artifactDir, 'phase10f-evidence.md'), `${markdown}\n`);

    expect(caseEvidence.map((c) => c.fixture)).toEqual([
      'industry_demo-3d-terrestrial',
      'gps-3d-cov-08',
      'gps-3d-16',
      'gps-3d-32',
      'gps-3d-64',
      'gps-3d-128',
      'gps-3d-16-orientation-synth',
    ]);
    for (const c of caseEvidence) {
      if (c.synthetic) {
        // Non-scaling orientation observation: proves the orientation-heavy
        // shape and records full metrics; reuse follows the same bar.
        expect(c.orientationParameters, `${c.fixture} 16 direction sets`).toBe(16);
        expect(c.orientationRatio, `${c.fixture} orientation ratio`).toBeGreaterThan(0);
        expect(c.legacyComparator, `${c.fixture} no legacy comparator`).toBeNull();
        if (!c.admissible) {
          expect(c.inadmissibilityReason, `${c.fixture} explicit inadmissibility`).toMatch(
            /damped-final-recovery|weak-case|non-converged|reuse inadmissible/,
          );
          expect(c.reuseProbe.statisticsReason, `${c.fixture} orientation fail-closed route`).toBe('damped-final-recovery');
          continue;
        }
      } else if (!c.admissible) {
        expect(c.inadmissibilityReason).toContain('weak-case observation');
        expect(c.legacyComparator, `${c.fixture} no legacy comparator`).toBeNull();
        continue;
      }
      expect(c.success && c.converged, `${c.fixture} reference solves`).toBe(true);
      expect(c.reuseProbe.statisticsReused, `${c.fixture} production reuses`).toBe(true);
      expect(c.reuseProbe.statisticsReason, `${c.fixture} production reason`).toBe(
        'reused-final-dense-qxx',
      );
      expect(c.reuseProbe.statisticsAccumulations, `${c.fixture} reuse skips accumulation`).toBe(0);
      expect(c.reuseProbe.statisticsInversions, `${c.fixture} reuse skips inversion`).toBe(0);
      expect(c.standardizedResidualDetailMs.statisticsNormalAccumulation, `${c.fixture} profiler accumulation`).toBe(0);
      expect(c.standardizedResidualDetailMs.statisticsQxxInversion, `${c.fixture} profiler inversion`).toBe(0);
      expect(c.allPairs.matchExpected, `${c.fixture} dense all-pairs count`).toBe(true);
      expect(c.precisionCounts.stationCovarianceRows, `${c.fixture} station rows cover unknowns`).toBe(
        c.unknownStations,
      );
      // Generated inputs carry no .RELATIVE/.PTOLERANCE directives, so the
      // requested-pair count is 0 by construction; relativeCovariance rows
      // below are connected pairs only.
      expect(c.precisionCounts.requestedRelPtolPairs, `${c.fixture} no requested pairs`).toBe(0);
      if (c.legacyComparator) {
        expect(c.legacyComparator.statisticsReused, `${c.fixture} oracle recomputes`).toBe(false);
        expect(c.legacyComparator.statisticsReason, `${c.fixture} oracle reason`).toBe(
          'force-legacy-oracle',
        );
        expect(c.legacyComparator.statisticsInversions, `${c.fixture} oracle statistics inversion`).toBe(1);
        expect(c.legacyComparator.fullResultParity, `${c.fixture} full-result parity`).toBe(true);
      } else {
        expect(
          ['gps-3d-cov-08', 'gps-3d-16'].includes(c.fixture) || c.synthetic,
          `${c.fixture} comparator scope`,
        ).toBe(true);
      }
    }
  }, 600000);
});
