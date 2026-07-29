import React from 'react';

import { radToDmsStr } from '../../engine/angles';
import type { GpsObservation } from '../../types';
import { DiagnosticHeader } from './ReportDiagnosticHeader';
import type { SectionControls, SourceLineRenderer } from './ReportDiagnosticPanels.types';
import type { CollapsibleDetailSectionId } from './reportSectionRegistry';

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
