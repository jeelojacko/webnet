import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  buildStationIdLookup,
  buildVisibleStationRows,
  buildVisibleStationIds,
  buildWeakStationSeverityLookup,
  resolveMapEllipseStrokeColor,
  resolveMapStationFillColor,
  resolveWeakStationSeverity,
  resolveSelectedObservationPairKey,
  resolveStationIdToken,
  scoreMapStationPriority,
} from '../engine/resultDerivedModels';
import { noteUiPerfStage, noteUiTabReady } from '../hooks/useUiPerfMonitor';
import {
  buildDerivedMapState2d,
  buildProjection2d,
  buildViewportBounds,
  clamp,
  pointToSegmentDistancePx,
  projectPoint2d,
  type ViewportBounds,
  view2dEquals,
} from './mapView/mapView2d';
import { createStableRuntimeId } from '../engine/id';
import { inverseENToGeodetic, projectGeodeticToEN } from '../engine/geodesy';
import { DEFAULT_PLANNING_MAP_STATE } from '../engine/planningMapState';
import MapViewSvg2d from './mapView/MapViewSvg2d';
import MapViewScene3d from './mapView/MapViewScene3d';
import MapViewContextMenu, { type MapToolPanel } from './mapView/MapViewContextMenu';
import MapViewToolOverlay from './mapView/MapViewToolOverlay';
import { renderMapCanvas2d, type CanvasBasemapTile2d } from './mapView/mapViewCanvas2d';
import { chooseOsmTileMeshDivisions } from './mapView/mapViewBasemap';
import {
  buildMapScenePointBounds2d,
  buildMapToolMetrics,
  buildMapViewStyle2d,
  buildProjectedMapState3d,
  buildTransformedOverlayGeometry2d,
} from './mapView/mapViewSelectors';
import { projectPoint3d } from './mapView/mapView3d';

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
const LABEL_GRID_PX = 48;
const INTERACTION_SETTLE_MS = 90;
const INTERACTION_DENSE_POINT_THRESHOLD = 180;
const INTERACTION_DENSE_LINE_THRESHOLD = 360;
const POINT_HIT_RADIUS_PX = 10;
const LINE_HIT_RADIUS_PX = 8;
const EMPTY_MAP_LINKS: ReturnType<typeof buildObservationMapLinks> = [];

type MapInteractionPhase = 'idle' | 'interacting' | 'settling';

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
  onSelectStation?: (_stationId: string) => void;
  onSelectObservation?: (_observationId: number) => void;
  snapshot?: MapViewSnapshot | null;
  onSnapshotChange?: (_snapshot: MapViewSnapshot) => void;
}

type DragMode = 'none' | 'pan2d' | 'orbit3d' | 'pan3d' | 'planning-vertex';

type OverpassGeometryVertex = { lat: number; lon: number };
type OverpassElement = {
  id?: number | string;
  geometry?: OverpassGeometryVertex[];
  tags?: Record<string, string>;
};
type BasemapTile2d = {
  key: string;
  href: string;
  meshColumns: number;
  meshRows: number;
  meshPoints: Array<{ x: number; y: number }>;
};
type PlanningPolygonTarget = {
  polygonId: string;
  polygonSource: 'user' | 'osm';
  polygonLabel: string;
};

const OSM_TILE_SIZE_PX = 256;
const OSM_MAX_ZOOM = 19;
const OSM_MIN_ZOOM = 0;
const OSM_FETCH_BUFFER_M = 100;
const clampLatitudeForTiles = (latDeg: number): number =>
  Math.min(85.05112878, Math.max(-85.05112878, latDeg));

const longitudeToTileX = (lonDeg: number, zoom: number): number =>
  ((lonDeg + 180) / 360) * 2 ** zoom;

const latitudeToTileY = (latDeg: number, zoom: number): number => {
  const latRad = (clampLatitudeForTiles(latDeg) * Math.PI) / 180;
  return (
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
    2 ** zoom
  );
};

const tileXToLongitude = (tileX: number, zoom: number): number => (tileX / 2 ** zoom) * 360 - 180;

const tileYToLatitude = (tileY: number, zoom: number): number => {
  const n = Math.PI - (2 * Math.PI * tileY) / 2 ** zoom;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};

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
  const unitScale = units === 'ft' ? FT_PER_M : 1;
  const isPreanalysis = result.preanalysisMode === true;
  const { stations, observations } = result;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const basemapLoadingRef = useRef<Set<string>>(new Set());
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
  const pendingView2dRef = useRef(view2d);
  const view2dFrameRef = useRef<number | null>(null);
  const settleTimerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const settleFrameRef = useRef<number | null>(null);
  const [interactionPhase, setInteractionPhase] = useState<MapInteractionPhase>('idle');
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
  const [activeTool, setActiveTool] = useState<MapToolPanel>(() => snapshot?.activeTool ?? 'none');
  const [inverseFromInput, setInverseFromInput] = useState(() => snapshot?.inverseFromInput ?? '');
  const [inverseToInput, setInverseToInput] = useState(() => snapshot?.inverseToInput ?? '');
  const [anglePivotInput, setAnglePivotInput] = useState(() => snapshot?.anglePivotInput ?? '');
  const [angleFromInput, setAngleFromInput] = useState(() => snapshot?.angleFromInput ?? '');
  const [angleToInput, setAngleToInput] = useState(() => snapshot?.angleToInput ?? '');
  const [showTransformedCoordinates, setShowTransformedCoordinates] = useState(
    () => snapshot?.showTransformedCoordinates ?? false,
  );
  const [showLabels, setShowLabels] = useState(() => snapshot?.showLabels ?? true);
  const [hideMinorGeometry, setHideMinorGeometry] = useState(
    () => snapshot?.hideMinorGeometry ?? false,
  );
  const [focusSelection, setFocusSelection] = useState(() => snapshot?.focusSelection ?? false);
  const [draftBlockedPolygon, setDraftBlockedPolygon] = useState<Array<{ x: number; y: number }>>([]);
  const [selectedPlanningPolygonId, setSelectedPlanningPolygonId] = useState<string | null>(null);
  const skipNextAutoResetRef = useRef(snapshot != null);
  const planningVertexDragRef = useRef<{
    polygonId: string;
    polygonSource: 'user' | 'osm';
    vertexIndex: number;
  } | null>(null);
  const [viewportWidth, setViewportWidth] = useState<number>(
    typeof window !== 'undefined' ? window.innerWidth : 1280,
  );
  const [basemapImages, setBasemapImages] = useState<Map<string, HTMLImageElement>>(() => new Map());

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

  const stationFill = useCallback(
    (stationId: string, fixed: boolean): string =>
      resolveMapStationFillColor({ fixed, severity: stationSeverity(stationId) }),
    [stationSeverity],
  );

  const ellipseStroke = useCallback(
    (stationId: string): string => resolveMapEllipseStrokeColor(stationSeverity(stationId)),
    [stationSeverity],
  );

  const stationIdLookup = useMemo(() => buildStationIdLookup(visibleStationIds), [visibleStationIds]);

  const resolveStationId = useCallback(
    (value: string): string | null => resolveStationIdToken(stationIdLookup, value),
    [stationIdLookup],
  );

  useEffect(() => {
    if (typeof window === 'undefined' || viewportWidthOverride != null) return;
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [viewportWidthOverride]);

  useEffect(() => {
    if (visibleStationIds.length === 0) {
      setInverseFromInput('');
      setInverseToInput('');
      setAnglePivotInput('');
      setAngleFromInput('');
      setAngleToInput('');
      return;
    }
    if (!resolveStationId(inverseFromInput)) setInverseFromInput(visibleStationIds[0]);
    if (!resolveStationId(inverseToInput))
      setInverseToInput(visibleStationIds[Math.min(1, visibleStationIds.length - 1)]);
    if (!resolveStationId(anglePivotInput)) setAnglePivotInput(visibleStationIds[0]);
    if (!resolveStationId(angleFromInput))
      setAngleFromInput(visibleStationIds[Math.min(1, visibleStationIds.length - 1)]);
    if (!resolveStationId(angleToInput))
      setAngleToInput(visibleStationIds[Math.min(2, visibleStationIds.length - 1)]);
  }, [
    angleFromInput,
    anglePivotInput,
    angleToInput,
    inverseFromInput,
    inverseToInput,
    resolveStationId,
    visibleStationIds,
  ]);

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
  const showTransformToggle = transformedOverlayConfig.enabled;
  const transformedOverlayActive =
    showTransformedCoordinates && transformedOverlayConfig.available && effectiveMode === '2d';

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
      const next = updater(pendingView2dRef.current);
      pendingView2dRef.current = next;
      scheduleView2dCommit();
    },
    [scheduleView2dCommit],
  );

  const markInteracting = useCallback(() => {
    if (effectiveMode !== '2d') return;
    clearInteractionSettle();
    setInteractionPhase('interacting');
    settleTimerRef.current = globalThis.setTimeout(() => {
      settleTimerRef.current = null;
      setInteractionPhase('settling');
      settleFrameRef.current = requestAnimationFrame(() => {
        settleFrameRef.current = null;
        setInteractionPhase('idle');
      });
    }, INTERACTION_SETTLE_MS);
  }, [clearInteractionSettle, effectiveMode]);

  useEffect(() => {
    pendingView2dRef.current = view2d;
  }, [view2d]);

  useEffect(
    () => () => {
      if (view2dFrameRef.current != null) {
        cancelAnimationFrame(view2dFrameRef.current);
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
    pendingView2dRef.current = reset;
    setView2d(reset);
    clearInteractionSettle();
    setInteractionPhase('idle');
  }, [clearInteractionSettle]);

  const reset3dView = useCallback(() => {
    setCamera3d(createDefaultMap3DCamera(scene3d));
  }, [scene3d]);

  useEffect(() => {
    if (!onSnapshotChange) return;
    onSnapshotChange({
      view2d,
      camera3d,
      activeTool,
      inverseFromInput,
      inverseToInput,
      anglePivotInput,
      angleFromInput,
      angleToInput,
      showTransformedCoordinates,
      showLabels,
      hideMinorGeometry,
      focusSelection,
    });
  }, [
    activeTool,
    angleFromInput,
    anglePivotInput,
    angleToInput,
    camera3d,
    focusSelection,
    hideMinorGeometry,
    inverseFromInput,
    inverseToInput,
    onSnapshotChange,
    showLabels,
    showTransformedCoordinates,
    view2d,
  ]);

  useEffect(() => {
    if (effectiveMode === '3d') {
      clearInteractionSettle();
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
    bbox.minX,
    bbox.minY,
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

  const stopDrag = useCallback(() => {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    dragRef.current.mode = 'none';
    planningVertexDragRef.current = null;
    setIsDragging(false);
  }, []);

  const updatePlanningPolygonVertices = useCallback(
    (polygonId: string, polygonSource: 'user' | 'osm', vertices: Array<{ x: number; y: number }>) => {
      if (!onPlanningMapChange) return;
      const update = (polygons: PlanningMapState['blockedPolygons']) =>
        polygons.map((polygon) =>
          polygon.id === polygonId
            ? { ...polygon, vertices: vertices.map((vertex) => ({ ...vertex })) }
            : polygon,
        );
      onPlanningMapChange({
        ...planningMap,
        blockedPolygons:
          polygonSource === 'user' ? update(planningMap.blockedPolygons) : planningMap.blockedPolygons,
        obstaclePolygons:
          polygonSource === 'osm' ? update(planningMap.obstaclePolygons) : planningMap.obstaclePolygons,
      });
    },
    [onPlanningMapChange, planningMap],
  );

  const removePlanningPolygon = useCallback(
    (polygonId: string, polygonSource: 'user' | 'osm') => {
      if (!onPlanningMapChange) return;
      onPlanningMapChange({
        ...planningMap,
        blockedPolygons:
          polygonSource === 'user'
            ? planningMap.blockedPolygons.filter((polygon) => polygon.id !== polygonId)
            : planningMap.blockedPolygons,
        obstaclePolygons:
          polygonSource === 'osm'
            ? planningMap.obstaclePolygons.filter((polygon) => polygon.id !== polygonId)
            : planningMap.obstaclePolygons,
      });
      setSelectedPlanningPolygonId((current) => (current === polygonId ? null : current));
      setContextMenu((current) => ({ ...current, open: false, planningPolygon: null }));
    },
    [onPlanningMapChange, planningMap],
  );

  const handleDragMoveClient = useCallback(
    (clientX: number, clientY: number) => {
      if (!dragRef.current.active) return;
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
      if (dragRef.current.mode === 'pan2d') {
        markInteracting();
        queueView2dUpdate((prev) => ({ ...prev, panX: prev.panX + dx, panY: prev.panY + dy }));
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
      camera3d?.distance,
      markInteracting,
      planningMap.blockedPolygons,
      planningMap.obstaclePolygons,
      queueView2dUpdate,
      updatePlanningPolygonVertices,
    ],
  );

  useEffect(() => {
    if (!isDragging) return;
    const onMouseMove = (event: MouseEvent) => {
      handleDragMoveClient(event.clientX, event.clientY);
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
  }, [handleDragMoveClient, isDragging, stopDrag]);

  const handleWheel = (event: React.WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
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
    markInteracting();
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
      const start = toSvgCoords(clientX, clientY);
      if (!start) return;
      dragRef.current = { active: true, mode: modeName, lastX: start.x, lastY: start.y };
      setIsDragging(true);
    },
    [toSvgCoords],
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

  const bracePreviewPoints2d = useMemo(
    () =>
      (result.preanalysisImpactDiagnostics?.scenarioPreviewPoints ?? [])
        .map((point) => {
          const projected = project2d(point.x, point.y);
          return {
            stationId: point.stationId,
            scenarioId: point.stationId,
            templateLabel: point.stationId,
            x: projected.x,
            y: projected.y,
            active: point.active,
          };
        })
        .sort(
          (left, right) =>
            Number(right.active) - Number(left.active) ||
            left.stationId.localeCompare(right.stationId, undefined, { numeric: true }),
        ),
    [project2d, result.preanalysisImpactDiagnostics?.scenarioPreviewPoints],
  );

  const scenarioPreviewSegments2d = useMemo(
    () =>
      (result.preanalysisImpactDiagnostics?.scenarioPreviewSegments ?? [])
        .map((segment) => {
          const fromStation = stations[segment.fromStationId];
          const toStation =
            stations[segment.toStationId] ??
            result.preanalysisImpactDiagnostics?.scenarioPreviewPoints.find(
              (point) => point.stationId === segment.toStationId,
            );
          if (!fromStation || !toStation) return null;
          const fromProjected = project2d(fromStation.x, fromStation.y);
          const toProjected = project2d(toStation.x, toStation.y);
          return {
            scenarioId: `${segment.fromStationId}-${segment.toStationId}`,
            fromStationId: segment.fromStationId,
            toStationId: segment.toStationId,
            x1: fromProjected.x,
            y1: fromProjected.y,
            x2: toProjected.x,
            y2: toProjected.y,
            kind: segment.kind,
            active: segment.active,
          };
        })
        .filter((segment): segment is NonNullable<typeof segment> => segment != null),
    [
      project2d,
      result.preanalysisImpactDiagnostics?.scenarioPreviewPoints,
      result.preanalysisImpactDiagnostics?.scenarioPreviewSegments,
      stations,
    ],
  );

  const planningInputPoints2d = useMemo(
    () =>
      planningMap.showInputPoints
        ? (result.parseState?.inputStationSnapshots ?? [])
            .map((point) => {
              const projected = project2d(point.x, point.y);
              return { stationId: point.stationId, x: projected.x, y: projected.y };
            })
            .sort((left, right) =>
              left.stationId.localeCompare(right.stationId, undefined, { numeric: true }),
            )
        : [],
    [planningMap.showInputPoints, project2d, result.parseState?.inputStationSnapshots],
  );

  const observedStationIdsForPlanning = useMemo(() => {
    const ids = new Set<string>();
    observations.forEach((observation) => {
      if ('from' in observation && typeof observation.from === 'string') {
        ids.add(observation.from);
      }
      if ('to' in observation && typeof observation.to === 'string') {
        ids.add(observation.to);
      }
      if ('at' in observation && typeof observation.at === 'string') {
        ids.add(observation.at);
      }
    });
    return ids;
  }, [observations]);

  const planningExtentPoints = useMemo(() => {
    const snapshots = result.parseState?.inputStationSnapshots ?? [];
    const filtered =
      observedStationIdsForPlanning.size > 0
        ? snapshots.filter((snapshot) => observedStationIdsForPlanning.has(snapshot.stationId))
        : snapshots;
    const source =
      filtered.length > 0
        ? filtered
        : snapshots.length > 0
          ? snapshots
          : Object.entries(stations).map(([stationId, station]) => ({
              stationId,
              x: station.x,
              y: station.y,
              h: station.h,
              coordInputClass: station.coordInputClass ?? 'unknown',
              constraintModeX: station.constraintModeX,
              constraintModeY: station.constraintModeY,
              constraintModeH: station.constraintModeH,
            }));
    return source.filter(
      (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
    );
  }, [observedStationIdsForPlanning, result.parseState?.inputStationSnapshots, stations]);

  const planningPolygons2d = useMemo(
    () =>
      [
        ...(planningMap.showObstacleLayer ? planningMap.obstaclePolygons : []),
        ...(planningMap.showBlockedAreas ? planningMap.blockedPolygons : []),
        ...(draftBlockedPolygon.length >= 2
          ? [
              {
                id: 'draft-blocked-polygon',
                source: 'user' as const,
                kind: 'blocked-area' as const,
                label: 'Draft blocked area',
                vertices: draftBlockedPolygon,
              },
            ]
          : []),
      ].map((polygon) => ({
        id: polygon.id,
        source: polygon.source,
        kind: polygon.kind,
        label: polygon.label,
        vertices: polygon.vertices.map((vertex) => project2d(vertex.x, vertex.y)),
        pointsAttr: polygon.vertices
          .map((vertex) => {
            const projected = project2d(vertex.x, vertex.y);
            return `${projected.x},${projected.y}`;
          })
          .join(' '),
      })),
    [
      planningMap.blockedPolygons,
      draftBlockedPolygon,
      planningMap.obstaclePolygons,
      planningMap.showBlockedAreas,
      planningMap.showObstacleLayer,
      project2d,
    ],
  );

  const planningGeorefContext = useMemo(() => {
    const parseState = result.parseState;
    if (!parseState) return null;
    const fallbackPoint =
      planningExtentPoints.length > 0
        ? planningExtentPoints[Math.floor(planningExtentPoints.length / 2)]!
        : { x: bbox.minX + bbox.width * 0.5, y: bbox.minY + bbox.height * 0.5 };
    const inverse = inverseENToGeodetic({
      east: fallbackPoint.x,
      north: fallbackPoint.y,
      originLatDeg: parseState.originLatDeg,
      originLonDeg: parseState.originLonDeg,
      model: parseState.crsProjectionModel ?? 'legacy-equirectangular',
      coordSystemMode: parseState.coordSystemMode,
      crsId: parseState.crsId,
    });
    if ('failureReason' in inverse) return null;
    return {
      originLatDeg: parseState.originLatDeg ?? inverse.latDeg,
      originLonDeg: parseState.originLonDeg ?? inverse.lonDeg,
      model: parseState.crsProjectionModel ?? 'legacy-equirectangular',
      coordSystemMode: parseState.coordSystemMode,
      crsId: parseState.crsId,
    };
  }, [bbox.height, bbox.minX, bbox.minY, bbox.width, planningExtentPoints, result.parseState]);

  const planningFetchExtent = useMemo(() => {
    if (planningExtentPoints.length === 0) return null;
    const xs = planningExtentPoints.map((point) => point.x);
    const ys = planningExtentPoints.map((point) => point.y);
    return {
      minX: Math.min(...xs) - OSM_FETCH_BUFFER_M,
      maxX: Math.max(...xs) + OSM_FETCH_BUFFER_M,
      minY: Math.min(...ys) - OSM_FETCH_BUFFER_M,
      maxY: Math.max(...ys) + OSM_FETCH_BUFFER_M,
    };
  }, [planningExtentPoints]);

  const basemapTiles2d = useMemo<BasemapTile2d[]>(() => {
    if (
      effectiveMode !== '2d' ||
      planningMap.basemapMode !== 'osm' ||
      planningGeorefContext == null
    ) {
      return [];
    }
    const viewportCorners = [
      svgToMapCoords(0, 0),
      svgToMapCoords(VIEW_W, 0),
      svgToMapCoords(0, VIEW_H),
      svgToMapCoords(VIEW_W, VIEW_H),
    ];
    const geodeticCorners = viewportCorners
      .map((corner) =>
        inverseENToGeodetic({
          east: corner.x,
          north: corner.y,
          ...planningGeorefContext,
        }),
      )
      .filter(
        (corner): corner is { latDeg: number; lonDeg: number } => !('failureReason' in corner),
      );
    if (geodeticCorners.length !== 4) return [];
    const lats = geodeticCorners.map((corner) => corner.latDeg);
    const lons = geodeticCorners.map((corner) => corner.lonDeg);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);
    const centerLat = (minLat + maxLat) * 0.5;
    const metersPerPixelX =
      Math.abs(
        svgToMapCoords(OSM_TILE_SIZE_PX, VIEW_H * 0.5).x - svgToMapCoords(0, VIEW_H * 0.5).x,
      ) / OSM_TILE_SIZE_PX;
    if (!(metersPerPixelX > 0)) return [];
    const tileMetersAtZoom0 =
      156543.03392804097 * Math.cos((clampLatitudeForTiles(centerLat) * Math.PI) / 180);
    let zoom = Math.round(
      Math.log2(Math.max(1e-9, tileMetersAtZoom0) / Math.max(1e-9, metersPerPixelX)),
    );
    if (!Number.isFinite(zoom)) zoom = 18;
    zoom = clamp(zoom, OSM_MIN_ZOOM, OSM_MAX_ZOOM);
    const tileCount = 2 ** zoom;
    const minTileX = Math.floor(longitudeToTileX(minLon, zoom));
    const maxTileX = Math.floor(longitudeToTileX(maxLon, zoom));
    const minTileY = Math.floor(latitudeToTileY(maxLat, zoom));
    const maxTileY = Math.floor(latitudeToTileY(minLat, zoom));
    const tiles: BasemapTile2d[] = [];
    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
        const wrappedTileX = ((tileX % tileCount) + tileCount) % tileCount;
        if (tileY < 0 || tileY >= tileCount) continue;
        const westLon = tileXToLongitude(tileX, zoom);
        const eastLon = tileXToLongitude(tileX + 1, zoom);
        const northLat = tileYToLatitude(tileY, zoom);
        const southLat = tileYToLatitude(tileY + 1, zoom);
        const northWest = projectGeodeticToEN({
          latDeg: northLat,
          lonDeg: westLon,
          originLatDeg: planningGeorefContext.originLatDeg,
          originLonDeg: planningGeorefContext.originLonDeg,
          model: planningGeorefContext.model,
          coordSystemMode: planningGeorefContext.coordSystemMode,
          crsId: planningGeorefContext.crsId,
        });
        const southEast = projectGeodeticToEN({
          latDeg: southLat,
          lonDeg: eastLon,
          originLatDeg: planningGeorefContext.originLatDeg,
          originLonDeg: planningGeorefContext.originLonDeg,
          model: planningGeorefContext.model,
          coordSystemMode: planningGeorefContext.coordSystemMode,
          crsId: planningGeorefContext.crsId,
        });
        const southEastScreen = project2d(southEast.east, southEast.north);
        const northWestScreen = project2d(northWest.east, northWest.north);
        if (
          !Number.isFinite(northWestScreen.x) ||
          !Number.isFinite(northWestScreen.y) ||
          !Number.isFinite(southEastScreen.x) ||
          !Number.isFinite(southEastScreen.y)
        ) {
          continue;
        }
        const tileWidthPx = Math.abs(southEastScreen.x - northWestScreen.x) * view2d.zoom;
        const tileHeightPx = Math.abs(southEastScreen.y - northWestScreen.y) * view2d.zoom;
        const meshColumns = chooseOsmTileMeshDivisions(tileWidthPx, tileHeightPx);
        const meshRows = meshColumns;
        const meshPoints: Array<{ x: number; y: number }> = [];
        let meshValid = true;
        for (let row = 0; row <= meshRows; row += 1) {
          const tileSampleY = tileY + row / meshRows;
          const sampleLat = tileYToLatitude(tileSampleY, zoom);
          for (let column = 0; column <= meshColumns; column += 1) {
            const tileSampleX = tileX + column / meshColumns;
            const sampleLon = tileXToLongitude(tileSampleX, zoom);
            const sampleProjected = projectGeodeticToEN({
              latDeg: sampleLat,
              lonDeg: sampleLon,
              originLatDeg: planningGeorefContext.originLatDeg,
              originLonDeg: planningGeorefContext.originLonDeg,
              model: planningGeorefContext.model,
              coordSystemMode: planningGeorefContext.coordSystemMode,
              crsId: planningGeorefContext.crsId,
            });
            const sampleScreen = project2d(sampleProjected.east, sampleProjected.north);
            if (!Number.isFinite(sampleScreen.x) || !Number.isFinite(sampleScreen.y)) {
              meshValid = false;
              break;
            }
            meshPoints.push({ x: sampleScreen.x, y: sampleScreen.y });
          }
          if (!meshValid) break;
        }
        if (!meshValid || meshPoints.length !== (meshColumns + 1) * (meshRows + 1)) continue;
        tiles.push({
          key: `${zoom}-${wrappedTileX}-${tileY}`,
          href: `https://tile.openstreetmap.org/${zoom}/${wrappedTileX}/${tileY}.png`,
          meshColumns,
          meshRows,
          meshPoints,
        });
      }
    }
    return tiles;
  }, [
    effectiveMode,
    planningGeorefContext,
    planningMap.basemapMode,
    project2d,
    svgToMapCoords,
    view2d.zoom,
  ]);

  useEffect(() => {
    if (effectiveMode !== '2d' || basemapTiles2d.length === 0 || typeof Image === 'undefined') return;
    let disposed = false;
    basemapTiles2d.forEach((tile) => {
      if (basemapImages.has(tile.href) || basemapLoadingRef.current.has(tile.href)) return;
      basemapLoadingRef.current.add(tile.href);
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => {
        basemapLoadingRef.current.delete(tile.href);
        if (disposed) return;
        setBasemapImages((current) => {
          if (current.get(tile.href) === image) return current;
          const next = new Map(current);
          next.set(tile.href, image);
          return next;
        });
      };
      image.onerror = () => {
        basemapLoadingRef.current.delete(tile.href);
      };
      image.src = tile.href;
    });
    return () => {
      disposed = true;
    };
  }, [basemapImages, basemapTiles2d, effectiveMode]);

  const canvasBasemapTiles2d = useMemo<CanvasBasemapTile2d[]>(
    () =>
      basemapTiles2d.map((tile) => {
        return {
          key: tile.key,
          image: basemapImages.get(tile.href) ?? null,
          meshColumns: tile.meshColumns,
          meshRows: tile.meshRows,
          meshPoints: tile.meshPoints,
        };
      }),
    [basemapImages, basemapTiles2d],
  );

  useEffect(() => {
    if (
      effectiveMode !== '2d' ||
      !planningGeorefContext ||
      !planningFetchExtent ||
      !planningMap.showObstacleLayer ||
      planningMap.obstaclePolygons.length > 0 ||
      !onPlanningMapChange
    ) {
      return;
    }
    const cornerA = inverseENToGeodetic({
      east: planningFetchExtent.minX,
      north: planningFetchExtent.minY,
      ...planningGeorefContext,
    });
    const cornerB = inverseENToGeodetic({
      east: planningFetchExtent.maxX,
      north: planningFetchExtent.maxY,
      ...planningGeorefContext,
    });
    if ('failureReason' in cornerA || 'failureReason' in cornerB) return;
    const minLat = Math.min(cornerA.latDeg, cornerB.latDeg);
    const maxLat = Math.max(cornerA.latDeg, cornerB.latDeg);
    const minLon = Math.min(cornerA.lonDeg, cornerB.lonDeg);
    const maxLon = Math.max(cornerA.lonDeg, cornerB.lonDeg);
    const controller = new AbortController();
    const query = `[out:json][timeout:20];(way["building"](${minLat},${minLon},${maxLat},${maxLon});way["landuse"="forest"](${minLat},${minLon},${maxLat},${maxLon});way["natural"="wood"](${minLat},${minLon},${maxLat},${maxLon});relation["building"](${minLat},${minLon},${maxLat},${maxLon}););out geom;`;
    void fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: query,
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((json) => {
        if (!json || !Array.isArray(json.elements)) return;
        const polygons = (json.elements as OverpassElement[])
          .map((element) => {
            const geometry = Array.isArray(element.geometry) ? element.geometry : [];
            const vertices = geometry
              .map((vertex) => {
                if (
                  typeof vertex?.lat !== 'number' ||
                  !Number.isFinite(vertex.lat) ||
                  typeof vertex?.lon !== 'number' ||
                  !Number.isFinite(vertex.lon)
                ) {
                  return null;
                }
                const projected = projectGeodeticToEN({
                  latDeg: vertex.lat,
                  lonDeg: vertex.lon,
                  originLatDeg: planningGeorefContext.originLatDeg,
                  originLonDeg: planningGeorefContext.originLonDeg,
                  model: planningGeorefContext.model,
                  coordSystemMode: planningGeorefContext.coordSystemMode,
                  crsId: planningGeorefContext.crsId,
                });
                return { x: projected.east, y: projected.north };
              })
              .filter((vertex: { x: number; y: number } | null): vertex is { x: number; y: number } => vertex != null);
            if (vertices.length < 3) return null;
            const isWooded =
              element.tags?.landuse === 'forest' || element.tags?.natural === 'wood';
            return {
              id: `osm-${String(element.id ?? createStableRuntimeId('osm'))}`,
              source: 'osm' as const,
              kind: isWooded ? ('wooded' as const) : ('building' as const),
              label: isWooded ? 'OSM wooded' : 'OSM building',
              vertices,
            };
          })
          .filter(
            (polygon): polygon is NonNullable<typeof polygon> => polygon != null,
          );
        if (polygons.length === 0) return;
        onPlanningMapChange({
          ...planningMap,
          obstaclePolygons: polygons,
        });
      })
      .catch(() => undefined);
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

  const viewportBounds2d = useMemo<ViewportBounds>(
    () => buildViewportBounds(VIEW_W, VIEW_H, VIEWPORT_CLIP_MARGIN_PX),
    [],
  );

  const mapState2d = useMemo(
    () =>
      buildDerivedMapState2d({
        mapLinks,
        stations,
        showLostStations,
        points,
        projectPoint: project2d,
        view2d,
        selectedObservationId,
        selectedObservationPairKey,
        selectedStationId,
        viewportBounds: viewportBounds2d,
        interactionPhaseInteracting:
          effectiveMode === '2d' && interactionPhase === 'interacting',
        interactionDensePointThreshold: INTERACTION_DENSE_POINT_THRESHOLD,
        interactionDenseLineThreshold: INTERACTION_DENSE_LINE_THRESHOLD,
        showLabels,
        hideMinorGeometry,
        focusSelection,
        pointThreshold: DENSE_LABEL_POINT_THRESHOLD,
        edgeThreshold: DENSE_LABEL_EDGE_THRESHOLD,
        labelGridPx: LABEL_GRID_PX,
        scorePriority: (point) =>
          scoreMapStationPriority({
            stationId: point.id,
            selectedStationId,
            severity: stationSeverity(point.id),
            fixed: point.fixed,
          }),
      }),
    [
      effectiveMode,
      focusSelection,
      hideMinorGeometry,
      interactionPhase,
      mapLinks,
      points,
      project2d,
      selectedObservationId,
      selectedObservationPairKey,
      selectedStationId,
      showLabels,
      showLostStations,
      stationSeverity,
      stations,
      view2d,
      viewportBounds2d,
    ],
  );

  const {
    filteredVisibleMapLines2d,
    filteredVisiblePoints2d,
    interactionDenseMode,
    mapDensitySummary,
    unselectedCanvasLines2d,
    visiblePointLabels2d,
  } = mapState2d;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || effectiveMode !== '2d') return;
    const isJsdom =
      typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string'
        ? /jsdom/i.test(navigator.userAgent)
        : false;
    const allowJsdomCanvas =
      typeof globalThis !== 'undefined' &&
      (globalThis as { __WEBNET_ENABLE_CANVAS_RENDER_TEST__?: boolean })
        .__WEBNET_ENABLE_CANVAS_RENDER_TEST__ === true;
    if (isJsdom && !allowJsdomCanvas) return;
    renderMapCanvas2d({
      canvas,
      interactionPhase,
      viewWidth: VIEW_W,
      viewHeight: VIEW_H,
      view2d,
      originalGeometryOpacity,
      lineWidth2d,
      pointRadius2d,
      ellipseStroke2d,
      projectionScale: projection2d.scale,
      units,
      interactionDenseMode,
      basemapTiles2d: canvasBasemapTiles2d,
      unselectedCanvasLines2d,
      filteredVisiblePoints2d,
      ellipseStroke,
      stationFill,
    });
  }, [
    effectiveMode,
    ellipseStroke,
    ellipseStroke2d,
    filteredVisiblePoints2d,
    interactionDenseMode,
    interactionPhase,
    lineWidth2d,
    originalGeometryOpacity,
    pointRadius2d,
    projection2d.scale,
    stationFill,
    units,
    unselectedCanvasLines2d,
    view2d,
    canvasBasemapTiles2d,
  ]);

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

  const inverseFromId = resolveStationId(inverseFromInput);
  const inverseToId = resolveStationId(inverseToInput);
  const anglePivotId = resolveStationId(anglePivotInput);
  const angleFromId = resolveStationId(angleFromInput);
  const angleToId = resolveStationId(angleToInput);

  const { inverse, angleBetween } = useMemo(
    () =>
      buildMapToolMetrics({
        stations,
        inverseFromId,
        inverseToId,
        anglePivotId,
        angleFromId,
        angleToId,
      }),
    [angleFromId, anglePivotId, angleToId, inverseFromId, inverseToId, stations],
  );

  const openContextMenu = (event: React.MouseEvent<SVGSVGElement>) => {
    event.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const target = event.target as HTMLElement | null;
    const polygonNode = target?.closest('[data-planning-polygon-id]') as HTMLElement | null;
    const polygonId = polygonNode?.getAttribute('data-planning-polygon-id') ?? null;
    const polygonSource = polygonNode?.getAttribute('data-planning-polygon-source');
    const polygonLabel = polygonNode?.getAttribute('data-planning-polygon-label') ?? 'Planning obstacle';
    if (polygonId) {
      setSelectedPlanningPolygonId(polygonId);
    }
    const menuWidth = 210;
    const menuHeight = polygonId ? 198 : 126;
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;
    const x = clamp(localX, 8, Math.max(8, rect.width - menuWidth - 8));
    const y = clamp(localY, 8, Math.max(8, rect.height - menuHeight - 8));
    setContextMenu({
      open: true,
      x,
      y,
      planningPolygon:
        polygonId && (polygonSource === 'user' || polygonSource === 'osm')
          ? {
              polygonId,
              polygonSource,
              polygonLabel,
            }
          : null,
    });
  };

  const openTool = (tool: Exclude<MapToolPanel, 'none'>) => {
    setActiveTool(tool);
    setContextMenu((prev) => ({ ...prev, open: false, planningPolygon: null }));
  };

  const closeTool = () => setActiveTool('none');

  const handleEditPlanningPolygon = useCallback(() => {
    const polygon = contextMenu.planningPolygon;
    if (!polygon) return;
    setSelectedPlanningPolygonId(polygon.polygonId);
    setContextMenu((current) => ({ ...current, open: false, planningPolygon: null }));
  }, [contextMenu.planningPolygon]);

  const handleDeletePlanningPolygon = useCallback(() => {
    const polygon = contextMenu.planningPolygon;
    if (!polygon) return;
    removePlanningPolygon(polygon.polygonId, polygon.polygonSource);
  }, [contextMenu.planningPolygon, removePlanningPolygon]);

  const handlePlanningVertexMouseDown = useCallback(
    (polygonId: string, vertexIndex: number, event: React.MouseEvent<SVGCircleElement>) => {
      const polygonSource = planningMap.obstaclePolygons.some((polygon) => polygon.id === polygonId)
        ? ('osm' as const)
        : ('user' as const);
      planningVertexDragRef.current = { polygonId, polygonSource, vertexIndex };
      setSelectedPlanningPolygonId(polygonId);
      beginDrag('planning-vertex', event.clientX, event.clientY);
      event.preventDefault();
      event.stopPropagation();
    },
    [beginDrag, planningMap.obstaclePolygons],
  );

  const handleSvgClick = (event: React.MouseEvent<SVGSVGElement>) => {
    if (effectiveMode !== '2d') return;
    const target = event.target as HTMLElement | null;
    const polygonId = target?.closest('[data-planning-polygon-id]')?.getAttribute('data-planning-polygon-id');
    if (polygonId) {
      setSelectedPlanningPolygonId(polygonId);
      return;
    }
    if (target?.closest('[data-map-observation],[data-map-station]')) return;
    const pointer = toSvgCoords(event.clientX, event.clientY);
    if (!pointer) return;
    if (planningMap.blockEditMode) {
      setDraftBlockedPolygon((current) => [...current, svgToMapCoords(pointer.x, pointer.y)]);
      return;
    }
    let nearestPointId: string | null = null;
    let nearestPointDistance = Number.POSITIVE_INFINITY;
    filteredVisiblePoints2d.forEach((point) => {
      const distance = Math.hypot(pointer.x - point.screenX, pointer.y - point.screenY);
      if (distance <= POINT_HIT_RADIUS_PX && distance < nearestPointDistance) {
        nearestPointDistance = distance;
        nearestPointId = point.id;
      }
    });
    if (nearestPointId) {
      onSelectStation?.(nearestPointId);
      return;
    }
    let nearestLineObservationId: number | null = null;
    let nearestLineDistance = Number.POSITIVE_INFINITY;
    filteredVisibleMapLines2d.forEach((line) => {
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
      onSelectObservation?.(nearestLineObservationId);
    }
  };

  const commitDraftBlockedPolygon = useCallback(() => {
    if (!onPlanningMapChange || draftBlockedPolygon.length < 3) return;
    onPlanningMapChange({
      ...planningMap,
      blockedPolygons: [
        ...planningMap.blockedPolygons,
        {
          id: createStableRuntimeId('block'),
          source: 'user',
          kind: 'blocked-area',
          label: `Blocked area ${planningMap.blockedPolygons.length + 1}`,
          vertices: draftBlockedPolygon.map((vertex) => ({ ...vertex })),
        },
      ],
      blockEditMode: false,
    });
    setDraftBlockedPolygon([]);
  }, [draftBlockedPolygon, onPlanningMapChange, planningMap]);

  const clearDraftBlockedPolygon = useCallback(() => {
    setDraftBlockedPolygon([]);
  }, []);

  useEffect(() => {
    if (!selectedPlanningPolygonId) return;
    const stillExists =
      planningMap.blockedPolygons.some((polygon) => polygon.id === selectedPlanningPolygonId) ||
      planningMap.obstaclePolygons.some((polygon) => polygon.id === selectedPlanningPolygonId);
    if (!stillExists) {
      setSelectedPlanningPolygonId(null);
      planningVertexDragRef.current = null;
    }
  }, [planningMap.blockedPolygons, planningMap.obstaclePolygons, selectedPlanningPolygonId]);

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
        className="bg-slate-900 border border-slate-800 rounded overflow-hidden flex-1 min-h-0 relative"
      >
        {effectiveMode === '2d' && (
          <canvas
            ref={canvasRef}
            data-testid="map-base-canvas"
            className="absolute inset-0 h-full w-full pointer-events-none"
          />
        )}
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
          <div ref={contextMenuRef}>
            <MapViewContextMenu
              x={contextMenu.x}
              y={contextMenu.y}
              onOpenTool={openTool}
              planningPolygonLabel={contextMenu.planningPolygon?.polygonLabel ?? null}
              onEditPlanningPolygon={
                contextMenu.planningPolygon != null ? handleEditPlanningPolygon : null
              }
              onDeletePlanningPolygon={
                contextMenu.planningPolygon != null ? handleDeletePlanningPolygon : null
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
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="none"
          shapeRendering={interactionPhase === 'interacting' ? 'optimizeSpeed' : 'geometricPrecision'}
          className={`w-full h-full select-none ${isDragging ? 'cursor-grabbing' : effectiveMode === '3d' ? 'cursor-grab' : 'cursor-default'}`}
          onWheel={handleWheel}
          onClick={handleSvgClick}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onMouseLeave={stopDrag}
          onContextMenu={openContextMenu}
        >
          {effectiveMode === '2d' && (
            <MapViewSvg2d
              marker2d={marker2d}
              view2d={view2d}
              originalGeometryOpacity={originalGeometryOpacity}
              filteredVisiblePoints2d={filteredVisiblePoints2d}
              visiblePointLabels2d={visiblePointLabels2d}
              labelOffset2d={labelOffset2d}
              labelFont2d={labelFont2d}
              labelStroke2d={labelStroke2d}
              filteredVisibleMapLines2d={filteredVisibleMapLines2d}
              selectedObservationId={selectedObservationId}
              selectedObservationPairKey={selectedObservationPairKey}
              lineWidth2d={lineWidth2d}
              onSelectObservation={onSelectObservation}
              selectedStationId={selectedStationId}
              pointRadius2d={pointRadius2d}
              transformedOverlayActive={transformedOverlayActive}
              transformedLines2d={transformedLines2d}
              transformedPoints2d={transformedPoints2d}
              planningInputPoints2d={planningInputPoints2d}
              planningPolygons2d={planningPolygons2d}
              selectedPlanningPolygonId={selectedPlanningPolygonId}
              bracePreviewPoints2d={bracePreviewPoints2d}
              scenarioPreviewSegments2d={scenarioPreviewSegments2d}
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
    </div>
  );
};

export default MapView;
