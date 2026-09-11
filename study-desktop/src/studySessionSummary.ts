import type {
  SerializedStudyFsrsCard,
  StudyAttempt,
  StudyRating,
  StudySessionItem,
} from './studyTypes';

export type StudySessionCompletionSummary = {
  reviewed: number;
  ratings: Record<StudyRating, number>;
  newLearned: number;
  stillDue: number;
  nextShortTermReview: string | null;
};

const emptyRatings = (): Record<StudyRating, number> => ({
  again: 0,
  hard: 0,
  good: 0,
  easy: 0,
});

const shortIntervalLabel = (from: Date, dueIso: string): string => {
  const ms = new Date(dueIso).getTime() - from.getTime();
  if (!Number.isFinite(ms)) return 'unknown';
  if (ms <= 0) return 'now';
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
};

export const buildStudySessionCompletionSummary = ({
  attempts,
  remainingItems,
  now,
}: {
  attempts: StudyAttempt[];
  remainingItems: StudySessionItem[];
  now: Date;
}): StudySessionCompletionSummary => {
  const ratings = emptyRatings();
  for (const attempt of attempts) ratings[attempt.rating] += 1;
  const shortTermDueDates = attempts
    .map((attempt) => attempt.scheduling?.cardAfter)
    .filter((card): card is SerializedStudyFsrsCard =>
      Boolean(card && (card.state === 'Learning' || card.state === 'Relearning')),
    )
    .map((card) => card.due)
    .sort();
  return {
    reviewed: attempts.length,
    ratings,
    newLearned: attempts.filter((attempt) => attempt.scheduling?.reason === 'new-learning').length,
    stillDue: remainingItems.filter(
      (item) =>
        item.reason === 'learning-due' ||
        item.reason === 'relearning-due' ||
        item.reason === 'review-due',
    ).length,
    nextShortTermReview: shortTermDueDates[0]
      ? shortIntervalLabel(now, shortTermDueDates[0])
      : null,
  };
};
