// Exam Prep Mock — current-binding session selectors.
//
// Every selector filters the immutable current binding (curriculumId +
// curriculumContentHash) so archived same-curriculum/different-hash mock
// sessions stay persisted and exportable but never become the current active
// mock or enter current history. If imported/corrupt data ever yields more
// than one current `in_progress` session, the selectors pick the latest by
// startedAt deterministically and surface a warning through
// `selectDuplicateActiveMockSessions`.

import { isCurrentExamPrepBinding } from '../examPrepManifest';
import { buildMockScore } from './examPrepMockResults';
import type { ExamPrepMockSession } from './examPrepMockTypes';

export const selectCurrentMockSessions = (
  sessions: ExamPrepMockSession[],
): ExamPrepMockSession[] => sessions.filter(isCurrentExamPrepBinding);

export const selectMockSessionById = (
  sessions: ExamPrepMockSession[],
  sessionId: string,
): ExamPrepMockSession | undefined => sessions.find((session) => session.id === sessionId);

const byStartedAtDesc = (a: ExamPrepMockSession, b: ExamPrepMockSession): number =>
  b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id);

/** Current `in_progress` sessions; empty normally, >1 only for corrupt data. */
export const selectInProgressMockSessions = (
  sessions: ExamPrepMockSession[],
): ExamPrepMockSession[] =>
  selectCurrentMockSessions(sessions)
    .filter((session) => session.status === 'in_progress')
    .sort(byStartedAtDesc);

/** Latest current in-progress session (deterministic tiebreak), or null. */
export const selectActiveMockSession = (
  sessions: ExamPrepMockSession[],
): ExamPrepMockSession | null => selectInProgressMockSessions(sessions)[0] ?? null;

/**
 * True when the given route is the focused mock-exam page while a current
 * in-progress session exists. Study hides the header Return in that state so
 * an active exam cannot be exited accidentally through history-back.
 */
export const isActiveMockExamRoute = (
  routePath: string,
  sessions: ExamPrepMockSession[],
): boolean => routePath === '/study/mock-exam' && selectActiveMockSession(sessions) !== null;

/** More than one current in-progress session => corrupted/imported data warning. */
export const selectDuplicateActiveMockSessions = (
  sessions: ExamPrepMockSession[],
): ExamPrepMockSession[] => selectInProgressMockSessions(sessions).slice(1);

export const selectSubmittedMockSessions = (
  sessions: ExamPrepMockSession[],
): ExamPrepMockSession[] =>
  selectCurrentMockSessions(sessions)
    .filter((session) => session.status === 'submitted')
    .sort(byStartedAtDesc);

export const selectGradedMockSessions = (
  sessions: ExamPrepMockSession[],
): ExamPrepMockSession[] =>
  selectCurrentMockSessions(sessions)
    .filter((session) => session.status === 'graded')
    .sort(byStartedAtDesc);

export type ExamPrepLatestGradedMockSummary = {
  sessionId: string;
  startedAt: string;
  points: number;
  totalPoints: number;
  percent: number | null;
};

/**
 * Latest current-binding graded mock for the Home dashboard (newest by
 * startedAt). Null when nothing is graded yet — callers must render a
 * neutral "no graded mock" state, never a fake 0 / 0 score.
 */
export const selectLatestGradedMockSummary = (
  sessions: ExamPrepMockSession[],
): ExamPrepLatestGradedMockSummary | null => {
  const latest = selectGradedMockSessions(sessions)[0];
  if (!latest) return null;
  const score = buildMockScore(latest);
  return {
    sessionId: latest.id,
    startedAt: latest.startedAt,
    points: score.points,
    totalPoints: score.totalPoints,
    percent: score.percent,
  };
};

export const selectAbandonedMockSessions = (
  sessions: ExamPrepMockSession[],
): ExamPrepMockSession[] =>
  selectCurrentMockSessions(sessions)
    .filter((session) => session.status === 'abandoned')
    .sort(byStartedAtDesc);

/** Graded + submitted (grading-incomplete) current sessions for history. */
export const selectRecentMockResults = (
  sessions: ExamPrepMockSession[],
  limit = 10,
): ExamPrepMockSession[] =>
  [...selectGradedMockSessions(sessions), ...selectSubmittedMockSessions(sessions)]
    .sort(byStartedAtDesc)
    .slice(0, limit);
