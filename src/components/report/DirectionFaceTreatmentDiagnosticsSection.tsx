import React from 'react';
import type { DirectionSetTreatmentDiagnostic } from '../../types';
import type { HeaderParams } from './DirectionDiagnosticsSections.types';
import type { CollapsibleDetailSectionId } from './reportSectionRegistry';

interface DirectionFaceTreatmentDiagnosticsSectionProps {
  directionTreatmentDiagnostics: DirectionSetTreatmentDiagnostic[];
  isPreanalysis: boolean;
  isDataCheck: boolean;
  renderCollapsibleSectionHeader: (_params: HeaderParams) => React.ReactNode;
  isSectionCollapsed: (_sectionId: CollapsibleDetailSectionId) => boolean;
  renderSourceLineLink: (_line: number | null | undefined) => React.ReactNode;
}

export const DirectionFaceTreatmentDiagnosticsSection: React.FC<
  DirectionFaceTreatmentDiagnosticsSectionProps
> = ({
  directionTreatmentDiagnostics,
  isPreanalysis,
  isDataCheck,
  renderCollapsibleSectionHeader,
  isSectionCollapsed,
  renderSourceLineLink,
}) => {
  const directionFaceUnknownCount = directionTreatmentDiagnostics.filter(
    (diag) => diag.faceSource.toLowerCase() === 'unknown',
  ).length;

  if (isPreanalysis || isDataCheck || directionTreatmentDiagnostics.length === 0) {
    return null;
  }

  return (
    <div className="mb-6 border border-slate-800 rounded overflow-hidden">
      {renderCollapsibleSectionHeader({
        sectionId: 'direction-face-treatment-diagnostics',
        label: 'Direction Face Treatment Diagnostics',
        className:
          'px-3 py-2 text-xs uppercase tracking-wider border-b border-slate-700 bg-slate-800/75',
        labelClassName: 'text-slate-100',
      })}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 p-3 text-xs text-slate-300 border-b border-slate-800/60">
        <div>
          <div className="text-slate-500">Rows</div>
          <div>{directionTreatmentDiagnostics.length}</div>
        </div>
        <div>
          <div className="text-slate-500">Unique Sets</div>
          <div>{new Set(directionTreatmentDiagnostics.map((diag) => diag.setId)).size}</div>
        </div>
        <div>
          <div className="text-slate-500">Unknown FaceSrc</div>
          <div className={directionFaceUnknownCount > 0 ? 'text-yellow-300' : ''}>
            {directionFaceUnknownCount}
          </div>
        </div>
        <div>
          <div className="text-slate-500">Top Decision</div>
          <div>{directionTreatmentDiagnostics[0]?.treatmentDecision ?? '-'}</div>
        </div>
        <div>
          <div className="text-slate-500">Top Set</div>
          <div className="font-mono">
            {directionTreatmentDiagnostics[0]
              ? `${directionTreatmentDiagnostics[0].setId}@${directionTreatmentDiagnostics[0].occupy}`
              : '-'}
          </div>
        </div>
      </div>
      {!isSectionCollapsed('direction-face-treatment-diagnostics') && (
        <div className="overflow-x-auto w-full">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="text-slate-200 border-b border-slate-700">
                <th className="py-2 px-3 font-semibold">#</th>
                <th className="py-2 px-3 font-semibold">Set</th>
                <th className="py-2 px-3 font-semibold">Occupy</th>
                <th className="py-2 px-3 font-semibold text-right">Line</th>
                <th className="py-2 px-3 font-semibold text-right">Readings</th>
                <th className="py-2 px-3 font-semibold text-right">Targets</th>
                <th className="py-2 px-3 font-semibold">FaceSrc</th>
                <th className="py-2 px-3 font-semibold">Decision</th>
                <th className="py-2 px-3 font-semibold">Policy</th>
                <th className="py-2 px-3 font-semibold">Mode</th>
              </tr>
            </thead>
            <tbody className="text-slate-300">
              {directionTreatmentDiagnostics.map((diag, idx) => (
                <tr
                  key={`d-face-${diag.setId}-${diag.occupy}-${diag.sourceLine ?? idx}-${idx}`}
                  className="border-b border-slate-800/50"
                >
                  <td className="py-1 px-3 text-slate-500">{idx + 1}</td>
                  <td className="py-1 px-3">{diag.setId}</td>
                  <td className="py-1 px-3">{diag.occupy}</td>
                  <td className="py-1 px-3 text-right text-slate-500">
                    {renderSourceLineLink(diag.sourceLine)}
                  </td>
                  <td className="py-1 px-3 text-right">{diag.readingCount}</td>
                  <td className="py-1 px-3 text-right">{diag.targetCount}</td>
                  <td className="py-1 px-3">{diag.faceSource}</td>
                  <td className="py-1 px-3">{diag.treatmentDecision}</td>
                  <td className="py-1 px-3">{diag.policyOutcome}</td>
                  <td className="py-1 px-3">{diag.faceNormalizationMode.toUpperCase()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
