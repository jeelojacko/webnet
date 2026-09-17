/**
 * Phase 16B iteration-path structured weights (agent tier, fast).
 *
 * - Hybrid policy units: m gate, density gate, malformed fail-closed,
 *   pre-assembly UB estimator validity against real assemblies.
 * - Iteration routing: structured accumulation reproduces the dense N/U
 *   bit-identically through solveAdjustmentIteration; dense-shape systems
 *   fall back to a materialized dense P; structured inputs are never
 *   mutated (no stale weights can carry across iterations/solves).
 * - Robust Huber and the kill switch stay on the dense path.
 */
import { describe, expect, it, vi } from 'vitest';

import { accumulateNormalEquationsFromSparseRows, zeros } from '../src/engine/matrix';
import {
  solveAdjustmentIteration,
} from '../src/engine/adjustmentIteration';
import {
  estimateStructuredWeightDensityUB,
  shouldAssembleStructuredWeights,
  structuredWeightDensity,
  structuredWeightTransferEligible,
  STRUCTURED_WEIGHT_MAX_DENSITY,
  STRUCTURED_WEIGHT_MIN_EQUATIONS,
} from '../src/engine/structuredWeightOracle';
import {
  resetStructuredWeightTelemetry,
  snapshotStructuredWeightTelemetry,
} from '../src/engine/structuredWeightTelemetry';
import { structuredWeightsToDense } from '../src/engine/sparseWeightRepresentation';
import type { IterationSolveDependencies } from '../src/engine/adjustmentSolveTypes';
import {
  assembleBoth,
  buildChain2D,
  buildCorrelatedControls,
  buildGnssBaseline,
  buildGps2D,
  buildGps3D,
  buildMixed,
  buildTsDirections,
  buildTsSetupScope,
  buildWeightedControls,
  maxDiff,
  type BuiltNetwork,
} from './evidence/phase16aWeightEvidenceShared';

const families = (): BuiltNetwork[] => [
  buildChain2D('hy-chain', 8),
  buildGps2D('hy-gps2', 4),
  buildGps3D('hy-gps3', 4),
  buildGnssBaseline('hy-gnss', 3),
  buildTsDirections('hy-ts-set', 2, 4),
  buildTsSetupScope('hy-ts-setup', 2, 4),
  buildWeightedControls('hy-weighted-controls', 8),
  buildCorrelatedControls('hy-correlated-controls', 8),
  buildMixed('hy-mixed'),
];

const estimateFor = (network: BuiltNetwork): number =>
  estimateStructuredWeightDensityUB({
    equationCount: network.numObsEquations,
    observations: network.observations,
    tsCorrelationEnabled: true,
    tsCorrelationRho: 0.5,
    tsCorrelationScope: network.tsScope,
    is2D: network.deps.is2D,
    constraintCount: network.constraints.length,
  });

describe('phase 16B hybrid eligibility', () => {
  it('gates on the measured crossover and fails closed on malformed input', () => {
    expect(STRUCTURED_WEIGHT_MIN_EQUATIONS).toBe(128);
    expect(STRUCTURED_WEIGHT_MAX_DENSITY).toBe(0.02);
    expect(structuredWeightTransferEligible(127)).toBe(false);
    expect(structuredWeightTransferEligible(128)).toBe(true);
    expect(structuredWeightTransferEligible(2000)).toBe(true);
    expect(structuredWeightTransferEligible(128, 0.0156)).toBe(true);
    expect(structuredWeightTransferEligible(2000, STRUCTURED_WEIGHT_MAX_DENSITY)).toBe(true);
    expect(structuredWeightTransferEligible(128, 0.0233)).toBe(false);
    expect(structuredWeightTransferEligible(2000, 1)).toBe(false);
    expect(structuredWeightTransferEligible(128, Number.NaN)).toBe(false);
    expect(structuredWeightTransferEligible(128, -0.1)).toBe(false);
    expect(structuredWeightTransferEligible(128, Number.POSITIVE_INFINITY)).toBe(false);
    expect(structuredWeightTransferEligible(127.5)).toBe(false);
    expect(structuredWeightTransferEligible(-3)).toBe(false);
  });

  it('keeps Huber and the kill switch on the dense path', () => {
    const admitted = {
      equationCount: 2000,
      densityUB: 0.0005,
      robustMode: 'none' as const,
    };
    expect(shouldAssembleStructuredWeights(admitted)).toBe(true);
    expect(shouldAssembleStructuredWeights({ ...admitted, robustMode: 'huber' })).toBe(false);
    expect(shouldAssembleStructuredWeights({ ...admitted, structuredWeightTransfer: false })).toBe(
      false,
    );
    expect(shouldAssembleStructuredWeights({ ...admitted, structuredWeightTransfer: true })).toBe(
      true,
    );
    expect(shouldAssembleStructuredWeights({ ...admitted, equationCount: 64 })).toBe(false);
    expect(shouldAssembleStructuredWeights({ ...admitted, densityUB: 1 })).toBe(false);
    expect(
      shouldAssembleStructuredWeights({ ...admitted, densityUB: Number.NaN }),
    ).toBe(false);
  });

  it('reports exact density from writer metadata', () => {
    const chain = buildChain2D('dens-chain', 64);
    const { sparse } = assembleBoth(chain);
    expect(structuredWeightDensity(sparse.structuredWeights!)).toBeCloseTo(
      1 / chain.numObsEquations,
      15,
    );
    const gps = buildGps2D('dens-gps', 64);
    const gpsBoth = assembleBoth(gps);
    expect(structuredWeightDensity(gpsBoth.sparse.structuredWeights!)).toBeCloseTo(
      (gps.numObsEquations + 2 * 64) / gps.numObsEquations ** 2,
      15,
    );
  });

  it('estimates an upper bound that matches real assemblies family by family', () => {
    for (const network of families()) {
      const { sparse } = assembleBoth(network);
      const actual = structuredWeightDensity(sparse.structuredWeights!);
      const estimated = estimateFor(network);
      expect(estimated).toBeGreaterThanOrEqual(actual);
      // The only deliberate looseness is the constraint term: each
      // constraint row budgets one off-diagonal while uncorrelated
      // controls write none (correlated pairs write their own, shrinking
      // the gap). Everything else (TS groups, GPS/GNSS blocks) is exact
      // on these builders, so any estimator/writer drift beyond the
      // documented term shows up here, not in a production solve.
      const maxLooseness = (2 * network.constraints.length) / network.numObsEquations ** 2;
      expect(estimated - actual).toBeLessThanOrEqual(maxLooseness + 1e-12);
      if (network.constraints.length === 0) expect(estimated).toBe(actual);
    }
  });

  it('fails the estimator closed on malformed input', () => {
    const network = buildChain2D('hy-malformed', 8);
    const valid = {
      equationCount: network.numObsEquations,
      observations: network.observations,
      tsCorrelationEnabled: true,
      tsCorrelationRho: 0.5,
      tsCorrelationScope: network.tsScope,
      is2D: network.deps.is2D,
      constraintCount: network.constraints.length,
    };
    expect(estimateStructuredWeightDensityUB(valid)).toBe(
      structuredWeightDensity(assembleBoth(network).sparse.structuredWeights!),
    );
    expect(
      estimateStructuredWeightDensityUB({ ...valid, equationCount: 0 }),
    ).toBe(Number.POSITIVE_INFINITY);
    expect(
      estimateStructuredWeightDensityUB({ ...valid, observations: 'nope' as never }),
    ).toBe(Number.POSITIVE_INFINITY);
    expect(
      estimateStructuredWeightDensityUB({ ...valid, constraintCount: -1 }),
    ).toBe(Number.POSITIVE_INFINITY);
    expect(
      estimateStructuredWeightDensityUB({ ...valid, is2D: 'yes' as never }),
    ).toBe(Number.POSITIVE_INFINITY);
    // NaN rho disables the writer (rho||0 -> 0 -> early return), so the
    // estimator ignoring TS groups matches the writer exactly.
    expect(
      estimateStructuredWeightDensityUB({ ...valid, tsCorrelationRho: Number.NaN }),
    ).toBe(estimateStructuredWeightDensityUB({ ...valid, tsCorrelationEnabled: false }));
  });
});

const mockDependencies = (
  captured: { normal?: number[][]; rhs?: number[][] },
): IterationSolveDependencies => ({
  robustMode: 'none',
  solveNormalEquations: vi.fn((normal: number[][], rhs: number[][]) => {
    captured.normal = normal;
    captured.rhs = rhs;
    return { correction: zeros(normal.length, 1) };
  }),
  estimateCondition: () => 1,
  recordConditionEstimate: () => undefined,
  captureRobustWeightBase: () => ({ diagonal: [], correlatedPairs: [] }),
  applyRobustWeightFactors: () => undefined,
  computeRobustWeightSummary: () => ({
    factors: [],
    downweightedRows: 0,
    minWeight: 1,
    maxNorm: 0,
    meanWeight: 1,
    topRows: [],
  }),
  maxRobustWeightDelta: () => 0,
  recordRobustDiagnostics: () => undefined,
  weightedQuadratic: (P, v) => {
    let sum = 0;
    for (let i = 0; i < P.length; i += 1) {
      for (let j = 0; j < P.length; j += 1) {
        sum += (P[i]?.[j] ?? 0) * (v[i]?.[0] ?? 0) * (v[j]?.[0] ?? 0);
      }
    }
    return sum;
  },
});

describe('phase 16B iteration structured accumulation', () => {
  it('reproduces the dense correction bit-identically at m=128 without mutating weights', () => {
    const network = buildChain2D('it-chain', 64);
    expect(network.numObsEquations).toBe(128);
    const { dense, sparse } = assembleBoth(network);
    expect(
      structuredWeightTransferEligible(
        network.numObsEquations,
        structuredWeightDensity(sparse.structuredWeights!),
      ),
    ).toBe(true);
    const before = {
      diagonal: Array.from(sparse.structuredWeights!.diagonal),
      offValues: Array.from(sparse.structuredWeights!.offValues),
    };
    const denseCaptured: { normal?: number[][]; rhs?: number[][] } = {};
    const denseResult = solveAdjustmentIteration(
      mockDependencies(denseCaptured),
      [],
      sparse.L,
      dense.P!,
      sparse.rowInfo,
      1,
      { sparseRows: sparse.sparseRows, numParams: network.numParams },
    );
    const structuredCaptured: { normal?: number[][]; rhs?: number[][] } = {};
    const structuredResult = solveAdjustmentIteration(
      mockDependencies(structuredCaptured),
      [],
      sparse.L,
      undefined,
      sparse.rowInfo,
      1,
      {
        sparseRows: sparse.sparseRows,
        numParams: network.numParams,
        structuredWeights: sparse.structuredWeights!,
      },
    );
    expect(maxDiff(structuredCaptured.normal!, denseCaptured.normal!).maxAbs).toBe(0);
    expect(maxDiff(structuredCaptured.rhs!, denseCaptured.rhs!).maxAbs).toBe(0);
    expect(structuredResult.correction).toEqual(denseResult.correction);
    expect(structuredResult.sumBefore).toBe(denseResult.sumBefore);
    expect(structuredResult.sumAfter).toBe(denseResult.sumAfter);
    expect(Array.from(sparse.structuredWeights!.diagonal)).toEqual(before.diagonal);
    expect(Array.from(sparse.structuredWeights!.offValues)).toEqual(before.offValues);
  });

  it('falls back to a materialized dense P on dense shapes and records it', () => {
    const network = buildTsSetupScope('it-setup-fallback', 16, 8);
    expect(network.numObsEquations).toBe(128);
    const { dense, sparse } = assembleBoth(network);
    const density = structuredWeightDensity(sparse.structuredWeights!);
    expect(density).toBeGreaterThan(STRUCTURED_WEIGHT_MAX_DENSITY);
    resetStructuredWeightTelemetry();
    const captured: { normal?: number[][]; rhs?: number[][] } = {};
    solveAdjustmentIteration(
      mockDependencies(captured),
      [],
      sparse.L,
      undefined,
      sparse.rowInfo,
      1,
      {
        sparseRows: sparse.sparseRows,
        numParams: network.numParams,
        structuredWeights: sparse.structuredWeights!,
      },
    );
    const telemetry = snapshotStructuredWeightTelemetry();
    expect(telemetry.structuredFallbacks).toBe(1);
    expect(telemetry.denseMaterializations).toBe(1);
    const expected = accumulateNormalEquationsFromSparseRows(
      sparse.sparseRows,
      sparse.L,
      dense.P!,
      network.numParams,
    );
    expect(maxDiff(captured.normal!, expected.normal).maxAbs).toBe(0);
    expect(maxDiff(captured.rhs!, expected.rhs).maxAbs).toBe(0);
    // The materialized P is the dense P bit-identically (oracle-proven).
    expect(
      maxDiff(
        structuredWeightsToDense(sparse.structuredWeights!),
        dense.P!,
      ).maxAbs,
    ).toBe(0);
  });
});
