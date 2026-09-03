// Exam Curriculum V1 — minimal read-only Tier-A curriculum browser.
//
// Renders the bundled, deterministic manifest (study-content/exam-curriculum/
// nb-sit-exam-curriculum-v1.json). It is deliberately separate from the Study
// Library / Study Map / AI-authored unit flows: metadata only, no legal text.
// REMEMBER (mustRecall) and LOOK HERE (mustLocate) are visually separated, and
// "Open source" reuses the existing statute reader deep-link.

import type React from 'react';
import { BookMarked, GraduationCap, MapPin } from 'lucide-react';
import examCurriculumManifestJson from '../../../study-content/exam-curriculum/nb-sit-exam-curriculum-v1.json';
import type {
  ExamCurriculumManifest,
  ExamCurriculumUnit,
} from './examCurriculumTypes';
import { EXAM_CURRICULUM_TIER_A_DOCUMENT_TITLES } from './examCurriculumCatalog';

type ExamCurriculumPageProps = {
  onOpenProvision: (_documentId: string, _sourceKey: string) => void;
};

const manifest = examCurriculumManifestJson as unknown as ExamCurriculumManifest;

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

const UnitCard = ({ unit, onOpenProvision }: { unit: ExamCurriculumUnit; onOpenProvision: ExamCurriculumPageProps['onOpenProvision'] }) => {
  return (
    <section className="rounded border border-slate-800 bg-slate-900 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-emerald-400">{unit.id}</span>
        <span
          className={`rounded px-1.5 py-0.5 text-[11px] uppercase tracking-wide ${
            unit.unitType === 'document_orientation' ? 'bg-sky-900 text-sky-200' : 'bg-indigo-900 text-indigo-200'
          }`}
        >
          {unit.unitType}
        </span>
        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px] text-slate-400">
          review: {unit.reviewWeight}
        </span>
        <DepthBadges unit={unit} />
      </div>
      <h4 className="mt-2 text-sm font-semibold text-white">{unit.title}</h4>
      <p className="mt-1 text-xs text-slate-400">{unit.examGoal}</p>
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
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <div className="rounded border border-amber-900/60 bg-amber-950/30 p-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-300">
            <BookMarked size={14} />
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
                <li key={`${lookup.prompt}-${lookup.sourceKey ?? ''}`} className="flex items-start justify-between gap-2">
                  <span className="min-w-0 flex-1">{lookup.prompt}</span>
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
                  key={anchor.sourceKey}
                  documentId={anchor.documentId}
                  sourceKey={anchor.sourceKey}
                  label={anchor.label}
                  onOpenProvision={onOpenProvision}
                />
              ))
            : (
              <span className="px-1 text-[11px] text-slate-500">Sources: {unit.sourceAnchors.length} provisions resolved (full list in canonical manifest)</span>
            )}
        </div>
      </div>
    </section>
  );
};

const ExamCurriculumPage = ({ onOpenProvision }: ExamCurriculumPageProps) => {
  const groups: Array<{ documentId: string; units: ExamCurriculumUnit[] }> = [];
  for (const unit of manifest.units) {
    const documentId = unit.sourceDocumentIds[0];
    const group = groups.find((g) => g.documentId === documentId);
    if (group) group.units.push(unit);
    else groups.push({ documentId, units: [unit] });
  }
  const orientationCount = manifest.units.filter((u) => u.unitType === 'document_orientation').length;
  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <GraduationCap className="text-emerald-400" size={20} />
          <h2 className="text-xl font-semibold text-white">Exam Curriculum — Tier A</h2>
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
          <span className="rounded bg-slate-800 px-2 py-1">{manifest.units.length} units</span>
          <span className="rounded bg-slate-800 px-2 py-1">{orientationCount} document_orientation</span>
          <span className="rounded bg-slate-800 px-2 py-1">
            {manifest.units.length - orientationCount} core_concept
          </span>
        </div>
      </div>
      {groups.map((group) => (
        <section key={group.documentId} className="space-y-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            {EXAM_CURRICULUM_TIER_A_DOCUMENT_TITLES[group.documentId] ?? group.documentId}
            <span className="ml-2 font-normal normal-case text-slate-600">
              {group.documentId} · {group.units.length} units
            </span>
          </h3>
          <div className="space-y-2">
            {group.units.map((unit) => (
              <UnitCard key={unit.id} unit={unit} onOpenProvision={onOpenProvision} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
};

export default ExamCurriculumPage;
