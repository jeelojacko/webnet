// Exam Prep — deterministic recall-task derivation.
//
// Recall cards are derived PURELY from each unit's `mustRecall` entries in
// canonical manifest order. Only mustRecall entries become cards (A 18 /
// B 27 / C 6 / D 0 / NAV 6 / DRILL 0 = 57); mustLocate, sourceAnchors,
// recognitionCues, and drill answers never create cards. The derivation is
// deterministic: the same manifest units always produce the same task list.

import type { ExamCurriculumUnit } from '../examCurriculum/examCurriculumTypes';
import { EXAM_PREP_RECALL_PROMPT } from './examPrepConstants';
import { EXAM_PREP_MANIFEST } from './examPrepManifest';
import type { ExamPrepRecallTask } from './examPrepTypes';

/** Units eligible for Learn studied progress (A-D + NAV; excludes DRILL). */
export const isExamPrepLearnUnit = (unit: ExamCurriculumUnit): boolean =>
  unit.tier === 'A' || unit.tier === 'B' || unit.tier === 'C' || unit.tier === 'D' ||
  unit.tier === 'NAV';

/** Pure derivation over any manifest unit list in canonical order. */
export const deriveExamPrepRecallTasks = (
  units: ExamCurriculumUnit[],
): ExamPrepRecallTask[] => {
  const tasks: ExamPrepRecallTask[] = [];
  let order = 0;
  units.forEach((unit, curriculumIndex) => {
    if (unit.tier === 'DRILL') return;
    unit.mustRecall.forEach((expectedAnswer, index) => {
      order += 1;
      tasks.push({
        id: `recall:${unit.id}:${index + 1}`,
        unitId: unit.id,
        unitTitle: unit.title,
        tier: unit.tier,
        index: index + 1,
        order,
        reviewWeight: unit.reviewWeight,
        curriculumIndex,
        prompt: EXAM_PREP_RECALL_PROMPT,
        expectedAnswer,
      });
    });
  });
  return tasks;
};

/** Frozen current-hash task list derived once from the bundled manifest. */
export const EXAM_PREP_RECALL_TASKS: ExamPrepRecallTask[] = deriveExamPrepRecallTasks(
  EXAM_PREP_MANIFEST.units,
);

/** Frozen current-hash Learn units (exactly 133 A-D/NAV units). */
export const EXAM_PREP_LEARN_UNITS: ExamCurriculumUnit[] = EXAM_PREP_MANIFEST.units.filter(
  isExamPrepLearnUnit,
);

export const examPrepTaskById = (taskId: string): ExamPrepRecallTask | undefined =>
  EXAM_PREP_RECALL_TASKS.find((task) => task.id === taskId);
