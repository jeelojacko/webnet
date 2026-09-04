// Exam Prep — small reusable UI components shared by Learn / Recall / Drills.
//
// Component-only module (fast refresh). Shared display atoms moved out of the
// unit/drill cards so rendering stays single-sourced.

import { MapPin } from 'lucide-react';
import type { ExamCurriculumUnit } from '../../examCurriculum/examCurriculumTypes';
import { EXAM_PREP_LEARNING_DEPTHS } from '../examPrepFormat';

export const EXAM_PREP_DEPTH_BADGES = ({ unit }: { unit: ExamCurriculumUnit }) => (
  <span className="flex flex-wrap gap-1">
    {EXAM_PREP_LEARNING_DEPTHS.filter((depth) => unit.learningDepths.includes(depth)).map(
      (depth) => (
        <span
          key={depth}
          className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px] uppercase tracking-wide text-slate-400"
        >
          {depth}
        </span>
      ),
    )}
  </span>
);

export const EXAM_PREP_UNIT_TYPE_BADGE = ({
  unitType,
}: {
  unitType: ExamCurriculumUnit['unitType'];
}) => (
  <span
    className={`rounded px-1.5 py-0.5 text-[11px] uppercase tracking-wide ${
      unitType === 'document_orientation'
        ? 'bg-sky-900 text-sky-200'
        : unitType === 'cross_document_navigation'
          ? 'bg-fuchsia-900 text-fuchsia-200'
          : unitType === 'lookup_drill'
            ? 'bg-emerald-900 text-emerald-200'
            : 'bg-indigo-900 text-indigo-200'
    }`}
  >
    {unitType}
  </span>
);

export const EXAM_PREP_OPEN_SOURCE_BUTTON = ({
  documentId,
  sourceKey,
  label,
  onOpenProvision,
}: {
  documentId: string;
  sourceKey: string;
  label: string;
  onOpenProvision: (_documentId: string, _sourceKey: string) => void;
}) => (
  <button
    type="button"
    onClick={() => onOpenProvision(documentId, sourceKey)}
    className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700"
    title={`Open ${sourceKey} in the statute reader`}
  >
    <MapPin size={12} className="text-emerald-400" />
    <span className="truncate">{label}</span>
  </button>
);
