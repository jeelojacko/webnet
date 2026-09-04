// Exam Prep — Recall Review view.
//
// Drives the deterministic recall queue built from current-hash progress.
// A card shows only its prompt until the learner presses Reveal; the
// expected answer text and the Again/Hard/Good/Easy rating row appear only
// after Reveal (no answer leakage). Ratings are persisted by the parent
// (attempt + progress atomically, stale-safe) and the queue recomputes.

import { useEffect, useMemo, useState } from 'react';
import { GraduationCap } from 'lucide-react';
import type { StudyDataSnapshot } from '../../studyTypes';
import { EXAM_PREP_RECALL_TASKS, EXAM_PREP_LEARN_UNITS } from '../examPrepRecallTasks';
import { buildExamPrepRecallQueue, type ExamPrepQueueItem } from '../examPrepQueue';
import {
  buildExamPrepRecallRatingPreviews,
} from '../examPrepReview';
import { buildExamPrepHomeMetrics } from '../examPrepSelectors';
import { resolveExamPrepSettings } from '../examPrepSettings';
import { EXAM_PREP_MANIFEST } from '../examPrepManifest';
import type { ExamPrepRecallRating } from '../examPrepTypes';

export type ExamPrepRecallViewProps = {
  data: StudyDataSnapshot;
  onRateRecallTask: (_options: {
    item: ExamPrepQueueItem;
    rating: ExamPrepRecallRating;
    now: Date;
    answer?: string;
  }) => Promise<void>;
  onNavigate: (_path: string) => void;
};

const RATINGS: Array<{ rating: ExamPrepRecallRating; label: string; className: string }> = [
  { rating: 'again', label: 'Again', className: 'bg-rose-700 hover:bg-rose-600' },
  { rating: 'hard', label: 'Hard', className: 'bg-amber-700 hover:bg-amber-600' },
  { rating: 'good', label: 'Good', className: 'bg-emerald-700 hover:bg-emerald-600' },
  { rating: 'easy', label: 'Easy', className: 'bg-sky-700 hover:bg-sky-600' },
];

const unitTitleFor = (taskId: string): string => {
  const task = EXAM_PREP_RECALL_TASKS.find((entry) => entry.id === taskId);
  if (task) return task.unitTitle;
  const unitId = taskId.split(':')[1] ?? taskId;
  const unit = EXAM_PREP_LEARN_UNITS.find((entry) => entry.id === unitId);
  return unit?.title ?? unitId;
};

const tierLabelFor = (taskId: string): string => {
  const task = EXAM_PREP_RECALL_TASKS.find((entry) => entry.id === taskId);
  return task ? (task.tier === 'NAV' ? 'Navigation' : `Tier ${task.tier}`) : '';
};

export const ExamPrepRecallView = ({
  data,
  onRateRecallTask,
  onNavigate,
}: ExamPrepRecallViewProps) => {
  const [nowIso, setNowIso] = useState(() => new Date().toISOString());
  const [revealed, setRevealed] = useState(false);
  const [ratingPending, setRatingPending] = useState(false);
  const [ratingError, setRatingError] = useState<string | null>(null);
  const [answer, setAnswer] = useState('');
  const [sessionReviewed, setSessionReviewed] = useState(0);

  useEffect(() => {
    const handle = window.setTimeout(
      () => setNowIso(new Date().toISOString()),
      30_000,
    );
    return () => window.clearTimeout(handle);
  }, [nowIso]);

  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const settings = useMemo(
    () =>
      resolveExamPrepSettings(
        data.examPrepSettings,
        { curriculumId: EXAM_PREP_MANIFEST.curriculumId, curriculumContentHash: EXAM_PREP_MANIFEST.contentHash },
        nowIso,
      ),
    [data.examPrepSettings, nowIso],
  );
  const queue = useMemo(
    () =>
      buildExamPrepRecallQueue({
        progress: data.examPrepRecallProgress,
        now,
        newRecallCardsPerSession: settings.newRecallCardsPerSession,
        maxRecallCardsPerSession: settings.maxRecallCardsPerSession,
      }),
    [data.examPrepRecallProgress, now, settings],
  );
  const metrics = useMemo(
    () =>
      buildExamPrepHomeMetrics(data.examPrepUnitProgress, data.examPrepRecallProgress, now),
    [data.examPrepRecallProgress, data.examPrepUnitProgress, now],
  );
  const item = queue[0] ?? null;
  const ratingPreviews = useMemo(() => {
    if (!item || !revealed) return [];
    return buildExamPrepRecallRatingPreviews({ data, item, now });
  }, [data, item, now, revealed]);

  const handleReveal = () => {
    setRevealed(true);
    setRatingError(null);
    setNowIso(new Date().toISOString());
  };

  const handleRate = async (rating: ExamPrepRecallRating) => {
    if (!item || ratingPending) return;
    setRatingPending(true);
    setRatingError(null);
    try {
      await onRateRecallTask({
        item,
        rating,
        now: new Date(),
        ...(answer.trim() ? { answer: answer.trim() } : {}),
      });
      setRevealed(false);
      setAnswer('');
      setSessionReviewed((count) => count + 1);
      setNowIso(new Date().toISOString());
    } catch (error) {
      // Surface persistence/stale errors without advancing the card: keep the
      // revealed state and the typed answer so the learner can retry.
      setRatingError(
        error instanceof Error
          ? error.message
          : 'The recall rating could not be saved. Try again.',
      );
    } finally {
      setRatingPending(false);
    }
  };

  if (queue.length === 0) {
    return (
      <div className="space-y-4">
        <section className="rounded border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-300">
          <GraduationCap className="mb-2 text-emerald-400" size={20} />
          <p className="font-semibold text-white">
            {sessionReviewed > 0 ? 'Session complete' : 'No recall cards are due right now.'}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {sessionReviewed > 0
              ? `You reviewed ${sessionReviewed} card${sessionReviewed === 1 ? '' : 's'} this session.`
              : `Introduced ${metrics.introducedRecallCards} / ${metrics.totalRecallCards} cards; ${metrics.newRecallCards} new cards remain unopened.`}
          </p>
          <button
            type="button"
            onClick={() => onNavigate('/study/learn')}
            className="mt-3 rounded border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
          >
            Browse Learn units
          </button>
        </section>
      </div>
    );
  }

  const dueLabel =
    item.progress && item.progress.scheduling.card
      ? `due ${item.progress.scheduling.card.due}`
      : 'new card';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
        <span className="rounded bg-slate-800 px-2 py-1">
          Queue: {queue.length} card{queue.length === 1 ? '' : 's'}
        </span>
        <span className="rounded bg-slate-800 px-2 py-1">Reviewed this session: {sessionReviewed}</span>
        <span className="rounded bg-slate-800 px-2 py-1">Due now: {metrics.dueRecallCards}</span>
        <span className="rounded bg-slate-800 px-2 py-1">
          Introduced: {metrics.introducedRecallCards}/{metrics.totalRecallCards}
        </span>
        <span className="rounded bg-slate-800 px-2 py-1">New: {metrics.newRecallCards}</span>
      </div>
      <section className="rounded border border-emerald-800 bg-emerald-950 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-emerald-300">{item.task.id}</span>
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px] text-slate-400">
            {tierLabelFor(item.task.id)}
          </span>
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px] text-slate-400">
            {dueLabel}
          </span>
        </div>
        <h4 className="mt-2 text-sm font-semibold text-white">{unitTitleFor(item.task.id)}</h4>
        {!revealed ? (
          <div className="mt-3 space-y-2">
            <p className="text-sm text-emerald-100">{item.task.prompt}</p>
            <textarea
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              className="w-full rounded border border-slate-700 bg-slate-900 p-1.5 text-xs text-slate-200"
              rows={3}
              placeholder="Write your recall attempt here (optional)..."
            />
            <button
              type="button"
              onClick={handleReveal}
              className="rounded border border-emerald-600 bg-emerald-900 px-3 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-800"
            >
              Reveal
            </button>
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            <div className="rounded border border-amber-900/60 bg-amber-950/30 p-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-amber-300">
                Expected answer
              </span>
              <p className="mt-1 text-sm text-amber-100/90">{item.task.expectedAnswer}</p>
            </div>
            {ratingError ? (
              <div
                role="alert"
                className="rounded border border-rose-900/60 bg-rose-950/40 p-2 text-xs text-rose-200"
              >
                {ratingError}
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              {ratingPreviews.map((preview) => {
                const button = RATINGS.find((entry) => entry.rating === preview.rating);
                if (!button) return null;
                return (
                  <button
                    key={preview.rating}
                    type="button"
                    disabled={ratingPending}
                    onClick={() => void handleRate(preview.rating)}
                    className={`rounded border border-slate-900 px-3 py-1.5 text-xs font-semibold text-white ${button.className}`}
                  >
                    {button.label} · {preview.intervalLabel}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-3 text-[10px] text-emerald-200/50">
          <span>prompt: {item.task.prompt}</span>
        </div>
      </section>
    </div>
  );
};
