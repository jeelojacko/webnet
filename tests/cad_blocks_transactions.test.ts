// Phase 18N block transactions: eligible-set validation (explicit codes,
// never silent loss), one-undoable lifecycle, reference safety on delete.
import { describe, expect, it } from 'vitest';

import { describeBlockReferences } from '../src/engine/cad/cadTransactionsBlockCommands';
import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import { createCadHistoryState, runCadCommand, undoCadHistory } from '../src/engine/cad/cadUndoRedo';
import { executeCadCommand } from '../src/engine/cad/cadTransactions';
import type { CadEntity, CadProject } from '../src/engine/cad/cadTypes';

const LAYER = 'test-layer';
const baseEntity = { layerId: LAYER, visible: true, locked: false } as const;

const line = (id: string, fromX = 0, fromY = 0, toX = 10, toY = 0): CadEntity => ({
  ...baseEntity, id, type: 'line', fromStationId: 'A', toStationId: 'B', fromX, fromY, toX, toY, sourceObservationIds: [],
});

const arc = (id: string): CadEntity => ({
  ...baseEntity, id, type: 'arc', centerX: 5, centerY: 5, radius: 2, startAngleDeg: 0, endAngleDeg: 180,
});

const freeText = (id: string): CadEntity => ({ ...baseEntity, id, type: 'text', x: 1, y: 2, text: 'note' });

const labeledText = (id: string): CadEntity => ({
  ...baseEntity,
  id,
  type: 'text',
  x: 1,
  y: 2,
  text: 'label',
  pointLabel: {
    pointEntityId: 'pt-1',
    labelStyleId: 'label-style-standard',
    content: { mode: 'manual' as const, text: 'label' },
  },
});

const surveyPoint = (id: string): CadEntity => ({
  ...baseEntity, id, type: 'survey-point', stationId: 'P1', x: 0, y: 0, pointClass: 'free', source: 'parsed-input',
});

const projectWith = (entities: CadEntity[]): CadProject => {
  const project = createBlankCadProject({ name: 'Block tx', units: 'm' });
  project.layers = [{ id: LAYER, name: 'Test', color: '#ffffff', visible: true, locked: false, role: 'planning' }];
  project.entities = entities;
  project.blockDefinitions = [];
  return project;
};

describe('cad block transactions (18N)', () => {
  it('BLOCK_CREATE captures eligible linework and replaces it with one reference (undoable)', () => {
    const project = projectWith([line('l1'), arc('a1'), freeText('t1')]);
    const history = createCadHistoryState(project, ['l1', 'a1', 't1']);
    const next = runCadCommand(history, { key: 'BLOCK_CREATE', name: 'Mark', sourceEntityIds: ['l1', 'a1', 't1'] });
    expect(next).not.toBe(history);
    expect(next.present.project.blockDefinitions).toHaveLength(1);
    expect(next.present.project.blockDefinitions?.[0]?.entities).toHaveLength(3);
    const refs = next.present.project.entities.filter((entity) => entity.type === 'block-reference');
    expect(refs).toHaveLength(1);
    expect(next.present.project.entities.filter((entity) => ['l1', 'a1', 't1'].includes(entity.id))).toHaveLength(0);
    const undone = undoCadHistory(next);
    expect(undone.present.project.blockDefinitions).toEqual([]);
    expect(undone.present.project.entities.map((entity) => entity.id).sort()).toEqual(['a1', 'l1', 't1']);
  });

  it('BLOCK_CREATE rejects semantic objects and point-label text without loss', () => {
    const runNull = (entities: CadEntity[], ids: string[]): void => {
      const history = createCadHistoryState(projectWith(entities));
      const result = executeCadCommand(history.present, { key: 'BLOCK_CREATE', name: 'Bad', sourceEntityIds: ids });
      expect(result).toBeNull();
    };
    runNull([surveyPoint('p1'), line('l1')], ['p1', 'l1']);
    runNull([labeledText('lt1')], ['lt1']);
    runNull([line('l1')], ['l1', 'missing-id']);
    runNull([line('l1')], []);
    // Duplicate names (case-insensitive) fail closed.
    const history = createCadHistoryState(projectWith([line('l1'), line('l2')]));
    const first = runCadCommand(history, { key: 'BLOCK_CREATE', name: 'Mark', sourceEntityIds: ['l1'] });
    expect(first).not.toBe(history);
    const second = runCadCommand(first, { key: 'BLOCK_CREATE', name: 'mark', sourceEntityIds: ['l2'] });
    expect(second).toBe(first);
    expect(first.present.project.entities.map((entity) => entity.id)).toContain('l2');
  });

  it('BLOCK_INSERT validates the definition and the transform', () => {
    const history = createCadHistoryState(projectWith([line('l1')]));
    const created = runCadCommand(history, { key: 'BLOCK_CREATE', name: 'Mark', sourceEntityIds: ['l1'] });
    const definitionId = created.present.project.blockDefinitions?.[0]?.id as string;
    const inserted = runCadCommand(created, { key: 'BLOCK_INSERT', definitionId, x: 5, y: 6, rotationDeg: 45, scaleX: 2, scaleY: 2, layerId: LAYER });
    expect(inserted).not.toBe(created);
    const refs = inserted.present.project.entities.filter((entity) => entity.type === 'block-reference');
    expect(refs).toHaveLength(2);
    expect(runCadCommand(inserted, { key: 'BLOCK_INSERT', definitionId: 'nope', x: 0, y: 0 })).toBe(inserted);
    expect(runCadCommand(inserted, { key: 'BLOCK_INSERT', definitionId, x: 0, y: 0, scaleX: 0 })).toBe(inserted);
    expect(runCadCommand(inserted, { key: 'BLOCK_INSERT', definitionId, x: Number.NaN, y: 0 })).toBe(inserted);
  });

  it('BLOCK_EXPLODE materializes world children with new ids and removes the ref', () => {
    const history = createCadHistoryState(projectWith([line('l1', 0, 0, 10, 0)]));
    const created = runCadCommand(history, { key: 'BLOCK_CREATE', name: 'Mark', sourceEntityIds: ['l1'] });
    const refId = created.present.project.entities.find((entity) => entity.type === 'block-reference')?.id as string;
    const second = runCadCommand(created, {
      key: 'BLOCK_INSERT',
      definitionId: created.present.project.blockDefinitions?.[0]?.id as string,
      x: 100, y: 0, rotationDeg: 90, scaleX: 1, scaleY: 1, layerId: LAYER,
    });
    const exploded = runCadCommand(second, { key: 'BLOCK_EXPLODE', referenceId: refId });
    expect(exploded).not.toBe(second);
    expect(exploded.present.project.entities.some((entity) => entity.id === refId)).toBe(false);
    // Rotated instance at (100,0): child line (0,0)-(10,0) about its base.
    const lines = exploded.present.project.entities.filter((entity) => entity.type === 'line');
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(new Set(exploded.present.project.entities.map((entity) => entity.id)).size).toBe(
      exploded.present.project.entities.length,
    );
    // The second (rotated) reference still expands — explode is per-instance.
    expect(exploded.present.project.blockDefinitions).toHaveLength(1);
  });

  it('BLOCK_RENAME / DUPLICATE guard names; DELETE enforces reference safety', () => {
    const history = createCadHistoryState(projectWith([line('l1'), line('l2')]));
    const created = runCadCommand(history, { key: 'BLOCK_CREATE', name: 'Mark', sourceEntityIds: ['l1'] });
    const definitionId = created.present.project.blockDefinitions?.[0]?.id as string;
    const withSecond = runCadCommand(created, { key: 'BLOCK_INSERT', definitionId, x: 1, y: 1, layerId: LAYER });
    // Rename + duplicate.
    const renamed = runCadCommand(withSecond, { key: 'BLOCK_RENAME', definitionId, name: 'Mark2' });
    expect(renamed).not.toBe(withSecond);
    expect(runCadCommand(renamed, { key: 'BLOCK_RENAME', definitionId, name: '  ' })).toBe(renamed);
    const duplicated = runCadCommand(renamed, { key: 'BLOCK_DUPLICATE', definitionId, name: 'Mark2' });
    expect(duplicated).toBe(renamed);
    const copy = runCadCommand(renamed, { key: 'BLOCK_DUPLICATE', definitionId, name: 'Mark copy' });
    expect(copy).not.toBe(renamed);
    expect(copy.present.project.blockDefinitions).toHaveLength(2);
    // Safety report counts references.
    const report = describeBlockReferences(copy.present.project, definitionId);
    expect(report.referenceIds).toHaveLength(2);
    expect(report.pointStyleIds).toEqual([]);
    // Referenced delete fails closed without the explicit force path.
    expect(runCadCommand(copy, { key: 'BLOCK_DELETE', definitionId })).toBe(copy);
    expect(runCadCommand(copy, { key: 'BLOCK_DELETE', definitionId, force: true })).toBe(copy);
    const deleted = runCadCommand(copy, { key: 'BLOCK_DELETE', definitionId, force: true, deleteRefs: true });
    expect(deleted).not.toBe(copy);
    expect(deleted.present.project.blockDefinitions?.map((entry) => entry.id)).not.toContain(definitionId);
    expect(deleted.present.project.entities.some((entity) => entity.type === 'block-reference' && entity.blockDefinitionId === definitionId)).toBe(false);
    // Unreferenced copy deletes without force.
    const copyId = deleted.present.project.blockDefinitions?.[0]?.id as string;
    const gone = runCadCommand(deleted, { key: 'BLOCK_DELETE', definitionId: copyId });
    expect(gone).not.toBe(deleted);
    expect(gone.present.project.blockDefinitions).toEqual([]);
  });

  it('BLOCK_DELETE with force clears point-style marker refs to the definition', () => {
    const history = createCadHistoryState(projectWith([line('l1')]));
    const created = runCadCommand(history, { key: 'BLOCK_CREATE', name: 'Mark', sourceEntityIds: ['l1'] });
    const definitionId = created.present.project.blockDefinitions?.[0]?.id as string;
    const styled: CadProject = {
      ...created.present.project,
      pointStyles: [
        ...(created.present.project.pointStyles ?? []),
        { id: 'style-marked', name: 'Marked', markerSymbolId: 'point-free', markerBlockDefinitionId: definitionId, displayMarker: true },
      ],
    };
    const state = { ...history, present: { ...history.present, project: styled } };
    expect(runCadCommand(state, { key: 'BLOCK_DELETE', definitionId })).toBe(state);
    const deleted = runCadCommand(state, { key: 'BLOCK_DELETE', definitionId, force: true, deleteRefs: true });
    expect(deleted).not.toBe(state);
    expect(deleted.present.project.pointStyles?.find((entry) => entry.id === 'style-marked')?.markerBlockDefinitionId).toBeUndefined();
  });
});
