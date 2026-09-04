// Exam Prep — Locate Sprint view.
//
// Ten-question mixed sprints over the exact frozen mustLocate pool (452
// tasks: A 112 / B 140 / C 94 / D 12 / NAV 94; DRILL excluded). The sprint is
// frozen at Start. Each item starts an elapsed timer immediately and shows
// only the lookup prompt — the expected document/provision stay hidden until
// Check Answer freezes the time and reveals the exact location (deep-link to
// the provision when the frozen target pins one; document-level targets show
// only the statute title). Found it / Missed it persists one immutable
// attempt with the frozen elapsed seconds but never reshapes the session.
//
// The optional objective Locate picker runs in a NEW tab (opened with
// `noopener,noreferrer`) and returns selections over a token-scoped
// BroadcastChannel. A pick freezes the timer and shows the learner's
// selection beside the expected location BEFORE any persistence: Continue
// saves the immutable attempt (correct → `found`, incorrect → `missed`) and
// advances. Persistence failures keep the feedback on screen for retry, and
// the manual Check Answer → Found it / Missed it self-assessment stays as the
// always-available fallback.
//
// Start copy is honest about scope: targets may be provision-pinned (390) or
// document-level (62), and the sprint samples the full exam curriculum.

import { useEffect, useRef, useState } from 'react';
import { Eye, GraduationCap, Target, Timer } from 'lucide-react';
import { EXAM_PREP_DOCUMENT_TITLES } from '../examPrepDocTitles';
import { EXAM_PREP_OPEN_SOURCE_BUTTON } from './examPrepBits';
import { EXAM_PREP_LOCATE_TASKS } from '../examPrepLocateTasks';
import { buildExamPrepLocateQueue } from '../examPrepLocateQueue';
import { buildLocateAttempt } from '../examPrepAttemptBuilders';
import { examPrepProvisionLabel, formatExamDrillTime } from '../examPrepFormat';
import {
  buildExamPrepLocatePickerPath,
  createExamPrepLocatePickerToken,
  isExamPrepBroadcastChannelSupported,
  locatePickMatchesExpected,
  subscribeExamPrepLocatePicks,
} from '../examPrepLocatePicker';
import { openStudyUrlNewTab, STUDY_LIBRARY_PATH } from '../../studyWindow';
import type { ExamPrepAttempt, ExamPrepLocateTask } from '../examPrepTypes';

export type ExamPrepLocateViewProps = {
  attempts: ExamPrepAttempt[];
  onSaveExamPrepAttempt: (_attempt: ExamPrepAttempt) => Promise<void>;
  onOpenProvision: (_documentId: string, _sourceKey: string) => void;
  onNavigate: (_path: string) => void;
};

type LocatePhase = 'idle' | 'active' | 'done';

/** Learner's objective picker selection, held until Continue persists it. */
type ObjectivePickFeedback = {
  documentId: string;
  sourceKey: string | null;
  correct: boolean;
} | null;

type PickerStatus = 'open' | 'unsupported' | null;

const createAttemptId = (taskId: string): string =>
  `locate-attempt-${taskId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const ExamPrepLocateView = ({
  attempts,
  onSaveExamPrepAttempt,
  onOpenProvision,
  onNavigate,
}: ExamPrepLocateViewProps) => {
  const [phase, setPhase] = useState<LocatePhase>('idle');
  const [session, setSession] = useState<ExamPrepLocateTask[] | null>(null);
  const [index, setIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [checked, setChecked] = useState(false);
  const [savePending, setSavePending] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [sessionFound, setSessionFound] = useState(0);
  // Ephemeral Locate picker handoff: nonce token of the picker tab opened for
  // the CURRENT un-checked item. Picks on the token-scoped channel are matched
  // against it; a stale picker tab from a previous item can never win.
  const [pickerToken, setPickerToken] = useState<string | null>(null);
  // What the learner picked (objective path). Persisted ONLY on Continue.
  const [objectiveFeedback, setObjectiveFeedback] = useState<ObjectivePickFeedback>(null);
  const [pickerStatus, setPickerStatus] = useState<PickerStatus>(null);
  const savePendingRef = useRef(savePending);
  savePendingRef.current = savePending;
  const checkedRef = useRef(checked);
  checkedRef.current = checked;
  // Guards the objective-pick path: one valid pick per item is consumed
  // synchronously, so duplicate channel deliveries can never double-apply
  // even before the state update that closes the channel re-renders.
  const pickerConsumedRef = useRef(false);
  const objectiveInFlightRef = useRef(false);

  const previewQueue = buildExamPrepLocateQueue(attempts);
  const item = phase === 'active' && session ? session[index] ?? null : null;

  // Item-level reset: a new frozen item starts its own timer and hides the
  // previous reveal/feedback. Parent-snapshot rerenders never touch these.
  useEffect(() => {
    if (phase === 'active') {
      setElapsed(0);
      setChecked(false);
      setSavePending(false);
      setSaveError(null);
      setObjectiveFeedback(null);
      setPickerToken(null);
      setPickerStatus(null);
      pickerConsumedRef.current = false;
    }
  }, [item?.id, phase]);

  // Running timer while an item is active and not yet answered (manual Check
  // Answer or an objective pick both freeze it).
  useEffect(() => {
    if (!item || checked) return;
    const handle = window.setInterval(() => setElapsed((seconds) => seconds + 1), 1000);
    return () => window.clearInterval(handle);
  }, [item, checked]);

  const freezeSession = () => {
    setSession(previewQueue);
    setIndex(0);
    setSessionFound(0);
    setElapsed(0);
    setChecked(false);
    setSaveError(null);
    setPickerToken(null);
    setPickerStatus(null);
    setObjectiveFeedback(null);
    pickerConsumedRef.current = false;
    objectiveInFlightRef.current = false;
    setPhase('active');
  };

  const handleStart = () => {
    if (phase !== 'idle' || previewQueue.length === 0) return;
    freezeSession();
  };

  const handleStartAnother = () => {
    if (phase !== 'done' || previewQueue.length === 0) return;
    freezeSession();
  };

  const handleCheckAnswer = () => {
    if (!item || savePending || objectiveFeedback) return;
    // Manual Check Answer closes the picker channel too: an objective pick
    // that arrives after a manual reveal must never double-answer the item.
    setPickerToken(null);
    setPickerStatus(null);
    pickerConsumedRef.current = true;
    setChecked(true); // freezes the elapsed timer
    setSaveError(null);
  };

  /**
   * Opens the ephemeral Locate picker for the current un-checked item. The
   * tab is opened with `noopener,noreferrer`, so `window.open` gives back no
   * handle whether or not the tab opened — we never claim popup failure from a
   * null WindowProxy; only a real synchronous exception is surfaced.
   */
  const handleOpenPicker = () => {
    if (!item || savePending || objectiveFeedback) return;
    const token = createExamPrepLocatePickerToken();
    const result = openStudyUrlNewTab(buildExamPrepLocatePickerPath(item.prompt, token));
    if (!result.attempted) {
      setSaveError('The Locate picker could not be opened. Use Check Answer instead.');
      return;
    }
    setSaveError(null);
    pickerConsumedRef.current = false;
    objectiveInFlightRef.current = false;
    if (!isExamPrepBroadcastChannelSupported()) {
      // Graceful fallback: the picker tab still opens for browsing, but its
      // selections cannot return automatically. Manual Check Answer remains.
      setPickerStatus('unsupported');
      return;
    }
    setPickerToken(token);
    setPickerStatus('open');
  };

  /**
   * Objective pick arrived from the ephemeral picker tab over the
   * token-scoped BroadcastChannel. Freeze the timer, compare the selection
   * against the frozen expected location, and SHOW the feedback — nothing is
   * persisted and the sprint does not advance until the learner presses
   * Continue.
   */
  const handleObjectivePick = (message: {
    documentId: string;
    sourceKey: string | null;
  }) => {
    if (!item || savePendingRef.current || checkedRef.current || pickerConsumedRef.current)
      return;
    if (objectiveInFlightRef.current) return;
    objectiveInFlightRef.current = true;
    try {
      pickerConsumedRef.current = true;
      setPickerToken(null);
      setPickerStatus(null);
      setChecked(true); // freezes the elapsed timer
      setObjectiveFeedback({
        documentId: message.documentId,
        sourceKey: message.sourceKey,
        correct: locatePickMatchesExpected(item, message),
      });
      setSaveError(null);
    } finally {
      objectiveInFlightRef.current = false;
    }
  };

  // Listen on the token-scoped channel only while an item is active with an
  // open picker tab. The effect cleanup closes the channel on token change,
  // item change, sprint end, and unmount, so stale picker tabs from earlier
  // items can never affect the sprint.
  useEffect(() => {
    if (phase !== 'active' || !item || !pickerToken) return;
    return subscribeExamPrepLocatePicks(pickerToken, (message) => {
      handleObjectivePick(message);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, phase, pickerToken]);

  /**
   * Persists the immutable locate attempt (frozen elapsed time) and only then
   * advances through the FROZEN session. Used by both the objective Continue
   * button and the manual Found it / Missed it buttons. On failure the current
   * screen (feedback or manual reveal) stays visible for retry.
   */
  const persistAndAdvance = async (result: 'found' | 'missed') => {
    if (!item || savePending || objectiveInFlightRef.current) return;
    objectiveInFlightRef.current = true;
    setSavePending(true);
    setSaveError(null);
    const attempt = buildLocateAttempt({
      attemptId: createAttemptId(item.id),
      task: item,
      result,
      elapsedSeconds: elapsed, // frozen at Check Answer / objective pick
      completedAt: new Date().toISOString(),
    });
    try {
      await onSaveExamPrepAttempt(attempt);
      setPickerToken(null);
      setPickerStatus(null);
      setObjectiveFeedback(null);
      pickerConsumedRef.current = true;
      // advance through the FROZEN session only
      if (result === 'found') setSessionFound((count) => count + 1);
      const nextIndex = index + 1;
      if (session && nextIndex >= session.length) setPhase('done');
      else setIndex(nextIndex);
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : 'The locate result could not be saved. Try again.',
      );
    } finally {
      objectiveInFlightRef.current = false;
      setSavePending(false);
    }
  };

  /** Objective path: Continue persists the shown pick result and advances. */
  const handleObjectiveContinue = () => {
    if (!objectiveFeedback || savePending) return;
    void persistAndAdvance(objectiveFeedback.correct ? 'found' : 'missed');
  };

  const finish = phase === 'done' && session ? session.length : 0;

  if (phase === 'done') {
    const hasNextCandidates = previewQueue.length > 0;
    return (
      <div className="space-y-3">
        <section className="rounded border border-emerald-800 bg-emerald-950 p-4">
          <GraduationCap className="mb-2 text-emerald-400" size={20} />
          <p className="font-semibold text-white">Locate Sprint complete</p>
          <p className="mt-1 text-xs text-slate-400">
            {`Found: ${sessionFound} / ${finish}`}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {hasNextCandidates ? (
              <button
                type="button"
                onClick={handleStartAnother}
                className="rounded border border-emerald-600 bg-emerald-900 px-3 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-800"
              >
                Start Another Sprint
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => onNavigate('/study/learn')}
              className="rounded border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
            >
              Browse Learn units
            </button>
          </div>
        </section>
      </div>
    );
  }

  if (phase === 'idle') {
    if (previewQueue.length === 0) {
      return (
        <div className="space-y-3">
          <section className="rounded border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-300">
            <GraduationCap className="mb-2 text-emerald-400" size={20} />
            <p className="font-semibold text-white">No locate targets are available.</p>
          </section>
        </div>
      );
    }
    return (
      <div className="space-y-3">
        <section className="rounded border border-emerald-800 bg-emerald-950 p-4">
          <GraduationCap className="mb-2 text-emerald-400" size={20} />
          <p className="font-semibold text-white">Locate Sprint</p>
          <div className="mt-1 space-y-1 text-xs text-slate-400">
            <p>{`${previewQueue.length} questions.`}</p>
            <p>Practice finding the correct statute or controlling provision.</p>
            <p>The answer remains hidden until Check Answer.</p>
            <p>This sprint samples the full exam curriculum.</p>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleStart}
              className="rounded border border-emerald-600 bg-emerald-900 px-3 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-800"
            >
              Start Locate Sprint
            </button>
            <button
              type="button"
              onClick={() => onNavigate('/study/learn')}
              className="rounded border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
            >
              Browse Learn units
            </button>
          </div>
        </section>
      </div>
    );
  }

  const selectionDocumentTitle = objectiveFeedback
    ? (EXAM_PREP_DOCUMENT_TITLES[objectiveFeedback.documentId] ?? objectiveFeedback.documentId)
    : '';

  return (
    <div className="space-y-3">
      <section className="rounded border border-emerald-800 bg-emerald-950 p-4">
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <span className="rounded bg-slate-800 px-2 py-1">
            Question {index + 1} of {session?.length ?? 0}
          </span>
          <span className="rounded bg-slate-800 px-2 py-1">Found so far: {sessionFound}</span>
        </div>
        <div className="mt-3 space-y-2">
          {!checked && !objectiveFeedback ? (
            <>
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-400">
                Find
              </p>
              <p className="locate-prompt rounded border border-slate-700 bg-slate-900 p-3 text-sm text-emerald-100">
                {item?.prompt}
              </p>
              <div className="flex items-center gap-1.5 text-xs text-emerald-200/80">
                <Timer size={12} />
                Elapsed: {formatExamDrillTime(elapsed)}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleOpenPicker}
                  className="inline-flex items-center gap-1.5 rounded border border-emerald-600 bg-emerald-900 px-3 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-800"
                >
                  <Target size={13} />
                  Open Locate Picker
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void openStudyUrlNewTab(STUDY_LIBRARY_PATH);
                  }}
                  className="rounded border border-sky-700 bg-sky-900 px-3 py-1.5 text-xs font-semibold text-sky-100 hover:bg-sky-800"
                >
                  Open Statute Library
                </button>
                <button
                  type="button"
                  onClick={handleCheckAnswer}
                  className="rounded border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
                >
                  Check Answer
                </button>
              </div>
              {pickerStatus === 'open' ? (
                <p className="text-[11px] italic text-slate-500">
                  Locate picker opened in a new tab. Your selection is checked automatically when
                  you choose a document or provision there — then Continue here.
                </p>
              ) : null}
              {pickerStatus === 'unsupported' ? (
                <p className="text-[11px] italic text-amber-300/80">
                  Automatic answer return is unavailable in this browser. Browse the statute
                  library and use Check Answer here when you are ready.
                </p>
              ) : null}
            </>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-1.5 text-xs text-emerald-200/80">
                <Timer size={12} />
                Elapsed: {formatExamDrillTime(elapsed)}
              </div>
              {objectiveFeedback ? (
                <>
                  <div
                    className={`rounded border p-3 ${
                      objectiveFeedback.correct
                        ? 'border-emerald-700/70 bg-emerald-950/40'
                        : 'border-rose-800/70 bg-rose-950/40'
                    }`}
                  >
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">
                      Your selection
                    </p>
                    <p className="mt-1 text-sm text-white">{selectionDocumentTitle}</p>
                    {objectiveFeedback.sourceKey ? (
                      <p className="mt-0.5 font-mono text-xs text-sky-300">
                        {examPrepProvisionLabel(objectiveFeedback.sourceKey)}
                      </p>
                    ) : (
                      <p className="mt-0.5 text-[11px] italic text-slate-400">
                        Document-level selection
                      </p>
                    )}
                    <p
                      className={`mt-2 text-sm font-semibold ${
                        objectiveFeedback.correct ? 'text-emerald-300' : 'text-rose-300'
                      }`}
                    >
                      {objectiveFeedback.correct ? 'Correct location' : 'Not quite'}
                    </p>
                  </div>
                  <div className="rounded border border-sky-900/60 bg-sky-950/40 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-sky-300">
                      Expected location
                    </p>
                    <p className="mt-1 text-sm text-white">
                      {EXAM_PREP_DOCUMENT_TITLES[item?.expectedDocumentId ?? ''] ??
                        item?.expectedDocumentId}
                      {item?.expectedSourceKey ? (
                        <span className="ml-1.5 font-mono text-xs text-sky-300">
                          {examPrepProvisionLabel(item.expectedSourceKey)}
                        </span>
                      ) : null}
                    </p>
                    {item?.expectedSourceKey ? (
                      <div className="mt-2">
                        <EXAM_PREP_OPEN_SOURCE_BUTTON
                          documentId={item.expectedDocumentId}
                          sourceKey={item.expectedSourceKey}
                          label={`Open exact provision · ${examPrepProvisionLabel(item.expectedSourceKey)}`}
                          onOpenProvision={onOpenProvision}
                          newTab
                        />
                      </div>
                    ) : (
                      <p className="mt-1 text-[11px] italic text-slate-500">
                        Document-level target — no single provision is pinned in the curriculum.
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={savePending}
                    onClick={handleObjectiveContinue}
                    className="rounded border border-emerald-600 bg-emerald-900 px-3 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-800"
                  >
                    Continue
                  </button>
                </>
              ) : (
                <>
                  <div className="rounded border border-sky-900/60 bg-sky-950/40 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-sky-300">
                      Expected location
                    </p>
                    <p className="mt-1 text-sm text-white">
                      {EXAM_PREP_DOCUMENT_TITLES[item?.expectedDocumentId ?? ''] ??
                        item?.expectedDocumentId}
                      {item?.expectedSourceKey ? (
                        <span className="ml-1.5 font-mono text-xs text-sky-300">
                          {examPrepProvisionLabel(item.expectedSourceKey)}
                        </span>
                      ) : null}
                    </p>
                    {item?.expectedSourceKey ? (
                      <div className="mt-2">
                        <EXAM_PREP_OPEN_SOURCE_BUTTON
                          documentId={item.expectedDocumentId}
                          sourceKey={item.expectedSourceKey}
                          label={`Open exact provision · ${examPrepProvisionLabel(item.expectedSourceKey)}`}
                          onOpenProvision={onOpenProvision}
                          newTab
                        />
                      </div>
                    ) : (
                      <p className="mt-1 text-[11px] italic text-slate-500">
                        Document-level target — no single provision is pinned in the curriculum.
                      </p>
                    )}
                  </div>
                  <p className="text-xs italic text-slate-400">
                    Did you have the correct location?
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={savePending}
                      onClick={() => void persistAndAdvance('found')}
                      className="rounded border border-emerald-600 bg-emerald-900 px-3 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-800"
                    >
                      Found it
                    </button>
                    <button
                      type="button"
                      disabled={savePending}
                      onClick={() => void persistAndAdvance('missed')}
                      className="rounded border border-rose-700 bg-rose-900 px-3 py-1.5 text-xs font-semibold text-rose-100 hover:bg-rose-800"
                    >
                      Missed it
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </section>
      {saveError ? (
        <div
          role="alert"
          className="rounded border border-rose-900/60 bg-rose-950/40 p-2 text-xs text-rose-200"
        >
          {saveError}
        </div>
      ) : null}
      {!checked && !objectiveFeedback ? (
        <div className="flex items-center gap-1.5 text-[11px] text-slate-600">
          <Eye size={12} /> The expected document and provision stay hidden until Check Answer.
        </div>
      ) : null}
    </div>
  );
};
