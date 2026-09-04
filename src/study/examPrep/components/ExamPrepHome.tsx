// Exam Prep — Home view.
//
// Shows the headline Exam Prep metrics: studied X/133 units, recall cards due
// now, introduced X/57 recall cards, and the frozen 57-card total — plus
// current session limits, a deterministic recommended next unstudied Learn
// unit (same rank philosophy as the recall queue; purely advisory, never
// auto-marks), and navigation into Learn / Recall / Drills.

import type { ExamPrepHomeMetrics } from '../examPrepSelectors';
import { selectRecommendedLearnUnit } from '../examPrepSelectors';
import type { ExamPrepUnitProgress } from '../examPrepTypes';
import { EXAM_PREP_MANIFEST, EXAM_PREP_SOURCE_CORPUS_CONTENT_HASH } from '../examPrepManifest';

export type ExamPrepHomeViewProps = {
  metrics: ExamPrepHomeMetrics;
  unitProgress: ExamPrepUnitProgress[];
  newRecallCardsPerSession: number;
  maxRecallCardsPerSession: number;
  onNavigate: (_path: string) => void;
};

const tierLabelFor = (tier: string): string =>
  tier === 'NAV' ? 'Navigation' : `Tier ${tier}`;

export const ExamPrepHomeView = ({
  metrics,
  unitProgress,
  newRecallCardsPerSession,
  maxRecallCardsPerSession,
  onNavigate,
}: ExamPrepHomeViewProps) => {
  const recommended = selectRecommendedLearnUnit(unitProgress);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <section className="rounded border border-slate-800 bg-slate-900 p-3">
          <div className="text-xs uppercase tracking-wide text-slate-500">Studied units</div>
          <div className="mt-1 text-2xl font-semibold text-emerald-300">
            {metrics.studiedLearnUnits}
            <span className="text-sm font-normal text-slate-500"> / {metrics.totalLearnUnits}</span>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('/study/learn')}
            className="mt-2 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700"
          >
            Open Learn
          </button>
        </section>
        <section className="rounded border border-slate-800 bg-slate-900 p-3">
          <div className="text-xs uppercase tracking-wide text-slate-500">Recall due now</div>
          <div className="mt-1 text-2xl font-semibold text-amber-300">
            {metrics.dueRecallCards}
          </div>
          <button
            type="button"
            onClick={() => onNavigate('/study/review')}
            className="mt-2 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700"
          >
            Open Recall Review
          </button>
        </section>
        <section className="rounded border border-slate-800 bg-slate-900 p-3">
          <div className="text-xs uppercase tracking-wide text-slate-500">Introduced cards</div>
          <div className="mt-1 text-2xl font-semibold text-sky-300">
            {metrics.introducedRecallCards}
            <span className="text-sm font-normal text-slate-500"> / {metrics.totalRecallCards}</span>
          </div>
        </section>
        <section className="rounded border border-slate-800 bg-slate-900 p-3">
          <div className="text-xs uppercase tracking-wide text-slate-500">Recall cards</div>
          <div className="mt-1 text-2xl font-semibold text-white">
            {metrics.totalRecallCards}
          </div>
          <div className="mt-2 text-[11px] text-slate-500">
            {metrics.newRecallCards} not yet introduced · session new limit {newRecallCardsPerSession} · max{' '}
            {maxRecallCardsPerSession}
          </div>
        </section>
      </div>
      {recommended ? (
        <section className="rounded border border-emerald-800/70 bg-emerald-950/40 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs uppercase tracking-wide text-emerald-400">
                Recommended next unit
              </div>
              <p className="mt-1 text-sm font-semibold text-white">{recommended.title}</p>
              <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
                <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-400">
                  {tierLabelFor(recommended.tier)}
                </span>
                <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-400">
                  {recommended.reviewWeight} review weight
                </span>
                <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-400">
                  {recommended.mustRecall.length} recall card
                  {recommended.mustRecall.length === 1 ? '' : 's'} · {recommended.mustLocate.length}{' '}
                  lookup{recommended.mustLocate.length === 1 ? '' : 's'}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">
                Deterministic pick among unstudied units; opens Learn below — studying is only
                marked when you toggle it there.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('/study/learn')}
              className="rounded border border-emerald-700 bg-emerald-900 px-3 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-800"
            >
              Open Learn
            </button>
          </div>
        </section>
      ) : null}
      <section className="rounded border border-slate-800 bg-slate-900 p-3 text-xs text-slate-400">
        <p>
          <span className="font-semibold text-slate-300">Immutable curriculum, hash-bound learner state.</span>{' '}
          Exam Prep stores progress, recall scheduling, attempts, and session settings locally,
          bound to the current frozen manifest content hash. Drills are session-only.
        </p>
        <p className="mt-1 font-mono text-[11px] text-slate-600">
          {EXAM_PREP_MANIFEST.curriculumId} · corpus {EXAM_PREP_SOURCE_CORPUS_CONTENT_HASH.slice(0, 16)}… ·
          contentHash {EXAM_PREP_MANIFEST.contentHash.slice(0, 16)}…
        </p>
      </section>
    </div>
  );
};
