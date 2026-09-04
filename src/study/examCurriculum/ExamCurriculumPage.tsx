// Exam Curriculum V1 — minimal read-only Tier-A curriculum browser.
//
// Renders the bundled, deterministic manifest (study-content/exam-curriculum/
// nb-sit-exam-curriculum-v1.json). It is deliberately separate from the Study
// Library / Study Map / AI-authored unit flows: metadata only, no legal text.
// REMEMBER (mustRecall) and LOOK HERE (mustLocate) are visually separated, and
// "Open source" reuses the existing statute reader deep-link.

import type React from 'react';
import { useState, useRef, useEffect } from 'react';
import { BookOpen, GraduationCap, MapPin, Timer } from 'lucide-react';
import examCurriculumManifestJson from '../../../study-content/exam-curriculum/nb-sit-exam-curriculum-v1.json';
import type {
  ExamCurriculumManifest,
  ExamCurriculumUnit,
} from './examCurriculumTypes';
import { EXAM_CURRICULUM_TIER_A_DOCUMENT_TITLES } from './examCurriculumCatalog';
import { EXAM_CURRICULUM_TIER_B_DOCUMENT_TITLES } from './examCurriculumCatalogTierB';
import {
  EXAM_CURRICULUM_TIER_C_DOCUMENT_TITLES,
  EXAM_CURRICULUM_TIER_D_DOCUMENT_TITLES,
} from './examCurriculumCatalogTierCD';

type ExamCurriculumPageProps = {
  onOpenProvision: (_documentId: string, _sourceKey: string) => void;
};

const manifest = examCurriculumManifestJson as unknown as ExamCurriculumManifest;

const DOCUMENT_TITLES: Record<string, string> = {
  ...EXAM_CURRICULUM_TIER_A_DOCUMENT_TITLES,
  ...EXAM_CURRICULUM_TIER_B_DOCUMENT_TITLES,
  ...EXAM_CURRICULUM_TIER_C_DOCUMENT_TITLES,
  ...EXAM_CURRICULUM_TIER_D_DOCUMENT_TITLES,
};

type TierFilter = 'all' | 'A' | 'B' | 'C' | 'D' | 'NAV' | 'DRILL';
const FILTER_TIERS = ['A', 'B', 'C', 'D', 'NAV'] as const;
const DRILL_DIFFICULTY_LABELS = { direct: 'direct', routing: 'routing', cross_document: 'cross-document' } as const;

const DEPTH_ORDER = ['recognize', 'understand', 'recall', 'retrieve'] as const;

const DepthBadges = ({ unit }: { unit: ExamCurriculumUnit }) => (
  <span className="flex flex-wrap gap-1">
    {DEPTH_ORDER.filter((depth) => unit.learningDepths.includes(depth)).map((depth) => (
      <span key={depth} className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px] uppercase tracking-wide text-slate-400">
        {depth}
      </span>
    ))}
  </span>
);

const OpenSourceButton = ({
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

const typeBadgeClass = (unitType: string) =>
  unitType === 'document_orientation' ? 'bg-sky-900 text-sky-200'
    : unitType === 'cross_document_navigation' ? 'bg-fuchsia-900 text-fuchsia-200'
      : unitType === 'lookup_drill' ? 'bg-emerald-900 text-emerald-200'
        : 'bg-indigo-900 text-indigo-200';

const UnitCard = ({ unit, onOpenProvision }: { unit: ExamCurriculumUnit; onOpenProvision: ExamCurriculumPageProps['onOpenProvision'] }) => {
  const multiDocument = unit.sourceDocumentIds.length > 1;
  const groupedAnchors = new Map<string, { label: string; anchors: ExamCurriculumUnit['sourceAnchors'] }>();
  for (const anchor of unit.sourceAnchors) {
    const key = anchor.documentId;
    const group = groupedAnchors.get(key);
    if (group) group.anchors.push(anchor);
    else groupedAnchors.set(key, { label: DOCUMENT_TITLES[key] ?? key, anchors: [anchor] });
  }
  return (
    <section className="rounded border border-slate-800 bg-slate-900 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-emerald-400">{unit.id}</span>
        <span
          className={`rounded px-1.5 py-0.5 text-[11px] uppercase tracking-wide ${typeBadgeClass(unit.unitType)}`}
        >
          {unit.unitType}
        </span>
        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px] text-slate-400">
          {unit.tier === 'NAV' ? 'Navigation' : unit.tier === 'DRILL' ? 'DRILL' : `Tier ${unit.tier}`}
        </span>
        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px] text-slate-400">
          review: {unit.reviewWeight}
        </span>
        <DepthBadges unit={unit} />
      </div>
      <h4 className="mt-2 text-sm font-semibold text-white">{unit.title}</h4>
      {unit.examGoal ? <p className="mt-1 text-xs text-slate-400">{unit.examGoal}</p> : null}
      {unit.recognitionCues.length > 0 && (
        <div className="mt-2 text-xs text-slate-300">
          <span className="font-semibold uppercase tracking-wide text-slate-500">Recognition cues</span>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {unit.recognitionCues.map((cue) => (
              <li key={cue}>{cue}</li>
            ))}
          </ul>
        </div>
      )}
      {unit.coreUnderstanding.length > 0 && (
        <div className="mt-2 text-xs text-slate-300">
          <span className="font-semibold uppercase tracking-wide text-slate-500">Core understanding</span>
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
                {DOCUMENT_TITLES[documentId] ?? documentId}
                <span className="ml-1 font-mono text-[10px] text-slate-500">
                  {documentId} · {unit.sourceAnchors.filter((a) => a.documentId === documentId).length} anchors
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
            <p className="mt-1 text-xs italic text-slate-500">Nothing to memorize — open-book unit.</p>
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
            <span className="font-normal normal-case text-sky-200/70">(mustLocate)</span>
          </div>
          {unit.mustLocate.length === 0 ? (
            <p className="mt-1 text-xs italic text-slate-500">No lookup targets.</p>
          ) : (
            <ul className="mt-1 space-y-1 text-xs text-sky-100/90">
              {unit.mustLocate.map((lookup) => (
                <li key={`${lookup.documentId}-${lookup.prompt}-${lookup.sourceKey ?? ''}`} className="flex items-start justify-between gap-2">
                  <span className="min-w-0 flex-1">
                    {multiDocument ? (
                      <span className="mr-1 font-mono text-[10px] text-sky-200/60">{DOCUMENT_TITLES[lookup.documentId] ?? lookup.documentId}</span>
                    ) : null}
                    {lookup.prompt}
                  </span>
                  {lookup.sourceKey ? (
                    <OpenSourceButton
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
          Source anchors ({unit.sourceAnchors.length})
        </span>
        <div className="mt-1 flex flex-wrap gap-1">
          {unit.sourceAnchors.length <= 12
            ? unit.sourceAnchors.map((anchor) => (
                <OpenSourceButton
                  key={`${anchor.documentId}-${anchor.sourceKey}`}
                  documentId={anchor.documentId}
                  sourceKey={anchor.sourceKey}
                  label={anchor.label}
                  onOpenProvision={onOpenProvision}
                />
              ))
            : (
              <span className="px-1 text-[11px] text-slate-500">Sources: {unit.sourceAnchors.length} provisions resolved across {unit.sourceDocumentIds.length} document{unit.sourceDocumentIds.length > 1 ? 's' : ''} (full list in canonical manifest)</span>
            )}
        </div>
        {multiDocument && unit.sourceAnchors.length <= 12 && (
          <div className="mt-1 text-[10px] text-slate-600">
            {[...groupedAnchors.keys()].join(' · ')}
          </div>
        )}
      </div>
    </section>
  );
};

const LookupDrillCard = ({ unit, onOpenProvision }: { unit: ExamCurriculumUnit; onOpenProvision: ExamCurriculumPageProps['onOpenProvision'] }) => {
  const [phase, setPhase] = useState<'start' | 'active' | 'reveal'>('start');
  const [elapsed, setElapsed] = useState(0);
  const [textareaValue, setTextareaValue] = useState('');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const drill = unit.drill;

  useEffect(() => {
    if (phase === 'active') {
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [phase]);

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  const handleReset = () => {
    setPhase('start');
    setElapsed(0);
    setTextareaValue('');
    if (timerRef.current) clearInterval(timerRef.current);
  };

  if (!drill) return null;

  return (
    <section className="rounded border border-emerald-800 bg-emerald-950 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-emerald-300">{unit.id}</span>
        <span className="rounded bg-emerald-900 px-1.5 py-0.5 text-[11px] uppercase tracking-wide text-emerald-200">lookup_drill</span>
        <span className="rounded bg-emerald-900 px-1.5 py-0.5 text-[11px] text-emerald-300">DRILL</span>
        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px] text-slate-400">{drill.difficulty}</span>
        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px] text-slate-400">{drill.timeTargetSeconds}s</span>
        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px] text-slate-400">review: {unit.reviewWeight}</span>
      </div>
      <h4 className="mt-2 text-sm font-semibold text-white">{unit.title}</h4>
      {phase === 'start' && (
        <div className="mt-2 space-y-1.5">
          <p className="text-xs text-emerald-100/70">Open-book lookup drill. Click Start to begin.</p>
          <button
            type="button"
            onClick={() => { setElapsed(0); setPhase('active'); }}
            className="rounded border border-emerald-600 bg-emerald-900 px-3 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-800"
          >
            Start
          </button>
        </div>
      )}
      {phase === 'active' && (
        <div className="mt-2 space-y-1.5 text-xs text-emerald-100/90">
          <div>
            <span className="font-semibold uppercase tracking-wide text-emerald-400">Fact pattern</span>
            <p className="mt-0.5">{drill.factPattern}</p>
          </div>
          <div>
            <span className="font-semibold uppercase tracking-wide text-emerald-400">Task</span>
            <p className="mt-0.5">{drill.task}</p>
          </div>
          <div className="rounded border border-emerald-900/60 bg-emerald-900/30 p-2">
            <span className="font-semibold uppercase tracking-wide text-emerald-300">Time: {formatTime(elapsed)}</span>
            <textarea
              value={textareaValue}
              onChange={(e) => setTextareaValue(e.target.value)}
              className="mt-1 w-full rounded border border-slate-700 bg-slate-900 p-1.5 text-xs text-slate-200"
              rows={3}
              placeholder="Type your answer here..."
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => { setPhase('reveal'); if (timerRef.current) clearInterval(timerRef.current); }}
              className="rounded border border-emerald-600 bg-emerald-900 px-3 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-800"
            >
              Reveal ({formatTime(elapsed)})
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="rounded border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-700"
            >
              Reset
            </button>
          </div>
        </div>
      )}
      {phase === 'reveal' && (
        <div className="mt-2 space-y-1.5 text-xs text-emerald-100/90">
          <div className="rounded border border-emerald-900/60 bg-emerald-900/30 p-2">
            <span className="font-semibold uppercase tracking-wide text-emerald-300">Time frozen: {formatTime(elapsed)}</span>
          </div>
          <div className="rounded border border-emerald-900/60 bg-emerald-900/30 p-2">
            <span className="font-semibold uppercase tracking-wide text-emerald-300">Route</span>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {drill.answerKey.requiredLookups.map((lookup, i) => (
                <li key={i}>
                  {lookup.prompt}
                  {lookup.sourceKey ? (
                    <OpenSourceButton
                      documentId={lookup.documentId}
                      sourceKey={lookup.sourceKey}
                      label={lookup.sourceKey.split(':').pop() ?? lookup.sourceKey}
                      onOpenProvision={onOpenProvision}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded border border-emerald-900/60 bg-emerald-900/30 p-2">
            <span className="font-semibold uppercase tracking-wide text-emerald-300">Answer points</span>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {drill.answerKey.requiredAnswerPoints.map((point, i) => (
                <li key={i}>{point}</li>
              ))}
            </ul>
          </div>
          {drill.answerKey.trapExplanation && (
            <div className="rounded border border-amber-900/60 bg-amber-950/30 p-2">
              <span className="font-semibold uppercase tracking-wide text-amber-300">Trap</span>
              <p className="mt-1 text-xs italic text-amber-100/80">{drill.answerKey.trapExplanation}</p>
            </div>
          )}
          {unit.relatedUnitIds.length > 0 && (
            <div className="rounded border border-slate-700 bg-slate-800/50 p-2">
              <span className="font-semibold uppercase tracking-wide text-slate-400">Related</span>
              <p className="mt-1 font-mono text-[11px] text-slate-300">{unit.relatedUnitIds.join(', ')}</p>
            </div>
          )}
          <button
            type="button"
            onClick={handleReset}
            className="rounded border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-700"
          >
            Reset
          </button>
        </div>
      )}
    </section>
  );
};

const ExamCurriculumPage = ({ onOpenProvision }: ExamCurriculumPageProps) => {
  const [tierFilter, setTierFilter] = useState<TierFilter>('all');
  const tierCount = (tier: (typeof FILTER_TIERS)[number]) => manifest.units.filter((u) => u.tier === tier).length;
  const drillCount = manifest.units.filter((u) => u.tier === 'DRILL').length;
  const visibleUnits = manifest.units.filter((unit) => {
    if (tierFilter === 'DRILL') return unit.tier === 'DRILL';
    return tierFilter === 'all' || unit.tier === tierFilter;
  });
  const groups: Array<{ documentId: string; units: ExamCurriculumUnit[] }> = [];
  for (const unit of visibleUnits) {
    const documentId = unit.tier === 'NAV' ? 'NAV' : unit.tier === 'DRILL' ? 'DRILL' : unit.sourceDocumentIds[0];
    const group = groups.find((g) => g.documentId === documentId);
    if (group) group.units.push(unit);
    else groups.push({ documentId, units: [unit] });
  }
  const orientationCount = visibleUnits.filter((u) => u.unitType === 'document_orientation').length;
  const coreConceptCount = visibleUnits.filter((u) => u.unitType === 'core_concept').length;
  const navigationCount = visibleUnits.filter((u) => u.unitType === 'cross_document_navigation').length;
  const drillCountVisible = visibleUnits.filter((u) => u.unitType === 'lookup_drill').length;
  const tierButtons: Array<{ key: TierFilter; label: string }> = [
    { key: 'all', label: `All (${manifest.units.length})` },
    ...FILTER_TIERS.map((tier) => ({
      key: tier,
      label: tier === 'NAV' ? `Navigation (${tierCount(tier)})` : `Tier ${tier} (${tierCount(tier)})`,
    })),
    { key: 'DRILL', label: `DRILL (${drillCount})` },
  ];
  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <GraduationCap className="text-emerald-400" size={20} />
          <h2 className="text-xl font-semibold text-white">Exam Curriculum — Tier A–D + Navigation + DRILL</h2>
        </div>
        <p className="mt-1 max-w-3xl text-sm text-slate-400">
          Open-book statute law exam curriculum. Units define what to recognize, understand, recall and locate;
          exact statutory detail stays in the statutes (open book). This is a separate layer from the Study Map and
          AI-authored study units.
        </p>
        <p className="mt-1 font-mono text-[11px] text-slate-500">
          {manifest.curriculumId} · corpus {manifest.sourcePackageId} ·{' '}
          {manifest.sourceCorpusContentHash.slice(0, 16)}… · hash {manifest.contentHash.slice(0, 16)}…
        </p>
        <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-300">
          {tierButtons.map((button) => (
            <button
              key={button.key}
              type="button"
              onClick={() => setTierFilter(button.key)}
              className={`rounded px-2 py-1 ${
                tierFilter === button.key ? 'bg-emerald-900 text-emerald-100' : 'bg-slate-800 hover:bg-slate-700'
              }`}
            >
              {button.label}
            </button>
          ))}
          <span className="rounded bg-slate-800 px-2 py-1">{orientationCount} document_orientation</span>
          <span className="rounded bg-slate-800 px-2 py-1">{coreConceptCount} core_concept</span>
          <span className="rounded bg-slate-800 px-2 py-1">{navigationCount} cross_document_navigation</span>
          <span className="rounded bg-emerald-900 px-2 py-1">{drillCountVisible} lookup_drill</span>
        </div>
      </div>
      {groups.map((group) => {
        if (group.documentId === 'DRILL') {
          return (
            <section key={group.documentId} className="space-y-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-emerald-300">
                Lookup Drills
                <span className="ml-2 font-normal normal-case text-slate-500">{group.units.length} drills</span>
              </h3>
              <div className="space-y-2">
                {group.units.map((unit) => (
                  <LookupDrillCard key={unit.id} unit={unit} onOpenProvision={onOpenProvision} />
                ))}
              </div>
            </section>
          );
        }
        return (
          <section key={group.documentId} className="space-y-2">
            {group.documentId === 'NAV' ? (
              <h3 className="text-sm font-semibold uppercase tracking-wide text-fuchsia-300">
                Navigation — cross-document routing units
                <span className="ml-2 font-normal normal-case text-slate-500">{group.units.length} units</span>
              </h3>
            ) : (
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
                {DOCUMENT_TITLES[group.documentId] ?? group.documentId}
                <span className="ml-2 font-normal normal-case text-slate-600">
                  {group.documentId} · {group.units.length} units
                </span>
              </h3>
            )}
            <div className="space-y-2">
              {group.units.map((unit) => (
                <UnitCard key={unit.id} unit={unit} onOpenProvision={onOpenProvision} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
};

export default ExamCurriculumPage;
