/**
 * Phase 12F.3 agent-tier contract, part 1: bounded native static-GNSS R2B route.
 *
 * Fast unit-scope checks (no WASM, no campaigns): default-OFF proof (no
 * bundle load, no solver touched), eligibility cohort gates, boundary
 * probes (params/blocks via overrides), dense-backed stub parity (coords
 * bitwise, SEUW rel, Qvv/Cvv rel, trace identity), no-dense tripwires
 * (full-Qxx canary, no qxx field, source guards), and route isolation.
 * The fault-injection fallback matrix lives in part 2
 * (gnssBaselineNativeR2BFaults.test.ts).
 *
 * Real-WASM parity, datasets, crossover benchmarks, and browser proof
 * are later-phase evidence only (never CI).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, beforeEach } from 'vitest';

import {
  runGnssBaselineAdjustment,
  type GnssBaselineAdjustInput,
} from '../../src/engine/gnssBaselineAdjust';
import type {
  SparseSelectedBlockInput,
  SparseSelectedBlockSolver,
} from '../../src/engine/numericalBackend';
import {
  deriveGnssNativeR2BEligibility,
  GNSS_NATIVE_R2B_MAX_BLOCKS,
  GNSS_NATIVE_R2B_MAX_FACTOR_NNZ,
  GNSS_NATIVE_R2B_MAX_PARAMS,
  GNSS_NATIVE_R2B_MAX_TOTAL_STATIONS,
  GNSS_NATIVE_R2B_MIN_PARAMS,
  isGnssNativeR2BRouteEnabled,
  runGnssBaselineWithNativeR2B,
  setGnssNativeR2BRouteEnabled,
} from '../../src/workers/gnssBaselineNativeR2BRoute';
import {
  isGnssNativeR1RouteEnabled,
  setGnssNativeR1RouteEnabled,
} from '../../src/workers/gnssBaselineNativeR1Route';
import { generateAuditNetwork } from '../../scripts/gnss/gnssNativeAuditCorpus';
import { buildGnssAdjustInput } from '../../scripts/gnss/gnssNativeArchitectureAudit';
import { countingBlockSolver, countingCorrectionSolver } from '../helpers/sparseTestStubs';

beforeEach(() => {
  setGnssNativeR2BRouteEnabled(false);
  setGnssNativeR1RouteEnabled(false);
});

const workerOn = { isWorker: true as const };
const smallBounds = { minParams: 1 };

const ringInput = (stations: number, seed = 7): GnssBaselineAdjustInput =>
  buildGnssAdjustInput(generateAuditNetwork('ring', stations, seed));

const rel = (a: number, b: number): number => {
  const denom = Math.max(Math.abs(a), Math.abs(b));
  return denom === 0 ? 0 : Math.abs(a - b) / denom;
};

describe('default-OFF production proof', () => {
  it('kill switch defaults OFF and touches nothing', async () => {
    expect(isGnssNativeR2BRouteEnabled()).toBe(false);
    const input = ringInput(8);
    const correction = countingCorrectionSolver();
    const blocks = countingBlockSolver();
    let loaded = false;
    const attempt = await runGnssBaselineWithNativeR2B(input, {
      ...workerOn,
      correctionSolverOverride: correction,
      blockSolverOverride: blocks,
      loadBundle: () => {
        loaded = true;
        throw new Error('must not load');
      },
    });
    expect(loaded).toBe(false);
    expect(correction.inputs.length).toBe(0);
    expect(blocks.inputs.length).toBe(0);
    expect(attempt.route).toBe('typescript');
    expect(attempt.result.routeProvenance).toBe('typescript-dense');
    expect(attempt.reasons.join('; ')).toMatch(/kill switch/);
  });

  it('default-OFF result is bit-identical to plain TS', async () => {
    const input = ringInput(8);
    const attempt = await runGnssBaselineWithNativeR2B(input, workerOn);
    const oracle = runGnssBaselineAdjustment(input);
    expect(attempt.route).toBe('typescript');
    expect(JSON.stringify(attempt.result)).toBe(JSON.stringify(oracle));
  });
});

describe('eligibility cohort', () => {
  it('admits a bridgeless ring at the MIN floor through the worker gate', () => {
    setGnssNativeR2BRouteEnabled(true);
    expect(GNSS_NATIVE_R2B_MIN_PARAMS).toBe(225);
    expect(GNSS_NATIVE_R2B_MAX_TOTAL_STATIONS).toBe(750);
    expect(GNSS_NATIVE_R2B_MAX_PARAMS).toBe(2250);
    expect(GNSS_NATIVE_R2B_MAX_BLOCKS).toBe(4000);
    expect(GNSS_NATIVE_R2B_MAX_FACTOR_NNZ).toBe(1500000);
    const input = ringInput(76);
    const eligibility = deriveGnssNativeR2BEligibility(input, workerOn);
    expect(eligibility.numParams).toBe(225);
    expect(eligibility.selectedBlockCount).toBeGreaterThan(0);
    expect(eligibility.reasons).toEqual([]);
    expect(eligibility.eligible).toBe(true);
  });

  it('rejects non-worker context even when enabled', () => {
    setGnssNativeR2BRouteEnabled(true);
    const eligibility = deriveGnssNativeR2BEligibility(ringInput(76), {});
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reasons.join('; ')).toMatch(/worker/);
  });

  it('rejects unavailable WASM and missing block API explicitly', () => {
    setGnssNativeR2BRouteEnabled(true);
    const noWasm = deriveGnssNativeR2BEligibility(ringInput(76), { ...workerOn, wasmAvailable: false });
    expect(noWasm.eligible).toBe(false);
    expect(noWasm.reasons.join('; ')).toMatch(/WASM bundle/);
    const noBlocks = deriveGnssNativeR2BEligibility(ringInput(76), { ...workerOn, blockApiAvailable: false });
    expect(noBlocks.eligible).toBe(false);
    expect(noBlocks.reasons.join('; ')).toMatch(/queryBlocks/);
  });

  it('holds small nets on TS with the perf-floor reason', () => {
    setGnssNativeR2BRouteEnabled(true);
    const eligibility = deriveGnssNativeR2BEligibility(ringInput(8), workerOn);
    expect(eligibility.numParams).toBe(21);
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reasons.join('; ')).toMatch(/perf floor/);
  });

  it('rejects bridged graphs (F-BRIDGE stays TS-dense)', () => {
    setGnssNativeR2BRouteEnabled(true);
    const input = buildGnssAdjustInput(generateAuditNetwork('chain', 8, 11));
    const eligibility = deriveGnssNativeR2BEligibility(input, { ...workerOn, ...smallBounds });
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reasons.join('; ')).toMatch(/cut-edge/);
  });

  it('rejects non-ECEF frames (never legacy G/GPS)', () => {
    setGnssNativeR2BRouteEnabled(true);
    const input = ringInput(8);
    const badFrame = {
      ...input,
      baselines: input.baselines.map((baseline, index) =>
        index === 0 ? { ...baseline, frame: 'projectLocal' as unknown as 'ecef' } : baseline,
      ),
    };
    const frameRejected = deriveGnssNativeR2BEligibility(badFrame, { ...workerOn, ...smallBounds });
    expect(frameRejected.eligible).toBe(false);
    expect(frameRejected.reasons.join('; ')).toMatch(/never legacy G\/GPS/);
    const badType = {
      ...input,
      baselines: input.baselines.map((baseline, index) =>
        index === 0 ? { ...baseline, type: 'gps' as unknown as 'gnssBaseline' } : baseline,
      ),
    };
    const typeRejected = deriveGnssNativeR2BEligibility(badType, { ...workerOn, ...smallBounds });
    expect(typeRejected.eligible).toBe(false);
    expect(typeRejected.reasons.join('; ')).toMatch(/never legacy G\/GPS/);
  });

  it('rejects invalid 3x3 covariance fail-closed', () => {
    setGnssNativeR2BRouteEnabled(true);
    const input = ringInput(8);
    const bad = {
      ...input,
      baselines: input.baselines.map((baseline, index) =>
        index === 0 ? { ...baseline, covariance: { ...baseline.covariance, xx: -1 } } : baseline,
      ),
    };
    const eligibility = deriveGnssNativeR2BEligibility(bad, { ...workerOn, ...smallBounds });
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reasons.join('; ')).toMatch(/covariance/);
  });

  it('params bounds: min-1/min/min+1 and max-1/max/max+1 via overrides', () => {
    setGnssNativeR2BRouteEnabled(true);
    const input = ringInput(8);
    expect(deriveGnssNativeR2BEligibility(input, { ...workerOn, minParams: 22 }).eligible).toBe(false);
    expect(deriveGnssNativeR2BEligibility(input, { ...workerOn, minParams: 21 }).eligible).toBe(true);
    expect(deriveGnssNativeR2BEligibility(input, { ...workerOn, minParams: 20 }).eligible).toBe(true);
    expect(
      deriveGnssNativeR2BEligibility(input, { ...workerOn, ...smallBounds, maxParams: 20 }).eligible,
    ).toBe(false);
    expect(
      deriveGnssNativeR2BEligibility(input, { ...workerOn, ...smallBounds, maxParams: 21 }).eligible,
    ).toBe(true);
    expect(
      deriveGnssNativeR2BEligibility(input, { ...workerOn, ...smallBounds, maxParams: 22 }).eligible,
    ).toBe(true);
  });

  it('block-cap bounds: cap-1/cap/cap+1 via maxBlocks override', () => {
    setGnssNativeR2BRouteEnabled(true);
    const input = ringInput(8);
    const measured = deriveGnssNativeR2BEligibility(input, { ...workerOn, ...smallBounds });
    expect(measured.eligible).toBe(true);
    const cap = measured.selectedBlockCount ?? 0;
    expect(cap).toBeGreaterThan(1);
    const below = deriveGnssNativeR2BEligibility(input, { ...workerOn, ...smallBounds, maxBlocks: cap - 1 });
    expect(below.eligible).toBe(false);
    expect(below.reasons.join('; ')).toMatch(/selected-block count/);
    expect(
      deriveGnssNativeR2BEligibility(input, { ...workerOn, ...smallBounds, maxBlocks: cap }).eligible,
    ).toBe(true);
    expect(
      deriveGnssNativeR2BEligibility(input, { ...workerOn, ...smallBounds, maxBlocks: cap + 1 }).eligible,
    ).toBe(true);
  });

  it('station cap gates total stations via override', () => {
    setGnssNativeR2BRouteEnabled(true);
    const input = ringInput(8);
    expect(
      deriveGnssNativeR2BEligibility(input, { ...workerOn, ...smallBounds, maxTotalStations: 7 }).eligible,
    ).toBe(false);
    expect(
      deriveGnssNativeR2BEligibility(input, { ...workerOn, ...smallBounds, maxTotalStations: 8 }).eligible,
    ).toBe(true);
  });
});

describe('native R2B parity through dense-backed stubs', () => {
  it('ring-76 (p=225, realistic ±6e6 ECEF): coords bitwise + statistics rel parity', async () => {
    setGnssNativeR2BRouteEnabled(true);
    const input = ringInput(76);
    const oracle = runGnssBaselineAdjustment(input);
    const attempt = await runGnssBaselineWithNativeR2B(input, {
      ...workerOn,
      correctionSolverOverride: countingCorrectionSolver(),
      blockSolverOverride: countingBlockSolver(),
    });
    expect(attempt.route).toBe('native-sparse-selected-qxx');
    expect(attempt.result.routeProvenance).toBe('native-sparse-selected-qxx');
    expect(attempt.reasons).toEqual([]);
    expect(attempt.result.stations).toEqual(oracle.stations);
    expect(attempt.result.residuals).toEqual(oracle.residuals);
    expect(attempt.result.weightedResidualSum).toBe(oracle.weightedResidualSum);
    const seuw = Math.sqrt(Math.max(attempt.result.varianceFactor, 0));
    const oracleSeuw = Math.sqrt(Math.max(oracle.varianceFactor, 0));
    expect(rel(seuw, oracleSeuw)).toBeLessThan(1e-12);
    expect(attempt.result.statistics.length).toBe(oracle.statistics.length);
    let qvvMaxRel = 0;
    let cvvMaxRel = 0;
    attempt.result.statistics.forEach((stat, index) => {
      const ref = oracle.statistics[index]!;
      (['xx', 'xy', 'xz', 'yy', 'yz', 'zz'] as const).forEach((key) => {
        qvvMaxRel = Math.max(qvvMaxRel, rel(stat.qvv[key], ref.qvv[key]));
        cvvMaxRel = Math.max(cvvMaxRel, rel(stat.cvv[key], ref.cvv[key]));
      });
      expect(Math.abs(stat.redundancy.trace - ref.redundancy.trace)).toBeLessThan(1e-9);
    });
    expect(qvvMaxRel).toBeLessThan(1e-9);
    expect(cvvMaxRel).toBeLessThan(1e-9);
    const trace = attempt.result.statistics.reduce((sum, stat) => sum + stat.redundancy.trace, 0);
    expect(Math.abs(trace - attempt.result.dof)).toBeLessThan(1e-9);
    const maxAbs = Math.max(
      ...Object.values(attempt.result.stations).map((station) => Math.abs(station.x)),
    );
    expect(maxAbs).toBeGreaterThan(1e6);
  });

  it('setup-uncertainty parity: nonzero setup stays TS-side, blocks match TS', async () => {
    setGnssNativeR2BRouteEnabled(true);
    const network = generateAuditNetwork('ring', 76, 31);
    const input = buildGnssAdjustInput(network, {
      horizontalCenteringSigma: 0.005,
      antennaHeightSigma: 0.002,
    });
    const oracle = runGnssBaselineAdjustment(input);
    const attempt = await runGnssBaselineWithNativeR2B(input, {
      ...workerOn,
      correctionSolverOverride: countingCorrectionSolver(),
      blockSolverOverride: countingBlockSolver(),
    });
    expect(attempt.route).toBe('native-sparse-selected-qxx');
    expect(attempt.result.stations).toEqual(oracle.stations);
    expect(attempt.result.weightedResidualSum).toBe(oracle.weightedResidualSum);
    const trace = attempt.result.statistics.reduce((sum, stat) => sum + stat.redundancy.trace, 0);
    expect(Math.abs(trace - attempt.result.dof)).toBeLessThan(1e-9);
  });

  it('multi-component meshes solve with trace identity (no single-component restriction)', async () => {
    setGnssNativeR2BRouteEnabled(true);
    const first = generateAuditNetwork('ring', 30, 41);
    const second = generateAuditNetwork('ring', 30, 43);
    const renamed = { stations: { ...first.stations }, baselines: [...first.baselines] };
    Object.entries(second.stations).forEach(([id, station]) => {
      renamed.stations[`B_${id}`] = station;
    });
    let nextId = Math.max(...first.baselines.map((baseline) => baseline.id)) + 1;
    second.baselines.forEach((baseline) => {
      renamed.baselines.push({ ...baseline, id: nextId++, from: `B_${baseline.from}`, to: `B_${baseline.to}` });
    });
    const input = buildGnssAdjustInput(renamed);
    const attempt = await runGnssBaselineWithNativeR2B(input, {
      ...workerOn,
      ...smallBounds,
      correctionSolverOverride: countingCorrectionSolver(),
      blockSolverOverride: countingBlockSolver(),
    });
    expect(attempt.route).toBe('native-sparse-selected-qxx');
    const trace = attempt.result.statistics.reduce((sum, stat) => sum + stat.redundancy.trace, 0);
    expect(Math.abs(trace - attempt.result.dof)).toBeLessThan(1e-9);
  });

  it('repeated edges: native parity with trace identity', async () => {
    setGnssNativeR2BRouteEnabled(true);
    const input = buildGnssAdjustInput(generateAuditNetwork('repeated-edge', 30, 47));
    const oracle = runGnssBaselineAdjustment(input);
    const attempt = await runGnssBaselineWithNativeR2B(input, {
      ...workerOn,
      ...smallBounds,
      correctionSolverOverride: countingCorrectionSolver(),
      blockSolverOverride: countingBlockSolver(),
    });
    expect(attempt.route).toBe('native-sparse-selected-qxx');
    expect(attempt.result.stations).toEqual(oracle.stations);
    const trace = attempt.result.statistics.reduce((sum, stat) => sum + stat.redundancy.trace, 0);
    expect(Math.abs(trace - attempt.result.dof)).toBeLessThan(1e-9);
  });
});

describe('no-dense tripwires', () => {
  it('never touches the full-Qxx path and carries no qxx field', async () => {
    setGnssNativeR2BRouteEnabled(true);
    const input = ringInput(76);
    let fullQxxCalls = 0;
    const canaryBlocks = countingBlockSolver() as SparseSelectedBlockSolver & {
      querySelected: () => never;
      inputs: SparseSelectedBlockInput[];
    };
    canaryBlocks.querySelected = (): never => {
      fullQxxCalls += 1;
      throw new Error('full-Qxx path touched (fail-closed tripwire)');
    };
    const attempt = await runGnssBaselineWithNativeR2B(input, {
      ...workerOn,
      correctionSolverOverride: countingCorrectionSolver(),
      blockSolverOverride: canaryBlocks,
    });
    expect(attempt.route).toBe('native-sparse-selected-qxx');
    expect(fullQxxCalls).toBe(0);
    expect('qxx' in attempt.result).toBe(false);
    expect('selectedBlocks' in attempt.result).toBe(true);
  });

  it('source guards: no full-Qxx references in the R2B route or engine branch', () => {
    const routePath = fileURLToPath(new URL('../../src/workers/gnssBaselineNativeR2BRoute.ts', import.meta.url));
    const routeSource = readFileSync(routePath, 'utf8');
    expect(routeSource).not.toContain('querySelected');
    const enginePath = fileURLToPath(new URL('../../src/engine/gnssBaselineAdjust.ts', import.meta.url));
    const engineSource = readFileSync(enginePath, 'utf8');
    const begin = engineSource.indexOf('R2B selected-blocks branch (begin)');
    const end = engineSource.indexOf('R2B selected-blocks branch (end)');
    expect(begin).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(begin);
    const branch = engineSource.slice(begin, end);
    expect(branch).not.toContain('querySelected');
    expect(branch).not.toContain('invertNormalMatrixForStats');
    expect(branch).not.toContain('nativeQxxProvider');
  });
});

describe('route isolation', () => {
  it('R1 switch is independent: R1 ON still leaves R2B OFF', async () => {
    setGnssNativeR1RouteEnabled(true);
    expect(isGnssNativeR1RouteEnabled()).toBe(true);
    expect(isGnssNativeR2BRouteEnabled()).toBe(false);
    const attempt = await runGnssBaselineWithNativeR2B(ringInput(8), workerOn);
    expect(attempt.route).toBe('typescript');
    expect(attempt.reasons.join('; ')).toMatch(/kill switch/);
    setGnssNativeR1RouteEnabled(false);
  });

  it('bridge-excluded graphs stay TS even when enabled', async () => {
    // Chain graphs trip the shared production F-BRIDGE PSD gate once dof > 0,
    // so clean TS itself throws: the route must reject at eligibility (no
    // native solver touched) and surface the TS error, never a native result.
    setGnssNativeR2BRouteEnabled(true);
    const input = buildGnssAdjustInput(generateAuditNetwork('chain', 8, 11));
    const blocks = countingBlockSolver();
    await expect(
      runGnssBaselineWithNativeR2B(input, {
        ...workerOn,
        ...smallBounds,
        correctionSolverOverride: countingCorrectionSolver(),
        blockSolverOverride: blocks,
      }),
    ).rejects.toThrow(/materially non-PSD/);
    expect(blocks.inputs.length).toBe(0);
  });

  it('TS-dense default path is untouched by the seam (no nativeRuntime)', () => {
    const input = ringInput(8);
    const result = runGnssBaselineAdjustment(input);
    expect(result.routeProvenance).toBe('typescript-dense');
    expect(result.converged).toBe(true);
  });
});
