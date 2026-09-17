import { describe, expect, it } from 'vitest';

import { createBlankCadDrawingDocument, parseCadDrawingFile, serializeCadDrawingFile } from '../src/engine/cad/cadDrawingFile';
import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import { migrateLegacySurveyPointStyles } from '../src/engine/cad/cadPointStyles';
import { createCadHistoryState, undoCadHistory } from '../src/engine/cad/cadUndoRedo';
import type { CadSurveyPointEntity, CadTextEntity } from '../src/engine/cad/cadTypes';
import {
  FIELD_TO_FINISH_GENERATOR,
  F2F_UNMAPPED_LAYER_NAME,
  buildFieldToFinishProject,
  isFieldToFinishEntity,
  type FieldToFinishCadArgs,
  type FieldToFinishCadPoint,
} from '../src/engine/fieldToFinish/cadGeneration';
import type { FeatureCodeCatalog } from '../src/engine/fieldToFinish/featureCatalog';
import { FieldLineworkControl } from '../src/engine/fieldToFinish/featureMetadata';
import { runFieldToFinishCommand } from '../src/engine/fieldToFinish/regeneration';

const catalog: FeatureCodeCatalog = {
  id: 'test-catalog',
  name: 'Test',
  version: '3',
  definitions: [
    {
      id: 'ep', code: 'EP', description: 'Edge pavement', layer: 'RD-EP',
      pointSymbolId: 'point-f2f-square',
      pointBehavior: 'point', lineworkBehavior: { enabled: true, implicitContinuation: false },
    },
    {
      id: 'cl', code: 'CL', description: 'Centerline', layer: 'RD-CL',
      pointBehavior: 'point', lineworkBehavior: { enabled: true, implicitContinuation: true },
    },
    {
      id: 'tree', code: 'TREE', description: 'Tree', layer: 'VG-TREE',
      pointBehavior: 'point', lineworkBehavior: { enabled: false, implicitContinuation: false },
    },
    {
      id: 'ctl', code: 'CTL', description: 'Control only', layer: 'CT-CTL',
      pointBehavior: 'none', lineworkBehavior: { enabled: false, implicitContinuation: false },
    },
  ],
  aliases: [],
};

const pt = (stationId: string, x: number, y: number, order: number, codes: FieldToFinishCadPoint['codes'], extra?: Partial<FieldToFinishCadPoint>): FieldToFinishCadPoint => ({
  stationId, x, y, sourceOrder: order, codes,
  rawCodeText: codes.map((c) => c.code).join(' '),
  description: `desc-${stationId}`,
  sourceImportId: 'import-1',
  ...extra,
});

const epCtl = (control: FieldLineworkControl) => [{ code: 'EP', controls: [control] }];

const basePoints = (): FieldToFinishCadPoint[] => [
  pt('P1', 0, 0, 1, epCtl(FieldLineworkControl.BEGIN)),
  pt('P2', 10, 0, 2, epCtl(FieldLineworkControl.END)),
  pt('P3', 0, 10, 3, [{ code: 'CL' }]),
  pt('P4', 10, 10, 4, [{ code: 'CL' }]),
  pt('P5', 5, 5, 5, [{ code: 'TREE' }], { z: 12.5 }),
  pt('P6', 7, 7, 6, [{ code: 'ZZZ' }]),
  pt('P7', 9, 9, 7, [{ code: 'CTL' }]),
];

const argsOf = (points: FieldToFinishCadPoint[]): FieldToFinishCadArgs => ({
  points, catalog, generationRunId: 'run-1',
});

describe('cad f2f generation', () => {
  it('creates points, layers, styles, linework, and labels with provenance', () => {
    const project = createBlankCadProject({ name: 'F2F', units: 'm' });
    const result = buildFieldToFinishProject(project, argsOf(basePoints()));

    const points = result.project.entities.filter((e): e is CadSurveyPointEntity => e.type === 'survey-point');
    expect(points).toHaveLength(7);
    const p1 = points.find((p) => p.stationId === 'P1')!;
    expect(p1.description).toBe('desc-P1');
    expect(p1.featureCode).toBe('EP');
    expect(p1.layerId).toBe(result.project.layers.find((l) => l.name === 'RD-EP')?.id);
    const provenance = p1.metadata?.['provenance'] as Record<string, unknown>;
    expect(provenance).toMatchObject({
      generatedBy: FIELD_TO_FINISH_GENERATOR,
      sourceImportId: 'import-1',
      sourceStationId: 'P1',
      featureDefinitionId: 'ep',
      catalogId: 'test-catalog',
      catalogVersion: '3',
      generationRunId: 'run-1',
      state: 'GENERATED',
    });
    expect(p1.metadata?.['featureCodes']).toEqual(['EP']);

    // Linework: EP BEGIN/END -> line, CL implicit bare -> line.
    const lines = result.project.entities.filter((e) => e.type === 'line');
    expect(lines).toHaveLength(2);
    const epLine = lines.find((l) => l.id.startsWith('f2f-lw-ep-'))!;
    expect([epLine.fromStationId, epLine.toStationId].sort()).toEqual(['P1', 'P2']);
    expect(epLine.metadata?.['sourcePointIds']).toEqual(['P1', 'P2']);
    expect(epLine.metadata?.['featureCode']).toBe('EP');

    // Labels carry id + description + code components; TREE label has elevation.
    const labels = result.project.entities.filter((e): e is CadTextEntity => e.type === 'text');
    expect(labels.find((l) => l.id === 'label:P1')?.text).toBe('P1 desc-P1 EP');
    expect(labels.find((l) => l.id === 'label:P5')?.text).toContain('EL 12.500');
    // pointBehavior 'none' still creates the point but suppresses its label.
    expect(points.some((p) => p.stationId === 'P7')).toBe(true);
    expect(labels.some((l) => l.id === 'label:P7')).toBe(false);

    expect(result.stats).toMatchObject({ points: 7, linework: 2, unmapped: 1 });
  });

  it('keeps unmapped codes on F2F-UNMAPPED, preserved and warned', () => {
    const project = createBlankCadProject({ name: 'F2F', units: 'm' });
    const result = buildFieldToFinishProject(project, argsOf(basePoints()));
    const p6 = result.project.entities.find((e): e is CadSurveyPointEntity => e.type === 'survey-point' && e.stationId === 'P6')!;
    expect(p6).toBeDefined();
    expect(p6.layerId).toBe(result.project.layers.find((l) => l.name === F2F_UNMAPPED_LAYER_NAME)?.id);
    expect(result.warnings.some((w) => w.code === 'F2F_UNMAPPED' && w.pointId === 'P6')).toBe(true);
  });

  it('applies deterministic multi-code precedence (first point-role match wins)', () => {
    const project = createBlankCadProject({ name: 'F2F', units: 'm' });
    const points = [pt('P1', 0, 0, 1, [{ code: 'CL' }, { code: 'EP' }])];
    const result = buildFieldToFinishProject(project, argsOf(points));
    const p1 = result.project.entities.find((e): e is CadSurveyPointEntity => e.type === 'survey-point')!;
    expect(p1.featureCode).toBe('CL');
    expect(p1.layerId).toBe(result.project.layers.find((l) => l.name === 'RD-CL')?.id);
    expect(p1.metadata?.['featureCodes']).toEqual(['CL', 'EP']);
  });

  it('parses combined code strings with instance and controls', () => {
    const project = createBlankCadProject({ name: 'F2F', units: 'm' });
    const points = [
      pt('P1', 0, 0, 1, [{ code: 'EP1 BEGIN' }]),
      pt('P2', 10, 0, 2, [{ code: 'EP1 END' }]),
    ];
    const result = buildFieldToFinishProject(project, argsOf(points));
    const lines = result.project.entities.filter((e) => e.type === 'line');
    expect(lines).toHaveLength(1);
    expect(lines[0]?.metadata?.['instance']).toBe('1');
  });

  it('is deterministic regardless of input order and never dupes layers on regen', () => {
    const project = createBlankCadProject({ name: 'F2F', units: 'm' });
    const first = buildFieldToFinishProject(project, argsOf(basePoints()));
    const shuffled = buildFieldToFinishProject(project, argsOf([...basePoints()].reverse()));
    expect(JSON.stringify(shuffled.project.entities)).toBe(JSON.stringify(first.project.entities));
    expect(JSON.stringify(shuffled.project.layers)).toBe(JSON.stringify(first.project.layers));

    const layerCount = first.project.layers.length;
    const regen = buildFieldToFinishProject(first.project, argsOf(basePoints()));
    const names = regen.project.layers.map((l) => l.name);
    expect(new Set(names).size).toBe(names.length);
    expect(regen.project.layers.length).toBe(layerCount);
    // Stable linework identity: second run adds no linework entities.
    expect(regen.addedEntityIds.filter((id) => id.startsWith('f2f-lw-'))).toEqual([]);
  });

  it('reuses conflicting styles and records the choice', () => {
    const project = createBlankCadProject({ name: 'F2F', units: 'm' });
    const planted = {
      ...project,
      styleLibrary: {
        ...project.styleLibrary,
        styles: [...project.styleLibrary.styles, { id: 'other-style', name: 'RD-EP', color: '#000000' }],
      },
    };
    const result = buildFieldToFinishProject(planted, argsOf(basePoints()));
    expect(result.project.styleLibrary.styles.filter((s) => s.name === 'RD-EP')).toHaveLength(1);
    expect(result.styleChoices.some((c) => c.reused === 'other-style' || c.requested.length > 0)).toBe(true);
    const epStyleId = result.project.entities.find((e): e is CadSurveyPointEntity => e.type === 'survey-point' && e.stationId === 'P1')?.styleId;
    expect(epStyleId).toBe('other-style');
  });

  it('runs as ONE undoable transaction via runCadCommand', () => {
    const project = createBlankCadProject({ name: 'F2F', units: 'm' });
    const built = buildFieldToFinishProject(project, argsOf(basePoints()));
    const history = createCadHistoryState(project);
    const next = runFieldToFinishCommand(history, built.payload);
    expect(next.undoStack).toHaveLength(1);
    expect(next.present.project.entities.length).toBe(built.project.entities.length);
    const undone = undoCadHistory(next);
    expect(undone.present.project.entities).toEqual([]);
  });

  it('round-trips save/reopen with semantic identity (still .wncad v2)', () => {
    const base = createBlankCadProject({ name: 'F2F', units: 'm' });
    const manual: CadSurveyPointEntity = {
      id: 'pt:MANUAL1',
      type: 'survey-point',
      layerId: 'points',
      styleId: 'style-point',
      visible: true,
      locked: false,
      stationId: 'MANUAL1',
      x: 1,
      y: 2,
      pointClass: 'free',
      source: 'parsed-input',
      metadata: { manual: true },
    };
    const project = buildFieldToFinishProject(
      { ...base, entities: [manual] },
      argsOf(basePoints()),
    ).project;
    const drawing = { ...createBlankCadDrawingDocument({ name: 'F2F', units: 'm' }), project };
    const parsed = parseCadDrawingFile(serializeCadDrawingFile(drawing));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.drawing.schemaVersion).toBe(2);
    const reopened = parsed.drawing.project;
    // Phase 18D: reopen backfills the additive point-style table and assigns
    // compatibility BASE refs (same symbol, scale 1 — marker appearance unchanged).
    const expected = migrateLegacySurveyPointStyles(project);
    expect(reopened.entities).toEqual(expected.entities);
    expect(reopened.pointStyles).toEqual(expected.pointStyles);
    expect(reopened.layers).toEqual(project.layers);
    expect(reopened.styleLibrary).toEqual(project.styleLibrary);
    // Manual content survives untouched and stays non-F2F.
    const reopenedManual = reopened.entities.find((e) => e.id === 'pt:MANUAL1')!;
    expect(isFieldToFinishEntity(reopenedManual)).toBe(false);
    // Compatibility BASE ref only; color/styleId/marker symbol all untouched.
    expect(reopenedManual).toEqual({ ...manual, pointStyleId: 'point-style-survey' });
    expect(reopened.entities.filter(isFieldToFinishEntity).length).toBeGreaterThan(0);
  });

  it('leaves legacy non-F2F content untouched', () => {
    const project = createBlankCadProject({ name: 'F2F', units: 'm' });
    const result = buildFieldToFinishProject(project, argsOf(basePoints()));
    // Default layers keep their colors; default symbols keep no-shape behavior.
    expect(result.project.layers.find((l) => l.id === 'points')?.color).toBe('#38bdf8');
    const free = result.project.styleLibrary.pointSymbols.find((s) => s.id === 'point-free')!;
    expect(free.shape).toBeUndefined();
    // New bounded F2F symbols exist for catalogs to reference.
    expect(result.project.styleLibrary.pointSymbols.some((s) => s.id === 'point-f2f-square' && s.shape === 'square')).toBe(true);
    const epStyle = result.project.styleLibrary.styles.find((s) => s.id === result.project.entities.find((e): e is CadSurveyPointEntity => e.type === 'survey-point' && e.stationId === 'P1')?.styleId);
    expect(epStyle?.pointSymbolId).toBe('point-f2f-square');
  });
});
