// Phase 18N UI slice: block adapter ops, history commit, hover annotator.
import { describe, expect, it } from 'vitest';
import { applyBlockUiOp, commitBlockUiOp } from '../src/cad-app/blocks/cadBlockUiCommands';
import { expandBlockReference, findBlockDefinition } from '../src/engine/cad/cadBlocks';
import { withBlockHoverTitles } from '../src/cad-app/blocks/cadBlockOverlay';
import { buildCadBlockSnapshot } from '../src/cad-app/shell/cadBlockSnapshot';
import { SURVEY_SYMBOL_SEEDS, ensureSurveySymbolsSeeded } from '../src/engine/cad/cadSurveySymbolLibrary';
import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import { createCadHistoryState } from '../src/engine/cad/cadUndoRedo';
import type { CadLineEntity, CadProject } from '../src/engine/cad/cadTypes';

const line = (id: string, fromX: number, fromY: number, toX: number, toY: number): CadLineEntity => ({
  id,
  type: 'line',
  layerId: 'general',
  visible: true,
  locked: false,
  fromStationId: 'A',
  toStationId: 'B',
  fromX,
  fromY,
  toX,
  toY,
  sourceObservationIds: [],
});

const withLine = (project: CadProject): CadProject => ({
  ...project,
  entities: [...project.entities, line('e1', 10, 20, 30, 40)],
});

describe('block UI adapter', () => {
  it('seeds the 26-symbol library idempotently without touching user blocks', () => {
    expect(SURVEY_SYMBOL_SEEDS.length).toBe(26);
    const base = createBlankCadProject({ name: 'test', units: 'm' });
    const first = ensureSurveySymbolsSeeded(base);
    expect(first.added).toBe(26);
    expect(base.blockDefinitions ?? []).toHaveLength(0);
    const second = ensureSurveySymbolsSeeded(first.project);
    expect(second.added).toBe(0);
    expect(second.project).toBe(first.project);
    for (const seed of SURVEY_SYMBOL_SEEDS) {
      expect(seed.id.startsWith('webnet-survey-symbol-')).toBe(true);
      expect(seed.entities.length).toBeGreaterThan(0);
    }
  });

  it('creates from selection, then duplicates/renames/redefines/deletes', () => {
    let project = withLine(createBlankCadProject({ name: 'test', units: 'm' }));
    const created = applyBlockUiOp(project, { kind: 'create', name: 'Sym', fromEntityIds: ['e1'] });
    expect(created.applied).toBe(true);
    project = created.project;
    const defId = project.blockDefinitions![0]!.id;
    expect(project.blockDefinitions![0]!.basePoint).toEqual({ x: 10, y: 20 });
    // Engine convention: drawing-coord children + base basePoint, so an
    // identity insert at the base reproduces the source exactly.
    const definition = findBlockDefinition(project.blockDefinitions, defId)!;
    const atBase = expandBlockReference(definition, {
      x: 10,
      y: 20,
      rotationDeg: 0,
      scaleX: 1,
      scaleY: 1,
    });
    expect(atBase).toHaveLength(1);
    expect(atBase[0]).toMatchObject({ type: 'line', fromX: 10, fromY: 20, toX: 30, toY: 40 });

    const dup = applyBlockUiOp(project, { kind: 'duplicate', definitionId: defId });
    expect(dup.applied).toBe(true);
    project = dup.project;
    expect(project.blockDefinitions).toHaveLength(2);

    const clash = applyBlockUiOp(project, {
      kind: 'rename',
      definitionId: project.blockDefinitions![1]!.id,
      name: 'sym',
    });
    expect(clash.applied).toBe(false);

    const renamed = applyBlockUiOp(project, {
      kind: 'rename',
      definitionId: project.blockDefinitions![1]!.id,
      name: 'Sym 2',
    });
    expect(renamed.applied).toBe(true);

    const inserted = applyBlockUiOp(renamed.project, {
      kind: 'insert',
      definitionId: defId,
      x: 1,
      y: 2,
      rotationDeg: 90,
      scale: 2,
    });
    expect(inserted.applied).toBe(true);
    const refId = inserted.addedEntityIds[0]!;

    const guarded = applyBlockUiOp(inserted.project, { kind: 'delete', definitionId: defId });
    expect(guarded.applied).toBe(false);

    const exploded = applyBlockUiOp(inserted.project, { kind: 'explode', entityId: refId });
    expect(exploded.applied).toBe(true);
    expect(exploded.removedEntityIds).toEqual([refId]);

    const deleted = applyBlockUiOp(exploded.project, { kind: 'delete', definitionId: defId });
    expect(deleted.applied).toBe(true);
    expect(deleted.project.blockDefinitions).toHaveLength(1);
  });

  it('redefines geometry without moving the base point (engine semantic)', () => {
    let project = withLine(createBlankCadProject({ name: 'test', units: 'm' }));
    const created = applyBlockUiOp(project, { kind: 'create', name: 'Sym', fromEntityIds: ['e1'] });
    expect(created.applied).toBe(true);
    project = {
      ...created.project,
      entities: [...created.project.entities, line('e2', 100, 200, 110, 210)],
    };
    const defId = project.blockDefinitions![0]!.id;
    expect(project.blockDefinitions![0]!.basePoint).toEqual({ x: 10, y: 20 });
    const inserted = applyBlockUiOp(project, { kind: 'insert', definitionId: defId, x: 1, y: 2 });
    expect(inserted.applied).toBe(true);
    project = inserted.project;
    const refId = inserted.addedEntityIds[0]!;

    const redefined = applyBlockUiOp(project, { kind: 'redefine', definitionId: defId, fromEntityIds: ['e2'] });
    expect(redefined.applied).toBe(true);
    const afterDef = findBlockDefinition(redefined.project.blockDefinitions, defId)!;
    // Engine BLOCK_REDEFINE semantic: geometry swap only, basePoint stays.
    expect(afterDef.basePoint).toEqual({ x: 10, y: 20 });
    const ref = redefined.project.entities.find((entity) => entity.id === refId);
    expect(ref?.type).toBe('block-reference');
    if (ref?.type !== 'block-reference') throw new Error('missing block reference');
    const world = expandBlockReference(afterDef, {
      x: ref.x,
      y: ref.y,
      rotationDeg: 0,
      scaleX: 1,
      scaleY: 1,
    });
    expect(world).toHaveLength(1);
    // world = insert + (local − basePoint): a base reset to the replacement
    // min-corner (100, 200) would have shifted this to (1, 2)/(11, 12).
    expect(world[0]).toMatchObject({ type: 'line', fromX: 91, fromY: 182, toX: 101, toY: 192 });
  });

  it('rejects empty selections, bad scales, and non-finite inserts', () => {
    const project = withLine(createBlankCadProject({ name: 'test', units: 'm' }));
    expect(applyBlockUiOp(project, { kind: 'create', name: 'X', fromEntityIds: [] }).applied).toBe(false);
    expect(applyBlockUiOp(project, { kind: 'create', name: 'X', fromEntityIds: ['missing'] }).applied).toBe(false);
    const created = applyBlockUiOp(project, { kind: 'create', name: 'X', fromEntityIds: ['e1'] });
    const defId = created.project.blockDefinitions![0]!.id;
    expect(applyBlockUiOp(created.project, { kind: 'insert', definitionId: defId, x: NaN, y: 0 }).applied).toBe(false);
    expect(applyBlockUiOp(created.project, { kind: 'insert', definitionId: defId, x: 0, y: 0, scale: 0 }).applied).toBe(false);
    expect(applyBlockUiOp(created.project, { kind: 'insert', definitionId: defId, x: 0, y: 0, scale: -1 }).applied).toBe(false);
  });

  it('edits reference transforms and commits undoable history', () => {
    const base = withLine(createBlankCadProject({ name: 'test', units: 'm' }));
    const created = applyBlockUiOp(base, { kind: 'create', name: 'X', fromEntityIds: ['e1'] });
    const state = createCadHistoryState(created.project);
    const inserted = commitBlockUiOp(state, {
      kind: 'insert',
      definitionId: created.project.blockDefinitions![0]!.id,
      x: 5,
      y: 6,
    });
    expect(inserted.state.undoStack).toHaveLength(1);
    expect(inserted.state.undoStack[0]!.transaction.commandKey).toBe('BLOCK_INSERT');
    const refId = inserted.addedEntityIds[0]!;
    expect(inserted.state.present.selection.selectedEntityIds).toEqual([refId]);

    const edited = commitBlockUiOp(inserted.state, {
      kind: 'set-transform',
      entityId: refId,
      rotationDeg: 45,
      scaleX: 3,
    });
    const ref = edited.state.present.project.entities.find((entity) => entity.id === refId);
    expect(ref?.type).toBe('block-reference');
    if (ref?.type === 'block-reference') {
      expect(ref.rotationDeg).toBe(45);
      expect(ref.scaleX).toBe(3);
    }
    const rejected = commitBlockUiOp(edited.state, { kind: 'set-transform', entityId: refId, scaleX: 0 });
    expect(rejected.state).toBe(edited.state);
  });

  it('tags native expansion primitives with hover titles', () => {
    const base = withLine(createBlankCadProject({ name: 'test', units: 'm' }));
    const created = applyBlockUiOp(base, { kind: 'create', name: 'X', fromEntityIds: ['e1'] });
    const inserted = applyBlockUiOp(created.project, {
      kind: 'insert',
      definitionId: created.project.blockDefinitions![0]!.id,
      x: 0,
      y: 0,
    });
    const refId = inserted.addedEntityIds[0]!;
    const tagged = withBlockHoverTitles(inserted.project, [
      {
        id: 'primitive:ref:line',
        layerId: 'general',
        sourceEntityId: refId,
        stroke: '#fff',
        kind: 'line',
        points: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
        strokeWidth: 1,
      },
      {
        id: 'primitive:e1',
        layerId: 'general',
        sourceEntityId: 'e1',
        stroke: '#fff',
        kind: 'line',
        points: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
        strokeWidth: 1,
      },
    ]);
    expect(tagged[0]!.hoverTitle).toBe('Block: X');
    expect(tagged[1]!.hoverTitle).toBeUndefined();
    const snapshot = buildCadBlockSnapshot(inserted.project, inserted.addedEntityIds, null);
    expect(snapshot.definitions).toHaveLength(1);
    expect(snapshot.referenceCounts[created.project.blockDefinitions![0]!.id]).toBe(1);
    expect(snapshot.selectedBlockReferenceIds).toEqual(inserted.addedEntityIds);
  });
});
