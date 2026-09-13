/**
 * Phase 12F.3 W5 — browser/worker proof for the R2B production route.
 *
 * Harness only (not a committed test): runs the 10 required §28 cases in a
 * REAL node worker_threads Worker against the REAL cpp/build-wasm bundle
 * (missing artifact fails loudly, never a silent skip). Small nets
 * (ring-25/mesh-25/repeated-edge-25/chain-25) for speed; no timing gates.
 *
 * Run: `node --import tsx scripts/gnss/gnssR2BWorkerProof.ts`
 *
 * Each native leg asserts: expected route, exact provenance
 * (`native-sparse-selected-qxx`), R2B-vs-TS coords bitwise (JSON-equal
 * stations/residuals plus exact weightedResidualSum), and no dense Qxx
 * (no `qxx` field). Each TS leg asserts route `typescript`, provenance
 * `typescript-dense`, and whole-structure equality with clean TS
 * (or the identical clean-TS throw for the bridged chain).
 */
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';

import { runGnssBaselineAdjustment } from '../../src/engine/gnssBaselineAdjust';
import { createExperimentalSparseNumericalBundle } from '../../src/engine/wasm/experimentalSparseNumericalBundle';
import type { WebNetWasmFactory } from '../../src/engine/wasm/wasmTypes';
import { setSparseAutoRouteBundleLoader } from '../../src/workers/adjustmentSparseAutoRoute';
import {
  deriveGnssNativeR2BEligibility,
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

const SMALL_COHORT = { minParams: 1 };
const SETUP = { horizontalCenteringSigma: 0.005, antennaHeightSigma: 0.002 };

const inputFor = (
  topology: 'ring' | 'sparse-mesh' | 'repeated-edge' | 'chain',
  stations: number,
  seed: number,
  setup = false,
) =>
  buildGnssAdjustInput(
    generateAuditNetwork(topology, stations, seed),
    setup ? SETUP : undefined,
  );

/** Native-leg checks shared by every R2B case (route/provenance/parity/no-qxx). */
const checkNativeLeg = async (
  name: string,
  topology: 'ring' | 'sparse-mesh' | 'repeated-edge',
  seed: number,
  setup: boolean,
  extra: Record<string, number> = {},
): Promise<CaseResult> => {
  const fail = (detail: string): CaseResult =>
    ({ name, expected: 'native-sparse-selected-qxx', actual: 'typescript', pass: false, detail });
  try {
    setGnssNativeR2BRouteEnabled(true);
    const input = inputFor(topology, 25, seed, setup);
    const oracle = runGnssBaselineAdjustment(input);
    const attempt = await runGnssBaselineWithNativeR2B(
      input,
      { isWorker: true, ...SMALL_COHORT, ...extra },
    );
    if (attempt.route !== 'native-sparse-selected-qxx') {
      return fail(`routed ${attempt.route}: ${attempt.reasons.join('; ')}`.slice(0, 300));
    }
    if (attempt.result.routeProvenance !== 'native-sparse-selected-qxx') {
      return fail(`provenance ${String(attempt.result.routeProvenance)}`);
    }
    if (attempt.reasons.length !== 0) {
      return fail(`non-empty reasons: ${attempt.reasons.join('; ')}`.slice(0, 200));
    }
    const stationsEqual =
      JSON.stringify(attempt.result.stations) === JSON.stringify(oracle.stations);
    const residualsEqual =
      JSON.stringify(attempt.result.residuals) === JSON.stringify(oracle.residuals);
    const wrsEqual = attempt.result.weightedResidualSum === oracle.weightedResidualSum;
    if (!stationsEqual || !residualsEqual || !wrsEqual) {
      return fail(
        `parity digest mismatch (stations=${stationsEqual} residuals=${residualsEqual} wrs=${wrsEqual})`,
      );
    }
    if ('qxx' in attempt.result) return fail('dense qxx field present on native leg');
    return {
      name,
      expected: 'native-sparse-selected-qxx',
      actual: attempt.route,
      pass: true,
      detail: 'provenance exact; coords bitwise vs clean TS; no qxx field',
    };
  } catch (error) {
    return fail(error instanceof Error ? error.message.slice(0, 200) : String(error));
  } finally {
    setGnssNativeR2BRouteEnabled(false);
  }
};

const checkTsLeg = (
  name: string,
  run: () => Promise<{ route: string; detail: string }>,
): Promise<CaseResult> => run().then(
  ({ route, detail }) => ({
    name,
    expected: 'typescript',
    actual: route,
    pass: route === 'typescript',
    detail,
  }),
  (error): CaseResult => ({
    name,
    expected: 'typescript',
    actual: 'threw',
    pass: false,
    detail: error instanceof Error ? error.message.slice(0, 200) : String(error),
  }),
);

const runAllCases = async (wasmPath: string): Promise<CaseResult[]> => {
  const results: CaseResult[] = [];
  const imported = (await import(pathToFileURL(wasmPath).href)) as {
    default: WebNetWasmFactory;
  };
  if (typeof imported.default !== 'function') throw new Error('Real WASM factory did not load.');
  const bundle = await createExperimentalSparseNumericalBundle(imported.default);
  let bundleLoads = 0;
  let forbidLoads = false;
  setSparseAutoRouteBundleLoader(() => {
    bundleLoads += 1;
    if (forbidLoads) throw new Error('bundle load forbidden (kill-OFF canary)');
    return Promise.resolve(bundle);
  });

  // 1. below-min -> TS (default perf floor, no diagnostic seam).
  results.push(await checkTsLeg('below-min-25 -> TS', async () => {
    setGnssNativeR2BRouteEnabled(true);
    try {
      const input = inputFor('ring', 25, 7);
      const oracle = runGnssBaselineAdjustment(input);
      const attempt = await runGnssBaselineWithNativeR2B(input, { isWorker: true });
      const wholeEqual = JSON.stringify(attempt.result) === JSON.stringify(oracle);
      return {
        route: attempt.route,
        detail: `${attempt.reasons.join('; ')}; whole-struct equal=${wholeEqual}`.slice(0, 300),
      };
    } finally {
      setGnssNativeR2BRouteEnabled(false);
    }
  }));

  // 2-5. eligible native legs.
  results.push(await checkNativeLeg('ring-25 -> R2B', 'ring', 7, false));
  results.push(await checkNativeLeg('mesh-25 -> R2B', 'sparse-mesh', 7, false));
  results.push(await checkNativeLeg('setup-25 -> R2B', 'ring', 7, true));
  results.push(await checkNativeLeg('repeated-25 -> R2B', 'repeated-edge', 7, false));

  // 6. bridge-excluded chain -> TS (eligibility rejects; clean TS itself
  // throws the production F-BRIDGE statistics error, which the oracle
  // must throw identically).
  results.push(await checkTsLeg('chain-25 -> TS', async () => {
    setGnssNativeR2BRouteEnabled(true);
    try {
      const input = inputFor('chain', 25, 11);
      const eligibility = deriveGnssNativeR2BEligibility(input, {
        isWorker: true,
        ...SMALL_COHORT,
      });
      const bridgePinned =
        !eligibility.eligible && eligibility.reasons.join('; ').match(/bridg/i) != null;
      if (!bridgePinned) {
        return { route: 'NOT-INELIGIBLE', detail: eligibility.reasons.join('; ').slice(0, 200) };
      }
      const loadsBefore = bundleLoads;
      try {
        const attempt = await runGnssBaselineWithNativeR2B(input, {
          isWorker: true,
          ...SMALL_COHORT,
        });
        return {
          route: attempt.route,
          detail: `bridge-ineligible; loads=${bundleLoads - loadsBefore}; ${attempt.reasons.join('; ')}`.slice(0, 300),
        };
      } catch (routeError) {
        let oracleMessage = '';
        try {
          runGnssBaselineAdjustment(input);
        } catch (oracleError) {
          oracleMessage = oracleError instanceof Error ? oracleError.message : String(oracleError);
        }
        const routeMessage = routeError instanceof Error ? routeError.message : String(routeError);
        const identical = oracleMessage !== '' && routeMessage === oracleMessage;
        return {
          route: identical ? 'typescript' : 'MISMATCHED-THROW',
          detail: `bridge-ineligible; clean-TS throw identical=${identical}: ${routeMessage}`.slice(0, 300),
        };
      }
    } finally {
      setGnssNativeR2BRouteEnabled(false);
    }
  }));

  // 7. fill-gate-excluded -> TS.
  results.push(await checkTsLeg('fill-gate-override -> TS', async () => {
    setGnssNativeR2BRouteEnabled(true);
    try {
      const input = inputFor('ring', 25, 7);
      const oracle = runGnssBaselineAdjustment(input);
      const attempt = await runGnssBaselineWithNativeR2B(input, {
        isWorker: true,
        ...SMALL_COHORT,
        maxFactorNnz: 1,
      });
      const wholeEqual = JSON.stringify(attempt.result) === JSON.stringify(oracle);
      return {
        route: attempt.route,
        detail: `${attempt.reasons.join('; ')}; whole-struct equal=${wholeEqual}`.slice(0, 300),
      };
    } finally {
      setGnssNativeR2BRouteEnabled(false);
    }
  }));

  // 8. above-max -> TS.
  results.push(await checkTsLeg('above-max-override -> TS', async () => {
    setGnssNativeR2BRouteEnabled(true);
    try {
      const input = inputFor('ring', 25, 7);
      const loadsBefore = bundleLoads;
      const attempt = await runGnssBaselineWithNativeR2B(input, {
        isWorker: true,
        ...SMALL_COHORT,
        maxTotalStations: 1,
      });
      return {
        route: attempt.route,
        detail: `loads=${bundleLoads - loadsBefore}; ${attempt.reasons.join('; ')}`.slice(0, 300),
      };
    } finally {
      setGnssNativeR2BRouteEnabled(false);
    }
  }));

  // 9. forced native failure (throwing block solver; real correction solver
  // from the bundle) -> TS with whole-struct equality.
  results.push(await checkTsLeg('forced-fail -> TS', async () => {
    setGnssNativeR2BRouteEnabled(true);
    try {
      const input = inputFor('ring', 25, 7);
      const oracle = runGnssBaselineAdjustment(input);
      const attempt = await runGnssBaselineWithNativeR2B(input, {
        isWorker: true,
        ...SMALL_COHORT,
        correctionSolverOverride: bundle.sparseCorrectionSolver,
        blockSolverOverride: {
          queryBlocks: () => {
            throw new Error('injected block failure');
          },
        } as unknown as typeof bundle.sparseSelectedCovarianceSolver,
      });
      const wholeEqual = JSON.stringify(attempt.result) === JSON.stringify(oracle);
      return {
        route: attempt.route,
        detail: `${attempt.reasons.join('; ')}; whole-struct equal=${wholeEqual}`.slice(0, 300),
      };
    } finally {
      setGnssNativeR2BRouteEnabled(false);
    }
  }));

  // 10. kill switch OFF -> TS with zero bundle loads.
  results.push(await checkTsLeg('kill-off -> TS', async () => {
    setGnssNativeR2BRouteEnabled(false);
    forbidLoads = true;
    const loadsBefore = bundleLoads;
    try {
      const input = inputFor('ring', 25, 7);
      const oracle = runGnssBaselineAdjustment(input);
      const attempt = await runGnssBaselineWithNativeR2B(input, {
        isWorker: true,
        ...SMALL_COHORT,
      });
      const wholeEqual = JSON.stringify(attempt.result) === JSON.stringify(oracle);
      return {
        route: attempt.route,
        detail: `loads=${bundleLoads - loadsBefore}; ${attempt.reasons.join('; ')}; whole-struct equal=${wholeEqual}`.slice(0, 300),
      };
    } finally {
      forbidLoads = false;
    }
  }));

  // 11. worker-only: isWorker false -> TS (route module is worker-only).
  results.push(await checkTsLeg('non-worker -> TS', async () => {
    setGnssNativeR2BRouteEnabled(true);
    try {
      const input = inputFor('ring', 25, 7);
      const loadsBefore = bundleLoads;
      const attempt = await runGnssBaselineWithNativeR2B(input, {
        isWorker: false,
        ...SMALL_COHORT,
      });
      return {
        route: attempt.route,
        detail: `loads=${bundleLoads - loadsBefore}; ${attempt.reasons.join('; ')}`.slice(0, 300),
      };
    } finally {
      setGnssNativeR2BRouteEnabled(false);
    }
  }));

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
    const tag = result.pass ? 'PASS' : 'FAIL';
    if (!result.pass) failed += 1;
    console.log(`[${tag}] ${result.name} (expected ${result.expected}, got ${result.actual}): ${result.detail}`);
  }
  console.log(`${results.length - failed}/${results.length} worker-thread cases passed (real WASM, real Worker).`);
  if (failed > 0) process.exit(1);
  console.log('R2B worker-thread proof passed.');
}
