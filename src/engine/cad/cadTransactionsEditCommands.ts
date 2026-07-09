import { createCadSelectionState } from './cadSelection';
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
import type { CadEntity, CadEntityId, CadProject } from './cadTypes';
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
    | { kind: 'polyline-vertex'; vertexIndex: number; x: number; y: number };
}> = {
  key: 'EDIT_ENTITY',
  execute: (snapshot, command) => {
    const targetEntity = snapshot.project.entities.find((entity) => entity.id === command.entityId);
    if (!targetEntity) return null;

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

    if (targetEntity.type === 'polyline' && command.edit.kind === 'polyline-vertex') {
      const edit = command.edit;
      const vertex = targetEntity.vertices[edit.vertexIndex];
      if (!vertex) return null;
      const updatedEntity: CadEntity = {
        ...targetEntity,
        vertices: targetEntity.vertices.map((entry, index) =>
          index === edit.vertexIndex ? { x: edit.x, y: edit.y } : entry,
        ),
      };
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

