import { isCurrentExamPrepBinding } from './examPrepManifest';
import type {
  ExamPrepAttempt,
  ExamPrepDrillAttempt,
  ExamPrepLocateAttempt,
  ExamPrepRecognitionAttempt,
} from './examPrepTypes';

export const selectCurrentExamPrepAttempts = (attempts: ExamPrepAttempt[]): ExamPrepAttempt[] =>
  attempts.filter(isCurrentExamPrepBinding);

export const selectRecognitionAttempts = (
  attempts: ExamPrepAttempt[],
): ExamPrepRecognitionAttempt[] =>
  selectCurrentExamPrepAttempts(attempts).filter(
    (attempt): attempt is ExamPrepRecognitionAttempt => attempt.kind === 'recognition',
  );

export const selectLocateAttempts = (attempts: ExamPrepAttempt[]): ExamPrepLocateAttempt[] =>
  selectCurrentExamPrepAttempts(attempts).filter(
    (attempt): attempt is ExamPrepLocateAttempt => attempt.kind === 'locate',
  );

export const selectDrillAttempts = (attempts: ExamPrepAttempt[]): ExamPrepDrillAttempt[] =>
  selectCurrentExamPrepAttempts(attempts).filter(
    (attempt): attempt is ExamPrepDrillAttempt => attempt.kind === 'drill',
  );

type CompletedAttempt = ExamPrepRecognitionAttempt | ExamPrepLocateAttempt | ExamPrepDrillAttempt;

const compareLatest = (left: CompletedAttempt, right: CompletedAttempt): number =>
  right.completedAt.localeCompare(left.completedAt) || right.id.localeCompare(left.id);

export const attemptsForTask = <T extends CompletedAttempt>(attempts: T[], taskId: string): T[] =>
  attempts.filter((attempt) => attempt.taskId === taskId).sort(compareLatest);

export const latestAttemptByTaskId = <T extends CompletedAttempt>(attempts: T[]): Map<string, T> => {
  const latest = new Map<string, T>();
  [...attempts].sort(compareLatest).forEach((attempt) => {
    if (!latest.has(attempt.taskId)) latest.set(attempt.taskId, attempt);
  });
  return latest;
};

export type ExamPrepRecognitionMetrics = {
  attemptedTasks: number;
  correctLatestTasks: number;
  accuracy: number | null;
};

export const buildRecognitionMetrics = (attempts: ExamPrepAttempt[]): ExamPrepRecognitionMetrics => {
  const latest = [...latestAttemptByTaskId(selectRecognitionAttempts(attempts)).values()];
  const correctLatestTasks = latest.filter((attempt) => attempt.result === 'got_it').length;
  return {
    attemptedTasks: latest.length,
    correctLatestTasks,
    accuracy: latest.length ? correctLatestTasks / latest.length : null,
  };
};

export type ExamPrepLocateMetrics = {
  attemptedTasks: number;
  foundLatestTasks: number;
  accuracy: number | null;
};

export const buildLocateMetrics = (attempts: ExamPrepAttempt[]): ExamPrepLocateMetrics => {
  const latest = [...latestAttemptByTaskId(selectLocateAttempts(attempts)).values()];
  const foundLatestTasks = latest.filter((attempt) => attempt.result === 'found').length;
  return {
    attemptedTasks: latest.length,
    foundLatestTasks,
    accuracy: latest.length ? foundLatestTasks / latest.length : null,
  };
};
