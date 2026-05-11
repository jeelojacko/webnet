import { describe, expect, it } from 'vitest';

import { buildReportObservationSelectorModel } from '../src/components/report/reportObservationSelectors';
import type { SortedObservation } from '../src/engine/resultDerivedModels';

describe('reportObservationSelectors', () => {
  it('builds filtered report observation groups and ranked suspect subsets in one pass', () => {
    const sortedObs: SortedObservation[] = [
      {
        id: 1,
        originalIndex: 0,
        type: 'direction',
        at: 'ST1',
        to: 'P1',
        setId: 'SET-1',
        obs: 1,
        instCode: 'TS',
        stdDev: 1,
        sourceFile: 'alpha.dat',
        sourceLine: 10,
        calc: 1,
        residual: 0.001,
        stdRes: 2.5,
        localTest: { critical: 2, pass: false },
      },
      {
        id: 2,
        originalIndex: 1,
        type: 'dist',
        subtype: 'ts',
        from: 'ST1',
        to: 'P1',
        obs: 20,
        instCode: 'TS',
        stdDev: 0.003,
        sourceLine: 11,
      },
      {
        id: 3,
        originalIndex: 2,
        type: 'gps',
        from: 'G1',
        to: 'G2',
        obs: { dE: 1, dN: 2 },
        instCode: 'GNSS',
        stdDev: 1,
        sourceFile: 'beta.dat',
        sourceLine: 12,
        stdRes: 3.2,
      },
    ];

    const model = buildReportObservationSelectorModel({
      result: {
        observations: sortedObs,
        logs: ['Blunder cycle 1 removed obs 3', 'other log'],
        directionTargetDiagnostics: [
          {
            setId: 'SET-1',
            occupy: 'ST1',
            target: 'P1',
            stdRes: 2.5,
            rawSpreadArcSec: 6,
            rawCount: 2,
            face1Count: 1,
            face2Count: 1,
            faceBalanced: true,
            suspectScore: 10,
          },
        ],
        directionRepeatabilityDiagnostics: [
          {
            occupy: 'ST1',
            target: 'P1',
            setCount: 2,
            localFailCount: 1,
            faceUnbalancedSets: 0,
            suspectScore: 5,
          },
        ],
        traverseDiagnostics: {
          closureCount: 1,
          misclosureE: 0,
          misclosureN: 0,
          misclosureMag: 0,
          totalTraverseDistance: 100,
          thresholds: {
            minClosureRatio: 1,
            maxLinearPpm: 10,
            maxAngularArcSec: 5,
            maxVerticalMisclosure: 0.01,
          },
          loops: [
            {
              key: 'TL-1',
              from: 'A',
              to: 'B',
              misclosureE: 0,
              misclosureN: 0,
              misclosureMag: 0,
              traverseDistance: 100,
              linearPpm: 9,
              severity: 1,
              pass: true,
            },
          ],
        },
        gpsLoopDiagnostics: {
          enabled: true,
          vectorCount: 1,
          loopCount: 1,
          passCount: 0,
          warnCount: 1,
          thresholds: { baseToleranceM: 0.01, ppmTolerance: 5 },
          loops: [
            {
              rank: 1,
              key: 'GL-1',
              stationPath: ['A', 'B'],
              edgeCount: 1,
              sourceLines: [1],
              closureE: 0.1,
              closureN: 0.2,
              closureMag: 0.22,
              loopDistance: 10,
              toleranceM: 0.01,
              severity: 2,
              pass: false,
            },
          ],
        },
        levelingLoopDiagnostics: {
          enabled: true,
          observationCount: 1,
          loopCount: 1,
          passCount: 0,
          warnCount: 1,
          totalLengthKm: 1,
          warnTotalLengthKm: 1,
          thresholds: { baseMm: 1, perSqrtKmMm: 2 },
          loops: [
            {
              rank: 1,
              key: 'LL-1',
              stationPath: ['A', 'B'],
              edgeCount: 1,
              sourceLines: [30],
              closure: 0.01,
              absClosure: 0.01,
              loopLengthKm: 1,
              toleranceMm: 2,
              toleranceM: 0.002,
              closurePerSqrtKmMm: 1,
              severity: 2,
              pass: false,
              segments: [],
            },
          ],
          suspectSegments: [
            {
              rank: 1,
              key: 'SEG-1',
              from: 'A',
              to: 'B',
              sourceLine: 30,
              occurrenceCount: 1,
              warnLoopCount: 1,
              totalLengthKm: 1,
              maxAbsDh: 0.01,
              suspectScore: 1,
              worstLoopSeverity: 2,
              closureLegCount: 0,
            },
          ],
        },
        directionRejectDiagnostics: [
          { setId: 'B', occupy: 'ST1', sourceLine: 20, reason: 'mixed-face', detail: 'B' },
          { setId: 'A', occupy: 'ST1', sourceLine: 15, reason: 'mixed-face', detail: 'A' },
        ],
        parseState: {
          directionSetTreatmentDiagnostics: [
            {
              setId: 'B',
              occupy: 'ST1',
              sourceLine: 22,
              faceSource: 'fallback',
              treatmentDecision: 'normalized',
              policyOutcome: 'accepted',
              faceNormalizationMode: 'on',
              parseCompatibilityMode: 'legacy',
              readingCount: 2,
              targetCount: 1,
              detail: 'B',
            },
            {
              setId: 'A',
              occupy: 'ST1',
              sourceLine: 18,
              faceSource: 'fallback',
              treatmentDecision: 'normalized',
              policyOutcome: 'accepted',
              faceNormalizationMode: 'on',
              parseCompatibilityMode: 'legacy',
              readingCount: 2,
              targetCount: 1,
              detail: 'A',
            },
          ],
        },
      },
      sortedObs,
      excludedIds: new Set<number>([3]),
      reportObservationTypeFilter: 'all',
      reportExclusionFilter: 'included',
      reviewConflictOnly: true,
      reviewAdjustedOnly: true,
      reviewImportedGroupFilter: 'alpha.dat',
      matchesReportQuery: (...parts) => parts.join(' ').includes('direction'),
      isDataCheck: false,
      isBlunderDetect: true,
      unitScale: 1,
      units: 'm',
    });

    expect(model.directionSetCount).toBe(1);
    expect(model.filteredSortedObs.map((obs) => obs.id)).toEqual([1]);
    expect(model.importedGroupOptions).toEqual(['alpha.dat', 'beta.dat']);
    expect(model.observationsByType.get('direction')?.map((obs) => obs.id)).toEqual([1]);
    expect(model.dataCheckDiffRows).toEqual([]);
    expect(model.blunderCycleLines).toEqual(['Blunder cycle 1 removed obs 3']);
    expect(model.blunderFlaggedCount).toBe(1);
    expect(model.topDirectionTargetSuspects).toHaveLength(1);
    expect(model.topDirectionRepeatabilitySuspects).toHaveLength(1);
    expect(model.traverseLoopSuspects).toHaveLength(1);
    expect(model.gpsLoopSuspects).toHaveLength(1);
    expect(model.levelingLoopSuspects).toHaveLength(1);
    expect(model.highlightedLevelingSegmentLines.has(30)).toBe(true);
    expect(model.directionRejects.map((row) => row.setId)).toEqual(['A', 'B']);
    expect(model.directionTreatmentDiagnostics.map((row) => row.setId)).toEqual(['A', 'B']);
  });
});
