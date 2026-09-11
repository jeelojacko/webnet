import type {
  SerializedStudyFsrsCard,
  StudyRating,
  StudyResponseMode,
  StudyRubricCoverage,
  StudyRubricCoverageStatus,
  StudySessionItem,
} from '../studyTypes';
import type { StudySessionCompletionSummary } from '../studySessionSummary';
import type { StudyNextScheduledReview as NextScheduledReview } from '../studyNextReview';
import { StudyEmptyState } from './StudyLayout';

type StudySessionPageProps = {
  activeItem: StudySessionItem | null;
  answer: string;
  onAnswerChange: (_answer: string) => void;
  guidedResponses: Record<string, string>;
  onGuidedResponsesChange: (_responses: Record<string, string>) => void;
  responseMode: StudyResponseMode;
  revealed: boolean;
  onRevealChange: (_revealed: boolean) => void;
  coveredConceptIds: string[];
  onToggleConcept: (_conceptId: string) => void;
  rubricCoverage: StudyRubricCoverage[];
  onRubricCoverageChange: (_coverage: StudyRubricCoverage[]) => void;
  ratingPending?: boolean;
  ratingPreviews?: Array<{ rating: StudyRating; intervalLabel: string; due: string }>;
  onRate: (_rating: StudyRating) => Promise<void>;
  completionSummary?: StudySessionCompletionSummary | null;
  nextScheduledReview?: NextScheduledReview | null;
  onUndoLatestRating?: () => Promise<void>;
  previewMode?: boolean;
  sourceText?: string;
  onClosePreview?: () => void;
  onOpenUnit?: (_unitId: string) => void;
};

const RATINGS: Array<{ rating: StudyRating; label: string; className: string }> = [
  { rating: 'again', label: 'Again', className: 'bg-rose-700 hover:bg-rose-600' },
  { rating: 'hard', label: 'Hard', className: 'bg-amber-700 hover:bg-amber-600' },
  { rating: 'good', label: 'Good', className: 'bg-emerald-700 hover:bg-emerald-600' },
  { rating: 'easy', label: 'Easy', className: 'bg-sky-700 hover:bg-sky-600' },
];

const COVERAGE_OPTIONS: Array<{ status: StudyRubricCoverageStatus; label: string }> = [
  { status: 'covered', label: 'Covered' },
  { status: 'partially-covered', label: 'Partially covered' },
  { status: 'missed', label: 'Missed' },
];

const orderedRequiredRubrics = (activeItem: StudySessionItem) =>
  activeItem.rubrics.filter((rubric) => rubric.required);

const orderedOptionalRubrics = (activeItem: StudySessionItem) =>
  activeItem.rubrics.filter((rubric) => !rubric.required);

const StudyCompletionPanel = ({
  summary,
  onUndoLatestRating,
}: {
  summary: StudySessionCompletionSummary;
  onUndoLatestRating?: () => Promise<void>;
}) => (
  <section className="rounded border border-emerald-800 bg-emerald-950/20 p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="text-sm font-semibold text-emerald-100">Session Complete</div>
      {onUndoLatestRating ? (
        <button
          onClick={() => void onUndoLatestRating()}
          className="rounded border border-emerald-700 px-3 py-1.5 text-xs text-emerald-100 hover:bg-emerald-900/40"
        >
          Undo Last Rating
        </button>
      ) : null}
    </div>
    <div className="mt-3 grid gap-2 text-sm text-slate-300 sm:grid-cols-2 lg:grid-cols-4">
      <div>Reviewed: {summary.reviewed}</div>
      <div>Again: {summary.ratings.again}</div>
      <div>Hard: {summary.ratings.hard}</div>
      <div>Good: {summary.ratings.good}</div>
      <div>Easy: {summary.ratings.easy}</div>
      <div>New learned: {summary.newLearned}</div>
      <div>Still due: {summary.stillDue}</div>
      <div>Next short-term review: {summary.nextShortTermReview ?? 'none'}</div>
    </div>
  </section>
);

const StudySchedulerDiagnostics = ({ activeItem }: { activeItem: StudySessionItem }) => {
  if (!import.meta.env.DEV) return null;
  const card: SerializedStudyFsrsCard | undefined = activeItem.progress.scheduling?.card;
  return (
    <details className="rounded border border-slate-800 bg-slate-950 p-3 text-xs text-slate-400">
      <summary className="cursor-pointer text-slate-500">Scheduler diagnostics</summary>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div>Unit ID: {activeItem.unit.id}</div>
        <div>Reason: {activeItem.reason ?? 'unclassified'}</div>
        <div>FSRS state: {card?.state ?? 'uninitialized'}</div>
        <div>
          Due:{' '}
          {card?.due ?? activeItem.progress.scheduling?.legacyDueAt ?? activeItem.progress.dueAt}
        </div>
        <div>Last review: {card?.last_review ?? 'never'}</div>
        <div>Stability: {card?.stability ?? 'n/a'}</div>
        <div>Difficulty: {card?.difficulty ?? 'n/a'}</div>
        <div>Reps: {card?.reps ?? 0}</div>
        <div>Lapses: {card?.lapses ?? 0}</div>
        <div>Config version: {activeItem.progress.scheduling?.configVersion ?? 'n/a'}</div>
      </div>
    </details>
  );
};

const relativeIntervalLabel = (dueAt: string): string => {
  const ms = new Date(dueAt).getTime() - Date.now();
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
};

const localDueLabel = (dueAt: string): string =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(dueAt));

const StudyNoDueState = ({ nextReview }: { nextReview?: NextScheduledReview | null }) => {
  if (!nextReview) return <StudyEmptyState text="No study units are available." />;
  return (
    <div className="flex min-h-[18rem] flex-col items-center justify-center gap-3 rounded border border-slate-800 bg-slate-900/50 px-4 text-center text-slate-500">
      <div className="text-sm font-medium text-slate-300">Nothing is due right now.</div>
      <div className="text-sm">
        Next review: {nextReview.title} in {relativeIntervalLabel(nextReview.dueAt)}.
      </div>
      <div className="text-xs text-slate-600">Due {localDueLabel(nextReview.dueAt)}</div>
    </div>
  );
};

const StudySessionPage = ({
  activeItem,
  answer,
  onAnswerChange,
  guidedResponses,
  onGuidedResponsesChange,
  responseMode,
  revealed,
  onRevealChange,
  coveredConceptIds,
  onToggleConcept,
  rubricCoverage,
  onRubricCoverageChange,
  ratingPending = false,
  ratingPreviews = [],
  onRate,
  completionSummary = null,
  nextScheduledReview = null,
  onUndoLatestRating,
  previewMode = false,
  sourceText,
  onClosePreview,
  onOpenUnit,
}: StudySessionPageProps) => {
  if (!activeItem) {
    return completionSummary ? (
      <StudyCompletionPanel summary={completionSummary} onUndoLatestRating={onUndoLatestRating} />
    ) : (
      <StudyNoDueState nextReview={nextScheduledReview} />
    );
  }
  const requiredRubrics = orderedRequiredRubrics(activeItem);
  const optionalRubrics = orderedOptionalRubrics(activeItem);
  const guidedRubrics = requiredRubrics.length > 0 ? requiredRubrics : activeItem.rubrics;
  const previewByRating = new Map(ratingPreviews.map((preview) => [preview.rating, preview]));
  const sourceReviewRequired = !previewMode && activeItem.reason === 'source-review-required';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white">
            {previewMode ? 'Study Unit Preview' : 'Study Session'}
          </h2>
          <p className="text-sm text-slate-500">
            {activeItem.unit.title} · {activeItem.progress.phase} · priority{' '}
            {activeItem.unit.priority}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded bg-slate-900 px-3 py-1.5 text-xs text-slate-400">
            {previewMode
              ? 'Preview'
              : sourceReviewRequired
                ? 'Source review required'
                : activeItem.reason === 'manual-practice'
                  ? 'Manual practice'
                  : activeItem.reason === 'surprise-practice'
                    ? 'Surprise practice'
                    : activeItem.due
                      ? 'Due review'
                      : 'New or upcoming'}
          </span>
          {onClosePreview ? (
            <button
              onClick={onClosePreview}
              className="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300"
            >
              Close Preview
            </button>
          ) : null}
        </div>
      </div>
      {previewMode ? (
        <section className="rounded border border-amber-700 bg-amber-950/30 p-3 text-sm text-amber-100">
          Preview mode - progress and review history will not be changed.
        </section>
      ) : null}
      <section className="rounded border border-slate-800 bg-slate-900 p-4">
        <div className="text-xs uppercase tracking-wide text-slate-500">Prompt</div>
        <div className="mt-2 text-base text-slate-100">{activeItem.prompt.question}</div>
      </section>
      <StudySchedulerDiagnostics activeItem={activeItem} />
      {sourceReviewRequired ? (
        <section className="rounded border border-amber-800 bg-amber-950/30 p-4">
          <div className="text-sm font-semibold text-amber-100">
            Review the official source before studying this unit.
          </div>
          <p className="mt-2 text-sm text-amber-200">
            Source acknowledgement is separate from memory review and will not change FSRS
            scheduling.
          </p>
          {onOpenUnit ? (
            <button
              onClick={() => onOpenUnit(activeItem.unit.id)}
              className="mt-3 rounded bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-500"
            >
              Open Unit Source
            </button>
          ) : null}
        </section>
      ) : null}
      {!sourceReviewRequired ? (
        <>
          {responseMode !== 'guided' ? (
            <section className="rounded border border-slate-800 bg-slate-900 p-4">
              <div className="mb-2 flex items-center justify-between gap-3">
                <label className="text-xs uppercase tracking-wide text-slate-500">
                  Typed Recall
                </label>
                <span className="text-xs text-slate-600">Autosaves locally</span>
              </div>
              <textarea
                value={answer}
                onChange={(event) => onAnswerChange(event.target.value)}
                className="min-h-[18rem] w-full rounded border border-slate-700 bg-slate-950 p-4 text-sm leading-6 text-slate-100"
              />
            </section>
          ) : null}
          {responseMode !== 'free-recall' ? (
            <section className="rounded border border-slate-800 bg-slate-900 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <label className="text-xs uppercase tracking-wide text-slate-500">
                  Guided Prompts
                </label>
                <span className="text-xs text-slate-600">Autosaves locally</span>
              </div>
              <div className="space-y-3">
                {guidedRubrics.map((rubric) => (
                  <label key={rubric.id} className="grid gap-2 text-sm text-slate-200">
                    {rubric.prompt}
                    <textarea
                      value={guidedResponses[rubric.id] ?? ''}
                      onChange={(event) =>
                        onGuidedResponsesChange({
                          ...guidedResponses,
                          [rubric.id]: event.target.value,
                        })
                      }
                      className="min-h-24 rounded border border-slate-700 bg-slate-950 p-3 text-sm leading-6 text-slate-100"
                    />
                  </label>
                ))}
                {optionalRubrics.length > 0 ? (
                  <details className="rounded border border-slate-800 bg-slate-950 p-3">
                    <summary className="cursor-pointer text-xs uppercase tracking-wide text-slate-500">
                      Optional guided prompts ({optionalRubrics.length})
                    </summary>
                    <div className="mt-3 space-y-3">
                      {optionalRubrics.map((rubric) => (
                        <label key={rubric.id} className="grid gap-2 text-sm text-slate-200">
                          {rubric.prompt}
                          <textarea
                            value={guidedResponses[rubric.id] ?? ''}
                            onChange={(event) =>
                              onGuidedResponsesChange({
                                ...guidedResponses,
                                [rubric.id]: event.target.value,
                              })
                            }
                            className="min-h-24 rounded border border-slate-700 bg-slate-950 p-3 text-sm leading-6 text-slate-100"
                          />
                        </label>
                      ))}
                    </div>
                  </details>
                ) : null}
              </div>
            </section>
          ) : null}
          {!revealed ? (
            <button
              onClick={() => onRevealChange(true)}
              className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
            >
              Reveal
            </button>
          ) : (
            <div className="space-y-4">
              {responseMode === 'guided' ? null : (
                <section className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded border border-slate-800 bg-slate-900 p-4">
                    <div className="text-xs uppercase tracking-wide text-slate-500">
                      Your Answer
                    </div>
                    <div className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-200">
                      {answer || 'No answer entered.'}
                    </div>
                  </div>
                  <div className="rounded border border-slate-800 bg-slate-900 p-4">
                    <div className="text-xs uppercase tracking-wide text-slate-500">
                      Reference Answer
                    </div>
                    <div className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-200">
                      {activeItem.prompt.referenceAnswer || activeItem.unit.referenceAnswer}
                    </div>
                  </div>
                </section>
              )}
              <section className="rounded border border-slate-800 bg-slate-900 p-4">
                <div className="text-xs uppercase tracking-wide text-slate-500">Answer Rubric</div>
                <div className="mt-3 space-y-3">
                  {activeItem.rubrics.map((rubric) => {
                    const selected = rubricCoverage.find(
                      (entry) => entry.rubricItemId === rubric.id,
                    )?.status;
                    return (
                      <div
                        key={rubric.id}
                        className="rounded border border-slate-800 bg-slate-950 p-3"
                      >
                        <div className="font-medium text-slate-100">{rubric.prompt}</div>
                        {responseMode !== 'free-recall' ? (
                          <div className="mt-2 rounded border border-slate-800 bg-slate-900 p-3">
                            <div className="text-xs uppercase tracking-wide text-slate-500">
                              User response
                            </div>
                            <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-200">
                              {guidedResponses[rubric.id] || 'No guided response entered.'}
                            </div>
                          </div>
                        ) : null}
                        <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-300">
                          {rubric.referenceAnswer ||
                            'No reference answer has been set for this rubric item.'}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {COVERAGE_OPTIONS.map((option) => (
                            <button
                              key={option.status}
                              onClick={() =>
                                onRubricCoverageChange([
                                  ...rubricCoverage.filter(
                                    (entry) => entry.rubricItemId !== rubric.id,
                                  ),
                                  { rubricItemId: rubric.id, status: option.status },
                                ])
                              }
                              className={`rounded px-3 py-1.5 text-xs ${
                                selected === option.status
                                  ? 'bg-emerald-600 text-white'
                                  : 'bg-slate-800 text-slate-300'
                              }`}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
              {sourceText ? (
                <details className="rounded border border-slate-800 bg-slate-900 p-4">
                  <summary className="cursor-pointer text-xs uppercase tracking-wide text-slate-500">
                    Exact Official Source Text
                  </summary>
                  <div className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-200">
                    {sourceText}
                  </div>
                </details>
              ) : null}
              <section className="rounded border border-slate-800 bg-slate-900 p-4">
                <div className="text-xs uppercase tracking-wide text-slate-500">
                  Keywords / Concepts
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {activeItem.concepts.map((concept) => (
                    <label
                      key={concept.id}
                      className="flex items-center gap-2 rounded bg-slate-950 px-3 py-2 text-sm text-slate-300"
                    >
                      <input
                        type="checkbox"
                        checked={coveredConceptIds.includes(concept.id)}
                        onChange={() => onToggleConcept(concept.id)}
                        className="h-4 w-4"
                      />
                      <span>{concept.label}</span>
                    </label>
                  ))}
                </div>
              </section>
              {!previewMode ? (
                <div className="space-y-2">
                  <div className="text-sm font-medium text-slate-200">
                    How well did you remember this unit?
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {RATINGS.map(({ rating, label, className }) => (
                      <button
                        key={rating}
                        onClick={() => onRate(rating)}
                        disabled={ratingPending}
                        title={previewByRating.get(rating)?.due}
                        className={`min-w-24 rounded px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
                      >
                        <span className="block">{label}</span>
                        <span className="mt-1 block text-xs font-normal text-white/80">
                          {previewByRating.get(rating)?.intervalLabel ?? ''}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
};

export default StudySessionPage;
