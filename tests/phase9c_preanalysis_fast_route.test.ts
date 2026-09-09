import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildChainStarInput } from '../src/engine/phase8a5PreanalysisSafetyCorpus';
import { runAdjustmentSession } from '../src/engine/runSession';
import { buildSupportedPhase9aPlainGpsInput } from './evidence/phase9aEvidenceShared';
import {
  PREANALYSIS_SPARSE_PREFLIGHT_MAX_ORIENTATION_FRACTION,
  PREANALYSIS_SPARSE_PREFLIGHT_MAX_ORIENTATION_PARAMETERS,
  derivePreanalysisSparsePreflight,
  isDirectionHeavyPreflightHoldback,
} from '../src/engine/preanalysisSparsePreflight';
import {
  clearPreanalysisSparseAutoRouteTestHooks,
  derivePreanalysisSparseAutoRouteEligibility,
  runWithPreanalysisSparseAutoRoute,
  setPreanalysisSparseAutoRouteEnabled,
  setPreanalysisSparseAutoRouteTestHooks,
} from '../src/workers/preanalysisSparseAutoRoute';
import { createRunSessionRequest } from './helpers/runSessionRequest';

const CAMP_INPUT = fs.readFileSync(
  path.join(process.cwd(), 'tests/fixtures/camp_design_preanalysis_traverse_only.dat'),
  'utf8',
);

const makeRequest = (input: string) => {
  const base = createRunSessionRequest({ input });
  return createRunSessionRequest({
    input,
    parseSettings: {
      ...base.parseSettings,
      runMode: 'preanalysis',
      coordMode: '2D',
      robustMode: 'none',
      tsCorrelationEnabled: false,
      autoAdjustEnabled: false,
    },
  });
};

describe('phase 9C preanalysis fast routing', () => {
  it('holds back the direction-heavy camp before bundle loading', async () => {
    setPreanalysisSparseAutoRouteEnabled(true);
    clearPreanalysisSparseAutoRouteTestHooks();
    try {
      const request = makeRequest(CAMP_INPUT);
      const eligibility = derivePreanalysisSparseAutoRouteEligibility(request);
      expect(eligibility.unknownCount).toBe(46);
      expect(eligibility.preflight).toMatchObject({
        stationUnknownCount: 46,
        coordinateParameterCount: 86,
        orientationParameterCount: 84,
        predictedParameterCount: 170,
        admitted: false,
      });
      expect(eligibility.reasons.join(' ')).toMatch(/direction-heavy preflight holdback/);

      let bundleLoads = 0;
      const attempt = await runWithPreanalysisSparseAutoRoute(request, undefined, {
        runSession: runAdjustmentSession,
        loadBundle: async () => {
          bundleLoads += 1;
          throw new Error('bundle must not load after preflight rejection');
        },
      });
      expect(bundleLoads).toBe(0);
      expect(attempt.route).toBe('typescript');
      expect(attempt.preflight?.admitted).toBe(false);
      expect(attempt.sparseAttempted).toBe(false);
      expect(attempt.bundleLoaded).toBe(false);
      expect(attempt.fallbackOccurred).toBe(false);
      const direct = runAdjustmentSession(request);
      const stripTiming = (result: typeof direct.result) => {
        const clone = JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
        delete clone.solveTimingProfile;
        if (Array.isArray(clone.logs)) {
          clone.logs = clone.logs.filter((line) => !String(line).startsWith('Solve timing (ms):'));
        }
        return clone;
      };
      expect(stripTiming(attempt.outcome.result)).toEqual(stripTiming(direct.result));
    } finally {
      clearPreanalysisSparseAutoRouteTestHooks();
      setPreanalysisSparseAutoRouteEnabled(false);
    }
  }, 120000);

  it('admits known-good coordinate-dominant and plain-GPS shapes', () => {
    setPreanalysisSparseAutoRouteEnabled(true);
    try {
      for (const input of [buildChainStarInput(126), buildSupportedPhase9aPlainGpsInput(4)]) {
        const eligibility = derivePreanalysisSparseAutoRouteEligibility(makeRequest(input));
        expect(eligibility.eligible, eligibility.reasons.join('; ')).toBe(true);
        expect(eligibility.preflight?.admitted).toBe(true);
        expect(eligibility.reasons).not.toContain(expect.stringContaining('direction-heavy'));
      }
    } finally {
      setPreanalysisSparseAutoRouteEnabled(false);
    }
  });

  it('enforces exact threshold boundaries (>16 AND >0.25)', () => {
    expect(PREANALYSIS_SPARSE_PREFLIGHT_MAX_ORIENTATION_PARAMETERS).toBe(16);
    expect(PREANALYSIS_SPARSE_PREFLIGHT_MAX_ORIENTATION_FRACTION).toBe(0.25);
    // Count gate: exactly 16 never holds back, even at a high fraction.
    expect(isDirectionHeavyPreflightHoldback(16, 17)).toBe(false);
    expect(isDirectionHeavyPreflightHoldback(16, 32)).toBe(false);
    // Fraction gate: exactly 25% never holds back (17/68), just above does.
    expect(isDirectionHeavyPreflightHoldback(17, 68)).toBe(false);
    expect(isDirectionHeavyPreflightHoldback(17, 67)).toBe(true);
    // Both gates: 17 orientations at 50% holds back; either gate alone admits.
    expect(isDirectionHeavyPreflightHoldback(17, 34)).toBe(true);
    expect(isDirectionHeavyPreflightHoldback(84, 170)).toBe(true);
    expect(isDirectionHeavyPreflightHoldback(4, 100)).toBe(false);
    expect(isDirectionHeavyPreflightHoldback(0, 10)).toBe(false);
  });

  it('fails closed on invalid metrics without throwing', () => {
    expect(isDirectionHeavyPreflightHoldback(Number.NaN, 100)).toBe(true);
    expect(isDirectionHeavyPreflightHoldback(10, 0)).toBe(true);
    expect(isDirectionHeavyPreflightHoldback(10, -5)).toBe(true);
    expect(isDirectionHeavyPreflightHoldback(10, Number.POSITIVE_INFINITY)).toBe(true);
    let threw = false;
    try {
      const rejected = derivePreanalysisSparsePreflight(null as never);
      expect(rejected.admitted).toBe(false);
      expect(rejected.reason).toMatch(/fail-closed/);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });

  it('rejects station 129 via the authoritative cap before preflight or bundle load', async () => {
    setPreanalysisSparseAutoRouteEnabled(true);
    setPreanalysisSparseAutoRouteTestHooks({ unknownCountOverride: 129 });
    try {
      const request = makeRequest(buildChainStarInput(8));
      const eligibility = derivePreanalysisSparseAutoRouteEligibility(request);
      expect(eligibility.eligible).toBe(false);
      expect(eligibility.unknownCount).toBe(129);
      expect(eligibility.preflight).toBeNull();
      expect(eligibility.reasons.join(' ')).toMatch(/exceeds cap 128/);
      let bundleLoads = 0;
      const attempt = await runWithPreanalysisSparseAutoRoute(request, undefined, {
        runSession: runAdjustmentSession,
        loadBundle: async () => {
          bundleLoads += 1;
          throw new Error('bundle must not load after cap rejection');
        },
      });
      expect(bundleLoads).toBe(0);
      expect(attempt.route).toBe('typescript');
      expect(attempt.sparseAttempted).toBe(false);
      expect(attempt.bundleLoaded).toBe(false);
    } finally {
      clearPreanalysisSparseAutoRouteTestHooks();
      setPreanalysisSparseAutoRouteEnabled(false);
    }
  });

  it('keeps a compact corpus regression on admitted shapes', () => {
    setPreanalysisSparseAutoRouteEnabled(true);
    try {
      const cases: Array<{ name: string; input: string }> = [
        { name: 'chain-8', input: buildChainStarInput(8) },
        { name: 'chain-32', input: buildChainStarInput(32) },
        { name: 'plain-gps-4', input: buildSupportedPhase9aPlainGpsInput(4) },
      ];
      for (const { name, input } of cases) {
        const eligibility = derivePreanalysisSparseAutoRouteEligibility(makeRequest(input));
        expect(eligibility.eligible, `${name}: ${eligibility.reasons.join('; ')}`).toBe(true);
        expect(eligibility.preflight?.admitted, name).toBe(true);
      }
    } finally {
      setPreanalysisSparseAutoRouteEnabled(false);
    }
  });
});
