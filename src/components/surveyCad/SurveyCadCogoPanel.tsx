import React, { useMemo, useState } from 'react';
import {
  buildCadCogoExportFilename,
  formatCadCogoComputation,
  type CadCogoExportFormat,
} from '../../engine/cad/cadCogoReports';
import type { CadCogoComputation } from '../../engine/cad/cadCogoTypes';
import type { CadEntity } from '../../engine/cad/cadTypes';

interface SurveyCadCogoPanelProps {
  computation: CadCogoComputation;
  createdEntities?: readonly CadEntity[];
  sourceLabel: 'selected' | 'latest';
}

const DOWNLOAD_MIME_BY_FORMAT: Record<CadCogoExportFormat, string> = {
  txt: 'text/plain;charset=utf-8',
  csv: 'text/csv;charset=utf-8',
  md: 'text/markdown;charset=utf-8',
};

interface PanelReportTable {
  title: string;
  columns: string[];
  rows: string[][];
}

const SurveyCadCogoPanel: React.FC<SurveyCadCogoPanelProps> = ({
  computation,
  createdEntities = [],
  sourceLabel,
}) => {
  const [format, setFormat] = useState<CadCogoExportFormat>('txt');
  const exportText = useMemo(
    () => formatCadCogoComputation(computation, format),
    [computation, format],
  );
  const fallbackParcelLayoutTable = useMemo<PanelReportTable | null>(
    () =>
      computation.toolKey === 'PARCEL_LAYOUT_AUTO'
        ? {
            title: 'Generated Parcels',
            columns: ['Name', 'Role', 'Area (m2)', 'Perimeter (m)', 'Closure (m)'],
            rows: createdEntities.flatMap((entity) =>
              entity.type === 'parcel'
                ? [
                    [
                      entity.parcelName,
                      entity.metadata?.createdBy === 'PARCEL_LAYOUT_AUTO' &&
                      typeof entity.metadata.role === 'string' &&
                      entity.metadata.role === 'remainder'
                        ? 'Remainder'
                        : 'Lot',
                      (entity.areaSquareMeters ?? 0).toFixed(3),
                      (entity.perimeterMeters ?? 0).toFixed(3),
                      (entity.closureDistanceMeters ?? 0).toFixed(6),
                    ],
                  ]
                : [],
            ),
          }
        : null,
    [computation.toolKey, createdEntities],
  );
  const reportTables = computation.report.tables?.length
    ? computation.report.tables
    : fallbackParcelLayoutTable?.rows.length
      ? [fallbackParcelLayoutTable]
      : [];

  const handleDownload = () => {
    const blob = new Blob([exportText], {
      type: DOWNLOAD_MIME_BY_FORMAT[format],
    });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = buildCadCogoExportFilename(computation, format);
    anchor.click();
    URL.revokeObjectURL(objectUrl);
  };

  return (
    <div
      className="absolute right-3 top-16 z-20 w-[21rem] overflow-hidden rounded border border-slate-800/80 bg-slate-950/92 text-[11px] text-slate-200 shadow-xl backdrop-blur-[1px]"
      data-survey-cad-cogo-panel
    >
      <div className="border-b border-slate-800/80 px-3 py-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div
              className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-200"
              data-survey-cad-cogo-panel-source
            >
              {sourceLabel === 'selected' ? 'Selected COGO Result' : 'Latest COGO Result'}
            </div>
            <div className="pt-1 font-semibold text-slate-100" data-survey-cad-cogo-panel-title>
              {computation.report.title}
            </div>
          </div>
          <div
            className="rounded border border-slate-700 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-300"
            data-survey-cad-cogo-panel-tool
          >
            {computation.toolKey}
          </div>
        </div>
        <div className="pt-1 text-slate-300" data-survey-cad-cogo-panel-summary>
          {computation.report.summary}
        </div>
      </div>
      <div className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 px-3 py-3" data-survey-cad-cogo-panel-rows>
        {computation.report.rows.map((row) => (
          <React.Fragment key={`${row.label}:${row.value}:${row.unit ?? ''}`}>
            <span className="text-slate-400">{row.label}</span>
            <span>
              {row.value}
              {row.unit ? ` ${row.unit}` : ''}
            </span>
          </React.Fragment>
        ))}
      </div>
      {computation.warnings.length > 0 ? (
        <div className="border-t border-slate-800/80 px-3 py-2" data-survey-cad-cogo-panel-warnings>
          <div className="pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-200">
            Warnings
          </div>
          {computation.warnings.map((warning) => (
            <div key={`${warning.code}:${warning.message}`} className="py-0.5 text-slate-300">
              [{warning.severity}] {warning.message}
            </div>
          ))}
        </div>
      ) : null}
      {(computation.alternatives ?? []).length > 0 ? (
        <div className="border-t border-slate-800/80 px-3 py-2" data-survey-cad-cogo-panel-alternatives>
          <div className="pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            Alternatives
          </div>
          {computation.alternatives?.map((alternative) => (
            <div key={alternative.id} className="py-0.5 text-slate-300">
              {alternative.label}
            </div>
          ))}
        </div>
      ) : null}
      {reportTables.map((table) => (
        <div
          key={`${table.title}:${table.columns.join('|')}`}
          className="border-t border-slate-800/80 px-3 py-2"
          data-survey-cad-cogo-panel-created-parcels={table.title === 'Generated Parcels' ? 'true' : undefined}
          data-survey-cad-cogo-panel-table={table.title}
        >
          <div className="pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            {table.title}
          </div>
          <div
            className="overflow-x-auto rounded border border-slate-800/80 bg-slate-950/40"
            data-survey-cad-cogo-panel-table-wrap={table.title}
          >
            <table className="min-w-full border-collapse text-[10px]">
              <thead>
                <tr className="text-slate-400">
                  {table.columns.map((column) => (
                    <th key={`${table.title}:${column}`} className="border-b border-slate-800/80 px-2 py-1 text-left font-semibold">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, rowIndex) => (
                  <tr key={`${table.title}:row:${rowIndex}`} className="text-slate-200">
                    {table.columns.map((column, columnIndex) => (
                      <td
                        key={`${table.title}:${rowIndex}:${column}`}
                        className="border-t border-slate-900/80 px-2 py-1 whitespace-nowrap"
                      >
                        {row[columnIndex] ?? ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      <div className="border-t border-slate-800/80 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            {(['txt', 'csv', 'md'] as const).map((entry) => (
              <button
                key={entry}
                type="button"
                className={`rounded border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${
                  format === entry
                    ? 'border-cyan-500/80 bg-cyan-500/10 text-cyan-100'
                    : 'border-slate-700 text-slate-300'
                }`}
                onClick={() => setFormat(entry)}
                data-survey-cad-cogo-format={entry}
              >
                {entry}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="rounded border border-slate-700 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-200"
            onClick={handleDownload}
            data-survey-cad-cogo-download
          >
            Export
          </button>
        </div>
        <pre
          className="mt-2 max-h-40 overflow-auto rounded border border-slate-800/80 bg-slate-950/60 p-2 text-[10px] leading-4 text-slate-300"
          data-survey-cad-cogo-export-preview
        >
          {exportText}
        </pre>
      </div>
    </div>
  );
};

export default SurveyCadCogoPanel;
