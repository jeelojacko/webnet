import { createInitialProgress } from './studyScheduler';
import type {
  StudyDataSnapshot,
  StudyResponseMode,
  StudySessionItem,
  StudyUnit,
} from './studyTypes';

export const responseModeForStudyItem = (item: StudySessionItem): StudyResponseMode => {
  if (item.unit.responseModeOverride) return item.unit.responseModeOverride;
  if (item.progress.phase === 'guided-recall') return 'guided';
  return 'free-recall';
};

export const sourceTextForStudyItem = (data: StudyDataSnapshot, item: StudySessionItem): string => {
  const selectedKeys = new Set(
    item.unit.sourceReferences?.map(
      (reference) => `${reference.documentId}::${reference.sourceKey}`,
    ) ?? [],
  );
  return data.legalComponents
    .filter((component) => selectedKeys.has(`${component.documentId}::${component.sourceKey}`))
    .map(
      (component) =>
        `${component.label}${component.heading ? ` ${component.heading}` : ''}\n\n${component.text}`,
    )
    .join('\n\n');
};

const promptRankForUnit = (unit: StudyUnit, promptKind: string): number => {
  if (promptKind === (unit.promptKind ?? 'guided-recall')) return 0;
  if (promptKind === 'guided-recall') return 1;
  return 2;
};

export const buildStudySessionItemForUnit = ({
  data,
  unitId,
  now,
  reason,
}: {
  data: StudyDataSnapshot;
  unitId: string;
  now: Date;
  reason?: StudySessionItem['reason'];
}): StudySessionItem | null => {
  const unit = data.units.find((entry) => entry.id === unitId);
  if (!unit) return null;
  const prompt = data.prompts
    .filter((entry) => entry.unitId === unitId)
    .slice()
    .sort(
      (left, right) =>
        promptRankForUnit(unit, left.kind) - promptRankForUnit(unit, right.kind) ||
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id),
    )[0];
  if (!prompt) return null;
  const progress =
    data.progress.find((entry) => entry.unitId === unitId) ??
    createInitialProgress(unitId, now.toISOString());
  return {
    unit,
    prompt,
    progress,
    concepts: data.concepts
      .filter((concept) => concept.unitId === unitId)
      .sort((left, right) => left.order - right.order || left.label.localeCompare(right.label)),
    rubrics: data.rubrics
      .filter((rubric) => rubric.unitId === unitId)
      .sort((left, right) => left.order - right.order || left.prompt.localeCompare(right.prompt)),
    due: false,
    reason,
    dueAt: null,
  };
};

export const selectSurprisePracticeUnitId = (data: StudyDataSnapshot): string | null => {
  const promptUnitIds = new Set(data.prompts.map((prompt) => prompt.unitId));
  const lastAttemptByUnitId = new Map<string, string>();
  for (const attempt of data.attempts) {
    const current = lastAttemptByUnitId.get(attempt.unitId);
    if (!current || attempt.completedAt > current)
      lastAttemptByUnitId.set(attempt.unitId, attempt.completedAt);
  }
  return (
    data.units
      .filter(
        (unit) =>
          promptUnitIds.has(unit.id) && !unit.sourceReviewRequired && !unit.sourceReferenceMissing,
      )
      .slice()
      .sort((left, right) => {
        const leftLast = lastAttemptByUnitId.get(left.id) ?? '';
        const rightLast = lastAttemptByUnitId.get(right.id) ?? '';
        return (
          leftLast.localeCompare(rightLast) ||
          left.priority - right.priority ||
          left.title.localeCompare(right.title) ||
          left.id.localeCompare(right.id)
        );
      })[0]?.id ?? null
  );
};
