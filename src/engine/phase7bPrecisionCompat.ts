/**
 * Phase 7B.5 legacy all-pairs compatibility demand helpers (test-only).
 *
 * Compares Option A (dense all-entry Qxx, numParams x numParams) against
 * Option B (exact all-station compat queries without dense Qxx) and the
 * unchanged selected-network demand. Pure and deterministic; no routing,
 * tolerance, or baseline changes.
 */
import { buildCovarianceQueryPlan } from './covarianceQueryPlan';
import { dedupeSelectedQueries, stationParamCountOf } from './selectedCovarianceStore';
import type { SolveParameterIndex } from './adjustmentSolveTypes';
import type { CovariancePair } from './covarianceQueryPlan';
import type { StationId } from '../types';

export interface Phase7bCompatDemandInput {
  paramIndex: SolveParameterIndex;
  unknowns: readonly StationId[];
  connectedPairs?: readonly CovariancePair[];
  requestedPairs?: readonly CovariancePair[];
  includeHeight: boolean;
  parameterCount: number;
}

export interface Phase7bCompatDemandReport {
  stationParamCount: number;
  parameterCount: number;
  /** Option A: dense all-entry n^2 demand. */
  denseAllEntryQueries: number;
  /** Option B: deduped exact all-station compat queries (no dense Qxx). */
  compatSelectedQueries: number;
  /** Unchanged selected-network demand (no all-pairs). */
  selectedNetworkQueries: number;
  /** Compat saving versus dense, in (0,1] when compat < dense. */
  compatFractionOfDense: number;
  selectedFractionOfDense: number;
}

const planQueryCount = (input: Phase7bCompatDemandInput, compat: boolean): number => {
  const plan = buildCovarianceQueryPlan({
    paramIndex: input.paramIndex,
    unknowns: input.unknowns,
    stationParamCount: stationParamCountOf(input.paramIndex),
    connectedPairs: input.connectedPairs,
    requestedPairs: input.requestedPairs,
    includeHeight: input.includeHeight,
    includeAllStationPairs: compat,
  });
  return dedupeSelectedQueries(plan.queries).length;
};

/** Deterministic Option A versus Option B demand comparison. */
export const comparePhase7bCompatDemand = (
  input: Phase7bCompatDemandInput,
): Phase7bCompatDemandReport => {
  const stationParamCount = stationParamCountOf(input.paramIndex);
  const denseAllEntryQueries = input.parameterCount * input.parameterCount;
  const compatSelectedQueries = planQueryCount(input, true);
  const selectedNetworkQueries = planQueryCount(input, false);
  return {
    stationParamCount,
    parameterCount: input.parameterCount,
    denseAllEntryQueries,
    compatSelectedQueries,
    selectedNetworkQueries,
    compatFractionOfDense:
      denseAllEntryQueries > 0 ? compatSelectedQueries / denseAllEntryQueries : 0,
    selectedFractionOfDense:
      denseAllEntryQueries > 0 ? selectedNetworkQueries / denseAllEntryQueries : 0,
  };
};
