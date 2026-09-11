/**
 * Phase 10I worker-only native full-Qxx auto-route (fail-closed).
 *
 * Routes ordinary single-solve 3D adjustment jobs with at most 384
 * parameters through the real WASM sparse bundle for FINAL COVARIANCE
 * ONLY (all-entry dense Qxx reconstruction, existing precision/report
 * contract preserved). Correction stays TypeScript; no row-products
 * solver, no selected-covariance store, no selected mode.
 *
 * Verified provenance: the route injects ONLY the selected-covariance
 * solver (dense all-entry mode) plus `allowVerifiedNativeDenseQxxReuse`,
 * so Phase 10E statistics reuse can consume the native-derived dense Qxx.
 * Every captured packed system is verified against the ACTUAL native
 * values before accept: dimension/finite/damping metadata gates, dense
 * all-entry query-coverage proof, C1 sampled-column agreement against an
 * independent TS oracle (bounded columns, no full inverse), C2 inverse
 * residuals judged on the captured native values, and C3 physical
 * validation over the full native set (reused production sentinel math).
 * Outcome parity alone never accepts a native result. Any kill-switch-off,
 * ineligibility, WASM init failure, sparse throw, covariance fallback,
 * verification reject, non-converged/non-finite result, or extra-solve
 * session shape reruns the original request in clean TypeScript.
 *
 * 2D and preanalysis sessions are never eligible (preserved for the
 * Phase 7C / preanalysis routes). No C++ or tolerance changes.
 */
import { buildSolvePreparation, collectActiveObservationsForSolve } from '../engine/adjustmentPreprocessing';
import type { AdjustmentRuntime } from '../engine/adjustmentRuntime';
import { extractAutoAdjustDirectiveFromInput } from '../engine/autoAdjust';
import { createExperimentalSparseRouteDiagnostics } from '../engine/experimentalSparseDiagnostics';
import type {
  SparseSelectedCovarianceInput,
  SparseSelectedCovarianceResult,
  SparseSelectedCovarianceSolver,
} from '../engine/numericalBackend';
import { parseInput } from '../engine/parseInputCore';
import { evaluateSparseGeometryPreflight } from '../engine/sparseGeometryPreflight';
import {
  accumulatePackedNormal,
  buildBoundedVerificationQueries,
  evaluateSentinelC1,
  evaluateSentinelC2,
  probeSelectedCovariance,
  validateSentinelPhysical,
} from '../engine/preanalysisSparseCovarianceSentinel';
import type { AdjustmentResult } from '../typesAdjustmentResult';
import type {
  RunSessionOutcome,
  RunSessionProgressCallback,
  RunSessionRequest,
} from '../engine/runSessionTypes';
import {
  loadSparseAutoRouteBundle,
  type SparseAutoRouteBundle,
} from './adjustmentSparseAutoRoute';

/** Conservative 3D coordinate-only parameter cap (Phase 10H corpus max). */
export const NATIVE_FULL_QXX_MAX_PARAMS = 384;

/**
 * Internal kill switch, DISABLED by default. The route is proven safe and
 * parity-exact by Phase 10I evidence, but measured ~2x slower than dense TS
 * (TS-side C1/C2/C3 verification dominates); enable only explicitly until
 * verification cost is addressed. No persisted or UI fields.
 */
let nativeFullQxxEnabled = false;

/** Disables or re-enables the native full-Qxx route (internal/test-only). */
export const setNativeFullQxxRouteEnabled = (enabled: boolean): void => {
  nativeFullQxxEnabled = enabled;
};

/** Reports current kill-switch state (default disabled pending performance proof). */
export const isNativeFullQxxRouteEnabled = (): boolean => nativeFullQxxEnabled;

export interface NativeFullQxxEligibility {
  eligible: boolean;
  reasons: string[];
  numParams: number | null;
}

/**
 * Fail-closed eligibility in fixed gate order. Single-solve 3D
 * adjustment only; 2D/preanalysis/robust/multi-solve shapes stay on
 * their existing routes.
 */
export const deriveNativeFullQxxEligibility = (
  request: RunSessionRequest,
): NativeFullQxxEligibility => {
  const reasons: string[] = [];
  if (!nativeFullQxxEnabled) {
    reasons.push('native full-Qxx route disabled by kill switch');
    return { eligible: false, reasons, numParams: null };
  }
  const parse = request.parseSettings;
  if (parse.runMode !== 'adjustment') {
    reasons.push(`unsupported runMode '${parse.runMode}': native full-Qxx requires 'adjustment'`);
  }
  if (parse.preanalysisMode) {
    reasons.push('preanalysis mode not cleared for native full-Qxx');
  }
  if (parse.coordMode !== '3D') {
    reasons.push(`dimension '${parse.coordMode}' not cleared for native full-Qxx (2D preserved)`);
  }
  if (parse.robustMode !== 'none') {
    reasons.push('robust reweighting not cleared for native full-Qxx');
  }
  if (parse.tsCorrelationEnabled) {
    reasons.push('TS correlation not yet admitted for native full-Qxx');
  }
  if (parse.suspectImpactMode !== 'off') {
    reasons.push(
      `suspect-impact mode '${parse.suspectImpactMode}' not cleared for native full-Qxx (single-solve sessions only)`,
    );
  }
  if (parse.autoAdjustEnabled) {
    reasons.push('auto-adjust not cleared for native full-Qxx (single-solve sessions only)');
  }
  if (parse.clusterDetectionEnabled && request.approvedClusterMerges.length > 0) {
    reasons.push(
      `cluster dual-pass (${request.approvedClusterMerges.length} approved merges) not cleared for native full-Qxx (single-solve sessions only)`,
    );
  }
  if (reasons.length > 0) return { eligible: false, reasons, numParams: null };
  try {
    const inlineAutoAdjust = extractAutoAdjustDirectiveFromInput(request.input);
    if (inlineAutoAdjust?.enabled) {
      reasons.push(
        'inline auto-adjust directive not cleared for native full-Qxx (single-solve sessions only)',
      );
    }
    const parsed = parseInput(request.input);
    const is2D = false;
    const active = collectActiveObservationsForSolve(parsed.observations, undefined, is2D);
    const preparation = buildSolvePreparation(parsed.stations, parsed.unknowns, active, is2D);
    if (active.some((observation) => observation.type === 'gps' && observation.gpsCovariance3d != null)) {
      reasons.push('3D GPS covariance weighting not yet admitted for native full-Qxx');
    }
    if (preparation.directionSetIds.length > 0) {
      reasons.push('orientation parameters not yet admitted for native full-Qxx');
    }
    const { numParams } = preparation;
    if (!Number.isFinite(numParams) || numParams <= 0) {
      reasons.push('unmeasurable parameter count (fail-closed)');
      return { eligible: false, reasons, numParams: null };
    }
    if (numParams > NATIVE_FULL_QXX_MAX_PARAMS) {
      reasons.push(
        `parameter count ${numParams} exceeds native full-Qxx cap ${NATIVE_FULL_QXX_MAX_PARAMS} (fail-closed)`,
      );
    }
    const preflight = evaluateSparseGeometryPreflight({
      stations: parsed.stations,
      observations: parsed.observations,
      unknowns: parsed.unknowns,
      is2D,
      numParams: preparation.numParams,
      numObsEquations: preparation.numObsEquations,
      directionSetIds: preparation.directionSetIds,
    });
    for (const reason of preflight.reasons) reasons.push(`preflight: ${reason}`);
    // NOTE: evaluateSparseProductionEligibility is a Phase 7C 2D-only
    // classifier (rejects dimension !== '2d' by design); the 3D route
    // relies on the geometry preflight plus the gates above instead.
    return { eligible: reasons.length === 0, reasons, numParams };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    reasons.push(`eligibility parse failed: ${detail}`.slice(0, 300));
    return { eligible: false, reasons, numParams: null };
  }
};

const isFiniteNativeResult = (result: AdjustmentResult): boolean => {
  if (!Number.isFinite(result.seuw)) return false;
  for (const station of Object.values(result.stations)) {
    if (!Number.isFinite(station.x) || !Number.isFinite(station.y)) return false;
    if (station.h != null && !Number.isFinite(station.h)) return false;
  }
  return true;
};

/**
 * Session-level capture bound. Final covariance runs once per solve, but
 * a session may run several solves; exceeding the bound rejects
 * fail-closed so verification can never silently claim full coverage.
 */
export const NATIVE_FULL_QXX_MAX_CAPTURED_SYSTEMS = 64;

export interface CapturedNativeFullQxxSystem {
  design: {
    rowOffsets: Int32Array;
    columns: Int32Array;
    values: Float64Array;
  };
  weights: {
    rows: Int32Array;
    columns: Int32Array;
    values: Float64Array;
  };
  observationEquationCount: number;
  parameterCount: number;
  queryRows: Int32Array;
  queryColumns: Int32Array;
  result: SparseSelectedCovarianceResult;
}

/**
 * Recording decorator over the bundle covariance solver. Captures every
 * packed system the native backend sees, bounded so verification can
 * never silently claim coverage it did not check. Verifies each system
 * INLINE before its Qxx reaches the engine, so rejected values never flow
 * into downstream numerics: a reject throws, the engine takes its dense
 * fallback, and the route then fails closed to a clean TypeScript rerun.
 */
export class NativeFullQxxCaptureSolver implements SparseSelectedCovarianceSolver {
  readonly systems: CapturedNativeFullQxxSystem[] = [];

  truncated = false;

  private readonly delegate: SparseSelectedCovarianceSolver;

  constructor(delegate: SparseSelectedCovarianceSolver) {
    this.delegate = delegate;
  }

  querySelected(input: SparseSelectedCovarianceInput): SparseSelectedCovarianceResult {
    if (this.systems.length >= NATIVE_FULL_QXX_MAX_CAPTURED_SYSTEMS) {
      this.truncated = true;
      return this.delegate.querySelected(input);
    }
    const result = this.delegate.querySelected(input);
    const captured: CapturedNativeFullQxxSystem = {
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
      observationEquationCount: input.observationEquationCount,
      parameterCount: input.parameterCount,
      queryRows: Int32Array.from(input.queryRows),
      queryColumns: Int32Array.from(input.queryColumns),
      result: {
        ...result,
        covariance: Float64Array.from(result.covariance),
      },
    };
    this.systems.push(captured);
    // Verification happens before returning Qxx to the engine. This makes
    // verified provenance true when statistics reuse runs, rather than
    // accepting first and checking after downstream numerics already used it.
    const verification = verifyNativeFullQxxSystems([captured], false, input.parameterCount);
    if (!verification.accepted) {
      throw new Error(`native full-Qxx verification rejected: ${verification.reasons.join('; ')}`);
    }
    return result;
  }
}

export interface NativeFullQxxVerification {
  accepted: boolean;
  reasons: string[];
  oracledSystemCount: number;
  maxC1Diff: number;
  maxC2Residual: number;
  verifiedColumns: number[];
}

/**
 * Per-captured-system verification over the ACTUAL native values:
 * dimension/finite/damping metadata gates, dense all-entry query-coverage
 * proof, C1 sampled-column agreement against an independent TS oracle
 * (bounded columns, no full inverse), C2 inverse residuals judged on the
 * captured native values, and C3 physical validation over the full
 * native set. Any failure rejects fail-closed: outcome parity alone
 * never accepts a native result.
 */
export const verifyNativeFullQxxSystems = (
  systems: readonly CapturedNativeFullQxxSystem[],
  truncated: boolean,
  expectedNumParams: number | null,
): NativeFullQxxVerification => {
  const reasons: string[] = [];
  let oracledSystemCount = 0;
  let maxC1Diff = 0;
  let maxC2Residual = 0;
  let verifiedColumns: number[] = [];
  if (truncated) {
    reasons.push(
      `oracle bound: capture truncated at ${NATIVE_FULL_QXX_MAX_CAPTURED_SYSTEMS} systems (fail-closed; coverage unproven)`,
    );
  }
  if (systems.length === 0) {
    reasons.push('verification: no native covariance systems captured (fail-closed)');
    return { accepted: false, reasons, oracledSystemCount, maxC1Diff, maxC2Residual, verifiedColumns };
  }
  systems.forEach((system, index) => {
    const tag = `system ${index + 1}`;
    oracledSystemCount += 1;
    const n = system.parameterCount;
    if (!Number.isInteger(n) || n <= 0 || n > NATIVE_FULL_QXX_MAX_PARAMS) {
      reasons.push(`${tag}: parameter count ${n} outside 1..${NATIVE_FULL_QXX_MAX_PARAMS} (fail-closed)`);
      return;
    }
    if (expectedNumParams != null && n !== expectedNumParams) {
      reasons.push(
        `${tag}: parameter count ${n} != eligible ${expectedNumParams} (dimension/provenance mismatch; fail-closed)`,
      );
      return;
    }
    if (!Number.isInteger(system.observationEquationCount) || system.observationEquationCount <= 0) {
      reasons.push(`${tag}: bad observation equation count (fail-closed)`);
      return;
    }
    // Dense all-entry coverage proof: the full-Qxx contract requires
    // every n^2 entry, never a selected subset.
    if (system.queryRows.length !== n * n || system.queryColumns.length !== n * n) {
      reasons.push(
        `${tag}: query coverage ${system.queryRows.length}/${system.queryColumns.length} != ${n * n} all-entry (fail-closed)`,
      );
      return;
    }
    if (system.result.covariance.length !== n * n) {
      reasons.push(
        `${tag}: native covariance length ${system.result.covariance.length} != ${n * n} (dimension mismatch; fail-closed)`,
      );
      return;
    }
    const { damping, dampingAttempts } = system.result;
    if (!system.result.timings || Object.values(system.result.timings).some((value) => !Number.isFinite(value) || value < 0)) {
      reasons.push(`${tag}: native phase timing metadata missing or invalid (fail-closed)`);
      return;
    }
    if (!Number.isFinite(damping) || damping !== 0) {
      reasons.push(`${tag}: damping=${damping} (undamped required; fail-closed)`);
      return;
    }
    if (!Number.isFinite(dampingAttempts)) {
      reasons.push(`${tag}: non-finite damping attempts (fail-closed)`);
      return;
    }
    const native = Array.from(system.result.covariance);
    for (let k = 0; k < native.length; k += 1) {
      if (!Number.isFinite(native[k])) {
        reasons.push(`${tag}: native covariance entry ${k} non-finite (fail-closed)`);
        return;
      }
    }
    let normal;
    try {
      normal = accumulatePackedNormal(
        {
          design: system.design,
          weights: system.weights,
          observationEquationCount: system.observationEquationCount,
          parameterCount: n,
        },
        NATIVE_FULL_QXX_MAX_PARAMS,
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      reasons.push(`${tag}: packed normal rebuild failed: ${detail}`.slice(0, 300));
      return;
    }
    let bounded;
    try {
      bounded = buildBoundedVerificationQueries(n, undefined, NATIVE_FULL_QXX_MAX_PARAMS);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      reasons.push(`${tag}: verification query build failed: ${detail}`.slice(0, 300));
      return;
    }
    const oracle = probeSelectedCovariance(normal, bounded.rows, bounded.columns, NATIVE_FULL_QXX_MAX_PARAMS);
    if (oracle.damped) {
      reasons.push(`${tag}: TS oracle factor damped (degenerate; fail-closed)`);
      return;
    }
    // Index native values by (row, column) through the captured query
    // order instead of assuming row-major layout.
    const nativeByKey = new Map<number, number>();
    for (let k = 0; k < system.queryRows.length; k += 1) {
      nativeByKey.set((system.queryRows[k] ?? -1) * n + (system.queryColumns[k] ?? -1), native[k] ?? Number.NaN);
    }
    const nativeSample = Array.from(bounded.rows, (row, k) => {
      const column = bounded.columns[k] ?? -1;
      return nativeByKey.get((row ?? -1) * n + column) ?? Number.NaN;
    });
    const c1 = evaluateSentinelC1(nativeSample, oracle.values);
    maxC1Diff = Math.max(maxC1Diff, c1.maxAbsoluteDiff);
    if (!c1.pass) {
      for (const reason of c1.reasons) reasons.push(`${tag} C1: ${reason}`);
    }
    const c2 = evaluateSentinelC2(normal, bounded.rows, bounded.columns, nativeSample, undefined, NATIVE_FULL_QXX_MAX_PARAMS);
    if (Number.isFinite(c2.maxResidual)) maxC2Residual = Math.max(maxC2Residual, c2.maxResidual);
    else maxC2Residual = Number.POSITIVE_INFINITY;
    if (!c2.pass) {
      for (const reason of c2.reasons) reasons.push(`${tag} C2: ${reason}`);
    }
    const physical = validateSentinelPhysical({
      queryRows: system.queryRows,
      queryColumns: system.queryColumns,
      values: native,
    });
    if (!physical.valid) {
      for (const reason of physical.reasons) reasons.push(`${tag} C3-physical: ${reason}`);
    }
    if (verifiedColumns.length === 0) verifiedColumns = bounded.verifiedColumns;
  });
  return {
    accepted: reasons.length === 0,
    reasons,
    oracledSystemCount,
    maxC1Diff,
    maxC2Residual,
    verifiedColumns,
  };
};

export type NativeFullQxxSessionFn = (
  _request: RunSessionRequest,
  _onProgress?: RunSessionProgressCallback,
  _runtime?: AdjustmentRuntime,
) => RunSessionOutcome;

export interface NativeFullQxxDeps {
  runSession: NativeFullQxxSessionFn;
  loadBundle?: () => Promise<SparseAutoRouteBundle>;
}

export type NativeFullQxxRouteName = 'typescript' | 'native-full-qxx';

export interface NativeFullQxxAttempt {
  outcome: RunSessionOutcome;
  route: NativeFullQxxRouteName;
  reasons: string[];
  /** C1/C2/C3 verification over captured native systems; present on the native path only. */
  verification?: NativeFullQxxVerification;
}

/**
 * Runs the request through the native full-Qxx route when eligible, else
 * plain TypeScript. Any failure reruns the original request with no
 * runtime, so the returned outcome is always a clean session result.
 */
export const runWithNativeFullQxxAutoRoute = async (
  request: RunSessionRequest,
  onProgress: RunSessionProgressCallback | undefined,
  deps: NativeFullQxxDeps,
): Promise<NativeFullQxxAttempt> => {
  const eligibility = deriveNativeFullQxxEligibility(request);
  if (!eligibility.eligible) {
    return {
      outcome: deps.runSession(request, onProgress, undefined),
      route: 'typescript',
      reasons: eligibility.reasons,
    };
  }
  let bundle: SparseAutoRouteBundle;
  try {
    bundle = await (deps.loadBundle ?? loadSparseAutoRouteBundle)();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      outcome: deps.runSession(request, onProgress, undefined),
      route: 'typescript',
      reasons: [`WASM bundle init failed: ${detail}`.slice(0, 300)],
    };
  }
  const diagnostics = createExperimentalSparseRouteDiagnostics();
  const capture = new NativeFullQxxCaptureSolver(bundle.sparseSelectedCovarianceSolver);
  const runtime: AdjustmentRuntime = {
    sparseSelectedCovarianceSolver: capture,
    experimentalSparseDiagnostics: diagnostics,
    experimentalSelectedCovarianceMode: false,
    allowVerifiedNativeDenseQxxReuse: true,
  };
  let outcome: RunSessionOutcome;
  try {
    outcome = deps.runSession(request, onProgress, runtime);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      outcome: deps.runSession(request, onProgress, undefined),
      route: 'typescript',
      reasons: [`native full-Qxx run threw: ${detail}`.slice(0, 300)],
    };
  }
  const fallbackReasons: string[] = [];
  if (diagnostics.sparseCorrectionFallbacks > 0) {
    fallbackReasons.push(
      `sparse correction fallbacks=${diagnostics.sparseCorrectionFallbacks} (unexpected; fail-closed)`,
    );
  }
  if (diagnostics.rowProductsFallbacks > 0) {
    fallbackReasons.push(
      `sparse row-products fallbacks=${diagnostics.rowProductsFallbacks} (fail-closed)`,
    );
  }
  if (diagnostics.selectedCovarianceFallbacks > 0) {
    fallbackReasons.push(
      `sparse selected-covariance fallbacks=${diagnostics.selectedCovarianceFallbacks} (fail-closed)`,
    );
  }
  if (!outcome.result.success || !outcome.result.converged) {
    fallbackReasons.push('native full-Qxx result not converged (fail-closed)');
  }
  if (!isFiniteNativeResult(outcome.result)) {
    fallbackReasons.push('native full-Qxx result non-finite (fail-closed)');
  }
  // C1/C2/C3 verification over the ACTUAL captured native systems:
  // outcome parity alone never accepts a native result.
  const verification = verifyNativeFullQxxSystems(
    capture.systems,
    capture.truncated,
    eligibility.numParams,
  );
  fallbackReasons.push(...verification.reasons);
  if (fallbackReasons.length > 0) {
    return {
      outcome: deps.runSession(request, onProgress, undefined),
      route: 'typescript',
      reasons: fallbackReasons,
    };
  }
  return { outcome, route: 'native-full-qxx', reasons: [], verification };
};
