import type {
  SparseSelectedBlockInput,
  SparseSelectedBlockResult,
  SparseSelectedBlockSolver,
  SparseSelectedCovarianceInput,
  SparseSelectedCovarianceResult,
  SparseSelectedCovarianceSolver,
} from '../numericalBackend';
import type { WebNetWasmModule } from './wasmTypes';

export type {
  SparseSelectedBlockInput,
  SparseSelectedBlockResult,
  SparseSelectedBlockSolver,
  SparseSelectedCovarianceInput,
  SparseSelectedCovarianceResult,
  SparseSelectedCovarianceSolver,
} from '../numericalBackend';

const ERROR_CAPACITY = 1024;

const int32 = (module: WebNetWasmModule, pointer: number): number =>
  module.HEAP32[pointer / Int32Array.BYTES_PER_ELEMENT] ?? 0;

const float64 = (module: WebNetWasmModule, pointer: number): number =>
  module.HEAPF64[pointer / Float64Array.BYTES_PER_ELEMENT] ?? Number.NaN;

const readTimings = (
  module: WebNetWasmModule,
  pointers: Record<'assembly' | 'equilibration' | 'analyze' | 'factorize' | 'solve', number>,
): SparseSelectedCovarianceResult['timings'] => {
  const timings = {
    assemblyMs: float64(module, pointers.assembly),
    equilibrationMs: float64(module, pointers.equilibration),
    analyzeMs: float64(module, pointers.analyze),
    factorizeMs: float64(module, pointers.factorize),
    solveMs: float64(module, pointers.solve),
  };
  return Object.values(timings).every(Number.isFinite) ? timings : undefined;
};

const allocate = (module: WebNetWasmModule, bytes: number): number => {
  const pointer = module._malloc(Math.max(1, bytes));
  if (pointer === 0) throw new Error('WASM selected covariance could not allocate solver buffers.');
  return pointer;
};

const readCString = (buffer: Uint8Array): string => {
  const end = buffer.indexOf(0);
  return new TextDecoder().decode(buffer.subarray(0, end < 0 ? buffer.length : end));
};

const validateEquationSystem = (input: SparseSelectedCovarianceInput | SparseSelectedBlockInput): void => {
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
export class WasmSparseSelectedCovariance implements SparseSelectedCovarianceSolver, SparseSelectedBlockSolver {
  public constructor(private readonly _module: WebNetWasmModule) {}

  /**
   * Thin wrapper over `webnet_sparse_selected_covariance_blocks`.
   *
   * One bridge call per invocation: validates block geometry, copies
   * buffers across the WASM boundary once, and returns row-major blocks
   * in deterministic request order alongside factor metadata.
   */
  public queryBlocks(input: SparseSelectedBlockInput): SparseSelectedBlockResult {
    validateEquationSystem(input);
    if (!Number.isInteger(input.blockSize) || input.blockSize <= 0) {
      throw new Error('WASM selected blocks require a positive block size.');
    }
    if (input.blockRowStarts.length !== input.blockColStarts.length) {
      throw new Error('WASM selected blocks require one row start per column start.');
    }
    if (input.blockSize > input.parameterCount) {
      throw new Error('WASM selected blocks do not fit the parameter range.');
    }
    const blockCount = input.blockRowStarts.length;
    for (let b = 0; b < blockCount; b += 1) {
      const rowBase = input.blockRowStarts[b] ?? -1;
      const colBase = input.blockColStarts[b] ?? -1;
      if (!Number.isInteger(rowBase) || !Number.isInteger(colBase) ||
          rowBase < 0 || colBase < 0 ||
          rowBase > input.parameterCount - input.blockSize ||
          colBase > input.parameterCount - input.blockSize) {
        throw new Error(`WASM selected block ${b} starts outside parameter range.`);
      }
    }
    const { design, weights } = input;
    const blocks = new Float64Array(blockCount * input.blockSize * input.blockSize);
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
      const blockRowStartsPointer = alloc(input.blockRowStarts.byteLength);
      const blockColStartsPointer = alloc(input.blockColStarts.byteLength);
      const blocksPointer = alloc(blocks.byteLength);
      const normalNnzPointer = alloc(Int32Array.BYTES_PER_ELEMENT);
      const factorNnzPointer = alloc(Int32Array.BYTES_PER_ELEMENT);
      const dampingPointer = alloc(Float64Array.BYTES_PER_ELEMENT);
      const attemptsPointer = alloc(Int32Array.BYTES_PER_ELEMENT);
      const assemblyPointer = alloc(Float64Array.BYTES_PER_ELEMENT);
      const equilibrationPointer = alloc(Float64Array.BYTES_PER_ELEMENT);
      const analyzePointer = alloc(Float64Array.BYTES_PER_ELEMENT);
      const factorizePointer = alloc(Float64Array.BYTES_PER_ELEMENT);
      const solvePointer = alloc(Float64Array.BYTES_PER_ELEMENT);
      const errorPointer = alloc(error.byteLength);
      this._module.HEAP32.set(design.rowOffsets, rowOffsetsPointer / Int32Array.BYTES_PER_ELEMENT);
      this._module.HEAP32.set(design.columns, designColumnsPointer / Int32Array.BYTES_PER_ELEMENT);
      this._module.HEAPF64.set(design.values, designValuesPointer / Float64Array.BYTES_PER_ELEMENT);
      this._module.HEAP32.set(weights.rows, weightRowsPointer / Int32Array.BYTES_PER_ELEMENT);
      this._module.HEAP32.set(weights.columns, weightColumnsPointer / Int32Array.BYTES_PER_ELEMENT);
      this._module.HEAPF64.set(weights.values, weightValuesPointer / Float64Array.BYTES_PER_ELEMENT);
      this._module.HEAP32.set(input.blockRowStarts, blockRowStartsPointer / Int32Array.BYTES_PER_ELEMENT);
      this._module.HEAP32.set(input.blockColStarts, blockColStartsPointer / Int32Array.BYTES_PER_ELEMENT);
      this._module.HEAPF64[assemblyPointer / Float64Array.BYTES_PER_ELEMENT] = Number.NaN;
      this._module.HEAPF64[equilibrationPointer / Float64Array.BYTES_PER_ELEMENT] = Number.NaN;
      this._module.HEAPF64[analyzePointer / Float64Array.BYTES_PER_ELEMENT] = Number.NaN;
      this._module.HEAPF64[factorizePointer / Float64Array.BYTES_PER_ELEMENT] = Number.NaN;
      this._module.HEAPF64[solvePointer / Float64Array.BYTES_PER_ELEMENT] = Number.NaN;
      const status = this._module._webnet_sparse_selected_covariance_blocks(
        rowOffsetsPointer, designColumnsPointer, designValuesPointer, design.values.length,
        weightRowsPointer, weightColumnsPointer, weightValuesPointer, weights.values.length,
        input.observationEquationCount, input.parameterCount,
        blockRowStartsPointer, blockColStartsPointer, blockCount, input.blockSize,
        blocksPointer, normalNnzPointer, factorNnzPointer,
        dampingPointer, attemptsPointer,
        assemblyPointer, equilibrationPointer, analyzePointer,
        factorizePointer, solvePointer,
        errorPointer, error.byteLength,
      );
      error.set(this._module.HEAPU8.subarray(errorPointer, errorPointer + error.byteLength));
      if (status !== 0) throw new Error(readCString(error) || `WASM selected blocks failed (${status}).`);
      blocks.set(this._module.HEAPF64.subarray(
        blocksPointer / Float64Array.BYTES_PER_ELEMENT,
        blocksPointer / Float64Array.BYTES_PER_ELEMENT + blocks.length,
      ));
      const timings = readTimings(this._module, {
        assembly: assemblyPointer,
        equilibration: equilibrationPointer,
        analyze: analyzePointer,
        factorize: factorizePointer,
        solve: solvePointer,
      });
      return {
        blocks,
        normalNnz: int32(this._module, normalNnzPointer),
        factorNnz: int32(this._module, factorNnzPointer),
        damping: this._module.HEAPF64[dampingPointer / Float64Array.BYTES_PER_ELEMENT] ?? 0,
        dampingAttempts: int32(this._module, attemptsPointer),
        ...(timings === undefined ? {} : { timings }),
      };
    } finally {
      pointers.reverse().forEach((pointer) => this._module._free(pointer));
    }
  }

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
      const assemblyPointer = alloc(Float64Array.BYTES_PER_ELEMENT);
      const equilibrationPointer = alloc(Float64Array.BYTES_PER_ELEMENT);
      const analyzePointer = alloc(Float64Array.BYTES_PER_ELEMENT);
      const factorizePointer = alloc(Float64Array.BYTES_PER_ELEMENT);
      const solvePointer = alloc(Float64Array.BYTES_PER_ELEMENT);
      const errorPointer = alloc(error.byteLength);
      this._module.HEAP32.set(design.rowOffsets, rowOffsetsPointer / Int32Array.BYTES_PER_ELEMENT);
      this._module.HEAP32.set(design.columns, designColumnsPointer / Int32Array.BYTES_PER_ELEMENT);
      this._module.HEAPF64.set(design.values, designValuesPointer / Float64Array.BYTES_PER_ELEMENT);
      this._module.HEAP32.set(weights.rows, weightRowsPointer / Int32Array.BYTES_PER_ELEMENT);
      this._module.HEAP32.set(weights.columns, weightColumnsPointer / Int32Array.BYTES_PER_ELEMENT);
      this._module.HEAPF64.set(weights.values, weightValuesPointer / Float64Array.BYTES_PER_ELEMENT);
      this._module.HEAP32.set(input.queryRows, queryRowsPointer / Int32Array.BYTES_PER_ELEMENT);
      this._module.HEAP32.set(input.queryColumns, queryColumnsPointer / Int32Array.BYTES_PER_ELEMENT);
      // Timing sentinel: an older module that never writes the slots leaves
      // NaN, so timings stay absent (fail-closed) instead of reading zeros.
      this._module.HEAPF64[assemblyPointer / Float64Array.BYTES_PER_ELEMENT] = Number.NaN;
      this._module.HEAPF64[equilibrationPointer / Float64Array.BYTES_PER_ELEMENT] = Number.NaN;
      this._module.HEAPF64[analyzePointer / Float64Array.BYTES_PER_ELEMENT] = Number.NaN;
      this._module.HEAPF64[factorizePointer / Float64Array.BYTES_PER_ELEMENT] = Number.NaN;
      this._module.HEAPF64[solvePointer / Float64Array.BYTES_PER_ELEMENT] = Number.NaN;
      const status = this._module._webnet_sparse_selected_covariance(
        rowOffsetsPointer, designColumnsPointer, designValuesPointer, design.values.length,
        weightRowsPointer, weightColumnsPointer, weightValuesPointer, weights.values.length,
        input.observationEquationCount, input.parameterCount,
        queryRowsPointer, queryColumnsPointer, queryCount,
        covariancePointer, normalNnzPointer, factorNnzPointer,
        dampingPointer, attemptsPointer,
        assemblyPointer, equilibrationPointer, analyzePointer,
        factorizePointer, solvePointer,
        errorPointer, error.byteLength,
      );
      error.set(this._module.HEAPU8.subarray(errorPointer, errorPointer + error.byteLength));
      if (status !== 0) throw new Error(readCString(error) || `WASM selected covariance failed (${status}).`);
      covariance.set(this._module.HEAPF64.subarray(
        covariancePointer / Float64Array.BYTES_PER_ELEMENT,
        covariancePointer / Float64Array.BYTES_PER_ELEMENT + covariance.length,
      ));
      const timings = readTimings(this._module, {
        assembly: assemblyPointer,
        equilibration: equilibrationPointer,
        analyze: analyzePointer,
        factorize: factorizePointer,
        solve: solvePointer,
      });
      return {
        covariance,
        normalNnz: int32(this._module, normalNnzPointer),
        factorNnz: int32(this._module, factorNnzPointer),
        damping: this._module.HEAPF64[dampingPointer / Float64Array.BYTES_PER_ELEMENT] ?? 0,
        dampingAttempts: int32(this._module, attemptsPointer),
        ...(timings === undefined ? {} : { timings }),
      };
    } finally {
      pointers.reverse().forEach((pointer) => this._module._free(pointer));
    }
  }
}
