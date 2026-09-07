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
 * when the next system exceeds the cap or a parameterCount exceeds 128, so
 * over-cap systems never execute natively. Post-run gates then judge the
 * captured native values (C1/C2/C3/physical/damping/fallbacks); any failure
 * restarts the original request clean in TypeScript exactly once.
 */
import type { AdjustmentRuntime } from '../engine/adjustmentRuntime';
import { extractAutoAdjustDirectiveFromInput } from '../engine/autoAdjust';
import { createExperimentalSparseRouteDiagnostics } from '../engine/experimentalSparseDiagnostics';
import type {
  SparseCorrectionSolveInput,
  SparseCorrectionSolveResult,
  SparseCorrectionSolver,
  SparseRowProductsSolver,
  SparseSelectedCovarianceInput,
  SparseSelectedCovarianceResult,
  SparseSelectedCovarianceSolver,
} from '../engine/numericalBackend';
import { parseInput } from '../engine/parseInputCore';
import {
  accumulatePackedNormal,
  buildBoundedVerificationQueries,
  evaluateSentinelC1,
  evaluateSentinelC2,
  evaluateSentinelC3,
  PREANALYSIS_SPARSE_VERIFICATION_COLUMN_COUNT,
  probeSelectedCovariance,
  validateSentinelPhysical,
} from '../engine/preanalysisSparseCovarianceSentinel';
import {
  evaluatePreanalysisSparseWholeSession,
  PREANALYSIS_SPARSE_PLANNING_SYSTEM_CAP,
  PREANALYSIS_SPARSE_UNKNOWN_CAP,
} from '../engine/preanalysisSparseSessionPolicy';
import { SPARSE_CONDITION_THRESHOLD } from '../engine/sparseNormalCondition';
import type { AdjustmentResult } from '../typesAdjustmentResult';
import type {
  RunSessionOutcome,
  RunSessionProgressCallback,
  RunSessionRequest,
} from '../engine/runSessionTypes';
import { loadSparseAutoRouteBundle, type SparseAutoRouteBundle } from './adjustmentSparseAutoRoute';

/** Enforced unknown cap (station unknowns at eligibility; params at runtime). */
export const PREANALYSIS_SPARSE_ROUTE_MAX_UNKNOWN_COUNT = PREANALYSIS_SPARSE_UNKNOWN_CAP;

/** Enforced per-session planning-system cap (captured covariance calls). */
export const PREANALYSIS_SPARSE_ROUTE_MAX_PLANNING_SYSTEMS = PREANALYSIS_SPARSE_PLANNING_SYSTEM_CAP;

/** Capture bound for selected-covariance calls (fail-closed truncation). */
export const PREANALYSIS_SPARSE_ROUTE_MAX_CAPTURED_CALLS = 512;

/**
 * Backstop bound on native re-verification entries per system. The route
 * never issues n^2 queries: verification uses at most
 * PREANALYSIS_SPARSE_VERIFICATION_COLUMN_COUNT (16) complete columns
 * (<=2,048 entries at n = 128). Exceeding this backstop fails closed.
 */
export const PREANALYSIS_SPARSE_ROUTE_MAX_VERIFICATION_QUERIES = 16384;

/** Internal kill switch. No persisted or UI fields; retained for rollback. */
let preanalysisSparseAutoRouteEnabled = false;

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
 * Fail-closed static eligibility from the request plus parsed unknowns.
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
  const parse = request.parseSettings;
  if (parse.runMode !== 'preanalysis') {
    reasons.push(`unsupported runMode '${parse.runMode}': preanalysis sparse route requires 'preanalysis'`);
  }
  if (parse.coordMode !== '2D') {
    reasons.push(`dimension '${parse.coordMode}' not cleared for preanalysis sparse route`);
  }
  if (parse.robustMode !== 'none') {
    reasons.push('robust reweighting not cleared for preanalysis sparse route');
  }
  if (parse.tsCorrelationEnabled) {
    reasons.push('TS correlation not cleared for preanalysis sparse route');
  }
  if (parse.autoAdjustEnabled) {
    reasons.push('auto-adjust not cleared for preanalysis sparse route');
  }
  if (parse.clusterDetectionEnabled && request.approvedClusterMerges.length > 0) {
    reasons.push('cluster dual-pass not cleared for preanalysis sparse route');
  }
  if (reasons.length > 0) return { eligible: false, reasons, unknownCount: null };
  try {
    const inlineAutoAdjust = extractAutoAdjustDirectiveFromInput(request.input);
    if (inlineAutoAdjust?.enabled) {
      reasons.push('inline auto-adjust directive not cleared for preanalysis sparse route');
      return { eligible: false, reasons, unknownCount: null };
    }
    const parsed = parseInput(request.input);
    const gpsCovarianceWeighting = parsed.observations.some(
      (observation) => observation.type === 'gps' && observation.gpsCovariance3d != null,
    );
    if (gpsCovarianceWeighting) {
      reasons.push('GPS covariance weighting not cleared for preanalysis sparse route');
    }
    const unknownCount = testHooks.unknownCountOverride ?? parsed.unknowns.length;
    if (unknownCount > PREANALYSIS_SPARSE_ROUTE_MAX_UNKNOWN_COUNT) {
      reasons.push(
        `size guard: ${unknownCount} unknowns exceed cap ${PREANALYSIS_SPARSE_ROUTE_MAX_UNKNOWN_COUNT}`,
      );
    }
    return { eligible: reasons.length === 0, reasons, unknownCount };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    reasons.push(`eligibility parse failed: ${detail}`.slice(0, 300));
    return { eligible: false, reasons, unknownCount: null };
  }
};

/**
 * Typed fail-closed abort thrown BEFORE delegating to the native solver.
 * The engine converts solver throws into recorded dense fallbacks (or lets
 * them propagate); either way the route discards the mixed outcome and
 * performs exactly one clean TypeScript restart, so this error never
 * carries correction/covariance authority.
 */
export class PreanalysisSparseCapError extends Error {
  readonly routeReason: string;

  constructor(reason: string) {
    super(reason);
    this.name = 'PreanalysisSparseCapError';
    this.routeReason = reason;
  }
}

/** Identifies the typed pre-dispatch abort (no string matching needed). */
export const isPreanalysisSparseCapError = (error: unknown): error is PreanalysisSparseCapError =>
  error instanceof PreanalysisSparseCapError;

/**
 * Shared candidate state: the correction gate counts one planning system
 * per native correction entry (first native entry per planning solve) and
 * the covariance gate pairs each covariance call to a started system.
 */
export interface PreanalysisCandidateState {
  systemsStarted: number;
  aborted: boolean;
  abortReason: string | null;
}

/** Creates fresh candidate state for one routed session attempt. */
export const createPreanalysisCandidateState = (): PreanalysisCandidateState => ({
  systemsStarted: 0,
  aborted: false,
  abortReason: null,
});

const abortCandidate = (state: PreanalysisCandidateState, reason: string): void => {
  if (!state.aborted) {
    state.aborted = true;
    state.abortReason = reason;
  }
};

export interface PreanalysisGateCaps {
  maxSystems: number;
  maxParameters: number;
}

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

interface CapturedCovarianceCall {
  input: SparseSelectedCovarianceInput;
  result: SparseSelectedCovarianceResult | null;
  threw: boolean;
}

const copyCovarianceInput = (input: SparseSelectedCovarianceInput): SparseSelectedCovarianceInput => ({
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
});

/**
 * Pre-dispatch gate plus capture around the native selected-covariance
 * solver. Each call must pair with an already-started correction system
 * (covariance never runs ahead of correction), and over-cap/over-count
 * calls are refused BEFORE delegating. Successful native results are
 * captured for post-run C1/C2/C3/physical judgment.
 */
export class PreanalysisGatedCovarianceCapture implements SparseSelectedCovarianceSolver {
  readonly calls: CapturedCovarianceCall[] = [];

  truncated = false;

  constructor(
    private readonly _delegate: SparseSelectedCovarianceSolver,
    private readonly _state: PreanalysisCandidateState,
    private readonly _caps: PreanalysisGateCaps,
  ) {}

  querySelected(input: SparseSelectedCovarianceInput): SparseSelectedCovarianceResult {
    if (this._state.aborted) {
      throw new PreanalysisSparseCapError(
        this._state.abortReason ?? 'candidate aborted (fail-closed; not delegated)',
      );
    }
    const n = input.parameterCount;
    if (!Number.isInteger(n) || n <= 0 || n > this._caps.maxParameters) {
      const reason =
        `system covariance: parameterCount ${n} exceeds cap ${this._caps.maxParameters} (fail-closed; not delegated)`;
      abortCandidate(this._state, reason);
      throw new PreanalysisSparseCapError(reason);
    }
    const next = this.calls.length + 1;
    if (next > this._caps.maxSystems) {
      const reason =
        `planning systems ${next} exceed cap ${this._caps.maxSystems} (fail-closed; not delegated)`;
      abortCandidate(this._state, reason);
      throw new PreanalysisSparseCapError(reason);
    }
    if (next > this._state.systemsStarted) {
      const reason =
        `system ${next}: covariance without paired correction entry (fail-closed; not delegated)`;
      abortCandidate(this._state, reason);
      throw new PreanalysisSparseCapError(reason);
    }
    if (this.calls.length >= PREANALYSIS_SPARSE_ROUTE_MAX_CAPTURED_CALLS) {
      this.truncated = true;
      return this._delegate.querySelected(input);
    }
    try {
      const result = this._delegate.querySelected(input);
      this.calls.push({ input: copyCovarianceInput(input), result, threw: false });
      return result;
    } catch (error) {
      this.calls.push({ input: copyCovarianceInput(input), result: null, threw: true });
      throw error;
    }
  }
}

interface CovarianceSystemVerdict {
  index: number;
  parameterCount: number;
  reasons: string[];
  warnings: string[];
}

/**
 * Verifies one captured covariance system: damping, native-value C2
 * (production values where they cover complete columns plus one bounded
 * deterministic all-pairs verification set through the same native
 * delegate), TS diagonal C1 packed-decode check, C3 hybrid, and physical
 * validity. Condition excess warns only. Returns per-system reasons
 * (empty = pass) plus warnings.
 */
const verifyCovarianceSystem = (
  call: CapturedCovarianceCall,
  index: number,
  delegate: SparseSelectedCovarianceSolver,
): CovarianceSystemVerdict => {
  const tag = `system ${index + 1}`;
  const reasons: string[] = [];
  const warnings: string[] = [];
  const n = call.input.parameterCount;
  if (call.threw || call.result == null) {
    reasons.push(`${tag}: native covariance produced no values (it threw; fail-closed)`);
    return { index, parameterCount: n, reasons, warnings };
  }
  if (n <= 0 || n > PREANALYSIS_SPARSE_ROUTE_MAX_UNKNOWN_COUNT) {
    reasons.push(`${tag}: parameterCount ${n} outside 1..${PREANALYSIS_SPARSE_ROUTE_MAX_UNKNOWN_COUNT} (fail-closed)`);
    return { index, parameterCount: n, reasons, warnings };
  }
  const damping = call.result.damping ?? Number.NaN;
  if (!Number.isFinite(damping) || damping !== 0) {
    reasons.push(`${tag}: damping=${damping} (undamped required)`);
    return { index, parameterCount: n, reasons, warnings };
  }
  let normal;
  try {
    normal = accumulatePackedNormal({
      design: call.input.design,
      weights: call.input.weights,
      observationEquationCount: call.input.observationEquationCount,
      parameterCount: n,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    reasons.push(`${tag}: normal accumulation threw fail-closed: ${detail}`.slice(0, 200));
    return { index, parameterCount: n, reasons, warnings };
  }
  // C2 on the captured NATIVE production values (complete columns only).
  // Production queries are station/pair blocks, so a production system
  // routinely has no complete column: that state is reported explicitly
  // here (never silently dropped) and the bounded verification below
  // judges the system instead. Rejection stays fail-closed: when NEITHER
  // production nor verification yields a complete column, the C3 branch
  // below falls back.
  const prodValues = Array.from(call.result.covariance);
  const prodC2 = evaluateSentinelC2(normal, call.input.queryRows, call.input.queryColumns, prodValues);
  if (prodC2.perColumnResidual.length === 0) {
    warnings.push(`${tag}: production C2 has no complete column (${prodC2.reasons.join('; ').slice(0, 160)}); bounded verification decides`);
  } else if (!prodC2.pass) {
    reasons.push(`${tag}: C2 rejects production native values: ${prodC2.reasons.join('; ').slice(0, 200)}`);
  }
  // Bounded deterministic verification: at most 16 complete native
  // columns through the same delegate (never touches engine diagnostics
  // or results). No n^2 all-pairs re-query is ever issued.
  let verificationPass: boolean | null = null;
  try {
    const bounded = buildBoundedVerificationQueries(n, PREANALYSIS_SPARSE_VERIFICATION_COLUMN_COUNT);
    if (bounded.rows.length > PREANALYSIS_SPARSE_ROUTE_MAX_VERIFICATION_QUERIES) {
      reasons.push(
        `${tag}: verification needs ${bounded.rows.length} entries, exceeding backstop ${PREANALYSIS_SPARSE_ROUTE_MAX_VERIFICATION_QUERIES} (fail-closed)`,
      );
    } else {
      const verification = delegate.querySelected({
        design: call.input.design,
        weights: call.input.weights,
        observationEquationCount: call.input.observationEquationCount,
        parameterCount: n,
        queryRows: bounded.rows,
        queryColumns: bounded.columns,
      });
      if (!Number.isFinite(verification.damping) || verification.damping !== 0) {
        reasons.push(`${tag}: verification native damping=${verification.damping} (undamped required)`);
      } else {
        const evaluated = evaluateSentinelC2(
          normal,
          bounded.rows,
          bounded.columns,
          Array.from(verification.covariance),
        );
        verificationPass = evaluated.pass;
        warnings.push(
          `${tag}: bounded verification cols=${bounded.verifiedColumns.length} checked=${evaluated.perColumnResidual.length} residual=${evaluated.maxResidual.toExponential(2)}`,
        );
        if (!evaluated.pass) {
          reasons.push(`${tag}: C2 rejects verification native values: ${evaluated.reasons.join('; ').slice(0, 200)}`);
        }
      }
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    reasons.push(`${tag}: verification native query threw fail-closed: ${detail}`.slice(0, 200));
  }
  // C1: captured native values vs a TS selected-solve reference at the
  // same queried entries. The reference factors dense N exactly once and
  // solves only the distinct queried columns: no full inverse and no
  // dense Qxx are ever materialized. Every queried entry is judged
  // (complete-column residuals are C2's job); zero queries fail closed.
  let c1Pass: boolean | null = null;
  try {
    if (call.input.queryRows.length === 0) {
      reasons.push(`${tag}: C1 needs at least one queried entry (fail-closed)`);
    } else {
      const probe = probeSelectedCovariance(normal, call.input.queryRows, call.input.queryColumns);
      if (probe.damped) {
        reasons.push(`${tag}: TS probe damped (fail-closed)`);
      } else {
        const c1 = evaluateSentinelC1(prodValues, probe.values);
        c1Pass = c1.pass;
        if (!c1.pass) {
          reasons.push(`${tag}: C1 rejects: ${c1.reasons.join('; ').slice(0, 200)}`);
        }
      }
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    reasons.push(`${tag}: C1 threw fail-closed: ${detail}`.slice(0, 200));
  }
  // C3 hybrid over C1 + production native C2 where complete (the bounded
  // verification C2 is judged separately above, never silently dropped).
  const c2ForC3 = prodC2.perColumnResidual.length > 0 ? prodC2 : null;
  if (c2ForC3 && verificationPass != null) {
    const c3 = evaluateSentinelC3({
      c1: c1Pass == null ? null : { pass: c1Pass, reasons: c1Pass ? [] : ['C1 failed'], maxAbsoluteDiff: 0, maxRelativeDiff: 0 },
      c2: c2ForC3,
    });
    if (!c3.pass) reasons.push(`${tag}: C3 rejects: ${c3.reasons.join('; ').slice(0, 200)}`);
  } else if (verificationPass == null && c2ForC3 == null) {
    reasons.push(`${tag}: no complete native column (production or verification); full-column coverage required (fail-closed)`);
  }
  // Physical validity over native production values.
  const physical = validateSentinelPhysical({
    queryRows: call.input.queryRows,
    queryColumns: call.input.queryColumns,
    values: prodValues,
  });
  if (!physical.valid) {
    reasons.push(`${tag}: physical rejects: ${physical.reasons.join('; ').slice(0, 200)}`);
  }
  // Test-hook forced failures (verification-gate exercise, no protocol change).
  if (testHooks.forceC2Failure) reasons.push(`${tag}: forced C2 failure (test hook)`);
  if (testHooks.forcePhysicalFailure) reasons.push(`${tag}: forced physical failure (test hook)`);
  return { index, parameterCount: n, reasons, warnings };
};

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
    maxParameters: PREANALYSIS_SPARSE_ROUTE_MAX_UNKNOWN_COUNT,
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
  // Pairing coverage: every started system needs its captured covariance.
  if (gatedCovariance.calls.length !== candidate.systemsStarted) {
    fallbackReasons.push(
      `unpaired coverage: ${candidate.systemsStarted} started systems != ${gatedCovariance.calls.length} captured covariance calls (fail-closed)`,
    );
  }
  // Per-system verification over the paired captured systems.
  const verdicts = gatedCovariance.calls.map((call, index) =>
    verifyCovarianceSystem(call, index, bundle.sparseSelectedCovarianceSolver),
  );
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
