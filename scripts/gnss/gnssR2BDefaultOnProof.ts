/**
 * Phase 12F.4 — default-ON proof for the certified R2B cohort.
 *
 * Unlike the 12F.3 harnesses (explicit kill-switch ON + diagnostic
 * minParams seam), every leg below runs NORMAL PRODUCTION DISPATCH: no
 * `setGnssNativeR2BRouteEnabled(true)` call and no bound overrides,
 * except the legs that explicitly test kill-switch OFF / re-enable and
 * the forced fill-cap fallback. The whole case list runs inside a REAL
 * node worker_threads Worker against the REAL cpp/build-wasm bundle
 * (missing artifact fails loudly). Production bounds apply: ring-100
 * (p=297) is the smallest fast eligible net; ring-25 stays TS below
 * the 225 floor.
 *
 * Run: `node --import tsx scripts/gnss/gnssR2BDefaultOnProof.ts`
 */
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';

import {
  runGnssBaselineAdjustment,
  type GnssBaselineAdjustInput,
} from '../../src/engine/gnssBaselineAdjust';
import { createExperimentalSparseNumericalBundle } from '../../src/engine/wasm/experimentalSparseNumericalBundle';
import type { WebNetWasmFactory } from '../../src/engine/wasm/wasmTypes';
import { setSparseAutoRouteBundleLoader } from '../../src/workers/adjustmentSparseAutoRoute';
import {
  deriveGnssNativeR2BEligibility,
  isGnssNativeR2BRouteEnabled,
  runGnssBaselineWithNativeR2B,
  setGnssNativeR2BRouteEnabled,
} from '../../src/workers/gnssBaselineNativeR2BRoute';
import { generateAuditNetwork } from './gnssNativeAuditCorpus';
import { buildGnssAdjustInput } from './gnssNativeArchitectureAudit';

interface CaseResult {
  name: string;
  expected: string;
  actual: string;
  pass: boolean;
  detail: string;
}

const inputFor = (
  topology: 'ring' | 'sparse-mesh' | 'chain',
  stations: number,
  seed: number,
  setup = false,
): GnssBaselineAdjustInput =>
  buildGnssAdjustInput(
    generateAuditNetwork(topology, stations, seed),
    setup ? { horizontalCenteringSigma: 0.005, antennaHeightSigma: 0.002 } : undefined,
  );

const runAllCases = async (wasmPath: string): Promise<CaseResult[]> => {
  const results: CaseResult[] = [];
  const ok = (name: string, expected: string, actual: string, pass: boolean, detail: string): void => {
    results.push({ name, expected, actual, pass, detail });
  };

  // 0. Pristine default must be ON (no enable call issued yet in worker).
  ok(
    'pristine default ON',
    'true',
    String(isGnssNativeR2BRouteEnabled()),
    isGnssNativeR2BRouteEnabled() === true,
    `switch=${isGnssNativeR2BRouteEnabled()}`,
  );

  const imported = (await import(pathToFileURL(wasmPath).href)) as {
    default: WebNetWasmFactory;
  };
  if (typeof imported.default !== 'function') throw new Error('Real WASM factory did not load.');
  const bundle = await createExperimentalSparseNumericalBundle(imported.default);
  let bundleLoads = 0;
  setSparseAutoRouteBundleLoader(() => {
    bundleLoads += 1;
    return Promise.resolve(bundle);
  });

  // 1. Default dispatch, eligible ring-100 (p=297): R2B, bitwise vs TS.
  try {
    const input = inputFor('ring', 100, 7);
    const oracle = runGnssBaselineAdjustment(input);
    const t0 = performance.now();
    const attempt = await runGnssBaselineWithNativeR2B(input, { isWorker: true });
    const wall = performance.now() - t0;
    const bitwise =
      JSON.stringify(attempt.result.stations) === JSON.stringify(oracle.stations) &&
      JSON.stringify(attempt.result.residuals) === JSON.stringify(oracle.residuals) &&
      attempt.result.weightedResidualSum === oracle.weightedResidualSum;
    ok(
      'default eligible ring-100 -> R2B',
      'native-sparse-selected-qxx',
      attempt.route,
      attempt.route === 'native-sparse-selected-qxx' &&
        attempt.result.routeProvenance === 'native-sparse-selected-qxx' &&
        bitwise && !('qxx' in attempt.result),
      `bitwise=${bitwise} wall=${wall.toFixed(0)}ms loads=${bundleLoads}`,
    );
  } catch (error) {
    ok('default eligible ring-100 -> R2B', 'native-sparse-selected-qxx', 'threw', false, String(error).slice(0, 200));
  }

  // 2. Default dispatch, eligible mesh-150 + setup uncertainty: R2B.
  try {
    const input = inputFor('sparse-mesh', 150, 7, true);
    const oracle = runGnssBaselineAdjustment(input);
    const attempt = await runGnssBaselineWithNativeR2B(input, { isWorker: true });
    const bitwise =
      JSON.stringify(attempt.result.stations) === JSON.stringify(oracle.stations) &&
      attempt.result.weightedResidualSum === oracle.weightedResidualSum;
    const trace = attempt.result.statistics.reduce((sum, stat) => sum + stat.redundancy.trace, 0);
    ok(
      'default eligible mesh-150+setup -> R2B',
      'native-sparse-selected-qxx',
      attempt.route,
      attempt.route === 'native-sparse-selected-qxx' && bitwise &&
        Math.abs(trace - attempt.result.dof) < 1e-9 && !('qxx' in attempt.result),
      `bitwise=${bitwise} identity=${Math.abs(trace - attempt.result.dof).toExponential(1)}`,
    );
  } catch (error) {
    ok('default eligible mesh-150+setup -> R2B', 'native-sparse-selected-qxx', 'threw', false, String(error).slice(0, 200));
  }

  // 3. Default dispatch below floor: TS, zero bundle loads.
  try {
    const before = bundleLoads;
    const input = inputFor('ring', 25, 21);
    const oracle = runGnssBaselineAdjustment(input);
    const attempt = await runGnssBaselineWithNativeR2B(input, { isWorker: true });
    ok(
      'default below-floor ring-25 -> TS zero-load',
      'typescript',
      attempt.route,
      attempt.route === 'typescript' &&
        JSON.stringify(attempt.result) === JSON.stringify(oracle) &&
        bundleLoads === before && attempt.reasons.join('; ').includes('perf floor'),
      `loads=${bundleLoads - before}`,
    );
  } catch (error) {
    ok('default below-floor ring-25 -> TS zero-load', 'typescript', 'threw', false, String(error).slice(0, 200));
  }

  // 4. Default dispatch, bridged graph: rejected pre-load, zero loads.
  {
    const before = bundleLoads;
    const input = inputFor('chain', 25, 11);
    const eligibility = deriveGnssNativeR2BEligibility(input, { isWorker: true });
    ok(
      'default bridged chain-25 rejected pre-load',
      'ineligible/cut-edge',
      eligibility.eligible ? 'eligible' : eligibility.reasons.join('; ').slice(0, 90),
      eligibility.eligible === false &&
        eligibility.reasons.join('; ').includes('cut-edge') && bundleLoads === before,
      `loads=${bundleLoads - before}`,
    );
  }

  // 5. Kill switch OFF: eligible job -> TS, zero native load.
  try {
    setGnssNativeR2BRouteEnabled(false);
    const before = bundleLoads;
    const input = inputFor('ring', 100, 7);
    const oracle = runGnssBaselineAdjustment(input);
    const attempt = await runGnssBaselineWithNativeR2B(input, { isWorker: true });
    ok(
      'kill OFF eligible ring-100 -> TS zero-load',
      'typescript',
      attempt.route,
      attempt.route === 'typescript' &&
        JSON.stringify(attempt.result) === JSON.stringify(oracle) && bundleLoads === before,
      `loads=${bundleLoads - before}`,
    );
  } catch (error) {
    ok('kill OFF eligible ring-100 -> TS zero-load', 'typescript', 'threw', false, String(error).slice(0, 200));
  }

  // 6. Re-enable: same job -> R2B again (no stale bypass).
  try {
    setGnssNativeR2BRouteEnabled(true);
    const input = inputFor('ring', 100, 7);
    const attempt = await runGnssBaselineWithNativeR2B(input, { isWorker: true });
    ok(
      're-enable ring-100 -> R2B',
      'native-sparse-selected-qxx',
      attempt.route,
      attempt.route === 'native-sparse-selected-qxx',
      `switch=${isGnssNativeR2BRouteEnabled()}`,
    );
  } catch (error) {
    ok('re-enable ring-100 -> R2B', 'native-sparse-selected-qxx', 'threw', false, String(error).slice(0, 200));
  }

  // 7. Forced fill cap: TS fallback, bitwise.
  try {
    const input = inputFor('ring', 100, 7);
    const oracle = runGnssBaselineAdjustment(input);
    const attempt = await runGnssBaselineWithNativeR2B(input, { isWorker: true, maxFactorNnz: 1 });
    ok(
      'forced fill cap -> TS fallback bitwise',
      'typescript',
      attempt.route,
      attempt.route === 'typescript' &&
        JSON.stringify(attempt.result) === JSON.stringify(oracle),
      attempt.reasons.join('; ').slice(0, 100),
    );
  } catch (error) {
    ok('forced fill cap -> TS fallback bitwise', 'typescript', 'threw', false, String(error).slice(0, 200));
  }

  setSparseAutoRouteBundleLoader(undefined);
  return results;
};

if (!isMainThread) {
  const results = await runAllCases((workerData as { wasmPath: string }).wasmPath);
  parentPort?.postMessage(results);
} else {
  const wasmPath = `${process.cwd()}/cpp/build-wasm/webnet_core.js`;
  const results = await new Promise<CaseResult[]>((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: { wasmPath } });
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new Error('Worker timed out.'));
    }, 300000);
    worker.once('message', (message: CaseResult[]) => {
      clearTimeout(timer);
      void worker.terminate();
      resolve(message);
    });
    worker.once('error', (error) => {
      clearTimeout(timer);
      void worker.terminate();
      reject(error);
    });
    worker.once('exit', (code) => {
      if (code !== 0) {
        clearTimeout(timer);
        reject(new Error(`Worker exited with code ${code}.`));
      }
    });
  });
  let failed = 0;
  for (const result of results) {
    if (!result.pass) failed += 1;
    console.log(`[${result.pass ? 'PASS' : 'FAIL'}] ${result.name} (expected ${result.expected}, got ${result.actual}): ${result.detail}`);
  }
  console.log(`${results.length - failed}/${results.length} default-ON checks passed (real WASM, real Worker).`);
  if (failed > 0) process.exit(1);
  console.log('R2B default-ON proof passed.');
}
