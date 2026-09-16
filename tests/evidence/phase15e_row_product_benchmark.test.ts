/**
 * Phase 15E evidence: solve-local dense row-product reuse (§benchmarks).
 *
 * EVIDENCE ONLY — compares the production default (reuse ON) against the
 * test-only kill switch (reuse OFF = legacy recompute) on 2D + 3D dense
 * fixtures. 1 warm-up + 5 measured clean wall runs per arm (medians); one
 * instrumented solve per arm supplies telemetry op counts and profiler
 * stats timing. Writes machine artifacts to artifacts/evidence/phase15e/
 * (gitignored) and the committed report to
 * reports/performance/phase15e-row-product-reuse.md.
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
import {
  getLastDenseRowProductCounters,
  setStatisticsDenseRowProductReuseEnabled,
} from '../../src/engine/statisticsDenseRowProductCache';
import { runAdjustmentSession } from '../../src/engine/runSession';
import { createRunSessionRequest } from '../helpers/runSessionRequest';

const RUNS = 5;
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const round2 = (v: number): number => Math.round(v * 100) / 100;

interface Fixture {
  id: string;
  dimension: '2D' | '3D';
  input: string;
  note: string;
  extraParseOptions?: Record<string, unknown>;
}

const specs = listPhase5BenchmarkCases(false);
const phase5 = (id: string): string => {
  const spec = specs.find((s) => s.id === id);
  if (!spec) throw new Error(`Missing fixture ${id}`);
  return generatePhase5BenchmarkInput(spec);
};
const phase6 = (id: string): string => {
  const found = buildPhase6LargeBenchmarkCases(false).find((c) => c.id === id);
  if (!found) throw new Error(`Missing fixture ${id}`);
  return found.input;
};

const fixtures: Fixture[] = [
  { id: 'chain-2d-64', dimension: '2D', input: phase5('chain-2d-64'), note: 'direction-heavy traverse' },
  { id: 'chain-2d-128', dimension: '2D', input: phase5('chain-2d-128'), note: 'direction-heavy traverse, larger' },
  { id: 'gps-2d-64', dimension: '2D', input: phase5('gps-2d-64'), note: 'GPS-vector 2D control' },
  {
    id: 'gps-2d-128',
    dimension: '2D',
    input: generatePhase5BenchmarkInput({ id: 'gps-2d-128', family: 'gps-2d', unknownCount: 128, seed: 2128 }),
    note: 'GPS-vector 2D, covariance-dominated larger case',
  },
  {
    id: 'chain-2d-tscorr-64',
    dimension: '2D',
    input: phase5('chain-2d-64'),
    note: 'traverse with real TS correlation (rho 0.5, set scope) + statistical MDB sensitivity',
    extraParseOptions: {
      tsCorrelationEnabled: true,
      tsCorrelationRho: 0.5,
      tsCorrelationScope: 'set',
      reliabilityPolicy: { model: 'statistical' },
    },
  },
  { id: 'gps-3d-64', dimension: '3D', input: phase6('gps-3d-64'), note: '3D GPS covariance' },
  { id: 'gps-3d-128', dimension: '3D', input: phase6('gps-3d-128'), note: '3D GPS covariance, larger' },
];

const stableJson = (result: ReturnType<LSAEngine['solve']>): string => {
  const logs = result.logs.filter((l) => !l.startsWith('Solve timing (ms):'));
  const { solveTimingProfile: _v, logs: _l, ...stable } = result;
  return JSON.stringify({ ...stable, logs });
};

interface ArmEvidence {
  wallMedianMs: number;
  statsTotalMs: number;
  perEquationMs: number;
  gpsCrossMs: number;
  summaryMs: number;
  rowProductConstructionMs: number;
  requests: number;
  computations: number;
  hits: number;
  uniquePairs: number;
  quadraticRequests: number;
  crossRequests: number;
  numParams: number;
  equations: number;
}

const measureArm = (fixture: Fixture, reuse: boolean): { arm: ArmEvidence; resultJson: string } => {
  const run = () =>
    new LSAEngine({
      input: fixture.input,
      parseOptions: { ...(fixture.extraParseOptions ?? {}) },
    }).solve();
  setStatisticsDenseRowProductReuseEnabled(reuse);
  try {
    run(); // warm-up
    const walls: number[] = [];
    for (let i = 0; i < RUNS; i += 1) {
      const t0 = performance.now();
      run();
      walls.push(performance.now() - t0);
    }
    const profiler = createDetailedSolveProfiler();
    const result = new LSAEngine({
      input: fixture.input,
      parseOptions: { ...(fixture.extraParseOptions ?? {}) },
      detailedSolveProfiler: profiler,
    }).solve();
    const counters = getLastDenseRowProductCounters();
    const first = profiler.profile.iterations[0];
    const detail = profiler.profile.standardizedResidualDetail;
    return {
      arm: {
        wallMedianMs: round2(median(walls)),
        statsTotalMs: round2(profiler.profile.statisticsMs),
        perEquationMs: round2(detail.perEquationStatisticsMs),
        gpsCrossMs: round2(detail.gpsCrossProductTransformMs),
        summaryMs: round2(detail.summaryConstructionMs),
        rowProductConstructionMs: round2(detail.rowProductConstructionMs),
        requests: counters?.rowProductRequests ?? 0,
        computations: counters?.computations ?? 0,
        hits: counters?.cacheHits ?? 0,
        uniquePairs: counters?.uniquePairsComputed ?? 0,
        quadraticRequests: counters?.quadraticFormRequests ?? 0,
        crossRequests: counters?.crossTermRequests ?? 0,
        numParams: first?.parameterCount ?? 0,
        equations: first?.equationCount ?? 0,
      },
      resultJson: stableJson(result),
    };
  } finally {
    setStatisticsDenseRowProductReuseEnabled(true);
  }
};

describe('Phase 15E dense row-product reuse evidence', () => {
  it('proves op-count reduction, bit-identical parity, and stage timing', () => {
    const rows: Record<string, unknown>[] = [];
    for (const fixture of fixtures) {
      const legacy = measureArm(fixture, false);
      const reuse = measureArm(fixture, true);
      // Bit-identical full-result parity OFF vs ON (timing/telemetry stripped).
      expect(reuse.resultJson).toBe(legacy.resultJson);
      // Op-count proof: same requests, strictly fewer computations, all
      // saved dots served as hits (GPS/TS-corr arms must show hits).
      expect(reuse.arm.requests).toBe(legacy.arm.requests);
      expect(reuse.arm.computations).toBeLessThanOrEqual(legacy.arm.computations);
      expect(reuse.arm.hits).toBe(legacy.arm.requests - reuse.arm.computations);
      if (fixture.id.startsWith('gps-') || fixture.id.includes('tscorr')) {
        expect(reuse.arm.hits).toBeGreaterThan(0);
      }
      // Legacy cost model: one dot per request, no hits.
      expect(legacy.arm.hits).toBe(0);
      expect(legacy.arm.computations).toBe(legacy.arm.requests);
      const delta = round2(reuse.arm.wallMedianMs - legacy.arm.wallMedianMs);
      const pct = legacy.arm.wallMedianMs > 0 ? round2((100 * delta) / legacy.arm.wallMedianMs) : 0;
      const statsDelta = round2(reuse.arm.statsTotalMs - legacy.arm.statsTotalMs);
      rows.push({
        fixture: fixture.id,
        dimension: fixture.dimension,
        note: fixture.note,
        params: reuse.arm.numParams,
        equations: reuse.arm.equations,
        transientBKiB: round2((reuse.arm.equations * reuse.arm.numParams * 8) / 1024),
        legacyWallMs: legacy.arm.wallMedianMs,
        reuseWallMs: reuse.arm.wallMedianMs,
        deltaMs: delta,
        deltaPct: pct,
        legacyStatsMs: legacy.arm.statsTotalMs,
        reuseStatsMs: reuse.arm.statsTotalMs,
        statsDeltaMs: statsDelta,
        legacyPerEquationMs: legacy.arm.perEquationMs,
        reusePerEquationMs: reuse.arm.perEquationMs,
        legacyGpsCrossMs: legacy.arm.gpsCrossMs,
        reuseGpsCrossMs: reuse.arm.gpsCrossMs,
        requests: reuse.arm.requests,
        legacyComputations: legacy.arm.computations,
        reuseComputations: reuse.arm.computations,
        hits: reuse.arm.hits,
        uniquePairs: reuse.arm.uniquePairs,
        quadraticRequests: reuse.arm.quadraticRequests,
        crossRequests: reuse.arm.crossRequests,
      });
    }

    // LOO session parity OFF vs ON (fresh cache per alternate solve).
    const blunder = [
      '.2D',
      'C A 0 0 0 ! !',
      'C B 100 0 0 ! !',
      'C P 50 40 0',
      'D A-P 64.031 0.01',
      'D B-P 64.031 0.01',
      'A P-A-B 102-40-00.0 1.0',
      'D A-P 64.071 0.01',
    ].join('\n');
    const looJson = (reuse: boolean): string => {
      setStatisticsDenseRowProductReuseEnabled(reuse);
      try {
        const base = createRunSessionRequest();
        const { result } = runAdjustmentSession(
          createRunSessionRequest({
            input: blunder,
            maxIterations: 30,
            parseSettings: {
              ...base.parseSettings,
              coordMode: '2D',
              runMode: 'adjustment',
              suspectImpactMode: 'on',
            },
          }),
        );
        const logs = result.logs.filter((l) => !l.startsWith('Solve timing (ms):'));
        const { solveTimingProfile: _v, logs: _l, ...stable } = result;
        return JSON.stringify({ ...stable, logs });
      } finally {
        setStatisticsDenseRowProductReuseEnabled(true);
      }
    };
    expect(looJson(true)).toBe(looJson(false));
    const outDir = join(process.cwd(), 'artifacts', 'evidence', 'phase15e');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'phase15e-row-product-benchmark.json'), `${JSON.stringify({ rows }, null, 2)}\n`);
  }, 180000);
});
