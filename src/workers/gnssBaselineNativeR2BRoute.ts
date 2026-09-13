/**
 * Phase 12F.4 worker-only bounded native static-GNSS R2B production route.
 *
 * DEFAULT ON for the certified cohort: the kill switch below stays true, so
 * eligible production jobs route native-sparse-selected-qxx unless a caller
 * explicitly disables the route (kill switch OFF forces clean TypeScript).
 *
 * Certified cohort (frozen 12F.3 classifier): GNSS-only ECEF single-solve
 * sessions, worker-only, robust OFF, bridgeless graphs (F-BRIDGE stays
 * TS-dense), params in [225, 2250], total stations <= 750, selected blocks
 * <= 4000, factor nnz <= 1.5M. R1 stays default OFF and is never a fallback.
 *
 * Option-A reuse: TS owns parse/frame/preflight/setup/assembly/residuals/
 * loops/reports; native supplies ONLY the sparse correction solve
 * (existing `solveAdjustmentIteration` seam) and the deduplicated
 * selected-block covariances (one batched `queryBlocks` bridge call).
 * Verification is the production `verifyGnssSelectedBlocks` gate (exact
 * 12F.2 evidence thresholds) plus the engine redundancy-identity gate;
 * S3 proves every correction iteration via
 * `SparseAutoRouteCaptureSolver` + `verifySparseAutoRouteSystems`.
 * Phase-12D TS postprocessing is shared: any native failure reruns the
 * identical input through clean TypeScript.
 *
 * Cohort: GNSS-only ECEF single-solve sessions, bridgeless graphs
 * (F-BRIDGE stays TS-dense, same as R1), params in [MIN, MAX].
 * Provisional bounds below (perf phase finalizes): keep as exported
 * constants. Legacy gps/G routes are untouched and never admitted here.
 *
 * No math/tolerance/GVX/UI/RINEX changes. No new C++ API. NEVER falls
 * back to R1 and NEVER touches the full-Qxx path.
 */
import {
  runGnssBaselineAdjustment,
  type GnssBaselineAdjustInput,
  type GnssBaselineAdjustResult,
} from '../engine/gnssBaselineAdjust';
import { classifyGnssDatumComponents } from '../engine/gnssFreeNetwork';
import { validateGnssBaselineCovariance } from '../engine/gnssBaselineCovariance';
import { gnssBaselineComponents } from '../engine/gnssBaselinePreflight';
import { buildSolveParameterIndex } from '../engine/adjustmentPreprocessing';
import { buildGnssSelectedBlockPlan } from '../engine/gnssSelectedBlockPlan';
import { queryGnssSelectedBlocks } from '../engine/gnssSelectedBlockQuery';
import type { StationMap } from '../types';
import type {
  SparseCorrectionSolver,
  SparseSelectedBlockSolver,
} from '../engine/numericalBackend';
import {
  packSparseDesignRows,
  packUpperTriangleWeights,
} from '../engine/sparseEquationPacking';
import {
  loadSparseAutoRouteBundle,
  SparseAutoRouteCaptureSolver,
  verifySparseAutoRouteSystems,
  type SparseAutoRouteBundle,
} from './adjustmentSparseAutoRoute';
import {
  countGnssNativeR1Params,
  findGnssBaselineBridges,
} from './gnssBaselineNativeR1Route';

/** Provisional R2B cohort lower bound (perf phase finalizes). */
export const GNSS_NATIVE_R2B_MIN_PARAMS = 225;

/** Provisional R2B cap on total stations (perf phase finalizes). */
export const GNSS_NATIVE_R2B_MAX_TOTAL_STATIONS = 750;

/** Provisional R2B cohort upper bound (perf phase finalizes). */
export const GNSS_NATIVE_R2B_MAX_PARAMS = 2250;

/** Provisional R2B cap on selected 3x3 blocks (perf phase finalizes). */
export const GNSS_NATIVE_R2B_MAX_BLOCKS = 4000;

/** Provisional R2B pre-solve fill gate on native factor nnz (perf phase finalizes). */
export const GNSS_NATIVE_R2B_MAX_FACTOR_NNZ = 1500000;

/** Pre-solve fill-gate trip: correction factor too dense for the R2B cohort. */
export class FillGateError extends Error {
  constructor(detail: string) {
    super(`GNSS R2B fill gate tripped: ${detail}.`);
    this.name = 'FillGateError';
  }
}

/** Dedicated GNSS R2B kill switch, default ON (certified cohort, Phase 12F.4). */
let gnssNativeR2BEnabled = true;

/** Enables/disables the GNSS native R2B route (internal/test-only). */
export const setGnssNativeR2BRouteEnabled = (enabled: boolean): void => {
  gnssNativeR2BEnabled = enabled;
};

/** Reports the GNSS native R2B kill-switch state (default ON). */
export const isGnssNativeR2BRouteEnabled = (): boolean => gnssNativeR2BEnabled;

export interface GnssNativeR2BEligibility {
  eligible: boolean;
  reasons: string[];
  numParams: number | null;
  selectedBlockCount: number | null;
}

export interface GnssNativeR2BEligibilityOptions {
  /** Worker-only route: caller must pass true (WASM lives in the worker). */
  isWorker?: boolean;
  /** False (or failed bundle load) => ineligible. */
  wasmAvailable?: boolean;
  /** False => the block API is absent => ineligible. */
  blockApiAvailable?: boolean;
  /** Diagnostic seams for tests ONLY; production omits them. */
  minParams?: number;
  maxTotalStations?: number;
  maxParams?: number;
  maxBlocks?: number;
}

const isFullyFixed = (stationId: string, stations: StationMap): boolean => {
  const station = stations[stationId];
  return !!station && !!station.fixedX && !!station.fixedY && !!station.fixedH;
};

/**
 * Selected-block count over the canonical plan (fail-closed: any plan
 * build fault is an eligibility reason, never an exception).
 */
const measureSelectedBlocks = (
  input: Pick<GnssBaselineAdjustInput, 'stations' | 'baselines'>,
  numParams: number,
): { count: number; freeFreeEdges: number } => {
  const components = gnssBaselineComponents([...input.baselines].sort((a, b) => a.id - b.id));
  const unknowns = components
    .flat()
    .filter((stationId) => {
      const station = input.stations[stationId];
      return !!station && !isFullyFixed(stationId, input.stations);
    })
    .sort();
  const { paramIndex, stationParamCount } = buildSolveParameterIndex(input.stations, unknowns, false);
  if (stationParamCount !== numParams) {
    throw new Error(`parameter recount ${stationParamCount} != ${numParams}`);
  }
  const plan = buildGnssSelectedBlockPlan(
    paramIndex,
    input.baselines.map((baseline) => ({ from: baseline.from, to: baseline.to })),
    numParams,
  );
  return { count: plan.counts.uniqueBlocks, freeFreeEdges: plan.counts.uniqueFreeFreeEdges };
};

/** Fail-closed eligibility in fixed gate order (reasons byte-identical on repeat). */
export const deriveGnssNativeR2BEligibility = (
  input: Pick<GnssBaselineAdjustInput, 'stations' | 'baselines'>,
  options: GnssNativeR2BEligibilityOptions = {},
): GnssNativeR2BEligibility => {
  const reasons: string[] = [];
  const minParams = options.minParams ?? GNSS_NATIVE_R2B_MIN_PARAMS;
  const maxTotalStations = options.maxTotalStations ?? GNSS_NATIVE_R2B_MAX_TOTAL_STATIONS;
  const maxParams = options.maxParams ?? GNSS_NATIVE_R2B_MAX_PARAMS;
  const maxBlocks = options.maxBlocks ?? GNSS_NATIVE_R2B_MAX_BLOCKS;
  if (!gnssNativeR2BEnabled) {
    reasons.push('GNSS native R2B route disabled by kill switch (default ON)');
    return { eligible: false, reasons, numParams: null, selectedBlockCount: null };
  }
  if (options.isWorker !== true) {
    reasons.push('GNSS native R2B requires worker context (WASM lives in the worker)');
    return { eligible: false, reasons, numParams: null, selectedBlockCount: null };
  }
  if (options.wasmAvailable === false) {
    reasons.push('WASM bundle unavailable for GNSS native R2B');
    return { eligible: false, reasons, numParams: null, selectedBlockCount: null };
  }
  if (options.blockApiAvailable === false) {
    reasons.push('WASM block API (queryBlocks) unavailable for GNSS native R2B');
    return { eligible: false, reasons, numParams: null, selectedBlockCount: null };
  }
  if (input.baselines.length === 0) {
    reasons.push('no baselines (fail-closed)');
    return { eligible: false, reasons, numParams: null, selectedBlockCount: null };
  }
  for (const baseline of input.baselines) {
    if (baseline.type !== 'gnssBaseline' || baseline.frame !== 'ecef') {
      reasons.push(
        `baseline ${baseline.id}: only ECEF gnssBaseline admitted (never legacy G/GPS)`,
      );
      return { eligible: false, reasons, numParams: null, selectedBlockCount: null };
    }
    try {
      validateGnssBaselineCovariance(baseline.covariance, `baseline ${baseline.id}`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      reasons.push(`baseline ${baseline.id}: invalid 3x3 covariance: ${detail}`.slice(0, 300));
      return { eligible: false, reasons, numParams: null, selectedBlockCount: null };
    }
  }
  const bridges = findGnssBaselineBridges(input);
  if (bridges.length > 0) {
    const shown = bridges
      .slice(0, 3)
      .map((bridge) => `${bridge.from}-${bridge.to}`)
      .join(', ');
    reasons.push(
      `bridged graph (${bridges.length} cut-edge(s), e.g. ${shown}): F-BRIDGE stays TS-dense`,
    );
  }
  let numParams: number | null = null;
  try {
    numParams = countGnssNativeR1Params(input);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    reasons.push(`parameter count unmeasurable: ${detail}`.slice(0, 300));
    return { eligible: false, reasons, numParams: null, selectedBlockCount: null };
  }
  if (!Number.isFinite(numParams) || numParams <= 0) {
    reasons.push('unmeasurable parameter count (fail-closed)');
    return { eligible: false, reasons, numParams: null, selectedBlockCount: null };
  }
  if (numParams < minParams) {
    reasons.push(
      `parameter count ${numParams} below R2B perf floor ${minParams} (correct but slower; stays TS)`,
    );
  }
  const totalStations = Object.keys(input.stations).length;
  if (totalStations > maxTotalStations) {
    reasons.push(`station count ${totalStations} exceeds R2B cap ${maxTotalStations} (fail-closed)`);
  }
  if (numParams > maxParams) {
    reasons.push(`parameter count ${numParams} exceeds R2B cap ${maxParams} (fail-closed)`);
  }
  let selectedBlockCount: number | null = null;
  try {
    selectedBlockCount = measureSelectedBlocks(input, numParams).count;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    reasons.push(`selected-block plan unmeasurable: ${detail}`.slice(0, 300));
    return { eligible: false, reasons, numParams, selectedBlockCount: null };
  }
  if (selectedBlockCount > maxBlocks) {
    reasons.push(`selected-block count ${selectedBlockCount} exceeds R2B cap ${maxBlocks} (fail-closed)`);
  }
  return { eligible: reasons.length === 0, reasons, numParams, selectedBlockCount };
};

export type GnssNativeR2BRouteName = 'typescript' | 'native-sparse-selected-qxx';

export interface GnssNativeR2BAttempt {
  result: GnssBaselineAdjustResult;
  route: GnssNativeR2BRouteName;
  reasons: string[];
}

export interface GnssNativeR2BDeps {
  isWorker?: boolean;
  loadBundle?: () => Promise<SparseAutoRouteBundle>;
  /** Test-only fault-injection seam: stub solvers bypass WASM. */
  correctionSolverOverride?: SparseCorrectionSolver;
  blockSolverOverride?: SparseSelectedBlockSolver;
  /** Test-only diagnostic bounds seam; production omits it. */
  minParams?: number;
  maxTotalStations?: number;
  maxParams?: number;
  maxBlocks?: number;
  maxFactorNnz?: number;
}

const isFiniteGnssR2BResult = (result: GnssBaselineAdjustResult): boolean => {
  if (!Number.isFinite(result.weightedResidualSum) || !Number.isFinite(result.varianceFactor)) {
    return false;
  }
  for (const station of Object.values(result.stations)) {
    if (!Number.isFinite(station.x) || !Number.isFinite(station.y)) return false;
    if (station.h != null && !Number.isFinite(station.h)) return false;
  }
  return true;
};

const cleanTypescriptResult = (input: GnssBaselineAdjustInput): GnssBaselineAdjustResult => {
  const { nativeRuntime: _dropped, ...tsInput } = input;
  return runGnssBaselineAdjustment(tsInput);
};

/**
 * Runs the input through native R2B when eligible, else plain TypeScript.
 * Every native failure (bundle init, missing block API, fill-gate trip,
 * throw, non-convergence, non-finite, S3 reject, damped blocks,
 * verification/identity reject) reruns the original input in clean
 * TypeScript, so the returned result is always a full production result
 * with accurate provenance. NEVER falls back to R1.
 */
export const runGnssBaselineWithNativeR2B = async (
  input: GnssBaselineAdjustInput,
  deps: GnssNativeR2BDeps = {},
): Promise<GnssNativeR2BAttempt> => {
  // Phase 12I.1: free networks never enter R2B (TS-dense inner datum only).
  if ((input.datumMode ?? 'constrained') === 'allow-free') {
    const classification = classifyGnssDatumComponents(input.stations, input.baselines);
    if (classification.freeComponents.length > 0) {
      return {
        result: cleanTypescriptResult(input),
        route: 'typescript',
        reasons: [
          `free-network allow-free with ${classification.freeComponents.length} free component(s): ` +
            'native R2B not admitted, clean TypeScript inner-constraint solve (fail-closed)',
        ],
      };
    }
  }
  const eligibility = deriveGnssNativeR2BEligibility(input, {
    isWorker: deps.isWorker,
    wasmAvailable: deps.correctionSolverOverride ?? deps.blockSolverOverride ? true : undefined,
    blockApiAvailable: deps.blockSolverOverride
      ? typeof (deps.blockSolverOverride as { queryBlocks?: unknown }).queryBlocks === 'function'
      : undefined,
    minParams: deps.minParams,
    maxTotalStations: deps.maxTotalStations,
    maxParams: deps.maxParams,
    maxBlocks: deps.maxBlocks,
  });
  if (!eligibility.eligible) {
    return { result: cleanTypescriptResult(input), route: 'typescript', reasons: eligibility.reasons };
  }
  let correctionSolver: SparseCorrectionSolver;
  let blockSolver: SparseSelectedBlockSolver;
  if (deps.correctionSolverOverride && deps.blockSolverOverride) {
    correctionSolver = deps.correctionSolverOverride;
    blockSolver = deps.blockSolverOverride;
  } else {
    let bundle: SparseAutoRouteBundle;
    try {
      bundle = await (deps.loadBundle ?? loadSparseAutoRouteBundle)();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return {
        result: cleanTypescriptResult(input),
        route: 'typescript',
        reasons: [`WASM bundle init failed: ${detail}`.slice(0, 300)],
      };
    }
    correctionSolver = bundle.sparseCorrectionSolver;
    const candidate = bundle.sparseSelectedCovarianceSolver as unknown as Partial<SparseSelectedBlockSolver>;
    if (typeof candidate.queryBlocks !== 'function') {
      return {
        result: cleanTypescriptResult(input),
        route: 'typescript',
        reasons: ['WASM block API (queryBlocks) unavailable for GNSS native R2B'],
      };
    }
    blockSolver = candidate as SparseSelectedBlockSolver;
  }
  const maxFactorNnz = deps.maxFactorNnz ?? GNSS_NATIVE_R2B_MAX_FACTOR_NNZ;
  // Capture decorator proves every correction iteration (S3); the provider
  // closure below reads the final captured factor nnz for the pre-solve
  // fill gate before any block query reaches the bridge.
  const correctionCapture = new SparseAutoRouteCaptureSolver(correctionSolver);
  let providerCalls = 0;
  const failClosed = (reasons: string[]): GnssNativeR2BAttempt => ({
    result: cleanTypescriptResult(input),
    route: 'typescript',
    reasons,
  });
  let native: GnssBaselineAdjustResult;
  try {
    native = runGnssBaselineAdjustment({
      ...input,
      nativeRuntime: {
        sparseCorrectionSolver: correctionCapture,
        nativeSelectedBlocksProvider: ({ sparseRows, weights, numParams, plan, paramIndex }) => {
          providerCalls += 1;
          const last = correctionCapture.systems[correctionCapture.systems.length - 1];
          const factorNnz = last?.result?.factorNnz;
          if (last == null || last.threw || last.result == null || !Number.isFinite(factorNnz)) {
            throw new FillGateError('no captured correction factor (fail-closed)');
          }
          if ((factorNnz as number) > maxFactorNnz) {
            throw new FillGateError(`factorNnz ${factorNnz} exceeds cap ${maxFactorNnz}`);
          }
          return queryGnssSelectedBlocks({
            plan,
            paramIndex,
            system: {
              design: packSparseDesignRows(sparseRows),
              weights: packUpperTriangleWeights(weights, weights.length),
              observationEquationCount: weights.length,
              parameterCount: numParams,
            },
            solver: blockSolver,
          });
        },
      },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return failClosed([`native R2B run threw: ${detail}`.slice(0, 300)]);
  }
  const fallbackReasons: string[] = [];
  if (!native.converged) fallbackReasons.push('native R2B result not converged (fail-closed)');
  if (!isFiniteGnssR2BResult(native)) fallbackReasons.push('native R2B result non-finite (fail-closed)');
  if (native.routeProvenance !== 'native-sparse-selected-qxx' || !('selectedBlocks' in native)) {
    fallbackReasons.push('native R2B provenance unproven (fail-closed)');
  }
  if (providerCalls !== 1) {
    fallbackReasons.push(`native R2B provider calls ${providerCalls} != 1 (fail-closed)`);
  }
  const s3 = verifySparseAutoRouteSystems(
    correctionCapture.systems,
    correctionCapture.truncated,
    native.iterations,
    native.conditionEstimate,
  );
  fallbackReasons.push(...s3.reasons);
  if (native.routeProvenance === 'native-sparse-selected-qxx' && 'selectedBlocks' in native) {
    if (native.selectedBlocks.meta.dampingAttempts !== 0) {
      fallbackReasons.push(
        `native R2B blocks damped (attempts=${native.selectedBlocks.meta.dampingAttempts}; fail-closed)`,
      );
    }
    if (native.selectedBlocks.meta.factorNnz > maxFactorNnz) {
      fallbackReasons.push(
        `native R2B post-hoc factorNnz ${native.selectedBlocks.meta.factorNnz} exceeds cap ${maxFactorNnz} (fail-closed)`,
      );
    }
  }
  if (fallbackReasons.length > 0) return failClosed(fallbackReasons);
  return { result: native, route: 'native-sparse-selected-qxx', reasons: [] };
};
