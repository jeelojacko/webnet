import type {
  SparseRowProductsInput,
  SparseRowProductsResult,
  SparseRowProductsSolver,
} from '../numericalBackend';
import type { WebNetWasmModule } from './wasmTypes';

export type {
  SparseRowProductsInput,
  SparseRowProductsResult,
  SparseRowProductsSolver,
} from '../numericalBackend';

const ERROR_CAPACITY = 1024;

const int32 = (module: WebNetWasmModule, pointer: number): number =>
  module.HEAP32[pointer / Int32Array.BYTES_PER_ELEMENT] ?? 0;

const allocate = (module: WebNetWasmModule, bytes: number): number => {
  const pointer = module._malloc(Math.max(1, bytes));
  if (pointer === 0) throw new Error('WASM row products could not allocate solver buffers.');
  return pointer;
};

const readCString = (buffer: Uint8Array): string => {
  const end = buffer.indexOf(0);
  return new TextDecoder().decode(buffer.subarray(0, end < 0 ? buffer.length : end));
};

const validateEquationSystem = (input: SparseRowProductsInput): void => {
  const { design, weights } = input;
  if (
    input.observationEquationCount !== design.rowOffsets.length - 1 ||
    design.columns.length !== design.values.length ||
    weights.rows.length !== weights.columns.length ||
    weights.rows.length !== weights.values.length
  ) {
    throw new Error('WASM row products received inconsistent packed lengths.');
  }
  if (!Number.isInteger(input.observationEquationCount) || input.observationEquationCount < 0) {
    throw new Error('WASM row products requires a non-negative equation count.');
  }
  if (!Number.isInteger(input.parameterCount) || input.parameterCount <= 0) {
    throw new Error('WASM row products requires at least one parameter.');
  }
};

const validateQueryRows = (input: SparseRowProductsInput): number => {
  const { queryRowOffsets, queryColumns, queryValues } = input;
  if (queryRowOffsets.length === 0) {
    throw new Error('WASM row products requires query row offsets with a terminal entry.');
  }
  const queryRowCount = queryRowOffsets.length - 1;
  const terminal = queryRowOffsets[queryRowCount] ?? -1;
  if ((queryRowOffsets[0] ?? -1) !== 0 || terminal !== queryColumns.length ||
      terminal !== queryValues.length) {
    throw new Error('WASM row products received inconsistent query CSR lengths.');
  }
  for (let k = 0; k < queryColumns.length; k += 1) {
    const column = queryColumns[k] ?? -1;
    if (!Number.isInteger(column) || column < 0 || column >= input.parameterCount) {
      throw new Error(`WASM row products query entry ${k} is outside parameter range.`);
    }
  }
  for (let row = 0; row < queryRowCount; row += 1) {
    const start = queryRowOffsets[row] ?? -1;
    const end = queryRowOffsets[row + 1] ?? -1;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > terminal) {
      throw new Error(`WASM row products query row ${row} has invalid offsets.`);
    }
  }
  return queryRowCount;
};

const validateCrossPairs = (input: SparseRowProductsInput, queryRowCount: number): void => {
  if (input.crossA.length !== input.crossB.length) {
    throw new Error('WASM row products requires matched cross index pairs.');
  }
  for (let c = 0; c < input.crossA.length; c += 1) {
    const a = input.crossA[c] ?? -1;
    const b = input.crossB[c] ?? -1;
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 ||
        a >= queryRowCount || b >= queryRowCount) {
      throw new Error(`WASM row products cross pair ${c} is outside query row range.`);
    }
  }
};

/**
 * Thin wrapper over `webnet_sparse_row_products`.
 *
 * Computes batched quadratic forms r_k^T Qxx r_k and cross products
 * r_a^T Qxx r_b for CSR query rows over parameter space. This wrapper
 * performs no statistics routing; it only validates counts, copies buffers
 * across the WASM boundary, and decodes errors.
 */
export class WasmSparseRowProducts implements SparseRowProductsSolver {
  public constructor(private readonly _module: WebNetWasmModule) {}

  public queryRowProducts(input: SparseRowProductsInput): SparseRowProductsResult {
    validateEquationSystem(input);
    const queryRowCount = validateQueryRows(input);
    validateCrossPairs(input, queryRowCount);
    const { design, weights } = input;
    const quadratic = new Float64Array(queryRowCount);
    const cross = new Float64Array(input.crossA.length);
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
      const queryOffsetsPointer = alloc(input.queryRowOffsets.byteLength);
      const queryColumnsPointer = alloc(input.queryColumns.byteLength);
      const queryValuesPointer = alloc(input.queryValues.byteLength);
      const crossAPointer = alloc(input.crossA.byteLength);
      const crossBPointer = alloc(input.crossB.byteLength);
      const quadraticPointer = alloc(quadratic.byteLength);
      const crossPointer = alloc(cross.byteLength);
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
      this._module.HEAP32.set(input.queryRowOffsets, queryOffsetsPointer / Int32Array.BYTES_PER_ELEMENT);
      this._module.HEAP32.set(input.queryColumns, queryColumnsPointer / Int32Array.BYTES_PER_ELEMENT);
      this._module.HEAPF64.set(input.queryValues, queryValuesPointer / Float64Array.BYTES_PER_ELEMENT);
      this._module.HEAP32.set(input.crossA, crossAPointer / Int32Array.BYTES_PER_ELEMENT);
      this._module.HEAP32.set(input.crossB, crossBPointer / Int32Array.BYTES_PER_ELEMENT);
      const status = this._module._webnet_sparse_row_products(
        rowOffsetsPointer, designColumnsPointer, designValuesPointer, design.values.length,
        weightRowsPointer, weightColumnsPointer, weightValuesPointer, weights.values.length,
        input.observationEquationCount, input.parameterCount,
        queryOffsetsPointer, queryColumnsPointer, queryValuesPointer, input.queryValues.length,
        queryRowCount, crossAPointer, crossBPointer, cross.length,
        quadraticPointer, crossPointer, normalNnzPointer, factorNnzPointer,
        dampingPointer, attemptsPointer, errorPointer, error.byteLength,
      );
      error.set(this._module.HEAPU8.subarray(errorPointer, errorPointer + error.byteLength));
      if (status !== 0) throw new Error(readCString(error) || `WASM row products failed (${status}).`);
      quadratic.set(this._module.HEAPF64.subarray(
        quadraticPointer / Float64Array.BYTES_PER_ELEMENT,
        quadraticPointer / Float64Array.BYTES_PER_ELEMENT + quadratic.length,
      ));
      cross.set(this._module.HEAPF64.subarray(
        crossPointer / Float64Array.BYTES_PER_ELEMENT,
        crossPointer / Float64Array.BYTES_PER_ELEMENT + cross.length,
      ));
      return {
        quadratic,
        cross,
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
