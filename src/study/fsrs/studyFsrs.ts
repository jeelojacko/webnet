import { Rating, State, createEmptyCard, fsrs, type Card, type FSRSParameters } from 'ts-fsrs';
import {
  deserializeStudyFsrsCard,
  serializeStudyFsrsCard,
  serializeStudyFsrsReviewLog,
} from './studyFsrsSerialization';
import { studySettingsToFsrsParameters } from './studyFsrsMigration';
import {
  DEFAULT_STUDY_FSRS_SETTINGS,
  type SerializedStudyFsrsCard,
  type StudyFsrsRating,
  type StudyFsrsRatingPreview,
  type StudyFsrsRatingResult,
  type StudyFsrsSchedule,
  type StudyFsrsSettings,
  type StudyFsrsState,
} from './studyFsrsTypes';

export type StudyFsrsScheduler = ReturnType<typeof createStudyFsrsScheduler>;

const ratingMap: Record<StudyFsrsRating, Rating.Again | Rating.Hard | Rating.Good | Rating.Easy> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

const stateMap: Record<State, StudyFsrsState> = {
  [State.New]: 'new',
  [State.Learning]: 'learning',
  [State.Review]: 'review',
  [State.Relearning]: 'relearning',
};

const previewRatings: StudyFsrsRating[] = ['again', 'hard', 'good', 'easy'];

const cardForScheduling = (schedule: StudyFsrsSchedule, now: Date): Card =>
  schedule.initialized && schedule.card ? deserializeStudyFsrsCard(schedule.card) : createEmptyCard(now);

const previewFromCard = (
  card: Card,
  parameters: FSRSParameters,
  rating: StudyFsrsRating,
  now: Date,
): StudyFsrsRatingPreview => {
  const preview = fsrs(parameters).repeat(card, now);
  const item = preview[ratingMap[rating]];
  return {
    rating,
    card: serializeStudyFsrsCard(item.card),
    log: serializeStudyFsrsReviewLog(item.log),
    due: item.card.due.toISOString(),
  };
};

export const createNewStudySchedule = ({
  configVersion,
  legacyDueAt,
}: {
  configVersion: number;
  legacyDueAt?: string;
}): StudyFsrsSchedule => ({
  schemaVersion: 1,
  algorithm: 'fsrs',
  initialized: false,
  configVersion,
  legacyDueAt,
});

export const createStudyFsrsScheduler = (
  settings: StudyFsrsSettings = DEFAULT_STUDY_FSRS_SETTINGS,
  resolvedParameters: FSRSParameters = studySettingsToFsrsParameters(settings),
) => {
  const parameters = resolvedParameters;

  return {
    parameters,

    createNewCard(now: Date): SerializedStudyFsrsCard {
      return serializeStudyFsrsCard(createEmptyCard(now));
    },

    getState(schedule: StudyFsrsSchedule): StudyFsrsState {
      if (!schedule.initialized || !schedule.card) return 'new';
      return stateMap[deserializeStudyFsrsCard(schedule.card).state];
    },

    previewStudyRating(schedule: StudyFsrsSchedule, rating: StudyFsrsRating, now: Date): StudyFsrsRatingPreview {
      return previewFromCard(cardForScheduling(schedule, now), parameters, rating, now);
    },

    previewAllStudyRatings(schedule: StudyFsrsSchedule, now: Date): StudyFsrsRatingPreview[] {
      const card = cardForScheduling(schedule, now);
      const preview = fsrs(parameters).repeat(card, now);
      return previewRatings.map((rating) => {
        const item = preview[ratingMap[rating]];
        return {
          rating,
          card: serializeStudyFsrsCard(item.card),
          log: serializeStudyFsrsReviewLog(item.log),
          due: item.card.due.toISOString(),
        };
      });
    },

    applyStudyRating(schedule: StudyFsrsSchedule, rating: StudyFsrsRating, now: Date): StudyFsrsRatingResult {
      const cardBefore = cardForScheduling(schedule, now);
      const item = fsrs(parameters).next(cardBefore, now, ratingMap[rating]);
      return {
        rating,
        cardBefore: serializeStudyFsrsCard(cardBefore),
        card: serializeStudyFsrsCard(item.card),
        log: serializeStudyFsrsReviewLog(item.log),
        due: item.card.due.toISOString(),
      };
    },

    getStudyRetrievability(schedule: StudyFsrsSchedule, now: Date): number | null {
      if (!schedule.initialized || !schedule.card) return null;
      return fsrs(parameters).get_retrievability(deserializeStudyFsrsCard(schedule.card), now, false);
    },
  };
};
