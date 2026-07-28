import React from 'react';

import {
  MAP_POINT_BORDER_STROKE,
  MAP_POINT_CENTER_FILL,
} from './mapViewColors';
import {
  measureMapViewPerf,
  noteMapViewPerfCounter,
  noteMapViewPerfMetadata,
} from './mapViewPerf';
import {
  EMPTY_BRACE_PREVIEW_POINTS,
  EMPTY_PLANNING_INPUT_POINTS,
  EMPTY_PLANNING_POLYGONS,
  EMPTY_SCENARIO_PREVIEW_SEGMENTS,
  EMPTY_SELECTED_PLANNING_POLYGON_IDS,
  EMPTY_TOOL_HIGHLIGHT_IDS,
  EMPTY_TOOL_HIGHLIGHT_SEGMENTS,
} from './MapViewSvg2d.constants';
import type { MapViewSvg2dProps } from './MapViewSvg2d.types';
import { SvgPlanningLayer } from './MapViewSvgPlanningLayer';
import { SvgSelectionLayer } from './MapViewSvgSelectionLayer';

const SvgArrowDefs = React.memo(function SvgArrowDefs({
  marker2d,
}: Pick<MapViewSvg2dProps, 'marker2d'>) {
  return (
    <defs>
      <marker
        id="arrow"
        markerWidth={marker2d}
        markerHeight={marker2d}
        refX={marker2d * 0.5}
        refY={marker2d * 0.5}
        orient="auto"
        markerUnits="userSpaceOnUse"
      >
        <path d={`M0,0 L0,${marker2d} L${marker2d},${marker2d * 0.5} z`} fill="#64748b" />
      </marker>
    </defs>
  );
});

type LabelLayerProps = Pick<
  MapViewSvg2dProps,
  | 'filteredVisiblePoints2d'
  | 'visiblePointLabels2d'
  | 'labelOffset2d'
  | 'labelFont2d'
  | 'labelStroke2d'
>;

type TransformedOverlayLayerProps = Pick<
  MapViewSvg2dProps,
  | 'transformedLines2d'
  | 'project2d'
  | 'lineWidth2d'
  | 'transformedPoints2d'
  | 'pointRadius2d'
  | 'visiblePointLabels2d'
  | 'labelOffset2d'
  | 'labelFont2d'
  | 'labelStroke2d'
>;

const SvgLabelLayer = React.memo(function SvgLabelLayer({
  filteredVisiblePoints2d,
  visiblePointLabels2d,
  labelOffset2d,
  labelFont2d,
  labelStroke2d,
}: LabelLayerProps) {
  return measureMapViewPerf('svg:labels', () => {
    noteMapViewPerfCounter('svg:labels:renders');
    return (
      <>
        {filteredVisiblePoints2d
          .filter((point) => visiblePointLabels2d.has(point.id))
          .map((point) => (
            <text
              key={`label-${point.id}`}
              data-map-label={point.id}
              x={point.x + labelOffset2d}
              y={point.y - labelOffset2d}
              fontSize={labelFont2d}
              fill="#e2e8f0"
              stroke="#020617"
              strokeWidth={labelStroke2d}
              paintOrder="stroke"
            >
              {point.id}
            </text>
          ))}
      </>
    );
  });
});

const SvgScenarioLabelLayer = React.memo(function SvgScenarioLabelLayer({
  bracePreviewPoints2d = EMPTY_BRACE_PREVIEW_POINTS,
  labelOffset2d,
  labelFont2d,
  labelStroke2d,
}: Pick<
  MapViewSvg2dProps,
  'bracePreviewPoints2d' | 'labelOffset2d' | 'labelFont2d' | 'labelStroke2d'
>) {
  return measureMapViewPerf('svg:scenario-labels', () => {
    noteMapViewPerfCounter('svg:scenario-labels:renders');
    return (
      <>
        {bracePreviewPoints2d.map((point) => (
          <text
            key={`scenario-label-${point.scenarioId}`}
            data-map-label={point.stationId}
            x={point.x + labelOffset2d}
            y={point.y - labelOffset2d}
            fontSize={labelFont2d}
            fill={point.active ? '#fdf2f8' : '#fce7f3'}
            stroke="#4a044e"
            strokeWidth={labelStroke2d}
            paintOrder="stroke"
          >
            {point.stationId}
          </text>
        ))}
      </>
    );
  });
});

const SvgTransformedOverlayLayer = React.memo(function SvgTransformedOverlayLayer({
  transformedLines2d,
  project2d,
  lineWidth2d,
  transformedPoints2d,
  pointRadius2d,
  visiblePointLabels2d,
  labelOffset2d,
  labelFont2d,
  labelStroke2d,
}: TransformedOverlayLayerProps) {
  return measureMapViewPerf('svg:transformed-overlay', () => {
    noteMapViewPerfCounter('svg:transformed-overlay:renders');
    return (
      <>
        {transformedLines2d.map((line) => {
          const p1 = project2d(line.x1, line.y1);
          const p2 = project2d(line.x2, line.y2);
          return (
            <line
              key={line.key}
              x1={p1.x}
              y1={p1.y}
              x2={p2.x}
              y2={p2.y}
              stroke="#22d3ee"
              strokeWidth={lineWidth2d}
              opacity={0.85}
            />
          );
        })}

        {transformedPoints2d.map((point) => {
          const proj = project2d(point.x, point.y);
          return (
            <g key={`tx-point-${point.id}`}>
              <circle
                data-map-transformed-point={point.id}
                cx={proj.x}
                cy={proj.y}
                r={pointRadius2d}
                fill={MAP_POINT_CENTER_FILL}
                stroke={MAP_POINT_BORDER_STROKE}
                strokeWidth={pointRadius2d * 0.38}
              />
              {visiblePointLabels2d.has(point.id) && (
                <text
                  data-map-label={point.id}
                  x={proj.x + labelOffset2d}
                  y={proj.y - labelOffset2d}
                  fontSize={labelFont2d}
                  fill="#f8fafc"
                  stroke="#020617"
                  strokeWidth={labelStroke2d}
                  paintOrder="stroke"
                >
                  {point.id}
                </text>
              )}
            </g>
          );
        })}
      </>
    );
  });
});

const MapViewSvg2d: React.FC<MapViewSvg2dProps> = ({
  marker2d,
  view2d,
  interactionPhase,
  filteredVisiblePoints2d,
  visiblePointLabels2d,
  labelOffset2d,
  labelFont2d,
  labelStroke2d,
  filteredVisibleMapLines2d,
  selectedObservationId,
  selectedObservationPairKey,
  lineWidth2d,
  onSelectObservation,
  selectedStationId,
  highlightedToolStationIds = EMPTY_TOOL_HIGHLIGHT_IDS,
  highlightedToolSegments = EMPTY_TOOL_HIGHLIGHT_SEGMENTS,
  pointRadius2d,
  transformedOverlayActive,
  transformedLines2d,
  transformedPoints2d,
  showLabels,
  planningInputPoints2d = EMPTY_PLANNING_INPUT_POINTS,
  planningPolygons2d = EMPTY_PLANNING_POLYGONS,
  selectedPlanningPolygonIds = EMPTY_SELECTED_PLANNING_POLYGON_IDS,
  renderPlanningPolygonBodies = true,
  renderPlanningInputPoints = true,
  bracePreviewPoints2d = EMPTY_BRACE_PREVIEW_POINTS,
  scenarioPreviewSegments2d = EMPTY_SCENARIO_PREVIEW_SEGMENTS,
  renderBracePreviewMarkers = true,
  renderScenarioPreviewSegments = true,
  selectionBoxRect = null,
  onPlanningVertexMouseDown,
  project2d,
}) =>
  measureMapViewPerf('svg:render', () => {
    noteMapViewPerfCounter('svg:renders');
    noteMapViewPerfMetadata('svg:last-interaction-phase', interactionPhase);
    noteMapViewPerfMetadata(
      'svg:last-label-count',
      filteredVisiblePoints2d.filter((point) => visiblePointLabels2d.has(point.id)).length +
        (showLabels ? bracePreviewPoints2d.length : 0),
    );
    noteMapViewPerfMetadata('svg:last-line-count', filteredVisibleMapLines2d.length);
    noteMapViewPerfMetadata('svg:last-planning-polygon-count', planningPolygons2d.length);
    noteMapViewPerfMetadata('svg:last-selection-box-active', selectionBoxRect != null);
    const viewTransform = `translate(${view2d.panX} ${view2d.panY}) scale(${view2d.zoom})`;
    return (
      <>
        <SvgArrowDefs marker2d={marker2d} />

        <g transform={viewTransform}>
          <SvgPlanningLayer
            planningPolygons2d={planningPolygons2d}
            selectedPlanningPolygonIds={selectedPlanningPolygonIds}
            renderPlanningPolygonBodies={renderPlanningPolygonBodies}
            lineWidth2d={lineWidth2d}
            pointRadius2d={pointRadius2d}
            onPlanningVertexMouseDown={onPlanningVertexMouseDown}
            planningInputPoints2d={planningInputPoints2d}
            renderPlanningInputPoints={renderPlanningInputPoints}
            scenarioPreviewSegments2d={scenarioPreviewSegments2d}
            renderScenarioPreviewSegments={renderScenarioPreviewSegments}
            bracePreviewPoints2d={bracePreviewPoints2d}
            renderBracePreviewMarkers={renderBracePreviewMarkers}
          />
          <SvgSelectionLayer
            filteredVisibleMapLines2d={filteredVisibleMapLines2d}
            selectedObservationId={selectedObservationId}
            selectedObservationPairKey={selectedObservationPairKey}
            lineWidth2d={lineWidth2d}
            onSelectObservation={onSelectObservation}
            selectedStationId={selectedStationId}
            highlightedToolStationIds={highlightedToolStationIds}
            highlightedToolSegments={highlightedToolSegments}
            filteredVisiblePoints2d={filteredVisiblePoints2d}
            pointRadius2d={pointRadius2d}
          />
        </g>

        {selectionBoxRect && (
          <rect
            data-map-selection-box="true"
            data-map-selection-mode={selectionBoxRect.mode}
            x={selectionBoxRect.x}
            y={selectionBoxRect.y}
            width={selectionBoxRect.width}
            height={selectionBoxRect.height}
            fill={
              selectionBoxRect.mode === 'window'
                ? 'rgba(34,211,238,0.12)'
                : 'rgba(251,191,36,0.14)'
            }
            stroke={selectionBoxRect.mode === 'window' ? '#67e8f9' : '#fbbf24'}
            strokeDasharray="6 4"
            strokeWidth={Math.max(1, pointRadius2d * 0.18)}
            vectorEffect="non-scaling-stroke"
          />
        )}

        {transformedOverlayActive && (
          <g transform={viewTransform}>
            <SvgTransformedOverlayLayer
              transformedLines2d={transformedLines2d}
              project2d={project2d}
              lineWidth2d={lineWidth2d}
              transformedPoints2d={transformedPoints2d}
              pointRadius2d={pointRadius2d}
              visiblePointLabels2d={visiblePointLabels2d}
              labelOffset2d={labelOffset2d}
              labelFont2d={labelFont2d}
              labelStroke2d={labelStroke2d}
            />
          </g>
        )}

        {showLabels && (
          <g transform={viewTransform}>
            <SvgScenarioLabelLayer
              bracePreviewPoints2d={bracePreviewPoints2d}
              labelOffset2d={labelOffset2d}
              labelFont2d={labelFont2d}
              labelStroke2d={labelStroke2d}
            />
            <SvgLabelLayer
              filteredVisiblePoints2d={filteredVisiblePoints2d}
              visiblePointLabels2d={visiblePointLabels2d}
              labelOffset2d={labelOffset2d}
              labelFont2d={labelFont2d}
              labelStroke2d={labelStroke2d}
            />
          </g>
        )}
      </>
    );
  });

export default MapViewSvg2d;
