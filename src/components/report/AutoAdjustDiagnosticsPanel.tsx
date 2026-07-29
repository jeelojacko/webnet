import React from 'react';

import type { AdjustmentResult } from '../../types';
import { DiagnosticHeader } from './ReportDiagnosticHeader';
import type { SectionControls, SourceLineRenderer } from './ReportDiagnosticPanels.types';
import type { CollapsibleDetailSectionId } from './reportSectionRegistry';

export const AutoAdjustDiagnosticsPanel: React.FC<
  SectionControls & {
    autoAdjustDiagnostics?: AdjustmentResult['autoAdjustDiagnostics'];
    isSpecialRunMode: boolean;
    renderSourceLineLink: SourceLineRenderer;
  }
> = ({
  autoAdjustDiagnostics,
  isDetailSectionPinned,
  isSectionCollapsed,
  isSpecialRunMode,
  onHeaderRef,
  renderSourceLineLink,
  toggleDetailSection,
  togglePinnedDetailSection,
}) => {
  if (isSpecialRunMode || !autoAdjustDiagnostics?.enabled) return null;
  const sectionId: CollapsibleDetailSectionId = 'auto-adjust-diagnostics';
  return (
    <div className="mb-6 border border-slate-800 rounded overflow-hidden" style={{ order: -207 }}>
      <DiagnosticHeader
        sectionId={sectionId}
        label="Auto-Adjust Diagnostics"
        isDetailSectionPinned={isDetailSectionPinned}
        isSectionCollapsed={isSectionCollapsed}
        onHeaderRef={onHeaderRef}
        toggleDetailSection={toggleDetailSection}
        togglePinnedDetailSection={togglePinnedDetailSection}
      />
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 p-3 text-xs text-slate-300 border-b border-slate-800/60">
        <div>
          <div className="text-slate-500">Threshold</div>
          <div>|t| &gt;= {autoAdjustDiagnostics.threshold.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-slate-500">Max Cycles</div>
          <div>{autoAdjustDiagnostics.maxCycles}</div>
        </div>
        <div>
          <div className="text-slate-500">Max Removals/Cycle</div>
          <div>{autoAdjustDiagnostics.maxRemovalsPerCycle}</div>
        </div>
        <div>
          <div className="text-slate-500">Min Redundancy</div>
          <div>{autoAdjustDiagnostics.minRedundancy.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-slate-500">Stop Reason</div>
          <div>{autoAdjustDiagnostics.stopReason}</div>
        </div>
        <div>
          <div className="text-slate-500">Total Removed</div>
          <div>{autoAdjustDiagnostics.removed.length}</div>
        </div>
      </div>
      {!isSectionCollapsed(sectionId) && (
        <>
          <div className="overflow-x-auto w-full border-b border-slate-800">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="text-slate-200 border-b border-slate-700">
                  <th className="py-2 px-3 font-semibold text-right">Cycle</th>
                  <th className="py-2 px-3 font-semibold text-right">SEUW</th>
                  <th className="py-2 px-3 font-semibold text-right">Max |t|</th>
                  <th className="py-2 px-3 font-semibold text-right">Removals</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {autoAdjustDiagnostics.cycles.map((cycle) => (
                  <tr key={`auto-cycle-${cycle.cycle}`} className="border-b border-slate-800/50">
                    <td className="py-1 px-3 text-right">{cycle.cycle}</td>
                    <td className="py-1 px-3 text-right font-mono">{cycle.seuw.toFixed(4)}</td>
                    <td className="py-1 px-3 text-right font-mono">
                      {cycle.maxAbsStdRes.toFixed(2)}
                    </td>
                    <td className="py-1 px-3 text-right">{cycle.removals.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {autoAdjustDiagnostics.removed.length > 0 && (
            <div className="overflow-x-auto w-full">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="text-slate-200 border-b border-slate-700">
                    <th className="py-2 px-3 font-semibold text-right">Obs ID</th>
                    <th className="py-2 px-3 font-semibold">Type</th>
                    <th className="py-2 px-3 font-semibold">Stations</th>
                    <th className="py-2 px-3 font-semibold text-right">Line</th>
                    <th className="py-2 px-3 font-semibold text-right">|t|</th>
                    <th className="py-2 px-3 font-semibold text-right">Redund</th>
                    <th className="py-2 px-3 font-semibold">Reason</th>
                  </tr>
                </thead>
                <tbody className="text-slate-300">
                  {autoAdjustDiagnostics.removed.map((row, idx) => (
                    <tr
                      key={`auto-removed-${row.obsId}-${row.sourceLine ?? 'na'}-${idx}`}
                      className="border-b border-slate-800/50"
                    >
                      <td className="py-1 px-3 text-right font-mono">{row.obsId}</td>
                      <td className="py-1 px-3 uppercase">{row.type}</td>
                      <td className="py-1 px-3 font-mono">{row.stations}</td>
                      <td className="py-1 px-3 text-right">
                        {renderSourceLineLink(row.sourceLine)}
                      </td>
                      <td className="py-1 px-3 text-right font-mono">{row.stdRes.toFixed(2)}</td>
                      <td className="py-1 px-3 text-right font-mono">
                        {row.redundancy != null ? row.redundancy.toFixed(3) : '-'}
                      </td>
                      <td className="py-1 px-3">{row.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
};
