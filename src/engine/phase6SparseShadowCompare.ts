/**
 * Phase 6 pure shadow-comparison helpers (test-only, no production routing).
 *
 * Compares an authoritative TypeScript AdjustmentResult against an injected
 * experimental sparse selected-network result with deterministic ordering and
 * key numeric maxima. Selected mode intentionally omits legacy all-pairs
 * relativePrecision, so that section is excluded from the comparison.
 */
import type { AdjustmentResult } from '../typesAdjustmentResult';
import type { Observation } from '../typesObservations';

export interface SparseShadowMaxima {
  maxCoordDiffM: number;
  maxHeightDiffM: number;
  maxResidualDiff: number;
  maxStdResDiff: number;
  seuwDiff: number;
  worstStationId: string | null;
  worstObservationIndex: number | null;
}

export interface SparseShadowComparison extends SparseShadowMaxima {
  referenceIterations: number;
  candidateIterations: number;
  iterationsMatch: boolean;
  convergedMatch: boolean;
  successMatch: boolean;
  pass: boolean;
  passReasons: string[];
}

const residualMagnitude = (observation: Observation): number | null => {
  const residual = observation.residual as unknown;
  if (typeof residual === 'number') return Math.abs(residual);
  if (residual != null && typeof residual === 'object') {
    const parts = residual as { vE?: unknown; vN?: unknown; vU?: unknown };
    const values = [parts.vE, parts.vN, parts.vU].filter(
      (value): value is number => typeof value === 'number',
    );
    if (values.length === 0) return null;
    return Math.max(...values.map((value) => Math.abs(value)));
  }
  return null;
};

const stdResValue = (observation: Observation): number | null =>
  typeof observation.stdRes === 'number' ? Math.abs(observation.stdRes) : null;

/** Pure deterministic comparison of two solve results. */
export const compareSparseShadowResults = (
  reference: AdjustmentResult,
  candidate: AdjustmentResult,
  coordToleranceM: number,
): SparseShadowComparison => {
  const passReasons: string[] = [];
  let maxCoordDiffM = 0;
  let maxHeightDiffM = 0;
  let worstStationId: string | null = null;
  for (const id of Object.keys(reference.stations).sort()) {
    const refStation = reference.stations[id];
    const candStation = candidate.stations[id];
    if (!refStation || !candStation) {
      maxCoordDiffM = Number.POSITIVE_INFINITY;
      worstStationId = id;
      continue;
    }
    const coordDiff = Math.max(
      Math.abs(refStation.x - candStation.x),
      Math.abs(refStation.y - candStation.y),
    );
    if (coordDiff > maxCoordDiffM) {
      maxCoordDiffM = coordDiff;
      worstStationId = id;
    }
    const refH = refStation.h ?? 0;
    const candH = candStation.h ?? 0;
    maxHeightDiffM = Math.max(maxHeightDiffM, Math.abs(refH - candH));
  }

  let maxResidualDiff = 0;
  let maxStdResDiff = 0;
  let worstObservationIndex: number | null = null;
  const count = Math.max(reference.observations.length, candidate.observations.length);
  for (let i = 0; i < count; i += 1) {
    const refObs = reference.observations[i];
    const candObs = candidate.observations[i];
    if (!refObs || !candObs) {
      maxResidualDiff = Number.POSITIVE_INFINITY;
      worstObservationIndex = i;
      continue;
    }
    const refRes = residualMagnitude(refObs);
    const candRes = residualMagnitude(candObs);
    if (refRes != null && candRes != null) {
      const diff = Math.abs(refRes - candRes);
      if (diff > maxResidualDiff) {
        maxResidualDiff = diff;
        worstObservationIndex = i;
      }
    }
    const refStd = stdResValue(refObs);
    const candStd = stdResValue(candObs);
    if (refStd != null && candStd != null) {
      maxStdResDiff = Math.max(maxStdResDiff, Math.abs(refStd - candStd));
    }
  }

  const seuwDiff = Math.abs(reference.seuw - candidate.seuw);
  const iterationsMatch = reference.iterations === candidate.iterations;
  const convergedMatch = reference.converged === candidate.converged;
  const successMatch = reference.success === candidate.success;
  if (!successMatch) passReasons.push('success mismatch');
  if (!convergedMatch) passReasons.push('converged mismatch');
  if (!iterationsMatch) passReasons.push('iteration-count mismatch');
  if (!(maxCoordDiffM <= coordToleranceM)) {
    passReasons.push(`max coord diff ${maxCoordDiffM.toExponential(2)} exceeds ${coordToleranceM}`);
  }
  if ([maxHeightDiffM, maxResidualDiff, maxStdResDiff, seuwDiff].some((value) => !Number.isFinite(value))) {
    passReasons.push('non-finite shadow comparison maximum');
  }
  return {
    maxCoordDiffM,
    maxHeightDiffM,
    maxResidualDiff,
    maxStdResDiff,
    seuwDiff,
    worstStationId,
    worstObservationIndex,
    referenceIterations: reference.iterations,
    candidateIterations: candidate.iterations,
    iterationsMatch,
    convergedMatch,
    successMatch,
    pass: passReasons.length === 0,
    passReasons,
  };
};

/** One-line deterministic summary for Markdown/JSON reports. */
export const formatSparseShadowSummaryLine = (comparison: SparseShadowComparison): string =>
  `pass=${comparison.pass} coord=${comparison.maxCoordDiffM.toExponential(2)}m ` +
  `height=${comparison.maxHeightDiffM.toExponential(2)}m ` +
  `resid=${comparison.maxResidualDiff.toExponential(2)} ` +
  `stdres=${comparison.maxStdResDiff.toExponential(2)} seuw=${comparison.seuwDiff.toExponential(2)}`;
