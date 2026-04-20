import { describe, expect, it } from 'vitest';
import { buildReviewQueue } from '../src/engine/reviewQueue';

describe('reviewQueue', () => {
  it('derives and sorts mixed queue items deterministically', () => {
    const result = {
      observations: [
        { id: 8, type: 'dist', stdRes: 3.2, sourceLine: 20, sourceFile: 'import-a.dat' },
        { id: 3, type: 'angle', stdRes: 4.8, sourceLine: 12, sourceFile: 'main.dat' },
      ],
      clusterDiagnostics: {
        candidates: [
          {
            key: 'cluster-1',
            representativeId: 'P100',
            memberCount: 2,
            maxSeparation: 0.08,
          },
        ],
      },
    } as any;

    const queue = buildReviewQueue({
      result,
      excludedIds: new Set<number>([8]),
      clusterReviewDecisions: {
        'cluster-1': { status: 'pending', canonicalId: 'P100' },
      },
      comparisonSummary: {
        residualChanges: [
          {
            observationId: 3,
            stationsLabel: 'A-B',
            sourceLine: 12,
            deltaAbsStdRes: 1.25,
          },
        ],
        movedStations: [
          {
            stationId: 'P100',
            currentSourceLine: 33,
            deltaHorizontal: 0.012,
          },
        ],
      } as any,
      importConflicts: [
        {
          id: 'c-1',
          type: 'station-id-collision',
          title: 'Station ID collision',
          targetLabel: 'P100',
          resolutionKey: 'control:P100',
          incomingSourceName: 'import-a.dat',
        },
      ] as any,
      conflictResolutions: { 'control:P100': 'rename-incoming' },
      conflictRenameValues: { 'control:P100': 'P100_IMP' },
    });

    expect(queue.length).toBeGreaterThanOrEqual(5);
    expect(queue[0]?.sourceType).toBe('import-conflict');
    expect(queue.some((item) => item.sourceType === 'suspect-observation' && item.resolved)).toBe(
      true,
    );
    expect(queue.some((item) => item.sourceType === 'cluster-candidate' && !item.resolved)).toBe(
      true,
    );
  });
});

