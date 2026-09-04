// Exam Prep — pure current-binding selectors.
//
// All selectors filter every record by BOTH `curriculumId` and
// `curriculumContentHash` from the bundled manifest. Archived
// same-curriculum/different-hash records stay in the persisted arrays
// (byte-preserved and exportable) but are excluded from current metrics and
// from queue/session construction. Uninitialized recall progress is treated
// as new (not introduced, never due).

import type { ExamCurriculumUnit } from '../examCurriculum/examCurriculumTypes';
import { isCurrentExamPrepBinding } from './examPrepManifest';
import { EXAM_PREP_LEARN_UNITS, EXAM_PREP_RECALL_TASKS } from './examPrepRecallTasks';
import type { ExamPrepRecallProgress, ExamPrepUnitProgress } from './examPrepTypes';

export const selectCurrentUnitProgress = (
  records: ExamPrepUnitProgress[],
): ExamPrepUnitProgress[] => records.filter(isCurrentExamPrepBinding);

export const selectCurrentRecallProgress = (
  records: ExamPrepRecallProgress[],
): ExamPrepRecallProgress[] => records.filter(isCurrentExamPrepBinding);

export const isExamPrepUnitStudied = (
  records: ExamPrepUnitProgress[],
  unitId: string,
): boolean => selectCurrentUnitProgress(records).some((record) => record.unitId === unitId);

export const selectUnitStudiedAt = (
  records: ExamPrepUnitProgress[],
  unitId: string,
): string | null => {
  const record = selectCurrentUnitProgress(records).find(
    (entry) => entry.unitId === unitId,
  );
  return record?.studiedAt ?? null;
};

/** Studied count over the canonical Learn units (X / 133). */
export const selectStudiedLearnUnitCount = (
  records: ExamPrepUnitProgress[],
  units: ExamCurriculumUnit[] = EXAM_PREP_LEARN_UNITS,
): number => {
  const studiedIds = new Set(selectCurrentUnitProgress(records).map((entry) => entry.unitId));
  return units.filter((unit) => studiedIds.has(unit.id)).length;
};

export const selectUnitProgressForUnit = (
  records: ExamPrepUnitProgress[],
  unitId: string,
): ExamPrepUnitProgress | null =>
  selectCurrentUnitProgress(records).find((entry) => entry.unitId === unitId) ?? null;

export const selectStudiedForUnit = (
  records: ExamPrepUnitProgress[],
  unitId: string,
): { studied: boolean; studiedAt: string | null } => {
  const studiedAt = selectUnitStudiedAt(records, unitId);
  return { studied: studiedAt !== null, studiedAt };
};

export const isExamPrepRecallIntroduced = (progress: ExamPrepRecallProgress): boolean =>
  isCurrentExamPrepBinding(progress) &&
  progress.scheduling.initialized === true &&
  Boolean(progress.scheduling.card);

export const examPrepRecallDueAt = (progress: ExamPrepRecallProgress): string | null =>
  isCurrentExamPrepBinding(progress) && progress.scheduling.initialized && progress.scheduling.card
    ? progress.scheduling.card.due
    : null;

export const isExamPrepRecallDue = (
  progress: ExamPrepRecallProgress,
  now: Date,
): boolean => {
  const dueAt = examPrepRecallDueAt(progress);
  return Boolean(dueAt && dueAt <= now.toISOString());
};

export const selectCurrentRecallProgressForTask = (
  records: ExamPrepRecallProgress[],
  taskId: string,
): ExamPrepRecallProgress | null =>
  selectCurrentRecallProgress(records).find((entry) => entry.taskId === taskId) ?? null;

/** Introduced (rated at least once) count over the 57 canonical cards. */
export const selectIntroducedRecallTaskCount = (
  records: ExamPrepRecallProgress[],
  tasks = EXAM_PREP_RECALL_TASKS,
): number => {
  const progressByTask = new Map(
    selectCurrentRecallProgress(records).map((entry) => [entry.taskId, entry]),
  );
  return tasks.filter((task) => {
    const entry = progressByTask.get(task.id);
    return Boolean(entry && isExamPrepRecallIntroduced(entry));
  }).length;
};

/** Due count over the 57 canonical cards as of `now`. */
export const selectDueRecallTaskCount = (
  records: ExamPrepRecallProgress[],
  now: Date,
  tasks = EXAM_PREP_RECALL_TASKS,
): number => {
  const progressByTask = new Map(
    selectCurrentRecallProgress(records).map((entry) => [entry.taskId, entry]),
  );
  return tasks.filter((task) => {
    const entry = progressByTask.get(task.id);
    return Boolean(entry && isExamPrepRecallDue(entry, now));
  }).length;
};

/** New count (never introduced, i.e. no current-hash progress record). */
export const selectNewRecallTaskCount = (
  records: ExamPrepRecallProgress[],
  tasks = EXAM_PREP_RECALL_TASKS,
): number => {
  const introducedIds = new Set(
    selectCurrentRecallProgress(records)
      .filter(isExamPrepRecallIntroduced)
      .map((entry) => entry.taskId),
  );
  return tasks.filter((task) => !introducedIds.has(task.id)).length;
};

export type ExamPrepHomeMetrics = {
  studiedLearnUnits: number;
  totalLearnUnits: number;
  dueRecallCards: number;
  introducedRecallCards: number;
  newRecallCards: number;
  totalRecallCards: number;
};

export const buildExamPrepHomeMetrics = (
  unitProgress: ExamPrepUnitProgress[],
  recallProgress: ExamPrepRecallProgress[],
  now: Date,
): ExamPrepHomeMetrics => ({
  studiedLearnUnits: selectStudiedLearnUnitCount(unitProgress),
  totalLearnUnits: EXAM_PREP_LEARN_UNITS.length,
  dueRecallCards: selectDueRecallTaskCount(recallProgress, now),
  introducedRecallCards: selectIntroducedRecallTaskCount(recallProgress),
  newRecallCards: selectNewRecallTaskCount(recallProgress),
  totalRecallCards: EXAM_PREP_RECALL_TASKS.length,
});
