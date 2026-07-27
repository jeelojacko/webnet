import React from 'react';
import type {
  DirectionSetDiagnostic,
  HeaderParams,
} from './DirectionDiagnosticsSections.types';
import type { CollapsibleDetailSectionId } from './reportSectionRegistry';

interface DirectionSetDiagnosticsSectionProps {
  directionSetDiagnostics: DirectionSetDiagnostic[];
  isPreanalysis: boolean;
  isDataCheck: boolean;
  renderCollapsibleSectionHeader: (_params: HeaderParams) => React.ReactNode;
  isSectionCollapsed: (_sectionId: CollapsibleDetailSectionId) => boolean;
}

const DirectionSetDiagnosticsSection: React.FC<DirectionSetDiagnosticsSectionProps> = ({
  directionSetDiagnostics,
  isPreanalysis,
  isDataCheck,
  renderCollapsibleSectionHeader,
  isSectionCollapsed,
}) => {
  const topDirectionSetDiagnostic = directionSetDiagnostics[0];
  const underconstrainedDirectionSetCount = directionSetDiagnostics.filter(
    (diag) => diag.underconstrainedOrientation,
  ).length;

  if (isPreanalysis || isDataCheck || directionSetDiagnostics.length === 0) {
    return null;
  }

  return (
    <div className="mb-6 border border-slate-800 rounded overflow-hidden">
      {renderCollapsibleSectionHeader({
        sectionId: 'direction-set-diagnostics',
        label: 'Direction Set Diagnostics',
        className:
          'px-3 py-2 text-xs uppercase tracking-wider border-b border-slate-700 bg-slate-800/75',
        labelClassName: 'text-slate-100',
      })}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 p-3 text-xs text-slate-300 border-b border-slate-800/60">
        <div>
          <div className="text-slate-500">Sets</div>
          <div>{directionSetDiagnostics.length}</div>
        </div>
        <div>
          <div className="text-slate-500">Underconstrained</div>
          <div className={underconstrainedDirectionSetCount > 0 ? 'text-yellow-300' : ''}>
            {underconstrainedDirectionSetCount}
          </div>
        </div>
        <div>
          <div className="text-slate-500">Worst RMS (&quot;)</div>
          <div>
            {topDirectionSetDiagnostic?.residualRmsArcSec != null
              ? topDirectionSetDiagnostic.residualRmsArcSec.toFixed(2)
              : '-'}
          </div>
        </div>
        <div>
          <div className="text-slate-500">Worst PairDelta (&quot;)</div>
          <div>
            {topDirectionSetDiagnostic?.maxFacePairDeltaArcSec != null
              ? topDirectionSetDiagnostic.maxFacePairDeltaArcSec.toFixed(2)
              : '-'}
          </div>
        </div>
        <div>
          <div className="text-slate-500">Top Set</div>
          <div className="font-mono">
            {topDirectionSetDiagnostic
              ? `${topDirectionSetDiagnostic.setId}@${topDirectionSetDiagnostic.occupy}`
              : '-'}
          </div>
        </div>
      </div>
      {!isSectionCollapsed('direction-set-diagnostics') && (
        <div className="overflow-x-auto w-full">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="text-slate-200 border-b border-slate-700">
                <th className="py-2 px-3 font-semibold">Set</th>
                <th className="py-2 px-3 font-semibold">Occupy</th>
                <th className="py-2 px-3 font-semibold text-right">Readings</th>
                <th className="py-2 px-3 font-semibold text-right">Targets</th>
                <th className="py-2 px-3 font-semibold text-right">Under</th>
                <th className="py-2 px-3 font-semibold text-right">Raw</th>
                <th className="py-2 px-3 font-semibold text-right">Reduced</th>
                <th className="py-2 px-3 font-semibold text-right">Pairs</th>
                <th className="py-2 px-3 font-semibold text-right">F1</th>
                <th className="py-2 px-3 font-semibold text-right">F2</th>
                <th className="py-2 px-3 font-semibold text-right">Orient (deg)</th>
                <th className="py-2 px-3 font-semibold text-right">RMS (")</th>
                <th className="py-2 px-3 font-semibold text-right">Max (")</th>
                <th className="py-2 px-3 font-semibold text-right">Mean PairDelta (")</th>
                <th className="py-2 px-3 font-semibold text-right">Max PairDelta (")</th>
                <th className="py-2 px-3 font-semibold text-right">Mean RawMax (")</th>
                <th className="py-2 px-3 font-semibold text-right">Max RawMax (")</th>
                <th className="py-2 px-3 font-semibold text-right">Orient SE (")</th>
              </tr>
            </thead>
            <tbody className="text-slate-300">
              {directionSetDiagnostics.map((d) => (
                <tr key={`${d.setId}-${d.occupy}`} className="border-b border-slate-800/50">
                  <td className="py-1 px-3">{d.setId}</td>
                  <td className="py-1 px-3">{d.occupy}</td>
                  <td className="py-1 px-3 text-right">{d.readingCount}</td>
                  <td className="py-1 px-3 text-right">{d.targetCount}</td>
                  <td className="py-1 px-3 text-right">{d.underconstrainedOrientation ? 'YES' : 'NO'}</td>
                  <td className="py-1 px-3 text-right">{d.rawCount}</td>
                  <td className="py-1 px-3 text-right">{d.reducedCount}</td>
                  <td className="py-1 px-3 text-right">{d.pairedTargets}</td>
                  <td className="py-1 px-3 text-right">{d.face1Count}</td>
                  <td className="py-1 px-3 text-right">{d.face2Count}</td>
                  <td className="py-1 px-3 text-right">{d.orientationDeg != null ? d.orientationDeg.toFixed(4) : '-'}</td>
                  <td className="py-1 px-3 text-right">{d.residualRmsArcSec != null ? d.residualRmsArcSec.toFixed(2) : '-'}</td>
                  <td className="py-1 px-3 text-right">{d.residualMaxArcSec != null ? d.residualMaxArcSec.toFixed(2) : '-'}</td>
                  <td className="py-1 px-3 text-right">{d.meanFacePairDeltaArcSec != null ? d.meanFacePairDeltaArcSec.toFixed(2) : '-'}</td>
                  <td className="py-1 px-3 text-right">{d.maxFacePairDeltaArcSec != null ? d.maxFacePairDeltaArcSec.toFixed(2) : '-'}</td>
                  <td className="py-1 px-3 text-right">{d.meanRawMaxResidualArcSec != null ? d.meanRawMaxResidualArcSec.toFixed(2) : '-'}</td>
                  <td className="py-1 px-3 text-right">{d.maxRawMaxResidualArcSec != null ? d.maxRawMaxResidualArcSec.toFixed(2) : '-'}</td>
                  <td className="py-1 px-3 text-right">{d.orientationSeArcSec != null ? d.orientationSeArcSec.toFixed(2) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default DirectionSetDiagnosticsSection;
