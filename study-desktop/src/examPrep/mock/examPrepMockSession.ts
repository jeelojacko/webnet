// Exam Prep Mock — session builders and immutable update helpers.
//
// Pure functions over ExamPrepMockSession records: creation and every state
// transition (answer/flag/visited/index/submit/grade/finalize/abandon). They
// never mutate their input, never touch the frozen question refs/profile
// snapshot, and always take an explicit `nowIso` so callers stay in control of
// the clock (tests use fixed timestamps).

import { examPrepProgressId } from '../examPrepManifest';
import type { ExamPrepCurriculumBinding } from '../examPrepTypes';
import type { ExamPrepMockProfile } from './examPrepMockProfiles';
import type {
  ExamPrepMockQuestionGrading,
  ExamPrepMockQuestionRef,
  ExamPrepMockResponse,
  ExamPrepMockSession,
} from './examPrepMockTypes';

export const examPrepMockLocalId = (): string =>
  `mock-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** Composite session record id: `${contentHash}::mock-…`. */
export const examPrepMockSessionId = (
  binding: ExamPrepCurriculumBinding,
  localId: string,
): string => examPrepProgressId(binding, localId);

const emptyResponseFor = (ref: ExamPrepMockQuestionRef): ExamPrepMockResponse => ({
  questionId: ref.questionId,
  answer: '',
  visited: false,
  flagged: false,
  responseUpdatedAt: null,
  grading: null,
});

/** Creates a fresh `in_progress` session with a deadline derived from the profile. */
export const createExamPrepMockSession = ({
  id,
  binding,
  profile,
  seed,
  paper,
  nowIso,
}: {
  id: string;
  binding: ExamPrepCurriculumBinding;
  profile: ExamPrepMockProfile;
  seed: string;
  paper: ExamPrepMockQuestionRef[];
  nowIso: string;
}): ExamPrepMockSession => ({
  ...binding,
  id,
  profileId: profile.id,
  profileVersion: profile.version,
  profileSnapshot: profile,
  seed,
  status: 'in_progress',
  startedAt: nowIso,
  deadlineAt: new Date(new Date(nowIso).getTime() + profile.durationMinutes * 60_000).toISOString(),
  updatedAt: nowIso,
  submittedAt: null,
  gradedAt: null,
  abandonedAt: null,
  currentQuestionIndex: 0,
  questions: paper.map((ref) => ({ ...ref })),
  responses: paper.map(emptyResponseFor),
});

const responseIndex = (session: ExamPrepMockSession, questionId: string): number =>
  session.responses.findIndex((response) => response.questionId === questionId);

const requireResponseIndex = (session: ExamPrepMockSession, questionId: string): number => {
  const index = responseIndex(session, questionId);
  if (index < 0) throw new Error(`Mock question not found: ${questionId}`);
  return index;
};

export const setMockAnswer = (
  session: ExamPrepMockSession,
  questionId: string,
  answer: string,
  nowIso: string,
): ExamPrepMockSession => {
  const index = requireResponseIndex(session, questionId);
  const responses = session.responses.slice();
  responses[index] = { ...responses[index], answer, responseUpdatedAt: nowIso };
  return { ...session, responses, updatedAt: nowIso };
};

export const setMockFlagged = (
  session: ExamPrepMockSession,
  questionId: string,
  flagged: boolean,
  nowIso: string,
): ExamPrepMockSession => {
  const index = requireResponseIndex(session, questionId);
  const responses = session.responses.slice();
  responses[index] = { ...responses[index], flagged };
  return { ...session, responses, updatedAt: nowIso };
};

export const markMockVisited = (
  session: ExamPrepMockSession,
  questionId: string,
  nowIso: string,
): ExamPrepMockSession => {
  const index = requireResponseIndex(session, questionId);
  const responses = session.responses.slice();
  if (responses[index].visited) return session;
  responses[index] = { ...responses[index], visited: true };
  return { ...session, responses, updatedAt: nowIso };
};

export const setMockCurrentIndex = (
  session: ExamPrepMockSession,
  currentQuestionIndex: number,
  nowIso: string,
): ExamPrepMockSession => {
  const clamped = Math.max(
    0,
    Math.min(currentQuestionIndex, Math.max(0, session.questions.length - 1)),
  );
  if (clamped === session.currentQuestionIndex) return session;
  return { ...session, currentQuestionIndex: clamped, updatedAt: nowIso };
};

export const submitMock = (
  session: ExamPrepMockSession,
  nowIso: string,
): ExamPrepMockSession => ({
  ...session,
  status: 'submitted',
  submittedAt: nowIso,
  updatedAt: nowIso,
});

export const gradeMockQuestion = (
  session: ExamPrepMockSession,
  questionId: string,
  grading: ExamPrepMockQuestionGrading,
  nowIso: string,
): ExamPrepMockSession => {
  const index = requireResponseIndex(session, questionId);
  const responses = session.responses.slice();
  responses[index] = { ...responses[index], grading };
  return { ...session, responses, updatedAt: nowIso };
};

export const finalizeMock = (
  session: ExamPrepMockSession,
  nowIso: string,
): ExamPrepMockSession => ({
  ...session,
  status: 'graded',
  gradedAt: nowIso,
  updatedAt: nowIso,
});

export const abandonMock = (
  session: ExamPrepMockSession,
  nowIso: string,
): ExamPrepMockSession => ({
  ...session,
  status: 'abandoned',
  abandonedAt: nowIso,
  updatedAt: nowIso,
});
