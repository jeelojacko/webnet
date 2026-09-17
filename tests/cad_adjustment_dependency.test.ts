import { describe, expect, it } from 'vitest';
import { cadBuildParcelClosureSummary } from '../src/engine/cad/cadCogoParcelGeometrySummaries';
import {
  decideCadDeliverableVerdict,
  dependencyOf,
  evaluateCadEntityDependency,
  identitiesEqual,
  ownerOfCadEntity,
  stampAdjustmentDependency,
  summarizeDrawingDependency,
} from '../src/engine/cad/cadAdjustmentDependency';
import type { CadEntity, CadProject } from '../src/engine/cad/cadTypes';
import type { ResultDependencyIdentity } from '../src/engine/resultIntegrity';

const CURRENT: ResultDependencyIdentity = {
  inputFingerprint: 'input-a',
  mathFingerprint: 'math-a',
  exclusionFingerprint: 'excl-a',
};
const OTHER: ResultDependencyIdentity = { ...CURRENT, inputFingerprint: 'input-b' };

const point = (overrides: Partial<Extract<CadEntity, { type: 'survey-point' }>> = {}): CadEntity => ({
  id: 'pt:A',
  type: 'survey-point',
  layerId: 'points',
  visible: true,
  locked: false,
  stationId: 'A',
  x: 100,
  y: 200,
  pointClass: 'free',
  source: 'adjustment-result',
  ...overrides,
});

const manualLine = (): CadEntity => ({
  id: 'ln:1',
  type: 'line',
  layerId: 'planning',
  visible: true,
  locked: false,
  fromStationId: 'A',
  toStationId: 'B',
  fromX: 0,
  fromY: 0,
  toX: 10,
  toY: 0,
  sourceObservationIds: [],
  metadata: { manual: true },
});

const f2fProvenance = (state = 'GENERATED') => ({
  provenance: {
    generatedBy: 'FIELD_TO_FINISH',
    sourceStationId: 'A',
    catalogId: 'cat',
    catalogVersion: '1',
    generationRunId: 'run-1',
    state,
  },
});

const projectOf = (entities: CadEntity[]): CadProject => ({
  version: 1,
  id: 'p1',
  name: 'test',
  metadata: {
    source: 'adjustment-result',
    runMode: 'adjustment',
    units: 'm',
    stationCount: 1,
    observationCount: 0,
    adjustedStationCount: 1,
  },
  layers: [],
  styleLibrary: { lineTypes: [], textStyles: [], pointSymbols: [], styles: [] },
  entities,
  cogoComputations: [],
  bounds: null,
});

const parcelVertices = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

const parcel = (tamperArea = 0): CadEntity => {
  const live = cadBuildParcelClosureSummary(parcelVertices)!;
  return {
    id: 'parcel:1',
    type: 'parcel',
    layerId: 'parcels',
    visible: true,
    locked: false,
    vertices: [...parcelVertices],
    vertexLabels: ['A', 'B', 'C', 'D'],
    parcelName: 'P1',
    areaSquareMeters: live.areaSquareMeters + tamperArea,
    perimeterMeters: live.perimeterMeters,
    closureDistanceMeters: live.closureDistanceMeters,
  };
};

describe('stamp/dependency round-trip', () => {
  it('stamps and reads back an identical identity', () => {
    const stamped = stampAdjustmentDependency(point(), CURRENT);
    expect(dependencyOf(stamped)).toEqual(CURRENT);
    expect(identitiesEqual(dependencyOf(stamped)!, CURRENT)).toBe(true);
  });

  it('preserves existing metadata including F2F provenance', () => {
    const entity = point({ metadata: { ...f2fProvenance(), note: 'keep' } });
    const stamped = stampAdjustmentDependency(entity, CURRENT);
    const metadata = stamped.metadata as Record<string, unknown>;
    expect(metadata['note']).toBe('keep');
    expect(metadata['provenance']).toEqual(f2fProvenance().provenance);
  });

  it('malformed dependency metadata reads as null', () => {
    expect(dependencyOf(point())).toBeNull();
    expect(dependencyOf(point({ metadata: { adjustmentDependency: { inputFingerprint: 'x' } } }))).toBeNull();
    expect(dependencyOf(point({ metadata: { adjustmentDependency: 'nope' } }))).toBeNull();
  });

  it('identitiesEqual detects any fingerprint change', () => {
    expect(identitiesEqual(CURRENT, { ...CURRENT })).toBe(true);
    expect(identitiesEqual(CURRENT, OTHER)).toBe(false);
    expect(identitiesEqual(CURRENT, { ...CURRENT, mathFingerprint: 'm2' })).toBe(false);
    expect(identitiesEqual(CURRENT, { ...CURRENT, exclusionFingerprint: 'e2' })).toBe(false);
  });
});

describe('ownerOfCadEntity', () => {
  it('classifies import, manual, F2F, COGO, parcel, and sheet owners', () => {
    expect(ownerOfCadEntity(point())).toBe('ADJUSTMENT_IMPORT');
    expect(ownerOfCadEntity(manualLine())).toBe('MANUAL');
    expect(ownerOfCadEntity(point({ metadata: f2fProvenance() }))).toBe('F2F_GENERATED');
    expect(ownerOfCadEntity(point({ metadata: f2fProvenance('MANUAL_OVERRIDE') }))).toBe('F2F_MANUAL_OVERRIDE');
    expect(ownerOfCadEntity(point({ metadata: { cogo: { toolKey: 'inverse' } } }))).toBe('COGO');
    expect(ownerOfCadEntity(parcel())).toBe('PARCEL_DERIVED');
  });

  it('marks sheet-derived text only with station linkage', () => {
    const linked: CadEntity = {
      id: 'label:A', type: 'text', layerId: 'labels', visible: true, locked: false,
      x: 0, y: 0, text: 'A', anchorEntityId: 'pt:A', metadata: { stationId: 'A' },
    };
    const unlinked: CadEntity = {
      id: 'note:1', type: 'text', layerId: 'labels', visible: true, locked: false,
      x: 0, y: 0, text: 'hi', anchorEntityId: 'pt:A',
    };
    expect(ownerOfCadEntity(linked)).toBe('SHEET_DERIVED');
    expect(ownerOfCadEntity(unlinked)).toBe('MANUAL');
  });
});

describe('evaluateCadEntityDependency', () => {
  it('returns CURRENT on stamp match', () => {
    expect(evaluateCadEntityDependency(stampAdjustmentDependency(point(), CURRENT), CURRENT))
      .toEqual({ status: 'CURRENT', reason: 'CAD_CURRENT' });
  });

  it('marks legacy unstamped import entities UNKNOWN_LEGACY', () => {
    expect(evaluateCadEntityDependency(point(), CURRENT))
      .toEqual({ status: 'UNKNOWN_LEGACY', reason: 'CAD_LEGACY_DEPENDENCY_UNKNOWN' });
  });

  it('marks malformed stamps UNKNOWN_LEGACY', () => {
    const entity = point({ metadata: { importedFrom: 'adjusted-points', adjustmentDependency: {} } });
    expect(evaluateCadEntityDependency(entity, CURRENT).status).toBe('UNKNOWN_LEGACY');
  });

  it('marks replaced fingerprints STALE', () => {
    expect(evaluateCadEntityDependency(stampAdjustmentDependency(point(), OTHER), CURRENT))
      .toEqual({ status: 'STALE', reason: 'CAD_SOURCE_RESULT_REPLACED' });
  });

  it('marks everything dependent STALE when current is null', () => {
    expect(evaluateCadEntityDependency(stampAdjustmentDependency(point(), CURRENT), null))
      .toEqual({ status: 'STALE', reason: 'CAD_SOURCE_RESULT_STALE' });
  });

  it('marks missing stations SOURCE_MISSING', () => {
    const stamped = stampAdjustmentDependency(point(), CURRENT);
    expect(evaluateCadEntityDependency(stamped, CURRENT, { stationIds: new Set(['B']) }))
      .toEqual({ status: 'SOURCE_MISSING', reason: 'CAD_SOURCE_STATION_MISSING' });
    expect(evaluateCadEntityDependency(stamped, CURRENT, { stationIds: new Set(['A']) }).status).toBe('CURRENT');
  });

  it('never blocks manual, override, or COGO owners', () => {
    const cogo = stampAdjustmentDependency(point({ metadata: { cogo: { toolKey: 'x' } } }), CURRENT);
    for (const entity of [manualLine(), point({ metadata: f2fProvenance('MANUAL_OVERRIDE') }), cogo]) {
      expect(evaluateCadEntityDependency(entity, CURRENT)).toEqual({ status: 'MANUAL', reason: 'CAD_NO_DEPENDENCY' });
    }
  });

  it('passes F2F entities with a CURRENT link, blocks on drift', () => {
    const stamped = stampAdjustmentDependency(point({ metadata: f2fProvenance() }), CURRENT);
    expect(evaluateCadEntityDependency(stamped, CURRENT, { f2fLinkStatus: 'CURRENT' }).status).toBe('CURRENT');
    expect(evaluateCadEntityDependency(stamped, CURRENT, { f2fLinkStatus: 'COORDINATES_CHANGED' }))
      .toEqual({ status: 'STALE', reason: 'CAD_F2F_SYNC_INCOMPLETE' });
  });

  it('accepts parcels matching live recompute, rejects tampered metrics', () => {
    expect(evaluateCadEntityDependency(stampAdjustmentDependency(parcel(), CURRENT), CURRENT).status).toBe('CURRENT');
    expect(evaluateCadEntityDependency(stampAdjustmentDependency(parcel(0.5), CURRENT), CURRENT))
      .toEqual({ status: 'STALE', reason: 'CAD_PARCEL_METRICS_STALE' });
  });

  it('marks broken-reference labels STALE', () => {
    const label: CadEntity = {
      id: 'label:A', type: 'text', layerId: 'labels', visible: true, locked: false,
      x: 0, y: 0, text: 'A', anchorEntityId: 'pt:A',
      metadata: { stationId: 'A', valueState: 'BROKEN_REFERENCE' },
    };
    expect(evaluateCadEntityDependency(stampAdjustmentDependency(label, CURRENT), CURRENT))
      .toEqual({ status: 'STALE', reason: 'CAD_DERIVED_LABEL_STALE' });
  });
});

describe('summary and verdict', () => {
  it('aggregates counts and sorted unique reasons', () => {
    const summary = summarizeDrawingDependency(projectOf([
      stampAdjustmentDependency(point(), CURRENT),
      point({ id: 'pt:B', stationId: 'B' }),
      manualLine(),
    ]), CURRENT);
    expect(summary).toMatchObject({
      status: 'NEEDS_REVIEW', currentCount: 1, unknownCount: 1, manualCount: 1,
      reasons: ['CAD_LEGACY_DEPENDENCY_UNKNOWN'],
    });
  });

  it('reports STALE when any entity is stale or missing', () => {
    const summary = summarizeDrawingDependency(projectOf([
      stampAdjustmentDependency(point(), OTHER),
    ]), CURRENT);
    expect(summary.status).toBe('STALE');
    expect(summary.staleCount).toBe(1);
  });

  it('reports MANUAL_ONLY for all-manual drawings and CURRENT otherwise', () => {
    expect(summarizeDrawingDependency(projectOf([manualLine()]), CURRENT).status).toBe('MANUAL_ONLY');
    expect(summarizeDrawingDependency(projectOf([stampAdjustmentDependency(point(), CURRENT)]), CURRENT).status)
      .toBe('CURRENT');
  });

  it('allows CURRENT and MANUAL_ONLY, blocks STALE and NEEDS_REVIEW', () => {
    const current = summarizeDrawingDependency(projectOf([stampAdjustmentDependency(point(), CURRENT)]), CURRENT);
    expect(decideCadDeliverableVerdict(current)).toEqual({ allowed: true, reason: null, blockMessage: null });
    const stale = summarizeDrawingDependency(projectOf([stampAdjustmentDependency(point(), OTHER)]), CURRENT);
    const verdict = decideCadDeliverableVerdict(stale);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe('CAD_SOURCE_RESULT_REPLACED');
    expect(verdict.blockMessage).toContain('Refresh adjusted points');
  });

  it('lets a well-formed stamp win over a parsed-input spikeSource marker', () => {
    const stamped = stampAdjustmentDependency(
      point({ metadata: { spikeSource: 'parsed-input' } }),
      CURRENT,
    );
    expect(evaluateCadEntityDependency(stamped, CURRENT)).toEqual({
      status: 'CURRENT',
      reason: 'CAD_CURRENT',
    });
    expect(evaluateCadEntityDependency(stamped, OTHER).status).toBe('STALE');
    const unstamped = point({ metadata: { spikeSource: 'parsed-input' } });
    expect(evaluateCadEntityDependency(unstamped, CURRENT)).toEqual({
      status: 'MANUAL',
      reason: 'CAD_NO_DEPENDENCY',
    });
  });
});
