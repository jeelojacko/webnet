// STRUCT-195.1 — block UI/reference value-cycle guard + behavior parity.
//
// BEFORE (runtime value SCC):
//   cadBlockUiCommands   --value--> cadBlockReferenceOps  (applyBlockReferenceOp)
//   cadBlockReferenceOps --value--> cadBlockUiCommands   (blockFail/blockSiblingNames)
//   => evaluating reference ops first hit a TDZ on the re-exported helper.
//
// AFTER (value edges only; `import type` is erased):
//   cadBlockUiCommands   --value--> cadBlockReferenceOps  (dispatch)
//   cadBlockUiCommands   --value--> cadBlockUiCommon      (fail/siblingNames)
//   cadBlockReferenceOps --value--> cadBlockUiCommon      (fail/siblingNames)
//   cadBlockReferenceOps --type--> cadBlockUiCommands     (CadBlockUiOp/CadBlockUiResult)
//   cadBlockUiCommon     --type--> engine cadTypes        (leaf)
//   => no cycle in the value graph.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

import { applyBlockUiOp, commitBlockUiOp } from '../src/cad-app/blocks/cadBlockUiCommands';
import { applyBlockReferenceOp } from '../src/cad-app/blocks/cadBlockReferenceOps';
import { siblingNames } from '../src/cad-app/blocks/cadBlockUiCommon';
import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import { createCadHistoryState, redoCadHistory, undoCadHistory } from '../src/engine/cad/cadUndoRedo';
import type {
  CadBlockDefinition,
  CadBlockReferenceEntity,
  CadEntity,
  CadProject,
} from '../src/engine/cad/cadTypes';

const BLOCKS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/cad-app/blocks');
const UI_FILE = path.join(BLOCKS_DIR, 'cadBlockUiCommands.ts');
const REF_FILE = path.join(BLOCKS_DIR, 'cadBlockReferenceOps.ts');
const COMMON_FILE = path.join(BLOCKS_DIR, 'cadBlockUiCommon.ts');
const MODULE_EXTS = ['.ts', '.tsx', '.js', '.jsx'];

interface ModuleEdges {
  value: string[];
  type: string[];
}

const resolveModule = (fromFile: string, spec: string): string | null => {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const ext of MODULE_EXTS) if (fs.existsSync(base + ext)) return base + ext;
  for (const ext of MODULE_EXTS) {
    const index = path.join(base, `index${ext}`);
    if (fs.existsSync(index)) return index;
  }
  return null;
};

const isTypeOnlyNamed = (clause: ts.ImportClause): boolean => {
  const bindings = clause.namedBindings;
  return (
    bindings != null &&
    ts.isNamedImports(bindings) &&
    bindings.elements.length > 0 &&
    clause.name == null &&
    bindings.elements.every((element) => element.isTypeOnly)
  );
};

const readEdges = (file: string): ModuleEdges => {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: ModuleEdges = { value: [], type: [] };
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const resolved = resolveModule(file, statement.moduleSpecifier.text);
      if (!resolved) continue;
      const clause = statement.importClause;
      if (!clause) out.value.push(resolved);
      else if (clause.phaseModifier === ts.SyntaxKind.TypeKeyword || isTypeOnlyNamed(clause)) out.type.push(resolved);
      else out.value.push(resolved);
    } else if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      const resolved = resolveModule(file, statement.moduleSpecifier.text);
      if (!resolved) continue;
      (statement.isTypeOnly ? out.type : out.value).push(resolved);
    }
  }
  return out;
};

const valueReaches = (start: string, target: string, seen = new Set<string>()): boolean => {
  if (start === target) return true;
  if (seen.has(start)) return false;
  seen.add(start);
  return readEdges(start).value.some((next) => valueReaches(next, target, seen));
};

const line = (id: string, fromX = 10, fromY = 20, toX = 30, toY = 40): CadEntity => ({
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

const refEntity = (
  id: string,
  blockDefinitionId: string,
  over: Partial<CadBlockReferenceEntity> = {},
): CadBlockReferenceEntity => ({
  id,
  type: 'block-reference',
  layerId: 'general',
  visible: true,
  locked: false,
  blockDefinitionId,
  x: 0,
  y: 0,
  rotationDeg: 0,
  scaleX: 1,
  scaleY: 1,
  ...over,
});

const circleBlock = (): CadBlockDefinition => ({
  id: 'blk-c',
  name: 'Circle',
  basePoint: { x: 0, y: 0 },
  entities: [
    { id: 'c1', type: 'circle', layerId: 'general', visible: true, locked: false, centerX: 1, centerY: 1, radius: 2 },
  ],
});

const projectWith = (entities: CadEntity[], definitions: CadBlockDefinition[] = []): CadProject => {
  const project = createBlankCadProject({ name: 'cycle', units: 'm' });
  project.entities = entities;
  project.blockDefinitions = definitions;
  return project;
};

const withLine = (): CadProject => projectWith([line('e1')]);

const createBlock = (project: CadProject, name = 'Sym'): { project: CadProject; defId: string } => {
  const result = applyBlockUiOp(project, { kind: 'create', name, fromEntityIds: ['e1'] });
  expect(result.applied).toBe(true);
  return { project: result.project, defId: result.project.blockDefinitions![0]!.id };
};

describe('block UI/reference value graph', () => {
  it('has no runtime value cycle between UI commands and reference ops', () => {
    const ui = readEdges(UI_FILE);
    const ref = readEdges(REF_FILE);
    const common = readEdges(COMMON_FILE);
    expect(ui.value).toContain(REF_FILE);
    expect(ui.value).toContain(COMMON_FILE);
    expect(ref.value).toContain(COMMON_FILE);
    expect(ref.value).not.toContain(UI_FILE);
    expect(ref.type).toContain(UI_FILE);
    expect(common.value).toEqual([]);
    expect(common.type).not.toContain(UI_FILE);
    expect(common.type).not.toContain(REF_FILE);
    expect(valueReaches(REF_FILE, UI_FILE)).toBe(false);
    expect(valueReaches(COMMON_FILE, UI_FILE)).toBe(false);
    expect(valueReaches(COMMON_FILE, REF_FILE)).toBe(false);
  });

  it('evaluates reference ops before UI commands without a TDZ', async () => {
    vi.resetModules();
    const ref = await import('../src/cad-app/blocks/cadBlockReferenceOps');
    const ui = await import('../src/cad-app/blocks/cadBlockUiCommands');
    expect(typeof ref.applyBlockReferenceOp).toBe('function');
    expect(typeof ui.applyBlockUiOp).toBe('function');
  });

  it('evaluates UI commands before reference ops without a TDZ', async () => {
    vi.resetModules();
    const ui = await import('../src/cad-app/blocks/cadBlockUiCommands');
    const ref = await import('../src/cad-app/blocks/cadBlockReferenceOps');
    expect(typeof ui.applyBlockUiOp).toBe('function');
    expect(typeof ref.applyBlockReferenceOp).toBe('function');
  });
});

describe('block UI/reference behavior parity', () => {
  it('fails with the exact envelope shape and leaves project/history untouched', () => {
    const project = withLine();
    const missing = applyBlockUiOp(project, { kind: 'insert', definitionId: 'nope', x: 0, y: 0 });
    expect(missing).toEqual({
      applied: false,
      reason: 'Block definition not found.',
      project,
      label: 'Block definition not found.',
      commandKey: 'BLOCK_INSERT',
      addedEntityIds: [],
      removedEntityIds: [],
    });
    expect(Object.keys(missing)).toEqual([
      'applied',
      'reason',
      'project',
      'label',
      'commandKey',
      'addedEntityIds',
      'removedEntityIds',
    ]);
    expect(missing.project).toBe(project);
    const state = createCadHistoryState(project);
    const rejected = commitBlockUiOp(state, { kind: 'insert', definitionId: 'nope', x: 0, y: 0 });
    expect(rejected.state).toBe(state);
    expect(rejected.state.undoStack).toHaveLength(0);
  });

  it('covers seed/create/duplicate/rename/redefine lifecycle', () => {
    const seeded = applyBlockUiOp(withLine(), { kind: 'seed-symbols' });
    expect(seeded.applied).toBe(true);
    expect(applyBlockUiOp(seeded.project, { kind: 'seed-symbols' }).applied).toBe(false);
    const created = createBlock(seeded.project);
    const dup = applyBlockUiOp(created.project, { kind: 'duplicate', definitionId: created.defId });
    expect(dup.applied).toBe(true);
    const renamed = applyBlockUiOp(dup.project, { kind: 'rename', definitionId: created.defId, name: 'Main' });
    expect(renamed.applied).toBe(true);
    const redefined = applyBlockUiOp(renamed.project, {
      kind: 'redefine',
      definitionId: created.defId,
      fromEntityIds: ['e1'],
    });
    expect(redefined.applied).toBe(true);
    expect(redefined.project.blockDefinitions!.find((entry) => entry.id === created.defId)!.name).toBe('Main');
  });

  it('enforces case-insensitive sibling uniqueness and exceptId filtering', () => {
    const first = createBlock(withLine());
    const second = applyBlockUiOp(first.project, { kind: 'duplicate', definitionId: first.defId });
    const secondId = second.project.blockDefinitions![1]!.id;
    expect(second.project.blockDefinitions!.map((entry) => entry.name)).toEqual(['Sym', 'Sym copy']);
    expect(siblingNames(first.project)).toEqual(['Sym']);
    expect(siblingNames(second.project, first.defId)).toEqual(['Sym copy']);
    const clash = applyBlockUiOp(second.project, { kind: 'rename', definitionId: secondId, name: 'sYm' });
    expect(clash.applied).toBe(false);
    expect(clash.reason).toBe('Duplicate block name “sYm”.');
    const suffixed = applyBlockUiOp(second.project, { kind: 'create', name: 'SYM', fromEntityIds: ['e1'] });
    expect(suffixed.project.blockDefinitions!.map((entry) => entry.name)).toEqual(['Sym', 'Sym copy', 'SYM 2']);
  });

  it('rejects invalid coordinates, scales, missing refs, and locked entities', () => {
    const created = createBlock(withLine());
    const p = created.project;
    expect(applyBlockUiOp(p, { kind: 'insert', definitionId: created.defId, x: NaN, y: 0 }).reason).toBe(
      'Insertion point must be finite coordinates.',
    );
    expect(applyBlockUiOp(p, { kind: 'insert', definitionId: created.defId, x: 0, y: 0, rotationDeg: Infinity }).reason).toBe(
      'Rotation must be a finite angle.',
    );
    expect(applyBlockUiOp(p, { kind: 'insert', definitionId: created.defId, x: 0, y: 0, scale: 0 }).reason).toBe(
      'Block scales must be finite and > 0 (got 0, 0).',
    );
    expect(applyBlockUiOp(p, { kind: 'insert', definitionId: created.defId, x: 0, y: 0, scale: -1 }).reason).toBe(
      'Block scales must be finite and > 0 (got -1, -1).',
    );
    expect(applyBlockReferenceOp(p, { kind: 'explode', entityId: 'missing' }).reason).toBe(
      'Select a block reference to explode.',
    );
    expect(applyBlockReferenceOp(p, { kind: 'set-transform', entityId: 'missing' }).reason).toBe(
      'Select a block reference to edit.',
    );
    const locked = projectWith([refEntity('ref-1', created.defId, { locked: true })], [p.blockDefinitions![0]!]);
    expect(applyBlockReferenceOp(locked, { kind: 'explode', entityId: 'ref-1' }).reason).toBe(
      'Reference is on a locked source.',
    );
    expect(applyBlockReferenceOp(locked, { kind: 'set-transform', entityId: 'ref-1', rotationDeg: 45 }).reason).toBe(
      'Reference is on a locked source.',
    );
    const lockedSource = projectWith([{ ...line('e1'), locked: true }]);
    expect(applyBlockUiOp(lockedSource, { kind: 'create', name: 'X', fromEntityIds: ['e1'] }).reason).toBe(
      'Selection includes a locked source.',
    );
  });

  it('rejects expansion-invalid circle ops without mutation', () => {
    const project = projectWith([], [circleBlock()]);
    const insert = applyBlockReferenceOp(project, {
      kind: 'insert',
      definitionId: 'blk-c',
      x: 0,
      y: 0,
      scale: 2,
      scaleY: 1,
    });
    expect(insert.applied).toBe(false);
    expect(insert.reason).toBe(
      'CAD_BLOCK_CIRCLE_NON_UNIFORM_SCALE: block reference scales a circle child non-uniformly (scaleX=2, scaleY=1); refusing instead of distorting the circle.',
    );
    expect(insert.project).toBe(project);
    const withRef = projectWith([refEntity('ref-1', 'blk-c')], [circleBlock()]);
    const edit = applyBlockReferenceOp(withRef, { kind: 'set-transform', entityId: 'ref-1', scaleX: 2, scaleY: 1 });
    expect(edit.applied).toBe(false);
    expect(edit.project).toBe(withRef);
  });

  it('reports afterSelectionIds and converges commitBlockUiOp selection', () => {
    const created = createBlock(withLine());
    const state = createCadHistoryState(created.project);
    const inserted = commitBlockUiOp(state, { kind: 'insert', definitionId: created.defId, x: 5, y: 6 });
    const refId = inserted.addedEntityIds[0]!;
    expect(inserted.afterSelectionIds).toEqual([refId]);
    expect(inserted.state.present.selection.selectedEntityIds).toEqual([refId]);
    const stale = {
      ...inserted.state,
      present: { ...inserted.state.present, selection: { selectedEntityIds: ['ghost', refId] } },
    };
    const moved = commitBlockUiOp(stale, { kind: 'set-transform', entityId: refId, rotationDeg: 45 });
    expect(moved.afterSelectionIds).toBeUndefined();
    expect(moved.state.present.selection.selectedEntityIds).toEqual([refId]);
    const exploded = commitBlockUiOp(moved.state, { kind: 'explode', entityId: refId });
    expect(exploded.afterSelectionIds).toEqual(exploded.addedEntityIds);
    expect(exploded.state.present.selection.selectedEntityIds).toEqual(exploded.addedEntityIds);
  });

  it('undoes and redoes one committed op', () => {
    const created = createBlock(withLine());
    const state = createCadHistoryState(created.project);
    const inserted = commitBlockUiOp(state, { kind: 'insert', definitionId: created.defId, x: 5, y: 6 });
    expect(inserted.state.undoStack).toHaveLength(1);
    const undone = undoCadHistory(inserted.state);
    expect(undone.present.project.entities.filter((entity) => entity.type === 'block-reference')).toHaveLength(0);
    const redone = redoCadHistory(undone);
    expect(redone.present.project.entities.filter((entity) => entity.type === 'block-reference')).toHaveLength(1);
  });
});
