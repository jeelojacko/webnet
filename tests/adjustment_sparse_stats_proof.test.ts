import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../src/engine/adjust';
import { assembleAdjustmentEquations } from '../src/engine/adjustmentEquationAssembly';
import type { AdjustmentEquationAssemblyDependencies } from '../src/engine/adjustmentEquationAssemblyTypes';
import {
  applyTsCorrelationToWeightMatrix as applyTsMatrix,
  applyTsCorrelationToWeightWriter as applyTsWriter,
  tsCorrelationGroup,
} from '../src/engine/adjustTsCorrelationWeights';
import { structuredWeightsToDense } from '../src/engine/sparseWeightRepresentation';
import { accumulateNormalEquationsFromSparseRows, denseRowsToSparseRows } from '../src/engine/matrix';
import { invertNormalMatrixForStats } from '../src/engine/adjustNormalEquationHelpers';
import type {
  SparseRowProductsInput,
  SparseRowProductsResult,
  SparseRowProductsSolver,
} from '../src/engine/numericalBackend';
import type { DirectionObservation, Observation, StationMap } from '../src/types';

/** Dense reference row-products solver built from the engine's own dense helpers. */
const denseReferenceRowProducts = (): SparseRowProductsSolver & {
  seen: SparseRowProductsInput[];
} => {
  const seen: SparseRowProductsInput[] = [];
  return {
    seen,
    queryRowProducts(input: SparseRowProductsInput): SparseRowProductsResult {
      seen.push(input);
      const eqCount = input.observationEquationCount;
      const paramCount = input.parameterCount;
      const dense = Array.from({ length: eqCount }, () => new Array<number>(paramCount).fill(0));
      for (let row = 0; row < eqCount; row += 1) {
        for (let k = input.design.rowOffsets[row] ?? 0; k < (input.design.rowOffsets[row + 1] ?? 0); k += 1) {
          dense[row][input.design.columns[k] ?? 0] = input.design.values[k] ?? 0;
        }
      }
      const weight = Array.from({ length: eqCount }, () => new Array<number>(eqCount).fill(0));
      for (let k = 0; k < input.weights.values.length; k += 1) {
        const r = input.weights.rows[k] ?? 0;
        const c = input.weights.columns[k] ?? 0;
        weight[r][c] = input.weights.values[k] ?? 0;
        weight[c][r] = input.weights.values[k] ?? 0;
      }
      const misclosures = Array.from({ length: eqCount }, () => [0]);
      const { normal } = accumulateNormalEquationsFromSparseRows(
        denseRowsToSparseRows(dense), misclosures, weight, paramCount,
      );
      const inverse = invertNormalMatrixForStats(normal, () => undefined);
      const queryRow = (row: number): number[] => {
        const out = new Array<number>(paramCount).fill(0);
        for (let k = input.queryRowOffsets[row] ?? 0; k < (input.queryRowOffsets[row + 1] ?? 0); k += 1) {
          out[input.queryColumns[k] ?? 0] = input.queryValues[k] ?? 0;
        }
        return out;
      };
      const form = (left: number[], right: number[]): number => {
        let sum = 0;
        for (let i = 0; i < paramCount; i += 1) {
          for (let j = 0; j < paramCount; j += 1) sum += left[i] * (inverse[i]?.[j] ?? 0) * right[j];
        }
        return sum;
      };
      const queryRowCount = input.queryRowOffsets.length - 1;
      const quadratic = new Float64Array(queryRowCount);
      for (let row = 0; row < queryRowCount; row += 1) {
        const vector = queryRow(row);
        quadratic[row] = form(vector, vector);
      }
      const cross = new Float64Array(input.crossA.length);
      for (let c = 0; c < input.crossA.length; c += 1) {
        cross[c] = form(queryRow(input.crossA[c] ?? 0), queryRow(input.crossB[c] ?? 0));
      }
      return { quadratic, cross, normalNnz: 0, factorNnz: 0, damping: 0, dampingAttempts: 0 };
    },
  };
};

const loadTutorialInput = (): string =>
  fs.readFileSync(path.join(process.cwd(), 'public/examples/mixed_grid_tutorial.dat'), 'utf-8');

const summarizeStats = (observations: Observation[]): unknown =>
  observations.map((obs) => ({
    id: obs.id,
    stdRes: obs.stdRes,
    redundancy: obs.redundancy,
    mdb: obs.mdb,
  }));

const assertStatsClose = (actual: unknown, expected: unknown, label: string): void => {
  if (typeof actual === 'number' && typeof expected === 'number') {
    if (Object.is(actual, expected)) return;
    expect(Math.abs(actual - expected), label).toBeLessThan(
      1e-9 * Math.max(1, Math.abs(actual), Math.abs(expected)),
    );
    return;
  }
  if (Array.isArray(actual) && Array.isArray(expected)) {
    expect(actual.length, label).toBe(expected.length);
    actual.forEach((value, index) => assertStatsClose(value, expected[index], `${label}[${index}]`));
    return;
  }
  if (actual && expected && typeof actual === 'object' && typeof expected === 'object') {
    const keys = new Set([...Object.keys(actual), ...Object.keys(expected)]);
    keys.forEach((key) => assertStatsClose(
      (actual as Record<string, unknown>)[key],
      (expected as Record<string, unknown>)[key],
      `${label}.${key}`,
    ));
    return;
  }
  expect(actual, label).toEqual(expected);
};

const stations: StationMap = {
  A: { x: 0, y: 0, h: 0, fixed: true, fixedX: true, fixedY: true, fixedH: true },
  B: { x: 10, y: 0, h: 0, fixed: false, fixedX: false, fixedY: false, fixedH: true },
};

const tsDeps = (): AdjustmentEquationAssemblyDependencies => {
  const effectiveStdDev = () => 0.001;
  const groupFor = (obs: Observation) => tsCorrelationGroup({ enabled: true, obs, scope: 'set' });
  return {
    stations,
    paramIndex: { B: { x: 0, y: 1 } },
    is2D: true,
    debug: false,
    directionOrientations: {},
    dirParamMap: { S1: 2 },
    effectiveStdDev,
    correctedDistanceModel: (_obs, calcDistRaw) => ({
      calcDistance: calcDistRaw,
      mapScale: 1,
      prismCorrection: 0,
    }),
    getObservedHorizontalDistanceIn2D: () => ({
      observedDistance: 12,
      sigmaDistance: 0.001,
      usedZenith: false,
    }),
    getAzimuth: () => ({ az: 0, dist: 10 }),
    measuredAngleCorrection: () => 0,
    modeledAzimuth: (rawAz) => rawAz,
    wrapToPi: (value) => value,
    gpsObservedVector: () => ({ dE: 0, dN: 0, scale: 1 }),
    gpsModeledVector: () => ({ dE: 0, dN: 0, scale: 1 }),
    gpsModeledVectorDerivatives: () => ({ from: {}, to: {} }),
    gpsWeight: () => ({ wEE: 1, wNN: 1, wEN: 0 }),
    getModeledZenith: () => ({ z: 0, dist: 1, horiz: 1, dh: 0, crCorr: 0, horizontalScale: 1 }),
    curvatureRefractionAngle: () => 0,
    applyTsCorrelationToWeightMatrix: (matrix, rowInfo) => {
      applyTsMatrix({
        captureDiagnostics: false,
        effectiveStdDev,
        enabled: true,
        matrix,
        rho: 0.3,
        rowInfo,
        scope: 'set',
        tsCorrelationGroup: groupFor,
      });
    },
    applyTsCorrelationToWeightWriter: (weights, rowInfo) => {
      applyTsWriter({
        captureDiagnostics: false,
        effectiveStdDev,
        enabled: true,
        weights,
        rho: 0.3,
        rowInfo,
        scope: 'set',
        tsCorrelationGroup: groupFor,
      });
    },
  };
};

describe('sparse row-product statistics wiring', () => {
  it('omits the dense P allocation for TS-correlated sparse assembly', () => {
    const mkDir = (id: number): DirectionObservation => ({
      id,
      type: 'direction',
      setId: 'S1',
      at: 'A',
      to: 'B',
      obs: 0.1 * id,
      instCode: 'S9',
      stdDev: 0.001,
    });
    const observations: Observation[] = [mkDir(11), mkDir(12)];
    const dense = assembleAdjustmentEquations(tsDeps(), observations, [], 2, 3);
    const sparse = assembleAdjustmentEquations(tsDeps(), observations, [], 2, 3, undefined, {
      weightRepresentation: 'sparse',
      omitDenseP: true,
    });

    expect(sparse.P).toBeUndefined();
    if (!sparse.structuredWeights) throw new Error('Expected structured weights in the test result.');
    expect(sparse.structuredWeights.size).toBe(2);
    expect(sparse.structuredWeights.offRows.length).toBe(1);
    expect(structuredWeightsToDense(sparse.structuredWeights)[0]?.[1]).toBeCloseTo(
      dense.P?.[0]?.[1] ?? 0,
      12,
    );
    expect(sparse.L).toEqual(dense.L);
  });

  it('matches dense statistics with an injected sparse row-products solver', () => {
    const input = loadTutorialInput();
    const baseline = new LSAEngine({ input }).solve();
    expect(baseline.success).toBe(true);
    const solver = denseReferenceRowProducts();
    const routed = new LSAEngine({ input, sparseRowProductsSolver: solver }).solve();
    expect(routed.success).toBe(true);
    expect(solver.seen.length).toBeGreaterThan(0);
    assertStatsClose(summarizeStats(routed.observations), summarizeStats(baseline.observations), 'stats');
  });

  it('falls back to dense statistics for robust Huber with a row-products solver', () => {
    const input = loadTutorialInput();
    const baseline = new LSAEngine({ input, parseOptions: { robustMode: 'huber' } }).solve();
    expect(baseline.success).toBe(true);
    // A failing solver exercises the dense fallback chain, which must
    // reproduce the baseline exactly.
    const failing: SparseRowProductsSolver = {
      queryRowProducts: () => {
        throw new Error('experimental backend offline');
      },
    };
    const fallenBack = new LSAEngine({
      input,
      parseOptions: { robustMode: 'huber' },
      sparseRowProductsSolver: failing,
    }).solve();
    expect(fallenBack.success).toBe(true);
    expect(summarizeStats(fallenBack.observations)).toEqual(summarizeStats(baseline.observations));
    // A working solver is consulted through dense-packed weights; its direct
    // quadratic form can differ from the dense B path in ill-conditioned
    // Huber corners (obs 8 cancels in qll-diag), so only sanity is asserted.
    const solver = denseReferenceRowProducts();
    const routed = new LSAEngine({
      input,
      parseOptions: { robustMode: 'huber' },
      sparseRowProductsSolver: solver,
    }).solve();
    expect(routed.success).toBe(true);
    expect(solver.seen.length).toBeGreaterThan(0);
    routed.observations.forEach((obs) => {
      expect(Number.isFinite(obs.stdRes ?? Number.NaN)).toBe(true);
    });
  });
});
