// Exam Prep — shared curriculum unit card.
//
// Ported from the Exam Curriculum browser (UnitCard) without duplication:
// every Learn list renders through this card. An optional studied toggle
// binds Exam Prep unit progress; without a toggle handler the card is the
// plain read-only unit card. REMEMBER vs LOOK HERE stay visually separated,
// multi-document Navigation units list every source document, and large
// anchor lists preview the first anchors with a component-local
// Show all / Show fewer toggle (every anchor stays individually openable,
// duplicates preserved).

import { useState } from 'react';
import { BookOpen, MapPin } from 'lucide-react';
import type { ExamCurriculumUnit } from '../../examCurriculum/examCurriculumTypes';
import { EXAM_PREP_DOCUMENT_TITLES } from '../examPrepDocTitles';
import { examPrepTierLabel } from '../examPrepFormat';
import {
  EXAM_PREP_DEPTH_BADGES,
  EXAM_PREP_OPEN_SOURCE_BUTTON,
  EXAM_PREP_UNIT_TYPE_BADGE,
} from './examPrepBits';

/** Anchors shown before the component-local Show all expands the list. */
export const SOURCE_ANCHOR_PREVIEW_LIMIT = 12;

export type ExamUnitCardProps = {
  unit: ExamCurriculumUnit;
  onOpenProvision: (_documentId: string, _sourceKey: string) => void;
  studied?: boolean;
  onToggleStudied?: () => void;
};

type SourceAnchor = ExamCurriculumUnit['sourceAnchors'][number];

const AnchorChips = ({
  anchors,
  onOpenProvision,
}: {
  anchors: SourceAnchor[];
  onOpenProvision: (_documentId: string, _sourceKey: string) => void;
}) => (
  <div className="mt-1 flex flex-wrap gap-1">
    {anchors.map((anchor, index) => (
      <EXAM_PREP_OPEN_SOURCE_BUTTON
        // Index-suffixed so duplicated (documentId, sourceKey) pairs — which
        // are intentionally never deduplicated — still get stable keys.
        key={`${anchor.documentId}-${anchor.sourceKey}-${index}`}
        documentId={anchor.documentId}
        sourceKey={anchor.sourceKey}
        label={anchor.label}
        onOpenProvision={onOpenProvision}
      />
    ))}
  </div>
);

const StudiedToggle = ({ studied, onToggle }: { studied: boolean; onToggle: () => void }) => (
  <button
    type="button"
    onClick={onToggle}
    aria-pressed={studied}
    className={`rounded px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
      studied
        ? 'bg-emerald-900 text-emerald-100 hover:bg-emerald-800'
        : 'border border-slate-700 bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
    }`}
  >
    {studied ? 'Studied' : 'Not studied'}
  </button>
);

export const ExamUnitCard = ({
  unit,
  onOpenProvision,
  studied = false,
  onToggleStudied,
}: ExamUnitCardProps) => {
  const multiDocument = unit.sourceDocumentIds.length > 1;
  const anchorCount = unit.sourceAnchors.length;
  const hasManyAnchors = anchorCount > SOURCE_ANCHOR_PREVIEW_LIMIT;
  const [showAllAnchors, setShowAllAnchors] = useState(false);
  const visibleAnchors =
    hasManyAnchors && !showAllAnchors
      ? unit.sourceAnchors.slice(0, SOURCE_ANCHOR_PREVIEW_LIMIT)
      : unit.sourceAnchors;
  const groupedAnchors = new Map<
    string,
    { label: string; anchors: ExamCurriculumUnit['sourceAnchors'] }
  >();
  for (const anchor of unit.sourceAnchors) {
    const key = anchor.documentId;
    const group = groupedAnchors.get(key);
    if (group) group.anchors.push(anchor);
    else
      groupedAnchors.set(key, {
        label: EXAM_PREP_DOCUMENT_TITLES[key] ?? key,
        anchors: [anchor],
      });
  }
  return (
    <section className="rounded border border-slate-800 bg-slate-900 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-emerald-400">{unit.id}</span>
        <EXAM_PREP_UNIT_TYPE_BADGE unitType={unit.unitType} />
        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px] text-slate-400">
          {examPrepTierLabel(unit.tier)}
        </span>
        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px] text-slate-400">
          review: {unit.reviewWeight}
        </span>
        <EXAM_PREP_DEPTH_BADGES unit={unit} />
        {onToggleStudied ? (
          <span className="ml-auto">
            <StudiedToggle studied={studied} onToggle={onToggleStudied} />
          </span>
        ) : null}
      </div>
      <h4 className="mt-2 text-sm font-semibold text-white">{unit.title}</h4>
      {unit.examGoal ? <p className="mt-1 text-xs text-slate-400">{unit.examGoal}</p> : null}
      {unit.recognitionCues.length > 0 && (
        <div className="mt-2 text-xs text-slate-300">
          <span className="font-semibold uppercase tracking-wide text-slate-500">
            Recognition cues
          </span>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {unit.recognitionCues.map((cue) => (
              <li key={cue}>{cue}</li>
            ))}
          </ul>
        </div>
      )}
      {unit.coreUnderstanding.length > 0 && (
        <div className="mt-2 text-xs text-slate-300">
          <span className="font-semibold uppercase tracking-wide text-slate-500">
            Core understanding
          </span>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {unit.coreUnderstanding.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </div>
      )}
      {multiDocument && (
        <div className="mt-2 text-xs text-slate-300">
          <span className="font-semibold uppercase tracking-wide text-slate-500">Documents</span>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {unit.sourceDocumentIds.map((documentId) => (
              <li key={documentId}>
                {EXAM_PREP_DOCUMENT_TITLES[documentId] ?? documentId}
                <span className="ml-1 font-mono text-[10px] text-slate-500">
                  {documentId} ·{' '}
                  {unit.sourceAnchors.filter((a) => a.documentId === documentId).length} anchors
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <div className="rounded border border-amber-900/60 bg-amber-950/30 p-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-300">
            <BookOpen size={14} />
            Remember
            <span className="font-normal normal-case text-amber-200/70">(mustRecall)</span>
          </div>
          {unit.mustRecall.length === 0 ? (
            <p className="mt-1 text-xs italic text-slate-500">
              Nothing to memorize — open-book unit.
            </p>
          ) : (
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-amber-100/90">
              {unit.mustRecall.map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded border border-sky-900/60 bg-sky-950/30 p-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-sky-300">
            <MapPin size={14} />
            Look Here
            <span className="font-normal normal-case text-sky-200/70">
              Exam lookup targets · mustLocate
            </span>
          </div>
          {unit.mustLocate.length === 0 ? (
            <p className="mt-1 text-xs italic text-slate-500">No lookup targets.</p>
          ) : (
            <ul className="mt-1 space-y-1 text-xs text-sky-100/90">
              {unit.mustLocate.map((lookup) => (
                <li
                  key={`${lookup.documentId}-${lookup.prompt}-${lookup.sourceKey ?? ''}`}
                  className="flex items-start justify-between gap-2"
                >
                  <span className="min-w-0 flex-1">
                    {multiDocument ? (
                      <span className="mr-1 font-mono text-[10px] text-sky-200/60">
                        {EXAM_PREP_DOCUMENT_TITLES[lookup.documentId] ?? lookup.documentId}
                      </span>
                    ) : null}
                    {lookup.prompt}
                  </span>
                  {lookup.sourceKey ? (
                    <EXAM_PREP_OPEN_SOURCE_BUTTON
                      documentId={lookup.documentId}
                      sourceKey={lookup.sourceKey}
                      label={lookup.sourceKey.split(':').pop() ?? lookup.sourceKey}
                      onOpenProvision={onOpenProvision}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="mt-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Supporting sources ({unit.sourceAnchors.length})
          <span className="ml-1 font-normal normal-case text-slate-600">sourceAnchors</span>
        </span>
        <AnchorChips anchors={visibleAnchors} onOpenProvision={onOpenProvision} />
        {hasManyAnchors ? (
          <button
            type="button"
            onClick={() => setShowAllAnchors((current) => !current)}
            aria-expanded={showAllAnchors}
            className="mt-1 rounded border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300 hover:bg-slate-800"
          >
            {showAllAnchors
              ? 'Show fewer'
              : `Show all ${unit.sourceAnchors.length} anchors`}
          </button>
        ) : null}
        {multiDocument && visibleAnchors.length === unit.sourceAnchors.length && (
          <div className="mt-1 text-[10px] text-slate-600">
            {[...groupedAnchors.keys()].join(' · ')}
          </div>
        )}
      </div>
    </section>
  );
};
