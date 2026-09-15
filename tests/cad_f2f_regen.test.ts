import { describe, expect, it } from 'vitest';

import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import type { CadSurveyPointEntity } from '../src/engine/cad/cadTypes';
import { buildFieldToFinishProject, type FieldToFinishCadArgs, type FieldToFinishCadPoint } from '../src/engine/fieldToFinish/cadGeneration';
import {
  adjustedStationsToFieldToFinishPoints,
  applyFieldToFinishRegen,
  controlStationsToFieldToFinishPoints,
  detachFieldToFinishEntity,
  markFieldToFinishManualOverride,
  previewFieldToFinishRegen,
  resolveFieldToFinishCoordinates,
  updateFieldToFinishCoordinates,
} from '../src/engine/fieldToFinish/regeneration';
import type { FeatureCodeCatalog } from '../src/engine/fieldToFinish/featureCatalog';
import { FieldLineworkControl } from '../src/engine/fieldToFinish/featureMetadata';
import type { ImportedControlStationRecord } from '../src/engine/importers';

const catalog: FeatureCodeCatalog = {
  id: 'test-catalog',
  name: 'Test',
  version: '3',
  definitions: [
    {
      id: 'ep', code: 'EP', description: 'Edge pavement', layer: 'RD-EP',
      pointBehavior: 'point', lineworkBehavior: { enabled: true, implicitContinuation: false },
    },
  ],
  aliases: [],
};

const pt = (stationId: string, x: number, y: number, order: number, code = 'EP'): FieldToFinishCadPoint => ({
  stationId, x, y, sourceOrder: order,
  sourceLine: order,
  codes: [{ code }],
  rawCodeText: code,
  description: `desc-${stationId}`,
  sourceImportId: 'import-1',
});

const argsOf = (points: FieldToFinishCadPoint[], runId = 'run-1'): FieldToFinishCadArgs => ({
  points, catalog, generationRunId: runId,
});

const seed = () => buildFieldToFinishProject(
  createBlankCadProject({ name: 'F2F', units: 'm' }),
  argsOf([
    pt('P1', 0, 0, 1, 'EP'),
    pt('P2', 10, 0, 2, 'EP'),
    pt('P3', 20, 0, 3, 'EP'),
  ]),
).project;

describe('cad f2f regen', () => {
  it('previews added/updated/removed/codes-changed/linework deltas', () => {
    const project = seed();
    const next = [
      pt('P1', 0, 0, 1, 'EP'),
      pt('P2', 11, 0, 2, 'EP'), // moved
      pt('P4', 30, 0, 4, 'ZZZ'), // added + unmapped
      // P3 removed
    ];
    const preview = previewFieldToFinishRegen(project, argsOf(next, 'run-2'), 'import-1');
    expect(preview.added).toEqual(['P4']);
    expect(preview.updated).toEqual(['P2']);
    expect(preview.removed).toEqual(['P3']);
    expect(preview.unmapped).toEqual([]);
    expect(preview.manualConflicts).toEqual([]);
  });

  it('is stable under input reorder (identity is not array index)', () => {
    const project = seed();
    const reordered = [pt('P3', 20, 0, 3, 'EP'), pt('P1', 0, 0, 1, 'EP'), pt('P2', 10, 0, 2, 'EP')];
    const preview = previewFieldToFinishRegen(project, argsOf(reordered, 'run-2'), 'import-1');
    expect(preview.added).toEqual([]);
    expect(preview.removed).toEqual([]);
    expect(preview.updated).toEqual([]);
  });

  it('removes generated entities only on confirmed regen and reports them', () => {
    const project = seed();
    const next = [pt('P1', 0, 0, 1, 'EP'), pt('P2', 10, 0, 2, 'EP')];
    const dry = applyFieldToFinishRegen(project, argsOf(next, 'run-2'), 'import-1', { confirmed: false });
    expect(dry.project.entities.some((e) => e.id === 'pt:P3')).toBe(true);
    expect(dry.removedEntityIds).toEqual([]);

    const confirmed = applyFieldToFinishRegen(project, argsOf(next, 'run-2'), 'import-1', { confirmed: true });
    expect(confirmed.project.entities.some((e) => e.id === 'pt:P3')).toBe(false);
    expect(confirmed.removedEntityIds).toContain('pt:P3');
    expect(confirmed.removed).toEqual(['P3']);
  });

  it('preserves MANUAL_OVERRIDE and DETACHED entities (never auto-deleted)', () => {
    let project = seed();
    project = markFieldToFinishManualOverride(project, 'pt:P2');
    project = detachFieldToFinishEntity(project, 'pt:P3');
    const next = [pt('P1', 0, 0, 1, 'EP')]; // P2 + P3 sources gone
    const preview = previewFieldToFinishRegen(project, argsOf(next, 'run-2'), 'import-1');
    expect(preview.manualConflicts.sort()).toEqual(['P2', 'P3']);
    expect(preview.removed).toEqual([]);

    const applied = applyFieldToFinishRegen(project, argsOf(next, 'run-2'), 'import-1', { confirmed: true });
    expect(applied.project.entities.some((e) => e.id === 'pt:P2')).toBe(true);
    expect(applied.project.entities.some((e) => e.id === 'pt:P3')).toBe(true);
    expect(applied.removedEntityIds).toEqual([]);
  });

  it('updates coordinates on adjustment rerun, skipping manual overrides', () => {
    const project = markFieldToFinishManualOverride(seed(), 'pt:P2');
    const { project: next, updated, skippedManual } = updateFieldToFinishCoordinates(
      project,
      new Map([['P1', { x: 1, y: 1 }], ['P2', { x: 99, y: 99 }]]),
    );
    expect(updated).toEqual(['P1']);
    expect(skippedManual).toEqual(['P2']);
    const p1 = next.entities.find((e): e is CadSurveyPointEntity => e.type === 'survey-point' && e.stationId === 'P1')!;
    const p2 = next.entities.find((e): e is CadSurveyPointEntity => e.type === 'survey-point' && e.stationId === 'P2')!;
    expect([p1.x, p1.y]).toEqual([1, 1]);
    expect([p2.x, p2.y]).toEqual([10, 0]);
    const label = next.entities.find((e) => e.id === 'label:P1')!;
    expect(label.type === 'text' && [label.x, label.y]).toEqual([1, 1]);
  });

  it('prefers adjusted coords and never alters adjustment inputs', () => {
    const adjusted = { x: 1, y: 2, z: 3 };
    const sideshot = { x: 4, y: 5 };
    const resolved = resolveFieldToFinishCoordinates({ adjusted, sideshot, coordinateOnly: { x: 7, y: 8 } });
    expect(resolved?.origin).toBe('adjusted');
    expect(resolved?.coords).toEqual(adjusted);
    expect(resolved?.coords).not.toBe(adjusted);
    expect(adjusted).toEqual({ x: 1, y: 2, z: 3 });
    expect(resolveFieldToFinishCoordinates({ sideshot })?.origin).toBe('sideshot');
    expect(resolveFieldToFinishCoordinates({ coordinateOnly: { x: 0, y: 0 } })?.origin).toBe('coordinate-only');
    expect(resolveFieldToFinishCoordinates({})).toBeUndefined();
  });

  it('adapts control-station records and adjusted stations without touching inputs', () => {
    const records = [
      {
        kind: 'control-station', stationId: 'A', coordinateMode: 'local',
        northM: 100, eastM: 200, heightM: 10,
        sourceLine: 5, importSourceKey: 'import-1',
        feature: { rawCodeText: 'EP', codes: [{ code: 'EP', rawCode: 'EP', role: 'both' }], description: 'edge' },
      },
      {
        kind: 'control-station', stationId: 'B', coordinateMode: 'local',
        northM: 110, eastM: 210,
        sourceLine: 6, importSourceKey: 'import-1',
      },
    ] as ImportedControlStationRecord[];
    const points = controlStationsToFieldToFinishPoints(records, 'import-1');
    expect(points[0]).toMatchObject({ stationId: 'A', x: 200, y: 100, z: 10, sourceOrder: 5 });
    expect(points[0]?.codes).toEqual([{ code: 'EP', rawCode: 'EP' }]);
    const shifted = adjustedStationsToFieldToFinishPoints(points, new Map([['A', { x: 201, y: 101 }]]));
    expect(shifted[0]).toMatchObject({ x: 201, y: 101, z: 10 });
    expect(points[0]).toMatchObject({ x: 200, y: 100 });
    expect(shifted[1]).toBe(points[1]);
  });

  it('chains linework end-to-end (BEGIN/CONTINUE/END) and flags linework changes', () => {
    const project = buildFieldToFinishProject(
      createBlankCadProject({ name: 'F2F', units: 'm' }),
      argsOf([
        { ...pt('P1', 0, 0, 1), codes: [{ code: 'EP', controls: [FieldLineworkControl.BEGIN] }] },
        { ...pt('P2', 10, 0, 2), codes: [{ code: 'EP', controls: [FieldLineworkControl.CONTINUE] }] },
        { ...pt('P3', 20, 0, 3), codes: [{ code: 'EP', controls: [FieldLineworkControl.END] }] },
      ]),
    ).project;
    const polys = project.entities.filter((e) => e.type === 'polyline');
    expect(polys).toHaveLength(1);
    expect(polys[0]?.type === 'polyline' && polys[0].vertices).toHaveLength(3);

    const preview = previewFieldToFinishRegen(
      project,
      argsOf([
        { ...pt('P1', 0, 0, 1), codes: [{ code: 'EP', controls: [FieldLineworkControl.BEGIN] }] },
        { ...pt('P2', 10, 0, 2), codes: [{ code: 'EP', controls: [FieldLineworkControl.END] }] },
      ], 'run-2'),
      'import-1',
    );
    expect(preview.lineworkChanged.length).toBeGreaterThan(0);
    expect(preview.removed).toEqual(['P3']);
  });
});
