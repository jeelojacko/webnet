import { useMemo } from 'react';

import { buildMap3DScene } from '../../engine/map3d';
import type { AdjustmentResult } from '../../types';
import { buildMapScenePointBounds2d } from './mapViewSelectors';

export const useMapViewScene = (result: AdjustmentResult, showLostStations: boolean) => {
  const scene3d = useMemo(
    () => buildMap3DScene(result, showLostStations),
    [result, showLostStations],
  );
  const { points, bbox } = useMemo(() => buildMapScenePointBounds2d(scene3d), [scene3d]);
  return { scene3d, points, bbox };
};
