import type { CadEntity, CadEntityId, CadProject } from './cadTypes';

export interface CadSelectionState {
  selectedEntityIds: CadEntityId[];
}

const normalizeSelectionIds = (
  project: CadProject,
  entityIds: readonly CadEntityId[],
): CadEntityId[] => {
  const requested = new Set(entityIds);
  return project.entities
    .filter((entity) => requested.has(entity.id))
    .map((entity) => entity.id);
};

export const createCadSelectionState = (
  project: CadProject,
  entityIds: readonly CadEntityId[] = [],
): CadSelectionState => ({
  selectedEntityIds: normalizeSelectionIds(project, entityIds),
});

export const clearCadSelection = (): CadSelectionState => ({
  selectedEntityIds: [],
});

export const selectAllCadEntities = (project: CadProject): CadSelectionState => ({
  selectedEntityIds: project.entities.filter((entity) => entity.visible).map((entity) => entity.id),
});

export const replaceCadSelection = (
  project: CadProject,
  entityIds: readonly CadEntityId[],
): CadSelectionState => ({
  selectedEntityIds: normalizeSelectionIds(project, entityIds),
});

export const toggleCadSelectionEntity = (
  project: CadProject,
  selection: CadSelectionState,
  entityId: CadEntityId,
): CadSelectionState => {
  const selected = new Set(selection.selectedEntityIds);
  if (selected.has(entityId)) {
    selected.delete(entityId);
  } else {
    selected.add(entityId);
  }
  return replaceCadSelection(project, [...selected]);
};

export const isCadEntitySelected = (
  selection: CadSelectionState,
  entityId: CadEntityId,
): boolean => selection.selectedEntityIds.includes(entityId);

export const getSelectedCadEntities = (
  project: CadProject,
  selection: CadSelectionState,
): CadEntity[] => {
  const selected = new Set(selection.selectedEntityIds);
  return project.entities.filter((entity) => selected.has(entity.id));
};
