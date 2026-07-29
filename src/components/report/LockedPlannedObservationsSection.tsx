import type React from 'react';

import type { Observation } from '../../types';
import { PreanalysisHeader } from './ReportPreanalysisHeader';
import type {
  ObservationFormatter,
  SectionControls,
  SourceLineRenderer,
  TooltipResolver,
} from './ReportPreanalysisSections.types';

export const LockedPlannedObservationsSection: React.FC<
  SectionControls & {
    fixedSigmaLabel: ObservationFormatter;
    isPreanalysis: boolean;
    lockedPreanalysisObservations: Observation[];
    observationStationsLabel: ObservationFormatter;
    observationValueLabel: ObservationFormatter;
    preanalysisLabelTooltip: TooltipResolver;
    renderSourceLineLink: SourceLineRenderer;
  }
> = ({
  fixedSigmaLabel,
  isPreanalysis,
  isSectionCollapsed,
  lockedPreanalysisObservations,
  observationStationsLabel,
  observationValueLabel,
  preanalysisLabelTooltip,
  renderSourceLineLink,
  ...controls
}) => {
  if (!isPreanalysis || lockedPreanalysisObservations.length === 0) return null;

  return (
    <div className="mb-6 border border-slate-800 rounded overflow-hidden opacity-75">
      <PreanalysisHeader
        {...controls}
        isSectionCollapsed={isSectionCollapsed}
        sectionId="locked-planned-observations"
        label="Locked Planned Observations"
        title={preanalysisLabelTooltip('Locked Planned Observations')}
      />
      {!isSectionCollapsed('locked-planned-observations') && (
        <>
          <div className="px-3 py-2 text-xs text-slate-500 bg-slate-950/30 border-b border-slate-800/60">
            These planned rows use fixed sigma weighting, remain visible for context, and are not
            removable from what-if actions.
          </div>
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-slate-200 border-b border-slate-700/80">
                <th className="py-2 px-3">#</th>
                <th className="py-2">Type</th>
                <th className="py-2">Stations</th>
                <th className="py-2 text-right">Line</th>
                <th className="py-2 text-right">Obs</th>
                <th className="py-2 text-right">Fixed Sigma</th>
                <th className="py-2 px-3">Note</th>
              </tr>
            </thead>
            <tbody className="text-slate-500">
              {lockedPreanalysisObservations.map((obs, idx) => (
                <tr
                  key={`locked-preanalysis-${obs.id}-${idx}`}
                  className="border-b border-slate-800/40 bg-slate-950/20"
                >
                  <td className="py-1 px-3">{idx + 1}</td>
                  <td className="py-1 uppercase">{obs.type}</td>
                  <td className="py-1">{observationStationsLabel(obs)}</td>
                  <td className="py-1 text-right font-mono">
                    {renderSourceLineLink(obs.sourceLine)}
                  </td>
                  <td className="py-1 text-right font-mono">{observationValueLabel(obs)}</td>
                  <td className="py-1 text-right font-mono">{fixedSigmaLabel(obs)}</td>
                  <td className="py-1 px-3">
                    Locked planned constraint; excluded from what-if actions.
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
};
