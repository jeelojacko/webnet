import type {
  SparseSelectedCovarianceInput,
  SparseSelectedCovarianceResult,
  SparseSelectedCovarianceSolver,
} from '../numericalBackend';
import type { WebNetWasmModule } from './wasmTypes';

export type {
  SparseSelectedCovarianceInput,
  SparseSelectedCovarianceResult,
  SparseSelectedCovarianceSolver,
} from '../numericalBackend';

const ERROR_CAPACITY = 1024;

const int32 = (module: WebNetWasmModule, pointer: number): number =>
  module.HEAP32[pointer / Int32Array.BYTES_PER_ELEMENT] ?? 0;

const allocate = (module: WebNetWasmModule, bytes: number): number => {
  const pointer = module._malloc(Math.max(1, bytes));
  if (pointer === 0) throw new Error('WASM selected covariance could not allocate solver buffers.');
  return pointer;
};

const readCString = (buffer: Uint8Array): string => {
  const end = buffer.indexOf(0);
  return new TextDecoder().decode(buffer.subarray(0, end < 0 ? buffer.length : end));
};

const validateEquationSystem = (input: SparseSelectedCovarianceInput): void => {
  const { design, weights } = input;
  if (
    input.observationEquationCount !== design.rowOffsets.length - 1 ||
    design.columns.length !== design.values.length ||
    weights.rows.length !== weights.columns.length ||
    weights.rows.length !== weights.values.length
  ) {
    throw new Error('WASM selected covariance received inconsistent packed lengths.');
  }
  if (!Number.isInteger(input.observationEquationCount) || input.observationEquationCount < 0) {
    throw new Error('WASM selected covariance requires a non-negative equation count.');
  }
  if (!Number.isInteger(input.parameterCount) || input.parameterCount <= 0) {
    throw new Error('WASM selected covariance requires at least one parameter.');
  }
};

const validateQueries = (input: SparseSelectedCovarianceInput): void => {
  if (input.queryRows.length !== input.queryColumns.length) {
    throw new Error('WASM selected covariance requires one row per query column.');
  }
  for (let k = 0; k < input.queryRows.length; k += 1) {
    const row = input.queryRows[k] ?? -1;
    const column = input.queryColumns[k] ?? -1;
    if (!Number.isInteger(row) || !Number.isInteger(column) || row < 0 || column < 0 ||
        row >= input.parameterCount || column >= input.parameterCount) {
      throw new Error(`WASM selected covariance query ${k} is outside parameter range.`);
    }
  }
};

/**
 * Thin wrapper over `webnet_sparse_selected_covariance`.
 *
 * Accepts already-packed equation data plus (row, column) queries into
 * Qxx = N^-1 and returns one covariance value per query alongside factor
 * metadata. This wrapper performs no statistics routing; it only validates
 * counts, copies buffers across the WASM boundary, and decodes errors.
 */
export class WasmSparseSelectedCovariance implements SparseSelectedCovarianceSolver {
  public constructor(private readonly _module: WebNetWasmModule) {}

  public querySelected(input: SparseSelectedCovarianceInput): SparseSelectedCovarianceResult {
    validateEquationSystem(input);
    validateQueries(input);
    const { design, weights } = input;
    const queryCount = input.queryRows.length;
    const covariance = new Float64Array(queryCount);
    const error = new Uint8Array(ERROR_CAPACITY);
    const pointers: number[] = [];
    const alloc = (bytes: number): number => {
      const pointer = allocate(this._module, bytes);
      pointers.push(pointer);
      return pointer;
    };
    try {
      const rowOffsetsPointer = alloc(design.rowOffsets.byteLength);
      const designColumnsPointer = alloc(design.columns.byteLength);
      const designValuesPointer = alloc(design.values.byteLength);
      const weightRowsPointer = alloc(weights.rows.byteLength);
      const weightColumnsPointer = alloc(weights.columns.byteLength);
      const weightValuesPointer = alloc(weights.values.byteLength);
      const queryRowsPointer = alloc(input.queryRows.byteLength);
      const queryColumnsPointer = alloc(input.queryColumns.byteLength);
      const covariancePointer = alloc(covariance.byteLength);
      const normalNnzPointer = alloc(Int32Array.BYTES_PER_ELEMENT);
      const factorNnzPointer = alloc(Int32Array.BYTES_PER_ELEMENT);
      const dampingPointer = alloc(Float64Array.BYTES_PER_ELEMENT);
      const attemptsPointer = alloc(Int32Array.BYTES_PER_ELEMENT);
      const errorPointer = alloc(error.byteLength);
      this._module.HEAP32.set(design.rowOffsets, rowOffsetsPointer / Int32Array.BYTES_PER_ELEMENT);
      this._module.HEAP32.set(design.columns, designColumnsPointer / Int32Array.BYTES_PER_ELEMENT);
      this._module.HEAPF64.set(design.values, designValuesPointer / Float64Array.BYTES_PER_ELEMENT);
      this._module.HEAP32.set(weights.rows, weightRowsPointer / Int32Array.BYTES_PER_ELEMENT);
      this._module.HEAP32.set(weights.columns, weightColumnsPointer / Int32Array.BYTES_PER_ELEMENT);
      this._module.HEAPF64.set(weights.values, weightValuesPointer / Float64Array.BYTES_PER_ELEMENT);
      this._module.HEAP32.set(input.queryRows, queryRowsPointer / Int32Array.BYTES_PER_ELEMENT);
      this._module.HEAP32.set(input.queryColumns, queryColumnsPointer / Int32Array.BYTES_PER_ELEMENT);
      const status = this._module._webnet_sparse_selected_covariance(
        rowOffsetsPointer, designColumnsPointer, designValuesPointer, design.values.length,
        weightRowsPointer, weightColumnsPointer, weightValuesPointer, weights.values.length,
        input.observationEquationCount, input.parameterCount,
        queryRowsPointer, queryColumnsPointer, queryCount,
        covariancePointer, normalNnzPointer, factorNnzPointer,
        dampingPointer, attemptsPointer, errorPointer, error.byteLength,
      );
      error.set(this._module.HEAPU8.subarray(errorPointer, errorPointer + error.byteLength));
      if (status !== 0) throw new Error(readCString(error) || `WASM selected covariance failed (${status}).`);
      covariance.set(this._module.HEAPF64.subarray(
        covariancePointer / Float64Array.BYTES_PER_ELEMENT,
        covariancePointer / Float64Array.BYTES_PER_ELEMENT + covariance.length,
      ));
      return {
        covariance,
        normalNnz: int32(this._module, normalNnzPointer),
        factorNnz: int32(this._module, factorNnzPointer),
        damping: this._module.HEAPF64[dampingPointer / Float64Array.BYTES_PER_ELEMENT] ?? 0,
        dampingAttempts: int32(this._module, attemptsPointer),
      };
    } finally {
      pointers.reverse().forEach((pointer) => this._module._free(pointer));
    }
  }
}
