// Exam Prep Locate — ephemeral picker protocol (browser-only).
//
// The Locate sprint opens a NEW tab pointing at the Study Library with a
// `?studyPicker=locate&prompt=…&token=…` query. That picker tab shows only the
// frozen lookup prompt (NEVER the expected document/provision). When the
// learner selects a document or provision the picker tab posts a
// token-scoped BroadcastChannel message
// (`webnet-study-locate-picker:<token>`); the sprint tab decides objectively
// whether the pick matches the frozen expected location and presents the
// result to the learner. BroadcastChannel (never `window.opener`) is the
// transport because the sprint opens the picker with `noopener,noreferrer`,
// which deliberately removes any reverse window reference. Nothing is
// persisted: no store, no snapshot field, and no expected-answer data ever
// enters the picker URL or the channel (the channel name carries only the
// random session token).
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

/** BroadcastChannel namespace shared by one sprint tab + one picker tab. */
export const EXAM_PREP_PICKER_CHANNEL_PREFIX = 'webnet-study-locate-picker';

export const EXAM_PREP_PICK_MESSAGE_TYPE = 'study-locate-pick';

/** Same-origin pick message posted by the picker tab to the sprint tab. */
export type ExamPrepLocatePickMessage = {
  type: typeof EXAM_PREP_PICK_MESSAGE_TYPE;
  token: string;
  documentId: string;
  sourceKey: string | null;
};

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

/** True when the browser provides BroadcastChannel (modern target browsers). */
export const isExamPrepBroadcastChannelSupported = (): boolean =>
  typeof BroadcastChannel !== 'undefined';

/**
 * Token-scoped channel name. The token is random and ephemeral — it never
 * carries any answer/document data, so channel names cannot leak the
 * expected location.
 */
export const examPrepLocatePickerChannelName = (token: string): string =>
  `${EXAM_PREP_PICKER_CHANNEL_PREFIX}:${token}`;

export const isExamPrepLocatePickMessage = (value: unknown): value is ExamPrepLocatePickMessage => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.type === EXAM_PREP_PICK_MESSAGE_TYPE &&
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

export type ExamPrepLocatePickPostResult = 'sent' | 'unsupported' | 'error';

/**
 * Posts a pick from the picker tab over the token-scoped BroadcastChannel.
 *
 * BroadcastChannel messages are fire-and-forget across same-origin tabs, so
 * `'sent'` means the channel accepted the message — it cannot confirm the
 * sprint tab is listening (the learner can always fall back to Check Answer
 * in the sprint tab). Browsers without BroadcastChannel return
 * `'unsupported'` so the picker can explain the manual fallback.
 */
export const postExamPrepLocatePick = (
  token: string,
  documentId: string,
  sourceKey: string | null,
): ExamPrepLocatePickPostResult => {
  if (!isExamPrepBroadcastChannelSupported()) return 'unsupported';
  try {
    const channel = new BroadcastChannel(examPrepLocatePickerChannelName(token));
    try {
      channel.postMessage({
        type: EXAM_PREP_PICK_MESSAGE_TYPE,
        token,
        documentId,
        sourceKey,
      });
    } finally {
      channel.close();
    }
    return 'sent';
  } catch {
    return 'error';
  }
};

/**
 * Subscribes the sprint tab to picks for one token-scoped channel. Returns a
 * cleanup that removes the listener and closes the channel — call it when the
 * item changes, the sprint ends, or the component unmounts so stale picker
 * tabs from earlier questions can never affect the sprint. Wrong-token and
 * malformed messages are ignored.
 */
export const subscribeExamPrepLocatePicks = (
  token: string,
  onPick: (_pick: ExamPrepLocatePickMessage) => void,
): (() => void) => {
  if (!isExamPrepBroadcastChannelSupported()) return () => undefined;
  try {
    const channel = new BroadcastChannel(examPrepLocatePickerChannelName(token));
    channel.onmessage = (event: MessageEvent) => {
      const pick = event.data;
      if (!isExamPrepLocatePickMessage(pick)) return;
      if (pick.token !== token) return;
      onPick(pick);
    };
    return () => {
      channel.onmessage = null;
      try {
        channel.close();
      } catch {
        // closing an already-closed channel is a no-op in practice
      }
    };
  } catch {
    return () => undefined;
  }
};
