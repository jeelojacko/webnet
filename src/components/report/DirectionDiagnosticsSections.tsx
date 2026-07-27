import React from 'react';
import { DirectionFaceTreatmentDiagnosticsSection } from './DirectionFaceTreatmentDiagnosticsSection';
import type {
  DirectionDiagnosticsSectionsProps,
  DirectionRepeatabilityDiagnostic,
} from './DirectionDiagnosticsSections.types';
import { formatDirectionStations } from './DirectionDiagnosticsSections.utils';
import DirectionRejectDiagnosticsSection from './DirectionRejectDiagnosticsSection';
import DirectionSetDiagnosticsSection from './DirectionSetDiagnosticsSection';
import DirectionTargetRepeatabilitySection from './DirectionTargetRepeatabilitySection';

export { DirectionFaceTreatmentDiagnosticsSection } from './DirectionFaceTreatmentDiagnosticsSection';

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
  const topDirectionRepeatabilityDiagnostic = directionRepeatabilityDiagnostics[0];
  const topDirectionTargetSuspect = topDirectionTargetSuspects[0];
  const topDirectionRepeatabilitySuspect = topDirectionRepeatabilitySuspects[0];
  const directionRepeatabilityLocalFailCount = directionRepeatabilityDiagnostics.reduce(
    (count, diag) => count + diag.localFailCount,
    0,
  );

  return (
    <>
      <DirectionSetDiagnosticsSection
        directionSetDiagnostics={directionSetDiagnostics}
        isPreanalysis={isPreanalysis}
        isDataCheck={isDataCheck}
        renderCollapsibleSectionHeader={renderCollapsibleSectionHeader}
        isSectionCollapsed={isSectionCollapsed}
      />

      <DirectionTargetRepeatabilitySection
        directionTargetDiagnostics={directionTargetDiagnostics}
        isPreanalysis={isPreanalysis}
        isDataCheck={isDataCheck}
        renderCollapsibleSectionHeader={renderCollapsibleSectionHeader}
        isSectionCollapsed={isSectionCollapsed}
        renderSourceLineLink={renderSourceLineLink}
      />

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

      <DirectionRejectDiagnosticsSection
        directionRejects={directionRejects}
        visibleDirectionRejects={visibleDirectionRejects}
        renderCollapsibleSectionHeader={renderCollapsibleSectionHeader}
        isSectionCollapsed={isSectionCollapsed}
        renderLoadMoreFooter={renderLoadMoreFooter}
        renderSourceLineLink={renderSourceLineLink}
      />

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
