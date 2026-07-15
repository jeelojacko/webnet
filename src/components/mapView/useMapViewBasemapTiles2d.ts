import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

import {
  buildBasemapTiles2dForBuffer,
  buildOsmDescriptorBucketForView,
  buildRequestedBasemapTiles,
  resolveInteractiveBasemapTiles,
} from './mapViewBasemap';
import { type MapInteractionPhase } from './mapViewInteraction';
import {
  buildWebglRenderInputWithTiles,
  type BasemapRenderInput,
  type LayerDirtyState,
  type WebglRenderInput,
} from './useMapViewLayerRenderer';
import { noteMapViewPerfCounter, noteMapViewPerfMetadata } from './mapViewPerf';
import type { BasemapTileDescriptor2d, MapViewTileStore } from './mapViewTileStore';
import type { MapBounds2d, Projection2d, View2dState } from './mapView2d';
import type { PlanningGeorefContext } from './mapViewObstacles';

interface UseMapViewBasemapTiles2dOptions {
  bbox: MapBounds2d;
  basemapDescriptorView2d: View2dState;
  dragRef: MutableRefObject<{ active: boolean; mode: string }>;
  effectiveMode: '2d' | '3d';
  idlePrefetchReady: boolean;
  idlePrefetchTileBuffer: number;
  idlePrefetchTileCountThreshold: number;
  interactionPhase: MapInteractionPhase;
  interactionTileBuffer: number;
  latestBasemapRenderInputRef: MutableRefObject<BasemapRenderInput | null>;
  latestWebglRenderInputRef: MutableRefObject<WebglRenderInput | null>;
  planningBasemapMode: 'none' | 'osm';
  planningGeorefContext: PlanningGeorefContext | null;
  projectPoint: (_x: number, _y: number) => { x: number; y: number };
  projection2d: Projection2d;
  renderLayersNow: (_dirty: LayerDirtyState) => void;
  renderer2d: 'canvas' | 'webgl';
  scheduleLayerRender: (_dirty: LayerDirtyState) => void;
  setBasemapDescriptorView2d: Dispatch<SetStateAction<View2dState>>;
  tileStoreRef: MutableRefObject<MapViewTileStore>;
  view2d: View2dState;
  viewHeight: number;
  viewWidth: number;
  visibleTileBuffer: number;
}

export const useMapViewBasemapTiles2d = (options: UseMapViewBasemapTiles2dOptions) => {
  const {
    bbox,
    basemapDescriptorView2d,
    dragRef,
    effectiveMode,
    idlePrefetchReady,
    idlePrefetchTileBuffer,
    idlePrefetchTileCountThreshold,
    interactionPhase,
    interactionTileBuffer,
    latestBasemapRenderInputRef,
    latestWebglRenderInputRef,
    planningBasemapMode,
    planningGeorefContext,
    projectPoint,
    projection2d,
    renderLayersNow,
    renderer2d,
    scheduleLayerRender,
    setBasemapDescriptorView2d,
    tileStoreRef,
    view2d,
    viewHeight,
    viewWidth,
    visibleTileBuffer,
  } = options;
  const basemapDescriptorBucketRef = useRef('');
  const stableBasemapTiles2dRef = useRef<BasemapTileDescriptor2d[]>([]);
  const stableBasemapTileSignatureRef = useRef('');
  const [stableBasemapTiles2dRender, setStableBasemapTiles2dRender] = useState<
    BasemapTileDescriptor2d[]
  >([]);
  const [stableBasemapTileSignatureRender, setStableBasemapTileSignatureRender] = useState('');
  useEffect(() => {
    if (effectiveMode !== '2d' || planningBasemapMode !== 'osm') {
      basemapDescriptorBucketRef.current = '';
      if (
        basemapDescriptorView2d.zoom !== view2d.zoom ||
        basemapDescriptorView2d.panX !== view2d.panX ||
        basemapDescriptorView2d.panY !== view2d.panY
      ) {
        setBasemapDescriptorView2d(view2d);
      }
      return;
    }
    if (planningGeorefContext == null) return;
    if (interactionPhase === 'idle') {
      basemapDescriptorBucketRef.current = '';
      if (
        basemapDescriptorView2d.zoom !== view2d.zoom ||
        basemapDescriptorView2d.panX !== view2d.panX ||
        basemapDescriptorView2d.panY !== view2d.panY
      ) {
        setBasemapDescriptorView2d(view2d);
      }
      return;
    }
    const bucket = buildOsmDescriptorBucketForView({
      bbox,
      descriptorView: view2d,
      interactionPhase,
      planningGeorefContext,
      projection: projection2d,
      viewHeight,
      viewWidth,
    });
    if (bucket == null) return;
    if (bucket.signature === basemapDescriptorBucketRef.current) return;
    basemapDescriptorBucketRef.current = bucket.signature;
    noteMapViewPerfCounter('tiles:descriptor-rebuilds');
    noteMapViewPerfMetadata('tiles:last-descriptor-bucket', bucket.signature);
    setBasemapDescriptorView2d(view2d);
  }, [
    basemapDescriptorView2d,
    bbox,
    effectiveMode,
    interactionPhase,
    planningBasemapMode,
    planningGeorefContext,
    projection2d,
    setBasemapDescriptorView2d,
    view2d,
    viewHeight,
    viewWidth,
  ]);

  const buildBasemapTiles2dForCurrentView = useCallback(
    (tileBuffer: number): BasemapTileDescriptor2d[] =>
      effectiveMode === '2d' && planningBasemapMode === 'osm' && planningGeorefContext != null
        ? buildBasemapTiles2dForBuffer({
            bbox,
            descriptorView: basemapDescriptorView2d,
            interactionPhase,
            planningGeorefContext,
            projectPoint,
            projection: projection2d,
            tileBuffer,
            viewHeight,
            viewWidth,
          })
        : [],
    [
      basemapDescriptorView2d,
      bbox,
      effectiveMode,
      interactionPhase,
      planningBasemapMode,
      planningGeorefContext,
      projectPoint,
      projection2d,
      viewHeight,
      viewWidth,
    ],
  );

  const basemapTiles2d = useMemo<BasemapTileDescriptor2d[]>(() => {
    if (effectiveMode !== '2d' || planningBasemapMode !== 'osm' || planningGeorefContext == null) {
      return [];
    }
    const tileBuffer =
      interactionPhase === 'interacting' ? interactionTileBuffer : visibleTileBuffer;
    return buildBasemapTiles2dForCurrentView(tileBuffer);
  }, [
    buildBasemapTiles2dForCurrentView,
    effectiveMode,
    interactionPhase,
    interactionTileBuffer,
    planningBasemapMode,
    planningGeorefContext,
    visibleTileBuffer,
  ]);

  const prefetchedBasemapTiles2d = useMemo<BasemapTileDescriptor2d[]>(() => {
    if (effectiveMode !== '2d' || planningBasemapMode !== 'osm' || planningGeorefContext == null) {
      return [];
    }
    if (interactionPhase !== 'idle') return basemapTiles2d;
    if (!idlePrefetchReady) return basemapTiles2d;
    if (basemapTiles2d.length >= idlePrefetchTileCountThreshold) return basemapTiles2d;
    return buildBasemapTiles2dForCurrentView(
      Math.max(visibleTileBuffer, idlePrefetchTileBuffer),
    );
  }, [
    basemapTiles2d,
    buildBasemapTiles2dForCurrentView,
    effectiveMode,
    idlePrefetchReady,
    idlePrefetchTileBuffer,
    idlePrefetchTileCountThreshold,
    interactionPhase,
    planningBasemapMode,
    planningGeorefContext,
    visibleTileBuffer,
  ]);

  const basemapTileSignature = useMemo(
    () =>
      basemapTiles2d
        .map((tile) => `${tile.key}:${tile.meshColumns}:${tile.meshRows}:${tile.meshPoints.length}`)
        .join('|'),
    [basemapTiles2d],
  );

  useEffect(() => {
    if (interactionPhase !== 'idle') return;
    if (stableBasemapTileSignatureRef.current === basemapTileSignature) return;
    stableBasemapTiles2dRef.current = basemapTiles2d;
    stableBasemapTileSignatureRef.current = basemapTileSignature;
    setStableBasemapTiles2dRender(basemapTiles2d);
    setStableBasemapTileSignatureRender(basemapTileSignature);
  }, [basemapTileSignature, basemapTiles2d, interactionPhase]);

  const canReuseStableBasemapTilesDuringInteraction =
    interactionPhase === 'interacting' &&
    stableBasemapTiles2dRender.length > 0 &&
    stableBasemapTileSignatureRender === basemapTileSignature;

  const activeBasemapTiles2d = resolveInteractiveBasemapTiles(
    basemapTiles2d,
    stableBasemapTiles2dRender,
    interactionPhase,
    canReuseStableBasemapTilesDuringInteraction,
  );

  const usingStableInteractionTiles =
    interactionPhase === 'interacting' &&
    activeBasemapTiles2d === stableBasemapTiles2dRender &&
    stableBasemapTiles2dRender.length > 0;

  const requestedBasemapTiles2d = useMemo(
    () =>
      buildRequestedBasemapTiles(
        activeBasemapTiles2d,
        prefetchedBasemapTiles2d,
        interactionPhase,
      ),
    [activeBasemapTiles2d, interactionPhase, prefetchedBasemapTiles2d],
  );

  const activeBasemapTileKeySet = useMemo(
    () => new Set(activeBasemapTiles2d.map((tile) => tile.key)),
    [activeBasemapTiles2d],
  );

  useLayoutEffect(() => {
    const canReuseStableInteractionTiles =
      effectiveMode === '2d' &&
      usingStableInteractionTiles &&
      (latestBasemapRenderInputRef.current?.tiles.length ?? 0) > 0;
    if (canReuseStableInteractionTiles) {
      const reusedTiles = latestBasemapRenderInputRef.current?.tiles ?? [];
      noteMapViewPerfCounter('tiles:interaction-reuse-frames');
      noteMapViewPerfMetadata('tiles:last-descriptor-mode', 'stable-reused');
      latestBasemapRenderInputRef.current = {
        interactionPhase,
        view2d,
        projectionScale: projection2d.scale,
        tiles: reusedTiles,
      };
      latestWebglRenderInputRef.current = buildWebglRenderInputWithTiles(
        latestWebglRenderInputRef.current,
        {
          interactionPhase,
          viewWidth,
          viewHeight,
          view2d,
          tiles: reusedTiles,
        },
      );
      renderLayersNow({ basemap: true });
      return;
    }
    const tileStore = tileStoreRef.current;
    tileStore.markAllEvictable();
    noteMapViewPerfCounter('tiles:mark-all-evictable');
    if (effectiveMode !== '2d' || activeBasemapTiles2d.length === 0) {
      latestBasemapRenderInputRef.current = {
        interactionPhase,
        view2d,
        projectionScale: projection2d.scale,
        tiles: [],
      };
      latestWebglRenderInputRef.current = buildWebglRenderInputWithTiles(
        latestWebglRenderInputRef.current,
        {
          interactionPhase,
          viewWidth,
          viewHeight,
          view2d,
          tiles: [],
        },
      );
      renderLayersNow({ basemap: true });
      return;
    }
    const tileSnapshotBeforeRequest = tileStore.snapshotMetrics();
    const canPrefetchIdleTiles =
      interactionPhase === 'idle' &&
      idlePrefetchReady &&
      tileSnapshotBeforeRequest.requestedCount === 0;
    const tileRequestDescriptors = canPrefetchIdleTiles
      ? requestedBasemapTiles2d
      : activeBasemapTiles2d;
    tileStore.requestTiles(
      tileRequestDescriptors,
      (readyTileKey) => {
        const activeDrag = dragRef.current;
        const currentInteractionPhase =
          latestBasemapRenderInputRef.current?.interactionPhase ?? interactionPhase;
        if (!activeBasemapTileKeySet.has(readyTileKey)) {
          noteMapViewPerfCounter('tiles:prefetch-ready-offscreen');
          return;
        }
        const shouldDeferTileDrivenRender =
          currentInteractionPhase === 'interacting' ||
          (activeDrag.active && activeDrag.mode === 'pan2d');
        if (shouldDeferTileDrivenRender) {
          noteMapViewPerfMetadata('tiles:snapshot', tileStore.snapshotMetrics());
          noteMapViewPerfCounter('tiles:deferred-renders-during-interaction');
          return;
        }
        const latest = latestBasemapRenderInputRef.current;
        if (!latest) return;
        latest.tiles = tileStore.resolveRenderTiles(activeBasemapTiles2d);
        noteMapViewPerfMetadata('tiles:snapshot', tileStore.snapshotMetrics());
        noteMapViewPerfMetadata('tiles:last-resolved-count', latest.tiles.length);
        noteMapViewPerfMetadata(
          'tiles:last-descriptor-mode',
          usingStableInteractionTiles ? 'stable-reused' : 'live',
        );
        if (latestWebglRenderInputRef.current) {
          latestWebglRenderInputRef.current.tiles = latest.tiles;
        }
        scheduleLayerRender({ basemap: true });
      },
      renderer2d === 'webgl' ? { crossOrigin: 'anonymous' } : undefined,
    );
    const resolvedTiles = tileStore.resolveRenderTiles(activeBasemapTiles2d);
    noteMapViewPerfMetadata('tiles:snapshot', tileStore.snapshotMetrics());
    noteMapViewPerfMetadata('tiles:last-resolved-count', resolvedTiles.length);
    noteMapViewPerfMetadata(
      'tiles:last-descriptor-mode',
      usingStableInteractionTiles ? 'stable-reused' : 'live',
    );
    latestBasemapRenderInputRef.current = {
      interactionPhase,
      view2d,
      projectionScale: projection2d.scale,
      tiles: resolvedTiles,
    };
    latestWebglRenderInputRef.current = buildWebglRenderInputWithTiles(
      latestWebglRenderInputRef.current,
      {
        interactionPhase,
        viewWidth,
        viewHeight,
        view2d,
        tiles: resolvedTiles,
      },
    );
    renderLayersNow({ basemap: true });
  }, [
    activeBasemapTileKeySet,
    activeBasemapTiles2d,
    dragRef,
    effectiveMode,
    idlePrefetchReady,
    interactionPhase,
    latestBasemapRenderInputRef,
    latestWebglRenderInputRef,
    projection2d.scale,
    renderLayersNow,
    renderer2d,
    requestedBasemapTiles2d,
    scheduleLayerRender,
    tileStoreRef,
    usingStableInteractionTiles,
    view2d,
    viewHeight,
    viewWidth,
  ]);

  return { setBasemapDescriptorView2d };
};
