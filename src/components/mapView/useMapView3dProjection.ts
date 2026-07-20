import { useCallback, useMemo, type Dispatch, type SetStateAction } from 'react';
import type { Map3DCamera, Map3DScene, Vec3 } from '../../engine/map3d';
import { buildProjectedMapState3d } from './mapViewSelectors';
import { projectPoint3d } from './mapView3d';
import { DENSE_LABEL_POINT_THRESHOLD, LABEL_GRID_PX, VIEW_H, VIEW_W } from './mapViewConstants';

interface UseMapView3dProjectionArgs {
  camera3d: Map3DCamera | null;
  effectiveMode: '2d' | '3d';
  scene3d: Map3DScene;
  selectedStationId?: string | null | undefined;
  setCamera3d: Dispatch<SetStateAction<Map3DCamera | null>>;
}

export const useMapView3dProjection = ({
  camera3d,
  effectiveMode,
  scene3d,
  selectedStationId,
  setCamera3d,
}: UseMapView3dProjectionArgs) => {
  const project3d = useCallback(
    (point: Vec3) => projectPoint3d(camera3d, point, VIEW_W, VIEW_H),
    [camera3d],
  );

  const projectedState3d = useMemo(
    () =>
      buildProjectedMapState3d({
        effectiveMode,
        camera3d,
        scene3d,
        selectedStationId: selectedStationId ?? null,
        denseLabelPointThreshold: DENSE_LABEL_POINT_THRESHOLD,
        labelGridPx: LABEL_GRID_PX,
        viewWidth: VIEW_W,
        viewHeight: VIEW_H,
      }),
    [camera3d, effectiveMode, scene3d, selectedStationId],
  );

  const applyCubeView = useCallback(
    (preset: 'iso' | 'top' | 'front' | 'right') => {
      setCamera3d((prev) => {
        if (!prev) return prev;
        if (preset === 'top') return { ...prev, yawDeg: 0, pitchDeg: 89 };
        if (preset === 'front') return { ...prev, yawDeg: 0, pitchDeg: 0 };
        if (preset === 'right') return { ...prev, yawDeg: 90, pitchDeg: 0 };
        return { ...prev, yawDeg: -35, pitchDeg: 25 };
      });
    },
    [setCamera3d],
  );

  return {
    applyCubeView,
    project3d,
    ...projectedState3d,
  };
};
