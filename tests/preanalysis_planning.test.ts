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
              { x: 2, y: 2 },
              { x: 8, y: 2 },
              { x: 8, y: 10 },
              { x: 2, y: 10 },
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
