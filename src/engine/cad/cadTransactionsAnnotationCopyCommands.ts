/**
 * Phase 18O — COPY/PASTE support for semantic annotation entities.
 *
 * COPY/PASTE keep the existing behavior for every legacy entity kind and add
 * annotation copies: new id, anchors preserved to the *same* source entity
 * (never rebound to a copied source), and placement translated. The wrappers
 * compose the legacy commands so no copy logic is duplicated.
 */
import { resolveCurrentCadLayerId } from './cadLayers';
import { appendCadProjectEntities } from './cadProjectState';
import { createCadSelectionState } from './cadSelection';
import { copyCommand, pasteCommand } from './cadTransactionsClipboardCommands';
import { getExpandedEntitiesByIds, getExpandedSelectedEntities } from './cadTransactionsSelection';
import type { CadCommand, CadCommandDefinition } from './cadTransactions.types';
import type {
  CadBearingDistanceLabelEntity,
  CadCurveLabelEntity,
  CadDimensionEntity,
  CadEntity,
  CadLeaderEntity,
  CadMTextEntity,
  CadProject,
} from './cadTypes';
import { createStableRuntimeId } from '../id';

export type CadAnnotationEntity =
  | CadMTextEntity
  | CadLeaderEntity
  | CadDimensionEntity
  | CadBearingDistanceLabelEntity
  | CadCurveLabelEntity;

export const isCadAnnotationEntity = (entity: CadEntity): entity is CadAnnotationEntity =>
  entity.type === 'mtext' ||
  entity.type === 'leader' ||
  entity.type === 'dimension' ||
  entity.type === 'bearing-label' ||
  entity.type === 'curve-label';

const copyAnnotationEntity = (entity: CadAnnotationEntity, deltaX: number, deltaY: number): CadAnnotationEntity => {
  const metadata = { ...entity.metadata, createdBy: 'COPY', manual: true };
  switch (entity.type) {
    case 'mtext':
      return { ...entity, id: createStableRuntimeId('cad-mtext'), x: entity.x + deltaX, y: entity.y + deltaY, metadata };
    case 'leader':
      return {
        ...entity,
        id: createStableRuntimeId('cad-leader'),
        vertices: entity.vertices.map((vertex) => ({ x: vertex.x + deltaX, y: vertex.y + deltaY })),
        metadata,
      };
    case 'dimension':
      return {
        ...entity,
        id: createStableRuntimeId('cad-dimension'),
        dimLinePoint: { x: entity.dimLinePoint.x + deltaX, y: entity.dimLinePoint.y + deltaY },
        ...(entity.textPoint != null
          ? { textPoint: { x: entity.textPoint.x + deltaX, y: entity.textPoint.y + deltaY } }
          : {}),
        metadata,
      };
    case 'bearing-label':
      return {
        ...entity,
        id: createStableRuntimeId('cad-bearing-label'),
        offset: { x: entity.offset.x + deltaX, y: entity.offset.y + deltaY },
        metadata,
      };
    case 'curve-label':
      return {
        ...entity,
        id: createStableRuntimeId('cad-curve-label'),
        offset: { x: entity.offset.x + deltaX, y: entity.offset.y + deltaY },
        metadata,
      };
  }
};

export const buildCopiedAnnotationEntities = (
  project: CadProject,
  selectedEntities: readonly CadEntity[],
  deltaX: number,
  deltaY: number,
): CadAnnotationEntity[] => {
  const currentLayerId = resolveCurrentCadLayerId(project);
  return selectedEntities.flatMap((entity) => {
    if (!isCadAnnotationEntity(entity)) return [];
    const copy = copyAnnotationEntity(entity, deltaX, deltaY);
    return [copy.layerId === 'labels' ? copy : { ...copy, layerId: currentLayerId }];
  });
};

const mergeAnnotationCopies = (
  base: ReturnType<CadCommandDefinition<CadCommand>['execute']>,
  snapshot: { project: CadProject },
  annotationCopies: CadAnnotationEntity[],
  key: 'COPY' | 'PASTE',
  prompt: string,
): ReturnType<CadCommandDefinition<CadCommand>['execute']> => {
  if (annotationCopies.length === 0) return base;
  const nextProject = appendCadProjectEntities(
    base?.nextSnapshot.project ?? snapshot.project,
    annotationCopies,
  );
  const selectionIds = [
    ...(base?.nextSnapshot.selection.selectedEntityIds ?? []),
    ...annotationCopies.map((entity) => entity.id),
  ];
  const addedEntityIds = [
    ...(base?.addedEntityIds ?? []),
    ...annotationCopies.map((entity) => entity.id),
  ];
  return {
    nextSnapshot: {
      project: nextProject,
      selection: createCadSelectionState(nextProject, selectionIds),
    },
    commandState: { key, phase: 'committed', prompt },
    transactionLabel: `${key} (${addedEntityIds.length})`,
    addedEntityIds,
    removedEntityIds: [],
  };
};

/**
 * COPY wrapper: keeps the legacy copy behavior for every existing entity kind
 * and appends annotation copies (new ids, anchors preserved to the same
 * source, placement translated).
 */
export const annotationAwareCopyCommand: CadCommandDefinition<Extract<CadCommand, { key: 'COPY' }>> = {
  key: 'COPY',
  execute: (snapshot, command) => {
    if (Math.abs(command.deltaX) <= 1e-9 && Math.abs(command.deltaY) <= 1e-9) return null;
    const base = copyCommand.execute(snapshot, command);
    return mergeAnnotationCopies(
      base,
      snapshot,
      buildCopiedAnnotationEntities(
        snapshot.project,
        getExpandedSelectedEntities(snapshot),
        command.deltaX,
        command.deltaY,
      ),
      'COPY',
      `COPY committed by (${command.deltaX.toFixed(3)}, ${command.deltaY.toFixed(3)}).`,
    );
  },
};

/**
 * PASTE wrapper: same composition as COPY, so pasting a copied/selected
 * annotation keeps the semantic entity instead of silently dropping it.
 */
export const annotationAwarePasteCommand: CadCommandDefinition<Extract<CadCommand, { key: 'PASTE' }>> = {
  key: 'PASTE',
  execute: (snapshot, command) => {
    if (Math.abs(command.deltaX) <= 1e-9 && Math.abs(command.deltaY) <= 1e-9) return null;
    const base = pasteCommand.execute(snapshot, command);
    return mergeAnnotationCopies(
      base,
      snapshot,
      buildCopiedAnnotationEntities(
        snapshot.project,
        getExpandedEntitiesByIds(snapshot.project, command.entityIds),
        command.deltaX,
        command.deltaY,
      ),
      'PASTE',
      `PASTE committed by (${command.deltaX.toFixed(3)}, ${command.deltaY.toFixed(3)}).`,
    );
  },
};
