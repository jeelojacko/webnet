import { describe, expect, it } from 'vitest';
import { Rating, State } from 'ts-fsrs';
import { fixedStudyClock } from '../../src/study/fsrs/studyClock';
import {
  createNewStudySchedule,
  createStudyFsrsScheduler,
} from '../../src/study/fsrs/studyFsrs';
import {
  createStudyFsrsConfigRecord,
  resolveStudyFsrsParameters,
} from '../../src/study/fsrs/studyFsrsMigration';
import {
  deserializeStudyFsrsCard,
  deserializeStudyFsrsReviewLog,
  serializeStudyFsrsCard,
  validateStudyFsrsParameters,
} from '../../src/study/fsrs/studyFsrsSerialization';
import {
  DEFAULT_STUDY_FSRS_SETTINGS,
  type StudyFsrsSchedule,
  type StudyFsrsSettings,
} from '../../src/study/fsrs/studyFsrsTypes';

const deterministicSettings: StudyFsrsSettings = {
  ...DEFAULT_STUDY_FSRS_SETTINGS,
  enableFuzz: false,
};

const clock = fixedStudyClock('2026-08-10T12:00:00.000Z');

const initializedSchedule = (): StudyFsrsSchedule => {
  const scheduler = createStudyFsrsScheduler(deterministicSettings);
  const now = clock.now();
  const schedule = createNewStudySchedule({ configVersion: 1 });
  const result = scheduler.applyStudyRating(schedule, 'good', now);
  return {
    ...schedule,
    initialized: true,
    initializedAt: now.toISOString(),
    lastScheduledAt: now.toISOString(),
    card: result.card,
  };
};

describe('study FSRS adapter', () => {
  it('creates a complete persisted config from Study settings', () => {
    const config = createStudyFsrsConfigRecord({
      settings: deterministicSettings,
      configVersion: 7,
      now: clock.now(),
    });
    const resolved = resolveStudyFsrsParameters(config);

    expect(config.schemaVersion).toBe(1);
    expect(config.configVersion).toBe(7);
    expect(config.userSettings.newUnitsPerSession).toBe(5);
    expect(resolved.request_retention).toBe(0.9);
    expect(resolved.maximum_interval).toBe(36500);
    expect(resolved.enable_fuzz).toBe(false);
    expect(validateStudyFsrsParameters(config.resolvedParameters)).toEqual(resolved);
  });

  it('creates new schedules without fabricating FSRS history', () => {
    const schedule = createNewStudySchedule({
      configVersion: 1,
      legacyDueAt: '2026-08-12T12:00:00.000Z',
    });

    expect(schedule.initialized).toBe(false);
    expect(schedule.card).toBeUndefined();
    expect(schedule.legacyDueAt).toBe('2026-08-12T12:00:00.000Z');
  });

  it('previews all four ratings without mutating the schedule', () => {
    const scheduler = createStudyFsrsScheduler(deterministicSettings);
    const schedule = createNewStudySchedule({ configVersion: 1 });
    const before = structuredClone(schedule);
    const preview = scheduler.previewAllStudyRatings(schedule, clock.now());

    expect(preview.map((entry) => entry.rating)).toEqual(['again', 'hard', 'good', 'easy']);
    expect(preview.every((entry) => Date.parse(entry.due) >= clock.now().getTime())).toBe(true);
    expect(schedule).toEqual(before);
  });

  it.each(['again', 'hard', 'good', 'easy'] as const)('applies %s as one FSRS transition', (rating) => {
    const scheduler = createStudyFsrsScheduler(deterministicSettings);
    const result = scheduler.applyStudyRating(createNewStudySchedule({ configVersion: 1 }), rating, clock.now());

    expect(result.rating).toBe(rating);
    expect(deserializeStudyFsrsCard(result.card).reps).toBe(1);
    expect(deserializeStudyFsrsReviewLog(result.log).rating).toBe(Rating[
      rating === 'again' ? 'Again' : rating === 'hard' ? 'Hard' : rating === 'good' ? 'Good' : 'Easy'
    ]);
    expect(result.cardBefore.reps).toBe(0);
  });

  it('serializes and restores Date fields explicitly', () => {
    const scheduler = createStudyFsrsScheduler(deterministicSettings);
    const result = scheduler.applyStudyRating(createNewStudySchedule({ configVersion: 1 }), 'good', clock.now());
    const restored = deserializeStudyFsrsCard(result.card);
    const serializedAgain = serializeStudyFsrsCard(restored);

    expect(result.card.due).toMatch(/Z$/);
    expect(restored.due).toBeInstanceOf(Date);
    expect(restored.last_review).toBeInstanceOf(Date);
    expect(serializedAgain).toEqual(result.card);
  });

  it('exposes retrievability for initialized cards only', () => {
    const scheduler = createStudyFsrsScheduler(deterministicSettings);
    const empty = createNewStudySchedule({ configVersion: 1 });
    const initialized = initializedSchedule();

    expect(scheduler.getStudyRetrievability(empty, clock.now())).toBeNull();
    expect(scheduler.getStudyRetrievability(initialized, clock.now())).toBeGreaterThan(0);
  });

  it('restores ts-fsrs card states from serialized records', () => {
    const scheduler = createStudyFsrsScheduler(deterministicSettings);
    const card = deserializeStudyFsrsCard(scheduler.createNewCard(clock.now()));

    expect(card.state).toBe(State.New);
    expect(card.due).toBeInstanceOf(Date);
  });
});
