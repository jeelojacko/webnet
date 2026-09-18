/**
 * Phase 18E engine subset (§84): drawing-owned F2F catalog + revision +
 * WNCAD persistence. Agent-tier fast: pure engine only, no UI.
 */
import { describe, expect, it } from 'vitest';

import {
  createBlankCadDrawingDocument,
  createBlankCadProject,
  migrateSurveyCadStateToDrawing,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import { cloneCadProject, sanitizeSurveyCadPersistedState } from '../src/engine/cad/cadPersistence';
import type { CadProject } from '../src/engine/cad/cadTypes';
import {
  exportCatalog,
  importCatalog,
  validateCatalog,
  validateCatalogStyleReferences,
} from '../src/engine/fieldToFinish/catalogIo';
import {
  backfillDrawingCatalog,
  drawingCatalogRevision,
  drawingFieldToFinishSource,
  getDrawingCatalogStatus,
  hasFieldToFinishContent,
} from '../src/engine/fieldToFinish/drawingCatalog';
import {
  buildFieldToFinishProject,
  type FieldToFinishCadPoint,
} from '../src/engine/fieldToFinish/cadGeneration';
import {
  diffFeatureCatalogs,
  computeFeatureCatalogRevision,
} from '../src/engine/fieldToFinish/catalogRevision';
import { cloneFeatureCatalog } from '../src/engine/fieldToFinish/featureCatalog';
import {
  buildFieldToFinishLink,
  classifyCatalogChange,
  computeSyncStatus,
  getFieldToFinishSyncStatus,
  stampCatalogStaleStatus,
} from '../src/engine/fieldToFinish/linkedSync';
import { SAMPLE_CATALOG } from '../src/engine/fieldToFinish/sampleCatalog';
import { STARTER_CATALOG } from '../src/engine/fieldToFinish/starterCatalog';

const pt = (stationId: string, x: number, code: string, sourceOrder: number): FieldToFinishCadPoint => ({
  stationId,
  x,
  y: 0,
  sourceOrder,
  codes: [{ code }],
});

const seedPoints = [pt('P1', 0, 'EP', 1), pt('P2', 10, 'EP', 2)];

const generateSeeded = (project: CadProject, runId = 'run-1'): CadProject => {
  const source = drawingFieldToFinishSource(project);
  expect(source).toBeDefined();
  return buildFieldToFinishProject(project, {
    points: seedPoints,
    catalog: source!.catalog,
    controlTokenAliases: source!.controlTokenAliases,
    generationRunId: runId,
  }).project;
};

describe('18e drawing-owned catalog', () => {
  it('blank drawings own a starter catalog and empty settings', () => {
    const project = createBlankCadProject({ name: 'D', units: 'm' });
    expect(project.fieldToFinishCatalog?.id).toBe('starter-survey');
    expect(project.fieldToFinishSettings).toEqual({});
    expect(getDrawingCatalogStatus(project)).toBe('READY');
    expect(hasFieldToFinishContent(project)).toBe(false);
  });

  it('clone deep-copies catalog and settings in trailing position', () => {
    const project = createBlankCadProject({ name: 'D', units: 'm' });
    const cloned = cloneCadProject(project);
    expect(cloned.fieldToFinishCatalog).toEqual(project.fieldToFinishCatalog);
    expect(cloned.fieldToFinishCatalog).not.toBe(project.fieldToFinishCatalog);
    // Trailing: catalog/settings serialize after pointGroups.
    const keys = Object.keys(JSON.parse(JSON.stringify(cloned)) as Record<string, unknown>);
    expect(keys.indexOf('fieldToFinishCatalog')).toBeGreaterThan(keys.indexOf('pointGroups'));
    expect(keys.indexOf('fieldToFinishSettings')).toBeGreaterThan(keys.indexOf('fieldToFinishCatalog'));
    // Signature settles: clone-of-clone is byte-identical.
    expect(JSON.stringify(cloneCadProject(cloned))).toBe(JSON.stringify(cloned));
  });

  it('two drawings are isolated: editing A never mutates B', () => {
    const a = createBlankCadProject({ name: 'A', units: 'm' });
    const b = cloneCadProject(a);
    const def = a.fieldToFinishCatalog!.definitions.find((d) => d.id === 'ep')!;
    def.layer = 'MUTATED';
    a.fieldToFinishSettings!.controlTokenAliases = { B: 'BEGIN' };
    expect(b.fieldToFinishCatalog!.definitions.find((d) => d.id === 'ep')!.layer).toBe('F2F-EDGE');
    expect(b.fieldToFinishSettings).toEqual({});
  });

  it('legacy with no F2F content seeds starter (migration A)', () => {
    const raw = JSON.parse(serializeCadDrawingFile(createBlankCadDrawingDocument({ units: 'm' })));
    delete raw.project.fieldToFinishCatalog;
    delete raw.project.fieldToFinishSettings;
    const parsed = parseCadDrawingFile(JSON.stringify(raw));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.drawing.project.fieldToFinishCatalog?.id).toBe('starter-survey');
    expect(parsed.drawing.project.fieldToFinishSettings).toEqual({});
    expect(getDrawingCatalogStatus(parsed.drawing.project)).toBe('READY');
  });

  it('legacy with F2F content but no catalog stays MISSING_LEGACY (migration B)', () => {
    const generated = generateSeeded(createBlankCadProject({ name: 'D', units: 'm' }));
    expect(hasFieldToFinishContent(generated)).toBe(true);
    const doc = createBlankCadDrawingDocument({ units: 'm' });
    const raw = JSON.parse(serializeCadDrawingFile({ ...doc, project: generated }));
    delete raw.project.fieldToFinishCatalog;
    delete raw.project.fieldToFinishSettings;
    const parsed = parseCadDrawingFile(JSON.stringify(raw));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.drawing.project.fieldToFinishCatalog).toBeUndefined();
    expect(getDrawingCatalogStatus(parsed.drawing.project)).toBe('MISSING_LEGACY');
    // Blocked: no generation source while missing.
    expect(drawingFieldToFinishSource(parsed.drawing.project)).toBeUndefined();
    // Provenance still surfaces the legacy catalog trace.
    const point = parsed.drawing.project.entities.find((e) => e.id === 'pt:P1');
    const provenance = (point?.metadata as Record<string, unknown> | undefined)?.['provenance'] as Record<string, unknown>;
    expect(provenance['catalogId']).toBe('starter-survey');
    expect(provenance['featureDefinitionId']).toBe('ep');
  });

  it('legacy persisted state backfills through the migrate helpers', () => {
    const blank = createBlankCadProject({ name: 'D', units: 'm' });
    const legacyState = JSON.parse(JSON.stringify({
      version: 1,
      sourceSignature: 'sig',
      project: { ...blank, fieldToFinishCatalog: undefined, fieldToFinishSettings: undefined },
    }));
    delete legacyState.project.fieldToFinishCatalog;
    delete legacyState.project.fieldToFinishSettings;
    const sanitized = sanitizeSurveyCadPersistedState(legacyState);
    expect(sanitized?.project.fieldToFinishCatalog?.id).toBe('starter-survey');
    const drawing = migrateSurveyCadStateToDrawing({ state: sanitized! });
    expect(drawing.project.fieldToFinishCatalog?.id).toBe('starter-survey');
  });

  it('backfill is idempotent and never overwrites an owned catalog', () => {
    const project = createBlankCadProject({ name: 'D', units: 'm' });
    const owned = { ...project, fieldToFinishCatalog: cloneFeatureCatalog(SAMPLE_CATALOG) };
    expect(backfillDrawingCatalog(owned).fieldToFinishCatalog?.id).toBe('sample-generic');
    expect(backfillDrawingCatalog(backfillDrawingCatalog(project))).toEqual(backfillDrawingCatalog(project));
  });
});

describe('18e revision semantics', () => {
  it('is stable, reorder-insensitive, edit-sensitive, version-blind', () => {
    const catalog = cloneFeatureCatalog(STARTER_CATALOG);
    const revision = computeFeatureCatalogRevision(catalog);
    expect(computeFeatureCatalogRevision(cloneFeatureCatalog(catalog))).toBe(revision);
    // Reorder-only edits do not dirty the link.
    const reordered = { ...catalog, definitions: [...catalog.definitions].reverse(), aliases: [...catalog.aliases] };
    expect(computeFeatureCatalogRevision(reordered)).toBe(revision);
    // Version-only edits never enter the revision.
    expect(computeFeatureCatalogRevision({ ...catalog, version: '999' })).toBe(revision);
    expect(classifyCatalogChange(catalog, { ...catalog, version: '999' })).toBeNull();
    // Semantic edits change it.
    const edited = cloneFeatureCatalog(catalog);
    edited.definitions.find((d) => d.id === 'ep')!.layer = 'OTHER';
    expect(computeFeatureCatalogRevision(edited)).not.toBe(revision);
    expect(classifyCatalogChange(catalog, edited)).toBe('CATALOG_CHANGED');
  });

  it('catalog edit stales the link and exact undo restores CURRENT (derived)', () => {
    const generated = generateSeeded(createBlankCadProject({ name: 'D', units: 'm' }));
    const link = generated.metadata.fieldToFinishLink!;
    // 17E link fields intact alongside the revision.
    expect(link.catalogId).toBe('starter-survey');
    expect(link.catalogRevision).toBe(drawingCatalogRevision(generated));
    expect(link.syncPolicy).toBe('manual');
    expect(getFieldToFinishSyncStatus(generated, { catalogRevision: drawingCatalogRevision(generated) })).toBe('CURRENT');

    const edited = cloneCadProject(generated);
    edited.fieldToFinishCatalog!.definitions.find((d) => d.id === 'ep')!.layer = 'CHANGED';
    expect(getFieldToFinishSyncStatus(edited, { catalogRevision: drawingCatalogRevision(edited) })).toBe('CATALOG_CHANGED');
    const stamped = stampCatalogStaleStatus(edited, 'CATALOG_CHANGED');
    expect(stamped.metadata.fieldToFinishLink?.status).toBe('CATALOG_CHANGED');

    // Exact restore (pre-edit clone) reads CURRENT again — no one-way latch.
    const restored = cloneCadProject(generated);
    expect(getFieldToFinishSyncStatus(restored, { catalogRevision: drawingCatalogRevision(restored) })).toBe('CURRENT');
  });

  it('wholesale replace stales; status precedence is preserved', () => {
    const generated = generateSeeded(createBlankCadProject({ name: 'D', units: 'm' }));
    const link = generated.metadata.fieldToFinishLink!;
    const replaced = { ...cloneCadProject(generated), fieldToFinishCatalog: cloneFeatureCatalog(SAMPLE_CATALOG) };
    const stale = { catalogRevision: drawingCatalogRevision(replaced) };
    expect(computeSyncStatus(link, stale)).toBe('CATALOG_CHANGED');
    // Precedence: manual conflict still outranks catalog change.
    expect(computeSyncStatus({ ...link, status: 'CURRENT' }, { ...stale, manualConflict: true })).toBe('MANUAL_CONFLICT');
    expect(computeSyncStatus({ ...link, status: 'CURRENT' }, { ...stale, sourceExists: false })).toBe('MISSING_SOURCE');
    expect(computeSyncStatus(undefined, stale)).toBe('UNLINKED');
  });

  it('legacy version-string links fail closed (stale, never false CURRENT)', () => {
    const legacy = buildFieldToFinishLink({
      generationRunId: 'old',
      catalogId: 'starter-survey',
      catalogRevision: '1',
      sourceRecordIds: [],
      stationIds: ['P1'],
      generatedEntityIds: [],
      generatedLabelIds: [],
    });
    const project = createBlankCadProject({ name: 'D', units: 'm' });
    expect(computeSyncStatus(legacy, { catalogRevision: drawingCatalogRevision(project) })).toBe('CATALOG_CHANGED');
  });
});

describe('18e persistence and interchange', () => {
  it('WNCAD roundtrip is semantically exact', () => {
    const doc = createBlankCadDrawingDocument({ units: 'm' });
    const parsed = parseCadDrawingFile(serializeCadDrawingFile(doc));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.drawing.project.fieldToFinishCatalog).toEqual(doc.project.fieldToFinishCatalog);
    expect(parsed.drawing.project.fieldToFinishSettings).toEqual(doc.project.fieldToFinishSettings);
  });

  it('save CURRENT / reopen CURRENT; save stale / reopen stale', () => {
    const generated = generateSeeded(createBlankCadProject({ name: 'D', units: 'm' }));
    const doc = { ...createBlankCadDrawingDocument({ units: 'm' }), project: generated };
    const reopened = parseCadDrawingFile(serializeCadDrawingFile(doc));
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    const link = reopened.drawing.project.metadata.fieldToFinishLink!;
    expect(link.status).toBe('CURRENT');
    expect(computeSyncStatus(link, { catalogRevision: drawingCatalogRevision(reopened.drawing.project) })).toBe('CURRENT');

    const edited = cloneCadProject(reopened.drawing.project);
    edited.fieldToFinishCatalog!.definitions.find((d) => d.id === 'cl')!.layer = 'CHANGED';
    const staleDoc = { ...doc, project: stampCatalogStaleStatus(edited, 'CATALOG_CHANGED') };
    const reopenedStale = parseCadDrawingFile(serializeCadDrawingFile(staleDoc));
    expect(reopenedStale.ok).toBe(true);
    if (!reopenedStale.ok) return;
    const staleLink = reopenedStale.drawing.project.metadata.fieldToFinishLink!;
    expect(staleLink.status).toBe('CATALOG_CHANGED');
    expect(computeSyncStatus(staleLink, { catalogRevision: drawingCatalogRevision(reopenedStale.drawing.project) }))
      .toBe('CATALOG_CHANGED');
  });

  it('control-token settings roundtrip and isolate per drawing', () => {
    const doc = createBlankCadDrawingDocument({ units: 'm' });
    doc.project.fieldToFinishSettings = { controlTokenAliases: { S: 'BEGIN' } };
    const parsed = parseCadDrawingFile(serializeCadDrawingFile(doc));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(drawingFieldToFinishSource(parsed.drawing.project)?.controlTokenAliases).toEqual({ S: 'BEGIN' });
    expect(drawingFieldToFinishSource(createBlankCadProject({ name: 'X', units: 'm' }))?.controlTokenAliases).toEqual({});
  });

  it('catalog JSON export/import roundtrips; malformed import leaves the drawing unchanged', () => {
    const project = createBlankCadProject({ name: 'D', units: 'm' });
    const before = JSON.stringify(project.fieldToFinishCatalog);
    const round = importCatalog(exportCatalog(project.fieldToFinishCatalog!));
    expect(round.catalog).toEqual(project.fieldToFinishCatalog);
    expect(round.issues).toEqual([]);
    // Atomic failure: malformed input yields null, drawing untouched.
    expect(importCatalog('{nope').catalog).toBeNull();
    expect(importCatalog(JSON.stringify({ schema: 'other' })).catalog).toBeNull();
    expect(JSON.stringify(project.fieldToFinishCatalog)).toBe(before);
  });

  it('rejects duplicate codes/ids and bad aliases; style refs stay warnings', () => {
    const base = cloneFeatureCatalog(STARTER_CATALOG);
    const dupCode = cloneFeatureCatalog(base);
    dupCode.definitions.push({ ...dupCode.definitions[0]!, id: 'other-id' });
    expect(validateCatalog(dupCode).some((i) => i.severity === 'error' && i.message.includes('Duplicate code'))).toBe(true);
    const dupId = cloneFeatureCatalog(base);
    dupId.definitions.push({ ...dupId.definitions[0]!, code: 'ZZZ' });
    expect(validateCatalog(dupId).some((i) => i.severity === 'error' && i.message.includes('Duplicate definition id'))).toBe(true);
    const badAlias = cloneFeatureCatalog(base);
    badAlias.aliases = [{ alias: 'NOPE', targetCode: 'MISSING' }];
    expect(validateCatalog(badAlias).some((i) => i.severity === 'error')).toBe(true);
    const dupAlias = cloneFeatureCatalog(base);
    dupAlias.aliases = [...dupAlias.aliases, { alias: 'eop', targetCode: 'EP' }];
    expect(validateCatalog(dupAlias).some((i) => i.severity === 'error' && i.message.includes('Duplicate alias'))).toBe(true);
    expect(validateCatalog(base).filter((i) => i.severity === 'error')).toEqual([]);
    // 18D: unresolved style refs are warnings, never errors.
    const styled = cloneFeatureCatalog(base);
    styled.definitions[0]!.pointStyleId = 'no-such-style';
    expect(validateCatalog(styled).filter((i) => i.severity === 'error')).toEqual([]);
    const styleIssues = validateCatalogStyleReferences(styled, { pointStyles: [], labelStyles: [], pointSymbols: [] });
    expect(styleIssues).toHaveLength(1);
    expect(styleIssues[0]!.severity).toBe('warning');
  });
});

describe('18e diff engine', () => {
  it('reports added/removed/changed/unchanged by stable id', () => {
    const current = cloneFeatureCatalog(STARTER_CATALOG);
    const incoming = cloneFeatureCatalog(STARTER_CATALOG);
    incoming.definitions.find((d) => d.id === 'ep')!.layer = 'NEW-LAYER';
    incoming.definitions = incoming.definitions.filter((d) => d.id !== 'mh');
    incoming.definitions.push({
      id: 'new', code: 'NEW', description: 'New', layer: 'F2F-NEW',
      pointBehavior: 'point', lineworkBehavior: { enabled: false, implicitContinuation: false },
    });
    const diff = diffFeatureCatalogs(current, incoming);
    expect(diff.added).toEqual(['new']);
    expect(diff.removed).toEqual(['mh']);
    expect(diff.changed).toEqual([{ id: 'ep', fields: ['layer'] }]);
    expect(diff.unchanged).toContain('cl');
    expect(diffFeatureCatalogs(current, cloneFeatureCatalog(current))).toEqual({ added: [], removed: [], changed: [], unchanged: expect.any(Array) });
  });
});

describe('18e generation compatibility', () => {
  it('starter generation preserves 18C layers and 18D label bindings', () => {
    const blank = createBlankCadProject({ name: 'D', units: 'm' });
    const standardLayers = blank.layers.map((l) => l.id);
    const generated = generateSeeded(blank);
    // Standard layers untouched; F2F layers added by name without duplicates.
    for (const id of standardLayers) {
      expect(generated.layers.some((l) => l.id === id)).toBe(true);
    }
    const names = generated.layers.map((l) => l.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('F2F-EDGE');
    // 18D: generated labels carry derived bindings.
    const label = generated.entities.find((e) => e.id === 'label:P1');
    expect(label?.type).toBe('text');
    if (label?.type === 'text') {
      expect(label.pointLabel?.content).toEqual({ mode: 'derived' });
    }
  });
});
