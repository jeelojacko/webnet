import type { StudySearchService } from './studySearchService';

export type StudySearchBulkUpdate = {
  upsertManyStudyUnits: (_unitIds: string[]) => void;
  removeStudyUnits: (_unitIds: string[]) => void;
  commit: () => void;
};

export const beginStudySearchBulkUpdate = (
  service: Pick<StudySearchService, 'commitStudyBulkUpdate'>,
): StudySearchBulkUpdate => {
  const upsertUnitIds = new Set<string>();
  const removeUnitIds = new Set<string>();
  return {
    upsertManyStudyUnits(unitIds) {
      unitIds.forEach((unitId) => {
        upsertUnitIds.add(unitId);
        removeUnitIds.delete(unitId);
      });
    },
    removeStudyUnits(unitIds) {
      unitIds.forEach((unitId) => {
        removeUnitIds.add(unitId);
        upsertUnitIds.delete(unitId);
      });
    },
    commit() {
      service.commitStudyBulkUpdate({
        upsertUnitIds: Array.from(upsertUnitIds).sort(),
        removeUnitIds: Array.from(removeUnitIds).sort(),
      });
    },
  };
};
