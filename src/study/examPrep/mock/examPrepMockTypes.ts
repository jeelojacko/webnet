// Exam Prep Mock — persistent mock-exam session types.
//
// One record contains an entire mock: the versioned profile snapshot used at
// start (so historical sessions stay interpretable after profile config
// changes), the frozen question references (q01.. per session), and the
// learner's free-text responses plus optional self-grading. The mock engine
// never writes Exam Prep attempts/FSRS/progress; it has its own evidence
// history in the `examPrepMockSessions` store (schema v10).

import type { ExamPrepCurriculumBinding } from '../examPrepTypes';
import type { ExamPrepMockProfile } from './examPrepMockProfiles';

export type ExamPrepMockSessionStatus = 'in_progress' | 'submitted' | 'graded' | 'abandoned';

export type ExamPrepMockQuestionKind = 'recall' | 'recognition' | 'locate' | 'drill';

/** Session-local reference to one frozen question on a mock paper. */
export interface ExamPrepMockQuestionRef {
  /** `q01`..`qNN`, assigned after the final mixed ordering. */
  questionId: string;
  kind: ExamPrepMockQuestionKind;
  /** Frozen pool identity: `recall:{unitId}:{i}`, `recognition:…`, `locate:…` or `drill:{unitId}`. */
  sourceTaskId: string;
  unitId: string;
  pointsPossible: number;
}

/** Learner response for one question; grading stays null until self-graded. */
export interface ExamPrepMockResponse {
  questionId: string;
  answer: string;
  visited: boolean;
  flagged: boolean;
  responseUpdatedAt: string | null;
  grading: ExamPrepMockQuestionGrading | null;
}

export type ExamPrepMockQuestionGrading =
  | {
      kind: 'recall';
      correct: boolean;
      pointsAwarded: 0 | 1;
      gradedAt: string;
    }
  | {
      kind: 'recognition';
      correct: boolean;
      pointsAwarded: 0 | 1;
      gradedAt: string;
    }
  | {
      kind: 'locate';
      correct: boolean;
      pointsAwarded: 0 | 1;
      gradedAt: string;
    }
  | {
      kind: 'drill';
      lawIdentified: boolean;
      provisionLocated: boolean;
      substantiveAnswerComplete: boolean;
      pointsAwarded: 0 | 1 | 2 | 3;
      gradedAt: string;
    };

export interface ExamPrepMockSession extends ExamPrepCurriculumBinding {
  /** `${curriculumContentHash}::mock-{localId}` composite key. */
  id: string;

  profileId: string;
  profileVersion: number;
  /** Full profile snapshot taken when the mock started (never mutated later). */
  profileSnapshot: ExamPrepMockProfile;

  seed: string;

  status: ExamPrepMockSessionStatus;

  startedAt: string;
  deadlineAt: string;
  updatedAt: string;

  submittedAt: string | null;
  gradedAt: string | null;
  abandonedAt: string | null;

  currentQuestionIndex: number;

  questions: ExamPrepMockQuestionRef[];
  responses: ExamPrepMockResponse[];
}

/** Compare-and-swap guard used by saveExamPrepMockSession. */
export type ExamPrepMockSessionExpectation =
  | { kind: 'absent' }
  | { kind: 'existing'; updatedAt: string };
