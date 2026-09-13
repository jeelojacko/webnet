/**
 * Phase 12F.1 agent-tier contract: bounded native static-GNSS R1 route.
 *
 * Fast unit-scope checks (no WASM, no campaigns): default-OFF proof (no
 * bundle load), eligibility cohort gates, dense-backed stub parity
 * (corrections, verified Qxx, Phase-12D statistics, trace identity,
 * setup variants), boundaries, family exclusions, route isolation, the
 * fault-injection fallback matrix (each fault => clean-TS restart,
 * whole-structure bit-identical to feature-disabled TS), and
 * multi-component/repeated-edge support.
 *
 * Real-WASM parity, Dataset A/B proofs, crossover benchmarks, memory,
 * and browser smoke are manual evidence only (never CI); see
 * reports/gnss/phase12f1-native-r1-production-proof.md.
 */
import { describe, expect, it, beforeEach } from 'vitest';

import { runGnssBaselineAdjustment } from '../../src/engine/gnssBaselineAdjust';
import {
  countGnssNativeR1Params,
  deriveGnssNativeR1Eligibility,
  findGnssBaselineBridges,
  GNSS_NATIVE_R1_MAX_PARAMS,
  GNSS_NATIVE_R1_MIN_PARAMS,
  isGnssNativeR1RouteEnabled,
  runGnssBaselineWithNativeR1,
  setGnssNativeR1RouteEnabled,
} from '../../src/workers/gnssBaselineNativeR1Route';
import {
  isNativeFullQxxRouteEnabled,
  setNativeFullQxxRouteEnabled,
} from '../../src/workers/adjustmentNativeFullQxxAutoRoute';
import type { SparseSelectedCovarianceResult } from '../../src/engine/numericalBackend';
import { generateAuditNetwork } from '../../scripts/gnss/gnssNativeAuditCorpus';
import { buildGnssAdjustInput } from '../../scripts/gnss/gnssNativeArchitectureAudit';
import type { SparseCorrectionSolveInput } from '../../src/engine/numericalBackend';
import {
  countingCorrectionSolver,
  countingCovarianceSolver,
} from '../helpers/sparseTestStubs';

beforeEach(() => {
  setGnssNativeR1RouteEnabled(false);
});

const workerOn = { isWorker: true as const };
const smallBounds = { minParams: 1, maxParams: 750 };

const ringInput = (stations: number, seed = 7) =>
  buildGnssAdjustInput(generateAuditNetwork('ring', stations, seed));

describe('default-OFF production proof', () => {
  it('kill switch defaults OFF and never loads WASM', async () => {
    expect(isGnssNativeR1RouteEnabled()).toBe(false);
    const input = ringInput(8);
    let loaded = false;
    const attempt = await runGnssBaselineWithNativeR1(input, {
      ...workerOn,
      loadBundle: () => {
        loaded = true;
        throw new Error('must not load');
      },
    });
    expect(loaded).toBe(false);
    expect(attempt.route).toBe('typescript');
    expect(attempt.result.routeProvenance).toBe('typescript-dense');
    expect(attempt.reasons.join('; ')).toMatch(/kill switch/);
  });

  it('default-OFF result is bit-identical to plain TS', async () => {
    const input = ringInput(8);
    const attempt = await runGnssBaselineWithNativeR1(input, workerOn);
    const oracle = runGnssBaselineAdjustment(input);
    expect(attempt.route).toBe('typescript');
    expect(JSON.stringify(attempt.result)).toBe(JSON.stringify(oracle));
  });
});

describe('eligibility cohort', () => {
  it('admits a bridgeless ring through the worker gate', () => {
    setGnssNativeR1RouteEnabled(true);
    const input = ringInput(52);
    const eligibility = deriveGnssNativeR1Eligibility(input, workerOn);
    expect(eligibility.numParams).toBe(153);
    expect(eligibility.reasons).toEqual([]);
    expect(eligibility.eligible).toBe(true);
  });

  it('rejects non-worker context even when enabled', () => {
    setGnssNativeR1RouteEnabled(true);
    const eligibility = deriveGnssNativeR1Eligibility(ringInput(52), {});
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reasons.join('; ')).toMatch(/worker/);
  });

  it('rejects unavailable WASM explicitly', () => {
    setGnssNativeR1RouteEnabled(true);
    const eligibility = deriveGnssNativeR1Eligibility(ringInput(52), {
      ...workerOn,
      wasmAvailable: false,
    });
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reasons.join('; ')).toMatch(/WASM/);
  });

  it('holds small nets on TS with the perf-floor reason', () => {
    setGnssNativeR1RouteEnabled(true);
    const eligibility = deriveGnssNativeR1Eligibility(ringInput(8), workerOn);
    expect(eligibility.numParams).toBe(21);
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reasons.join('; ')).toMatch(/perf floor/);
  });

  it('rejects bridged graphs (F-BRIDGE stays TS-dense)', () => {
    setGnssNativeR1RouteEnabled(true);
    const input = buildGnssAdjustInput(generateAuditNetwork('chain', 8, 11));
    const bridges = findGnssBaselineBridges(input);
    expect(bridges.length).toBeGreaterThan(0);
    const eligibility = deriveGnssNativeR1Eligibility(input, {
      ...workerOn,
      ...smallBounds,
    });
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reasons.join('; ')).toMatch(/cut-edge/);
  });

  it('repeated edges are not bridges', () => {
    const input = buildGnssAdjustInput(generateAuditNetwork('repeated-edge', 8, 13));
    expect(findGnssBaselineBridges(input)).toEqual([]);
  });

  it('doubled a-b pair is not a bridge (multigraph Tarjan)', () => {
    const input = {
      stations: {},
      baselines: [
        { from: 'a', to: 'b', id: 1 },
        { from: 'a', to: 'b', id: 2 },
        { from: 'b', to: 'c', id: 3 },
      ],
    } as unknown as Parameters<typeof findGnssBaselineBridges>[0];
    expect(findGnssBaselineBridges(input)).toEqual([{ from: 'b', to: 'c' }]);
  });

  it('rejects non-ECEF frames (never legacy G/GPS)', () => {
    setGnssNativeR1RouteEnabled(true);
    const input = ringInput(8);
    const bad = {
      ...input,
      baselines: input.baselines.map((baseline, index) =>
        index === 0 ? { ...baseline, frame: 'projectLocal' as unknown as 'ecef' } : baseline,
      ),
    };
    const eligibility = deriveGnssNativeR1Eligibility(bad, { ...workerOn, ...smallBounds });
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reasons.join('; ')).toMatch(/never legacy G\/GPS/);
  });

  it('rejects invalid 3x3 covariance fail-closed', () => {
    setGnssNativeR1RouteEnabled(true);
    const input = ringInput(8);
    const bad = {
      ...input,
      baselines: input.baselines.map((baseline, index) =>
        index === 0
          ? { ...baseline, covariance: { ...baseline.covariance, xx: -1 } }
          : baseline,
      ),
    };
    const eligibility = deriveGnssNativeR1Eligibility(bad, { ...workerOn, ...smallBounds });
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reasons.join('; ')).toMatch(/covariance/);
  });

  it('bounds: 750 admitted, 753 rejected (eligibility-only, no solve)', () => {
    setGnssNativeR1RouteEnabled(true);
    expect(GNSS_NATIVE_R1_MAX_PARAMS).toBe(750);
    expect(GNSS_NATIVE_R1_MIN_PARAMS).toBe(150);
    const atCap = buildGnssAdjustInput(generateAuditNetwork('ring', 251, 21));
    expect(countGnssNativeR1Params(atCap)).toBe(750);
    expect(deriveGnssNativeR1Eligibility(atCap, workerOn).eligible).toBe(true);
    const overCap = buildGnssAdjustInput(generateAuditNetwork('ring', 252, 23));
    expect(countGnssNativeR1Params(overCap)).toBe(753);
    const rejected = deriveGnssNativeR1Eligibility(overCap, workerOn);
    expect(rejected.eligible).toBe(false);
    expect(rejected.reasons.join('; ')).toMatch(/exceeds R1 cap 750/);
  });
});

describe('native R1 parity through dense-backed stubs', () => {
  it('ring-52 (p=153, realistic ±6e6 ECEF): bitwise parity + native provenance', async () => {
    setGnssNativeR1RouteEnabled(true);
    const input = ringInput(52);
    const oracle = runGnssBaselineAdjustment(input);
    const attempt = await runGnssBaselineWithNativeR1(input, {
      ...workerOn,
      correctionSolverOverride: countingCorrectionSolver(),
      covarianceSolverOverride: countingCovarianceSolver(),
    });
    expect(attempt.route).toBe('native-sparse-full-qxx');
    expect(attempt.result.routeProvenance).toBe('native-sparse-full-qxx');
    expect(attempt.reasons).toEqual([]);
    // Whole-structure bitwise identity except provenance tag + log line.
    const { routeProvenance: _n, logs: _nl, ...nativeRest } = attempt.result;
    const { routeProvenance: _t, logs: _tl, ...tsRest } = oracle;
    expect(JSON.stringify(nativeRest)).toBe(JSON.stringify(tsRest));
    expect(attempt.result.logs).toEqual([
      ...oracle.logs,
      'GNSS Qxx: native sparse full-dense (verified).',
    ]);
    // Realistic ECEF magnitudes really exercised.
    const maxAbs = Math.max(
      ...Object.values(attempt.result.stations).map((station) => Math.abs(station.x)),
    );
    expect(maxAbs).toBeGreaterThan(1e6);
  });

  it('Phase-12D postprocessing parity: residuals/vTPv/SEUW/trace', async () => {
    setGnssNativeR1RouteEnabled(true);
    const input = ringInput(52);
    const oracle = runGnssBaselineAdjustment(input);
    const attempt = await runGnssBaselineWithNativeR1(input, {
      ...workerOn,
      correctionSolverOverride: countingCorrectionSolver(),
      covarianceSolverOverride: countingCovarianceSolver(),
    });
    expect(attempt.route).toBe('native-sparse-full-qxx');
    expect(attempt.result.weightedResidualSum).toBe(oracle.weightedResidualSum);
    expect(attempt.result.varianceFactor).toBe(oracle.varianceFactor);
    expect(attempt.result.statistics).toEqual(oracle.statistics);
    expect(attempt.result.residuals).toEqual(oracle.residuals);
    const trace = attempt.result.statistics.reduce((sum, stat) => sum + stat.redundancy.trace, 0);
    expect(Math.abs(trace - attempt.result.dof)).toBeLessThan(1e-9);
  });

  it('setup variants A0/AC/AH/A-style: native-vs-TS parity', async () => {
    setGnssNativeR1RouteEnabled(true);
    const network = generateAuditNetwork('ring', 52, 31);
    const setups = [
      undefined,
      { horizontalCenteringSigma: 0.005, antennaHeightSigma: 0 },
      { horizontalCenteringSigma: 0, antennaHeightSigma: 0.002 },
      { horizontalCenteringSigma: 0.005, antennaHeightSigma: 0.002 },
    ];
    for (const setupUncertainty of setups) {
      const input = buildGnssAdjustInput(network, setupUncertainty);
      const oracle = runGnssBaselineAdjustment(input);
      const attempt = await runGnssBaselineWithNativeR1(input, {
        ...workerOn,
        correctionSolverOverride: countingCorrectionSolver(),
        covarianceSolverOverride: countingCovarianceSolver(),
      });
      expect(attempt.route).toBe('native-sparse-full-qxx');
      const seuw = Math.sqrt(Math.max(attempt.result.varianceFactor, 0));
      const oracleSeuw = Math.sqrt(Math.max(oracle.varianceFactor, 0));
      expect(seuw).toBe(oracleSeuw);
      const { routeProvenance: _n, logs: _nl, conditionEstimate: _nc, ...nativeRest } = attempt.result;
      const { routeProvenance: _t, logs: _tl, conditionEstimate: _tc, ...tsRest } = oracle;
      expect(JSON.stringify(nativeRest)).toBe(JSON.stringify(tsRest));
      // Condition is diagnostics-only metadata: native reports the packed
      // estimate while TS reports the dense one (last-ulp scale).
      const relCond =
        Math.abs((attempt.result.conditionEstimate ?? 0) - (oracle.conditionEstimate ?? 0)) /
        Math.max(1, Math.abs(oracle.conditionEstimate ?? 0));
      expect(relCond).toBeLessThan(1e-12);
      expect(attempt.result.logs).toEqual([
        ...oracle.logs,
        'GNSS Qxx: native sparse full-dense (verified).',
      ]);
    }
  });

  it('multi-component meshes solve with trace identity (no single-component restriction)', async () => {
    setGnssNativeR1RouteEnabled(true);
    const first = generateAuditNetwork('ring', 30, 41);
    const second = generateAuditNetwork('ring', 30, 43);
    // Disjoint station namespaces => two components in one packed system.
    const renamed = {
      stations: { ...first.stations },
      baselines: [...first.baselines],
    };
    Object.entries(second.stations).forEach(([id, station]) => {
      renamed.stations[`B_${id}`] = station;
    });
    let nextId = Math.max(...first.baselines.map((baseline) => baseline.id)) + 1;
    second.baselines.forEach((baseline) => {
      renamed.baselines.push({ ...baseline, id: nextId++, from: `B_${baseline.from}`, to: `B_${baseline.to}` });
    });
    const input = buildGnssAdjustInput(renamed);
    const attempt = await runGnssBaselineWithNativeR1(input, {
      ...workerOn,
      correctionSolverOverride: countingCorrectionSolver(),
      covarianceSolverOverride: countingCovarianceSolver(),
    });
    expect(attempt.route).toBe('native-sparse-full-qxx');
    const trace = attempt.result.statistics.reduce((sum, stat) => sum + stat.redundancy.trace, 0);
    expect(Math.abs(trace - attempt.result.dof)).toBeLessThan(1e-9);
  });

  it('repeated/reversed edges: native parity', async () => {
    setGnssNativeR1RouteEnabled(true);
    const input = buildGnssAdjustInput(generateAuditNetwork('repeated-edge', 30, 47));
    const oracle = runGnssBaselineAdjustment(input);
    const attempt = await runGnssBaselineWithNativeR1(input, {
      ...workerOn,
      ...smallBounds,
      correctionSolverOverride: countingCorrectionSolver(),
      covarianceSolverOverride: countingCovarianceSolver(),
    });
    expect(attempt.route).toBe('native-sparse-full-qxx');
    const { routeProvenance: _n, logs: _nl, ...nativeRest } = attempt.result;
    const { routeProvenance: _t, logs: _tl, ...tsRest } = oracle;
    expect(JSON.stringify(nativeRest)).toBe(JSON.stringify(tsRest));
    expect(attempt.result.logs).toEqual([
      ...oracle.logs,
      'GNSS Qxx: native sparse full-dense (verified).',
    ]);
  });
});

describe('fallback contract + fault injection', () => {
  const faultyPairs = (): Array<{
    name: string;
    correction: ReturnType<typeof countingCorrectionSolver>;
    covariance: ReturnType<typeof countingCovarianceSolver>;
  }> => {
    const throwingCorrection = countingCorrectionSolver();
    throwingCorrection.solveFromEquations = () => {
      throw new Error('injected correction failure');
    };
    const goodCorrection = countingCorrectionSolver();
    const nanCorrection = {
      ...countingCorrectionSolver(),
      solveFromEquations: (input: SparseCorrectionSolveInput) => {
        const good = goodCorrection.solveFromEquations(input);
        return {
          ...good,
          correction: good.correction.map((row) => row.map(() => Number.NaN)),
        };
      },
    };
    const nanCovariance = {
      ...countingCovarianceSolver(),
      querySelected: (
        input: Parameters<ReturnType<typeof countingCovarianceSolver>['querySelected']>[0],
      ): SparseSelectedCovarianceResult => ({
        covariance: new Float64Array(input.queryRows.length).fill(Number.NaN),
        normalNnz: 0,
        factorNnz: 0,
        damping: 0,
        dampingAttempts: 0,
        timings: { assemblyMs: 0, equilibrationMs: 0, analyzeMs: 0, factorizeMs: 0, solveMs: 0 },
      }),
    };
    const shortCovariance = {
      ...countingCovarianceSolver(),
      querySelected: (): SparseSelectedCovarianceResult => ({
        covariance: new Float64Array(3).fill(1),
        normalNnz: 0,
        factorNnz: 0,
        damping: 0,
        dampingAttempts: 0,
        timings: { assemblyMs: 0, equilibrationMs: 0, analyzeMs: 0, factorizeMs: 0, solveMs: 0 },
      }),
    };
    const dampedCovariance = {
      ...countingCovarianceSolver(),
      querySelected: (
        input: Parameters<ReturnType<typeof countingCovarianceSolver>['querySelected']>[0],
      ): SparseSelectedCovarianceResult => {
        const good = countingCovarianceSolver().querySelected(input);
        return { ...good, damping: 1 };
      },
    };
    return [
      { name: 'correction throw', correction: throwingCorrection, covariance: countingCovarianceSolver() },
      { name: 'NaN correction', correction: nanCorrection, covariance: countingCovarianceSolver() },
      { name: 'NaN Qxx', correction: countingCorrectionSolver(), covariance: nanCovariance },
      { name: 'short Qxx', correction: countingCorrectionSolver(), covariance: shortCovariance },
      { name: 'damped Qxx', correction: countingCorrectionSolver(), covariance: dampedCovariance },
    ];
  };

  for (const pair of faultyPairs()) {
    it(`fault ${pair.name} => clean-TS restart, bit-identical`, async () => {
      setGnssNativeR1RouteEnabled(true);
      const input = ringInput(8);
      const oracle = runGnssBaselineAdjustment(input);
      const attempt = await runGnssBaselineWithNativeR1(input, {
        ...workerOn,
        ...smallBounds,
        correctionSolverOverride: pair.correction,
        covarianceSolverOverride: pair.covariance,
      });
      expect(attempt.route).toBe('typescript');
      expect(attempt.result.routeProvenance).toBe('typescript-dense');
      expect(attempt.reasons.length).toBeGreaterThan(0);
      expect(JSON.stringify(attempt.result)).toBe(JSON.stringify(oracle));
    });
  }

  it('WASM bundle init failure => clean-TS restart, bit-identical', async () => {
    setGnssNativeR1RouteEnabled(true);
    const input = ringInput(52);
    const oracle = runGnssBaselineAdjustment(input);
    const attempt = await runGnssBaselineWithNativeR1(input, {
      ...workerOn,
      loadBundle: () => Promise.reject(new Error('injected WASM missing')),
    });
    expect(attempt.route).toBe('typescript');
    expect(JSON.stringify(attempt.result)).toBe(JSON.stringify(oracle));
  });
});

describe('route isolation', () => {
  it('GNSS R1 toggle is independent of the legacy 3D full-Qxx route', () => {
    const before = isNativeFullQxxRouteEnabled();
    setGnssNativeR1RouteEnabled(true);
    expect(isGnssNativeR1RouteEnabled()).toBe(true);
    expect(isNativeFullQxxRouteEnabled()).toBe(before);
    setNativeFullQxxRouteEnabled(!before);
    expect(isGnssNativeR1RouteEnabled()).toBe(true);
    setNativeFullQxxRouteEnabled(before);
    setGnssNativeR1RouteEnabled(false);
  });

  it('TS-dense default path is untouched by the seam (no nativeRuntime)', () => {
    const input = ringInput(8);
    const result = runGnssBaselineAdjustment(input);
    expect(result.routeProvenance).toBe('typescript-dense');
    expect(result.converged).toBe(true);
  });
});
