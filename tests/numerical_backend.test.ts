import { describe, expect, it } from 'vitest';

import { resolveNumericalBackend } from '../src/engine/numericalBackend';
import { loadWasmSmokeModule } from '../src/engine/wasmSmoke';

describe('numerical backend boundary', () => {
  it('keeps TypeScript as the default authoritative backend', () => {
    expect(resolveNumericalBackend()).toBe('typescript');
    expect(resolveNumericalBackend({ backend: 'wasm' })).toBe('wasm');
  });

  it('loads and calls a coarse-grained WASM-compatible smoke module', async () => {
    const module = await loadWasmSmokeModule(() => ({ add: (_a, _b) => _a + _b }));
    expect(module?.add(2, 3)).toBe(5);
  });

  it('fails safely when optional WASM is unavailable', async () => {
    await expect(loadWasmSmokeModule()).resolves.toBeNull();
    await expect(loadWasmSmokeModule(() => { throw new Error('unavailable'); })).resolves.toBeNull();
  });
});
