import type { CadWorkspaceSnapshot } from './cadTransactions.types';
import type { CadEntity, CadEntityId, CadProject } from './cadTypes';

export const expandSelectedEntityIds = (
  project: CadProject,
  selectedEntityIds: readonly CadEntityId[],
): CadEntityId[] => {
  const expanded = new Set(selectedEntityIds);
  project.entities.forEach((entity) => {
    if (entity.type === 'text' && entity.anchorEntityId && expanded.has(entity.anchorEntityId)) {
      expanded.add(entity.id);
      return;
    }
    if (entity.type === 'error-ellipse' && expanded.has(`pt:${entity.stationId}`)) {
      expanded.add(entity.id);
    }
  });
  return project.entities.filter((entity) => expanded.has(entity.id)).map((entity) => entity.id);
};

export const getExpandedSelectedEntities = (snapshot: CadWorkspaceSnapshot): CadEntity[] => {
  const expandedIds = new Set(
    expandSelectedEntityIds(snapshot.project, snapshot.selection.selectedEntityIds),
  );
  return snapshot.project.entities.filter((entity) => expandedIds.has(entity.id) && !entity.locked);
};

export const getExpandedEntitiesByIds = (
  project: CadProject,
  selectedEntityIds: readonly CadEntityId[],
): CadEntity[] => {
  const expandedIds = new Set(expandSelectedEntityIds(project, selectedEntityIds));
  return project.entities.filter((entity) => expandedIds.has(entity.id) && !entity.locked);
};
