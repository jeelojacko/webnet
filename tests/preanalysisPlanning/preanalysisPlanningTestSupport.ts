import type { AdjustmentResult } from '../../src/types';
export const pairKey = (from: string, to: string): string => [from, to].sort().join('|');

export const buildResult = (worstMajor: number): AdjustmentResult =>
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

export const buildChainResult = (): AdjustmentResult =>
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

export const buildMultiRouteResult = (): AdjustmentResult =>
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

export const buildPartiallyFixedChainResult = (): AdjustmentResult => {
  const result = buildChainResult();
  result.stations.C = {
    ...result.stations.C,
    constraintX: 0.01,
  };
  return result;
};
