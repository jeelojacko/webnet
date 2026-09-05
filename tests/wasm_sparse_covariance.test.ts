import { describe, expect, it, vi } from 'vitest';

import type { WebNetWasmModule } from '../src/engine/wasm/wasmTypes';
import { WasmSparseSelectedCovariance } from '../src/engine/wasm/wasmSparseCovariance';
import { WasmSparseRowProducts } from '../src/engine/wasm/wasmSparseRowProducts';

interface MockHeap extends WebNetWasmModule {
  freed: number[];
}

const HEAP_BYTES = 1 << 20;

const createMockModule = (handlers: {
  covariance?: (..._args: number[]) => number;
  rowProducts?: (..._args: number[]) => number;
}): MockHeap => {
  const heap = new ArrayBuffer(HEAP_BYTES);
  let next = 8;
  const freed: number[] = [];
  const align = (value: number, to: number): number => Math.ceil(value / to) * to;
  const module = {
    HEAPF64: new Float64Array(heap),
    HEAPU8: new Uint8Array(heap),
    HEAP32: new Int32Array(heap),
    freed,
    _malloc: (bytes: number): number => {
      next = align(next, 8);
      const pointer = next;
      next += align(Math.max(1, bytes), 8);
      if (next > HEAP_BYTES) return 0;
      return pointer;
    },
    _free: (pointer: number): void => {
      freed.push(pointer);
    },
    _webnet_dense_solve: () => 0,
    _webnet_sparse_equation_solve: () => 0,
    _webnet_sparse_selected_covariance: (...args: number[]): number =>
      handlers.covariance?.(...args) ?? 0,
    _webnet_sparse_row_products: (...args: number[]): number =>
      handlers.rowProducts?.(...args) ?? 0,
  } as unknown as MockHeap;
  return module;
};

const writeError = (module: MockHeap, pointer: number, capacity: number, message: string): void => {
  const bytes = new TextEncoder().encode(message);
  module.HEAPU8.fill(0, pointer, pointer + capacity);
  module.HEAPU8.set(bytes.subarray(0, capacity - 1), pointer);
};

const equationSystem = () => ({
  design: {
    rowOffsets: new Int32Array([0, 1, 2]),
    columns: new Int32Array([0, 1]),
    values: new Float64Array([2, 3]),
  },
  weights: {
    rows: new Int32Array([0, 1]),
    columns: new Int32Array([0, 1]),
    values: new Float64Array([1, 1]),
  },
  observationEquationCount: 2,
  parameterCount: 2,
});

describe('WasmSparseSelectedCovariance', () => {
  it('packs queries, decodes outputs, and frees every allocation', () => {
    const module = createMockModule({
      covariance: (rowOffsets, designColumns, designValues, designNnz,
        weightRows, weightColumns, weightValues, weightNnz,
        equationCount, parameterCount, queryRows, queryColumns, queryCount,
        covarianceOut, normalNnzOut, factorNnzOut, dampingOut, attemptsOut,
        error, errorCapacity) => {
        expect(designNnz).toBe(2);
        expect(weightNnz).toBe(2);
        expect(equationCount).toBe(2);
        expect(parameterCount).toBe(2);
        expect(queryCount).toBe(2);
        expect(Array.from(module.HEAP32.subarray(
          queryRows / 4, queryRows / 4 + queryCount))).toEqual([0, 1]);
        expect(Array.from(module.HEAP32.subarray(
          queryColumns / 4, queryColumns / 4 + queryCount))).toEqual([0, 1]);
        module.HEAPF64.set([0.25, 0.5], covarianceOut / 8);
        module.HEAP32[normalNnzOut / 4] = 4;
        module.HEAP32[factorNnzOut / 4] = 3;
        module.HEAPF64[dampingOut / 8] = 0;
        module.HEAP32[attemptsOut / 4] = 1;
        writeError(module, error, errorCapacity, '');
        return 0;
      },
    });
    const wrapper = new WasmSparseSelectedCovariance(module);
    const result = wrapper.querySelected({
      ...equationSystem(),
      queryRows: new Int32Array([0, 1]),
      queryColumns: new Int32Array([0, 1]),
    });
    expect(Array.from(result.covariance)).toEqual([0.25, 0.5]);
    expect(result.normalNnz).toBe(4);
    expect(result.factorNnz).toBe(3);
    expect(result.dampingAttempts).toBe(1);
    expect(module.freed.length).toBeGreaterThan(0);
  });

  it('rejects mismatched query lengths and out-of-range indices', () => {
    const module = createMockModule({});
    const wrapper = new WasmSparseSelectedCovariance(module);
    const base = equationSystem();
    expect(() => wrapper.querySelected({
      ...base, queryRows: new Int32Array([0]), queryColumns: new Int32Array([0, 1]),
    })).toThrow(/one row per query/);
    expect(() => wrapper.querySelected({
      ...base, queryRows: new Int32Array([0]), queryColumns: new Int32Array([7]),
    })).toThrow(/outside parameter range/);
    expect(() => wrapper.querySelected({
      ...base,
      design: { ...base.design, rowOffsets: new Int32Array([0, 1]) },
      queryRows: new Int32Array([0]),
      queryColumns: new Int32Array([0]),
    })).toThrow(/inconsistent packed lengths/);
  });

  it('decodes native error text on nonzero status', () => {
    const module = createMockModule({
      covariance: (...args) => {
        const error = args[args.length - 2] ?? 0;
        const capacity = args[args.length - 1] ?? 0;
        writeError(module, error, capacity, 'factorization failed');
        return 3;
      },
    });
    const wrapper = new WasmSparseSelectedCovariance(module);
    expect(() => wrapper.querySelected({
      ...equationSystem(),
      queryRows: new Int32Array([0]),
      queryColumns: new Int32Array([0]),
    })).toThrow('factorization failed');
  });

  it('surfaces allocation failure without calling the ABI', () => {
    const module = createMockModule({});
    module._malloc = () => 0;
    const spy = vi.spyOn(module, '_webnet_sparse_selected_covariance');
    const wrapper = new WasmSparseSelectedCovariance(module);
    expect(() => wrapper.querySelected({
      ...equationSystem(),
      queryRows: new Int32Array([0]),
      queryColumns: new Int32Array([0]),
    })).toThrow(/could not allocate/);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('WasmSparseRowProducts', () => {
  it('packs CSR queries and cross pairs, then decodes both outputs', () => {
    const module = createMockModule({
      rowProducts: (rowOffsets, designColumns, designValues, designNnz,
        weightRows, weightColumns, weightValues, weightNnz,
        equationCount, parameterCount, queryOffsets, queryColumns, queryValues,
        queryNnz, queryRowCount, crossA, crossB, crossCount,
        quadraticOut, crossOut, normalNnzOut, factorNnzOut, dampingOut,
        attemptsOut, error, errorCapacity) => {
        expect(queryNnz).toBe(2);
        expect(queryRowCount).toBe(2);
        expect(crossCount).toBe(1);
        expect(Array.from(module.HEAP32.subarray(
          queryOffsets / 4, queryOffsets / 4 + 3))).toEqual([0, 1, 2]);
        expect(Array.from(module.HEAP32.subarray(
          crossA / 4, crossA / 4 + 1))).toEqual([0]);
        expect(Array.from(module.HEAP32.subarray(
          crossB / 4, crossB / 4 + 1))).toEqual([1]);
        module.HEAPF64.set([1.5, 2.5], quadraticOut / 8);
        module.HEAPF64.set([0.75], crossOut / 8);
        module.HEAP32[normalNnzOut / 4] = 4;
        module.HEAP32[factorNnzOut / 4] = 3;
        module.HEAPF64[dampingOut / 8] = 0;
        module.HEAP32[attemptsOut / 4] = 2;
        writeError(module, error, errorCapacity, '');
        return 0;
      },
    });
    const wrapper = new WasmSparseRowProducts(module);
    const result = wrapper.queryRowProducts({
      ...equationSystem(),
      queryRowOffsets: new Int32Array([0, 1, 2]),
      queryColumns: new Int32Array([0, 1]),
      queryValues: new Float64Array([1, 1]),
      crossA: new Int32Array([0]),
      crossB: new Int32Array([1]),
    });
    expect(Array.from(result.quadratic)).toEqual([1.5, 2.5]);
    expect(Array.from(result.cross)).toEqual([0.75]);
    expect(result.normalNnz).toBe(4);
    expect(result.dampingAttempts).toBe(2);
    expect(module.freed.length).toBeGreaterThan(0);
  });

  it('rejects inconsistent CSR, cross pairs, and bad columns', () => {
    const module = createMockModule({});
    const wrapper = new WasmSparseRowProducts(module);
    const valid = {
      ...equationSystem(),
      queryRowOffsets: new Int32Array([0, 1, 2]),
      queryColumns: new Int32Array([0, 1]),
      queryValues: new Float64Array([1, 1]),
      crossA: new Int32Array([0]),
      crossB: new Int32Array([1]),
    };
    expect(() => wrapper.queryRowProducts({
      ...valid, queryRowOffsets: new Int32Array([0, 1, 3]),
    })).toThrow(/inconsistent query CSR/);
    expect(() => wrapper.queryRowProducts({
      ...valid, crossA: new Int32Array([0, 1]),
    })).toThrow(/matched cross/);
    expect(() => wrapper.queryRowProducts({
      ...valid, crossB: new Int32Array([9]),
    })).toThrow(/outside query row range/);
    expect(() => wrapper.queryRowProducts({
      ...valid, queryColumns: new Int32Array([0, 9]),
    })).toThrow(/outside parameter range/);
  });

  it('decodes native error text on nonzero status', () => {
    const module = createMockModule({
      rowProducts: (...args) => {
        const error = args[args.length - 2] ?? 0;
        const capacity = args[args.length - 1] ?? 0;
        writeError(module, error, capacity, 'row batch invalid');
        return 1;
      },
    });
    const wrapper = new WasmSparseRowProducts(module);
    expect(() => wrapper.queryRowProducts({
      ...equationSystem(),
      queryRowOffsets: new Int32Array([0, 0]),
      queryColumns: new Int32Array([]),
      queryValues: new Float64Array([]),
      crossA: new Int32Array([]),
      crossB: new Int32Array([]),
    })).toThrow('row batch invalid');
  });
});
