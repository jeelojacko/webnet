// Exam Prep — Recognition Sprint view.
//
// Ten-question mixed sprints over the frozen recognition-cue pool
// (317 tasks derived from A-D/NAV recognitionCues; DRILL excluded). The
// sprint is frozen at Start: each Got it / Missed it persists one immutable
// attempt but never refills or reshapes the running session. A cue shows ONLY
// the frozen cue before Reveal — the expected curriculum unit identity (unit
// id, not the internal `recognition:…` task id) and source documents are
// hidden until the learner reveals. Persistence failures keep the revealed
// card, the typed answer, and the question index so the learner can retry.

import { useState } from 'react';
import { Eye, GraduationCap } from 'lucide-react';
import { EXAM_PREP_DOCUMENT_TITLES } from '../examPrepDocTitles';
import { EXAM_PREP_RECOGNITION_ASK, EXAM_PREP_RECOGNITION_PRACTICE_COPY } from '../examPrepConstants';
import { EXAM_PREP_RECOGNITION_TASKS } from '../examPrepRecognitionTasks';
import { buildExamPrepRecognitionQueue } from '../examPrepRecognitionQueue';
import { buildRecognitionAttempt } from '../examPrepAttemptBuilders';
import { examPrepTierLabel } from '../examPrepFormat';
import type { ExamPrepAttempt, ExamPrepRecognitionTask } from '../examPrepTypes';

export type ExamPrepRecognitionViewProps = {
  attempts: ExamPrepAttempt[];
  onSaveExamPrepAttempt: (_attempt: ExamPrepAttempt) => Promise<void>;
  onNavigate: (_path: string) => void;
};

type RecognitionPhase = 'idle' | 'active' | 'done';

const createAttemptId = (taskId: string): string =>
  `recognition-attempt-${taskId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const ExamPrepRecognitionView = ({
  attempts,
  onSaveExamPrepAttempt,
  onNavigate,
}: ExamPrepRecognitionViewProps) => {
  const [phase, setPhase] = useState<RecognitionPhase>('idle');
  const [session, setSession] = useState<ExamPrepRecognitionTask[] | null>(null);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [ratingPending, setRatingPending] = useState(false);
  const [ratingError, setRatingError] = useState<string | null>(null);
  const [answer, setAnswer] = useState('');
  const [sessionCorrect, setSessionCorrect] = useState(0);

  const previewQueue = buildExamPrepRecognitionQueue(attempts);
  const item = phase === 'active' && session ? session[index] ?? null : null;

  const freezeSession = () => {
    setSession(previewQueue);
    setIndex(0);
    setSessionCorrect(0);
    setRevealed(false);
    setAnswer('');
    setRatingError(null);
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

  const handleReveal = () => {
    setRevealed(true);
    setRatingError(null);
  };

  const handleResult = async (result: 'got_it' | 'missed') => {
    if (!item || ratingPending) return;
    setRatingPending(true);
    setRatingError(null);
    const attempt = buildRecognitionAttempt({
      attemptId: createAttemptId(item.id),
      task: item,
      result,
      completedAt: new Date().toISOString(),
      ...(answer.trim() ? { answer: answer.trim() } : {}),
    });
    try {
      await onSaveExamPrepAttempt(attempt);
      // advance through the FROZEN session only
      setRevealed(false);
      setAnswer('');
      if (result === 'got_it') setSessionCorrect((count) => count + 1);
      const nextIndex = index + 1;
      if (session && nextIndex >= session.length) setPhase('done');
      else setIndex(nextIndex);
    } catch (error) {
      setRatingError(
        error instanceof Error
          ? error.message
          : 'The recognition result could not be saved. Try again.',
      );
    } finally {
      setRatingPending(false);
    }
  };

  const finish = (phase === 'done' && session ? session.length : 0);

  if (phase === 'done') {
    const hasNextCandidates = previewQueue.length > 0;
    return (
      <div className="space-y-3">
        <section className="rounded border border-emerald-800 bg-emerald-950 p-4">
          <GraduationCap className="mb-2 text-emerald-400" size={20} />
          <p className="font-semibold text-white">Recognition Sprint complete</p>
          <p className="mt-1 text-xs text-slate-400">
            {`Correct: ${sessionCorrect} / ${finish}`}
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
            <p className="font-semibold text-white">No recognition cues are available.</p>
          </section>
        </div>
      );
    }
    return (
      <div className="space-y-3">
        <section className="rounded border border-emerald-800 bg-emerald-950 p-4">
          <GraduationCap className="mb-2 text-emerald-400" size={20} />
          <p className="font-semibold text-white">Recognition Sprint</p>
          <div className="mt-1 space-y-1 text-xs text-slate-400">
            <p>{`${previewQueue.length} questions.`}</p>
            <p>{EXAM_PREP_RECOGNITION_PRACTICE_COPY}</p>
            <p>The expected topic and likely source documents remain hidden until Reveal.</p>
            <p>This sprint samples the full exam curriculum.</p>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleStart}
              className="rounded border border-emerald-600 bg-emerald-900 px-3 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-800"
            >
              Start Recognition Sprint
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
          <span className="rounded bg-slate-800 px-2 py-1">
            Correct so far: {sessionCorrect}
          </span>
        </div>
        <div className="mt-3 space-y-2">
          {!revealed ? (
            <>
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-400">
                Cue
              </p>
              <p className="cue rounded border border-slate-700 bg-slate-900 p-3 text-sm text-emerald-100">
                {item?.cue}
              </p>
              <p className="text-xs italic text-slate-500">{EXAM_PREP_RECOGNITION_ASK}</p>
              <textarea
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
                className="w-full rounded border border-slate-700 bg-slate-900 p-1.5 text-xs text-slate-200"
                rows={3}
                placeholder="Your answer (optional)..."
              />
              <button
                type="button"
                onClick={handleReveal}
                className="rounded border border-emerald-600 bg-emerald-900 px-3 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-800"
              >
                Reveal
              </button>
            </>
          ) : (
            <div className="space-y-3">
              <div className="rounded border border-sky-900/60 bg-sky-950/40 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-sky-300">
                  Expected topic
                </p>
                <p className="mt-1 text-sm text-white">
                  <span className="font-mono text-xs text-sky-300">{item?.unitId}</span>
                  <span className="ml-2">{item?.unitTitle}</span>
                </p>
                <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
                  <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-400">
                    {item ? examPrepTierLabel(item.tier) : ''}
                  </span>
                  <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-400">
                    {item?.reviewWeight} review weight
                  </span>
                </div>
                <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-sky-300">
                  Likely sources
                </p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-sky-100/90">
                  {(item?.expectedDocumentIds ?? []).map((documentId) => (
                    <li key={documentId}>
                      {EXAM_PREP_DOCUMENT_TITLES[documentId] ?? documentId}
                    </li>
                  ))}
                </ul>
              </div>
              {answer.trim() ? (
                <div className="rounded border border-slate-700 bg-slate-800/50 p-2 text-xs text-slate-300">
                  <span className="font-semibold uppercase tracking-wide text-slate-400">
                    Your answer
                  </span>
                  <p className="mt-0.5 whitespace-pre-wrap">{answer}</p>
                </div>
              ) : null}
              {ratingError ? (
                <div
                  role="alert"
                  className="rounded border border-rose-900/60 bg-rose-950/40 p-2 text-xs text-rose-200"
                >
                  {ratingError}
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={ratingPending}
                  onClick={() => void handleResult('got_it')}
                  className="rounded border border-emerald-600 bg-emerald-900 px-3 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-800"
                >
                  Got it
                </button>
                <button
                  type="button"
                  disabled={ratingPending}
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
      {!revealed ? (
        <div className="flex items-center gap-1.5 text-[11px] text-slate-600">
          <Eye size={12} /> Expected topic and sources stay hidden until you press Reveal.
        </div>
      ) : null}
    </div>
  );
};
