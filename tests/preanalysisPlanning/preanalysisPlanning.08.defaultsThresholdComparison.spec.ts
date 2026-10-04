/**
 * Preanalysis default change (0.001 m / 5 sets -> 0.005 m / 3 sets):
 * old-vs-new comparison on the canonical camp fixture.
 *
 * Pins that the base solve output is identical (threshold/max-set controls
 * only affect post-base planning) and records the intended threshold-plan
 * metadata difference (target value only). Recommendation rows are identical
 * on this fixture; the row-identity assertion pins that truthfully rather
 * than forcing it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  buildPreanalysisPlanningDiagnostics,
  buildPreanalysisSyntheticSetTemplates,
  buildSyntheticPreanalysisInput,
  resolveAppliedPreanalysisActionState,
} from '../../src/engine/preanalysisPlanning';
import { DEFAULT_PLANNING_MAP_STATE } from '../../src/engine/planningMapState';
import { runAdjustmentSession } from '../../src/engine/runSession';
import { createRunSessionRequest } from '../helpers/runSessionRequest';
import type { AdjustmentResult } from '../../src/types';

const CAMP_INPUT = fs.readFileSync(
  path.join(process.cwd(), 'tests/fixtures/camp_design_preanalysis_traverse_only.dat'),
  'utf-8',
);

const snapshotBaseResult = (result: AdjustmentResult): string =>
  JSON.stringify({
    success: result.success,
    converged: result.converged,
    stations: result.stations,
    observations: result.observations,
    stationCovariances: result.stationCovariances,
    relativeCovariances: result.relativeCovariances,
    weakGeometryDiagnostics: (
      result as unknown as { weakGeometryDiagnostics?: unknown }
    ).weakGeometryDiagnostics,
    plannedObservationCount: (
      result.parseState as unknown as { plannedObservationCount?: unknown }
    )?.plannedObservationCount,
  });

const runPlanningArm = (thresholdMeters: number, maxAddedSets: number) => {
  const baseRequest = createRunSessionRequest({
    input: CAMP_INPUT,
    parseSettings: {
      ...createRunSessionRequest().parseSettings,
      runMode: 'preanalysis',
      preanalysisMode: true,
      coordMode: '2D',
      preanalysisAccuracyThresholdMeters: thresholdMeters,
      preanalysisMaxAddedSets: maxAddedSets,
    },
  });
  const base = runAdjustmentSession(baseRequest).result;
  const sessionTemplates = buildPreanalysisSyntheticSetTemplates(
    CAMP_INPUT,
    base,
    DEFAULT_PLANNING_MAP_STATE,
    [],
  );
  expect(sessionTemplates.length).toBeGreaterThan(0);
  let planningChecks = 0;
  const solveScenario = (nextIds: string[]): AdjustmentResult => {
    planningChecks += 1;
    const normalized = resolveAppliedPreanalysisActionState(
      sessionTemplates,
      nextIds,
    ).normalizedScenarioIds;
    const solveInput = buildSyntheticPreanalysisInput(CAMP_INPUT, normalized, sessionTemplates);
    const scenarioRequest = createRunSessionRequest({
      ...baseRequest,
      input: solveInput,
      parseSettings: {
        ...baseRequest.parseSettings,
        runMode: 'adjustment',
        preanalysisMode: false,
      },
    });
    return runAdjustmentSession(scenarioRequest).result;
  };
  const diagnostics = buildPreanalysisPlanningDiagnostics({
    base,
    input: CAMP_INPUT,
    planningMap: DEFAULT_PLANNING_MAP_STATE,
    activeTemplateIds: [],
    targetThresholdMeters: thresholdMeters,
    maxAddedSets: maxAddedSets,
    solveScenario,
  });
  return { base, diagnostics, planningChecks };
};

describe('preanalysis default change: old 0.001/5 vs new 0.005/3 (camp fixture)', () => {
  it('keeps base solve output identical and recommendation rows identical', () => {
    const oldArm = runPlanningArm(0.001, 5);
    const newArm = runPlanningArm(0.005, 3);

    // Base solve must be identical: these controls only affect post-base planning.
    expect(snapshotBaseResult(newArm.base)).toBe(snapshotBaseResult(oldArm.base));

    // Recommendation candidate cap (16) and scoring are untouched.
    expect(newArm.diagnostics.candidateTemplateCount).toBe(
      oldArm.diagnostics.candidateTemplateCount,
    );
    expect(newArm.diagnostics.candidateTemplateCount).toBe(16);

    // Recommendation scenario IDs, order, and scores are identical on this fixture.
    const summarize = (rows: Array<{ scenarioId: string; score?: unknown; thresholdReached?: unknown }>) =>
      rows.map((row) => ({
        scenarioId: row.scenarioId,
        score: row.score,
        thresholdReached: row.thresholdReached,
      }));
    expect(summarize(newArm.diagnostics.rows)).toEqual(summarize(oldArm.diagnostics.rows));

    // Threshold-plan metadata: only the target itself differs (that is the point).
    expect(newArm.diagnostics.thresholdPlan.thresholdReached).toBe(
      oldArm.diagnostics.thresholdPlan.thresholdReached,
    );
    expect(newArm.diagnostics.thresholdPlan.appliedStepCount).toBe(
      oldArm.diagnostics.thresholdPlan.appliedStepCount,
    );
    expect(newArm.diagnostics.thresholdPlan.finalWorstStationMajor).toBe(
      oldArm.diagnostics.thresholdPlan.finalWorstStationMajor,
    );
    expect(newArm.diagnostics.thresholdPlan.targetThresholdMeters).toBe(0.005);
    expect(oldArm.diagnostics.thresholdPlan.targetThresholdMeters).toBe(0.001);

    // Record the planning check counts (informational; both arms evaluate the
    // same 16 candidates here because the base already beats both targets).
    expect(newArm.planningChecks).toBe(oldArm.planningChecks);
    expect(newArm.planningChecks).toBe(16);
  });
});
