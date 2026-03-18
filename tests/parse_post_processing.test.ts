import { describe, expect, it } from 'vitest';

import { finalizeParsePostProcessing } from '../src/engine/parsePostProcessing';
import type {
  AliasTraceEntry,
  DirectionRejectDiagnostic,
  Observation,
  ParseOptions,
  StationMap,
  StationId,
} from '../src/types';

const createState = (): ParseOptions =>
  ({
    units: 'm',
    coordMode: '3D',
    order: 'EN',
    deltaMode: 'slope',
    mapMode: 'off',
    normalize: true,
  }) as ParseOptions;

const applyFixities = (
  station: StationMap[string],
  fix: { x?: boolean; y?: boolean; h?: boolean },
  coordMode: ParseOptions['coordMode'],
) => {
  if (fix.x != null) station.fixedX = fix.x;
  if (fix.y != null) station.fixedY = fix.y;
  if (fix.h != null) station.fixedH = fix.h;
  station.fixed =
    coordMode === '2D'
      ? Boolean(station.fixedX && station.fixedY)
      : Boolean(station.fixedX && station.fixedY && station.fixedH);
};

describe('parsePostProcessing', () => {
  it('canonicalizes aliases across stations, observations, rejects, and lost-station state', () => {
    const stations: StationMap = {
      CAN: { x: 10, y: 20, h: 30, fixed: false, fixedX: false, fixedY: false, fixedH: false },
      ALIAS: { x: 0, y: 0, h: 0, fixed: false, fixedX: false, fixedY: false, fixedH: false },
      P2: { x: 1, y: 2, h: 3, fixed: false, fixedX: false, fixedY: false, fixedH: false },
    };
    const observations: Observation[] = [
      {
        id: 1,
        type: 'dist',
        subtype: 'ts',
        from: 'ALIAS',
        to: 'P2',
        obs: 5,
        stdDev: 1,
        instCode: 'S9',
      },
    ] as Observation[];
    const aliasTraceEntries: AliasTraceEntry[] = [];
    const directionRejectDiagnostics: DirectionRejectDiagnostic[] = [
      {
        setId: 'SET1',
        occupy: 'ALIAS',
        target: 'TGT_ALIAS',
        reason: 'mixed-face',
        detail: 'detail',
      },
    ];
    const state = createState();
    state.gpsTopoShots = [{ pointId: 'ALIAS', east: 1, north: 2, sourceLine: 9, fromId: 'P2' }];
    const logs: string[] = [];
    const aliasMap = new Map<StationId, { canonicalId: StationId; reference?: string }>([
      ['ALIAS', { canonicalId: 'CAN', reference: 'explicit:1' }],
      ['TGT_ALIAS', { canonicalId: 'TGT', reference: 'explicit:2' }],
    ]);

    const result = finalizeParsePostProcessing({
      stations,
      observations,
      state,
      logs,
      resolveAlias: (id) => aliasMap.get(id) ?? { canonicalId: id },
      addAliasTrace: (sourceId, canonicalId, context, sourceLine, detail, reference) => {
        aliasTraceEntries.push({ sourceId, canonicalId, context, sourceLine, detail, reference });
      },
      applyFixities,
      lostStationIds: new Set(['ALIAS']),
      explicitAliasCount: 1,
      aliasRuleCount: 0,
      directionRejectDiagnostics,
      aliasTraceEntries,
      descriptionTraceEntries: [],
      orderExplicit: true,
      preanalysisMode: false,
      compatibilityMode: 'legacy',
      compatibilityAcceptedNoOps: new Set(),
      compatibilityDiagnostics: [],
      ambiguousCount: 0,
      legacyFallbackCount: 0,
      strictRejectCount: 0,
      rewriteSuggestionCount: 0,
      directiveTransitions: [],
      directiveNoEffectWarnings: [],
      inputLines: [],
      splitInlineCommentAndDescription: (line) => ({ line }),
      directionSetTreatmentDiagnostics: [],
      defaultDescriptionReconcileMode: 'first',
      defaultDescriptionAppendDelimiter: ' | ',
    });

    expect(stations.CAN.lost).toBe(true);
    expect(stations.ALIAS).toBeUndefined();
    expect((observations[0] as Extract<Observation, { from: StationId }>).from).toBe('CAN');
    expect(state.gpsTopoShots?.[0]).toMatchObject({ pointId: 'CAN', fromId: 'P2' });
    expect(directionRejectDiagnostics[0]).toMatchObject({ occupy: 'CAN', target: 'TGT' });
    expect(state.lostStationIds).toEqual(['CAN']);
    expect(state.aliasTrace?.some((row) => row.sourceId === 'ALIAS' && row.canonicalId === 'CAN')).toBe(
      true,
    );
    expect(result.unknowns).toEqual(expect.arrayContaining(['CAN', 'P2']));
    expect(logs.some((line) => line.includes('Alias canonicalization applied'))).toBe(true);
    expect(logs.some((line) => line.includes('Lost stations flagged: CAN'))).toBe(true);
  });

  it('reconciles descriptions and finalizes parse-state summaries and logs', () => {
    const stations: StationMap = {
      S1: { x: 0, y: 0, h: 0, fixed: true, fixedX: true, fixedY: true, fixedH: true },
      S2: { x: 1, y: 1, h: 1, fixed: false, fixedX: false, fixedY: false, fixedH: false },
    };
    const observations: Observation[] = [
      {
        id: 1,
        type: 'angle',
        at: 'S1',
        from: 'S2',
        to: 'S1',
        obs: 0.1,
        stdDev: 1,
        instCode: 'S9',
      },
      {
        id: 2,
        type: 'gps',
        from: 'S1',
        to: 'S2',
        obs: { dE: 1, dN: 2 },
        stdDev: 1,
        instCode: 'GPS',
        gpsOffsetDistanceM: 0.5,
      },
    ] as Observation[];
    const state = createState();
    const logs: string[] = [];

    finalizeParsePostProcessing({
      stations,
      observations,
      state,
      logs,
      resolveAlias: (id) => ({ canonicalId: id }),
      addAliasTrace: () => undefined,
      applyFixities,
      lostStationIds: new Set(),
      explicitAliasCount: 0,
      aliasRuleCount: 0,
      directionRejectDiagnostics: [],
      aliasTraceEntries: [],
      descriptionTraceEntries: [
        { stationId: 'S1', sourceLine: 2, recordType: 'C', description: 'First desc' },
        { stationId: 'S1', sourceLine: 4, recordType: 'C', description: 'Second desc' },
      ],
      orderExplicit: false,
      preanalysisMode: true,
      compatibilityMode: 'legacy',
      compatibilityAcceptedNoOps: new Set(['.GRID']),
      compatibilityDiagnostics: [],
      ambiguousCount: 1,
      legacyFallbackCount: 2,
      strictRejectCount: 0,
      rewriteSuggestionCount: 3,
      directiveTransitions: [],
      directiveNoEffectWarnings: [],
      inputLines: [],
      splitInlineCommentAndDescription: (line) => ({ line }),
      directionSetTreatmentDiagnostics: [],
      defaultDescriptionReconcileMode: 'append',
      defaultDescriptionAppendDelimiter: ' / ',
    });

    expect(state.descriptionScanSummary?.[0]).toMatchObject({
      stationId: 'S1',
      recordCount: 2,
      uniqueCount: 2,
      conflict: true,
    });
    expect(state.reconciledDescriptions?.S1).toBe('First desc / Second desc');
    expect(state.gpsOffsetObservationCount).toBe(1);
    expect(state.parsedUsageSummary?.angle.measured).toBe(1);
    expect(state.parsedUsageSummary?.total).toBe(1);
    expect(state.compatibilityAcceptedNoOpDirectives).toEqual(['.GRID']);
    expect(state.ambiguousCount).toBe(1);
    expect(state.legacyFallbackCount).toBe(2);
    expect(state.rewriteSuggestionCount).toBe(3);
    expect(logs.some((line) => line.includes('Description reconciliation: mode=APPEND'))).toBe(
      true,
    );
    expect(logs.some((line) => line.includes('GPS rover offsets parsed: 1'))).toBe(true);
    expect(logs.some((line) => line.includes('Parse compatibility: mode=legacy, ambiguous=1'))).toBe(
      true,
    );
    expect(logs.some((line) => line.includes('Warning: .ORDER not specified'))).toBe(true);
    expect(logs.some((line) => line.includes('Stations: 2 (unknown: 1). Obs: 2'))).toBe(true);
  });
});
