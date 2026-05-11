import React from 'react';

import { RAD_TO_DEG, radToDmsStr } from '../../engine/angles';
import type { VisibleStationRow } from '../../engine/resultDerivedModels';
import type { MapToolPanel } from './MapViewContextMenu';

interface InverseResult {
  azimuthFromToRad: number;
  azimuthToFromRad: number;
  distance2d: number;
}

interface AngleBetweenResult {
  insideAngleRad: number;
  outsideAngleRad: number;
}

interface MapViewToolOverlayProps {
  activeTool: Exclude<MapToolPanel, 'none'>;
  visibleStationRows: VisibleStationRow[];
  isPreanalysis: boolean;
  units: 'm' | 'ft';
  unitScale: number;
  onClose: () => void;
  inverseFromInput: string;
  inverseToInput: string;
  inverseFromId: string | null;
  inverseToId: string | null;
  onInverseFromInputChange: (_value: string) => void;
  onInverseToInputChange: (_value: string) => void;
  inverse: InverseResult | null;
  anglePivotInput: string;
  angleFromInput: string;
  angleToInput: string;
  anglePivotId: string | null;
  angleFromId: string | null;
  angleToId: string | null;
  onAnglePivotInputChange: (_value: string) => void;
  onAngleFromInputChange: (_value: string) => void;
  onAngleToInputChange: (_value: string) => void;
  angleBetween: AngleBetweenResult | null;
}

const inputClass =
  'w-full rounded border border-slate-600 bg-slate-950 px-2 py-1 text-slate-100';
const selectClass = 'rounded border border-slate-600 bg-slate-950 px-2 py-1 text-slate-100';

const MapViewToolOverlay: React.FC<MapViewToolOverlayProps> = ({
  activeTool,
  visibleStationRows,
  isPreanalysis,
  units,
  unitScale,
  onClose,
  inverseFromInput,
  inverseToInput,
  inverseFromId,
  inverseToId,
  onInverseFromInputChange,
  onInverseToInputChange,
  inverse,
  anglePivotInput,
  angleFromInput,
  angleToInput,
  anglePivotId,
  angleFromId,
  angleToId,
  onAnglePivotInputChange,
  onAngleFromInputChange,
  onAngleToInputChange,
  angleBetween,
}) => (
  <div className="absolute left-2 top-2 z-20 w-[min(560px,calc(100%-16px))] rounded border border-slate-700 bg-slate-900/95 p-3 text-xs shadow-lg shadow-black/45">
    <div className="mb-2 flex items-center justify-between border-b border-slate-700 pb-2">
      <div className="uppercase tracking-wider text-slate-300">
        {activeTool === 'points' ? 'Points' : activeTool === 'inverse' ? 'Inverse' : 'Angles Between'}
      </div>
      <button
        type="button"
        onClick={onClose}
        className="rounded border border-slate-600 px-2 py-0.5 text-slate-300 hover:bg-slate-800"
      >
        Close
      </button>
    </div>

    {activeTool === 'points' && (
      <div className="max-h-[300px] overflow-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-slate-700 text-slate-400">
              <th className="px-2 py-1">Point</th>
              {isPreanalysis ? <th className="px-2 py-1">Cue</th> : null}
              <th className="px-2 py-1 text-right">Northing ({units})</th>
              <th className="px-2 py-1 text-right">Easting ({units})</th>
              <th className="px-2 py-1 text-right">Height ({units})</th>
              <th className="px-2 py-1 text-right">σN ({units})</th>
              <th className="px-2 py-1 text-right">σE ({units})</th>
              <th className="px-2 py-1 text-right">σH ({units})</th>
            </tr>
          </thead>
          <tbody className="text-slate-200">
            {visibleStationRows.map(({ id: stationId, station, severity }) => {
              const formatStd = (value?: number) =>
                value != null && Number.isFinite(value) ? (value * unitScale).toFixed(4) : '-';
              return (
                <tr key={`point-tool-${stationId}`} className="border-b border-slate-800/60">
                  <td className="px-2 py-1">{stationId}</td>
                  {isPreanalysis ? (
                    <td className="px-2 py-1 uppercase">{severity ?? '-'}</td>
                  ) : null}
                  <td className="px-2 py-1 text-right">{(station.y * unitScale).toFixed(4)}</td>
                  <td className="px-2 py-1 text-right">{(station.x * unitScale).toFixed(4)}</td>
                  <td className="px-2 py-1 text-right">{(station.h * unitScale).toFixed(4)}</td>
                  <td className="px-2 py-1 text-right">{formatStd(station.sN)}</td>
                  <td className="px-2 py-1 text-right">{formatStd(station.sE)}</td>
                  <td className="px-2 py-1 text-right">{formatStd(station.sH)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    )}

    {activeTool === 'inverse' && (
      <div className="space-y-2">
        <datalist id="map-point-id-list">
          {visibleStationRows.map(({ id: stationId }) => (
            <option key={`inv-id-${stationId}`} value={stationId} />
          ))}
        </datalist>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          <label className="space-y-1 text-slate-300">
            From Point
            <div className="flex gap-2">
              <input
                type="text"
                value={inverseFromInput}
                onChange={(event) => onInverseFromInputChange(event.target.value)}
                list="map-point-id-list"
                className={inputClass}
              />
              <select
                value={inverseFromId ?? ''}
                onChange={(event) => onInverseFromInputChange(event.target.value)}
                className={selectClass}
              >
                <option value="">Select</option>
                {visibleStationRows.map(({ id: stationId }) => (
                  <option key={`inv-from-${stationId}`} value={stationId}>
                    {stationId}
                  </option>
                ))}
              </select>
            </div>
          </label>
          <label className="space-y-1 text-slate-300">
            To Point
            <div className="flex gap-2">
              <input
                type="text"
                value={inverseToInput}
                onChange={(event) => onInverseToInputChange(event.target.value)}
                list="map-point-id-list"
                className={inputClass}
              />
              <select
                value={inverseToId ?? ''}
                onChange={(event) => onInverseToInputChange(event.target.value)}
                className={selectClass}
              >
                <option value="">Select</option>
                {visibleStationRows.map(({ id: stationId }) => (
                  <option key={`inv-to-${stationId}`} value={stationId}>
                    {stationId}
                  </option>
                ))}
              </select>
            </div>
          </label>
        </div>
        <div className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-200">
          {!inverseFromId || !inverseToId ? (
            <div>Enter or select both point IDs.</div>
          ) : inverseFromId === inverseToId ? (
            <div>From and To points must be different.</div>
          ) : !inverse ? (
            <div>Inverse unavailable for the selected points.</div>
          ) : (
            <div className="space-y-1">
              <div>
                Az {inverseFromId} → {inverseToId}:{' '}
                <span className="font-mono">{radToDmsStr(inverse.azimuthFromToRad)}</span> (
                {(inverse.azimuthFromToRad * RAD_TO_DEG).toFixed(6)} deg)
              </div>
              <div>
                Az {inverseToId} → {inverseFromId}:{' '}
                <span className="font-mono">{radToDmsStr(inverse.azimuthToFromRad)}</span> (
                {(inverse.azimuthToFromRad * RAD_TO_DEG).toFixed(6)} deg)
              </div>
              <div>
                Horizontal distance:{' '}
                <span className="font-mono">
                  {(inverse.distance2d * unitScale).toFixed(4)} {units}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    )}

    {activeTool === 'angles' && (
      <div className="space-y-2">
        <datalist id="map-angle-point-id-list">
          {visibleStationRows.map(({ id: stationId }) => (
            <option key={`ang-id-${stationId}`} value={stationId} />
          ))}
        </datalist>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <label className="space-y-1 text-slate-300">
            Pivot
            <div className="flex gap-2">
              <input
                type="text"
                value={anglePivotInput}
                onChange={(event) => onAnglePivotInputChange(event.target.value)}
                list="map-angle-point-id-list"
                className={inputClass}
              />
              <select
                value={anglePivotId ?? ''}
                onChange={(event) => onAnglePivotInputChange(event.target.value)}
                className={selectClass}
              >
                <option value="">Select</option>
                {visibleStationRows.map(({ id: stationId }) => (
                  <option key={`ang-piv-${stationId}`} value={stationId}>
                    {stationId}
                  </option>
                ))}
              </select>
            </div>
          </label>
          <label className="space-y-1 text-slate-300">
            Leg A
            <div className="flex gap-2">
              <input
                type="text"
                value={angleFromInput}
                onChange={(event) => onAngleFromInputChange(event.target.value)}
                list="map-angle-point-id-list"
                className={inputClass}
              />
              <select
                value={angleFromId ?? ''}
                onChange={(event) => onAngleFromInputChange(event.target.value)}
                className={selectClass}
              >
                <option value="">Select</option>
                {visibleStationRows.map(({ id: stationId }) => (
                  <option key={`ang-from-${stationId}`} value={stationId}>
                    {stationId}
                  </option>
                ))}
              </select>
            </div>
          </label>
          <label className="space-y-1 text-slate-300">
            Leg B
            <div className="flex gap-2">
              <input
                type="text"
                value={angleToInput}
                onChange={(event) => onAngleToInputChange(event.target.value)}
                list="map-angle-point-id-list"
                className={inputClass}
              />
              <select
                value={angleToId ?? ''}
                onChange={(event) => onAngleToInputChange(event.target.value)}
                className={selectClass}
              >
                <option value="">Select</option>
                {visibleStationRows.map(({ id: stationId }) => (
                  <option key={`ang-to-${stationId}`} value={stationId}>
                    {stationId}
                  </option>
                ))}
              </select>
            </div>
          </label>
        </div>
        <div className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-200">
          {!anglePivotId || !angleFromId || !angleToId ? (
            <div>Enter or select all three point IDs.</div>
          ) : anglePivotId === angleFromId ||
            anglePivotId === angleToId ||
            angleFromId === angleToId ? (
            <div>Pivot, Leg A, and Leg B must be three different points.</div>
          ) : !angleBetween ? (
            <div>Angle unavailable for the selected points.</div>
          ) : (
            <div className="space-y-1">
              <div>
                Inside angle at {anglePivotId}:{' '}
                <span className="font-mono">{radToDmsStr(angleBetween.insideAngleRad)}</span> (
                {(angleBetween.insideAngleRad * RAD_TO_DEG).toFixed(6)} deg)
              </div>
              <div>
                Outside angle at {anglePivotId}:{' '}
                <span className="font-mono">{radToDmsStr(angleBetween.outsideAngleRad)}</span> (
                {(angleBetween.outsideAngleRad * RAD_TO_DEG).toFixed(6)} deg)
              </div>
            </div>
          )}
        </div>
      </div>
    )}
  </div>
);

export default MapViewToolOverlay;
