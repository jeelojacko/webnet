import React from 'react';

import type { AdjustmentResult } from '../../types';
import { DiagnosticHeader } from './ReportDiagnosticHeader';
import type { SectionControls, SourceLineRenderer } from './ReportDiagnosticPanels.types';
import type { CollapsibleDetailSectionId } from './reportSectionRegistry';

export const AutoSideshotCandidatesPanel: React.FC<
  SectionControls & {
    autoSideshotDiagnostics?: AdjustmentResult['autoSideshotDiagnostics'];
    renderSourceLineLink: SourceLineRenderer;
    showAutoSideshotDiagnosticsSection: boolean;
  }
> = ({
  autoSideshotDiagnostics,
  isDetailSectionPinned,
  isSectionCollapsed,
  onHeaderRef,
  renderSourceLineLink,
  showAutoSideshotDiagnosticsSection,
  toggleDetailSection,
  togglePinnedDetailSection,
}) => {
  if (!showAutoSideshotDiagnosticsSection || !autoSideshotDiagnostics) return null;
  const sectionId: CollapsibleDetailSectionId = 'auto-sideshot-candidates';
  return (
    <div className="mb-6 border border-slate-800 rounded overflow-hidden">
      <DiagnosticHeader
        sectionId={sectionId}
        label="Auto Sideshot Candidates (M Records)"
        isDetailSectionPinned={isDetailSectionPinned}
        isSectionCollapsed={isSectionCollapsed}
        onHeaderRef={onHeaderRef}
        toggleDetailSection={toggleDetailSection}
        togglePinnedDetailSection={togglePinnedDetailSection}
      />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 text-xs text-slate-300 border-b border-slate-800/60">
        <div>
          <div className="text-slate-500">Evaluated M Pairs</div>
          <div>{autoSideshotDiagnostics.evaluatedCount}</div>
        </div>
        <div>
          <div className="text-slate-500">Candidates</div>
          <div>{autoSideshotDiagnostics.candidateCount}</div>
        </div>
        <div>
          <div className="text-slate-500">Excluded Control Targets</div>
          <div>{autoSideshotDiagnostics.excludedControlCount}</div>
        </div>
        <div>
          <div className="text-slate-500">Min Redundancy Threshold</div>
          <div>{autoSideshotDiagnostics.threshold.toFixed(2)}</div>
        </div>
      </div>
      {!isSectionCollapsed(sectionId) && (
        <div className="overflow-x-auto w-full">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="text-slate-200 border-b border-slate-700">
                <th className="py-2 px-3 font-semibold text-right">Line</th>
                <th className="py-2 px-3 font-semibold">Occupy</th>
                <th className="py-2 px-3 font-semibold">Backsight</th>
                <th className="py-2 px-3 font-semibold">Target</th>
                <th className="py-2 px-3 font-semibold text-right">Angle Obs</th>
                <th className="py-2 px-3 font-semibold text-right">Dist Obs</th>
                <th className="py-2 px-3 font-semibold text-right">Angle Red</th>
                <th className="py-2 px-3 font-semibold text-right">Dist Red</th>
                <th className="py-2 px-3 font-semibold text-right">Min Red</th>
                <th className="py-2 px-3 font-semibold text-right">Max |t|</th>
              </tr>
            </thead>
            <tbody className="text-slate-300">
              {autoSideshotDiagnostics.candidates.map((row, idx) => (
                <tr
                  key={`auto-sideshot-${row.sourceLine ?? 'na'}-${row.target}-${idx}`}
                  className="border-b border-slate-800/50"
                >
                  <td className="py-1 px-3 text-right font-mono">
                    {renderSourceLineLink(row.sourceLine)}
                  </td>
                  <td className="py-1 px-3 font-mono">{row.occupy}</td>
                  <td className="py-1 px-3 font-mono">{row.backsight}</td>
                  <td className="py-1 px-3 font-mono">{row.target}</td>
                  <td className="py-1 px-3 text-right font-mono">{row.angleObsId}</td>
                  <td className="py-1 px-3 text-right font-mono">{row.distObsId}</td>
                  <td className="py-1 px-3 text-right font-mono">
                    {row.angleRedundancy.toFixed(3)}
                  </td>
                  <td className="py-1 px-3 text-right font-mono">
                    {row.distRedundancy.toFixed(3)}
                  </td>
                  <td className="py-1 px-3 text-right font-mono">
                    {row.minRedundancy.toFixed(3)}
                  </td>
                  <td className="py-1 px-3 text-right font-mono">
                    {row.maxAbsStdRes.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
