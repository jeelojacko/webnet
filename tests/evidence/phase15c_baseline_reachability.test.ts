/**
 * Phase 15C §1 BASELINE: suspect-impact 'on' blocks the native 3D full-Qxx route.
 *
 * EVIDENCE ONLY — no production changes. Same otherwise-eligible small 3D job
 * (gps-3d ladder, 8 unknowns = 24 params, real-WASM bundle like the Phase 11A
 * WASM-tier contract) solved twice through the production auto-route:
 * suspectImpactMode='off' => route 'native-full-qxx' (C1/C2/C3 accepted,
 * reasons empty); suspectImpactMode='on' => route 'typescript' with the
 * suspect-impact ineligibility reason, WASM bundle never touched. (Phase 15C
 * Model A admits the production default 'auto' — auto/off sessions run the
 * whole session natively with per-system inline verification; only 'on'
 * stays rejected.) Route evidence / failure reasons only, no timing.
 */
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { generatePhase6Large3dInput } from '../../src/engine/phase6BenchmarkNetworks';
import { runAdjustmentSession } from '../../src/engine/runSession';
import type { SparseSelectedCovarianceSolver } from '../../src/engine/numericalBackend';
import { createExperimentalSparseNumericalBundle } from '../../src/engine/wasm/experimentalSparseNumericalBundle';
import type { WebNetWasmFactory } from '../../src/engine/wasm/wasmTypes';
import {
  deriveNativeFullQxxEligibility,
  runWithNativeFullQxxAutoRoute,
  setNativeFullQxxRouteEnabled,
} from '../../src/workers/adjustmentNativeFullQxxAutoRoute';
import { createRunSessionRequest } from '../helpers/runSessionRequest';

const input = generatePhase6Large3dInput({
  id: 'gps-3d-baseline-08',
  family: 'gps-2d',
  unknownCount: 8,
  seed: 2308,
  variant: 'gps-covariance',
  dimension: '3d',
});

const toRequest = (suspectImpactMode: 'off' | 'on') => {
  const base = createRunSessionRequest({ input });
  return {
    ...base,
    parseSettings: { ...base.parseSettings, coordMode: '3D' as const, suspectImpactMode },
  };
};

let bundle: { sparseSelectedCovarianceSolver: SparseSelectedCovarianceSolver } | null = null;
const loadBundle = async () => {
  if (bundle) return bundle as never;
  const mod = (await import(
    pathToFileURL(`${process.cwd()}/cpp/build-wasm/webnet_core.js`).href
  )) as { default: WebNetWasmFactory };
  if (typeof mod.default !== 'function') throw new Error('WASM factory missing');
  const real = await createExperimentalSparseNumericalBundle(mod.default);
  bundle = { sparseSelectedCovarianceSolver: real.sparseSelectedCovarianceSolver };
  return bundle as never;
};

describe('Phase 15C baseline: suspect-impact on-mode reachability (real WASM)', () => {
  it("same eligible 3D job: 'off' reaches native, 'on' is rejected", async () => {
    setNativeFullQxxRouteEnabled(true);

    const offEligibility = deriveNativeFullQxxEligibility(toRequest('off'));
    expect(offEligibility.numParams).toBe(24);
    expect(offEligibility.eligible, `off eligible: ${offEligibility.reasons.join('; ')}`).toBe(true);

    const onEligibility = deriveNativeFullQxxEligibility(toRequest('on'));
    expect(onEligibility.eligible).toBe(false);
    expect(onEligibility.reasons.join('; ')).toContain("suspect-impact mode 'on'");

    const off = await runWithNativeFullQxxAutoRoute(toRequest('off'), undefined, {
      runSession: runAdjustmentSession,
      loadBundle,
    });
    expect(off.outcome.result.success).toBe(true);
    expect(off.route).toBe('native-full-qxx');
    expect(off.verification?.accepted).toBe(true);
    expect(off.reasons).toEqual([]);

    let bundleTouched = false;
    const on = await runWithNativeFullQxxAutoRoute(toRequest('on'), undefined, {
      runSession: runAdjustmentSession,
      loadBundle: (async () => {
        bundleTouched = true;
        return loadBundle();
      }) as never,
    });
    expect(on.outcome.result.success).toBe(true);
    expect(on.route).toBe('typescript');
    expect(on.verification).toBeUndefined();
    expect(on.reasons.join('; ')).toContain("suspect-impact mode 'on'");
    expect(bundleTouched).toBe(false);

    console.log(
      `15C baseline: off -> ${off.route} (verify ${off.verification?.accepted}, reasons []); ` +
        `on -> ${on.route} (reasons [${on.reasons.join('; ')}], wasm touched: ${bundleTouched})`,
    );
  }, 300000);
});
