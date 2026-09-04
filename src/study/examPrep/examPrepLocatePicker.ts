// Exam Prep Locate — ephemeral picker protocol (browser-only).
//
// The Locate sprint opens a NEW tab pointing at the Study Library with a
// `?studyPicker=locate&prompt=…&token=…` query. That picker tab shows only the
// frozen lookup prompt (NEVER the expected document/provision). When the
// learner selects a document or provision the picker tab posts a same-origin
// message back to the sprint tab (`window.opener.postMessage`); the sprint
// tab decides objectively whether the pick matches the frozen expected
// location and advances the frozen session. Nothing is persisted: no store,
// no snapshot field, no expected-answer leakage into the picker tab.
//
// The query string rides along on every in-tab history operation in the
// picker tab (hash-only replaces resolve against the current URL, preserving
// the search), so the context survives browsing from the Library into
// document readers and back.

import { STUDY_LIBRARY_PATH } from '../studyWindow';
import type { ExamPrepLocateTask } from './examPrepTypes';

export const EXAM_PREP_PICKER_KIND = 'locate';
export const EXAM_PREP_PICKER_PARAM = 'studyPicker';
export const EXAM_PREP_PICKER_TOKEN_PARAM = 'token';
export const EXAM_PREP_PICKER_PROMPT_PARAM = 'prompt';

/** Parse picker context from a `location.search` string, or null. */
export type ExamPrepLocatePickerContext = {
  kind: 'locate';
  prompt: string;
  token: string;
};

export const parseExamPrepLocatePickerSearch = (
  search: string,
): ExamPrepLocatePickerContext | null => {
  const params = new URLSearchParams(search);
  if (params.get(EXAM_PREP_PICKER_PARAM) !== EXAM_PREP_PICKER_KIND) return null;
  const prompt = params.get(EXAM_PREP_PICKER_PROMPT_PARAM) ?? '';
  const token = params.get(EXAM_PREP_PICKER_TOKEN_PARAM) ?? '';
  if (!prompt || !token) return null;
  return { kind: 'locate', prompt, token };
};

/** Nonce token guarding one Locate picker session. */
export const createExamPrepLocatePickerToken = (): string =>
  `locate-pick-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Path the sprint tab opens in the new tab (Library in picker mode). */
export const buildExamPrepLocatePickerPath = (prompt: string, token: string): string => {
  const params = new URLSearchParams({
    [EXAM_PREP_PICKER_PARAM]: EXAM_PREP_PICKER_KIND,
    [EXAM_PREP_PICKER_PROMPT_PARAM]: prompt,
    [EXAM_PREP_PICKER_TOKEN_PARAM]: token,
  });
  return `${STUDY_LIBRARY_PATH}?${params.toString()}`;
};

/** Same-origin pick message posted by the picker tab to the sprint tab. */
export type ExamPrepLocatePickMessage = {
  type: 'study-locate-pick';
  token: string;
  documentId: string;
  sourceKey: string | null;
};

export const isExamPrepLocatePickMessage = (value: unknown): value is ExamPrepLocatePickMessage => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.type === 'study-locate-pick' &&
    typeof candidate.token === 'string' &&
    typeof candidate.documentId === 'string' &&
    (typeof candidate.sourceKey === 'string' || candidate.sourceKey === null)
  );
};

/**
 * Objective correctness: a pick matches the frozen expected location when the
 * document matches AND either the expected target is document-level
 * (`expectedSourceKey === null`) or the picked sourceKey equals the pinned
 * provision exactly.
 */
export const locatePickMatchesExpected = (
  task: Pick<ExamPrepLocateTask, 'expectedDocumentId' | 'expectedSourceKey'>,
  pick: { documentId: string; sourceKey: string | null },
): boolean =>
  pick.documentId === task.expectedDocumentId &&
  (task.expectedSourceKey === null || pick.sourceKey === task.expectedSourceKey);

/** Posts a pick to the sprint tab that opened this picker tab. */
export const postExamPrepLocatePick = (
  token: string,
  documentId: string,
  sourceKey: string | null,
): boolean => {
  if (!window.opener || !window.opener.postMessage) return false;
  const message: ExamPrepLocatePickMessage = {
    type: 'study-locate-pick',
    token,
    documentId,
    sourceKey,
  };
  window.opener.postMessage(message, window.location.origin);
  return true;
};
