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
}

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
}) => {
  return (
    <>
      {!isPreanalysis &&
        !isDataCheck &&
        result.directionSetDiagnostics &&
        result.directionSetDiagnostics.length > 0 && (
          <div className="mb-6 border border-slate-800 rounded overflow-hidden">
            {renderCollapsibleSectionHeader({
              sectionId: 'direction-set-diagnostics',
              label: 'Direction Set Diagnostics',
              className:
                'px-3 py-2 text-xs uppercase tracking-wider border-b border-slate-700 bg-slate-800/75',
              labelClassName: 'text-slate-100',
            })}
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
                    {result.directionSetDiagnostics.map((d: DirectionSetDiagnostic) => (
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
        result.directionTargetDiagnostics &&
        result.directionTargetDiagnostics.length > 0 && (
          <div className="mb-6 border border-slate-800 rounded overflow-hidden">
            {renderCollapsibleSectionHeader({
              sectionId: 'direction-target-repeatability',
              label: 'Direction Target Repeatability (ranked)',
              className:
                'px-3 py-2 text-xs uppercase tracking-wider border-b border-slate-700 bg-slate-800/75',
              labelClassName: 'text-slate-100',
            })}
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
                    {result.directionTargetDiagnostics.map((d: DirectionTargetDiagnostic, idx) => (
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

      {directionTreatmentDiagnostics.length > 0 && (
        <div className="mb-6 border border-slate-800 rounded overflow-hidden">
          {renderCollapsibleSectionHeader({
            sectionId: 'direction-face-treatment-diagnostics',
            label: 'Direction Face Treatment Diagnostics',
            className:
              'px-3 py-2 text-xs uppercase tracking-wider border-b border-slate-700 bg-slate-800/75',
            labelClassName: 'text-slate-100',
          })}
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
        result.directionRepeatabilityDiagnostics &&
        result.directionRepeatabilityDiagnostics.length > 0 && (
          <div className="mb-6 border border-slate-800 rounded overflow-hidden">
            {renderCollapsibleSectionHeader({
              sectionId: 'direction-repeatability-multi-set',
              label: 'Direction Repeatability By Occupy-Target (multi-set)',
              className:
                'px-3 py-2 text-xs uppercase tracking-wider border-b border-slate-700 bg-slate-800/75',
              labelClassName: 'text-slate-100',
            })}
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
                    {result.directionRepeatabilityDiagnostics.map(
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
