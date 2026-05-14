import React from 'react';

import type { ProjectedMapLine2D, ProjectedPoint2D, View2dState } from './mapView2d';

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

interface MapViewSvg2dProps {
  marker2d: number;
  view2d: View2dState;
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
  pointRadius2d: number;
  transformedOverlayActive: boolean;
  transformedLines2d: TransformedLine2d[];
  transformedPoints2d: TransformedPoint2d[];
  planningInputPoints2d?: PlanningInputPoint2d[];
  planningPolygons2d?: PlanningPolygon2d[];
  selectedPlanningPolygonId?: string | null;
  bracePreviewPoints2d?: BracePreviewPoint2d[];
  scenarioPreviewSegments2d?: ScenarioPreviewSegment2d[];
  onPlanningVertexMouseDown?: (
    _polygonId: string,
    _vertexIndex: number,
    _event: React.MouseEvent<SVGCircleElement>,
  ) => void;
  project2d: (_x: number, _y: number) => { x: number; y: number };
}

const MapViewSvg2d: React.FC<MapViewSvg2dProps> = ({
  marker2d,
  view2d,
  originalGeometryOpacity,
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
  pointRadius2d,
  transformedOverlayActive,
  transformedLines2d,
  transformedPoints2d,
  planningInputPoints2d = [],
  planningPolygons2d = [],
  selectedPlanningPolygonId = null,
  bracePreviewPoints2d = [],
  scenarioPreviewSegments2d = [],
  onPlanningVertexMouseDown,
  project2d,
}) => (
  <>
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

    <g
      transform={`translate(${view2d.panX} ${view2d.panY}) scale(${view2d.zoom})`}
      opacity={originalGeometryOpacity}
    >
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
    </g>

    <g transform={`translate(${view2d.panX} ${view2d.panY}) scale(${view2d.zoom})`}>
      {planningPolygons2d.map((polygon) => (
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
          strokeWidth={polygon.id === selectedPlanningPolygonId ? pointRadius2d * 0.34 : pointRadius2d * 0.18}
        >
          <title>{polygon.label || polygon.kind}</title>
        </polygon>
      ))}

      {planningPolygons2d
        .filter((polygon) => polygon.id === selectedPlanningPolygonId)
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

      {planningInputPoints2d.map((point) => (
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

      {scenarioPreviewSegments2d.map((segment) => (
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
          <text
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
        </g>
      ))}

      {filteredVisibleMapLines2d
        .filter(
          (line) =>
            line.observationId === selectedObservationId ||
            (selectedObservationPairKey != null && line.pairKey === selectedObservationPairKey),
        )
        .map((line) => (
          <line
            key={`${line.key}-selected`}
            data-map-observation={line.observationId}
            x1={line.x1}
            y1={line.y1}
            x2={line.x2}
            y2={line.y2}
            stroke="#22d3ee"
            strokeWidth={lineWidth2d * 2}
            markerEnd="url(#arrow)"
            opacity={1}
            onClick={() => onSelectObservation?.(line.observationId)}
            className={onSelectObservation ? 'cursor-pointer' : undefined}
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
              stroke="#22d3ee"
              strokeWidth={pointRadius2d * 0.6}
              pointerEvents="none"
            />
          ))}
    </g>

    {transformedOverlayActive && (
      <g transform={`translate(${view2d.panX} ${view2d.panY}) scale(${view2d.zoom})`}>
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
                cx={proj.x}
                cy={proj.y}
                r={pointRadius2d}
                fill={point.fixed ? '#34d399' : '#f97316'}
              />
              {visiblePointLabels2d.has(point.id) && (
                <text
                  data-map-label={point.id}
                  x={proj.x + labelOffset2d}
                  y={proj.y - labelOffset2d}
                  fontSize={labelFont2d}
                  fill="#f8fafc"
                  stroke="#082f49"
                  strokeWidth={labelStroke2d}
                  paintOrder="stroke"
                >
                  {point.id}
                </text>
              )}
            </g>
          );
        })}
      </g>
    )}
  </>
);

export default MapViewSvg2d;
