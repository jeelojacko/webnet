import { computeFeatureCatalogRevision } from '../src/engine/fieldToFinish/catalogRevision';
import { describe, expect, it } from 'vitest';

import {
  createBlankCadDrawingDocument,
  createBlankCadProject,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import {
  buildFieldToFinishProject,
  type FieldToFinishCadArgs,
  type FieldToFinishCadPoint,
} from '../src/engine/fieldToFinish/cadGeneration';
import type { FeatureCodeCatalog } from '../src/engine/fieldToFinish/featureCatalog';
import {
  buildFieldToFinishLink,
  buildSourceRevision,
  buildStationEntityIndex,
  classifyCatalogChange,
  computeSyncStatus,
  getFieldToFinishSyncStatus,
  stampCatalogStaleStatus,
  stampFieldToFinishLink,
} from '../src/engine/fieldToFinish/linkedSync';
import {
  detachFieldToFinishEntity,
  markFieldToFinishManualOverride,
} from '../src/engine/fieldToFinish/regeneration';

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

const revision = computeFeatureCatalogRevision(catalog);

const pt = (stationId: string, x: number, y: number, order: number): FieldToFinishCadPoint => ({
  stationId, x, y, sourceOrder: order,
  sourceLine: order,
  codes: [{ code: 'EP' }],
  rawCodeText: 'EP',
  sourceImportId: 'import-1',
});

const argsOf = (points: FieldToFinishCadPoint[], runId = 'run-1'): FieldToFinishCadArgs => ({
  points, catalog, generationRunId: runId,
});

const seedPoints = [pt('P1', 0, 0, 1), pt('P2', 10, 0, 2), pt('P3', 20, 0, 3)];

describe('cad f2f link', () => {
  it('stamps a link on generate', () => {
    const { project } = buildFieldToFinishProject(
      createBlankCadProject({ name: 'F2F', units: 'm' }),
      argsOf(seedPoints),
    );
    const link = project.metadata.fieldToFinishLink;
    expect(link).toBeDefined();
    expect(link?.generationRunId).toBe('run-1');
    expect(link?.catalogId).toBe('test-catalog');
    expect(link?.catalogRevision).toBe(revision);
    expect(link?.stationIds).toEqual(['P1', 'P2', 'P3']);
    expect(link?.status).toBe('CURRENT');
    expect(getFieldToFinishSyncStatus(project)).toBe('CURRENT');
  });

  it('round-trips the link through save/reopen with CURRENT intact', () => {
    const { project } = buildFieldToFinishProject(
      createBlankCadProject({ name: 'F2F', units: 'm' }),
      argsOf(seedPoints),
    );
    const link = buildFieldToFinishLink({
      generationRunId: 'run-1',
      catalogId: 'test-catalog',
      catalogRevision: revision,
      sourceKind: 'adjustment',
      inputFingerprint: 'in-1',
      settingsFingerprint: 'set-1',
      sourceRecordIds: linkSourceRecordIds(project.metadata.fieldToFinishLink?.sourceRecordIds),
      stationIds: ['P1', 'P2', 'P3'],
      generatedEntityIds: project.metadata.fieldToFinishLink?.generatedEntityIds ?? [],
      generatedLabelIds: project.metadata.fieldToFinishLink?.generatedLabelIds ?? [],
    });
    const document = {
      ...createBlankCadDrawingDocument({ name: 'F2F', units: 'm' }),
      project: { ...project, metadata: { ...project.metadata, fieldToFinishLink: link } },
    };
    const parsed = parseCadDrawingFile(serializeCadDrawingFile(document));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.drawing.project.metadata.fieldToFinishLink).toEqual(link);
    expect(getFieldToFinishSyncStatus(parsed.drawing.project, {
      sourceRevision: buildSourceRevision({ inputFingerprint: 'in-1', settingsFingerprint: 'set-1' }),
      catalogRevision: revision,
      stationIds: ['P1', 'P2', 'P3'],
    })).toBe('CURRENT');
  });

  it('classifies legacy docs without a link as UNLINKED', () => {
    const project = createBlankCadProject({ name: 'legacy', units: 'm' });
    expect(getFieldToFinishSyncStatus(project)).toBe('UNLINKED');
    expect(computeSyncStatus(undefined)).toBe('UNLINKED');
  });

  it('detects revision, catalog, topology, metadata, missing-source, and manual states', () => {
    const link = buildFieldToFinishLink({
      generationRunId: 'run-1',
      catalogId: 'test-catalog',
      catalogRevision: revision,
      sourceKind: 'adjustment',
      inputFingerprint: 'in-1',
      settingsFingerprint: 'set-1',
      sourceRecordIds: ['1', '2', '3'],
      stationIds: ['P1', 'P2', 'P3'],
      generatedEntityIds: ['pt:P1'],
      generatedLabelIds: ['label:P1'],
    });
    const base = {
      sourceRevision: buildSourceRevision({ inputFingerprint: 'in-1', settingsFingerprint: 'set-1' }),
      catalogRevision: revision,
      stationIds: ['P1', 'P2', 'P3'],
      sourceRecordIds: ['1', '2', '3'],
    };
    expect(computeSyncStatus(link, base)).toBe('CURRENT');
    expect(computeSyncStatus(link, {
      ...base,
      sourceRevision: buildSourceRevision({ inputFingerprint: 'in-2', settingsFingerprint: 'set-1' }),
    })).toBe('COORDINATES_CHANGED');
    expect(computeSyncStatus(link, { ...base, catalogRevision: '4' })).toBe('CATALOG_CHANGED');
    expect(computeSyncStatus(link, { ...base, stationIds: ['P1', 'P2'] })).toBe('SOURCE_TOPOLOGY_CHANGED');
    expect(computeSyncStatus(link, { ...base, sourceRecordIds: ['1', '2', '9'] })).toBe('FEATURE_METADATA_CHANGED');
    expect(computeSyncStatus(link, { ...base, sourceExists: false })).toBe('MISSING_SOURCE');
    expect(computeSyncStatus(link, { ...base, manualConflict: true })).toBe('MANUAL_CONFLICT');
  });

  it('leaves MANUAL_OVERRIDE/DETACHED states untouched', () => {
    const { project } = buildFieldToFinishProject(
      createBlankCadProject({ name: 'F2F', units: 'm' }),
      argsOf(seedPoints),
    );
    const pointId = 'pt:P1';
    const overridden = markFieldToFinishManualOverride(project, pointId);
    const detached = detachFieldToFinishEntity(project, 'pt:P2');
    const overriddenEntity = overridden.entities.find((entity) => entity.id === pointId);
    const detachedEntity = detached.entities.find((entity) => entity.id === 'pt:P2');
    expect((overriddenEntity?.metadata as Record<string, unknown> | undefined)?.['provenance'])
      .toMatchObject({ state: 'MANUAL_OVERRIDE' });
    expect((detachedEntity?.metadata as Record<string, unknown> | undefined)?.['provenance'])
      .toMatchObject({ state: 'DETACHED' });
    // Link still stamped + CURRENT by default snapshot.
    expect(overridden.metadata.fieldToFinishLink?.generationRunId).toBe('run-1');
    expect(getFieldToFinishSyncStatus(overridden)).toBe('CURRENT');
  });

  it('exposes a station->entity index from provenance conventions', () => {
    const { project } = buildFieldToFinishProject(
      createBlankCadProject({ name: 'F2F', units: 'm' }),
      argsOf(seedPoints),
    );
    const index = buildStationEntityIndex(project);
    expect(index['P1']?.pointEntityId).toBe('pt:P1');
    expect(index['P1']?.labelEntityId).toBe('label:P1');
    expect(Object.keys(index).sort()).toEqual(['P1', 'P2', 'P3']);
  });

  it('builds link record ids from point records only (no label derivatives)', () => {
    const { project } = buildFieldToFinishProject(
      createBlankCadProject({ name: 'F2F', units: 'm' }),
      argsOf(seedPoints),
    );
    const link = project.metadata.fieldToFinishLink;
    // Raw source-record snapshot: sourceLine ids only, no `<record>:label`.
    expect(link?.sourceRecordIds).toEqual(['1', '2', '3']);
    expect(getFieldToFinishSyncStatus(project, {
      catalogRevision: revision,
      stationIds: ['P1', 'P2', 'P3'],
      sourceRecordIds: ['1', '2', '3'],
    })).toBe('CURRENT');
  });

  it('compares id sets by content, not duplicate-bearing length', () => {
    const link = buildFieldToFinishLink({
      generationRunId: 'run-1',
      catalogId: 'test-catalog',
      catalogRevision: revision,
      sourceKind: 'adjustment',
      inputFingerprint: 'in-1',
      settingsFingerprint: 'set-1',
      sourceRecordIds: ['1', '1', '2'],
      stationIds: ['P1', 'P2', 'P2'],
      generatedEntityIds: ['pt:P1'],
      generatedLabelIds: ['label:P1'],
    });
    // Construction canonicalizes: deduped + sorted.
    expect(link.sourceRecordIds).toEqual(['1', '2']);
    expect(link.stationIds).toEqual(['P1', 'P2']);
    // Duplicate-bearing snapshots compare by set content: ['1','1'] vs
    // ['1','2'] is a real drift, ['P1','P1','P2'] vs ['P1','P2'] is not.
    const base = {
      sourceRevision: buildSourceRevision({ inputFingerprint: 'in-1', settingsFingerprint: 'set-1' }),
      catalogRevision: revision,
      stationIds: ['P1', 'P1', 'P2'],
      sourceRecordIds: ['1', '2', '2'],
    };
    expect(computeSyncStatus(link, base)).toBe('CURRENT');
    expect(computeSyncStatus(link, { ...base, sourceRecordIds: ['1', '1'] })).toBe('FEATURE_METADATA_CHANGED');
    expect(computeSyncStatus(link, { ...base, stationIds: ['P1', 'P2', 'P3'] })).toBe('SOURCE_TOPOLOGY_CHANGED');
  });

  it('classifies catalog edits by content revision, not version string', () => {
    // Version-only edits never enter the revision: no staleness.
    const editedVersion = { ...catalog, version: '4' };
    expect(classifyCatalogChange(catalog, editedVersion)).toBeNull();
    // Semantic edits dirty the link regardless of the version string.
    const editedDefs = {
      ...catalog,
      definitions: catalog.definitions.map((def) =>
        def.id === 'ep' ? { ...def, layer: 'RD-EP2' } : def,
      ),
    };
    expect(classifyCatalogChange(catalog, editedDefs)).toBe('CATALOG_CHANGED');
    const editedAliases = { ...catalog, aliases: [{ alias: 'E', targetCode: 'EP' }] };
    expect(classifyCatalogChange(catalog, editedAliases)).toBe('CATALOG_CHANGED');
    expect(classifyCatalogChange(catalog, catalog)).toBeNull();
    expect(classifyCatalogChange(catalog, { ...catalog })).toBeNull();
  });

  it('stamps catalog staleness without touching entities', () => {
    const { project } = buildFieldToFinishProject(
      createBlankCadProject({ name: 'F2F', units: 'm' }),
      argsOf(seedPoints),
    );
    const before = JSON.stringify(project.entities);
    const stale = stampCatalogStaleStatus(project, 'CATALOG_CHANGED');
    expect(stale.metadata.fieldToFinishLink?.status).toBe('CATALOG_CHANGED');
    expect(JSON.stringify(stale.entities)).toBe(before);
    // Idempotent: already stale restamps to the identical project.
    expect(stampCatalogStaleStatus(stale, 'CATALOG_CHANGED')).toBe(stale);
    // Higher-precedence states are preserved, never downgraded.
    const conflicted = stampFieldToFinishLink(stale, { status: 'MANUAL_CONFLICT' });
    expect(stampCatalogStaleStatus(conflicted, 'FEATURE_METADATA_CHANGED')).toBe(conflicted);
    // No link: identical project back.
    const bare = createBlankCadProject({ name: 'bare', units: 'm' });
    expect(stampCatalogStaleStatus(bare, 'CATALOG_CHANGED')).toBe(bare);
  });
});

const linkSourceRecordIds = (ids: readonly string[] | undefined): string[] => [...(ids ?? [])];
