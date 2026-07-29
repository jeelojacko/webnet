import type { CadEntity, CadProject } from './cadTypes';
import { syncArcSupportEntities } from './cadTransactionsArcSupportEntities';
import { syncLinkedSurveyPointPosition } from './cadTransactionsPointReferences';

export { createArcSupportEntities, syncArcSupportEntities } from './cadTransactionsArcSupportEntities';
export { buildCopiedDependentPointEntities } from './cadTransactionsCopiedDependents';
export {
  movePointReferences,
  renamePointReferences,
  resolveLinkedSurveyPoint,
  syncLinkedSurveyPointPosition,
} from './cadTransactionsPointReferences';

export const syncEditedEntityDependencies = (
  project: CadProject,
  previousEntity: CadEntity,
  updatedEntity: CadEntity,
  options?: { syncLinePoints?: boolean },
): CadProject => {
  if (
    (options?.syncLinePoints ?? true) &&
    previousEntity.type === 'line' &&
    updatedEntity.type === 'line'
  ) {
    let nextProject = syncLinkedSurveyPointPosition(
      project,
      previousEntity.fromStationId,
      { x: previousEntity.fromX, y: previousEntity.fromY },
      { x: updatedEntity.fromX, y: updatedEntity.fromY },
    );
    nextProject = syncLinkedSurveyPointPosition(
      nextProject,
      previousEntity.toStationId,
      { x: previousEntity.toX, y: previousEntity.toY },
      { x: updatedEntity.toX, y: updatedEntity.toY },
    );
    return nextProject;
  }
  if (
    (previousEntity.type === 'polyline' && updatedEntity.type === 'polyline') ||
    (previousEntity.type === 'polygon' && updatedEntity.type === 'polygon') ||
    (previousEntity.type === 'parcel' && updatedEntity.type === 'parcel')
  ) {
    return previousEntity.vertices.reduce((currentProject, previousVertex, index) => {
      const nextVertex = updatedEntity.vertices[index];
      if (!nextVertex) return currentProject;
      return syncLinkedSurveyPointPosition(
        currentProject,
        previousEntity.vertexLabels[index],
        previousVertex,
        nextVertex,
      );
    }, project);
  }
  if (previousEntity.type === 'arc' && updatedEntity.type === 'arc') {
    return syncArcSupportEntities(project, updatedEntity);
  }
  return project;
};
