import type { StudyDataSnapshot, StudyProgress, StudyUnit } from './studyTypes';

export type StudyNextScheduledReview = {
  unitId: string;
  title: string;
  dueAt: string;
};

const progressByUnitId = (progress: StudyProgress[]): Map<string, StudyProgress> =>
  new Map(progress.map((entry) => [entry.unitId, entry]));

const hasPrompt = (data: StudyDataSnapshot, unitId: string): boolean =>
  data.prompts.some((prompt) => prompt.unitId === unitId);

const futureDueAt = (unit: StudyUnit, progress: StudyProgress | undefined, now: Date) => {
  if (unit.sourceReviewRequired || unit.sourceReferenceMissing) return null;
  const schedule = progress?.scheduling;
  const dueAt =
    schedule?.initialized && schedule.card ? schedule.card.due : schedule?.legacyDueAt ?? null;
  if (!dueAt) return null;
  if (!schedule?.initialized && progress?.phase === 'unread') return null;
  return new Date(dueAt).getTime() > now.getTime() ? dueAt : null;
};

export const findNextScheduledStudyReview = (
  data: StudyDataSnapshot,
  now: Date,
): StudyNextScheduledReview | null => {
  const progressMap = progressByUnitId(data.progress);
  return data.units
    .map((unit) => {
      const dueAt = futureDueAt(unit, progressMap.get(unit.id), now);
      if (!dueAt || !hasPrompt(data, unit.id)) return null;
      return { unitId: unit.id, title: unit.title, dueAt };
    })
    .filter((entry): entry is StudyNextScheduledReview => Boolean(entry))
    .sort(
      (left, right) =>
        left.dueAt.localeCompare(right.dueAt) ||
        left.title.localeCompare(right.title) ||
        left.unitId.localeCompare(right.unitId),
    )[0] ?? null;
};

export const millisecondsUntilNextScheduledReview = (
  nextReview: StudyNextScheduledReview | null,
  now: Date,
): number | null => {
  if (!nextReview) return null;
  const delay = new Date(nextReview.dueAt).getTime() - now.getTime();
  return Number.isFinite(delay) ? Math.max(0, delay) : null;
};
