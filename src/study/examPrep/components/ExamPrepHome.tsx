// Exam Prep — Home view.
//
// Shows the headline Exam Prep metrics: studied X/133 units, recall cards due
// now, introduced X/57 recall cards, and the frozen 57-card total — plus
// current session limits and navigation into Learn / Recall / Drills.

import type { ExamPrepHomeMetrics } from '../examPrepSelectors';
import { EXAM_PREP_MANIFEST, EXAM_PREP_SOURCE_CORPUS_CONTENT_HASH } from '../examPrepManifest';

export type ExamPrepHomeViewProps = {
  metrics: ExamPrepHomeMetrics;
  newRecallCardsPerSession: number;
  maxRecallCardsPerSession: number;
  onNavigate: (_path: string) => void;
};

export const ExamPrepHomeView = ({
  metrics,
  newRecallCardsPerSession,
  maxRecallCardsPerSession,
  onNavigate,
}: ExamPrepHomeViewProps) => (
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
