import { describe, expect, it } from 'vitest';
import { buildStudyQueue } from '../../src/study/studyQueue';
import { createSeedStudyData } from '../../src/study/studySeed';
import type {
  SerializedStudyFsrsCard,
  StudyFsrsSchedule,
  StudyProgress,
  StudyUnit,
} from '../../src/study/studyTypes';

const now = new Date('2026-08-11T12:00:00.000Z');
const nowIso = now.toISOString();

const card = (state: SerializedStudyFsrsCard['state'], due: string): SerializedStudyFsrsCard => ({
  due,
  stability: 1,
  difficulty: 5,
  elapsed_days: 0,
  scheduled_days: 0,
  learning_steps: 0,
  reps: 1,
  lapses: 0,
  state,
  last_review: '2026-08-10T12:00:00.000Z',
});

const schedule = (state: SerializedStudyFsrsCard['state'], due: string): StudyFsrsSchedule => ({
  schemaVersion: 1,
  algorithm: 'fsrs',
  initialized: true,
  card: card(state, due),
  initializedAt: '2026-08-10T12:00:00.000Z',
  lastScheduledAt: '2026-08-10T12:00:00.000Z',
  configVersion: 1,
});

const progressFor = (
  unitId: string,
  scheduling: StudyProgress['scheduling'],
  phase: StudyProgress['phase'] = 'maintenance',
): StudyProgress => ({
  unitId,
  phase,
  scheduling,
  dueAt: scheduling?.card?.due ?? scheduling?.legacyDueAt ?? nowIso,
  lastStudiedAt: null,
  successfulGuidedRecallDays: [],
  successfulFreeRecallDays: [],
  applicationSuccessCount: 0,
  reviewCount: scheduling?.initialized ? 1 : 0,
  createdAt: '2026-08-10T12:00:00.000Z',
  updatedAt: '2026-08-10T12:00:00.000Z',
});

const queueFor = ({
  units,
  progress,
  newUnitsPerSession = 5,
  includeSurprisePractice = false,
  surpriseUnitIds = [],
}: {
  units?: StudyUnit[];
  progress: StudyProgress[];
  newUnitsPerSession?: number;
  includeSurprisePractice?: boolean;
  surpriseUnitIds?: string[];
}) => {
  const seed = createSeedStudyData(nowIso);
  return buildStudyQueue({
    units: units ?? seed.units,
    prompts: seed.prompts,
    concepts: seed.concepts,
    rubrics: seed.rubrics,
    progress,
    now,
    newUnitsPerSession,
    includeSurprisePractice,
    surpriseUnitIds,
  });
};

describe('study FSRS queue builder', () => {
  it('surfaces source-review-required units before due memory reviews', () => {
    const seed = createSeedStudyData(nowIso);
    const units = seed.units.map((unit, index) =>
      index === 1 ? { ...unit, sourceReviewRequired: true, priority: 5 as const } : unit,
    );
    const progress = [
      progressFor(units[0].id, schedule('Review', '2026-08-09T12:00:00.000Z')),
      progressFor(units[1].id, schedule('Review', '2026-08-08T12:00:00.000Z')),
    ];

    const queue = queueFor({ units, progress });

    expect(queue[0]?.unit.id).toBe(units[1].id);
    expect(queue[0]?.reason).toBe('source-review-required');
    expect(queue[1]?.reason).toBe('review-due');
  });

  it('orders due learning and relearning before due review cards', () => {
    const seed = createSeedStudyData(nowIso);
    const progress = [
      progressFor(seed.units[0].id, schedule('Review', '2026-08-08T12:00:00.000Z')),
      progressFor(seed.units[1].id, schedule('Learning', '2026-08-11T11:55:00.000Z')),
      progressFor(seed.units[2].id, schedule('Relearning', '2026-08-11T11:56:00.000Z')),
    ];

    const queue = queueFor({ progress });

    expect(queue.slice(0, 3).map((item) => item.reason)).toEqual([
      'learning-due',
      'relearning-due',
      'review-due',
    ]);
  });

  it('excludes future learning cards at the current timestamp boundary', () => {
    const seed = createSeedStudyData(nowIso);
    const progress = [
      progressFor(seed.units[0].id, schedule('Learning', '2026-08-11T12:00:00.000Z')),
      progressFor(seed.units[1].id, schedule('Learning', '2026-08-11T12:00:00.001Z')),
    ];

    const queue = queueFor({ progress, newUnitsPerSession: 0 });

    expect(queue.map((item) => item.unit.id)).toEqual([seed.units[0].id]);
    expect(queue[0]?.reason).toBe('learning-due');
  });

  it('uses due time first and priority only as a due-review tie breaker', () => {
    const seed = createSeedStudyData(nowIso);
    const units = seed.units.map((unit, index) =>
      index === 0 ? { ...unit, priority: 5 as const } : index === 1 ? { ...unit, priority: 1 as const } : unit,
    );
    const progress = [
      progressFor(units[0].id, schedule('Review', '2026-08-09T12:00:00.000Z')),
      progressFor(units[1].id, schedule('Review', '2026-08-10T12:00:00.000Z')),
      progressFor(units[2].id, schedule('Review', '2026-08-10T12:00:00.000Z')),
    ];

    const queue = queueFor({ units, progress, newUnitsPerSession: 0 });

    expect(queue.map((item) => item.unit.id)).toEqual([units[0].id, units[1].id, units[2].id]);
  });

  it('queues legacy due progress by preserved due date without fabricating a card', () => {
    const seed = createSeedStudyData(nowIso);
    const progress = [
      progressFor(
        seed.units[0].id,
        {
          schemaVersion: 1,
          algorithm: 'fsrs',
          initialized: false,
          legacyDueAt: '2026-08-10T12:00:00.000Z',
          configVersion: 1,
        },
        'guided-recall',
      ),
    ];

    const queue = queueFor({ progress, newUnitsPerSession: 0 });

    expect(queue[0]?.reason).toBe('review-due');
    expect(queue[0]?.progress.scheduling?.initialized).toBe(false);
    expect(queue[0]?.dueAt).toBe('2026-08-10T12:00:00.000Z');
  });

  it('limits only new material after due work', () => {
    const seed = createSeedStudyData(nowIso);
    const progress = [
      progressFor(seed.units[0].id, schedule('Review', '2026-08-10T12:00:00.000Z')),
      ...seed.units.slice(1).map((unit) =>
        progressFor(
          unit.id,
          {
            schemaVersion: 1,
            algorithm: 'fsrs',
            initialized: false,
            configVersion: 1,
          },
          'unread',
        ),
      ),
    ];

    const queue = queueFor({ progress, newUnitsPerSession: 2 });

    expect(queue[0]?.reason).toBe('review-due');
    expect(queue.filter((item) => item.reason === 'new')).toHaveLength(2);
  });

  it('orders new units by priority and stable title/id tie breakers', () => {
    const seed = createSeedStudyData(nowIso);
    const units = [
      { ...seed.units[0], title: 'Same title', priority: 2 as const },
      { ...seed.units[1], title: 'Same title', priority: 2 as const },
      { ...seed.units[2], title: 'Higher priority title', priority: 1 as const },
    ];
    const progress = units.map((unit) =>
      progressFor(unit.id, {
        schemaVersion: 1,
        algorithm: 'fsrs',
        initialized: false,
        configVersion: 1,
      }, 'unread'),
    );

    const queue = queueFor({ units, progress, newUnitsPerSession: 3 });

    expect(queue.map((item) => item.unit.id)).toEqual([units[2].id, units[1].id, units[0].id]);
    expect(queue.every((item) => item.reason === 'new')).toBe(true);
  });

  it('excludes surprise practice from normal scheduling unless explicitly requested', () => {
    const seed = createSeedStudyData(nowIso);
    const progress = [
      progressFor(seed.units[0].id, schedule('Review', '2026-08-12T12:00:00.000Z')),
    ];

    expect(queueFor({ progress, newUnitsPerSession: 0, surpriseUnitIds: [seed.units[0].id] })).toEqual([]);

    const withSurprise = queueFor({
      progress,
      newUnitsPerSession: 0,
      includeSurprisePractice: true,
      surpriseUnitIds: [seed.units[0].id],
    });
    expect(withSurprise[0]?.reason).toBe('surprise-practice');
    expect(withSurprise[0]?.due).toBe(false);
  });
});
