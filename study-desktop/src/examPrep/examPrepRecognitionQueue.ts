import { selectRecognitionAttempts } from './examPrepAttemptSelectors';
import { buildExamPrepPracticeQueue } from './examPrepPracticeQueue';
import { EXAM_PREP_RECOGNITION_TASKS } from './examPrepRecognitionTasks';
import type { ExamPrepAttempt, ExamPrepRecognitionTask } from './examPrepTypes';

export const RECOGNITION_SPRINT_SIZE = 10;

export const buildExamPrepRecognitionQueue = (
  attempts: ExamPrepAttempt[],
  tasks: ExamPrepRecognitionTask[] = EXAM_PREP_RECOGNITION_TASKS,
): ExamPrepRecognitionTask[] => buildExamPrepPracticeQueue(tasks, selectRecognitionAttempts(attempts));
