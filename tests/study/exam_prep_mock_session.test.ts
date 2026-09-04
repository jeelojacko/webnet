// Exam Prep Mock — session update helpers + results helpers + selectors.

import { describe, expect, it } from 'vitest';
import { EXAM_PREP_PROVISIONAL_MOCK_V1 } from '../../src/study/examPrep/mock/examPrepMockProfiles';
import { EXAM_PREP_MANIFEST } from '../../src/study/examPrep/examPrepManifest';
import {
  abandonMock,
  finalizeMock,
  gradeMockQuestion,
  markMockVisited,
  setMockAnswer,
  setMockCurrentIndex,
  setMockFlagged,
  submitMock,
} from '../../src/study/examPrep/mock/examPrepMockSession';
import {
  buildMockScore,
  buildMockTypeBreakdown,
  isMockExpired,
  isMockFullyGraded,
  mockAnsweredCount,
  mockElapsedSeconds,
  mockFlaggedCount,
  mockGradedCount,
  mockRemainingSeconds,
  mockTimeUsedSeconds,
  mockUnansweredCount,
} from '../../src/study/examPrep/mock/examPrepMockResults';
import {
  isActiveMockExamRoute,
  selectActiveMockSession,
  selectCurrentMockSessions,
  selectDuplicateActiveMockSessions,
  selectGradedMockSessions,
  selectRecentMockResults,
  selectSubmittedMockSessions,
} from '../../src/study/examPrep/mock/examPrepMockSelectors';
import {
  EXAM_PREP_TEST_ARCHIVED_HASH,
} from './exam_prep_test_support';
import { makeGradedMockSession, makeMockSession, makeSubmittedMockSession } from './exam_prep_mock_support';
import type { ExamPrepMockSession } from '../../src/study/examPrep/mock/examPrepMockTypes';

const NOW = '2026-09-08T14:00:00.000Z';
const NOW_MS = Date.parse(NOW);

describe('mock session creation + immutable update helpers', () => {
  it('creates an in-progress session with a 150-minute deadline', () => {
    const session = makeMockSession();
    expect(session.status).toBe('in_progress');
    expect(session.startedAt).toBe(NOW);
    expect(session.deadlineAt).toBe('2026-09-08T16:30:00.000Z');
    expect(session.profileSnapshot.id).toBe('nb-statute-provisional-v1');
    expect(session.profileSnapshot.durationMinutes).toBe(150);
    expect(session.questions).toHaveLength(30);
    expect(session.responses).toHaveLength(30);
    expect(session.responses.every((response) => response.grading === null)).toBe(true);
  });

  it('setMockAnswer persists the typed text immutably', () => {
    const session = makeMockSession();
    const later = '2026-09-08T14:05:00.000Z';
    const first = setMockAnswer(session, session.questions[0]?.questionId ?? 'q01', 'my rule', later);
    expect(first.responses[0]?.answer).toBe('my rule');
    expect(first.responses[0]?.responseUpdatedAt).toBe(later);
    expect(session.responses[0]?.answer).toBe('');
    expect(session.updatedAt).not.toBe(first.updatedAt);
    // original untouched: mutating the returned record must not affect the base
    const second = setMockAnswer(first, session.questions[0]?.questionId ?? 'q01', 'edited', later);
    expect(first.responses[0]?.answer).toBe('my rule');
    expect(second.responses[0]?.answer).toBe('edited');
  });

  it('flag/visited/current-index helpers never mutate question refs or profile snapshot', () => {
    const session = makeMockSession();
    const originalQuestions = session.questions;
    const flagged = setMockFlagged(session, session.questions[0]?.questionId ?? 'q01', true, NOW);
    expect(flagged.responses[0]?.flagged).toBe(true);
    const visited = markMockVisited(session, session.questions[0]?.questionId ?? 'q01', NOW);
    expect(visited.responses[0]?.visited).toBe(true);
    expect(visited.questions).toBe(originalQuestions);
    expect(visited.profileSnapshot).toBe(session.profileSnapshot);
    const moved = setMockCurrentIndex(session, 7, NOW);
    expect(moved.currentQuestionIndex).toBe(7);
    expect(setMockCurrentIndex(session, 9999, NOW).currentQuestionIndex).toBe(29);
  });

  it('submit/abandon/finalize transitions are one-way state changes', () => {
    const session = makeMockSession();
    const submitted = submitMock(session, NOW);
    expect(submitted.status).toBe('submitted');
    expect(submitted.submittedAt).toBe(NOW);
    expect(submitted.responses).toHaveLength(30);
    const abandoned = abandonMock(session, NOW);
    expect(abandoned.status).toBe('abandoned');
    expect(abandoned.abandonedAt).toBe(NOW);
    const final = finalizeMock(submitted, NOW);
    expect(final.status).toBe('graded');
    expect(final.gradedAt).toBe(NOW);
  });

  it('gradeMockQuestion replaces the grading for one question', () => {
    const submitted = makeSubmittedMockSession();
    const qid = submitted.questions[0]?.questionId ?? 'q01';
    const next = gradeMockQuestion(submitted, qid, { kind: 'recall', correct: true, pointsAwarded: 1, gradedAt: NOW }, NOW);
    expect(next.responses.find((r) => r.questionId === qid)?.grading).toEqual({
      kind: 'recall',
      correct: true,
      pointsAwarded: 1,
      gradedAt: NOW,
    });
  });
});

describe('mock results helpers', () => {
  it('computes expiry/remaining/elapsed from the persisted deadline only', () => {
    const session = makeMockSession({ startedAt: '2026-09-08T14:00:00.000Z' });
    expect(isMockExpired(session, NOW_MS)).toBe(false);
    expect(mockRemainingSeconds(session, NOW_MS)).toBe(150 * 60);
    expect(mockElapsedSeconds(session, NOW_MS)).toBe(0);
    const oneMinuteLater = NOW_MS + 60_000;
    expect(mockRemainingSeconds(session, oneMinuteLater)).toBe(149 * 60);
    expect(mockElapsedSeconds(session, oneMinuteLater)).toBe(60);
    expect(isMockExpired(session, Date.parse(session.deadlineAt))).toBe(true);
    expect(mockRemainingSeconds(session, Date.parse(session.deadlineAt) + 5)).toBe(0);
  });

  it('answered/flagged/visited/graded counts reflect the responses', () => {
    let session = makeMockSession();
    session = setMockAnswer(session, session.questions[0]?.questionId ?? 'q01', 'one', NOW);
    session = setMockAnswer(session, session.questions[1]?.questionId ?? 'q02', 'two', NOW);
    session = setMockFlagged(session, session.questions[0]?.questionId ?? 'q01', true, NOW);
    session = markMockVisited(session, session.questions[2]?.questionId ?? 'q03', NOW);
    expect(mockAnsweredCount(session)).toBe(2);
    expect(mockUnansweredCount(session)).toBe(28);
    expect(mockFlaggedCount(session)).toBe(1);
    const submitted = submitMock(session, NOW);
    expect(mockGradedCount(submitted)).toBe(0);
    const graded = gradeMockQuestion(submitted, submitted.questions[0]?.questionId ?? 'q01', { kind: 'recall', correct: true, pointsAwarded: 1, gradedAt: NOW }, NOW);
    expect(mockGradedCount(graded)).toBe(1);
    expect(isMockFullyGraded(graded)).toBe(false);
  });

  it('scores the plan scenario as 34 / 42 → 81% with the type breakdown', () => {
    const session = makeSubmittedMockSession();
    expect(isMockFullyGraded(session)).toBe(true);
    const score = buildMockScore(session);
    expect(score).toEqual({ points: 34, totalPoints: 42, percent: 81 });
    const breakdown = buildMockTypeBreakdown(session);
    expect(breakdown.recall).toMatchObject({ earned: 5, possible: 6, correct: 5, total: 6 });
    expect(breakdown.recognition).toMatchObject({ earned: 7, possible: 8, correct: 7, total: 8 });
    expect(breakdown.locate).toMatchObject({ earned: 7, possible: 10, correct: 7, total: 10 });
    expect(breakdown.drill).toMatchObject({ earned: 15, possible: 18, correct: 5, total: 6 });
    const final = finalizeMock(session, NOW);
    expect(final.status).toBe('graded');
    expect(buildMockScore(final).points).toBe(34);
  });

  it('zeroes ungraded points instead of inventing scores', () => {
    const fresh = makeMockSession();
    const score = buildMockScore(fresh);
    expect(score).toEqual({ points: 0, totalPoints: 42, percent: 0 });
  });

  it('counts a drill as complete only at the full 3/3 self-score', () => {
    let session = submitMock(makeMockSession({ seed: 'drill-partial' }), NOW);
    const drillQuestions = session.questions.filter((question) => question.kind === 'drill');
    expect(drillQuestions).toHaveLength(6);
    const [full, partialTwo, partialOne] = drillQuestions;
    const gradeDrill = (
      current: ExamPrepMockSession,
      questionId: string,
      points: number,
    ): ExamPrepMockSession =>
      gradeMockQuestion(
        current,
        questionId,
        {
          kind: 'drill',
          lawIdentified: points >= 1,
          provisionLocated: points >= 2,
          substantiveAnswerComplete: points >= 3,
          pointsAwarded: points as 0 | 1 | 2 | 3,
          gradedAt: NOW,
        },
        NOW,
      );
    if (!full || !partialTwo || !partialOne) throw new Error('expected six drills');
    session = gradeDrill(session, full.questionId, 3);
    session = gradeDrill(session, partialTwo.questionId, 2);
    session = gradeDrill(session, partialOne.questionId, 1);
    const breakdown = buildMockTypeBreakdown(session);
    // Only the full 3/3 drill counts as correct/complete; 1/3 and 2/3 stay partial.
    expect(breakdown.drill).toMatchObject({ correct: 1, total: 6, earned: 6 });
    // The same earned points appear in the overall score regardless.
    expect(buildMockScore(session).points).toBe(6);
  });

  it('reports time used from submission, never from later grading', () => {
    const started = '2026-09-08T14:00:00.000Z';
    const submittedAt = '2026-09-08T16:00:00.000Z'; // 2h into the 2.5h mock
    const gradedNextDay = '2026-09-09T09:00:00.000Z';
    const session = submitMock(makeMockSession({ seed: 'time-submit', startedAt: started }), submittedAt);
    const graded = finalizeMock(session, gradedNextDay);
    expect(mockTimeUsedSeconds(graded)).toBe(2 * 60 * 60);
    expect(mockTimeUsedSeconds(session)).toBe(2 * 60 * 60);
  });

  it('reports time used for abandoned sessions from abandonment', () => {
    const started = '2026-09-08T14:00:00.000Z';
    const abandonedAt = '2026-09-08T14:45:00.000Z';
    const session = abandonMock(makeMockSession({ seed: 'time-abandon', startedAt: started }), abandonedAt);
    expect(mockTimeUsedSeconds(session)).toBe(45 * 60);
  });

  it('clamps time used to the hard-stop deadline for late submissions', () => {
    const started = '2026-09-08T14:00:00.000Z';
    // Submitted 10 minutes AFTER the 150-minute deadline expired.
    const submittedLate = '2026-09-08T16:40:00.000Z';
    const session = submitMock(
      makeMockSession({ seed: 'time-late', startedAt: started }),
      submittedLate,
    );
    expect(mockTimeUsedSeconds(session)).toBe(150 * 60);
  });

  it('returns zero time used while a session is still in progress', () => {
    expect(mockTimeUsedSeconds(makeMockSession())).toBe(0);
  });
});

describe('mock selectors (current-binding filtering)', () => {
  const archivedSession = (_status: ExamPrepMockSession['status']): ExamPrepMockSession => {
    const session = makeMockSession({ status: 'in_progress' });
    return { ...session, curriculumContentHash: EXAM_PREP_TEST_ARCHIVED_HASH };
  };

  it('ignores archived sessions everywhere in current selectors', () => {
    const active = makeMockSession();
    const sessions = [active, archivedSession('in_progress'), archivedSession('graded')];
    expect(selectCurrentMockSessions(sessions)).toEqual([active]);
    expect(selectActiveMockSession(sessions)).toBe(active);
    expect(selectActiveMockSession([archivedSession('in_progress')])).toBeNull();
  });

  it('selects the latest in-progress session and surfaces duplicates', () => {
    const older = makeMockSession({ startedAt: '2026-09-08T10:00:00.000Z' });
    const newer = makeMockSession({ startedAt: '2026-09-08T11:00:00.000Z' });
    const sessions = [newer, older];
    expect(selectActiveMockSession(sessions)?.id).toBe(newer.id);
    expect(selectDuplicateActiveMockSessions(sessions).map((s) => s.id)).toEqual([older.id]);
  });

  it('splits submitted/graded/abandoned and orders recent results newest first', () => {
    const gradedOld = makeGradedMockSession();
    const graded = { ...gradedOld, startedAt: '2026-09-09T10:00:00.000Z', updatedAt: '2026-09-09T10:00:00.000Z' };
    const submitted = makeSubmittedMockSession();
    const sessions = [makeMockSession(), graded, submitted, archivedSession('graded')];
    expect(selectGradedMockSessions(sessions).map((s) => s.id)).toEqual([graded.id]);
    expect(selectSubmittedMockSessions(sessions).map((s) => s.id)).toEqual([submitted.id]);
    const recent = selectRecentMockResults(sessions, 10);
    expect(recent.map((s) => s.id)).toEqual([graded.id, submitted.id]);
  });

  it('selectRecentMockResults respects the display limit', () => {
    const sessions = [makeGradedMockSession(), makeSubmittedMockSession()];
    expect(selectRecentMockResults(sessions, 1)).toHaveLength(1);
  });
});

describe('profile provenance survives on session records', () => {
  it('stores the full profile snapshot used at start', () => {
    const session = makeMockSession();
    expect(session.profileId).toBe(EXAM_PREP_PROVISIONAL_MOCK_V1.id);
    expect(session.profileVersion).toBe(1);
    expect(session.profileSnapshot).toEqual(EXAM_PREP_PROVISIONAL_MOCK_V1);
    expect(session.curriculumId).toBe(EXAM_PREP_MANIFEST.curriculumId);
    expect(session.curriculumContentHash).toBe(EXAM_PREP_MANIFEST.contentHash);
  });
});

describe('mock exam return lock (header Return safety)', () => {
  const archivedSession = (_status: ExamPrepMockSession['status']): ExamPrepMockSession => {
    const session = makeMockSession({ status: 'in_progress' });
    return { ...session, curriculumContentHash: EXAM_PREP_TEST_ARCHIVED_HASH };
  };

  it('locks only the focused mock-exam route while a current session is in progress', () => {
    const active = makeMockSession();
    expect(isActiveMockExamRoute('/study/mock-exam', [active])).toBe(true);
    // Any other route (source reader while checking a provision) stays unlocked.
    expect(isActiveMockExamRoute('/study/document/doc-x', [active])).toBe(false);
    expect(isActiveMockExamRoute('/study/mock-exam', [])).toBe(false);
  });

  it('ignores non-current and non-in-progress sessions for the lock', () => {
    const archived = archivedSession('in_progress');
    expect(isActiveMockExamRoute('/study/mock-exam', [archived])).toBe(false);
    const graded = makeMockSession({ status: 'graded' });
    expect(isActiveMockExamRoute('/study/mock-exam', [graded])).toBe(false);
  });
});
