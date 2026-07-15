import { useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';

import {
  renderBasemapCanvas2d,
  renderGeometryCanvas2d,
  renderPlanningOverlayCanvas2d,
} from './mapViewCanvas2d';
import { canRenderCanvasLayers, type MapInteractionPhase } from './mapViewInteraction';
import {
  noteMapViewPerfCounter,
} from './mapViewPerf';
import type { ProjectedMapLine2D, ProjectedPoint2D } from './mapView2d';
import { buildMapViewWebglScene2d } from './mapViewWebglBuffers';
import type { MapViewTileStore, BasemapTileRenderSurface2d } from './mapViewTileStore';
import type { MapViewWebgl2d } from './mapViewWebgl2d';

interface MapViewLayerRendererOptions {
  basemapCanvasRef: RefObject<HTMLCanvasElement | null>;
  effectiveMode: '2d' | '3d';
  geometryCanvasRef: RefObject<HTMLCanvasElement | null>;
  onWebglFallback: () => void;
  planningCanvasRef: RefObject<HTMLCanvasElement | null>;
  renderer2d: 'canvas' | 'webgl';
  tileStoreRef: { current: MapViewTileStore };
  units: 'm' | 'ft';
  viewHeight: number;
  viewWidth: number;
  webglRendererRef: { current: MapViewWebgl2d };
}

export interface BasemapRenderInput {
  interactionPhase: MapInteractionPhase;
  view2d: { zoom: number; panX: number; panY: number };
  projectionScale: number;
  tiles: BasemapTileRenderSurface2d[];
}

export interface GeometryRenderInput {
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
}

export interface PlanningRenderInput {
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
}

export interface WebglRenderInput {
  interactionPhase: MapInteractionPhase;
  viewWidth: number;
  viewHeight: number;
  view2d: { zoom: number; panX: number; panY: number };
  tiles: BasemapTileRenderSurface2d[];
  surveyHaloLineWidth: number;
  surveyLineWidth: number;
  previewLineWidth: number;
  ellipseLineWidth: number;
  surveyHaloLines: ReturnType<typeof buildMapViewWebglScene2d>['surveyHaloLines'];
  surveyLines: ReturnType<typeof buildMapViewWebglScene2d>['surveyLines'];
  previewLines: ReturnType<typeof buildMapViewWebglScene2d>['previewLines'];
  ellipseLines: ReturnType<typeof buildMapViewWebglScene2d>['ellipseLines'];
  surveyHaloPoints: ReturnType<typeof buildMapViewWebglScene2d>['surveyHaloPoints'];
  surveyPoints: ReturnType<typeof buildMapViewWebglScene2d>['surveyPoints'];
  previewPoints: ReturnType<typeof buildMapViewWebglScene2d>['previewPoints'];
}

export interface LayerDirtyState {
  basemap?: boolean;
  geometry?: boolean;
  planning?: boolean;
}

export const buildWebglRenderInputWithTiles = (
  current: WebglRenderInput | null,
  options: {
    interactionPhase: MapInteractionPhase;
    tiles: BasemapTileRenderSurface2d[];
    view2d: { zoom: number; panX: number; panY: number };
    viewHeight: number;
    viewWidth: number;
  },
): WebglRenderInput => ({
  interactionPhase: options.interactionPhase,
  viewWidth: options.viewWidth,
  viewHeight: options.viewHeight,
  view2d: options.view2d,
  tiles: options.tiles,
  surveyHaloLineWidth: current?.surveyHaloLineWidth ?? 0,
  surveyLineWidth: current?.surveyLineWidth ?? 0,
  previewLineWidth: current?.previewLineWidth ?? 0,
  ellipseLineWidth: current?.ellipseLineWidth ?? 0,
  surveyHaloLines: current?.surveyHaloLines ?? [],
  surveyLines: current?.surveyLines ?? [],
  previewLines: current?.previewLines ?? [],
  ellipseLines: current?.ellipseLines ?? [],
  surveyHaloPoints: current?.surveyHaloPoints ?? [],
  surveyPoints: current?.surveyPoints ?? [],
  previewPoints: current?.previewPoints ?? [],
});

export const useMapViewLayerRenderer = (options: MapViewLayerRendererOptions) => {
  const {
    basemapCanvasRef,
    effectiveMode,
    geometryCanvasRef,
    onWebglFallback,
    planningCanvasRef,
    renderer2d,
    tileStoreRef,
    units,
    viewHeight,
    viewWidth,
    webglRendererRef,
  } = options;
  const renderRequestFrameRef = useRef<number | null>(null);
  const renderDirtyRef = useRef({ basemap: false, geometry: false, planning: false });
  const latestBasemapRenderInputRef = useRef<BasemapRenderInput | null>(null);
  const latestGeometryRenderInputRef = useRef<GeometryRenderInput | null>(null);
  const latestPlanningRenderInputRef = useRef<PlanningRenderInput | null>(null);
  const latestWebglRenderInputRef = useRef<WebglRenderInput | null>(null);

  const renderLayersNow = useCallback(
    (dirty: LayerDirtyState) => {
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
          onWebglFallback();
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
              viewWidth,
              viewHeight,
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
              viewWidth,
              viewHeight,
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
            viewWidth,
            viewHeight,
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
    [
      basemapCanvasRef,
      effectiveMode,
      geometryCanvasRef,
      onWebglFallback,
      planningCanvasRef,
      renderer2d,
      tileStoreRef,
      units,
      viewHeight,
      viewWidth,
      webglRendererRef,
    ],
  );

  const scheduleLayerRender = useCallback(
    (dirty: LayerDirtyState) => {
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

  useEffect(
    () => () => {
      if (renderRequestFrameRef.current != null) {
        cancelAnimationFrame(renderRequestFrameRef.current);
      }
    },
    [],
  );

  return {
    latestBasemapRenderInputRef,
    latestGeometryRenderInputRef,
    latestPlanningRenderInputRef,
    latestWebglRenderInputRef,
    renderLayersNow,
    scheduleLayerRender,
  };
};
