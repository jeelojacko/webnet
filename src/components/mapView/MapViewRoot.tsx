import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  buildMap3DScene,
} from '../../engine/map3d';
import { RAD_TO_DEG } from '../../engine/angles';
import { noteUiPerfStage, noteUiTabReady } from '../../hooks/useUiPerfMonitor';
import { DEFAULT_PLANNING_MAP_STATE } from '../../engine/planningMapState';
import MapViewContent from './MapViewContent';
import {
  buildContextMenuProps,
  buildScene3dProps,
  buildSvg2dProps,
  buildToolOverlayProps,
} from './MapViewRoot.props';
import type { MapToolPickTarget } from './MapViewToolOverlay';
import {
  noteMapViewPerfCounter,
} from './mapViewPerf';
import { buildMapScenePointBounds2d } from './mapViewSelectors';
import {
  type PlanningPolygonTarget,
  type ScreenSelectionBox,
} from './mapViewInteraction';
import { useMapView2dRenderState } from './useMapView2dRenderState';
import { useMapView3dProjection } from './useMapView3dProjection';
import { useMapViewCoordinates } from './useMapViewCoordinates';
import { useMapViewDragInteractions } from './useMapViewDragInteractions';
import { useMapViewPlanningActions } from './useMapViewPlanningActions';
import { useMapViewRenderSurfaces } from './useMapViewRenderSurfaces';
import { useMapViewSelectionInteractions } from './useMapViewSelectionInteractions';
import { useMapViewViewportState } from './useMapViewViewportState';
import {
  useMapViewContextMenuDismiss,
  useMapViewViewportWidth,
} from './useMapViewShellEffects';
import { useMapViewSnapshotSync } from './useMapViewSnapshotSync';
import { useMapViewStationDisplay } from './useMapViewStationDisplay';
import { useMapViewToolState } from './useMapViewToolState';
import { useMapViewTransformOverlay } from './useMapViewTransformOverlay';
import type { MapViewProps, MapViewSnapshot } from './MapView.types';
import {
  FT_PER_M,
  DENSE_LABEL_EDGE_THRESHOLD,
  MAX_ELLIPSOID_SAMPLES,
  OSM_INTERACTION_TILE_CAP,
  OSM_INTERACTION_ZOOM_DELTA,
  OSM_VISIBLE_TILE_CAP,
  VIEW_H,
  VIEW_W,
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
  const svgRef = useRef<SVGSVGElement | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const obstacleFetchSignatureRef = useRef<string>('');
  const [contextMenu, setContextMenu] = useState<{
    open: boolean;
    x: number;
    y: number;
    planningPolygon: PlanningPolygonTarget | null;
  }>({
    open: false,
    x: 0,
    y: 0,
    planningPolygon: null,
  });
  const [showTransformedCoordinates, setShowTransformedCoordinates] = useState(
    () => snapshot?.showTransformedCoordinates ?? false,
  );
  const [showLabels, setShowLabels] = useState(() => snapshot?.showLabels ?? true);
  const [hideMinorGeometry, setHideMinorGeometry] = useState(
    () => snapshot?.hideMinorGeometry ?? false,
  );
  const [focusSelection, setFocusSelection] = useState(() => snapshot?.focusSelection ?? false);
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
  const [selectionBox, setSelectionBox] = useState<ScreenSelectionBox | null>(null);
  const [viewportWidth, setViewportWidth] = useState<number>(
    typeof window !== 'undefined' ? window.innerWidth : 1280,
  );
  useEffect(() => {
    noteUiPerfStage('mapReady');
    noteUiTabReady('map');
  }, [result]);

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

  const closeContextMenu = useCallback(() => {
    setContextMenu((prev) => ({ ...prev, open: false, planningPolygon: null }));
  }, []);

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

  useMapViewViewportWidth({ setViewportWidth, viewportWidthOverride });

  const effectiveViewportWidth = viewportWidthOverride ?? viewportWidth;

  const fallbackReason = useMemo(() => {
    if (mode !== '3d') return null;
    if (scene3d.stations.length > 500 || scene3d.edges.length > 1000) {
      return `network too large (${scene3d.stations.length} stations, ${scene3d.edges.length} edges)`;
    }
    if (
      effectiveViewportWidth < 768 &&
      (scene3d.stations.length > 140 || scene3d.edges.length > 260)
    ) {
      return `mobile viewport (${effectiveViewportWidth}px) with dense geometry`;
    }
    return null;
  }, [mode, scene3d.edges.length, scene3d.stations.length, effectiveViewportWidth]);
  const effectiveMode: '2d' | '3d' = mode === '3d' && !fallbackReason ? '3d' : '2d';
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
  useMapViewContextMenuDismiss({
    contextMenuOpen: contextMenu.open,
    contextMenuRef,
    setContextMenu,
  });
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

  useEffect(() => {
    if (!transformedOverlayConfig.available || effectiveMode !== '2d') {
      setShowTransformedCoordinates(false);
    }
  }, [effectiveMode, transformedOverlayConfig.available]);

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

  const map2dRenderState = useMapView2dRenderState({
    bbox,
    basemapDescriptorView2d,
    derivedResult,
    derivedView2d,
    dragRef,
    draftBlockedPolygon,
    effectiveMode,
    ellipseStroke,
    focusSelection,
    hideMinorGeometry,
    idlePrefetchReady,
    interactionPhase,
    layerRenderer,
    obstacleFetchSignatureRef,
    observations,
    onPlanningMapChange,
    planningMap,
    points,
    project2d,
    projection2d,
    renderer2d,
    result,
    scheduleLayerRender: layerRenderer.scheduleLayerRender,
    selectedObservationId,
    selectedPlanningPolygonIds,
    selectedStationId,
    setBasemapDescriptorView2d,
    showLabels,
    showLostStations,
    stationFill,
    stationSeverity,
    stations,
    tileStoreRef,
    transformedOverlayActive,
    units,
    view2d,
  });
  const {
    filteredVisibleMapLines2d,
    filteredVisiblePoints2d,
    findPlanningPolygonAtSvgPoint,
    labelFont2d,
    labelOffset2d,
    labelStroke2d,
    lineWidth2d,
    mapDensitySummary,
    mapHitIndex2d,
    mapLinkByPairKey,
    marker2d,
    originalGeometryOpacity,
    planningPolygons2d,
    pointRadius2d,
    selectedObservationPairKey,
    svgBracePreviewPoints2d,
    svgPlanningInputPoints2d,
    svgPlanningPolygons2d,
    svgScenarioPreviewSegments2d,
    svgVisiblePointLabels2d,
  } = map2dRenderState;

  const {
    handleDeletePlanningPolygon,
    handleEditPlanningPolygon,
    handlePlanningVertexMouseDown,
    handleRemoveSelectedPlanningPolygons,
    handleSvgClick,
    openContextMenu,
    selectionBoxRect,
  } = useMapViewSelectionInteractions({
    applyPickedToolStation,
    beginDrag,
    clearMapSelection,
    closeContextMenu,
    containerRef,
    contextMenu,
    effectiveMode,
    findPlanningPolygonAtSvgPoint,
    mapHitIndex2d,
    onSelectObservation,
    onSelectStation,
    planningMap,
    planningPolygons2d,
    planningVertexDragRef,
    removePlanningPolygon,
    removeSelectedPlanningPolygons,
    selectedObservationId,
    selectedPlanningPolygonIds,
    selectedStationId,
    selectionBox,
    setContextMenu,
    setDraftBlockedPolygon,
    setSelectedPlanningPolygonIds,
    setSelectionBox,
    svgToMapCoords,
    toSvgCoords,
    toolPickTarget,
    view2d,
  });

  const { applyCubeView, project3d, projected3d, projected3dById, visiblePointLabels3d } =
    useMapView3dProjection({
      camera3d,
      effectiveMode,
      scene3d,
      selectedStationId,
      setCamera3d,
    });

  const svg2dProps = buildSvg2dProps({
    bracePreviewPoints2d: svgBracePreviewPoints2d,
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
    planningInputPoints2d: svgPlanningInputPoints2d,
    planningPolygons2d: svgPlanningPolygons2d,
    pointRadius2d,
    project2d,
    renderer2d,
    scenarioPreviewSegments2d: svgScenarioPreviewSegments2d,
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
    visiblePointLabels2d: svgVisiblePointLabels2d,
  });

  const scene3dProps = buildScene3dProps({
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
  });

  const contextMenuProps = buildContextMenuProps({
    contextMenu,
    handleDeletePlanningPolygon,
    handleEditPlanningPolygon,
    handleRemoveSelectedPlanningPolygons,
    openTool,
    selectedPlanningPolygonIds,
  });

  const toolOverlayProps = buildToolOverlayProps({
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
  });

  return (
    <MapViewContent
      activeTool={activeTool}
      basemapCanvasRef={basemapCanvasRef}
      canShowInputPointHint={points.length === 0}
      containerRef={containerRef}
      contextMenuOpen={contextMenu.open}
      contextMenuRef={contextMenuRef}
      contextMenuProps={contextMenuProps}
      derivedView2d={derivedView2d}
      effectiveMode={effectiveMode}
      fallbackReason={fallbackReason}
      filteredVisiblePointCount={filteredVisiblePoints2d.length}
      focusSelection={focusSelection}
      geometryCanvasRef={geometryCanvasRef}
      handleMouseDown={handleMouseDown}
      handleMouseUp={handleMouseUp}
      handleSvgClick={handleSvgClick}
      handleWheel={handleWheel}
      hideMinorGeometry={hideMinorGeometry}
      inputPointsLoaded={inputPointsLoaded}
      interactionPhase={interactionPhase}
      isDragging={isDragging}
      isPreanalysis={isPreanalysis}
      mapDensitySummary={mapDensitySummary}
      mode={mode}
      onLoadInputPoints={onLoadInputPoints}
      onPlanningMapChange={onPlanningMapChange}
      openContextMenu={openContextMenu}
      planningCanvasRef={planningCanvasRef}
      planningMap={planningMap}
      renderSurfaceLayout={renderSurfaceLayout}
      renderSurfaceRef={renderSurfaceRef}
      renderer2d={renderer2d}
      scene3dProps={scene3dProps}
      selectedPlanningPolygonIds={selectedPlanningPolygonIds}
      setFocusSelection={setFocusSelection}
      setHideMinorGeometry={setHideMinorGeometry}
      setShowLabels={setShowLabels}
      setShowTransformedCoordinates={setShowTransformedCoordinates}
      showLabels={showLabels}
      showTransformToggle={showTransformToggle}
      svg2dProps={svg2dProps}
      svgRef={svgRef}
      toolOverlayProps={toolOverlayProps}
      toolPickTarget={toolPickTarget}
      transformedOverlayActive={transformedOverlayActive}
      transformedOverlayConfig={transformedOverlayConfig}
      unitScale={unitScale}
      units={units}
      view2d={view2d}
      webglCanvasRef={webglCanvasRef}
      webglEligible={webglEligible}
      applyCubeView={applyCubeView}
      clearDraftBlockedPolygon={clearDraftBlockedPolygon}
      commitDraftBlockedPolygon={commitDraftBlockedPolygon}
      draftBlockedPolygonLength={draftBlockedPolygon.length}
      removePlanningPolygon={removePlanningPolygon}
      removeSelectedPlanningPolygons={removeSelectedPlanningPolygons}
    />
  );
};

export default MapView;
