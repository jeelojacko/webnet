import React from 'react';

import type { ProjectedMapLine2D, ProjectedPoint2D, View2dState } from './mapView2d';

export interface TransformedLine2d {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface TransformedPoint2d {
  id: string;
  x: number;
  y: number;
  fixed: boolean;
}

export interface BracePreviewPoint2d {
  scenarioId: string;
  stationId: string;
  templateLabel: string;
  x: number;
  y: number;
  active: boolean;
}

export interface PlanningInputPoint2d {
  stationId: string;
  x: number;
  y: number;
}

export interface PlanningPolygon2d {
  id: string;
  source: 'user' | 'osm';
  kind: 'blocked-area' | 'building' | 'wooded';
  label: string;
  pointsAttr: string;
  vertices: Array<{ x: number; y: number }>;
}

export interface ScenarioPreviewSegment2d {
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

export interface MapViewSvg2dProps {
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

export type PlanningLayerProps = Pick<
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

export type SelectionLayerProps = Pick<
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
