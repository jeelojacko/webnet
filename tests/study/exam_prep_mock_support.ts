// Exam Prep Mock — shared test fixtures.
//
// Pure factories that build realistic ExamPrepMockSession records over the
// frozen profile + paper so focused tests (paper generation, session helpers,
// results, selectors, storage, UI) share one shape.

import { currentExamPrepBinding, EXAM_PREP_MANIFEST } from '../../src/study/examPrep/examPrepManifest';
import { EXAM_PREP_PROVISIONAL_MOCK_V1 } from '../../src/study/examPrep/mock/examPrepMockProfiles';
import { buildExamPrepMockPaper } from '../../src/study/examPrep/mock/examPrepMockPaper';
import { examPrepMockSessionId } from '../../src/study/examPrep/mock/examPrepMockSession';
import {
  finalizeMock,
  gradeMockQuestion,
  submitMock,
} from '../../src/study/examPrep/mock/examPrepMockSession';
import type {
  ExamPrepMockQuestionGrading,
  ExamPrepMockSession,
  ExamPrepMockSessionStatus,
} from '../../src/study/examPrep/mock/examPrepMockTypes';

export const MOCK_FIXED_SEED = 'mock-test-seed-0001';

/** Fresh in-progress session bound to the current curriculum hash. */
export const makeMockSession = ({
  seed = MOCK_FIXED_SEED,
  startedAt = '2026-09-08T14:00:00.000Z',
  status = 'in_progress',
}: {
  seed?: string;
  startedAt?: string;
  status?: ExamPrepMockSessionStatus;
} = {}): ExamPrepMockSession => {
  const binding = currentExamPrepBinding();
  const paper = buildExamPrepMockPaper({ profile: EXAM_PREP_PROVISIONAL_MOCK_V1, seed });
  const id = examPrepMockSessionId(binding, `mock-${seed}`);
  return {
    ...binding,
    id,
    profileId: EXAM_PREP_PROVISIONAL_MOCK_V1.id,
    profileVersion: EXAM_PREP_PROVISIONAL_MOCK_V1.version,
    profileSnapshot: EXAM_PREP_PROVISIONAL_MOCK_V1,
    seed,
    status,
    startedAt,
    deadlineAt: new Date(
      new Date(startedAt).getTime() + EXAM_PREP_PROVISIONAL_MOCK_V1.durationMinutes * 60_000,
    ).toISOString(),
    updatedAt: startedAt,
    submittedAt: null,
    gradedAt: null,
    abandonedAt: null,
    currentQuestionIndex: 0,
    questions: paper,
    responses: paper.map((question) => ({
      questionId: question.questionId,
      answer: '',
      visited: false,
      flagged: false,
      responseUpdatedAt: null,
      grading: null,
    })),
  };
};

/** Human-authored full-session fixture used by results/grading tests. */
export const makeSubmittedMockSession = (): ExamPrepMockSession => {
  const session = makeMockSession({ status: 'in_progress', seed: 'scenario-seed' });
  const now = session.startedAt;
  const graded = submitMock(session, now);
  const byKind = (kind: string) =>
    graded.questions.filter((question) => question.kind === kind);
  let next = graded;
  const grade = (kind: string, correctList: boolean[]) => {
    const items = byKind(kind);
    items.forEach((question, position) => {
      const correct = correctList[position] ?? false;
      const grading: ExamPrepMockQuestionGrading =
        kind === 'drill'
          ? {
              kind: 'drill',
              lawIdentified: correct,
              provisionLocated: correct,
              substantiveAnswerComplete: correct,
              pointsAwarded: correct ? 3 : 0,
              gradedAt: now,
            }
          : {
              kind: kind as 'recall',
              correct,
              pointsAwarded: correct ? 1 : 0,
              gradedAt: now,
            };
      next = gradeMockQuestion(next, question.questionId, grading, now);
    });
  };
  // Recall 6 -> 5/6; Recognition 8 -> 7/8; Locate 10 -> 7/10; Drills 6 -> 15/18
  grade('recall', [true, true, true, true, true, false]);
  grade('recognition', [true, true, true, true, true, true, true, false]);
  grade('locate', [true, true, true, true, true, true, true, false, false, false]);
  grade('drill', [true, true, true, true, true, false]);
  return next;
};

/** Fully graded session with the exact 34/42 practice score (submitted first). */
export const makeGradedMockSession = (): ExamPrepMockSession => {
  const submitted = makeSubmittedMockSession();
  return finalizeMock(submitted, submitted.startedAt);
};
