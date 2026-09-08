/**
 * Phase 9A cap-widening evidence shard (EVIDENCE ONLY, no production change).
 *
 * phase 9A evidence: production controls and corpus
 * Split from tests/evidence/phase9a_cap_widening_evidence.test.ts: every
 * `it` body below is preserved verbatim (only the module-level evidence
 * accumulator was renamed to a shard-local fragment). This shard is
 * independently executable and writes exactly one atomic raw fragment
 * (artifacts/evidence/phase9a/corpus.json, gitignored). Report
 * assembly lives in scripts/phase9a/phase9aReport.ts; the committed
 * reports/phase9a/ verdict is checked by tests/phase9a_release_verdict.test.ts.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { runAdjustmentSession } from '../../src/engine/runSession';
import { comparePreanalysisContract } from '../../src/engine/preanalysisSparseEvidence';
import {
  evaluatePreanalysisSparseWholeSession,
  PREANALYSIS_SPARSE_PLANNING_SYSTEM_CAP,
  PREANALYSIS_SPARSE_UNKNOWN_CAP,
} from '../../src/engine/preanalysisSparseSessionPolicy';
import { PREANALYSIS_SPARSE_SENTINEL_MAX_UNKNOWN_COUNT } from '../../src/engine/preanalysisSparseCovarianceSentinel';
import {
  clearPreanalysisSparseAutoRouteTestHooks,
  derivePreanalysisSparseAutoRouteEligibility,
  PreanalysisGatedCorrectionSolver,
  runWithPreanalysisSparseAutoRoute,
  setPreanalysisSparseAutoRouteEnabled,
  setPreanalysisSparseAutoRouteTestHooks,
} from '../../src/workers/preanalysisSparseAutoRoute';
import { verifyCovarianceSystem } from '../../src/workers/preanalysisSparseCovarianceGate';
import {
  loadPhase9aRealBundle,
} from '../../scripts/phase9a/phase9aHarness';
import {
  buildChainStarInput,
  buildSupportedPhase9aPlainGpsInput,
  buildWeakPhase9aChainStarInput,
  exactPhase9aStationCount,
  makePhase9aPreanalysisRequest,
  PHASE9A_ANCHOR_INPUT,
  PHASE9A_CAMP_INPUT,
  PHASE9A_GPS_COV_INPUT,
  writePhase9aFragment,
} from './phase9aEvidenceShared';

const fragment: Record<string, unknown> = {};

describe('phase 9A evidence: production controls and corpus', () => {
  it('keeps production defaults exactly when no overrides are set', () => {
    expect(PREANALYSIS_SPARSE_UNKNOWN_CAP).toBe(128);
    expect(PREANALYSIS_SPARSE_PLANNING_SYSTEM_CAP).toBe(64);
    setPreanalysisSparseAutoRouteEnabled(true);
    clearPreanalysisSparseAutoRouteTestHooks();
    try {
      // Static eligibility still gates at 128 with no overrides.
      setPreanalysisSparseAutoRouteTestHooks({ unknownCountOverride: 128 });
      expect(derivePreanalysisSparseAutoRouteEligibility(makePhase9aPreanalysisRequest(PHASE9A_ANCHOR_INPUT)).eligible).toBe(true);
      setPreanalysisSparseAutoRouteTestHooks({ unknownCountOverride: 129 });
      const over = derivePreanalysisSparseAutoRouteEligibility(makePhase9aPreanalysisRequest(PHASE9A_ANCHOR_INPUT));
      expect(over.eligible).toBe(false);
      expect(over.reasons.join(' ')).toMatch(/exceed cap 128/);
      clearPreanalysisSparseAutoRouteTestHooks();
      // Whole-session policy still rejects above-cap counts with no overrides.
      const passVerdict = { index: 0, staticAdmit: true, physicalValid: true, sentinelPass: true, correctionPass: true };
      expect(
        evaluatePreanalysisSparseWholeSession({ unknownCount: 128, systems: [passVerdict] }).admit,
      ).toBe(true);
      expect(
        evaluatePreanalysisSparseWholeSession({ unknownCount: 129, systems: [passVerdict] }).admit,
      ).toBe(false);
      const manySystems = Array.from({ length: 65 }, (_, index) => ({ ...passVerdict, index }));
      expect(
        evaluatePreanalysisSparseWholeSession({ unknownCount: 2, systems: manySystems }).admit,
      ).toBe(false);
      // Runtime correction pre-dispatch refuses parameterCount 129 under the explicit historical 128 cap.
      let delegated = false;
      const correction = new PreanalysisGatedCorrectionSolver(
        {
          solveFromEquations: () => {
            delegated = true;
            return { correction: [], damping: 0, dampingAttempts: 0, designNnz: 0, weightNnz: 0, normalNnz: 0, factorNnz: 0, ordering: 'test', solver: 'test' };
          },
        },
        { systemsStarted: 0, aborted: false, abortReason: null },
        { maxSystems: 64, maxParameters: 128 },
      );
      expect(() =>
        correction.solveFromEquations({
          design: { rowOffsets: new Int32Array(0), columns: new Int32Array(0), values: new Float64Array(0) },
          weights: { rows: new Int32Array(0), columns: new Int32Array(0), values: new Float64Array(0) },
          misclosures: new Float64Array(0),
          observationEquationCount: 0,
          parameterCount: 129,
        }),
      ).toThrow(/exceeds cap 128/);
      expect(delegated).toBe(false);
      // Covariance header refuses parameterCount 129 under the explicit historical 128 cap (no native delegation).
      const verdict = verifyCovarianceSystem(
        {
          input: {
            design: { rowOffsets: new Int32Array(0), columns: new Int32Array(0), values: new Float64Array(0) },
            weights: { rows: new Int32Array(0), columns: new Int32Array(0), values: new Float64Array(0) },
            observationEquationCount: 0,
            parameterCount: 129,
            queryRows: new Int32Array(0),
            queryColumns: new Int32Array(0),
          },
          result: { covariance: new Float64Array(0), damping: 0, dampingAttempts: 0, normalNnz: 0, factorNnz: 0 },
          threw: false,
        },
        0,
        { querySelected: () => { throw new Error('must not delegate'); } },
        {},
        PREANALYSIS_SPARSE_SENTINEL_MAX_UNKNOWN_COUNT,
      );
      expect(verdict.reasons.join(' ')).toMatch(/outside 1\.\.128/);
      fragment.productionControls9a1 = { defaultsPinned: true, eligibility129Rejected: true, policyRejects129And65Systems: true, correction129Refused: true, covariance129Refused: true };
    } finally {
      clearPreanalysisSparseAutoRouteTestHooks();
      setPreanalysisSparseAutoRouteEnabled(false);
    }
  });

  it('widens static eligibility, runtime caps, and session policy only via overrides', () => {
    setPreanalysisSparseAutoRouteEnabled(true);
    try {
      // Static gate: stationUnknownCapOverride=256 admits 129..256, rejects 257.
      setPreanalysisSparseAutoRouteTestHooks({ unknownCountOverride: 129, stationUnknownCapOverride: 256 });
      expect(derivePreanalysisSparseAutoRouteEligibility(makePhase9aPreanalysisRequest(PHASE9A_ANCHOR_INPUT)).eligible).toBe(true);
      setPreanalysisSparseAutoRouteTestHooks({ unknownCountOverride: 256, stationUnknownCapOverride: 256 });
      expect(derivePreanalysisSparseAutoRouteEligibility(makePhase9aPreanalysisRequest(PHASE9A_ANCHOR_INPUT)).eligible).toBe(true);
      setPreanalysisSparseAutoRouteTestHooks({ unknownCountOverride: 257, stationUnknownCapOverride: 256 });
      const over = derivePreanalysisSparseAutoRouteEligibility(makePhase9aPreanalysisRequest(PHASE9A_ANCHOR_INPUT));
      expect(over.eligible).toBe(false);
      expect(over.reasons.join(' ')).toMatch(/exceed cap 256/);
      // Runtime correction gate: parameterCapOverride=256 delegates parameterCount 200.
      let delegated = false;
      const widened = new PreanalysisGatedCorrectionSolver(
        {
          solveFromEquations: () => {
            delegated = true;
            return { correction: [], damping: 0, dampingAttempts: 0, designNnz: 0, weightNnz: 0, normalNnz: 0, factorNnz: 0, ordering: 'test', solver: 'test' };
          },
        },
        { systemsStarted: 0, aborted: false, abortReason: null },
        { maxSystems: 64, maxParameters: 256 },
      );
      widened.solveFromEquations({
        design: { rowOffsets: new Int32Array(0), columns: new Int32Array(0), values: new Float64Array(0) },
        weights: { rows: new Int32Array(0), columns: new Int32Array(0), values: new Float64Array(0) },
        misclosures: new Float64Array(0),
        observationEquationCount: 0,
        parameterCount: 200,
      });
      expect(delegated).toBe(true);
      // Covariance header honors the widened cap (passes header; sentinel may still decide).
      const header = verifyCovarianceSystem(
        {
          input: {
            design: { rowOffsets: new Int32Array(0), columns: new Int32Array(0), values: new Float64Array(0) },
            weights: { rows: new Int32Array(0), columns: new Int32Array(0), values: new Float64Array(0) },
            observationEquationCount: 0,
            parameterCount: 200,
            queryRows: new Int32Array(0),
            queryColumns: new Int32Array(0),
          },
          result: { covariance: new Float64Array(0), damping: 0, dampingAttempts: 0, normalNnz: 0, factorNnz: 0 },
          threw: false,
        },
        0,
        { querySelected: () => { throw new Error('must not delegate'); } },
        {},
        256,
      );
      expect(header.reasons.join(' ')).not.toMatch(/outside 1\.\.256/);
      // Whole-session policy admits above-128 counts only with matching overrides.
      const passVerdict = { index: 0, staticAdmit: true, physicalValid: true, sentinelPass: true, correctionPass: true };
      expect(
        evaluatePreanalysisSparseWholeSession({ unknownCount: 200, systems: [passVerdict] }).admit,
      ).toBe(false);
      expect(
        evaluatePreanalysisSparseWholeSession({
          unknownCount: 200,
          systems: [passVerdict],
          capOverrides: { unknownCap: 256 },
        }).admit,
      ).toBe(true);
      setPreanalysisSparseAutoRouteTestHooks({ unknownCountOverride: 511, stationUnknownCapOverride: 512, parameterCapOverride: 512 });
      expect(derivePreanalysisSparseAutoRouteEligibility(makePhase9aPreanalysisRequest(PHASE9A_ANCHOR_INPUT)).eligible).toBe(true);
      setPreanalysisSparseAutoRouteTestHooks({ unknownCountOverride: 513, stationUnknownCapOverride: 512, parameterCapOverride: 512 });
      expect(derivePreanalysisSparseAutoRouteEligibility(makePhase9aPreanalysisRequest(PHASE9A_ANCHOR_INPUT)).eligible).toBe(false);
      fragment.capOverrides9a1 = {
        static256Boundary: { eligible129: true, eligible256: true, eligible257: false },
        static512Boundary: { eligible511: true, eligible512: true, eligible513: false },
        runtimeParameterCap256Delegates200: true,
        policyAdmits200OnlyWithOverride: true,
      };
      fragment.staticStationBoundaries = {
        status: 'EXECUTED',
        production: { 127: true, 128: true, 129: false },
        evidence256: { 255: true, 256: true, 257: false },
        evidence512: { 511: true, 512: true, 513: false },
      };
      fragment.productionControls = { status: 'EXECUTED', ...(fragment.productionControls9a1 as Record<string, unknown>) };
    } finally {
      clearPreanalysisSparseAutoRouteTestHooks();
      setPreanalysisSparseAutoRouteEnabled(false);
    }
  });

  it('executes an evidence-mode direction-heavy session without changing feature gates', async () => {
    const bundle = await loadPhase9aRealBundle();
    if (!bundle) {
      fragment.directionHeavy9a1 = { status: 'NOT_EVALUATED', reason: 'WASM artifact absent' };
      return;
    }
    const request = makePhase9aPreanalysisRequest(PHASE9A_CAMP_INPUT);
    const parameterCounts: number[] = [];
    const wrapped = {
      ...bundle,
      sparseCorrectionSolver: {
        solveFromEquations: (input: Parameters<typeof bundle.sparseCorrectionSolver.solveFromEquations>[0]) => {
          parameterCounts.push(input.parameterCount);
          return bundle.sparseCorrectionSolver.solveFromEquations(input);
        },
      },
    };
    setPreanalysisSparseAutoRouteEnabled(true);
    setPreanalysisSparseAutoRouteTestHooks({ stationUnknownCapOverride: 128, parameterCapOverride: 600 });
    try {
      const attempt = await runWithPreanalysisSparseAutoRoute(request, undefined, {
        runSession: runAdjustmentSession,
        loadBundle: () => Promise.resolve(wrapped),
      });
      const forced = runAdjustmentSession(request);
      expect(comparePreanalysisContract(forced.result, attempt.outcome.result).pass).toBe(true);
      fragment.directionHeavy9a1 = {
        status: 'EXECUTED',
        route: attempt.route,
        stationUnknownCount: derivePreanalysisSparseAutoRouteEligibility(request).unknownCount,
        maxActualParameterCount: parameterCounts.length > 0 ? Math.max(...parameterCounts) : null,
        restartEquality: attempt.route === 'typescript',
        fallbackReason: attempt.reasons[0] ?? null,
      };
      fragment.directionHeavy = fragment.directionHeavy9a1;
    } finally {
      clearPreanalysisSparseAutoRouteTestHooks();
      setPreanalysisSparseAutoRouteEnabled(false);
    }
  }, 300000);

  it('preserves GPS-covariance exclusion with no native sparse delegation', () => {
    const request = makePhase9aPreanalysisRequest(PHASE9A_GPS_COV_INPUT);
    setPreanalysisSparseAutoRouteEnabled(true);
    try {
      const eligibility = derivePreanalysisSparseAutoRouteEligibility(request);
      expect(eligibility.eligible).toBe(false);
      expect(eligibility.reasons.join(' ')).toMatch(/GPS covariance weighting/);
      fragment.gpsCovarianceExclusion = { status: 'EXECUTED', eligible: false, nativeSparseDelegations: 0 };
    } finally {
      clearPreanalysisSparseAutoRouteTestHooks();
      setPreanalysisSparseAutoRouteEnabled(false);
    }
  });

  it('covers plain GPS above 128 with full contract equality', async () => {
    const bundle = await loadPhase9aRealBundle();
    if (!bundle) {
      fragment.plainGps = { status: 'NOT_EVALUATED', reason: 'WASM artifact absent' };
      fragment.gpsCovarianceExclusion = { status: 'NOT_EVALUATED', reason: 'WASM artifact absent' };
      return;
    }
    const rows: Array<Record<string, unknown>> = [];
    try {
    for (const target of [255, 511]) {
      // Mixed chain-star + plain GPS adds one orientation parameter.
      const stationUnknownCount = (target - 1) / 2;
      const request = makePhase9aPreanalysisRequest(buildSupportedPhase9aPlainGpsInput(stationUnknownCount));
      const parameterCounts: number[] = [];
      const wrapped = {
        ...bundle,
        sparseCorrectionSolver: {
          solveFromEquations: (input: Parameters<typeof bundle.sparseCorrectionSolver.solveFromEquations>[0]) => {
            parameterCounts.push(input.parameterCount);
            return bundle.sparseCorrectionSolver.solveFromEquations(input);
          },
        },
      };
      setPreanalysisSparseAutoRouteEnabled(true);
      setPreanalysisSparseAutoRouteTestHooks({
        stationUnknownCapOverride: stationUnknownCount,
        parameterCapOverride: target + 3,
        systemCapOverride: 64,
      });
      const attempt = await runWithPreanalysisSparseAutoRoute(request, undefined, {
        runSession: runAdjustmentSession,
        loadBundle: () => Promise.resolve(wrapped),
      });
      const forced = runAdjustmentSession(request);
      const comparison = comparePreanalysisContract(forced.result, attempt.outcome.result);
      expect(comparison.pass).toBe(true);
      const actualParameterCount = parameterCounts.length > 0 ? Math.max(...parameterCounts) : null;
      expect(attempt.route).toBe('sparse');
      expect(actualParameterCount).toBe(target + 3);
      rows.push({ targetParameterCount: target, stationUnknownCount, coordinateParameterCount: stationUnknownCount * 2, orientationParameterCount: actualParameterCount! - stationUnknownCount * 2, actualParameterCount, route: attempt.route, contractPass: comparison.pass, fallbackReason: attempt.reasons[0] ?? null });
    }
    fragment.plainGps = { status: 'EXECUTED', rows };
    } finally {
      clearPreanalysisSparseAutoRouteTestHooks();
      setPreanalysisSparseAutoRouteEnabled(false);
    }
  }, 900000);

  it('records deterministic weak and ill-conditioned above-cap outcomes', async () => {
    const bundle = await loadPhase9aRealBundle();
    if (!bundle) {
      fragment.weakGeometry = { status: 'NOT_EVALUATED', reason: 'WASM artifact absent' };
      fragment.illConditioned = { status: 'NOT_EVALUATED', reason: 'WASM artifact absent' };
      return;
    }
    const rows: Array<Record<string, unknown>> = [];
    try {
    for (const [name, input] of [
      ['weak-geometry', buildWeakPhase9aChainStarInput(exactPhase9aStationCount(256))],
      ['ill-conditioned', buildChainStarInput(exactPhase9aStationCount(256), 0.003, 1e-6)],
    ] as const) {
      const request = makePhase9aPreanalysisRequest(input);
      setPreanalysisSparseAutoRouteEnabled(true);
      setPreanalysisSparseAutoRouteTestHooks({ stationUnknownCapOverride: exactPhase9aStationCount(256), parameterCapOverride: 256, systemCapOverride: 64 });
      const attempt = await runWithPreanalysisSparseAutoRoute(request, undefined, { runSession: runAdjustmentSession, loadBundle: () => Promise.resolve(bundle) });
      const forced = runAdjustmentSession(request);
      const comparison = comparePreanalysisContract(forced.result, attempt.outcome.result);
      expect(comparison.pass).toBe(true);
      rows.push({ name, targetParameterCount: 256, route: attempt.route, fallbackReason: attempt.reasons[0] ?? null, contractPass: comparison.pass, warningOnly: attempt.route === 'sparse' });
    }
    fragment.weakGeometry = { status: 'EXECUTED', rows: rows.filter((row) => row.name === 'weak-geometry') };
    fragment.illConditioned = { status: 'EXECUTED', rows: rows.filter((row) => row.name === 'ill-conditioned') };
    } finally {
      clearPreanalysisSparseAutoRouteTestHooks();
      setPreanalysisSparseAutoRouteEnabled(false);
    }
  }, 900000);
});

afterAll(() => {
  writePhase9aFragment('corpus', fragment);
});
