export interface WasmSmokeModule {
  add(_a: number, _b: number): number;
}

export type WasmSmokeModuleFactory = () => Promise<WasmSmokeModule> | WasmSmokeModule;

/** Lazy, optional loader seam; production adjustment remains TypeScript in Phase 0. */
export const loadWasmSmokeModule = async (
  factory?: WasmSmokeModuleFactory,
): Promise<WasmSmokeModule | null> => {
  if (!factory) return null;
  try {
    return await factory();
  } catch {
    return null;
  }
};
