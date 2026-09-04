// Exam Prep — recall session settings helpers.
//
// Defaults and bounds for the number of new recall cards per session and the
// maximum session size. Settings records are keyed by curriculum content hash
// so an archived hash import keeps its own settings record untouched while
// current metrics always resolve the current-hash record (or the defaults).

import {
  EXAM_PREP_DEFAULT_MAX_RECALL_CARDS_PER_SESSION,
  EXAM_PREP_DEFAULT_NEW_RECALL_CARDS_PER_SESSION,
  EXAM_PREP_MAX_CARDS_MAX,
  EXAM_PREP_MAX_CARDS_MIN,
  EXAM_PREP_NEW_CARDS_MAX,
  EXAM_PREP_NEW_CARDS_MIN,
} from './examPrepConstants';
import type { ExamPrepCurriculumBinding, ExamPrepSettings } from './examPrepTypes';

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const toFinite = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/**
 * Normalizes an imported/legacy settings record to legal bounds:
 * new in [0,57], max in [1,57], and new <= max. Records from archived
 * hashes keep their own identity (id = their content hash).
 */
export const normalizeExamPrepSettings = (input: ExamPrepSettings): ExamPrepSettings => {
  const maxRecallCardsPerSession = clamp(
    toFinite(input.maxRecallCardsPerSession, EXAM_PREP_DEFAULT_MAX_RECALL_CARDS_PER_SESSION),
    EXAM_PREP_MAX_CARDS_MIN,
    EXAM_PREP_MAX_CARDS_MAX,
  );
  const newRecallCardsPerSession = Math.min(
    clamp(
      toFinite(input.newRecallCardsPerSession, EXAM_PREP_DEFAULT_NEW_RECALL_CARDS_PER_SESSION),
      EXAM_PREP_NEW_CARDS_MIN,
      EXAM_PREP_NEW_CARDS_MAX,
    ),
    maxRecallCardsPerSession,
  );
  return {
    id: input.id,
    curriculumId: input.curriculumId,
    curriculumContentHash: input.curriculumContentHash,
    newRecallCardsPerSession,
    maxRecallCardsPerSession,
    updatedAt: input.updatedAt,
  };
};

export const createDefaultExamPrepSettings = (
  binding: ExamPrepCurriculumBinding,
  updatedAt: string,
): ExamPrepSettings =>
  normalizeExamPrepSettings({
    id: binding.curriculumContentHash,
    curriculumId: binding.curriculumId,
    curriculumContentHash: binding.curriculumContentHash,
    newRecallCardsPerSession: EXAM_PREP_DEFAULT_NEW_RECALL_CARDS_PER_SESSION,
    maxRecallCardsPerSession: EXAM_PREP_DEFAULT_MAX_RECALL_CARDS_PER_SESSION,
    updatedAt,
  });

export const isExamPrepSettingsForBinding = (
  record: ExamPrepSettings,
  binding: ExamPrepCurriculumBinding,
): boolean =>
  record.curriculumId === binding.curriculumId &&
  record.curriculumContentHash === binding.curriculumContentHash;

/** Resolves the effective session limits for the given binding. */
export const resolveExamPrepSettings = (
  records: ExamPrepSettings[],
  binding: ExamPrepCurriculumBinding,
  updatedAt: string,
): ExamPrepSettings => {
  const match = records.find((record) => isExamPrepSettingsForBinding(record, binding));
  if (match) return normalizeExamPrepSettings(match);
  return createDefaultExamPrepSettings(binding, updatedAt);
};
