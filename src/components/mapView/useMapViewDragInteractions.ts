import {
  useCallback,
  useEffect,
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type MutableRefObject,
  type SetStateAction,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { createDefaultMap3DCamera, type Map3DCamera } from '../../engine/map3d';
import { clamp } from './mapView2d';
import { noteMapViewPerfCounter } from './mapViewPerf';
import type { ScreenSelectionBox } from './mapViewInteraction';
import type { DragMode } from './MapView.types';
import {
  MAX_ZOOM,
  MIDDLE_DBLCLICK_MS,
  MIN_ZOOM,
} from './mapViewConstants';

type View2dState = { zoom: number; panX: number; panY: number };
type DragRef = MutableRefObject<{ active: boolean; mode: DragMode; lastX: number; lastY: number }>;
type Point2d = { x: number; y: number };

interface UseMapViewDragInteractionsArgs {
  applyPanPreviewOffset: (_offsetX: number, _offsetY: number) => void;
  camera3d: Map3DCamera | null;
  dragMoveFrameRef: MutableRefObject<number | null>;
  dragRef: DragRef;
  effectiveMode: '2d' | '3d';
  isDragging: boolean;
  markInteracting: (_kind: 'pan' | 'wheel') => void;
  middleClickRef: MutableRefObject<number>;
  panPreviewCommitViewRef: MutableRefObject<View2dState | null>;
  panPreviewOffsetRef: MutableRefObject<Point2d>;
  pendingDragClientRef: MutableRefObject<Point2d | null>;
  pendingView2dRef: MutableRefObject<View2dState>;
  planningMap: {
    blockedPolygons: Array<{ id: string; vertices: Point2d[] }>;
    obstaclePolygons: Array<{ id: string; vertices: Point2d[] }>;
  };
  planningVertexDragRef: MutableRefObject<{
    polygonId: string;
    polygonSource: 'user' | 'osm';
    vertexIndex: number;
  } | null>;
  queueView2dUpdate: (_updater: (_current: View2dState) => View2dState) => void;
  reset2dView: () => void;
  reset3dView: () => void;
  scene3d: Parameters<typeof createDefaultMap3DCamera>[0];
  selectionBox: ScreenSelectionBox | null;
  setCamera3d: Dispatch<SetStateAction<Map3DCamera | null>>;
  setFrozenDerivedView2d: Dispatch<SetStateAction<View2dState | null>>;
  setIsDragging: (_value: boolean) => void;
  setSelectionBox: Dispatch<SetStateAction<ScreenSelectionBox | null>>;
  setView2d: Dispatch<SetStateAction<View2dState>>;
  svgToMapCoords: (_screenX: number, _screenY: number) => Point2d;
  toSvgCoords: (_clientX: number, _clientY: number) => Point2d | null;
  updatePlanningPolygonVertices: (
    _polygonId: string,
    _polygonSource: 'user' | 'osm',
    _vertices: Point2d[],
  ) => void;
}

export const useMapViewDragInteractions = ({
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
}: UseMapViewDragInteractionsArgs) => {
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
  }, [
    applyPanPreviewOffset,
    dragMoveFrameRef,
    dragRef,
    panPreviewCommitViewRef,
    panPreviewOffsetRef,
    pendingDragClientRef,
    pendingView2dRef,
    planningVertexDragRef,
    setFrozenDerivedView2d,
    setIsDragging,
    setView2d,
  ]);

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
        setCamera3d((prev) =>
          prev
            ? {
                ...prev,
                yawDeg: prev.yawDeg + dx * 0.22,
                pitchDeg: clamp(prev.pitchDeg - dy * 0.22, -89, 89),
              }
            : prev,
        );
        return;
      }
      if (dragRef.current.mode === 'pan3d') {
        const panScale = Math.max(0.2, (camera3d?.distance ?? 10) * 0.0025);
        setCamera3d((prev) =>
          prev
            ? {
                ...prev,
                panX: prev.panX - dx * panScale,
                panY: prev.panY + dy * panScale,
              }
            : prev,
        );
      }
    },
    [
      applyPanPreviewOffset,
      camera3d?.distance,
      dragRef,
      effectiveMode,
      markInteracting,
      panPreviewOffsetRef,
      planningMap.blockedPolygons,
      planningMap.obstaclePolygons,
      planningVertexDragRef,
      setCamera3d,
      svgToMapCoords,
      toSvgCoords,
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
    [dragMoveFrameRef, handleDragMoveClient, pendingDragClientRef],
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
        current == null ? current : { ...current, currentX: pointer.x, currentY: pointer.y },
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
  }, [dragRef, isDragging, scheduleDragMoveClient, selectionBox, setSelectionBox, stopDrag, toSvgCoords]);

  const handleWheel = (event: ReactWheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    noteMapViewPerfCounter('map:wheel-events');
    if (effectiveMode === '3d') {
      setCamera3d((prev) => {
        if (!prev) return prev;
        const factor = Math.exp(event.deltaY * 0.0015);
        return {
          ...prev,
          distance: clamp(prev.distance * factor, 0.6, Math.max(50000, scene3d.extents.radius * 80)),
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
      return {
        zoom: nextZoom,
        panX: anchor.x - (anchor.x - prev.panX) * ratio,
        panY: anchor.y - (anchor.y - prev.panY) * ratio,
      };
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
    [
      applyPanPreviewOffset,
      dragRef,
      panPreviewCommitViewRef,
      panPreviewOffsetRef,
      pendingView2dRef,
      setFrozenDerivedView2d,
      setIsDragging,
      toSvgCoords,
    ],
  );

  const handleMouseDown = (event: ReactMouseEvent<SVGSVGElement>) => {
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

  const handleMouseUp = (event: ReactMouseEvent<SVGSVGElement>) => {
    if (event.button === 0 || event.button === 1) stopDrag();
  };

  return {
    beginDrag,
    handleMouseDown,
    handleMouseUp,
    handleWheel,
    stopDrag,
  };
};
