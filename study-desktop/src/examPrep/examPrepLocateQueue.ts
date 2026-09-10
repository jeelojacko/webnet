import { selectLocateAttempts } from './examPrepAttemptSelectors';
import { EXAM_PREP_LOCATE_TASKS } from './examPrepLocateTasks';
import { buildExamPrepPracticeQueue } from './examPrepPracticeQueue';
import type { ExamPrepAttempt, ExamPrepLocateTask } from './examPrepTypes';

export const LOCATE_SPRINT_SIZE = 10;

export const buildExamPrepLocateQueue = (
  attempts: ExamPrepAttempt[],
  tasks: ExamPrepLocateTask[] = EXAM_PREP_LOCATE_TASKS,
): ExamPrepLocateTask[] => buildExamPrepPracticeQueue(tasks, selectLocateAttempts(attempts));
