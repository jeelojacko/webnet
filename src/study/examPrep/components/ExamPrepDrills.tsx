// Exam Prep — Lookup Drills view.
//
// Phase 2.5 learner/readiness UX over the 24 frozen drills:
//  - a top summary of readiness statuses (Exam-ready / Accurate / Developing
//    / Unattempted) plus the Exam-ready definition note,
//  - a deterministic Recommended drill block (compact summary + Go to drill,
//    never a duplicated interactive card),
//  - two local, combinable filters: status (All / Needs Work / each status,
//    where Needs Work = Developing + Accurate exactly) and difficulty (All /
//    Direct / Routing / Cross-document), and
//  - the canonical drill list rendered through the shared ExamDrillCard
//    (each card still owns its timer/reveal/self-assessment session state;
//    attempts are immutable and saved explicitly).
//
// Filter state is component-local only — nothing is persisted.

import { useMemo, useState } from 'react';
import type { ExamPrepAttempt, ExamPrepDrillAttempt } from '../examPrepTypes';
import {
  EXAM_PREP_DRILL_DIFFICULTY_LABELS,
  EXAM_PREP_DRILL_STATUS_LABELS,
  EXAM_PREP_DRILL_UNITS,
  buildExamPrepDrillRows,
  buildExamPrepDrillStatusCounts,
  examPrepDrillReadinessReason,
  filterExamPrepDrillRows,
  type ExamPrepDrillDifficultyFilter,
  type ExamPrepDrillStatusFilter,
} from '../examPrepDrillFilters';
import { selectRecommendedExamPrepDrill as selectRecommendedDrillRow } from '../examPrepRecommendations';
import { ExamDrillCard } from './examDrillCard';

export type ExamPrepDrillsViewProps = {
  attempts: ExamPrepAttempt[];
  onOpenProvision: (_documentId: string, _sourceKey: string) => void;
  onSaveDrillAttempt: (_attempt: ExamPrepDrillAttempt) => Promise<void>;
  onNavigate?: (_path: string) => void;
};

const difficultyCounts = (
  rows: ReturnType<typeof buildExamPrepDrillRows>,
): Record<ExamPrepDrillDifficultyFilter, number> => {
  const counts: Record<ExamPrepDrillDifficultyFilter, number> = {
    all: rows.length,
    direct: 0,
    routing: 0,
    cross_document: 0,
  };
  for (const row of rows) {
    const difficulty = row.unit.drill?.difficulty;
    if (difficulty) counts[difficulty] += 1;
  }
  return counts;
};

export const ExamPrepDrillsView = ({
  attempts,
  onOpenProvision,
  onSaveDrillAttempt,
  onNavigate,
}: ExamPrepDrillsViewProps) => {
  const [statusFilter, setStatusFilter] = useState<ExamPrepDrillStatusFilter>('all');
  const [difficultyFilter, setDifficultyFilter] =
    useState<ExamPrepDrillDifficultyFilter>('all');

  const rows = useMemo(() => buildExamPrepDrillRows(EXAM_PREP_DRILL_UNITS, attempts), [attempts]);
  const counts = useMemo(() => buildExamPrepDrillStatusCounts(rows), [rows]);
  const byDifficulty = useMemo(() => difficultyCounts(rows), [rows]);
  const recommended = useMemo(() => selectRecommendedDrillRow(attempts), [attempts]);
  const visibleRows = useMemo(
    () => filterExamPrepDrillRows(rows, statusFilter, difficultyFilter),
    [difficultyFilter, rows, statusFilter],
  );
  const recommendationReason = recommended
    ? examPrepDrillReadinessReason(recommended.stats)
    : null;

  const goToDrill = (drillId: string) => {
    // Clear any filter that could hide the card, then reveal it after the
    // re-render settles.
    if (statusFilter !== 'all' || difficultyFilter !== 'all') {
      setStatusFilter('all');
      setDifficultyFilter('all');
    }
    window.setTimeout(() => {
      document
        .getElementById(`exam-drill-${drillId}`)
        ?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    }, 0);
  };

  const statusButtons: Array<{ key: ExamPrepDrillStatusFilter; label: string }> = [
    { key: 'all', label: `All (${counts.total})` },
    { key: 'needs_work', label: `Needs Work (${counts.needsWork})` },
    { key: 'unattempted', label: `Unattempted (${counts.unattempted})` },
    { key: 'developing', label: `Developing (${counts.developing})` },
    { key: 'accurate', label: `Accurate (${counts.accurate})` },
    { key: 'exam_ready', label: `Exam-ready (${counts.examReady})` },
  ];
  const difficultyButtons: Array<{ key: ExamPrepDrillDifficultyFilter; label: string }> = [
    { key: 'all', label: `All difficulties (${byDifficulty.all})` },
    { key: 'direct', label: `${EXAM_PREP_DRILL_DIFFICULTY_LABELS.direct} (${byDifficulty.direct})` },
    { key: 'routing', label: `${EXAM_PREP_DRILL_DIFFICULTY_LABELS.routing} (${byDifficulty.routing})` },
    {
      key: 'cross_document',
      label: `${EXAM_PREP_DRILL_DIFFICULTY_LABELS.cross_document} (${byDifficulty.cross_document})`,
    },
  ];

  return (
    <div className="space-y-4">
      <section className="rounded border border-emerald-800 bg-emerald-950 p-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-emerald-300">
          Lookup Drills
          <span className="ml-2 font-normal normal-case text-slate-500">
            {counts.total} drills · self-assessed results are saved locally
          </span>
        </h3>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-300">
            Exam-ready {counts.examReady}
          </span>
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-300">
            Accurate {counts.accurate}
          </span>
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-amber-200/90">
            Developing {counts.developing}
          </span>
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-400">
            Unattempted {counts.unattempted}
          </span>
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-500">
            {counts.attempted} / {counts.total} attempted
          </span>
        </div>
        <p className="mt-2 text-[11px] italic text-slate-500">
          Exam-ready = 3/3 within the target time on two different practice dates.
        </p>
      </section>

      {recommended ? (
        <section className="rounded border border-amber-800/70 bg-amber-950/40 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs uppercase tracking-wide text-amber-300">
                Recommended drill
              </div>
              <p className="mt-1 text-sm font-semibold text-white">
                <span className="font-mono text-xs text-amber-200">{recommended.unit.id}</span>
                <span className="ml-2">{recommended.unit.title}</span>
              </p>
              <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
                <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-300">
                  Status: {EXAM_PREP_DRILL_STATUS_LABELS[recommended.stats.status]}
                </span>
                <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-400">
                  review: {recommended.unit.reviewWeight}
                </span>
              </div>
              {recommendationReason ? (
                <p className="mt-1 text-[11px] italic text-slate-400">{recommendationReason}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => goToDrill(recommended.unit.id)}
              className="rounded border border-amber-700 bg-amber-900 px-3 py-1.5 text-xs font-semibold text-amber-100 hover:bg-amber-800"
            >
              Go to drill
            </button>
          </div>
        </section>
      ) : (
        <section className="rounded border border-emerald-800/60 bg-emerald-950/30 p-3">
          <div className="text-xs font-semibold text-emerald-200">
            Every drill is Exam-ready — nothing is recommended right now.
          </div>
        </section>
      )}

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
          <span className="text-[11px] uppercase tracking-wide text-slate-500">Status</span>
          {statusButtons.map((button) => (
            <button
              key={button.key}
              type="button"
              onClick={() => setStatusFilter(button.key)}
              className={`rounded px-2 py-1 ${
                statusFilter === button.key
                  ? 'bg-emerald-900 text-emerald-100'
                  : 'bg-slate-800 hover:bg-slate-700'
              }`}
            >
              {button.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
          <span className="text-[11px] uppercase tracking-wide text-slate-500">Difficulty</span>
          {difficultyButtons.map((button) => (
            <button
              key={button.key}
              type="button"
              onClick={() => setDifficultyFilter(button.key)}
              className={`rounded px-2 py-1 ${
                difficultyFilter === button.key
                  ? 'bg-emerald-900 text-emerald-100'
                  : 'bg-slate-800 hover:bg-slate-700'
              }`}
            >
              {button.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-slate-600">
          Needs Work = Developing + Accurate. Accurate means the answer was correct but the
          two-date within-target readiness criterion is not yet demonstrated.
        </p>
      </div>

      <div className="space-y-2">
        {visibleRows.map((row) => (
          <ExamDrillCard
            key={row.unit.id}
            unit={row.unit}
            onOpenProvision={onOpenProvision}
            attempts={attempts}
            onSaveAttempt={onSaveDrillAttempt}
            onNavigate={onNavigate}
          />
        ))}
        {visibleRows.length === 0 ? (
          <p className="rounded border border-slate-800 bg-slate-900/60 p-3 text-xs text-slate-500">
            No drills match the current filters.
          </p>
        ) : null}
      </div>
    </div>
  );
};
