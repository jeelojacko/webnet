import { createCadSelectionState } from './cadSelection';
import { checkCadEntityEditable } from './cadAppearance';
import { validateBoundaryEntityVertexEdit } from './cadBoundaryCandidateValidation';
import { getCadEntityDisplayLabel } from './cadEntityNames';
import { stationIdExists } from './cadTransactionsEntityFactories';
import {
  movePointReferences,
  renamePointReferences,
  syncEditedEntityDependencies,
} from './cadTransactionsLinkedEntities';
import { withEntityMetadataName } from './cadTransactionsMetadata';
import { replaceCadProjectEntities } from './cadProjectState';
import type { CadCommandDefinition } from './cadTransactions.types';
import type { CadEntity, CadEntityAppearance, CadEntityId, CadLayerId, CadProject } from './cadTypes';
const replaceEntityInProject = (
  project: CadProject,
  entityId: CadEntityId,
  updater: (_entity: CadEntity) => CadEntity,
): CadProject =>
  replaceCadProjectEntities(
    project,
    project.entities.map((entity) => (entity.id === entityId ? updater(entity) : entity)),
  );

export const editEntityCommand: CadCommandDefinition<{
  key: 'EDIT_ENTITY';
  entityId: CadEntityId;
  edit:
    | { kind: 'entity-name'; value: string }
    | { kind: 'point-x'; value: number }
    | { kind: 'point-y'; value: number }
    | { kind: 'point-z'; value: number | null }
    | { kind: 'line-end'; toX: number; toY: number }
    | { kind: 'arc-radius'; value: number }
    | { kind: 'polyline-vertex'; vertexIndex: number; x: number; y: number }
    | { kind: 'polyline-vertices'; vertices: Array<{ vertexIndex: number; x: number; y: number }> }
    | { kind: 'entity-layer'; layerId: CadLayerId }
    | { kind: 'entity-appearance'; patch: CadEntityAppearance };
}> = {
  key: 'EDIT_ENTITY',
  execute: (snapshot, command) => {
    const targetEntity = snapshot.project.entities.find((entity) => entity.id === command.entityId);
    if (!targetEntity) return null;

    // Central editability gate (spec §6): locked/hidden source rejects ALL
    // edit kinds (geometry + appearance + layer-move) with stable codes.
    if (!checkCadEntityEditable(snapshot.project, targetEntity).editable) return null;
    if (command.edit.kind === 'entity-layer' || command.edit.kind === 'entity-appearance') {
      if (command.edit.kind === 'entity-layer') {
        const targetLayerId = command.edit.layerId;
        if (targetLayerId === targetEntity.layerId) return null;
        if (!snapshot.project.layers.some((layer) => layer.id === targetLayerId)) return null;
        const nextProject = replaceEntityInProject(snapshot.project, targetEntity.id, (entity) => ({
          ...entity,
          layerId: targetLayerId,
        }));
        return {
          nextSnapshot: {
            project: nextProject,
            selection: createCadSelectionState(nextProject, [targetEntity.id]),
          },
          commandState: {
            key: 'EDIT_ENTITY',
            phase: 'committed',
            prompt: `EDIT_ENTITY committed for ${getCadEntityDisplayLabel(targetEntity)}.`,
          },
          transactionLabel: `EDIT_ENTITY (${getCadEntityDisplayLabel(targetEntity)})`,
          addedEntityIds: [],
          removedEntityIds: [],
        };
      }
      if (command.edit.kind !== 'entity-appearance') return null;
      const appearancePatch = command.edit.patch;
      const nextProject = replaceEntityInProject(snapshot.project, targetEntity.id, (entity) => ({
        ...entity,
        appearance: { ...entity.appearance, ...appearancePatch },
      }));
      return {
        nextSnapshot: {
          project: nextProject,
          selection: createCadSelectionState(nextProject, [targetEntity.id]),
        },
        commandState: {
          key: 'EDIT_ENTITY',
          phase: 'committed',
          prompt: `EDIT_ENTITY committed for ${getCadEntityDisplayLabel(targetEntity)}.`,
        },
        transactionLabel: `EDIT_ENTITY (${getCadEntityDisplayLabel(targetEntity)})`,
        addedEntityIds: [],
        removedEntityIds: [],
      };
    }

    if (command.edit.kind === 'entity-name') {
      const nextName = command.edit.value.trim();
      if (!nextName) return null;
      let nextProject: CadProject | null = null;
      if (targetEntity.type === 'survey-point') {
        if (
          stationIdExists(snapshot.project, nextName) &&
          nextName.toUpperCase() !== targetEntity.stationId.trim().toUpperCase()
        ) {
          return null;
        }
        nextProject = replaceCadProjectEntities(
          snapshot.project,
          snapshot.project.entities.map((entity) =>
            renamePointReferences(entity, targetEntity.id, targetEntity.stationId, nextName),
          ),
        );
      } else if (targetEntity.type === 'alignment') {
        nextProject = replaceEntityInProject(snapshot.project, targetEntity.id, (entity) =>
          entity.type === 'alignment' ? { ...entity, name: nextName } : entity,
        );
      } else if (targetEntity.type === 'parcel') {
        nextProject = replaceEntityInProject(snapshot.project, targetEntity.id, (entity) =>
          entity.type === 'parcel' ? { ...entity, parcelName: nextName } : entity,
        );
      } else {
        nextProject = replaceEntityInProject(snapshot.project, targetEntity.id, (entity) =>
          withEntityMetadataName(entity, nextName),
        );
      }
      if (!nextProject) return null;
      return {
        nextSnapshot: {
          project: nextProject,
          selection: createCadSelectionState(nextProject, [targetEntity.id]),
        },
        commandState: {
          key: 'EDIT_ENTITY',
          phase: 'committed',
          prompt: `EDIT_ENTITY committed for ${nextName}.`,
        },
        transactionLabel: `EDIT_ENTITY (${nextName})`,
        addedEntityIds: [],
        removedEntityIds: [],
      };
    }

    if (targetEntity.type === 'survey-point') {
      const nextX = command.edit.kind === 'point-x' ? command.edit.value : targetEntity.x;
      const nextY = command.edit.kind === 'point-y' ? command.edit.value : targetEntity.y;
      const nextZ =
        command.edit.kind === 'point-z'
          ? command.edit.value ?? undefined
          : targetEntity.z;
      if (
        !Number.isFinite(nextX) ||
        !Number.isFinite(nextY) ||
        (nextZ != null && !Number.isFinite(nextZ))
      ) {
        return null;
      }
      const nextProject = replaceCadProjectEntities(
        snapshot.project,
        snapshot.project.entities.map((entity) =>
          movePointReferences(entity, targetEntity.id, targetEntity.stationId, nextX, nextY, nextZ),
        ),
      );
      return {
        nextSnapshot: {
          project: nextProject,
          selection: createCadSelectionState(nextProject, [targetEntity.id]),
        },
        commandState: {
          key: 'EDIT_ENTITY',
          phase: 'committed',
          prompt: `EDIT_ENTITY committed for ${targetEntity.stationId}.`,
        },
        transactionLabel: `EDIT_ENTITY (${targetEntity.stationId})`,
        addedEntityIds: [],
        removedEntityIds: [],
      };
    }

    if (targetEntity.type === 'line' && command.edit.kind === 'line-end') {
      const edit = command.edit;
      const updatedEntity: CadEntity = {
        ...targetEntity,
        toX: edit.toX,
        toY: edit.toY,
      };
      const nextProjectBase = replaceEntityInProject(snapshot.project, targetEntity.id, (_entity) =>
        updatedEntity,
      );
      const nextProject = syncEditedEntityDependencies(nextProjectBase, targetEntity, updatedEntity);
      return {
        nextSnapshot: {
          project: nextProject,
          selection: createCadSelectionState(nextProject, [targetEntity.id]),
        },
        commandState: {
          key: 'EDIT_ENTITY',
          phase: 'committed',
          prompt: `EDIT_ENTITY committed for ${getCadEntityDisplayLabel(targetEntity)}.`,
        },
        transactionLabel: `EDIT_ENTITY (${getCadEntityDisplayLabel(targetEntity)})`,
        addedEntityIds: [],
        removedEntityIds: [],
      };
    }

    if (targetEntity.type === 'arc' && command.edit.kind === 'arc-radius') {
      const value = command.edit.value;
      if (!Number.isFinite(value) || value <= 0) return null;
      const updatedEntity: CadEntity = { ...targetEntity, radius: value };
      const nextProjectBase = replaceEntityInProject(snapshot.project, targetEntity.id, (_entity) =>
        updatedEntity,
      );
      const nextProject = syncEditedEntityDependencies(nextProjectBase, targetEntity, updatedEntity);
      return {
        nextSnapshot: {
          project: nextProject,
          selection: createCadSelectionState(nextProject, [targetEntity.id]),
        },
        commandState: {
          key: 'EDIT_ENTITY',
          phase: 'committed',
          prompt: `EDIT_ENTITY committed for ${getCadEntityDisplayLabel(targetEntity)}.`,
        },
        transactionLabel: `EDIT_ENTITY (${getCadEntityDisplayLabel(targetEntity)})`,
        addedEntityIds: [],
        removedEntityIds: [],
      };
    }

    // Polygons share the polyline {x, y} vertex layout; created boundary sources are polygons.
    const isRingEditable = targetEntity.type === 'polyline' || targetEntity.type === 'polygon';
    if (isRingEditable && command.edit.kind === 'polyline-vertex') {
      const edit = command.edit;
      const vertex = targetEntity.vertices[edit.vertexIndex];
      if (!vertex) return null;
      const vertices = targetEntity.vertices.map((entry, index) =>
        index === edit.vertexIndex ? { x: edit.x, y: edit.y } : entry,
      );
      // Phase 18W: a boundary source must stay a valid ring (fail closed).
      if (validateBoundaryEntityVertexEdit(snapshot.project, targetEntity.id, vertices)) return null;
      const updatedEntity: CadEntity = { ...targetEntity, vertices };
      const nextProjectBase = replaceEntityInProject(snapshot.project, targetEntity.id, (_entity) => updatedEntity);
      const nextProject = syncEditedEntityDependencies(nextProjectBase, targetEntity, updatedEntity);
      return {
        nextSnapshot: {
          project: nextProject,
          selection: createCadSelectionState(nextProject, [targetEntity.id]),
        },
        commandState: {
          key: 'EDIT_ENTITY',
          phase: 'committed',
          prompt: `EDIT_ENTITY committed for ${getCadEntityDisplayLabel(targetEntity)}.`,
        },
        transactionLabel: `EDIT_ENTITY (${getCadEntityDisplayLabel(targetEntity)})`,
        addedEntityIds: [],
        removedEntityIds: [],
      };
    }

    // Phase 18W follow-up: same-vertex-count batch Apply in ONE history entry.
    // Single-vertex branch above is untouched; this shares its gate + guard.
    if (isRingEditable && command.edit.kind === 'polyline-vertices') {
      const moves = command.edit.vertices;
      if (!Array.isArray(moves) || moves.length === 0) return null;
      const byIndex = new Map<number, { x: number; y: number }>();
      for (const move of moves) {
        if (!Number.isInteger(move.vertexIndex)) return null;
        if (!Number.isFinite(move.x) || !Number.isFinite(move.y)) return null;
        if (!targetEntity.vertices[move.vertexIndex]) return null;
        byIndex.set(move.vertexIndex, { x: move.x, y: move.y });
      }
      const vertices = targetEntity.vertices.map((entry, index) => byIndex.get(index) ?? entry);
      // Phase 18W: a boundary source must stay a valid ring (fail closed).
      if (validateBoundaryEntityVertexEdit(snapshot.project, targetEntity.id, vertices)) return null;
      const updatedEntity: CadEntity = { ...targetEntity, vertices };
      const nextProjectBase = replaceEntityInProject(snapshot.project, targetEntity.id, (_entity) => updatedEntity);
      const nextProject = syncEditedEntityDependencies(nextProjectBase, targetEntity, updatedEntity);
      return {
        nextSnapshot: {
          project: nextProject,
          selection: createCadSelectionState(nextProject, [targetEntity.id]),
        },
        commandState: {
          key: 'EDIT_ENTITY',
          phase: 'committed',
          prompt: `EDIT_ENTITY committed for ${getCadEntityDisplayLabel(targetEntity)}.`,
        },
        transactionLabel: `EDIT_ENTITY (${getCadEntityDisplayLabel(targetEntity)})`,
        addedEntityIds: [],
        removedEntityIds: [],
      };
    }

    return null;
  },
};

