// Exam Prep — pure "Today's activity" derivation.
//
// Phase 2.5 derives a per-day activity summary at runtime from the existing
// immutable records only — no daily-progress store is created. Every count is
// restricted to the current curriculum binding (archived same-curriculum /
// different-hash and other-curriculum records never appear) and to the
// machine-local calendar date via the shared `formatExamPrepLocalDate` helper
// (never UTC slicing), so counts hold under any browser time zone.

import { formatExamPrepLocalDate } from './examPrepLocalDate';
import { isCurrentExamPrepBinding } from './examPrepManifest';
import type { ExamPrepAttempt, ExamPrepUnitProgress } from './examPrepTypes';

export type ExamPrepTodayActivity = {
  studiedUnits: number;
  recallReviews: number;
  recognitionAttempts: number;
  locateAttempts: number;
  drillAttempts: number;
};

/** Machine-local calendar date of an ISO timestamp. */
const isoLocalDate = (iso: string): string => formatExamPrepLocalDate(new Date(iso));

/**
 * Counts current-hash activity whose timestamps fall on the local calendar
 * day of `now`. Drill attempts use their persisted browser-local
 * `practiceDate` field; every other kind converts its ISO timestamp to the
 * local calendar date.
 */
export const buildExamPrepTodayActivity = (
  unitProgress: ExamPrepUnitProgress[],
  attempts: ExamPrepAttempt[],
  now: Date,
): ExamPrepTodayActivity => {
  const today = formatExamPrepLocalDate(now);
  let studiedUnits = 0;
  let recallReviews = 0;
  let recognitionAttempts = 0;
  let locateAttempts = 0;
  let drillAttempts = 0;

  for (const progress of unitProgress) {
    if (isCurrentExamPrepBinding(progress) && isoLocalDate(progress.studiedAt) === today) {
      studiedUnits += 1;
    }
  }

  for (const attempt of attempts) {
    if (!isCurrentExamPrepBinding(attempt)) continue;
    switch (attempt.kind) {
      case 'recall':
        if (isoLocalDate(attempt.reviewedAt) === today) recallReviews += 1;
        break;
      case 'recognition':
        if (isoLocalDate(attempt.completedAt) === today) recognitionAttempts += 1;
        break;
      case 'locate':
        if (isoLocalDate(attempt.completedAt) === today) locateAttempts += 1;
        break;
      case 'drill':
        if (attempt.practiceDate === today) drillAttempts += 1;
        break;
    }
  }

  return { studiedUnits, recallReviews, recognitionAttempts, locateAttempts, drillAttempts };
};
