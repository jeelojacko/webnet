import React from 'react';
import type { Station } from '../../types';

interface AdjustedCoordinatesSectionProps {
  isPreanalysis: boolean;
  units: 'm' | 'ft';
  ellipseMode: '1sigma' | '95';
  onEllipseModeChange: (_mode: '1sigma' | '95') => void;
  ellipseUnit: string;
  ellipseConfidenceScale: number;
  ellipseScale: number;
  filteredStationRows: Array<[string, Station]>;
  selectedStationId: string | null;
  onSelectStation?: (_stationId: string) => void;
  stationDescription: (_stationId: string) => string;
  stationTypeBadge: (_station: Station) => { label: string; className: string; title: string };
  rowSelectionClass: (_selected: boolean) => string;
  unitScale: number;
  visibleRowsFor: <T>(_key: string, _rows: T[], _defaultSize?: number) => T[];
  renderLoadMoreFooter: (
    _key: string,
    _shownCount: number,
    _totalCount: number,
    _step?: number,
  ) => React.ReactNode;
}

const AdjustedCoordinatesSection: React.FC<AdjustedCoordinatesSectionProps> = ({
  isPreanalysis,
  units,
  ellipseMode,
  onEllipseModeChange,
  ellipseUnit,
  ellipseConfidenceScale,
  ellipseScale,
  filteredStationRows,
  selectedStationId,
  onSelectStation,
  stationDescription,
  stationTypeBadge,
  rowSelectionClass,
  unitScale,
  visibleRowsFor,
  renderLoadMoreFooter,
}) => {
  const visibleRows = visibleRowsFor('adjusted-coordinates', filteredStationRows);

  return (
    <div className="mb-8" style={{ order: -190 }}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-blue-400 font-bold text-base uppercase tracking-wider">
          {isPreanalysis
            ? `Predicted Coordinates & Precision (${units})`
            : `Adjusted Coordinates (${units})`}
        </h3>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span>Ellipse</span>
          <div className="flex rounded border border-slate-700 overflow-hidden">
            <button
              onClick={() => onEllipseModeChange('1sigma')}
              className={`px-2 py-0.5 ${ellipseMode === '1sigma' ? 'bg-slate-700 text-slate-100' : 'bg-slate-900/60 text-slate-400'}`}
            >
              1σ
            </button>
            <button
              onClick={() => onEllipseModeChange('95')}
              className={`px-2 py-0.5 ${ellipseMode === '95' ? 'bg-slate-700 text-slate-100' : 'bg-slate-900/60 text-slate-400'}`}
            >
              95%
            </button>
          </div>
        </div>
      </div>
      <div className="overflow-x-auto w-full">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="text-slate-500 border-b border-slate-800 text-xs">
              <th className="py-2 font-semibold w-20">Stn</th>
              <th className="py-2 font-semibold">Description</th>
              <th className="py-2 font-semibold text-right">Northing</th>
              <th className="py-2 font-semibold text-right">Easting</th>
              <th className="py-2 font-semibold text-right">Height</th>
              <th className="py-2 font-semibold text-right">σN</th>
              <th className="py-2 font-semibold text-right">σE</th>
              <th className="py-2 font-semibold text-right">σH</th>
              <th className="py-2 font-semibold text-center">Type</th>
              <th className="py-2 font-semibold text-right w-32">Ellipse ({ellipseUnit})</th>
              <th className="py-2 font-semibold text-right w-20">Az (deg)</th>
            </tr>
          </thead>
          <tbody className="text-slate-300">
            {visibleRows.map(([id, station]) => (
              <tr
                key={id}
                data-report-station-row={id}
                onClick={() => onSelectStation?.(id)}
                className={`border-b border-slate-800/50 ${rowSelectionClass(
                  selectedStationId === id,
                )} ${onSelectStation ? 'cursor-pointer' : ''}`}
              >
                <td className="py-1 font-medium text-slate-100">{id}</td>
                <td className="py-1 text-xs text-slate-400">{stationDescription(id)}</td>
                <td className="py-1 text-right text-slate-200">
                  {(station.y * unitScale).toFixed(4)}
                </td>
                <td className="py-1 text-right text-slate-200">
                  {(station.x * unitScale).toFixed(4)}
                </td>
                <td className="py-1 text-right text-slate-200">
                  {(station.h * unitScale).toFixed(4)}
                </td>
                <td className="py-1 text-right text-xs text-slate-400">
                  {station.sN != null ? (station.sN * unitScale).toFixed(4) : '-'}
                </td>
                <td className="py-1 text-right text-xs text-slate-400">
                  {station.sE != null ? (station.sE * unitScale).toFixed(4) : '-'}
                </td>
                <td className="py-1 text-right text-xs text-slate-400">
                  {station.sH != null ? (station.sH * unitScale).toFixed(4) : '-'}
                </td>
                <td className="py-1 text-center">
                  {(() => {
                    const badge = stationTypeBadge(station);
                    return (
                      <span className={badge.className} title={badge.title}>
                        {badge.label}
                      </span>
                    );
                  })()}
                </td>
                <td className="py-1 text-right text-xs text-slate-400">
                  {station.errorEllipse
                    ? `${(
                        station.errorEllipse.semiMajor *
                        ellipseConfidenceScale *
                        ellipseScale *
                        (units === 'ft' ? 0.0328084 : 1)
                      ).toFixed(1)} / ${(
                        station.errorEllipse.semiMinor *
                        ellipseConfidenceScale *
                        ellipseScale *
                        (units === 'ft' ? 0.0328084 : 1)
                      ).toFixed(1)}`
                    : '-'}
                </td>
                <td className="py-1 text-right text-xs text-slate-400">
                  {station.errorEllipse ? station.errorEllipse.theta.toFixed(2) : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {renderLoadMoreFooter('adjusted-coordinates', visibleRows.length, filteredStationRows.length)}
      </div>
    </div>
  );
};

export default AdjustedCoordinatesSection;
