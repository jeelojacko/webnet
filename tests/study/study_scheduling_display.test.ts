import { describe, expect, it } from 'vitest';
import { summarizeStudyScheduling } from '../../src/study/studySchedulingDisplay';
import { createSeedStudyData } from '../../src/study/studySeed';
import type { StudyProgress } from '../../src/study/studyTypes';

const now = new Date('2026-08-11T12:00:00.000Z');

const baseProgress = (overrides: Partial<StudyProgress> = {}): StudyProgress => ({
  unitId: 'unit-1',
  phase: 'maintenance',
  dueAt: '2026-08-11T11:00:00.000Z',
  lastStudiedAt: null,
  successfulGuidedRecallDays: [],
  successfulFreeRecallDays: [],
  applicationSuccessCount: 0,
  reviewCount: 0,
  createdAt: '2026-08-01T10:00:00.000Z',
  updatedAt: '2026-08-01T10:00:00.000Z',
  ...overrides,
});

describe('study scheduling display summaries', () => {
  it('prioritizes source-review status over memory scheduling labels', () => {
    const seed = createSeedStudyData('2026-08-01T10:00:00.000Z');
    const summary = summarizeStudyScheduling({
      unit: { ...seed.units[0], sourceReviewRequired: true },
      progress: seed.progress[0],
      now,
    });

    expect(summary.category).toBe('source-review');
    expect(summary.label).toBe('Source review required');
  });

  it('labels overdue review cards separately from due-today cards', () => {
    const seed = createSeedStudyData('2026-08-01T10:00:00.000Z');
    const summary = summarizeStudyScheduling({
      unit: seed.units[0],
      progress: baseProgress({
        scheduling: {
          schemaVersion: 1,
          algorithm: 'fsrs',
          initialized: true,
          configVersion: 1,
          card: {
            due: '2026-08-10T10:00:00.000Z',
            stability: 2.5,
            difficulty: 4.5,
            elapsed_days: 1,
            scheduled_days: 1,
            learning_steps: 0,
            reps: 7,
            lapses: 1,
            state: 'Review',
            last_review: '2026-08-09T10:00:00.000Z',
          },
        },
      }),
      now,
    });

    expect(summary.category).toBe('overdue');
    expect(summary.label).toBe('Overdue · 1d');
    expect(summary.reviews).toBe(7);
    expect(summary.lapses).toBe(1);
  });

  it('labels new units without fabricating a due timestamp', () => {
    const seed = createSeedStudyData('2026-08-01T10:00:00.000Z');
    const summary = summarizeStudyScheduling({
      unit: seed.units[0],
      progress: baseProgress({ dueAt: '2026-08-20T10:00:00.000Z', scheduling: undefined }),
      now,
    });

    expect(summary.category).toBe('new');
    expect(summary.label).toBe('New');
  });
});
