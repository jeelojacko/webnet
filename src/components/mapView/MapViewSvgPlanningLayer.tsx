import React from 'react';

import {
  EMPTY_BRACE_PREVIEW_POINTS,
  EMPTY_PLANNING_INPUT_POINTS,
  EMPTY_PLANNING_POLYGONS,
  EMPTY_SCENARIO_PREVIEW_SEGMENTS,
  EMPTY_SELECTED_PLANNING_POLYGON_IDS,
} from './MapViewSvg2d.constants';
import type { PlanningLayerProps } from './MapViewSvg2d.types';
import { measureMapViewPerf, noteMapViewPerfCounter } from './mapViewPerf';

export const SvgPlanningLayer = React.memo(function SvgPlanningLayer({
  planningPolygons2d = EMPTY_PLANNING_POLYGONS,
  selectedPlanningPolygonIds = EMPTY_SELECTED_PLANNING_POLYGON_IDS,
  renderPlanningPolygonBodies = true,
  lineWidth2d,
  pointRadius2d,
  onPlanningVertexMouseDown,
  planningInputPoints2d = EMPTY_PLANNING_INPUT_POINTS,
  renderPlanningInputPoints = true,
  scenarioPreviewSegments2d = EMPTY_SCENARIO_PREVIEW_SEGMENTS,
  renderScenarioPreviewSegments = true,
  bracePreviewPoints2d = EMPTY_BRACE_PREVIEW_POINTS,
  renderBracePreviewMarkers = true,
}: PlanningLayerProps) {
  return measureMapViewPerf('svg:planning-layer', () => {
    noteMapViewPerfCounter('svg:planning-layer:renders');
    return (
      <>
        {planningPolygons2d
          .filter(
            (polygon) =>
              renderPlanningPolygonBodies || selectedPlanningPolygonIds.includes(polygon.id),
          )
          .map((polygon) => (
            <polygon
              key={`planning-polygon-${polygon.id}`}
              data-planning-polygon-id={polygon.id}
              data-planning-polygon-source={polygon.source}
              data-planning-polygon-label={polygon.label || polygon.kind}
              points={polygon.pointsAttr}
              fill={
                polygon.source === 'user'
                  ? 'rgba(244,114,182,0.20)'
                  : polygon.kind === 'wooded'
                    ? 'rgba(74,222,128,0.16)'
                    : 'rgba(148,163,184,0.16)'
              }
              stroke={
                polygon.source === 'user'
                  ? '#f9a8d4'
                  : polygon.kind === 'wooded'
                    ? '#86efac'
                    : '#cbd5e1'
              }
              strokeWidth={
                selectedPlanningPolygonIds.includes(polygon.id)
                  ? pointRadius2d * 0.34
                  : pointRadius2d * 0.18
              }
              pointerEvents="none"
            >
              <title>{polygon.label || polygon.kind}</title>
            </polygon>
          ))}

        {planningPolygons2d
          .filter(
            (polygon) =>
              selectedPlanningPolygonIds.length === 1 &&
              selectedPlanningPolygonIds[0] === polygon.id,
          )
          .flatMap((polygon) =>
            polygon.vertices.map((vertex, vertexIndex) => (
              <circle
                key={`planning-vertex-${polygon.id}-${vertexIndex}`}
                data-planning-vertex={`${polygon.id}:${vertexIndex}`}
                data-planning-polygon-source={polygon.source}
                cx={vertex.x}
                cy={vertex.y}
                r={pointRadius2d * 0.5}
                fill="#fde68a"
                stroke="#f59e0b"
                strokeWidth={pointRadius2d * 0.12}
                onMouseDown={(event) => onPlanningVertexMouseDown?.(polygon.id, vertexIndex, event)}
              />
            )),
          )}

        {renderPlanningInputPoints &&
          planningInputPoints2d.map((point) => (
            <circle
              key={`planning-input-${point.stationId}`}
              data-map-input-point={point.stationId}
              cx={point.x}
              cy={point.y}
              r={pointRadius2d * 0.45}
              fill="#fef3c7"
              stroke="#f59e0b"
              strokeWidth={pointRadius2d * 0.12}
            />
          ))}

        {renderScenarioPreviewSegments &&
          scenarioPreviewSegments2d.map((segment) => (
            <line
              key={`scenario-segment-${segment.scenarioId}-${segment.fromStationId}-${segment.toStationId}`}
              x1={segment.x1}
              y1={segment.y1}
              x2={segment.x2}
              y2={segment.y2}
              stroke={segment.kind === 'cross-tie' ? '#fda4af' : segment.active ? '#f472b6' : '#f9a8d4'}
              strokeDasharray={segment.kind === 'cross-tie' ? '4 3' : '2 2'}
              strokeWidth={segment.active ? lineWidth2d * 1.1 : lineWidth2d * 0.8}
              opacity={0.9}
            />
          ))}

        {bracePreviewPoints2d.map((point) => (
          <g key={`brace-preview-${point.scenarioId}`}>
            {renderBracePreviewMarkers && (
              <circle
                data-map-brace-preview={point.stationId}
                cx={point.x}
                cy={point.y}
                r={pointRadius2d * 1.15}
                fill={point.active ? '#f472b6' : '#f9a8d4'}
                stroke={point.active ? '#fdf2f8' : '#fbcfe8'}
                strokeWidth={point.active ? pointRadius2d * 0.38 : pointRadius2d * 0.25}
              >
                <title>{point.templateLabel}</title>
              </circle>
            )}
          </g>
        ))}
      </>
    );
  });
});
