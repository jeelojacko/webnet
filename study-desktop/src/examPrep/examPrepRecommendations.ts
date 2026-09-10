// Exam Prep — deterministic "what next" recommendations (pure, advisory).
//
// Phase 2.5 adds two derived recommendations. Nothing here persists or
// mutates state; both helpers are deterministic for a fixed input snapshot.
//
// `selectExamPrepRecommendedAction` answers "Recommended Now" on Home with
// one fixed priority chain:
//
//   1. due Recall cards exist
//   2. an unstudied Learn unit exists
//   3. a missed Recognition task exists in current history
//   4. a missed Locate task exists in current history
//   5. a Developing drill exists
//   6. an Unattempted drill exists
//   7. an Accurate (not yet Exam-ready) drill exists
//   8. Recognition practice
//
// `selectRecommendedExamPrepDrill` picks the top drill needing work: within
// status priority Developing → Unattempted → Accurate (Exam-ready drills are
// never recommended), then review weight (high → medium → low), then
// canonical DRILL order. Archived/other-hash attempts never participate.

import type { ExamCurriculumUnit, ExamCurriculumReviewWeight } from '../examCurriculum/examCurriculumTypes';
import {
  latestAttemptByTaskId,
  selectLocateAttempts,
  selectRecognitionAttempts,
} from './examPrepAttemptSelectors';
import { buildExamPrepDrillStats, type ExamPrepDrillStatus } from './examPrepDrillStats';
import {
  EXAM_PREP_DRILL_UNITS,
  examPrepDrillTaskId,
  type ExamPrepDrillRow,
} from './examPrepDrillFilters';
import { selectDueRecallTaskCount, selectRecommendedLearnUnit } from './examPrepSelectors';
import type {
  ExamPrepAttempt,
  ExamPrepLocateAttempt,
  ExamPrepRecallProgress,
  ExamPrepRecognitionAttempt,
  ExamPrepUnitProgress,
} from './examPrepTypes';

export type ExamPrepRecommendedAction =
  | { kind: 'recall'; count: number; path: '/study/review' }
  | { kind: 'learn'; unitId: string; title: string; path: '/study/learn' }
  | { kind: 'recognition'; reason: 'missed' | 'practice'; path: '/study/recognition' }
  | { kind: 'locate'; reason: 'missed'; path: '/study/locate' }
  | {
      kind: 'drill';
      drillId: string;
      title: string;
      status: ExamPrepDrillStatus;
      path: '/study/drills';
    };

const weightRank = (weight: ExamCurriculumReviewWeight): number =>
  ({ high: 0, medium: 1, low: 2 })[weight];

const statusRank = (status: Exclude<ExamPrepDrillStatus, 'exam_ready'>): number =>
  ({ developing: 0, unattempted: 1, accurate: 2 })[status];

const hasLatestMissed = (
  attempts: ExamPrepAttempt[],
  kind: 'recognition' | 'locate',
): boolean => {
  // Current-hash only: archived/other-curriculum attempts never participate.
  const kindAttempts: Array<ExamPrepRecognitionAttempt | ExamPrepLocateAttempt> =
    kind === 'recognition' ? selectRecognitionAttempts(attempts) : selectLocateAttempts(attempts);
  const latest = latestAttemptByTaskId(kindAttempts);
  return [...latest.values()].some((attempt) => attempt.result === 'missed');
};

const compareDrillRowPriority = (
  left: { row: ExamPrepDrillRow; index: number },
  right: { row: ExamPrepDrillRow; index: number },
): number => {
  const leftStatus = left.row.stats.status as Exclude<ExamPrepDrillStatus, 'exam_ready'>;
  const rightStatus = right.row.stats.status as Exclude<ExamPrepDrillStatus, 'exam_ready'>;
  return (
    statusRank(leftStatus) -
      statusRank(rightStatus) ||
    weightRank(left.row.unit.reviewWeight) -
      weightRank(right.row.unit.reviewWeight) ||
    left.index - right.index
  );
};

/**
 * Top drill that still needs work (never Exam-ready). Deterministic: status
 * priority, then review weight, then canonical DRILL order.
 */
export const selectRecommendedExamPrepDrill = (
  attempts: ExamPrepAttempt[],
  units: ExamCurriculumUnit[] = EXAM_PREP_DRILL_UNITS,
): ExamPrepDrillRow | null => {
  const candidates: Array<{ row: ExamPrepDrillRow; index: number }> = [];
  units.forEach((unit, index) => {
    const row: ExamPrepDrillRow = {
      unit,
      stats: buildExamPrepDrillStats(attempts, examPrepDrillTaskId(unit.id)),
    };
    if (row.stats.status !== 'exam_ready') candidates.push({ row, index });
  });
  if (candidates.length === 0) return null;
  return candidates.sort(compareDrillRowPriority)[0]?.row ?? null;
};

/**
 * Advisory "Recommended Now" pick. Purely derived from the input snapshot;
 * never writes progress, never marks units studied.
 */
export const selectExamPrepRecommendedAction = (
  unitProgress: ExamPrepUnitProgress[],
  recallProgress: ExamPrepRecallProgress[],
  attempts: ExamPrepAttempt[],
  now: Date,
): ExamPrepRecommendedAction => {
  const dueRecallCount = selectDueRecallTaskCount(recallProgress, now);
  if (dueRecallCount > 0) {
    return { kind: 'recall', count: dueRecallCount, path: '/study/review' };
  }

  const learnUnit = selectRecommendedLearnUnit(unitProgress);
  if (learnUnit) {
    return { kind: 'learn', unitId: learnUnit.id, title: learnUnit.title, path: '/study/learn' };
  }

  if (hasLatestMissed(attempts, 'recognition')) {
    return { kind: 'recognition', reason: 'missed', path: '/study/recognition' };
  }

  if (hasLatestMissed(attempts, 'locate')) {
    return { kind: 'locate', reason: 'missed', path: '/study/locate' };
  }

  const drill = selectRecommendedExamPrepDrill(attempts);
  if (drill) {
    return {
      kind: 'drill',
      drillId: drill.unit.id,
      title: drill.unit.title,
      status: drill.stats.status,
      path: '/study/drills',
    };
  }

  return { kind: 'recognition', reason: 'practice', path: '/study/recognition' };
};
