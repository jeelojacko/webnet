// Exam Prep — Learn view.
//
// Renders exactly the 133 A-D/NAV curriculum units with an independent
// studied/not-studied toggle backed by Exam Prep unit progress. Filtering,
// grouping, REMEMBER/LOOK HERE layout, Navigation display, anchor collapse,
// and source deep links are preserved from the Exam Curriculum browser.

import { useState } from 'react';
import type { ExamCurriculumUnit } from '../../examCurriculum/examCurriculumTypes';
import { EXAM_PREP_LEARN_UNITS } from '../examPrepRecallTasks';
import { EXAM_PREP_DOCUMENT_TITLES } from '../examPrepDocTitles';
import type { ExamPrepUnitProgress } from '../examPrepTypes';
import { selectStudiedForUnit } from '../examPrepSelectors';
import { ExamUnitCard } from './examUnitCard';

export type ExamPrepLearnViewProps = {
  unitProgress: ExamPrepUnitProgress[];
  onOpenProvision: (_documentId: string, _sourceKey: string) => void;
  onToggleUnitStudied: (_unitId: string) => void | Promise<void>;
};

type LearnFilter = 'all' | 'A' | 'B' | 'C' | 'D' | 'NAV';
const FILTER_TIERS = ['A', 'B', 'C', 'D', 'NAV'] as const;

const groupKeyFor = (unit: ExamCurriculumUnit): string =>
  unit.tier === 'NAV' ? 'NAV' : unit.sourceDocumentIds[0];

export const ExamPrepLearnView = ({
  unitProgress,
  onOpenProvision,
  onToggleUnitStudied,
}: ExamPrepLearnViewProps) => {
  const [filter, setFilter] = useState<LearnFilter>('all');
  const tierCount = (tier: (typeof FILTER_TIERS)[number]) =>
    EXAM_PREP_LEARN_UNITS.filter((unit) => unit.tier === tier).length;
  const visibleUnits = EXAM_PREP_LEARN_UNITS.filter((unit) => {
    if (filter === 'all') return true;
    return unit.tier === filter;
  });
  const groups: Array<{ key: string; units: ExamCurriculumUnit[] }> = [];
  for (const unit of visibleUnits) {
    const key = groupKeyFor(unit);
    const group = groups.find((entry) => entry.key === key);
    if (group) group.units.push(unit);
    else groups.push({ key, units: [unit] });
  }
  const orientationCount = visibleUnits.filter(
    (unit) => unit.unitType === 'document_orientation',
  ).length;
  const coreConceptCount = visibleUnits.filter((unit) => unit.unitType === 'core_concept')
    .length;
  const navigationCount = visibleUnits.filter(
    (unit) => unit.unitType === 'cross_document_navigation',
  ).length;
  const filterButtons: Array<{ key: LearnFilter; label: string }> = [
    { key: 'all', label: `All (${EXAM_PREP_LEARN_UNITS.length})` },
    ...FILTER_TIERS.map((tier) => ({
      key: tier,
      label: tier === 'NAV' ? `Navigation (${tierCount(tier)})` : `Tier ${tier} (${tierCount(tier)})`,
    })),
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
        {filterButtons.map((button) => (
          <button
            key={button.key}
            type="button"
            onClick={() => setFilter(button.key)}
            className={`rounded px-2 py-1 ${
              filter === button.key
                ? 'bg-emerald-900 text-emerald-100'
                : 'bg-slate-800 hover:bg-slate-700'
            }`}
          >
            {button.label}
          </button>
        ))}
        <span className="rounded bg-slate-800 px-2 py-1">{orientationCount} document_orientation</span>
        <span className="rounded bg-slate-800 px-2 py-1">{coreConceptCount} core_concept</span>
        <span className="rounded bg-slate-800 px-2 py-1">{navigationCount} cross_document_navigation</span>
      </div>
      <p className="text-xs text-slate-500">
        Mark units studied as you complete them. Studied progress is independent per unit and
        stored locally.
      </p>
      {groups.map((group) => (
        <section key={group.key} className="space-y-2">
          {group.key === 'NAV' ? (
            <h3 className="text-sm font-semibold uppercase tracking-wide text-fuchsia-300">
              Navigation — cross-document routing units
              <span className="ml-2 font-normal normal-case text-slate-500">
                {group.units.length} units
              </span>
            </h3>
          ) : (
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
              {EXAM_PREP_DOCUMENT_TITLES[group.key] ?? group.key}
              <span className="ml-2 font-normal normal-case text-slate-600">
                {group.key} · {group.units.length} units
              </span>
            </h3>
          )}
          <div className="space-y-2">
            {group.units.map((unit) => {
              const studiedState = selectStudiedForUnit(unitProgress, unit.id);
              return (
                <ExamUnitCard
                  key={unit.id}
                  unit={unit}
                  onOpenProvision={onOpenProvision}
                  studied={studiedState.studied}
                  onToggleStudied={() => onToggleUnitStudied(unit.id)}
                />
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
};
