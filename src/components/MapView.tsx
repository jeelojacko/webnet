import React, {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { AdjustedPointsExportSettings, AdjustmentResult, PlanningMapState } from '../types';
import {
  buildMap3DScene,
  createDefaultMap3DCamera,
  type Map3DCamera,
  type Vec3,
} from '../engine/map3d';
import { RAD_TO_DEG } from '../engine/angles';
import type { DerivedQaResult } from '../engine/qaWorkflow';
import {
  buildAdjustedPointsTransformPreview,
  sanitizeAdjustedPointsExportSettings,
} from '../engine/adjustedPointsExport';
import {
  buildMapLinkByPairKey,
  buildObservationMapLinks,
  buildVisibleStationRows,
  buildVisibleStationIds,
  buildWeakStationSeverityLookup,
  resolveMapEllipseStrokeColor,
  resolveMapStationFillColor,
  resolveWeakStationSeverity,
  resolveSelectedObservationPairKey,
} from '../engine/resultDerivedModels';
import { noteUiPerfStage, noteUiTabReady } from '../hooks/useUiPerfMonitor';
import {
  buildProjection2d,
  clamp,
  pointToSegmentDistancePx,
  projectPoint2d,
  type ProjectedMapLine2D,
  type ProjectedPoint2D,
  view2dEquals,
} from './mapView/mapView2d';
import { DEFAULT_PLANNING_MAP_STATE } from '../engine/planningMapState';
import MapViewSvg2d from './mapView/MapViewSvg2d';
import MapViewScene3d from './mapView/MapViewScene3d';
import MapViewContextMenu, { type MapToolPanel } from './mapView/MapViewContextMenu';
import MapViewToolOverlay, { type MapToolPickTarget } from './mapView/MapViewToolOverlay';
import { buildMapViewHitIndex } from './mapView/mapViewHitIndex';
import { MapViewTileStore } from './mapView/mapViewTileStore';
import { MapViewWebgl2d } from './mapView/mapViewWebgl2d';
import { buildMapViewWebglScene2d } from './mapView/mapViewWebglBuffers';
import {
  measureMapViewPerf,
  noteMapViewPerfCounter,
  noteMapViewPerfMetadata,
} from './mapView/mapViewPerf';
import {
  buildMapScenePointBounds2d,
  buildMapViewStyle2d,
  buildProjectedMapState3d,
  buildTransformedOverlayGeometry2d,
} from './mapView/mapViewSelectors';
import { projectPoint3d } from './mapView/mapView3d';
import {
  buildRenderSurfaceLayout,
  canRenderWebglLayers,
  DEFAULT_RENDER_SURFACE_LAYOUT,
  doesPolygonTouchRect,
  isPolygonInsideRect,
  OSM_FETCH_BUFFER_M,
  renderSurfaceLayoutEquals,
  type MapInteractionKind,
  type MapInteractionPhase,
  type PlanningPolygonTarget,
  type RenderSurfaceLayout,
  type ScreenSelectionBox,
  type SelectionBoxMode,
} from './mapView/mapViewInteraction';
import { useMapViewLayerRenderer } from './mapView/useMapViewLayerRenderer';
import { useMapViewBasemapTiles2d } from './mapView/useMapViewBasemapTiles2d';
import {
  buildObstacleFetchSignature,
  buildOverpassObstacleQuery,
  parseOverpassObstaclePolygons,
} from './mapView/mapViewObstacles';
import { useMapViewDerived2d } from './mapView/useMapViewDerived2d';
import { useFrozenMapViewOverlays } from './mapView/useFrozenMapViewOverlays';
import { useMapViewPlanning2d } from './mapView/useMapViewPlanning2d';
import { useMapViewPlanningActions } from './mapView/useMapViewPlanningActions';
import { useMapViewSnapshotSync } from './mapView/useMapViewSnapshotSync';
import { useMapViewToolState } from './mapView/useMapViewToolState';

const FT_PER_M = 3.280839895;
const VIEW_W = 1000;
const VIEW_H = 700;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 200;
const MIDDLE_DBLCLICK_MS = 320;
const MAX_ELLIPSOID_SAMPLES = 28;
const VIEWPORT_CLIP_MARGIN_PX = 80;
const DENSE_LABEL_POINT_THRESHOLD = 90;
const DENSE_LABEL_EDGE_THRESHOLD = 180;
const OSM_FULL_LABEL_POINT_THRESHOLD = 160;
const LABEL_GRID_PX = 48;
const INTERACTION_SETTLE_MS = 90;
const OSM_IDLE_PREFETCH_DELAY_MS = 260;
const INTERACTION_DENSE_POINT_THRESHOLD = 180;
const INTERACTION_DENSE_LINE_THRESHOLD = 360;
const POINT_HIT_RADIUS_PX = 10;
const LINE_HIT_RADIUS_PX = 8;
const OSM_VISIBLE_TILE_BUFFER = 1;
const OSM_IDLE_PREFETCH_TILE_BUFFER = 2;
const OSM_IDLE_PREFETCH_TILE_COUNT_THRESHOLD = 30;
const OSM_INTERACTION_TILE_BUFFER = 0;
const OSM_INTERACTION_ZOOM_DELTA = 1;
const OSM_VISIBLE_TILE_CAP = 72;
const OSM_INTERACTION_TILE_CAP = 42;
const EMPTY_MAP_LINKS: ReturnType<typeof buildObservationMapLinks> = [];

export interface MapViewSnapshot {
  view2d: { zoom: number; panX: number; panY: number };
  camera3d: Map3DCamera | null;
  activeTool: MapToolPanel;
  inverseFromInput: string;
  inverseToInput: string;
  anglePivotInput: string;
  angleFromInput: string;
  angleToInput: string;
  showTransformedCoordinates: boolean;
  showLabels: boolean;
  hideMinorGeometry: boolean;
  focusSelection: boolean;
}

interface MapViewProps {
  result: AdjustmentResult;
  units: 'm' | 'ft';
  planningMap?: PlanningMapState;
  onPlanningMapChange?: (_value: PlanningMapState) => void;
  inputPointsLoaded?: boolean;
  onLoadInputPoints?: (() => void) | null;
  showLostStations?: boolean;
  mode?: '2d' | '3d';
  viewportWidthOverride?: number;
  adjustedPointsExportSettings?: AdjustedPointsExportSettings;
  derivedResult?: DerivedQaResult | null;
  selectedStationId?: string | null;
  selectedObservationId?: number | null;
  onSelectStation?: (_stationId: string | null) => void;
  onSelectObservation?: (_observationId: number | null) => void;
  snapshot?: MapViewSnapshot | null;
  onSnapshotChange?: (_snapshot: MapViewSnapshot) => void;
}

type DragMode = 'none' | 'pan2d' | 'orbit3d' | 'pan3d' | 'planning-vertex';

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
  const interactionKindRef = useRef<MapInteractionKind>('none');
  const [basemapDescriptorView2d, setBasemapDescriptorView2d] = useState(
    () => snapshot?.view2d ?? { zoom: 1, panX: 0, panY: 0 },
  );
  const [idlePrefetchReady, setIdlePrefetchReady] = useState(false);
  const obstacleFetchSignatureRef = useRef<string>('');
  const dragRef = useRef<{ active: boolean; mode: DragMode; lastX: number; lastY: number }>({
    active: false,
    mode: 'none',
    lastX: 0,
    lastY: 0,
  });
  const middleClickRef = useRef(0);
  const [view2d, setView2d] = useState(
    () => snapshot?.view2d ?? { zoom: 1, panX: 0, panY: 0 },
  );
  const deferredView2d = useDeferredValue(view2d);
  const [frozenDerivedView2d, setFrozenDerivedView2d] = useState<typeof view2d | null>(null);
  const pendingView2dRef = useRef(view2d);
  const view2dFrameRef = useRef<number | null>(null);
  const dragMoveFrameRef = useRef<number | null>(null);
  const pendingDragClientRef = useRef<{ x: number; y: number } | null>(null);
  const panPreviewOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const panPreviewCommitViewRef = useRef<{ zoom: number; panX: number; panY: number } | null>(null);
  const settleTimerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const settleFrameRef = useRef<number | null>(null);
  const [interactionPhase, setInteractionPhase] = useState<MapInteractionPhase>('idle');
  const interactionPhaseRef = useRef<MapInteractionPhase>('idle');
  const [camera3d, setCamera3d] = useState<Map3DCamera | null>(() => snapshot?.camera3d ?? null);
  const [isDragging, setIsDragging] = useState(false);
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
  const skipNextAutoResetRef = useRef(snapshot != null);
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

  const cleanAdjustedPointsExportSettings = useMemo(
    () =>
      adjustedPointsExportSettings
        ? sanitizeAdjustedPointsExportSettings(adjustedPointsExportSettings)
        : null,
    [adjustedPointsExportSettings],
  );

  const transformedOverlayConfig = useMemo(() => {
    const emptyMap = new Map<string, { east: number; north: number }>();
    if (!cleanAdjustedPointsExportSettings) {
      return {
        enabled: false,
        available: false,
        reason: '',
        referenceStationId: '',
        scope: 'all' as const,
        transformedByStationId: emptyMap,
        scaleEnabled: false,
        scaleFactor: 1,
        rotationEnabled: false,
        rotationAngleDeg: 0,
        translationEnabled: false,
        translationMethod: 'direction-distance' as const,
        translationAzimuthDeg: 0,
        translationDistanceM: 0,
      };
    }
    const preview = buildAdjustedPointsTransformPreview({
      result,
      settings: cleanAdjustedPointsExportSettings,
      units,
      includeLostStations: cleanAdjustedPointsExportSettings.includeLostStations,
    });
    return {
      enabled: preview.enabled,
      available: preview.available,
      reason: preview.reason,
      referenceStationId: preview.referenceStationId,
      scope: preview.scope,
      transformedByStationId: preview.transformedByStationId,
      scaleEnabled: preview.scaleEnabled,
      scaleFactor: preview.scaleFactor,
      rotationEnabled: preview.rotationEnabled,
      rotationAngleDeg: preview.rotationAngleDeg,
      translationEnabled: preview.translationEnabled,
      translationMethod: preview.translationMethod,
      translationAzimuthDeg: preview.translationAzimuthDeg,
      translationDistanceM: preview.translationDistanceM,
    };
  }, [cleanAdjustedPointsExportSettings, result, units]);

  const visibleStationIds = useMemo(
    () => buildVisibleStationIds(stations, showLostStations),
    [showLostStations, stations],
  );

  const weakStationSeverity = useMemo(
    () => buildWeakStationSeverityLookup(result.weakGeometryDiagnostics),
    [result.weakGeometryDiagnostics],
  );

  const stationSeverity = useCallback(
    (stationId: string): 'watch' | 'weak' | null =>
      resolveWeakStationSeverity(weakStationSeverity, stationId),
    [weakStationSeverity],
  );

  const visibleStationRows = useMemo(
    () => buildVisibleStationRows(stations, showLostStations, weakStationSeverity),
    [showLostStations, stations, weakStationSeverity],
  );

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

  const stationFill = useCallback(
    (stationId: string, fixed: boolean): string =>
      resolveMapStationFillColor({ fixed, severity: stationSeverity(stationId) }),
    [stationSeverity],
  );

  const ellipseStroke = useCallback(
    (stationId: string): string => resolveMapEllipseStrokeColor(stationSeverity(stationId)),
    [stationSeverity],
  );

  useEffect(() => {
    if (typeof window === 'undefined' || viewportWidthOverride != null) return;
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [viewportWidthOverride]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = () => {
      const rect = container.getBoundingClientRect();
      const nextLayout = buildRenderSurfaceLayout(rect.width, rect.height);
      setRenderSurfaceLayout((current) =>
        renderSurfaceLayoutEquals(current, nextLayout) ? current : nextLayout,
      );
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => {
        measure();
      });
      observer.observe(container);
      return () => observer.disconnect();
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    return undefined;
  }, []);

  useEffect(() => {
    if (!contextMenu.open) return;
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && contextMenuRef.current?.contains(target)) return;
      setContextMenu((prev) => ({ ...prev, open: false, planningPolygon: null }));
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setContextMenu((prev) => ({ ...prev, open: false, planningPolygon: null }));
      }
    };
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [contextMenu.open]);

  const effectiveViewportWidth = viewportWidthOverride ?? viewportWidth;
  const derivedView2d = frozenDerivedView2d ?? deferredView2d;

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
  const webglEligible = effectiveMode === '2d' && canRenderWebglLayers();
  const showTransformToggle = transformedOverlayConfig.enabled;
  const transformedOverlayActive =
    showTransformedCoordinates && transformedOverlayConfig.available && effectiveMode === '2d';

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

  const {
    latestBasemapRenderInputRef,
    latestGeometryRenderInputRef,
    latestPlanningRenderInputRef,
    latestWebglRenderInputRef,
    renderLayersNow,
    scheduleLayerRender,
  } = useMapViewLayerRenderer({
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

  const applyPanPreviewOffset = useCallback((offsetX: number, offsetY: number) => {
    const translate = offsetX === 0 && offsetY === 0 ? '' : `translate(${offsetX}px, ${offsetY}px)`;
    const applyTo = (node: HTMLElement | SVGElement | null) => {
      if (!node) return;
      node.style.transformOrigin = '0 0';
      node.style.transform = translate;
      node.style.willChange = translate ? 'transform' : '';
    };
    applyTo(renderSurfaceRef.current);
    const container = containerRef.current;
    if (container) {
      container.dataset.mapPreviewPanX = offsetX.toFixed(6);
      container.dataset.mapPreviewPanY = offsetY.toFixed(6);
    }
  }, []);

  const clearInteractionSettle = useCallback(() => {
    if (settleTimerRef.current != null) {
      globalThis.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
    if (settleFrameRef.current != null) {
      cancelAnimationFrame(settleFrameRef.current);
      settleFrameRef.current = null;
    }
  }, []);

  const scheduleView2dCommit = useCallback(() => {
    if (view2dFrameRef.current != null) return;
    view2dFrameRef.current = requestAnimationFrame(() => {
      view2dFrameRef.current = null;
      const next = pendingView2dRef.current;
      setView2d((prev) => (view2dEquals(prev, next) ? prev : next));
    });
  }, []);

  const queueView2dUpdate = useCallback(
    (
      updater: (_current: { zoom: number; panX: number; panY: number }) => {
        zoom: number;
        panX: number;
        panY: number;
      },
    ) => {
      noteMapViewPerfCounter('map:view-update-requests');
      const next = updater(pendingView2dRef.current);
      pendingView2dRef.current = next;
      scheduleView2dCommit();
    },
    [scheduleView2dCommit],
  );

  const markInteracting = useCallback((kind: MapInteractionKind) => {
    if (effectiveMode !== '2d') return;
    clearInteractionSettle();
    interactionKindRef.current = kind;
    if (interactionPhaseRef.current !== 'interacting') {
      interactionPhaseRef.current = 'interacting';
      setInteractionPhase('interacting');
    }
    settleTimerRef.current = globalThis.setTimeout(() => {
      settleTimerRef.current = null;
      interactionPhaseRef.current = 'settling';
      setInteractionPhase('settling');
      settleFrameRef.current = requestAnimationFrame(() => {
        settleFrameRef.current = null;
        interactionKindRef.current = 'none';
        interactionPhaseRef.current = 'idle';
        setInteractionPhase('idle');
      });
    }, INTERACTION_SETTLE_MS);
  }, [clearInteractionSettle, effectiveMode]);

  useEffect(() => {
    pendingView2dRef.current = view2d;
  }, [view2d]);

  useEffect(() => {
    interactionPhaseRef.current = interactionPhase;
  }, [interactionPhase]);

  useEffect(() => {
    if (effectiveMode !== '2d' || planningMap.basemapMode !== 'osm') {
      setIdlePrefetchReady(false);
      return;
    }
    if (interactionPhase !== 'idle') {
      setIdlePrefetchReady(false);
      return;
    }
    const timeout = window.setTimeout(() => {
      setIdlePrefetchReady(true);
    }, OSM_IDLE_PREFETCH_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [effectiveMode, interactionPhase, planningMap.basemapMode]);

  useEffect(
    () => () => {
      if (view2dFrameRef.current != null) {
        cancelAnimationFrame(view2dFrameRef.current);
      }
      if (dragMoveFrameRef.current != null) {
        cancelAnimationFrame(dragMoveFrameRef.current);
      }
      clearInteractionSettle();
    },
    [clearInteractionSettle],
  );

  useEffect(() => {
    if (!transformedOverlayConfig.available || effectiveMode !== '2d') {
      setShowTransformedCoordinates(false);
    }
  }, [effectiveMode, transformedOverlayConfig.available]);

  const reset2dView = useCallback(() => {
    const reset = { zoom: 1, panX: 0, panY: 0 };
    applyPanPreviewOffset(0, 0);
    panPreviewOffsetRef.current = { x: 0, y: 0 };
    panPreviewCommitViewRef.current = null;
    pendingView2dRef.current = reset;
    setView2d(reset);
    setBasemapDescriptorView2d(reset);
    setFrozenDerivedView2d(null);
    clearInteractionSettle();
    interactionKindRef.current = 'none';
    interactionPhaseRef.current = 'idle';
    setInteractionPhase('idle');
  }, [applyPanPreviewOffset, clearInteractionSettle]);

  const reset3dView = useCallback(() => {
    setCamera3d(createDefaultMap3DCamera(scene3d));
  }, [scene3d]);

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

  useEffect(() => {
    if (effectiveMode === '3d') {
      clearInteractionSettle();
      interactionKindRef.current = 'none';
      interactionPhaseRef.current = 'idle';
      setInteractionPhase('idle');
      if (skipNextAutoResetRef.current) {
        skipNextAutoResetRef.current = false;
        return;
      }
      reset3dView();
      return;
    }
    if (skipNextAutoResetRef.current) {
      skipNextAutoResetRef.current = false;
      return;
    }
    reset2dView();
  }, [
    bbox.height,
    bbox,
    bbox.width,
    clearInteractionSettle,
    effectiveMode,
    reset2dView,
    reset3dView,
  ]);

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

  const stopDrag = useCallback(() => {
    if (!dragRef.current.active) return;
    if (dragRef.current.mode === 'pan2d') {
      const previewOffset = panPreviewOffsetRef.current;
      const commitView = panPreviewCommitViewRef.current;
      applyPanPreviewOffset(0, 0);
      if (commitView && (previewOffset.x !== 0 || previewOffset.y !== 0)) {
        const nextView = {
          ...commitView,
          panX: commitView.panX + previewOffset.x,
          panY: commitView.panY + previewOffset.y,
        };
        pendingView2dRef.current = nextView;
        setView2d(nextView);
      }
      panPreviewOffsetRef.current = { x: 0, y: 0 };
      panPreviewCommitViewRef.current = null;
      setFrozenDerivedView2d(null);
    }
    dragRef.current.active = false;
    dragRef.current.mode = 'none';
    pendingDragClientRef.current = null;
    if (dragMoveFrameRef.current != null) {
      cancelAnimationFrame(dragMoveFrameRef.current);
      dragMoveFrameRef.current = null;
    }
    planningVertexDragRef.current = null;
    setIsDragging(false);
    noteMapViewPerfCounter('map:stop-drag');
  }, [applyPanPreviewOffset, planningVertexDragRef]);

  const handleDragMoveClient = useCallback(
    (clientX: number, clientY: number) => {
      if (!dragRef.current.active) return;
      noteMapViewPerfCounter(`map:drag-move:${dragRef.current.mode}`);
      if (dragRef.current.mode === 'pan2d') {
        const dx = clientX - dragRef.current.lastX;
        const dy = clientY - dragRef.current.lastY;
        dragRef.current.lastX = clientX;
        dragRef.current.lastY = clientY;
        markInteracting('pan');
        const nextPreviewOffset = {
          x: panPreviewOffsetRef.current.x + dx,
          y: panPreviewOffsetRef.current.y + dy,
        };
        panPreviewOffsetRef.current = nextPreviewOffset;
        applyPanPreviewOffset(nextPreviewOffset.x, nextPreviewOffset.y);
        return;
      }
      const next = toSvgCoords(clientX, clientY);
      if (!next) return;
      const dx = next.x - dragRef.current.lastX;
      const dy = next.y - dragRef.current.lastY;
      dragRef.current.lastX = next.x;
      dragRef.current.lastY = next.y;
      if (dragRef.current.mode === 'planning-vertex') {
        const activeVertex = planningVertexDragRef.current;
        if (!activeVertex) return;
        const nextMap = svgToMapCoords(next.x, next.y);
        const sourcePolygons =
          activeVertex.polygonSource === 'user'
            ? planningMap.blockedPolygons
            : planningMap.obstaclePolygons;
        const polygon = sourcePolygons.find((entry) => entry.id === activeVertex.polygonId);
        if (!polygon) return;
        const nextVertices = polygon.vertices.map((vertex, index) =>
          index === activeVertex.vertexIndex ? nextMap : vertex,
        );
        updatePlanningPolygonVertices(
          activeVertex.polygonId,
          activeVertex.polygonSource,
          nextVertices,
        );
        return;
      }
      if (effectiveMode !== '3d') return;
      if (dragRef.current.mode === 'orbit3d') {
        setCamera3d((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            yawDeg: prev.yawDeg + dx * 0.22,
            pitchDeg: clamp(prev.pitchDeg - dy * 0.22, -89, 89),
          };
        });
        return;
      }
      if (dragRef.current.mode === 'pan3d') {
        const panScale = Math.max(0.2, (camera3d?.distance ?? 10) * 0.0025);
        setCamera3d((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            panX: prev.panX - dx * panScale,
            panY: prev.panY + dy * panScale,
          };
        });
      }
    },
    [
      toSvgCoords,
      svgToMapCoords,
      effectiveMode,
      applyPanPreviewOffset,
      camera3d?.distance,
      markInteracting,
      planningMap.blockedPolygons,
      planningMap.obstaclePolygons,
      planningVertexDragRef,
      updatePlanningPolygonVertices,
    ],
  );

  const scheduleDragMoveClient = useCallback(
    (clientX: number, clientY: number) => {
      pendingDragClientRef.current = { x: clientX, y: clientY };
      if (dragMoveFrameRef.current != null) return;
      dragMoveFrameRef.current = requestAnimationFrame(() => {
        dragMoveFrameRef.current = null;
        const next = pendingDragClientRef.current;
        pendingDragClientRef.current = null;
        if (!next) return;
        noteMapViewPerfCounter('map:drag-move-frame-commits');
        handleDragMoveClient(next.x, next.y);
      });
    },
    [handleDragMoveClient],
  );

  useEffect(() => {
    if (!isDragging && selectionBox == null) return;
    const onMouseMove = (event: MouseEvent) => {
      if (dragRef.current.active) {
        scheduleDragMoveClient(event.clientX, event.clientY);
        return;
      }
      if (selectionBox == null) return;
      const pointer = toSvgCoords(event.clientX, event.clientY);
      if (!pointer) return;
      setSelectionBox((current) =>
        current == null
          ? current
          : {
              ...current,
              currentX: pointer.x,
              currentY: pointer.y,
            },
      );
    };
    const onMouseUp = () => {
      stopDrag();
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [isDragging, scheduleDragMoveClient, selectionBox, stopDrag, toSvgCoords]);

  const handleWheel = (event: React.WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    noteMapViewPerfCounter('map:wheel-events');
    if (effectiveMode === '3d') {
      setCamera3d((prev) => {
        if (!prev) return prev;
        const factor = Math.exp(event.deltaY * 0.0015);
        return {
          ...prev,
          distance: clamp(
            prev.distance * factor,
            0.6,
            Math.max(50000, scene3d.extents.radius * 80),
          ),
        };
      });
      return;
    }
    const anchor = toSvgCoords(event.clientX, event.clientY);
    if (!anchor) return;
    markInteracting('wheel');
    queueView2dUpdate((prev) => {
      const factor = Math.exp(-event.deltaY * 0.0015);
      const nextZoom = clamp(prev.zoom * factor, MIN_ZOOM, MAX_ZOOM);
      if (nextZoom === prev.zoom) return prev;
      const ratio = nextZoom / prev.zoom;
      const panX = anchor.x - (anchor.x - prev.panX) * ratio;
      const panY = anchor.y - (anchor.y - prev.panY) * ratio;
      return { zoom: nextZoom, panX, panY };
    });
  };

  const beginDrag = useCallback(
    (modeName: DragMode, clientX: number, clientY: number) => {
      noteMapViewPerfCounter(`map:begin-drag:${modeName}`);
      if (modeName === 'pan2d') {
        panPreviewOffsetRef.current = { x: 0, y: 0 };
        panPreviewCommitViewRef.current = pendingView2dRef.current;
        applyPanPreviewOffset(0, 0);
        setFrozenDerivedView2d(pendingView2dRef.current);
        dragRef.current = { active: true, mode: modeName, lastX: clientX, lastY: clientY };
        setIsDragging(true);
        return;
      }
      const start = toSvgCoords(clientX, clientY);
      if (!start) return;
      dragRef.current = { active: true, mode: modeName, lastX: start.x, lastY: start.y };
      setIsDragging(true);
    },
    [applyPanPreviewOffset, toSvgCoords],
  );

  const handleMouseDown = (event: React.MouseEvent<SVGSVGElement>) => {
    if (effectiveMode === '3d') {
      if (event.button === 0) {
        event.preventDefault();
        beginDrag('orbit3d', event.clientX, event.clientY);
        return;
      }
      if (event.button === 1) {
        event.preventDefault();
        const now = performance.now();
        const sinceLastMiddle = now - middleClickRef.current;
        middleClickRef.current = now;
        if (sinceLastMiddle > 0 && sinceLastMiddle <= MIDDLE_DBLCLICK_MS) {
          stopDrag();
          reset3dView();
          return;
        }
        beginDrag('pan3d', event.clientX, event.clientY);
      }
      return;
    }
    if (event.button !== 1) return;
    event.preventDefault();
    const now = performance.now();
    const sinceLastMiddle = now - middleClickRef.current;
    middleClickRef.current = now;
    if (sinceLastMiddle > 0 && sinceLastMiddle <= MIDDLE_DBLCLICK_MS) {
      stopDrag();
      reset2dView();
      return;
    }
    beginDrag('pan2d', event.clientX, event.clientY);
  };

  const handleMouseUp = (event: React.MouseEvent<SVGSVGElement>) => {
    if (event.button === 0 || event.button === 1) stopDrag();
  };

  const {
    pointRadius2d,
    lineWidth2d,
    ellipseStroke2d,
    labelFont2d,
    labelStroke2d,
    labelOffset2d,
    marker2d,
    originalGeometryOpacity,
  } = useMemo(
    () => buildMapViewStyle2d({ zoom: view2d.zoom }, transformedOverlayActive),
    [transformedOverlayActive, view2d.zoom],
  );

  const { transformedLines2d, transformedPoints2d } = useMemo(
    () =>
      buildTransformedOverlayGeometry2d({
        transformedOverlayActive,
        observations,
        stations,
        showLostStations,
        transformedByStationId: transformedOverlayConfig.transformedByStationId,
        points,
      }),
    [
      observations,
      points,
      showLostStations,
      stations,
      transformedOverlayActive,
      transformedOverlayConfig.transformedByStationId,
    ],
  );

  const {
    bracePreviewPoints2d,
    findPlanningPolygonAtSvgPoint,
    planningFetchExtent,
    planningGeorefContext,
    planningInputPoints2d,
    planningPolygons2d,
    scenarioPreviewSegments2d,
  } = useMapViewPlanning2d({
    bbox,
    draftBlockedPolygon,
    fetchBufferM: OSM_FETCH_BUFFER_M,
    planningMap,
    projectPoint: project2d,
    result,
    stations,
    view2d,
  });

  const selectionBoxRect = useMemo(() => {
    if (selectionBox == null) return null;
    const x = Math.min(selectionBox.anchorX, selectionBox.currentX);
    const y = Math.min(selectionBox.anchorY, selectionBox.currentY);
    const width = Math.abs(selectionBox.currentX - selectionBox.anchorX);
    const height = Math.abs(selectionBox.currentY - selectionBox.anchorY);
    const mode: SelectionBoxMode =
      selectionBox.currentX >= selectionBox.anchorX ? 'window' : 'crossing';
    return { x, y, width, height, mode };
  }, [selectionBox]);

  const applySelectionBoxToPlanningPolygons = useCallback(
    (rect: { x: number; y: number; width: number; height: number; mode: SelectionBoxMode }) => {
      const bounds = {
        left: rect.x,
        right: rect.x + rect.width,
        top: rect.y,
        bottom: rect.y + rect.height,
      };
      const hits = planningPolygons2d
        .filter((polygon) => polygon.id !== 'draft-blocked-polygon')
        .filter((polygon) => {
          const screenVertices = polygon.vertices.map((vertex) => ({
            x: vertex.x * view2d.zoom + view2d.panX,
            y: vertex.y * view2d.zoom + view2d.panY,
          }));
          return rect.mode === 'window'
            ? isPolygonInsideRect(screenVertices, bounds)
            : doesPolygonTouchRect(screenVertices, bounds);
        })
        .map((polygon) => polygon.id);
      setSelectedPlanningPolygonIds(hits);
      onSelectStation?.(null);
      onSelectObservation?.(null);
      setSelectionBox(null);
    },
    [
      onSelectObservation,
      onSelectStation,
      planningPolygons2d,
      setSelectedPlanningPolygonIds,
      view2d.panX,
      view2d.panY,
      view2d.zoom,
    ],
  );

  useMapViewBasemapTiles2d({
    basemapDescriptorView2d,
    bbox,
    dragRef,
    effectiveMode,
    idlePrefetchReady,
    idlePrefetchTileBuffer: OSM_IDLE_PREFETCH_TILE_BUFFER,
    idlePrefetchTileCountThreshold: OSM_IDLE_PREFETCH_TILE_COUNT_THRESHOLD,
    interactionPhase,
    interactionTileBuffer: OSM_INTERACTION_TILE_BUFFER,
    latestBasemapRenderInputRef,
    latestWebglRenderInputRef,
    planningBasemapMode: planningMap.basemapMode,
    planningGeorefContext,
    projectPoint: project2d,
    projection2d,
    renderLayersNow,
    renderer2d,
    scheduleLayerRender,
    setBasemapDescriptorView2d,
    tileStoreRef,
    view2d,
    viewHeight: VIEW_H,
    viewWidth: VIEW_W,
    visibleTileBuffer: OSM_VISIBLE_TILE_BUFFER,
  });

  useEffect(() => {
    if (
      effectiveMode !== '2d' ||
      !planningGeorefContext ||
      !planningFetchExtent ||
      !planningMap.showObstacleLayer ||
      !onPlanningMapChange
    ) {
      return;
    }
    const fetchSignature = buildObstacleFetchSignature(
      planningGeorefContext,
      planningFetchExtent,
    );
    if (obstacleFetchSignatureRef.current === fetchSignature) return;
    obstacleFetchSignatureRef.current = fetchSignature;
    const query = buildOverpassObstacleQuery(planningGeorefContext, planningFetchExtent);
    if (query == null) return;
    const controller = new AbortController();
    void fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: query,
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((json) => {
        if (!json || !Array.isArray(json.elements)) return;
        const polygons = parseOverpassObstaclePolygons(json.elements, planningGeorefContext);
        if (polygons.length === 0) return;
        onPlanningMapChange({
          ...planningMap,
          obstaclePolygons: polygons,
        });
      })
      .catch(() => {
        if (obstacleFetchSignatureRef.current === fetchSignature) {
          obstacleFetchSignatureRef.current = '';
        }
      });
    return () => controller.abort();
  }, [
    effectiveMode,
    onPlanningMapChange,
    planningFetchExtent,
    planningGeorefContext,
    planningMap,
  ]);

  const fallbackMapLinks = useMemo(
    () => (derivedResult ? EMPTY_MAP_LINKS : buildObservationMapLinks(observations)),
    [derivedResult, observations],
  );
  const mapLinks = derivedResult?.mapLinks ?? fallbackMapLinks;
  const mapLinkByPairKey = useMemo(() => buildMapLinkByPairKey(mapLinks), [mapLinks]);
  const selectedObservationPairKey = useMemo(
    () => resolveSelectedObservationPairKey(derivedResult?.observationById, selectedObservationId),
    [derivedResult?.observationById, selectedObservationId],
  );

  const {
    effectiveVisiblePointLabels2d,
    filteredVisibleMapLines2d,
    filteredVisiblePoints2d,
    interactionDenseMode,
    mapDensitySummary,
    unselectedCanvasLines2d,
  } = useMapViewDerived2d({
    denseLabelEdgeThreshold: DENSE_LABEL_EDGE_THRESHOLD,
    denseLabelPointThreshold: DENSE_LABEL_POINT_THRESHOLD,
    derivedView2d,
    effectiveMode,
    focusSelection,
    hideMinorGeometry,
    interactionDenseLineThreshold: INTERACTION_DENSE_LINE_THRESHOLD,
    interactionDensePointThreshold: INTERACTION_DENSE_POINT_THRESHOLD,
    interactionPhase,
    labelGridPx: LABEL_GRID_PX,
    mapLinks,
    osmFullLabelPointThreshold: OSM_FULL_LABEL_POINT_THRESHOLD,
    planningBasemapMode: planningMap.basemapMode,
    pointHitRadiusPx: POINT_HIT_RADIUS_PX,
    points,
    projectPoint: project2d,
    selectedObservationId,
    selectedObservationPairKey,
    selectedStationId,
    showLabels,
    showLostStations,
    stationSeverity,
    stations,
    viewportClipMarginPx: VIEWPORT_CLIP_MARGIN_PX,
    viewHeight: VIEW_H,
    viewWidth: VIEW_W,
  });

  const {
    svgBracePreviewPoints2d,
    svgPlanningInputPoints2d,
    svgPlanningPolygons2d,
    svgScenarioPreviewSegments2d,
    svgVisiblePointLabels2d,
  } = useFrozenMapViewOverlays({
    bracePreviewPoints2d,
    effectiveMode,
    interactionPhase,
    planningInputPoints2d,
    planningPolygons2d,
    scenarioPreviewSegments2d,
    visiblePointLabels2d: effectiveVisiblePointLabels2d,
  });

  const webglScene2d = useMemo(
    () =>
      measureMapViewPerf('map:build-webgl-scene', () =>
        {
          noteMapViewPerfCounter('map:webgl-scene-rebuilds');
          return buildMapViewWebglScene2d({
            originalGeometryOpacity,
            lineWidth2d,
            pointRadius2d,
            ellipseStroke2d,
            viewZoom: view2d.zoom,
            projectionScale: projection2d.scale,
            units,
            interactionDenseMode,
            unselectedCanvasLines2d,
            filteredVisiblePoints2d,
            ellipseStroke,
            stationFill,
            bracePreviewPoints2d,
            scenarioPreviewSegments2d,
          });
        },
      ),
    [
      bracePreviewPoints2d,
      ellipseStroke,
      ellipseStroke2d,
      filteredVisiblePoints2d,
      interactionDenseMode,
      lineWidth2d,
      originalGeometryOpacity,
      pointRadius2d,
      view2d.zoom,
      projection2d.scale,
      scenarioPreviewSegments2d,
      stationFill,
      units,
      unselectedCanvasLines2d,
    ],
  );

  const mapHitIndex2d = useMemo(
    () =>
      buildMapViewHitIndex({
        points: filteredVisiblePoints2d,
        lines: filteredVisibleMapLines2d,
      }),
    [filteredVisibleMapLines2d, filteredVisiblePoints2d],
  );

  useLayoutEffect(() => {
    if (effectiveMode !== '2d') return;
    noteMapViewPerfMetadata('map:renderer2d', renderer2d);
    noteMapViewPerfMetadata('map:show-labels', showLabels);
    noteMapViewPerfMetadata('map:show-input-points', planningMap.showInputPoints);
    noteMapViewPerfMetadata('map:show-obstacles', planningMap.showObstacleLayer);
    noteMapViewPerfMetadata('map:show-blocked-areas', planningMap.showBlockedAreas);
    noteMapViewPerfMetadata('map:basemap-mode', planningMap.basemapMode);
    noteMapViewPerfMetadata('map:visible-point-count', filteredVisiblePoints2d.length);
    noteMapViewPerfMetadata('map:visible-line-count', filteredVisibleMapLines2d.length);
    noteMapViewPerfMetadata('map:planning-input-point-count', planningInputPoints2d.length);
    noteMapViewPerfMetadata('map:planning-polygon-count', planningPolygons2d.length);
    noteMapViewPerfMetadata('map:interaction-phase', interactionPhase);
  }, [
    effectiveMode,
    filteredVisibleMapLines2d.length,
    filteredVisiblePoints2d.length,
    interactionPhase,
    planningInputPoints2d.length,
    planningMap.basemapMode,
    planningMap.showBlockedAreas,
    planningMap.showInputPoints,
    planningMap.showObstacleLayer,
    planningPolygons2d.length,
    renderer2d,
    showLabels,
  ]);

  useLayoutEffect(() => {
    if (effectiveMode !== '2d') return;
    latestGeometryRenderInputRef.current = {
      interactionPhase,
      view2d,
      originalGeometryOpacity,
      lineWidth2d,
      pointRadius2d,
      ellipseStroke2d,
      projectionScale: projection2d.scale,
      units,
      interactionDenseMode,
      unselectedCanvasLines2d,
      filteredVisiblePoints2d,
      ellipseStroke,
      stationFill,
    };
    latestWebglRenderInputRef.current = {
      interactionPhase,
      viewWidth: VIEW_W,
      viewHeight: VIEW_H,
      view2d,
      tiles: latestBasemapRenderInputRef.current?.tiles ?? [],
      ...webglScene2d,
    };
    renderLayersNow({ geometry: true });
  }, [
    effectiveMode,
    ellipseStroke,
    ellipseStroke2d,
    filteredVisiblePoints2d,
    interactionDenseMode,
    interactionPhase,
    latestBasemapRenderInputRef,
    latestGeometryRenderInputRef,
    latestWebglRenderInputRef,
    lineWidth2d,
    originalGeometryOpacity,
    pointRadius2d,
    projection2d.scale,
    renderLayersNow,
    stationFill,
    units,
    unselectedCanvasLines2d,
    view2d,
    webglScene2d,
  ]);

  useLayoutEffect(() => {
    if (effectiveMode !== '2d') return;
    latestPlanningRenderInputRef.current = {
      interactionPhase,
      view2d,
      pointRadius2d,
      planningInputPoints2d,
      planningPolygons2d: planningPolygons2d.map((polygon) => ({
        id: polygon.id,
        source: polygon.source,
        kind: polygon.kind,
        label: polygon.label,
        vertices: polygon.vertices,
      })),
      selectedPlanningPolygonIds,
    };
    renderLayersNow({ planning: true });
  }, [
    effectiveMode,
    interactionPhase,
    latestPlanningRenderInputRef,
    planningInputPoints2d,
    planningPolygons2d,
    pointRadius2d,
    renderLayersNow,
    selectedPlanningPolygonIds,
    view2d,
  ]);

  useLayoutEffect(() => {
    if (effectiveMode !== '2d') return;
    renderLayersNow({ basemap: true, geometry: true, planning: true });
  }, [effectiveMode, renderLayersNow, renderer2d]);

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

  const openContextMenu = (event: React.MouseEvent<SVGSVGElement>) => {
    event.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pointer = toSvgCoords(event.clientX, event.clientY);
    const polygonHit =
      effectiveMode === '2d' && pointer != null
        ? findPlanningPolygonAtSvgPoint(pointer)
        : null;
    const polygonId = polygonHit?.polygonId ?? null;
    const polygonSource = polygonHit?.polygonSource ?? null;
    const polygonLabel = polygonHit?.polygonLabel ?? 'Planning obstacle';
    const preserveMultiSelection = selectedPlanningPolygonIds.length > 1;
    if (polygonId && !preserveMultiSelection) {
      setSelectedPlanningPolygonIds([polygonId]);
    }
    const showMultiDelete = !polygonId && selectedPlanningPolygonIds.length > 1;
    const effectiveMultiDelete = preserveMultiSelection || showMultiDelete;
    const menuWidth = 240;
    const menuHeight =
      effectiveMultiDelete && !polygonId
        ? 172
        : preserveMultiSelection && polygonId
          ? 172
          : polygonId
            ? 232
            : 126;
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;
    const x = clamp(localX, 8, Math.max(8, rect.width - menuWidth - 8));
    const y = clamp(localY, 8, Math.max(8, rect.height - menuHeight - 8));
    setContextMenu({
      open: true,
      x,
      y,
      planningPolygon:
        !preserveMultiSelection && polygonId && (polygonSource === 'user' || polygonSource === 'osm')
          ? {
              polygonId,
              polygonSource,
              polygonLabel,
            }
          : null,
    });
  };

  const handleEditPlanningPolygon = useCallback(() => {
    const polygon = contextMenu.planningPolygon;
    if (!polygon) return;
    setSelectedPlanningPolygonIds([polygon.polygonId]);
    setContextMenu((current) => ({ ...current, open: false, planningPolygon: null }));
  }, [contextMenu.planningPolygon, setSelectedPlanningPolygonIds]);

  const handleDeletePlanningPolygon = useCallback(() => {
    const polygon = contextMenu.planningPolygon;
    if (!polygon) return;
    removePlanningPolygon(polygon.polygonId, polygon.polygonSource);
    closeContextMenu();
  }, [closeContextMenu, contextMenu.planningPolygon, removePlanningPolygon]);

  const handleRemoveSelectedPlanningPolygons = useCallback(() => {
    removeSelectedPlanningPolygons();
    closeContextMenu();
  }, [closeContextMenu, removeSelectedPlanningPolygons]);

  const handlePlanningVertexMouseDown = useCallback(
    (polygonId: string, vertexIndex: number, event: React.MouseEvent<SVGCircleElement>) => {
      const polygonSource = planningMap.obstaclePolygons.some((polygon) => polygon.id === polygonId)
        ? ('osm' as const)
        : ('user' as const);
      planningVertexDragRef.current = { polygonId, polygonSource, vertexIndex };
      setSelectedPlanningPolygonIds([polygonId]);
      beginDrag('planning-vertex', event.clientX, event.clientY);
      event.preventDefault();
      event.stopPropagation();
    },
    [beginDrag, planningMap.obstaclePolygons, planningVertexDragRef, setSelectedPlanningPolygonIds],
  );

  const handleSvgClick = (event: React.MouseEvent<SVGSVGElement>) => {
    if (effectiveMode === '3d') {
      const target = event.target as HTMLElement | null;
      const stationId = target?.getAttribute('data-map-station');
      if (toolPickTarget != null && stationId) {
        applyPickedToolStation(stationId);
        return;
      }
      if (!target?.closest('[data-map-observation],[data-map-station]')) {
        clearMapSelection();
      }
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-map-observation],[data-map-station]')) return;
    const pointer = toSvgCoords(event.clientX, event.clientY);
    if (!pointer) return;
    const pointCandidates = mapHitIndex2d.pointCandidates(pointer.x, pointer.y, POINT_HIT_RADIUS_PX);
    let nearestPointId: string | null = null;
    let nearestPointDistance = Number.POSITIVE_INFINITY;
    pointCandidates.forEach((point) => {
      const distance = Math.hypot(pointer.x - point.screenX, pointer.y - point.screenY);
      if (distance <= POINT_HIT_RADIUS_PX && distance < nearestPointDistance) {
        nearestPointDistance = distance;
        nearestPointId = point.id;
      }
    });
    if (toolPickTarget != null) {
      if (nearestPointId) applyPickedToolStation(nearestPointId);
      return;
    }
    if (planningMap.blockEditMode) {
      setDraftBlockedPolygon((current) => [...current, svgToMapCoords(pointer.x, pointer.y)]);
      return;
    }
    if (selectionBox != null) {
      const nextMode: SelectionBoxMode =
        pointer.x >= selectionBox.anchorX ? 'window' : 'crossing';
      const nextRect = {
        x: Math.min(selectionBox.anchorX, pointer.x),
        y: Math.min(selectionBox.anchorY, pointer.y),
        width: Math.abs(pointer.x - selectionBox.anchorX),
        height: Math.abs(pointer.y - selectionBox.anchorY),
        mode: nextMode,
      };
      applySelectionBoxToPlanningPolygons(nextRect);
      return;
    }
    if (nearestPointId) {
      setSelectedPlanningPolygonIds([]);
      onSelectStation?.(nearestPointId);
      return;
    }
    const lineCandidates = mapHitIndex2d.lineCandidates(pointer.x, pointer.y, LINE_HIT_RADIUS_PX);
    let nearestLineObservationId: number | null = null;
    let nearestLineDistance = Number.POSITIVE_INFINITY;
    lineCandidates.forEach((line) => {
      const distance = pointToSegmentDistancePx(
        pointer.x,
        pointer.y,
        line.screenX1,
        line.screenY1,
        line.screenX2,
        line.screenY2,
      );
      if (distance <= LINE_HIT_RADIUS_PX && distance < nearestLineDistance) {
        nearestLineDistance = distance;
        nearestLineObservationId = line.observationId;
      }
    });
    if (nearestLineObservationId != null) {
      setSelectedPlanningPolygonIds([]);
      onSelectObservation?.(nearestLineObservationId);
      return;
    }
    const polygonHit = findPlanningPolygonAtSvgPoint(pointer);
    if (polygonHit != null) {
      setSelectedPlanningPolygonIds([polygonHit.polygonId]);
      onSelectStation?.(null);
      onSelectObservation?.(null);
      setSelectionBox(null);
      return;
    }
    if (
      selectedStationId != null ||
      selectedObservationId != null ||
      selectedPlanningPolygonIds.length > 0
    ) {
      clearMapSelection();
      return;
    }
    setSelectionBox({
      anchorX: pointer.x,
      anchorY: pointer.y,
      currentX: pointer.x,
      currentY: pointer.y,
    });
  };

  return (
    <div className="h-full p-4 flex flex-col min-h-0">
      <div className="flex items-center justify-between mb-3 text-xs text-slate-400 shrink-0">
        <span>
          Map view ({effectiveMode === '2d' ? '2D true-scale' : '3D scaled'}) — coords &
          ellipses in {units} (
          {unitScale.toFixed(4)} factor)
        </span>
        <div className="flex items-center gap-3">
          {effectiveMode === '2d' && mapDensitySummary.dense && (
            <span className="text-[11px] text-slate-500">
              Dense view: labels {mapDensitySummary.labelTotal}/{filteredVisiblePoints2d.length}
              {mapDensitySummary.lineSuppressed > 0
                ? `, clipped links ${mapDensitySummary.lineSuppressed}`
                : ''}
            </span>
          )}
          <span className="text-slate-500">
            {effectiveMode === '3d'
              ? 'Left-drag=orbit, middle-drag=pan, wheel=zoom, middle-double-click=reset'
              : 'Wheel=zoom, middle-drag=pan, middle-double-click=reset extents'}
            {'; right-click=tools'}
          </span>
        </div>
      </div>
      {effectiveMode === '2d' && (
        <div className="mb-2 flex flex-wrap items-center gap-3 rounded border border-slate-700/80 bg-slate-900/75 px-3 py-2 text-[11px] text-slate-200">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={showLabels}
              onChange={(event) => setShowLabels(event.target.checked)}
              className="h-3.5 w-3.5 rounded border-slate-500 bg-slate-950 text-cyan-400 focus:ring-cyan-500"
            />
            <span className="uppercase tracking-wide">Show labels</span>
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={hideMinorGeometry}
              onChange={(event) => setHideMinorGeometry(event.target.checked)}
              className="h-3.5 w-3.5 rounded border-slate-500 bg-slate-950 text-cyan-400 focus:ring-cyan-500"
            />
            <span className="uppercase tracking-wide">Hide minor geometry</span>
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={focusSelection}
              onChange={(event) => setFocusSelection(event.target.checked)}
              className="h-3.5 w-3.5 rounded border-slate-500 bg-slate-950 text-cyan-400 focus:ring-cyan-500"
            />
            <span className="uppercase tracking-wide">Focus selection</span>
          </label>
          <div className="ml-2 h-4 w-px bg-slate-700" />
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={planningMap.basemapMode === 'osm'}
              onChange={(event) =>
                onPlanningMapChange?.({
                  ...planningMap,
                  basemapMode: event.target.checked ? 'osm' : 'none',
                })
              }
              className="h-3.5 w-3.5 rounded border-slate-500 bg-slate-950 text-pink-300 focus:ring-pink-400"
            />
            <span className="uppercase tracking-wide">OSM basemap</span>
          </label>
          {onLoadInputPoints && (
            <button
              type="button"
              onClick={onLoadInputPoints}
              className="rounded border border-slate-600 px-2 py-1 uppercase tracking-wide text-slate-100 hover:border-pink-300"
            >
              {inputPointsLoaded ? 'Reload points' : 'Load points'}
            </button>
          )}
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={planningMap.showInputPoints}
              onChange={(event) =>
                onPlanningMapChange?.({
                  ...planningMap,
                  showInputPoints: event.target.checked,
                })
              }
              className="h-3.5 w-3.5 rounded border-slate-500 bg-slate-950 text-pink-300 focus:ring-pink-400"
            />
            <span className="uppercase tracking-wide">Input points</span>
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={planningMap.showObstacleLayer}
              onChange={(event) =>
                onPlanningMapChange?.({
                  ...planningMap,
                  showObstacleLayer: event.target.checked,
                })
              }
              className="h-3.5 w-3.5 rounded border-slate-500 bg-slate-950 text-pink-300 focus:ring-pink-400"
            />
            <span className="uppercase tracking-wide">Obstacles</span>
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={planningMap.showBlockedAreas}
              onChange={(event) =>
                onPlanningMapChange?.({
                  ...planningMap,
                  showBlockedAreas: event.target.checked,
                })
              }
              className="h-3.5 w-3.5 rounded border-slate-500 bg-slate-950 text-pink-300 focus:ring-pink-400"
            />
            <span className="uppercase tracking-wide">Blocked areas</span>
          </label>
          <button
            type="button"
            onClick={() =>
              onPlanningMapChange?.({
                ...planningMap,
                blockEditMode: !planningMap.blockEditMode,
              })
            }
            className={`rounded border px-2 py-1 uppercase tracking-wide ${
              planningMap.blockEditMode
                ? 'border-pink-300 text-pink-100 bg-pink-950/30'
                : 'border-slate-600 text-slate-200'
            }`}
          >
            {planningMap.blockEditMode ? 'Stop draw' : 'Draw block'}
          </button>
          {draftBlockedPolygon.length > 0 && (
            <>
              <button
                type="button"
                onClick={commitDraftBlockedPolygon}
                disabled={draftBlockedPolygon.length < 3}
                className="rounded border border-pink-400 px-2 py-1 uppercase tracking-wide text-pink-100 disabled:border-slate-700 disabled:text-slate-500"
              >
                Finish block
              </button>
              <button
                type="button"
                onClick={clearDraftBlockedPolygon}
                className="rounded border border-slate-600 px-2 py-1 uppercase tracking-wide"
              >
                Cancel draft
              </button>
            </>
          )}
          {planningMap.blockedPolygons.length > 0 && (
            <button
              type="button"
              onClick={() =>
                onPlanningMapChange?.({
                  ...planningMap,
                  blockedPolygons: [],
                })
              }
              className="rounded border border-slate-600 px-2 py-1 uppercase tracking-wide"
            >
              Clear blocks
            </button>
          )}
        </div>
      )}
      {effectiveMode === '2d' && planningMap.blockedPolygons.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded border border-slate-800/70 bg-slate-950/60 px-3 py-2 text-[11px] text-slate-300">
          <span className="uppercase tracking-wide text-slate-500">Blocked polygons</span>
          {selectedPlanningPolygonIds.length > 1 && (
            <button
              type="button"
              onClick={removeSelectedPlanningPolygons}
              className="rounded border border-pink-400 px-2 py-1 text-pink-100 hover:bg-pink-950/30"
            >
              Delete {selectedPlanningPolygonIds.length} selected
            </button>
          )}
          {planningMap.blockedPolygons.map((polygon) => (
            <button
              key={polygon.id}
              type="button"
              onClick={() => removePlanningPolygon(polygon.id, 'user')}
              className="rounded border border-slate-700 px-2 py-1 text-slate-200 hover:bg-slate-800"
            >
              Delete {polygon.label || polygon.id}
            </button>
          ))}
        </div>
      )}
      {showTransformToggle && (
        <div className="mb-2 flex flex-wrap items-center gap-3 rounded border border-slate-700/80 bg-slate-900/75 px-3 py-2 text-[11px] text-slate-200">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={transformedOverlayActive}
              onChange={(event) => setShowTransformedCoordinates(event.target.checked)}
              disabled={!transformedOverlayConfig.available || effectiveMode !== '2d'}
              className="h-3.5 w-3.5 rounded border-slate-500 bg-slate-950 text-cyan-400 focus:ring-cyan-500"
            />
            <span className="uppercase tracking-wide">Show transformed coordinates</span>
          </label>
          <span className="text-slate-400">
            Ref {transformedOverlayConfig.referenceStationId || '-'}; scope{' '}
            {transformedOverlayConfig.scope === 'all' ? 'all points' : 'selected + reference'}; order
            scale-&gt;rotate-&gt;translate
            {transformedOverlayConfig.scaleEnabled &&
              `; k=${transformedOverlayConfig.scaleFactor.toFixed(6)}`}
            {transformedOverlayConfig.rotationEnabled &&
              `; rot=${transformedOverlayConfig.rotationAngleDeg.toFixed(6)}deg`}
            {transformedOverlayConfig.translationEnabled &&
              `; tr=${transformedOverlayConfig.translationMethod}, az=${transformedOverlayConfig.translationAzimuthDeg.toFixed(6)}deg, d=${(transformedOverlayConfig.translationDistanceM * unitScale).toFixed(4)} ${units}`}
          </span>
          {!transformedOverlayConfig.available && transformedOverlayConfig.reason && (
            <span className="text-amber-300">{transformedOverlayConfig.reason}</span>
          )}
          {effectiveMode !== '2d' && transformedOverlayConfig.available && (
            <span className="text-slate-400">2D map mode required for transformed overlay.</span>
          )}
        </div>
      )}
      {mode === '3d' && fallbackReason && (
        <div className="mb-2 rounded border border-amber-800/60 bg-amber-950/30 px-3 py-2 text-[11px] text-amber-200">
          3D rendering fallback: {fallbackReason}. Showing 2D map for stable performance.
        </div>
      )}
      {isPreanalysis && (
        <div className="mb-2 rounded border border-cyan-900/60 bg-cyan-950/20 px-3 py-2 text-[11px] text-cyan-100">
          Preanalysis map: predicted ellipses use sigma0^2 = 1.0. Weak-geometry cues are highlighted
          in amber/red on non-fixed stations.
        </div>
      )}
      <div
        ref={containerRef}
        data-map-interaction-phase={interactionPhase}
        data-map-renderer={effectiveMode === '2d' ? renderer2d : 'svg-3d'}
        data-map-view-zoom={view2d.zoom.toFixed(6)}
        data-map-view-pan-x={view2d.panX.toFixed(6)}
        data-map-view-pan-y={view2d.panY.toFixed(6)}
        data-map-derived-view-zoom={derivedView2d.zoom.toFixed(6)}
        data-map-derived-view-pan-x={derivedView2d.panX.toFixed(6)}
        data-map-derived-view-pan-y={derivedView2d.panY.toFixed(6)}
        className="bg-slate-900 border-y border-slate-800 rounded overflow-hidden flex-1 min-h-0 relative"
      >
        <div
          ref={renderSurfaceRef}
          className="absolute"
          style={{
            width: `${renderSurfaceLayout.width}px`,
            height: `${renderSurfaceLayout.height}px`,
            left: `${renderSurfaceLayout.left}px`,
            top: `${renderSurfaceLayout.top}px`,
          }}
        >
          {effectiveMode === '2d' && (
            <>
              {renderer2d === 'canvas' && (
                <canvas
                  ref={basemapCanvasRef}
                  data-testid="map-base-canvas"
                  className="absolute inset-0 z-0 h-full w-full pointer-events-none"
                />
              )}
              <canvas
                ref={planningCanvasRef}
                data-testid="map-planning-canvas"
                className="absolute inset-0 z-10 h-full w-full pointer-events-none"
              />
              {webglEligible && (
                <canvas
                  ref={webglCanvasRef}
                  data-testid="map-webgl-canvas"
                  className={`absolute inset-0 z-20 h-full w-full pointer-events-none ${
                    renderer2d === 'webgl' ? '' : 'hidden'
                  }`}
                />
              )}
              {renderer2d === 'canvas' && (
                <canvas
                  ref={geometryCanvasRef}
                  data-testid="map-geometry-canvas"
                  className="absolute inset-0 z-20 h-full w-full pointer-events-none"
                />
              )}
            </>
          )}
          <svg
            ref={svgRef}
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            preserveAspectRatio="xMidYMid slice"
            shapeRendering={interactionPhase === 'interacting' ? 'optimizeSpeed' : 'geometricPrecision'}
            className={`absolute inset-0 z-30 h-full w-full select-none ${
              toolPickTarget != null
                ? 'cursor-crosshair'
                : isDragging
                  ? 'cursor-grabbing'
                  : effectiveMode === '3d'
                    ? 'cursor-grab'
                    : 'cursor-default'
            }`}
            onWheel={handleWheel}
            onClick={handleSvgClick}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onContextMenu={openContextMenu}
          >
            {effectiveMode === '2d' && (
              <MapViewSvg2d
                marker2d={marker2d}
                view2d={view2d}
                showLabels={showLabels}
                interactionPhase={interactionPhase}
                originalGeometryOpacity={originalGeometryOpacity}
                filteredVisiblePoints2d={filteredVisiblePoints2d}
                visiblePointLabels2d={svgVisiblePointLabels2d}
                labelOffset2d={labelOffset2d}
                labelFont2d={labelFont2d}
                labelStroke2d={labelStroke2d}
                filteredVisibleMapLines2d={filteredVisibleMapLines2d}
                selectedObservationId={selectedObservationId}
                selectedObservationPairKey={selectedObservationPairKey}
                lineWidth2d={lineWidth2d}
                onSelectObservation={onSelectObservation}
                selectedStationId={selectedStationId}
                highlightedToolStationIds={highlightedToolStationIds}
                highlightedToolSegments={highlightedToolSegments}
                pointRadius2d={pointRadius2d}
                transformedOverlayActive={transformedOverlayActive}
                transformedLines2d={transformedLines2d}
                transformedPoints2d={transformedPoints2d}
                planningInputPoints2d={svgPlanningInputPoints2d}
                planningPolygons2d={svgPlanningPolygons2d}
                selectedPlanningPolygonIds={selectedPlanningPolygonIds}
                renderPlanningPolygonBodies={false}
                renderPlanningInputPoints={false}
                bracePreviewPoints2d={svgBracePreviewPoints2d}
                scenarioPreviewSegments2d={svgScenarioPreviewSegments2d}
                renderBracePreviewMarkers={renderer2d !== 'webgl'}
                renderScenarioPreviewSegments={renderer2d !== 'webgl'}
                selectionBoxRect={selectionBoxRect}
                onPlanningVertexMouseDown={handlePlanningVertexMouseDown}
                project2d={project2d}
              />
            )}

            {effectiveMode === '3d' && camera3d && (
              <MapViewScene3d
                viewWidth={VIEW_W}
                viewHeight={VIEW_H}
                scene3d={scene3d}
                projected3d={projected3d}
                projected3dById={projected3dById}
                visiblePointLabels3d={visiblePointLabels3d}
                project3d={project3d}
                sceneRadius={scene3d.extents.radius}
                maxEllipsoidSamples={MAX_ELLIPSOID_SAMPLES}
                ellipseStroke={ellipseStroke}
                stationFill={stationFill}
                mapLinkByPairKey={mapLinkByPairKey}
                selectedObservationId={selectedObservationId}
                selectedObservationPairKey={selectedObservationPairKey}
                onSelectObservation={onSelectObservation}
                selectedStationId={selectedStationId}
                highlightedToolStationIds={highlightedToolStationIds}
                highlightedToolSegments={highlightedToolSegments}
                onSelectStation={onSelectStation}
              />
            )}

            {points.length === 0 && (
              <>
                <text x={VIEW_W / 2} y={VIEW_H / 2 - 18} textAnchor="middle" fill="#94a3b8" fontSize={18}>
                  No stations to display
                </text>
                {onLoadInputPoints && (
                  <text x={VIEW_W / 2} y={VIEW_H / 2 + 12} textAnchor="middle" fill="#f9a8d4" fontSize={13}>
                    Use "Load points" to populate the planning map before the first run.
                  </text>
                )}
              </>
            )}
          </svg>
        </div>
        {effectiveMode === '3d' && (
          <div className="absolute right-2 top-2 z-10 rounded border border-slate-700/80 bg-slate-900/85 p-1">
            <div className="grid grid-cols-2 gap-1 text-[10px]">
              <button
                type="button"
                onClick={() => applyCubeView('iso')}
                className="rounded bg-slate-800 px-2 py-1 text-slate-200 hover:bg-slate-700"
              >
                ISO
              </button>
              <button
                type="button"
                onClick={() => applyCubeView('top')}
                className="rounded bg-slate-800 px-2 py-1 text-slate-200 hover:bg-slate-700"
              >
                TOP
              </button>
              <button
                type="button"
                onClick={() => applyCubeView('front')}
                className="rounded bg-slate-800 px-2 py-1 text-slate-200 hover:bg-slate-700"
              >
                FRONT
              </button>
              <button
                type="button"
                onClick={() => applyCubeView('right')}
                className="rounded bg-slate-800 px-2 py-1 text-slate-200 hover:bg-slate-700"
              >
                RIGHT
              </button>
            </div>
          </div>
        )}
        {contextMenu.open && (
          <div
            ref={contextMenuRef}
            className="pointer-events-none absolute inset-0 z-[70]"
          >
            <MapViewContextMenu
              x={contextMenu.x}
              y={contextMenu.y}
              onOpenTool={openTool}
              planningPolygonLabel={contextMenu.planningPolygon?.polygonLabel ?? null}
              selectedPlanningPolygonCount={selectedPlanningPolygonIds.length}
              onEditPlanningPolygon={
                contextMenu.planningPolygon != null ? handleEditPlanningPolygon : null
              }
              onDeletePlanningPolygon={
                contextMenu.planningPolygon != null ? handleDeletePlanningPolygon : null
              }
              onDeleteSelectedPlanningPolygons={
                selectedPlanningPolygonIds.length > 1 ? handleRemoveSelectedPlanningPolygons : null
              }
            />
          </div>
        )}
        {activeTool !== 'none' && (
          <MapViewToolOverlay
            activeTool={activeTool}
            visibleStationRows={visibleStationRows}
            isPreanalysis={isPreanalysis}
            units={units}
            unitScale={unitScale}
            onClose={closeTool}
            inverseFromInput={inverseFromInput}
            inverseToInput={inverseToInput}
            inverseFromId={inverseFromId}
            inverseToId={inverseToId}
            onInverseFromInputChange={setInverseFromInput}
            onInverseToInputChange={setInverseToInput}
            pickTarget={toolPickTarget}
            onTogglePickTarget={toggleToolPickTarget}
            inverse={inverse}
            anglePivotInput={anglePivotInput}
            angleFromInput={angleFromInput}
            angleToInput={angleToInput}
            anglePivotId={anglePivotId}
            angleFromId={angleFromId}
            angleToId={angleToId}
            onAnglePivotInputChange={setAnglePivotInput}
            onAngleFromInputChange={setAngleFromInput}
            onAngleToInputChange={setAngleToInput}
            angleBetween={angleBetween}
          />
        )}
        {effectiveMode === '2d' && planningMap.basemapMode === 'osm' && (
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noreferrer"
            className="pointer-events-auto absolute bottom-2 right-2 rounded bg-slate-950/75 px-2 py-1 text-[10px] text-slate-300 hover:text-white"
          >
            Basemap © OpenStreetMap contributors
          </a>
        )}
        {effectiveMode === '2d' && (
          <div
            data-testid="map-renderer-badge"
            className="pointer-events-none absolute bottom-2 left-2 rounded bg-slate-950/75 px-2 py-1 text-[10px] text-slate-300"
          >
            {renderer2d === 'webgl' ? 'Renderer: WebGL2' : 'Renderer: Canvas fallback'}
            {mapDensitySummary.dense ? ' | Dense overlay' : ' | Normal overlay'}
          </div>
        )}
      </div>
    </div>
  );
};

export default MapView;
