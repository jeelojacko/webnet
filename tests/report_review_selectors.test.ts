import { describe, expect, it } from 'vitest';

import { buildReportReviewSelectorModel } from '../src/components/report/reportReviewSelectors';
import type { AdjustmentResult, ClusterApprovedMerge } from '../src/types';

describe('reportReviewSelectors', () => {
  it('builds traceability, cluster-review, and sideshot review subsets together', () => {
    const activeClusterApprovedMerges: ClusterApprovedMerge[] = [
      { aliasId: 'A2', canonicalId: 'A1' },
    ];

    const model = buildReportReviewSelectorModel({
      parseState: {
        aliasTrace: [
          {
            sourceId: 'RAW-A2',
            canonicalId: 'A2',
            sourceLine: 5,
            context: 'station',
            detail: 'explicit',
          },
        ],
        descriptionTrace: [
          { stationId: 'A1', description: 'Alpha', sourceLine: 8, recordType: 'C' },
          { stationId: 'A1', description: 'Alpha Prime', sourceLine: 12, recordType: 'C' },
        ],
        descriptionScanSummary: [
          {
            stationId: 'A1',
            recordCount: 2,
            uniqueCount: 2,
            conflict: true,
            descriptions: ['Alpha', 'Alpha Prime'],
            sourceLines: [8, 12],
          },
        ],
        descriptionRepeatedStationCount: 1,
        descriptionConflictCount: 1,
        descriptionReconcileMode: 'append',
        descriptionAppendDelimiter: ' / ',
        reconciledDescriptions: { A1: 'Alpha / Alpha Prime' },
        lostStationIds: ['L2', 'L10'],
      } as unknown as NonNullable<AdjustmentResult['parseState']>,
      clusterDiagnostics: {
        enabled: true,
        passMode: 'dual-pass',
        linkageMode: 'single',
        dimension: '2D',
        tolerance: 0.05,
        pairCount: 1,
        candidateCount: 2,
        candidates: [
          {
            key: 'cluster-a',
            representativeId: 'A1',
            stationIds: ['A1', 'A2', 'A3'],
            memberCount: 3,
            hasFixed: false,
            hasUnknown: true,
            centroidE: 0,
            centroidN: 0,
            maxSeparation: 0.01,
            meanSeparation: 0.005,
            pairs: [{ from: 'A1', to: 'A2', separation: 0.01 }],
          },
          {
            key: 'cluster-b',
            representativeId: 'B1',
            stationIds: ['B1', 'B2'],
            memberCount: 2,
            hasFixed: true,
            hasUnknown: false,
            centroidE: 10,
            centroidN: 10,
            maxSeparation: 0.02,
            meanSeparation: 0.02,
            pairs: [{ from: 'B1', to: 'B2', separation: 0.02 }],
          },
        ],
        mergeOutcomes: [
          {
            aliasId: 'A2',
            canonicalId: 'A1',
            deltaE: 0.01,
            deltaN: 0.02,
          },
        ],
        rejectedProposals: [
          {
            key: 'cluster-b',
            representativeId: 'B1',
            stationIds: ['B1', 'B2'],
            memberCount: 2,
            reason: 'operator-rejected',
          },
        ],
      },
      activeClusterApprovedMerges,
      clusterReviewDecisions: {
        'cluster-a': { status: 'approve', canonicalId: 'A3' },
        'cluster-b': { status: 'reject', canonicalId: 'B9' },
      },
      autoSideshotDiagnostics: {
        enabled: true,
        threshold: 0.25,
        evaluatedCount: 3,
        excludedControlCount: 0,
        candidateCount: 2,
        candidates: [
          {
            occupy: 'ST1',
            backsight: 'BS1',
            target: 'T1',
            angleObsId: 11,
            distObsId: 12,
            angleRedundancy: 0,
            distRedundancy: 0,
            minRedundancy: 0,
            maxAbsStdRes: 2.2,
          },
          {
            occupy: 'ST2',
            backsight: 'BS2',
            target: 'T2',
            angleObsId: 21,
            distObsId: 22,
            angleRedundancy: 0,
            distRedundancy: 0,
            minRedundancy: 0,
            maxAbsStdRes: 2.8,
          },
        ],
      },
      sideshots: [
        {
          id: 'ss-1',
          from: 'ST1',
          to: 'T1',
          mode: 'slope',
          hasAzimuth: true,
          distance: 10,
          horizDistance: 9.9,
        },
        {
          id: 'gps-v',
          from: 'G1',
          to: 'G2',
          mode: 'gps',
          sourceType: 'G',
          hasAzimuth: true,
          distance: 5,
          horizDistance: 5,
        },
        {
          id: 'gps-c',
          from: 'G2',
          to: 'G3',
          mode: 'gps',
          sourceType: 'GS',
          hasAzimuth: false,
          distance: 2,
          horizDistance: 2,
        },
      ],
      observations: [
        {
          id: 11,
          type: 'direction',
          at: 'ST1',
          to: 'T1',
          setId: 'SET-1',
          obs: 1,
          instCode: 'TS',
          stdDev: 1,
        },
        {
          id: 31,
          type: 'gps',
          from: 'G1',
          to: 'G2',
          obs: { dE: 1, dN: 2 },
          instCode: 'GNSS',
          stdDev: 1,
          gpsOffsetDistanceM: 0.25,
        },
        {
          id: 32,
          type: 'gps',
          from: 'G2',
          to: 'G3',
          obs: { dE: 3, dN: 4 },
          instCode: 'GNSS',
          stdDev: 1,
        },
      ],
    });

    expect(model.aliasTrace).toHaveLength(1);
    expect(model.descriptionConflicts.map((row) => row.stationId)).toEqual(['A1']);
    expect(model.descriptionRefsByStation.get('A1')).toEqual([
      { key: 'ALPHA', description: 'Alpha', lines: [8] },
      { key: 'ALPHA PRIME', description: 'Alpha Prime', lines: [12] },
    ]);
    expect(model.lostStationIds).toEqual(['L2', 'L10']);
    expect(model.reconciledDescriptions.A1).toBe('Alpha / Alpha Prime');

    expect(model.clusterCandidates.map((row) => row.key)).toEqual(['cluster-a', 'cluster-b']);
    expect(model.clusterAppliedMerges).toEqual(activeClusterApprovedMerges);
    expect(model.clusterMergeOutcomes).toHaveLength(1);
    expect(model.clusterRejectedProposals).toHaveLength(1);
    expect(model.clusterReviewStats).toEqual({
      approved: 1,
      rejected: 1,
      pending: 0,
      plannedMerges: 2,
    });

    expect([...model.autoSideshotObsIds]).toEqual([11, 12, 21, 22]);
    expect(model.tsSideshots.map((row) => row.id)).toEqual(['ss-1']);
    expect(model.gpsSideshots.map((row) => row.id)).toEqual(['gps-v', 'gps-c']);
    expect(model.gpsVectorSideshots.map((row) => row.id)).toEqual(['gps-v']);
    expect(model.gpsCoordinateSideshots.map((row) => row.id)).toEqual(['gps-c']);
    expect(model.gpsOffsetObservations.map((row) => row.id)).toEqual([31]);
  });
});
