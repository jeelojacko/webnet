/**
 * Phase 7B bounded evidence: full-ENU EU/NU fixtures, structured-P parity,
 * TS-vs-sparse parity, sparse-only scaling, raw-N condition parity, and
 * arbitrary-pair selected covariance parity.
 *
 * No production routing, tolerances, or baselines are touched. WASM-backed
 * cases skip gracefully when the build artifact is unavailable.
 */
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../src/engine/adjust';
import { accumulateNormalEquationsFromSparseRows, zeros } from '../src/engine/matrix';
import { invertNormalMatrixForStats } from '../src/engine/adjustNormalEquationHelpers';
import { compareSparseShadowResults } from '../src/engine/phase6SparseShadowCompare';
import {
  buildPhase7bEnuScalingInput,
  buildPhase7bEnuSmallInput,
} from '../src/engine/phase7bEnuFixtures';
import {
  PHASE7B_PRECISION_POLICY,
  describePhase7bCoverage,
} from '../src/engine/phase7bPrecisionPolicy';
import {
  classifyConditionWarning,
  estimateSparseNormalCondition,
} from '../src/engine/sparseNormalCondition';
import {
  packSparseDesignRows,
  packUpperTriangleWeights,
} from '../src/engine/sparseEquationPacking';
import {
  SymmetricWeightBuilder,
  structuredQuadraticForm,
  structuredWeightsToDense,
} from '../src/engine/sparseWeightRepresentation';
import { createExperimentalSparseRouteDiagnostics } from '../src/engine/experimentalSparseDiagnostics';
import {
  buildExperimentalSparseEngineOptions,
  createExperimentalSparseNumericalBundle,
} from '../src/engine/wasm/experimentalSparseNumericalBundle';
import { WasmSparseSelectedCovariance } from '../src/engine/wasm/wasmSparseCovariance';
import type { WebNetWasmFactory } from '../src/engine/wasm/wasmTypes';
import type { GpsObservation } from '../src/types';

const loadWasmFactory = async (): Promise<WebNetWasmFactory | null> => {
  try {
    const imported = (await import(
      pathToFileURL(`${process.cwd()}/cpp/build-wasm/webnet_core.js`).href
    )) as unknown as { default: WebNetWasmFactory };
    if (typeof imported.default !== 'function') return null;
    return imported.default;
  } catch {
    return null;
  }
};

const wasmFactory = await loadWasmFactory();

type EngineInternals = {
  observations: GpsObservation[];
  gpsCovariance: (_obs: GpsObservation) => {
    cEE: number;
    cNN: number;
    cEN: number;
    cUU: number;
    cEU?: number;
    cNU?: number;
  };
  gpsWeight: (_obs: GpsObservation) => {
    wEE: number;
    wNN: number;
    wEN: number;
    wUU?: number;
    wEU?: number;
    wNU?: number;
  };
};

const asInternals = (engine: LSAEngine): EngineInternals =>
  engine as unknown as EngineInternals;

describe('phase 7B full-ENU parser/weighting audit', () => {
  it('parses G0-G3 nonzero off-diagonals into gpsCovariance3d', () => {
    const engine = new LSAEngine({ input: buildPhase7bEnuSmallInput() });
    const result = engine.solve();
    expect(result.success).toBe(true);
    const gpsVectors = asInternals(engine).observations.filter((obs) => obs.type === 'gps');
    expect(gpsVectors).toHaveLength(3);
    for (const gps of gpsVectors) {
      expect(gps.gpsCovariance3d).toBeDefined();
      expect(Math.abs(gps.gpsCovariance3d?.cXY ?? 0)).toBeGreaterThan(0);
      expect(Math.abs(gps.gpsCovariance3d?.cXZ ?? 0)).toBeGreaterThan(0);
      expect(Math.abs(gps.gpsCovariance3d?.cYZ ?? 0)).toBeGreaterThan(0);
    }
  });

  it('propagates nonzero EN/EU/NU into solve covariance and inverse weights', () => {
    const engine = new LSAEngine({ input: buildPhase7bEnuSmallInput() });
    const result = engine.solve();
    expect(result.success).toBe(true);
    expect(result.converged).toBe(true);
    const internals = asInternals(engine);
    const gpsVectors = internals.observations.filter((obs) => obs.type === 'gps');
    for (const gps of gpsVectors) {
      const covariance = internals.gpsCovariance(gps);
      expect(Math.abs(covariance.cEN)).toBeGreaterThan(0);
      expect(Math.abs(covariance.cEU ?? 0)).toBeGreaterThan(0);
      expect(Math.abs(covariance.cNU ?? 0)).toBeGreaterThan(0);
      const weight = internals.gpsWeight(gps);
      expect(Math.abs(weight.wEN)).toBeGreaterThan(0);
      expect(Math.abs(weight.wEU ?? 0)).toBeGreaterThan(0);
      expect(Math.abs(weight.wNU ?? 0)).toBeGreaterThan(0);
      // Inverse proof: W * C is the 3x3 identity.
      const c = [
        [covariance.cEE, covariance.cEN, covariance.cEU ?? 0],
        [covariance.cEN, covariance.cNN, covariance.cNU ?? 0],
        [covariance.cEU ?? 0, covariance.cNU ?? 0, covariance.cUU],
      ];
      const w = [
        [weight.wEE, weight.wEN, weight.wEU ?? 0],
        [weight.wEN, weight.wNN, weight.wNU ?? 0],
        [weight.wEU ?? 0, weight.wNU ?? 0, weight.wUU ?? 0],
      ];
      for (let i = 0; i < 3; i += 1) {
        for (let j = 0; j < 3; j += 1) {
          let sum = 0;
          for (let k = 0; k < 3; k += 1) sum += (w[i]?.[k] ?? 0) * (c[k]?.[j] ?? 0);
          expect(Math.abs(sum - (i === j ? 1 : 0))).toBeLessThan(1e-9);
        }
      }
    }
  });

  it('matches dense-vs-structured weight quadratics on a full ENU block', () => {
    const engine = new LSAEngine({ input: buildPhase7bEnuSmallInput() });
    expect(engine.solve().success).toBe(true);
    const internals = asInternals(engine);
    const gps = internals.observations.find((obs) => obs.type === 'gps') as GpsObservation;
    const weight = internals.gpsWeight(gps);
    const dense = [
      [weight.wEE, weight.wEN, weight.wEU ?? 0],
      [weight.wEN, weight.wNN, weight.wNU ?? 0],
      [weight.wEU ?? 0, weight.wNU ?? 0, weight.wUU ?? 0],
    ];
    const builder = new SymmetricWeightBuilder(3);
    dense.forEach((row, i) => row.forEach((value, j) => builder.set(i, j, value)));
    const structured = builder.finalize();
    expect(structuredWeightsToDense(structured)).toEqual(dense);
    const vector = [[0.5], [-0.25], [0.125]];
    let denseQuadratic = 0;
    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3; j += 1) {
        denseQuadratic += (vector[i]?.[0] ?? 0) * (dense[i]?.[j] ?? 0) * (vector[j]?.[0] ?? 0);
      }
    }
    const structuredValue = structuredQuadraticForm(structured, vector);
    const tolerance =
      PHASE7B_PRECISION_POLICY.weightQuadraticRelativeTolerance * Math.max(1, Math.abs(denseQuadratic));
    expect(Math.abs(structuredValue - denseQuadratic)).toBeLessThanOrEqual(tolerance);
  });
});

describe('phase 7B raw-N condition parity (dense N reference)', () => {
  it('matches the dense rowMax*colMax estimate on a packed system', () => {
    const rows = [
      [{ index: 0, value: 1 }, { index: 1, value: 0.5 }],
      [{ index: 1, value: 2 }, { index: 2, value: -0.25 }],
      [{ index: 0, value: 0.75 }, { index: 2, value: 1.5 }],
    ];
    const denseP = [
      [2, 0.5, 0],
      [0.5, 3, -0.25],
      [0, -0.25, 1.5],
    ];
    const { normal } = accumulateNormalEquationsFromSparseRows(rows, zeros(3, 1), denseP, 3);
    let rowMax = 0;
    let columnMax = 0;
    for (let i = 0; i < 3; i += 1) {
      let rowSum = 0;
      let columnSum = 0;
      for (let j = 0; j < 3; j += 1) {
        rowSum += Math.abs(normal[i]?.[j] ?? 0);
        columnSum += Math.abs(normal[j]?.[i] ?? 0);
      }
      rowMax = Math.max(rowMax, rowSum);
      columnMax = Math.max(columnMax, columnSum);
    }
    const sparse = estimateSparseNormalCondition(
      packSparseDesignRows(rows),
      packUpperTriangleWeights(denseP, 3),
      3,
    );
    const expected = rowMax * columnMax;
    const tolerance =
      PHASE7B_PRECISION_POLICY.conditionRelativeTolerance * Math.max(1, Math.abs(expected));
    expect(Math.abs(sparse - expected)).toBeLessThanOrEqual(tolerance);
  });

  it('classifies warnings with production threshold semantics and wording', () => {
    expect(classifyConditionWarning(1e9)).toEqual({ flagged: false, message: null });
    const flagged = classifyConditionWarning(2.5e12);
    expect(flagged.flagged).toBe(true);
    expect(flagged.message).toBe(
      'Warning: normal matrix appears ill-conditioned (estimate=2.500e+12, threshold=1.000e+12).',
    );
    expect(classifyConditionWarning(1e12).flagged).toBe(false);
  });

  it('rejects inconsistent packing fail-closed', () => {
    const design = packSparseDesignRows([[{ index: 0, value: 1 }]]);
    expect(() =>
      estimateSparseNormalCondition(design, packUpperTriangleWeights([[1]], 1), 0),
    ).not.toThrow();
    expect(() =>
      estimateSparseNormalCondition(
        { rowOffsets: new Int32Array([0, 1]), columns: new Int32Array([5]), values: new Float64Array([1]) },
        packUpperTriangleWeights([[1]], 1),
        2,
      ),
    ).toThrow();
  });

  it('exposes the internal precision policy and coverage metadata', () => {
    expect(PHASE7B_PRECISION_POLICY.shadowToleranceM).toBe(1e-6);
    expect(PHASE7B_PRECISION_POLICY.conditionThreshold).toBe(1e12);
    const coverage = describePhase7bCoverage();
    expect(coverage.fixtureKinds).toContain('full-enu-small-grid');
    expect(coverage.deferred.length).toBeGreaterThan(0);
  });
});

describe.runIf(wasmFactory != null)('phase 7B TS-vs-sparse full-ENU parity', () => {
  it('matches the TS reference on the small full-ENU fixture with zero fallbacks', async () => {
    const input = buildPhase7bEnuSmallInput();
    const reference = new LSAEngine({ input }).solve();
    expect(reference.success).toBe(true);
    expect(reference.converged).toBe(true);
    const bundle = await createExperimentalSparseNumericalBundle(wasmFactory!);
    const diagnostics = createExperimentalSparseRouteDiagnostics();
    const candidate = new LSAEngine({
      input,
      ...buildExperimentalSparseEngineOptions(bundle, diagnostics, true),
    }).solve();
    const comparison = compareSparseShadowResults(
      reference,
      candidate,
      PHASE7B_PRECISION_POLICY.shadowToleranceM,
    );
    expect(comparison.pass).toBe(true);
    expect(comparison.passReasons).toEqual([]);
    expect(
      diagnostics.sparseCorrectionFallbacks +
        diagnostics.rowProductsFallbacks +
        diagnostics.selectedCovarianceFallbacks,
    ).toBe(0);
    // Raw-N condition metadata: first correction iteration only.
    expect(diagnostics.sparseConditionEstimates).toHaveLength(1);
    const sparseEstimate = diagnostics.sparseConditionEstimates[0] as number;
    const denseEstimate = reference.condition?.estimate;
    expect(denseEstimate).toBeDefined();
    if (denseEstimate != null) {
      const tolerance =
        PHASE7B_PRECISION_POLICY.conditionRelativeTolerance * Math.max(1, Math.abs(denseEstimate));
      expect(Math.abs(sparseEstimate - denseEstimate)).toBeLessThanOrEqual(tolerance);
      expect(classifyConditionWarning(sparseEstimate).flagged).toBe(
        (denseEstimate ?? 0) > PHASE7B_PRECISION_POLICY.conditionThreshold,
      );
    }
  });

  it('runs the sparse-only scaling chain with zero fallbacks and repeat determinism', async () => {
    const input = buildPhase7bEnuScalingInput({ unknownCount: 8 });
    const bundle = await createExperimentalSparseNumericalBundle(wasmFactory!);
    const runOnce = () => {
      const diagnostics = createExperimentalSparseRouteDiagnostics();
      const result = new LSAEngine({
        input,
        ...buildExperimentalSparseEngineOptions(bundle, diagnostics, true),
      }).solve();
      return { result, diagnostics };
    };
    const first = runOnce();
    expect(first.result.success).toBe(true);
    expect(first.result.converged).toBe(true);
    expect(
      first.diagnostics.sparseCorrectionFallbacks +
        first.diagnostics.rowProductsFallbacks +
        first.diagnostics.selectedCovarianceFallbacks,
    ).toBe(0);
    expect(first.diagnostics.sparseConditionEstimates).toHaveLength(1);
    const second = runOnce();
    for (const id of Object.keys(first.result.stations)) {
      const a = first.result.stations[id];
      const b = second.result.stations[id];
      expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(PHASE7B_PRECISION_POLICY.repeatToleranceM);
      expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(PHASE7B_PRECISION_POLICY.repeatToleranceM);
      expect(Math.abs((a.h ?? 0) - (b.h ?? 0))).toBeLessThanOrEqual(
        PHASE7B_PRECISION_POLICY.repeatToleranceM,
      );
    }
  });

  it('matches dense Qxx on arbitrary selected pairs through the existing sparse API', async () => {
    const module = await wasmFactory!();
    const solver = new WasmSparseSelectedCovariance(module);
    const rows = [
      [{ index: 0, value: 1 }, { index: 1, value: 0.5 }],
      [{ index: 1, value: 2 }, { index: 2, value: -0.25 }],
      [{ index: 0, value: 0.75 }, { index: 2, value: 1.5 }],
      [{ index: 0, value: 0.5 }, { index: 1, value: -1 }, { index: 2, value: 0.5 }],
    ];
    const denseP = [
      [2, 0.5, 0, 0],
      [0.5, 3, -0.25, 0],
      [0, -0.25, 1.5, 0.1],
      [0, 0, 0.1, 1],
    ];
    const design = packSparseDesignRows(rows);
    const weights = packUpperTriangleWeights(denseP, 4);
    // Arbitrary pairs: diagonal, symmetric off-diagonal, and reversed order.
    const queryRows = new Int32Array([0, 0, 2, 2, 1]);
    const queryColumns = new Int32Array([0, 2, 0, 2, 0]);
    const sparseResult = solver.querySelected({
      design,
      weights,
      observationEquationCount: 4,
      parameterCount: 3,
      queryRows,
      queryColumns,
    });
    expect(sparseResult.damping).toBe(0);
    const { normal } = accumulateNormalEquationsFromSparseRows(rows, zeros(4, 1), denseP, 3);
    const inverse = invertNormalMatrixForStats(normal, () => undefined);
    for (let k = 0; k < queryRows.length; k += 1) {
      const expected = inverse[queryRows[k] as number]?.[queryColumns[k] as number] ?? 0;
      const actual = sparseResult.covariance[k] ?? 0;
      expect(Math.abs(actual - expected)).toBeLessThan(1e-9 * Math.max(1, Math.abs(expected)));
    }
  });
});
