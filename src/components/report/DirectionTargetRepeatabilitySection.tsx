import React from 'react';
import type {
  DirectionTargetDiagnostic,
  HeaderParams,
} from './DirectionDiagnosticsSections.types';
import { formatDirectionStations } from './DirectionDiagnosticsSections.utils';
import type { CollapsibleDetailSectionId } from './reportSectionRegistry';

interface DirectionTargetRepeatabilitySectionProps {
  directionTargetDiagnostics: DirectionTargetDiagnostic[];
  isPreanalysis: boolean;
  isDataCheck: boolean;
  renderCollapsibleSectionHeader: (_params: HeaderParams) => React.ReactNode;
  isSectionCollapsed: (_sectionId: CollapsibleDetailSectionId) => boolean;
  renderSourceLineLink: (_line: number | null | undefined) => React.ReactNode;
}

const DirectionTargetRepeatabilitySection: React.FC<
  DirectionTargetRepeatabilitySectionProps
> = ({
  directionTargetDiagnostics,
  isPreanalysis,
  isDataCheck,
  renderCollapsibleSectionHeader,
  isSectionCollapsed,
  renderSourceLineLink,
}) => {
  const topDirectionTargetDiagnostic = directionTargetDiagnostics[0];
  const directionTargetLocalFailCount = directionTargetDiagnostics.filter(
    (diag) => diag.localPass === false,
  ).length;

  if (isPreanalysis || isDataCheck || directionTargetDiagnostics.length === 0) {
    return null;
  }

  return (
    <div className="mb-6 border border-slate-800 rounded overflow-hidden">
      {renderCollapsibleSectionHeader({
        sectionId: 'direction-target-repeatability',
        label: 'Direction Target Repeatability (ranked)',
        className:
          'px-3 py-2 text-xs uppercase tracking-wider border-b border-slate-700 bg-slate-800/75',
        labelClassName: 'text-slate-100',
      })}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 p-3 text-xs text-slate-300 border-b border-slate-800/60">
        <div>
          <div className="text-slate-500">Targets</div>
          <div>{directionTargetDiagnostics.length}</div>
        </div>
        <div>
          <div className="text-slate-500">Local Fail</div>
          <div className={directionTargetLocalFailCount > 0 ? 'text-red-400' : ''}>
            {directionTargetLocalFailCount}
          </div>
        </div>
        <div>
          <div className="text-slate-500">Worst Spread (&quot;)</div>
          <div>{topDirectionTargetDiagnostic?.rawSpreadArcSec != null ? topDirectionTargetDiagnostic.rawSpreadArcSec.toFixed(2) : '-'}</div>
        </div>
        <div>
          <div className="text-slate-500">Worst Score</div>
          <div>{topDirectionTargetDiagnostic ? topDirectionTargetDiagnostic.suspectScore.toFixed(1) : '-'}</div>
        </div>
        <div>
          <div className="text-slate-500">Top Target</div>
          <div className="font-mono">
            {topDirectionTargetDiagnostic
              ? formatDirectionStations(topDirectionTargetDiagnostic.occupy, topDirectionTargetDiagnostic.target)
              : '-'}
          </div>
        </div>
      </div>
      {!isSectionCollapsed('direction-target-repeatability') && (
        <div className="overflow-x-auto w-full">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="text-slate-200 border-b border-slate-700">
                <th className="py-2 px-3 font-semibold">#</th>
                <th className="py-2 px-3 font-semibold">Set</th>
                <th className="py-2 px-3 font-semibold">Occupy</th>
                <th className="py-2 px-3 font-semibold">Target</th>
                <th className="py-2 px-3 font-semibold text-right">Line</th>
                <th className="py-2 px-3 font-semibold text-right">Raw</th>
                <th className="py-2 px-3 font-semibold text-right">F1</th>
                <th className="py-2 px-3 font-semibold text-right">F2</th>
                <th className="py-2 px-3 font-semibold text-right">Spread (")</th>
                <th className="py-2 px-3 font-semibold text-right">RawMax (")</th>
                <th className="py-2 px-3 font-semibold text-right">PairDelta (")</th>
                <th className="py-2 px-3 font-semibold text-right">F1Spread (")</th>
                <th className="py-2 px-3 font-semibold text-right">F2Spread (")</th>
                <th className="py-2 px-3 font-semibold text-right">Red Sigma (")</th>
                <th className="py-2 px-3 font-semibold text-right">Residual (")</th>
                <th className="py-2 px-3 font-semibold text-right">StdRes</th>
                <th className="py-2 px-3 font-semibold text-right">Local</th>
                <th className="py-2 px-3 font-semibold text-right">MDB (")</th>
                <th className="py-2 px-3 font-semibold text-right">Score</th>
              </tr>
            </thead>
            <tbody className="text-slate-300">
              {directionTargetDiagnostics.map((d, idx) => (
                <tr key={`${d.setId}-${d.occupy}-${d.target}-${idx}`} className="border-b border-slate-800/50">
                  <td className="py-1 px-3 text-slate-500">{idx + 1}</td>
                  <td className="py-1 px-3">{d.setId}</td>
                  <td className="py-1 px-3">{d.occupy}</td>
                  <td className="py-1 px-3">{d.target}</td>
                  <td className="py-1 px-3 text-right text-slate-500">{renderSourceLineLink(d.sourceLine)}</td>
                  <td className="py-1 px-3 text-right">{d.rawCount}</td>
                  <td className="py-1 px-3 text-right">{d.face1Count}</td>
                  <td className="py-1 px-3 text-right">{d.face2Count}</td>
                  <td className="py-1 px-3 text-right">{d.rawSpreadArcSec != null ? d.rawSpreadArcSec.toFixed(2) : '-'}</td>
                  <td className="py-1 px-3 text-right">{d.rawMaxResidualArcSec != null ? d.rawMaxResidualArcSec.toFixed(2) : '-'}</td>
                  <td className="py-1 px-3 text-right">{d.facePairDeltaArcSec != null ? d.facePairDeltaArcSec.toFixed(2) : '-'}</td>
                  <td className="py-1 px-3 text-right">{d.face1SpreadArcSec != null ? d.face1SpreadArcSec.toFixed(2) : '-'}</td>
                  <td className="py-1 px-3 text-right">{d.face2SpreadArcSec != null ? d.face2SpreadArcSec.toFixed(2) : '-'}</td>
                  <td className="py-1 px-3 text-right">{d.reducedSigmaArcSec != null ? d.reducedSigmaArcSec.toFixed(2) : '-'}</td>
                  <td className="py-1 px-3 text-right">{d.residualArcSec != null ? d.residualArcSec.toFixed(2) : '-'}</td>
                  <td className="py-1 px-3 text-right">{d.stdRes != null ? d.stdRes.toFixed(2) : '-'}</td>
                  <td className={`py-1 px-3 text-right ${d.localPass === false ? 'text-red-400' : ''}`}>
                    {d.localPass == null ? '-' : d.localPass ? 'PASS' : 'FAIL'}
                  </td>
                  <td className="py-1 px-3 text-right">{d.mdbArcSec != null ? d.mdbArcSec.toFixed(2) : '-'}</td>
                  <td className="py-1 px-3 text-right font-mono">{d.suspectScore.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default DirectionTargetRepeatabilitySection;
