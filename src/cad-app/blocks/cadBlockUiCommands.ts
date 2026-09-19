// Phase 18N UI slice — block table/reference mutations as pure project
// transforms + one history-commit adapter.
//
// Persist slice 2b87cb39 landed real BLOCK_* transactions reusing this
// slice's seed gate; this adapter is deliberately kept: it carries the
// manager's reason-rich UX (empty-selection, duplicate-name, in-use
// guards) and commits through identical history bookkeeping. Repoint
// callers at runCadCommand when the two paths are unified.

import { checkCadEntityEditable } from '../../engine/cad/cadAppearance';
import { findBlockDefinition, validateBlockDefinition } from '../../engine/cad/cadBlocks';
import { ensureSurveySymbolsSeeded } from '../../engine/cad/cadSurveySymbolLibrary';
import type { CadHistoryState } from '../../engine/cad/cadUndoRedo';
import { createStableRuntimeId } from '../../engine/id';
import { collectChildren, selectionBasePoint } from './cadBlockSelectionGeometry';
import { applyBlockReferenceOp } from './cadBlockReferenceOps';
import type {
  CadBlockDefinition,
  CadBlockReferenceEntity,
  CadEntity,
  CadEntityId,
  CadProject,
} from '../../engine/cad/cadTypes';

const siblingNames = (project: CadProject, exceptId?: string): string[] =>
  (project.blockDefinitions ?? []).filter((entry) => entry.id !== exceptId).map((entry) => entry.name);

const uniqueName = (project: CadProject, base: string): string => {
  const taken = new Set(siblingNames(project).map((name) => name.trim().toLowerCase()));
  const clean = base.trim().length > 0 ? base.trim() : 'Block';
  if (!taken.has(clean.toLowerCase())) return clean;
  let index = 2;
  while (taken.has(`${clean} ${index}`.toLowerCase())) index += 1;
  return `${clean} ${index}`;
};

export type CadBlockUiOp =
  | { kind: 'seed-symbols' }
  | { kind: 'create'; name: string; description?: string; fromEntityIds: CadEntityId[] }
  | { kind: 'duplicate'; definitionId: string }
  | { kind: 'rename'; definitionId: string; name: string }
  | { kind: 'redefine'; definitionId: string; fromEntityIds: CadEntityId[] }
  | { kind: 'delete'; definitionId: string }
  | {
      kind: 'insert';
      definitionId: string;
      x: number;
      y: number;
      rotationDeg?: number;
      scale?: number;
      scaleY?: number;
      layerId?: string;
    }
  | { kind: 'explode'; entityId: CadEntityId }
  | {
      kind: 'set-transform';
      entityId: CadEntityId;
      x?: number;
      y?: number;
      rotationDeg?: number;
      scaleX?: number;
      scaleY?: number;
    };

export interface CadBlockUiResult {
  applied: boolean;
  reason?: string;
  project: CadProject;
  label: string;
  commandKey:
    | 'BLOCK_SEED'
    | 'BLOCK_CREATE'
    | 'BLOCK_DUPLICATE'
    | 'BLOCK_RENAME'
    | 'BLOCK_REDEFINE'
    | 'BLOCK_DELETE'
    | 'BLOCK_INSERT'
    | 'BLOCK_EXPLODE'
    | 'BLOCK_EDIT';
  addedEntityIds: CadEntityId[];
  removedEntityIds: CadEntityId[];
  afterSelectionIds?: CadEntityId[];
}

const fail = (project: CadProject, commandKey: CadBlockUiResult['commandKey'], reason: string): CadBlockUiResult => ({
  applied: false,
  reason,
  project,
  label: reason,
  commandKey,
  addedEntityIds: [],
  removedEntityIds: [],
});


export const applyBlockUiOp = (project: CadProject, op: CadBlockUiOp): CadBlockUiResult => {
  const definitions = project.blockDefinitions ?? [];
  switch (op.kind) {
    case 'seed-symbols': {
      const { project: next, added } = ensureSurveySymbolsSeeded(project);
      if (added === 0) return fail(project, 'BLOCK_SEED', 'Survey symbols are already in this drawing.');
      return {
        applied: true,
        project: next,
        label: `Seeded ${added} survey symbols.`,
        commandKey: 'BLOCK_SEED',
        addedEntityIds: [],
        removedEntityIds: [],
      };
    }
    case 'create': {
      const sources = op.fromEntityIds
        .map((id) => project.entities.find((entity) => entity.id === id))
        .filter((entity): entity is CadEntity => entity != null);
      if (sources.length === 0) return fail(project, 'BLOCK_CREATE', 'Select linework first, then create a block.');
      const locked = sources.some((entity) => !checkCadEntityEditable(project, entity).editable);
      if (locked) return fail(project, 'BLOCK_CREATE', 'Selection includes a locked source.');
      const base = selectionBasePoint(sources);
      if (!base) return fail(project, 'BLOCK_CREATE', 'Selection has no geometry to capture.');
      const { children, skipped } = collectChildren(project, op.fromEntityIds);
      if (children.length === 0) {
        return fail(project, 'BLOCK_CREATE', 'Only lines, polylines, arcs, polygons, and free text can form a block.');
      }
      const name = uniqueName(project, op.name);
      const definition: CadBlockDefinition = {
        id: createStableRuntimeId('block'),
        name,
        basePoint: base,
        entities: children,
        ...(op.description?.trim() ? { description: op.description.trim() } : {}),
      };
      const issues = validateBlockDefinition(definition, siblingNames(project));
      if (issues.length > 0) return fail(project, 'BLOCK_CREATE', issues[0]!.message);
      void skipped;
      return {
        applied: true,
        project: { ...project, blockDefinitions: [...definitions, definition] },
        label: `Block “${name}” created (${children.length} entities).`,
        commandKey: 'BLOCK_CREATE',
        addedEntityIds: [],
        removedEntityIds: [],
      };
    }
    case 'duplicate': {
      const source = findBlockDefinition(definitions, op.definitionId);
      if (!source) return fail(project, 'BLOCK_DUPLICATE', 'Block definition not found.');
      const name = uniqueName(project, `${source.name} copy`);
      const copy: CadBlockDefinition = {
        ...source,
        id: createStableRuntimeId('block'),
        name,
        basePoint: { ...source.basePoint },
        entities: source.entities.map((child, index) => ({ ...child, id: `child-${index + 1}` })),
      };
      return {
        applied: true,
        project: { ...project, blockDefinitions: [...definitions, copy] },
        label: `Block “${name}” duplicated.`,
        commandKey: 'BLOCK_DUPLICATE',
        addedEntityIds: [],
        removedEntityIds: [],
      };
    }
    case 'rename': {
      const target = findBlockDefinition(definitions, op.definitionId);
      if (!target) return fail(project, 'BLOCK_RENAME', 'Block definition not found.');
      const name = op.name.trim();
      if (name.length === 0) return fail(project, 'BLOCK_RENAME', 'Block name must not be empty.');
      const clash = definitions.some(
        (entry) => entry.id !== op.definitionId && entry.name.trim().toLowerCase() === name.toLowerCase(),
      );
      if (clash) return fail(project, 'BLOCK_RENAME', `Duplicate block name “${name}”.`);
      return {
        applied: true,
        project: {
          ...project,
          blockDefinitions: definitions.map((entry) => (entry.id === op.definitionId ? { ...entry, name } : entry)),
        },
        label: `Block renamed to “${name}”.`,
        commandKey: 'BLOCK_RENAME',
        addedEntityIds: [],
        removedEntityIds: [],
      };
    }
    case 'redefine': {
      const target = findBlockDefinition(definitions, op.definitionId);
      if (!target) return fail(project, 'BLOCK_REDEFINE', 'Block definition not found.');
      const inUse = project.entities.filter(
        (entity): entity is CadBlockReferenceEntity =>
          entity.type === 'block-reference' && entity.blockDefinitionId === op.definitionId,
      );
      const lockedRef = inUse.find((entity) => !checkCadEntityEditable(project, entity).editable);
      if (lockedRef) return fail(project, 'BLOCK_REDEFINE', 'A locked reference uses this block.');
      const sources = op.fromEntityIds
        .map((id) => project.entities.find((entity) => entity.id === id))
        .filter((entity): entity is CadEntity => entity != null);
      if (sources.length === 0) return fail(project, 'BLOCK_REDEFINE', 'Select replacement linework first.');
      const base = selectionBasePoint(sources);
      if (!base) return fail(project, 'BLOCK_REDEFINE', 'Selection has no geometry to capture.');
      const { children } = collectChildren(project, op.fromEntityIds);
      if (children.length === 0) {
        return fail(project, 'BLOCK_REDEFINE', 'Only lines, polylines, arcs, polygons, and free text can form a block.');
      }
      const next: CadBlockDefinition = { ...target, basePoint: base, entities: children };
      const issues = validateBlockDefinition(next, siblingNames(project, op.definitionId));
      if (issues.length > 0) return fail(project, 'BLOCK_REDEFINE', issues[0]!.message);
      return {
        applied: true,
        project: {
          ...project,
          blockDefinitions: definitions.map((entry) => (entry.id === op.definitionId ? next : entry)),
        },
        label: `Block “${target.name}” redefined (${children.length} entities, ${inUse.length} references update).`,
        commandKey: 'BLOCK_REDEFINE',
        addedEntityIds: [],
        removedEntityIds: [],
      };
    }
    case 'delete': {
      const target = findBlockDefinition(definitions, op.definitionId);
      if (!target) return fail(project, 'BLOCK_DELETE', 'Block definition not found.');
      const refs = project.entities.filter(
        (entity) => entity.type === 'block-reference' && entity.blockDefinitionId === op.definitionId,
      );
      if (refs.length > 0) {
        return fail(
          project,
          'BLOCK_DELETE',
          `“${target.name}” still has ${refs.length} reference${refs.length === 1 ? '' : 's'} — explode or erase them first.`,
        );
      }
      const usedAsMarker = (project.pointStyles ?? []).some(
        (style) => style.markerBlockDefinitionId === op.definitionId,
      );
      if (usedAsMarker) {
        return fail(project, 'BLOCK_DELETE', `“${target.name}” backs a point style marker — repoint the style first.`);
      }
      return {
        applied: true,
        project: { ...project, blockDefinitions: definitions.filter((entry) => entry.id !== op.definitionId) },
        label: `Block “${target.name}” deleted.`,
        commandKey: 'BLOCK_DELETE',
        addedEntityIds: [],
        removedEntityIds: [],
      };
    }
    case 'insert':
    case 'explode':
    case 'set-transform':
      return applyBlockReferenceOp(project, op);
  }
};

/**
 * Commit one block op as an undoable history entry (mirrors runCadCommand
 * bookkeeping; no-ops return the state untouched). Selection converges:
 * unknown ids are dropped, never kept.
 */
export const commitBlockUiOp = (state: CadHistoryState, op: CadBlockUiOp): CadBlockUiResult & { state: CadHistoryState } => {
  const result = applyBlockUiOp(state.present.project, op);
  if (!result.applied) return { ...result, state };
  const beforeIds = state.present.selection.selectedEntityIds;
  const known = new Set(result.project.entities.map((entity) => entity.id));
  const afterIds = (result.afterSelectionIds ?? beforeIds).filter((id) => known.has(id));
  const nextSequence = state.nextSequence;
  return {
    ...result,
    state: {
      present: {
        project: result.project,
        selection: { selectedEntityIds: afterIds },
      },
      undoStack: [
        ...state.undoStack,
        {
          transaction: {
            id: `cad-tx-${nextSequence}`,
            sequence: nextSequence,
            commandKey: result.commandKey,
            label: result.label,
            beforeSelectionIds: beforeIds,
            afterSelectionIds: afterIds,
            addedEntityIds: result.addedEntityIds,
            removedEntityIds: result.removedEntityIds,
          },
          before: state.present,
          after: {
            project: result.project,
            selection: { selectedEntityIds: afterIds },
          },
        },
      ],
      redoStack: [],
      nextSequence: nextSequence + 1,
      commandState: state.commandState,
    },
  };
};

export { fail as blockFail, siblingNames as blockSiblingNames };
