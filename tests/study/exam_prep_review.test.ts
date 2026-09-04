import { describe, expect, it } from 'vitest';
import { EXAM_PREP_RECALL_TASKS } from '../../src/study/examPrep/examPrepRecallTasks';
import { buildExamPrepRecallQueue } from '../../src/study/examPrep/examPrepQueue';
import {
  buildExamPrepRatedRecallAttempt,
  buildExamPrepRecallRatingPreviews,
} from '../../src/study/examPrep/examPrepReview';
import { createSeedStudyData } from '../../src/study/studySeed';
import type { StudyDataSnapshot } from '../../src/study/studyTypes';
import { makeRecallProgress, testCard } from './exam_prep_test_support';

const NOW = new Date('2026-09-10T00:00:00.000Z');
const seed = createSeedStudyData('2026-09-01T00:00:00.000Z') as StudyDataSnapshot;

const queueItemFor = (taskId: string) => {
  const task = EXAM_PREP_RECALL_TASKS.find((entry) => entry.id === taskId);
  if (!task) throw new Error(`no task ${taskId}`);
  const queue = buildExamPrepRecallQueue({
    progress: [],
    now: NOW,
    newRecallCardsPerSession: 1,
    maxRecallCardsPerSession: 5,
  });
  // build with explicit tasks restricted to the chosen one
  const single = buildExamPrepRecallQueue({
    tasks: [task],
    progress: [],
    now: NOW,
    newRecallCardsPerSession: 1,
    maxRecallCardsPerSession: 5,
  });
  void queue;
  return single[0];
};

const firstTask = EXAM_PREP_RECALL_TASKS[0];
if (!firstTask) throw new Error('expected tasks');

describe('Exam Prep FSRS rating previews and rated attempts', () => {
  it('produces four rating previews for a new card with due labels', () => {
    const item = queueItemFor(firstTask.id);
    if (!item) throw new Error('expected item');
    const previews = buildExamPrepRecallRatingPreviews({ data: seed, item, now: NOW });
    expect(previews.map((preview) => preview.rating)).toEqual(['again', 'hard', 'good', 'easy']);
    for (const preview of previews) {
      expect(preview.due).toBeTruthy();
      expect(typeof preview.intervalLabel).toBe('string');
    }
  });

  it('first rating on a new card initializes scheduling and writes immutable evidence', () => {
    const item = queueItemFor(firstTask.id);
    if (!item) throw new Error('expected item');
    const previews = buildExamPrepRecallRatingPreviews({ data: seed, item, now: NOW });
    const goodPreview = previews.find((preview) => preview.rating === 'good');
    const { attempt, progress } = buildExamPrepRatedRecallAttempt({
      data: seed,
      item,
      rating: 'good',
      now: NOW,
      attemptId: `attempt-${firstTask.id}-1`,
      answer: 'my typed answer',
    });
    expect(progress.scheduling.initialized).toBe(true);
    expect(progress.scheduling.card?.state).not.toBe('New');
    expect(new Date(progress.scheduling.card?.due ?? '').getTime()).toBeGreaterThan(NOW.getTime());
    expect(progress.scheduling.card?.state).toBe(attempt.cardAfter.state);
    expect(progress.reviewCount).toBe(1);
    expect(progress.lastReviewedAt).toBe(NOW.toISOString());
    expect(progress.updatedAt).toBe(NOW.toISOString());
    expect(goodPreview?.due).toBe(progress.scheduling.card?.due);
    // attempt immutability contract
    expect(attempt.id).toBe(`attempt-${firstTask.id}-1`);
    expect(attempt.kind).toBe('recall');
    expect(attempt.taskId).toBe(firstTask.id);
    expect(attempt.unitId).toBe(firstTask.unitId);
    expect(attempt.exactAnswer).toBe(firstTask.expectedAnswer);
    expect(attempt.rating).toBe('good');
    expect(attempt.answer).toBe('my typed answer');
    expect(attempt.cardBefore.state).toBe('New');
    expect(attempt.cardAfter.state).not.toBe('New');
    expect(attempt.cardAfter.state).toBe(progress.scheduling.card?.state);
    expect(attempt.fsrsReviewLog.rating).toBe('Good');
    expect(attempt.dueBefore).toBe(NOW.toISOString());
    expect(attempt.dueAfter).toBe(attempt.cardAfter.due);
    expect(attempt.dueAfter).toBe(goodPreview?.due);
    expect(attempt.configVersion).toBe(1);
    expect(attempt.reviewedAt).toBe(NOW.toISOString());
  });

  it('subsequent ratings carry cardBefore snapshots and increment reviewCount', () => {
    const task = EXAM_PREP_RECALL_TASKS[1];
    if (!task) throw new Error('expected task');
    const existing = makeRecallProgress({
      taskId: task.id,
      unitId: task.unitId,
      card: testCard({ state: 'Learning', due: '2026-09-10T00:00:00.000Z' }),
      reviewCount: 1,
      createdAt: '2026-09-09T00:00:00.000Z',
    });
    const item = {
      task,
      progress: existing,
    };
    const previews = buildExamPrepRecallRatingPreviews({ data: seed, item, now: NOW });
    const againPreview = previews.find((preview) => preview.rating === 'again');
    const { attempt, progress } = buildExamPrepRatedRecallAttempt({
      data: seed,
      item,
      rating: 'again',
      now: NOW,
      attemptId: `attempt-${task.id}-2`,
    });
    expect(progress.reviewCount).toBe(2);
    expect(progress.lastReviewedAt).toBe(NOW.toISOString());
    expect(progress.createdAt).toBe('2026-09-09T00:00:00.000Z');
    expect(progress.scheduling.initializedAt).toBe('2026-09-05T11:00:00.000Z');
    expect(attempt.cardBefore.state).toBe('Learning');
    expect(attempt.cardAfter.reps).toBeGreaterThanOrEqual(existing.scheduling.card?.reps ?? 0);
    expect(attempt.exactAnswer).toBe(task.expectedAnswer);
    expect(againPreview?.due).toBe(attempt.dueAfter);
  });

  it('is deterministic for identical inputs', () => {
    const item = queueItemFor(firstTask.id);
    if (!item) throw new Error('expected item');
    const a = buildExamPrepRatedRecallAttempt({
      data: seed,
      item,
      rating: 'good',
      now: NOW,
      attemptId: `attempt-${firstTask.id}-d`,
    });
    const b = buildExamPrepRatedRecallAttempt({
      data: seed,
      item,
      rating: 'good',
      now: NOW,
      attemptId: `attempt-${firstTask.id}-d`,
    });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
