import React from 'react';
import type {
  AdjustmentResult,
  DirectionRejectDiagnostic,
  DirectionSetTreatmentDiagnostic,
} from '../../types';
import {
  REPORT_DIAGNOSTIC_WINDOW_SIZE,
  type CollapsibleDetailSectionId,
} from './reportSectionRegistry';

interface HeaderParams {
  sectionId: CollapsibleDetailSectionId;
  label: string;
  className: string;
  labelClassName: string;
  title?: string;
}

type DirectionSetDiagnostic = NonNullable<AdjustmentResult['directionSetDiagnostics']>[number];
type DirectionTargetDiagnostic = NonNullable<AdjustmentResult['directionTargetDiagnostics']>[number];
type DirectionRepeatabilityDiagnostic = NonNullable<
  AdjustmentResult['directionRepeatabilityDiagnostics']
>[number];

const formatDirectionStations = (occupy: string, target: string) => `${occupy}-${target}`;

interface DirectionDiagnosticsSectionsProps {
  result: AdjustmentResult;
  isPreanalysis: boolean;
  isDataCheck: boolean;
  directionTreatmentDiagnostics: DirectionSetTreatmentDiagnostic[];
  directionRejects: DirectionRejectDiagnostic[];
  visibleDirectionRejects: DirectionRejectDiagnostic[];
  topDirectionTargetSuspects: DirectionTargetDiagnostic[];
  topDirectionRepeatabilitySuspects: DirectionRepeatabilityDiagnostic[];
  renderCollapsibleSectionHeader: (_params: HeaderParams) => React.ReactNode;
  isSectionCollapsed: (_sectionId: CollapsibleDetailSectionId) => boolean;
  renderLoadMoreFooter: (
    _key: string,
    _shownCount: number,
    _totalCount: number,
    _step?: number,
  ) => React.ReactNode;
  renderSourceLineLink: (_line: number | null | undefined) => React.ReactNode;
  showFaceTreatmentSection?: boolean;
}

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

const DirectionDiagnosticsSections: React.FC<DirectionDiagnosticsSectionsProps> = ({
  result,
  isPreanalysis,
  isDataCheck,
  directionTreatmentDiagnostics,
  directionRejects,
  visibleDirectionRejects,
  topDirectionTargetSuspects,
  topDirectionRepeatabilitySuspects,
  renderCollapsibleSectionHeader,
  isSectionCollapsed,
  renderLoadMoreFooter,
  renderSourceLineLink,
  showFaceTreatmentSection = true,
}) => {
  const directionSetDiagnostics = result.directionSetDiagnostics ?? [];
  const directionTargetDiagnostics = result.directionTargetDiagnostics ?? [];
  const directionRepeatabilityDiagnostics = result.directionRepeatabilityDiagnostics ?? [];
  const topDirectionSetDiagnostic = directionSetDiagnostics[0];
  const topDirectionTargetDiagnostic = directionTargetDiagnostics[0];
  const topDirectionRepeatabilityDiagnostic = directionRepeatabilityDiagnostics[0];
  const topDirectionTargetSuspect = topDirectionTargetSuspects[0];
  const topDirectionRepeatabilitySuspect = topDirectionRepeatabilitySuspects[0];
  const underconstrainedDirectionSetCount = directionSetDiagnostics.filter(
    (diag) => diag.underconstrainedOrientation,
  ).length;
  const directionTargetLocalFailCount = directionTargetDiagnostics.filter(
    (diag) => diag.localPass === false,
  ).length;
  const directionRepeatabilityLocalFailCount = directionRepeatabilityDiagnostics.reduce(
    (count, diag) => count + diag.localFailCount,
    0,
  );
  const directionRejectTargetCount = directionRejects.filter((reject) => reject.target).length;
  const topDirectionReject = directionRejects[0];

  return (
    <>
      {!isPreanalysis &&
        !isDataCheck &&
        directionSetDiagnostics.length > 0 && (
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
                    {directionSetDiagnostics.map((d: DirectionSetDiagnostic) => (
                      <tr key={`${d.setId}-${d.occupy}`} className="border-b border-slate-800/50">
                        <td className="py-1 px-3">{d.setId}</td>
                        <td className="py-1 px-3">{d.occupy}</td>
                        <td className="py-1 px-3 text-right">{d.readingCount}</td>
                        <td className="py-1 px-3 text-right">{d.targetCount}</td>
                        <td className="py-1 px-3 text-right">
                          {d.underconstrainedOrientation ? 'YES' : 'NO'}
                        </td>
                        <td className="py-1 px-3 text-right">{d.rawCount}</td>
                        <td className="py-1 px-3 text-right">{d.reducedCount}</td>
                        <td className="py-1 px-3 text-right">{d.pairedTargets}</td>
                        <td className="py-1 px-3 text-right">{d.face1Count}</td>
                        <td className="py-1 px-3 text-right">{d.face2Count}</td>
                        <td className="py-1 px-3 text-right">
                          {d.orientationDeg != null ? d.orientationDeg.toFixed(4) : '-'}
                        </td>
                        <td className="py-1 px-3 text-right">
                          {d.residualRmsArcSec != null ? d.residualRmsArcSec.toFixed(2) : '-'}
                        </td>
                        <td className="py-1 px-3 text-right">
                          {d.residualMaxArcSec != null ? d.residualMaxArcSec.toFixed(2) : '-'}
                        </td>
                        <td className="py-1 px-3 text-right">
                          {d.meanFacePairDeltaArcSec != null
                            ? d.meanFacePairDeltaArcSec.toFixed(2)
                            : '-'}
                        </td>
                        <td className="py-1 px-3 text-right">
                          {d.maxFacePairDeltaArcSec != null
                            ? d.maxFacePairDeltaArcSec.toFixed(2)
                            : '-'}
                        </td>
                        <td className="py-1 px-3 text-right">
                          {d.meanRawMaxResidualArcSec != null
                            ? d.meanRawMaxResidualArcSec.toFixed(2)
                            : '-'}
                        </td>
                        <td className="py-1 px-3 text-right">
                          {d.maxRawMaxResidualArcSec != null
                            ? d.maxRawMaxResidualArcSec.toFixed(2)
                            : '-'}
                        </td>
                        <td className="py-1 px-3 text-right">
                          {d.orientationSeArcSec != null ? d.orientationSeArcSec.toFixed(2) : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

      {!isPreanalysis &&
        !isDataCheck &&
        directionTargetDiagnostics.length > 0 && (
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
                <div>
                  {topDirectionTargetDiagnostic?.rawSpreadArcSec != null
                    ? topDirectionTargetDiagnostic.rawSpreadArcSec.toFixed(2)
                    : '-'}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Worst Score</div>
                <div>
                  {topDirectionTargetDiagnostic
                    ? topDirectionTargetDiagnostic.suspectScore.toFixed(1)
                    : '-'}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Top Target</div>
                <div className="font-mono">
                  {topDirectionTargetDiagnostic
                    ? formatDirectionStations(
                        topDirectionTargetDiagnostic.occupy,
                        topDirectionTargetDiagnostic.target,
                      )
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
                    {directionTargetDiagnostics.map((d: DirectionTargetDiagnostic, idx) => (
                      <tr
                        key={`${d.setId}-${d.occupy}-${d.target}-${idx}`}
                        className="border-b border-slate-800/50"
                      >
                        <td className="py-1 px-3 text-slate-500">{idx + 1}</td>
                        <td className="py-1 px-3">{d.setId}</td>
                        <td className="py-1 px-3">{d.occupy}</td>
                        <td className="py-1 px-3">{d.target}</td>
                        <td className="py-1 px-3 text-right text-slate-500">
                          {renderSourceLineLink(d.sourceLine)}
                        </td>
                        <td className="py-1 px-3 text-right">{d.rawCount}</td>
                        <td className="py-1 px-3 text-right">{d.face1Count}</td>
                        <td className="py-1 px-3 text-right">{d.face2Count}</td>
                        <td className="py-1 px-3 text-right">
                          {d.rawSpreadArcSec != null ? d.rawSpreadArcSec.toFixed(2) : '-'}
                        </td>
                        <td className="py-1 px-3 text-right">
                          {d.rawMaxResidualArcSec != null
                            ? d.rawMaxResidualArcSec.toFixed(2)
                            : '-'}
                        </td>
                        <td className="py-1 px-3 text-right">
                          {d.facePairDeltaArcSec != null ? d.facePairDeltaArcSec.toFixed(2) : '-'}
                        </td>
                        <td className="py-1 px-3 text-right">
                          {d.face1SpreadArcSec != null ? d.face1SpreadArcSec.toFixed(2) : '-'}
                        </td>
                        <td className="py-1 px-3 text-right">
                          {d.face2SpreadArcSec != null ? d.face2SpreadArcSec.toFixed(2) : '-'}
                        </td>
                        <td className="py-1 px-3 text-right">
                          {d.reducedSigmaArcSec != null ? d.reducedSigmaArcSec.toFixed(2) : '-'}
                        </td>
                        <td className="py-1 px-3 text-right">
                          {d.residualArcSec != null ? d.residualArcSec.toFixed(2) : '-'}
                        </td>
                        <td className="py-1 px-3 text-right">
                          {d.stdRes != null ? d.stdRes.toFixed(2) : '-'}
                        </td>
                        <td
                          className={`py-1 px-3 text-right ${d.localPass === false ? 'text-red-400' : ''}`}
                        >
                          {d.localPass == null ? '-' : d.localPass ? 'PASS' : 'FAIL'}
                        </td>
                        <td className="py-1 px-3 text-right">
                          {d.mdbArcSec != null ? d.mdbArcSec.toFixed(2) : '-'}
                        </td>
                        <td className="py-1 px-3 text-right font-mono">
                          {d.suspectScore.toFixed(1)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

      {showFaceTreatmentSection && (
        <DirectionFaceTreatmentDiagnosticsSection
          directionTreatmentDiagnostics={directionTreatmentDiagnostics}
          isPreanalysis={isPreanalysis}
          isDataCheck={isDataCheck}
          renderCollapsibleSectionHeader={renderCollapsibleSectionHeader}
          isSectionCollapsed={isSectionCollapsed}
          renderSourceLineLink={renderSourceLineLink}
        />
      )}

      {directionRejects.length > 0 && (
        <div className="mb-6 border border-slate-800 rounded overflow-hidden">
          {renderCollapsibleSectionHeader({
            sectionId: 'direction-reject-diagnostics',
            label: 'Direction Reject Diagnostics',
            className:
              'px-3 py-2 text-xs uppercase tracking-wider border-b border-slate-700 bg-slate-800/75',
            labelClassName: 'text-slate-100',
          })}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 p-3 text-xs text-slate-300 border-b border-slate-800/60">
            <div>
              <div className="text-slate-500">Rejects</div>
              <div>{directionRejects.length}</div>
            </div>
            <div>
              <div className="text-slate-500">Target Rows</div>
              <div>{directionRejectTargetCount}</div>
            </div>
            <div>
              <div className="text-slate-500">Visible Rows</div>
              <div>{visibleDirectionRejects.length}</div>
            </div>
            <div>
              <div className="text-slate-500">Top Reason</div>
              <div className="truncate">{topDirectionReject?.detail ?? '-'}</div>
            </div>
            <div>
              <div className="text-slate-500">Top Set</div>
              <div className="font-mono">
                {topDirectionReject ? `${topDirectionReject.setId}@${topDirectionReject.occupy}` : '-'}
              </div>
            </div>
          </div>
          {!isSectionCollapsed('direction-reject-diagnostics') && (
            <div className="overflow-x-auto w-full">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="text-slate-200 border-b border-slate-700">
                    <th className="py-2 px-3 font-semibold">#</th>
                    <th className="py-2 px-3 font-semibold">Set</th>
                    <th className="py-2 px-3 font-semibold">Occupy</th>
                    <th className="py-2 px-3 font-semibold">Target</th>
                    <th className="py-2 px-3 font-semibold text-right">Line</th>
                    <th className="py-2 px-3 font-semibold">Rec</th>
                    <th className="py-2 px-3 font-semibold">Expected</th>
                    <th className="py-2 px-3 font-semibold">Actual</th>
                    <th className="py-2 px-3 font-semibold">FaceSrc</th>
                    <th className="py-2 px-3 font-semibold">Decision</th>
                    <th className="py-2 px-3 font-semibold">Policy</th>
                    <th className="py-2 px-3 font-semibold">Reason</th>
                  </tr>
                </thead>
                <tbody className="text-slate-300">
                  {visibleDirectionRejects.map((r, idx) => (
                    <tr
                      key={`d-rej-${r.setId}-${r.target ?? 'set'}-${r.sourceLine ?? idx}-${idx}`}
                      className="border-b border-slate-800/50"
                    >
                      <td className="py-1 px-3 text-slate-500">{idx + 1}</td>
                      <td className="py-1 px-3">{r.setId}</td>
                      <td className="py-1 px-3">{r.occupy}</td>
                      <td className="py-1 px-3">{r.target ?? '-'}</td>
                      <td className="py-1 px-3 text-right text-slate-500">
                        {renderSourceLineLink(r.sourceLine)}
                      </td>
                      <td className="py-1 px-3">{r.recordType ?? '-'}</td>
                      <td className="py-1 px-3">{r.expectedFace ?? '-'}</td>
                      <td className="py-1 px-3">{r.actualFace ?? '-'}</td>
                      <td className="py-1 px-3">{r.faceSource ?? '-'}</td>
                      <td className="py-1 px-3">{r.treatmentDecision ?? '-'}</td>
                      <td className="py-1 px-3">{r.policyOutcome ?? '-'}</td>
                      <td className="py-1 px-3 text-yellow-300">{r.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {renderLoadMoreFooter(
                'direction-reject-diagnostics',
                visibleDirectionRejects.length,
                directionRejects.length,
                REPORT_DIAGNOSTIC_WINDOW_SIZE,
              )}
            </div>
          )}
        </div>
      )}

      {!isPreanalysis && !isDataCheck && topDirectionTargetSuspects.length > 0 && (
        <div className="mb-8 border border-slate-800 rounded overflow-hidden">
          {renderCollapsibleSectionHeader({
            sectionId: 'direction-target-suspects-top',
            label: 'Direction Target Suspects (top)',
            className:
              'px-4 py-2 border-b border-slate-800 bg-slate-900/60 text-xs uppercase tracking-wider',
            labelClassName: 'text-slate-100',
          })}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 text-xs text-slate-300 border-b border-slate-800/60">
            <div>
              <div className="text-slate-500">Candidates</div>
              <div>{topDirectionTargetSuspects.length}</div>
            </div>
            <div>
              <div className="text-slate-500">Worst Spread (&quot;)</div>
              <div>
                {topDirectionTargetSuspect?.rawSpreadArcSec != null
                  ? topDirectionTargetSuspect.rawSpreadArcSec.toFixed(2)
                  : '-'}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Worst StdRes</div>
              <div>
                {topDirectionTargetSuspect?.stdRes != null
                  ? topDirectionTargetSuspect.stdRes.toFixed(2)
                  : '-'}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Top Score</div>
              <div>{topDirectionTargetSuspect?.suspectScore.toFixed(1) ?? '-'}</div>
            </div>
          </div>
          {!isSectionCollapsed('direction-target-suspects-top') && (
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-slate-200 border-b border-slate-700/80">
                  <th className="py-2 px-3">#</th>
                  <th className="py-2">Set</th>
                  <th className="py-2">Stations</th>
                  <th className="py-2 text-right">Spread (")</th>
                  <th className="py-2 text-right">StdRes</th>
                  <th className="py-2 text-right">Local</th>
                  <th className="py-2 text-right px-3">Score</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {topDirectionTargetSuspects.map((d, idx) => (
                  <tr
                    key={`dts-${d.setId}-${d.occupy}-${d.target}-${idx}`}
                    className="border-b border-slate-800/30"
                  >
                    <td className="py-1 px-3 text-slate-500">{idx + 1}</td>
                    <td className="py-1">{d.setId}</td>
                    <td className="py-1">{`${d.occupy}-${d.target}`}</td>
                    <td className="py-1 text-right font-mono">
                      {d.rawSpreadArcSec != null ? d.rawSpreadArcSec.toFixed(2) : '-'}
                    </td>
                    <td className="py-1 text-right font-mono">
                      {d.stdRes != null ? d.stdRes.toFixed(2) : '-'}
                    </td>
                    <td
                      className={`py-1 text-right font-mono ${d.localPass === false ? 'text-red-400' : ''}`}
                    >
                      {d.localPass == null ? '-' : d.localPass ? 'PASS' : 'FAIL'}
                    </td>
                    <td className="py-1 px-3 text-right font-mono">{d.suspectScore.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {!isPreanalysis &&
        !isDataCheck &&
        directionRepeatabilityDiagnostics.length > 0 && (
          <div className="mb-6 border border-slate-800 rounded overflow-hidden">
            {renderCollapsibleSectionHeader({
              sectionId: 'direction-repeatability-multi-set',
              label: 'Direction Repeatability By Occupy-Target (multi-set)',
              className:
                'px-3 py-2 text-xs uppercase tracking-wider border-b border-slate-700 bg-slate-800/75',
              labelClassName: 'text-slate-100',
            })}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 p-3 text-xs text-slate-300 border-b border-slate-800/60">
              <div>
                <div className="text-slate-500">Occupy-Targets</div>
                <div>{directionRepeatabilityDiagnostics.length}</div>
              </div>
              <div>
                <div className="text-slate-500">Local Fail</div>
                <div className={directionRepeatabilityLocalFailCount > 0 ? 'text-red-400' : ''}>
                  {directionRepeatabilityLocalFailCount}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Worst Range (&quot;)</div>
                <div>
                  {topDirectionRepeatabilityDiagnostic?.residualRangeArcSec != null
                    ? topDirectionRepeatabilityDiagnostic.residualRangeArcSec.toFixed(2)
                    : '-'}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Worst Score</div>
                <div>
                  {topDirectionRepeatabilityDiagnostic
                    ? topDirectionRepeatabilityDiagnostic.suspectScore.toFixed(1)
                    : '-'}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Top Pair</div>
                <div className="font-mono">
                  {topDirectionRepeatabilityDiagnostic
                    ? formatDirectionStations(
                        topDirectionRepeatabilityDiagnostic.occupy,
                        topDirectionRepeatabilityDiagnostic.target,
                      )
                    : '-'}
                </div>
              </div>
            </div>
            {!isSectionCollapsed('direction-repeatability-multi-set') && (
              <div className="overflow-x-auto w-full">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="text-slate-200 border-b border-slate-700">
                      <th className="py-2 px-3 font-semibold">#</th>
                      <th className="py-2 px-3 font-semibold">Occupy</th>
                      <th className="py-2 px-3 font-semibold">Target</th>
                      <th className="py-2 px-3 font-semibold text-right">Sets</th>
                      <th className="py-2 px-3 font-semibold text-right">Local Fail</th>
                      <th className="py-2 px-3 font-semibold text-right">Face Unbal</th>
                      <th className="py-2 px-3 font-semibold text-right">Res Mean (")</th>
                      <th className="py-2 px-3 font-semibold text-right">Res RMS (")</th>
                      <th className="py-2 px-3 font-semibold text-right">Res Range (")</th>
                      <th className="py-2 px-3 font-semibold text-right">Res Max (")</th>
                      <th className="py-2 px-3 font-semibold text-right">RMS |t|</th>
                      <th className="py-2 px-3 font-semibold text-right">Max |t|</th>
                      <th className="py-2 px-3 font-semibold text-right">Spread Mean (")</th>
                      <th className="py-2 px-3 font-semibold text-right">Spread Max (")</th>
                      <th className="py-2 px-3 font-semibold">Worst Set</th>
                      <th className="py-2 px-3 font-semibold text-right">Line</th>
                      <th className="py-2 px-3 font-semibold text-right">Score</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-300">
                    {directionRepeatabilityDiagnostics.map(
                      (d: DirectionRepeatabilityDiagnostic, idx) => (
                        <tr
                          key={`dr-${d.occupy}-${d.target}-${idx}`}
                          className="border-b border-slate-800/50"
                        >
                          <td className="py-1 px-3 text-slate-500">{idx + 1}</td>
                          <td className="py-1 px-3">{d.occupy}</td>
                          <td className="py-1 px-3">{d.target}</td>
                          <td className="py-1 px-3 text-right">{d.setCount}</td>
                          <td
                            className={`py-1 px-3 text-right ${d.localFailCount > 0 ? 'text-red-400' : ''}`}
                          >
                            {d.localFailCount}
                          </td>
                          <td className="py-1 px-3 text-right">{d.faceUnbalancedSets}</td>
                          <td className="py-1 px-3 text-right">
                            {d.residualMeanArcSec != null ? d.residualMeanArcSec.toFixed(2) : '-'}
                          </td>
                          <td className="py-1 px-3 text-right">
                            {d.residualRmsArcSec != null ? d.residualRmsArcSec.toFixed(2) : '-'}
                          </td>
                          <td className="py-1 px-3 text-right">
                            {d.residualRangeArcSec != null
                              ? d.residualRangeArcSec.toFixed(2)
                              : '-'}
                          </td>
                          <td className="py-1 px-3 text-right">
                            {d.residualMaxArcSec != null ? d.residualMaxArcSec.toFixed(2) : '-'}
                          </td>
                          <td className="py-1 px-3 text-right">
                            {d.stdResRms != null ? d.stdResRms.toFixed(2) : '-'}
                          </td>
                          <td className="py-1 px-3 text-right">
                            {d.maxStdRes != null ? d.maxStdRes.toFixed(2) : '-'}
                          </td>
                          <td className="py-1 px-3 text-right">
                            {d.meanRawSpreadArcSec != null
                              ? d.meanRawSpreadArcSec.toFixed(2)
                              : '-'}
                          </td>
                          <td className="py-1 px-3 text-right">
                            {d.maxRawSpreadArcSec != null
                              ? d.maxRawSpreadArcSec.toFixed(2)
                              : '-'}
                          </td>
                          <td className="py-1 px-3 text-slate-400">{d.worstSetId ?? '-'}</td>
                          <td className="py-1 px-3 text-right text-slate-500">
                            {d.worstLine ?? '-'}
                          </td>
                          <td className="py-1 px-3 text-right font-mono">
                            {d.suspectScore.toFixed(1)}
                          </td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

      {!isPreanalysis && !isDataCheck && topDirectionRepeatabilitySuspects.length > 0 && (
        <div className="mb-8 border border-slate-800 rounded overflow-hidden">
          {renderCollapsibleSectionHeader({
            sectionId: 'direction-repeatability-suspects-top',
            label: 'Direction Repeatability Suspects (top)',
            className:
              'px-4 py-2 border-b border-slate-800 bg-slate-900/60 text-xs uppercase tracking-wider',
            labelClassName: 'text-slate-100',
          })}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 text-xs text-slate-300 border-b border-slate-800/60">
            <div>
              <div className="text-slate-500">Candidates</div>
              <div>{topDirectionRepeatabilitySuspects.length}</div>
            </div>
            <div>
              <div className="text-slate-500">Worst Max |t|</div>
              <div>
                {topDirectionRepeatabilitySuspect?.maxStdRes != null
                  ? topDirectionRepeatabilitySuspect.maxStdRes.toFixed(2)
                  : '-'}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Worst Spread Max (&quot;)</div>
              <div>
                {topDirectionRepeatabilitySuspect?.maxRawSpreadArcSec != null
                  ? topDirectionRepeatabilitySuspect.maxRawSpreadArcSec.toFixed(2)
                  : '-'}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Top Score</div>
              <div>{topDirectionRepeatabilitySuspect?.suspectScore.toFixed(1) ?? '-'}</div>
            </div>
          </div>
          {!isSectionCollapsed('direction-repeatability-suspects-top') && (
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-slate-200 border-b border-slate-700/80">
                  <th className="py-2 px-3">#</th>
                  <th className="py-2">Stations</th>
                  <th className="py-2 text-right">Sets</th>
                  <th className="py-2 text-right">Res Range (")</th>
                  <th className="py-2 text-right">Max |t|</th>
                  <th className="py-2 text-right">Spread Max (")</th>
                  <th className="py-2 text-right">Local Fail</th>
                  <th className="py-2 text-right px-3">Score</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {topDirectionRepeatabilitySuspects.map((d, idx) => (
                  <tr
                    key={`drs-${d.occupy}-${d.target}-${idx}`}
                    className="border-b border-slate-800/30"
                  >
                    <td className="py-1 px-3 text-slate-500">{idx + 1}</td>
                    <td className="py-1">{`${d.occupy}-${d.target}`}</td>
                    <td className="py-1 text-right font-mono">{d.setCount}</td>
                    <td className="py-1 text-right font-mono">
                      {d.residualRangeArcSec != null ? d.residualRangeArcSec.toFixed(2) : '-'}
                    </td>
                    <td className="py-1 text-right font-mono">
                      {d.maxStdRes != null ? d.maxStdRes.toFixed(2) : '-'}
                    </td>
                    <td className="py-1 text-right font-mono">
                      {d.maxRawSpreadArcSec != null ? d.maxRawSpreadArcSec.toFixed(2) : '-'}
                    </td>
                    <td
                      className={`py-1 text-right font-mono ${d.localFailCount > 0 ? 'text-red-400' : ''}`}
                    >
                      {d.localFailCount}
                    </td>
                    <td className="py-1 px-3 text-right font-mono">{d.suspectScore.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </>
  );
};

export default DirectionDiagnosticsSections;
