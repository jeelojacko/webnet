import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../src/engine/adjust';
import { buildQaDerivedResult } from '../src/engine/qaWorkflow';
import {
  buildDataCheckDiffRows,
  buildMapLinkByPairKey,
  buildObservationMapLinks,
  buildResultStatisticalSummaryModel,
  buildResultTraceabilityModel,
  buildStationIdLookup,
  buildVisibleStationIds,
  buildWeakStationSeverityLookup,
  groupSortedObservationsByType,
  resolveSelectedObservationPairKey,
  resolveStationIdToken,
  sortObservationsByStdRes,
} from '../src/engine/resultDerivedModels';

const buildResult = (input: string) => new LSAEngine({ input, maxIterations: 8 }).solve();

describe('resultDerivedModels helpers', () => {
  it('sorts and groups observations for report-facing consumers', () => {
    const result = buildResult(
      [
        '.2D',
        'C A 0 0 0 ! !',
        'C B 100 0 0 ! !',
        'C P 60 40 0',
        'D A-P 72.1110255 0.005',
        'D B-P 56.5685425 0.005',
        'A P-A-B 90-00-00 3',
      ].join('\n'),
    );

    result.observations[0].stdRes = 0.5;
    result.observations[1].stdRes = 2.75;
    result.observations[2].stdRes = 1.2;

    const sorted = sortObservationsByStdRes(result.observations);
    const grouped = groupSortedObservationsByType(sorted);

    expect(sorted[0]?.id).toBe(result.observations[1]?.id);
    expect(grouped.get('dist')).toHaveLength(2);
    expect(grouped.get('angle')).toHaveLength(1);
  });

  it('builds deterministic data-check rows and statistical-summary fallbacks', () => {
    const result = buildResult(
      [
        '.2D',
        'C A 0 0 0 ! !',
        'C B 100 0 0 ! !',
        'C P 50 40 0',
        'D A-P 64.0312424 0.005',
        'D B-P 64.0312424 0.005',
        'A P-A-B 102-40-30 3',
      ].join('\n'),
    );

    result.statisticalSummary = undefined;
    result.observations[0].residual = 0.0042;
    result.observations[0].stdRes = 0.9;
    result.observations[1].residual = 0.0018;
    result.observations[1].stdRes = 1.3;
    result.observations[2].residual = (8 / 3600) * (Math.PI / 180);
    result.observations[2].stdRes = 2.1;

    const dataCheckRows = buildDataCheckDiffRows(result.observations, {
      unitScale: 1,
      linearUnitLabel: 'm',
      linearUnitSpacer: ' ',
      limit: 10,
    });
    const statisticalSummary = buildResultStatisticalSummaryModel(result, 'ui');

    expect(dataCheckRows[0]?.obs.type).toBe('angle');
    expect(dataCheckRows[0]?.diffLabel).toBe('8.00"');
    expect(dataCheckRows.some((row) => row.diffLabel.endsWith(' m'))).toBe(true);
    expect(statisticalSummary.rows.map((row) => row.label)).toEqual(['Angles', 'Distances']);
    expect(statisticalSummary.totalCount).toBe(3);
  });

  it('normalizes traceability lookups for report and listing consumers', () => {
    const result = buildResult(
      [
        '.2D',
        'C A 0 0 0 ! !',
        'C B 100 0 0 ! !',
        'D A-B 100 0.01',
      ].join('\n'),
    );

    result.parseState = {
      ...(result.parseState ?? {}),
      aliasTrace: [
        { sourceId: 'Z2', canonicalId: 'B', sourceLine: 12, context: 'observation' },
        { sourceId: 'A1', canonicalId: 'A', sourceLine: 5, context: 'station' },
      ],
      descriptionTrace: [
        { stationId: 'B', sourceLine: 20, recordType: 'C', description: 'Base 2' },
        { stationId: 'A', sourceLine: 8, recordType: 'C', description: 'Alpha' },
        { stationId: 'B', sourceLine: 18, recordType: 'C', description: 'Base 2' },
      ],
      descriptionScanSummary: [
        {
          stationId: 'B',
          recordCount: 2,
          uniqueCount: 1,
          conflict: false,
          descriptions: ['Base 2'],
          sourceLines: [18, 20],
        },
        {
          stationId: 'A',
          recordCount: 1,
          uniqueCount: 1,
          conflict: false,
          descriptions: ['Alpha'],
          sourceLines: [8],
        },
      ],
      descriptionRepeatedStationCount: 1,
      descriptionConflictCount: 0,
      descriptionReconcileMode: 'append',
      descriptionAppendDelimiter: ' / ',
      reconciledDescriptions: { A: 'Alpha', B: 'Base 2' },
      lostStationIds: ['B10', 'B2'],
    } as NonNullable<typeof result.parseState>;

    const traceability = buildResultTraceabilityModel(result.parseState);

    expect(traceability.aliasTrace.map((entry) => entry.sourceId)).toEqual(['A1', 'Z2']);
    expect(traceability.descriptionTrace.map((entry) => entry.sourceLine)).toEqual([8, 18, 20]);
    expect(traceability.lostStationIds).toEqual(['B2', 'B10']);
    expect(traceability.descriptionRepeatedStationCount).toBe(1);
    expect(traceability.descriptionAppendDelimiter).toBe(' / ');
    expect(traceability.descriptionRefsByStation.get('B')).toEqual([
      { key: 'BASE 2', description: 'Base 2', lines: [18, 20] },
    ]);
  });

  it('builds shared map selectors for station visibility and pair lookups', () => {
    const result = buildResult(
      [
        '.2D',
        'C A 0 0 0 ! !',
        'C B 100 0 0 ! !',
        'C P 60 40 0',
        'D A-P 72.1110255 0.005',
        'D B-P 56.5685425 0.005',
        'A P-A-B 90-00-00 3',
      ].join('\n'),
    );

    result.stations.B.lost = true;
    result.weakGeometryDiagnostics = {
      enabled: true,
      stationMedianHorizontal: 0.01,
      stationCues: [
        { stationId: 'P', severity: 'weak', horizontalMetric: 0.08, note: 'weak station' },
      ],
      relativeCues: [],
    };

    const derived = buildQaDerivedResult(result);
    const visibleStationIds = buildVisibleStationIds(result.stations, false);
    const stationLookup = buildStationIdLookup(visibleStationIds);
    const weakStationSeverity = buildWeakStationSeverityLookup(result.weakGeometryDiagnostics);
    const fallbackMapLinks = buildObservationMapLinks(result.observations);
    const mapLinkByPairKey = buildMapLinkByPairKey(fallbackMapLinks);
    const selectedObservationId = result.observations.find((obs) => obs.type === 'dist')?.id ?? null;

    expect(visibleStationIds).toEqual(['A', 'P']);
    expect(resolveStationIdToken(stationLookup, 'p')).toBe('P');
    expect(weakStationSeverity.get('P')).toBe('weak');
    expect(fallbackMapLinks).toHaveLength(2);
    expect(mapLinkByPairKey.get('A|P')?.observationId).toBe(result.observations[0]?.id);
    expect(resolveSelectedObservationPairKey(derived.observationById, selectedObservationId)).toBe(
      'A|P',
    );
  });
});
