import { describe, expect, it } from 'vitest';

import { buildReportWindowedRowsModel } from '../src/components/report/reportWindowedRows';

describe('reportWindowedRows', () => {
  it('reuses one visible-row pass for remaining ReportView windows', () => {
    const calls: string[] = [];
    const visibleRowsFor = <T,>(key: string, rows: T[]) => {
      calls.push(key);
      return rows.slice(0, 1);
    };

    const model = buildReportWindowedRowsModel({
      visibleRowsFor,
      traverseLoopSuspects: [{ key: 't1' }, { key: 't2' }] as any,
      gpsLoopSuspects: [{ key: 'g1' }, { key: 'g2' }] as any,
      levelingLoopSuspects: [{ key: 'l1' }, { key: 'l2' }] as any,
      directionRejects: [{ sourceLine: 1 }, { sourceLine: 2 }] as any,
      filteredStationCovariances: [{ stationId: 'A' }, { stationId: 'B' }] as any,
      filteredRelativeCovariances: [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }] as any,
      filteredRelativePrecision: [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }] as any,
    });

    expect(calls).toEqual([
      'traverse-loop-suspects',
      'gps-loop-suspects',
      'leveling-loop-suspects',
      'direction-reject-diagnostics',
      'station-covariances',
      'relative-covariances',
      'relative-precision',
    ]);
    expect(model.visibleTraverseLoopSuspects).toHaveLength(1);
    expect(model.visibleGpsLoopSuspects).toHaveLength(1);
    expect(model.visibleLevelingLoopSuspects).toHaveLength(1);
    expect(model.visibleDirectionRejects).toHaveLength(1);
    expect(model.visibleStationCovariances).toHaveLength(1);
    expect(model.visibleRelativeCovariances).toHaveLength(1);
    expect(model.visibleRelativePrecision).toHaveLength(1);
  });
});
