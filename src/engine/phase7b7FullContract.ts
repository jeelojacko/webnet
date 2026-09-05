/**
 * Phase 7B.7 full result-contract comparison (test-only, no routing).
 *
 * Compares an authoritative TypeScript reference `AdjustmentResult`
 * against an actual-worker sparse candidate across the FULL contract the
 * production dense path guarantees:
 *
 * - run status: success / converged / iterations (exact) / DOF (exact)
 * - coordinates (x/y, 1e-6 m) and heights (h, 1e-6 m)
 * - SEUW (1e-9 relative), residuals, standardized residuals (1e-9 relative)
 * - redundancy and MDB (1e-9 relative, shape-aware)
 * - station covariances, relative covariances, legacy all-pairs
 *   relativePrecision rows (1e-9 relative, deterministic order)
 * - station key order and condition metadata (estimate/threshold/flagged)
 *
 * The divergence classifier separates clean agreement (`agree`) from
 * bounded numeric mismatch (`mismatch`) and solver-trajectory divergence
 * (`diverged`, coordinate disagreement beyond 1e-6 m). No production
 * routing, tolerance, or baseline changes.
 */
import type { AdjustmentResult } from '../typesAdjustmentResult';
import type { Observation } from '../typesObservations';

export const PHASE7B7_COORD_TOLERANCE_M = 1e-6;
export const PHASE7B7_RELATIVE_TOLERANCE = 1e-9;

export type Phase7b7DivergenceClass = 'agree' | 'mismatch' | 'diverged';

export interface Phase7b7ContractMaxima {
  maxCoordDiffM: number;
  worstStationId: string | null;
  maxHeightDiffM: number;
  worstHeightStationId: string | null;
  maxResidualDiff: number;
  maxStdResDiff: number;
  maxRedundancyDiff: number;
  maxMdbDiff: number;
  maxStationCovDiff: number;
  maxRelativeCovDiff: number;
  maxRelPrecDiff: number;
  seuwDiff: number;
  worstObservationIndex: number | null;
}

export interface Phase7b7ContractComparison extends Phase7b7ContractMaxima {
  pass: boolean;
  reasons: string[];
  divergence: Phase7b7DivergenceClass;
  /**
   * Legacy sparse-path artifact note (never a rejection reason): older
   * sparse-injected candidates returned from iteration 1 before the dense
   * first-iteration `recordConditionEstimate` ran, so the candidate carried
   * no result-level `condition` while the dense reference did. Since the
   * Phase 7C parity fix the sparse iteration branch records
   * result.condition itself (native estimate preferred, packed fallback),
   * so this note is normally null and estimate agreement is gated directly.
   */
  conditionNote: string | null;
}

const withinRelative = (actual: number, expected: number): number => {
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.abs(actual - expected);
};

const checkRelative = (
  actual: number,
  expected: number,
  tolerance: number,
): boolean => {
  const diff = withinRelative(actual, expected);
  if (!Number.isFinite(diff)) return false;
  return diff <= tolerance * Math.max(1, Math.abs(expected));
};

const residualMagnitude = (observation: Observation): number | null => {
  const residual = observation.residual as unknown;
  if (typeof residual === 'number') return residual;
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

const redundancyParts = (observation: Observation): number[] | null => {
  const redundancy = observation.redundancy as unknown;
  if (typeof redundancy === 'number') return [redundancy];
  if (redundancy != null && typeof redundancy === 'object') {
    const parts = redundancy as { rE?: unknown; rN?: unknown };
    const values = [parts.rE, parts.rN].filter(
      (value): value is number => typeof value === 'number',
    );
    return values.length > 0 ? values : null;
  }
  return null;
};

const compareCovarianceFields = (
  actual: Record<string, unknown>,
  expected: Record<string, unknown>,
  fields: string[],
  tolerance: number,
): number => {
  let worst = 0;
  for (const field of fields) {
    const actualValue = actual[field];
    const expectedValue = expected[field];
    if (actualValue === undefined && expectedValue === undefined) continue;
    if (typeof actualValue !== 'number' || typeof expectedValue !== 'number') {
      return Number.POSITIVE_INFINITY;
    }
    const diff = withinRelative(actualValue, expectedValue);
    if (!Number.isFinite(diff)) return Number.POSITIVE_INFINITY;
    const allowed = tolerance * Math.max(1, Math.abs(expectedValue));
    if (diff > allowed) return Number.POSITIVE_INFINITY;
    worst = Math.max(worst, diff);
  }
  return worst;
};

/** Pure deterministic full-contract comparison of two solve results. */
export const comparePhase7b7FullContract = (
  reference: AdjustmentResult,
  candidate: AdjustmentResult,
  coordToleranceM: number = PHASE7B7_COORD_TOLERANCE_M,
  relativeTolerance: number = PHASE7B7_RELATIVE_TOLERANCE,
): Phase7b7ContractComparison => {
  const reasons: string[] = [];
  let maxCoordDiffM = 0;
  let worstStationId: string | null = null;
  let maxHeightDiffM = 0;
  let worstHeightStationId: string | null = null;

  if (reference.success !== candidate.success) {
    reasons.push(`success mismatch (reference=${reference.success}, candidate=${candidate.success})`);
  }
  if (reference.converged !== candidate.converged) {
    reasons.push(`converged mismatch (reference=${reference.converged}, candidate=${candidate.converged})`);
  }
  if (reference.iterations !== candidate.iterations) {
    reasons.push(`iteration-count mismatch (reference=${reference.iterations}, candidate=${candidate.iterations})`);
  }
  if (reference.dof !== candidate.dof) {
    reasons.push(`dof mismatch (reference=${reference.dof}, candidate=${candidate.dof})`);
  }

  const referenceIds = Object.keys(reference.stations).sort();
  const candidateIds = Object.keys(candidate.stations).sort();
  if (
    referenceIds.length !== candidateIds.length ||
    referenceIds.some((id, index) => id !== candidateIds[index])
  ) {
    reasons.push('station order/content mismatch');
    maxCoordDiffM = Number.POSITIVE_INFINITY;
    maxHeightDiffM = Number.POSITIVE_INFINITY;
  } else {
    for (const id of referenceIds) {
      const refStation = reference.stations[id];
      const candStation = candidate.stations[id];
      if (!refStation || !candStation) {
        maxCoordDiffM = Number.POSITIVE_INFINITY;
        worstStationId = id;
        continue;
      }
      const diff = Math.max(
        withinRelative(refStation.x, candStation.x),
        withinRelative(refStation.y, candStation.y),
      );
      if (!Number.isFinite(diff)) {
        maxCoordDiffM = Number.POSITIVE_INFINITY;
        worstStationId = id;
        continue;
      }
      if (diff > maxCoordDiffM) {
        maxCoordDiffM = diff;
        worstStationId = id;
      }
      const heightDiff = withinRelative(refStation.h, candStation.h);
      if (!Number.isFinite(heightDiff)) {
        maxHeightDiffM = Number.POSITIVE_INFINITY;
        worstHeightStationId = id;
        continue;
      }
      if (heightDiff > maxHeightDiffM) {
        maxHeightDiffM = heightDiff;
        worstHeightStationId = id;
      }
    }
  }
  if (!Number.isFinite(maxCoordDiffM) || maxCoordDiffM > coordToleranceM) {
    reasons.push(
      `coordinate agreement: max diff ${maxCoordDiffM.toExponential(2)} exceeds ${coordToleranceM} m (worst=${worstStationId ?? 'none'})`,
    );
  }
  if (!Number.isFinite(maxHeightDiffM) || maxHeightDiffM > coordToleranceM) {
    reasons.push(
      `height agreement: max diff ${maxHeightDiffM.toExponential(2)} exceeds ${coordToleranceM} m (worst=${worstHeightStationId ?? 'none'})`,
    );
  }

  const seuwDiff = withinRelative(reference.seuw, candidate.seuw);
  if (!checkRelative(candidate.seuw, reference.seuw, relativeTolerance)) {
    reasons.push(`seuw mismatch (diff=${seuwDiff.toExponential(2)})`);
  }

  let maxResidualDiff = 0;
  let maxStdResDiff = 0;
  let maxRedundancyDiff = 0;
  let maxMdbDiff = 0;
  let worstObservationIndex: number | null = null;
  const observationCount = Math.max(
    reference.observations.length,
    candidate.observations.length,
  );
  if (reference.observations.length !== candidate.observations.length) {
    reasons.push(
      `observation-count mismatch (reference=${reference.observations.length}, candidate=${candidate.observations.length})`,
    );
    worstObservationIndex = 0;
  }
  for (let i = 0; i < observationCount; i += 1) {
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
      const diff = withinRelative(refRes, candRes);
      if (!Number.isFinite(diff)) {
        maxResidualDiff = Number.POSITIVE_INFINITY;
        worstObservationIndex = i;
      } else {
        const allowed = relativeTolerance * Math.max(1, Math.abs(refRes));
        if (diff > allowed) {
          maxResidualDiff = Number.POSITIVE_INFINITY;
          worstObservationIndex = i;
        } else {
          maxResidualDiff = Math.max(maxResidualDiff, diff);
        }
      }
    }
    const refStd = typeof refObs.stdRes === 'number' ? refObs.stdRes : null;
    const candStd = typeof candObs.stdRes === 'number' ? candObs.stdRes : null;
    if (refStd != null && candStd != null) {
      const diff = withinRelative(refStd, candStd);
      const allowed = relativeTolerance * Math.max(1, Math.abs(refStd));
      if (!Number.isFinite(diff) || diff > allowed) {
        maxStdResDiff = Number.POSITIVE_INFINITY;
        if (worstObservationIndex == null) worstObservationIndex = i;
      } else {
        maxStdResDiff = Math.max(maxStdResDiff, diff);
      }
    } else if ((refStd == null) !== (candStd == null)) {
      maxStdResDiff = Number.POSITIVE_INFINITY;
      if (worstObservationIndex == null) worstObservationIndex = i;
    }
    const refRed = redundancyParts(refObs);
    const candRed = redundancyParts(candObs);
    if (refRed != null && candRed != null) {
      if (refRed.length !== candRed.length) {
        maxRedundancyDiff = Number.POSITIVE_INFINITY;
        if (worstObservationIndex == null) worstObservationIndex = i;
      } else {
        refRed.forEach((expected, part) => {
          const actual = candRed[part] ?? Number.NaN;
          const diff = withinRelative(actual, expected);
          const allowed = relativeTolerance * Math.max(1, Math.abs(expected));
          if (!Number.isFinite(diff) || diff > allowed) {
            maxRedundancyDiff = Number.POSITIVE_INFINITY;
            if (worstObservationIndex == null) worstObservationIndex = i;
          } else {
            maxRedundancyDiff = Math.max(maxRedundancyDiff, diff);
          }
        });
      }
    } else if ((refRed == null) !== (candRed == null)) {
      maxRedundancyDiff = Number.POSITIVE_INFINITY;
      if (worstObservationIndex == null) worstObservationIndex = i;
    }
    const refMdb = typeof refObs.mdb === 'number' ? refObs.mdb : null;
    const candMdb = typeof candObs.mdb === 'number' ? candObs.mdb : null;
    if (refMdb != null && candMdb != null) {
      const diff = withinRelative(refMdb, candMdb);
      const allowed = relativeTolerance * Math.max(1, Math.abs(refMdb));
      if (!Number.isFinite(diff) || diff > allowed) {
        maxMdbDiff = Number.POSITIVE_INFINITY;
        if (worstObservationIndex == null) worstObservationIndex = i;
      } else {
        maxMdbDiff = Math.max(maxMdbDiff, diff);
      }
    } else if ((refMdb == null) !== (candMdb == null)) {
      maxMdbDiff = Number.POSITIVE_INFINITY;
      if (worstObservationIndex == null) worstObservationIndex = i;
    }
  }
  if (!Number.isFinite(maxResidualDiff)) reasons.push('residual mismatch beyond 1e-9 relative');
  if (!Number.isFinite(maxStdResDiff)) reasons.push('standardized-residual mismatch beyond 1e-9 relative');
  if (!Number.isFinite(maxRedundancyDiff)) reasons.push('redundancy mismatch beyond 1e-9 relative');
  if (!Number.isFinite(maxMdbDiff)) reasons.push('MDB mismatch beyond 1e-9 relative');

  const stationCovFields = ['cEE', 'cEN', 'cNN', 'cEH', 'cNH', 'cHH', 'sigmaE', 'sigmaN', 'sigmaH'];
  let maxStationCovDiff = 0;
  const referenceStationCov = [...(reference.stationCovariances ?? [])].sort((a, b) =>
    a.stationId < b.stationId ? -1 : a.stationId > b.stationId ? 1 : 0,
  );
  const candidateStationCov = [...(candidate.stationCovariances ?? [])].sort((a, b) =>
    a.stationId < b.stationId ? -1 : a.stationId > b.stationId ? 1 : 0,
  );
  if (
    referenceStationCov.length !== candidateStationCov.length ||
    referenceStationCov.some((block, index) => block.stationId !== candidateStationCov[index]?.stationId)
  ) {
    reasons.push('station-covariance block mismatch (order/content)');
    maxStationCovDiff = Number.POSITIVE_INFINITY;
  } else {
    referenceStationCov.forEach((expected, index) => {
      const actual = candidateStationCov[index];
      if (!actual) {
        maxStationCovDiff = Number.POSITIVE_INFINITY;
        return;
      }
      const worst = compareCovarianceFields(
        actual as unknown as Record<string, unknown>,
        expected as unknown as Record<string, unknown>,
        stationCovFields,
        relativeTolerance,
      );
      if (!Number.isFinite(worst)) {
        maxStationCovDiff = Number.POSITIVE_INFINITY;
      } else {
        maxStationCovDiff = Math.max(maxStationCovDiff, worst);
      }
    });
    if (!Number.isFinite(maxStationCovDiff)) {
      reasons.push('station-covariance mismatch beyond 1e-9 relative');
    }
  }

  const relativeCovFields = [...stationCovFields, 'sigmaDist', 'sigmaAz'];
  let maxRelativeCovDiff = 0;
  const sortPair = (from: string, to: string): string => `${from}→${to}`;
  const referenceRelativeCov = [...(reference.relativeCovariances ?? [])].sort((a, b) =>
    sortPair(a.from, a.to) < sortPair(b.from, b.to) ? -1 : 1,
  );
  const candidateRelativeCov = [...(candidate.relativeCovariances ?? [])].sort((a, b) =>
    sortPair(a.from, a.to) < sortPair(b.from, b.to) ? -1 : 1,
  );
  if (
    referenceRelativeCov.length !== candidateRelativeCov.length ||
    referenceRelativeCov.some(
      (block, index) =>
        block.from !== candidateRelativeCov[index]?.from ||
        block.to !== candidateRelativeCov[index]?.to,
    )
  ) {
    reasons.push('relative-covariance block mismatch (order/content)');
    maxRelativeCovDiff = Number.POSITIVE_INFINITY;
  } else {
    referenceRelativeCov.forEach((expected, index) => {
      const actual = candidateRelativeCov[index];
      if (!actual) {
        maxRelativeCovDiff = Number.POSITIVE_INFINITY;
        return;
      }
      const worst = compareCovarianceFields(
        actual as unknown as Record<string, unknown>,
        expected as unknown as Record<string, unknown>,
        relativeCovFields,
        relativeTolerance,
      );
      if (!Number.isFinite(worst)) {
        maxRelativeCovDiff = Number.POSITIVE_INFINITY;
      } else {
        maxRelativeCovDiff = Math.max(maxRelativeCovDiff, worst);
      }
    });
    if (!Number.isFinite(maxRelativeCovDiff)) {
      reasons.push('relative-covariance mismatch beyond 1e-9 relative');
    }
  }

  let maxRelPrecDiff = 0;
  const referenceRows = [...(reference.relativePrecision ?? [])].sort((a, b) =>
    sortPair(a.from, a.to) < sortPair(b.from, b.to) ? -1 : 1,
  );
  const candidateRows = [...(candidate.relativePrecision ?? [])].sort((a, b) =>
    sortPair(a.from, a.to) < sortPair(b.from, b.to) ? -1 : 1,
  );
  if (
    referenceRows.length !== candidateRows.length ||
    referenceRows.some(
      (row, index) =>
        row.from !== candidateRows[index]?.from || row.to !== candidateRows[index]?.to,
    )
  ) {
    reasons.push('relativePrecision row mismatch (order/content)');
    maxRelPrecDiff = Number.POSITIVE_INFINITY;
  } else {
    referenceRows.forEach((expected, index) => {
      const actual = candidateRows[index];
      if (!actual) {
        maxRelPrecDiff = Number.POSITIVE_INFINITY;
        return;
      }
      const worst = compareCovarianceFields(
        actual as unknown as Record<string, unknown>,
        expected as unknown as Record<string, unknown>,
        ['sigmaN', 'sigmaE', 'sigmaDist', 'sigmaAz'],
        relativeTolerance,
      );
      if (!Number.isFinite(worst)) {
        maxRelPrecDiff = Number.POSITIVE_INFINITY;
      } else {
        maxRelPrecDiff = Math.max(maxRelPrecDiff, worst);
      }
    });
    if (!Number.isFinite(maxRelPrecDiff)) {
      reasons.push('relativePrecision mismatch beyond 1e-9 relative');
    }
  }

  const referenceCondition = reference.condition;
  const candidateCondition = candidate.condition;
  let conditionNote: string | null = null;
  if (referenceCondition != null && candidateCondition == null) {
    conditionNote =
      'sparse-path artifact: dense reference records first-iteration result condition ' +
      `(estimate=${referenceCondition.estimate.toExponential(3)}, flagged=${referenceCondition.flagged}) ` +
      'while the sparse-injected candidate bypasses dense condition recording by existing design';
  } else if ((referenceCondition == null) !== (candidateCondition == null)) {
    reasons.push('condition-metadata presence mismatch');
  } else if (referenceCondition && candidateCondition) {
    if (!checkRelative(candidateCondition.estimate, referenceCondition.estimate, relativeTolerance)) {
      reasons.push('condition-estimate mismatch beyond 1e-9 relative');
    }
    if (candidateCondition.threshold !== referenceCondition.threshold) {
      reasons.push('condition-threshold mismatch');
    }
    if (candidateCondition.flagged !== referenceCondition.flagged) {
      reasons.push('condition-flag mismatch');
    }
  }

  const pass = reasons.length === 0;
  const divergence: Phase7b7DivergenceClass = pass
    ? 'agree'
    : !Number.isFinite(maxCoordDiffM) || maxCoordDiffM > coordToleranceM
      ? 'diverged'
      : 'mismatch';
  return {
    pass,
    reasons,
    divergence,
    conditionNote,
    maxCoordDiffM,
    worstStationId,
    maxHeightDiffM,
    worstHeightStationId,
    maxResidualDiff,
    maxStdResDiff,
    maxRedundancyDiff,
    maxMdbDiff,
    maxStationCovDiff,
    maxRelativeCovDiff,
    maxRelPrecDiff,
    seuwDiff,
    worstObservationIndex,
  };
};
