import { selectDrillAttempts } from './examPrepAttemptSelectors';
import type { ExamPrepAttempt, ExamPrepDrillAttempt } from './examPrepTypes';

export type ExamPrepDrillStatus = 'unattempted' | 'developing' | 'accurate' | 'exam_ready';
export type ExamPrepDrillStats = {
  status: ExamPrepDrillStatus;
  attemptCount: number;
  latestAttempt: ExamPrepDrillAttempt | null;
  latestScore: number | null;
  latestElapsedSeconds: number | null;
  bestCorrectElapsedSeconds: number | null;
  qualifyingPracticeDates: string[];
};

export const buildExamPrepDrillStats = (
  attempts: ExamPrepAttempt[],
  taskId: string,
): ExamPrepDrillStats => {
  const matching = selectDrillAttempts(attempts)
    .filter((attempt) => attempt.taskId === taskId)
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt) || b.id.localeCompare(a.id));
  const latestAttempt = matching[0] ?? null;
  const correct = matching.filter((attempt) => attempt.score === 3);
  const qualifyingPracticeDates = [...new Set(
    correct
      .filter((attempt) => attempt.elapsedSeconds <= attempt.targetSeconds)
      .map((attempt) => attempt.practiceDate),
  )].sort();
  const status: ExamPrepDrillStatus = !latestAttempt
    ? 'unattempted'
    : qualifyingPracticeDates.length >= 2
      ? 'exam_ready'
      : latestAttempt.score === 3
        ? 'accurate'
        : 'developing';
  return {
    status,
    attemptCount: matching.length,
    latestAttempt,
    latestScore: latestAttempt?.score ?? null,
    latestElapsedSeconds: latestAttempt?.elapsedSeconds ?? null,
    bestCorrectElapsedSeconds: correct.length
      ? Math.min(...correct.map((attempt) => attempt.elapsedSeconds))
      : null,
    qualifyingPracticeDates,
  };
};

export const buildDrillMetrics = (attempts: ExamPrepAttempt[]) => {
  const taskIds = new Set(selectDrillAttempts(attempts).map((attempt) => attempt.taskId));
  return {
    attemptedDrills: taskIds.size,
    examReadyDrills: [...taskIds].filter(
      (taskId) => buildExamPrepDrillStats(attempts, taskId).status === 'exam_ready',
    ).length,
  };
};
