import { describe, expect, it } from 'vitest';
import { buildStudySessionCompletionSummary } from '../../src/study/studySessionSummary';
import type { StudyAttempt, StudySessionItem } from '../../src/study/studyTypes';

const attempt = (
  id: string,
  rating: StudyAttempt['rating'],
  reason: NonNullable<StudyAttempt['scheduling']>['reason'],
  dueAfter?: string,
): StudyAttempt => ({
  id,
  unitId: `unit-${id}`,
  promptId: `prompt-${id}`,
  phase: 'guided-recall',
  phaseBefore: 'guided-recall',
  phaseAfter: 'guided-recall',
  answer: '',
  responseMode: 'guided',
  guidedResponses: {},
  coveredConceptIds: [],
  rubricCoverage: [],
  rating,
  scheduling: {
    algorithm: 'fsrs',
    schedulingApplied: true,
    rating,
    reviewedAt: '2026-08-11T10:00:00.000Z',
    dueAfter,
    reason,
    cardAfter: dueAfter
      ? {
          due: dueAfter,
          stability: 1,
          difficulty: 1,
          elapsed_days: 0,
          scheduled_days: 0,
          learning_steps: 0,
          reps: 1,
          lapses: rating === 'again' ? 1 : 0,
          state: 'Learning',
          last_review: '2026-08-11T10:00:00.000Z',
        }
      : undefined,
  },
  startedAt: '2026-08-11T09:55:00.000Z',
  revealedAt: '2026-08-11T10:00:00.000Z',
  completedAt: '2026-08-11T10:00:00.000Z',
});

describe('study session completion summary', () => {
  it('summarizes ratings, new learned count, still-due items, and short-term due interval', () => {
    const summary = buildStudySessionCompletionSummary({
      attempts: [
        attempt('1', 'good', 'new-learning'),
        attempt('2', 'again', 'scheduled-review', '2026-08-11T10:10:00.000Z'),
      ],
      remainingItems: [
        { reason: 'review-due', due: true } as StudySessionItem,
        { reason: 'new', due: false } as StudySessionItem,
      ],
      now: new Date('2026-08-11T10:00:00.000Z'),
    });

    expect(summary.reviewed).toBe(2);
    expect(summary.ratings.good).toBe(1);
    expect(summary.ratings.again).toBe(1);
    expect(summary.newLearned).toBe(1);
    expect(summary.stillDue).toBe(1);
    expect(summary.nextShortTermReview).toBe('10m');
  });
});
