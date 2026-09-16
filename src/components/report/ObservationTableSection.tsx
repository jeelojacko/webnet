import React from 'react';
import type { Observation } from '../../types';
import { RAD_TO_DEG, radToDmsStr } from '../../engine/angles';
import type { LocalTestSummary } from '../../engine/localTestPolicy';
import type { ReliabilitySummary } from '../../engine/reliabilityPolicy';
import {
  activeMdbComponentsOf,
  activeMdbOf,
  buildCoordEffCellTooltip,
  buildMdbCellTooltip,
  buildMdbHeaderTooltip,
  COORD_EFF_HEADER_TOOLTIP,
  formatCoordEffCell,
} from '../../engine/reliabilityDisplay';
import type { CollapsibleDetailSectionId } from './reportSectionRegistry';
import { buildLocalTestCellTooltip, formatLocalTestCell } from './localTestDisplay';
import { REPORT_TABLE_WINDOW_SIZE } from './reportSectionRegistry';
import CollapsibleSectionHeader from './CollapsibleSectionHeader';
import ReportLoadMoreFooter from './ReportLoadMoreFooter';
import {
  formatObservationLinearResidualMm,
  formatObservationSigmaDisplay,
  getObservationStationDisplay,
} from './observationReportDisplay';

interface ObservationTableSectionProps {
  obsList: Observation[];
  title: string;
  sectionId?: CollapsibleDetailSectionId;
  unitScale: number;
  excludedIds: Set<number>;
  autoSideshotObsIds: Set<number>;
  selectedObservationId: number | null;
  onSelectObservation?: (_observationId: number) => void;
  onToggleExclude: (_observationId: number) => void;
  rowSelectionClass: (_selected: boolean) => string;
  visibleRowsFor: <T>(_key: string, _rows: T[], _defaultSize?: number) => T[];
  showMoreRows: (_key: string, _step?: number) => void;
  showAllRows: (_key: string, _totalCount: number) => void;
  renderSourceLineLink: (_line: number | null | undefined) => React.ReactNode;
  isSectionCollapsed: (_sectionId: CollapsibleDetailSectionId) => boolean;
  isDetailSectionPinned: (_sectionId: CollapsibleDetailSectionId) => boolean;
  toggleDetailSection: (_sectionId: CollapsibleDetailSectionId) => void;
  togglePinnedDetailSection: (_sectionId: CollapsibleDetailSectionId, _label: string) => void;
  onHeaderRef?: (_sectionId: CollapsibleDetailSectionId, _node: HTMLDivElement | null) => void;
  formatMdb: (_value: number, _angular: boolean) => string;
  prismAnnotation: (_observation: Observation) => string;
  localTestSummary?: LocalTestSummary | null;
  reliabilitySummary?: ReliabilitySummary | null;
}

const ObservationTableSection: React.FC<ObservationTableSectionProps> = ({
  obsList,
  title,
  sectionId,
  unitScale,
  excludedIds,
  autoSideshotObsIds,
  selectedObservationId,
  onSelectObservation,
  onToggleExclude,
  rowSelectionClass,
  visibleRowsFor,
  showMoreRows,
  showAllRows,
  renderSourceLineLink,
  isSectionCollapsed,
  isDetailSectionPinned,
  toggleDetailSection,
  togglePinnedDetailSection,
  onHeaderRef,
  formatMdb,
  prismAnnotation,
  localTestSummary,
  reliabilitySummary,
}) => {
  if (!obsList.length) return null;

  const tableKey = sectionId ? `observations-${sectionId}` : null;
  const visibleObsList = tableKey ? visibleRowsFor(tableKey, obsList) : obsList;
  const collapsed = sectionId ? isSectionCollapsed(sectionId) : false;
  const isAngularType = (type: Observation['type']) =>
    type === 'angle' ||
    type === 'direction' ||
    type === 'bearing' ||
    type === 'dir' ||
    type === 'zenith';

  return (
    <div className="mb-6 bg-slate-900/30 border border-slate-800/50 rounded overflow-hidden">
      {sectionId ? (
        <CollapsibleSectionHeader
          sectionId={sectionId}
          label={title}
          className="bg-slate-800/50 px-4 py-2 border-b border-slate-700"
          labelClassName="text-blue-400 font-bold uppercase tracking-wider text-xs"
          collapsed={collapsed}
          pinned={isDetailSectionPinned(sectionId)}
          onToggleCollapse={toggleDetailSection}
          onTogglePin={togglePinnedDetailSection}
          onHeaderRef={onHeaderRef}
        />
      ) : (
        <div className="bg-slate-800/50 px-4 py-2 border-b border-slate-700 flex items-center justify-between">
          <span className="text-blue-400 font-bold uppercase tracking-wider text-xs">{title}</span>
          <span className="text-[10px] text-slate-500">
            {obsList.length} row{obsList.length === 1 ? '' : 's'}
          </span>
        </div>
      )}
      {!collapsed && (
        <>
          <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-slate-500 border-b border-slate-800/50">
                <th className="py-2 px-4">Use</th>
                <th className="py-2">Stations</th>
                <th className="py-2 text-right">Line</th>
                <th className="py-2 text-right">Obs</th>
                <th className="py-2 text-right">Calc</th>
                <th className="py-2 text-right">Residual</th>
                <th className="py-2 text-right">LinRes (mm)</th>
                <th className="py-2 text-right">StdRes</th>
                <th className="py-2 text-right">Redund</th>
                <th className="py-2 text-right">Local</th>
                <th className="py-2 text-right" title={buildMdbHeaderTooltip(reliabilitySummary ?? undefined)}>MDB</th>
                <th className="py-2 text-right" title={COORD_EFF_HEADER_TOOLTIP}>CoordEff</th>
                <th className="py-2 text-right px-4">σ</th>
              </tr>
            </thead>
            <tbody className="text-slate-300">
              {visibleObsList.map((obs) => {
                const isFail = Math.abs(obs.stdRes || 0) > 3;
                const isWarn = Math.abs(obs.stdRes || 0) > 1 && !isFail;
                const excluded = excludedIds.has(obs.id);
                let obsStr = '';
                let calcStr = '';
                let resStr = '';
                let stdResStr = '-';
                let redundancyStr = '-';
                let localStr = '-';
                let mdbStr = '-';
                const coordEffStr = formatCoordEffCell(obs);
                const angular = isAngularType(obs.type);

                if (obs.type === 'angle') {
                  obsStr = radToDmsStr(obs.obs);
                  calcStr = obs.calc != null ? radToDmsStr(obs.calc as number) : '-';
                  resStr =
                    obs.residual != null
                      ? `${((obs.residual as number) * RAD_TO_DEG * 3600).toFixed(2)}"`
                      : '-';
                } else if (obs.type === 'direction') {
                  obsStr = radToDmsStr(obs.obs);
                  calcStr = obs.calc != null ? radToDmsStr(obs.calc as number) : '-';
                  resStr =
                    obs.residual != null
                      ? `${((obs.residual as number) * RAD_TO_DEG * 3600).toFixed(2)}"`
                      : '-';
                } else if (obs.type === 'dist') {
                  obsStr = (obs.obs * unitScale).toFixed(4);
                  calcStr = obs.calc != null ? ((obs.calc as number) * unitScale).toFixed(4) : '-';
                  resStr =
                    obs.residual != null ? ((obs.residual as number) * unitScale).toFixed(4) : '-';
                } else if (obs.type === 'gps') {
                  obsStr = `dE=${(obs.obs.dE * unitScale).toFixed(3)}, dN=${(
                    obs.obs.dN * unitScale
                  ).toFixed(3)}`;
                  calcStr =
                    obs.calc != null
                      ? `dE=${((obs.calc as { dE: number }).dE * unitScale).toFixed(3)}, dN=${(
                          (obs.calc as { dN: number; dE: number }).dN * unitScale
                        ).toFixed(3)}`
                      : '-';
                  resStr =
                    obs.residual != null
                      ? `vE=${((obs.residual as { vE: number }).vE * unitScale).toFixed(3)}, vN=${(
                          (obs.residual as { vN: number; vE: number }).vN * unitScale
                        ).toFixed(3)}`
                      : '-';
                } else if (obs.type === 'lev') {
                  obsStr = (obs.obs * unitScale).toFixed(4);
                  calcStr = obs.calc != null ? ((obs.calc as number) * unitScale).toFixed(4) : '-';
                  resStr =
                    obs.residual != null ? ((obs.residual as number) * unitScale).toFixed(4) : '-';
                } else if (obs.type === 'bearing' || obs.type === 'dir' || obs.type === 'zenith') {
                  obsStr = radToDmsStr(obs.obs);
                  calcStr = obs.calc != null ? radToDmsStr(obs.calc as number) : '-';
                  resStr =
                    obs.residual != null
                      ? `${((obs.residual as number) * RAD_TO_DEG * 3600).toFixed(2)}"`
                      : '-';
                }

                if (obs.stdResComponents) {
                  stdResStr = `${obs.stdResComponents.tE.toFixed(2)}/${obs.stdResComponents.tN.toFixed(2)}`;
                } else if (obs.stdRes != null) {
                  stdResStr = obs.stdRes.toFixed(2);
                }

                if (typeof obs.redundancy === 'object' && obs.redundancy) {
                  redundancyStr = `${obs.redundancy.rE.toFixed(2)}/${obs.redundancy.rN.toFixed(2)}`;
                } else if (typeof obs.redundancy === 'number') {
                  redundancyStr = obs.redundancy.toFixed(2);
                }
                localStr = formatLocalTestCell(obs);
                const activeComps = activeMdbComponentsOf(obs, reliabilitySummary);
                if (activeComps) {
                  mdbStr = `E=${formatMdb(activeComps.mE, angular)} N=${formatMdb(
                    activeComps.mN,
                    angular,
                  )}`;
                } else {
                  const activeMdb = activeMdbOf(obs, reliabilitySummary);
                  if (!Number.isNaN(activeMdb)) mdbStr = formatMdb(activeMdb, angular);
                }
                const stationDisplay = getObservationStationDisplay(obs, {
                  autoSideshot: autoSideshotObsIds.has(obs.id),
                  prismTag: prismAnnotation(obs),
                });
                const linRes = formatObservationLinearResidualMm(obs);
                const linResText = linRes?.text ?? '-';
                const linResTitle = linRes?.title ?? 'Linear equivalent not available for GNSS.';
                const sigmaDisplay = formatObservationSigmaDisplay(obs);

                return (
                  <tr
                    key={obs.id}
                    data-report-observation-row={obs.id}
                    onClick={() => onSelectObservation?.(obs.id)}
                    className={`border-b border-slate-800/30 ${excluded ? 'opacity-50' : ''} ${rowSelectionClass(
                      selectedObservationId === obs.id,
                    )} ${onSelectObservation ? 'cursor-pointer' : ''}`}
                  >
                    <td className="py-1 px-4">
                      <input
                        type="checkbox"
                        checked={!excluded}
                        onChange={() => onToggleExclude(obs.id)}
                        className="accent-blue-500"
                      />
                    </td>
                    <td className="py-1">
                      <span
                        tabIndex={0}
                        title={stationDisplay.title}
                        aria-label={stationDisplay.ariaLabel}
                      >
                        {stationDisplay.visible}
                      </span>
                    </td>
                    <td className="py-1 px-2 text-right font-mono tabular-nums whitespace-nowrap text-slate-500">
                      {renderSourceLineLink(obs.sourceLine)}
                    </td>
                    <td className="py-1 px-2 text-right font-mono tabular-nums whitespace-nowrap text-slate-400">{obsStr || '-'}</td>
                    <td className="py-1 px-2 text-right font-mono tabular-nums whitespace-nowrap text-slate-500">{calcStr}</td>
                    <td
                      className={`py-1 px-2 text-right font-bold font-mono tabular-nums whitespace-nowrap ${
                        isFail ? 'text-red-500' : isWarn ? 'text-yellow-500' : 'text-green-500'
                      }`}
                    >
                      {resStr}
                    </td>
                    <td
                      className="py-1 px-3 text-right font-mono tabular-nums whitespace-nowrap text-slate-400 border-l border-slate-800/60"
                      title={linResTitle}
                    >
                      {linResText}
                    </td>
                    <td
                      className="py-1 px-3 text-right font-mono tabular-nums whitespace-nowrap text-slate-400 border-l border-slate-800/60"
                    >
                      {stdResStr}
                    </td>
                    <td className="py-1 px-2 text-right font-mono tabular-nums whitespace-nowrap text-slate-500">{redundancyStr}</td>
                    <td
                      className={`py-1 px-2 text-right font-mono tabular-nums whitespace-nowrap ${
                        localStr.includes('F') || localStr === 'FAIL'
                          ? 'text-red-400'
                          : 'text-slate-400'
                      }`}
                      title={buildLocalTestCellTooltip(obs, localTestSummary)}
                    >
                      <span tabIndex={0} aria-label={`Local test ${localStr}`}>
                        {localStr}
                      </span>
                    </td>
                    <td
                      className="py-1 px-2 text-right font-mono tabular-nums whitespace-nowrap text-slate-500"
                      title={buildMdbCellTooltip(obs, reliabilitySummary)}
                    >
                      <span tabIndex={0} aria-label={`MDB ${mdbStr}`}>
                        {mdbStr}
                      </span>
                    </td>
                    <td
                      className="py-1 px-2 text-right font-mono tabular-nums whitespace-nowrap text-slate-500"
                      title={buildCoordEffCellTooltip(obs, reliabilitySummary)}
                    >
                      <span tabIndex={0} aria-label={`Coordinate influence ${coordEffStr} millimetres`}>
                        {coordEffStr}
                      </span>
                    </td>
                    <td
                      className="py-1 px-2 text-right font-mono tabular-nums whitespace-nowrap text-slate-400"
                      title={sigmaDisplay.title}
                    >
                      {sigmaDisplay.visible}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
          {tableKey ? (
            <ReportLoadMoreFooter
              rowKey={tableKey}
              shownCount={visibleObsList.length}
              totalCount={obsList.length}
              onShowMore={showMoreRows}
              onShowAll={showAllRows}
              step={REPORT_TABLE_WINDOW_SIZE}
            />
          ) : null}
        </>
      )}
    </div>
  );
};

export default ObservationTableSection;
