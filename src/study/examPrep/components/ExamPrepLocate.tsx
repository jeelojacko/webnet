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
// Start copy is honest about scope: targets may be provision-pinned (390) or
// document-level (62), and the sprint samples the full exam curriculum.

import { useEffect, useState } from 'react';
import { Eye, GraduationCap, Timer } from 'lucide-react';
import { EXAM_PREP_DOCUMENT_TITLES } from '../examPrepDocTitles';
import { EXAM_PREP_OPEN_SOURCE_BUTTON } from './examPrepBits';
import { EXAM_PREP_LOCATE_TASKS } from '../examPrepLocateTasks';
import { buildExamPrepLocateQueue } from '../examPrepLocateQueue';
import { buildLocateAttempt } from '../examPrepAttemptBuilders';
import { examPrepProvisionLabel, formatExamDrillTime } from '../examPrepFormat';
import type { ExamPrepAttempt, ExamPrepLocateTask } from '../examPrepTypes';

export const EXAM_PREP_STATUTE_LIBRARY_PATH = '/study/library';

export type ExamPrepLocateViewProps = {
  attempts: ExamPrepAttempt[];
  onSaveExamPrepAttempt: (_attempt: ExamPrepAttempt) => Promise<void>;
  onOpenProvision: (_documentId: string, _sourceKey: string) => void;
  onNavigate: (_path: string) => void;
};

type LocatePhase = 'idle' | 'active' | 'done';

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

  const previewQueue = buildExamPrepLocateQueue(attempts);
  const item = phase === 'active' && session ? session[index] ?? null : null;

  // Item-level reset: a new frozen item starts its own timer and hides the
  // previous reveal. Parent-snapshot rerenders never touch these states.
  useEffect(() => {
    if (phase === 'active') {
      setElapsed(0);
      setChecked(false);
      setSavePending(false);
      setSaveError(null);
    }
  }, [item?.id, phase]);

  // Running timer while an item is active and not yet checked.
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
    if (!item || savePending) return;
    setChecked(true); // freezes the elapsed timer
    setSaveError(null);
  };

  const handleResult = async (result: 'found' | 'missed') => {
    if (!item || savePending) return;
    setSavePending(true);
    setSaveError(null);
    const attempt = buildLocateAttempt({
      attemptId: createAttemptId(item.id),
      task: item,
      result,
      elapsedSeconds: elapsed, // frozen at Check Answer
      completedAt: new Date().toISOString(),
    });
    try {
      await onSaveExamPrepAttempt(attempt);
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
      setSavePending(false);
    }
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
          {!checked ? (
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
                  onClick={() => {
                    const libraryWindow = window.open(
                      EXAM_PREP_STATUTE_LIBRARY_PATH,
                      '_blank',
                      'noopener,noreferrer',
                    );
                    if (!libraryWindow) setSaveError('Could not open the Statute Library.');
                  }}
                  className="rounded border border-sky-700 bg-sky-900 px-3 py-1.5 text-xs font-semibold text-sky-100 hover:bg-sky-800"
                >
                  Open Statute Library
                </button>
                <button
                  type="button"
                  onClick={handleCheckAnswer}
                  className="rounded border border-emerald-600 bg-emerald-900 px-3 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-800"
                >
                  Check Answer
                </button>
              </div>
            </>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-1.5 text-xs text-emerald-200/80">
                <Timer size={12} />
                Elapsed: {formatExamDrillTime(elapsed)}
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
                  onClick={() => void handleResult('found')}
                  className="rounded border border-emerald-600 bg-emerald-900 px-3 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-800"
                >
                  Found it
                </button>
                <button
                  type="button"
                  disabled={savePending}
                  onClick={() => void handleResult('missed')}
                  className="rounded border border-rose-700 bg-rose-900 px-3 py-1.5 text-xs font-semibold text-rose-100 hover:bg-rose-800"
                >
                  Missed it
                </button>
              </div>
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
      {!checked ? (
        <div className="flex items-center gap-1.5 text-[11px] text-slate-600">
          <Eye size={12} /> The expected document and provision stay hidden until Check Answer.
        </div>
      ) : null}
    </div>
  );
};
