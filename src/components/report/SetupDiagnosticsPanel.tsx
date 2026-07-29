import React from 'react';

import type { AdjustmentResult } from '../../types';
import { DiagnosticHeader } from './ReportDiagnosticHeader';
import type { SectionControls } from './ReportDiagnosticPanels.types';
import type { CollapsibleDetailSectionId } from './reportSectionRegistry';

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
