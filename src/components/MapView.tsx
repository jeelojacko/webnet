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
  buildBaseProjectedMapLines2d,
  buildBaseProjectedPoints2d,
  buildConnectedStationIds2d,
  buildFilteredVisibleMapLines2d,
  buildFilteredVisiblePoints2d,
  buildMapDensitySummary,
  buildProjectedViewportBounds,
  buildProjectedMapLines2d,
  buildProjectedPoints2d,
  buildProjection2d,
  buildUnselectedCanvasLines2d,
  buildVisiblePointLabels2d,
  buildVisibleBaseProjectedMapLines2d,
  buildVisibleBaseProjectedPoints2d,
  buildViewportBounds,
  clamp,
  pointToSegmentDistancePx,
  projectPoint2d,
  type ProjectedMapLine2D,
  type ProjectedPoint2D,
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
import {
  renderBasemapCanvas2d,
  renderGeometryCanvas2d,
  renderPlanningOverlayCanvas2d,
} from './mapView/mapViewCanvas2d';
import { chooseOsmTileMeshDivisions } from './mapView/mapViewBasemap';
import { buildMapViewHitIndex } from './mapView/mapViewHitIndex';
import {
  MapViewTileStore,
  type BasemapTileDescriptor2d,
  type BasemapTileRenderSurface2d,
} from './mapView/mapViewTileStore';
import { MapViewWebgl2d } from './mapView/mapViewWebgl2d';
import { buildMapViewWebglScene2d } from './mapView/mapViewWebglBuffers';
import {
  measureMapViewPerf,
  noteMapViewPerfCounter,
  noteMapViewPerfMetadata,
} from './mapView/mapViewPerf';
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
const OSM_VISIBLE_TILE_BUFFER = 1;
const OSM_INTERACTION_TILE_BUFFER = 2;
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
  onSelectStation?: (_stationId: string | null) => void;
  onSelectObservation?: (_observationId: number | null) => void;
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
type PlanningPolygonTarget = {
  polygonId: string;
  polygonSource: 'user' | 'osm';
  polygonLabel: string;
};
type ScreenSelectionBox = {
  anchorX: number;
  anchorY: number;
  currentX: number;
  currentY: number;
};

type SelectionBoxMode = 'window' | 'crossing';

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

const isPointInsideRect = (
  point: { x: number; y: number },
  rect: { left: number; right: number; top: number; bottom: number },
): boolean =>
  point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;

const segmentsIntersect = (
  a1: { x: number; y: number },
  a2: { x: number; y: number },
  b1: { x: number; y: number },
  b2: { x: number; y: number },
): boolean => {
  const cross = (
    origin: { x: number; y: number },
    p1: { x: number; y: number },
    p2: { x: number; y: number },
  ) => (p1.x - origin.x) * (p2.y - origin.y) - (p1.y - origin.y) * (p2.x - origin.x);
  const onSegment = (
    start: { x: number; y: number },
    point: { x: number; y: number },
    end: { x: number; y: number },
  ) =>
    point.x >= Math.min(start.x, end.x) &&
    point.x <= Math.max(start.x, end.x) &&
    point.y >= Math.min(start.y, end.y) &&
    point.y <= Math.max(start.y, end.y);

  const d1 = cross(a1, a2, b1);
  const d2 = cross(a1, a2, b2);
  const d3 = cross(b1, b2, a1);
  const d4 = cross(b1, b2, a2);

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  if (d1 === 0 && onSegment(a1, b1, a2)) return true;
  if (d2 === 0 && onSegment(a1, b2, a2)) return true;
  if (d3 === 0 && onSegment(b1, a1, b2)) return true;
  if (d4 === 0 && onSegment(b1, a2, b2)) return true;
  return false;
};

const isPointInsidePolygon = (
  point: { x: number; y: number },
  polygon: Array<{ x: number; y: number }>,
): boolean => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    const intersects =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / ((b.y - a.y) || Number.EPSILON) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
};

const doesPolygonTouchRect = (
  polygon: Array<{ x: number; y: number }>,
  rect: { left: number; right: number; top: number; bottom: number },
): boolean => {
  if (polygon.some((vertex) => isPointInsideRect(vertex, rect))) return true;
  const rectCorners = [
    { x: rect.left, y: rect.top },
    { x: rect.right, y: rect.top },
    { x: rect.right, y: rect.bottom },
    { x: rect.left, y: rect.bottom },
  ];
  if (rectCorners.some((corner) => isPointInsidePolygon(corner, polygon))) return true;
  const rectEdges = [
    [rectCorners[0]!, rectCorners[1]!],
    [rectCorners[1]!, rectCorners[2]!],
    [rectCorners[2]!, rectCorners[3]!],
    [rectCorners[3]!, rectCorners[0]!],
  ] as const;
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index]!;
    const end = polygon[(index + 1) % polygon.length]!;
    if (rectEdges.some(([edgeStart, edgeEnd]) => segmentsIntersect(start, end, edgeStart, edgeEnd))) {
      return true;
    }
  }
  return false;
};

const isPolygonInsideRect = (
  polygon: Array<{ x: number; y: number }>,
  rect: { left: number; right: number; top: number; bottom: number },
): boolean => polygon.every((vertex) => isPointInsideRect(vertex, rect));

const canRenderCanvasLayers = (): boolean => {
  const isJsdom =
    typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string'
      ? /jsdom/i.test(navigator.userAgent)
      : false;
  const allowJsdomCanvas =
    typeof globalThis !== 'undefined' &&
    (globalThis as { __WEBNET_ENABLE_CANVAS_RENDER_TEST__?: boolean })
      .__WEBNET_ENABLE_CANVAS_RENDER_TEST__ === true;
  return !isJsdom || allowJsdomCanvas;
};

const canRenderWebglLayers = (): boolean => {
  if (typeof document === 'undefined' || typeof HTMLCanvasElement === 'undefined') return false;
  const isJsdom =
    typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string'
      ? /jsdom/i.test(navigator.userAgent)
      : false;
  const allowJsdomWebgl =
    typeof globalThis !== 'undefined' &&
    (globalThis as { __WEBNET_ENABLE_WEBGL_RENDER_TEST__?: boolean })
      .__WEBNET_ENABLE_WEBGL_RENDER_TEST__ === true;
  return !isJsdom || allowJsdomWebgl;
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
  const renderRequestFrameRef = useRef<number | null>(null);
  const renderDirtyRef = useRef({ basemap: false, geometry: false, planning: false });
  const [renderer2d, setRenderer2d] = useState<'canvas' | 'webgl'>(() =>
    canRenderWebglLayers() ? 'webgl' : 'canvas',
  );
  const latestBasemapRenderInputRef = useRef<{
    interactionPhase: MapInteractionPhase;
    view2d: { zoom: number; panX: number; panY: number };
    projectionScale: number;
    tiles: BasemapTileRenderSurface2d[];
  } | null>(null);
  const latestGeometryRenderInputRef = useRef<{
    interactionPhase: MapInteractionPhase;
    view2d: { zoom: number; panX: number; panY: number };
    originalGeometryOpacity: number;
    lineWidth2d: number;
    pointRadius2d: number;
    ellipseStroke2d: number;
    projectionScale: number;
    units: 'm' | 'ft';
    interactionDenseMode: boolean;
    unselectedCanvasLines2d: ProjectedMapLine2D[];
    filteredVisiblePoints2d: ProjectedPoint2D[];
      ellipseStroke: (_stationId: string) => string;
      stationFill: (_stationId: string, _fixed: boolean) => string;
  } | null>(null);
  const latestPlanningRenderInputRef = useRef<{
    interactionPhase: MapInteractionPhase;
    view2d: { zoom: number; panX: number; panY: number };
    pointRadius2d: number;
    planningInputPoints2d: Array<{ stationId: string; x: number; y: number }>;
    planningPolygons2d: Array<{
      id: string;
      source: 'user' | 'osm';
      kind: 'blocked-area' | 'building' | 'wooded';
      label: string;
      vertices: Array<{ x: number; y: number }>;
    }>;
    selectedPlanningPolygonIds: string[];
  } | null>(null);
  const latestWebglRenderInputRef = useRef<{
    interactionPhase: MapInteractionPhase;
    viewWidth: number;
    viewHeight: number;
    view2d: { zoom: number; panX: number; panY: number };
    tiles: BasemapTileRenderSurface2d[];
    surveyLineWidth: number;
    previewLineWidth: number;
    ellipseLineWidth: number;
    surveyLines: ReturnType<typeof buildMapViewWebglScene2d>['surveyLines'];
    previewLines: ReturnType<typeof buildMapViewWebglScene2d>['previewLines'];
    ellipseLines: ReturnType<typeof buildMapViewWebglScene2d>['ellipseLines'];
    surveyPoints: ReturnType<typeof buildMapViewWebglScene2d>['surveyPoints'];
    previewPoints: ReturnType<typeof buildMapViewWebglScene2d>['previewPoints'];
  } | null>(null);
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
  const stableSnapshotView2dRef = useRef(snapshot?.view2d ?? { zoom: 1, panX: 0, panY: 0 });
  const lastEmittedSnapshotRef = useRef<MapViewSnapshot | null>(null);
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
  const [selectedPlanningPolygonIds, setSelectedPlanningPolygonIds] = useState<string[]>([]);
  const [selectionBox, setSelectionBox] = useState<ScreenSelectionBox | null>(null);
  const skipNextAutoResetRef = useRef(snapshot != null);
  const planningVertexDragRef = useRef<{
    polygonId: string;
    polygonSource: 'user' | 'osm';
    vertexIndex: number;
  } | null>(null);
  const [viewportWidth, setViewportWidth] = useState<number>(
    typeof window !== 'undefined' ? window.innerWidth : 1280,
  );
  const selectedPlanningPolygonId =
    selectedPlanningPolygonIds.length === 1 ? selectedPlanningPolygonIds[0] ?? null : null;

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

  const renderLayersNow = useCallback(
    (dirty: { basemap?: boolean; geometry?: boolean; planning?: boolean }) => {
      if (effectiveMode !== '2d') return;
      noteMapViewPerfCounter('map:render-layer-now-calls');
      const shouldRenderPlanning = dirty.planning === true;
      if (renderer2d === 'webgl') {
        const webglInput = latestWebglRenderInputRef.current;
        const webglRenderer = webglRendererRef.current;
        if (!webglInput || !webglRenderer.isReady()) return;
        noteMapViewPerfCounter('map:render-webgl-path');
        webglRenderer.markDirty({ basemap: dirty.basemap, geometry: dirty.geometry });
        const rendered = webglRenderer.render(webglInput);
        if (!rendered) {
          fallbackFromWebgl();
          return;
        }
        webglInput.tiles.forEach((tile) => {
          tileStoreRef.current.markUploaded(tile.key);
        });
      } else {
        if (!canRenderCanvasLayers()) return;
        noteMapViewPerfCounter('map:render-canvas-path');
        if (dirty.basemap) {
          const basemapInput = latestBasemapRenderInputRef.current;
          const basemapCanvas = basemapCanvasRef.current;
          if (basemapInput && basemapCanvas) {
            renderBasemapCanvas2d({
              canvas: basemapCanvas,
              interactionPhase: basemapInput.interactionPhase,
              viewWidth: VIEW_W,
              viewHeight: VIEW_H,
              view2d: basemapInput.view2d,
              projectionScale: basemapInput.projectionScale,
              units,
              basemapTiles2d: basemapInput.tiles,
            });
          }
        }
        if (dirty.geometry) {
          const geometryInput = latestGeometryRenderInputRef.current;
          const geometryCanvas = geometryCanvasRef.current;
          if (geometryInput && geometryCanvas) {
            renderGeometryCanvas2d({
              canvas: geometryCanvas,
              interactionPhase: geometryInput.interactionPhase,
              viewWidth: VIEW_W,
              viewHeight: VIEW_H,
              view2d: geometryInput.view2d,
              originalGeometryOpacity: geometryInput.originalGeometryOpacity,
              lineWidth2d: geometryInput.lineWidth2d,
              pointRadius2d: geometryInput.pointRadius2d,
              ellipseStroke2d: geometryInput.ellipseStroke2d,
              projectionScale: geometryInput.projectionScale,
              units: geometryInput.units,
              interactionDenseMode: geometryInput.interactionDenseMode,
              unselectedCanvasLines2d: geometryInput.unselectedCanvasLines2d,
              filteredVisiblePoints2d: geometryInput.filteredVisiblePoints2d,
              ellipseStroke: geometryInput.ellipseStroke,
              stationFill: geometryInput.stationFill,
            });
          }
        }
      }
      if (shouldRenderPlanning) {
        if (renderer2d === 'canvas' && !canRenderCanvasLayers()) return;
        noteMapViewPerfCounter('map:render-planning-overlay');
        const planningInput = latestPlanningRenderInputRef.current;
        const planningCanvas = planningCanvasRef.current;
        if (planningInput && planningCanvas) {
          renderPlanningOverlayCanvas2d({
            canvas: planningCanvas,
            interactionPhase: planningInput.interactionPhase,
            viewWidth: VIEW_W,
            viewHeight: VIEW_H,
            view2d: planningInput.view2d,
            projectionScale: 1,
            units,
            pointRadius2d: planningInput.pointRadius2d,
            planningInputPoints2d: planningInput.planningInputPoints2d,
            planningPolygons2d: planningInput.planningPolygons2d,
            selectedPlanningPolygonIds: planningInput.selectedPlanningPolygonIds,
          });
        }
      }
    },
    [effectiveMode, fallbackFromWebgl, renderer2d, units],
  );

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

  const scheduleLayerRender = useCallback(
    (dirty: { basemap?: boolean; geometry?: boolean; planning?: boolean }) => {
      if (effectiveMode !== '2d') return;
      if (renderer2d === 'canvas' && !canRenderCanvasLayers()) return;
      noteMapViewPerfCounter('map:schedule-layer-render');
      if (dirty.basemap) renderDirtyRef.current.basemap = true;
      if (dirty.geometry) renderDirtyRef.current.geometry = true;
      if (dirty.planning) renderDirtyRef.current.planning = true;
      if (renderRequestFrameRef.current != null) return;
      renderRequestFrameRef.current = requestAnimationFrame(() => {
        renderRequestFrameRef.current = null;
        const dirtyNow = renderDirtyRef.current;
        renderDirtyRef.current = { basemap: false, geometry: false, planning: false };
        renderLayersNow(dirtyNow);
      });
    },
    [effectiveMode, renderLayersNow, renderer2d],
  );

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

  useEffect(() => {
    if (effectiveMode !== '2d' || interactionPhase !== 'idle') return;
    stableSnapshotView2dRef.current = view2d;
  }, [effectiveMode, interactionPhase, view2d]);

  useEffect(
    () => () => {
      if (view2dFrameRef.current != null) {
        cancelAnimationFrame(view2dFrameRef.current);
      }
      if (dragMoveFrameRef.current != null) {
        cancelAnimationFrame(dragMoveFrameRef.current);
      }
      if (renderRequestFrameRef.current != null) {
        cancelAnimationFrame(renderRequestFrameRef.current);
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
    setFrozenDerivedView2d(null);
    clearInteractionSettle();
    setInteractionPhase('idle');
  }, [applyPanPreviewOffset, clearInteractionSettle]);

  const reset3dView = useCallback(() => {
    setCamera3d(createDefaultMap3DCamera(scene3d));
  }, [scene3d]);

  useEffect(() => {
    if (!onSnapshotChange) return;
    const nextSnapshot: MapViewSnapshot = {
      view2d: effectiveMode === '2d' ? stableSnapshotView2dRef.current : view2d,
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
    };
    const previousSnapshot = lastEmittedSnapshotRef.current;
    const snapshotUnchanged =
      previousSnapshot != null &&
      view2dEquals(previousSnapshot.view2d, nextSnapshot.view2d) &&
      previousSnapshot.camera3d === nextSnapshot.camera3d &&
      previousSnapshot.activeTool === nextSnapshot.activeTool &&
      previousSnapshot.inverseFromInput === nextSnapshot.inverseFromInput &&
      previousSnapshot.inverseToInput === nextSnapshot.inverseToInput &&
      previousSnapshot.anglePivotInput === nextSnapshot.anglePivotInput &&
      previousSnapshot.angleFromInput === nextSnapshot.angleFromInput &&
      previousSnapshot.angleToInput === nextSnapshot.angleToInput &&
      previousSnapshot.showTransformedCoordinates === nextSnapshot.showTransformedCoordinates &&
      previousSnapshot.showLabels === nextSnapshot.showLabels &&
      previousSnapshot.hideMinorGeometry === nextSnapshot.hideMinorGeometry &&
      previousSnapshot.focusSelection === nextSnapshot.focusSelection;
    if (snapshotUnchanged) return;
    lastEmittedSnapshotRef.current = nextSnapshot;
    onSnapshotChange(nextSnapshot);
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
    interactionPhase,
    onSnapshotChange,
    effectiveMode,
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

  const clearMapSelection = useCallback(() => {
    onSelectStation?.(null);
    onSelectObservation?.(null);
    setSelectedPlanningPolygonIds([]);
    setSelectionBox(null);
    planningVertexDragRef.current = null;
  }, [onSelectObservation, onSelectStation]);

  const clearMapSelectionBox = useCallback(() => {
    setSelectionBox(null);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setContextMenu((prev) => ({ ...prev, open: false, planningPolygon: null }));
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
    selectedObservationId,
    selectedPlanningPolygonIds.length,
    selectedStationId,
    selectionBox,
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
  }, [applyPanPreviewOffset]);

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
      setSelectedPlanningPolygonIds((current) => current.filter((id) => id !== polygonId));
      setContextMenu((current) => ({ ...current, open: false, planningPolygon: null }));
    },
    [onPlanningMapChange, planningMap],
  );

  const removeSelectedPlanningPolygons = useCallback(() => {
    if (!onPlanningMapChange || selectedPlanningPolygonIds.length === 0) return;
    const selectedIds = new Set(selectedPlanningPolygonIds);
    onPlanningMapChange({
      ...planningMap,
      blockedPolygons: planningMap.blockedPolygons.filter((polygon) => !selectedIds.has(polygon.id)),
      obstaclePolygons: planningMap.obstaclePolygons.filter((polygon) => !selectedIds.has(polygon.id)),
    });
    setSelectedPlanningPolygonIds([]);
    setContextMenu((current) => ({ ...current, open: false, planningPolygon: null }));
  }, [onPlanningMapChange, planningMap, selectedPlanningPolygonIds]);

  const handleDragMoveClient = useCallback(
    (clientX: number, clientY: number) => {
      if (!dragRef.current.active) return;
      noteMapViewPerfCounter(`map:drag-move:${dragRef.current.mode}`);
      if (dragRef.current.mode === 'pan2d') {
        const dx = clientX - dragRef.current.lastX;
        const dy = clientY - dragRef.current.lastY;
        dragRef.current.lastX = clientX;
        dragRef.current.lastY = clientY;
        markInteracting();
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

  const findPlanningPolygonAtSvgPoint = useCallback(
    (svgPoint: { x: number; y: number }) => {
      const projectedPoint = {
        x: (svgPoint.x - view2d.panX) / Math.max(view2d.zoom, 1e-9),
        y: (svgPoint.y - view2d.panY) / Math.max(view2d.zoom, 1e-9),
      };
      for (let index = planningPolygons2d.length - 1; index >= 0; index -= 1) {
        const polygon = planningPolygons2d[index]!;
        if (polygon.id === 'draft-blocked-polygon' || polygon.vertices.length < 3) continue;
        if (isPointInsidePolygon(projectedPoint, polygon.vertices)) {
          return {
            polygonId: polygon.id,
            polygonSource: polygon.source,
            polygonLabel: polygon.label || polygon.kind,
          };
        }
      }
      return null;
    },
    [planningPolygons2d, view2d.panX, view2d.panY, view2d.zoom],
  );

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
    [onSelectObservation, onSelectStation, planningPolygons2d, view2d.panX, view2d.panY, view2d.zoom],
  );

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

  const basemapTiles2d = useMemo<BasemapTileDescriptor2d[]>(() => {
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
    const tileBuffer =
      interactionPhase === 'interacting' ? OSM_INTERACTION_TILE_BUFFER : OSM_VISIBLE_TILE_BUFFER;
    const minTileX = Math.floor(longitudeToTileX(minLon, zoom)) - tileBuffer;
    const maxTileX = Math.floor(longitudeToTileX(maxLon, zoom)) + tileBuffer;
    const minTileY = Math.floor(latitudeToTileY(maxLat, zoom)) - tileBuffer;
    const maxTileY = Math.floor(latitudeToTileY(minLat, zoom)) + tileBuffer;
    const centerTileX = (minTileX + maxTileX) * 0.5;
    const centerTileY = (minTileY + maxTileY) * 0.5;
    const tiles: BasemapTileDescriptor2d[] = [];
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
        const meshColumns = chooseOsmTileMeshDivisions(
          tileWidthPx,
          tileHeightPx,
          interactionPhase === 'interacting',
        );
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
          zoom,
          tileX: wrappedTileX,
          tileY,
          meshColumns,
          meshRows,
          meshPoints,
        });
      }
    }
    return tiles.sort((left, right) => {
      const [leftZoom, leftX, leftY] = left.key.split('-').map(Number);
      const [rightZoom, rightX, rightY] = right.key.split('-').map(Number);
      const zoomDelta = (rightZoom ?? zoom) - (leftZoom ?? zoom);
      if (zoomDelta !== 0) return zoomDelta;
      const leftDistance = Math.hypot((leftX ?? 0) - centerTileX, (leftY ?? 0) - centerTileY);
      const rightDistance = Math.hypot((rightX ?? 0) - centerTileX, (rightY ?? 0) - centerTileY);
      return leftDistance - rightDistance;
    });
  }, [
    effectiveMode,
    interactionPhase,
    planningGeorefContext,
    planningMap.basemapMode,
    project2d,
    svgToMapCoords,
    view2d.zoom,
  ]);

  useLayoutEffect(() => {
    const tileStore = tileStoreRef.current;
    tileStore.markAllEvictable();
    noteMapViewPerfCounter('tiles:mark-all-evictable');
    if (effectiveMode !== '2d' || basemapTiles2d.length === 0) {
      latestBasemapRenderInputRef.current = {
        interactionPhase,
        view2d,
        projectionScale: projection2d.scale,
        tiles: [],
      };
      latestWebglRenderInputRef.current = {
        interactionPhase,
        viewWidth: VIEW_W,
        viewHeight: VIEW_H,
        view2d,
        tiles: [],
        surveyLineWidth: latestWebglRenderInputRef.current?.surveyLineWidth ?? 0,
        previewLineWidth: latestWebglRenderInputRef.current?.previewLineWidth ?? 0,
        ellipseLineWidth: latestWebglRenderInputRef.current?.ellipseLineWidth ?? 0,
        surveyLines: latestWebglRenderInputRef.current?.surveyLines ?? [],
        previewLines: latestWebglRenderInputRef.current?.previewLines ?? [],
        ellipseLines: latestWebglRenderInputRef.current?.ellipseLines ?? [],
        surveyPoints: latestWebglRenderInputRef.current?.surveyPoints ?? [],
        previewPoints: latestWebglRenderInputRef.current?.previewPoints ?? [],
      };
      renderLayersNow({ basemap: true });
      return;
    }
    tileStore.requestTiles(
      basemapTiles2d,
      () => {
        const latest = latestBasemapRenderInputRef.current;
        if (!latest) return;
        latest.tiles = tileStore.resolveRenderTiles(basemapTiles2d);
        noteMapViewPerfMetadata('tiles:snapshot', tileStore.snapshotMetrics());
        noteMapViewPerfMetadata('tiles:last-resolved-count', latest.tiles.length);
        if (latestWebglRenderInputRef.current) {
          latestWebglRenderInputRef.current.tiles = latest.tiles;
        }
        scheduleLayerRender({ basemap: true });
      },
      renderer2d === 'webgl' ? { crossOrigin: 'anonymous' } : undefined,
    );
    const resolvedTiles = tileStore.resolveRenderTiles(basemapTiles2d);
    noteMapViewPerfMetadata('tiles:snapshot', tileStore.snapshotMetrics());
    noteMapViewPerfMetadata('tiles:last-resolved-count', resolvedTiles.length);
    latestBasemapRenderInputRef.current = {
      interactionPhase,
      view2d,
      projectionScale: projection2d.scale,
      tiles: resolvedTiles,
    };
    latestWebglRenderInputRef.current = {
      interactionPhase,
      viewWidth: VIEW_W,
      viewHeight: VIEW_H,
      view2d,
      tiles: resolvedTiles,
      surveyLineWidth: latestWebglRenderInputRef.current?.surveyLineWidth ?? 0,
      previewLineWidth: latestWebglRenderInputRef.current?.previewLineWidth ?? 0,
      ellipseLineWidth: latestWebglRenderInputRef.current?.ellipseLineWidth ?? 0,
      surveyLines: latestWebglRenderInputRef.current?.surveyLines ?? [],
      previewLines: latestWebglRenderInputRef.current?.previewLines ?? [],
      ellipseLines: latestWebglRenderInputRef.current?.ellipseLines ?? [],
      surveyPoints: latestWebglRenderInputRef.current?.surveyPoints ?? [],
      previewPoints: latestWebglRenderInputRef.current?.previewPoints ?? [],
    };
    renderLayersNow({ basemap: true });
  }, [
    basemapTiles2d,
    effectiveMode,
    interactionPhase,
    projection2d.scale,
    renderLayersNow,
    renderer2d,
    scheduleLayerRender,
    view2d,
  ]);

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

  const baseProjectedMapLines2d = useMemo(
    () =>
      measureMapViewPerf('map:build-base-lines', () =>
        buildBaseProjectedMapLines2d({
          mapLinks,
          stations,
          showLostStations,
          projectPoint: project2d,
        }),
      ),
    [mapLinks, project2d, showLostStations, stations],
  );

  const baseProjectedPoints2d = useMemo(
    () =>
      measureMapViewPerf('map:build-base-points', () =>
        buildBaseProjectedPoints2d({
          points,
          projectPoint: project2d,
        }),
      ),
    [points, project2d],
  );

  const projectedViewportBounds2d = useMemo(
    () => buildProjectedViewportBounds(viewportBounds2d, derivedView2d),
    [derivedView2d, viewportBounds2d],
  );

  const visibleBaseProjectedMapLines2d = useMemo(
    () =>
      measureMapViewPerf('map:cull-base-lines', () =>
        buildVisibleBaseProjectedMapLines2d({
          baseProjectedMapLines2d,
          selectedObservationId,
          selectedObservationPairKey,
          projectedViewportBounds: projectedViewportBounds2d,
        }),
      ),
    [
      baseProjectedMapLines2d,
      projectedViewportBounds2d,
      selectedObservationId,
      selectedObservationPairKey,
    ],
  );

  const visibleBaseProjectedPoints2d = useMemo(
    () =>
      measureMapViewPerf('map:cull-base-points', () =>
        buildVisibleBaseProjectedPoints2d({
          baseProjectedPoints2d,
          selectedStationId,
          projectedViewportBounds: projectedViewportBounds2d,
          selectionMarginProjected: POINT_HIT_RADIUS_PX / Math.max(derivedView2d.zoom, 1e-9),
        }),
      ),
    [baseProjectedPoints2d, derivedView2d.zoom, projectedViewportBounds2d, selectedStationId],
  );

  const filteredVisibleBaseProjectedMapLines2d = useMemo(
    () =>
      measureMapViewPerf('map:filter-base-lines', () =>
        buildFilteredVisibleMapLines2d({
          visibleMapLines2d: visibleBaseProjectedMapLines2d,
          hideMinorGeometry,
          focusSelection,
          selectedObservationId,
          selectedObservationPairKey,
          selectedStationId,
        }),
      ),
    [
      focusSelection,
      hideMinorGeometry,
      selectedObservationId,
      selectedObservationPairKey,
      selectedStationId,
      visibleBaseProjectedMapLines2d,
    ],
  );

  const connectedStationIds2d = useMemo(
    () =>
      measureMapViewPerf('map:build-connected-stations', () =>
        buildConnectedStationIds2d({
          filteredVisibleMapLines2d: filteredVisibleBaseProjectedMapLines2d,
          focusSelection,
          selectedStationId,
        }),
      ),
    [filteredVisibleBaseProjectedMapLines2d, focusSelection, selectedStationId],
  );

  const filteredVisibleBaseProjectedPoints2d = useMemo(
    () =>
      measureMapViewPerf('map:filter-base-points', () =>
        buildFilteredVisiblePoints2d({
          visiblePoints2d: visibleBaseProjectedPoints2d,
          connectedStationIds: connectedStationIds2d,
        }),
      ),
    [connectedStationIds2d, visibleBaseProjectedPoints2d],
  );

  const projectedMapLines2d = useMemo(
    () =>
      measureMapViewPerf('map:apply-view-lines', () =>
        buildProjectedMapLines2d({
          baseProjectedMapLines2d: filteredVisibleBaseProjectedMapLines2d,
          view2d: derivedView2d,
        }),
      ),
    [derivedView2d, filteredVisibleBaseProjectedMapLines2d],
  );

  const projectedPoints2d = useMemo(
    () =>
      measureMapViewPerf('map:apply-view-points', () =>
        buildProjectedPoints2d({
          baseProjectedPoints2d: filteredVisibleBaseProjectedPoints2d,
          view2d: derivedView2d,
        }),
      ),
    [derivedView2d, filteredVisibleBaseProjectedPoints2d],
  );

  const interactionDenseMode = useMemo(
    () =>
      measureMapViewPerf('map:derive-interaction-density', () =>
        effectiveMode === '2d' &&
        interactionPhase === 'interacting' &&
        (projectedPoints2d.length > INTERACTION_DENSE_POINT_THRESHOLD ||
          projectedMapLines2d.length > INTERACTION_DENSE_LINE_THRESHOLD),
      ),
    [effectiveMode, interactionPhase, projectedMapLines2d.length, projectedPoints2d.length],
  );

  const visiblePointLabels2d = useMemo(
    () =>
      measureMapViewPerf('map:build-visible-labels', () =>
        buildVisiblePointLabels2d({
          showLabels,
          visiblePoints2d: projectedPoints2d,
          visibleMapLines2dLength: projectedMapLines2d.length,
          interactionDenseMode,
          selectedStationId,
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
      ),
    [
      interactionDenseMode,
      projectedMapLines2d.length,
      projectedPoints2d,
      selectedStationId,
      showLabels,
      stationSeverity,
    ],
  );

  const unselectedCanvasLines2d = useMemo(
    () =>
      measureMapViewPerf('map:build-unselected-lines', () =>
        buildUnselectedCanvasLines2d({
          filteredVisibleMapLines2d: projectedMapLines2d,
          interactionDenseMode,
          selectedObservationId,
          selectedObservationPairKey,
          selectedStationId,
        }),
      ),
    [
      interactionDenseMode,
      projectedMapLines2d,
      selectedObservationId,
      selectedObservationPairKey,
      selectedStationId,
    ],
  );

  const mapDensitySummary = useMemo(
    () =>
      measureMapViewPerf('map:build-density-summary', () =>
        buildMapDensitySummary({
          filteredVisibleMapLines2dLength: projectedMapLines2d.length,
          filteredVisiblePoints2dLength: projectedPoints2d.length,
          totalProjectedMapLines2dLength: baseProjectedMapLines2d.length,
          projectedMapLines2dLength: projectedMapLines2d.length,
          visiblePointLabels2dSize: visiblePointLabels2d.size,
          denseLabelEdgeThreshold: DENSE_LABEL_EDGE_THRESHOLD,
        }),
      ),
    [
      baseProjectedMapLines2d.length,
      projectedMapLines2d.length,
      projectedPoints2d.length,
      visiblePointLabels2d.size,
    ],
  );

  const filteredVisibleMapLines2d = projectedMapLines2d;
  const filteredVisiblePoints2d = projectedPoints2d;

  const webglScene2d = useMemo(
    () =>
      measureMapViewPerf('map:build-webgl-scene', () =>
        buildMapViewWebglScene2d({
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
          bracePreviewPoints2d,
          scenarioPreviewSegments2d,
        }),
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

  const openTool = (tool: Exclude<MapToolPanel, 'none'>) => {
    setActiveTool(tool);
    setContextMenu((prev) => ({ ...prev, open: false, planningPolygon: null }));
  };

  const closeTool = () => setActiveTool('none');

  const handleEditPlanningPolygon = useCallback(() => {
    const polygon = contextMenu.planningPolygon;
    if (!polygon) return;
    setSelectedPlanningPolygonIds([polygon.polygonId]);
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
      setSelectedPlanningPolygonIds([polygonId]);
      beginDrag('planning-vertex', event.clientX, event.clientY);
      event.preventDefault();
      event.stopPropagation();
    },
    [beginDrag, planningMap.obstaclePolygons],
  );

  const handleSvgClick = (event: React.MouseEvent<SVGSVGElement>) => {
    if (effectiveMode === '3d') {
      const target = event.target as HTMLElement | null;
      if (!target?.closest('[data-map-observation],[data-map-station]')) {
        clearMapSelection();
      }
      return;
    }
    const target = event.target as HTMLElement | null;
    const pointer = toSvgCoords(event.clientX, event.clientY);
    const polygonHit =
      pointer != null ? findPlanningPolygonAtSvgPoint(pointer) : null;
    if (polygonHit != null) {
      setSelectedPlanningPolygonIds([polygonHit.polygonId]);
      onSelectStation?.(null);
      onSelectObservation?.(null);
      setSelectionBox(null);
      return;
    }
    if (target?.closest('[data-map-observation],[data-map-station]')) return;
    if (!pointer) return;
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
    if (selectedPlanningPolygonIds.length === 0) return;
    const availableIds = new Set([
      ...planningMap.blockedPolygons.map((polygon) => polygon.id),
      ...planningMap.obstaclePolygons.map((polygon) => polygon.id),
    ]);
    setSelectedPlanningPolygonIds((current) => current.filter((id) => availableIds.has(id)));
    if (
      selectedPlanningPolygonId != null &&
      !availableIds.has(selectedPlanningPolygonId)
    ) {
      planningVertexDragRef.current = null;
    }
  }, [
    planningMap.blockedPolygons,
    planningMap.obstaclePolygons,
    selectedPlanningPolygonId,
    selectedPlanningPolygonIds.length,
  ]);

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
        className="bg-slate-900 border border-slate-800 rounded overflow-hidden flex-1 min-h-0 relative"
      >
        <div ref={renderSurfaceRef} className="absolute inset-0">
          {effectiveMode === '2d' && (
            <>
              {webglEligible && (
                <canvas
                  ref={webglCanvasRef}
                  data-testid="map-webgl-canvas"
                  className={`absolute inset-0 h-full w-full pointer-events-none ${
                    renderer2d === 'webgl' ? '' : 'hidden'
                  }`}
                />
              )}
              {renderer2d === 'canvas' && (
                <>
                  <canvas
                    ref={basemapCanvasRef}
                    data-testid="map-base-canvas"
                    className="absolute inset-0 h-full w-full pointer-events-none"
                  />
                  <canvas
                    ref={geometryCanvasRef}
                    data-testid="map-geometry-canvas"
                    className="absolute inset-0 h-full w-full pointer-events-none"
                  />
                </>
              )}
              <canvas
                ref={planningCanvasRef}
                data-testid="map-planning-canvas"
                className="absolute inset-0 h-full w-full pointer-events-none"
              />
            </>
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
                selectedPlanningPolygonIds={selectedPlanningPolygonIds}
                renderPlanningPolygonBodies={false}
                renderPlanningInputPoints={false}
                bracePreviewPoints2d={bracePreviewPoints2d}
                scenarioPreviewSegments2d={scenarioPreviewSegments2d}
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
          <div ref={contextMenuRef}>
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
                selectedPlanningPolygonIds.length > 1 ? removeSelectedPlanningPolygons : null
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
