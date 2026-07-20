import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  buildMap3DScene,
  type Vec3,
} from '../../engine/map3d';
import { RAD_TO_DEG } from '../../engine/angles';
import { noteUiPerfStage, noteUiTabReady } from '../../hooks/useUiPerfMonitor';
import {
  buildProjection2d,
  projectPoint2d,
} from './mapView2d';
import { DEFAULT_PLANNING_MAP_STATE } from '../../engine/planningMapState';
import MapViewSvg2d from './MapViewSvg2d';
import MapViewScene3d from './MapViewScene3d';
import MapViewContextMenu from './MapViewContextMenu';
import MapViewToolOverlay, { type MapToolPickTarget } from './MapViewToolOverlay';
import MapViewContent from './MapViewContent';
import { MapViewTileStore } from './mapViewTileStore';
import { MapViewWebgl2d } from './mapViewWebgl2d';
import {
  noteMapViewPerfCounter,
} from './mapViewPerf';
import {
  buildMapScenePointBounds2d,
  buildProjectedMapState3d,
} from './mapViewSelectors';
import { projectPoint3d } from './mapView3d';
import {
  canRenderWebglLayers,
  DEFAULT_RENDER_SURFACE_LAYOUT,
  type PlanningPolygonTarget,
  type RenderSurfaceLayout,
  type ScreenSelectionBox,
} from './mapViewInteraction';
import { useMapView2dRenderState } from './useMapView2dRenderState';
import { useMapViewDragInteractions } from './useMapViewDragInteractions';
import { useMapViewLayerRenderer } from './useMapViewLayerRenderer';
import { useMapViewPlanningActions } from './useMapViewPlanningActions';
import { useMapViewSelectionInteractions } from './useMapViewSelectionInteractions';
import { useMapViewViewportState } from './useMapViewViewportState';
import {
  useMapViewContextMenuDismiss,
  useMapViewRenderSurfaceLayout,
  useMapViewViewportWidth,
} from './useMapViewShellEffects';
import { useMapViewSnapshotSync } from './useMapViewSnapshotSync';
import { useMapViewStationDisplay } from './useMapViewStationDisplay';
import { useMapViewToolState } from './useMapViewToolState';
import { useMapViewTransformOverlay } from './useMapViewTransformOverlay';
import type { MapViewProps, MapViewSnapshot } from './MapView.types';
import {
  DENSE_LABEL_EDGE_THRESHOLD,
  DENSE_LABEL_POINT_THRESHOLD,
  FT_PER_M,
  LABEL_GRID_PX,
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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const webglCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const basemapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const geometryCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const planningCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderSurfaceRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const tileStoreRef = useRef<MapViewTileStore>(new MapViewTileStore());
  const webglRendererRef = useRef<MapViewWebgl2d>(new MapViewWebgl2d());
  const [renderSurfaceLayout, setRenderSurfaceLayout] = useState<RenderSurfaceLayout>(
    DEFAULT_RENDER_SURFACE_LAYOUT,
  );
  const [renderer2d, setRenderer2d] = useState<'canvas' | 'webgl'>(() =>
    canRenderWebglLayers() ? 'webgl' : 'canvas',
  );
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
  useMapViewRenderSurfaceLayout({ containerRef, setRenderSurfaceLayout });
  useMapViewContextMenuDismiss({
    contextMenuOpen: contextMenu.open,
    contextMenuRef,
    setContextMenu,
  });

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
  const webglEligible = effectiveMode === '2d' && canRenderWebglLayers();
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

  useLayoutEffect(() => {
    const webglRenderer = webglRendererRef.current;
    if (!webglEligible) {
      setRenderer2d('canvas');
      webglRenderer.dispose();
      return;
    }
    const canvas = webglCanvasRef.current;
    if (!canvas) {
      setRenderer2d('canvas');
      webglRenderer.dispose();
      return;
    }
    const initialized = webglRenderer.init(canvas);
    setRenderer2d(initialized ? 'webgl' : 'canvas');
    if (!initialized) {
      webglRenderer.dispose();
    }
    return () => {
      webglRenderer.dispose();
    };
  }, [webglEligible]);

  const fallbackFromWebgl = useCallback(() => {
    webglRendererRef.current.dispose();
    setRenderer2d('canvas');
  }, []);

  const layerRenderer = useMapViewLayerRenderer({
    basemapCanvasRef,
    effectiveMode,
    geometryCanvasRef,
    onWebglFallback: fallbackFromWebgl,
    planningCanvasRef,
    renderer2d,
    tileStoreRef,
    units,
    viewHeight: VIEW_H,
    viewWidth: VIEW_W,
    webglRendererRef,
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

  const projection2d = useMemo(() => buildProjection2d(bbox, VIEW_W, VIEW_H), [bbox]);

  const project2d = useCallback(
    (x: number, y: number) => projectPoint2d(x, y, bbox, projection2d, VIEW_H),
    [bbox, projection2d],
  );

  const toSvgCoords = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const x = ((clientX - rect.left) / rect.width) * VIEW_W;
    const y = ((clientY - rect.top) / rect.height) * VIEW_H;
    return { x, y };
  }, []);

  const svgToMapCoords = useCallback(
    (screenX: number, screenY: number): { x: number; y: number } => {
      const projectedX = (screenX - view2d.panX) / Math.max(view2d.zoom, 1e-9);
      const projectedY = (screenY - view2d.panY) / Math.max(view2d.zoom, 1e-9);
      const x = bbox.minX + (projectedX - projection2d.offsetX) / Math.max(projection2d.scale, 1e-9);
      const y = bbox.minY + (VIEW_H - projectedY - projection2d.offsetY) / Math.max(projection2d.scale, 1e-9);
      return { x, y };
    },
    [bbox.minX, bbox.minY, projection2d.offsetX, projection2d.offsetY, projection2d.scale, view2d.panX, view2d.panY, view2d.zoom],
  );

  const clearMapSelection = useCallback(() => {
    onSelectStation?.(null);
    onSelectObservation?.(null);
    setSelectedPlanningPolygonIds([]);
    setSelectionBox(null);
    planningVertexDragRef.current = null;
  }, [onSelectObservation, onSelectStation, planningVertexDragRef, setSelectedPlanningPolygonIds]);

  const clearMapSelectionBox = useCallback(() => {
    setSelectionBox(null);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setContextMenu((prev) => ({ ...prev, open: false, planningPolygon: null }));
      if (toolPickTarget != null) {
        clearToolPickTarget();
        return;
      }
      if (selectionBox != null) {
        clearMapSelectionBox();
        return;
      }
      if (
        selectedStationId != null ||
        selectedObservationId != null ||
        selectedPlanningPolygonIds.length > 0
      ) {
        clearMapSelection();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    clearMapSelection,
    clearMapSelectionBox,
    clearToolPickTarget,
    selectedObservationId,
    selectedPlanningPolygonIds.length,
    selectedStationId,
    selectionBox,
    toolPickTarget,
  ]);

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

  const project3d = useCallback(
    (point: Vec3) => projectPoint3d(camera3d, point, VIEW_W, VIEW_H),
    [camera3d],
  );

  const { projected3d, projected3dById, visiblePointLabels3d } = useMemo(
    () =>
      buildProjectedMapState3d({
        effectiveMode,
        camera3d,
        scene3d,
        selectedStationId,
        denseLabelPointThreshold: DENSE_LABEL_POINT_THRESHOLD,
        labelGridPx: LABEL_GRID_PX,
        viewWidth: VIEW_W,
        viewHeight: VIEW_H,
      }),
    [camera3d, effectiveMode, scene3d, selectedStationId],
  );

  const applyCubeView = (preset: 'iso' | 'top' | 'front' | 'right') => {
    setCamera3d((prev) => {
      if (!prev) return prev;
      if (preset === 'top') return { ...prev, yawDeg: 0, pitchDeg: 89 };
      if (preset === 'front') return { ...prev, yawDeg: 0, pitchDeg: 0 };
      if (preset === 'right') return { ...prev, yawDeg: 90, pitchDeg: 0 };
      return { ...prev, yawDeg: -35, pitchDeg: 25 };
    });
  };

  const svg2dProps = {
    marker2d,
    view2d,
    showLabels,
    interactionPhase,
    originalGeometryOpacity,
    filteredVisiblePoints2d,
    visiblePointLabels2d: svgVisiblePointLabels2d,
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
    planningInputPoints2d: svgPlanningInputPoints2d,
    planningPolygons2d: svgPlanningPolygons2d,
    selectedPlanningPolygonIds,
    renderPlanningPolygonBodies: false,
    renderPlanningInputPoints: false,
    bracePreviewPoints2d: svgBracePreviewPoints2d,
    scenarioPreviewSegments2d: svgScenarioPreviewSegments2d,
    renderBracePreviewMarkers: renderer2d !== 'webgl',
    renderScenarioPreviewSegments: renderer2d !== 'webgl',
    selectionBoxRect,
    onPlanningVertexMouseDown: handlePlanningVertexMouseDown,
    project2d,
  };

  const scene3dProps = camera3d
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

  const contextMenuProps = {
    x: contextMenu.x,
    y: contextMenu.y,
    onOpenTool: openTool,
    planningPolygonLabel: contextMenu.planningPolygon?.polygonLabel ?? null,
    selectedPlanningPolygonCount: selectedPlanningPolygonIds.length,
    onEditPlanningPolygon: contextMenu.planningPolygon != null ? handleEditPlanningPolygon : null,
    onDeletePlanningPolygon:
      contextMenu.planningPolygon != null ? handleDeletePlanningPolygon : null,
    onDeleteSelectedPlanningPolygons:
      selectedPlanningPolygonIds.length > 1 ? handleRemoveSelectedPlanningPolygons : null,
  };

  const toolOverlayProps = activeTool !== 'none'
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
