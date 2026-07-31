import { describe, expect, it } from 'vitest';

import {
  buildPreanalysisPlanningDiagnostics,
  buildPreanalysisSyntheticSetTemplates,
  buildSyntheticPreanalysisInput,
} from '../../src/engine/preanalysisPlanning';
import { DEFAULT_PLANNING_MAP_STATE } from '../../src/engine/planningMapState';
import type { AdjustmentResult } from '../../src/types';
import {
  buildChainResult,
  buildResult,
  pairKey,
} from './preanalysisPlanningTestSupport';

describe('buildPreanalysisPlanningDiagnostics transforms and obstacles', () => {
  it('keeps threshold planning additive-only and reports when only advisory changes remain', () => {
    const input = ['DB B', 'DM A', 'DE', '', 'DB C', 'DM B', 'DE', '', 'DB D', 'DM C', 'DE'].join('\n');
    const diagnostics = buildPreanalysisPlanningDiagnostics({
      base: buildChainResult(),
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
      activeTemplateIds: ['preanalysis-set:B:A', 'preanalysis-set:C:B', 'preanalysis-set:D:C'],
      targetThresholdMeters: 0.005,
      maxAddedSets: 2,
      solveScenario: () => buildChainResult(),
    });

    expect(diagnostics.thresholdPlan.steps).toHaveLength(0);
    expect(diagnostics.thresholdPlan.unmetReason).toBe(
      'Additive scenarios are exhausted; only one-click transform scenarios remain outside threshold planning.',
    );
  });

  it('applies decommission transforms by removing the weak intermediate lines and adding the bypass tie', () => {
    const input = ['DB B', 'DM A', 'DE', '', 'DB C', 'DM B', 'DE', '', 'DB D', 'DM C', 'DE'].join('\n');
    const templates = buildPreanalysisSyntheticSetTemplates(
      input,
      buildChainResult(),
      {
        ...DEFAULT_PLANNING_MAP_STATE,
        scenarioFamilies: {
          existingSet: true,
          bracePoint: false,
          syntheticSetup: false,
          promotedSetup: false,
          crossTie: false,
        },
      },
      ['preanalysis-set:B:A', 'preanalysis-set:C:B', 'preanalysis-set:D:C'],
    );

    const transformed = buildSyntheticPreanalysisInput(
      input,
      ['preanalysis-decommission:B|C|D'],
      templates,
    );

    expect(transformed).toContain(['DB B', 'DM D', 'DE'].join('\n'));
    expect(transformed).not.toContain('DB C');
    expect(transformed).not.toContain('DM C');
  });

  it('applies move transforms by replacing the active synthetic block with the relocated candidate block', () => {
    const input = ['DB B', 'DM A', 'DE', '', 'DB C', 'DM B', 'DE', '', 'DB D', 'DM C', 'DE'].join('\n');
    const templates = buildPreanalysisSyntheticSetTemplates(
      input,
      buildChainResult(),
      {
        ...DEFAULT_PLANNING_MAP_STATE,
        scenarioFamilies: {
          existingSet: true,
          bracePoint: true,
          syntheticSetup: false,
          promotedSetup: false,
          crossTie: false,
        },
      },
      ['preanalysis-brace:B|C'],
    );
    const activeBrace = templates.find((template) => template.id === 'preanalysis-brace:B|C');
    const moveTemplate = templates.find((template) => template.scenarioKind === 'move-synthetic');

    expect(activeBrace).toBeDefined();
    expect(moveTemplate).toBeDefined();

    const transformed = buildSyntheticPreanalysisInput(
      input,
      ['preanalysis-brace:B|C', moveTemplate!.id],
      templates,
    );

    expect(transformed).toContain(moveTemplate!.blockText);
    expect(transformed).not.toContain(activeBrace!.blockText);
  });

  it('recomputes the next recommendation after an applied path fix changes the active bottleneck', () => {
    const input = ['DB B', 'DM A', 'DE', '', 'DB C', 'DM B', 'DE', '', 'DB D', 'DM C', 'DE'].join('\n');
    const solveScenario = (nextIds: string[]) => {
      const hasBA = nextIds.includes('preanalysis-set:B:A');
      const hasCB = nextIds.includes('preanalysis-set:C:B');
      const hasDC = nextIds.includes('preanalysis-set:D:C');
      const result = buildChainResult();
      if (hasBA) {
        result.relativeCovariances = result.relativeCovariances?.map((row) =>
          pairKey(row.from, row.to) === 'B|C'
            ? { ...row, sigmaDist: 0.003, ellipse: { semiMajor: 0.003, semiMinor: 0.002, theta: 0 } }
            : row,
        );
      }
      if (hasCB) {
        result.stationCovariances = result.stationCovariances?.map((row) =>
          row.stationId === 'D'
            ? { ...row, sigmaE: 0.007, sigmaN: 0.007, sigmaH: 0.007, ellipse: { semiMajor: 0.007, semiMinor: 0.004, theta: 0 } }
            : row,
        );
        result.relativeCovariances = result.relativeCovariances?.map((row) =>
          pairKey(row.from, row.to) === 'C|D'
            ? { ...row, sigmaDist: 0.004, ellipse: { semiMajor: 0.004, semiMinor: 0.002, theta: 0 } }
            : row,
        );
      }
      if (hasDC) {
        result.stationCovariances = result.stationCovariances?.map((row) =>
          row.stationId === 'D'
            ? { ...row, sigmaE: 0.009, sigmaN: 0.009, sigmaH: 0.009, ellipse: { semiMajor: 0.009, semiMinor: 0.004, theta: 0 } }
            : row,
        );
      }
      return result as AdjustmentResult;
    };
    const diagnostics = buildPreanalysisPlanningDiagnostics({
      base: solveScenario(['preanalysis-set:B:A']),
      input,
      planningMap: DEFAULT_PLANNING_MAP_STATE,
      activeTemplateIds: ['preanalysis-set:B:A'],
      targetThresholdMeters: 0.005,
      maxAddedSets: 3,
      solveScenario,
    });

    expect(diagnostics.rows[0]?.scenarioId).toBe('preanalysis-set:C:B');
    expect(diagnostics.rows[0]?.bottleneckPair).toEqual({ from: 'C', to: 'D' });
  });

  it('rejects brace and synthetic setup candidates that fall inside blocked polygons', () => {
    const input = ['DB 105', 'DM 104', 'DE', '', 'DB 109', 'DM 114', 'DE'].join('\n');
    const diagnostics = buildPreanalysisPlanningDiagnostics({
      base: buildResult(0.01),
      input,
      planningMap: {
        ...DEFAULT_PLANNING_MAP_STATE,
        blockedPolygons: [
          {
            id: 'user-block-1',
            source: 'user',
            kind: 'blocked-area',
            label: 'Blocked',
            vertices: [
              { x: -1, y: -1 },
              { x: 13, y: -1 },
              { x: 13, y: 15 },
              { x: -1, y: 15 },
            ],
          },
        ],
      },
      activeTemplateIds: [],
      targetThresholdMeters: 0.005,
      maxAddedSets: 5,
      solveScenario: () => buildResult(0.01),
    });

    expect(diagnostics.rows.some((row) => row.scenarioKind === 'brace-point')).toBe(false);
    expect(diagnostics.rows.some((row) => row.scenarioKind === 'synthetic-setup')).toBe(false);
  });
});
