import {
  useCallback,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
import {
  createDefaultMap3DCamera,
  type Map3DCamera,
  type Map3DScene,
} from '../../engine/map3d';
import { view2dEquals } from './mapView2d';
import { noteMapViewPerfCounter } from './mapViewPerf';
import type { MapInteractionKind, MapInteractionPhase } from './mapViewInteraction';
import type { DragMode, MapViewSnapshot } from './MapView.types';
import { INTERACTION_SETTLE_MS, OSM_IDLE_PREFETCH_DELAY_MS } from './mapViewConstants';

type View2dState = { zoom: number; panX: number; panY: number };
type BboxLike = { width: number; height: number };

interface UseMapViewViewportStateArgs {
  bbox: BboxLike;
  containerRef: MutableRefObject<HTMLDivElement | null>;
  effectiveMode: '2d' | '3d';
  planningBasemapMode: 'none' | 'osm';
  renderSurfaceRef: MutableRefObject<HTMLDivElement | null>;
  scene3d: Map3DScene;
  snapshot: MapViewSnapshot | null;
}

export const useMapViewViewportState = ({
  bbox,
  containerRef,
  effectiveMode,
  planningBasemapMode,
  renderSurfaceRef,
  scene3d,
  snapshot,
}: UseMapViewViewportStateArgs) => {
  const interactionKindRef = useRef<MapInteractionKind>('none');
  const [basemapDescriptorView2d, setBasemapDescriptorView2d] = useState(
    () => snapshot?.view2d ?? { zoom: 1, panX: 0, panY: 0 },
  );
  const [idlePrefetchReady, setIdlePrefetchReady] = useState(false);
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
  const [frozenDerivedView2d, setFrozenDerivedView2d] = useState<View2dState | null>(null);
  const pendingView2dRef = useRef(view2d);
  const view2dFrameRef = useRef<number | null>(null);
  const dragMoveFrameRef = useRef<number | null>(null);
  const pendingDragClientRef = useRef<{ x: number; y: number } | null>(null);
  const panPreviewOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const panPreviewCommitViewRef = useRef<View2dState | null>(null);
  const settleTimerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const settleFrameRef = useRef<number | null>(null);
  const [interactionPhase, setInteractionPhase] = useState<MapInteractionPhase>('idle');
  const interactionPhaseRef = useRef<MapInteractionPhase>('idle');
  const [camera3d, setCamera3d] = useState<Map3DCamera | null>(() => snapshot?.camera3d ?? null);
  const [isDragging, setIsDragging] = useState(false);
  const skipNextAutoResetRef = useRef(snapshot != null);

  const derivedView2d = frozenDerivedView2d ?? deferredView2d;

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
  }, [containerRef, renderSurfaceRef]);

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
    (updater: (_current: View2dState) => View2dState) => {
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
    if (effectiveMode !== '2d' || planningBasemapMode !== 'osm') {
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
  }, [effectiveMode, interactionPhase, planningBasemapMode]);

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
    bbox,
    bbox.height,
    bbox.width,
    clearInteractionSettle,
    effectiveMode,
    reset2dView,
    reset3dView,
  ]);

  return {
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
  };
};
