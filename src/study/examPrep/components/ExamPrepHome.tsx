// Exam Prep — Home view.
//
// Phase 2.5 learner-workflow/readiness UX:
//  - compact Suggested study flow explaining how the five modes fit together,
//  - Recommended Now (deterministic advisory next action; never persists,
//    never auto-marks anything studied),
//  - five independent readiness dimensions: Learn X/133 studied, Recall
//    introduced X/57 + due now, Recognition coverage X/317 + latest-result
//    accuracy, Locate coverage X/452 + latest-result accuracy, and Lookup
//    Drills exam-ready X/24 + attempted X/24 (no combined mastery score),
//  - Today's Activity derived from the current-hash immutable records on the
//    local calendar date,
//  - the all-studied Curriculum coverage note once every Learn unit is
//    studied, and
//  - a "What these measure" help section that keeps the labels honest
//    (Studied ≠ mastered; accuracy ≠ curriculum coverage).

import type { ExamPrepHomeMetrics } from '../examPrepSelectors';
import { EXAM_PREP_MANIFEST, EXAM_PREP_SOURCE_CORPUS_CONTENT_HASH } from '../examPrepManifest';
import { EXAM_PREP_DRILL_STATUS_LABELS } from '../examPrepDrillFilters';
import { EXAM_PREP_TOTAL_LOCATE_TASKS, EXAM_PREP_TOTAL_RECOGNITION_TASKS } from '../examPrepConstants';
import { EXAM_PREP_PROVISIONAL_MOCK_V1 } from '../mock/examPrepMockProfiles';
import {
  selectExamPrepRecommendedAction,
  type ExamPrepRecommendedAction,
} from '../examPrepRecommendations';
import { buildExamPrepTodayActivity, type ExamPrepTodayActivity } from '../examPrepToday';
import type {
  ExamPrepAttempt,
  ExamPrepRecallProgress,
  ExamPrepUnitProgress,
} from '../examPrepTypes';

export type ExamPrepHomeViewProps = {
  metrics: ExamPrepHomeMetrics;
  unitProgress: ExamPrepUnitProgress[];
  recallProgress: ExamPrepRecallProgress[];
  attempts: ExamPrepAttempt[];
  now: Date;
  newRecallCardsPerSession: number;
  maxRecallCardsPerSession: number;
  onNavigate: (_path: string) => void;
};

const STUDY_FLOW_STEPS = [
  { step: '1', title: 'Learn', note: 'Understand the topic and where its law lives.' },
  { step: '2', title: 'Recall', note: 'Memorize only the 57 curated REMEMBER rules.' },
  { step: '3', title: 'Recognition', note: 'Practice identifying which law/topic applies.' },
  { step: '4', title: 'Locate', note: 'Practice finding the correct statute or provision.' },
  { step: '5', title: 'Lookup Drills', note: 'Combine recognition, retrieval, and application.' },
  {
    step: '6',
    title: 'Mock Exam',
    note: 'Combine the full workflow under one timed exam simulation.',
  },
] as const;

const MEASURE_DEFINITIONS = [
  { label: 'Studied', note: 'You have worked through the curriculum unit.' },
  { label: 'Recall', note: 'The small set of rules intentionally selected for memory.' },
  {
    label: 'Recognition',
    note: 'Whether you can identify the relevant law or topic from a cue.',
  },
  {
    label: 'Locate',
    note: 'Whether you can find the correct statute or controlling provision.',
  },
  {
    label: 'Exam-ready drill',
    note: 'You scored 3/3 within the target time on two different practice dates.',
  },
] as const;

const MEASURE_HONESTY_NOTES = [
  'Studied ≠ mastered',
  'Accuracy ≠ complete curriculum coverage',
  'Exam-ready drills ≠ guarantee of exam success',
] as const;

const cardClass =
  'rounded border border-slate-800 bg-slate-900 p-3';
const metricButtonClass =
  'mt-2 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700';

const plural = (count: number, singular: string, pluralWord: string): string =>
  `${count} ${count === 1 ? singular : pluralWord}`;

const recommendedNowText = (
  action: ExamPrepRecommendedAction,
): { heading: string; detail: string | null } => {
  switch (action.kind) {
    case 'recall':
      return {
        heading:
          action.count === 1
            ? '1 recall card is due.'
            : `${action.count} recall cards are due.`,
        detail: 'Reviewing due memory is the highest-priority task.',
      };
    case 'learn':
      return {
        heading: action.title,
        detail: 'Next high-priority unstudied curriculum unit.',
      };
    case 'recognition':
      return {
        heading: 'Recognition practice',
        detail:
          action.reason === 'missed'
            ? 'A recognition cue was missed recently — revisit the law/topic mapping.'
            : 'Regular recognition practice keeps law/topic mapping sharp.',
      };
    case 'locate':
      return {
        heading: 'Locate practice',
        detail: 'A locate target was missed recently — revisit finding the right statute.',
      };
    case 'drill':
      return {
        heading: action.title,
        detail: null,
      };
  }
};

export const ExamPrepHomeView = ({
  metrics,
  unitProgress,
  recallProgress,
  attempts,
  now,
  newRecallCardsPerSession,
  maxRecallCardsPerSession,
  onNavigate,
}: ExamPrepHomeViewProps) => {
  const recommended = selectExamPrepRecommendedAction(unitProgress, recallProgress, attempts, now);
  const recommendedText = recommendedNowText(recommended);
  const today = buildExamPrepTodayActivity(unitProgress, attempts, now);
  const allStudied = metrics.studiedLearnUnits >= metrics.totalLearnUnits;
  const zeroToday =
    today.studiedUnits === 0 &&
    today.recallReviews === 0 &&
    today.recognitionAttempts === 0 &&
    today.locateAttempts === 0 &&
    today.drillAttempts === 0;

  return (
    <div className="space-y-4">
      <section className="rounded border border-slate-800 bg-slate-900/70 p-3">
        <div className="text-xs uppercase tracking-wide text-slate-400">
          Suggested study flow
        </div>
        <ol className="mt-2 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-6">
          {STUDY_FLOW_STEPS.map((item) => (
            <li key={item.step} className="rounded border border-slate-800 bg-slate-900 p-2">
              <div className="text-emerald-300">
                <span className="font-mono text-[10px] text-emerald-500">{item.step}.</span>{' '}
                <span className="font-semibold text-slate-100">{item.title}</span>
              </div>
              <p className="mt-0.5 text-[11px] text-slate-500">{item.note}</p>
            </li>
          ))}
        </ol>
        <p className="mt-2 text-[11px] text-slate-600">
          The six steps explain how the learning architecture fits together; no progress is
          attached to the steps themselves.
        </p>
      </section>

      <section className="rounded border border-emerald-800/70 bg-emerald-950/40 p-3">
        <div className="text-xs uppercase tracking-wide text-emerald-400">Recommended now</div>
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-white">
              {recommended.kind === 'learn' || recommended.kind === 'drill' ? (
                <>
                  <span className="font-mono text-xs text-emerald-300">
                    {recommended.kind === 'learn' ? recommended.unitId : recommended.drillId}
                  </span>
                  <span className="ml-2">{recommendedText.heading}</span>
                </>
              ) : (
                recommendedText.heading
              )}
            </p>
            {recommended.kind === 'drill' ? (
              <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
                <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-300">
                  Status: {EXAM_PREP_DRILL_STATUS_LABELS[recommended.status]}
                </span>
              </div>
            ) : null}
            {recommendedText.detail ? (
              <p className="mt-1 text-[11px] text-slate-500">{recommendedText.detail}</p>
            ) : null}
          </div>
          <RecommendedNowButton action={recommended} onNavigate={onNavigate} />
        </div>
      </section>

      <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <section className={cardClass}>
          <div className="text-xs uppercase tracking-wide text-slate-500">Studied units</div>
          <div className="mt-1 text-2xl font-semibold text-emerald-300">
            {metrics.studiedLearnUnits}
            <span className="text-sm font-normal text-slate-500">
              {' '}
              / {metrics.totalLearnUnits}
            </span>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('/study/learn')}
            className={metricButtonClass}
          >
            Open Learn
          </button>
        </section>
        <section className={cardClass}>
          <div className="text-xs uppercase tracking-wide text-slate-500">Recall due now</div>
          <div className="mt-1 text-2xl font-semibold text-amber-300">
            {metrics.dueRecallCards}
          </div>
          <button
            type="button"
            onClick={() => onNavigate('/study/review')}
            className={metricButtonClass}
          >
            Open Recall Review
          </button>
        </section>
        <section className={cardClass}>
          <div className="text-xs uppercase tracking-wide text-slate-500">Introduced cards</div>
          <div className="mt-1 text-2xl font-semibold text-sky-300">
            {metrics.introducedRecallCards}
            <span className="text-sm font-normal text-slate-500">
              {' '}
              / {metrics.totalRecallCards}
            </span>
          </div>
        </section>
        <section className={cardClass}>
          <div className="text-xs uppercase tracking-wide text-slate-500">Recall cards</div>
          <div className="mt-1 text-2xl font-semibold text-white">
            {metrics.totalRecallCards}
          </div>
          <div className="mt-2 text-[11px] text-slate-500">
            {metrics.newRecallCards} not yet introduced · session new limit{' '}
            {newRecallCardsPerSession} · max {maxRecallCardsPerSession}
          </div>
        </section>
      </div>

      <div className="grid gap-3 text-sm sm:grid-cols-3">
        <ReadinessCard
          title="Recognition"
          accuracy={metrics.recognition.accuracy}
          accuracyLabel="latest-result accuracy"
          attempted={metrics.recognition.attemptedTasks}
          denominator={EXAM_PREP_TOTAL_RECOGNITION_TASKS}
          unitWord="cue"
          onNavigate={() => onNavigate('/study/recognition')}
          ctaLabel="Recognition Sprint"
        />
        <ReadinessCard
          title="Locate"
          accuracy={metrics.locate.accuracy}
          accuracyLabel="latest-result accuracy"
          attempted={metrics.locate.attemptedTasks}
          denominator={EXAM_PREP_TOTAL_LOCATE_TASKS}
          unitWord="target"
          onNavigate={() => onNavigate('/study/locate')}
          ctaLabel="Locate Sprint"
        />
        <section className={cardClass}>
          <div className="text-xs uppercase tracking-wide text-slate-500">Lookup Drills</div>
          <div className="mt-1 text-2xl font-semibold text-amber-300">
            {metrics.drill.examReadyDrills}
            <span className="text-sm font-normal text-slate-500">
              {' '}
              / {metrics.drill.totalDrills} exam-ready
            </span>
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            {metrics.drill.attemptedDrills} / {metrics.drill.totalDrills} attempted
          </div>
          <button
            type="button"
            onClick={() => onNavigate('/study/drills')}
            className={metricButtonClass}
          >
            Lookup Drills
          </button>
        </section>
      </div>

      <section className="rounded border border-amber-800/60 bg-amber-950/25 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-xs uppercase tracking-wide text-amber-300">
              Provisional Mock Exam
            </div>
            <p className="mt-1 text-sm text-slate-300">
              {EXAM_PREP_PROVISIONAL_MOCK_V1.durationMinutes} min ·{' '}
              {EXAM_PREP_PROVISIONAL_MOCK_V1.questionCounts.recall +
                EXAM_PREP_PROVISIONAL_MOCK_V1.questionCounts.recognition +
                EXAM_PREP_PROVISIONAL_MOCK_V1.questionCounts.locate +
                EXAM_PREP_PROVISIONAL_MOCK_V1.questionCounts.drill}{' '}
              questions
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Format awaiting registrar confirmation — not the official ANBLS exam format.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('/study/mock-exam')}
            className="rounded border border-amber-700 bg-amber-900 px-3 py-1.5 text-xs font-semibold text-amber-100 hover:bg-amber-800"
          >
            Open Mock Exam
          </button>
        </div>
      </section>

      <section className={cardClass}>
        <div className="text-xs uppercase tracking-wide text-slate-400">Today's activity</div>
        {zeroToday ? (
          <p className="mt-1 text-xs text-slate-500">
            No Exam Prep activity recorded today yet.
          </p>
        ) : (
          <TodayActivityLines today={today} />
        )}
        <p className="mt-1.5 text-[11px] text-slate-600">
          Derived from your current progress and attempts on this local date — nothing extra is
          tracked.
        </p>
      </section>

      {allStudied ? (
        <section className="rounded border border-emerald-700/60 bg-emerald-900/25 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-emerald-300">
            Curriculum coverage
          </div>
          <p className="mt-1 text-sm text-emerald-100">
            All {metrics.totalLearnUnits} curriculum units are marked studied.
          </p>
        </section>
      ) : null}

      <details className="rounded border border-slate-800 bg-slate-900/70 p-3 text-xs">
        <summary className="cursor-pointer font-semibold text-slate-200">
          What these measure
        </summary>
        <dl className="mt-2 space-y-1.5">
          {MEASURE_DEFINITIONS.map((definition) => (
            <div key={definition.label} className="flex flex-wrap gap-1.5">
              <dt className="font-semibold text-slate-300">{definition.label}</dt>
              <dd className="text-slate-500">{definition.note}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 border-t border-slate-800 pt-2 text-slate-600">
          Honest labels: {MEASURE_HONESTY_NOTES.join(' · ')}.
        </p>
      </details>

      <section className={cardClass + ' text-xs text-slate-400'}>
        <p>
          <span className="font-semibold text-slate-300">
            Immutable curriculum, hash-bound learner state.
          </span>{' '}
          Exam Prep stores progress, recall scheduling, attempts, and session settings locally,
          bound to the current frozen manifest content hash. Only 57 REMEMBER cards use FSRS;
          Recognition, Locate, and Drill practice use immutable attempt history.
        </p>
        <p className="mt-1 font-mono text-[11px] text-slate-600">
          {EXAM_PREP_MANIFEST.curriculumId} · corpus{' '}
          {EXAM_PREP_SOURCE_CORPUS_CONTENT_HASH.slice(0, 16)}… · contentHash{' '}
          {EXAM_PREP_MANIFEST.contentHash.slice(0, 16)}…
        </p>
      </section>
    </div>
  );
};

const recommendedNowCta = (
  action: ExamPrepRecommendedAction,
): { label: string; path: string } => {
  switch (action.kind) {
    case 'recall':
      return { label: 'Start Recall Review', path: '/study/review' };
    case 'learn':
      return { label: 'Open Learn', path: '/study/learn' };
    case 'recognition':
      return { label: 'Start Recognition Sprint', path: '/study/recognition' };
    case 'locate':
      return { label: 'Start Locate Sprint', path: '/study/locate' };
    case 'drill':
      return { label: 'Open Lookup Drills', path: '/study/drills' };
  }
};

const RecommendedNowButton = ({
  action,
  onNavigate,
}: {
  action: ExamPrepRecommendedAction;
  onNavigate: (_path: string) => void;
}) => {
  const cta = recommendedNowCta(action);
  return (
    <button
      type="button"
      onClick={() => onNavigate(cta.path)}
      className="rounded border border-emerald-700 bg-emerald-900 px-3 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-800"
    >
      {cta.label}
    </button>
  );
};

const accuracyPercent = (accuracy: number | null): string | null =>
  accuracy === null ? null : `${Math.round(accuracy * 100)}%`;

const ReadinessCard = ({
  title,
  accuracy,
  accuracyLabel,
  attempted,
  denominator,
  unitWord,
  onNavigate,
  ctaLabel,
}: {
  title: string;
  accuracy: number | null;
  accuracyLabel: string;
  attempted: number;
  denominator: number;
  unitWord: 'cue' | 'target';
  onNavigate: () => void;
  ctaLabel: string;
}) => {
  const percent = accuracyPercent(accuracy);
  const attemptedWord = unitWord === 'cue' ? 'cues' : 'targets';
  return (
    <section className={cardClass}>
      <div className="text-xs uppercase tracking-wide text-slate-500">{title}</div>
      <div className="mt-1 text-2xl font-semibold text-sky-300">{percent ?? '—'}</div>
      <div className="text-[10px] text-slate-600">
        {percent === null ? 'No attempts yet' : accuracyLabel}
      </div>
      {attempted > 0 ? (
        <div className="mt-1 text-[11px] text-slate-500">
          {attempted} / {denominator} {attemptedWord} attempted
        </div>
      ) : null}
      <button type="button" onClick={onNavigate} className={metricButtonClass}>
        {ctaLabel}
      </button>
    </section>
  );
};

const TodayActivityLines = ({ today }: { today: ExamPrepTodayActivity }) => (
  <dl className="mt-2 space-y-1 text-xs">
    <div className="flex justify-between gap-4 border-b border-slate-800 pb-1">
      <dt className="text-slate-400">Learn</dt>
      <dd className="text-slate-200">
        {plural(today.studiedUnits, 'unit', 'units')}
      </dd>
    </div>
    <div className="flex justify-between gap-4 border-b border-slate-800 pb-1">
      <dt className="text-slate-400">Recall</dt>
      <dd className="text-slate-200">
        {plural(today.recallReviews, 'review', 'reviews')}
      </dd>
    </div>
    <div className="flex justify-between gap-4 border-b border-slate-800 pb-1">
      <dt className="text-slate-400">Recognition</dt>
      <dd className="text-slate-200">
        {plural(today.recognitionAttempts, 'question', 'questions')}
      </dd>
    </div>
    <div className="flex justify-between gap-4 border-b border-slate-800 pb-1">
      <dt className="text-slate-400">Locate</dt>
      <dd className="text-slate-200">
        {plural(today.locateAttempts, 'lookup', 'lookups')}
      </dd>
    </div>
    <div className="flex justify-between gap-4">
      <dt className="text-slate-400">Drills</dt>
      <dd className="text-slate-200">
        {plural(today.drillAttempts, 'attempt', 'attempts')}
      </dd>
    </div>
  </dl>
);
