/**
 * Phase 9E representative scenario-cost audit (manual evidence tier).
 *
 * One exact-camp pass only. Diagnostic output; no performance gate and no
 * production fast-path behavior.
 *
 * Timing labels: each per-scenario `wallMs`/`solveTimingProfile` below is an
 * ISOLATED fresh-session solve (`runAdjustmentSession` per scenario, each
 * with its own template-source/main/planning overhead), so per-scenario
 * times OVERSTATE the production per-scenario cost (production evaluates
 * scenarios via the lightweight `solveCore` single solve). Only
 * `fullSessionWallMs` and the full-session `solveTimingProfile` are
 * production timings. Cross-run timing comparisons are indicative only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';

import { buildPreanalysisPlanningDiagnostics } from '../../src/engine/preanalysisPlanning';
import {
  buildPreanalysisSyntheticSetTemplates,
  buildSyntheticPreanalysisInput,
} from '../../src/engine/preanalysisPlanningTemplates';
import { resolveAppliedPreanalysisActionState } from '../../src/engine/preanalysisPlanningShared';
import { DEFAULT_PLANNING_MAP_STATE } from '../../src/engine/planningMapState';
import { runAdjustmentSession } from '../../src/engine/runSession';
import { createRunSessionRequest } from '../helpers/runSessionRequest';

const CAMP_INPUT = fs.readFileSync(
  path.join(process.cwd(), 'tests/fixtures/camp_design_preanalysis_traverse_only.dat'),
  'utf-8',
);

type ScenarioAuditRow = {
  scenarioId: string;
  scenarioKind: string;
  addedObservationCount: number;
  activeObservationCount: number;
  success: boolean;
  wallMs: number;
  solveTimingProfile: NonNullable<ReturnType<typeof runAdjustmentSession>['result']['solveTimingProfile']>;
  iterations: number;
  seuw: number;
};

describe('phase 9E representative scenario-cost audit', () => {
  it('profiles each default-camp recommendation scenario once', () => {
    const baseRequest = createRunSessionRequest({
      input: CAMP_INPUT,
      parseSettings: {
        ...createRunSessionRequest().parseSettings,
        runMode: 'preanalysis',
        preanalysisMode: true,
        coordMode: '2D',
      },
    });
    const base = runAdjustmentSession(baseRequest).result;
    const templates = buildPreanalysisSyntheticSetTemplates(
      CAMP_INPUT,
      base,
      DEFAULT_PLANNING_MAP_STATE,
      [],
    );
    const templateById = new Map(templates.map((template) => [template.id, template]));
    const rows: ScenarioAuditRow[] = [];

    buildPreanalysisPlanningDiagnostics({
      base,
      input: CAMP_INPUT,
      planningMap: DEFAULT_PLANNING_MAP_STATE,
      activeTemplateIds: [],
      targetThresholdMeters: baseRequest.parseSettings.preanalysisAccuracyThresholdMeters,
      maxAddedSets: 5,
      solveScenario: (requestedIds) => {
        const normalizedIds = resolveAppliedPreanalysisActionState(
          templates,
          requestedIds,
        ).normalizedScenarioIds;
        const template = templateById.get(normalizedIds[0] ?? '');
        const scenarioRequest = createRunSessionRequest({
          ...baseRequest,
          input: buildSyntheticPreanalysisInput(CAMP_INPUT, normalizedIds, templates),
          parseSettings: {
            ...baseRequest.parseSettings,
            runMode: 'preanalysis',
            preanalysisMode: true,
          },
        });
        const startedAt = performance.now();
        const result = runAdjustmentSession(scenarioRequest).result;
        // Isolated fresh-session wall time (overstates production solveCore).
        const wallMs = performance.now() - startedAt;
        if (template != null) {
          if (rows.length >= 16) {
            throw new Error(
              `phase9e-scenario-audit: more than 16 recommendation scenarios (got ${template.id} as #${rows.length + 1}); failing closed instead of silently dropping`,
            );
          }
          rows.push({
            scenarioId: template.id,
            scenarioKind: template.scenarioKind,
            addedObservationCount: template.addedObservationCount,
            activeObservationCount: result.observations.length,
            success: result.success,
            wallMs,
            solveTimingProfile: result.solveTimingProfile!,
            iterations: result.iterations,
            seuw: result.seuw,
          });
        }
        return result;
      },
    });

    expect(rows).toHaveLength(16);
    expect(rows.every((row) => row.success && row.iterations === 1 && row.seuw === 1)).toBe(true);
    const sortedTimes = rows.map((row) => row.wallMs).sort((left, right) => left - right);
    const medianMs = sortedTimes[Math.floor(sortedTimes.length / 2)] ?? 0;
    const totalMs = rows.reduce((sum, row) => sum + row.wallMs, 0);
    const fullSessionStartedAt = performance.now();
    const fullSession = runAdjustmentSession(baseRequest).result;
    const fullSessionWallMs = performance.now() - fullSessionStartedAt;
    expect(fullSession.success).toBe(true);
    console.log(
      `[phase9e-scenario-audit] ${JSON.stringify({
        productionBaseSession: {
          totalMs: base.solveTimingProfile?.totalMs,
          parseAndSetupMs: base.solveTimingProfile?.parseAndSetupMs,
          equationAssemblyMs: base.solveTimingProfile?.equationAssemblyMs,
          matrixFactorizationMs: base.solveTimingProfile?.matrixFactorizationMs,
          precisionPropagationMs: base.solveTimingProfile?.precisionPropagationMs,
          precisionAndDiagnosticsMs: base.solveTimingProfile?.precisionAndDiagnosticsMs,
          resultPackagingMs: base.solveTimingProfile?.resultPackagingMs,
          otherMs: base.solveTimingProfile?.otherMs,
          observationCount: base.observations.length,
          iterations: base.iterations,
          seuw: base.seuw,
        },
        scenarioCount: rows.length,
        isolatedScenarioTotalWallMs: totalMs,
        isolatedScenarioMinWallMs: sortedTimes[0],
        isolatedScenarioMedianWallMs: medianMs,
        isolatedScenarioMaxWallMs: sortedTimes.at(-1),
        productionFullSessionWallMs: fullSessionWallMs,
        isolatedScenarioShareOfFullSession: totalMs / fullSessionWallMs,
        rows,
      })}`,
    );
  }, 120000);
});
