/**
 * Phase 15C evidence: default-session (auto) native full-Qxx parity, Model A (real WASM).
 *
 * EVIDENCE ONLY — no production changes. Every solve in the session
 * (primary + up to 3 LOO alternates) runs with the injected native capture;
 * each captured system is inline-verified before reaching the engine and the
 * finalizer aggregates the cached evidence; any failure reruns clean.
 *
 * - AUTO zero-candidate session: native-vs-clean-TS full parity (timing and
 *   routing metadata stripped; stations, residuals, SEUW, chi-square, local
 *   tests, suspectImpactDiagnostics including ordering compared).
 * - AUTO one-candidate + three-candidate sessions: same parity plus LOO
 *   exactness — each session alternate row matches an independent clean-TS
 *   manual-exclusion run (excludedIds = candidate obsId, mode 'off').
 * - ON mode: explicit rejection (route typescript + mode-naming reason,
 *   WASM bundle never touched).
 */
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { runAdjustmentSession } from '../../src/engine/runSession';
import type { RunSessionRequest } from '../../src/engine/runSessionTypes';
import {
  computeShiftDetail,
  countLocalFailures,
  chiSummaryOf,
  maxAbsStdRes,
} from '../../src/engine/suspectImpactShared';
import type { SparseSelectedCovarianceSolver } from '../../src/engine/numericalBackend';
import { createExperimentalSparseNumericalBundle } from '../../src/engine/wasm/experimentalSparseNumericalBundle';
import type { WebNetWasmFactory } from '../../src/engine/wasm/wasmTypes';
import type { AdjustmentResult } from '../../src/typesAdjustmentResult';
import {
  runWithNativeFullQxxAutoRoute,
  setNativeFullQxxRouteEnabled,
} from '../../src/workers/adjustmentNativeFullQxxAutoRoute';
import { createRunSessionRequest } from '../helpers/runSessionRequest';
import {
  buildMinimal3dInput,
  buildThreeCandidateInput,
} from '../helpers/phase15cSessionNetworks';

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

const requestFor = (
  input: string,
  suspectImpactMode: 'off' | 'auto' | 'on',
  excludedIds: number[] = [],
): RunSessionRequest => {
  const base = createRunSessionRequest({ input, excludedIds });
  return {
    ...base,
    parseSettings: { ...base.parseSettings, coordMode: '3D' as const, suspectImpactMode },
  };
};

/**
 * Numerical contract minus timing/routing metadata (logs, profiler, row elapsedMs).
 * Compared with ULP-aware tolerance: native and TS Qxx come from different
 * inversion algorithms, so Qxx-derived second-order diagnostics (error-ellipse
 * rotation, reliability external effects) may differ in the last ULPs (~1e-15
 * absolute here) while stations, residuals, SEUW, chi-square, and local tests
 * agree bitwise. Gate: every numeric leaf must satisfy abs <= 1e-9 AND
 * (abs <= 1e-12 OR rel <= 1e-9); structure (keys, types, ordering) is exact.
 */
interface ParityDiff {
  maxAbs: number;
  maxRel: number;
  worst: string;
}

const collectParityDiff = (a: unknown, b: unknown, path: string, diff: ParityDiff): void => {
  if (typeof a !== typeof b) throw new Error(`type mismatch at ${path}`);
  if (typeof a === 'number' && typeof b === 'number') {
    if (Number.isNaN(a) || Number.isNaN(b)) throw new Error(`NaN at ${path}`);
    const abs = Math.abs(a - b);
    if (abs > 0) {
      const denom = Math.max(Math.abs(a), Math.abs(b));
      const rel = denom > 0 ? abs / denom : Number.POSITIVE_INFINITY;
      if (abs > diff.maxAbs) {
        diff.maxAbs = abs;
        diff.worst = path;
      }
      if (rel < Number.POSITIVE_INFINITY && rel > diff.maxRel) diff.maxRel = rel;
      const ok = abs <= 1e-9 && (abs <= 1e-12 || rel <= 1e-9);
      if (!ok) throw new Error(`parity exceeded at ${path}: ${a} vs ${b} (abs ${abs}, rel ${rel})`);
    }
    return;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) throw new Error(`array mismatch at ${path}`);
    if (a.length !== b.length) throw new Error(`length mismatch at ${path}: ${a.length} vs ${b.length}`);
    a.forEach((item, index) => collectParityDiff(item, b[index], `${path}[${index}]`, diff));
    return;
  }
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b as Record<string, unknown>);
    if (aKeys.length !== bKeys.length || !aKeys.every((key, index) => key === bKeys[index])) {
      throw new Error(`key mismatch at ${path}: [${aKeys.join(',')}] vs [${bKeys.join(',')}]`);
    }
    for (const key of aKeys) {
      collectParityDiff(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
        path === '' ? key : `${path}.${key}`,
        diff,
      );
    }
    return;
  }
  if (a !== b) throw new Error(`value mismatch at ${path}: ${String(a)} vs ${String(b)}`);
};

const expectSessionParity = (native: AdjustmentResult, clean: AdjustmentResult): ParityDiff => {
  const diff: ParityDiff = { maxAbs: 0, maxRel: 0, worst: '' };
  collectParityDiff(JSON.parse(canonical(native)) as unknown, JSON.parse(canonical(clean)) as unknown, '', diff);
  return diff;
};
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

const expectLooExactness = (base: AdjustmentResult, input: string): void => {
  const rows = base.suspectImpactDiagnostics ?? [];
  expect(rows.length).toBeGreaterThan(0);
  rows.forEach((row, index) => {
    expect(row.status).toBe('ok');
    const manual = runAdjustmentSession(requestFor(input, 'off', [row.obsId]), undefined, undefined);
    expect(manual.result.success).toBe(true);
    const shift = computeShiftDetail(base, manual.result);
    // Alternate-vs-manual LOO exactness under the same ULP-aware gate as
    // session parity (alternate stdRes flows through native-verified Qxx).
    const diff: ParityDiff = { maxAbs: 0, maxRel: 0, worst: '' };
    collectParityDiff(
      {
        altSeuw: row.altSeuw,
        altMaxStdRes: row.altMaxStdRes,
        altChi: row.altChi,
        altLocalFails: row.altLocalFails,
        altDof: row.altDof,
        altObsCount: row.altObsCount,
        topAffectedStations: row.topAffectedStations,
        mostAffectedStation: row.mostAffectedStation,
      },
      {
        altSeuw: manual.result.seuw,
        altMaxStdRes: maxAbsStdRes(manual.result),
        altChi: chiSummaryOf(manual.result),
        altLocalFails: countLocalFailures(manual.result),
        altDof: manual.result.dof,
        altObsCount: manual.result.observations.length,
        topAffectedStations: shift.top,
        mostAffectedStation: shift.most,
      },
      `loo[${index}]`,
      diff,
    );
    console.log(
      `15C LOO ${index + 1}/${rows.length}: obs ${row.obsId} altSeuw=${row.altSeuw} ` +
        `altMaxStdRes=${row.altMaxStdRes} chi=${row.altChi?.T}/${row.altChi?.dof} exact`,
    );
  });
};

describe('Phase 15C default-session parity (real WASM)', () => {
  it('AUTO zero-candidate session: native-vs-clean full parity', async () => {
    setNativeFullQxxRouteEnabled(true);
    const input = buildMinimal3dInput();
    const request = requestFor(input, 'auto');
    const clean = runAdjustmentSession(request, undefined, undefined);
    expect(clean.result.success).toBe(true);
    expect(clean.result.suspectImpactDiagnostics?.length).toBe(0);

    const attempt = await runWithNativeFullQxxAutoRoute(request, undefined, {
      runSession: runAdjustmentSession,
      loadBundle,
    });
    expect(attempt.route).toBe('native-full-qxx');
    expect(attempt.verification?.accepted).toBe(true);
    expect(attempt.verification?.oracledSystemCount).toBe(1);
    expect(attempt.reasons).toEqual([]);
    expect(attempt.outcome.result.suspectImpactDiagnostics?.length).toBe(0);
    const zeroDiff = expectSessionParity(attempt.outcome.result, clean.result);
    console.log(
      `15C zero-candidate: route ${attempt.route}, systems=${attempt.verification?.oracledSystemCount}, ` +
        `parity maxAbs=${zeroDiff.maxAbs} maxRel=${zeroDiff.maxRel} worst=${zeroDiff.worst}`,
    );
  }, 300000);

  it('AUTO one-candidate session: parity + LOO exactness', async () => {
    setNativeFullQxxRouteEnabled(true);
    const input = buildMinimal3dInput({ gpsEErr: 0.5 });
    const request = requestFor(input, 'auto');
    const clean = runAdjustmentSession(request, undefined, undefined);
    expect(clean.result.success).toBe(true);
    expect(clean.result.suspectImpactDiagnostics?.length).toBe(1);

    const attempt = await runWithNativeFullQxxAutoRoute(request, undefined, {
      runSession: runAdjustmentSession,
      loadBundle,
    });
    expect(attempt.route).toBe('native-full-qxx');
    expect(attempt.verification?.accepted).toBe(true);
    expect(attempt.verification?.oracledSystemCount).toBe(2);
    expect(attempt.reasons).toEqual([]);
    expect(attempt.outcome.result.suspectImpactDiagnostics?.length).toBe(1);
    const oneDiff = expectSessionParity(attempt.outcome.result, clean.result);
    expectLooExactness(attempt.outcome.result, input);
    console.log(
      `15C one-candidate: route ${attempt.route}, systems=${attempt.verification?.oracledSystemCount}, ` +
        `parity maxAbs=${oneDiff.maxAbs} maxRel=${oneDiff.maxRel} worst=${oneDiff.worst}`,
    );
  }, 300000);

  it('AUTO three-candidate session: parity + LOO exactness', async () => {
    setNativeFullQxxRouteEnabled(true);
    const input = buildThreeCandidateInput();
    const request = requestFor(input, 'auto');
    const clean = runAdjustmentSession(request, undefined, undefined);
    expect(clean.result.success).toBe(true);
    expect(clean.result.suspectImpactDiagnostics?.length).toBe(3);

    const attempt = await runWithNativeFullQxxAutoRoute(request, undefined, {
      runSession: runAdjustmentSession,
      loadBundle,
    });
    expect(attempt.route).toBe('native-full-qxx');
    expect(attempt.verification?.accepted).toBe(true);
    expect(attempt.verification?.oracledSystemCount).toBe(4);
    expect(attempt.reasons).toEqual([]);
    expect(attempt.outcome.result.suspectImpactDiagnostics?.length).toBe(3);
    const threeDiff = expectSessionParity(attempt.outcome.result, clean.result);
    expectLooExactness(attempt.outcome.result, input);
    console.log(
      `15C three-candidate: route ${attempt.route}, systems=${attempt.verification?.oracledSystemCount}, ` +
        `parity maxAbs=${threeDiff.maxAbs} maxRel=${threeDiff.maxRel} worst=${threeDiff.worst}`,
    );
  }, 300000);

  it("ON mode is explicitly rejected without touching WASM", async () => {
    setNativeFullQxxRouteEnabled(true);
    const request = requestFor(buildMinimal3dInput({ gpsEErr: 0.5 }), 'on');
    let bundleTouched = false;
    const attempt = await runWithNativeFullQxxAutoRoute(request, undefined, {
      runSession: runAdjustmentSession,
      loadBundle: (async () => {
        bundleTouched = true;
        return loadBundle();
      }) as never,
    });
    expect(attempt.outcome.result.success).toBe(true);
    expect(attempt.route).toBe('typescript');
    expect(attempt.verification).toBeUndefined();
    expect(attempt.reasons.join('; ')).toContain("suspect-impact mode 'on'");
    expect(bundleTouched).toBe(false);
    console.log(`15C on-reject: route ${attempt.route}, reasons [${attempt.reasons.join('; ')}]`);
  }, 300000);
});
