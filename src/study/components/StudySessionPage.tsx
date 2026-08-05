import type { StudyRating, StudySessionItem } from '../studyTypes';
import { StudyEmptyState } from './StudyLayout';

type StudySessionPageProps = {
  activeItem: StudySessionItem | null;
  answer: string;
  onAnswerChange: (_answer: string) => void;
  revealed: boolean;
  onRevealChange: (_revealed: boolean) => void;
  coveredConceptIds: string[];
  onToggleConcept: (_conceptId: string) => void;
  onRate: (_rating: StudyRating) => Promise<void>;
};

const RATINGS: Array<{ rating: StudyRating; label: string; className: string }> = [
  { rating: 'again', label: 'Again', className: 'bg-rose-700 hover:bg-rose-600' },
  { rating: 'hard', label: 'Hard', className: 'bg-amber-700 hover:bg-amber-600' },
  { rating: 'good', label: 'Good', className: 'bg-emerald-700 hover:bg-emerald-600' },
  { rating: 'easy', label: 'Easy', className: 'bg-sky-700 hover:bg-sky-600' },
];

const StudySessionPage = ({
  activeItem,
  answer,
  onAnswerChange,
  revealed,
  onRevealChange,
  coveredConceptIds,
  onToggleConcept,
  onRate,
}: StudySessionPageProps) => {
  if (!activeItem) return <StudyEmptyState text="No study units are available." />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white">Study Session</h2>
          <p className="text-sm text-slate-500">
            {activeItem.unit.title} · {activeItem.progress.phase} · priority {activeItem.unit.priority}
          </p>
        </div>
        <span className="rounded bg-slate-900 px-3 py-1.5 text-xs text-slate-400">
          {activeItem.due ? 'Due review' : 'New or upcoming'}
        </span>
      </div>
      <section className="rounded border border-slate-800 bg-slate-900 p-4">
        <div className="text-xs uppercase tracking-wide text-slate-500">Prompt</div>
        <div className="mt-2 text-base text-slate-100">{activeItem.prompt.question}</div>
      </section>
      <section className="rounded border border-slate-800 bg-slate-900 p-4">
        <div className="mb-2 flex items-center justify-between gap-3">
          <label className="text-xs uppercase tracking-wide text-slate-500">Typed Recall</label>
          <span className="text-xs text-slate-600">Autosaves locally</span>
        </div>
        <textarea
          value={answer}
          onChange={(event) => onAnswerChange(event.target.value)}
          className="min-h-[18rem] w-full rounded border border-slate-700 bg-slate-950 p-4 text-sm leading-6 text-slate-100"
        />
      </section>
      {!revealed ? (
        <button
          onClick={() => onRevealChange(true)}
          className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
        >
          Reveal
        </button>
      ) : (
        <div className="space-y-4">
          <section className="grid gap-4 lg:grid-cols-2">
            <div className="rounded border border-slate-800 bg-slate-900 p-4">
              <div className="text-xs uppercase tracking-wide text-slate-500">Your Answer</div>
              <div className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-200">
                {answer || 'No answer entered.'}
              </div>
            </div>
            <div className="rounded border border-slate-800 bg-slate-900 p-4">
              <div className="text-xs uppercase tracking-wide text-slate-500">Reference Answer</div>
              <div className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-200">
                {activeItem.prompt.referenceAnswer || activeItem.unit.referenceAnswer}
              </div>
            </div>
          </section>
          <section className="rounded border border-slate-800 bg-slate-900 p-4">
            <div className="text-xs uppercase tracking-wide text-slate-500">Required Concepts</div>
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
          <div className="flex flex-wrap gap-2">
            {RATINGS.map(({ rating, label, className }) => (
              <button
                key={rating}
                onClick={() => onRate(rating)}
                className={`rounded px-4 py-2 text-sm font-medium text-white ${className}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default StudySessionPage;
