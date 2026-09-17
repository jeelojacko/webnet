/**
 * Phase 16B structured-weight oracle (§8) plus the dense-identical
 * structured normal accumulator used by the covariance-recovery candidate
 * path. Pure functions over StructuredSymmetricWeights; no solver, settings,
 * or output-format knowledge.
 */
import { zeros } from './matrix';
import type { Matrix, SparseMatrixRows } from './matrix';
import { structuredWeightsToDense } from './sparseWeightRepresentation';
import type { StructuredSymmetricWeights } from './sparseWeightRepresentation';
import { tsCorrelationGroup } from './adjustTsCorrelationWeights';
import type { Observation, ParseOptions } from '../types';

export interface StructuredWeightRoundTrip {
  maxAbs: number;
  maxRel: number;
  exact: boolean;
}

/**
 * Phase 16B hybrid routing policy (deterministic, fail-closed, no settings).
 *
 * Measured crossover (16B evidence, assembly + accumulation medians):
 * - chain/gps-2d at m=128 (density <= 0.0156): structured wins 12-23%.
 * - gps-3d at m=129 (0.0233), ts 42x12 at m=504 (0.0238): structured
 *   loses ~21-27% (builder-finalize string-sort dominates).
 * - ts 16x8 at m=128 (0.0625) and denser: structured loses 80% to 20x.
 * - chain/ts-250x8 at m=2000 (density <= 0.004): structured wins 27-45%.
 * MAX_DENSITY sits in the measured gap with margin on both sides.
 */
export const STRUCTURED_WEIGHT_MIN_EQUATIONS = 128;
export const STRUCTURED_WEIGHT_MAX_DENSITY = 0.02;

/**
 * Phase 16B routing: dense fallback below the measured crossover.
 * Below 128 equations the dense allocation is at most 128KB while the
 * structured finalize dominates, so dense is the standing choice there.
 * Above the density cap the finalize string-sort dominates, so dense is
 * likewise the standing choice. Both paths are bit-identical
 * (oracle-proven), so this is performance-only routing.
 */
export const structuredWeightTransferEligible = (
  equationCount: number,
  density?: number,
): boolean => {
  if (!Number.isInteger(equationCount) || equationCount < STRUCTURED_WEIGHT_MIN_EQUATIONS) {
    return false;
  }
  if (density === undefined) return true;
  if (!Number.isFinite(density) || density < 0) return false;
  return density <= STRUCTURED_WEIGHT_MAX_DENSITY;
};

/**
 * Exact stored density of finalized structured weights from writer
 * metadata only (diagonal is always stored; off-diagonal triplets are
 * upper-triangle, hence doubled). O(1); never builds a dense P.
 */
export const structuredWeightDensity = (weights: StructuredSymmetricWeights): number => {
  if (!Number.isInteger(weights.size) || weights.size <= 0) return 0;
  return (weights.size + 2 * weights.offValues.length) / (weights.size * weights.size);
};

export interface StructuredWeightDensityEstimateInput {
  equationCount: number;
  observations: readonly Observation[];
  tsCorrelationEnabled: boolean;
  tsCorrelationRho: number;
  tsCorrelationScope: ParseOptions['tsCorrelationScope'];
  is2D: boolean;
  constraintCount: number;
}

/**
 * Pre-assembly upper bound on the structured weight density, O(m) over the
 * observation list with no dense P. TS group sizes come from the same pure
 * grouping the weight writer uses (groups only shrink afterwards via
 * skipped rows, so the pair count is a true upper bound); GPS/GNSS blocks
 * are bounded per baseline (3 in 3D, 1 in 2D where the U row cannot
 * exist); each constraint correlation pair costs at most one off-diagonal.
 * Malformed input yields +Infinity so callers fail closed to dense.
 */
export const estimateStructuredWeightDensityUB = (
  input: StructuredWeightDensityEstimateInput,
): number => {
  const equationCount = input.equationCount;
  if (!Number.isInteger(equationCount) || equationCount <= 0) return Number.POSITIVE_INFINITY;
  if (!Array.isArray(input.observations)) return Number.POSITIVE_INFINITY;
  if (typeof input.is2D !== 'boolean') return Number.POSITIVE_INFINITY;
  if (!Number.isInteger(input.constraintCount) || input.constraintCount < 0) {
    return Number.POSITIVE_INFINITY;
  }
  const tsActive =
    input.tsCorrelationEnabled === true &&
    Number.isFinite(input.tsCorrelationRho) &&
    (input.tsCorrelationRho as number) > 0;
  const groupSizes = new Map<string, number>();
  let gpsBaselines = 0;
  let gnssBaselines = 0;
  for (const observation of input.observations) {
    if (!observation || typeof observation.type !== 'string') return Number.POSITIVE_INFINITY;
    if (observation.type === 'gps') gpsBaselines += 1;
    else if (observation.type === 'gnssBaseline') gnssBaselines += 1;
    if (!tsActive) continue;
    let key: string | null;
    try {
      key =
        tsCorrelationGroup({
          enabled: true,
          obs: observation,
          scope: input.tsCorrelationScope,
        })?.key ?? null;
    } catch {
      return Number.POSITIVE_INFINITY;
    }
    if (key == null) continue;
    if (typeof key !== 'string' || key.length === 0) return Number.POSITIVE_INFINITY;
    groupSizes.set(key, (groupSizes.get(key) ?? 0) + 1);
  }
  let offDiagonal = 0;
  groupSizes.forEach((size) => {
    offDiagonal += (size * (size - 1)) / 2;
  });
  offDiagonal += (input.is2D ? 1 : 3) * gpsBaselines + 3 * gnssBaselines + input.constraintCount;
  return (equationCount + 2 * offDiagonal) / (equationCount * equationCount);
};

/**
 * Pre-assembly routing decision for the correction loop: sparse assembly
 * with omitDenseP only when the kill switch allows it, the robust
 * Huber loop is off (its inner reweighting stays on the legacy dense
 * path), and the density upper bound is inside the measured crossover.
 * Deterministic in its inputs; any doubt routes dense.
 */
export const shouldAssembleStructuredWeights = (input: {
  equationCount: number;
  densityUB: number;
  robustMode?: string;
  structuredWeightTransfer?: boolean;
}): boolean => {
  if (input.structuredWeightTransfer === false) return false;
  if (input.robustMode === 'huber') return false;
  return structuredWeightTransferEligible(input.equationCount, input.densityUB);
};

/**
 * Materializes structured weights and compares every entry against the
 * reference dense P. Bit-identical comparison; maxRel is reported against
 * the largest reference magnitude for context.
 */
export const compareStructuredWeightsToDense = (
  weights: StructuredSymmetricWeights,
  reference: number[][],
): StructuredWeightRoundTrip => {
  const materialized = structuredWeightsToDense(weights);
  if (materialized.length !== reference.length) {
    throw new Error(
      `Structured round-trip size mismatch (got ${materialized.length} for ${reference.length}).`,
    );
  }
  let maxAbs = 0;
  let refMax = 0;
  for (let row = 0; row < reference.length; row += 1) {
    const actualRow = materialized[row] ?? [];
    const expectedRow = reference[row] ?? [];
    if (actualRow.length !== expectedRow.length) {
      throw new Error(`Structured round-trip row ${row} length mismatch.`);
    }
    for (let column = 0; column < expectedRow.length; column += 1) {
      const expected = expectedRow[column] ?? 0;
      const diff = Math.abs((actualRow[column] ?? 0) - expected);
      if (diff > maxAbs) maxAbs = diff;
      if (Math.abs(expected) > refMax) refMax = Math.abs(expected);
    }
  }
  return { maxAbs, maxRel: refMax === 0 ? maxAbs : maxAbs / refMax, exact: maxAbs === 0 };
};

const requireSupportedShape = (weights: StructuredSymmetricWeights): void => {
  if (weights.diagonal.length !== weights.size) {
    throw new Error('Structured accumulation needs diagonal length equal to size.');
  }
  if (
    weights.offRows.length !== weights.offColumns.length ||
    weights.offRows.length !== weights.offValues.length
  ) {
    throw new Error('Structured accumulation needs matching off-diagonal triplet arrays.');
  }
  for (let position = 0; position < weights.offRows.length; position += 1) {
    const row = weights.offRows[position] as number;
    const column = weights.offColumns[position] as number;
    if (
      !Number.isInteger(row) ||
      !Number.isInteger(column) ||
      row < 0 ||
      column < 0 ||
      row >= weights.size ||
      column >= weights.size ||
      row >= column
    ) {
      throw new Error(`Structured accumulation rejects unsupported triplet at position ${position}.`);
    }
  }
};

/**
 * Structured A'PA accumulation replicating
 * accumulateNormalEquationsFromSparseRows statement-for-statement (per-row
 * diagonal pass, then canonical row-major off-diagonal pairs) so N and rhs
 * are bit-identical to the dense-weight result. Triplet arrays must be in
 * canonical (row, column) order as emitted by finalize(); anything else
 * throws so the caller falls back to dense.
 */
export const accumulateNormalFromStructuredWeights = (
  rows: SparseMatrixRows,
  residuals: Matrix,
  weights: StructuredSymmetricWeights,
  numParams: number,
): { normal: Matrix; rhs: Matrix } => {
  requireSupportedShape(weights);
  const normal = zeros(numParams, numParams);
  const rhs = zeros(numParams, 1);
  const rowCount = Math.min(rows.length, weights.size, residuals.length);
  let triplet = 0;
  const tripletCount = weights.offRows.length;

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const rowEntries = rows[rowIndex];
    if (triplet < tripletCount && (weights.offRows[triplet] as number) < rowIndex) {
      throw new Error('Structured accumulation needs canonical triplet order.');
    }
    if (rowEntries.length === 0) {
      while (triplet < tripletCount && (weights.offRows[triplet] as number) === rowIndex) {
        triplet += 1;
      }
      continue;
    }
    const rowResidual = residuals[rowIndex]?.[0] ?? 0;
    const diagonalWeight = weights.diagonal[rowIndex] as number;

    if (diagonalWeight !== 0) {
      for (let a = 0; a < rowEntries.length; a += 1) {
        const left = rowEntries[a];
        rhs[left.index][0] += left.value * diagonalWeight * rowResidual;
        for (let b = a; b < rowEntries.length; b += 1) {
          const right = rowEntries[b];
          const contribution = left.value * diagonalWeight * right.value;
          normal[left.index][right.index] += contribution;
          if (left.index !== right.index) {
            normal[right.index][left.index] += contribution;
          }
        }
      }
    }

    while (triplet < tripletCount && (weights.offRows[triplet] as number) === rowIndex) {
      const colIndex = weights.offColumns[triplet] as number;
      const weight = weights.offValues[triplet] as number;
      triplet += 1;
      if (colIndex >= rowCount) continue;
      const otherEntries = rows[colIndex];
      if (otherEntries.length === 0) continue;
      const otherResidual = residuals[colIndex]?.[0] ?? 0;

      for (let a = 0; a < rowEntries.length; a += 1) {
        const left = rowEntries[a];
        rhs[left.index][0] += left.value * weight * otherResidual;
      }
      for (let b = 0; b < otherEntries.length; b += 1) {
        const right = otherEntries[b];
        rhs[right.index][0] += right.value * weight * rowResidual;
      }

      for (let a = 0; a < rowEntries.length; a += 1) {
        const left = rowEntries[a];
        for (let b = 0; b < otherEntries.length; b += 1) {
          const right = otherEntries[b];
          const contribution = left.value * weight * right.value;
          normal[left.index][right.index] += contribution;
          normal[right.index][left.index] += contribution;
        }
      }
    }
  }

  return { normal, rhs };
};
