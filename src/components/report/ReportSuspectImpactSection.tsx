import React from 'react';

import { confirmActionGuard } from '../../engine/actionGuards';
import type { AdjustmentResult } from '../../types';
import type { SuspectImpactRow } from '../../typesAdjustmentResult';
import {
  describeSuspectImpactFailure,
  formatLooShift,
} from './ReportSuspectImpactSection.utils';
import { semanticTooltip } from '../../engine/statisticalSemantics';
import { QcCategoryTag } from './QcOverviewSection';
import CollapsibleSectionHeader from './CollapsibleSectionHeader';
import type { CollapsibleDetailSectionId } from './reportSectionRegistry';


const describeChiPass = (pass: boolean | undefined): string =>
  pass == null ? '-' : pass ? 'PASS' : 'FAIL';

const formatChiCell = (row: SuspectImpactRow): string => {
  const base = describeChiPass(row.baseChiPass);
  const alt = describeChiPass(row.altChiPass);
  return `${base}->${alt}`;
};

const formatChiTooltip = (row: SuspectImpactRow): string => {
  const part = (
    label: string,
    chi: SuspectImpactRow['baseChi'],
    dof: number | undefined,
  ): string => {
    if (!chi) return `${label}: unavailable (DOF ${dof ?? '-'})`;
    return `${label}: T=${chi.T.toFixed(3)} DOF=${chi.dof} p=${chi.p.toFixed(4)} ${chi.pass ? 'PASS' : 'FAIL'}`;
  };
  return `${part('Base', row.baseChi, row.baseDof)}; ${part('Without obs', row.altChi, row.altDof)}`;
};

const formatSeuwCell = (row: SuspectImpactRow): string => {
  if (row.baseSeuw == null || row.altSeuw == null) return '-';
  return `${row.baseSeuw.toFixed(4)}->${row.altSeuw.toFixed(4)}`;
};

const formatLocalFailsCell = (row: SuspectImpactRow): string => {
  if (row.baseLocalFails == null || row.altLocalFails == null) return '-';
  return `${row.baseLocalFails}->${row.altLocalFails}`;
};

const formatWithoutObsTooltip = (row: SuspectImpactRow): string => {
  const seuw =
    row.baseSeuw != null && row.altSeuw != null
      ? `SEUW base=${row.baseSeuw.toFixed(4)} alt=${row.altSeuw.toFixed(4)}`
      : 'SEUW unavailable';
  const maxStd =
    row.baseMaxStdRes != null && row.altMaxStdRes != null
      ? `max |StdRes| base=${row.baseMaxStdRes.toFixed(2)} alt=${row.altMaxStdRes.toFixed(2)}`
      : 'max |StdRes| unavailable';
  const fails =
    row.baseLocalFails != null && row.altLocalFails != null
      ? `local fails base=${row.baseLocalFails} alt=${row.altLocalFails}`
      : 'local fails unavailable';
  return `${seuw}; ${maxStd}; ${fails}; ${formatChiTooltip(row)}`;
};

const formatShiftCell = (
  row: SuspectImpactRow,
  unitScale: number,
  units: 'm' | 'ft',
): string => {
  if (row.status !== 'ok') return describeSuspectImpactFailure(row);
  if (row.shiftStatus === 'free-network-unavailable')
    return 'unavailable (free-network datum)';
  if (row.maxCoordShift == null || row.mostAffectedStation == null) return '-';
  return `${formatLooShift(row.maxCoordShift, unitScale, units)} @ ${row.mostAffectedStation.id}`;
};

const formatShiftTooltip = (row: SuspectImpactRow): string => {
  if (row.status !== 'ok') return `Without-observation re-solve ${describeSuspectImpactFailure(row)}; no shift computed.`;
  if (row.shiftStatus === 'free-network-unavailable')
    return 'Coordinate shifts unavailable: free-network datum (no fixed control) makes absolute re-solve shifts datum-dependent.';
  const most = row.mostAffectedStation;
  if (!most) return 'No shift computed.';
  return `Most-affected station ${most.id}: dE=${(most.dE * 1000).toFixed(2)}mm dN=${(most.dN * 1000).toFixed(2)}mm dH=${(most.dH * 1000).toFixed(2)}mm horiz=${(most.horiz * 1000).toFixed(2)}mm 3D=${(most.mag3d * 1000).toFixed(2)}mm`;
};

type SourceLineRenderer = (_line: number | null | undefined) => React.ReactNode;

export const ReportSuspectImpactSection: React.FC<{
  excludedIds: Set<number>;
  isDetailSectionPinned: (_id: CollapsibleDetailSectionId) => boolean;
  isPreanalysis: boolean;
  isSectionCollapsed: (_id: CollapsibleDetailSectionId) => boolean;
  isSpecialRunMode: boolean;
  onApplyImpactExclude: (_id: number) => void;
  onHeaderRef: (_id: CollapsibleDetailSectionId, _node: HTMLDivElement | null) => void;
  renderSourceLineLink: SourceLineRenderer;
  suspectImpactActionableCount: number;
  suspectImpactDiagnostics: NonNullable<AdjustmentResult['suspectImpactDiagnostics']>;
  suspectImpactExcludedCount: number;
  suspectImpactWorstBaseStdRes: number;
  toggleDetailSection: (_id: CollapsibleDetailSectionId) => void;
  togglePinnedDetailSection: (_id: CollapsibleDetailSectionId, _label: string) => void;
  unitScale: number;
  units: 'm' | 'ft';
}> = ({
  excludedIds,
  isDetailSectionPinned,
  isPreanalysis,
  isSectionCollapsed,
  isSpecialRunMode,
  onApplyImpactExclude,
  onHeaderRef,
  renderSourceLineLink,
  suspectImpactActionableCount,
  suspectImpactDiagnostics,
  suspectImpactExcludedCount,
  suspectImpactWorstBaseStdRes,
  toggleDetailSection,
  togglePinnedDetailSection,
  unitScale,
  units,
}) => {
  if (isPreanalysis || isSpecialRunMode || suspectImpactDiagnostics.length === 0) return null;
  const sectionId: CollapsibleDetailSectionId = 'suspect-impact-analysis';
  const robust = suspectImpactDiagnostics.some((row) => row.robustReSolve);
  return (
    <div className="mb-8 border border-slate-800 rounded overflow-hidden" style={{ order: -202 }}>
      <CollapsibleSectionHeader
        sectionId={sectionId}
        label="LEAVE-ONE-OUT INFLUENCE"
        title={semanticTooltip('looShift')}
        className="px-4 py-2 border-b border-slate-800 bg-slate-900/60 text-xs uppercase tracking-wider"
        labelClassName="text-slate-100"
        collapsed={isSectionCollapsed(sectionId)}
        pinned={isDetailSectionPinned(sectionId)}
        onToggleCollapse={toggleDetailSection}
        onTogglePin={togglePinnedDetailSection}
        onHeaderRef={onHeaderRef}
      />
      <div className="px-4 py-1 text-[11px] text-slate-400 border-b border-slate-800/60">
        What-if exclusion analysis
        <QcCategoryTag category="what-if" />
        {robust ? ' — Robust re-solve comparison (robust weights active in alternates)' : null}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 text-xs text-slate-300 border-b border-slate-800/60">
        <div>
          <div className="text-slate-500">Candidates</div>
          <div>{suspectImpactDiagnostics.length}</div>
        </div>
        <div>
          <div className="text-slate-500">Actionable</div>
          <div>{suspectImpactActionableCount}</div>
        </div>
        <div>
          <div className="text-slate-500">Excluded</div>
          <div>{suspectImpactExcludedCount}</div>
        </div>
        <div>
          <div className="text-slate-500">Worst Base |StdRes|</div>
          <div>{suspectImpactWorstBaseStdRes.toFixed(2)}</div>
        </div>
      </div>
      {!isSectionCollapsed(sectionId) && (
        <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-slate-200 border-b border-slate-700/80">
              <th className="py-2 px-3">#</th>
              <th className="py-2">Observation</th>
              <th className="py-2">Stations</th>
              <th className="py-2 text-right">Base |StdRes|</th>
              <th className="py-2 text-right">Local</th>
              <th className="py-2 text-right">Without Obs</th>
              <th className="py-2 text-right" title={semanticTooltip('looShift')}>Coord Shift</th>
              <th className="py-2 text-right">Status</th>
              <th className="py-2 text-right px-3">Action</th>
            </tr>
          </thead>
          <tbody className="text-slate-300">
            {suspectImpactDiagnostics.map((d, idx) => {
              const alreadyExcluded = excludedIds.has(d.obsId);
              return (
                <tr key={`impact-${d.obsId}-${idx}`} className="border-b border-slate-800/30">
                  <td className="py-1 px-3 text-slate-500">{idx + 1}</td>
                  <td className="py-1 uppercase text-slate-400">
                    #{d.obsId} {d.type} {renderSourceLineLink(d.sourceLine)}
                  </td>
                  <td className="py-1">{d.stations}</td>
                  <td
                    className="py-1 text-right font-mono"
                    title={
                      d.baseStdRes != null
                        ? `Base standardized residual |StdRes|=${d.baseStdRes.toFixed(2)}`
                        : 'Base standardized residual unavailable'
                    }
                  >
                    {d.baseStdRes != null ? d.baseStdRes.toFixed(2) : '-'}
                  </td>
                  <td
                    className={`py-1 text-right font-mono ${d.baseLocalFail ? 'text-red-400' : ''}`}
                    title={d.baseLocalFail ? 'Base local (single-outlier) test: FAIL' : 'Base local (single-outlier) test: no failure'}
                  >
                    {d.baseLocalFail ? 'FAIL' : '-'}
                  </td>
                  <td className="py-1 text-right font-mono" title={formatWithoutObsTooltip(d)}>
                    {d.status !== 'ok' ? (
                      <span className="text-slate-500">-</span>
                    ) : (
                      <span>
                        SEUW {formatSeuwCell(d)}
                        <br />
                        <span className="text-slate-500">
                          χ² {formatChiCell(d)} · fails {formatLocalFailsCell(d)}
                        </span>
                      </span>
                    )}
                  </td>
                  <td className="py-1 text-right font-mono" title={formatShiftTooltip(d)}>
                    {formatShiftCell(d, unitScale, units)}
                  </td>
                  <td className="py-1 text-right font-mono">
                    {d.status === 'ok' ? 'OK' : `FAILED (${describeSuspectImpactFailure(d)})`}
                  </td>
                  <td className="py-1 px-3 text-right">
                    <button
                      onClick={() => {
                        const confirmed = confirmActionGuard({
                          action: 'exclude-rerun',
                          scope: `${d.type.toUpperCase()} ${d.stations} (line ${d.sourceLine ?? '-'})`,
                          detail:
                            'This marks the observation excluded and immediately reruns the adjustment.',
                        });
                        if (!confirmed) return;
                        onApplyImpactExclude(d.obsId);
                      }}
                      disabled={alreadyExcluded || d.status !== 'ok'}
                      className={`px-2 py-0.5 rounded border text-[10px] ${
                        alreadyExcluded || d.status !== 'ok'
                          ? 'border-slate-700 text-slate-600 cursor-not-allowed'
                          : 'border-blue-600 text-blue-300 hover:bg-blue-900/30'
                      }`}
                    >
                      {alreadyExcluded ? 'Excluded' : d.status !== 'ok' ? 'N/A' : 'Exclude + Re-run'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
};
