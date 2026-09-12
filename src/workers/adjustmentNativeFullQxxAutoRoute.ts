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
import {
  sampleDensePhysicalIndex,
  scanDensePhysical,
  tryBuildDensePhysicalIndex,
} from '../engine/sentinelDensePhysicalValidation';
import type { AdjustmentResult } from '../typesAdjustmentResult';
import type {
  RunSessionOutcome,
  RunSessionProgressCallback,
  RunSessionRequest,
} from '../engine/runSessionTypes';
import {
  loadSparseAutoRouteBundle,
  SparseAutoRouteCaptureSolver,
  verifySparseAutoRouteSystems,
  type SparseAutoRouteBundle,
  type SparseAutoRouteVerification,
} from './adjustmentSparseAutoRoute';

/** Conservative 3D coordinate-only parameter cap (Phase 10H corpus max). */
export const NATIVE_FULL_QXX_MAX_PARAMS = 384;

/**
 * Internal kill switch, ENABLED by default (Phase 10M certification: verified
 * native-faster at 384 params with exact parity; small-job cost is ~ms noise).
 * Set false to force clean TypeScript fallback. No persisted or UI fields.
 */
let nativeFullQxxEnabled = true;

/** Disables or re-enables the native full-Qxx route (internal/test-only). */
export const setNativeFullQxxRouteEnabled = (enabled: boolean): void => {
  nativeFullQxxEnabled = enabled;
};

/** Reports current kill-switch state (default enabled for the certified <=384 cohort). */
export const isNativeFullQxxRouteEnabled = (): boolean => nativeFullQxxEnabled;

/**
 * Phase 10N internal kill switch for native 3D correction, default OFF.
 * Internal/test-only, no persisted or UI fields, independent of the
 * full-Qxx switch above. When enabled (and full-Qxx eligibility passes),
 * the route additionally injects the real WASM correction solver with
 * S3 every-iteration verification; any proof failure reruns clean
 * TypeScript. Disabling restores exact Phase 10M behavior.
 */
let native3dCorrectionEnabled = false;

/** Enables or disables the native 3D correction experiment (internal/test-only). */
export const setNative3dCorrectionRouteEnabled = (enabled: boolean): void => {
  native3dCorrectionEnabled = enabled;
};

/** Reports the native 3D correction experiment state (default OFF). */
export const isNative3dCorrectionRouteEnabled = (): boolean => native3dCorrectionEnabled;

export interface NativeFullQxxEligibility {
  eligible: boolean;
  reasons: string[];
  numParams: number | null;
}

/**
 * Fail-closed eligibility in fixed gate order. Single-solve 3D
 * adjustment only; 2D/preanalysis/robust/multi-solve shapes stay on
 * their existing routes.
 *
 * Phase 11A diagnostic seam: `maxParams` defaults to the production cap
 * and every production call site omits it. Evidence harnesses ONLY may
 * pass a wider diagnostic value (e.g. 768) to study the verified route
 * above the cap; production reachability above 384 is never enabled.
 */
export const deriveNativeFullQxxEligibility = (
  request: RunSessionRequest,
  maxParams: number = NATIVE_FULL_QXX_MAX_PARAMS,
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
    if (numParams > maxParams) {
      reasons.push(
        `parameter count ${numParams} exceeds native full-Qxx cap ${maxParams} (fail-closed)`,
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

/**
 * Diagnostic-only per-bucket timing for native full-Qxx verification.
 * Measurement only: never influences accept/reject decisions. All fields
 * accumulate milliseconds (performance.now walls) or dense-op counts.
 * Pass undefined (the default at every production call site) for zero
 * behavior change; every write is guarded by `if (timing)`.
 */
export interface NativeFullQxxVerificationTiming {
  captureCopyMs: number;
  finiteScanConvertMs: number;
  oracleBuildMs: number;
  queryBuildMs: number;
  oracleProbeMs: number;
  nativeIndexMs: number;
  c1Ms: number;
  c2Ms: number;
  c3PhysicalMs: number;
  otherMs: number;
  systemsVerified: number;
  factorizations: number;
  solves: number;
  probedColumns: number;
  verifiedColumns: number;
  queryEntries: number;
  nativeBytesCopied: number;
  packedBytesCopied: number;
}

/** Zero-valued timing collector for evidence harnesses (production never allocates one). */
export const createNativeFullQxxVerificationTiming = (): NativeFullQxxVerificationTiming => ({
  captureCopyMs: 0,
  finiteScanConvertMs: 0,
  oracleBuildMs: 0,
  queryBuildMs: 0,
  oracleProbeMs: 0,
  nativeIndexMs: 0,
  c1Ms: 0,
  c2Ms: 0,
  c3PhysicalMs: 0,
  otherMs: 0,
  systemsVerified: 0,
  factorizations: 0,
  solves: 0,
  probedColumns: 0,
  verifiedColumns: 0,
  queryEntries: 0,
  nativeBytesCopied: 0,
  packedBytesCopied: 0,
});

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

  /** Optional diagnostic timing sink (default off; measurement-only). */
  readonly verificationTiming?: NativeFullQxxVerificationTiming;

  /**
   * Phase 11A diagnostic cap override for inline verification (default
   * the production cap). Evidence harnesses ONLY may pass a wider value;
   * production construction always omits it.
   */
  private readonly maxVerificationParams: number;

  /** Counts inline per-system verifications (double-verification audit). */
  inlineVerifications = 0;

  /**
   * Inline verification evidence per captured system (Phase 10L reuse).
   * Index-aligned with `systems`: entry i is the result of
   * verifyNativeFullQxxSystems([systems[i]], false, parameterCount)
   * taken before the native values reached the engine. Private; read via
   * getInlineVerifications() for route finalization only.
   */
  private readonly inlineEvidence: NativeFullQxxVerification[] = [];

  constructor(
    delegate: SparseSelectedCovarianceSolver,
    verificationTiming?: NativeFullQxxVerificationTiming,
    maxVerificationParams: number = NATIVE_FULL_QXX_MAX_PARAMS,
  ) {
    this.delegate = delegate;
    this.verificationTiming = verificationTiming;
    this.maxVerificationParams = maxVerificationParams;
  }

  querySelected(input: SparseSelectedCovarianceInput): SparseSelectedCovarianceResult {
    if (this.systems.length >= NATIVE_FULL_QXX_MAX_CAPTURED_SYSTEMS) {
      this.truncated = true;
      return this.delegate.querySelected(input);
    }
    const result = this.delegate.querySelected(input);
    const copyStart = this.verificationTiming ? performance.now() : 0;
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
    if (this.verificationTiming) {
      this.verificationTiming.captureCopyMs += performance.now() - copyStart;
      this.verificationTiming.nativeBytesCopied += result.covariance.length * 8;
      this.verificationTiming.packedBytesCopied +=
        (input.design.values.length + input.weights.values.length) * 8 +
        (input.design.rowOffsets.length + input.design.columns.length +
          input.weights.rows.length + input.weights.columns.length +
          input.queryRows.length + input.queryColumns.length) * 4;
    }
    // Verification happens before returning Qxx to the engine. This makes
    // verified provenance true when statistics reuse runs, rather than
    // accepting first and checking after downstream numerics already used it.
    const verification = verifyNativeFullQxxSystems(
      [captured],
      false,
      input.parameterCount,
      this.verificationTiming,
      this.maxVerificationParams,
    );
    this.inlineVerifications += 1;
    this.inlineEvidence.push(verification);
    if (!verification.accepted) {
      throw new Error(`native full-Qxx verification rejected: ${verification.reasons.join('; ')}`);
    }
    return result;
  }

  /**
   * Narrow read accessor for route finalization only. Returns copies with
   * fresh reasons/verifiedColumns arrays, so callers can never mutate the
   * stored evidence (the typed-array snapshots stay owned by the capture).
   */
  getInlineVerifications(): readonly NativeFullQxxVerification[] {
    return this.inlineEvidence.map((verification) => ({
      ...verification,
      reasons: [...verification.reasons],
      verifiedColumns: [...verification.verifiedColumns],
    }));
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
  timing?: NativeFullQxxVerificationTiming,
  maxParams: number = NATIVE_FULL_QXX_MAX_PARAMS,
): NativeFullQxxVerification => {
  const now = (): number => (timing ? performance.now() : 0);
  const routeStart = now();
  const entryBuckets = timing
    ? timing.captureCopyMs + timing.finiteScanConvertMs + timing.oracleBuildMs +
      timing.queryBuildMs + timing.oracleProbeMs + timing.nativeIndexMs +
      timing.c1Ms + timing.c2Ms + timing.c3PhysicalMs
    : 0;
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
    if (!Number.isInteger(n) || n <= 0 || n > maxParams) {
      reasons.push(`${tag}: parameter count ${n} outside 1..${maxParams} (fail-closed)`);
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
    const nativeConvertStart = now();
    const native = Array.from(system.result.covariance);
    for (let k = 0; k < native.length; k += 1) {
      if (!Number.isFinite(native[k])) {
        reasons.push(`${tag}: native covariance entry ${k} non-finite (fail-closed)`);
        return;
      }
    }
    if (timing) {
      timing.finiteScanConvertMs += now() - nativeConvertStart;
      timing.nativeBytesCopied += system.result.covariance.length * 8;
    }
    let normal;
    const oracleBuildStart = now();
    try {
      normal = accumulatePackedNormal(
        {
          design: system.design,
          weights: system.weights,
          observationEquationCount: system.observationEquationCount,
          parameterCount: n,
        },
        maxParams,
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      reasons.push(`${tag}: packed normal rebuild failed: ${detail}`.slice(0, 300));
      return;
    }
    if (timing) timing.oracleBuildMs += now() - oracleBuildStart;
    let bounded;
    const queryBuildStart = now();
    try {
      bounded = buildBoundedVerificationQueries(n, undefined, maxParams);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      reasons.push(`${tag}: verification query build failed: ${detail}`.slice(0, 300));
      return;
    }
    if (timing) timing.queryBuildMs += now() - queryBuildStart;
    const oracleProbeStart = now();
    const oracle = probeSelectedCovariance(normal, bounded.rows, bounded.columns, maxParams);
    if (timing) {
      timing.oracleProbeMs += now() - oracleProbeStart;
      timing.factorizations += 1;
      timing.solves += oracle.probedColumns.length;
      timing.probedColumns += oracle.probedColumns.length;
      timing.verifiedColumns += bounded.verifiedColumns.length;
      timing.queryEntries += system.queryRows.length;
    }
    if (oracle.damped) {
      reasons.push(`${tag}: TS oracle factor damped (degenerate; fail-closed)`);
      return;
    }
    // Packed dense index built once and shared by C1/C2 bounded sample
    // extraction and C3 physical scans (replaces the number-key Map and
    // the string-key legacy Map for proven full-dense inputs). Any
    // malformed shape falls back to the legacy paths below.
    const nativeIndexStart = now();
    const denseIndex = tryBuildDensePhysicalIndex(system.queryRows, system.queryColumns, native, n);
    const nativeSample = denseIndex
      ? sampleDensePhysicalIndex(denseIndex, bounded.rows, bounded.columns)
      : (() => {
        const nativeByKey = new Map<number, number>();
        for (let k = 0; k < system.queryRows.length; k += 1) {
          nativeByKey.set((system.queryRows[k] ?? -1) * n + (system.queryColumns[k] ?? -1), native[k] ?? Number.NaN);
        }
        return Array.from(bounded.rows, (row, k) => {
          const column = bounded.columns[k] ?? -1;
          return nativeByKey.get((row ?? -1) * n + column) ?? Number.NaN;
        });
      })();
    if (timing) timing.nativeIndexMs += now() - nativeIndexStart;
    const c1Start = now();
    const c1 = evaluateSentinelC1(nativeSample, oracle.values);
    if (timing) timing.c1Ms += now() - c1Start;
    maxC1Diff = Math.max(maxC1Diff, c1.maxAbsoluteDiff);
    if (!c1.pass) {
      for (const reason of c1.reasons) reasons.push(`${tag} C1: ${reason}`);
    }
    const c2Start = now();
    const c2 = evaluateSentinelC2(normal, bounded.rows, bounded.columns, nativeSample, undefined, maxParams);
    if (timing) timing.c2Ms += now() - c2Start;
    if (Number.isFinite(c2.maxResidual)) maxC2Residual = Math.max(maxC2Residual, c2.maxResidual);
    else maxC2Residual = Number.POSITIVE_INFINITY;
    if (!c2.pass) {
      for (const reason of c2.reasons) reasons.push(`${tag} C2: ${reason}`);
    }
    const c3Start = now();
    const physical = denseIndex
      ? scanDensePhysical(denseIndex, system.queryRows, system.queryColumns, native)
      : validateSentinelPhysical({
        queryRows: system.queryRows,
        queryColumns: system.queryColumns,
        values: native,
      });
    if (timing) {
      timing.c3PhysicalMs += now() - c3Start;
      timing.systemsVerified += 1;
    }
    if (!physical.valid) {
      for (const reason of physical.reasons) reasons.push(`${tag} C3-physical: ${reason}`);
    }
    if (verifiedColumns.length === 0) verifiedColumns = bounded.verifiedColumns;
  });
  if (timing) {
    const exitBuckets =
      timing.captureCopyMs + timing.finiteScanConvertMs + timing.oracleBuildMs +
      timing.queryBuildMs + timing.oracleProbeMs + timing.nativeIndexMs +
      timing.c1Ms + timing.c2Ms + timing.c3PhysicalMs;
    timing.otherMs += Math.max(0, now() - routeStart - (exitBuckets - entryBuckets));
  }
  return {
    accepted: reasons.length === 0,
    reasons,
    oracledSystemCount,
    maxC1Diff,
    maxC2Residual,
    verifiedColumns,
  };
};

/** Retags single-system inline reasons (`system 1 ...`) to their capture position. */
const retagInlineReason = (reason: string, tag: string): string =>
  reason.replace(/^system 1\b/, tag);

/** Shape check on stored inline evidence; genuine oracle output always passes. */
const isMalformedInlineVerification = (inline: NativeFullQxxVerification): boolean =>
  typeof inline.accepted !== 'boolean' ||
  !Array.isArray(inline.reasons) ||
  typeof inline.maxC1Diff !== 'number' ||
  typeof inline.maxC2Residual !== 'number' ||
  !Array.isArray(inline.verifiedColumns) ||
  typeof inline.oracledSystemCount !== 'number' ||
  (!inline.accepted && inline.reasons.length === 0);

/**
 * Phase 10L cached-evidence finalizer: aggregates stored inline evidence
 * WITHOUT re-running oracle/C1/C2/C3 numerics. Accept/reject decisions
 * are bit-identical to verifyNativeFullQxxSystems over the same capture:
 * truncation/empty reasons use the same strings, per-system reasons are
 * propagated in capture order with position retagging, parameter-count
 * eligibility is re-checked against expectedNumParams (inline used the
 * input count), and maxC1Diff/maxC2Residual/verifiedColumns aggregate
 * exactly as the legacy loop (max-from-zero, first-system column list).
 *
 * Fail-closed on anything the evidence cannot prove: truncation, empty
 * capture, evidence/capture count mismatch, missing or malformed inline
 * evidence, any inline rejection, any parameter-count mismatch, and any
 * accepted aggregate with non-finite maxes or empty column provenance.
 *
 * Ownership audit (Phase 10L): between inline verification and route
 * finalization the snapshot arrays have only readers. The capture owns
 * deep copies (Int32Array.from/Float64Array.from at capture time); the
 * engine receives the ORIGINAL delegate result, never the copy. Engine
 * downstream (reconstructDenseQxx, createSelectedCovarianceStore) only
 * indexed-reads result.covariance into fresh structures, and both
 * verifiers only read (Array.from copies, Map index) — no code path
 * writes into captured typed arrays. `systems` is publicly reachable,
 * so index-desync tampering (push/shuffle) is defended fail-closed via
 * the count check plus the per-system parameter re-check; verification
 * objects are copy-on-read, so finalization input cannot alias the
 * store. Conclusion: the cached copy is never handed out mutably and
 * wiring the finalizer into production is safe.
 */
export const finalizeNativeFullQxxVerification = (
  systems: readonly CapturedNativeFullQxxSystem[],
  inlineResults: readonly NativeFullQxxVerification[],
  truncated: boolean,
  expectedNumParams: number | null,
  timing?: NativeFullQxxVerificationTiming,
  maxParams: number = NATIVE_FULL_QXX_MAX_PARAMS,
): NativeFullQxxVerification => {
  const start = timing ? performance.now() : 0;
  const finish = (): void => {
    if (timing) timing.otherMs += performance.now() - start;
  };
  const reasons: string[] = [];
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
    finish();
    return { accepted: false, reasons, oracledSystemCount: 0, maxC1Diff, maxC2Residual, verifiedColumns };
  }
  if (inlineResults.length !== systems.length) {
    reasons.push(
      `verification: inline evidence count ${inlineResults.length} != captured ${systems.length} (fail-closed; provenance unproven)`,
    );
    finish();
    return { accepted: false, reasons, oracledSystemCount: systems.length, maxC1Diff, maxC2Residual, verifiedColumns };
  }
  systems.forEach((system, index) => {
    const tag = `system ${index + 1}`;
    const n = system.parameterCount;
    if (!Number.isInteger(n) || n <= 0 || n > maxParams) {
      reasons.push(`${tag}: parameter count ${n} outside 1..${maxParams} (fail-closed)`);
      return;
    }
    if (expectedNumParams != null && n !== expectedNumParams) {
      reasons.push(
        `${tag}: parameter count ${n} != eligible ${expectedNumParams} (dimension/provenance mismatch; fail-closed)`,
      );
      return;
    }
    const inline = inlineResults[index];
    if (inline == null || isMalformedInlineVerification(inline)) {
      reasons.push(
        inline == null
          ? `${tag}: missing inline verification evidence (fail-closed; provenance unproven)`
          : `${tag}: inline verification metadata malformed (fail-closed; provenance unproven)`,
      );
      return;
    }
    maxC1Diff = Math.max(maxC1Diff, inline.maxC1Diff);
    maxC2Residual = Math.max(maxC2Residual, inline.maxC2Residual);
    if (verifiedColumns.length === 0 && inline.verifiedColumns.length > 0) {
      verifiedColumns = [...inline.verifiedColumns];
    }
    for (const reason of inline.reasons) reasons.push(retagInlineReason(reason, tag));
  });
  if (reasons.length === 0) {
    if (!Number.isFinite(maxC1Diff) || !Number.isFinite(maxC2Residual) || verifiedColumns.length === 0) {
      reasons.push('verification: aggregate provenance unprovable (fail-closed)');
    }
  }
  finish();
  return {
    accepted: reasons.length === 0,
    reasons,
    oracledSystemCount: systems.length,
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
  /**
   * Phase 10N S3 verification over captured native correction systems;
   * present only when the correction experiment ran and was accepted.
   */
  correctionVerification?: SparseAutoRouteVerification;
  /** Native correction calls captured in the accepted attempt (10N only). */
  nativeCorrectionCalls?: number;
}

/**
 * Runs the request through the native full-Qxx route when eligible, else
 * plain TypeScript. Any failure reruns the original request with no
 * runtime, so the returned outcome is always a clean session result.
 *
 * Phase 11A diagnostic seam: `maxParams` defaults to the production cap
 * and every production call site omits it. Evidence harnesses ONLY may
 * pass a wider diagnostic value (e.g. 768); the threaded value flows
 * through eligibility, capture-inline verification, and finalization.
 */
export const runWithNativeFullQxxAutoRoute = async (
  request: RunSessionRequest,
  onProgress: RunSessionProgressCallback | undefined,
  deps: NativeFullQxxDeps,
  maxParams: number = NATIVE_FULL_QXX_MAX_PARAMS,
): Promise<NativeFullQxxAttempt> => {
  const eligibility = deriveNativeFullQxxEligibility(request, maxParams);
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
  // Phase 10N experiment: when the separate default-OFF correction switch
  // is enabled, also inject the real WASM correction solver behind a
  // shared S3 capture. Covariance side stays exactly Phase 10M (native
  // full dense Qxx, 10L cached finalizer, C1/C2/C3 unchanged); no
  // row-products/selected mode. Any correction-proof failure below reruns
  // the whole attempt in clean TypeScript (never a mixed
  // TS-correction+native-Qxx attempt: no proven restart boundary exists).
  if (native3dCorrectionEnabled) {
    const correctionCapture = new SparseAutoRouteCaptureSolver(bundle.sparseCorrectionSolver);
    const covarianceCapture = new NativeFullQxxCaptureSolver(bundle.sparseSelectedCovarianceSolver, undefined, maxParams);
    const correctionRuntime: AdjustmentRuntime = {
      sparseCorrectionSolver: correctionCapture,
      sparseSelectedCovarianceSolver: covarianceCapture,
      experimentalSparseDiagnostics: diagnostics,
      experimentalSelectedCovarianceMode: false,
      allowVerifiedNativeDenseQxxReuse: true,
    };
    let correctionOutcome: RunSessionOutcome;
    try {
      correctionOutcome = deps.runSession(request, onProgress, correctionRuntime);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return {
        outcome: deps.runSession(request, onProgress, undefined),
        route: 'typescript',
        reasons: [`native 3D correction run threw: ${detail}`.slice(0, 300)],
      };
    }
    const correctionFallbackReasons: string[] = [];
    if (diagnostics.sparseCorrectionFallbacks > 0) {
      correctionFallbackReasons.push(
        `sparse correction fallbacks=${diagnostics.sparseCorrectionFallbacks} (mixed trajectory; fail-closed)`,
      );
    }
    if (diagnostics.rowProductsFallbacks > 0) {
      correctionFallbackReasons.push(
        `sparse row-products fallbacks=${diagnostics.rowProductsFallbacks} (fail-closed)`,
      );
    }
    if (diagnostics.selectedCovarianceFallbacks > 0) {
      correctionFallbackReasons.push(
        `sparse selected-covariance fallbacks=${diagnostics.selectedCovarianceFallbacks} (fail-closed)`,
      );
    }
    if (!correctionOutcome.result.success || !correctionOutcome.result.converged) {
      correctionFallbackReasons.push('native 3D correction result not converged (fail-closed)');
    }
    if (!isFiniteNativeResult(correctionOutcome.result)) {
      correctionFallbackReasons.push('native 3D correction result non-finite (fail-closed)');
    }
    // S3 every-iteration proof over the ACTUAL native correction calls:
    // contract unchanged (count==iterations, 1e-9 dense-oracle agreement,
    // finite, damping==0, finite condition evidence, first-system condition
    // agreement; warnings stay warnings).
    const correctionVerification = verifySparseAutoRouteSystems(
      correctionCapture.systems,
      correctionCapture.truncated,
      correctionOutcome.result.iterations,
      correctionOutcome.result.condition?.estimate,
    );
    correctionFallbackReasons.push(...correctionVerification.reasons);
    const covarianceVerification = finalizeNativeFullQxxVerification(
      covarianceCapture.systems,
      covarianceCapture.getInlineVerifications(),
      covarianceCapture.truncated,
      eligibility.numParams,
      undefined,
      maxParams,
    );
    correctionFallbackReasons.push(...covarianceVerification.reasons);
    if (correctionFallbackReasons.length > 0) {
      return {
        outcome: deps.runSession(request, onProgress, undefined),
        route: 'typescript',
        reasons: correctionFallbackReasons,
      };
    }
    return {
      outcome: correctionOutcome,
      route: 'native-full-qxx',
      reasons: [],
      verification: covarianceVerification,
      correctionVerification,
      nativeCorrectionCalls: correctionCapture.systems.length,
    };
  }
  const capture = new NativeFullQxxCaptureSolver(bundle.sparseSelectedCovarianceSolver, undefined, maxParams);
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
  // outcome parity alone never accepts a native result. Phase 10L reuses
  // the cached inline evidence instead of re-running the oracle numerics
  // (fail-closed aggregation; decisions bit-identical to the legacy path).
  const verification = finalizeNativeFullQxxVerification(
    capture.systems,
    capture.getInlineVerifications(),
    capture.truncated,
    eligibility.numParams,
    undefined,
    maxParams,
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
