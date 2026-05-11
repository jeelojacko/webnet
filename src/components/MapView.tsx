import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AdjustedPointsExportSettings, AdjustmentResult } from '../types';
import {
  buildMap3DScene,
  createDefaultMap3DCamera,
  type Map3DCamera,
  type Vec3,
} from '../engine/map3d';
import { RAD_TO_DEG } from '../engine/angles';
import { computeInverse2D, computePivotAngles } from '../engine/mapTools';
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
import MapViewSvg2d from './mapView/MapViewSvg2d';
import MapViewScene3d from './mapView/MapViewScene3d';
import MapViewContextMenu, { type MapToolPanel } from './mapView/MapViewContextMenu';
import MapViewToolOverlay from './mapView/MapViewToolOverlay';
import { renderMapCanvas2d } from './mapView/mapViewCanvas2d';
import {
  buildProjectedStationLookup3d,
  buildProjectedStations3d,
  buildVisiblePointLabels3d,
  projectPoint3d,
} from './mapView/mapView3d';

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

type DragMode = 'none' | 'pan2d' | 'orbit3d' | 'pan3d';

const MapView: React.FC<MapViewProps> = ({
  result,
  units,
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
  const [contextMenu, setContextMenu] = useState<{ open: boolean; x: number; y: number }>({
    open: false,
    x: 0,
    y: 0,
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

  const { points, bbox } = useMemo(() => {
    if (scene3d.stations.length === 0) {
      return {
        points: [],
        bbox: { minX: 0, minY: 0, width: 1, height: 1 },
      };
    }
    const xs = scene3d.stations.map((s) => s.position.x);
    const ys = scene3d.stations.map((s) => s.position.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const pad = Math.max((maxX - minX) * 0.1, (maxY - minY) * 0.1, 1);
    const width = maxX - minX + pad * 2;
    const height = maxY - minY + pad * 2;
    const pts = scene3d.stations.map((s) => ({
      id: s.id,
      x: s.position.x,
      y: s.position.y,
      h: s.position.z,
      fixed: s.fixed,
      ellipsoid: s.ellipsoid,
    }));
    return { points: pts, bbox: { minX: minX - pad, minY: minY - pad, width, height } };
  }, [scene3d]);

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
      setContextMenu((prev) => ({ ...prev, open: false }));
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setContextMenu((prev) => ({ ...prev, open: false }));
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

  const stopDrag = useCallback(() => {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    dragRef.current.mode = 'none';
    setIsDragging(false);
  }, []);

  const handleDragMoveClient = useCallback(
    (clientX: number, clientY: number) => {
      if (!dragRef.current.active) return;
      const next = toSvgCoords(clientX, clientY);
      if (!next) return;
      const dx = next.x - dragRef.current.lastX;
      const dy = next.y - dragRef.current.lastY;
      dragRef.current.lastX = next.x;
      dragRef.current.lastY = next.y;
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
    [toSvgCoords, effectiveMode, camera3d?.distance, markInteracting, queueView2dUpdate],
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

  const beginDrag = (modeName: DragMode, clientX: number, clientY: number) => {
    const start = toSvgCoords(clientX, clientY);
    if (!start) return;
    dragRef.current = { active: true, mode: modeName, lastX: start.x, lastY: start.y };
    setIsDragging(true);
  };

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

  const labelScale2d = Math.sqrt(view2d.zoom);
  const pointRadius2dPx = clamp(7 / labelScale2d, 1.6, 7);
  const lineWidth2dPx = clamp(1.2 / labelScale2d, 0.35, 1.2);
  const ellipseStroke2dPx = clamp(1 / labelScale2d, 0.35, 1);
  const labelFont2dPx = clamp(12 + Math.max(0, Math.log2(view2d.zoom)) * 3, 12, 26);
  const labelStroke2dPx = clamp(labelFont2dPx * 0.12, 1.2, 2.8);
  const labelOffset2dPx = clamp(labelFont2dPx * 0.85, 9, 22);
  const marker2dPx = clamp(6 / labelScale2d, 2.5, 6);
  const invZoom2d = 1 / view2d.zoom;
  const pointRadius2d = pointRadius2dPx * invZoom2d;
  const lineWidth2d = lineWidth2dPx * invZoom2d;
  const ellipseStroke2d = ellipseStroke2dPx * invZoom2d;
  const labelFont2d = labelFont2dPx * invZoom2d;
  const labelStroke2d = labelStroke2dPx * invZoom2d;
  const labelOffset2d = labelOffset2dPx * invZoom2d;
  const marker2d = marker2dPx * invZoom2d;
  const originalGeometryOpacity = transformedOverlayActive ? 0.25 : 1;

  const transformedLines2d = useMemo(() => {
    if (!transformedOverlayActive) return [] as Array<{ key: string; x1: number; y1: number; x2: number; y2: number }>;
    return observations
      .map((obs, idx) => {
        if (obs.type !== 'dist' && obs.type !== 'gps') return null;
        const fromStation = stations[obs.from];
        const toStation = stations[obs.to];
        if (!fromStation || !toStation) return null;
        if (!showLostStations && (fromStation.lost || toStation.lost)) return null;
        const from = transformedOverlayConfig.transformedByStationId.get(obs.from);
        const to = transformedOverlayConfig.transformedByStationId.get(obs.to);
        if (!from || !to) return null;
        return {
          key: `tx-line-${idx}`,
          x1: from.east,
          y1: from.north,
          x2: to.east,
          y2: to.north,
        };
      })
      .filter((line): line is { key: string; x1: number; y1: number; x2: number; y2: number } => line != null);
  }, [
    observations,
    showLostStations,
    stations,
    transformedOverlayActive,
    transformedOverlayConfig.transformedByStationId,
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
  ]);

  const transformedPoints2d = useMemo(() => {
    if (!transformedOverlayActive) {
      return [] as Array<{ id: string; x: number; y: number; fixed: boolean }>;
    }
    return points
      .map((point) => {
        const rotated = transformedOverlayConfig.transformedByStationId.get(point.id);
        if (!rotated) return null;
        return {
          id: point.id,
          x: rotated.east,
          y: rotated.north,
          fixed: point.fixed,
        };
      })
      .filter(
        (
          point,
        ): point is {
          id: string;
          x: number;
          y: number;
          fixed: boolean;
        } => point != null,
      );
  }, [points, transformedOverlayActive, transformedOverlayConfig.transformedByStationId]);

  const project3d = useCallback(
    (point: Vec3) => projectPoint3d(camera3d, point, VIEW_W, VIEW_H),
    [camera3d],
  );

  const projected3d = useMemo(() => {
    if (effectiveMode !== '3d' || !camera3d) return [];
    return buildProjectedStations3d(scene3d, camera3d, VIEW_W, VIEW_H);
  }, [camera3d, effectiveMode, scene3d]);

  const projected3dById = useMemo(() => {
    return buildProjectedStationLookup3d(projected3d);
  }, [projected3d]);

  const visiblePointLabels3d = useMemo(() => {
    return buildVisiblePointLabels3d(
      projected3d,
      selectedStationId,
      DENSE_LABEL_POINT_THRESHOLD,
      LABEL_GRID_PX,
    );
  }, [projected3d, selectedStationId]);

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

  const inverse = useMemo(() => {
    if (!inverseFromId || !inverseToId) return null;
    const from = stations[inverseFromId];
    const to = stations[inverseToId];
    if (!from || !to) return null;
    return computeInverse2D({ x: from.x, y: from.y }, { x: to.x, y: to.y });
  }, [inverseFromId, inverseToId, stations]);

  const angleBetween = useMemo(() => {
    if (!anglePivotId || !angleFromId || !angleToId) return null;
    const pivot = stations[anglePivotId];
    const from = stations[angleFromId];
    const to = stations[angleToId];
    if (!pivot || !from || !to) return null;
    return computePivotAngles(
      { x: pivot.x, y: pivot.y },
      { x: from.x, y: from.y },
      { x: to.x, y: to.y },
    );
  }, [angleFromId, anglePivotId, angleToId, stations]);

  const openContextMenu = (event: React.MouseEvent<SVGSVGElement>) => {
    event.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const menuWidth = 210;
    const menuHeight = 126;
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;
    const x = clamp(localX, 8, Math.max(8, rect.width - menuWidth - 8));
    const y = clamp(localY, 8, Math.max(8, rect.height - menuHeight - 8));
    setContextMenu({
      open: true,
      x,
      y,
    });
  };

  const openTool = (tool: Exclude<MapToolPanel, 'none'>) => {
    setActiveTool(tool);
    setContextMenu((prev) => ({ ...prev, open: false }));
  };

  const closeTool = () => setActiveTool('none');

  const handleSvgClick = (event: React.MouseEvent<SVGSVGElement>) => {
    if (effectiveMode !== '2d') return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-map-observation],[data-map-station]')) return;
    const pointer = toSvgCoords(event.clientX, event.clientY);
    if (!pointer) return;
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
            <MapViewContextMenu x={contextMenu.x} y={contextMenu.y} onOpenTool={openTool} />
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
            <text x={VIEW_W / 2} y={VIEW_H / 2} textAnchor="middle" fill="#94a3b8" fontSize={18}>
              No stations to display
            </text>
          )}
        </svg>
      </div>
    </div>
  );
};

export default MapView;
