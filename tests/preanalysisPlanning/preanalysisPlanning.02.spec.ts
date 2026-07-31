import { describe, expect, it } from 'vitest';

import { buildPreanalysisPlanningDiagnostics } from '../../src/engine/preanalysisPlanning';
import { DEFAULT_PLANNING_MAP_STATE } from '../../src/engine/planningMapState';
import {
  buildChainResult,
  buildPartiallyFixedChainResult,
  buildResult,
} from './preanalysisPlanningTestSupport';

describe('buildPreanalysisPlanningDiagnostics advisories', () => {
  it('falls back to remaining global templates after the current weak-seed subset is exhausted', () => {
    const base = buildResult(0.01);
    base.stations['200'] = { x: 30, y: 30, h: 0, fixed: false };
    base.stations['201'] = { x: 40, y: 30, h: 0, fixed: false };
    base.observations.push({
      id: 3,
      type: 'direction',
      instCode: 'SX12',
      stdDev: 1,
      planned: true,
      sigmaSource: 'default',
      setId: '200-set',
      sourceLine: 9,
      at: '200',
      to: '201',
    } as never);
    const input = [
      'DB 105',
      'DM 104',
      'DE',
      '',
      'DB 109',
      'DM 114',
      'DE',
      '',
      'DB 200',
      'DM 201',
      'DE',
    ].join('\n');

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
      activeTemplateIds: [
        'preanalysis-set:105:104',
        'preanalysis-set:109:114',
        'preanalysis-brace:105|109',
      ],
      targetThresholdMeters: 0.005,
      maxAddedSets: 5,
      solveScenario: () => buildResult(0.01),
    });

    expect(diagnostics.candidateTemplateCount).toBe(1);
    expect(diagnostics.rows.map((row) => row.scenarioId)).toContain('preanalysis-set:200:201');
  });

  it('surfaces advisory bypass and decommission recommendations on weak control-path chains', () => {
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

    expect(diagnostics.rows.some((row) => row.scenarioKind === 'bypass-intermediate')).toBe(true);
    expect(diagnostics.rows.some((row) => row.scenarioKind === 'decommission-intermediate')).toBe(true);
    expect(
      diagnostics.rows
        .filter((row) => row.scenarioKind === 'decommission-intermediate')
        .every((row) => row.actionMode === 'applyable-transform'),
    ).toBe(true);
  });

  it('emits move-synthetic advisories only when active synthetic geometry can be relocated to a better corridor', () => {
    const input = ['DB B', 'DM A', 'DE', '', 'DB C', 'DM B', 'DE', '', 'DB D', 'DM C', 'DE'].join('\n');
    const diagnostics = buildPreanalysisPlanningDiagnostics({
      base: buildChainResult(),
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
      activeTemplateIds: ['preanalysis-brace:B|C'],
      targetThresholdMeters: 0.005,
      maxAddedSets: 3,
      solveScenario: () => buildChainResult(),
    });

    const moveRow = diagnostics.rows.find((row) => row.scenarioKind === 'move-synthetic');
    expect(moveRow).toBeDefined();
    expect(moveRow?.actionMode).toBe('applyable-transform');
    expect(moveRow?.templateLabel).toContain('Move Brace');
    expect(moveRow?.rationale).toContain('Move active synthetic geometry');
  });

  it('suppresses decommission advisories for the partially fixed intermediate itself even when a bypass exists', () => {
    const input = ['DB B', 'DM A', 'DE', '', 'DB C', 'DM B', 'DE', '', 'DB D', 'DM C', 'DE'].join('\n');
    const diagnostics = buildPreanalysisPlanningDiagnostics({
      base: buildPartiallyFixedChainResult(),
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
      solveScenario: () => buildPartiallyFixedChainResult(),
    });

    expect(diagnostics.rows.some((row) => row.scenarioKind === 'bypass-intermediate')).toBe(true);
    expect(
      diagnostics.rows.some(
        (row) => row.scenarioKind === 'decommission-intermediate' && row.occupyStationId === 'C',
      ),
    ).toBe(false);
  });
});
