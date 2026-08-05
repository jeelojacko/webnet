import { describe, expect, it } from 'vitest';

import {
  buildSessionItems,
  createInitialProgress,
  markReadingComplete,
  updateProgressAfterAttempt,
} from '../../src/study/studyScheduler';
import { createSeedStudyData } from '../../src/study/studySeed';

describe('study scheduler', () => {
  it('advances phases only after successful attempts on separate days', () => {
    const initial = markReadingComplete(
      createInitialProgress('unit-1', '2026-08-01T10:00:00.000Z'),
      '2026-08-01T10:00:00.000Z',
    );
    const first = updateProgressAfterAttempt({
      progress: initial,
      attempt: { rating: 'good', completedAt: '2026-08-01T11:00:00.000Z' },
    });
    const sameDay = updateProgressAfterAttempt({
      progress: first,
      attempt: { rating: 'easy', completedAt: '2026-08-01T12:00:00.000Z' },
    });
    const nextDay = updateProgressAfterAttempt({
      progress: sameDay,
      attempt: { rating: 'good', completedAt: '2026-08-02T12:00:00.000Z' },
    });

    expect(first.phase).toBe('guided-recall');
    expect(sameDay.phase).toBe('guided-recall');
    expect(nextDay.phase).toBe('free-recall');
  });

  it('orders due reviews before new units and then by priority', () => {
    const data = createSeedStudyData('2026-08-01T10:00:00.000Z');
    const progress = data.progress.map((entry, index) =>
      index === 2
        ? {
            ...entry,
            phase: 'maintenance' as const,
            dueAt: '2026-08-01T09:00:00.000Z',
          }
        : entry,
    );

    const items = buildSessionItems({
      units: data.units,
      prompts: data.prompts,
      concepts: data.concepts,
      progress,
      nowIso: '2026-08-01T10:00:00.000Z',
      newPriorityLimit: 5,
    });

    expect(items[0]?.due).toBe(true);
    expect(items[0]?.unit.id).toBe(data.units[2]?.id);
    expect(items[1]?.unit.priority).toBeLessThanOrEqual(items[2]?.unit.priority ?? 5);
  });
});
