// Exam Prep — FSRS rating previews and rated-attempt construction.
//
// Reuses the Study FSRS scheduler/config machinery (`createStudyFsrsScheduler`,
// `resolveStudyFsrsParameters`, `createStudyFsrsConfigRecord`). Building an
// attempt + progress is pure; the caller persists them atomically with stale
// `updatedAt` protection. Attempts are immutable evidence: exact answer,
// rating, card before/after, review log, due values, config version, and
// timestamps.

import {
  createNewStudySchedule,
  createStudyFsrsScheduler,
} from '../fsrs/studyFsrs';
import {
  createStudyFsrsConfigRecord,
  resolveStudyFsrsParameters,
} from '../fsrs/studyFsrsMigration';
import type { StudyDataSnapshot, StudyFsrsSchedule } from '../studyTypes';
import type { ExamPrepQueueItem } from './examPrepQueue';
import { currentExamPrepBinding, examPrepProgressId } from './examPrepManifest';
import type {
  ExamPrepRecallAttempt,
  ExamPrepRecallProgress,
  ExamPrepRecallRating,
} from './examPrepTypes';

export type ExamPrepRatingPreview = {
  rating: ExamPrepRecallRating;
  due: string;
  intervalLabel: string;
};

export type ExamPrepRatedRecallResult = {
  attempt: ExamPrepRecallAttempt;
  progress: ExamPrepRecallProgress;
};

const intervalLabel = (from: Date, dueIso: string): string => {
  const ms = new Date(dueIso).getTime() - from.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 'now';
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 365) return `${days}d`;
  return `${Math.round(days / 365)}y`;
};

const resolveFsrsConfig = (data: StudyDataSnapshot, now: Date) =>
  data.settings.fsrsConfig ??
  createStudyFsrsConfigRecord({
    now,
    configVersion: 1,
  });

const resolveSchedule = (
  item: ExamPrepQueueItem,
  configVersion: number,
): StudyFsrsSchedule =>
  item.progress?.scheduling ??
  createNewStudySchedule({ configVersion });

export const buildExamPrepRecallRatingPreviews = ({
  data,
  item,
  now,
}: {
  data: StudyDataSnapshot;
  item: ExamPrepQueueItem;
  now: Date;
}): ExamPrepRatingPreview[] => {
  const config = resolveFsrsConfig(data, now);
  const scheduler = createStudyFsrsScheduler(
    config.userSettings,
    resolveStudyFsrsParameters(config),
  );
  const schedule = resolveSchedule(item, config.configVersion);
  return scheduler.previewAllStudyRatings(schedule, now).map((preview) => ({
    rating: preview.rating,
    due: preview.due,
    intervalLabel: intervalLabel(now, preview.due),
  }));
};

export const buildExamPrepRatedRecallAttempt = ({
  data,
  item,
  rating,
  now,
  attemptId,
  answer,
}: {
  data: StudyDataSnapshot;
  item: ExamPrepQueueItem;
  rating: ExamPrepRecallRating;
  now: Date;
  attemptId: string;
  answer?: string;
}): ExamPrepRatedRecallResult => {
  const nowIso = now.toISOString();
  const binding = currentExamPrepBinding();
  const config = resolveFsrsConfig(data, now);
  const scheduler = createStudyFsrsScheduler(
    config.userSettings,
    resolveStudyFsrsParameters(config),
  );
  const schedule = resolveSchedule(item, config.configVersion);
  const scheduled = scheduler.applyStudyRating(schedule, rating, now);
  const existing = item.progress;
  const reviewCount = (existing?.reviewCount ?? 0) + 1;
  const progress: ExamPrepRecallProgress = {
    id: examPrepProgressId(binding, item.task.id),
    curriculumId: binding.curriculumId,
    curriculumContentHash: binding.curriculumContentHash,
    taskId: item.task.id,
    unitId: item.task.unitId,
    scheduling: {
      schemaVersion: 1,
      algorithm: 'fsrs',
      initialized: true,
      card: scheduled.card,
      initializedAt: existing?.scheduling.initializedAt ?? nowIso,
      lastScheduledAt: nowIso,
      configVersion: config.configVersion,
    },
    reviewCount,
    lastReviewedAt: nowIso,
    createdAt: existing?.createdAt ?? nowIso,
    updatedAt: nowIso,
  };
  const attempt: ExamPrepRecallAttempt = {
    id: attemptId,
    kind: 'recall',
    curriculumId: binding.curriculumId,
    curriculumContentHash: binding.curriculumContentHash,
    taskId: item.task.id,
    unitId: item.task.unitId,
    exactAnswer: item.task.expectedAnswer,
    rating,
    cardBefore: scheduled.cardBefore,
    cardAfter: scheduled.card,
    fsrsReviewLog: scheduled.log,
    dueBefore: scheduled.cardBefore.due,
    dueAfter: scheduled.due,
    configVersion: config.configVersion,
    reviewedAt: nowIso,
    ...(answer !== undefined ? { answer } : {}),
  };
  return { attempt, progress };
};
