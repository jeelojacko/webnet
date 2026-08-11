import { createNewStudySchedule, createStudyFsrsScheduler } from './fsrs/studyFsrs';
import {
  createStudyFsrsConfigRecord,
  resolveStudyFsrsParameters,
} from './fsrs/studyFsrsMigration';
import { updateProgressAfterAttempt } from './studyScheduler';
import type {
  StudyAttempt,
  StudyDataSnapshot,
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
};

export type RatedStudyAttemptResult = {
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
  const scheduler = createStudyFsrsScheduler(config.userSettings, resolveStudyFsrsParameters(config));
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
}: BuildRatedStudyAttemptOptions): RatedStudyAttemptResult => {
  const nowIso = now.toISOString();
  const config = resolveConfig(data, now);
  const scheduler = createStudyFsrsScheduler(config.userSettings, resolveStudyFsrsParameters(config));
  const schedule = resolveSchedule(item, config);
  const dueBefore = schedule.initialized && schedule.card ? schedule.card.due : schedule.legacyDueAt ?? item.progress.dueAt;
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
      reason: schedule.initialized ? 'scheduled-review' : 'new-learning',
    },
    startedAt,
    revealedAt: nowIso,
    completedAt: nowIso,
  };
  return { attempt, progress };
};
