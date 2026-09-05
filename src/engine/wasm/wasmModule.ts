import type { WebNetWasmFactory, WebNetWasmModule } from './wasmTypes';

let modulePromise: Promise<WebNetWasmModule | null> | null = null;

export const loadWebNetWasm = (
  factory?: WebNetWasmFactory,
): Promise<WebNetWasmModule | null> => {
  if (!factory) return Promise.resolve(null);
  modulePromise ??= Promise.resolve().then(factory).catch(() => null);
  return modulePromise;
};

export const resetWebNetWasmLoaderForTests = (): void => {
  modulePromise = null;
};
