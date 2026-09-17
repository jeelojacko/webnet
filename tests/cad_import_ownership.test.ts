import { describe, expect, it } from 'vitest';
import { importAdjustedPointsIntoCadProject } from '../src/engine/cad/cadAdjustedPointsImport';
import {
  dependencyOf,
  evaluateCadEntityDependency,
} from '../src/engine/cad/cadAdjustmentDependency';
import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import type { CadEntity, CadProject } from '../src/engine/cad/cadTypes';
import { buildFieldToFinishLink } from '../src/engine/fieldToFinish/linkedSync';
import { applyAdjustmentRerunToLinkedF2f } from '../src/engine/fieldToFinish/linkedRerunSync';
import type { AdjustmentResult } from '../src/types';
import type { ResultDependencyIdentity } from '../src/engine/resultIntegrity';

const IDENTITY: ResultDependencyIdentity = {
  inputFingerprint: 'input-a',
  mathFingerprint: 'math-a',
  exclusionFingerprint: 'excl-a',
};
const OLD_IDENTITY: ResultDependencyIdentity = { ...IDENTITY, inputFingerprint: 'input-old' };

const station = (x: number, y: number, extra: Record<string, unknown> = {}) => ({
  x,
  y,
  h: 0,
  fixed: false,
  ...extra,
});

const resultOf = (coords: Record<string, { x: number; y: number }>): AdjustmentResult =>
  ({
    success: true,
    converged: true,
    iterations: 1,
    seuw: 1,
    dof: 1,
    logs: [],
    observations: [],
    stations: Object.fromEntries(
      Object.entries(coords).map(([id, { x, y }]) => [id, station(x, y)]),
    ),
  }) as AdjustmentResult;

const f2fProvenance = (stationId: string) => ({
  provenance: {
    generatedBy: 'FIELD_TO_FINISH',
    sourceStationId: stationId,
    catalogId: 'cat',
    catalogVersion: '1',
    generationRunId: 'run-1',
    state: 'GENERATED',
  },
});

const f2fPoint = (stationId: string, x: number, y: number): CadEntity => ({
  id: `pt:${stationId}`,
  type: 'survey-point',
  layerId: 'f2f-layer-ep',
  styleId: 'f2f-style-ep',
  visible: true,
  locked: false,
  stationId,
  x,
  y,
  pointClass: 'free',
  source: 'parsed-input',
  metadata: { featureCodes: ['EP'], provenance: f2fProvenance(stationId).provenance },
});

const f2fLabel = (stationId: string, x: number, y: number): CadEntity => ({
  id: `label:${stationId}`,
  type: 'text',
  layerId: 'labels',
  styleId: 'style-label',
  visible: true,
  locked: false,
  x,
  y,
  text: stationId,
  anchorEntityId: `pt:${stationId}`,
  metadata: {
    stationId,
    featureCodes: ['EP'],
    provenance: { ...f2fProvenance(stationId).provenance, sourceRecordId: `${stationId}:label` },
  },
});

const f2fLinework = (a: string, b: string, ax: number, ay: number, bx: number, by: number): CadEntity => ({
  id: 'f2f-lw-ep-0',
  type: 'polyline',
  layerId: 'f2f-layer-ep',
  styleId: 'f2f-style-ep',
  visible: true,
  locked: false,
  vertices: [{ x: ax, y: ay }, { x: bx, y: by }],
  vertexLabels: [a, b],
  closed: false,
  metadata: {
    featureCode: 'EP',
    sourcePointIds: [a, b],
    provenance: f2fProvenance(a).provenance,
  },
});

const manualPoint = (stationId: string, x: number, y: number): CadEntity => ({
  id: `pt:${stationId}`,
  type: 'survey-point',
  layerId: 'points',
  styleId: 'style-point',
  visible: true,
  locked: false,
  stationId,
  x,
  y,
  pointClass: 'free',
  source: 'parsed-input',
  metadata: { manual: true },
});

const oldImportPoint = (stationId: string, x: number, y: number): CadEntity => ({
  id: `pt:${stationId}`,
  type: 'survey-point',
  layerId: 'points',
  styleId: 'style-point',
  visible: true,
  locked: false,
  stationId,
  x,
  y,
  z: 0,
  pointClass: 'free',
  source: 'adjustment-result',
  metadata: {
    stationId,
    importedFrom: 'adjusted-points',
    importId: 'adjusted-points:old',
    sourceName: 'Current adjustment',
    adjustmentDependency: { ...OLD_IDENTITY },
  },
});

const parcelOf = (
  id: string,
  vertices: Array<{ x: number; y: number }>,
  vertexLabels: string[],
): CadEntity => ({
  id,
  type: 'parcel',
  layerId: 'parcels',
  visible: true,
  locked: false,
  vertices,
  vertexLabels,
  parcelName: id,
});

const projectWith = (entities: CadEntity[], stationIds?: string[]): CadProject => {
  const base = createBlankCadDrawingDocument({ name: 'ownership', units: 'm' }).project;
  const link = stationIds
    ? buildFieldToFinishLink({
      generationRunId: 'run-1',
      catalogId: 'cat',
      catalogRevision: '1',
      sourceKind: 'adjustment',
      sourceRecordIds: stationIds,
      stationIds,
      generatedEntityIds: entities.map((entity) => entity.id),
      generatedLabelIds: entities.filter((entity) => entity.type === 'text').map((entity) => entity.id),
    })
    : undefined;
  return {
    ...base,
    entities,
    ...(link ? { metadata: { ...base.metadata, fieldToFinishLink: link } } : {}),
  };
};

const importInto = (project: CadProject, result: AdjustmentResult) =>
  importAdjustedPointsIntoCadProject({
    identity: IDENTITY,
    importedAtIso: '2026-09-17T00:00:00.000Z',
    project,
    result,
    sourceName: 'Current adjustment',
  });

describe('MODEL A owner precedence', () => {
  it('(a) F2F geometry is byte-preserved and skipped on same-station import', () => {
    const point = f2fPoint('A', 10, 20);
    const label = f2fLabel('A', 10, 20);
    const line = f2fLinework('A', 'B', 10, 20, 40, 50);
    const pointB = f2fPoint('B', 40, 50);
    const project = projectWith([point, label, line, pointB], ['A', 'B']);
    const linkBefore = project.metadata.fieldToFinishLink!;

    const { project: next, record } = importInto(project, resultOf({ A: { x: 10, y: 20 }, B: { x: 40, y: 50 } }));

    expect(record.skippedF2fStationIds).toEqual(['A', 'B']);
    expect(record.createdPointCount).toBe(0);
    expect(record.updatedPointCount).toBe(0);
    expect(next.entities.find((entity) => entity.id === 'pt:A')).toBe(point);
    expect(next.entities.find((entity) => entity.id === 'label:A')).toBe(label);
    expect(next.entities.find((entity) => entity.id === 'f2f-lw-ep-0')).toBe(line);
    expect(next.metadata.fieldToFinishLink).toBe(linkBefore);
    expect(next.metadata.fieldToFinishLink?.status).toBe('CURRENT');
  });

  it('(b) F2F + manual preserved, new station created, rerun still moves F2F points', () => {
    const pointA = f2fPoint('A', 10, 20);
    const pointB = f2fPoint('B', 40, 50);
    const manual = manualPoint('M', 1, 2);
    const project = projectWith([pointA, pointB, manual], ['A', 'B']);

    const { project: next, record } = importInto(
      project,
      resultOf({ A: { x: 11, y: 21 }, B: { x: 41, y: 51 }, C: { x: 70, y: 80 } }),
    );

    expect(record.skippedF2fStationIds).toEqual(['A', 'B']);
    expect(next.entities.find((entity) => entity.id === 'pt:A')).toBe(pointA);
    expect(next.entities.find((entity) => entity.id === 'pt:B')).toBe(pointB);
    expect(next.entities.find((entity) => entity.id === 'pt:M')).toBe(manual);
    const created = next.entities.find((entity) => entity.id === 'pt:C');
    expect(created).toMatchObject({ type: 'survey-point', x: 70, y: 80 });
    expect(dependencyOf(created!)).toEqual(IDENTITY);

    const rerun = applyAdjustmentRerunToLinkedF2f(next, {
      result: resultOf({ A: { x: 12, y: 22 }, B: { x: 42, y: 52 } }),
    });
    expect(rerun.updated).toEqual(['A', 'B']);
    expect(rerun.project.entities.find((entity) => entity.id === 'pt:A')).toMatchObject({ x: 12, y: 22 });
  });

  it('(c) created entities carry the stamp and evaluate CURRENT', () => {
    const { project: next } = importInto(
      projectWith([]),
      resultOf({ A: { x: 10, y: 20 } }),
    );
    for (const id of ['pt:A', 'label:A']) {
      const entity = next.entities.find((entry) => entry.id === id)!;
      expect(dependencyOf(entity)).toEqual(IDENTITY);
      expect(evaluateCadEntityDependency(entity, IDENTITY)).toEqual({
        status: 'CURRENT',
        reason: 'CAD_CURRENT',
      });
    }
  });

  it('(d) missing-station old import entity is kept and evaluates SOURCE_MISSING', () => {
    const old = oldImportPoint('D', 5, 5);
    const project = projectWith([old]);
    const { project: next } = importInto(project, resultOf({ A: { x: 10, y: 20 } }));
    const kept = next.entities.find((entity) => entity.id === 'pt:D');
    expect(kept).toBe(old);
    expect(evaluateCadEntityDependency(kept!, IDENTITY, { stationIds: new Set(['A']) })).toEqual({
      status: 'SOURCE_MISSING',
      reason: 'CAD_SOURCE_STATION_MISSING',
    });
  });

  it('(e) new station is created with stable ids and manual geometry preserved', () => {
    const existing = oldImportPoint('A', 10, 20);
    const { project: next, record } = importInto(
      projectWith([existing]),
      resultOf({ A: { x: 10, y: 20 }, C: { x: 70, y: 80 } }),
    );
    expect(record.createdPointCount).toBe(1);
    expect(record.updatedPointCount).toBe(1);
    expect(next.entities.find((entity) => entity.id === 'pt:C')).toMatchObject({ x: 70, y: 80 });
    expect(next.entities.find((entity) => entity.id === 'label:C')).toBeDefined();
    expect(dependencyOf(next.entities.find((entity) => entity.id === 'pt:C')!)).toEqual(IDENTITY);
  });

  it('(f) parcel vertices follow moved stations with recomputed metrics', () => {
    const before = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const derived = parcelOf('parcel:1', before, ['A', 'B', 'C', 'D']);
    const orphan = parcelOf(
      'parcel:orphan',
      [{ x: 100, y: 100 }, { x: 110, y: 100 }, { x: 110, y: 110 }],
      ['X', 'Y', 'Z'],
    );
    const manualParcel = parcelOf('parcel:manual', before.map((v) => ({ ...v })), []);
    const { project: next } = importInto(
      projectWith([derived, orphan, manualParcel]),
      resultOf({
        A: { x: 0, y: 0 },
        B: { x: 20, y: 0 },
        C: { x: 20, y: 10 },
        D: { x: 0, y: 10 },
      }),
    );
    const refreshed = next.entities.find((entity) => entity.id === 'parcel:1')!;
    expect(refreshed).not.toBe(derived);
    expect(refreshed.type).toBe('parcel');
    if (refreshed.type !== 'parcel') throw new Error('expected parcel');
    expect(refreshed.vertices[1]).toEqual({ x: 20, y: 0 });
    expect(refreshed.areaSquareMeters).toBeCloseTo(200, 9);
    expect(refreshed.perimeterMeters).toBeCloseTo(60, 9);
    expect(evaluateCadEntityDependency(refreshed, IDENTITY)).toEqual({
      status: 'CURRENT',
      reason: 'CAD_CURRENT',
    });
    expect(next.entities.find((entity) => entity.id === 'parcel:orphan')).toBe(orphan);
    expect(next.entities.find((entity) => entity.id === 'parcel:manual')).toBe(manualParcel);
  });
});

describe('linked F2F sync stamping', () => {
  it('stamps synced F2F entities CURRENT on a complete sync, nothing on conflict', () => {
    const project = projectWith([f2fPoint('A', 10, 20), f2fLabel('A', 10, 20)], ['A']);
    const moved = applyAdjustmentRerunToLinkedF2f(project, {
      result: resultOf({ A: { x: 11, y: 21 } }),
      resultDependencyIdentity: IDENTITY,
    });
    expect(moved.status).toBe('CURRENT');
    for (const entity of moved.project.entities.filter((entry) => entry.id.startsWith('pt:') || entry.id.startsWith('label:'))) {
      expect(evaluateCadEntityDependency(entity, IDENTITY, { f2fLinkStatus: moved.status })).toEqual({
        status: 'CURRENT',
        reason: 'CAD_CURRENT',
      });
    }
    const unstamped = applyAdjustmentRerunToLinkedF2f(project, {
      result: resultOf({ A: { x: 11, y: 21 } }),
    });
    expect(unstamped.status).toBe('CURRENT');
    expect(dependencyOf(unstamped.project.entities.find((entity) => entity.id === 'pt:A')!)).toBeNull();
  });
});
