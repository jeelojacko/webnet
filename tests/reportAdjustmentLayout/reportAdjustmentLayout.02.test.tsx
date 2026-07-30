import { describe, expect, it } from 'vitest';
import {
  LSAEngine,
  baseInput,
  renderReport,
} from './reportAdjustmentLayoutTestSupport';

describe('ReportView adjustment-layout sections', () => {
  it('keeps suspect-impact and setup summary cards visible while deferring their detail tables by default', () => {
    const result = new LSAEngine({ input: baseInput, maxIterations: 8 }).solve();
    result.suspectImpactDiagnostics = [
      {
        obsId: 1,
        type: 'dist',
        stations: 'A-C',
        sourceLine: 5,
        baseStdRes: 2.4,
        deltaSeuw: -0.01,
        deltaMaxStdRes: -0.2,
        chiDelta: 'PASS->PASS',
        maxCoordShift: 0.001,
        score: 1.2,
        status: 'ok',
      },
      {
        obsId: 2,
        type: 'angle',
        stations: 'C-A-B',
        sourceLine: 7,
        baseStdRes: 1.8,
        deltaSeuw: 0,
        deltaMaxStdRes: 0,
        chiDelta: 'PASS->PASS',
        maxCoordShift: 0,
        score: 0.5,
        status: 'excluded',
      },
    ] as any;
    result.setupDiagnostics = [
      {
        station: 'C',
        directionSetCount: 1,
        directionObsCount: 2,
        angleObsCount: 1,
        distanceObsCount: 2,
        zenithObsCount: 0,
        levelingObsCount: 0,
        gpsObsCount: 0,
        traverseDistance: 120,
        orientationRmsArcSec: 1.2,
        orientationSeArcSec: 0.8,
        rmsStdRes: 1.1,
        maxStdRes: 2.2,
        localFailCount: 1,
        worstObsType: 'dist',
        worstObsStations: 'A-C',
        worstObsLine: 5,
      },
    ] as any;

    const html = renderReport(result);
    expect(html).toContain('Suspect Impact Analysis (what-if exclusion)');
    expect(html).toContain('Setup Diagnostics');
    expect(html).toContain('Candidates');
    expect(html).toContain('Actionable');
    expect(html).toContain('Excluded');
    expect(html).toContain('Setups');
    expect(html).toContain('Worst Max |t|');
    expect(html).toContain('Show');
    expect(html).not.toContain('dSEUW');
    expect(html).not.toContain('Dir Sets');
    expect(html).not.toContain('Orient RMS');
  });

  it('keeps diagnostics summary cards visible while deferring residual, robust, correlation, and loop detail tables by default', () => {
    const result = new LSAEngine({ input: baseInput, maxIterations: 8 }).solve();
    result.residualDiagnostics = {
      observationCount: 6,
      withStdResCount: 5,
      over2SigmaCount: 1,
      over3SigmaCount: 0,
      over4SigmaCount: 0,
      localFailCount: 1,
      lowRedundancyCount: 1,
      veryLowRedundancyCount: 0,
      meanRedundancy: 0.42,
      minRedundancy: 0.11,
      maxStdRes: 2.44,
      criticalT: 3,
      worst: {
        obsId: 9,
        type: 'dist',
        stations: 'A-C',
        sourceLine: 5,
        stdRes: 2.44,
        localFail: true,
        redundancy: 0.11,
      },
      byType: [
        {
          type: 'zenith',
          count: 2,
          withStdResCount: 2,
          localFailCount: 0,
          over3SigmaCount: 0,
          maxStdRes: 1.11,
          meanRedundancy: 0.51,
          minRedundancy: 0.32,
        },
      ],
    } as any;
    result.robustDiagnostics = {
      enabled: true,
      mode: 'huber',
      k: 1.5,
      iterations: [
        {
          iteration: 1,
          downweightedRows: 2,
          meanWeight: 0.91,
          minWeight: 0.5,
          maxNorm: 2.7,
          maxWeightDelta: 0.21,
        },
      ],
      topDownweightedRows: [
        {
          obsId: 9,
          type: 'dist',
          stations: 'A-C',
          sourceLine: 5,
          weight: 0.5,
          norm: 2.7,
        },
      ],
    } as any;
    result.tsCorrelationDiagnostics = {
      enabled: true,
      scope: 'setup',
      rho: 0.25,
      groupCount: 1,
      equationCount: 4,
      pairCount: 2,
      maxGroupSize: 2,
      meanAbsOffDiagWeight: 0.00123,
      groups: [
        {
          key: 'setup-1',
          station: 'A',
          setId: 'SET1',
          rows: 2,
          pairCount: 1,
          meanAbsOffDiagWeight: 0.00123,
        },
      ],
    } as any;
    result.traverseDiagnostics = {
      closureCount: 1,
      misclosureE: 0.01,
      misclosureN: 0.02,
      misclosureMag: 0.02236,
      totalTraverseDistance: 120,
      closureRatio: 12000,
      linearPpm: 83.3,
      angularMisclosureArcSec: 4.2,
      verticalMisclosure: 0.003,
      thresholds: {
        minClosureRatio: 8000,
        maxLinearPpm: 150,
        maxAngularArcSec: 10,
        maxVerticalMisclosure: 0.01,
      },
      passes: {
        overall: false,
      },
      loops: [
        {
          key: 'TRAV-LOOP-1',
          misclosureMag: 0.02236,
          traverseDistance: 120,
          closureRatio: 12000,
          linearPpm: 83.3,
          angularMisclosureArcSec: 4.2,
          verticalMisclosure: 0.003,
          severity: 1.2,
          pass: false,
        },
      ],
    } as any;
    result.gpsLoopDiagnostics = {
      enabled: true,
      vectorCount: 3,
      loopCount: 1,
      passCount: 0,
      warnCount: 1,
      thresholds: {
        baseToleranceM: 0.01,
        ppmTolerance: 5,
      },
      loops: [
        {
          rank: 1,
          key: 'GPS-LOOP-1',
          stationPath: ['A', 'B', 'A'],
          closureMag: 0.025,
          toleranceM: 0.015,
          linearPpm: 12.3,
          closureRatio: 8000,
          severity: 1.8,
          pass: false,
          sourceLines: [10, 11],
        },
      ],
    } as any;
    result.levelingLoopDiagnostics = {
      enabled: true,
      observationCount: 4,
      loopCount: 1,
      passCount: 0,
      warnCount: 1,
      totalLengthKm: 0.4,
      warnTotalLengthKm: 0.4,
      worstClosure: 0.006,
      worstClosurePerSqrtKmMm: 8.5,
      worstLoopKey: 'LL-1-A',
      thresholds: {
        baseMm: 2,
        perSqrtKmMm: 4,
      },
      suspectSegments: [
        {
          rank: 1,
          key: 'A-B',
          from: 'A',
          to: 'B',
          sourceLine: 12,
          warnLoopCount: 1,
          suspectScore: 2.2,
          maxAbsDh: 0.004,
          worstLoopKey: 'LL-1-A',
        },
      ],
      loops: [
        {
          rank: 1,
          key: 'LL-1-A',
          stationPath: ['A', 'B', 'A'],
          closure: 0.006,
          absClosure: 0.006,
          loopLengthKm: 0.4,
          toleranceMm: 4.53,
          closurePerSqrtKmMm: 8.5,
          pass: false,
          sourceLines: [12, 13],
          segments: [
            {
              from: 'A',
              to: 'B',
              observedDh: 0.004,
              lengthKm: 0.2,
              sourceLine: 12,
              closureLeg: false,
            },
          ],
        },
      ],
    } as any;

    const html = renderReport(result);
    expect(html).toContain('Residual Diagnostics');
    expect(html).toContain('Robust Diagnostics');
    expect(html).toContain('TS Correlation Diagnostics');
    expect(html).toContain('Traverse Diagnostics');
    expect(html).toContain('GPS Loop Diagnostics');
    expect(html).toContain('Leveling Loop Diagnostics');
    expect(html).toContain('With StdRes');
    expect(html).toContain('Iterations');
    expect(html).toContain('Scope');
    expect(html).toContain('Closure Count');
    expect(html).toContain('Vectors');
    expect(html).toContain('Observations');
    expect(html).toContain('Show');
    expect(html).not.toContain('ZENITH');
    expect(html).not.toContain('Mean Weight');
    expect(html).not.toContain('setup-1');
    expect(html).not.toContain('A-&gt;B-&gt;A');
  });

});
