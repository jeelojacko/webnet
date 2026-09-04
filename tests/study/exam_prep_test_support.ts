// Exam Prep — shared test fixtures.
//
// Pure factories for Exam Prep persistent records so focused tests build
// current-hash and archived (same curriculum, other hash) records without
// duplicating shapes. Uses the frozen manifest binding.

import {
  currentExamPrepBinding,
  examPrepProgressId,
} from '../../src/study/examPrep/examPrepManifest';
import type {
  ExamPrepRecallAttempt,
  ExamPrepRecallProgress,
  ExamPrepSettings,
  ExamPrepUnitProgress,
} from '../../src/study/examPrep/examPrepTypes';
import type { SerializedStudyFsrsCard, StudyFsrsSchedule } from '../../src/study/studyTypes';

export const EXAM_PREP_TEST_ARCHIVED_HASH = 'f9'.padEnd(64, 'a');
export const EXAM_PREP_TEST_OTHER_CURRICULUM = 'other-curriculum-id';

export const currentBinding = currentExamPrepBinding();

export const archivedBinding = {
  curriculumId: currentBinding.curriculumId,
  curriculumContentHash: EXAM_PREP_TEST_ARCHIVED_HASH,
};

export const otherCurriculumBinding = {
  curriculumId: EXAM_PREP_TEST_OTHER_CURRICULUM,
  curriculumContentHash: EXAM_PREP_TEST_ARCHIVED_HASH,
};

export const testCard = (overrides: Partial<SerializedStudyFsrsCard> = {}): SerializedStudyFsrsCard => ({
  due: '2026-09-05T12:00:00.000Z',
  stability: 3,
  difficulty: 5.5,
  elapsed_days: 0,
  scheduled_days: 0,
  learning_steps: 0,
  reps: 1,
  lapses: 0,
  state: 'Learning',
  last_review: '2026-09-05T11:00:00.000Z',
  ...overrides,
});

export const initializedSchedule = (
  card: SerializedStudyFsrsCard,
  configVersion = 1,
): StudyFsrsSchedule => ({
  schemaVersion: 1,
  algorithm: 'fsrs',
  initialized: true,
  card,
  initializedAt: '2026-09-05T11:00:00.000Z',
  lastScheduledAt: card.last_review ?? '2026-09-05T11:00:00.000Z',
  configVersion,
});

export const makeUnitProgress = (
  unitId: string,
  studiedAt = '2026-09-05T10:00:00.000Z',
  binding = currentBinding,
): ExamPrepUnitProgress => ({
  id: examPrepProgressId(binding, unitId),
  curriculumId: binding.curriculumId,
  curriculumContentHash: binding.curriculumContentHash,
  unitId,
  studiedAt,
  updatedAt: studiedAt,
});

export const makeRecallProgress = ({
  taskId,
  unitId,
  card,
  binding = currentBinding,
  reviewCount = 1,
  createdAt = '2026-09-05T10:00:00.000Z',
  updatedAt,
}: {
  taskId: string;
  unitId: string;
  card: SerializedStudyFsrsCard;
  binding?: typeof currentBinding | typeof archivedBinding | typeof otherCurriculumBinding;
  reviewCount?: number;
  createdAt?: string;
  updatedAt?: string;
}): ExamPrepRecallProgress => ({
  id: examPrepProgressId(binding, taskId),
  curriculumId: binding.curriculumId,
  curriculumContentHash: binding.curriculumContentHash,
  taskId,
  unitId,
  scheduling: initializedSchedule(card),
  reviewCount,
  lastReviewedAt: card.last_review ?? createdAt,
  createdAt,
  updatedAt: updatedAt ?? card.last_review ?? createdAt,
});

export const makeRecallAttempt = ({
  id,
  taskId,
  unitId,
  binding = currentBinding,
  rating = 'good',
  dueAfter = '2026-09-15T12:00:00.000Z',
  reviewedAt = '2026-09-05T12:00:00.000Z',
  exactAnswer = 'expected answer',
}: {
  id: string;
  taskId: string;
  unitId: string;
  binding?: typeof currentBinding | typeof archivedBinding;
  rating?: ExamPrepRecallAttempt['rating'];
  dueAfter?: string;
  reviewedAt?: string;
  exactAnswer?: string;
}): ExamPrepRecallAttempt => ({
  id,
  kind: 'recall',
  curriculumId: binding.curriculumId,
  curriculumContentHash: binding.curriculumContentHash,
  taskId,
  unitId,
  exactAnswer,
  rating,
  cardBefore: testCard({ state: 'New', due: reviewedAt, last_review: null }),
  cardAfter: testCard({ due: dueAfter }),
  fsrsReviewLog: {
    rating: 'Good',
    state: 'Learning',
    due: dueAfter,
    stability: 3,
    difficulty: 5.5,
    elapsed_days: 0,
    last_elapsed_days: 0,
    scheduled_days: 0,
    learning_steps: 0,
    review: reviewedAt,
  },
  dueBefore: reviewedAt,
  dueAfter,
  configVersion: 1,
  reviewedAt,
});

export const makeSettings = (
  overrides: Partial<ExamPrepSettings> = {},
  binding = currentBinding,
): ExamPrepSettings => ({
  id: binding.curriculumContentHash,
  curriculumId: binding.curriculumId,
  curriculumContentHash: binding.curriculumContentHash,
  newRecallCardsPerSession: 8,
  maxRecallCardsPerSession: 20,
  updatedAt: '2026-09-05T10:00:00.000Z',
  ...overrides,
});
