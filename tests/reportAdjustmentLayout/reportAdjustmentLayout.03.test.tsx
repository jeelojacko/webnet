import { describe, expect, it } from 'vitest';
import {
  LSAEngine,
  baseInput,
  renderReport,
} from './reportAdjustmentLayoutTestSupport';

describe('ReportView adjustment-layout sections', () => {
  it('keeps ranked suspect summary cards visible while deferring loop suspect tables by default', () => {
    const result = new LSAEngine({ input: baseInput, maxIterations: 8 }).solve();
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
    expect(html).toContain('Traverse Closure Suspects');
    expect(html).toContain('GPS Loop Suspects (ranked)');
    expect(html).toContain('Leveling Loop Suspects (ranked)');
    expect(html).toContain('Leveling Segment Suspects');
    expect(html).toContain('Warn Loops');
    expect(html).toContain('Worst Ratio');
    expect(html).toContain('Worst Severity');
    expect(html).toContain('Suspect Segments');
    expect(html).toContain('Top Score');
    expect(html).toContain('Show');
    expect(html).not.toContain('Path</th>');
    expect(html).not.toContain('Segment</th>');
    expect(html).not.toContain('A-&gt;B-&gt;A');
  });

  it('keeps direction diagnostic summary cards visible while deferring direction detail tables by default', () => {
    const result = new LSAEngine({ input: baseInput, maxIterations: 8 }).solve();
    result.directionSetDiagnostics = [
      {
        setId: 'SET1',
        occupy: 'C',
        readingCount: 4,
        targetCount: 2,
        underconstrainedOrientation: true,
        rawCount: 4,
        reducedCount: 2,
        pairedTargets: 2,
        face1Count: 2,
        face2Count: 2,
        orientationDeg: 90,
        residualRmsArcSec: 1.25,
        residualMaxArcSec: 2.3,
        meanFacePairDeltaArcSec: 0.8,
        maxFacePairDeltaArcSec: 1.6,
        meanRawMaxResidualArcSec: 0.9,
        maxRawMaxResidualArcSec: 1.8,
        orientationSeArcSec: 0.7,
      },
    ] as any;
    result.directionTargetDiagnostics = [
      {
        setId: 'SET1',
        occupy: 'C',
        target: 'B',
        sourceLine: 7,
        rawCount: 2,
        face1Count: 1,
        face2Count: 1,
        rawSpreadArcSec: 2.4,
        rawMaxResidualArcSec: 1.7,
        facePairDeltaArcSec: 1.1,
        face1SpreadArcSec: 0.8,
        face2SpreadArcSec: 0.9,
        reducedSigmaArcSec: 1.2,
        residualArcSec: 0.7,
        stdRes: 2.1,
        localPass: false,
        mdbArcSec: 3.4,
        suspectScore: 4.6,
      },
    ] as any;
    result.parseState = {
      ...(result.parseState ?? {}),
      directionSetTreatmentDiagnostics: [
        {
          setId: 'SET1',
          occupy: 'C',
          sourceLine: 7,
          readingCount: 4,
          targetCount: 2,
          faceSource: 'unknown',
          treatmentDecision: 'reduced',
          policyOutcome: 'keep',
          faceNormalizationMode: 'paired',
        },
      ],
    } as any;
    result.directionRejectDiagnostics = [
      {
        setId: 'SET1',
        occupy: 'C',
        target: 'B',
        sourceLine: 8,
        recordType: 'DN',
        expectedFace: 'F1',
        actualFace: 'F2',
        faceSource: 'computed',
        treatmentDecision: 'reject',
        policyOutcome: 'drop',
        detail: 'face mismatch',
      },
    ] as any;
    result.directionRepeatabilityDiagnostics = [
      {
        occupy: 'C',
        target: 'B',
        setCount: 2,
        localFailCount: 1,
        faceUnbalancedSets: 1,
        residualMeanArcSec: 0.4,
        residualRmsArcSec: 0.7,
        residualRangeArcSec: 2.8,
        residualMaxArcSec: 1.9,
        stdResRms: 1.6,
        maxStdRes: 2.7,
        meanRawSpreadArcSec: 1.2,
        maxRawSpreadArcSec: 3.1,
        worstSetId: 'SET1',
        worstLine: 7,
        suspectScore: 5.1,
      },
    ] as any;

    const html = renderReport(result);
    expect(html).toContain('Direction Set Diagnostics');
    expect(html).toContain('Direction Target Repeatability (ranked)');
    expect(html).toContain('Direction Face Treatment Diagnostics');
    expect(html).toContain('Direction Reject Diagnostics');
    expect(html).toContain('Direction Target Suspects (top)');
    expect(html).toContain('Direction Repeatability By Occupy-Target (multi-set)');
    expect(html).toContain('Direction Repeatability Suspects (top)');
    expect(html).toContain('Underconstrained');
    expect(html).toContain('Unknown FaceSrc');
    expect(html).toContain('Top Reason');
    expect(html).toContain('Worst Max |t|');
    expect(html).toContain('Show');
    expect(html).not.toContain('Readings</th>');
    expect(html).not.toContain('FaceSrc</th>');
    expect(html).not.toContain('Expected</th>');
    expect(html).not.toContain('Res Mean (&quot;)</th>');
    expect(html).not.toContain('Stations</th>');

    const faceTreatmentIndex = html.indexOf('Direction Face Treatment Diagnostics');
    const processingLogIndex = html.indexOf('Processing Log');
    const multiSetIndex = html.indexOf('Direction Repeatability By Occupy-Target (multi-set)');
    expect(faceTreatmentIndex).toBeGreaterThan(multiSetIndex);
    expect(processingLogIndex).toBeGreaterThan(faceTreatmentIndex);
  });

  it('keeps robust-comparison and observation summary cards visible while deferring their detail tables by default', () => {
    const multiUnknownInput = [
      '.2D',
      'C A 0 0 0 ! !',
      'C B 100 0 0 ! !',
      'C C 60 80 0',
      'C D 140 90 0',
      'D A-C 100.0000 0.005',
      'D B-C 89.4427 0.005',
      'D A-D 166.4332 0.005',
      'D B-D 98.4886 0.005',
      'D C-D 80.6226 0.005',
    ].join('\n');
    const result = new LSAEngine({ input: multiUnknownInput, maxIterations: 8 }).solve();
    result.robustComparison = {
      enabled: true,
      overlapCount: 1,
      classicalTop: [
        {
          rank: 1,
          obsId: 1,
          type: 'dist',
          stations: 'A-C',
          sourceLine: 5,
          stdRes: 2.8,
          localFail: true,
        },
      ],
      robustTop: [
        {
          rank: 1,
          obsId: 2,
          type: 'angle',
          stations: 'C-A-B',
          sourceLine: 7,
          stdRes: 2.1,
          localFail: false,
        },
      ],
    } as any;

    const html = renderReport(result);
    expect(html).toContain('Robust vs Classical Suspects (Top 10)');
    expect(html).toContain('Per-Type Summary');
    expect(html).toContain('Relative Precision (Unknowns)');
    expect(html).toContain('Classical Top');
    expect(html).toContain('Robust Top');
    expect(html).toContain('Types');
    expect(html).toContain('Pairs');
    expect(html).toContain('Top Ellipse Az');
    expect(html).toContain('Show');
    expect(html).not.toContain('Overlap:');
    expect(html).not.toContain('Unit</th>');
    expect(html).not.toContain('σAz (&quot;)</th>');
  });

});
