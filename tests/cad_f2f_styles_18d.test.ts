import { describe, expect, it } from 'vitest';

import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import {
  DEFAULT_CAD_POINT_LABEL_STYLES,
  F2F_FULL_LABEL_STYLE_ID,
  buildPointLabelContent,
} from '../src/engine/cad/cadPointLabelStyles';
import { DEFAULT_CAD_POINT_STYLE_ID } from '../src/engine/cad/cadPointStyles';
import type { CadEntity, CadProject, CadSurveyPointEntity, CadTextEntity } from '../src/engine/cad/cadTypes';
import {
  buildFieldToFinishProject,
  type FieldToFinishCadPoint,
} from '../src/engine/fieldToFinish/cadGeneration';
import {
  exportCatalog,
  importCatalog,
  validateCatalogStyleReferences,
} from '../src/engine/fieldToFinish/catalogIo';
import type { FeatureCodeCatalog } from '../src/engine/fieldToFinish/featureCatalog';
import { applyFieldToFinishRegen } from '../src/engine/fieldToFinish/regeneration';

const pt = (
  stationId: string,
  x: number,
  y: number,
  order: number,
  codes: string[],
  extra?: Partial<FieldToFinishCadPoint>,
): FieldToFinishCadPoint => ({
  stationId,
  x,
  y,
  sourceOrder: order,
  rawCodeText: codes.join(' '),
  codes: codes.map((code) => ({ code })),
  description: `desc-${stationId}`,
  sourceRecordId: stationId,
  sourceImportId: 'styles-18d',
  ...extra,
});

const catalogWith = (
  defs: FeatureCodeCatalog['definitions'],
): FeatureCodeCatalog => ({
  id: 'styles-18d',
  name: 'Styles 18D',
  version: '1',
  definitions: defs,
  aliases: [],
});

const pointDef = (overrides?: Record<string, unknown>): FeatureCodeCatalog['definitions'][number] => ({
  id: 'ep',
  code: 'EP',
  description: 'Edge',
  layer: 'F2F-EDGE',
  pointBehavior: 'point',
  lineworkBehavior: { enabled: false, implicitContinuation: false },
  ...overrides,
});

const surveyPointOf = (project: Pick<CadProject, 'entities'>, stationId: string): CadSurveyPointEntity => {
  const entity: CadEntity | undefined = project.entities.find((entry) => entry.id === `pt:${stationId}`);
  if (entity?.type !== 'survey-point') throw new Error(`missing point ${stationId}`);
  return entity;
};

const labelOf = (project: Pick<CadProject, 'entities'>, stationId: string): CadTextEntity => {
  const entity: CadEntity | undefined = project.entities.find((entry) => entry.id === `label:${stationId}`);
  if (entity?.type !== 'text') throw new Error(`missing label ${stationId}`);
  return entity;
};

describe('phase 18D f2f point/label style integration', () => {
  it('uses definition.pointStyleId when it resolves in the drawing', () => {
    const catalog = catalogWith([pointDef({ pointStyleId: 'point-style-tree' })]);
    const built = buildFieldToFinishProject(
      createBlankCadProject({ name: 'F2F styles', units: 'm' }),
      { points: [pt('P1', 0, 0, 1, ['EP'])], catalog, generationRunId: 's-1' },
    );
    expect(surveyPointOf(built.project, 'P1').pointStyleId).toBe('point-style-tree');
    // Manual override fields are never set from generation.
    expect(surveyPointOf(built.project, 'P1').pointStyleOverrideId).toBeUndefined();
    expect(surveyPointOf(built.project, 'P1').pointLabelStyleOverrideId).toBeUndefined();
  });

  it('derives a compat style from pointSymbolId for legacy catalogs', () => {
    const catalog = catalogWith([pointDef({ pointSymbolId: 'point-f2f-square' })]);
    const built = buildFieldToFinishProject(
      createBlankCadProject({ name: 'F2F styles', units: 'm' }),
      { points: [pt('P1', 0, 0, 1, ['EP'])], catalog, generationRunId: 's-1' },
    );
    // point-f2f-square is the monument marker: first pointStyle sharing the symbol.
    expect(surveyPointOf(built.project, 'P1').pointStyleId).toBe('point-style-monument');
  });

  it('falls back to the drawing default with neither ref, even for unknown pointStyleId', () => {
    const catalog = catalogWith([
      pointDef({ pointStyleId: 'point-style-no-such', pointSymbolId: 'symbol-no-such' }),
    ]);
    const built = buildFieldToFinishProject(
      createBlankCadProject({ name: 'F2F styles', units: 'm' }),
      { points: [pt('P1', 0, 0, 1, ['EP'])], catalog, generationRunId: 's-1' },
    );
    expect(surveyPointOf(built.project, 'P1').pointStyleId).toBe(DEFAULT_CAD_POINT_STYLE_ID);
  });

  it('wires labelStyleId for real, with F2F Full fallback and formatter text', () => {
    const catalog = catalogWith([pointDef({ labelStyleId: 'point-label-point-number' })]);
    const built = buildFieldToFinishProject(
      createBlankCadProject({ name: 'F2F styles', units: 'm' }),
      { points: [pt('P1', 0, 0, 1, ['EP'], { z: 12.345 })], catalog, generationRunId: 's-1' },
    );
    expect(surveyPointOf(built.project, 'P1').pointLabelStyleId).toBe('point-label-point-number');
    const label = labelOf(built.project, 'P1');
    expect(label.pointLabel).toEqual({
      pointEntityId: 'pt:P1',
      labelStyleId: 'point-label-point-number',
      content: { mode: 'derived' },
    });
    expect(label.text).toBe('P1');

    // Unknown labelStyleId → F2F Full compat (legacy text, byte-identical).
    const fallback = catalogWith([pointDef({ labelStyleId: 'label-style-no-such' })]);
    const rebuilt = buildFieldToFinishProject(
      createBlankCadProject({ name: 'F2F styles', units: 'm' }),
      { points: [pt('P1', 0, 0, 1, ['EP'], { z: 12.345 })], catalog: fallback, generationRunId: 's-2' },
    );
    expect(surveyPointOf(rebuilt.project, 'P1').pointLabelStyleId).toBe(F2F_FULL_LABEL_STYLE_ID);
    const fallbackLabel = labelOf(rebuilt.project, 'P1');
    const full = DEFAULT_CAD_POINT_LABEL_STYLES.find((style) => style.id === F2F_FULL_LABEL_STYLE_ID)!;
    expect(fallbackLabel.text).toBe(
      buildPointLabelContent(
        { stationId: 'P1', x: 0, y: 0, z: 12.345, description: 'desc-P1', featureCode: 'EP' },
        full,
      ),
    );
    expect(fallbackLabel.text).toBe('P1 desc-P1 EP EL 12.345');
  });

  it('regen updates BASE refs but preserves manual overrides, manual label text, and offset', () => {
    const before = catalogWith([pointDef({ pointStyleId: 'point-style-tree' })]);
    const args = { points: [pt('P1', 0, 0, 1, ['EP'])], catalog: before, generationRunId: 's-1' };
    let project = buildFieldToFinishProject(
      createBlankCadProject({ name: 'F2F styles', units: 'm' }),
      args,
    ).project;
    // Operator overrides (state stays GENERATED): manual fields must survive.
    // Manual label content + placement must survive.
    project = {
      ...project,
      entities: project.entities.map((entity) => {
        if (entity.id === 'pt:P1' && entity.type === 'survey-point') {
          return {
            ...entity,
            pointStyleOverrideId: 'point-style-control',
            pointLabelStyleOverrideId: 'point-label-none',
          };
        }
        if (entity.id === 'label:P1' && entity.type === 'text') {
          return {
            ...entity,
            x: entity.x + 3,
            y: entity.y + 4,
            text: 'hand-edited',
            pointLabel: {
              pointEntityId: 'pt:P1',
              labelStyleId: F2F_FULL_LABEL_STYLE_ID,
              offsetOverride: { dx: 3, dy: 4 },
              content: { mode: 'manual', text: 'hand-edited' },
            },
          };
        }
        return entity;
      }),
    };

    const after = catalogWith([
      pointDef({ pointStyleId: 'point-style-utility', labelStyleId: 'point-label-point-number' }),
    ]);
    const regen = applyFieldToFinishRegen(
      project,
      { points: [pt('P1', 0, 0, 1, ['EP'])], catalog: after, generationRunId: 's-2' },
      'styles-18d',
      { confirmed: true },
    );
    const point = surveyPointOf(regen.project, 'P1');
    expect(point.pointStyleId).toBe('point-style-utility');
    expect(point.pointLabelStyleId).toBe('point-label-point-number');
    expect(point.pointStyleOverrideId).toBe('point-style-control');
    expect(point.pointLabelStyleOverrideId).toBe('point-label-none');
    const label = labelOf(regen.project, 'P1');
    expect(label.text).toBe('hand-edited');
    expect(label.x).toBe(3);
    expect(label.y).toBe(4);
    expect(label.pointLabel?.content).toEqual({ mode: 'manual', text: 'hand-edited' });
    expect(label.pointLabel).toMatchObject({ offsetOverride: { dx: 3, dy: 4 } });
    // Base style ref on the binding still follows the catalog.
    expect(label.pointLabel?.labelStyleId).toBe('point-label-point-number');
  });

  it('keeps unknown codes on F2F-UNMAPPED with a default style and a visible label', () => {
    const catalog = catalogWith([pointDef()]);
    const built = buildFieldToFinishProject(
      createBlankCadProject({ name: 'F2F styles', units: 'm' }),
      { points: [pt('R1', 9, 9, 1, ['ROCK'])], catalog, generationRunId: 's-1' },
    );
    const point = surveyPointOf(built.project, 'R1');
    expect(point.layerId).toBe('f2f-layer-unmapped');
    expect(point.pointStyleId).toBe(DEFAULT_CAD_POINT_STYLE_ID);
    const label = labelOf(built.project, 'R1');
    expect(label.pointLabel?.content).toEqual({ mode: 'derived' });
    expect(label.text).toContain('R1');
  });

  it('assigns styles from the primary definition on multi-code points', () => {
    const catalog = catalogWith([
      { ...pointDef(), id: 'cl', code: 'CL', layer: 'F2F-CL', pointStyleId: 'point-style-control' },
      { ...pointDef(), id: 'ep', code: 'EP', layer: 'F2F-EP', pointStyleId: 'point-style-tree' },
    ]);
    const base = createBlankCadProject({ name: 'F2F styles', units: 'm' });
    const first = buildFieldToFinishProject(
      base,
      { points: [pt('P1', 0, 0, 1, ['CL', 'EP'])], catalog, generationRunId: 's-1' },
    );
    // First point-role match wins: CL is primary.
    expect(surveyPointOf(first.project, 'P1').pointStyleId).toBe('point-style-control');
    expect(surveyPointOf(first.project, 'P1').featureCode).toBe('CL');
    const second = buildFieldToFinishProject(
      base,
      { points: [pt('P1', 0, 0, 1, ['EP', 'CL'])], catalog, generationRunId: 's-2' },
    );
    expect(surveyPointOf(second.project, 'P1').pointStyleId).toBe('point-style-tree');
  });

  it('round-trips pointStyleId additively; legacy catalogs stay key-identical', () => {
    const catalog = catalogWith([
      pointDef({ pointStyleId: 'point-style-tree', labelStyleId: 'point-label-elevation' }),
    ]);
    const imported = importCatalog(exportCatalog(catalog));
    expect(imported.issues).toEqual([]);
    expect(imported.catalog?.definitions[0]).toMatchObject({
      pointStyleId: 'point-style-tree',
      labelStyleId: 'point-label-elevation',
    });

    const legacyJson = JSON.stringify({
      schema: 'webnet.feature-catalog',
      schemaVersion: 1,
      id: 'legacy',
      name: 'Legacy',
      version: '1',
      definitions: [
        {
          id: 'ep', code: 'EP', description: '', layer: 'L',
          pointSymbolId: 's', styleId: 'st', labelStyleId: 'ls',
          pointBehavior: 'point',
          lineworkBehavior: { enabled: false, implicitContinuation: false },
        },
      ],
      aliases: [],
    });
    const legacy = importCatalog(legacyJson);
    expect(legacy.catalog).not.toBeNull();
    expect(legacy.catalog?.definitions[0]?.pointStyleId).toBeUndefined();
    expect(JSON.stringify(JSON.parse(exportCatalog(legacy.catalog!)).definitions[0])).not.toContain('pointStyleId');
  });

  it('reports unresolved style refs as warnings while import succeeds', () => {
    const catalog = catalogWith([
      pointDef({
        pointStyleId: 'point-style-no-such',
        labelStyleId: 'label-style-no-such',
        pointSymbolId: 'symbol-no-such',
      }),
    ]);
    const blank = createBlankCadProject({ name: 'F2F styles', units: 'm' });
    const issues = validateCatalogStyleReferences(catalog, {
      pointStyles: blank.pointStyles ?? [],
      labelStyles: blank.labelStyles ?? [],
      pointSymbols: blank.styleLibrary.pointSymbols,
    });
    expect(issues).toHaveLength(3);
    expect(issues.every((issue) => issue.severity === 'warning')).toBe(true);
    // Import itself still succeeds — refs pass through, generation falls back.
    expect(importCatalog(exportCatalog(catalog)).catalog).not.toBeNull();
  });

  it('migrates legacy unbound labels on regen only, leaving non-F2F labels free', () => {
    const catalog = catalogWith([pointDef()]);
    const args = { points: [pt('P1', 0, 0, 1, ['EP'])], catalog, generationRunId: 's-1' };
    let project = buildFieldToFinishProject(
      createBlankCadProject({ name: 'F2F styles', units: 'm' }),
      args,
    ).project;
    const full = DEFAULT_CAD_POINT_LABEL_STYLES.find((style) => style.id === F2F_FULL_LABEL_STYLE_ID)!;
    const expected = buildPointLabelContent(
      { stationId: 'P1', x: 0, y: 0, description: 'desc-P1', featureCode: 'EP' },
      full,
    );
    // Simulate legacy files: matching label, bumped label, and a non-F2F label.
    const legacyMatching: CadTextEntity = {
      id: 'label:legacy-match', type: 'text', layerId: 'labels', styleId: 'style-label',
      visible: true, locked: false, x: 0, y: 0, text: expected, anchorEntityId: 'pt:P1',
      metadata: {
        stationId: 'P1',
        provenance: { generatedBy: 'FIELD_TO_FINISH', state: 'GENERATED' },
      },
    };
    const legacyBumped: CadTextEntity = {
      ...legacyMatching, id: 'label:legacy-bump', y: 0.5,
    };
    const plain: CadTextEntity = {
      ...legacyMatching, id: 'label:plain', metadata: { stationId: 'P1' },
    };
    project = { ...project, entities: [...project.entities, legacyMatching, legacyBumped, plain] };

    const regen = applyFieldToFinishRegen(project, { ...args, generationRunId: 's-2' }, 'styles-18d', {
      confirmed: true,
    });
    const byId = new Map(regen.project.entities.map((entity) => [entity.id, entity]));
    const match = byId.get('label:legacy-match');
    expect(match?.type === 'text' ? match.pointLabel : undefined).toEqual({
      pointEntityId: 'pt:P1',
      labelStyleId: F2F_FULL_LABEL_STYLE_ID,
      content: { mode: 'derived' },
    });
    const bump = byId.get('label:legacy-bump');
    expect(bump?.type === 'text' ? bump.pointLabel?.content : undefined).toEqual({
      mode: 'manual',
      text: expected,
    });
    const untouched = byId.get('label:plain');
    expect(untouched?.type === 'text' ? untouched.pointLabel : undefined).toBeUndefined();
  });
});
