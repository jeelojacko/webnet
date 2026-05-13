import { describe, expect, it } from 'vitest';

import { buildReportSummarySelectorModel } from '../src/components/report/reportSummarySelectors';

describe('reportSummarySelectors', () => {
  it('builds compact summary counts and top rows for remaining ReportView cards', () => {
    const model = buildReportSummarySelectorModel({
      sortedObs: [
        { id: 1, stdRes: -2.5 },
        { id: 2, stdRes: 1.2 },
      ] as any,
      suspectImpactDiagnostics: [
        { obsId: 1, status: 'ok', baseStdRes: -2.25 },
        { obsId: 2, status: 'excluded', baseStdRes: 1.5 },
      ] as any,
      excludedIds: new Set<number>([2]),
      setupDiagnostics: [
        {
          localFailCount: 2,
          maxStdRes: -3.1,
          directionObsCount: 1,
          angleObsCount: 2,
          distanceObsCount: 3,
          zenithObsCount: 4,
          levelingObsCount: 5,
          gpsObsCount: 6,
        },
      ] as any,
      typeSummary: {
        angle: { count: 2, rms: 1, maxAbs: 2, maxStdRes: 3, over3: 1, over4: 0, unit: '"' },
        dist: { count: 5, rms: 2, maxAbs: 4, maxStdRes: 5, over3: 2, over4: 1, unit: 'm' },
      } as any,
      filteredStationCovariances: [{ stationId: 'A', cEE: 1, cEN: 2, cNN: 3, cHH: 4 }] as any,
      filteredRelativeCovariances: [
        { from: 'A', to: 'B', sigmaDist: 0.1, cEE: 5, cEN: 6, cNN: 7 },
      ] as any,
      filteredRelativePrecision: [
        { from: 'A', to: 'B', sigmaDist: 0.1, ellipse: { theta: 0 } },
      ] as any,
      gpsOffsetObservations: [{ id: 9, from: 'A', to: 'R1' }] as any,
    });

    expect(model.maxAbsStdRes).toBe(2.5);
    expect(model.suspectImpactActionableCount).toBe(1);
    expect(model.suspectImpactExcludedCount).toBe(1);
    expect(model.suspectImpactWorstBaseStdRes).toBe(2.25);
    expect(model.setupLocalFailCount).toBe(2);
    expect(model.setupWorstStdRes).toBe(3.1);
    expect(model.setupObsCount).toBe(21);
    expect(model.typeSummaryEntries.map(([key]) => key)).toEqual(['angle', 'dist']);
    expect(model.typeSummaryObsCount).toBe(7);
    expect(model.topTypeSummaryEntry?.[0]).toBe('dist');
    expect(model.topStationCovarianceRow?.stationId).toBe('A');
    expect(model.topRelativeCovarianceRow?.from).toBe('A');
    expect(model.topRelativePrecisionRow?.to).toBe('B');
    expect(model.topGpsOffsetObservation?.id).toBe(9);
  });
});
