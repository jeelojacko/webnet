/**
 * Phase 7B worker-local runtime provider seam (no production routing).
 *
 * Holds a non-serializable `AdjustmentRuntime` inside the worker thread so
 * tests can inject sparse solvers/diagnostics without adding fields to
 * `RunSessionRequest` or the worker protocol. Production default is
 * `undefined`, which preserves exact legacy behavior.
 */
import type { AdjustmentRuntime } from '../engine/adjustmentRuntime';

export type AdjustmentWorkerRuntimeProvider = () => AdjustmentRuntime | undefined;

let runtimeProvider: AdjustmentWorkerRuntimeProvider | undefined;

/** Injects (or clears) the worker-local runtime provider. Test-only. */
export const setAdjustmentWorkerRuntimeProvider = (
  provider: AdjustmentWorkerRuntimeProvider | undefined,
): void => {
  runtimeProvider = provider;
};

/** Convenience injection of a fixed runtime object. Test-only. */
export const setAdjustmentWorkerRuntime = (
  runtime: AdjustmentRuntime | undefined,
): void => {
  runtimeProvider = runtime === undefined ? undefined : () => runtime;
};

/** Resolves the current worker-local runtime (undefined by default). */
export const getAdjustmentWorkerRuntime = (): AdjustmentRuntime | undefined =>
  runtimeProvider?.();
