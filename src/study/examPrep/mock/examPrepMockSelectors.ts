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
