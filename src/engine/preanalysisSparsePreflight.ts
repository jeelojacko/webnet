import type { ParseResult } from '../types';
import {
  buildSolvePreparation,
  collectActiveObservationsForSolve,
} from './adjustmentPreprocessing';

/** Hold back when orientation params exceed this count AND the fraction gate also trips. Strict `>` semantics. */
export const PREANALYSIS_SPARSE_PREFLIGHT_MAX_ORIENTATION_PARAMETERS = 16;

/** Hold back when the orientation share of predicted params exceeds this fraction. Strict `>` semantics. */
export const PREANALYSIS_SPARSE_PREFLIGHT_MAX_ORIENTATION_FRACTION = 0.25;

export interface PreanalysisSparsePreflight {
  stationUnknownCount: number;
  coordinateParameterCount: number;
  orientationParameterCount: number;
  predictedParameterCount: number;
  orientationFraction: number;
  admitted: boolean;
  reason: string | null;
}

/** Exact holdback predicate: strictly more than 16 AND strictly more than 25%. */
export const isDirectionHeavyPreflightHoldback = (
  orientationParameterCount: number,
  predictedParameterCount: number,
): boolean => {
  if (
    !Number.isFinite(orientationParameterCount) ||
    !Number.isFinite(predictedParameterCount) ||
    predictedParameterCount <= 0 ||
    orientationParameterCount < 0
  ) {
    return true;
  }
  const fraction = orientationParameterCount / predictedParameterCount;
  if (!Number.isFinite(fraction)) return true;
  return (
    orientationParameterCount > PREANALYSIS_SPARSE_PREFLIGHT_MAX_ORIENTATION_PARAMETERS &&
    fraction > PREANALYSIS_SPARSE_PREFLIGHT_MAX_ORIENTATION_FRACTION
  );
};

const failClosedPreflight = (reason: string): PreanalysisSparsePreflight => ({
  stationUnknownCount: 0,
  coordinateParameterCount: 0,
  orientationParameterCount: 0,
  predictedParameterCount: 0,
  orientationFraction: Number.NaN,
  admitted: false,
  reason,
});

/**
 * Cheap, conservative admission check for the sparse preanalysis candidate.
 * Direction orientations are the known camp failure shape: the existing
 * sparse gates remain authoritative, but direction-heavy systems are held
 * back before WASM initialization and numerical execution. Never throws:
 * invalid, non-finite, or non-positive derived metrics fail closed to
 * TypeScript with a deterministic reason.
 */
export const derivePreanalysisSparsePreflight = (
  parsed: ParseResult,
  excludedIds: readonly number[] = [],
): PreanalysisSparsePreflight => {
  try {
    const is2D = parsed.parseState.coordMode === '2D';
    const active = collectActiveObservationsForSolve(
      parsed.observations,
      new Set(excludedIds),
      is2D,
    );
    const preparation = buildSolvePreparation(
      parsed.stations,
      parsed.unknowns,
      active,
      is2D,
    );
    const orientationParameterCount = preparation.directionSetIds.length;
    const coordinateParameterCount = preparation.stationParamCount;
    const predictedParameterCount = preparation.numParams;
    const stationUnknownCount = parsed.unknowns.length;
    const validMetrics =
      Number.isInteger(stationUnknownCount) &&
      stationUnknownCount >= 0 &&
      Number.isInteger(coordinateParameterCount) &&
      coordinateParameterCount >= 0 &&
      Number.isInteger(orientationParameterCount) &&
      orientationParameterCount >= 0 &&
      Number.isInteger(predictedParameterCount) &&
      predictedParameterCount > 0;
    if (!validMetrics) {
      return {
        ...failClosedPreflight(
          'sparse preflight invalid metrics (fail-closed; route TypeScript)',
        ),
        stationUnknownCount: Number.isInteger(stationUnknownCount) ? stationUnknownCount : 0,
      };
    }
    const orientationFraction = orientationParameterCount / predictedParameterCount;
    if (!Number.isFinite(orientationFraction)) {
      return failClosedPreflight(
        'sparse preflight invalid metrics (fail-closed; route TypeScript)',
      );
    }
    const directionHeavy = isDirectionHeavyPreflightHoldback(
      orientationParameterCount,
      predictedParameterCount,
    );
    return {
      stationUnknownCount,
      coordinateParameterCount,
      orientationParameterCount,
      predictedParameterCount,
      orientationFraction,
      admitted: !directionHeavy,
      reason: directionHeavy
        ? `direction-heavy preflight holdback: ${orientationParameterCount} orientation parameters of ${predictedParameterCount} (${(orientationFraction * 100).toFixed(1)}%)`
        : null,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return failClosedPreflight(
      `sparse preflight preparation failed: ${detail} (fail-closed; route TypeScript)`.slice(0, 300),
    );
  }
};
