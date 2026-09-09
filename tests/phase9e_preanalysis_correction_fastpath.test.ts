/**
 * Phase 9E first-stage fast path: fast (default) vs legacy-oracle parity.
 *
 * The legacy correction loop is retained as a test oracle via the test-only
 * `preanalysisCorrectionFastPath: false` runtime override (default runs the
 * fast path when eligible). Covers: all 16 camp recommendation scenarios
 * (full result + recommendation list), forced-threshold cache equality, an
 * active-template case, orientation-heavy eligibility, and unsupported-shape
 * fallback (3D + fail-closed eligibility units).
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  getPreanalysisCorrectionFastPathStats,
  isPreanalysisCorrectionFastPathEligible,
  resetPreanalysisCorrectionFastPathStats,
} from '../src/engine/preanalysisCorrectionFastPath';
import {
  buildPreanalysisPlanningDiagnostics,
  buildPreanalysisSyntheticSetTemplates,
  buildSyntheticPreanalysisInput,
  resolveAppliedPreanalysisActionState,
} from '../src/engine/preanalysisPlanning';
import { createPreanalysisScenarioCacheDiagnostics } from '../src/engine/preanalysisPlanningSolveAudit';
import { DEFAULT_PLANNING_MAP_STATE } from '../src/engine/planningMapState';
import { runAdjustmentSession } from '../src/engine/runSession';
import { solveEngine } from '../src/engine/solveEngine';
import type { AdjustmentResult } from '../src/types';
import { createRunSessionRequest } from './helpers/runSessionRequest';

const CAMP_INPUT = fs.readFileSync(
  path.join(process.cwd(), 'tests/fixtures/camp_design_preanalysis_traverse_only.dat'),
  'utf-8',
);

const makeRequest = (coordMode: '2D' | '3D' = '2D') => {
  const base = createRunSessionRequest({ input: CAMP_INPUT });
  return createRunSessionRequest({
    input: CAMP_INPUT,
    parseSettings: {
      ...base.parseSettings,
      runMode: 'preanalysis',
      preanalysisMode: true,
      coordMode,
    },
  });
};

const stripTiming = (result: AdjustmentResult): unknown => {
  const clone = JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
  delete clone.solveTimingProfile;
  if (Array.isArray(clone.logs)) {
    clone.logs = (clone.logs as string[]).filter(
      (line) => !line.startsWith('Solve timing (ms):'),
    );
  }
  return clone;
};

describe('phase 9E preanalysis correction fast path', () => {
  it('matches the legacy loop on the full camp session (all 16 recommendation scenarios)', () => {
    resetPreanalysisCorrectionFastPathStats();
    const fast = runAdjustmentSession(makeRequest()).result;
    const fastStats = getPreanalysisCorrectionFastPathStats();
    resetPreanalysisCorrectionFastPathStats();
    const legacy = runAdjustmentSession(makeRequest(), undefined, {
      preanalysisCorrectionFastPath: false,
    }).result;
    const legacyStats = getPreanalysisCorrectionFastPathStats();

    expect(fast.success).toBe(true);
    expect(legacy.success).toBe(true);
    // Template-source + main + 16 recommendation scenarios, all fast.
    expect(fastStats.evaluations).toBeGreaterThanOrEqual(18);
    expect(fastStats.fastSolves).toBe(fastStats.evaluations);
    expect(fastStats.legacyFallbacks).toBe(0);
    expect(legacyStats.fastSolves).toBe(0);
    expect(legacyStats.legacyFallbacks).toBe(legacyStats.evaluations);

    // Recommendation list equality: same ids in the same order.
    const fastRows = fast.preanalysisImpactDiagnostics?.rows ?? [];
    const legacyRows = legacy.preanalysisImpactDiagnostics?.rows ?? [];
    expect(fastRows.length).toBe(legacyRows.length);
    expect(fastRows.map((row) => row.scenarioId)).toEqual(
      legacyRows.map((row) => row.scenarioId),
    );
    // At least one evaluated scenario adds observations (new parameters,
    // including fresh orientation unknowns for direction setups) while fast.
    expect(fastRows.some((row) => row.addedObservationCount > 0)).toBe(true);

    expect(stripTiming(fast)).toEqual(stripTiming(legacy));
  }, 120000);

  it('matches the legacy loop on forced-threshold planning with cache equality', () => {
    const baseRequest = makeRequest();
    // Single-solve base (no session planning); identical input/mode.
    const base = solveEngine({
      input: CAMP_INPUT,
      maxIterations: baseRequest.maxIterations,
      convergenceThreshold: baseRequest.convergenceLimit,
      instrumentLibrary: baseRequest.projectInstruments,
      parseOptions: { runMode: 'preanalysis', preanalysisMode: true, coordMode: '2D' },
    });
    expect(base.success).toBe(true);
    const templates = buildPreanalysisSyntheticSetTemplates(
      CAMP_INPUT,
      base,
      DEFAULT_PLANNING_MAP_STATE,
      [],
    );
    const solveWith = (fast: boolean) => {
      const runtime = fast ? undefined : { preanalysisCorrectionFastPath: false as const };
      const cache = createPreanalysisScenarioCacheDiagnostics();
      // Single-solve scenarios (no nested planning), matching the
      // production solveCore path; runtime override threads through.
      const solveScenario = (nextIds: string[]): AdjustmentResult => {
        const normalized = resolveAppliedPreanalysisActionState(templates, nextIds)
          .normalizedScenarioIds;
        return solveEngine({
          input: buildSyntheticPreanalysisInput(CAMP_INPUT, normalized, templates),
          maxIterations: baseRequest.maxIterations,
          convergenceThreshold: baseRequest.convergenceLimit,
          instrumentLibrary: baseRequest.projectInstruments,
          parseOptions: {
            runMode: 'preanalysis',
            preanalysisMode: true,
            coordMode: '2D',
          },
          runtime,
        });
      };
      const diagnostics = buildPreanalysisPlanningDiagnostics({
        base,
        input: CAMP_INPUT,
        planningMap: DEFAULT_PLANNING_MAP_STATE,
        activeTemplateIds: [],
        targetThresholdMeters: 0,
        maxAddedSets: 1,
        solveScenario,
        scenarioCacheDiagnostics: cache,
      });
      return { diagnostics, cache };
    };

    resetPreanalysisCorrectionFastPathStats();
    const fastRun = solveWith(true);
    const fastStats = getPreanalysisCorrectionFastPathStats();
    resetPreanalysisCorrectionFastPathStats();
    const legacyRun = solveWith(false);
    const legacyStats = getPreanalysisCorrectionFastPathStats();

    expect(fastRun.diagnostics.thresholdPlan.steps.length).toBeGreaterThan(0);
    expect(fastStats.fastSolves).toBe(fastStats.evaluations);
    expect(fastStats.legacyFallbacks).toBe(0);
    expect(legacyStats.fastSolves).toBe(0);
    expect(stripTiming(fastRun.diagnostics as never)).toEqual(
      stripTiming(legacyRun.diagnostics as never),
    );
    // Cache contract identical: same requests, hits, peak, and key order.
    expect(fastRun.cache.requests).toBe(legacyRun.cache.requests);
    expect(fastRun.cache.cacheHits).toBe(legacyRun.cache.cacheHits);
    expect(fastRun.cache.cacheHits).toBeGreaterThan(0);
    expect(fastRun.cache.peakEntries).toBe(legacyRun.cache.peakEntries);
    expect(fastRun.cache.normalizedKeys).toEqual(legacyRun.cache.normalizedKeys);
  }, 120000);

  it('matches the legacy loop with an active template', () => {
    const baseRequest = makeRequest();
    const base = solveEngine({
      input: CAMP_INPUT,
      maxIterations: baseRequest.maxIterations,
      convergenceThreshold: baseRequest.convergenceLimit,
      instrumentLibrary: baseRequest.projectInstruments,
      parseOptions: { runMode: 'preanalysis', preanalysisMode: true, coordMode: '2D' },
    });
    const templates = buildPreanalysisSyntheticSetTemplates(
      CAMP_INPUT,
      base,
      DEFAULT_PLANNING_MAP_STATE,
      [],
    );
    const activeId = templates.find(
      (template) => template.actionMode === 'applyable-addition',
    )?.id;
    expect(activeId).toBeDefined();
    const makeActive = () =>
      createRunSessionRequest({
        ...makeRequest(),
        activePreanalysisAdditionIds: [activeId!],
      });
    resetPreanalysisCorrectionFastPathStats();
    const fast = runAdjustmentSession(makeActive()).result;
    const fastStats = getPreanalysisCorrectionFastPathStats();
    resetPreanalysisCorrectionFastPathStats();
    const legacy = runAdjustmentSession(makeActive(), undefined, {
      preanalysisCorrectionFastPath: false,
    }).result;
    expect(fast.success).toBe(true);
    expect(legacy.success).toBe(true);
    expect(fastStats.fastSolves).toBe(fastStats.evaluations);
    expect(fastStats.legacyFallbacks).toBe(0);
    expect(stripTiming(fast)).toEqual(stripTiming(legacy));
  }, 120000);

  it('fails closed on unsupported shapes and backends', () => {
    const eligible = {
      preanalysisMode: true,
      is2D: true,
      debug: false,
      robustMode: 'none',
      maxIterations: 10,
      hasSparseCorrectionSolver: false,
      hasSparseRowProductsSolver: false,
      hasSparseSelectedCovarianceSolver: false,
      hasNormalEquationSolver: false,
    };
    expect(isPreanalysisCorrectionFastPathEligible(eligible)).toBe(true);
    expect(
      isPreanalysisCorrectionFastPathEligible({ ...eligible, preanalysisMode: false }),
    ).toBe(false);
    expect(isPreanalysisCorrectionFastPathEligible({ ...eligible, is2D: false })).toBe(false);
    expect(isPreanalysisCorrectionFastPathEligible({ ...eligible, debug: true })).toBe(false);
    expect(
      isPreanalysisCorrectionFastPathEligible({ ...eligible, robustMode: 'huber' }),
    ).toBe(false);
    expect(
      isPreanalysisCorrectionFastPathEligible({ ...eligible, robustMode: 'danish' }),
    ).toBe(false);
    expect(
      isPreanalysisCorrectionFastPathEligible({ ...eligible, maxIterations: 0 }),
    ).toBe(false);
    expect(
      isPreanalysisCorrectionFastPathEligible({ ...eligible, hasSparseCorrectionSolver: true }),
    ).toBe(false);
    expect(
      isPreanalysisCorrectionFastPathEligible({ ...eligible, hasSparseRowProductsSolver: true }),
    ).toBe(false);
    expect(
      isPreanalysisCorrectionFastPathEligible({
        ...eligible,
        hasSparseSelectedCovarianceSolver: true,
      }),
    ).toBe(false);
    expect(
      isPreanalysisCorrectionFastPathEligible({ ...eligible, hasNormalEquationSolver: true }),
    ).toBe(false);

    // Integration: 3D preanalysis (covariance augmentation changes the
    // recovery N) runs the legacy loop even with the fast default.
    resetPreanalysisCorrectionFastPathStats();
    const threeD = runAdjustmentSession(makeRequest('3D')).result;
    const stats = getPreanalysisCorrectionFastPathStats();
    expect(threeD.success).toBe(true);
    expect(stats.evaluations).toBeGreaterThan(0);
    expect(stats.fastSolves).toBe(0);
    expect(stats.legacyFallbacks).toBe(stats.evaluations);
  }, 120000);
});
