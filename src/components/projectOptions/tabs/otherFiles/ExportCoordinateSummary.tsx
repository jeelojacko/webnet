import React from 'react';
import {
  describeExportCoordinateContext,
  resolveExportCoordinateContext,
} from '../../../../engine/exportCoordinateContext';
import type { ProjectOptionsModalContext } from '../../../../hooks/useProjectOptionsModalController';
import type { ProjectExportFormat } from '../../../../types';

type ExportCoordinateSummaryProps = {
  context: ProjectOptionsModalContext;
  exportFormat?: ProjectExportFormat;
};

/**
 * Informational export coordinate summary (read-only). The CRS picker owned
 * by AdjustmentCoordinateSystemCard is untouched; this only restates what the
 * active export will claim. No second CRS config UI lives here.
 */
export const ExportCoordinateSummary: React.FC<ExportCoordinateSummaryProps> = ({
  context,
  exportFormat,
}) => {
  const {
    SettingsRow,
    exportFormat: activeExportFormat,
    parseSettingsDraft,
    settingsDraft,
  } = context;
  const format = exportFormat ?? activeExportFormat;
  const coordContext = resolveExportCoordinateContext({
    coordSystemMode: parseSettingsDraft.coordSystemMode,
    crsId: parseSettingsDraft.crsId,
    units: settingsDraft.units === 'ft' ? 'ft' : 'm',
  });
  const [systemLine, spaceLine, unitsLine, gridGroundNote] =
    describeExportCoordinateContext(coordContext);
  const transformLine =
    format === 'geojson'
      ? 'Project CRS -> geographic lon/lat (degrees; inverse projection applied)'
      : 'No export transform';
  const cellClass =
    'rounded border border-slate-500 bg-slate-700 px-2 py-1 text-xs text-slate-100';
  return (
    <>
      <SettingsRow
        label="Coordinate System"
        tooltip="Project CRS and provenance behind the active export. Informational only."
      >
        <div className={cellClass}>{systemLine.replace('Coordinate system: ', '')}</div>
      </SettingsRow>
      <SettingsRow
        label="Coordinate Space"
        tooltip="Grid coordinates are reduced to the grid; they are never ground coordinates."
      >
        <div className={cellClass}>
          {spaceLine.replace('Coordinate space: ', '')} / {unitsLine.replace('Units: ', '')}
        </div>
      </SettingsRow>
      <SettingsRow label="Transformation" tooltip="Post-solve export transform, if any.">
        <div className={cellClass}>{transformLine}</div>
      </SettingsRow>
      <SettingsRow label="Grid/Ground" tooltip="Engine truth about the exported values.">
        <div className={cellClass}>{gridGroundNote}</div>
      </SettingsRow>
    </>
  );
};

export default ExportCoordinateSummary;
