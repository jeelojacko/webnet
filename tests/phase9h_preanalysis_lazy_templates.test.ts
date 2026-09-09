/**
 * Phase 9H lazy preanalysis templates: with no active additions the initial
 * main solve runs once on the base input and templates are derived from that
 * exact result (no separate template-source solveEngine call). Active-addition
 * sessions keep the legacy template-source solve.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { buildPreanalysisSyntheticSetTemplates } from '../src/engine/preanalysisPlanning';
import { resolveEffectiveProjectParse } from '../src/engine/effectiveProjectParse';
import { runAdjustmentSession } from '../src/engine/runSession';
import { buildParseOptions } from '../src/engine/runSessionProfile';
import { solveEngine } from '../src/engine/solveEngine';
import * as solveEngineModule from '../src/engine/solveEngine';
import type { AdjustmentResult } from '../src/types';
import { createRunSessionRequest } from './helpers/runSessionRequest';

const SMALL_INPUT = fs.readFileSync(
  path.join(process.cwd(), 'tests/fixtures/preanalysis_cli.dat'),
  'utf-8',
);

const makePreanalysisRequest = (input: string) => {
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

/** Replicates the pre-9H template-source solve for the empty-active case. */
const stripSessionVolatileFields = (result: AdjustmentResult): unknown => {
  const clone = JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
  delete clone.solveTimingProfile;
  delete clone.preanalysisImpactDiagnostics;
  delete clone.preanalysisSyntheticAdditionIds;
  delete clone.robustComparison;
  if (Array.isArray(clone.logs)) {
    clone.logs = (clone.logs as string[]).filter((line) => !line.startsWith('Solve timing (ms):'));
  }
  return clone;
};

const legacyTemplateSource = (request: ReturnType<typeof makePreanalysisRequest>) => {
  const { profileContext, normalizedMerges } = resolveEffectiveProjectParse(request, {
    approvedClusterMerges: [],
  });
  return solveEngine({
    input: request.input,
    maxIterations: request.maxIterations,
    convergenceThreshold: request.convergenceLimit,
    instrumentLibrary: profileContext.effectiveInstrumentLibrary,
    excludeIds: new Set<number>(),
    overrides: {},
    geoidSourceData:
      profileContext.effectiveParse.geoidSourceFormat !== 'builtin'
        ? (request.geoidSourceData ?? undefined)
        : undefined,
    parseOptions: {
      ...buildParseOptions(
        request,
        profileContext.effectiveParse,
        profileContext.directionSetMode,
        profileContext.allowClusterFaceReliability,
        normalizedMerges,
        profileContext.currentInstrument,
      ),
      preanalysisSyntheticAdditionIds: [],
    },
  });
};

describe('phase 9H lazy preanalysis templates', () => {
  it('empty-active session performs no uncounted template-source solve', () => {
    const spy = vi.spyOn(solveEngineModule, 'solveEngine');
    try {
      const request = makePreanalysisRequest(SMALL_INPUT);
      const outcome = runAdjustmentSession(request);
      // Every engine call is a counted solveCore solve; the legacy extra
      // uncounted template-source call is gone (actual drops exactly one).
      expect(spy.mock.calls.length).toBe(outcome.profile.solveInvocationCount);
      expect(outcome.profile.solveInvocationCount).toBeGreaterThanOrEqual(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('lazy templates and main result match the legacy template-source oracle', () => {
    const request = makePreanalysisRequest(SMALL_INPUT);
    const outcome = runAdjustmentSession(request);
    const lazyTemplates = buildPreanalysisSyntheticSetTemplates(
      SMALL_INPUT,
      outcome.result,
      request.planningMap,
      [],
    );
    expect(lazyTemplates.length).toBeGreaterThan(0);
    const templateSource = legacyTemplateSource(request);
    const legacyTemplates = buildPreanalysisSyntheticSetTemplates(
      SMALL_INPUT,
      templateSource,
      request.planningMap,
      [],
    );
    expect(lazyTemplates).toEqual(legacyTemplates);
    // Same base input through same effective options: complete engine result
    // equality after removing only session timing and planning metadata.
    expect(stripSessionVolatileFields(outcome.result)).toEqual(
      stripSessionVolatileFields(templateSource),
    );
    // Recommendation/threshold planning still runs off the lazy templates.
    expect(outcome.result.preanalysisImpactDiagnostics?.enabled).toBe(true);
    expect(
      outcome.result.preanalysisImpactDiagnostics?.candidateTemplateCount,
    ).toBe(lazyTemplates.length);
  });

  it('active-addition session preserves the template-source solve', () => {
    const emptyRequest = makePreanalysisRequest(SMALL_INPUT);
    const base = runAdjustmentSession(emptyRequest).result;
    const templates = buildPreanalysisSyntheticSetTemplates(
      SMALL_INPUT,
      base,
      emptyRequest.planningMap,
      [],
    );
    const active = templates.find(
      (template) =>
        template.actionMode === 'applyable-addition' ||
        template.actionMode === 'applyable-transform',
    );
    expect(active).toBeDefined();
    const spy = vi.spyOn(solveEngineModule, 'solveEngine');
    try {
      const request = makePreanalysisRequest(SMALL_INPUT);
      request.activePreanalysisAdditionIds = [active!.id];
      const outcome = runAdjustmentSession(request);
      // Legacy behavior kept: one uncounted template-source solve on top of
      // the counted solveCore solves.
      expect(spy.mock.calls.length).toBe(outcome.profile.solveInvocationCount + 1);
      expect(outcome.result.preanalysisSyntheticAdditionIds).toContain(active!.id);
    } finally {
      spy.mockRestore();
    }
  });
});
