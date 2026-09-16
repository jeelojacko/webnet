import React from 'react';

import type { AdjustmentResult } from '../../types';
import {
  buildQcAttention,
  buildQcOverview,
  QC_CATEGORY_LABEL,
  QC_CATEGORY_TOOLTIP,
  type QcAttentionItem,
  type QcAttentionKind,
  type QcCategory,
} from '../../engine/qcOverviewModel';
import { semanticTooltip } from '../../engine/statisticalSemantics';
import type { CollapsibleDetailSectionId } from './reportSectionRegistry';

/** One category indicator per section level (§5); never per cell/row. */
export const QcCategoryTag: React.FC<{ category: QcCategory }> = ({ category }) => (
  <span
    className="ml-2 normal-case tracking-normal text-slate-500"
    title={QC_CATEGORY_TOOLTIP[category]}
  >
    {QC_CATEGORY_LABEL[category].toUpperCase()}
  </span>
);

const OBS_TYPE_SECTION: Record<string, CollapsibleDetailSectionId> = {
  angle: 'angles-ts',
  direction: 'directions-db-dn',
  dist: 'distances-ts',
  bearing: 'bearings-azimuths',
  dir: 'directions-azimuth',
  zenith: 'zenith-vertical-angles',
  gps: 'gps-vectors',
  gnssBaseline: 'gps-vectors',
  lev: 'leveling-dh',
};

const ATTENTION_HEADINGS: Array<{ kind: QcAttentionKind; heading: string }> = [
  { kind: 'formal', heading: 'Formal flags' },
  { kind: 'reliability', heading: 'Reliability concerns' },
  { kind: 'what-if', heading: 'What-if shifts' },
  { kind: 'descriptive', heading: 'Descriptive patterns' },
  { kind: 'stochastic', heading: 'Stochastic scales' },
];

const Link: React.FC<{ title: string; onJump: () => void; children: React.ReactNode }> = ({
  title,
  onJump,
  children,
}) => (
  <button
    type="button"
    onClick={onJump}
    title={title}
    className="font-mono text-blue-300 underline decoration-dotted underline-offset-2 hover:text-blue-200"
  >
    {children}
  </button>
);

/**
 * QUALITY CONTROL OVERVIEW (§7): compact navigation/context card below the
 * Adjustment Summary. Counts only — no quality score, no overall grade, no
 * severity ranking. Counts link to the suspect list, observation sections,
 * or the selected observation through the existing anchor + selection
 * architecture (§30); no router framework involved.
 */
export const QcOverviewSection: React.FC<{
  isDataCheck: boolean;
  isPreanalysis: boolean;
  isSpecialRunMode: boolean;
  result: AdjustmentResult;
  onJumpToSection: (_id: CollapsibleDetailSectionId) => void;
  onSelectObservation?: (_observationId: number) => void;
  /** Active report filters can hide a jump target; when provided the jump clears them first. */
  onClearFilters?: () => void;
}> = ({ isDataCheck, isPreanalysis, isSpecialRunMode, result, onJumpToSection, onSelectObservation, onClearFilters }) => {
  if (isSpecialRunMode || isPreanalysis || isDataCheck) return null;
  const overview = buildQcOverview(result);
  const attention = buildQcAttention(result);

  const jumpToObservation = (obsId: number): void => {
    // Clear active filters first so the target row cannot stay hidden, then
    // select + jump to the section, then scroll to the row itself (the
    // section jump lands on the header only).
    onClearFilters?.();
    onSelectObservation?.(obsId);
    const obs = result.observations.find((o) => o.id === obsId);
    const section = obs ? OBS_TYPE_SECTION[obs.type] : undefined;
    if (section) onJumpToSection(section);
    window.setTimeout(() => {
      document
        .querySelector(`[data-report-observation-row="${obsId}"]`)
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 60);
  };

  const renderItem = (item: QcAttentionItem): React.ReactNode => {
    const target = item.obsId != null ? item.obsId : null;
    if (target == null && item.sectionId == null) {
      return (
        <span title={item.detail}>
          {item.label} — {item.detail}
        </span>
      );
    }
    return (
      <Link
        title={`${item.detail} (jump to ${target != null ? 'observation' : 'section'})`}
        onJump={() => {
          if (target != null) jumpToObservation(target);
          else if (item.sectionId) onJumpToSection(item.sectionId as CollapsibleDetailSectionId);
        }}
      >
        {item.label}
      </Link>
    );
  };

  return (
    <div className="mb-6 border border-slate-800 rounded overflow-hidden" style={{ order: -208 }}>
      <div className="px-4 py-2 border-b border-slate-800 bg-slate-900/60 text-xs uppercase tracking-wider">
        <span className="text-slate-100" title={semanticTooltip('chiSquare')}>
          Quality control overview
        </span>
        <span className="ml-2 normal-case tracking-normal text-slate-500">
          Navigation only — not a grade
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 p-3 text-xs text-slate-300 border-b border-slate-800/60">
        <div>
          <div className="text-slate-500" title={semanticTooltip('chiSquare')}>Chi-square (95%)</div>
          <div className={`font-bold ${overview.chi.pass == null ? '' : overview.chi.pass ? 'text-green-400' : 'text-red-400'}`}>
            {overview.chi.pass == null ? '-' : overview.chi.pass ? 'PASS' : 'FAIL'}
          </div>
        </div>
        <div>
          <div className="text-slate-500" title={semanticTooltip('localTest')}>Local flagged / tested</div>
          <div className="font-mono">
            {overview.local.tested == null ? (
              <span title="Local testing was not run for this result">not analyzed</span>
            ) : overview.loo.candidates > 0 ? (
              <Link
                title="Jump to the leave-one-out suspect list"
                onJump={() => onJumpToSection('suspect-impact-analysis')}
              >
                {overview.local.flagged} flagged of {overview.local.tested} tested ({overview.local.unit})
              </Link>
            ) : (
              <span>
                {overview.local.flagged} flagged of {overview.local.tested} tested ({overview.local.unit})
              </span>
            )}
          </div>
        </div>
        <div>
          <div className="text-slate-500" title={semanticTooltip('coordEff')}>Worst coordinate influence</div>
          <div className="font-mono">
            {overview.coordEff && onSelectObservation ? (
              <Link
                title="Select the worst-influence observation in its table"
                onJump={() => jumpToObservation(overview.coordEff?.obsId as number)}
              >
                {overview.coordEff.primaryMm.toFixed(1)}mm {overview.coordEff.label}
                {overview.coordEff.affectedStation ? ` @ ${overview.coordEff.affectedStation}` : ''}
              </Link>
            ) : (
              <span>{overview.coordEff ? `${overview.coordEff.primaryMm.toFixed(1)}mm ${overview.coordEff.label}` : '-'}</span>
            )}
          </div>
        </div>
        <div>
          <div className="text-slate-500" title={semanticTooltip('diagnosticScale')}>Stochastic estimable groups</div>
          <div className="font-mono">
            {overview.stochastic.estimable == null ? (
              <span title="Stochastic diagnostics are absent for this result">not analyzed</span>
            ) : (
            <>
            {overview.stochastic.estimable}
            {overview.stochastic.largest ? ` · largest ${overview.stochastic.largest.label} ×${overview.stochastic.largest.scale.toFixed(2)}` : ''}
            </>
            )}
          </div>
        </div>
        <div>
          <div className="text-slate-500" title={semanticTooltip('looShift')}>Leave-one-out analyzed</div>
          <div className="font-mono">
            {overview.loo.candidates === 0 ? (
              <span title="No leave-one-out candidates for this result">not analyzed</span>
            ) : overview.loo.largest && onSelectObservation ? (
              <Link
                title="Jump to the leave-one-out suspect list and select the largest shift"
                onJump={() => {
                  onSelectObservation(overview.loo.largest?.obsId as number);
                  onJumpToSection('suspect-impact-analysis');
                }}
              >
                {overview.loo.analyzed} analyzed · largest {(overview.loo.largest.shiftM * 1000).toFixed(2)}mm
              </Link>
            ) : (
              <span>
                {overview.loo.analyzed} analyzed of {overview.loo.candidates} candidates
              </span>
            )}
          </div>
        </div>
        <div>
          <div className="text-slate-500" title={semanticTooltip('systematicTrend')}>Systematic patterns available</div>
          <div className="font-mono">
            {overview.systematic.total > 0 ? (
              <Link
                title="Jump to the systematic pattern diagnostics"
                onJump={() => onJumpToSection('systematic-pattern-diagnostics')}
              >
                {overview.systematic.available} of {overview.systematic.total}
              </Link>
            ) : (
              <span>-</span>
            )}
          </div>
        </div>
      </div>
      <div className="px-4 py-2 text-xs text-slate-300">
        {ATTENTION_HEADINGS.map(({ kind, heading }) => {
          const items = attention[kind];
          if (items.length === 0) return null;
          return (
            <div key={kind} className="mt-1">
              <span className="uppercase tracking-wider text-slate-500 mr-2">{heading}</span>
              <ul className="mt-0.5 space-y-0.5">
                {items.map((item) => (
                  <li key={item.key} className="font-mono text-[11px]">
                    {renderItem(item)}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
};
