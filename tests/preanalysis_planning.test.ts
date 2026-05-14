import { describe, expect, it } from 'vitest';

import { buildPreanalysisPlanningDiagnostics } from '../src/engine/preanalysisPlanning';
import { DEFAULT_PLANNING_MAP_STATE } from '../src/engine/planningMapState';
import type { AdjustmentResult } from '../src/types';

const buildResult = (worstMajor: number): AdjustmentResult =>
  ({
    success: true,
    converged: true,
    iterations: 1,
    stations: {
      '104': { x: 10, y: 0, h: 0, fixed: false },
      '105': { x: 0, y: 0, h: 0, fixed: false },
      '109': { x: 12, y: 14, h: 0, fixed: false },
      '114': { x: 22, y: 14, h: 0, fixed: false },
    },
    observations: [
      {
        id: 1,
        type: 'direction',
        instCode: 'SX12',
        stdDev: 1,
        planned: true,
        sigmaSource: 'default',
        setId: '105-set',
        sourceLine: 1,
        at: '105',
        to: '104',
      },
      {
        id: 2,
        type: 'direction',
        instCode: 'SX12',
        stdDev: 1,
        planned: true,
        sigmaSource: 'default',
        setId: '109-set',
        sourceLine: 5,
        at: '109',
        to: '114',
      },
    ],
    stationCovariances: [
      {
        stationId: 'P1',
        cEE: worstMajor,
        cEN: 0,
        cNN: worstMajor,
        sigmaE: worstMajor,
        sigmaN: worstMajor,
        sigmaH: worstMajor,
        ellipse: { semiMajor: worstMajor, semiMinor: worstMajor, theta: 0 },
      },
    ],
    relativeCovariances: [
      {
        from: '105',
        to: '109',
        connected: true,
        connectionTypes: ['direction'],
        cEE: worstMajor,
        cEN: 0,
        cNN: worstMajor,
        sigmaE: worstMajor,
        sigmaN: worstMajor,
        sigmaH: worstMajor,
        sigmaDist: worstMajor,
        ellipse: { semiMajor: worstMajor, semiMinor: worstMajor, theta: 0 },
      },
    ],
    weakGeometryDiagnostics: {
      enabled: true,
      stationMedianHorizontal: worstMajor,
      relativeMedianDistance: worstMajor,
      stationCues: [
        {
          stationId: '105',
          horizontalMetric: worstMajor,
          severity: 'weak',
          note: 'weak',
        },
        {
          stationId: '109',
          horizontalMetric: worstMajor,
          severity: 'watch',
          note: 'watch',
        },
      ],
      relativeCues: [
        {
          from: '105',
          to: '109',
          distanceMetric: worstMajor,
          severity: 'weak',
          note: 'weak pair',
        },
      ],
    },
    logs: [],
    covariance: [],
    summaries: [],
    unknowns: [],
    sigma0: 1,
    seuw: 1,
    dof: 1,
  }) as unknown as AdjustmentResult;

describe('buildPreanalysisPlanningDiagnostics', () => {
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
          syntheticSetup: false,
          promotedSetup: false,
          crossTie: false,
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
    expect(braceRow?.templateLabel).toContain('Brace BRACE_105_109');
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
          syntheticSetup: true,
          promotedSetup: true,
          crossTie: true,
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

  it('keeps brace and synthetic families in the bounded solve pool ahead of surplus repeated-set trials', () => {
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
          syntheticSetup: true,
          promotedSetup: true,
          crossTie: true,
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
    expect(diagnostics.rows.some((row) => row.scenarioKind === 'promoted-setup')).toBe(true);
    expect(diagnostics.rows[0]?.scenarioKind).toBe('brace-point');
    expect(diagnostics.rows.slice(0, 3).some((row) => row.scenarioKind === 'promoted-setup')).toBe(
      true,
    );
    expect(
      diagnostics.rows.slice(0, 4).filter((row) => row.scenarioKind === 'existing-set').length,
    ).toBeLessThanOrEqual(1);
  });

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
