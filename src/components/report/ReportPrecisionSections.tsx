import React from 'react';

import { RAD_TO_DEG } from '../../engine/angles';
import type {
  AdjustmentResult,
  RelativeCovarianceBlock,
  StationCovarianceBlock,
  WeakGeometryDiagnostics,
} from '../../types';
import PrecisionHeader from './ReportPrecisionHeader';
import type {
  LoadMoreRenderer,
  SectionControls,
  TooltipResolver,
} from './ReportPrecisionSections.types';
import type { CollapsibleDetailSectionId } from './reportSectionRegistry';

export const StationCovariancesSection: React.FC<
  SectionControls & {
    covarianceScale: number;
    filteredStationCovariances: StationCovarianceBlock[];
    isPreanalysis: boolean;
    parseState: AdjustmentResult['parseState'];
    preanalysisLabelTooltip: TooltipResolver;
    renderLoadMoreFooter: LoadMoreRenderer;
    topStationCovarianceRow?: StationCovarianceBlock;
    units: 'm' | 'ft';
    visibleStationCovariances: StationCovarianceBlock[];
  }
> = ({
  covarianceScale,
  filteredStationCovariances,
  isDetailSectionPinned,
  isPreanalysis,
  isSectionCollapsed,
  onHeaderRef,
  parseState,
  preanalysisLabelTooltip,
  renderLoadMoreFooter,
  toggleDetailSection,
  togglePinnedDetailSection,
  topStationCovarianceRow,
  units,
  visibleStationCovariances,
}) => {
  if (!isPreanalysis || filteredStationCovariances.length === 0) return null;
  const sectionId: CollapsibleDetailSectionId = 'station-covariances';
  const showHeight = !parseState?.coordMode || parseState.coordMode === '3D';
  return (
    <div className="mb-4 border border-slate-800 rounded">
      <PrecisionHeader
        sectionId={sectionId}
        label={`Station Covariance Blocks (${units}^2)`}
        title={preanalysisLabelTooltip('Station Covariance Blocks Section')}
        isDetailSectionPinned={isDetailSectionPinned}
        isSectionCollapsed={isSectionCollapsed}
        onHeaderRef={onHeaderRef}
        toggleDetailSection={toggleDetailSection}
        togglePinnedDetailSection={togglePinnedDetailSection}
      />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 text-xs text-slate-300 border-b border-slate-800/60">
        <div>
          <div className="text-slate-500">Stations</div>
          <div>{filteredStationCovariances.length}</div>
        </div>
        <div>
          <div className="text-slate-500">Top Station</div>
          <div className="font-mono">{topStationCovarianceRow?.stationId ?? '-'}</div>
        </div>
        <div>
          <div className="text-slate-500">Top CEE</div>
          <div>
            {topStationCovarianceRow != null
              ? (topStationCovarianceRow.cEE * covarianceScale).toExponential(4)
              : '-'}
          </div>
        </div>
        <div>
          <div className="text-slate-500">Top CHH</div>
          <div>
            {topStationCovarianceRow?.cHH != null
              ? (topStationCovarianceRow.cHH * covarianceScale).toExponential(4)
              : '-'}
          </div>
        </div>
      </div>
      {!isSectionCollapsed(sectionId) && (
        <div className="overflow-x-auto w-full">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="text-slate-200 border-b border-slate-700">
                <th className="py-2 px-3 font-semibold">Station</th>
                <th className="py-2 px-3 font-semibold text-right">CEE</th>
                <th className="py-2 px-3 font-semibold text-right">CEN</th>
                <th className="py-2 px-3 font-semibold text-right">CNN</th>
                {showHeight ? (
                  <th className="py-2 px-3 font-semibold text-right">CHH</th>
                ) : null}
              </tr>
            </thead>
            <tbody className="text-slate-300">
              {visibleStationCovariances.map((block) => (
                <tr key={`station-cov-${block.stationId}`} className="border-b border-slate-800/50">
                  <td className="py-1 px-3">{block.stationId}</td>
                  <td className="py-1 px-3 text-right">
                    {(block.cEE * covarianceScale).toExponential(4)}
                  </td>
                  <td className="py-1 px-3 text-right">
                    {(block.cEN * covarianceScale).toExponential(4)}
                  </td>
                  <td className="py-1 px-3 text-right">
                    {(block.cNN * covarianceScale).toExponential(4)}
                  </td>
                  {showHeight ? (
                    <td className="py-1 px-3 text-right">
                      {block.cHH != null ? (block.cHH * covarianceScale).toExponential(4) : '-'}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
          {renderLoadMoreFooter(
            'station-covariances',
            visibleStationCovariances.length,
            filteredStationCovariances.length,
          )}
        </div>
      )}
    </div>
  );
};

export const RelativeCovariancesSection: React.FC<
  SectionControls & {
    covarianceScale: number;
    filteredRelativeCovariances: RelativeCovarianceBlock[];
    isPreanalysis: boolean;
    preanalysisLabelTooltip: TooltipResolver;
    renderLoadMoreFooter: LoadMoreRenderer;
    topRelativeCovarianceRow?: RelativeCovarianceBlock;
    unitScale: number;
    visibleRelativeCovariances: RelativeCovarianceBlock[];
  }
> = ({
  covarianceScale,
  filteredRelativeCovariances,
  isDetailSectionPinned,
  isPreanalysis,
  isSectionCollapsed,
  onHeaderRef,
  preanalysisLabelTooltip,
  renderLoadMoreFooter,
  toggleDetailSection,
  togglePinnedDetailSection,
  topRelativeCovarianceRow,
  unitScale,
  visibleRelativeCovariances,
}) => {
  if (!isPreanalysis || filteredRelativeCovariances.length === 0) return null;
  const sectionId: CollapsibleDetailSectionId = 'relative-covariances';
  return (
    <div className="mb-4 border border-slate-800 rounded">
      <PrecisionHeader
        sectionId={sectionId}
        label="Predicted Relative Precision (Connected Pairs)"
        title={preanalysisLabelTooltip('Predicted Relative Precision (Connected Pairs)')}
        isDetailSectionPinned={isDetailSectionPinned}
        isSectionCollapsed={isSectionCollapsed}
        onHeaderRef={onHeaderRef}
        toggleDetailSection={toggleDetailSection}
        togglePinnedDetailSection={togglePinnedDetailSection}
      />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 text-xs text-slate-300 border-b border-slate-800/60">
        <div>
          <div className="text-slate-500">Pairs</div>
          <div>{filteredRelativeCovariances.length}</div>
        </div>
        <div>
          <div className="text-slate-500">Top Pair</div>
          <div className="font-mono">
            {topRelativeCovarianceRow
              ? `${topRelativeCovarianceRow.from}-${topRelativeCovarianceRow.to}`
              : '-'}
          </div>
        </div>
        <div>
          <div className="text-slate-500">Top σDist</div>
          <div>
            {topRelativeCovarianceRow?.sigmaDist != null
              ? (topRelativeCovarianceRow.sigmaDist * unitScale).toFixed(4)
              : '-'}
          </div>
        </div>
        <div>
          <div className="text-slate-500">Top CEE</div>
          <div>
            {topRelativeCovarianceRow != null
              ? (topRelativeCovarianceRow.cEE * covarianceScale).toExponential(4)
              : '-'}
          </div>
        </div>
      </div>
      {!isSectionCollapsed(sectionId) && (
        <div className="overflow-x-auto w-full">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="text-slate-200 border-b border-slate-700">
                <th className="py-2 px-3 font-semibold">From</th>
                <th className="py-2 px-3 font-semibold">To</th>
                <th className="py-2 px-3 font-semibold">Types</th>
                <th className="py-2 px-3 font-semibold text-right">σN</th>
                <th className="py-2 px-3 font-semibold text-right">σE</th>
                <th className="py-2 px-3 font-semibold text-right">σDist</th>
                <th className="py-2 px-3 font-semibold text-right">σAz (")</th>
                <th className="py-2 px-3 font-semibold text-right">CEE</th>
                <th className="py-2 px-3 font-semibold text-right">CEN</th>
                <th className="py-2 px-3 font-semibold text-right">CNN</th>
              </tr>
            </thead>
            <tbody className="text-slate-300">
              {visibleRelativeCovariances.map((rel, idx) => (
                <tr
                  key={`preanalysis-rel-${rel.from}-${rel.to}-${idx}`}
                  className="border-b border-slate-800/50"
                >
                  <td className="py-1 px-3">{rel.from}</td>
                  <td className="py-1 px-3">{rel.to}</td>
                  <td className="py-1 px-3 text-slate-400">
                    {rel.connectionTypes.join(', ')}
                  </td>
                  <td className="py-1 px-3 text-right">
                    {(rel.sigmaN * unitScale).toFixed(4)}
                  </td>
                  <td className="py-1 px-3 text-right">
                    {(rel.sigmaE * unitScale).toFixed(4)}
                  </td>
                  <td className="py-1 px-3 text-right">
                    {rel.sigmaDist != null ? (rel.sigmaDist * unitScale).toFixed(4) : '-'}
                  </td>
                  <td className="py-1 px-3 text-right">
                    {rel.sigmaAz != null ? (rel.sigmaAz * RAD_TO_DEG * 3600).toFixed(2) : '-'}
                  </td>
                  <td className="py-1 px-3 text-right">
                    {(rel.cEE * covarianceScale).toExponential(4)}
                  </td>
                  <td className="py-1 px-3 text-right">
                    {(rel.cEN * covarianceScale).toExponential(4)}
                  </td>
                  <td className="py-1 px-3 text-right">
                    {(rel.cNN * covarianceScale).toExponential(4)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {renderLoadMoreFooter(
            'relative-covariances',
            visibleRelativeCovariances.length,
            filteredRelativeCovariances.length,
          )}
        </div>
      )}
    </div>
  );
};

export const WeakGeometryCuesSection: React.FC<
  SectionControls & {
    flaggedRelativeCues: WeakGeometryDiagnostics['relativeCues'];
    flaggedStationCues: WeakGeometryDiagnostics['stationCues'];
    isPreanalysis: boolean;
    preanalysisLabelTooltip: TooltipResolver;
    unitScale: number;
    units: 'm' | 'ft';
    weakGeometryDiagnostics?: WeakGeometryDiagnostics;
  }
> = ({
  flaggedRelativeCues,
  flaggedStationCues,
  isDetailSectionPinned,
  isPreanalysis,
  isSectionCollapsed,
  onHeaderRef,
  preanalysisLabelTooltip,
  toggleDetailSection,
  togglePinnedDetailSection,
  unitScale,
  units,
  weakGeometryDiagnostics,
}) => {
  if (!isPreanalysis || !weakGeometryDiagnostics) return null;
  const sectionId: CollapsibleDetailSectionId = 'weak-geometry-cues';
  return (
    <div className="mb-8 border border-amber-900/60 rounded overflow-hidden">
      <PrecisionHeader
        sectionId={sectionId}
        label="Weak Geometry Cues"
        className="px-3 py-2 text-xs uppercase tracking-wider border-b border-amber-900/40 bg-amber-950/30"
        labelClassName="text-amber-200"
        title={preanalysisLabelTooltip('Weak Geometry Cues')}
        isDetailSectionPinned={isDetailSectionPinned}
        isSectionCollapsed={isSectionCollapsed}
        onHeaderRef={onHeaderRef}
        toggleDetailSection={toggleDetailSection}
        togglePinnedDetailSection={togglePinnedDetailSection}
      />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 text-xs text-slate-300 border-b border-amber-900/30">
        <div>
          <div className="text-slate-500" title={preanalysisLabelTooltip('Median Station Major')}>
            Median Station Major
          </div>
          <div>
            {(weakGeometryDiagnostics.stationMedianHorizontal * unitScale).toFixed(4)} {units}
          </div>
        </div>
        <div>
          <div className="text-slate-500" title={preanalysisLabelTooltip('Median Pair SigmaDist')}>
            Median Pair SigmaDist
          </div>
          <div>
            {weakGeometryDiagnostics.relativeMedianDistance != null
              ? `${(weakGeometryDiagnostics.relativeMedianDistance * unitScale).toFixed(4)} ${units}`
              : '-'}
          </div>
        </div>
        <div>
          <div className="text-slate-500" title={preanalysisLabelTooltip('Station Flags')}>
            Station Flags
          </div>
          <div>{flaggedStationCues.length}</div>
        </div>
        <div>
          <div className="text-slate-500" title={preanalysisLabelTooltip('Pair Flags')}>
            Pair Flags
          </div>
          <div>{flaggedRelativeCues.length}</div>
        </div>
      </div>
      {!isSectionCollapsed(sectionId) && (
        <div className="overflow-x-auto w-full">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="text-slate-200 border-b border-slate-700">
                <th className="py-2 px-3 font-semibold">Scope</th>
                <th className="py-2 px-3 font-semibold">ID</th>
                <th className="py-2 px-3 font-semibold">Severity</th>
                <th className="py-2 px-3 font-semibold text-right">Metric</th>
                <th className="py-2 px-3 font-semibold text-right">Median Ratio</th>
                <th className="py-2 px-3 font-semibold text-right">Shape Ratio</th>
                <th className="py-2 px-3 font-semibold">Note</th>
              </tr>
            </thead>
            <tbody className="text-slate-300">
              {[...flaggedStationCues, ...flaggedRelativeCues].map((cue, idx) => {
                const isStationCue = 'stationId' in cue;
                const severityClass =
                  cue.severity === 'weak'
                    ? 'text-red-300'
                    : cue.severity === 'watch'
                      ? 'text-amber-300'
                      : 'text-slate-300';
                const metric = 'horizontalMetric' in cue ? cue.horizontalMetric : cue.distanceMetric;
                const id = isStationCue ? cue.stationId : `${cue.from}-${cue.to}`;
                return (
                  <tr key={`weak-geometry-${id}-${idx}`} className="border-b border-slate-800/50">
                    <td className="py-1 px-3 uppercase text-slate-500">
                      {isStationCue ? 'station' : 'pair'}
                    </td>
                    <td className="py-1 px-3">{id}</td>
                    <td className={`py-1 px-3 uppercase font-semibold ${severityClass}`}>
                      {cue.severity}
                    </td>
                    <td className="py-1 px-3 text-right">
                      {metric != null ? `${(metric * unitScale).toFixed(4)} ${units}` : '-'}
                    </td>
                    <td className="py-1 px-3 text-right">
                      {cue.relativeToMedian != null ? `${cue.relativeToMedian.toFixed(2)}x` : '-'}
                    </td>
                    <td className="py-1 px-3 text-right">
                      {cue.ellipseRatio != null ? `${cue.ellipseRatio.toFixed(2)}x` : '-'}
                    </td>
                    <td className="py-1 px-3 text-slate-400">{cue.note}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
