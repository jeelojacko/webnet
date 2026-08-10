import type {
  SerializedStudyFsrsCard,
  SerializedStudyFsrsReviewLog,
  StudyFsrsConfigRecord,
  StudyFsrsSchedule,
  StudyFsrsSettings,
} from '../studyTypes';

export type {
  SerializedStudyFsrsCard,
  SerializedStudyFsrsReviewLog,
  StudyFsrsConfigRecord,
  StudyFsrsSchedule,
  StudyFsrsSettings,
};

export type StudyFsrsRating = 'again' | 'hard' | 'good' | 'easy';

export type StudyFsrsState = 'new' | 'learning' | 'review' | 'relearning';

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
