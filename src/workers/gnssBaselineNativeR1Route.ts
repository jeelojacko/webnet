/**
 * Phase 12F.1 worker-only bounded native static-GNSS R1 production proof.
 *
 * PRODUCTION PROOF but DEFAULT OFF: the kill switch below stays false, so
 * production behavior is bit-identical TypeScript unless a caller
 * explicitly enables the route (tests/manual evidence only).
 *
 * Option-A reuse (Phase 12F.0 §21/§22): TS owns parse/frame/preflight/
 * setup/assembly/residuals/statistics/loops/reports; native supplies ONLY
 * the sparse correction solve (existing `solveAdjustmentIteration` seam)
 * and the full dense Qxx (all-entry `querySelected`, the 10I route
 * pattern). Verification reuses the 10I C1/C2/C3 checks verbatim — never
 * weaker — via `NativeFullQxxCaptureSolver` (inline reject throws before
 * values reach the engine) plus S3 every-iteration correction proof via
 * `SparseAutoRouteCaptureSolver` + `verifySparseAutoRouteSystems`.
 * Phase-12D TS postprocessing is shared: any native failure reruns the
 * identical input through clean TypeScript.
 *
 * Cohort: GNSS-only ECEF single-solve sessions, bridgeless graphs
 * (F-BRIDGE: cut-edges trip the shared TS eigen gate once dof > 0, so
 * they stay TS), params in [MIN, MAX]. Setup augmentation stays TS-side
 * (effective 3x3 to native, raw on `rawCovariance`). Legacy gps/G routes
 * are untouched and never admitted here.
 *
 * No math/tolerance/GVX/UI/RINEX changes. No new C++ API.
 */
import { runGnssBaselineAdjustment, type GnssBaselineAdjustInput } from '../engine/gnssBaselineAdjust';
import type { GnssBaselineAdjustResult } from '../engine/gnssBaselineAdjust';
import { validateGnssBaselineCovariance } from '../engine/gnssBaselineCovariance';
import { gnssBaselineComponents } from '../engine/gnssBaselinePreflight';
import type { StationMap } from '../types';
import type {
  SparseSelectedCovarianceSolver,
  SparseCorrectionSolver,
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
import { NativeFullQxxCaptureSolver } from './adjustmentNativeFullQxxAutoRoute';

/**
 * R1 cohort upper bound: mesh-250 (p=747) proven in the 12F.0 audit with
 * margin under the 768 native cap. Never equate gnssBaseline with legacy
 * G/GPS: this route admits gnssBaseline ONLY.
 */
export const GNSS_NATIVE_R1_MAX_PARAMS = 750;

/**
 * R1 cohort lower bound (perf gate, not correctness): native ≈ TS at
 * p ≤ 72 (sub-ms noise), R1 ~2× faster at p = 147, clearly faster ≥ 297
 * (12F.0 §20 TOTAL-wall-time medians). 150 sits just above the observed
 * crossover band (~100–150); below it the route is correct but slower,
 * so it stays TS.
 */
export const GNSS_NATIVE_R1_MIN_PARAMS = 150;

/** Dedicated GNSS R1 kill switch, default OFF (production proof only). */
let gnssNativeR1Enabled = false;

/** Enables/disables the GNSS native R1 route (internal/test-only). */
export const setGnssNativeR1RouteEnabled = (enabled: boolean): void => {
  gnssNativeR1Enabled = enabled;
};

/** Reports the GNSS native R1 kill-switch state (default OFF). */
export const isGnssNativeR1RouteEnabled = (): boolean => gnssNativeR1Enabled;

export interface GnssNativeR1Eligibility {
  eligible: boolean;
  reasons: string[];
  numParams: number | null;
}

export interface GnssNativeR1EligibilityOptions {
  /** Worker-only route: caller must pass true (WASM lives in the worker). */
  isWorker?: boolean;
  /** False (or failed bundle load) => ineligible. */
  wasmAvailable?: boolean;
  /** Diagnostic seam for tests ONLY; production omits it. */
  minParams?: number;
  maxParams?: number;
}

const isFullyFixed = (stationId: string, stations: StationMap): boolean => {
  const station = stations[stationId];
  return !!station && !!station.fixedX && !!station.fixedY && !!station.fixedH;
};

/**
 * Cut-edge (bridge) detection over baseline endpoints (iterative Tarjan,
 * deterministic). A bridge carries ~zero redundancy, so once dof > 0 its
 * Qvv block trips the shared TS eigen PSD gate (F-BRIDGE) — native
 * neither causes nor fixes it, so bridged graphs stay TS-dense.
 */
export const findGnssBaselineBridges = (
  input: Pick<GnssBaselineAdjustInput, 'stations' | 'baselines'>,
): Array<{ from: string; to: string }> => {
  const adjacency = new Map<string, Map<string, number>>();
  const link = (a: string, b: string, id: number): void => {
    if (!adjacency.has(a)) adjacency.set(a, new Map());
    if (!adjacency.has(b)) adjacency.set(b, new Map());
    adjacency.get(a)?.set(b, id);
    adjacency.get(b)?.set(a, id);
  };
  input.baselines.forEach((baseline) => link(baseline.from, baseline.to, baseline.id));
  const disc = new Map<string, number>();
  const low = new Map<string, number>();
  const bridges: Array<{ from: string; to: string }> = [];
  let clock = 0;
  const stations = [...adjacency.keys()].sort();
  stations.forEach((root) => {
    if (disc.has(root)) return;
    // Iterative DFS carrying the edge id used to arrive (parallel edges
    // between the same pair are distinct ids, so repeated edges never
    // count as bridges).
    const stack: Array<{ node: string; parentEdge: number; childIdx: string[] }> = [
      { node: root, parentEdge: -1, childIdx: [...(adjacency.get(root)?.keys() ?? [])].sort() },
    ];
    disc.set(root, clock);
    low.set(root, clock);
    clock += 1;
    const parent = new Map<string, { node: string; edge: number }>();
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      if (frame.childIdx.length === 0) {
        stack.pop();
        const up = parent.get(frame.node);
        if (up) {
          const upLow = low.get(up.node) ?? 0;
          low.set(up.node, Math.min(upLow, low.get(frame.node) ?? 0));
          if ((low.get(frame.node) ?? 0) > (disc.get(up.node) ?? 0)) {
            bridges.push({ from: up.node, to: frame.node });
          }
        }
        continue;
      }
      const next = frame.childIdx.pop() as string;
      const edgeId = adjacency.get(frame.node)?.get(next) ?? -1;
      if (edgeId === frame.parentEdge) continue;
      if (disc.has(next)) {
        low.set(frame.node, Math.min(low.get(frame.node) ?? 0, disc.get(next) ?? 0));
      } else {
        parent.set(next, { node: frame.node, edge: edgeId });
        disc.set(next, clock);
        low.set(next, clock);
        clock += 1;
        stack.push({
          node: next,
          parentEdge: edgeId,
          childIdx: [...(adjacency.get(next)?.keys() ?? [])].sort(),
        });
      }
    }
  });
  bridges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  return bridges;
};

/** Parameter count with the exact production unknowns rule (sorted free stations × 3). */
export const countGnssNativeR1Params = (
  input: Pick<GnssBaselineAdjustInput, 'stations' | 'baselines'>,
): number => {
  const components = gnssBaselineComponents([...input.baselines].sort((a, b) => a.id - b.id));
  const unknowns = components
    .flat()
    .filter((stationId) => {
      const station = input.stations[stationId];
      return !!station && !isFullyFixed(stationId, input.stations);
    })
    .sort();
  return 3 * unknowns.length;
};

/** Fail-closed eligibility in fixed gate order (reasons byte-identical on repeat). */
export const deriveGnssNativeR1Eligibility = (
  input: Pick<GnssBaselineAdjustInput, 'stations' | 'baselines'>,
  options: GnssNativeR1EligibilityOptions = {},
): GnssNativeR1Eligibility => {
  const reasons: string[] = [];
  const minParams = options.minParams ?? GNSS_NATIVE_R1_MIN_PARAMS;
  const maxParams = options.maxParams ?? GNSS_NATIVE_R1_MAX_PARAMS;
  if (!gnssNativeR1Enabled) {
    reasons.push('GNSS native R1 route disabled by kill switch (default OFF)');
    return { eligible: false, reasons, numParams: null };
  }
  if (options.isWorker !== true) {
    reasons.push('GNSS native R1 requires worker context (WASM lives in the worker)');
    return { eligible: false, reasons, numParams: null };
  }
  if (options.wasmAvailable === false) {
    reasons.push('WASM bundle unavailable for GNSS native R1');
    return { eligible: false, reasons, numParams: null };
  }
  if (input.baselines.length === 0) {
    reasons.push('no baselines (fail-closed)');
    return { eligible: false, reasons, numParams: null };
  }
  for (const baseline of input.baselines) {
    if (baseline.type !== 'gnssBaseline' || baseline.frame !== 'ecef') {
      reasons.push(
        `baseline ${baseline.id}: only ECEF gnssBaseline admitted (never legacy G/GPS)`,
      );
      return { eligible: false, reasons, numParams: null };
    }
    try {
      validateGnssBaselineCovariance(baseline.covariance, `baseline ${baseline.id}`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      reasons.push(`baseline ${baseline.id}: invalid 3x3 covariance: ${detail}`.slice(0, 300));
      return { eligible: false, reasons, numParams: null };
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
    return { eligible: false, reasons, numParams: null };
  }
  if (!Number.isFinite(numParams) || numParams <= 0) {
    reasons.push('unmeasurable parameter count (fail-closed)');
    return { eligible: false, reasons, numParams: null };
  }
  if (numParams < minParams) {
    reasons.push(
      `parameter count ${numParams} below R1 perf floor ${minParams} (correct but slower; stays TS)`,
    );
  }
  if (numParams > maxParams) {
    reasons.push(`parameter count ${numParams} exceeds R1 cap ${maxParams} (fail-closed)`);
  }
  return { eligible: reasons.length === 0, reasons, numParams };
};

export type GnssNativeR1RouteName = 'typescript' | 'native-sparse-full-qxx';

export interface GnssNativeR1Attempt {
  result: GnssBaselineAdjustResult;
  route: GnssNativeR1RouteName;
  reasons: string[];
}

export interface GnssNativeR1Deps {
  isWorker?: boolean;
  loadBundle?: () => Promise<SparseAutoRouteBundle>;
  /** Test-only fault-injection seam: stub solvers bypass WASM. */
  correctionSolverOverride?: SparseCorrectionSolver;
  covarianceSolverOverride?: SparseSelectedCovarianceSolver;
  /** Test-only diagnostic bounds seam; production omits it. */
  minParams?: number;
  maxParams?: number;
}

const isFiniteGnssResult = (result: GnssBaselineAdjustResult): boolean => {
  if (!Number.isFinite(result.weightedResidualSum) || !Number.isFinite(result.varianceFactor)) {
    return false;
  }
  for (const station of Object.values(result.stations)) {
    if (!Number.isFinite(station.x) || !Number.isFinite(station.y)) return false;
    if (station.h != null && !Number.isFinite(station.h)) return false;
  }
  return result.qxx.every((row) => row.every((value) => Number.isFinite(value)));
};

const cleanTypescriptResult = (input: GnssBaselineAdjustInput): GnssBaselineAdjustResult => {
  const { nativeRuntime: _dropped, ...tsInput } = input;
  return runGnssBaselineAdjustment(tsInput);
};

/**
 * Runs the input through native R1 when eligible, else plain TypeScript.
 * Every native failure (bundle init, throw, non-convergence,
 * non-finite, S3/C1/C2/C3 reject, dimension fault) reruns the original
 * input in clean TypeScript, so the returned result is always a full
 * production result with accurate provenance.
 */
export const runGnssBaselineWithNativeR1 = async (
  input: GnssBaselineAdjustInput,
  deps: GnssNativeR1Deps = {},
): Promise<GnssNativeR1Attempt> => {
  const eligibility = deriveGnssNativeR1Eligibility(input, {
    isWorker: deps.isWorker,
    wasmAvailable: deps.correctionSolverOverride ?? deps.covarianceSolverOverride ? true : undefined,
    minParams: deps.minParams,
    maxParams: deps.maxParams,
  });
  if (!eligibility.eligible) {
    return { result: cleanTypescriptResult(input), route: 'typescript', reasons: eligibility.reasons };
  }
  let correctionSolver: SparseCorrectionSolver;
  let covarianceSolver: SparseSelectedCovarianceSolver;
  if (deps.correctionSolverOverride && deps.covarianceSolverOverride) {
    correctionSolver = deps.correctionSolverOverride;
    covarianceSolver = deps.covarianceSolverOverride;
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
    covarianceSolver = bundle.sparseSelectedCovarianceSolver;
  }
  const maxParams = deps.maxParams ?? GNSS_NATIVE_R1_MAX_PARAMS;
  // Capture decorators verify the ACTUAL native values: S3 proves every
  // correction iteration; the Qxx capture verifies C1/C2/C3 inline and
  // throws before rejected values reach the engine.
  const correctionCapture = new SparseAutoRouteCaptureSolver(correctionSolver);
  const covarianceCapture = new NativeFullQxxCaptureSolver(covarianceSolver, undefined, maxParams);
  const failClosed = (reasons: string[]): GnssNativeR1Attempt => ({
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
        nativeQxxProvider: ({ sparseRows, weights, numParams }) => {
          const packedDesign = packSparseDesignRows(sparseRows);
          const packedWeights = packUpperTriangleWeights(weights, weights.length);
          const queryRows: number[] = [];
          const queryColumns: number[] = [];
          for (let row = 0; row < numParams; row += 1) {
            for (let column = 0; column < numParams; column += 1) {
              queryRows.push(row);
              queryColumns.push(column);
            }
          }
          const queried = covarianceCapture.querySelected({
            design: packedDesign,
            weights: packedWeights,
            observationEquationCount: weights.length,
            parameterCount: numParams,
            queryRows: Int32Array.from(queryRows),
            queryColumns: Int32Array.from(queryColumns),
          });
          const qxx: number[][] = [];
          for (let row = 0; row < numParams; row += 1) {
            qxx.push([...queried.covariance.slice(row * numParams, (row + 1) * numParams)]);
          }
          return qxx;
        },
      },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return failClosed([`native R1 run threw: ${detail}`.slice(0, 300)]);
  }
  const fallbackReasons: string[] = [];
  if (!native.converged) fallbackReasons.push('native R1 result not converged (fail-closed)');
  if (!isFiniteGnssResult(native)) fallbackReasons.push('native R1 result non-finite (fail-closed)');
  if (native.routeProvenance !== 'native-sparse-full-qxx') {
    fallbackReasons.push('native R1 provenance unproven (fail-closed)');
  }
  if (covarianceCapture.systems.length !== 1) {
    fallbackReasons.push(
      `native R1 captured ${covarianceCapture.systems.length} Qxx systems != 1 (fail-closed)`,
    );
  }
  const s3 = verifySparseAutoRouteSystems(
    correctionCapture.systems,
    correctionCapture.truncated,
    native.iterations,
    native.conditionEstimate,
  );
  fallbackReasons.push(...s3.reasons);
  if (fallbackReasons.length > 0) return failClosed(fallbackReasons);
  return { result: native, route: 'native-sparse-full-qxx', reasons: [] };
};
