import React, { useMemo } from 'react';

import type { AdjustmentResult } from '../../types';
import { PreanalysisHeader } from './ReportPreanalysisHeader';
import { formatFixedOrScientific } from './reportFormatters';
import type {
  SectionControls,
  SourceLineRenderer,
  TooltipResolver,
} from './ReportPreanalysisSections.types';

export { LockedPlannedObservationsSection } from './LockedPlannedObservationsSection';

const formatPreanalysisLinearMetric = (
  valueMeters: number | undefined,
  unitScale: number,
): string => (valueMeters != null ? formatFixedOrScientific(valueMeters * unitScale, 4) : '-');

const formatPreanalysisSetupLabel = (setupStationIds: string[]): string => setupStationIds.join(', ');

const formatPreanalysisSetLabel = (label: string): string => {
  const separatorIndex = label.indexOf('->');
  if (separatorIndex < 0) return label;
  const trimmed = label.slice(separatorIndex + 2).trim();
  return trimmed || label;
};

export const PreanalysisPlanningSummarySection: React.FC<{
  flaggedRelativeCueCount: number;
  flaggedStationCueCount: number;
  isPreanalysis: boolean;
  lockedPreanalysisObservationCount: number;
  parseState: AdjustmentResult['parseState'];
  preanalysisLabelTooltip: TooltipResolver;
  relativeCovarianceCount: number;
  stationCovarianceCount: number;
}> = ({
  flaggedRelativeCueCount,
  flaggedStationCueCount,
  isPreanalysis,
  lockedPreanalysisObservationCount,
  parseState,
  preanalysisLabelTooltip,
  relativeCovarianceCount,
  stationCovarianceCount,
}) => {
  if (!isPreanalysis) return null;

  return (
    <div className="mb-6 border border-cyan-900/70 rounded overflow-hidden">
      <div
        className="px-3 py-2 text-xs text-cyan-200 uppercase tracking-wider border-b border-cyan-900/60 bg-cyan-950/30"
        title={preanalysisLabelTooltip('Preanalysis Planning Summary')}
      >
        Preanalysis Planning Summary
      </div>
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 p-3 text-xs text-slate-300 border-b border-cyan-900/30">
        <div>
          <div className="text-slate-500" title={preanalysisLabelTooltip('Planned Observations')}>
            Planned Observations
          </div>
          <div>{parseState?.plannedObservationCount ?? 0}</div>
        </div>
        <div>
          <div
            className="text-slate-500"
            title={preanalysisLabelTooltip('Station Covariance Blocks')}
          >
            Station Covariance Blocks
          </div>
          <div>{stationCovarianceCount}</div>
        </div>
        <div>
          <div
            className="text-slate-500"
            title={preanalysisLabelTooltip('Connected Pair Blocks')}
          >
            Connected Pair Blocks
          </div>
          <div>{relativeCovarianceCount}</div>
        </div>
        <div>
          <div className="text-slate-500" title={preanalysisLabelTooltip('Weak Stations')}>
            Weak Stations
          </div>
          <div>{flaggedStationCueCount}</div>
        </div>
        <div>
          <div className="text-slate-500" title={preanalysisLabelTooltip('Weak Pairs')}>
            Weak Pairs
          </div>
          <div>{flaggedRelativeCueCount}</div>
        </div>
        <div>
          <div className="text-slate-500" title={preanalysisLabelTooltip('Locked Planned')}>
            Locked Planned
          </div>
          <div>{lockedPreanalysisObservationCount}</div>
        </div>
      </div>
      <div className="px-3 py-2 text-xs text-cyan-100/90 bg-cyan-950/20">
        Predicted covariance uses sigma0^2 = 1.0. Residual-based QC, chi-square, suspect
        ranking, and exclusion workflows are disabled in this mode.
      </div>
    </div>
  );
};

export const PreanalysisRecommendationsSection: React.FC<
  SectionControls & {
    activePreanalysisScenarioIds: Set<string>;
    isPreanalysis: boolean;
    onApplyAllPreanalysisActions: (_ids: string[]) => void;
    onApplyPreanalysisAction: (_id: string) => void;
    preanalysisImpactDiagnostics?: AdjustmentResult['preanalysisImpactDiagnostics'];
    preanalysisLabelTooltip: TooltipResolver;
    renderSourceLineLink: SourceLineRenderer;
    unitScale: number;
    units: 'm' | 'ft';
  }
> = ({
  activePreanalysisScenarioIds,
  isPreanalysis,
  isSectionCollapsed,
  onApplyAllPreanalysisActions,
  onApplyPreanalysisAction,
  preanalysisImpactDiagnostics,
  preanalysisLabelTooltip,
  renderSourceLineLink,
  unitScale,
  units,
  ...controls
}) => {
  const pendingPreanalysisScenarioIds = useMemo(
    () =>
      (preanalysisImpactDiagnostics?.rows ?? [])
        .filter(
          (row) =>
            row.status === 'ok' &&
            row.actionMode !== 'advisory' &&
            !activePreanalysisScenarioIds.has(row.scenarioId),
        )
        .map((row) => row.scenarioId),
    [activePreanalysisScenarioIds, preanalysisImpactDiagnostics?.rows],
  );

  if (!isPreanalysis || !preanalysisImpactDiagnostics?.rows.length) return null;

  const formatLinearMetric = (valueMeters?: number): string =>
    formatPreanalysisLinearMetric(valueMeters, unitScale);

  return (
    <div className="mb-6 border border-slate-800 rounded overflow-hidden">
      <PreanalysisHeader
        {...controls}
        isSectionCollapsed={isSectionCollapsed}
        sectionId="planned-observation-what-if-analysis"
        label="Preanalysis Added-Set / Brace Recommendations"
        title={preanalysisLabelTooltip('Preanalysis Added-Set Recommendations')}
      />
      {!isSectionCollapsed('planned-observation-what-if-analysis') && (
        <>
          <div className="flex items-center justify-end gap-2 px-3 py-2 border-b border-slate-800/60 bg-slate-950/20">
            <button
              type="button"
              onClick={() => onApplyAllPreanalysisActions(pendingPreanalysisScenarioIds)}
              disabled={pendingPreanalysisScenarioIds.length === 0}
              className={`px-2.5 py-1 rounded border text-[10px] uppercase tracking-wide ${
                pendingPreanalysisScenarioIds.length === 0
                  ? 'border-slate-700 text-slate-600 cursor-not-allowed'
                  : 'border-cyan-700 text-cyan-200 hover:bg-cyan-950/30'
              }`}
            >
              Apply All Visible
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-8 gap-3 p-3 text-xs text-slate-300 border-b border-slate-800/60">
            <div>
              <div className="text-slate-500" title={preanalysisLabelTooltip('Applied Added Scenarios')}>
                Applied Scenarios
              </div>
              <div>{preanalysisImpactDiagnostics.activeSyntheticAdditionCount}</div>
            </div>
            <div>
              <div className="text-slate-500" title={preanalysisLabelTooltip('Candidate Added Scenarios')}>
                Candidate Scenarios
              </div>
              <div>{preanalysisImpactDiagnostics.candidateTemplateCount}</div>
            </div>
            <div>
              <div className="text-slate-500" title={preanalysisLabelTooltip('Worst Station Major')}>
                Worst Station Major
              </div>
              <div>
                {preanalysisImpactDiagnostics.baseWorstStationMajor != null
                  ? `${formatLinearMetric(preanalysisImpactDiagnostics.baseWorstStationMajor)} ${units}`
                  : '-'}
              </div>
            </div>
            <div>
              <div className="text-slate-500" title={preanalysisLabelTooltip('Worst Pair SigmaDist')}>
                Worst Pair SigmaDist
              </div>
              <div>
                {preanalysisImpactDiagnostics.baseWorstPairSigmaDist != null
                  ? `${formatLinearMetric(preanalysisImpactDiagnostics.baseWorstPairSigmaDist)} ${units}`
                  : '-'}
              </div>
            </div>
            <div>
              <div className="text-slate-500" title={preanalysisLabelTooltip('Weak Stations')}>
                Weak Stations
              </div>
              <div>{preanalysisImpactDiagnostics.baseWeakStationCount}</div>
            </div>
            <div>
              <div className="text-slate-500" title={preanalysisLabelTooltip('Weak Pairs')}>
                Weak Pairs
              </div>
              <div>{preanalysisImpactDiagnostics.baseWeakPairCount}</div>
            </div>
            <div>
              <div className="text-slate-500" title={preanalysisLabelTooltip('Preanalysis Accuracy Threshold')}>
                Target Threshold
              </div>
              <div>
                {preanalysisImpactDiagnostics.targetThresholdMeters != null
                  ? `${formatLinearMetric(preanalysisImpactDiagnostics.targetThresholdMeters)} ${units}`
                  : '-'}
              </div>
            </div>
            <div>
              <div className="text-slate-500" title={preanalysisLabelTooltip('Threshold Plan Result')}>
                Threshold Plan
              </div>
              <div>
                {preanalysisImpactDiagnostics.thresholdPlan.thresholdReached
                  ? `Reached in ${preanalysisImpactDiagnostics.thresholdPlan.appliedStepCount}`
                  : preanalysisImpactDiagnostics.thresholdPlan.appliedStepCount > 0
                    ? `Best ${preanalysisImpactDiagnostics.thresholdPlan.appliedStepCount}`
                    : 'Not planned'}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3 p-3 text-xs text-slate-300 border-b border-slate-800/60 bg-slate-950/20">
            <div>
              <div className="text-slate-500">Plan Target</div>
              <div>
                {preanalysisImpactDiagnostics.thresholdPlan.targetThresholdMeters != null
                  ? `${formatLinearMetric(
                      preanalysisImpactDiagnostics.thresholdPlan.targetThresholdMeters,
                    )} ${units}`
                  : '-'}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Plan Status</div>
              <div>
                {preanalysisImpactDiagnostics.thresholdPlan.thresholdReached
                  ? 'Reached'
                  : 'Not Reached'}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Sets Needed</div>
              <div>{preanalysisImpactDiagnostics.thresholdPlan.appliedStepCount}</div>
            </div>
            <div>
              <div className="text-slate-500">Projected Worst Major</div>
              <div>
                {preanalysisImpactDiagnostics.thresholdPlan.finalWorstStationMajor != null
                  ? `${formatLinearMetric(
                      preanalysisImpactDiagnostics.thresholdPlan.finalWorstStationMajor,
                    )} ${units}`
                  : '-'}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Plan Note</div>
              <div>{preanalysisImpactDiagnostics.thresholdPlan.unmetReason ?? '-'}</div>
            </div>
          </div>
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-slate-200 border-b border-slate-700/80">
                <th className="py-2 px-3">#</th>
                <th className="py-2">Setup</th>
                <th className="py-2">Set</th>
                <th className="py-2 text-right">Lines</th>
                <th className="py-2 text-right">Added Obs</th>
                <th className="py-2 text-right">dWorstMaj ({units})</th>
                <th className="py-2 text-right">dMedianMaj ({units})</th>
                <th className="py-2 text-right">dWorstPair ({units})</th>
                <th className="py-2 text-right">dPathWorst ({units})</th>
                <th className="py-2 text-right">dPathTotal ({units})</th>
                <th className="py-2 text-right">dWeakStn</th>
                <th className="py-2 text-right">dWeakPair</th>
                <th className="py-2">Path Reason</th>
                <th className="py-2 text-right">Score</th>
                <th className="py-2 text-right">Threshold</th>
                <th className="py-2 text-right px-3">Action</th>
              </tr>
            </thead>
            <tbody className="text-slate-300">
              {preanalysisImpactDiagnostics.rows.map((row, idx) => {
                const alreadyApplied = activePreanalysisScenarioIds.has(row.scenarioId);
                return (
                  <tr key={`preanalysis-impact-${row.scenarioId}-${idx}`} className="border-b border-slate-800/30">
                    <td className="py-1 px-3 text-slate-500">{idx + 1}</td>
                    <td className="py-1 uppercase text-slate-400">
                      {formatPreanalysisSetupLabel(row.setupStationIds)}
                    </td>
                    <td className="py-1">{formatPreanalysisSetLabel(row.templateLabel)}</td>
                    <td className="py-1 text-right font-mono text-slate-500">
                      {row.sourceLines.length > 0 ? renderSourceLineLink(row.sourceLines[0]) : '-'}
                    </td>
                    <td className="py-1 text-right font-mono">{row.addedObservationCount}</td>
                    <td className="py-1 text-right font-mono">
                      {formatLinearMetric(row.deltaWorstStationMajor)}
                    </td>
                    <td className="py-1 text-right font-mono">
                      {formatLinearMetric(row.deltaMedianStationMajor)}
                    </td>
                    <td className="py-1 text-right font-mono">
                      {formatLinearMetric(row.deltaWorstPairSigmaDist)}
                    </td>
                    <td className="py-1 text-right font-mono">
                      {formatLinearMetric(row.deltaPathWorstEdge)}
                    </td>
                    <td className="py-1 text-right font-mono">
                      {formatLinearMetric(row.deltaPathTotalMetric)}
                    </td>
                    <td className="py-1 text-right font-mono">
                      {row.deltaWeakStationCount ?? '-'}
                    </td>
                    <td className="py-1 text-right font-mono">
                      {row.deltaWeakPairCount ?? '-'}
                    </td>
                    <td className="py-1 text-[11px] text-slate-400">
                      {row.primaryTargetStationId != null
                        ? `${row.primaryTargetStationId}${
                            row.bottleneckPair != null
                              ? ` via ${row.bottleneckPair.from}-${row.bottleneckPair.to}`
                              : ''
                          }${row.rationale ? `: ${row.rationale}` : ''}`
                        : row.rationale ?? '-'}
                    </td>
                    <td className="py-1 text-right font-mono">
                      {row.score != null ? row.score.toFixed(2) : '-'}
                    </td>
                    <td className="py-1 text-right font-mono">
                      {row.thresholdReached ? 'YES' : 'NO'}
                    </td>
                    <td className="py-1 px-3 text-right">
                      <button
                        onClick={() => onApplyPreanalysisAction(row.scenarioId)}
                        disabled={
                          row.status !== 'ok' || alreadyApplied || row.actionMode === 'advisory'
                        }
                        className={`px-2 py-0.5 rounded border text-[10px] ${
                          row.status !== 'ok' || alreadyApplied || row.actionMode === 'advisory'
                            ? 'border-slate-700 text-slate-600 cursor-not-allowed'
                            : 'border-cyan-700 text-cyan-200 hover:bg-cyan-950/30'
                        }`}
                      >
                        {alreadyApplied
                          ? 'Applied'
                          : row.actionMode !== 'advisory'
                            ? 'Apply + Re-run'
                            : 'Manual Action'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
};
