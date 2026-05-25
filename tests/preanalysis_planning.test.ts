import { describe, expect, it } from 'vitest';

import { buildPreanalysisPlanningDiagnostics } from '../src/engine/preanalysisPlanning';
import { DEFAULT_PLANNING_MAP_STATE } from '../src/engine/planningMapState';
import type { AdjustmentResult } from '../src/types';

const pairKey = (from: string, to: string): string => [from, to].sort().join('|');

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

const buildChainResult = (): AdjustmentResult =>
  ({
    success: true,
    converged: true,
    iterations: 1,
    stations: {
      A: { x: 0, y: 0, h: 0, fixed: true, fixedX: true, fixedY: true },
      B: { x: 50, y: 0, h: 0, fixed: false },
      C: { x: 100, y: 0, h: 0, fixed: false },
      D: { x: 150, y: 0, h: 0, fixed: false },
    },
    observations: [
      { id: 1, type: 'direction', instCode: 'SX12', stdDev: 1, planned: true, sigmaSource: 'default', setId: 'B-set', sourceLine: 1, at: 'B', to: 'A' },
      { id: 2, type: 'direction', instCode: 'SX12', stdDev: 1, planned: true, sigmaSource: 'default', setId: 'C-set', sourceLine: 5, at: 'C', to: 'B' },
      { id: 3, type: 'direction', instCode: 'SX12', stdDev: 1, planned: true, sigmaSource: 'default', setId: 'D-set', sourceLine: 9, at: 'D', to: 'C' },
    ],
    stationCovariances: [
      { stationId: 'B', cEE: 0.004, cEN: 0, cNN: 0.004, sigmaE: 0.004, sigmaN: 0.004, sigmaH: 0.004, ellipse: { semiMajor: 0.004, semiMinor: 0.003, theta: 0 } },
      { stationId: 'C', cEE: 0.008, cEN: 0, cNN: 0.008, sigmaE: 0.008, sigmaN: 0.008, sigmaH: 0.008, ellipse: { semiMajor: 0.008, semiMinor: 0.005, theta: 0 } },
      { stationId: 'D', cEE: 0.012, cEN: 0, cNN: 0.012, sigmaE: 0.012, sigmaN: 0.012, sigmaH: 0.012, ellipse: { semiMajor: 0.012, semiMinor: 0.006, theta: 0 } },
    ],
    relativeCovariances: [
      { from: 'A', to: 'B', connected: true, connectionTypes: ['direction'], cEE: 0.002, cEN: 0, cNN: 0.002, sigmaE: 0.002, sigmaN: 0.002, sigmaH: 0.002, sigmaDist: 0.002, ellipse: { semiMajor: 0.002, semiMinor: 0.001, theta: 0 } },
      { from: 'B', to: 'C', connected: true, connectionTypes: ['direction'], cEE: 0.009, cEN: 0, cNN: 0.009, sigmaE: 0.009, sigmaN: 0.009, sigmaH: 0.009, sigmaDist: 0.009, ellipse: { semiMajor: 0.009, semiMinor: 0.003, theta: 0 } },
      { from: 'C', to: 'D', connected: true, connectionTypes: ['direction'], cEE: 0.006, cEN: 0, cNN: 0.006, sigmaE: 0.006, sigmaN: 0.006, sigmaH: 0.006, sigmaDist: 0.006, ellipse: { semiMajor: 0.006, semiMinor: 0.003, theta: 0 } },
    ],
    weakGeometryDiagnostics: {
      enabled: true,
      stationMedianHorizontal: 0.008,
      relativeMedianDistance: 0.006,
      stationCues: [
        { stationId: 'D', horizontalMetric: 0.012, severity: 'weak', note: 'weak leaf' },
        { stationId: 'C', horizontalMetric: 0.008, severity: 'watch', note: 'watch mid' },
      ],
      relativeCues: [
        { from: 'B', to: 'C', distanceMetric: 0.009, severity: 'weak', note: 'main bottleneck' },
        { from: 'C', to: 'D', distanceMetric: 0.006, severity: 'watch', note: 'leaf leg' },
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

const buildMultiRouteResult = (): AdjustmentResult =>
  ({
    success: true,
    converged: true,
    iterations: 1,
    stations: {
      A: { x: 0, y: 0, h: 0, fixed: true, fixedX: true, fixedY: true },
      B: { x: 40, y: 20, h: 0, fixed: false },
      C: { x: 40, y: -20, h: 0, fixed: false },
      D: { x: 80, y: 0, h: 0, fixed: false },
    },
    observations: [
      { id: 1, type: 'direction', instCode: 'SX12', stdDev: 1, planned: true, sigmaSource: 'default', setId: 'B-set', sourceLine: 1, at: 'B', to: 'A' },
      { id: 2, type: 'direction', instCode: 'SX12', stdDev: 1, planned: true, sigmaSource: 'default', setId: 'C-set', sourceLine: 5, at: 'C', to: 'A' },
      { id: 3, type: 'direction', instCode: 'SX12', stdDev: 1, planned: true, sigmaSource: 'default', setId: 'D-set', sourceLine: 9, at: 'D', to: 'B' },
      { id: 4, type: 'direction', instCode: 'SX12', stdDev: 1, planned: true, sigmaSource: 'default', setId: 'D-alt', sourceLine: 13, at: 'D', to: 'C' },
    ],
    stationCovariances: [
      { stationId: 'B', cEE: 0.004, cEN: 0, cNN: 0.004, sigmaE: 0.004, sigmaN: 0.004, sigmaH: 0.004, ellipse: { semiMajor: 0.004, semiMinor: 0.003, theta: 0 } },
      { stationId: 'C', cEE: 0.004, cEN: 0, cNN: 0.004, sigmaE: 0.004, sigmaN: 0.004, sigmaH: 0.004, ellipse: { semiMajor: 0.004, semiMinor: 0.003, theta: 0 } },
      { stationId: 'D', cEE: 0.012, cEN: 0, cNN: 0.012, sigmaE: 0.012, sigmaN: 0.012, sigmaH: 0.012, ellipse: { semiMajor: 0.012, semiMinor: 0.006, theta: 0 } },
    ],
    relativeCovariances: [
      { from: 'A', to: 'B', connected: true, connectionTypes: ['direction'], cEE: 0.004, cEN: 0, cNN: 0.004, sigmaE: 0.004, sigmaN: 0.004, sigmaH: 0.004, sigmaDist: 0.004, ellipse: { semiMajor: 0.004, semiMinor: 0.002, theta: 0 } },
      { from: 'A', to: 'C', connected: true, connectionTypes: ['direction'], cEE: 0.004, cEN: 0, cNN: 0.004, sigmaE: 0.004, sigmaN: 0.004, sigmaH: 0.004, sigmaDist: 0.004, ellipse: { semiMajor: 0.004, semiMinor: 0.002, theta: 0 } },
      { from: 'B', to: 'D', connected: true, connectionTypes: ['direction'], cEE: 0.007, cEN: 0, cNN: 0.007, sigmaE: 0.007, sigmaN: 0.007, sigmaH: 0.007, sigmaDist: 0.007, ellipse: { semiMajor: 0.007, semiMinor: 0.003, theta: 0 } },
      { from: 'C', to: 'D', connected: true, connectionTypes: ['direction'], cEE: 0.007, cEN: 0, cNN: 0.007, sigmaE: 0.007, sigmaN: 0.007, sigmaH: 0.007, sigmaDist: 0.007, ellipse: { semiMajor: 0.007, semiMinor: 0.003, theta: 0 } },
    ],
    weakGeometryDiagnostics: {
      enabled: true,
      stationMedianHorizontal: 0.004,
      relativeMedianDistance: 0.005,
      stationCues: [{ stationId: 'D', horizontalMetric: 0.012, severity: 'weak', note: 'weak leaf' }],
      relativeCues: [
        { from: 'B', to: 'D', distanceMetric: 0.007, severity: 'weak', note: 'path one' },
        { from: 'C', to: 'D', distanceMetric: 0.007, severity: 'weak', note: 'path two' },
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

const buildPartiallyFixedChainResult = (): AdjustmentResult => {
  const result = buildChainResult();
  result.stations.C = {
    ...result.stations.C,
    constraintX: 0.01,
  };
  return result;
};

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
    expect(diagnostics.rows[0]?.deltaWorstStationMajor).toBeCloseTo(-0.004);
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
      diagnostics.rows.filter((row) => row.scenarioKind === 'decommission-intermediate').every(
        (row) => row.actionMode === 'advisory',
      ),
    ).toBe(true);
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
      'Additive scenarios are exhausted; only manual advisory network changes remain.',
    );
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
