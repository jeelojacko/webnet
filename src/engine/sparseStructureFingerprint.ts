/**
 * Phase 6 sparse structure fingerprint (developer audit only).
 *
 * Pure structural fingerprint over packed sparse design + packed
 * upper-triangle weights. Covers parameter/equation counts, design
 * rowOffsets/columns, and weight rows/columns. Numeric values and object
 * identity are excluded so repeated solves of the same network topology
 * fingerprint identically. No caches, reuse, or production routing.
 */
import type { SparseEquationSystem } from './numericalBackend';

export interface SparseStructureFingerprintInput {
  parameterCount: number;
  observationEquationCount: number;
  designRowOffsets: ArrayLike<number>;
  designColumns: ArrayLike<number>;
  weightRows: ArrayLike<number>;
  weightColumns: ArrayLike<number>;
}

const FINGERPRINT_VERSION = 'sparse-struct-v1';

const requireNonNegativeInt = (value: number, label: string): void => {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Sparse structure fingerprint requires non-negative integer ${label} (got ${value}).`);
  }
};

const toArray = (values: ArrayLike<number>): number[] => Array.from(values);

/** Validates structural lengths/bounds; throws fail-closed on invalid input. */
export const validateSparseStructure = (input: SparseStructureFingerprintInput): void => {
  requireNonNegativeInt(input.parameterCount, 'parameterCount');
  requireNonNegativeInt(input.observationEquationCount, 'observationEquationCount');
  const offsets = toArray(input.designRowOffsets);
  const columns = toArray(input.designColumns);
  const weightRows = toArray(input.weightRows);
  const weightColumns = toArray(input.weightColumns);
  if (offsets.length !== input.observationEquationCount + 1) {
    throw new Error(
      `Sparse structure fingerprint needs observationEquationCount+1 rowOffsets (got ${offsets.length} for ${input.observationEquationCount} equations).`,
    );
  }
  if (weightRows.length !== weightColumns.length) {
    throw new Error(
      `Sparse structure fingerprint needs matching weight rows/columns (got ${weightRows.length} rows for ${weightColumns.length} columns).`,
    );
  }
  if (offsets[0] !== 0) {
    throw new Error(`Sparse structure fingerprint needs rowOffsets[0] === 0 (got ${offsets[0]}).`);
  }
  offsets.forEach((offset, index) => {
    if (!Number.isInteger(offset) || offset < 0 || offset > columns.length) {
      throw new Error(`Sparse structure fingerprint has out-of-range rowOffset ${offset} at ${index}.`);
    }
    if (index > 0 && offset < (offsets[index - 1] as number)) {
      throw new Error(`Sparse structure fingerprint needs non-decreasing rowOffsets (drop at ${index}).`);
    }
  });
  if ((offsets[offsets.length - 1] as number) !== columns.length) {
    throw new Error(
      `Sparse structure fingerprint needs final rowOffset === design column count (got ${offsets[offsets.length - 1]} for ${columns.length} columns).`,
    );
  }
  columns.forEach((column, index) => {
    if (!Number.isInteger(column) || column < 0 || column >= input.parameterCount) {
      throw new Error(`Sparse structure fingerprint has design column ${column} at ${index} outside [0, ${input.parameterCount}).`);
    }
  });
  weightRows.forEach((row, index) => {
    if (!Number.isInteger(row) || row < 0 || row >= input.observationEquationCount) {
      throw new Error(`Sparse structure fingerprint has weight row ${row} at ${index} outside [0, ${input.observationEquationCount}).`);
    }
  });
  weightColumns.forEach((column, index) => {
    if (!Number.isInteger(column) || column < 0 || column >= input.observationEquationCount) {
      throw new Error(`Sparse structure fingerprint has weight column ${column} at ${index} outside [0, ${input.observationEquationCount}).`);
    }
  });
};

const fnv1a32 = (parts: number[], seed: number): number => {
  let hash = seed >>> 0;
  for (const part of parts) {
    hash ^= (part >>> 0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const hex8 = (value: number): string => (value >>> 0).toString(16).padStart(8, '0');

/**
 * Deterministic structural fingerprint. Two independent FNV-1a streams
 * (different seeds) are combined to keep accidental collisions unlikely;
 * use sparseStructuresEqual for a collision-safe array-level decision.
 */
export const fingerprintSparseStructure = (input: SparseStructureFingerprintInput): string => {
  validateSparseStructure(input);
  const offsets = toArray(input.designRowOffsets);
  const columns = toArray(input.designColumns);
  const weightRows = toArray(input.weightRows);
  const weightColumns = toArray(input.weightColumns);
  const stream = [
    input.parameterCount,
    input.observationEquationCount,
    offsets.length,
    columns.length,
    weightRows.length,
    ...offsets,
    ...columns,
    ...weightRows,
    ...weightColumns,
  ];
  const primary = fnv1a32(stream, 2166136261);
  const secondary = fnv1a32(stream, 4242424242);
  return (
    `${FINGERPRINT_VERSION}:p=${input.parameterCount}:e=${input.observationEquationCount}` +
    `:dnz=${columns.length}:wnz=${weightRows.length}:h=${hex8(primary)}${hex8(secondary)}`
  );
};

/** Fingerprints a packed sparse equation system (values excluded). */
export const fingerprintSparseSolveInput = (system: SparseEquationSystem): string =>
  fingerprintSparseStructure({
    parameterCount: system.parameterCount,
    observationEquationCount: system.observationEquationCount,
    designRowOffsets: system.design.rowOffsets,
    designColumns: system.design.columns,
    weightRows: system.weights.rows,
    weightColumns: system.weights.columns,
  });

/**
 * Collision-safe structural equality: validates both inputs, compares the
 * cheap fingerprints first, then confirms with full array comparison so a
 * hash collision can never report equal structures.
 */
export const sparseStructuresEqual = (
  left: SparseStructureFingerprintInput,
  right: SparseStructureFingerprintInput,
): boolean => {
  validateSparseStructure(left);
  validateSparseStructure(right);
  if (fingerprintSparseStructure(left) !== fingerprintSparseStructure(right)) return false;
  const pairs: Array<[ArrayLike<number>, ArrayLike<number>]> = [
    [left.designRowOffsets, right.designRowOffsets],
    [left.designColumns, right.designColumns],
    [left.weightRows, right.weightRows],
    [left.weightColumns, right.weightColumns],
  ];
  return (
    left.parameterCount === right.parameterCount &&
    left.observationEquationCount === right.observationEquationCount &&
    pairs.every(([a, b]) => a.length === b.length && toArray(a).every((value, index) => value === b[index]))
  );
};
