import { describe, expect, it } from 'vitest';
import { buildRatedStudyAttempt } from '../../src/study/studyReviewTransaction';
import { buildSessionItems, markReadingComplete } from '../../src/study/studyScheduler';
import { createSeedStudyData } from '../../src/study/studySeed';

const activeSessionItem = () => {
  const data = createSeedStudyData('2026-08-10T10:00:00.000Z');
  const progress = markReadingComplete(data.progress[0], '2026-08-10T10:00:00.000Z');
  const nextData = {
    ...data,
    progress: [progress, ...data.progress.slice(1)],
  };
  const item = buildSessionItems({
    units: nextData.units,
    prompts: nextData.prompts,
    concepts: nextData.concepts,
    rubrics: nextData.rubrics,
    progress: nextData.progress,
    nowIso: '2026-08-10T10:05:00.000Z',
  })[0];
  if (!item) throw new Error('Expected a session item.');
  return { data: nextData, item };
};

describe('study review transaction builder', () => {
  it('creates one FSRS scheduling transition for a rated unit attempt', () => {
    const { data, item } = activeSessionItem();
    const now = new Date('2026-08-10T10:06:00.000Z');
    const result = buildRatedStudyAttempt({
      data,
      item,
      rating: 'good',
      now,
      attemptId: 'attempt-1',
      answer: 'typed answer',
      responseMode: 'guided',
      guidedResponses: { rubric: 'guided answer' },
      coveredConceptIds: ['concept-1'],
      rubricCoverage: [{ rubricItemId: 'rubric-1', status: 'covered' }],
      startedAt: '2026-08-10T10:00:00.000Z',
    });

    expect(result.attempt.scheduling).toMatchObject({
      algorithm: 'fsrs',
      schedulingApplied: true,
      rating: 'good',
      reviewedAt: now.toISOString(),
      reason: 'new-learning',
      dueBefore: item.progress.scheduling?.legacyDueAt,
      dueAfter: result.progress.dueAt,
      configVersion: data.settings.fsrsConfig?.configVersion,
    });
    expect(result.attempt.scheduling?.cardBefore?.reps).toBe(0);
    expect(result.attempt.scheduling?.cardAfter?.reps).toBe(1);
    expect(result.attempt.scheduling?.fsrsReviewLog?.rating).toBe('Good');
    expect(result.progress.scheduling?.initialized).toBe(true);
    expect(result.progress.scheduling?.card).toEqual(result.attempt.scheduling?.cardAfter);
    expect(result.progress.dueAt).toBe(result.attempt.scheduling?.dueAfter);
  });

  it('records phase before and after independently from FSRS state', () => {
    const { data, item } = activeSessionItem();
    const first = buildRatedStudyAttempt({
      data,
      item,
      rating: 'good',
      now: new Date('2026-08-10T10:06:00.000Z'),
      attemptId: 'attempt-1',
      answer: '',
      responseMode: 'guided',
      guidedResponses: {},
      coveredConceptIds: [],
      rubricCoverage: [],
      startedAt: '2026-08-10T10:00:00.000Z',
    });
    const nextDayItem = {
      ...item,
      progress: {
        ...first.progress,
        dueAt: '2026-08-11T10:06:00.000Z',
      },
    };
    const second = buildRatedStudyAttempt({
      data,
      item: nextDayItem,
      rating: 'easy',
      now: new Date('2026-08-11T10:06:00.000Z'),
      attemptId: 'attempt-2',
      answer: '',
      responseMode: 'guided',
      guidedResponses: {},
      coveredConceptIds: [],
      rubricCoverage: [],
      startedAt: '2026-08-11T10:00:00.000Z',
    });

    expect(second.attempt.phaseBefore).toBe('guided-recall');
    expect(second.attempt.phaseAfter).toBe('free-recall');
    expect(second.progress.phase).toBe('free-recall');
    expect(second.progress.scheduling?.card?.state).toBeDefined();
  });
});
