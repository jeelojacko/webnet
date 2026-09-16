/**
 * Phase 15C agent-tier contract: native full-Qxx default-session (auto) reachability, Model A.
 *
 * Fast unit-scope checks (mock dense-backed covariance bundle, no WASM, tiny
 * deterministic 3D networks): eligibility admits suspect-impact off+auto and
 * rejects on/unknown with a mode-naming reason; kill switch forces clean
 * TypeScript; capture-overflow and empty verification reject fail-closed at
 * the unit level; an auto session with one LOO alternate reaches native with
 * whole-session verification and clean-TS parity; a mid-session verification
 * failure falls back to a clean-TS rerun with identical outcome.
 */
import { describe, expect, it, afterEach } from 'vitest';

import { runAdjustmentSession } from '../src/engine/runSession';
import type { RunSessionRequest } from '../src/engine/runSessionTypes';
import {
  deriveNativeFullQxxEligibility,
  finalizeNativeFullQxxVerification,
  runWithNativeFullQxxAutoRoute,
  setNativeFullQxxRouteEnabled,
  verifyNativeFullQxxSystems,
  type CapturedNativeFullQxxSystem,
} from '../src/workers/adjustmentNativeFullQxxAutoRoute';
import type { SparseAutoRouteBundle } from '../src/workers/adjustmentSparseAutoRoute';
import type { AdjustmentResult } from '../src/typesAdjustmentResult';
import { createRunSessionRequest } from './helpers/runSessionRequest';
import { buildMinimal3dInput } from './helpers/phase15cSessionNetworks';
import { countingCovarianceSolver } from './helpers/sparseTestStubs';

afterEach(() => {
  setNativeFullQxxRouteEnabled(true);
});

const requestFor = (input: string, suspectImpactMode: 'off' | 'auto' | 'on'): RunSessionRequest => {
  const base = createRunSessionRequest({ input });
  return {
    ...base,
    parseSettings: { ...base.parseSettings, coordMode: '3D', suspectImpactMode },
  };
};

const mockBundle = () =>
  ({
    sparseSelectedCovarianceSolver: countingCovarianceSolver(),
  }) as unknown as SparseAutoRouteBundle;

/** Routing/timing-stripped canonical form for native-vs-clean parity. */
const canonical = (result: AdjustmentResult): string => {
  const rows = (result.suspectImpactDiagnostics ?? []).map((row) => {
    const { elapsedMs: _dropped, ...stable } = row;
    return stable;
  });
  return JSON.stringify({
    success: result.success,
    converged: result.converged,
    iterations: result.iterations,
    seuw: result.seuw,
    dof: result.dof,
    stations: result.stations,
    observations: result.observations,
    chiSquare: result.chiSquare,
    suspectImpactDiagnostics: rows,
  });
};

describe('Phase 15C native default-session eligibility', () => {
  it("admits suspect-impact 'off' and 'auto', rejects 'on' with a mode-naming reason", () => {
    const input = buildMinimal3dInput();
    const off = deriveNativeFullQxxEligibility(requestFor(input, 'off'));
    expect(off.eligible).toBe(true);
    expect(off.numParams).toBe(3);

    const auto = deriveNativeFullQxxEligibility(requestFor(input, 'auto'));
    expect(auto.eligible).toBe(true);
    expect(auto.numParams).toBe(3);

    const on = deriveNativeFullQxxEligibility(requestFor(input, 'on'));
    expect(on.eligible).toBe(false);
    expect(on.reasons.join('; ')).toContain("suspect-impact mode 'on'");
    expect(on.reasons.join('; ')).toContain('auto/off sessions only');
  });

  it('rejects unknown suspect-impact modes fail-closed', () => {
    const base = requestFor(buildMinimal3dInput(), 'auto');
    const weird = {
      ...base,
      parseSettings: { ...base.parseSettings, suspectImpactMode: 'sometimes' },
    } as unknown as RunSessionRequest;
    const eligibility = deriveNativeFullQxxEligibility(weird);
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reasons.join('; ')).toContain("suspect-impact mode 'sometimes'");
  });

  it('kill switch forces clean TypeScript even for an eligible auto session', async () => {
    setNativeFullQxxRouteEnabled(false);
    const attempt = await runWithNativeFullQxxAutoRoute(requestFor(buildMinimal3dInput({ gpsEErr: 0.5 }), 'auto'), undefined, {
      runSession: runAdjustmentSession,
      loadBundle: async () => mockBundle(),
    });
    expect(attempt.route).toBe('typescript');
    expect(attempt.reasons.join('; ')).toContain('kill switch');
    expect(attempt.outcome.result.success).toBe(true);
  });
});

describe('Phase 15C native default-session verification bounds', () => {
  it('capture overflow (65 systems, evidence mismatch) rejects fail-closed', () => {
    const systems = Array.from(
      { length: 65 },
      () => ({ parameterCount: 3 }) as unknown as CapturedNativeFullQxxSystem,
    );
    const verification = finalizeNativeFullQxxVerification(systems, [], false, 3);
    expect(verification.accepted).toBe(false);
    expect(verification.reasons.join('; ')).toMatch(/inline evidence count 0 != captured 65/);
  });

  it('truncated capture rejects fail-closed', () => {
    const verification = finalizeNativeFullQxxVerification([], [], true, null);
    expect(verification.accepted).toBe(false);
    expect(verification.reasons.join('; ')).toMatch(/truncated/);
  });

  it('empty verification rejects fail-closed', () => {
    const verification = verifyNativeFullQxxSystems([], false, null);
    expect(verification.accepted).toBe(false);
    expect(verification.reasons.join('; ')).toMatch(/no native covariance systems captured/);
  });
});

describe('Phase 15C native default-session execution (Model A)', () => {
  it('auto one-candidate session reaches native with whole-session verification and clean parity', async () => {
    const request = requestFor(buildMinimal3dInput({ gpsEErr: 0.5 }), 'auto');
    const clean = runAdjustmentSession(request, undefined, undefined);
    expect(clean.result.suspectImpactDiagnostics?.length).toBe(1);

    const bundle = mockBundle();
    const attempt = await runWithNativeFullQxxAutoRoute(request, undefined, {
      runSession: runAdjustmentSession,
      loadBundle: async () => bundle,
    });
    expect(attempt.route).toBe('native-full-qxx');
    expect(attempt.verification?.accepted).toBe(true);
    expect(attempt.reasons).toEqual([]);
    // Whole-session capture: primary + 1 LOO alternate, every system inline-verified.
    expect(attempt.verification?.oracledSystemCount).toBe(2);
    expect(canonical(attempt.outcome.result)).toBe(canonical(clean.result));
  });

  it('mid-session verification failure reruns the whole session in clean TypeScript with identical outcome', async () => {
    const request = requestFor(buildMinimal3dInput({ gpsEErr: 0.5 }), 'auto');
    const clean = runAdjustmentSession(request, undefined, undefined);
    expect(clean.result.suspectImpactDiagnostics?.length).toBe(1);

    const delegate = countingCovarianceSolver();
    let calls = 0;
    const flaky = {
      querySelected: (input: Parameters<typeof delegate.querySelected>[0]) => {
        calls += 1;
        if (calls >= 2) throw new Error('native covariance unavailable on alternate');
        return delegate.querySelected(input);
      },
    };
    const attempt = await runWithNativeFullQxxAutoRoute(request, undefined, {
      runSession: runAdjustmentSession,
      loadBundle: async () =>
        ({ sparseSelectedCovarianceSolver: flaky }) as unknown as SparseAutoRouteBundle,
    });
    expect(attempt.route).toBe('typescript');
    expect(attempt.reasons.length).toBeGreaterThan(0);
    expect(attempt.reasons.join('; ')).toMatch(/fail-closed/);
    expect(canonical(attempt.outcome.result)).toBe(canonical(clean.result));
  });
});
