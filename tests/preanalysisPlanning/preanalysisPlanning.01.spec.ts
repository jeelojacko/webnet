import { describe, expect, it } from 'vitest';

import { buildPreanalysisPlanningDiagnostics } from '../../src/engine/preanalysisPlanning';
import { DEFAULT_PLANNING_MAP_STATE } from '../../src/engine/planningMapState';
import type { AdjustmentResult } from '../../src/types';
import {
  buildChainResult,
  buildMultiRouteResult,
  buildResult,
  pairKey,
} from './preanalysisPlanningTestSupport';

describe('buildPreanalysisPlanningDiagnostics recommendations', () => {
  it('does not recommend templates already applied in the current preanalysis rerun', () => {
    const input = ['DB 105', 'DM 104', 'DE', '', 'DB 109', 'DM 114', 'DE'].join('\n');
    const activeTemplateIds = ['preanalysis-set:105:104'];
    const diagnostics = buildPreanalysisPlanningDiagnostics({
      base: buildResult(0.01),
      input,
      planningMap: {
        ...DEFAULT_PLANNING_MAP_STATE,
        scenarioFamilies: {
          existingSet: true,
          bracePoint: true,
          syntheticSetup: true,
          promotedSetup: true,
          crossTie: true,
        },
      },
      activeTemplateIds,
      targetThresholdMeters: 0.005,
      maxAddedSets: 5,
      solveScenario: (nextIds) => buildResult(nextIds.includes('preanalysis-set:109:114') ? 0.006 : 0.01),
    });

    expect(diagnostics.activeSyntheticAdditionCount).toBe(1);
    expect(diagnostics.candidateTemplateCount).toBeGreaterThanOrEqual(1);
    expect(diagnostics.rows.some((row) => row.scenarioId === 'preanalysis-set:109:114')).toBe(true);
    expect(diagnostics.thresholdPlan.steps[0]?.scenarioId).toBe('preanalysis-set:109:114');
  });

  it('reports when all usable templates are already active instead of implying the input had none', () => {
    const input = ['DB 105', 'DM 104', 'DE', '', 'DB 109', 'DM 114', 'DE'].join('\n');
    const diagnostics = buildPreanalysisPlanningDiagnostics({
      base: buildResult(0.01),
      input,
      planningMap: {
        ...DEFAULT_PLANNING_MAP_STATE,
        scenarioFamilies: {
          existingSet: true,
          bracePoint: true,
          syntheticSetup: false,
          promotedSetup: false,
          crossTie: false,
        },
      },
      activeTemplateIds: [
        'preanalysis-set:105:104',
        'preanalysis-set:109:114',
        'preanalysis-brace:105|109',
      ],
      targetThresholdMeters: 0.005,
      maxAddedSets: 5,
      solveScenario: () => buildResult(0.01),
    });

    expect(diagnostics.candidateTemplateCount).toBe(0);
    expect(diagnostics.rows).toHaveLength(0);
    expect(diagnostics.thresholdPlan.unmetReason).toBe(
      'All usable existing setup-set templates are already active.',
    );
  });

  it('adds bounded brace-point scenarios between occupied weak-pair stations', () => {
    const input = ['DB 105', 'DM 104', 'DE', '', 'DB 109', 'DM 114', 'DE'].join('\n');
    const diagnostics = buildPreanalysisPlanningDiagnostics({
      base: buildResult(0.01),
      input,
      planningMap: {
        ...DEFAULT_PLANNING_MAP_STATE,
        scenarioFamilies: {
          existingSet: true,
          bracePoint: true,
          syntheticSetup: false,
          promotedSetup: false,
          crossTie: false,
        },
      },
      activeTemplateIds: ['preanalysis-set:105:104', 'preanalysis-set:109:114'],
      targetThresholdMeters: 0.005,
      maxAddedSets: 5,
      solveScenario: (nextIds) =>
        buildResult(nextIds.some((id) => id.startsWith('preanalysis-brace:')) ? 0.007 : 0.01),
    });

    const braceRow = diagnostics.rows.find((row) => row.scenarioKind === 'brace-point');
    expect(braceRow).toBeDefined();
    expect(braceRow?.setupStationIds).toEqual(['105', '109']);
    expect(braceRow?.templateLabel).toContain('Brace B-1');
  });

  it('surfaces higher-impact brace scenarios even when repeated existing sets are still available', () => {
    const input = ['DB 105', 'DM 104', 'DE', '', 'DB 109', 'DM 114', 'DE'].join('\n');
    const diagnostics = buildPreanalysisPlanningDiagnostics({
      base: buildResult(0.01),
      input,
      planningMap: {
        ...DEFAULT_PLANNING_MAP_STATE,
        scenarioFamilies: {
          existingSet: true,
          bracePoint: true,
          syntheticSetup: false,
          promotedSetup: false,
          crossTie: false,
        },
      },
      activeTemplateIds: [],
      targetThresholdMeters: 0.005,
      maxAddedSets: 5,
      solveScenario: (nextIds) => {
        if (nextIds.some((id) => id.startsWith('preanalysis-brace:'))) return buildResult(0.006);
        if (nextIds.some((id) => id.startsWith('preanalysis-promoted:'))) return buildResult(0.0065);
        if (nextIds.some((id) => id.startsWith('preanalysis-synthsetup:'))) return buildResult(0.007);
        return buildResult(0.0095);
      },
    });

    expect(diagnostics.rows.some((row) => row.scenarioKind === 'brace-point')).toBe(true);
    expect(diagnostics.rows[0]?.scenarioKind).toBe('brace-point');
  });

  it('removes family bias and prefers the better path-to-control existing set over weaker synthetic families', () => {
    const input = ['DB B', 'DM A', 'DE', '', 'DB C', 'DM B', 'DE', '', 'DB D', 'DM C', 'DE'].join('\n');
    const diagnostics = buildPreanalysisPlanningDiagnostics({
      base: buildChainResult(),
      input,
      planningMap: DEFAULT_PLANNING_MAP_STATE,
      activeTemplateIds: [],
      targetThresholdMeters: 0.005,
      maxAddedSets: 5,
      solveScenario: (nextIds) => {
        if (nextIds.includes('preanalysis-set:B:A')) {
          const improved = buildChainResult();
          improved.stationCovariances = improved.stationCovariances?.map((row) =>
            row.stationId === 'D'
              ? { ...row, sigmaE: 0.006, sigmaN: 0.006, sigmaH: 0.006, ellipse: { semiMajor: 0.006, semiMinor: 0.004, theta: 0 } }
              : row,
          );
          improved.relativeCovariances = improved.relativeCovariances?.map((row) =>
            pairKey(row.from, row.to) === 'B|C'
              ? { ...row, sigmaDist: 0.003, ellipse: { semiMajor: 0.003, semiMinor: 0.002, theta: 0 } }
              : row,
          );
          return improved as AdjustmentResult;
        }
        if (nextIds.some((id) => id.startsWith('preanalysis-brace:'))) {
          const weaker = buildChainResult();
          weaker.stationCovariances = weaker.stationCovariances?.map((row) =>
            row.stationId === 'D'
              ? { ...row, sigmaE: 0.0105, sigmaN: 0.0105, sigmaH: 0.0105, ellipse: { semiMajor: 0.0105, semiMinor: 0.005, theta: 0 } }
              : row,
          );
          return weaker as AdjustmentResult;
        }
        if (nextIds.some((id) => id.startsWith('preanalysis-promoted:'))) {
          const weaker = buildChainResult();
          weaker.stationCovariances = weaker.stationCovariances?.map((row) =>
            row.stationId === 'D'
              ? { ...row, sigmaE: 0.0108, sigmaN: 0.0108, sigmaH: 0.0108, ellipse: { semiMajor: 0.0108, semiMinor: 0.005, theta: 0 } }
              : row,
          );
          return weaker as AdjustmentResult;
        }
        if (nextIds.some((id) => id.startsWith('preanalysis-synthsetup:'))) {
          const weaker = buildChainResult();
          weaker.stationCovariances = weaker.stationCovariances?.map((row) =>
            row.stationId === 'D'
              ? { ...row, sigmaE: 0.011, sigmaN: 0.011, sigmaH: 0.011, ellipse: { semiMajor: 0.011, semiMinor: 0.005, theta: 0 } }
              : row,
          );
          return weaker as AdjustmentResult;
        }
        return buildChainResult();
      },
    });

    expect(diagnostics.rows[0]?.scenarioId).toBe('preanalysis-set:B:A');
    expect(diagnostics.rows[0]?.scenarioKind).toBe('existing-set');
    expect(diagnostics.rows[0]?.primaryTargetStationId).toBe('D');
    expect(diagnostics.rows[0]?.bottleneckPair).toEqual({ from: 'B', to: 'C' });
  });

  it('picks a deterministic canonical anchor path when multiple equal routes exist', () => {
    const input = ['DB B', 'DM A', 'DE', '', 'DB C', 'DM A', 'DE', '', 'DB D', 'DM B', 'DE', '', 'DB D', 'DM C', 'DE'].join('\n');
    const diagnostics = buildPreanalysisPlanningDiagnostics({
      base: buildMultiRouteResult(),
      input,
      planningMap: {
        ...DEFAULT_PLANNING_MAP_STATE,
        scenarioFamilies: {
          existingSet: true,
          bracePoint: false,
          syntheticSetup: false,
          promotedSetup: false,
          crossTie: false,
        },
      },
      activeTemplateIds: ['preanalysis-set:B:A', 'preanalysis-set:C:A', 'preanalysis-set:D:B', 'preanalysis-set:D:C'],
      targetThresholdMeters: 0.005,
      maxAddedSets: 2,
      solveScenario: () => buildMultiRouteResult(),
    });

    const row = diagnostics.rows.find((candidate) => candidate.primaryTargetStationId === 'D');
    expect(row?.anchorPathStationIds).toEqual(['A', 'B', 'D']);
    expect(row?.bottleneckPair).toEqual({ from: 'B', to: 'D' });
  });

  it('keeps impactful non-existing scenarios in the bounded solve pool without relying on family bias', () => {
    const base = buildResult(0.01);
    for (let index = 0; index < 8; index += 1) {
      const occupy = `30${index}`;
      const target = `40${index}`;
      base.stations[occupy] = { x: 50 + index * 10, y: 0, h: 0, fixed: false };
      base.stations[target] = { x: 55 + index * 10, y: 5, h: 0, fixed: false };
      base.observations.push({
        id: 10 + index,
        type: 'direction',
        instCode: 'SX12',
        stdDev: 1,
        planned: true,
        sigmaSource: 'default',
        setId: `${occupy}-set`,
        sourceLine: 9 + index * 4,
        at: occupy,
        to: target,
      } as never);
    }
    const extraBlocks = Array.from({ length: 8 }, (_, index) =>
      [`DB 30${index}`, `DM 40${index}`, 'DE'].join('\n'),
    );
    const input = [
      'DB 105',
      'DM 104',
      'DE',
      '',
      'DB 109',
      'DM 114',
      'DE',
      '',
      ...extraBlocks,
    ].join('\n\n');

    const diagnostics = buildPreanalysisPlanningDiagnostics({
      base,
      input,
      planningMap: {
        ...DEFAULT_PLANNING_MAP_STATE,
        scenarioFamilies: {
          existingSet: true,
          bracePoint: true,
          syntheticSetup: false,
          promotedSetup: false,
          crossTie: false,
        },
      },
      activeTemplateIds: [],
      targetThresholdMeters: 0.005,
      maxAddedSets: 5,
      solveScenario: (nextIds) => {
        if (nextIds.some((id) => id.startsWith('preanalysis-brace:'))) return buildResult(0.006);
        if (nextIds.some((id) => id.startsWith('preanalysis-promoted:'))) return buildResult(0.0065);
        if (nextIds.some((id) => id.startsWith('preanalysis-synthsetup:'))) return buildResult(0.007);
        return buildResult(0.0095);
      },
    });

    expect(diagnostics.rows.some((row) => row.scenarioKind === 'brace-point')).toBe(true);
    expect(diagnostics.rows[0]?.scenarioKind).toBe('brace-point');
    expect(diagnostics.rows[0]?.deltaWorstStationMajor).toBeCloseTo(-0.004);
  });
});
