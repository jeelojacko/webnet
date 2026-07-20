import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { MapViewTileStore } from './mapViewTileStore';
import { MapViewWebgl2d } from './mapViewWebgl2d';
import {
  canRenderWebglLayers,
  DEFAULT_RENDER_SURFACE_LAYOUT,
  type RenderSurfaceLayout,
} from './mapViewInteraction';
import { useMapViewLayerRenderer } from './useMapViewLayerRenderer';
import { useMapViewRenderSurfaceLayout } from './useMapViewShellEffects';
import { VIEW_H, VIEW_W } from './mapViewConstants';

interface UseMapViewRenderSurfacesArgs {
  effectiveMode: '2d' | '3d';
  units: 'm' | 'ft';
}

export const useMapViewRenderSurfaces = ({
  effectiveMode,
  units,
}: UseMapViewRenderSurfacesArgs) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const webglCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const basemapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const geometryCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const planningCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderSurfaceRef = useRef<HTMLDivElement | null>(null);
  const tileStoreRef = useRef<MapViewTileStore>(new MapViewTileStore());
  const webglRendererRef = useRef<MapViewWebgl2d>(new MapViewWebgl2d());
  const [renderSurfaceLayout, setRenderSurfaceLayout] = useState<RenderSurfaceLayout>(
    DEFAULT_RENDER_SURFACE_LAYOUT,
  );
  const [renderer2d, setRenderer2d] = useState<'canvas' | 'webgl'>(() =>
    canRenderWebglLayers() ? 'webgl' : 'canvas',
  );
  const webglEligible = effectiveMode === '2d' && canRenderWebglLayers();

  useMapViewRenderSurfaceLayout({ containerRef, setRenderSurfaceLayout });

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

  return {
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
  };
};
