import { Rating, State, TypeConvert, type Card, type FSRSParameters, type ReviewLog, type StepUnit } from 'ts-fsrs';
import type { SerializedStudyFsrsCard, SerializedStudyFsrsReviewLog } from './studyFsrsTypes';

const stateNames: Record<State, SerializedStudyFsrsCard['state']> = {
  [State.New]: 'New',
  [State.Learning]: 'Learning',
  [State.Review]: 'Review',
  [State.Relearning]: 'Relearning',
};

const ratingNames: Record<Rating.Again | Rating.Hard | Rating.Good | Rating.Easy, SerializedStudyFsrsReviewLog['rating']> = {
  [Rating.Again]: 'Again',
  [Rating.Hard]: 'Hard',
  [Rating.Good]: 'Good',
  [Rating.Easy]: 'Easy',
};

const stateByName: Record<SerializedStudyFsrsCard['state'], State> = {
  New: State.New,
  Learning: State.Learning,
  Review: State.Review,
  Relearning: State.Relearning,
};

const ratingByName: Record<SerializedStudyFsrsReviewLog['rating'], Rating.Again | Rating.Hard | Rating.Good | Rating.Easy> = {
  Again: Rating.Again,
  Hard: Rating.Hard,
  Good: Rating.Good,
  Easy: Rating.Easy,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const assertFiniteNumber = (value: unknown, field: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid FSRS ${field}: expected a finite number.`);
  }
  return value;
};

const assertBoolean = (value: unknown, field: string): boolean => {
  if (typeof value !== 'boolean') throw new Error(`Invalid FSRS ${field}: expected a boolean.`);
  return value;
};

const assertIsoDate = (value: unknown, field: string): string => {
  if (typeof value !== 'string') throw new Error(`Invalid FSRS ${field}: expected an ISO string.`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) {
    throw new Error(`Invalid FSRS ${field}: expected a normalized ISO timestamp.`);
  }
  return value;
};

const assertOptionalIsoDate = (value: unknown, field: string): string | null => {
  if (value === null || value === undefined) return null;
  return assertIsoDate(value, field);
};

const dateFromIso = (value: string): Date => new Date(value);

export const serializeStudyFsrsCard = (card: Card): SerializedStudyFsrsCard => ({
  due: card.due.toISOString(),
  stability: card.stability,
  difficulty: card.difficulty,
  elapsed_days: card.elapsed_days,
  scheduled_days: card.scheduled_days,
  learning_steps: card.learning_steps,
  reps: card.reps,
  lapses: card.lapses,
  state: stateNames[card.state],
  last_review: card.last_review?.toISOString() ?? null,
});

export const deserializeStudyFsrsCard = (snapshot: unknown): Card => {
  if (!isRecord(snapshot)) throw new Error('Invalid FSRS card: expected an object.');
  const state = snapshot.state;
  if (state !== 'New' && state !== 'Learning' && state !== 'Review' && state !== 'Relearning') {
    throw new Error('Invalid FSRS card state.');
  }
  return TypeConvert.card({
    due: dateFromIso(assertIsoDate(snapshot.due, 'card.due')),
    stability: assertFiniteNumber(snapshot.stability, 'card.stability'),
    difficulty: assertFiniteNumber(snapshot.difficulty, 'card.difficulty'),
    elapsed_days: assertFiniteNumber(snapshot.elapsed_days, 'card.elapsed_days'),
    scheduled_days: assertFiniteNumber(snapshot.scheduled_days, 'card.scheduled_days'),
    learning_steps: assertFiniteNumber(snapshot.learning_steps, 'card.learning_steps'),
    reps: assertFiniteNumber(snapshot.reps, 'card.reps'),
    lapses: assertFiniteNumber(snapshot.lapses, 'card.lapses'),
    state: stateByName[state],
    last_review: assertOptionalIsoDate(snapshot.last_review, 'card.last_review'),
  });
};

export const serializeStudyFsrsReviewLog = (log: ReviewLog): SerializedStudyFsrsReviewLog => {
  if (
    log.rating !== Rating.Again &&
    log.rating !== Rating.Hard &&
    log.rating !== Rating.Good &&
    log.rating !== Rating.Easy
  ) {
    throw new Error('Cannot serialize a non-review FSRS rating.');
  }
  return {
    rating: ratingNames[log.rating],
    state: stateNames[log.state],
    due: log.due.toISOString(),
    stability: log.stability,
    difficulty: log.difficulty,
    elapsed_days: log.elapsed_days,
    last_elapsed_days: log.last_elapsed_days,
    scheduled_days: log.scheduled_days,
    learning_steps: log.learning_steps,
    review: log.review.toISOString(),
  };
};

export const deserializeStudyFsrsReviewLog = (snapshot: unknown): ReviewLog => {
  if (!isRecord(snapshot)) throw new Error('Invalid FSRS review log: expected an object.');
  const state = snapshot.state;
  const rating = snapshot.rating;
  if (state !== 'New' && state !== 'Learning' && state !== 'Review' && state !== 'Relearning') {
    throw new Error('Invalid FSRS review log state.');
  }
  if (rating !== 'Again' && rating !== 'Hard' && rating !== 'Good' && rating !== 'Easy') {
    throw new Error('Invalid FSRS review log rating.');
  }
  return TypeConvert.review_log({
    rating: ratingByName[rating],
    state: stateByName[state],
    due: dateFromIso(assertIsoDate(snapshot.due, 'log.due')),
    stability: assertFiniteNumber(snapshot.stability, 'log.stability'),
    difficulty: assertFiniteNumber(snapshot.difficulty, 'log.difficulty'),
    elapsed_days: assertFiniteNumber(snapshot.elapsed_days, 'log.elapsed_days'),
    last_elapsed_days: assertFiniteNumber(snapshot.last_elapsed_days, 'log.last_elapsed_days'),
    scheduled_days: assertFiniteNumber(snapshot.scheduled_days, 'log.scheduled_days'),
    learning_steps: assertFiniteNumber(snapshot.learning_steps, 'log.learning_steps'),
    review: dateFromIso(assertIsoDate(snapshot.review, 'log.review')),
  });
};

const isStepUnit = (value: unknown): value is StepUnit =>
  typeof value === 'string' && /^\d+(?:\.\d+)?[mhd]$/.test(value);

export const validateStudyFsrsParameters = (value: unknown): FSRSParameters => {
  if (!isRecord(value)) throw new Error('Invalid FSRS parameters: expected an object.');
  const w = value.w;
  const learningSteps = value.learning_steps;
  const relearningSteps = value.relearning_steps;
  if (!Array.isArray(w) || !w.every((entry) => typeof entry === 'number' && Number.isFinite(entry))) {
    throw new Error('Invalid FSRS parameters: expected numeric weights.');
  }
  if (!Array.isArray(learningSteps) || !learningSteps.every(isStepUnit)) {
    throw new Error('Invalid FSRS parameters: expected valid learning steps.');
  }
  if (!Array.isArray(relearningSteps) || !relearningSteps.every(isStepUnit)) {
    throw new Error('Invalid FSRS parameters: expected valid relearning steps.');
  }
  return {
    request_retention: assertFiniteNumber(value.request_retention, 'parameters.request_retention'),
    maximum_interval: assertFiniteNumber(value.maximum_interval, 'parameters.maximum_interval'),
    w,
    enable_fuzz: assertBoolean(value.enable_fuzz, 'parameters.enable_fuzz'),
    enable_short_term: assertBoolean(value.enable_short_term, 'parameters.enable_short_term'),
    learning_steps: learningSteps,
    relearning_steps: relearningSteps,
  };
};
