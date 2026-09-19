// Phase 18N UI slice — reference ops (insert / explode / set-transform).
//
// Pure project transforms; the table ops live in cadBlockUiCommands and
// dispatch here. Insert stamps the definition name for readable Properties.

import { findBlockDefinition, normalizeBlockScales, validateBlockDefinition } from '../../engine/cad/cadBlocks';
import { expandBlockReference } from '../../engine/cad/cadBlocks';
import { resolveCurrentCadLayerId } from '../../engine/cad/cadLayers';
import { checkCadEntityEditable } from '../../engine/cad/cadAppearance';
import { createStableRuntimeId } from '../../engine/id';
import type { CadBlockChild, CadBlockReferenceEntity, CadEntity, CadProject } from '../../engine/cad/cadTypes';
import type { CadBlockUiOp, CadBlockUiResult } from './cadBlockUiCommands';
import { blockFail as fail, blockSiblingNames as siblingNames } from './cadBlockUiCommands';

export const applyBlockReferenceOp = (project: CadProject, op: Extract<CadBlockUiOp, { kind: 'insert' | 'explode' | 'set-transform' }>): CadBlockUiResult => {
  const definitions = project.blockDefinitions ?? [];
  switch (op.kind) {
    case 'insert': {
      const definition = findBlockDefinition(definitions, op.definitionId);
      if (!definition) return fail(project, 'BLOCK_INSERT', 'Block definition not found.');
      if (!Number.isFinite(op.x) || !Number.isFinite(op.y)) {
        return fail(project, 'BLOCK_INSERT', 'Insertion point must be finite coordinates.');
      }
      const rotationDeg = op.rotationDeg ?? 0;
      if (!Number.isFinite(rotationDeg)) return fail(project, 'BLOCK_INSERT', 'Rotation must be a finite angle.');
      const scaleX = op.scale ?? 1;
      const scaleY = op.scaleY ?? scaleX;
      const scaleIssue = normalizeBlockScales(scaleX, scaleY);
      if (scaleIssue) return fail(project, 'BLOCK_INSERT', scaleIssue.message);
      const issues = validateBlockDefinition(definition, siblingNames(project, definition.id));
      if (issues.length > 0) return fail(project, 'BLOCK_INSERT', issues[0]!.message);
      const reference: CadBlockReferenceEntity = {
        id: createStableRuntimeId('ent'),
        type: 'block-reference',
        layerId: op.layerId ?? resolveCurrentCadLayerId(project),
        visible: true,
        locked: false,
        blockDefinitionId: definition.id,
        x: op.x,
        y: op.y,
        rotationDeg,
        scaleX,
        scaleY,
        metadata: { entityName: definition.name },
      };
      return {
        applied: true,
        project: { ...project, entities: [...project.entities, reference] },
        label: `Inserted “${definition.name}” at ${op.x.toFixed(3)}, ${op.y.toFixed(3)}.`,
        commandKey: 'BLOCK_INSERT',
        addedEntityIds: [reference.id],
        removedEntityIds: [],
        afterSelectionIds: [reference.id],
      };
    }
    case 'explode': {
      const target = project.entities.find((entity) => entity.id === op.entityId);
      if (!target || target.type !== 'block-reference') {
        return fail(project, 'BLOCK_EXPLODE', 'Select a block reference to explode.');
      }
      if (!checkCadEntityEditable(project, target).editable) {
        return fail(project, 'BLOCK_EXPLODE', 'Reference is on a locked source.');
      }
      const definition = findBlockDefinition(definitions, target.blockDefinitionId);
      if (!definition) return fail(project, 'BLOCK_EXPLODE', 'Block definition not found.');
      let expanded: CadBlockChild[];
      try {
        expanded = expandBlockReference(definition, target);
      } catch (error) {
        return fail(project, 'BLOCK_EXPLODE', error instanceof Error ? error.message : 'Expansion failed.');
      }
      const parts: CadEntity[] = expanded.map((child, index) => ({
        ...child,
        id: createStableRuntimeId('ent'),
        layerId: target.layerId,
        visible: target.visible,
        locked: false,
        ...(child.type === 'text' ? { anchorEntityId: undefined } : {}),
        metadata: { ...(child.metadata ?? {}), explodedFrom: target.id, explodedIndex: index },
      }));
      return {
        applied: true,
        project: {
          ...project,
          entities: [
            ...project.entities.filter((entity) => entity.id !== target.id),
            ...parts,
          ],
        },
        label: `Exploded “${definition.name}” into ${parts.length} entities.`,
        commandKey: 'BLOCK_EXPLODE',
        addedEntityIds: parts.map((part) => part.id),
        removedEntityIds: [target.id],
        afterSelectionIds: parts.map((part) => part.id),
      };
    }
    case 'set-transform': {
      const target = project.entities.find((entity) => entity.id === op.entityId);
      if (!target || target.type !== 'block-reference') {
        return fail(project, 'BLOCK_EDIT', 'Select a block reference to edit.');
      }
      if (!checkCadEntityEditable(project, target).editable) {
        return fail(project, 'BLOCK_EDIT', 'Reference is on a locked source.');
      }
      const x = op.x ?? target.x;
      const y = op.y ?? target.y;
      const rotationDeg = op.rotationDeg ?? target.rotationDeg;
      const scaleX = op.scaleX ?? target.scaleX;
      const scaleY = op.scaleY ?? target.scaleY;
      if (![x, y, rotationDeg, scaleX, scaleY].every(Number.isFinite)) {
        return fail(project, 'BLOCK_EDIT', 'Transform values must be finite numbers.');
      }
      const scaleIssue = normalizeBlockScales(scaleX, scaleY);
      if (scaleIssue) return fail(project, 'BLOCK_EDIT', scaleIssue.message);
      return {
        applied: true,
        project: {
          ...project,
          entities: project.entities.map((entity) =>
            entity.id === target.id ? { ...entity, x, y, rotationDeg, scaleX, scaleY } : entity,
          ),
        },
        label: 'Block reference updated.',
        commandKey: 'BLOCK_EDIT',
        addedEntityIds: [],
        removedEntityIds: [],
      };
    }
  }
};
