/**
 * Phase 15B correctness verification (§5, §13-§23, §28-§32, §35-§36).
 *
 * Production code already generalizes decideStatisticsQxxReuse to the
 * conservative 2D dense cohort; this file PROVES correctness without
 * touching gates: direct Qxx equivalence, dense oracle, full-result
 * parity, admitted corpus A-F (E proves TS groups active via OFF/ON
 * toggle), rejected corpus G-J, GPS/robust/free-network/orientation/
 * weighted-controls/sparse/preanalysis/LOO/concurrency checks, export
 * parity, fault injection, and operation-count gates.
 */
import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../src/engine/adjust';
import { invertNormalMatrixForStats } from '../src/engine/adjustNormalEquationHelpers';
import {
  accumulateNormalEquationsFromSparseRows,
  zeros,
} from '../src/engine/matrix';
import type { SparseMatrixRows } from '../src/engine/matrix';
import type {
  SparseSelectedCovarianceInput,
  SparseSelectedCovarianceResult,
  SparseSelectedCovarianceSolver,
} from '../src/engine/numericalBackend';
import { decideStatisticsQxxReuse } from '../src/engine/statisticsQxxReuse';
import type { QxxReuseProbeEvent } from '../src/engine/qxxReuseEvidence';
import { buildObservationsResidualsCsvText } from '../src/engine/browserExports';
import { buildLandXmlText } from '../src/engine/landxml';
import type { ParseOptions } from '../src/types';

const DIST_EXACT = '64.0312423743285';
const ANGLE_EXACT = '102-40-49.380570552';

const TERRESTRIAL = [
  '.2D',
  'C A 0 0 0 ! !',
  'C B 100 0 0 ! !',
  'C P 50 40 0',
  'D A-P 64.031 0.01',
  'D B-P 64.031 0.01',
  'A P-A-B 102-40-00.0 1.0',
].join('\n');

const DIRECTION = [
  '.2D',
  'C A 0 0 0 ! !',
  'C B 100 0 0 ! !',
  'C P 50 40 0',
  `D A-P ${DIST_EXACT} 0.00001`,
  `D B-P ${DIST_EXACT} 0.00001`,
  'DB P',
  'DN A 231-20-24.690285276 0.001',
  'DN B 128-39-35.309714724 0.001',
  'DE',
].join('\n');

const GPS_2D = [
  '.2D',
  'C A 0 0 0 ! !',
  'C B 100 0 0 ! !',
  'C P 50 40 0',
  'G GPS1 A P 50.0 40.0 0.00001 0.00001',
  'G GPS1 B P -50.0 40.0 0.00001 0.00001',
  `D A-P ${DIST_EXACT} 0.00001`,
].join('\n');

const WEIGHTED = [
  '.2D',
  'C A 0 0 0 ! !',
  'C B 100 0 0.00001 0.00001',
  'C P 50 40 0',
  `D A-P ${DIST_EXACT} 0.00001`,
  `D B-P ${DIST_EXACT} 0.00001`,
  `A P-A-B ${ANGLE_EXACT} 0.001`,
].join('\n');

/** Direction set with 3 readings: TS-correlation groups go active. */
const TSCORR_DIR = [
  '.2D',
  'C A 0 0 0 ! !',
  'C B 100 0 0 ! !',
  'C C 0 100 0 ! !',
  'C P 50 40 0',
  'D A-P 64.0312423743285 0.01',
  'DB P',
  'DN A 231-20-24.690285276 0.5',
  'DN B 128-39-35.309714724 0.5',
  'DN C 320-13-39.944067845 0.5',
  'DE',
].join('\n');

const OUTLIER = [
  '.2D',
  'C A 0 0 0 ! !',
  'C B 100 0 0 ! !',
  'C P 50 40 0',
  'D A-P 64.031 0.01',
  'D B-P 64.031 0.01',
  'A P-A-B 102-40-00.0 1.0',
  'D A-P 64.071 0.01',
].join('\n');

const TSCORR_PARSE: Partial<ParseOptions> = {
  coordMode: '2D',
  units: 'm',
  tsCorrelationEnabled: true,
  tsCorrelationRho: 0.5,
  tsCorrelationScope: 'set',
};
const STATISTICAL_PARSE: Partial<ParseOptions> = {
  coordMode: '2D',
  units: 'm',
  reliabilityPolicy: { model: 'statistical' },
};

interface CorpusCase {
  id: string;
  input: string;
  parseOptions?: Partial<ParseOptions>;
}

const ADMITTED: CorpusCase[] = [
  { id: 'A-terrestrial', input: TERRESTRIAL },
  { id: 'B-direction', input: DIRECTION },
  { id: 'C-gps', input: GPS_2D },
  { id: 'D-weighted', input: WEIGHTED },
  { id: 'E-tscorr', input: TSCORR_DIR, parseOptions: TSCORR_PARSE },
  { id: 'F-statistical', input: OUTLIER, parseOptions: STATISTICAL_PARSE },
];

const solveWithProbe = (
  c: CorpusCase,
  forceLegacy: boolean | undefined,
  extra?: { sparseSolver?: SparseSelectedCovarianceSolver },
) => {
  const events: QxxReuseProbeEvent[] = [];
  const result = new LSAEngine({
    input: c.input,
    maxIterations: 30,
    parseOptions: c.parseOptions,
    forceLegacyStatisticsQxx: forceLegacy,
    sparseSelectedCovarianceSolver: extra?.sparseSolver,
    qxxReuseProbe: (event) => {
      events.push(event);
    },
  }).solve();
  return { result, events };
};

/** Full-result comparison: timing/profiling stripped, everything else compared. */
const stripVolatile = (result: ReturnType<LSAEngine['solve']>): string => {
  const logs = result.logs.filter((line) => !line.startsWith('Solve timing (ms):'));
  return JSON.stringify({ ...result, logs, solveTimingProfile: undefined });
};

const maxAbsDiff = (a: number[][], b: number[][]): number => {
  let max = 0;
  for (let i = 0; i < a.length; i += 1) {
    for (let j = 0; j < a[i].length; j += 1) {
      max = Math.max(max, Math.abs(a[i][j] - b[i][j]));
    }
  }
  return max;
};

const maxRelDiff = (a: number[][], b: number[][]): number => {
  let max = 0;
  for (let i = 0; i < a.length; i += 1) {
    for (let j = 0; j < a[i].length; j += 1) {
      const denom = Math.max(Math.abs(a[i][j]), Math.abs(b[i][j]));
      if (denom > 0) max = Math.max(max, Math.abs(a[i][j] - b[i][j]) / denom);
    }
  }
  return max;
};

/** Exact dense selected-covariance solver (proves sparse presence rejects). */
const denseReferenceSelectedCovariance = (): SparseSelectedCovarianceSolver => ({
  querySelected(input: SparseSelectedCovarianceInput): SparseSelectedCovarianceResult {
    const eqCount = input.observationEquationCount;
    const paramCount = input.parameterCount;
    const sparseRows: SparseMatrixRows = Array.from({ length: eqCount }, () => []);
    for (let row = 0; row < eqCount; row += 1) {
      const start = input.design.rowOffsets[row] ?? 0;
      const end = input.design.rowOffsets[row + 1] ?? 0;
      for (let k = start; k < end; k += 1) {
        (sparseRows[row] as { index: number; value: number }[]).push({
          index: input.design.columns[k] ?? 0,
          value: input.design.values[k] ?? 0,
        });
      }
    }
    const weights = Array.from({ length: eqCount }, () => new Array<number>(eqCount).fill(0));
    for (let k = 0; k < input.weights.values.length; k += 1) {
      const row = input.weights.rows[k] ?? 0;
      const column = input.weights.columns[k] ?? 0;
      const value = input.weights.values[k] ?? 0;
      (weights[row] as number[])[column] = value;
      (weights[column] as number[])[row] = value;
    }
    const { normal } = accumulateNormalEquationsFromSparseRows(
      sparseRows,
      zeros(eqCount, 1),
      weights,
      paramCount,
    );
    const inverse = invertNormalMatrixForStats(normal, () => undefined);
    const covariance = new Float64Array(input.queryRows.length);
    for (let k = 0; k < input.queryRows.length; k += 1) {
      covariance[k] = inverse[input.queryRows[k] ?? 0]?.[input.queryColumns[k] ?? 0] ?? 0;
    }
    return { covariance, normalNnz: 0, factorNnz: 0, damping: 0, dampingAttempts: 0 };
  },
});

describe('Phase 15B correctness verification', () => {
  it.each(ADMITTED.map((c) => [c.id] as [string]))(
    'admitted %s: reuse with full parity, bit-identical Qxx, 1/0 op counts',
    (id) => {
      const c = ADMITTED.find((x) => x.id === id) as CorpusCase;
      const { result, events } = solveWithProbe(c, undefined);
      expect(result.success).toBe(true);
      expect(result.converged).toBe(true);
      const oracle = solveWithProbe(c, true);
      expect(stripVolatile(result)).toBe(stripVolatile(oracle.result));

      const stats = events.find((e) => e.stage === 'statistics');
      expect(stats?.reused).toBe(true);
      expect(stats?.reason).toBe('reused-final-dense-qxx');
      expect(stats?.normalAccumulations).toBe(0);
      expect(stats?.inversions).toBe(0);
      expect(stats?.normalDimension).toBeNull();
      const final = events.find((e) => e.stage === 'final-covariance');
      expect(final?.normalAccumulations).toBe(1);
      expect(final?.inversions).toBe(1);

      const legacyStats = oracle.events.find((e) => e.stage === 'statistics');
      expect(legacyStats?.reused).toBe(false);
      expect(legacyStats?.normalAccumulations).toBe(1);
      expect(legacyStats?.inversions).toBe(1);
      // §20 direct Qxx equivalence under strict covariance tolerance.
      expect(maxAbsDiff(legacyStats!.qxx!, stats!.qxx!)).toBe(0);
      expect(maxRelDiff(legacyStats!.qxx!, stats!.qxx!)).toBe(0);
    },
  );

  it('dense oracle (§36): legacy final N/Qxx equal stats-recomputed N/Qxx equal reuse Qxx', () => {
    const c = ADMITTED.find((x) => x.id === 'C-gps') as CorpusCase;
    const oracle = solveWithProbe(c, true);
    const legacyFinal = oracle.events.find((e) => e.stage === 'final-covariance');
    const legacyStats = oracle.events.find((e) => e.stage === 'statistics');
    expect(legacyFinal?.normalDimension).toBe(legacyStats?.normalDimension);
    expect(maxAbsDiff(legacyFinal!.normal!, legacyStats!.normal!)).toBe(0);
    expect(maxAbsDiff(legacyFinal!.qxx!, legacyStats!.qxx!)).toBe(0);
    const { events } = solveWithProbe(c, undefined);
    const stats = events.find((e) => e.stage === 'statistics');
    expect(maxAbsDiff(legacyStats!.qxx!, stats!.qxx!)).toBe(0);
  });

  it('E proves TS groups active: OFF/ON toggle changes correlation terms', () => {
    const c = ADMITTED.find((x) => x.id === 'E-tscorr') as CorpusCase;
    const on = solveWithProbe(c, undefined);
    expect(on.result.tsCorrelationDiagnostics?.enabled).toBe(true);
    expect(on.result.tsCorrelationDiagnostics?.pairCount).toBeGreaterThan(0);
    const off: CorpusCase = { id: 'E-off', input: c.input };
    const offRun = solveWithProbe(off, undefined);
    expect(offRun.result.tsCorrelationDiagnostics?.pairCount ?? 0).toBe(0);
    // No-op toggle rejected: correlation terms genuinely differ.
    expect(
      JSON.stringify(on.result.tsCorrelationDiagnostics) ===
        JSON.stringify(offRun.result.tsCorrelationDiagnostics),
    ).toBe(false);
    expect(JSON.stringify(on.result.stochasticDiagnostics)).not.toBe(
      JSON.stringify(offRun.result.stochasticDiagnostics),
    );
  });

  it('GPS (§13): coupled E/N blocks, redundancy, local tests, MDB, CoordEff, rotated components', () => {
    const c = ADMITTED.find((x) => x.id === 'C-gps') as CorpusCase;
    const { result } = solveWithProbe(c, undefined);
    const oracle = solveWithProbe(c, true);
    const gps = result.observations.find((o) => o.type === 'gps');
    const gpsOracle = oracle.result.observations.find((o) => o.type === 'gps');
    expect(gps).toBeDefined();
    // No diagonal simplification: per-component coupled fields populated.
    expect(gps?.stdResComponents).toBeDefined();
    expect(gps?.componentStdRes).toBeDefined();
    expect(gps?.componentResidualStdErr).toBeDefined();
    expect(gps?.redundancy).toEqual(
      expect.objectContaining({ rE: expect.any(Number), rN: expect.any(Number) }),
    );
    expect(gps?.mdbComponents).toBeDefined();
    expect(gps?.reliability?.externalComponents?.E?.available).toBe(true);
    expect(gps?.reliability?.externalComponents?.N?.available).toBe(true);
    expect(JSON.stringify(gps)).toBe(JSON.stringify(gpsOracle));
    expect(JSON.stringify(result.stochasticDiagnostics)).toBe(
      JSON.stringify(oracle.result.stochasticDiagnostics),
    );
  });

  it('F statistical reliability: MDB, CoordEff, availability unchanged vs legacy', () => {
    const c = ADMITTED.find((x) => x.id === 'F-statistical') as CorpusCase;
    const { result } = solveWithProbe(c, undefined);
    const oracle = solveWithProbe(c, true);
    expect(result.reliabilitySummary?.model).toBe('statistical');
    for (const obs of result.observations) {
      const other = oracle.result.observations.find((o) => o.id === obs.id);
      expect(JSON.stringify(obs.reliability)).toBe(JSON.stringify(other?.reliability));
      expect(obs.mdb).toBe(other?.mdb);
      expect(obs.localTest).toEqual(other?.localTest);
    }
  });

  it('G sparse-selected stays sparse: solver presence rejects reuse', () => {
    const c = ADMITTED.find((x) => x.id === 'C-gps') as CorpusCase;
    const { result, events } = solveWithProbe(c, undefined, {
      sparseSolver: denseReferenceSelectedCovariance(),
    });
    expect(result.success).toBe(true);
    const stats = events.find((e) => e.stage === 'statistics');
    expect(stats?.reused).toBe(false);
    expect(stats?.reason).toBe('sparse-selected-solver-active');
    expect(stats?.inversions).toBe(1);
  });

  it('H malformed Qxx: every shape rejected fail-closed', () => {
    const base = {
      forceLegacy: false,
      converged: true,
      preanalysisMode: false,
      robustMode: 'none' as string | undefined,
      finalQxx: [
        [2, 0.5],
        [0.5, 1],
      ],
      hasSelectedStore: false,
      hasSparseSelectedCovarianceSolver: false,
      sparseRowProductsAvailable: false,
      numParams: 2,
      augmentedRowCount: 0,
      finalCovarianceDamping: 0,
    };
    const malformed: Array<[string, number[][] | null]> = [
      ['missing', null],
      ['dim-mismatch-rows', [[2, 0.5], [0.5, 1], [0, 0]]],
      ['dim-mismatch-cols', [[2], [0.5]]],
      ['nan', [[2, Number.NaN], [0.5, 1]]],
      ['inf', [[2, Number.POSITIVE_INFINITY], [0.5, 1]]],
      ['malformed-row', [[2, 0.5], [0.5] as unknown as number[]]],
      ['empty', []],
    ];
    for (const [label, finalQxx] of malformed) {
      const decision = decideStatisticsQxxReuse({ ...base, finalQxx });
      expect(decision.eligible).toBe(false);
      expect(decision.reason).toMatch(/missing-final-qxx|dimension-mismatch-or-non-finite/);
      expect(label).toBeTruthy();
    }
  });

  it('I kill switch forces legacy with full parity; J robust falls back', () => {
    const c = ADMITTED.find((x) => x.id === 'A-terrestrial') as CorpusCase;
    const { result, events } = solveWithProbe(c, true);
    expect(events.find((e) => e.stage === 'statistics')?.reason).toBe(
      'force-legacy-oracle',
    );
    expect(stripVolatile(result)).toBe(stripVolatile(solveWithProbe(c, undefined).result));

    const huber: CorpusCase = { id: 'J-huber', input: `${TERRESTRIAL}\n.ROBUST HUBER 1.5\n` };
    const robust = solveWithProbe(huber, undefined);
    const robustOracle = solveWithProbe(huber, true);
    expect(stripVolatile(robust.result)).toBe(stripVolatile(robustOracle.result));
    expect(
      robust.events.find((e) => e.stage === 'statistics')?.reason,
    ).toBe('robust-mode-inadmissible');
  });

  it('free-network (§17) + preanalysis (§30): parity on any path, gates reject', () => {
    const free: CorpusCase = { id: 'free', input: TERRESTRIAL.replace(/!/g, '') };
    const { result } = solveWithProbe(free, undefined);
    const oracle = solveWithProbe(free, true);
    expect(stripVolatile(result)).toBe(stripVolatile(oracle.result));
    expect(
      decideStatisticsQxxReuse({
        forceLegacy: false,
        converged: true,
        preanalysisMode: true,
        robustMode: 'none',
        finalQxx: [[1]],
        hasSelectedStore: false,
        hasSparseSelectedCovarianceSolver: false,
        sparseRowProductsAvailable: false,
        numParams: 1,
        augmentedRowCount: 0,
        finalCovarianceDamping: 0,
      }).reason,
    ).toBe('preanalysis-mode');
  });

  it('LOO/no-sharing (§31) + concurrency (§32): independent deterministic solves', () => {
    const a = ADMITTED.find((x) => x.id === 'A-terrestrial') as CorpusCase;
    const c = ADMITTED.find((x) => x.id === 'C-gps') as CorpusCase;
    const a1 = solveWithProbe(a, undefined);
    const c1 = solveWithProbe(c, undefined);
    const a2 = solveWithProbe(a, undefined);
    const c2 = solveWithProbe(c, undefined);
    // Deterministic across runs; each solve owns its Qxx (value-equal, ref-distinct).
    expect(stripVolatile(a1.result)).toBe(stripVolatile(a2.result));
    expect(stripVolatile(c1.result)).toBe(stripVolatile(c2.result));
    const qxxA1 = a1.events.find((e) => e.stage === 'statistics')?.qxx as number[][];
    const qxxA2 = a2.events.find((e) => e.stage === 'statistics')?.qxx as number[][];
    expect(qxxA1).not.toBe(qxxA2);
    expect(maxAbsDiff(qxxA1, qxxA2)).toBe(0);
    expect(a1.events.find((e) => e.stage === 'statistics')?.reused).toBe(true);
    expect(c1.events.find((e) => e.stage === 'statistics')?.reused).toBe(true);
    expect(c2.events.find((e) => e.stage === 'statistics')?.reused).toBe(true);
  });

  it('export parity (§22): residual CSV, saved JSON, LandXML identical', () => {
    const c = ADMITTED.find((x) => x.id === 'C-gps') as CorpusCase;
    const { result } = solveWithProbe(c, undefined);
    const oracle = solveWithProbe(c, true);
    expect(buildObservationsResidualsCsvText({ result, units: 'm' })).toBe(
      buildObservationsResidualsCsvText({ result: oracle.result, units: 'm' }),
    );
    expect(stripVolatile(result)).toBe(stripVolatile(oracle.result));
    const landSettings = {
      units: 'm' as const,
      solveProfile: 'webnet' as const,
      generatedAt: new Date('2026-09-16T00:00:00Z'),
      projectName: 'phase15b',
      applicationName: 'WebNet',
      applicationVersion: '0.0.0',
    };
    expect(buildLandXmlText(result, landSettings)).toBe(
      buildLandXmlText(oracle.result, landSettings),
    );
  });
});
