import type {
  SparseCorrectionSolveInput,
  SparseCorrectionSolveResult,
  SparseCorrectionSolver,
} from '../numericalBackend';
import type { WebNetWasmModule } from './wasmTypes';

const ERROR_CAPACITY = 1024;
const int32 = (module: WebNetWasmModule, pointer: number): number =>
  module.HEAP32[pointer / Int32Array.BYTES_PER_ELEMENT] ?? 0;
const allocate = (module: WebNetWasmModule, bytes: number): number => {
  const pointer = module._malloc(bytes);
  if (pointer === 0) throw new Error('WASM sparse solve could not allocate solver buffers.');
  return pointer;
};
const readCString = (buffer: Uint8Array): string => {
  const end = buffer.indexOf(0);
  return new TextDecoder().decode(buffer.subarray(0, end < 0 ? buffer.length : end));
};

export class WasmSparseNormalEquationSolver implements SparseCorrectionSolver {
  public constructor(private readonly _module: WebNetWasmModule) {}

  public solveFromEquations(input: SparseCorrectionSolveInput): SparseCorrectionSolveResult {
    const { design, weights, misclosures } = input;
    if (input.observationEquationCount !== design.rowOffsets.length - 1 || design.columns.length !== design.values.length || weights.rows.length !== weights.columns.length || weights.rows.length !== weights.values.length || misclosures.length !== input.observationEquationCount) {
      throw new Error('WASM sparse solve received inconsistent packed lengths.');
    }
    const rowOffsets = design.rowOffsets;
    const designColumns = design.columns;
    const designValues = design.values;
    const weightRows = weights.rows;
    const weightColumns = weights.columns;
    const weightValues = weights.values;
    const correction = new Float64Array(input.parameterCount);
    const error = new Uint8Array(ERROR_CAPACITY);
    const pointers: number[] = [];
    const alloc = (bytes: number): number => {
      const pointer = allocate(this._module, Math.max(1, bytes));
      pointers.push(pointer);
      return pointer;
    };
    try {
      const rowOffsetsPointer = alloc(rowOffsets.byteLength);
      const designColumnsPointer = alloc(designColumns.byteLength);
      const designValuesPointer = alloc(designValues.byteLength);
      const weightRowsPointer = alloc(weightRows.byteLength);
      const weightColumnsPointer = alloc(weightColumns.byteLength);
      const weightValuesPointer = alloc(weightValues.byteLength);
      const misclosuresPointer = alloc(misclosures.byteLength);
      const correctionPointer = alloc(correction.byteLength);
      const designNnzPointer = alloc(Int32Array.BYTES_PER_ELEMENT);
      const weightNnzPointer = alloc(Int32Array.BYTES_PER_ELEMENT);
      const normalNnzPointer = alloc(Int32Array.BYTES_PER_ELEMENT);
      const factorNnzPointer = alloc(Int32Array.BYTES_PER_ELEMENT);
      const dampingPointer = alloc(Float64Array.BYTES_PER_ELEMENT);
      const attemptsPointer = alloc(Int32Array.BYTES_PER_ELEMENT);
      const errorPointer = alloc(error.byteLength);
      this._module.HEAP32.set(rowOffsets, rowOffsetsPointer / Int32Array.BYTES_PER_ELEMENT);
      this._module.HEAP32.set(designColumns, designColumnsPointer / Int32Array.BYTES_PER_ELEMENT);
      this._module.HEAPF64.set(designValues, designValuesPointer / Float64Array.BYTES_PER_ELEMENT);
      this._module.HEAP32.set(weightRows, weightRowsPointer / Int32Array.BYTES_PER_ELEMENT);
      this._module.HEAP32.set(weightColumns, weightColumnsPointer / Int32Array.BYTES_PER_ELEMENT);
      this._module.HEAPF64.set(weightValues, weightValuesPointer / Float64Array.BYTES_PER_ELEMENT);
      this._module.HEAPF64.set(misclosures, misclosuresPointer / Float64Array.BYTES_PER_ELEMENT);
      const status = this._module._webnet_sparse_equation_solve(
        rowOffsetsPointer, designColumnsPointer, designValuesPointer, designValues.length,
        weightRowsPointer, weightColumnsPointer, weightValuesPointer, weightValues.length,
        misclosuresPointer, input.observationEquationCount, input.parameterCount,
        correctionPointer, designNnzPointer, weightNnzPointer, normalNnzPointer,
        factorNnzPointer, dampingPointer, attemptsPointer, errorPointer, error.byteLength,
      );
      error.set(this._module.HEAPU8.subarray(errorPointer, errorPointer + error.byteLength));
      if (status !== 0) throw new Error(readCString(error) || `WASM sparse solve failed (${status}).`);
      correction.set(this._module.HEAPF64.subarray(correctionPointer / Float64Array.BYTES_PER_ELEMENT, correctionPointer / Float64Array.BYTES_PER_ELEMENT + correction.length));
      return {
        correction: Array.from(correction, (value) => [value]),
        damping: this._module.HEAPF64[dampingPointer / Float64Array.BYTES_PER_ELEMENT] ?? 0,
        dampingAttempts: int32(this._module, attemptsPointer),
        designNnz: int32(this._module, designNnzPointer),
        weightNnz: int32(this._module, weightNnzPointer),
        normalNnz: int32(this._module, normalNnzPointer),
        factorNnz: int32(this._module, factorNnzPointer),
        ordering: 'AMD',
        solver: 'SimplicialLLT',
      };
    } finally {
      pointers.reverse().forEach((pointer) => this._module._free(pointer));
    }
  }
}
