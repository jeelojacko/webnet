/**
 * Phase 12F.3 W3 wasm-tier contract: REAL production R2B route over the
 * real cpp/build-wasm bundle (missing artifact fails loudly, never a
 * silent skip).
 *
 * Fast CI-sized nets only (ring-12/25, sparse-mesh-25): kill ON + worker +
 * real bundle (no solver overrides; the diagnostic minParams seam only
 * lowers the perf floor for measurement) routes native-sparse-selected-qxx
 * with coords bitwise vs clean TS, redundancy identity < 1e-9, and
 * selectedBlocks.meta present with factorNnz > 0. Bridge-excluded chain
 * stays TS (shared F-BRIDGE gate, zero bundle loads); kill OFF stays TS
 * with no bundle load (canary). No timing gates.
 */
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import {
  runGnssBaselineAdjustment,
  type GnssBaselineAdjustInput,
} from '../../src/engine/gnssBaselineAdjust';
import { createExperimentalSparseNumericalBundle } from '../../src/engine/wasm/experimentalSparseNumericalBundle';
import type { WebNetWasmFactory } from '../../src/engine/wasm/wasmTypes';
import { setSparseAutoRouteBundleLoader } from '../../src/workers/adjustmentSparseAutoRoute';
import {
  runGnssBaselineWithNativeR2B,
  setGnssNativeR2BRouteEnabled,
} from '../../src/workers/gnssBaselineNativeR2BRoute';
import { generateAuditNetwork } from '../../scripts/gnss/gnssNativeAuditCorpus';
import { buildGnssAdjustInput } from '../../scripts/gnss/gnssNativeArchitectureAudit';

const workerOn = { isWorker: true as const };
/** Diagnostic floor-lowering for CI-sized nets (measurement only). */
const smallCohort = { minParams: 1 };

const inputFor = (topology: 'ring' | 'sparse-mesh' | 'chain', stations: number, seed: number): GnssBaselineAdjustInput =>
  buildGnssAdjustInput(generateAuditNetwork(topology, stations, seed));

let bundleLoads = 0;

const installRealBundleLoader = async (): Promise<void> => {
  const built = join(process.cwd(), 'cpp/build-wasm/webnet_core.js');
  const imported = (await import(pathToFileURL(built).href)) as {
    default: WebNetWasmFactory;
  };
  if (typeof imported.default !== 'function') throw new Error('Real WASM factory did not load.');
  const bundle = await createExperimentalSparseNumericalBundle(imported.default);
  bundleLoads = 0;
  setSparseAutoRouteBundleLoader(() => {
    bundleLoads += 1;
    return Promise.resolve(bundle);
  });
};

afterEach(() => {
  setGnssNativeR2BRouteEnabled(false);
  setSparseAutoRouteBundleLoader(undefined);
});

describe('R2B production route (wasm tier, real bundle)', () => {
  it.each([
    ['ring-12', 'ring' as const, 12, 21],
    ['ring-25', 'ring' as const, 25, 7],
    ['sparse-mesh-25', 'sparse-mesh' as const, 25, 7],
  ])('%s: native route, coords bitwise vs TS, identity < 1e-9, meta present', async (
    _label,
    topology,
    stations,
    seed,
  ) => {
    await installRealBundleLoader();
    setGnssNativeR2BRouteEnabled(true);
    const input = inputFor(topology, stations, seed);
    const oracle = runGnssBaselineAdjustment(input);
    const attempt = await runGnssBaselineWithNativeR2B(input, { ...workerOn, ...smallCohort });
    expect(attempt.route).toBe('native-sparse-selected-qxx');
    expect(attempt.result.routeProvenance).toBe('native-sparse-selected-qxx');
    expect(attempt.reasons).toEqual([]);
    expect(bundleLoads).toBeGreaterThanOrEqual(1);
    // Coordinates bitwise identical to clean TS.
    expect(attempt.result.stations).toEqual(oracle.stations);
    expect(attempt.result.residuals).toEqual(oracle.residuals);
    expect(attempt.result.weightedResidualSum).toBe(oracle.weightedResidualSum);
    // Exactly-one-provider-call proxy: verified block store present with real factor meta.
    expect('selectedBlocks' in attempt.result).toBe(true);
    if ('selectedBlocks' in attempt.result) {
      expect(attempt.result.selectedBlocks.meta.factorNnz).toBeGreaterThan(0);
      expect(attempt.result.selectedBlocks.meta.normalNnz).toBeGreaterThan(0);
      expect(attempt.result.selectedBlocks.meta.dampingAttempts).toBe(0);
      expect(attempt.result.selectedBlocks.uniqueColumns).toBe(attempt.result.numParams);
    }
    // Redundancy identity < 1e-9.
    const trace = attempt.result.statistics.reduce((sum, stat) => sum + stat.redundancy.trace, 0);
    expect(Math.abs(trace - attempt.result.dof)).toBeLessThan(1e-9);
    expect('qxx' in attempt.result).toBe(false);
  });

  it('bridge-excluded chain stays TS with zero bundle loads', async () => {
    await installRealBundleLoader();
    setGnssNativeR2BRouteEnabled(true);
    const input = inputFor('chain', 12, 11);
    // Chain trips the shared production F-BRIDGE statistics gate inside clean
    // TS itself: the route must reject at eligibility (native never touched)
    // and surface the TS error, never a native result.
    await expect(
      runGnssBaselineWithNativeR2B(input, { ...workerOn, ...smallCohort }),
    ).rejects.toThrow(/materially non-PSD/);
    expect(bundleLoads).toBe(0);
  });

  it('kill OFF stays TS with no bundle load (canary)', async () => {
    setGnssNativeR2BRouteEnabled(false);
    let loads = 0;
    setSparseAutoRouteBundleLoader(() => {
      loads += 1;
      throw new Error('must not load');
    });
    const input = inputFor('ring', 12, 21);
    const attempt = await runGnssBaselineWithNativeR2B(input, workerOn);
    expect(loads).toBe(0);
    expect(attempt.route).toBe('typescript');
    expect(attempt.result.routeProvenance).toBe('typescript-dense');
    expect(attempt.reasons.join('; ')).toMatch(/kill switch/);
    const oracle = runGnssBaselineAdjustment(input);
    expect(JSON.stringify(attempt.result)).toBe(JSON.stringify(oracle));
  });
});
