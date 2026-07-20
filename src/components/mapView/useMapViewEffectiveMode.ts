import { useMemo } from 'react';
import type { Map3DScene } from '../../engine/map3d';

export const useMapViewEffectiveMode = ({
  mode,
  scene3d,
  viewportWidth,
  viewportWidthOverride,
}: {
  mode: '2d' | '3d';
  scene3d: Map3DScene;
  viewportWidth: number;
  viewportWidthOverride?: number | undefined;
}) => {
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
  return { effectiveMode, fallbackReason };
};
