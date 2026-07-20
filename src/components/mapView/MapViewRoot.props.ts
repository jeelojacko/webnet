import type React from 'react';
import MapViewContextMenu from './MapViewContextMenu';
import MapViewScene3d from './MapViewScene3d';
import MapViewSvg2d from './MapViewSvg2d';
import MapViewToolOverlay, { type MapToolPickTarget } from './MapViewToolOverlay';
import { MAX_ELLIPSOID_SAMPLES, VIEW_H, VIEW_W } from './mapViewConstants';

type Svg2dProps = React.ComponentProps<typeof MapViewSvg2d>;
type Scene3dProps = React.ComponentProps<typeof MapViewScene3d>;
type ToolOverlayProps = React.ComponentProps<typeof MapViewToolOverlay>;
type ContextMenuProps = React.ComponentProps<typeof MapViewContextMenu>;

type Point2d = { x: number; y: number };

interface BuildSvg2dPropsArgs {
  bracePreviewPoints2d: Svg2dProps['bracePreviewPoints2d'];
  filteredVisibleMapLines2d: Svg2dProps['filteredVisibleMapLines2d'];
  filteredVisiblePoints2d: Svg2dProps['filteredVisiblePoints2d'];
  handlePlanningVertexMouseDown: NonNullable<Svg2dProps['onPlanningVertexMouseDown']>;
  highlightedToolSegments: Svg2dProps['highlightedToolSegments'];
  highlightedToolStationIds: Svg2dProps['highlightedToolStationIds'];
  interactionPhase: Svg2dProps['interactionPhase'];
  labelFont2d: Svg2dProps['labelFont2d'];
  labelOffset2d: Svg2dProps['labelOffset2d'];
  labelStroke2d: Svg2dProps['labelStroke2d'];
  lineWidth2d: Svg2dProps['lineWidth2d'];
  marker2d: Svg2dProps['marker2d'];
  onSelectObservation: Svg2dProps['onSelectObservation'];
  originalGeometryOpacity: Svg2dProps['originalGeometryOpacity'];
  planningInputPoints2d: Svg2dProps['planningInputPoints2d'];
  planningPolygons2d: Svg2dProps['planningPolygons2d'];
  pointRadius2d: Svg2dProps['pointRadius2d'];
  project2d: (_x: number, _y: number) => Point2d;
  renderer2d: 'canvas' | 'webgl';
  scenarioPreviewSegments2d: Svg2dProps['scenarioPreviewSegments2d'];
  selectedObservationId: number | null;
  selectedObservationPairKey: Svg2dProps['selectedObservationPairKey'];
  selectedPlanningPolygonIds: string[];
  selectedStationId: string | null;
  selectionBoxRect: Svg2dProps['selectionBoxRect'];
  showLabels: boolean;
  transformedLines2d: Svg2dProps['transformedLines2d'];
  transformedOverlayActive: boolean;
  transformedPoints2d: Svg2dProps['transformedPoints2d'];
  view2d: Svg2dProps['view2d'];
  visiblePointLabels2d: Svg2dProps['visiblePointLabels2d'];
}

interface BuildScene3dPropsArgs {
  camera3d: unknown | null;
  ellipseStroke: Scene3dProps['ellipseStroke'];
  highlightedToolSegments: Scene3dProps['highlightedToolSegments'];
  highlightedToolStationIds: Scene3dProps['highlightedToolStationIds'];
  mapLinkByPairKey: Scene3dProps['mapLinkByPairKey'];
  onSelectObservation: Scene3dProps['onSelectObservation'];
  onSelectStation: Scene3dProps['onSelectStation'];
  project3d: Scene3dProps['project3d'];
  projected3d: Scene3dProps['projected3d'];
  projected3dById: Scene3dProps['projected3dById'];
  scene3d: Scene3dProps['scene3d'];
  selectedObservationId: number | null;
  selectedObservationPairKey: Scene3dProps['selectedObservationPairKey'];
  selectedStationId: string | null;
  stationFill: Scene3dProps['stationFill'];
  visiblePointLabels3d: Scene3dProps['visiblePointLabels3d'];
}

interface BuildContextMenuPropsArgs {
  contextMenu: {
    x: number;
    y: number;
    planningPolygon: { polygonLabel: string } | null;
  };
  handleDeletePlanningPolygon: () => void;
  handleEditPlanningPolygon: () => void;
  handleRemoveSelectedPlanningPolygons: () => void;
  openTool: ContextMenuProps['onOpenTool'];
  selectedPlanningPolygonIds: string[];
}

interface BuildToolOverlayPropsArgs {
  activeTool: ToolOverlayProps['activeTool'] | 'none';
  angleBetween: ToolOverlayProps['angleBetween'];
  angleFromId: string | null;
  angleFromInput: string;
  anglePivotId: string | null;
  anglePivotInput: string;
  angleToId: string | null;
  angleToInput: string;
  closeTool: ToolOverlayProps['onClose'];
  inverse: ToolOverlayProps['inverse'];
  inverseFromId: string | null;
  inverseFromInput: string;
  inverseToId: string | null;
  inverseToInput: string;
  isPreanalysis: boolean;
  setAngleFromInput: (_value: string) => void;
  setAnglePivotInput: (_value: string) => void;
  setAngleToInput: (_value: string) => void;
  setInverseFromInput: (_value: string) => void;
  setInverseToInput: (_value: string) => void;
  toggleToolPickTarget: (_target: MapToolPickTarget) => void;
  toolPickTarget: MapToolPickTarget | null;
  unitScale: number;
  units: 'm' | 'ft';
  visibleStationRows: ToolOverlayProps['visibleStationRows'];
}

export const buildSvg2dProps = ({
  bracePreviewPoints2d,
  filteredVisibleMapLines2d,
  filteredVisiblePoints2d,
  handlePlanningVertexMouseDown,
  highlightedToolSegments,
  highlightedToolStationIds,
  interactionPhase,
  labelFont2d,
  labelOffset2d,
  labelStroke2d,
  lineWidth2d,
  marker2d,
  onSelectObservation,
  originalGeometryOpacity,
  planningInputPoints2d,
  planningPolygons2d,
  pointRadius2d,
  project2d,
  renderer2d,
  scenarioPreviewSegments2d,
  selectedObservationId,
  selectedObservationPairKey,
  selectedPlanningPolygonIds,
  selectedStationId,
  selectionBoxRect,
  showLabels,
  transformedLines2d,
  transformedOverlayActive,
  transformedPoints2d,
  view2d,
  visiblePointLabels2d,
}: BuildSvg2dPropsArgs): Svg2dProps => ({
  marker2d,
  view2d,
  showLabels,
  interactionPhase,
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
  highlightedToolStationIds,
  highlightedToolSegments,
  pointRadius2d,
  transformedOverlayActive,
  transformedLines2d,
  transformedPoints2d,
  planningInputPoints2d,
  planningPolygons2d,
  selectedPlanningPolygonIds,
  renderPlanningPolygonBodies: false,
  renderPlanningInputPoints: false,
  bracePreviewPoints2d,
  scenarioPreviewSegments2d,
  renderBracePreviewMarkers: renderer2d !== 'webgl',
  renderScenarioPreviewSegments: renderer2d !== 'webgl',
  selectionBoxRect,
  onPlanningVertexMouseDown: handlePlanningVertexMouseDown,
  project2d,
});

export const buildScene3dProps = ({
  camera3d,
  ellipseStroke,
  highlightedToolSegments,
  highlightedToolStationIds,
  mapLinkByPairKey,
  onSelectObservation,
  onSelectStation,
  project3d,
  projected3d,
  projected3dById,
  scene3d,
  selectedObservationId,
  selectedObservationPairKey,
  selectedStationId,
  stationFill,
  visiblePointLabels3d,
}: BuildScene3dPropsArgs): Scene3dProps | null =>
  camera3d
    ? {
        viewWidth: VIEW_W,
        viewHeight: VIEW_H,
        scene3d,
        projected3d,
        projected3dById,
        visiblePointLabels3d,
        project3d,
        sceneRadius: scene3d.extents.radius,
        maxEllipsoidSamples: MAX_ELLIPSOID_SAMPLES,
        ellipseStroke,
        stationFill,
        mapLinkByPairKey,
        selectedObservationId,
        selectedObservationPairKey,
        onSelectObservation,
        selectedStationId,
        highlightedToolStationIds,
        highlightedToolSegments,
        onSelectStation,
      }
    : null;

export const buildContextMenuProps = ({
  contextMenu,
  handleDeletePlanningPolygon,
  handleEditPlanningPolygon,
  handleRemoveSelectedPlanningPolygons,
  openTool,
  selectedPlanningPolygonIds,
}: BuildContextMenuPropsArgs): ContextMenuProps => ({
  x: contextMenu.x,
  y: contextMenu.y,
  onOpenTool: openTool,
  planningPolygonLabel: contextMenu.planningPolygon?.polygonLabel ?? null,
  selectedPlanningPolygonCount: selectedPlanningPolygonIds.length,
  onEditPlanningPolygon: contextMenu.planningPolygon != null ? handleEditPlanningPolygon : null,
  onDeletePlanningPolygon: contextMenu.planningPolygon != null ? handleDeletePlanningPolygon : null,
  onDeleteSelectedPlanningPolygons:
    selectedPlanningPolygonIds.length > 1 ? handleRemoveSelectedPlanningPolygons : null,
});

export const buildToolOverlayProps = ({
  activeTool,
  angleBetween,
  angleFromId,
  angleFromInput,
  anglePivotId,
  anglePivotInput,
  angleToId,
  angleToInput,
  closeTool,
  inverse,
  inverseFromId,
  inverseFromInput,
  inverseToId,
  inverseToInput,
  isPreanalysis,
  setAngleFromInput,
  setAnglePivotInput,
  setAngleToInput,
  setInverseFromInput,
  setInverseToInput,
  toggleToolPickTarget,
  toolPickTarget,
  unitScale,
  units,
  visibleStationRows,
}: BuildToolOverlayPropsArgs): ToolOverlayProps | null =>
  activeTool !== 'none'
    ? {
        activeTool,
        visibleStationRows,
        isPreanalysis,
        units,
        unitScale,
        onClose: closeTool,
        inverseFromInput,
        inverseToInput,
        inverseFromId,
        inverseToId,
        onInverseFromInputChange: setInverseFromInput,
        onInverseToInputChange: setInverseToInput,
        pickTarget: toolPickTarget,
        onTogglePickTarget: toggleToolPickTarget,
        inverse,
        anglePivotInput,
        angleFromInput,
        angleToInput,
        anglePivotId,
        angleFromId,
        angleToId,
        onAnglePivotInputChange: setAnglePivotInput,
        onAngleFromInputChange: setAngleFromInput,
        onAngleToInputChange: setAngleToInput,
        angleBetween,
      }
    : null;
