import React from 'react';

import { confirmActionGuard } from '../../engine/actionGuards';
import type { AdjustmentResult } from '../../types';
import CollapsibleSectionHeader from './CollapsibleSectionHeader';
import type { CollapsibleDetailSectionId } from './reportSectionRegistry';

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
  return (
    <div className="mb-8 border border-slate-800 rounded overflow-hidden" style={{ order: -140 }}>
      <CollapsibleSectionHeader
        sectionId={sectionId}
        label="Suspect Impact Analysis (what-if exclusion)"
        className="px-4 py-2 border-b border-slate-800 bg-slate-900/60 text-xs uppercase tracking-wider"
        labelClassName="text-slate-100"
        collapsed={isSectionCollapsed(sectionId)}
        pinned={isDetailSectionPinned(sectionId)}
        onToggleCollapse={toggleDetailSection}
        onTogglePin={togglePinnedDetailSection}
        onHeaderRef={onHeaderRef}
      />
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
          <div className="text-slate-500">Worst Base |t|</div>
          <div>{suspectImpactWorstBaseStdRes.toFixed(2)}</div>
        </div>
      </div>
      {!isSectionCollapsed(sectionId) && (
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-slate-200 border-b border-slate-700/80">
              <th className="py-2 px-3">#</th>
              <th className="py-2">Type</th>
              <th className="py-2">Stations</th>
              <th className="py-2 text-right">Line</th>
              <th className="py-2 text-right">Base |t|</th>
              <th className="py-2 text-right">dSEUW</th>
              <th className="py-2 text-right">dMax|t|</th>
              <th className="py-2 text-right">Chi</th>
              <th className="py-2 text-right">Max Shift ({units})</th>
              <th className="py-2 text-right">Score</th>
              <th className="py-2 text-right px-3">Action</th>
            </tr>
          </thead>
          <tbody className="text-slate-300">
            {suspectImpactDiagnostics.map((d, idx) => {
              const alreadyExcluded = excludedIds.has(d.obsId);
              return (
                <tr key={`impact-${d.obsId}-${idx}`} className="border-b border-slate-800/30">
                  <td className="py-1 px-3 text-slate-500">{idx + 1}</td>
                  <td className="py-1 uppercase text-slate-400">{d.type}</td>
                  <td className="py-1">{d.stations}</td>
                  <td className="py-1 text-right font-mono text-slate-500">
                    {renderSourceLineLink(d.sourceLine)}
                  </td>
                  <td className="py-1 text-right font-mono">
                    {d.baseStdRes != null ? d.baseStdRes.toFixed(2) : '-'}
                  </td>
                  <td className="py-1 text-right font-mono">
                    {d.deltaSeuw != null ? d.deltaSeuw.toFixed(4) : '-'}
                  </td>
                  <td className="py-1 text-right font-mono">
                    {d.deltaMaxStdRes != null ? d.deltaMaxStdRes.toFixed(2) : '-'}
                  </td>
                  <td className="py-1 text-right font-mono">{d.chiDelta}</td>
                  <td className="py-1 text-right font-mono">
                    {d.maxCoordShift != null ? (d.maxCoordShift * unitScale).toFixed(4) : '-'}
                  </td>
                  <td className="py-1 text-right font-mono">
                    {d.score != null ? d.score.toFixed(1) : '-'}
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
      )}
    </div>
  );
};
