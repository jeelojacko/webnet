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
  ExamPrepDrillAttempt,
  ExamPrepLocateAttempt,
  ExamPrepRecallAttempt,
  ExamPrepRecallProgress,
  ExamPrepRecognitionAttempt,
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

export const makeRecognitionAttempt = ({
  id,
  taskId,
  unitId,
  cueIndex = 1,
  cue = 'cue',
  expectedUnitTitle = 'unit title',
  expectedDocumentIds = [],
  result = 'missed',
  answer,
  completedAt = '2026-09-05T12:00:00.000Z',
  binding = currentBinding,
}: {
  id: string;
  taskId: string;
  unitId: string;
  cueIndex?: number;
  cue?: string;
  expectedUnitTitle?: string;
  expectedDocumentIds?: string[];
  result?: 'got_it' | 'missed';
  answer?: string;
  completedAt?: string;
  binding?: typeof currentBinding | typeof archivedBinding | typeof otherCurriculumBinding;
}): ExamPrepRecognitionAttempt => ({
  id,
  kind: 'recognition',
  curriculumId: binding.curriculumId,
  curriculumContentHash: binding.curriculumContentHash,
  taskId,
  unitId,
  cueIndex,
  cue,
  expectedUnitTitle,
  expectedDocumentIds: [...expectedDocumentIds],
  ...(answer !== undefined ? { answer } : {}),
  result,
  completedAt,
});

export const makeLocateAttempt = ({
  id,
  taskId,
  unitId,
  lookupIndex = 1,
  prompt = 'find',
  expectedDocumentId = 'doc',
  expectedSourceKey = null,
  result = 'missed',
  elapsedSeconds = 12,
  completedAt = '2026-09-05T12:00:00.000Z',
  binding = currentBinding,
}: {
  id: string;
  taskId: string;
  unitId: string;
  lookupIndex?: number;
  prompt?: string;
  expectedDocumentId?: string;
  expectedSourceKey?: string | null;
  result?: 'found' | 'missed';
  elapsedSeconds?: number;
  completedAt?: string;
  binding?: typeof currentBinding | typeof archivedBinding | typeof otherCurriculumBinding;
}): ExamPrepLocateAttempt => ({
  id,
  kind: 'locate',
  curriculumId: binding.curriculumId,
  curriculumContentHash: binding.curriculumContentHash,
  taskId,
  unitId,
  lookupIndex,
  prompt,
  expectedDocumentId,
  expectedSourceKey: expectedSourceKey ?? null,
  result,
  elapsedSeconds,
  completedAt,
});

export const makeDrillAttempt = ({
  id,
  taskId,
  unitId,
  difficulty = 'direct',
  answer = '',
  elapsedSeconds = 60,
  targetSeconds = 90,
  lawIdentified = false,
  provisionLocated = false,
  substantiveAnswerComplete = false,
  practiceDate = '2026-09-05',
  completedAt = '2026-09-05T12:00:00.000Z',
  binding = currentBinding,
}: {
  id: string;
  taskId: string;
  unitId: string;
  difficulty?: ExamPrepDrillAttempt['difficulty'];
  answer?: string;
  elapsedSeconds?: number;
  targetSeconds?: number;
  lawIdentified?: boolean;
  provisionLocated?: boolean;
  substantiveAnswerComplete?: boolean;
  practiceDate?: string;
  completedAt?: string;
  binding?: typeof currentBinding | typeof archivedBinding | typeof otherCurriculumBinding;
}): ExamPrepDrillAttempt => {
  const score = [lawIdentified, provisionLocated, substantiveAnswerComplete].filter(Boolean)
    .length as 0 | 1 | 2 | 3;
  return {
    id,
    kind: 'drill',
    curriculumId: binding.curriculumId,
    curriculumContentHash: binding.curriculumContentHash,
    taskId,
    unitId,
    difficulty,
    answer,
    elapsedSeconds,
    targetSeconds,
    lawIdentified,
    provisionLocated,
    substantiveAnswerComplete,
    score,
    practiceDate,
    completedAt,
  };
};

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
