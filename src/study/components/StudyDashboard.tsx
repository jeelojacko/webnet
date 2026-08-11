import type { StudyDataSnapshot, StudySessionItem } from '../studyTypes';

type StudyDashboardProps = {
  data: StudyDataSnapshot;
  sessionItems: StudySessionItem[];
  onNavigate: (_path: string) => void;
  onSurprisePractice: () => void;
};

const Stat = ({ label, value }: { label: string; value: string | number }) => (
  <div className="rounded border border-slate-800 bg-slate-900 p-4">
    <div className="text-2xl font-semibold text-white">{value}</div>
    <div className="mt-1 text-xs uppercase tracking-wide text-slate-500">{label}</div>
  </div>
);

const dueReviewReasons = new Set(['learning-due', 'relearning-due', 'review-due']);

const sessionItemLabel = (item: StudySessionItem): string => {
  if (item.reason === 'source-review-required') return 'Source review required';
  if (item.reason === 'learning-due') return 'Learning due';
  if (item.reason === 'relearning-due') return 'Relearning due';
  if (item.reason === 'review-due') return 'Due review';
  if (item.reason === 'new') return 'New';
  if (item.reason === 'manual-practice') return 'Manual practice';
  if (item.reason === 'surprise-practice') return 'Surprise practice';
  return item.due ? 'Due review' : 'New or upcoming';
};

const StudyDashboard = ({
  data,
  sessionItems,
  onNavigate,
  onSurprisePractice,
}: StudyDashboardProps) => {
  const dueCount = sessionItems.filter((item) =>
    item.reason ? dueReviewReasons.has(item.reason) : item.due,
  ).length;
  const sourceReviewCount = sessionItems.filter(
    (item) => item.reason === 'source-review-required',
  ).length;
  const attemptCount = data.attempts.length;
  const phaseCounts = data.progress.reduce<Record<string, number>>((acc, entry) => {
    acc[entry.phase] = (acc[entry.phase] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white">Dashboard</h2>
          <p className="text-sm text-slate-500">Study units, due reviews, and review history.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => onNavigate('/study/session')}
            className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
          >
            Start Session
          </button>
          <button
            onClick={onSurprisePractice}
            className="rounded border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800"
          >
            Surprise Practice
          </button>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Documents" value={data.documents.length} />
        <Stat label="Study Units" value={data.units.length} />
        <Stat label="Due Reviews" value={dueCount} />
        <Stat label="Source Review" value={sourceReviewCount} />
        <Stat label="Attempts" value={attemptCount} />
      </div>
      <section className="rounded border border-slate-800 bg-slate-900">
        <div className="border-b border-slate-800 px-4 py-3 text-sm font-semibold text-slate-200">
          Phase Summary
        </div>
        <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-5">
          {['unread', 'guided-recall', 'free-recall', 'application', 'maintenance'].map((phase) => (
            <div key={phase} className="rounded bg-slate-950 p-3">
              <div className="text-lg font-semibold text-white">{phaseCounts[phase] ?? 0}</div>
              <div className="text-xs text-slate-500">{phase}</div>
            </div>
          ))}
        </div>
      </section>
      <section className="rounded border border-slate-800 bg-slate-900">
        <div className="border-b border-slate-800 px-4 py-3 text-sm font-semibold text-slate-200">
          Next Items
        </div>
        <div className="divide-y divide-slate-800">
          {sessionItems.slice(0, 6).map((item) => (
            <button
              key={`${item.unit.id}:${item.prompt.id}`}
              onClick={() => onNavigate('/study/session')}
              className="grid w-full gap-1 px-4 py-3 text-left hover:bg-slate-800"
            >
              <span className="text-sm font-medium text-slate-100">{item.unit.title}</span>
              <span className="text-xs text-slate-500">
                {sessionItemLabel(item)} · {item.progress.phase} · priority {item.unit.priority}
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
};

export default StudyDashboard;
