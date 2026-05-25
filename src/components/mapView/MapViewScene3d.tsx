import React from 'react';

import type { Map3DScene, Vec3 } from '../../engine/map3d';
import { buildStationPairKey } from '../../engine/resultDerivedModels';
import { clamp } from './mapView2d';
import {
  buildEllipsoidRings3d,
  type ProjectedPoint3D,
  type ProjectedStation3D,
} from './mapView3d';

const EMPTY_TOOL_HIGHLIGHT_SEGMENTS: Array<{ key: string; fromId: string; toId: string }> = [];
const EMPTY_TOOL_HIGHLIGHT_IDS = new Set<string>();

interface MapObservationLink3d {
  observationId: number;
}

interface MapViewScene3dProps {
  viewWidth: number;
  viewHeight: number;
  scene3d: Map3DScene;
  projected3d: ProjectedStation3D[];
  projected3dById: ReadonlyMap<string, ProjectedPoint3D>;
  visiblePointLabels3d: ReadonlySet<string>;
  project3d: (_point: Vec3) => ProjectedPoint3D;
  sceneRadius: number;
  maxEllipsoidSamples: number;
  ellipseStroke: (_stationId: string) => string;
  stationFill: (_stationId: string, _fixed: boolean) => string;
  mapLinkByPairKey: ReadonlyMap<string, MapObservationLink3d>;
  selectedObservationId: number | null;
  selectedObservationPairKey: string | null;
  onSelectObservation?: (_observationId: number) => void;
  selectedStationId: string | null;
  highlightedToolStationIds?: ReadonlySet<string>;
  highlightedToolSegments?: ReadonlyArray<{ key: string; fromId: string; toId: string }>;
  onSelectStation?: (_stationId: string) => void;
}

const MapViewScene3d: React.FC<MapViewScene3dProps> = ({
  viewWidth,
  viewHeight,
  scene3d,
  projected3d,
  projected3dById,
  visiblePointLabels3d,
  project3d,
  sceneRadius,
  maxEllipsoidSamples,
  ellipseStroke,
  stationFill,
  mapLinkByPairKey,
  selectedObservationId,
  selectedObservationPairKey,
  onSelectObservation,
  selectedStationId,
  highlightedToolStationIds = EMPTY_TOOL_HIGHLIGHT_IDS,
  highlightedToolSegments = EMPTY_TOOL_HIGHLIGHT_SEGMENTS,
  onSelectStation,
}) => (
  <>
    <rect x={0} y={0} width={viewWidth} height={viewHeight} fill="#020617" />
    {scene3d.edges.map((edge, idx) => {
      const a = projected3dById.get(edge.from);
      const b = projected3dById.get(edge.to);
      if (!a || !b) return null;
      const pairKey = buildStationPairKey(edge.from, edge.to);
      const link = mapLinkByPairKey.get(pairKey) ?? null;
      const isSelected =
        (link != null && link.observationId === selectedObservationId) ||
        (selectedObservationPairKey != null && pairKey === selectedObservationPairKey);
      const isToolHighlighted = highlightedToolSegments.some((segment) => segment.key === pairKey);
      if (isSelected || isToolHighlighted) return null;
      return (
        <line
          key={`edge3d-${idx}`}
          data-map-observation={link?.observationId ?? `${edge.from}-${edge.to}`}
          x1={a.x}
          y1={a.y}
          x2={b.x}
          y2={b.y}
          stroke="#334155"
          strokeWidth={1}
          opacity={0.65}
          onClick={() => {
            if (link) onSelectObservation?.(link.observationId);
          }}
          className={link && onSelectObservation ? 'cursor-pointer' : undefined}
        />
      );
    })}
    {highlightedToolSegments.map((segment, idx) => {
      const a = projected3dById.get(segment.fromId);
      const b = projected3dById.get(segment.toId);
      if (!a || !b) return null;
      return (
        <line
          key={`edge3d-tool-highlight-${idx}`}
          data-map-tool-line-highlight={segment.key}
          x1={a.x}
          y1={a.y}
          x2={b.x}
          y2={b.y}
          stroke="#f59e0b"
          strokeWidth={1.8}
          opacity={1}
          pointerEvents="none"
        />
      );
    })}
    {scene3d.edges.map((edge, idx) => {
      const a = projected3dById.get(edge.from);
      const b = projected3dById.get(edge.to);
      if (!a || !b) return null;
      const pairKey = buildStationPairKey(edge.from, edge.to);
      const link = mapLinkByPairKey.get(pairKey) ?? null;
      const isSelected =
        (link != null && link.observationId === selectedObservationId) ||
        (selectedObservationPairKey != null && pairKey === selectedObservationPairKey);
      if (!isSelected) return null;
      return (
        <line
          key={`edge3d-selected-${idx}`}
          data-map-observation={link?.observationId ?? `${edge.from}-${edge.to}`}
          x1={a.x}
          y1={a.y}
          x2={b.x}
          y2={b.y}
          stroke="#22d3ee"
          strokeWidth={2}
          opacity={1}
          onClick={() => {
            if (link) onSelectObservation?.(link.observationId);
          }}
          className={link && onSelectObservation ? 'cursor-pointer' : undefined}
        />
      );
    })}
    {projected3d.map(({ node, p }) => {
      const pointRadius = clamp(7 - Math.log10(Math.max(1, p.depth)), 2.2, 7);
      const labelSize = clamp(10 - Math.log10(Math.max(1, p.depth)) * 0.8, 8, 12);
      const labelOffset = clamp(8 - Math.log10(Math.max(1, p.depth)), 5, 10);
      const rings = node.ellipsoid
        ? buildEllipsoidRings3d(
            node.position,
            node.ellipsoid,
            sceneRadius,
            project3d,
            maxEllipsoidSamples,
          )
        : [];
      return (
        <g key={node.id}>
          {rings.map((poly, polyIdx) => (
            <polyline
              key={`${node.id}-ell-${polyIdx}`}
              points={poly}
              fill="none"
              stroke={ellipseStroke(node.id)}
              strokeWidth={0.9}
              opacity={0.45}
            />
          ))}
          <circle
            data-map-station={node.id}
            cx={p.x}
            cy={p.y}
            r={pointRadius}
            fill={stationFill(node.id, node.fixed)}
            stroke="none"
            onClick={() => onSelectStation?.(node.id)}
            className={onSelectStation ? 'cursor-pointer' : undefined}
          />
          {highlightedToolStationIds.has(node.id) && (
            <circle
              data-map-tool-station-highlight={node.id}
              cx={p.x}
              cy={p.y}
              r={pointRadius * 1.65}
              fill="none"
              stroke="#f59e0b"
              strokeWidth={1.9}
              pointerEvents="none"
            />
          )}
          {selectedStationId === node.id && (
            <circle
              cx={p.x}
              cy={p.y}
              r={pointRadius * 1.45}
              fill="none"
              stroke="#22d3ee"
              strokeWidth={2}
              pointerEvents="none"
            />
          )}
          {visiblePointLabels3d.has(node.id) && (
            <text
              data-map-label={node.id}
              x={p.x + labelOffset}
              y={p.y - labelOffset}
              fontSize={labelSize}
              fill="#e2e8f0"
              stroke="#020617"
              strokeWidth={1.2}
              paintOrder="stroke"
            >
              {node.id}
            </text>
          )}
        </g>
      );
    })}
  </>
);

export default MapViewScene3d;
