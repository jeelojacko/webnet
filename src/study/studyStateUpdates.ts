import type { StudyAttempt, StudyProgress } from './studyTypes';

export const replaceById = <T extends { id: string }>(items: T[], item: T): T[] => [
  ...items.filter((entry) => entry.id !== item.id),
  item,
];

export const replaceProgress = (items: StudyProgress[], item: StudyProgress): StudyProgress[] => [
  ...items.filter((entry) => entry.unitId !== item.unitId),
  item,
];

export const getLatestEligibleSchedulingAttempt = (
  attempts: StudyAttempt[],
): StudyAttempt | undefined =>
  attempts
    .filter(
      (attempt) => attempt.scheduling?.schedulingApplied === true && !attempt.scheduling.undoneAt,
    )
    .slice()
    .sort(
      (left, right) =>
        right.completedAt.localeCompare(left.completedAt) || right.id.localeCompare(left.id),
    )[0];

export const getLatestEligibleSchedulingAttemptForUnit = (
  attempts: StudyAttempt[],
  unitId: string,
): StudyAttempt | undefined =>
  getLatestEligibleSchedulingAttempt(attempts.filter((attempt) => attempt.unitId === unitId));
