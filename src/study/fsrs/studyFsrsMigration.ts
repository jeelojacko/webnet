import { generatorParameters, type FSRSParameters, type StepUnit } from 'ts-fsrs';
import type { StudyAttempt, StudyAttemptScheduling, StudyFsrsSchedule } from '../studyTypes';
import {
  DEFAULT_STUDY_FSRS_SETTINGS,
  type StudyFsrsConfigRecord,
  type StudyFsrsSettings,
} from './studyFsrsTypes';
import { deserializeStudyFsrsCard, validateStudyFsrsParameters } from './studyFsrsSerialization';

const toStepUnits = (steps: string[]): StepUnit[] =>
  steps.map((step) => {
    if (!/^\d+(?:\.\d+)?[mhd]$/.test(step)) throw new Error(`Invalid Study FSRS step: ${step}`);
    return step as StepUnit;
  });

export const studySettingsToFsrsParameters = (settings: StudyFsrsSettings): FSRSParameters =>
  generatorParameters({
    request_retention: settings.requestRetention,
    maximum_interval: settings.maximumIntervalDays,
    enable_fuzz: settings.enableFuzz,
    enable_short_term: settings.enableShortTerm,
    learning_steps: toStepUnits(settings.learningSteps),
    relearning_steps: toStepUnits(settings.relearningSteps),
  });

export const createStudyFsrsConfigRecord = ({
  settings = DEFAULT_STUDY_FSRS_SETTINGS,
  configVersion = 1,
  now,
}: {
  settings?: StudyFsrsSettings;
  configVersion?: number;
  now: Date;
}): StudyFsrsConfigRecord => {
  const nowIso = now.toISOString();
  return {
    schemaVersion: 1,
    configVersion,
    userSettings: { ...settings, learningSteps: settings.learningSteps.slice(), relearningSteps: settings.relearningSteps.slice() },
    resolvedParameters: studySettingsToFsrsParameters(settings),
    createdAt: nowIso,
    updatedAt: nowIso,
  };
};

export const resolveStudyFsrsParameters = (config: StudyFsrsConfigRecord): FSRSParameters =>
  validateStudyFsrsParameters(config.resolvedParameters);

const isValidIso = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const migrateStudyFsrsSchedule = ({
  schedule,
  legacyDueAt,
  configVersion,
}: {
  schedule: unknown;
  legacyDueAt?: string;
  configVersion: number;
}): StudyFsrsSchedule => {
  if (isRecord(schedule) && schedule.algorithm === 'fsrs' && schedule.schemaVersion === 1) {
    const initialized = schedule.initialized === true;
    if (initialized && schedule.card) {
      try {
        deserializeStudyFsrsCard(schedule.card);
      } catch {
        return {
          schemaVersion: 1,
          algorithm: 'fsrs',
          initialized: false,
          configVersion,
          legacyDueAt: isValidIso(legacyDueAt) ? legacyDueAt : undefined,
        };
      }
    }
    return {
      schemaVersion: 1,
      algorithm: 'fsrs',
      initialized,
      card: initialized && schedule.card ? schedule.card as StudyFsrsSchedule['card'] : undefined,
      initializedAt: isValidIso(schedule.initializedAt) ? schedule.initializedAt : undefined,
      lastScheduledAt: isValidIso(schedule.lastScheduledAt) ? schedule.lastScheduledAt : undefined,
      configVersion:
        typeof schedule.configVersion === 'number' && Number.isFinite(schedule.configVersion)
          ? schedule.configVersion
          : configVersion,
      legacyDueAt: isValidIso(schedule.legacyDueAt) ? schedule.legacyDueAt : undefined,
    };
  }
  return {
    schemaVersion: 1,
    algorithm: 'fsrs',
    initialized: false,
    configVersion,
    legacyDueAt: isValidIso(legacyDueAt) ? legacyDueAt : undefined,
  };
};

export const isFsrsReplayableAttempt = (attempt: Partial<StudyAttempt>): boolean => {
  const scheduling = attempt.scheduling as Partial<StudyAttemptScheduling> | undefined;
  if (!scheduling || scheduling.algorithm !== 'fsrs') return false;
  if (scheduling.schedulingApplied !== true) return false;
  if (!scheduling.rating || !['again', 'hard', 'good', 'easy'].includes(scheduling.rating)) return false;
  if (!isValidIso(scheduling.reviewedAt)) return false;
  if (scheduling.reason === 'preview' || scheduling.reason === 'source-review') return false;
  if (scheduling.undoneAt) return false;
  return true;
};
