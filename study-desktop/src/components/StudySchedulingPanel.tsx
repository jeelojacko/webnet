import { getLatestEligibleSchedulingAttemptForUnit } from '../studyStateUpdates';
import type { StudyDataSnapshot, StudyUnit } from '../studyTypes';
import type { StudySchedulingSummary } from '../studySchedulingDisplay';

type StudySchedulingPanelProps = {
  data: StudyDataSnapshot;
  unit: StudyUnit;
  summary: StudySchedulingSummary;
  onUndoLatestRating?: (_unitId: string) => Promise<void>;
};

const StudySchedulingPanel = ({
  data,
  unit,
  summary,
  onUndoLatestRating,
}: StudySchedulingPanelProps) => {
  const eligibleUndo = getLatestEligibleSchedulingAttemptForUnit(data.attempts, unit.id);
  return (
    <section className="rounded border border-slate-800 bg-slate-950 p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs uppercase tracking-wide text-slate-500">Scheduling</div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded bg-slate-900 px-2 py-1 text-xs text-emerald-300">
            {summary.label}
          </span>
          {eligibleUndo && onUndoLatestRating ? (
            <button
              type="button"
              onClick={() => void onUndoLatestRating(unit.id)}
              className="rounded border border-amber-700 px-2 py-1 text-xs text-amber-100 hover:bg-amber-900/40"
            >
              Undo last counted review
            </button>
          ) : null}
        </div>
      </div>
      <div className="grid gap-2 text-sm text-slate-300 sm:grid-cols-2">
        <div>
          <span className="text-slate-500">State: </span>
          {summary.stateLabel}
        </div>
        <div>
          <span className="text-slate-500">Due: </span>
          {summary.dueLabel}
        </div>
        <div>
          <span className="text-slate-500">Last reviewed: </span>
          {summary.lastReviewedLabel}
        </div>
        <div>
          <span className="text-slate-500">Reviews: </span>
          {summary.reviews ?? 0}
        </div>
        <div>
          <span className="text-slate-500">Lapses: </span>
          {summary.lapses ?? 0}
        </div>
      </div>
      <details className="mt-3 text-xs text-slate-400">
        <summary className="cursor-pointer text-slate-500">Advanced scheduling values</summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <div>Due ISO: {summary.dueAt ?? 'not scheduled'}</div>
          <div>Stability: {summary.stability?.toFixed(3) ?? 'n/a'}</div>
          <div>Difficulty: {summary.difficulty?.toFixed(3) ?? 'n/a'}</div>
        </div>
      </details>
    </section>
  );
};

export default StudySchedulingPanel;
