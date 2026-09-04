// Exam Prep Mock — pure results/counting helpers.
//
// Scoring, expiry, answered/flagged/graded counts and the type breakdown live
// here (never inside React components). All functions are pure over a session
// record plus an explicit clock; they never read the real wall clock.

import type { ExamPrepMockProfile } from './examPrepMockProfiles';
import { examPrepMockProfilePointTotal, examPrepMockProfileQuestionTotal } from './examPrepMockProfiles';
import type {
  ExamPrepMockQuestionGrading,
  ExamPrepMockQuestionKind,
  ExamPrepMockResponse,
  ExamPrepMockSession,
} from './examPrepMockTypes';

export const mockResponseByQuestionId = (
  session: ExamPrepMockSession,
  questionId: string,
): ExamPrepMockResponse | undefined =>
  session.responses.find((response) => response.questionId === questionId);

export const isMockExpired = (session: ExamPrepMockSession, nowMs: number): boolean =>
  Date.parse(session.deadlineAt) <= nowMs;

/** Whole seconds until the deadline (never negative). */
export const mockRemainingSeconds = (session: ExamPrepMockSession, nowMs: number): number =>
  Math.max(0, Math.floor((Date.parse(session.deadlineAt) - nowMs) / 1000));

/** Whole seconds since the session started (never negative). */
export const mockElapsedSeconds = (session: ExamPrepMockSession, nowMs: number): number =>
  Math.max(0, Math.floor((nowMs - Date.parse(session.startedAt)) / 1000));

export const mockAnsweredCount = (session: ExamPrepMockSession): number =>
  session.responses.filter((response) => response.answer.trim() !== '').length;

export const mockUnansweredCount = (session: ExamPrepMockSession): number =>
  session.questions.length - mockAnsweredCount(session);

export const mockVisitedCount = (session: ExamPrepMockSession): number =>
  session.responses.filter((response) => response.visited).length;

export const mockFlaggedCount = (session: ExamPrepMockSession): number =>
  session.responses.filter((response) => response.flagged).length;

export const mockGradedCount = (session: ExamPrepMockSession): number =>
  session.responses.filter((response) => response.grading !== null).length;

/** All 30 questions have self-grading records (finalization gate). */
export const isMockFullyGraded = (session: ExamPrepMockSession): boolean =>
  session.questions.length > 0 &&
  session.responses.every((response) => response.grading !== null);

const gradingPoints = (grading: ExamPrepMockQuestionGrading): number =>
  grading.pointsAwarded;

export const buildMockScore = (
  session: ExamPrepMockSession,
): { points: number; totalPoints: number; percent: number | null } => {
  const totalPoints = session.questions.reduce(
    (sum, question) => sum + question.pointsPossible,
    0,
  );
  const points = session.responses.reduce(
    (sum, response) => sum + (response.grading ? gradingPoints(response.grading) : 0),
    0,
  );
  const percent = totalPoints === 0 ? null : Math.round((points / totalPoints) * 100);
  return { points, totalPoints, percent };
};

export type ExamPrepMockKindScore = {
  kind: ExamPrepMockQuestionKind;
  earned: number;
  possible: number;
  correct: number;
  total: number;
};

export const buildMockTypeBreakdown = (
  session: ExamPrepMockSession,
): Record<ExamPrepMockQuestionKind, ExamPrepMockKindScore> => {
  const kinds: ExamPrepMockQuestionKind[] = ['recall', 'recognition', 'locate', 'drill'];
  const breakdown = kinds.map((kind) => {
    const questionRefs = session.questions.filter((question) => question.kind === kind);
    const responses = questionRefs
      .map((question) => mockResponseByQuestionId(session, question.questionId))
      .filter((response): response is ExamPrepMockResponse => Boolean(response));
    const possible = questionRefs.reduce((sum, question) => sum + question.pointsPossible, 0);
    const earned = responses.reduce(
      (sum, response) => sum + (response.grading ? gradingPoints(response.grading) : 0),
      0,
    );
    const correct = responses.filter(
      (response) =>
        response.grading !== null &&
        (response.grading.kind === 'drill'
          ? response.grading.pointsAwarded > 0
          : response.grading.correct),
    ).length;
    return { kind, earned, possible, correct, total: questionRefs.length };
  });
  return {
    recall: breakdown[0],
    recognition: breakdown[1],
    locate: breakdown[2],
    drill: breakdown[3],
  };
};

/** Display helpers bound to a profile (start screen / history readouts). */
export const profileQuestionTotal = (profile: ExamPrepMockProfile): number =>
  examPrepMockProfileQuestionTotal(profile);

export const profilePointTotal = (profile: ExamPrepMockProfile): number =>
  examPrepMockProfilePointTotal(profile);
