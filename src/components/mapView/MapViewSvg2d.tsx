import React from 'react';

import type { ProjectedMapLine2D, ProjectedPoint2D, View2dState } from './mapView2d';
import {
  MAP_POINT_BORDER_STROKE,
  MAP_POINT_CENTER_FILL,
  MAP_SELECTION_CORE_STROKE,
  MAP_SELECTION_HALO_STROKE,
} from './mapViewColors';
import {
  measureMapViewPerf,
  noteMapViewPerfCounter,
  noteMapViewPerfMetadata,
} from './mapViewPerf';

interface TransformedLine2d {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface TransformedPoint2d {
  id: string;
  x: number;
  y: number;
  fixed: boolean;
}

interface BracePreviewPoint2d {
  scenarioId: string;
  stationId: string;
  templateLabel: string;
  x: number;
  y: number;
  active: boolean;
}

interface PlanningInputPoint2d {
  stationId: string;
  x: number;
  y: number;
}

interface PlanningPolygon2d {
  id: string;
  source: 'user' | 'osm';
  kind: 'blocked-area' | 'building' | 'wooded';
  label: string;
  pointsAttr: string;
  vertices: Array<{ x: number; y: number }>;
}

interface ScenarioPreviewSegment2d {
  scenarioId: string;
  fromStationId: string;
  toStationId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  kind: 'sight-line' | 'cross-tie';
  active: boolean;
}

const EMPTY_PLANNING_INPUT_POINTS: PlanningInputPoint2d[] = [];
const EMPTY_PLANNING_POLYGONS: PlanningPolygon2d[] = [];
const EMPTY_SELECTED_PLANNING_POLYGON_IDS: string[] = [];
const EMPTY_BRACE_PREVIEW_POINTS: BracePreviewPoint2d[] = [];
const EMPTY_SCENARIO_PREVIEW_SEGMENTS: ScenarioPreviewSegment2d[] = [];
const EMPTY_TOOL_HIGHLIGHT_IDS = new Set<string>();
const EMPTY_TOOL_HIGHLIGHT_SEGMENTS: Array<{ key: string; fromId: string; toId: string }> = [];

interface MapViewSvg2dProps {
  marker2d: number;
  view2d: View2dState;
  showLabels: boolean;
  interactionPhase: 'idle' | 'interacting' | 'settling';
  originalGeometryOpacity: number;
  filteredVisiblePoints2d: ProjectedPoint2D[];
  visiblePointLabels2d: Set<string>;
  labelOffset2d: number;
  labelFont2d: number;
  labelStroke2d: number;
  filteredVisibleMapLines2d: ProjectedMapLine2D[];
  selectedObservationId: number | null;
  selectedObservationPairKey: string | null;
  lineWidth2d: number;
  onSelectObservation?: (_observationId: number) => void;
  selectedStationId: string | null;
  highlightedToolStationIds?: ReadonlySet<string>;
  highlightedToolSegments?: ReadonlyArray<{ key: string; fromId: string; toId: string }>;
  pointRadius2d: number;
  transformedOverlayActive: boolean;
  transformedLines2d: TransformedLine2d[];
  transformedPoints2d: TransformedPoint2d[];
  planningInputPoints2d?: PlanningInputPoint2d[];
  planningPolygons2d?: PlanningPolygon2d[];
  selectedPlanningPolygonIds?: string[];
  renderPlanningPolygonBodies?: boolean;
  renderPlanningInputPoints?: boolean;
  bracePreviewPoints2d?: BracePreviewPoint2d[];
  scenarioPreviewSegments2d?: ScenarioPreviewSegment2d[];
  renderBracePreviewMarkers?: boolean;
  renderScenarioPreviewSegments?: boolean;
  selectionBoxRect?: {
    x: number;
    y: number;
    width: number;
    height: number;
    mode: 'window' | 'crossing';
  } | null;
  onPlanningVertexMouseDown?: (
    _polygonId: string,
    _vertexIndex: number,
    _event: React.MouseEvent<SVGCircleElement>,
  ) => void;
  project2d: (_x: number, _y: number) => { x: number; y: number };
}

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

type PlanningLayerProps = Pick<
  MapViewSvg2dProps,
  | 'planningPolygons2d'
  | 'selectedPlanningPolygonIds'
  | 'renderPlanningPolygonBodies'
  | 'lineWidth2d'
  | 'pointRadius2d'
  | 'onPlanningVertexMouseDown'
  | 'planningInputPoints2d'
  | 'renderPlanningInputPoints'
  | 'scenarioPreviewSegments2d'
  | 'renderScenarioPreviewSegments'
  | 'bracePreviewPoints2d'
  | 'renderBracePreviewMarkers'
>;

type SelectionLayerProps = Pick<
  MapViewSvg2dProps,
  | 'filteredVisibleMapLines2d'
  | 'selectedObservationId'
  | 'selectedObservationPairKey'
  | 'lineWidth2d'
  | 'onSelectObservation'
  | 'selectedStationId'
  | 'highlightedToolStationIds'
  | 'highlightedToolSegments'
  | 'filteredVisiblePoints2d'
  | 'pointRadius2d'
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

const SvgPlanningLayer = React.memo(function SvgPlanningLayer({
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

const SvgSelectionLayer = React.memo(function SvgSelectionLayer({
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
