import { generatorParameters, type FSRSParameters, type StepUnit } from 'ts-fsrs';
import {
  DEFAULT_STUDY_FSRS_SETTINGS,
  type StudyFsrsConfigRecord,
  type StudyFsrsSettings,
} from './studyFsrsTypes';
import { validateStudyFsrsParameters } from './studyFsrsSerialization';

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
