import React from 'react';

import {
  MAP_SELECTION_CORE_STROKE,
  MAP_SELECTION_HALO_STROKE,
} from './mapViewColors';
import {
  EMPTY_TOOL_HIGHLIGHT_IDS,
  EMPTY_TOOL_HIGHLIGHT_SEGMENTS,
} from './MapViewSvg2d.constants';
import type { SelectionLayerProps } from './MapViewSvg2d.types';
import { measureMapViewPerf, noteMapViewPerfCounter } from './mapViewPerf';

export const SvgSelectionLayer = React.memo(function SvgSelectionLayer({
  filteredVisibleMapLines2d,
  selectedObservationId,
  selectedObservationPairKey,
  lineWidth2d,
  onSelectObservation,
  selectedStationId,
  highlightedToolStationIds = EMPTY_TOOL_HIGHLIGHT_IDS,
  highlightedToolSegments = EMPTY_TOOL_HIGHLIGHT_SEGMENTS,
  filteredVisiblePoints2d,
  pointRadius2d,
}: SelectionLayerProps) {
  return measureMapViewPerf('svg:selection-layer', () => {
    noteMapViewPerfCounter('svg:selection-layer:renders');
    const pointsById = new Map(filteredVisiblePoints2d.map((point) => [point.id, point] as const));
    return (
      <>
        {highlightedToolSegments.map((segment) => {
          const from = pointsById.get(segment.fromId);
          const to = pointsById.get(segment.toId);
          if (!from || !to) return null;
          return (
            <line
              key={`${segment.key}-tool-highlight`}
              data-map-tool-line-highlight={segment.key}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke="#fbbf24"
              strokeWidth={lineWidth2d * 2.6}
              markerEnd="url(#arrow)"
              opacity={0.95}
              pointerEvents="none"
            />
          );
        })}

        {highlightedToolSegments.map((segment) => {
          const from = pointsById.get(segment.fromId);
          const to = pointsById.get(segment.toId);
          if (!from || !to) return null;
          return (
            <line
              key={`${segment.key}-tool-highlight-core`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke="#f59e0b"
              strokeWidth={lineWidth2d * 1.4}
              markerEnd="url(#arrow)"
              opacity={1}
              pointerEvents="none"
            />
          );
        })}

        {filteredVisibleMapLines2d
          .filter(
            (line) =>
              line.observationId === selectedObservationId ||
              (selectedObservationPairKey != null && line.pairKey === selectedObservationPairKey),
          )
          .map((line) => (
            <line
              key={`${line.key}-selected`}
              data-map-observation-selection={line.observationId}
              x1={line.x1}
              y1={line.y1}
              x2={line.x2}
              y2={line.y2}
              stroke={MAP_SELECTION_HALO_STROKE}
              strokeWidth={lineWidth2d * 3.2}
              markerEnd="url(#arrow)"
              opacity={1}
              pointerEvents="none"
            />
          ))}

        {filteredVisibleMapLines2d
          .filter(
            (line) =>
              line.observationId === selectedObservationId ||
              (selectedObservationPairKey != null && line.pairKey === selectedObservationPairKey),
          )
          .map((line) => (
            <line
              key={`${line.key}-selected-core`}
              data-map-observation={line.observationId}
              x1={line.x1}
              y1={line.y1}
              x2={line.x2}
              y2={line.y2}
              stroke={MAP_SELECTION_CORE_STROKE}
              strokeWidth={lineWidth2d * 1.85}
              markerEnd="url(#arrow)"
              opacity={1}
              onClick={() => onSelectObservation?.(line.observationId)}
              className={onSelectObservation ? 'cursor-pointer' : undefined}
            />
          ))}

        {filteredVisiblePoints2d
          .filter((point) => highlightedToolStationIds.has(point.id))
          .map((point) => (
            <circle
              key={`tool-highlight-station-${point.id}`}
              data-map-tool-station-highlight={point.id}
              cx={point.x}
              cy={point.y}
              r={pointRadius2d * 1.6}
              fill="none"
              stroke="#fbbf24"
              strokeWidth={pointRadius2d * 0.7}
              pointerEvents="none"
            />
          ))}
        {filteredVisiblePoints2d
          .filter((point) => highlightedToolStationIds.has(point.id))
          .map((point) => (
            <circle
              key={`tool-highlight-station-core-${point.id}`}
              cx={point.x}
              cy={point.y}
              r={pointRadius2d * 1.28}
              fill="none"
              stroke="#f59e0b"
              strokeWidth={pointRadius2d * 0.38}
              pointerEvents="none"
            />
          ))}
        {selectedStationId &&
          filteredVisiblePoints2d
            .filter((point) => point.id === selectedStationId)
            .map((point) => (
              <circle
                key={`selected-station-${point.id}`}
                data-map-station-selection={point.id}
                cx={point.x}
                cy={point.y}
                r={pointRadius2d * 1.45}
                fill="none"
                stroke={MAP_SELECTION_HALO_STROKE}
                strokeWidth={pointRadius2d * 0.6}
                pointerEvents="none"
              />
            ))}
        {selectedStationId &&
          filteredVisiblePoints2d
            .filter((point) => point.id === selectedStationId)
            .map((point) => (
              <circle
                key={`selected-station-core-${point.id}`}
                cx={point.x}
                cy={point.y}
                r={pointRadius2d * 1.18}
                fill="none"
                stroke={MAP_SELECTION_CORE_STROKE}
                strokeWidth={pointRadius2d * 0.34}
                pointerEvents="none"
              />
            ))}
      </>
    );
  });
});
