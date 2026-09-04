// Exam Prep Mock — focused answering UI for an in-progress mock.
//
// Deadline-based timer (derived from the persisted deadline, never stored
// remaining time), free-text responses, flag/visited palette, hard-stop
// expiry lock, submit/abandon confirmations and CAS-serialized debounced
// autosave. Only the question's own frozen prompt text is rendered here;
// expected answers resolve AFTER submission in the grading view.

import { useEffect, useRef, useState } from 'react';
import { Flag, Timer } from 'lucide-react';
import { formatExamMockClock, EXAM_PREP_MOCK_KIND_LABELS } from '../examPrepFormat';
import { openStudyUrlNewTab, STUDY_LIBRARY_PATH } from '../../studyWindow';
import {
  markMockVisited,
  setMockAnswer,
  setMockCurrentIndex,
  setMockFlagged,
  submitMock,
  abandonMock,
} from '../mock/examPrepMockSession';
import { examPrepMockQuestionPromptText } from '../mock/examPrepMockQuestionPrompt';
import {
  isMockExpired,
  mockAnsweredCount,
  mockFlaggedCount,
  mockRemainingSeconds,
  mockUnansweredCount,
} from '../mock/examPrepMockResults';
import type {
  ExamPrepMockSession,
  ExamPrepMockSessionExpectation,
} from '../mock/examPrepMockTypes';

export type SaveExamPrepMockSession = (
  _session: ExamPrepMockSession,
  _expectation: ExamPrepMockSessionExpectation,
) => Promise<void>;

export type ExamPrepMockActiveProps = {
  session: ExamPrepMockSession;
  onSaveSession: SaveExamPrepMockSession;
  onNavigate: (_path: string) => void;
  autosaveDebounceMs?: number;
};

type SaveState = 'saved' | 'saving' | 'error';

const nowIso = (): string => new Date().toISOString();

export const ExamPrepMockActive = ({
  session,
  onSaveSession,
  onNavigate,
  autosaveDebounceMs = 750,
}: ExamPrepMockActiveProps) => {
  const [draft, setDraft] = useState<ExamPrepMockSession>(session);
  const [clockNowMs, setClockNowMs] = useState(() => Date.now());
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmingSubmit, setConfirmingSubmit] = useState(false);
  const [confirmingAbandon, setConfirmingAbandon] = useState(false);

  const lastSavedRef = useRef<ExamPrepMockSession>(session);
  const latestRef = useRef<ExamPrepMockSession>(session);
  const dirtyRef = useRef(false);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const debounceRef = useRef<number | undefined>(undefined);
  const savingRef = useRef(false);

  useEffect(() => {
    const handle = window.setInterval(() => setClockNowMs(Date.now()), 1000);
    return () => window.clearInterval(handle);
  }, []);

  useEffect(
    () => () => {
      if (debounceRef.current !== undefined) window.clearTimeout(debounceRef.current);
    },
    [],
  );

  const applyChange = (next: ExamPrepMockSession) => {
    latestRef.current = next;
    dirtyRef.current = true;
    setDraft(next);
    if (debounceRef.current !== undefined) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      void flushQueue();
    }, autosaveDebounceMs);
  };

  /** Runs until the local draft matches the last persisted session. */
  const flushQueue = (): Promise<void> => {
    if (savingRef.current) return queueRef.current;
    savingRef.current = true;
    queueRef.current = queueRef.current.then(async () => {
      for (;;) {
        if (!dirtyRef.current) return;
        setSaveState('saving');
        setSaveError(null);
        const candidate = latestRef.current;
        const persisted = { ...candidate, updatedAt: nowIso() };
        try {
          await onSaveSession(persisted, {
            kind: 'existing',
            updatedAt: lastSavedRef.current.updatedAt,
          });
        } catch (error) {
          setSaveState('error');
          setSaveError(
            error instanceof Error
              ? error.message
              : 'This mock session could not be saved. Reload to resume the latest saved version.',
          );
          return;
        }
        lastSavedRef.current = persisted;
        // A revision typed while this save was in flight must never be
        // clobbered: keep it dirty and save it next instead of resetting the
        // flag and overwriting the draft with the (older) persisted copy.
        if (latestRef.current !== candidate) continue;
        dirtyRef.current = false;
        setDraft(persisted);
        setSaveState('saved');
        setSaveError(null);
        return;
      }
    });
    return queueRef.current.finally(() => {
      savingRef.current = false;
    });
  };

  const currentIndex = draft.currentQuestionIndex;
  const question = draft.questions[currentIndex];
  const response = question
    ? draft.responses.find((entry) => entry.questionId === question.questionId)
    : undefined;
  const total = draft.questions.length;
  const expired = isMockExpired(draft, clockNowMs);
  const remainingSeconds = mockRemainingSeconds(draft, clockNowMs);
  const answerValue = response?.answer ?? '';

  const navigateQuestion = (index: number) => {
    if (index < 0 || index >= total || index === currentIndex) return;
    const base = latestRef.current;
    const target = base.questions[index];
    if (!target) return;
    const marked = markMockVisited(base, target.questionId, nowIso());
    applyChange(setMockCurrentIndex(marked, index, nowIso()));
  };

  const changeAnswer = (value: string) => {
    if (expired || !question) return;
    const base = latestRef.current;
    const current = base.questions[currentIndex];
    if (!current) return;
    applyChange(setMockAnswer(base, current.questionId, value, nowIso()));
  };

  const toggleFlag = () => {
    if (expired || !question) return;
    const base = latestRef.current;
    const current = base.questions[currentIndex];
    if (!current) return;
    const flagged = Boolean(
      base.responses.find((entry) => entry.questionId === current.questionId)?.flagged,
    );
    applyChange(setMockFlagged(base, current.questionId, !flagged, nowIso()));
  };

  const exitForLater = async () => {
    await flushQueue();
    onNavigate('/study/exam-prep');
  };

  const confirmSubmit = async () => {
    setConfirmingSubmit(false);
    try {
      await flushQueue();
      const base = lastSavedRef.current;
      const submitted = submitMock(base, nowIso());
      await onSaveSession(submitted, {
        kind: 'existing',
        updatedAt: lastSavedRef.current.updatedAt,
      });
      lastSavedRef.current = submitted;
      dirtyRef.current = false;
      setSaveState('saved');
      setSaveError(null);
    } catch (error) {
      // Session is still in_progress: keep the dialog closed but surface the
      // failure and leave the answering state fully intact for retry.
      setSaveState('error');
      setSaveError(
        error instanceof Error
          ? error.message
          : 'This mock session could not be submitted. Try again or reload to resume the latest saved version.',
      );
    }
  };

  const confirmAbandon = async () => {
    setConfirmingAbandon(false);
    try {
      await flushQueue();
      const base = lastSavedRef.current;
      const abandoned = abandonMock(base, nowIso());
      await onSaveSession(abandoned, {
        kind: 'existing',
        updatedAt: lastSavedRef.current.updatedAt,
      });
      lastSavedRef.current = abandoned;
      dirtyRef.current = false;
      setSaveState('saved');
      setSaveError(null);
    } catch (error) {
      setSaveState('error');
      setSaveError(
        error instanceof Error
          ? error.message
          : 'This mock session could not be abandoned. Try again or reload to resume the latest saved version.',
      );
    }
  };

  const kindLabel = question ? EXAM_PREP_MOCK_KIND_LABELS[question.kind] : '';
  const promptText = question ? examPrepMockQuestionPromptText(question) : '';
  const saveIndicator =
    saveState === 'saving' ? (
      <span className="text-amber-300">Saving…</span>
    ) : saveState === 'error' ? (
      <span className="text-rose-300">Save failed</span>
    ) : (
      <span className="text-slate-500">Saved</span>
    );

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">
            Exam Prep · {draft.profileSnapshot.title}
          </div>
          <div className="mt-1 flex items-center gap-2 text-sm font-semibold text-white">
            Question {currentIndex + 1} of {total}
            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-300">
              {kindLabel}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="flex items-center gap-1 rounded bg-slate-800 px-2 py-1 font-mono text-emerald-200">
            <Timer size={12} />
            {expired ? '00:00:00' : formatExamMockClock(remainingSeconds)} left
          </span>
          {saveIndicator}
          <button
            type="button"
            onClick={() => void exitForLater()}
            className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-slate-200 hover:bg-slate-700"
          >
            Exit / Save for later
          </button>
          <button
            type="button"
            onClick={() => setConfirmingAbandon(true)}
            className="rounded border border-rose-900 bg-rose-950 px-2 py-1 text-rose-200 hover:bg-rose-900"
          >
            Abandon
          </button>
        </div>
      </header>

      {saveError ? (
        <div
          role="alert"
          className="rounded border border-rose-900/60 bg-rose-950/40 p-2 text-xs text-rose-200"
        >
          {saveError}
        </div>
      ) : null}

      {expired ? (
        <section className="rounded border border-amber-800 bg-amber-950/40 p-3 text-xs text-amber-100">
          <p className="font-semibold">Time expired.</p>
          <p className="mt-0.5 text-amber-200/80">Responses are locked.</p>
          <p className="mt-0.5 text-amber-200/60">
            On reload this session remains locked. Submit when you are ready to self-grade.
          </p>
        </section>
      ) : null}

      <section className="rounded border border-slate-800 bg-slate-900/70 p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-400">
          {kindLabel || 'Question'}
        </p>
        <div className="mt-2 space-y-2 whitespace-pre-wrap text-sm text-slate-100">
          {promptText}
        </div>
        <textarea
          value={answerValue}
          disabled={expired}
          onChange={(event) => changeAnswer(event.target.value)}
          className="mt-3 w-full rounded border border-slate-700 bg-slate-900 p-2 text-sm text-slate-200 disabled:opacity-60"
          rows={5}
          placeholder="Your answer..."
        />
        <div className="mt-2 flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={response?.flagged ?? false}
              disabled={expired}
              onChange={toggleFlag}
            />
            <Flag size={12} className="text-amber-300" />
            Flag for review
          </label>
          {saveError ? null : (
            <span className="text-[11px] text-slate-600">Answers autosave locally.</span>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            disabled={currentIndex === 0}
            onClick={() => navigateQuestion(currentIndex - 1)}
            className="rounded border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Previous
          </button>
          <div className="flex items-center gap-2">
            {draft.profileSnapshot.resources.builtInStatuteLibrary ? (
              <button
                type="button"
                onClick={() => {
                  // noopener/noreferrer gives back no window handle, so a null
                  // WindowProxy is not a popup failure — only a synchronous
                  // exception is surfaced.
                  const opened = openStudyUrlNewTab(STUDY_LIBRARY_PATH);
                  if (!opened.attempted) {
                    setSaveError('The Statute Library could not be opened.');
                  }
                }}
                className="rounded border border-sky-700 bg-sky-900 px-3 py-1.5 text-xs font-semibold text-sky-100 hover:bg-sky-800"
              >
                Open Statute Library
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setConfirmingSubmit(true)}
              className="rounded border border-emerald-600 bg-emerald-900 px-3 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-800"
            >
              Submit Mock Exam
            </button>
          </div>
          <button
            type="button"
            disabled={currentIndex >= total - 1}
            onClick={() => navigateQuestion(currentIndex + 1)}
            className="rounded border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </section>

      <MockPalette session={draft} currentIndex={currentIndex} onSelect={navigateQuestion} />

      {confirmingSubmit ? (
        <MockConfirmDialog
          title="Submit Mock Exam?"
          answered={mockAnsweredCount(draft)}
          unanswered={mockUnansweredCount(draft)}
          flagged={mockFlaggedCount(draft)}
          note="You will not be able to edit responses after submission."
          confirmLabel="Submit Exam"
          onConfirm={() => void confirmSubmit()}
          onCancel={() => setConfirmingSubmit(false)}
        />
      ) : null}

      {confirmingAbandon ? (
        <MockConfirmDialog
          title="Abandon this mock exam?"
          note="Your saved responses will remain in history, but the exam will not receive a score."
          confirmLabel="Abandon Mock Exam"
          danger
          onConfirm={() => void confirmAbandon()}
          onCancel={() => setConfirmingAbandon(false)}
        />
      ) : null}
    </div>
  );
};

const MockPalette = ({
  session,
  currentIndex,
  onSelect,
}: {
  session: ExamPrepMockSession;
  currentIndex: number;
  onSelect: (_index: number) => void;
}) => (
  <div className="flex flex-wrap gap-1.5">
    {session.questions.map((question, index) => {
      const response = session.responses.find((entry) => entry.questionId === question.questionId);
      const answered = Boolean(response && response.answer.trim() !== '');
      const flagged = response?.flagged ?? false;
      const visited = response?.visited ?? false;
      const stateClass = index === currentIndex
        ? 'border-emerald-500 bg-emerald-900 text-emerald-50'
        : flagged
          ? 'border-amber-700 bg-amber-950 text-amber-100'
          : answered
            ? 'border-emerald-800 bg-emerald-950 text-emerald-200'
            : visited
              ? 'border-slate-600 bg-slate-800 text-slate-200'
              : 'border-slate-800 bg-slate-900 text-slate-500';
      return (
        <button
          key={question.questionId}
          type="button"
          onClick={() => onSelect(index)}
          title={`${question.questionId}${flagged ? ' · flagged' : ''}`}
          className={`h-8 w-8 rounded border text-xs ${stateClass}`}
        >
          {index + 1}
        </button>
      );
    })}
  </div>
);

const MockConfirmDialog = ({
  title,
  answered,
  unanswered,
  flagged,
  note,
  confirmLabel,
  onConfirm,
  onCancel,
  danger = false,
}: {
  title: string;
  answered?: number;
  unanswered?: number;
  flagged?: number;
  note: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
}) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
    <div className="w-full max-w-md rounded border border-slate-700 bg-slate-900 p-4 shadow-xl">
      <h3 className="text-sm font-semibold text-white">{title}</h3>
      {answered !== undefined ? (
        <div className="mt-2 space-y-1 text-xs text-slate-300">
          <p>Answered: {answered} / {answered + (unanswered ?? 0)}</p>
          <p>Unanswered: {unanswered}</p>
          <p>Flagged: {flagged}</p>
        </div>
      ) : null}
      <p className="mt-2 text-xs italic text-slate-400">{note}</p>
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
        >
          Keep Working
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className={`rounded px-3 py-1.5 text-xs font-semibold ${
            danger
              ? 'border border-rose-700 bg-rose-900 text-rose-100 hover:bg-rose-800'
              : 'border border-emerald-600 bg-emerald-900 text-emerald-100 hover:bg-emerald-800'
          }`}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  </div>
);
