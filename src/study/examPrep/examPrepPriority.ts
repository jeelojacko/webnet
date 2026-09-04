// Exam Prep — deterministic new-content priority ordering.
//
// Both the recall queue's new-card ordering and the Home "recommended next"
// selection share ONE rank philosophy. Ranks are exactly:
//
//   0  high A    3  other A    6  C
//   1  high B    4  other B    7  D
//   2  high NAV  5  other NAV  8  DRILL (never ranked for recall/learn)
//
// "high" means `reviewWeight === 'high'`; "other" is medium or low. Within
// the same rank the tie-break is curriculum (manifest) index, then the
// 1-based mustRecall index inside the unit, then the task id — so equal-rank
// cards stay in canonical manifest order and the outcome is fully
// deterministic for a fixed task list.

import type { ExamCurriculumReviewWeight } from '../examCurriculum/examCurriculumTypes';
import type { ExamPrepCurriculumTier, ExamPrepRecallTask } from './examPrepTypes';

/** Numeric rank for the tier/weight pair (lower rank sorts first). */
export const examPrepPriorityGroup = (
  tier: ExamPrepCurriculumTier,
  reviewWeight: ExamCurriculumReviewWeight,
): number => {
  const high = reviewWeight === 'high';
  switch (tier) {
    case 'A':
      return high ? 0 : 3;
    case 'B':
      return high ? 1 : 4;
    case 'NAV':
      return high ? 2 : 5;
    case 'C':
      return 6;
    case 'D':
      return 7;
    default:
      return 8; // DRILL units never rank for recall or Learn study
  }
};

/** Deterministic comparator for new recall cards (rank, then ties). */
export const compareExamPrepRecallTaskPriority = (
  left: ExamPrepRecallTask,
  right: ExamPrepRecallTask,
): number =>
  examPrepPriorityGroup(left.tier, left.reviewWeight) -
    examPrepPriorityGroup(right.tier, right.reviewWeight) ||
  left.curriculumIndex - right.curriculumIndex ||
  left.index - right.index ||
  left.id.localeCompare(right.id);
