/**
 * Phase 8A.6 test-only bridge: the Phase 8A worker bridge plus actual
 * sparse selected-covariance packed input/result capture.
 *
 * Loads the production browser worker module (`src/workers/adjustmentWorker.ts`)
 * inside a Node worker_threads worker and injects a worker-local sparse
 * runtime via the exported test-only provider seam (no protocol or
 * `RunSessionRequest` changes, no auto-route). The injected runtime uses
 * the REAL WASM sparse bundle (correction, row products, selected
 * covariance) with legacy-all-pairs selected covariance. The production
 * worker is unchanged: capture wrappers only observe.
 *
 * Per selected-covariance call the wrapper records compact sentinel
 * metrics (counts, damping, finite/min/max/mean of returned values, FNV
 * fingerprints of packed inputs) and a bounded copy of the packed query
 * lists. Full packed design/weight arrays are NOT shipped across threads;
 * only compact metrics cross the boundary. A bounded in-bridge C2-style
 * residual is intentionally NOT computed here (it would duplicate the
 * parent-side pure sentinel); the parent test rebuilds C1/C2/C3 from the
 * captured packed copies it holds directly.
 */
import { parentPort } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import {
  createExperimentalSparseRouteDiagnostics,
  type ExperimentalSparseRouteDiagnostics,
} from '../src/engine/experimentalSparseDiagnostics';
import type {
  SparseCorrectionSolveInput,
  SparseCorrectionSolveResult,
  SparseCorrectionSolver,
  SparseSelectedCovarianceInput,
  SparseSelectedCovarianceResult,
  SparseSelectedCovarianceSolver,
} from '../src/engine/numericalBackend';
import { measurePhase7b7DenseOracle } from '../src/engine/phase7b7DenseRebuild';
import {
  accumulatePackedNormal,
  buildDiagonalQueries,
  evaluateSentinelC1,
  evaluateSentinelC2,
  evaluateSentinelC3,
  probeSelectedCovariance,
  validateSentinelPhysical,
} from '../src/engine/phase8a6SparseCovarianceSentinel';
import { choleskyDecomposeWithDamping, invertSPDFromCholesky } from '../src/engine/matrixCholesky';
import {
  scaleNormalMatrix,
  unscaleNormalInverse,
} from '../src/engine/adjustNormalMatrixHelpers';
import { createExperimentalSparseNumericalBundle } from '../src/engine/wasm/experimentalSparseNumericalBundle';
import type { WebNetWasmFactory } from '../src/engine/wasm/wasmTypes';

type WorkerEvent = { data: unknown };

/** Session-level capture bound; exceeding it truncates fail-closed. */
const MAX_CAPTURED_SYSTEMS = 512;

/** Selected-covariance capture bound (calls, not queries). */
const MAX_CAPTURED_COVARIANCE_CALLS = 512;

interface CapturedSystem {
  design: SparseCorrectionSolveInput['design'];
  weights: SparseCorrectionSolveInput['weights'];
  misclosures: Float64Array;
  observationEquationCount: number;
  parameterCount: number;
  result: SparseCorrectionSolveResult | null;
  threw: boolean;
}

const copySystem = (input: SparseCorrectionSolveInput): Omit<CapturedSystem, 'result' | 'threw'> => ({
  design: {
    rowOffsets: Int32Array.from(input.design.rowOffsets),
    columns: Int32Array.from(input.design.columns),
    values: Float64Array.from(input.design.values),
  },
  weights: {
    rows: Int32Array.from(input.weights.rows),
    columns: Int32Array.from(input.weights.columns),
    values: Float64Array.from(input.weights.values),
  },
  misclosures: Float64Array.from(input.misclosures),
  observationEquationCount: input.observationEquationCount,
  parameterCount: input.parameterCount,
});

class LocalCaptureSolver implements SparseCorrectionSolver {
  readonly systems: CapturedSystem[] = [];

  truncated = false;

  constructor(private readonly _delegate: SparseCorrectionSolver) {}

  solveFromEquations(input: SparseCorrectionSolveInput): SparseCorrectionSolveResult {
    if (this.systems.length >= MAX_CAPTURED_SYSTEMS) {
      this.truncated = true;
      return this._delegate.solveFromEquations(input);
    }
    try {
      const result = this._delegate.solveFromEquations(input);
      this.systems.push({ ...copySystem(input), result, threw: false });
      return result;
    } catch (error) {
      this.systems.push({ ...copySystem(input), result: null, threw: true });
      throw error;
    }
  }
}

const fnv1a = (values: ArrayLike<number>): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < values.length; i += 1) {
    hash ^= Math.floor(Math.abs(values[i] ?? 0) * 1e9) & 0xffffffff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
};

export interface CovarianceCallMetrics {
  parameterCount: number;
  observationEquationCount: number;
  queryCount: number;
  designNnz: number;
  weightNnz: number;
  designFingerprint: number;
  weightFingerprint: number;
  queryFingerprint: number;
  damping: number | null;
  threw: boolean;
  allFinite: boolean;
  minValue: number | null;
  maxValue: number | null;
  meanValue: number | null;
  /** Bounded copy of packed query lists (full lists when small). */
  queryRows: number[];
  queryColumns: number[];
  queriesTruncated: boolean;
  /** C2-native: inverse residual judged on the NATIVE returned values. */
  c2MaxResidual: number | null;
  c2Pass: boolean | null;
  c2ColumnsChecked: number;
  c2Note: string;
}

/**
 * C2-native check at the capture site. The production query plan is the
 * selected plan (station+connected/requested entries), which rarely covers
 * a full covariance column — judging only production values would fail
 * closed almost everywhere. The bridge therefore issues one bounded
 * test-only verification query set (full all-pairs, n^2 <= 16384, only for
 * n <= 128) through the SAME raw native delegate. This adds no production
 * diagnostics (the engine decorator never sees it) and changes no
 * production result; it purely verifies that native-returned values
 * satisfy ||N q_j - e_j|| with N accumulated from the same packed inputs
 * the native solver consumed. The production returned values are
 * additionally judged where they cover complete columns; any
 * complete-column failure rejects.
 */
const checkNativeC2 = (
  input: SparseSelectedCovarianceInput,
  delegate: SparseSelectedCovarianceSolver,
  prodValues: Float64Array,
): { maxResidual: number | null; pass: boolean | null; columnsChecked: number; note: string } => {
  const n = input.parameterCount;
  if (!Number.isInteger(n) || n <= 0 || n > 128) {
    return {
      maxResidual: null,
      pass: null,
      columnsChecked: 0,
      note: `C2-native skipped: parameterCount ${n} outside 1..128 (fail-closed)`,
    };
  }
  let normal;
  try {
    normal = accumulatePackedNormal({
      design: input.design,
      weights: input.weights,
      observationEquationCount: input.observationEquationCount,
      parameterCount: n,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      maxResidual: null,
      pass: false,
      columnsChecked: 0,
      note: `C2-native normal accumulation threw fail-closed: ${detail}`.slice(0, 300),
    };
  }
  // Production returned values: judge complete columns where they exist.
  const prod = evaluateSentinelC2(normal, input.queryRows, input.queryColumns, prodValues);
  const prodNote =
    `prod queries=${input.queryRows.length} completeCols=${prod.perColumnResidual.length} pass=${prod.pass}`;
  if (prod.perColumnResidual.length > 0 && !prod.pass) {
    return {
      maxResidual: prod.maxResidual,
      pass: false,
      columnsChecked: prod.perColumnResidual.length,
      note: `C2-native REJECTED on production values: ${prod.reasons.join('; ').slice(0, 200)}`,
    };
  }
  // Verification values: full all-pairs through the same native solver.
  // This re-queries the native solver purely for verification; the fresh
  // native values never touch production state or diagnostics.
  try {
    const queryRows: number[] = [];
    const queryColumns: number[] = [];
    for (let row = 0; row < n; row += 1) {
      for (let column = 0; column < n; column += 1) {
        queryRows.push(row);
        queryColumns.push(column);
      }
    }
    const verification = delegate.querySelected({
      design: input.design,
      weights: input.weights,
      observationEquationCount: input.observationEquationCount,
      parameterCount: n,
      queryRows: Int32Array.from(queryRows),
      queryColumns: Int32Array.from(queryColumns),
    });
    const evaluated = evaluateSentinelC2(
      normal,
      Int32Array.from(queryRows),
      Int32Array.from(queryColumns),
      verification.covariance,
    );
    return {
      maxResidual: evaluated.maxResidual,
      pass: evaluated.pass,
      columnsChecked: evaluated.perColumnResidual.length,
      note: `verification all-pairs n^2=${n * n} checked=${evaluated.perColumnResidual.length} pass=${evaluated.pass}; ${prodNote}; ${evaluated.reasons.join('; ').slice(0, 160)}`,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      maxResidual: null,
      pass: false,
      columnsChecked: 0,
      note: `C2-native verification threw fail-closed: ${detail}; ${prodNote}`.slice(0, 300),
    };
  }
};

class LocalCaptureCovariance implements SparseSelectedCovarianceSolver {
  readonly calls: CovarianceCallMetrics[] = [];

  truncated = false;

  constructor(private readonly _delegate: SparseSelectedCovarianceSolver) {}

  querySelected(input: SparseSelectedCovarianceInput): SparseSelectedCovarianceResult {
    if (this.calls.length >= MAX_CAPTURED_COVARIANCE_CALLS) {
      this.truncated = true;
      return this._delegate.querySelected(input);
    }
    const queryCount = input.queryRows.length;
    const keepFull = queryCount <= 20000;
    const queryRows = keepFull ? Array.from(input.queryRows) : Array.from(input.queryRows.slice(0, 64));
    const queryColumns = keepFull ? Array.from(input.queryColumns) : Array.from(input.queryColumns.slice(0, 64));
    try {
      const result = this._delegate.querySelected(input);
      let allFinite = true;
      let minValue: number | null = null;
      let maxValue: number | null = null;
      let sum = 0;
      for (let k = 0; k < result.covariance.length; k += 1) {
        const value = result.covariance[k] ?? Number.NaN;
        if (!Number.isFinite(value)) {
          allFinite = false;
          continue;
        }
        minValue = minValue == null ? value : Math.min(minValue, value);
        maxValue = maxValue == null ? value : Math.max(maxValue, value);
        sum += value;
      }
      const c2 = checkNativeC2(input, this._delegate, result.covariance);
      this.calls.push({
        parameterCount: input.parameterCount,
        observationEquationCount: input.observationEquationCount,
        queryCount,
        designNnz: input.design.values.length,
        weightNnz: input.weights.values.length,
        designFingerprint: fnv1a(input.design.values),
        weightFingerprint: fnv1a(input.weights.values),
        queryFingerprint: fnv1a([...input.queryRows, ...input.queryColumns]),
        damping: result.damping,
        threw: false,
        allFinite,
        minValue,
        maxValue,
        meanValue: result.covariance.length > 0 ? sum / result.covariance.length : null,
        queryRows,
        queryColumns,
        queriesTruncated: !keepFull,
        c2MaxResidual: c2.maxResidual,
        c2Pass: c2.pass,
        c2ColumnsChecked: c2.columnsChecked,
        c2Note: c2.note,
      });
      return result;
    } catch (error) {
      this.calls.push({
        parameterCount: input.parameterCount,
        observationEquationCount: input.observationEquationCount,
        queryCount,
        designNnz: input.design.values.length,
        weightNnz: input.weights.values.length,
        designFingerprint: fnv1a(input.design.values),
        weightFingerprint: fnv1a(input.weights.values),
        queryFingerprint: fnv1a([...input.queryRows, ...input.queryColumns]),
        damping: null,
        threw: true,
        allFinite: false,
        minValue: null,
        maxValue: null,
        meanValue: null,
        queryRows,
        queryColumns,
        queriesTruncated: !keepFull,
        c2MaxResidual: null,
        c2Pass: null,
        c2ColumnsChecked: 0,
        c2Note: 'native call threw; no values to judge (fail-closed)',
      });
      throw error;
    }
  }
}

interface SentinelMetrics {
  parameterCount: number;
  observationEquationCount: number;
  damped: boolean;
  c1MaxRelativeDiff: number | null;
  c1Pass: boolean | null;
  c2MaxResidual: number | null;
  c2Pass: boolean | null;
  c2ColumnsChecked: number;
  c2Note: string;
  c3Pass: boolean | null;
  physicalValid: boolean | null;
  note: string;
}

/**
 * Pairs a captured correction system with its native covariance call by
 * index. Pairing is accepted only when the native call exists, did not
 * throw, and agrees on the parameter count; otherwise C2 stays unpaired
 * fail-closed (never silently matched).
 */
const pairNativeC2 = (
  system: CapturedSystem,
  call: CovarianceCallMetrics | undefined,
): { pass: boolean | null; maxResidual: number | null; reasons: string[]; columnsChecked: number; note: string } | null => {
  if (!call) {
    return {
      pass: null,
      maxResidual: null,
      reasons: ['no paired native covariance call (fail-closed)'],
      columnsChecked: 0,
      note: 'unpaired: no native call at this index',
    };
  }
  if (call.threw || call.parameterCount !== system.parameterCount) {
    return {
      pass: null,
      maxResidual: null,
      reasons: ['native call threw or parameter count disagrees (fail-closed)'],
      columnsChecked: 0,
      note: 'unpaired: threw or parameter mismatch',
    };
  }
  if (call.c2Pass == null) {
    return {
      pass: null,
      maxResidual: call.c2MaxResidual,
      reasons: [`native C2 unevaluated: ${call.c2Note}`],
      columnsChecked: call.c2ColumnsChecked,
      note: call.c2Note,
    };
  }
  return {
    pass: call.c2Pass,
    maxResidual: call.c2MaxResidual,
    reasons: call.c2Pass ? [] : [`native C2: ${call.c2Note}`],
    columnsChecked: call.c2ColumnsChecked,
    note: call.c2Note,
  };
};

/**
 * Compact per-system sentinel metrics from the ACTUAL captured packed
 * correction inputs plus the PAIRED native covariance call. C1 compares a
 * TS probe against a dense-reference inverse at the diagonal (packed-decode
 * consistency only — both sides are TS, so C1 cannot judge the native
 * solver). C2 is the independent check: the inverse residual judged on
 * NATIVE values — production returns where they cover complete columns,
 * plus a bounded test-only full all-pairs verification set through the
 * same native solver (production diagnostics untouched). C3 requires both. Systems pair with native calls by
 * index when counts and parameter counts agree; otherwise C2 is unpaired
 * fail-closed. Only compact numbers cross the thread boundary.
 */
const summarizeSentinel = (
  systems: CapturedSystem[],
  covCalls: CovarianceCallMetrics[],
): SentinelMetrics[] =>
  systems.map((system, index) => {
    const base = {
      parameterCount: system.parameterCount,
      observationEquationCount: system.observationEquationCount,
    };
    if (system.threw || system.result == null) {
      return {
        ...base,
        damped: false,
        c1MaxRelativeDiff: null,
        c1Pass: null,
        c2MaxResidual: null,
        c2Pass: null,
        c2ColumnsChecked: 0,
        c2Note: 'no captured result (fail-closed)',
        c3Pass: null,
        physicalValid: null,
        note: 'no captured result (fail-closed)',
      };
    }
    try {
      const packed = {
        design: system.design,
        weights: system.weights,
        observationEquationCount: system.observationEquationCount,
        parameterCount: system.parameterCount,
      };
      const normal = accumulatePackedNormal(packed);
      const { rows, columns } = buildDiagonalQueries(system.parameterCount);
      const probe = probeSelectedCovariance(normal, rows, columns);
      if (probe.damped) {
        return {
          ...base,
          damped: true,
          c1MaxRelativeDiff: null,
          c1Pass: false,
          c2MaxResidual: null,
          c2Pass: false,
          c2ColumnsChecked: 0,
          c2Note: 'sentinel factor damped (fail-closed)',
          c3Pass: false,
          physicalValid: false,
          note: 'sentinel factor damped (fail-closed)',
        };
      }
      const scaled = scaleNormalMatrix(normal);
      const factorization = choleskyDecomposeWithDamping(scaled.scaled);
      let c1: { pass: boolean; maxRelativeDiff: number } | null = null;
      if (factorization.damping === 0) {
        const denseInverse = unscaleNormalInverse(
          invertSPDFromCholesky(factorization.factor),
          scaled.scale,
        );
        const reference = Array.from(
          { length: rows.length },
          (_, k) => denseInverse[rows[k] ?? -1]?.[columns[k] ?? -1] ?? Number.NaN,
        );
        const evaluated = evaluateSentinelC1(probe.values, reference);
        c1 = { pass: evaluated.pass, maxRelativeDiff: evaluated.maxRelativeDiff };
      }
      const c2native = pairNativeC2(system, covCalls[index]);
      const c1result = c1 == null
        ? null
        : { pass: c1.pass, reasons: [], maxAbsoluteDiff: 0, maxRelativeDiff: c1.maxRelativeDiff };
      const c2result = c2native == null || c2native.pass == null
        ? null
        : {
          pass: c2native.pass,
          reasons: c2native.reasons,
          maxResidual: c2native.maxResidual ?? Number.POSITIVE_INFINITY,
          perColumnResidual: [],
        };
      // Unpaired/unevaluated native C2 fails C3 closed: a null c2result
      // carries the pairing reason so the hybrid cannot silently pass.
      const c3 = evaluateSentinelC3({
        c1: c1result,
        c2: c2result ?? {
          pass: false,
          reasons: c2native?.reasons ?? ['no native C2 (fail-closed)'],
          maxResidual: Number.POSITIVE_INFINITY,
          perColumnResidual: [],
        },
      });
      const physical = validateSentinelPhysical({
        queryRows: rows,
        queryColumns: columns,
        values: probe.values,
      });
      return {
        ...base,
        damped: false,
        c1MaxRelativeDiff: c1?.maxRelativeDiff ?? null,
        c1Pass: c1?.pass ?? null,
        c2MaxResidual: c2native?.maxResidual ?? null,
        c2Pass: c2native?.pass ?? null,
        c2ColumnsChecked: c2native?.columnsChecked ?? 0,
        c2Note: c2native?.note ?? 'unpaired',
        c3Pass: c3.pass,
        physicalValid: physical.valid,
        note: c1 == null ? 'dense oracle damped (fail-closed)' : 'diagonal C1 + native C2',
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return {
        ...base,
        damped: false,
        c1MaxRelativeDiff: null,
        c1Pass: false,
        c2MaxResidual: null,
        c2Pass: false,
        c2ColumnsChecked: 0,
        c2Note: `sentinel threw fail-closed: ${detail}`.slice(0, 200),
        c3Pass: false,
        physicalValid: false,
        note: `sentinel threw fail-closed: ${detail}`.slice(0, 200),
      };
    }
  });

interface OracleSummary {
  maxCorrectionDiff: number | null;
  damping: number | null;
  conditionEstimate: number | undefined;
  sparseConditionEstimate: number | undefined;
  parameterCount: number;
  observationEquationCount: number;
}

const summarizeSystems = (systems: CapturedSystem[]): OracleSummary[] =>
  systems.map((system) => {
    if (system.threw || system.result == null) {
      return {
        maxCorrectionDiff: null,
        damping: null,
        conditionEstimate: undefined,
        sparseConditionEstimate: undefined,
        parameterCount: system.parameterCount,
        observationEquationCount: system.observationEquationCount,
      };
    }
    const measured = measurePhase7b7DenseOracle(
      {
        design: system.design,
        weights: system.weights,
        misclosures: system.misclosures,
        observationEquationCount: system.observationEquationCount,
        parameterCount: system.parameterCount,
      },
      system.result.conditionEstimate,
    );
    let maxCorrectionDiff: number | null = null;
    if (measured.denseCorrection) {
      let worst = 0;
      let nonfinite = false;
      for (let param = 0; param < system.parameterCount; param += 1) {
        const sparse = system.result?.correction[param]?.[0] ?? Number.NaN;
        const diff = Math.abs((measured.denseCorrection[param] ?? Number.NaN) - sparse);
        if (!Number.isFinite(diff)) {
          nonfinite = true;
          break;
        }
        worst = Math.max(worst, diff);
      }
      maxCorrectionDiff = nonfinite ? Number.POSITIVE_INFINITY : worst;
    }
    return {
      maxCorrectionDiff,
      damping: system.result.damping,
      conditionEstimate: measured.conditionEstimate,
      sparseConditionEstimate: system.result.conditionEstimate,
      parameterCount: system.parameterCount,
      observationEquationCount: system.observationEquationCount,
    };
  });

const shim = Object.assign(Object.create(globalThis) as {
  postMessage: (_message: unknown) => void;
  onmessage: ((_event: WorkerEvent) => void) | null;
}, {
  postMessage: (message: unknown) => parentPort?.postMessage(message),
  onmessage: null,
});

(globalThis as Record<string, unknown>).self = shim;

const worker = await import('../src/workers/adjustmentWorker.ts');
const wasmModule = (await import(
  pathToFileURL(path.join(process.cwd(), 'cpp/build-wasm/webnet_core.js')).href,
)) as unknown as { default: WebNetWasmFactory };
const bundle = await createExperimentalSparseNumericalBundle(wasmModule.default);

let current: {
  diagnostics: ExperimentalSparseRouteDiagnostics;
  capture: LocalCaptureSolver;
  covariance: LocalCaptureCovariance;
} | null = null;

worker.setAdjustmentWorkerRuntimeProvider(() => {
  const diagnostics = createExperimentalSparseRouteDiagnostics();
  const capture = new LocalCaptureSolver(bundle.sparseCorrectionSolver);
  const covariance = new LocalCaptureCovariance(bundle.sparseSelectedCovarianceSolver);
  current = { diagnostics, capture, covariance };
  return {
    sparseCorrectionSolver: capture,
    sparseRowProductsSolver: bundle.sparseRowProductsSolver,
    sparseSelectedCovarianceSolver: covariance,
    experimentalSparseDiagnostics: diagnostics,
    experimentalSelectedCovarianceMode: true,
    experimentalSelectedCovarianceLegacyAllPairs: true,
  };
});

const snapshotDiagnostics = () => {
  const diagnostics = current?.diagnostics;
  const capture = current?.capture;
  const covariance = current?.covariance;
  return {
    sparseCorrectionCalls: diagnostics?.sparseCorrectionCalls ?? 0,
    sparseCorrectionFallbacks: diagnostics?.sparseCorrectionFallbacks ?? 0,
    rowProductsCalls: diagnostics?.rowProductsCalls ?? 0,
    rowProductsFallbacks: diagnostics?.rowProductsFallbacks ?? 0,
    selectedCovarianceCalls: diagnostics?.selectedCovarianceCalls ?? 0,
    selectedCovarianceFallbacks: diagnostics?.selectedCovarianceFallbacks ?? 0,
    bundleInitialized: true,
    capturedSystemCount: capture?.systems.length ?? 0,
    truncated: capture?.truncated ?? false,
    oracles: summarizeSystems(capture?.systems ?? []),
    sentinelMetrics: summarizeSentinel(capture?.systems ?? [], covariance?.calls ?? []),
    covarianceCalls: covariance?.calls ?? [],
    covarianceTruncated: covariance?.truncated ?? false,
  };
};

const rawPost = shim.postMessage;
shim.postMessage = (message: unknown) => {
  rawPost(message);
  const record = message as { type?: unknown; runId?: unknown };
  if (record?.type === 'success' && typeof record.runId === 'string') {
    parentPort?.postMessage({
      type: 'test-diagnostics',
      runId: record.runId,
      diagnostics: snapshotDiagnostics(),
    });
  }
};

parentPort?.on('message', (data: unknown) => {
  shim.onmessage?.({ data });
});
