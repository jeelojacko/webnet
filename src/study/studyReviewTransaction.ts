import { createNewStudySchedule, createStudyFsrsScheduler } from './fsrs/studyFsrs';
import {
  createStudyFsrsConfigRecord,
  resolveStudyFsrsParameters,
} from './fsrs/studyFsrsMigration';
import { updateProgressAfterAttempt } from './studyScheduler';
import type {
  StudyAttempt,
  StudyDataSnapshot,
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
  const config =
    data.settings.fsrsConfig ??
    createStudyFsrsConfigRecord({
      now,
      configVersion: 1,
    });
  const scheduler = createStudyFsrsScheduler(config.userSettings, resolveStudyFsrsParameters(config));
  const schedule =
    item.progress.scheduling ??
    createNewStudySchedule({
      configVersion: config.configVersion,
      legacyDueAt: item.progress.dueAt,
    });
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
