// Exam Prep — immutable snapshot helpers.
//
// All Exam Prep state updates replace an entry by identity (upsert) or
// append immutable attempts; nothing is mutated in place. UI-only session /
// card / reveal / textarea state lives in components, not here. Attempt
// appends are fail-closed on duplicate ids (a write never silently replaces
// an existing immutable attempt in the in-memory snapshot).

import type { ExamPrepAttempt } from './examPrepTypes';

export const upsertById = <T extends { id: string }>(items: T[], item: T): T[] => [
  ...items.filter((entry) => entry.id !== item.id),
  item,
];

export const removeById = <T extends { id: string }>(items: T[], id: string): T[] =>
  items.filter((entry) => entry.id !== id);

export const appendImmutableAttempt = (
  attempts: ExamPrepAttempt[],
  attempt: ExamPrepAttempt,
): ExamPrepAttempt[] => {
  if (attempts.some((entry) => entry.id === attempt.id)) return attempts;
  return [...attempts, attempt];
};
