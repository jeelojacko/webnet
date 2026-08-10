export type StudyFsrsRating = 'again' | 'hard' | 'good' | 'easy';

export type StudyFsrsState = 'new' | 'learning' | 'review' | 'relearning';

export type StudyFsrsSettings = {
  enabled: boolean;
  requestRetention: number;
  maximumIntervalDays: number;
  enableFuzz: boolean;
  enableShortTerm: boolean;
  learningSteps: string[];
  relearningSteps: string[];
  newUnitsPerSession: number;
};

export type SerializedStudyFsrsCard = {
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: 'New' | 'Learning' | 'Review' | 'Relearning';
  last_review: string | null;
};

export type SerializedStudyFsrsReviewLog = {
  rating: 'Again' | 'Hard' | 'Good' | 'Easy';
  state: 'New' | 'Learning' | 'Review' | 'Relearning';
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  last_elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  review: string;
};

export type StudyFsrsConfigRecord = {
  schemaVersion: 1;
  configVersion: number;
  userSettings: StudyFsrsSettings;
  resolvedParameters: unknown;
  createdAt: string;
  updatedAt: string;
};

export type StudyFsrsSchedule = {
  schemaVersion: 1;
  algorithm: 'fsrs';
  initialized: boolean;
  card?: SerializedStudyFsrsCard;
  initializedAt?: string;
  lastScheduledAt?: string;
  configVersion: number;
  legacyDueAt?: string;
};

export type StudyFsrsRatingPreview = {
  rating: StudyFsrsRating;
  card: SerializedStudyFsrsCard;
  log: SerializedStudyFsrsReviewLog;
  due: string;
};

export type StudyFsrsRatingResult = StudyFsrsRatingPreview & {
  cardBefore: SerializedStudyFsrsCard;
};

export const DEFAULT_STUDY_FSRS_SETTINGS: StudyFsrsSettings = {
  enabled: true,
  requestRetention: 0.9,
  maximumIntervalDays: 36500,
  enableFuzz: true,
  enableShortTerm: true,
  learningSteps: ['10m'],
  relearningSteps: ['10m'],
  newUnitsPerSession: 5,
};
