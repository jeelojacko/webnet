// Exam Prep — persistent learner-state types.
//
// Exam Prep is the learner-facing layer over the frozen Exam Curriculum V1
// manifest. The curriculum itself is immutable; these records are the
// per-learner progress/attempt/settings state bound to one curriculum
// content hash. Every record carries both `curriculumId` and
// `curriculumContentHash` from the bundled manifest binding so archived
// same-curriculum/different-hash state stays preserved but is never counted
// in current metrics.

import type {
  SerializedStudyFsrsCard,
  SerializedStudyFsrsReviewLog,
  StudyFsrsSchedule,
  StudyRating,
} from '../studyTypes';
import type {
  ExamCurriculumReviewWeight,
  ExamLookupDrillDifficulty,
} from '../examCurriculum/examCurriculumTypes';

export type ExamPrepRecallRating = StudyRating;

export type ExamPrepCurriculumTier = 'A' | 'B' | 'C' | 'D' | 'NAV' | 'DRILL';

/**
 * One FSRS-scheduled recall card derived from a single `unit.mustRecall`
 * entry in canonical manifest order. Derived records are pure and
 * deterministic; they are never persisted themselves.
 */
export interface ExamPrepRecallTask {
  /** `recall:{unitId}:{index}` where index is 1-based within the unit. */
  id: string;
  unitId: string;
  unitTitle: string;
  tier: ExamPrepCurriculumTier;
  /** 1-based index of the mustRecall entry inside its unit. */
  index: number;
  /** Global 1-based position in canonical derivation order. */
  order: number;
  /** Review weight of the source curriculum unit (`high`/`medium`/`low`). */
  reviewWeight: ExamCurriculumReviewWeight;
  /** 0-based position of the source unit in the manifest units array. */
  curriculumIndex: number;
  /** Fixed learner prompt shown on the card. */
  prompt: string;
  /** Verbatim frozen manifest mustRecall text (the expected answer). */
  expectedAnswer: string;
}

/** Binding of a record to the bundled curriculum manifest. */
export interface ExamPrepCurriculumBinding {
  curriculumId: string;
  curriculumContentHash: string;
}

/** `studied` marker for one A-D/NAV curriculum unit (presence = studied). */
export interface ExamPrepUnitProgress extends ExamPrepCurriculumBinding {
  /** `${curriculumContentHash}::${unitId}` composite key. */
  id: string;
  unitId: string;
  studiedAt: string;
  updatedAt: string;
}

/** FSRS scheduling state for one derived recall task. */
export interface ExamPrepRecallProgress extends ExamPrepCurriculumBinding {
  /** `${curriculumContentHash}::${taskId}` composite key. */
  id: string;
  taskId: string;
  unitId: string;
  /** Serialized ts-fsrs schedule; created on the first rated review. */
  scheduling: StudyFsrsSchedule;
  reviewCount: number;
  lastReviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExamPrepRecognitionTask {
  id: string;
  unitId: string;
  unitTitle: string;
  tier: ExamPrepCurriculumTier;
  reviewWeight: ExamCurriculumReviewWeight;
  curriculumIndex: number;
  cueIndex: number;
  cue: string;
  expectedDocumentIds: string[];
}

export interface ExamPrepLocateTask {
  id: string;
  unitId: string;
  unitTitle: string;
  tier: ExamPrepCurriculumTier;
  reviewWeight: ExamCurriculumReviewWeight;
  curriculumIndex: number;
  lookupIndex: number;
  prompt: string;
  expectedDocumentId: string;
  /**
   * Resolved provision pin. Frozen curriculum targets that intentionally stop
   * at document level carry `null` (document-level locate practice); every
   * pinned target carries its exact `sourceKey`.
   */
  expectedSourceKey: string | null;
}

/** Immutable evidence record written atomically with recall progress. */
export interface ExamPrepRecallAttempt extends ExamPrepCurriculumBinding {
  id: string;
  kind: 'recall';
  taskId: string;
  unitId: string;
  /** Verbatim frozen expected answer at review time. */
  exactAnswer: string;
  rating: ExamPrepRecallRating;
  cardBefore: SerializedStudyFsrsCard;
  cardAfter: SerializedStudyFsrsCard;
  fsrsReviewLog: SerializedStudyFsrsReviewLog;
  dueBefore: string;
  dueAfter: string;
  configVersion: number;
  reviewedAt: string;
  /** Optional learner-typed answer kept when the UI captures one. */
  answer?: string;
}

export interface ExamPrepRecognitionAttempt extends ExamPrepCurriculumBinding {
  id: string;
  kind: 'recognition';
  taskId: string;
  unitId: string;
  cueIndex: number;
  cue: string;
  expectedUnitTitle: string;
  expectedDocumentIds: string[];
  answer?: string;
  result: 'got_it' | 'missed';
  completedAt: string;
}

export interface ExamPrepLocateAttempt extends ExamPrepCurriculumBinding {
  id: string;
  kind: 'locate';
  taskId: string;
  unitId: string;
  lookupIndex: number;
  prompt: string;
  expectedDocumentId: string;
  expectedSourceKey: string | null;
  result: 'found' | 'missed';
  elapsedSeconds: number;
  completedAt: string;
}

export interface ExamPrepDrillAttempt extends ExamPrepCurriculumBinding {
  id: string;
  kind: 'drill';
  taskId: string;
  unitId: string;
  difficulty: ExamLookupDrillDifficulty;
  answer: string;
  elapsedSeconds: number;
  targetSeconds: number;
  lawIdentified: boolean;
  provisionLocated: boolean;
  substantiveAnswerComplete: boolean;
  score: 0 | 1 | 2 | 3;
  practiceDate: string;
  completedAt: string;
}

export type ExamPrepAttempt =
  | ExamPrepRecallAttempt
  | ExamPrepRecognitionAttempt
  | ExamPrepLocateAttempt
  | ExamPrepDrillAttempt;

export type ExamPrepRecallProgressExpectation =
  | { kind: 'absent' }
  | { kind: 'existing'; updatedAt: string };

/** Per-curriculum-hash recall session limits. */
export interface ExamPrepSettings extends ExamPrepCurriculumBinding {
  /** `curriculumContentHash` is the settings key (all current settings). */
  id: string;
  newRecallCardsPerSession: number;
  maxRecallCardsPerSession: number;
  updatedAt: string;
}

export type ExamPrepDataSlice = {
  examPrepUnitProgress: ExamPrepUnitProgress[];
  examPrepRecallProgress: ExamPrepRecallProgress[];
  examPrepAttempts: ExamPrepAttempt[];
  examPrepSettings: ExamPrepSettings[];
};
