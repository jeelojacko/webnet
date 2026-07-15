import React from 'react';

import { radToDmsStr } from '../../engine/angles';
import type { AdjustmentResult, GpsObservation } from '../../types';
import CollapsibleSectionHeader from './CollapsibleSectionHeader';
import type { CollapsibleDetailSectionId } from './reportSectionRegistry';

type SourceLineRenderer = (_line: number | null | undefined) => React.ReactNode;

type SectionControls = {
  isDetailSectionPinned: (_id: CollapsibleDetailSectionId) => boolean;
  isSectionCollapsed: (_id: CollapsibleDetailSectionId) => boolean;
  onHeaderRef: (_id: CollapsibleDetailSectionId, _node: HTMLDivElement | null) => void;
  toggleDetailSection: (_id: CollapsibleDetailSectionId) => void;
  togglePinnedDetailSection: (_id: CollapsibleDetailSectionId, _label: string) => void;
};

const DiagnosticHeader: React.FC<
  SectionControls & {
    className?: string;
    label: string;
    labelClassName?: string;
    sectionId: CollapsibleDetailSectionId;
  }
> = ({
  className = 'px-3 py-2 text-xs uppercase tracking-wider border-b border-slate-700 bg-slate-800/75',
  isDetailSectionPinned,
  isSectionCollapsed,
  label,
  labelClassName = 'text-slate-100',
  onHeaderRef,
  sectionId,
  toggleDetailSection,
  togglePinnedDetailSection,
}) => (
  <CollapsibleSectionHeader
    sectionId={sectionId}
    label={label}
    className={className}
    labelClassName={labelClassName}
    collapsed={isSectionCollapsed(sectionId)}
    pinned={isDetailSectionPinned(sectionId)}
    onToggleCollapse={toggleDetailSection}
    onTogglePin={togglePinnedDetailSection}
    onHeaderRef={onHeaderRef}
  />
);

export const AutoAdjustDiagnosticsPanel: React.FC<
  SectionControls & {
    autoAdjustDiagnostics?: AdjustmentResult['autoAdjustDiagnostics'];
    isSpecialRunMode: boolean;
    renderSourceLineLink: SourceLineRenderer;
  }
> = ({
  autoAdjustDiagnostics,
  isDetailSectionPinned,
  isSectionCollapsed,
  isSpecialRunMode,
  onHeaderRef,
  renderSourceLineLink,
  toggleDetailSection,
  togglePinnedDetailSection,
}) => {
  if (isSpecialRunMode || !autoAdjustDiagnostics?.enabled) return null;
  const sectionId: CollapsibleDetailSectionId = 'auto-adjust-diagnostics';
  return (
    <div className="mb-6 border border-slate-800 rounded overflow-hidden" style={{ order: -207 }}>
      <DiagnosticHeader
        sectionId={sectionId}
        label="Auto-Adjust Diagnostics"
        isDetailSectionPinned={isDetailSectionPinned}
        isSectionCollapsed={isSectionCollapsed}
        onHeaderRef={onHeaderRef}
        toggleDetailSection={toggleDetailSection}
        togglePinnedDetailSection={togglePinnedDetailSection}
      />
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 p-3 text-xs text-slate-300 border-b border-slate-800/60">
        <div>
          <div className="text-slate-500">Threshold</div>
          <div>|t| &gt;= {autoAdjustDiagnostics.threshold.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-slate-500">Max Cycles</div>
          <div>{autoAdjustDiagnostics.maxCycles}</div>
        </div>
        <div>
          <div className="text-slate-500">Max Removals/Cycle</div>
          <div>{autoAdjustDiagnostics.maxRemovalsPerCycle}</div>
        </div>
        <div>
          <div className="text-slate-500">Min Redundancy</div>
          <div>{autoAdjustDiagnostics.minRedundancy.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-slate-500">Stop Reason</div>
          <div>{autoAdjustDiagnostics.stopReason}</div>
        </div>
        <div>
          <div className="text-slate-500">Total Removed</div>
          <div>{autoAdjustDiagnostics.removed.length}</div>
        </div>
      </div>
      {!isSectionCollapsed(sectionId) && (
        <>
          <div className="overflow-x-auto w-full border-b border-slate-800">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="text-slate-200 border-b border-slate-700">
                  <th className="py-2 px-3 font-semibold text-right">Cycle</th>
                  <th className="py-2 px-3 font-semibold text-right">SEUW</th>
                  <th className="py-2 px-3 font-semibold text-right">Max |t|</th>
                  <th className="py-2 px-3 font-semibold text-right">Removals</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {autoAdjustDiagnostics.cycles.map((cycle) => (
                  <tr key={`auto-cycle-${cycle.cycle}`} className="border-b border-slate-800/50">
                    <td className="py-1 px-3 text-right">{cycle.cycle}</td>
                    <td className="py-1 px-3 text-right font-mono">{cycle.seuw.toFixed(4)}</td>
                    <td className="py-1 px-3 text-right font-mono">
                      {cycle.maxAbsStdRes.toFixed(2)}
                    </td>
                    <td className="py-1 px-3 text-right">{cycle.removals.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {autoAdjustDiagnostics.removed.length > 0 && (
            <div className="overflow-x-auto w-full">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="text-slate-200 border-b border-slate-700">
                    <th className="py-2 px-3 font-semibold text-right">Obs ID</th>
                    <th className="py-2 px-3 font-semibold">Type</th>
                    <th className="py-2 px-3 font-semibold">Stations</th>
                    <th className="py-2 px-3 font-semibold text-right">Line</th>
                    <th className="py-2 px-3 font-semibold text-right">|t|</th>
                    <th className="py-2 px-3 font-semibold text-right">Redund</th>
                    <th className="py-2 px-3 font-semibold">Reason</th>
                  </tr>
                </thead>
                <tbody className="text-slate-300">
                  {autoAdjustDiagnostics.removed.map((row, idx) => (
                    <tr
                      key={`auto-removed-${row.obsId}-${row.sourceLine ?? 'na'}-${idx}`}
                      className="border-b border-slate-800/50"
                    >
                      <td className="py-1 px-3 text-right font-mono">{row.obsId}</td>
                      <td className="py-1 px-3 uppercase">{row.type}</td>
                      <td className="py-1 px-3 font-mono">{row.stations}</td>
                      <td className="py-1 px-3 text-right">
                        {renderSourceLineLink(row.sourceLine)}
                      </td>
                      <td className="py-1 px-3 text-right font-mono">{row.stdRes.toFixed(2)}</td>
                      <td className="py-1 px-3 text-right font-mono">
                        {row.redundancy != null ? row.redundancy.toFixed(3) : '-'}
                      </td>
                      <td className="py-1 px-3">{row.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export const AutoSideshotCandidatesPanel: React.FC<
  SectionControls & {
    autoSideshotDiagnostics?: AdjustmentResult['autoSideshotDiagnostics'];
    renderSourceLineLink: SourceLineRenderer;
    showAutoSideshotDiagnosticsSection: boolean;
  }
> = ({
  autoSideshotDiagnostics,
  isDetailSectionPinned,
  isSectionCollapsed,
  onHeaderRef,
  renderSourceLineLink,
  showAutoSideshotDiagnosticsSection,
  toggleDetailSection,
  togglePinnedDetailSection,
}) => {
  if (!showAutoSideshotDiagnosticsSection || !autoSideshotDiagnostics) return null;
  const sectionId: CollapsibleDetailSectionId = 'auto-sideshot-candidates';
  return (
    <div className="mb-6 border border-slate-800 rounded overflow-hidden">
      <DiagnosticHeader
        sectionId={sectionId}
        label="Auto Sideshot Candidates (M Records)"
        isDetailSectionPinned={isDetailSectionPinned}
        isSectionCollapsed={isSectionCollapsed}
        onHeaderRef={onHeaderRef}
        toggleDetailSection={toggleDetailSection}
        togglePinnedDetailSection={togglePinnedDetailSection}
      />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 text-xs text-slate-300 border-b border-slate-800/60">
        <div>
          <div className="text-slate-500">Evaluated M Pairs</div>
          <div>{autoSideshotDiagnostics.evaluatedCount}</div>
        </div>
        <div>
          <div className="text-slate-500">Candidates</div>
          <div>{autoSideshotDiagnostics.candidateCount}</div>
        </div>
        <div>
          <div className="text-slate-500">Excluded Control Targets</div>
          <div>{autoSideshotDiagnostics.excludedControlCount}</div>
        </div>
        <div>
          <div className="text-slate-500">Min Redundancy Threshold</div>
          <div>{autoSideshotDiagnostics.threshold.toFixed(2)}</div>
        </div>
      </div>
      {!isSectionCollapsed(sectionId) && (
        <div className="overflow-x-auto w-full">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="text-slate-200 border-b border-slate-700">
                <th className="py-2 px-3 font-semibold text-right">Line</th>
                <th className="py-2 px-3 font-semibold">Occupy</th>
                <th className="py-2 px-3 font-semibold">Backsight</th>
                <th className="py-2 px-3 font-semibold">Target</th>
                <th className="py-2 px-3 font-semibold text-right">Angle Obs</th>
                <th className="py-2 px-3 font-semibold text-right">Dist Obs</th>
                <th className="py-2 px-3 font-semibold text-right">Angle Red</th>
                <th className="py-2 px-3 font-semibold text-right">Dist Red</th>
                <th className="py-2 px-3 font-semibold text-right">Min Red</th>
                <th className="py-2 px-3 font-semibold text-right">Max |t|</th>
              </tr>
            </thead>
            <tbody className="text-slate-300">
              {autoSideshotDiagnostics.candidates.map((row, idx) => (
                <tr
                  key={`auto-sideshot-${row.sourceLine ?? 'na'}-${row.target}-${idx}`}
                  className="border-b border-slate-800/50"
                >
                  <td className="py-1 px-3 text-right font-mono">
                    {renderSourceLineLink(row.sourceLine)}
                  </td>
                  <td className="py-1 px-3 font-mono">{row.occupy}</td>
                  <td className="py-1 px-3 font-mono">{row.backsight}</td>
                  <td className="py-1 px-3 font-mono">{row.target}</td>
                  <td className="py-1 px-3 text-right font-mono">{row.angleObsId}</td>
                  <td className="py-1 px-3 text-right font-mono">{row.distObsId}</td>
                  <td className="py-1 px-3 text-right font-mono">
                    {row.angleRedundancy.toFixed(3)}
                  </td>
                  <td className="py-1 px-3 text-right font-mono">
                    {row.distRedundancy.toFixed(3)}
                  </td>
                  <td className="py-1 px-3 text-right font-mono">
                    {row.minRedundancy.toFixed(3)}
                  </td>
                  <td className="py-1 px-3 text-right font-mono">
                    {row.maxAbsStdRes.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export const SetupDiagnosticsPanel: React.FC<
  SectionControls & {
    isDataCheck: boolean;
    isPreanalysis: boolean;
    setupDiagnostics: NonNullable<AdjustmentResult['setupDiagnostics']>;
    setupLocalFailCount: number;
    setupObsCount: number;
    setupWorstStdRes: number;
    unitScale: number;
    units: 'm' | 'ft';
  }
> = ({
  isDataCheck,
  isDetailSectionPinned,
  isPreanalysis,
  isSectionCollapsed,
  onHeaderRef,
  setupDiagnostics,
  setupLocalFailCount,
  setupObsCount,
  setupWorstStdRes,
  toggleDetailSection,
  togglePinnedDetailSection,
  unitScale,
  units,
}) => {
  if (isPreanalysis || isDataCheck || setupDiagnostics.length === 0) return null;
  const sectionId: CollapsibleDetailSectionId = 'setup-diagnostics';
  return (
    <div className="mb-8 border border-slate-800 rounded overflow-hidden" style={{ order: -160 }}>
      <DiagnosticHeader
        sectionId={sectionId}
        label="Setup Diagnostics"
        isDetailSectionPinned={isDetailSectionPinned}
        isSectionCollapsed={isSectionCollapsed}
        onHeaderRef={onHeaderRef}
        toggleDetailSection={toggleDetailSection}
        togglePinnedDetailSection={togglePinnedDetailSection}
      />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 text-xs text-slate-300 border-b border-slate-800/60">
        <div>
          <div className="text-slate-500">Setups</div>
          <div>{setupDiagnostics.length}</div>
        </div>
        <div>
          <div className="text-slate-500">Obs Total</div>
          <div>{setupObsCount}</div>
        </div>
        <div>
          <div className="text-slate-500">Local Fails</div>
          <div>{setupLocalFailCount}</div>
        </div>
        <div>
          <div className="text-slate-500">Worst Max |t|</div>
          <div>{setupWorstStdRes.toFixed(2)}</div>
        </div>
      </div>
      {!isSectionCollapsed(sectionId) && (
        <div className="overflow-x-auto w-full">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="text-slate-200 border-b border-slate-700">
                <th className="py-2 px-3 font-semibold">Setup</th>
                <th className="py-2 px-3 font-semibold text-right">Dir Sets</th>
                <th className="py-2 px-3 font-semibold text-right">Dir Obs</th>
                <th className="py-2 px-3 font-semibold text-right">Angles</th>
                <th className="py-2 px-3 font-semibold text-right">Dist</th>
                <th className="py-2 px-3 font-semibold text-right">Zen</th>
                <th className="py-2 px-3 font-semibold text-right">Lev</th>
                <th className="py-2 px-3 font-semibold text-right">GPS</th>
                <th className="py-2 px-3 font-semibold text-right">Trav Dist ({units})</th>
                <th className="py-2 px-3 font-semibold text-right">Orient RMS (")</th>
                <th className="py-2 px-3 font-semibold text-right">Orient SE (")</th>
                <th className="py-2 px-3 font-semibold text-right">RMS |t|</th>
                <th className="py-2 px-3 font-semibold text-right">Max |t|</th>
                <th className="py-2 px-3 font-semibold text-right">Local Fail</th>
                <th className="py-2 px-3 font-semibold">Worst Obs</th>
                <th className="py-2 px-3 font-semibold text-right">Line</th>
              </tr>
            </thead>
            <tbody className="text-slate-300">
              {setupDiagnostics.map((s) => (
                <tr key={s.station} className="border-b border-slate-800/50">
                  <td className="py-1 px-3">{s.station}</td>
                  <td className="py-1 px-3 text-right">{s.directionSetCount}</td>
                  <td className="py-1 px-3 text-right">{s.directionObsCount}</td>
                  <td className="py-1 px-3 text-right">{s.angleObsCount}</td>
                  <td className="py-1 px-3 text-right">{s.distanceObsCount}</td>
                  <td className="py-1 px-3 text-right">{s.zenithObsCount}</td>
                  <td className="py-1 px-3 text-right">{s.levelingObsCount}</td>
                  <td className="py-1 px-3 text-right">{s.gpsObsCount}</td>
                  <td className="py-1 px-3 text-right">
                    {(s.traverseDistance * unitScale).toFixed(3)}
                  </td>
                  <td className="py-1 px-3 text-right">
                    {s.orientationRmsArcSec != null ? s.orientationRmsArcSec.toFixed(2) : '-'}
                  </td>
                  <td className="py-1 px-3 text-right">
                    {s.orientationSeArcSec != null ? s.orientationSeArcSec.toFixed(2) : '-'}
                  </td>
                  <td className="py-1 px-3 text-right">
                    {s.rmsStdRes != null ? s.rmsStdRes.toFixed(2) : '-'}
                  </td>
                  <td className="py-1 px-3 text-right">
                    {s.maxStdRes != null ? s.maxStdRes.toFixed(2) : '-'}
                  </td>
                  <td className="py-1 px-3 text-right">{s.localFailCount}</td>
                  <td className="py-1 px-3 text-slate-400">
                    {s.worstObsType != null
                      ? `${s.worstObsType.toUpperCase()} ${s.worstObsStations ?? ''}`.trim()
                      : '-'}
                  </td>
                  <td className="py-1 px-3 text-right text-slate-500">{s.worstObsLine ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export const GpsRoverOffsetsPanel: React.FC<
  SectionControls & {
    gpsOffsetObservations: GpsObservation[];
    isDataCheck: boolean;
    renderSourceLineLink: SourceLineRenderer;
    topGpsOffsetObservation?: GpsObservation;
    unitScale: number;
    units: 'm' | 'ft';
  }
> = ({
  gpsOffsetObservations,
  isDataCheck,
  isDetailSectionPinned,
  isSectionCollapsed,
  onHeaderRef,
  renderSourceLineLink,
  topGpsOffsetObservation,
  toggleDetailSection,
  togglePinnedDetailSection,
  unitScale,
  units,
}) => {
  if (isDataCheck || gpsOffsetObservations.length === 0) return null;
  const sectionId: CollapsibleDetailSectionId = 'gps-rover-offsets';
  return (
    <div className="mb-8 border border-slate-800 rounded overflow-hidden">
      <DiagnosticHeader
        sectionId={sectionId}
        label="GPS Rover Offsets"
        isDetailSectionPinned={isDetailSectionPinned}
        isSectionCollapsed={isSectionCollapsed}
        onHeaderRef={onHeaderRef}
        toggleDetailSection={toggleDetailSection}
        togglePinnedDetailSection={togglePinnedDetailSection}
      />
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 p-3 text-xs text-slate-300 border-b border-slate-800/60">
        <div>
          <div className="text-slate-500">Offsets</div>
          <div>{gpsOffsetObservations.length}</div>
        </div>
        <div>
          <div className="text-slate-500">Top Pair</div>
          <div className="font-mono">
            {topGpsOffsetObservation
              ? `${topGpsOffsetObservation.from}-${topGpsOffsetObservation.to}`
              : '-'}
          </div>
        </div>
        <div>
          <div className="text-slate-500">Top Slope ({units})</div>
          <div>
            {topGpsOffsetObservation?.gpsOffsetDistanceM != null
              ? (topGpsOffsetObservation.gpsOffsetDistanceM * unitScale).toFixed(4)
              : '-'}
          </div>
        </div>
        <div>
          <div className="text-slate-500">Top dH ({units})</div>
          <div>
            {topGpsOffsetObservation?.gpsOffsetDeltaH != null
              ? (topGpsOffsetObservation.gpsOffsetDeltaH * unitScale).toFixed(4)
              : '-'}
          </div>
        </div>
        <div>
          <div className="text-slate-500">Top Az</div>
          <div>
            {topGpsOffsetObservation?.gpsOffsetAzimuthRad != null
              ? radToDmsStr(topGpsOffsetObservation.gpsOffsetAzimuthRad)
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
                <th className="py-2 px-3 font-semibold text-right">G Line</th>
                <th className="py-2 px-3 font-semibold text-right">G4 Line</th>
                <th className="py-2 px-3 font-semibold text-right">Az</th>
                <th className="py-2 px-3 font-semibold text-right">Slope ({units})</th>
                <th className="py-2 px-3 font-semibold text-right">Zenith</th>
                <th className="py-2 px-3 font-semibold text-right">dE ({units})</th>
                <th className="py-2 px-3 font-semibold text-right">dN ({units})</th>
                <th className="py-2 px-3 font-semibold text-right">dH ({units})</th>
              </tr>
            </thead>
            <tbody className="text-slate-300">
              {gpsOffsetObservations.map((obs) => (
                <tr
                  key={`gps-offset-${obs.id}-${obs.gpsOffsetSourceLine ?? obs.sourceLine ?? obs.id}`}
                  className="border-b border-slate-800/30"
                >
                  <td className="py-1 px-3">{obs.from}</td>
                  <td className="py-1 px-3">{obs.to}</td>
                  <td className="py-1 px-3 text-right">
                    {renderSourceLineLink(obs.sourceLine)}
                  </td>
                  <td className="py-1 px-3 text-right">{obs.gpsOffsetSourceLine ?? '-'}</td>
                  <td className="py-1 px-3 text-right">
                    {obs.gpsOffsetAzimuthRad != null ? radToDmsStr(obs.gpsOffsetAzimuthRad) : '-'}
                  </td>
                  <td className="py-1 px-3 text-right">
                    {obs.gpsOffsetDistanceM != null
                      ? (obs.gpsOffsetDistanceM * unitScale).toFixed(4)
                      : '-'}
                  </td>
                  <td className="py-1 px-3 text-right">
                    {obs.gpsOffsetZenithRad != null ? radToDmsStr(obs.gpsOffsetZenithRad) : '-'}
                  </td>
                  <td className="py-1 px-3 text-right">
                    {obs.gpsOffsetDeltaE != null
                      ? (obs.gpsOffsetDeltaE * unitScale).toFixed(4)
                      : '-'}
                  </td>
                  <td className="py-1 px-3 text-right">
                    {obs.gpsOffsetDeltaN != null
                      ? (obs.gpsOffsetDeltaN * unitScale).toFixed(4)
                      : '-'}
                  </td>
                  <td className="py-1 px-3 text-right">
                    {obs.gpsOffsetDeltaH != null
                      ? (obs.gpsOffsetDeltaH * unitScale).toFixed(4)
                      : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
