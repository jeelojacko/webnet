export interface WebNetWasmModule {
  HEAPF64: Float64Array;
  HEAPU8: Uint8Array;
  HEAP32: Int32Array;
  _malloc(_size: number): number;
  _free(_pointer: number): void;
  _webnet_dense_solve(
    _normal: number,
    _rhs: number,
    _correction: number,
    _dimension: number,
    _damping: number,
    _attempts: number,
    _error: number,
    _errorCapacity: number,
  ): number;
}

export type WebNetWasmFactory = () => Promise<WebNetWasmModule> | WebNetWasmModule;
