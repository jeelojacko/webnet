import type {
  NormalEquationSolveResult,
  NormalEquationSolver,
} from '../numericalBackend';
import type { WebNetWasmModule } from './wasmTypes';

const ERROR_CAPACITY = 1024;

const flattenMatrix = (matrix: number[][], dimension: number): Float64Array => {
  if (matrix.length !== dimension || matrix.some((row) => row.length !== dimension)) {
    throw new Error('WASM dense solve requires a square normal matrix.');
  }
  return Float64Array.from(matrix.flat());
};

const flattenRhs = (rhs: number[][], dimension: number): Float64Array => {
  if (rhs.length !== dimension || rhs.some((row) => row.length !== 1)) {
    throw new Error('WASM dense solve requires exactly one RHS value per parameter.');
  }
  return Float64Array.from(rhs.map((row) => row[0] ?? 0));
};

export class WasmDenseNormalEquationSolver implements NormalEquationSolver {
  public constructor(private readonly _module: WebNetWasmModule) {}

  public solveCorrection(normal: number[][], rhs: number[][]): NormalEquationSolveResult {
    const dimension = normal.length;
    if (dimension === 0) throw new Error('WASM dense solve requires at least one parameter.');
    const normalBuffer = flattenMatrix(normal, dimension);
    const rhsBuffer = flattenRhs(rhs, dimension);
    const correctionBuffer = new Float64Array(dimension);
    const errorBuffer = new Uint8Array(ERROR_CAPACITY);
    const normalPointer = this._module._malloc(normalBuffer.byteLength);
    const rhsPointer = this._module._malloc(rhsBuffer.byteLength);
    const correctionPointer = this._module._malloc(correctionBuffer.byteLength);
    const errorPointer = this._module._malloc(errorBuffer.byteLength);
    const dampingPointer = this._module._malloc(Float64Array.BYTES_PER_ELEMENT);
    const attemptsPointer = this._module._malloc(Int32Array.BYTES_PER_ELEMENT);
    try {
      if ([normalPointer, rhsPointer, correctionPointer, errorPointer, dampingPointer, attemptsPointer].some((pointer) => pointer === 0)) {
        throw new Error('WASM dense solve could not allocate solver buffers.');
      }
      this._module.HEAPF64.set(normalBuffer, normalPointer / Float64Array.BYTES_PER_ELEMENT);
      this._module.HEAPF64.set(rhsBuffer, rhsPointer / Float64Array.BYTES_PER_ELEMENT);
      const status = this._module._webnet_dense_solve(
        normalPointer,
        rhsPointer,
        correctionPointer,
        dimension,
        dampingPointer,
        attemptsPointer,
        errorPointer,
        errorBuffer.byteLength,
      );
      errorBuffer.set(
        this._module.HEAPU8.subarray(errorPointer, errorPointer + errorBuffer.byteLength),
      );
      if (status !== 0) throw new Error(readCString(errorBuffer) || `WASM dense solve failed (${status}).`);
      correctionBuffer.set(
        this._module.HEAPF64.subarray(
          correctionPointer / Float64Array.BYTES_PER_ELEMENT,
          correctionPointer / Float64Array.BYTES_PER_ELEMENT + dimension,
        ),
      );
      const damping = this._module.HEAPF64[dampingPointer / Float64Array.BYTES_PER_ELEMENT] ?? 0;
      const attempts = this._module.HEAP32[attemptsPointer / Int32Array.BYTES_PER_ELEMENT] ?? 0;
      return {
        correction: Array.from(correctionBuffer, (value) => [value]),
        damping,
        dampingAttempts: attempts,
      };
    } finally {
      if (attemptsPointer) this._module._free(attemptsPointer);
      if (dampingPointer) this._module._free(dampingPointer);
      if (errorPointer) this._module._free(errorPointer);
      if (correctionPointer) this._module._free(correctionPointer);
      if (rhsPointer) this._module._free(rhsPointer);
      if (normalPointer) this._module._free(normalPointer);
    }
  }
}

const readCString = (buffer: Uint8Array): string => {
  const end = buffer.indexOf(0);
  return new TextDecoder().decode(buffer.subarray(0, end < 0 ? buffer.length : end));
};
