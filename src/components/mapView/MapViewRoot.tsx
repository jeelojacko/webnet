import React, {
  useMemo,
} from 'react';
import {
  buildMap3DScene,
} from '../../engine/map3d';
import { RAD_TO_DEG } from '../../engine/angles';
import { DEFAULT_PLANNING_MAP_STATE } from '../../engine/planningMapState';
import MapViewContent from './MapViewContent';
import type { MapToolPickTarget } from './MapViewToolOverlay';
import {
  noteMapViewPerfCounter,
} from './mapViewPerf';
import { buildMapScenePointBounds2d } from './mapViewSelectors';
import { useMapViewContentProps } from './useMapViewContentProps';
import { useMapViewCoordinates } from './useMapViewCoordinates';
import { useMapViewDragInteractions } from './useMapViewDragInteractions';
import { useMapViewEffectiveMode } from './useMapViewEffectiveMode';
import { useMapViewPlanningActions } from './useMapViewPlanningActions';
import { useMapViewRenderSurfaces } from './useMapViewRenderSurfaces';
import { useMapViewRootUiState } from './useMapViewRootUiState';
import { useMapViewViewportState } from './useMapViewViewportState';
import {
  useMapViewContextMenuDismiss,
} from './useMapViewShellEffects';
import { useMapViewSnapshotSync } from './useMapViewSnapshotSync';
import { useMapViewStationDisplay } from './useMapViewStationDisplay';
import { useMapViewToolState } from './useMapViewToolState';
import { useMapViewTransformAvailability } from './useMapViewTransformAvailability';
import { useMapViewTransformOverlay } from './useMapViewTransformOverlay';
import type { MapViewProps, MapViewSnapshot } from './MapView.types';
import {
  FT_PER_M,
  OSM_INTERACTION_TILE_CAP,
  OSM_INTERACTION_ZOOM_DELTA,
  OSM_VISIBLE_TILE_CAP,
} from './mapViewConstants';

export type { MapViewSnapshot } from './MapView.types';

const MapView: React.FC<MapViewProps> = ({
  result,
  units,
  planningMap = DEFAULT_PLANNING_MAP_STATE,
  onPlanningMapChange,
  inputPointsLoaded = false,
  onLoadInputPoints = null,
  showLostStations = true,
  mode = '2d',
  viewportWidthOverride,
  adjustedPointsExportSettings,
  derivedResult = null,
  selectedStationId = null,
  selectedObservationId = null,
  onSelectStation,
  onSelectObservation,
  snapshot = null,
  onSnapshotChange,
}) => {
  noteMapViewPerfCounter('map:component-renders');
  const unitScale = units === 'ft' ? FT_PER_M : 1;
  const isPreanalysis = result.preanalysisMode === true;
  const { stations, observations } = result;
  const {
    closeContextMenu,
    contextMenu,
    contextMenuRef,
    focusSelection,
    hideMinorGeometry,
    obstacleFetchSignatureRef,
    selectionBox,
    setContextMenu,
    setFocusSelection,
    setHideMinorGeometry,
    setSelectionBox,
    setShowLabels,
    setShowTransformedCoordinates,
    showLabels,
    showTransformedCoordinates,
    svgRef,
    viewportWidth,
  } = useMapViewRootUiState({ result, snapshot, viewportWidthOverride });
  const {
    clearDraftBlockedPolygon,
    commitDraftBlockedPolygon,
    draftBlockedPolygon,
    planningVertexDragRef,
    removePlanningPolygon,
    removeSelectedPlanningPolygons,
    selectedPlanningPolygonIds,
    setDraftBlockedPolygon,
    setSelectedPlanningPolygonIds,
    updatePlanningPolygonVertices,
  } = useMapViewPlanningActions({
    onPlanningMapChange,
    planningMap,
  });

  const scene3d = useMemo(
    () => buildMap3DScene(result, showLostStations),
    [result, showLostStations],
  );

  const { points, bbox } = useMemo(() => buildMapScenePointBounds2d(scene3d), [scene3d]);

  const {
    ellipseStroke,
    stationFill,
    stationSeverity,
    visibleStationIds,
    visibleStationRows,
  } = useMapViewStationDisplay({
    showLostStations,
    stations,
    weakGeometryDiagnostics: result.weakGeometryDiagnostics,
  });

  const {
    activeTool,
    angleBetween,
    angleFromId,
    angleFromInput,
    anglePivotId,
    anglePivotInput,
    angleToId,
    angleToInput,
    applyPickedToolStation,
    clearToolPickTarget,
    closeTool,
    highlightedToolSegments,
    highlightedToolStationIds,
    inverse,
    inverseFromId,
    inverseFromInput,
    inverseToId,
    inverseToInput,
    openTool,
    setAngleFromInput,
    setAnglePivotInput,
    setAngleToInput,
    setInverseFromInput,
    setInverseToInput,
    toggleToolPickTarget,
    toolPickTarget,
  } = useMapViewToolState({
    onCloseContextMenu: closeContextMenu,
    snapshot,
    stations,
    visibleStationIds,
  });

  const { effectiveMode, fallbackReason } = useMapViewEffectiveMode({
    mode, scene3d, viewportWidth, viewportWidthOverride,
  });
  const {
    basemapCanvasRef,
    containerRef,
    geometryCanvasRef,
    layerRenderer,
    planningCanvasRef,
    renderSurfaceLayout,
    renderSurfaceRef,
    renderer2d,
    tileStoreRef,
    webglCanvasRef,
    webglEligible,
  } = useMapViewRenderSurfaces({ effectiveMode, units });
  useMapViewContextMenuDismiss({ contextMenuOpen: contextMenu.open, contextMenuRef, setContextMenu });
  const {
    applyPanPreviewOffset,
    basemapDescriptorView2d,
    camera3d,
    derivedView2d,
    dragMoveFrameRef,
    dragRef,
    idlePrefetchReady,
    interactionPhase,
    isDragging,
    markInteracting,
    middleClickRef,
    panPreviewCommitViewRef,
    panPreviewOffsetRef,
    pendingDragClientRef,
    pendingView2dRef,
    queueView2dUpdate,
    reset2dView,
    reset3dView,
    setBasemapDescriptorView2d,
    setCamera3d,
    setFrozenDerivedView2d,
    setIsDragging,
    setView2d,
    view2d,
  } = useMapViewViewportState({
    bbox,
    containerRef,
    effectiveMode,
    planningBasemapMode: planningMap.basemapMode,
    renderSurfaceRef,
    scene3d,
    snapshot,
  });
  const {
    showTransformToggle,
    transformedLines2d,
    transformedOverlayActive,
    transformedOverlayConfig,
    transformedPoints2d,
  } = useMapViewTransformOverlay({
    adjustedPointsExportSettings,
    effectiveMode,
    observations,
    points,
    result,
    showLostStations,
    showTransformedCoordinates,
    stations,
    units,
  });

  useMapViewTransformAvailability({
    available: transformedOverlayConfig.available, effectiveMode, setShowTransformedCoordinates,
  });

  useMapViewSnapshotSync({
    activeTool,
    angleFromInput,
    anglePivotInput,
    angleToInput,
    camera3d,
    effectiveMode,
    focusSelection,
    hideMinorGeometry,
    initialView2d: snapshot?.view2d ?? { zoom: 1, panX: 0, panY: 0 },
    interactionPhase,
    inverseFromInput,
    inverseToInput,
    onSnapshotChange,
    showLabels,
    showTransformedCoordinates,
    view2d,
  });

  const { clearMapSelection, project2d, projection2d, svgToMapCoords, toSvgCoords } =
    useMapViewCoordinates({
      bbox,
      clearToolPickTarget,
      onSelectObservation,
      onSelectStation,
      planningVertexDragRef,
      selectedObservationId,
      selectedPlanningPolygonIds,
      selectedStationId,
      selectionBox,
      setContextMenu,
      setSelectedPlanningPolygonIds,
      setSelectionBox,
      svgRef,
      toolPickTarget,
      view2d,
    });

  const { beginDrag, handleMouseDown, handleMouseUp, handleWheel } =
    useMapViewDragInteractions({
      applyPanPreviewOffset,
      camera3d,
      dragMoveFrameRef,
      dragRef,
      effectiveMode,
      isDragging,
      markInteracting,
      middleClickRef,
      panPreviewCommitViewRef,
      panPreviewOffsetRef,
      pendingDragClientRef,
      pendingView2dRef,
      planningMap,
      planningVertexDragRef,
      queueView2dUpdate,
      reset2dView,
      reset3dView,
      scene3d,
      selectionBox,
      setCamera3d,
      setFrozenDerivedView2d,
      setIsDragging,
      setSelectionBox,
      setView2d,
      svgToMapCoords,
      toSvgCoords,
      updatePlanningPolygonVertices,
    });

  const contentProps = useMapViewContentProps({
    activeTool,
    angleBetween,
    angleFromId,
    angleFromInput,
    anglePivotId,
    anglePivotInput,
    angleToId,
    angleToInput,
    applyPickedToolStation,
    basemapCanvasRef,
    basemapDescriptorView2d,
    beginDrag,
    bbox,
    camera3d,
    clearDraftBlockedPolygon,
    clearMapSelection,
    clearToolPickTarget,
    closeTool,
    closeContextMenu,
    commitDraftBlockedPolygon,
    containerRef,
    contextMenu,
    contextMenuRef,
    derivedResult,
    derivedView2d,
    dragRef,
    draftBlockedPolygon,
    draftBlockedPolygonLength: draftBlockedPolygon.length,
    effectiveMode,
    ellipseStroke,
    fallbackReason,
    focusSelection,
    geometryCanvasRef,
    handleMouseDown,
    handleMouseUp,
    handleWheel,
    highlightedToolSegments,
    highlightedToolStationIds,
    hideMinorGeometry,
    idlePrefetchReady,
    inputPointsLoaded,
    interactionPhase,
    inverse,
    inverseFromId,
    inverseFromInput,
    inverseToId,
    inverseToInput,
    isPreanalysis,
    isDragging,
    layerRenderer,
    mode,
    obstacleFetchSignatureRef,
    observations,
    onLoadInputPoints,
    onPlanningMapChange,
    onSelectObservation,
    onSelectStation,
    openTool,
    planningCanvasRef,
    planningMap,
    planningVertexDragRef,
    points,
    project2d,
    projection2d,
    removePlanningPolygon,
    removeSelectedPlanningPolygons,
    renderSurfaceLayout,
    renderSurfaceRef,
    renderer2d,
    result,
    scene3d,
    selectedObservationId,
    selectedPlanningPolygonIds,
    selectedStationId,
    selectionBox,
    setBasemapDescriptorView2d,
    setCamera3d,
    setContextMenu,
    setDraftBlockedPolygon,
    setAngleFromInput,
    setAnglePivotInput,
    setAngleToInput,
    setFocusSelection,
    setHideMinorGeometry,
    setInverseFromInput,
    setInverseToInput,
    setSelectedPlanningPolygonIds,
    setSelectionBox,
    setShowLabels,
    setShowTransformedCoordinates,
    showLabels,
    showLostStations,
    showTransformToggle,
    stationFill,
    stationSeverity,
    stations,
    svgRef,
    svgToMapCoords,
    tileStoreRef,
    toSvgCoords,
    toggleToolPickTarget,
    toolPickTarget,
    transformedLines2d,
    transformedOverlayActive,
    transformedOverlayConfig,
    transformedPoints2d,
    unitScale,
    units,
    updatePlanningPolygonVertices,
    view2d,
    visibleStationRows,
    webglCanvasRef,
    webglEligible,
  });

  return <MapViewContent {...contentProps} />;
};

export default MapView;
