// Exam Prep — immutable snapshot helpers.
//
// All Exam Prep state updates replace an entry by identity (upsert) or
// append immutable attempts; nothing is mutated in place. UI-only session /
// card / reveal / textarea state lives in components, not here.

import type { ExamPrepRecallAttempt } from './examPrepTypes';

export const upsertById = <T extends { id: string }>(items: T[], item: T): T[] => [
  ...items.filter((entry) => entry.id !== item.id),
  item,
];

export const removeById = <T extends { id: string }>(items: T[], id: string): T[] =>
  items.filter((entry) => entry.id !== id);

export const appendImmutableAttempt = (
  attempts: ExamPrepRecallAttempt[],
  attempt: ExamPrepRecallAttempt,
): ExamPrepRecallAttempt[] => {
  if (attempts.some((entry) => entry.id === attempt.id)) return attempts;
  return [...attempts, attempt];
};
