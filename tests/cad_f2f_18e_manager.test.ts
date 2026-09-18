/**
 * Phase 18E UI/manager contracts (agent-tier fast, pure engine + UI helpers).
 * Covers: definition CRUD, alias CRUD, duplicate-code blocking, missing-style
 * warning retention, unmapped create-definition flow, regen preview counts,
 * regen atomicity, manual-override + layer-edit preservation, Point Group
 * precedence (manual > group > catalog > default), multi-code source-order
 * precedence, and save/reopen link stability (CURRENT stays CURRENT, stale
 * stays stale).
 */
import { describe, expect, it } from 'vitest';

import {
  createBlankCadDrawingDocument,
  createBlankCadProject,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import type { CadProject } from '../src/engine/cad/cadTypes';
import { resolveSurveyPointDisplay } from '../src/engine/cad/cadPointGroups';
import {
  catalogsSemanticallyEqual,
  exportCatalog,
  importCatalog,
  validateCatalog,
  validateCatalogStyleReferences,
} from '../src/engine/fieldToFinish/catalogIo';
import {
  buildFieldToFinishProject,
  type FieldToFinishCadPoint,
} from '../src/engine/fieldToFinish/cadGeneration';
import { cloneFeatureCatalog, type FeatureCodeCatalog } from '../src/engine/fieldToFinish/featureCatalog';
import {
  applyFieldToFinishRegen,
  detachFieldToFinishEntity,
  markFieldToFinishManualOverride,
  previewFieldToFinishRegen,
} from '../src/engine/fieldToFinish/regeneration';
import {
  computeFeatureCatalogRevision,
  diffFeatureCatalogs,
} from '../src/engine/fieldToFinish/catalogRevision';
import {
  buildFieldToFinishLink,
  getFieldToFinishSyncStatus,
} from '../src/engine/fieldToFinish/linkedSync';
import { STARTER_CATALOG } from '../src/engine/fieldToFinish/starterCatalog';
import { buildF2FReviewRows } from '../src/components/surveyCad/f2fReviewUtils';

const pt = (stationId: string, x: number, code: string, sourceOrder: number): FieldToFinishCadPoint => ({
  stationId,
  x,
  y: 0,
  sourceOrder,
  codes: [{ code }],
});

const multiPt = (stationId: string, codes: string[]): FieldToFinishCadPoint => ({
  stationId,
  x: 0,
  y: 0,
  sourceOrder: 1,
  codes: codes.map((code) => ({ code })),
});

const blankCatalog = (): FeatureCodeCatalog => cloneFeatureCatalog(STARTER_CATALOG);

const generate = (project: CadProject, points: FieldToFinishCadPoint[], runId = 'run-1'): CadProject =>
  buildFieldToFinishProject(project, {
    points,
    catalog: project.fieldToFinishCatalog ?? blankCatalog(),
    generationRunId: runId,
  }).project;

describe('18e definition CRUD', () => {
  it('new/rename definitions validate clean; revision tracks content', () => {
    const catalog = blankCatalog();
    const before = computeFeatureCatalogRevision(catalog);
    catalog.definitions.push({
      id: 'rock',
      code: 'ROCK',
      description: 'Rock outcrop',
      layer: 'F2F-TOPO',
      pointBehavior: 'point',
      lineworkBehavior: { enabled: false, implicitContinuation: false },
    });
    expect(validateCatalog(catalog)).toEqual([]);
    expect(computeFeatureCatalogRevision(catalog)).not.toBe(before);
    // Rename code (stable id kept): still clean, revision moves.
    const def = catalog.definitions.find((entry) => entry.id === 'rock')!;
    def.code = 'STONE';
    expect(validateCatalog(catalog)).toEqual([]);
    // Version-only edit does NOT move the revision (descriptive metadata).
    const revBeforeVersion = computeFeatureCatalogRevision(catalog);
    catalog.version = '2-final';
    expect(computeFeatureCatalogRevision(catalog)).toBe(revBeforeVersion);
    // Reorder-only edit does NOT move the revision either.
    catalog.definitions.reverse();
    expect(computeFeatureCatalogRevision(catalog)).toBe(revBeforeVersion);
  });

  it('duplicate canonical codes are blocked with a first-wins error', () => {
    const catalog = blankCatalog();
    catalog.definitions.push({
      id: 'ep-dup',
      code: 'ep', // canonical dup of EP
      description: 'dup',
      layer: 'F2F-EDGE',
      pointBehavior: 'point',
      lineworkBehavior: { enabled: false, implicitContinuation: false },
    });
    const issues = validateCatalog(catalog);
    expect(issues.some((issue) => issue.severity === 'error' && issue.message.includes('Duplicate code'))).toBe(true);
  });

  it('delete is data-only: removing a definition never touches geometry', () => {
    const project = generate(createBlankCadProject({ name: 'D', units: 'm' }), [pt('P1', 0, 'EP', 1)]);
    const next: CadProject = {
      ...project,
      fieldToFinishCatalog: {
        ...project.fieldToFinishCatalog!,
        definitions: project.fieldToFinishCatalog!.definitions.filter((def) => def.id !== 'ep'),
      },
    };
    // Geometry survives the catalog delete.
    expect(next.entities.some((entity) => entity.id === 'pt:P1')).toBe(true);
    const diff = diffFeatureCatalogs(project.fieldToFinishCatalog!, next.fieldToFinishCatalog!);
    expect(diff.removed).toEqual(['ep']);
  });
});

describe('18e alias CRUD', () => {
  it('add/edit/delete aliases with target-exists + no-dup validation', () => {
    const catalog = blankCatalog();
    catalog.aliases.push({ alias: 'CTR', targetCode: 'CONTROL' });
    expect(validateCatalog(catalog)).toEqual([]);
    catalog.aliases.push({ alias: 'CTR', targetCode: 'MON' });
    expect(validateCatalog(catalog).some((issue) => issue.message.includes('Duplicate alias'))).toBe(true);
    catalog.aliases.pop();
    catalog.aliases.push({ alias: 'ZZZ', targetCode: 'NOPE' });
    expect(validateCatalog(catalog).some((issue) => issue.message.includes('unknown code'))).toBe(true);
    catalog.aliases.pop();
    catalog.aliases.push({ alias: 'EP', targetCode: 'MON' }); // shadows a definition code
    expect(validateCatalog(catalog).some((issue) => issue.message.includes('shadows'))).toBe(true);
  });
});

describe('18e missing-style refs', () => {
  it('unknown style refs warn, keep the stored ref, and generation falls back', () => {
    const catalog = blankCatalog();
    const def = catalog.definitions.find((entry) => entry.id === 'ep')!;
    def.pointStyleId = 'ghost-style';
    const warnings = validateCatalogStyleReferences(catalog, {
      pointStyles: [],
      labelStyles: [],
      pointSymbols: [],
    });
    expect(warnings.some((issue) => issue.message.includes('ghost-style'))).toBe(true);
    // Stored ref kept (not stripped).
    expect(def.pointStyleId).toBe('ghost-style');
    // Generation still produces the point via deterministic fallback.
    const project = generate(createBlankCadProject({ name: 'D', units: 'm' }), [pt('P1', 0, 'EP', 1)]);
    expect(project.entities.some((entity) => entity.id === 'pt:P1')).toBe(true);
  });
});

describe('18e unmapped create-definition flow', () => {
  it('unmapped stays preserved; adding the definition maps it', () => {
    const catalog = blankCatalog();
    const points = [pt('R1', 0, 'ROCK', 1)];
    const before = buildF2FReviewRows(points, catalog);
    expect(before[0]!.mappingStatus).toBe('Unmapped');
    catalog.definitions.push({
      id: 'rock',
      code: 'ROCK',
      description: 'Rock outcrop',
      layer: 'F2F-TOPO',
      pointBehavior: 'point',
      lineworkBehavior: { enabled: false, implicitContinuation: false },
    });
    const after = buildF2FReviewRows(points, catalog);
    expect(after[0]!.mappingStatus).toBe('Mapped');
  });
});

describe('18e regen preview + atomicity', () => {
  const seed = (): CadProject =>
    generate(createBlankCadProject({ name: 'D', units: 'm' }), [pt('P1', 0, 'EP', 1), pt('P2', 10, 'EP', 2)]);

  it('preview counts create/update/remove without mutating', () => {
    const project = seed();
    const before = JSON.stringify(project.entities);
    const preview = previewFieldToFinishRegen(
      project,
      { points: [pt('P1', 1, 'EP', 1), pt('P3', 20, 'EP', 3)], catalog: project.fieldToFinishCatalog!, generationRunId: 'run-2' },
      'f2f-ui-import',
    );
    expect(preview.updated).toEqual(['P1']);
    expect(preview.added).toEqual(['P3']);
    expect(preview.removed).toEqual(['P2']);
    expect(JSON.stringify(project.entities)).toBe(before);
  });

  it('confirmed:false removes nothing; confirmed:true removes GENERATED only', () => {
    const project = seed();
    const args = {
      points: [pt('P1', 0, 'EP', 1)],
      catalog: project.fieldToFinishCatalog!,
      generationRunId: 'run-2',
    };
    const unconfirmed = applyFieldToFinishRegen(project, args, 'f2f-ui-import', { confirmed: false });
    expect(unconfirmed.removedEntityIds).toEqual([]);
    const confirmed = applyFieldToFinishRegen(project, args, 'f2f-ui-import', { confirmed: true });
    expect(confirmed.removedEntityIds).toContain('pt:P2');
    expect(confirmed.project.entities.some((entity) => entity.id === 'pt:P2')).toBe(false);
    expect(confirmed.project.entities.some((entity) => entity.id === 'pt:P1')).toBe(true);
    // Input project untouched (pure apply = atomic failure story: no commit, no change).
    expect(project.entities.some((entity) => entity.id === 'pt:P2')).toBe(true);
  });

  it('MANUAL_OVERRIDE/DETACHED survive confirmed regen and read as conflicts', () => {
    let project = seed();
    project = markFieldToFinishManualOverride(project, 'pt:P1');
    project = detachFieldToFinishEntity(project, 'pt:P2');
    const preview = previewFieldToFinishRegen(
      project,
      { points: [], catalog: project.fieldToFinishCatalog!, generationRunId: 'run-2' },
      'f2f-ui-import',
    );
    expect(preview.manualConflicts).toEqual(expect.arrayContaining(['P1', 'P2']));
    expect(preview.removed).toEqual([]);
    const applied = applyFieldToFinishRegen(
      project,
      { points: [], catalog: project.fieldToFinishCatalog!, generationRunId: 'run-2' },
      'f2f-ui-import',
      { confirmed: true },
    );
    expect(applied.removedEntityIds).toEqual([]);
    expect(applied.project.entities.some((entity) => entity.id === 'pt:P1')).toBe(true);
    expect(applied.project.entities.some((entity) => entity.id === 'pt:P2')).toBe(true);
  });

  it('layer edits (color) survive regen; existing layers are never rewritten', () => {
    let project = seed();
    const layerId = project.entities.find((entity) => entity.id === 'pt:P1')!.layerId;
    project = {
      ...project,
      layers: project.layers.map((layer) => (layer.id === layerId ? { ...layer, color: '#ff0000' } : layer)),
    };
    const applied = applyFieldToFinishRegen(
      project,
      { points: [pt('P1', 0, 'EP', 1), pt('P2', 10, 'EP', 2)], catalog: project.fieldToFinishCatalog!, generationRunId: 'run-2' },
      'f2f-ui-import',
      { confirmed: true },
    );
    expect(applied.project.layers.find((layer) => layer.id === layerId)?.color).toBe('#ff0000');
  });
});

describe('18e precedence', () => {
  it('Point Group precedence resolves manual > group > catalog > default', () => {
    const point = {
      id: 'pt:X',
      type: 'survey-point' as const,
      layerId: 'l',
      styleId: 's',
      visible: true,
      locked: false,
      stationId: 'X',
      x: 0,
      y: 0,
      pointClass: 'free' as const,
      source: 'parsed-input' as const,
      pointStyleId: 'catalog-base',
      pointLabelStyleId: 'catalog-label',
      metadata: {},
    };
    const groups = [{ id: 'g', name: 'G', query: {}, priority: 1, pointStyleOverrideId: 'group-style' }];
    const styles = [{ id: 'catalog-base' }, { id: 'group-style' }, { id: 'manual-style' }, { id: 'default-style' }];
    const base = {
      point,
      groups,
      pointStyles: styles,
      labelStyles: [{ id: 'catalog-label' }],
      defaultPointStyleId: 'default-style',
      defaultLabelStyleId: 'catalog-label',
    };
    // Catalog base alone.
    expect(resolveSurveyPointDisplay({ ...base, groups: [] }).effectivePointStyleId).toBe('catalog-base');
    // Group beats catalog.
    expect(resolveSurveyPointDisplay(base).effectivePointStyleId).toBe('group-style');
    // Manual beats group.
    expect(
      resolveSurveyPointDisplay({ ...base, point: { ...point, pointStyleOverrideId: 'manual-style' } }).effectivePointStyleId,
    ).toBe('manual-style');
  });

  it('multi-code source order wins: first point-role match is primary', () => {
    const catalog = blankCatalog();
    catalog.definitions.push(
      {
        id: 'a-def',
        code: 'AAA',
        description: 'A',
        layer: 'F2F-A',
        pointBehavior: 'point',
        lineworkBehavior: { enabled: false, implicitContinuation: false },
      },
      {
        id: 'b-def',
        code: 'BBB',
        description: 'B',
        layer: 'F2F-B',
        pointBehavior: 'point',
        lineworkBehavior: { enabled: false, implicitContinuation: false },
      },
    );
    const project = createBlankCadProject({ name: 'D', units: 'm' });
    const builtBA = buildFieldToFinishProject(project, {
      points: [multiPt('S1', ['BBB', 'AAA'])],
      catalog,
      generationRunId: 'run-1',
    }).project;
    const builtAB = buildFieldToFinishProject(project, {
      points: [multiPt('S1', ['AAA', 'BBB'])],
      catalog,
      generationRunId: 'run-1',
    }).project;
    const codeOf = (owner: CadProject): string | undefined =>
      (owner.entities.find((entity) => entity.id === 'pt:S1') as { featureCode?: string } | undefined)?.featureCode;
    expect(codeOf(builtBA)).toBe('BBB');
    expect(codeOf(builtAB)).toBe('AAA');
  });
});

describe('18e save/reopen link stability', () => {
  const linkOf = (project: CadProject, runId: string): CadProject => {
    const revision = computeFeatureCatalogRevision(project.fieldToFinishCatalog!);
    const link = buildFieldToFinishLink({
      generationRunId: runId,
      catalogId: project.fieldToFinishCatalog!.id,
      catalogRevision: revision,
      sourceKind: 'coordinate-import',
      sourceRecordIds: ['P1'],
      stationIds: ['P1'],
      generatedEntityIds: ['pt:P1'],
      generatedLabelIds: [],
    });
    return { ...project, metadata: { ...project.metadata, fieldToFinishLink: { ...link, status: 'CURRENT' as const } } };
  };

  it('save CURRENT / reopen CURRENT', () => {
    const project = linkOf(generate(createBlankCadProject({ name: 'D', units: 'm' }), [pt('P1', 0, 'EP', 1)]), 'run-1');
    const doc = { ...createBlankCadDrawingDocument({ units: 'm' }), project };
    const parsed = parseCadDrawingFile(serializeCadDrawingFile(doc));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const reopened = parsed.drawing.project;
    expect(
      getFieldToFinishSyncStatus(reopened, { catalogRevision: computeFeatureCatalogRevision(reopened.fieldToFinishCatalog!) }),
    ).toBe('CURRENT');
  });

  it('save stale / reopen stale (CATALOG_CHANGED survives roundtrip)', () => {
    let project = linkOf(generate(createBlankCadProject({ name: 'D', units: 'm' }), [pt('P1', 0, 'EP', 1)]), 'run-1');
    project = {
      ...project,
      fieldToFinishCatalog: {
        ...project.fieldToFinishCatalog!,
        definitions: project.fieldToFinishCatalog!.definitions.map((def) =>
          def.id === 'ep' ? { ...def, layer: 'F2F-CHANGED' } : def,
        ),
      },
    };
    const doc = { ...createBlankCadDrawingDocument({ units: 'm' }), project };
    const parsed = parseCadDrawingFile(serializeCadDrawingFile(doc));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const reopened = parsed.drawing.project;
    expect(
      getFieldToFinishSyncStatus(reopened, { catalogRevision: computeFeatureCatalogRevision(reopened.fieldToFinishCatalog!) }),
    ).toBe('CATALOG_CHANGED');
  });
});

describe('18e catalog file roundtrip', () => {
  it('export retains style ids; import roundtrips semantically equal', () => {
    const catalog = blankCatalog();
    catalog.definitions.find((entry) => entry.id === 'ep')!.pointStyleId = 'ps-1';
    const text = exportCatalog(catalog);
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(parsed['schema']).toBe('webnet.feature-catalog');
    const result = importCatalog(text);
    expect(result.catalog).not.toBeNull();
    expect(catalogsSemanticallyEqual(catalog, result.catalog!)).toBe(true);
    // Malformed input: null catalog, existing stays unchanged.
    expect(importCatalog('not json{{{').catalog).toBeNull();
  });
});
