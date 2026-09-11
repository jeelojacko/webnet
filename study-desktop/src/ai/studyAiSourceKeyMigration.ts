import type { AiProposedSourceGroup } from './studyAiTypes';

/** Explicit Phase 4C remaps for frozen AI artifacts invalidated by corpus cleanup. */
export const remapStudySourceKey = (documentId: string, sourceKey: string): string => {
  if (documentId === 'doc-new-brunswick-land-surveyors-act' && sourceKey === 'section:30') {
    return 'section:30(3)';
  }
  if (
    documentId === 'doc-new-brunswick-land-surveyors-bylaws' &&
    sourceKey === 'section:1986'
  ) {
    return 'section:15.1';
  }
  return sourceKey;
};

export const remapStudySourceGroup = (
  documentId: string,
  group: AiProposedSourceGroup,
): AiProposedSourceGroup => ({
  ...group,
  sourceKeys: group.sourceKeys.map((key) => remapStudySourceKey(documentId, key)),
  focusSelections: group.focusSelections.map((selection) => ({
    ...selection,
    sourceKey: remapStudySourceKey(documentId, selection.sourceKey),
  })),
});
