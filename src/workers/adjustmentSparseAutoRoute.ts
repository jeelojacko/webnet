/**
 * Phase 7C automatic sparse route (worker-only, fail-closed).
 *
 * Routes ordinary single-solve 2D adjustment jobs with at most 64 unknowns
 * through the real WASM sparse bundle (correction on every iteration, row
 * products, selected covariance with legacy all-pairs) and verifies every
 * captured correction system against the dense rebuild oracle (S3
 * every-iteration coverage: correction agreement, undamped, finite
 * condition evidence, captured count equal to candidate iterations, and
 * result.condition agreement with the first-system oracle).
 *
 * Any kill-switch-off, ineligibility, WASM init failure, sparse throw,
 * engine fallback, oracle mismatch, damping, non-finite result, or missing
 * result.condition falls
 * back to a clean rerun of the original request without a runtime, so the
 * worker protocol, persisted state, UI, and TypeScript defaults are
 * untouched. No C++ or tolerance changes.
 */
import { buildSolvePreparation, collectActiveObservationsForSolve } from '../engine/adjustmentPreprocessing';
import type { AdjustmentRuntime } from '../engine/adjustmentRuntime';
import { extractAutoAdjustDirectiveFromInput } from '../engine/autoAdjust';
import { createExperimentalSparseRouteDiagnostics } from '../engine/experimentalSparseDiagnostics';
import type {
  SparseCorrectionSolveInput,
  SparseCorrectionSolveResult,
  SparseCorrectionSolver,
  SparseRowProductsSolver,
  SparseSelectedCovarianceSolver,
} from '../engine/numericalBackend';
import { parseInput } from '../engine/parseInputCore';
import { PHASE7B6_CORRECTION_TOLERANCE } from '../engine/phase7b6CorrectionHandshake';
import { PHASE7B7_RELATIVE_TOLERANCE } from '../engine/phase7b7FullContract';
import {
  measurePhase7b7DenseOracle,
  type Phase7b7CapturedSystem,
} from '../engine/phase7b7DenseRebuild';
import {
  PHASE7B7_RECOMMENDED_MAX_UNKNOWN_COUNT,
} from '../engine/phase7b7SafetyStrategies';
import { evaluateSparseGeometryPreflight } from '../engine/sparseGeometryPreflight';
import { SPARSE_CONDITION_THRESHOLD } from '../engine/sparseNormalCondition';
import { evaluateSparseProductionEligibility } from '../engine/sparseProductionEligibility';
import { createExperimentalSparseNumericalBundle } from '../engine/wasm/experimentalSparseNumericalBundle';
import type { WebNetWasmFactory } from '../engine/wasm/wasmTypes';
import type { AdjustmentResult } from '../typesAdjustmentResult';
import type {
  RunSessionOutcome,
  RunSessionProgressCallback,
  RunSessionRequest,
} from '../engine/runSessionTypes';

/** Ordinary-job size cap for the automatic route (S3 evidence-based cap). */
export const SPARSE_AUTO_ROUTE_MAX_UNKNOWN_COUNT = PHASE7B7_RECOMMENDED_MAX_UNKNOWN_COUNT;

/**
 * Session-level capture bound. A session may run several solves (main plus
 * suspect-impact extras), each contributing one captured system per
 * correction iteration; exceeding the bound rejects fail-closed so S3 can
 * never silently claim full every-iteration coverage.
 */
export const SPARSE_AUTO_ROUTE_MAX_CAPTURED_SYSTEMS = 512;

/** Internal kill switch, enabled by default. No persisted or UI fields. */
let autoRouteEnabled = true;

/** Disables or re-enables the automatic sparse route (internal/test-only). */
export const setSparseAutoRouteEnabled = (enabled: boolean): void => {
  autoRouteEnabled = enabled;
};

/** Reports the current kill-switch state (enabled by default). */
export const isSparseAutoRouteEnabled = (): boolean => autoRouteEnabled;

export interface SparseAutoRouteBundle {
  sparseCorrectionSolver: SparseCorrectionSolver;
  sparseRowProductsSolver: SparseRowProductsSolver;
  sparseSelectedCovarianceSolver: SparseSelectedCovarianceSolver;
}

export type SparseAutoRouteBundleLoader = () => Promise<SparseAutoRouteBundle>;

let bundleLoaderOverride: SparseAutoRouteBundleLoader | undefined;
let cachedBundlePromise: Promise<SparseAutoRouteBundle> | null = null;

/** Injects (or clears) a test-only bundle loader; clears the bundle cache. */
export const setSparseAutoRouteBundleLoader = (
  loader: SparseAutoRouteBundleLoader | undefined,
): void => {
  bundleLoaderOverride = loader;
  cachedBundlePromise = null;
};

export const resolveSparseWasmGlueUrl = (): string => {
  const base = import.meta.env.BASE_URL ?? '/';
  const locationHref = (globalThis as { location?: { href?: unknown } }).location?.href;
  if (typeof locationHref !== 'string' || locationHref.length === 0) {
    throw new Error(
      'WASM sparse bundle requires a browser worker location (fail-closed: adjustment stays TypeScript).',
    );
  }
  const basePath = base.endsWith('/') ? base : `${base}/`;
  return new URL(`${basePath}webnet_core.js`, locationHref).href;
};

const loadDefaultBundle = async (): Promise<SparseAutoRouteBundle> => {
  // Indirect dynamic import: keeps bundlers and the tsx worker-bridge
  // transform from rewriting this specifier. Any failure (blocked eval,
  // missing asset, bad shape) throws and the route falls back to
  // TypeScript via the caller.
  const indirectImport = new Function(
    'specifier',
    'return import(specifier);',
  ) as (_specifier: string) => Promise<unknown>;
  const imported = (await indirectImport(resolveSparseWasmGlueUrl())) as unknown as {
    default?: WebNetWasmFactory;
  };
  if (!imported || typeof imported.default !== 'function') {
    throw new Error('WASM sparse bundle factory unavailable.');
  }
  return createExperimentalSparseNumericalBundle(imported.default);
};

/** Loads (and caches) the real WASM sparse bundle; throws on init failure. */
export const loadSparseAutoRouteBundle = (): Promise<SparseAutoRouteBundle> => {
  if (bundleLoaderOverride) return bundleLoaderOverride();
  cachedBundlePromise ??= loadDefaultBundle().catch((error: unknown) => {
    cachedBundlePromise = null;
    throw error;
  });
  return cachedBundlePromise;
};

export interface SparseAutoRouteEligibility {
  eligible: boolean;
  reasons: string[];
  unknownCount: number | null;
}

/**
 * Derives fail-closed eligibility from parsed/prepared state plus the
 * request parse settings. Reasons append in fixed gate order so repeated
 * evaluations are byte-identical.
 */
export const deriveSparseAutoRouteEligibility = (
  request: RunSessionRequest,
): SparseAutoRouteEligibility => {
  const reasons: string[] = [];
  if (!autoRouteEnabled) {
    reasons.push('sparse auto-route disabled by kill switch');
    return { eligible: false, reasons, unknownCount: null };
  }
  const parse = request.parseSettings;
  if (parse.runMode !== 'adjustment') {
    reasons.push(`unsupported runMode '${parse.runMode}': sparse auto-route requires 'adjustment'`);
  }
  if (parse.preanalysisMode) {
    reasons.push('preanalysis mode not cleared for sparse auto-route');
  }
  if (parse.coordMode !== '2D') {
    reasons.push(`dimension '${parse.coordMode}' not cleared for sparse auto-route`);
  }
  if (parse.robustMode !== 'none') {
    reasons.push('robust reweighting not cleared for sparse auto-route');
  }
  if (parse.tsCorrelationEnabled) {
    reasons.push('TS correlation not cleared for sparse auto-route');
  }
  // Single-solve sessions only: every extra solve (suspect-impact extras,
  // auto-adjust trials, robust comparison, cluster dual-pass) would add
  // captured correction systems outside the candidate iteration count, so
  // S3 could no longer prove every-iteration coverage. Fail closed here.
  if (parse.suspectImpactMode !== 'off') {
    reasons.push(
      `suspect-impact mode '${parse.suspectImpactMode}' not cleared for sparse auto-route (single-solve sessions only)`,
    );
  }
  if (parse.autoAdjustEnabled) {
    reasons.push('auto-adjust not cleared for sparse auto-route (single-solve sessions only)');
  }
  if (parse.clusterDetectionEnabled && request.approvedClusterMerges.length > 0) {
    reasons.push(
      `cluster dual-pass (${request.approvedClusterMerges.length} approved merges) not cleared for sparse auto-route (single-solve sessions only)`,
    );
  }
  if (reasons.length > 0) return { eligible: false, reasons, unknownCount: null };
  try {
    const inlineAutoAdjust = extractAutoAdjustDirectiveFromInput(request.input);
    if (inlineAutoAdjust?.enabled) {
      reasons.push(
        'inline auto-adjust directive not cleared for sparse auto-route (single-solve sessions only)',
      );
    }
    const parsed = parseInput(request.input);
    const is2D = true;
    const active = collectActiveObservationsForSolve(parsed.observations, undefined, is2D);
    const gpsCovarianceWeighting = active.some(
      (observation) => observation.type === 'gps' && observation.gpsCovariance3d != null,
    );
    if (gpsCovarianceWeighting) {
      reasons.push('GPS covariance weighting not cleared for sparse auto-route');
    }
    const preparation = buildSolvePreparation(parsed.stations, parsed.unknowns, active, is2D);
    const unknownCount = parsed.unknowns.length;
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
    const production = evaluateSparseProductionEligibility({
      dimension: '2d',
      unknownCount,
      maxUnknownCount: SPARSE_AUTO_ROUTE_MAX_UNKNOWN_COUNT,
      runMode: 'adjustment',
      robustWeighting: false,
      tsCorrelation: false,
      gpsCovarianceWeighting,
      wasmAvailable: true,
      workerAvailable: true,
      rankRisk: preflight.eligible ? 'none' : 'suspect',
    });
    reasons.push(...production.reasons);
    return { eligible: reasons.length === 0, reasons, unknownCount };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    reasons.push(`eligibility parse failed: ${detail}`.slice(0, 300));
    return { eligible: false, reasons, unknownCount: null };
  }
};

export interface CapturedAutoRouteSystem {
  input: Phase7b7CapturedSystem;
  result: SparseCorrectionSolveResult | null;
  threw: boolean;
}

const copyCapturedSystem = (input: SparseCorrectionSolveInput): Phase7b7CapturedSystem => ({
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

/**
 * Recording decorator over the bundle correction solver. Captures every
 * correction system the sparse backend sees (one call per iteration),
 * bounded so S3 can never silently claim full every-iteration coverage.
 */
export class SparseAutoRouteCaptureSolver implements SparseCorrectionSolver {
  readonly systems: CapturedAutoRouteSystem[] = [];

  truncated = false;

  private readonly delegate: SparseCorrectionSolver;

  constructor(delegate: SparseCorrectionSolver) {
    this.delegate = delegate;
  }

  solveFromEquations(input: SparseCorrectionSolveInput): SparseCorrectionSolveResult {
    if (this.systems.length >= SPARSE_AUTO_ROUTE_MAX_CAPTURED_SYSTEMS) {
      this.truncated = true;
      return this.delegate.solveFromEquations(input);
    }
    try {
      const result = this.delegate.solveFromEquations(input);
      this.systems.push({ input: copyCapturedSystem(input), result, threw: false });
      return result;
    } catch (error) {
      this.systems.push({ input: copyCapturedSystem(input), result: null, threw: true });
      throw error;
    }
  }
}

export interface SparseAutoRouteVerification {
  accepted: boolean;
  reasons: string[];
  warnings: string[];
  oracledSystemCount: number;
  maxCorrectionDiff: number;
}

/**
 * S3 every-iteration oracle gates over all captured correction systems:
 * dense-rebuild correction agreement, undamped, finite condition evidence,
 * captured count equal to the candidate correction iteration count, and
 * result.condition agreement with the first-system oracle evidence.
 * Condition threshold excess warns (production semantics), never rejects.
 */
export const verifySparseAutoRouteSystems = (
  systems: readonly CapturedAutoRouteSystem[],
  truncated: boolean,
  iterationCount: number,
  recordedConditionEstimate?: number,
  correctionTolerance: number = PHASE7B6_CORRECTION_TOLERANCE,
  conditionThreshold: number = SPARSE_CONDITION_THRESHOLD,
): SparseAutoRouteVerification => {
  const reasons: string[] = [];
  const warnings: string[] = [];
  let oracledSystemCount = 0;
  let maxCorrectionDiff = 0;
  let firstConditionEstimate: number | undefined;
  if (truncated) {
    reasons.push(
      `oracle bound: capture truncated at ${SPARSE_AUTO_ROUTE_MAX_CAPTURED_SYSTEMS} systems (fail-closed; every-iteration coverage unproven)`,
    );
  }
  if (systems.length === 0) {
    reasons.push('s3: no correction systems captured (fail-closed)');
  } else if (systems.length !== iterationCount) {
    reasons.push(
      `s3: captured ${systems.length} systems != ${iterationCount} correction iterations (every-iteration unproven; fail-closed)`,
    );
  }
  systems.forEach((system, index) => {
    const tag = `iteration ${index + 1}`;
    oracledSystemCount += 1;
    if (system.threw || system.result == null) {
      reasons.push(`${tag}: sparse backend produced no correction (it threw; fail-closed)`);
      return;
    }
    const measured = measurePhase7b7DenseOracle(
      system.input,
      system.result.conditionEstimate,
    );
    if (!measured.denseCorrection) {
      reasons.push(`${tag}: dense rebuild produced no correction (fail-closed)`);
      return;
    }
    const sparse = Array.from(
      { length: system.input.parameterCount },
      (_, param) => system.result?.correction[param]?.[0] ?? Number.NaN,
    );
    if (sparse.length !== system.input.parameterCount) {
      reasons.push(`${tag}: correction length mismatch (fail-closed)`);
      return;
    }
    let worst = 0;
    let nonfinite = false;
    for (let param = 0; param < system.input.parameterCount; param += 1) {
      const diff = Math.abs(
        (measured.denseCorrection[param] ?? Number.NaN) - (sparse[param] ?? Number.NaN),
      );
      if (!Number.isFinite(diff)) {
        nonfinite = true;
        break;
      }
      worst = Math.max(worst, diff);
    }
    if (nonfinite) {
      maxCorrectionDiff = Number.POSITIVE_INFINITY;
      reasons.push(`${tag}: non-finite correction agreement (fail-closed)`);
      return;
    }
    maxCorrectionDiff = Math.max(maxCorrectionDiff, worst);
    if (worst > correctionTolerance) {
      reasons.push(
        `${tag}: correction agreement max diff ${worst.toExponential(2)} exceeds ${correctionTolerance}`,
      );
    }
    const damping = system.result.damping ?? Number.NaN;
    if (!Number.isFinite(damping) || damping !== 0) {
      reasons.push(`${tag}: damping=${damping} (undamped required)`);
    }
    if (measured.conditionEstimate == null || !Number.isFinite(measured.conditionEstimate)) {
      reasons.push(`${tag}: no finite condition estimate (fail-closed)`);
    } else if (measured.conditionEstimate > conditionThreshold) {
      warnings.push(
        `${tag}: normal matrix appears ill-conditioned (estimate=${measured.conditionEstimate.toExponential(3)}, threshold=${conditionThreshold.toExponential(3)}, source=${measured.conditionSource ?? 'unknown'}).`,
      );
    }
    if (index === 0 && measured.conditionEstimate != null && Number.isFinite(measured.conditionEstimate)) {
      firstConditionEstimate = measured.conditionEstimate;
    }
  });
  if (recordedConditionEstimate == null || !Number.isFinite(recordedConditionEstimate)) {
    reasons.push('condition gate: sparse result recorded no finite result.condition (fail-closed)');
  } else if (firstConditionEstimate != null) {
    const allowed = PHASE7B7_RELATIVE_TOLERANCE * Math.max(1, Math.abs(firstConditionEstimate));
    const diff = Math.abs(recordedConditionEstimate - firstConditionEstimate);
    if (!Number.isFinite(diff) || diff > allowed) {
      reasons.push(
        `condition gate: result.condition estimate ${recordedConditionEstimate.toExponential(3)} disagrees with first-system oracle ${firstConditionEstimate.toExponential(3)} (fail-closed)`,
      );
    }
  }
  return {
    accepted: reasons.length === 0,
    reasons,
    warnings,
    oracledSystemCount,
    maxCorrectionDiff,
  };
};

const isFiniteAutoRouteResult = (result: AdjustmentResult): boolean => {
  if (!Number.isFinite(result.seuw)) return false;
  for (const station of Object.values(result.stations)) {
    if (!Number.isFinite(station.x) || !Number.isFinite(station.y)) return false;
    if (station.h != null && !Number.isFinite(station.h)) return false;
  }
  return true;
};

export type SparseAutoRouteSessionFn = (
  _request: RunSessionRequest,
  _onProgress?: RunSessionProgressCallback,
  _runtime?: AdjustmentRuntime,
) => RunSessionOutcome;

export interface SparseAutoRouteDeps {
  runSession: SparseAutoRouteSessionFn;
  loadBundle?: () => Promise<SparseAutoRouteBundle>;
}

export type SparseAutoRouteName = 'typescript' | 'sparse';

export interface SparseAutoRouteAttempt {
  outcome: RunSessionOutcome;
  route: SparseAutoRouteName;
  reasons: string[];
}

/**
 * Runs the request through the sparse auto-route when eligible, else plain
 * TypeScript. Any failure along the sparse path reruns the original request
 * with no runtime, so the returned outcome is always a clean session result.
 */
export const runWithSparseAutoRoute = async (
  request: RunSessionRequest,
  onProgress: RunSessionProgressCallback | undefined,
  deps: SparseAutoRouteDeps,
): Promise<SparseAutoRouteAttempt> => {
  const eligibility = deriveSparseAutoRouteEligibility(request);
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
  const capture = new SparseAutoRouteCaptureSolver(bundle.sparseCorrectionSolver);
  const runtime: AdjustmentRuntime = {
    sparseCorrectionSolver: capture,
    sparseRowProductsSolver: bundle.sparseRowProductsSolver,
    sparseSelectedCovarianceSolver: bundle.sparseSelectedCovarianceSolver,
    experimentalSparseDiagnostics: diagnostics,
    experimentalSelectedCovarianceMode: true,
    experimentalSelectedCovarianceLegacyAllPairs: true,
  };
  let outcome: RunSessionOutcome;
  try {
    outcome = deps.runSession(request, onProgress, runtime);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      outcome: deps.runSession(request, onProgress, undefined),
      route: 'typescript',
      reasons: [`sparse run threw: ${detail}`.slice(0, 300)],
    };
  }
  const fallbackReasons: string[] = [];
  if (diagnostics.sparseCorrectionFallbacks > 0) {
    fallbackReasons.push(
      `sparse correction fallbacks=${diagnostics.sparseCorrectionFallbacks} (mixed trajectory; fail-closed)`,
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
  const verification = verifySparseAutoRouteSystems(
    capture.systems,
    capture.truncated,
    outcome.result.iterations,
    outcome.result.condition?.estimate,
  );
  fallbackReasons.push(...verification.reasons);
  if (!isFiniteAutoRouteResult(outcome.result)) {
    fallbackReasons.push('sparse result non-finite (fail-closed)');
  }
  if (fallbackReasons.length > 0) {
    return {
      outcome: deps.runSession(request, onProgress, undefined),
      route: 'typescript',
      reasons: fallbackReasons,
    };
  }
  return { outcome, route: 'sparse', reasons: [] };
};
