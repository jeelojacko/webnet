import { DEFAULT_CAD_LAYERS } from '../src/engine/cad/cadLayers';
import { DEFAULT_CAD_STYLE_LIBRARY } from '../src/engine/cad/cadStyles';
import type {
  CadCoordinateContext,
  CadEntity,
  CadLayerId,
  CadProject,
  CadSurveyPointEntity,
} from '../src/engine/cad/cadTypes';

export const buildCadLineL1Project = (options?: {
  entities?: CadEntity[];
  coordinateContext?: CadCoordinateContext;
  currentLayerId?: CadLayerId;
}): CadProject => ({
  version: 2,
  id: 'cad-line-l1',
  name: 'Line L1',
  metadata: {
    source: 'parsed-input',
    runMode: 'unknown',
    units: 'm',
    stationCount: 0,
    observationCount: 0,
    adjustedStationCount: 0,
    ...(options?.coordinateContext ? { coordinateContext: options.coordinateContext } : {}),
  },
  layers: DEFAULT_CAD_LAYERS.map((layer) => ({ ...layer })),
  styleLibrary: DEFAULT_CAD_STYLE_LIBRARY,
  entities: options?.entities ?? [],
  cogoComputations: [],
  bounds: null,
  currentLayerId: options?.currentLayerId ?? 'general',
});

export const buildCadLineL1SurveyPoint = (
  stationId: string,
  x: number,
  y: number,
): CadSurveyPointEntity => ({
  id: `point:${stationId}`,
  type: 'survey-point',
  layerId: 'points',
  visible: true,
  locked: false,
  stationId,
  x,
  y,
  pointClass: 'free',
  source: 'parsed-input',
});
