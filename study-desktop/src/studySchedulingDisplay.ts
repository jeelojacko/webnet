import type { StudyDataSnapshot, StudyProgress, StudyUnit } from './studyTypes';

export type StudySchedulingCategory =
  | 'source-review'
  | 'overdue'
  | 'due'
  | 'learning'
  | 'relearning'
  | 'review'
  | 'new';

export type StudySchedulingSummary = {
  unitId: string;
  label: string;
  category: StudySchedulingCategory;
  stateLabel: string;
  dueLabel: string;
  dueAt: string | null;
  sortDueAt: string;
  lastReviewedLabel: string;
  reviews: number | null;
  lapses: number | null;
  stability: number | null;
  difficulty: number | null;
};

const startOfLocalDay = (date: Date): Date => {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
};

const formatDate = (date: Date): string =>
  date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

const relativeDueLabel = (dueAt: string | null, now: Date): string => {
  if (!dueAt) return 'Not scheduled';
  const due = new Date(dueAt);
  const dueTime = due.getTime();
  const nowTime = now.getTime();
  if (!Number.isFinite(dueTime)) return 'Invalid due date';
  if (dueTime <= nowTime) {
    const overdueDays = Math.floor(
      (startOfLocalDay(now).getTime() - startOfLocalDay(due).getTime()) / 86_400_000,
    );
    if (overdueDays > 0) return `Overdue · ${overdueDays}d`;
    return 'Due today';
  }
  const minutes = Math.max(1, Math.round((dueTime - nowTime) / 60_000));
  if (minutes < 60) return `due in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `due in ${hours}h`;
  const tomorrow = startOfLocalDay(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (startOfLocalDay(due).getTime() === tomorrow.getTime()) return 'Tomorrow';
  return formatDate(due);
};

const cardDueAt = (progress: StudyProgress | undefined): string | null => {
  const schedule = progress?.scheduling;
  if (schedule?.initialized && schedule.card) return schedule.card.due;
  return schedule?.legacyDueAt ?? progress?.dueAt ?? null;
};

const categoryFor = (
  unit: StudyUnit,
  progress: StudyProgress | undefined,
  dueAt: string | null,
  now: Date,
): StudySchedulingCategory => {
  if (unit.sourceReviewRequired || unit.sourceReferenceMissing) return 'source-review';
  const card = progress?.scheduling?.initialized ? progress.scheduling.card : undefined;
  const dueTime = dueAt ? new Date(dueAt).getTime() : Number.NaN;
  const isDue = Number.isFinite(dueTime) && dueTime <= now.getTime();
  if (isDue && dueAt && startOfLocalDay(new Date(dueAt)).getTime() < startOfLocalDay(now).getTime())
    return 'overdue';
  if (isDue) return 'due';
  if (card?.state === 'Learning') return 'learning';
  if (card?.state === 'Relearning') return 'relearning';
  if (card?.state === 'Review') return 'review';
  return 'new';
};

const stateLabelFor = (
  unit: StudyUnit,
  progress: StudyProgress | undefined,
  category: StudySchedulingCategory,
): string => {
  if (unit.sourceReferenceMissing) return 'Source reference missing';
  if (unit.sourceReviewRequired) return 'Source review required';
  const cardState = progress?.scheduling?.initialized ? progress.scheduling.card?.state : undefined;
  if (cardState) return cardState;
  if (progress?.scheduling?.legacyDueAt) return 'Legacy due';
  if (category === 'new') return 'New';
  return 'Unscheduled';
};

const labelFor = (
  category: StudySchedulingCategory,
  stateLabel: string,
  dueLabel: string,
): string => {
  if (category === 'source-review') return stateLabel;
  if (category === 'new') return 'New';
  if (category === 'overdue') return dueLabel;
  if (category === 'due')
    return stateLabel === 'Learning' || stateLabel === 'Relearning'
      ? `${stateLabel} due`
      : 'Due today';
  if (category === 'learning' || category === 'relearning' || category === 'review')
    return `${stateLabel} · ${dueLabel}`;
  return stateLabel;
};

export const summarizeStudyScheduling = ({
  unit,
  progress,
  now,
}: {
  unit: StudyUnit;
  progress?: StudyProgress;
  now: Date;
}): StudySchedulingSummary => {
  const dueAt = cardDueAt(progress);
  const category = categoryFor(unit, progress, dueAt, now);
  const stateLabel = stateLabelFor(unit, progress, category);
  const dueLabel = relativeDueLabel(dueAt, now);
  const card = progress?.scheduling?.initialized ? progress.scheduling.card : undefined;
  return {
    unitId: unit.id,
    label: labelFor(category, stateLabel, dueLabel),
    category,
    stateLabel,
    dueLabel,
    dueAt,
    sortDueAt: dueAt ?? '9999-12-31T23:59:59.999Z',
    lastReviewedLabel: card?.last_review ? formatDate(new Date(card.last_review)) : 'Never',
    reviews: card?.reps ?? null,
    lapses: card?.lapses ?? null,
    stability: card?.stability ?? null,
    difficulty: card?.difficulty ?? null,
  };
};

export const summarizeStudySchedulingForData = (
  data: StudyDataSnapshot,
  now: Date,
): Map<string, StudySchedulingSummary> => {
  const progressByUnitId = new Map(data.progress.map((progress) => [progress.unitId, progress]));
  return new Map(
    data.units.map((unit) => [
      unit.id,
      summarizeStudyScheduling({ unit, progress: progressByUnitId.get(unit.id), now }),
    ]),
  );
};
