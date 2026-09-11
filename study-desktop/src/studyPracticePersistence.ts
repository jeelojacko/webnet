import type { StudyStorage } from './studyStorageTypes';
import { buildNonSchedulingStudyAttempt, buildRatedStudyAttempt } from './studyReviewTransaction';
import { replaceProgress } from './studyStateUpdates';
import type {
  StudyDataSnapshot,
  StudyRating,
  StudyResponseMode,
  StudyRubricCoverage,
  StudySessionItem,
} from './studyTypes';

type StudyPracticeReason = 'manual-practice' | 'surprise-practice';

export type PersistStudyPracticeAttemptResult = {
  snapshot: StudyDataSnapshot;
  statusMessage: string;
};

export const persistStudyPracticeAttempt = async ({
  data,
  storage,
  item,
  rating,
  reason,
  answer,
  responseMode,
  guidedResponses,
  coveredConceptIds,
  rubricCoverage,
  startedAt,
  revealedAt,
  countScheduling = false,
  attemptId,
}: {
  data: StudyDataSnapshot;
  storage: StudyStorage;
  item: StudySessionItem;
  rating: StudyRating;
  reason: StudyPracticeReason;
  answer: string;
  responseMode: StudyResponseMode;
  guidedResponses: Record<string, string>;
  coveredConceptIds: string[];
  rubricCoverage: StudyRubricCoverage[];
  startedAt: string;
  revealedAt: string;
  countScheduling?: boolean;
  attemptId: string;
}): Promise<PersistStudyPracticeAttemptResult> => {
  if (countScheduling) {
    const { attempt, progress } = buildRatedStudyAttempt({
      data,
      item,
      rating,
      now: new Date(revealedAt),
      attemptId,
      answer,
      responseMode,
      guidedResponses,
      coveredConceptIds,
      rubricCoverage,
      startedAt,
      countedReason: reason === 'manual-practice' ? 'manual-counted-practice' : reason,
    });
    await storage.saveAttemptProgress({
      attempt,
      progress,
      expectedProgressUpdatedAt: item.progress.updatedAt,
    });
    return {
      snapshot: {
        ...data,
        attempts: [...data.attempts, attempt],
        progress: replaceProgress(data.progress, progress),
      },
      statusMessage:
        reason === 'surprise-practice'
          ? 'Surprise practice saved and counted toward scheduling.'
          : 'Manual practice saved and counted toward scheduling.',
    };
  }

  const attempt = buildNonSchedulingStudyAttempt({
    item,
    rating,
    attemptId,
    answer,
    responseMode,
    guidedResponses,
    coveredConceptIds,
    rubricCoverage,
    reason,
    startedAt,
    revealedAt,
    completedAt: revealedAt,
  });
  await storage.saveAttempt(attempt);
  return {
    snapshot: { ...data, attempts: [...data.attempts, attempt] },
    statusMessage:
      reason === 'surprise-practice'
        ? 'Surprise practice saved without changing scheduling.'
        : 'Manual practice saved without changing scheduling.',
  };
};
