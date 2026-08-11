import { createNewStudySchedule, createStudyFsrsScheduler } from './fsrs/studyFsrs';
import { createStudyFsrsConfigRecord, resolveStudyFsrsParameters } from './fsrs/studyFsrsMigration';
import { updateProgressAfterAttempt } from './studyScheduler';
import type {
  StudyAttempt,
  StudyDataSnapshot,
  StudyAttemptSchedulingReason,
  StudyFsrsConfigRecord,
  StudyFsrsSchedule,
  StudyProgress,
  StudyRating,
  StudyResponseMode,
  StudyRubricCoverage,
  StudySessionItem,
} from './studyTypes';

export type BuildRatedStudyAttemptOptions = {
  data: StudyDataSnapshot;
  item: StudySessionItem;
  rating: StudyRating;
  now: Date;
  attemptId: string;
  answer: string;
  responseMode: StudyResponseMode;
  guidedResponses: Record<string, string>;
  coveredConceptIds: string[];
  rubricCoverage: StudyRubricCoverage[];
  startedAt: string;
  countedReason?: Extract<
    StudyAttemptSchedulingReason,
    'manual-counted-practice' | 'surprise-practice'
  >;
};

export type BuildNonSchedulingStudyAttemptOptions = {
  item: StudySessionItem;
  rating: StudyRating;
  attemptId: string;
  answer: string;
  responseMode: StudyResponseMode;
  guidedResponses: Record<string, string>;
  coveredConceptIds: string[];
  rubricCoverage: StudyRubricCoverage[];
  reason: Extract<StudyAttemptSchedulingReason, 'manual-practice' | 'surprise-practice'>;
  startedAt: string;
  revealedAt: string;
  completedAt: string;
};

export type RatedStudyAttemptResult = {
  attempt: StudyAttempt;
  progress: StudyProgress;
};

export type StudyUndoRatingResult = {
  attempt: StudyAttempt;
  progress: StudyProgress;
};

export type StudyRatingPreview = {
  rating: StudyRating;
  due: string;
  intervalLabel: string;
};

const resolveConfig = (data: StudyDataSnapshot, now: Date): StudyFsrsConfigRecord =>
  data.settings.fsrsConfig ??
  createStudyFsrsConfigRecord({
    now,
    configVersion: 1,
  });

const resolveSchedule = (
  item: StudySessionItem,
  config: StudyFsrsConfigRecord,
): StudyFsrsSchedule =>
  item.progress.scheduling ??
  createNewStudySchedule({
    configVersion: config.configVersion,
    legacyDueAt: item.progress.dueAt,
  });

const isSuccessfulRating = (rating: StudyRating): boolean => rating === 'good' || rating === 'easy';

const removeDay = (days: string[], completedAt: string): string[] => {
  const day = completedAt.slice(0, 10);
  const index = days.lastIndexOf(day);
  if (index < 0) return days.slice();
  return [...days.slice(0, index), ...days.slice(index + 1)];
};

const restoreProgressPhaseAfterUndo = (
  progress: StudyProgress,
  attempt: StudyAttempt,
): StudyProgress => {
  const rating = attempt.scheduling?.rating ?? attempt.rating;
  if (!isSuccessfulRating(rating)) {
    return {
      ...progress,
      phase: attempt.phaseBefore ?? progress.phase,
      reviewCount: Math.max(0, progress.reviewCount - 1),
    };
  }
  if (attempt.phaseBefore === 'guided-recall') {
    return {
      ...progress,
      phase: attempt.phaseBefore,
      successfulGuidedRecallDays: removeDay(
        progress.successfulGuidedRecallDays,
        attempt.completedAt,
      ),
      reviewCount: Math.max(0, progress.reviewCount - 1),
    };
  }
  if (attempt.phaseBefore === 'free-recall') {
    return {
      ...progress,
      phase: attempt.phaseBefore,
      successfulFreeRecallDays: removeDay(progress.successfulFreeRecallDays, attempt.completedAt),
      reviewCount: Math.max(0, progress.reviewCount - 1),
    };
  }
  if (attempt.phaseBefore === 'application') {
    return {
      ...progress,
      phase: attempt.phaseBefore,
      applicationSuccessCount: Math.max(0, progress.applicationSuccessCount - 1),
      reviewCount: Math.max(0, progress.reviewCount - 1),
    };
  }
  return {
    ...progress,
    phase: attempt.phaseBefore ?? progress.phase,
    reviewCount: Math.max(0, progress.reviewCount - 1),
  };
};

const intervalLabel = (from: Date, dueIso: string): string => {
  const ms = new Date(dueIso).getTime() - from.getTime();
  if (ms <= 0) return 'now';
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 365) return `${days}d`;
  return `${Math.round(days / 365)}y`;
};

export const buildStudyRatingPreviews = ({
  data,
  item,
  now,
}: {
  data: StudyDataSnapshot;
  item: StudySessionItem;
  now: Date;
}): StudyRatingPreview[] => {
  const config = resolveConfig(data, now);
  const scheduler = createStudyFsrsScheduler(
    config.userSettings,
    resolveStudyFsrsParameters(config),
  );
  const schedule = resolveSchedule(item, config);
  return scheduler.previewAllStudyRatings(schedule, now).map((preview) => ({
    rating: preview.rating,
    due: preview.due,
    intervalLabel: intervalLabel(now, preview.due),
  }));
};

export const buildRatedStudyAttempt = ({
  data,
  item,
  rating,
  now,
  attemptId,
  answer,
  responseMode,
  guidedResponses,
  coveredConceptIds,
  rubricCoverage,
  startedAt,
  countedReason,
}: BuildRatedStudyAttemptOptions): RatedStudyAttemptResult => {
  const nowIso = now.toISOString();
  const config = resolveConfig(data, now);
  const scheduler = createStudyFsrsScheduler(
    config.userSettings,
    resolveStudyFsrsParameters(config),
  );
  const schedule = resolveSchedule(item, config);
  const dueBefore =
    schedule.initialized && schedule.card
      ? schedule.card.due
      : (schedule.legacyDueAt ?? item.progress.dueAt);
  const scheduled = scheduler.applyStudyRating(schedule, rating, now);
  const phaseBefore = item.progress.phase;
  const phaseProgress = updateProgressAfterAttempt({
    progress: item.progress,
    attempt: { rating, completedAt: nowIso },
    rules: data.settings.phaseRules,
  });
  const progress: StudyProgress = {
    ...phaseProgress,
    dueAt: scheduled.due,
    scheduling: {
      schemaVersion: 1,
      algorithm: 'fsrs',
      initialized: true,
      card: scheduled.card,
      initializedAt: schedule.initializedAt ?? nowIso,
      lastScheduledAt: nowIso,
      configVersion: config.configVersion,
    },
  };
  const attempt: StudyAttempt = {
    id: attemptId,
    unitId: item.unit.id,
    promptId: item.prompt.id,
    phase: phaseBefore,
    phaseBefore,
    phaseAfter: progress.phase,
    answer,
    responseMode,
    guidedResponses,
    coveredConceptIds,
    rubricCoverage,
    rating,
    scheduling: {
      algorithm: 'fsrs',
      schedulingApplied: true,
      rating,
      reviewedAt: nowIso,
      cardBefore: scheduled.cardBefore,
      cardAfter: scheduled.card,
      fsrsReviewLog: scheduled.log,
      dueBefore,
      dueAfter: scheduled.due,
      configVersion: config.configVersion,
      reason: countedReason ?? (schedule.initialized ? 'scheduled-review' : 'new-learning'),
    },
    startedAt,
    revealedAt: nowIso,
    completedAt: nowIso,
  };
  return { attempt, progress };
};

export const buildNonSchedulingStudyAttempt = ({
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
  completedAt,
}: BuildNonSchedulingStudyAttemptOptions): StudyAttempt => ({
  id: attemptId,
  unitId: item.unit.id,
  promptId: item.prompt.id,
  phase: item.progress.phase,
  phaseBefore: item.progress.phase,
  phaseAfter: item.progress.phase,
  answer,
  responseMode,
  guidedResponses,
  coveredConceptIds,
  rubricCoverage,
  rating,
  scheduling: {
    algorithm: 'fsrs',
    schedulingApplied: false,
    rating,
    reviewedAt: completedAt,
    dueBefore:
      item.progress.scheduling?.initialized && item.progress.scheduling.card
        ? item.progress.scheduling.card.due
        : (item.progress.scheduling?.legacyDueAt ?? item.progress.dueAt),
    dueAfter:
      item.progress.scheduling?.initialized && item.progress.scheduling.card
        ? item.progress.scheduling.card.due
        : (item.progress.scheduling?.legacyDueAt ?? item.progress.dueAt),
    configVersion: item.progress.scheduling?.configVersion,
    reason,
  },
  startedAt,
  revealedAt,
  completedAt,
});

export const buildUndoLatestSchedulingRating = ({
  data,
  attemptId,
  now,
}: {
  data: StudyDataSnapshot;
  attemptId: string;
  now: Date;
}): StudyUndoRatingResult => {
  const attempt = data.attempts.find((entry) => entry.id === attemptId);
  if (!attempt?.scheduling?.schedulingApplied || attempt.scheduling.undoneAt) {
    throw new Error('No eligible scheduling rating was found to undo.');
  }
  const countedAttempts = data.attempts
    .filter(
      (entry) =>
        entry.unitId === attempt.unitId &&
        entry.scheduling?.schedulingApplied === true &&
        !entry.scheduling.undoneAt,
    )
    .slice()
    .sort(
      (left, right) =>
        right.completedAt.localeCompare(left.completedAt) || right.id.localeCompare(left.id),
    );
  if (countedAttempts[0]?.id !== attempt.id) {
    throw new Error('Only the latest scheduling rating for this unit can be undone.');
  }
  const existingProgress = data.progress.find((entry) => entry.unitId === attempt.unitId);
  if (!existingProgress) throw new Error('Study progress was not found for the rating undo.');
  const dueAt = attempt.scheduling.dueBefore ?? existingProgress.dueAt;
  const restoredPhase = restoreProgressPhaseAfterUndo(existingProgress, attempt);
  const progress: StudyProgress = {
    ...restoredPhase,
    dueAt,
    scheduling:
      attempt.scheduling.reason === 'new-learning'
        ? {
            schemaVersion: 1,
            algorithm: 'fsrs',
            initialized: false,
            configVersion:
              attempt.scheduling.configVersion ??
              existingProgress.scheduling?.configVersion ??
              data.settings.fsrsConfig?.configVersion ??
              1,
            legacyDueAt: dueAt,
          }
        : {
            schemaVersion: 1,
            algorithm: 'fsrs',
            initialized: true,
            card:
              attempt.scheduling.cardBefore ??
              (() => {
                throw new Error('The rating does not include a restorable FSRS card snapshot.');
              })(),
            initializedAt: existingProgress.scheduling?.initializedAt,
            lastScheduledAt: attempt.scheduling.cardBefore?.last_review ?? undefined,
            configVersion:
              attempt.scheduling.configVersion ??
              existingProgress.scheduling?.configVersion ??
              data.settings.fsrsConfig?.configVersion ??
              1,
          },
    updatedAt: now.toISOString(),
  };
  return {
    attempt: {
      ...attempt,
      scheduling: {
        ...attempt.scheduling,
        undoneAt: now.toISOString(),
      },
    },
    progress,
  };
};
