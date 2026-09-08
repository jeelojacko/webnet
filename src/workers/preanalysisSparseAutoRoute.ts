/**
 * Production preanalysis sparse route (enabled after Phase 8B.2).
 *
 * Whole-session atomic candidate for single-solve-shaped 2D plain-mode
 * preanalysis jobs: when enabled AND eligible, the request runs once with
 * the real WASM sparse bundle (selected covariance, legacy all-pairs)
 * behind capturing decorators; every captured selected-covariance system
 * must pass damping, fallback, physical, and C1/C2/C3 sentinel gates with
 * bounded deterministic complete-column C2 native verification, else the
 * original immutable request restarts clean in TypeScript. Condition
 * estimates are warn-only (production semantics); the correction oracle
 * carries no authority (the planning correction is discarded by contract).
 *
 * The shipped default is enabled; `setPreanalysisSparseAutoRouteEnabled(false)`
 * remains an internal emergency/test kill switch. Disabled short-circuits to
 * TypeScript with no WASM init.
 * No protocol, UI, persistence, tolerance, or preanalysis-semantics
 * changes. Production-safe: no evidence-only, test-helper, or script imports.
 *
 * Pre-dispatch enforcement: gated wrappers around the native correction
 * (first entry per planning solve) and selected-covariance solvers count
 * candidate systems and throw a typed fail-closed error BEFORE delegating
 * when the next system exceeds the cap or a parameterCount exceeds 256, so
 * over-cap systems never execute natively. Post-run gates then judge the
 * captured native values (C1/C2/C3/physical/damping/fallbacks); any failure
 * restarts the original request clean in TypeScript exactly once.
 */
import type { AdjustmentRuntime } from '../engine/adjustmentRuntime';
import { extractAutoAdjustDirectiveFromInput } from '../engine/autoAdjust';
import { parseEffectiveProjectInput, resolveEffectiveProjectParse } from '../engine/effectiveProjectParse';
import { createExperimentalSparseRouteDiagnostics } from '../engine/experimentalSparseDiagnostics';
import type {
  SparseCorrectionSolveInput,
  SparseCorrectionSolveResult,
  SparseCorrectionSolver,
  SparseRowProductsSolver,
} from '../engine/numericalBackend';
import { evaluatePreanalysisSparseWholeSession } from '../engine/preanalysisSparseSessionPolicy';
import { SPARSE_CONDITION_THRESHOLD } from '../engine/sparseNormalCondition';
import type { AdjustmentResult } from '../typesAdjustmentResult';
import type {
  RunSessionOutcome,
  RunSessionProgressCallback,
  RunSessionRequest,
} from '../engine/runSessionTypes';
import { loadSparseAutoRouteBundle, type SparseAutoRouteBundle } from './adjustmentSparseAutoRoute';
import { PreanalysisGatedCovarianceCapture } from './preanalysisSparseCovarianceGate';
import type { PreanalysisVerifierTimingSink } from './preanalysisSparseCovarianceGate';
import {
  createPreanalysisCandidateState,
  PREANALYSIS_SPARSE_ROUTE_MAX_PARAMETERS,
  PREANALYSIS_SPARSE_ROUTE_MAX_PLANNING_SYSTEMS,
  PREANALYSIS_SPARSE_ROUTE_MAX_STATION_UNKNOWNS,
  PreanalysisSparseCapError,
  type PreanalysisCandidateState,
  type PreanalysisGateCaps,
} from './preanalysisSparseAutoRouteCaps';

export {
  createPreanalysisCandidateState,
  isPreanalysisSparseCapError,
  PREANALYSIS_SPARSE_ROUTE_MAX_CAPTURED_CALLS,
  PREANALYSIS_SPARSE_ROUTE_MAX_PARAMETERS,
  PREANALYSIS_SPARSE_ROUTE_MAX_PLANNING_SYSTEMS,
  PREANALYSIS_SPARSE_ROUTE_MAX_STATION_UNKNOWNS,
  PREANALYSIS_SPARSE_ROUTE_MAX_VERIFICATION_QUERIES,
  PreanalysisSparseCapError,
  type PreanalysisCandidateState,
  type PreanalysisGateCaps,
} from './preanalysisSparseAutoRouteCaps';
export {
  PreanalysisGatedCovarianceCapture,
  verifyCovarianceSystem,
  type PreanalysisCovarianceVerdict,
} from './preanalysisSparseCovarianceGate';

/** Internal kill switch. No persisted or UI fields; retained for rollback. */
let preanalysisSparseAutoRouteEnabled = true;

/** Enables/disables the production preanalysis sparse route (internal/test-only). */
export const setPreanalysisSparseAutoRouteEnabled = (enabled: boolean): void => {
  preanalysisSparseAutoRouteEnabled = enabled;
};

/** Reports the current kill-switch state (true by default). */
export const isPreanalysisSparseAutoRouteEnabled = (): boolean => preanalysisSparseAutoRouteEnabled;

export interface PreanalysisSparseAutoRouteTestHooks {
  unknownCountOverride?: number;
  /** Test-only planning-system cap (default 64). Lower to force pre-dispatch abort. */
  systemCapOverride?: number;
  /**
   * Test-only static station-unknown cap (default 128). Widens the
   * eligibility gate and the whole-session unknown check for evidence runs.
   */
  stationUnknownCapOverride?: number;
  /**
   * Test-only per-system parameter cap (default 256 Phase 9B; station
   * unknowns stay capped at 128 separately). Widens the runtime
   * correction/covariance pre-dispatch gates for evidence runs.
   */
  parameterCapOverride?: number;
  /**
   * Evidence-only verifier timing sink (default null = disabled).
   * Records wall-ms per verifier phase; never affects gates or routing.
   */
  timingSink?: PreanalysisVerifierTimingSink | null;
  forceC2Failure?: boolean;
  forcePhysicalFailure?: boolean;
}

let testHooks: PreanalysisSparseAutoRouteTestHooks = {};

/** Test-only injection hooks (no protocol or user-facing flags). */
export const setPreanalysisSparseAutoRouteTestHooks = (
  hooks: PreanalysisSparseAutoRouteTestHooks,
): void => {
  testHooks = { ...hooks };
};

/** Clears test-only injection hooks. */
export const clearPreanalysisSparseAutoRouteTestHooks = (): void => {
  testHooks = {};
};

export interface PreanalysisSparseEligibility {
  eligible: boolean;
  reasons: string[];
  unknownCount: number | null;
}

/**
 * Fail-closed static eligibility from the effective project content.
 * Uses the shared authoritative effective parse (same profile resolution
 * plus includeFiles/projectRunFiles wiring as the direct solve), then
 * parses the effective content and judges the parsed state — so UI
 * settings the solver normalizes away, and directives hiding in
 * included or project run files, cannot slip past the static gates.
 * Reasons append in fixed gate order so repeated evaluations are
 * byte-identical. Actual per-system parameterCount and dynamic
 * planning-system counts are enforced at runtime, not here.
 */
export const derivePreanalysisSparseAutoRouteEligibility = (
  request: RunSessionRequest,
): PreanalysisSparseEligibility => {
  const reasons: string[] = [];
  if (!preanalysisSparseAutoRouteEnabled) {
    reasons.push('preanalysis sparse auto-route disabled by kill switch');
    return { eligible: false, reasons, unknownCount: null };
  }
  let effectiveParse;
  try {
    effectiveParse = resolveEffectiveProjectParse(request).profileContext.effectiveParse;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    reasons.push(`effective parse resolution failed: ${detail}`.slice(0, 300));
    return { eligible: false, reasons, unknownCount: null };
  }
  if (effectiveParse.runMode !== 'preanalysis') {
    reasons.push(`unsupported runMode '${effectiveParse.runMode}': preanalysis sparse route requires 'preanalysis'`);
  }
  if (effectiveParse.coordMode !== '2D') {
    reasons.push(`dimension '${effectiveParse.coordMode}' not cleared for preanalysis sparse route`);
  }
  if (effectiveParse.robustMode !== 'none') {
    reasons.push('robust reweighting not cleared for preanalysis sparse route');
  }
  if (effectiveParse.tsCorrelationEnabled) {
    reasons.push('TS correlation not cleared for preanalysis sparse route');
  }
  if (effectiveParse.autoAdjustEnabled) {
    reasons.push('auto-adjust not cleared for preanalysis sparse route');
  }
  if (effectiveParse.clusterDetectionEnabled && request.approvedClusterMerges.length > 0) {
    reasons.push('cluster dual-pass not cleared for preanalysis sparse route');
  }
  if (reasons.length > 0) return { eligible: false, reasons, unknownCount: null };
  try {
    const inlineAutoAdjust = extractAutoAdjustDirectiveFromInput(request.input);
    if (inlineAutoAdjust?.enabled) {
      reasons.push('inline auto-adjust directive not cleared for preanalysis sparse route');
      return { eligible: false, reasons, unknownCount: null };
    }
    const parsed = parseEffectiveProjectInput(request);
    if (parsed.parseState.autoAdjustEnabled) {
      reasons.push('inline auto-adjust directive not cleared for preanalysis sparse route');
    }
    if (parsed.parseState.robustMode != null && parsed.parseState.robustMode !== 'none') {
      reasons.push('robust reweighting not cleared for preanalysis sparse route');
    }
    if (parsed.parseState.tsCorrelationEnabled) {
      reasons.push('TS correlation not cleared for preanalysis sparse route');
    }
    const gpsCovarianceWeighting = parsed.observations.some(
      (observation) => observation.type === 'gps' && observation.gpsCovariance3d != null,
    );
    if (gpsCovarianceWeighting) {
      reasons.push('GPS covariance weighting not cleared for preanalysis sparse route');
    }
    const unknownCount = testHooks.unknownCountOverride ?? parsed.unknowns.length;
    const stationUnknownCap =
      testHooks.stationUnknownCapOverride ?? PREANALYSIS_SPARSE_ROUTE_MAX_STATION_UNKNOWNS;
    if (unknownCount > stationUnknownCap) {
      reasons.push(
        `size guard: station unknown count ${unknownCount} exceeds cap ${stationUnknownCap}`,
      );
    }
    return { eligible: reasons.length === 0, reasons, unknownCount };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    reasons.push(`eligibility parse failed: ${detail}`.slice(0, 300));
    return { eligible: false, reasons, unknownCount: null };
  }
};

const abortCandidate = (state: PreanalysisCandidateState, reason: string): void => {
  if (!state.aborted) {
    state.aborted = true;
    state.abortReason = reason;
  }
};



/**
 * Pre-dispatch gate around the native correction solver. Each call opens
 * one planning system: parameterCount is rejected and the over-cap system
 * is refused BEFORE delegating, so over-cap systems never execute
 * natively. Native delegate throws propagate unmarked (the engine
 * dense-fallbacks them and the route rejects post-hoc).
 */
export class PreanalysisGatedCorrectionSolver implements SparseCorrectionSolver {
  constructor(
    private readonly _delegate: SparseCorrectionSolver,
    private readonly _state: PreanalysisCandidateState,
    private readonly _caps: PreanalysisGateCaps,
  ) {}

  solveFromEquations(input: SparseCorrectionSolveInput): SparseCorrectionSolveResult {
    if (this._state.aborted) {
      throw new PreanalysisSparseCapError(
        this._state.abortReason ?? 'candidate aborted (fail-closed; not delegated)',
      );
    }
    const n = input.parameterCount;
    if (!Number.isInteger(n) || n <= 0 || n > this._caps.maxParameters) {
      const reason =
        `system ${this._state.systemsStarted + 1}: parameterCount ${n} exceeds cap ${this._caps.maxParameters} (fail-closed; not delegated)`;
      abortCandidate(this._state, reason);
      throw new PreanalysisSparseCapError(reason);
    }
    const next = this._state.systemsStarted + 1;
    if (next > this._caps.maxSystems) {
      const reason =
        `planning systems ${next} exceed cap ${this._caps.maxSystems} (fail-closed; not delegated)`;
      abortCandidate(this._state, reason);
      throw new PreanalysisSparseCapError(reason);
    }
    this._state.systemsStarted = next;
    return this._delegate.solveFromEquations(input);
  }
}

const isFinitePreanalysisResult = (result: AdjustmentResult): boolean => {
  if (!Number.isFinite(result.seuw)) return false;
  for (const station of Object.values(result.stations)) {
    if (!Number.isFinite(station.x) || !Number.isFinite(station.y)) return false;
    if (station.h != null && !Number.isFinite(station.h)) return false;
  }
  return true;
};

export type PreanalysisSparseAutoRouteSessionFn = (
  _request: RunSessionRequest,
  _onProgress?: RunSessionProgressCallback,
  _runtime?: AdjustmentRuntime,
) => RunSessionOutcome;

export interface PreanalysisSparseAutoRouteDeps {
  runSession: PreanalysisSparseAutoRouteSessionFn;
  loadBundle?: () => Promise<SparseAutoRouteBundle>;
}

export type PreanalysisSparseAutoRouteName = 'typescript' | 'sparse';

export interface PreanalysisSparseAutoRouteAttempt {
  outcome: RunSessionOutcome;
  route: PreanalysisSparseAutoRouteName;
  reasons: string[];
  warnings: string[];
}

/**
 * Runs the preanalysis request through the sparse route when enabled and
 * eligible, else plain TypeScript. Any failure reruns the ORIGINAL
 * immutable request with no runtime, so the returned outcome is always a
 * clean session result.
 */
export const runWithPreanalysisSparseAutoRoute = async (
  request: RunSessionRequest,
  onProgress: RunSessionProgressCallback | undefined,
  deps: PreanalysisSparseAutoRouteDeps,
): Promise<PreanalysisSparseAutoRouteAttempt> => {
  const eligibility = derivePreanalysisSparseAutoRouteEligibility(request);
  if (!eligibility.eligible) {
    return {
      outcome: deps.runSession(request, onProgress, undefined),
      route: 'typescript',
      reasons: eligibility.reasons,
      warnings: [],
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
      warnings: [],
    };
  }
  const diagnostics = createExperimentalSparseRouteDiagnostics();
  const maxSystems = testHooks.systemCapOverride ?? PREANALYSIS_SPARSE_ROUTE_MAX_PLANNING_SYSTEMS;
  const caps: PreanalysisGateCaps = {
    maxSystems,
    maxParameters:
      testHooks.parameterCapOverride ?? PREANALYSIS_SPARSE_ROUTE_MAX_PARAMETERS,
  };
  const candidate = createPreanalysisCandidateState();
  const gatedCorrection = new PreanalysisGatedCorrectionSolver(
    bundle.sparseCorrectionSolver,
    candidate,
    caps,
  );
  const gatedCovariance = new PreanalysisGatedCovarianceCapture(
    bundle.sparseSelectedCovarianceSolver,
    candidate,
    caps,
  );
  gatedCovariance.setTestFlags({
    forceC2Failure: testHooks.forceC2Failure,
    forcePhysicalFailure: testHooks.forcePhysicalFailure,
  });
  if (testHooks.timingSink) {
    gatedCovariance.setTimingSink(testHooks.timingSink);
  }
  const passthroughRowProducts: SparseRowProductsSolver = bundle.sparseRowProductsSolver;
  const runtime: AdjustmentRuntime = {
    sparseCorrectionSolver: gatedCorrection,
    sparseRowProductsSolver: passthroughRowProducts,
    sparseSelectedCovarianceSolver: gatedCovariance,
    experimentalSparseDiagnostics: diagnostics,
    experimentalSelectedCovarianceMode: true,
    experimentalSelectedCovarianceLegacyAllPairs: true,
  };
  let outcome: RunSessionOutcome;
  try {
    outcome = deps.runSession(request, onProgress, runtime);
  } catch (error) {
    // Single clean restart: this catch and the post-run gate below are
    // mutually exclusive, so the original request reruns in TypeScript
    // exactly once and a mixed sparse/dense outcome is never returned.
    const detail = error instanceof Error ? error.message : String(error);
    return {
      outcome: deps.runSession(request, onProgress, undefined),
      route: 'typescript',
      reasons: [`sparse run threw: ${detail}`.slice(0, 300)],
      warnings: [],
    };
  }
  const fallbackReasons: string[] = [];
  const warnings: string[] = [];
  if (testHooks.systemCapOverride != null) {
    warnings.push(`test hook systemCapOverride=${testHooks.systemCapOverride} (production cap=${PREANALYSIS_SPARSE_ROUTE_MAX_PLANNING_SYSTEMS})`);
  }
  if (testHooks.stationUnknownCapOverride != null) {
    warnings.push(`test hook stationUnknownCapOverride=${testHooks.stationUnknownCapOverride} (production cap=${PREANALYSIS_SPARSE_ROUTE_MAX_STATION_UNKNOWNS})`);
  }
  if (testHooks.parameterCapOverride != null) {
    warnings.push(`test hook parameterCapOverride=${testHooks.parameterCapOverride} (production cap=${PREANALYSIS_SPARSE_ROUTE_MAX_PARAMETERS})`);
  }
  // Typed pre-dispatch abort reason (the engine converts gate throws into
  // recorded dense fallbacks, so the abort surfaces here as well).
  if (candidate.aborted && candidate.abortReason) {
    fallbackReasons.push(candidate.abortReason);
  }
  if (diagnostics.sparseCorrectionFallbacks > 0) {
    fallbackReasons.push(`sparse correction fallbacks=${diagnostics.sparseCorrectionFallbacks} (fail-closed)`);
  }
  if (diagnostics.rowProductsFallbacks > 0) {
    fallbackReasons.push(`sparse row-products fallbacks=${diagnostics.rowProductsFallbacks} (fail-closed)`);
  }
  if (diagnostics.selectedCovarianceFallbacks > 0) {
    fallbackReasons.push(`sparse selected-covariance fallbacks=${diagnostics.selectedCovarianceFallbacks} (fail-closed)`);
  }
  if (gatedCovariance.truncated) {
    fallbackReasons.push('capture truncated at bound (fail-closed; coverage unproven)');
  }
  if (candidate.systemsStarted === 0) {
    fallbackReasons.push('no planning systems started (fail-closed)');
  }
  if (candidate.systemsStarted > maxSystems) {
    fallbackReasons.push(
      `planning systems ${candidate.systemsStarted} exceed cap ${maxSystems} (fail-closed)`,
    );
  }
  // Pairing coverage: every started system needs its verified covariance.
  // Verdicts were recorded immediately per system by the gate; only the
  // compact verdicts are retained (packed inputs/results are dropped).
  if (gatedCovariance.verdicts.length !== candidate.systemsStarted) {
    fallbackReasons.push(
      `unpaired coverage: ${candidate.systemsStarted} started systems != ${gatedCovariance.verdicts.length} verified covariance systems (fail-closed)`,
    );
  }
  if (gatedCovariance.maxRetainedPackedSystems > 1) {
    fallbackReasons.push(
      `covariance gate retained ${gatedCovariance.maxRetainedPackedSystems} packed systems (bound is 1; fail-closed)`,
    );
  }
  const verdicts = gatedCovariance.verdicts;
  for (const verdict of verdicts) fallbackReasons.push(...verdict.reasons);
  for (const verdict of verdicts) warnings.push(...verdict.warnings);
  // Whole-session atomic policy over per-system pass/fail.
  const policySystems = verdicts.map((verdict) => ({
    index: verdict.index,
    staticAdmit: true,
    physicalValid: !verdict.reasons.some((reason) => reason.includes('physical')),
    sentinelPass: !verdict.reasons.some((reason) => reason.includes('C1') || reason.includes('C2') || reason.includes('C3') || reason.includes('damping') || reason.includes('complete native')),
    correctionPass: true,
  }));
  if (policySystems.length > 0) {
    const session = evaluatePreanalysisSparseWholeSession({
      unknownCount: eligibility.unknownCount ?? 0,
      systems: policySystems,
      capOverrides: {
        unknownCap:
          testHooks.stationUnknownCapOverride ?? PREANALYSIS_SPARSE_ROUTE_MAX_STATION_UNKNOWNS,
        planningSystemCap: maxSystems,
      },
    });
    if (!session.admit) {
      for (const reason of session.reasons) {
        if (!fallbackReasons.includes(reason)) fallbackReasons.push(reason);
      }
    }
  }
  // Condition is warn-only (production semantics preserved).
  const conditionEstimate = outcome.result.condition?.estimate;
  if (conditionEstimate != null && Number.isFinite(conditionEstimate) && conditionEstimate > SPARSE_CONDITION_THRESHOLD) {
    warnings.push(
      `normal matrix appears ill-conditioned (estimate=${conditionEstimate.toExponential(3)}, threshold=${SPARSE_CONDITION_THRESHOLD.toExponential(3)}).`,
    );
  }
  if (!isFinitePreanalysisResult(outcome.result)) {
    fallbackReasons.push('sparse result non-finite (fail-closed)');
  }
  if (fallbackReasons.length > 0) {
    // Atomic fallback: exactly one clean TypeScript rerun of the original
    // immutable request; the mixed sparse/dense outcome is discarded and
    // never returned, so no mixed authority is possible.
    return {
      outcome: deps.runSession(request, onProgress, undefined),
      route: 'typescript',
      reasons: fallbackReasons,
      warnings,
    };
  }
  return { outcome, route: 'sparse', reasons: [], warnings };
};
