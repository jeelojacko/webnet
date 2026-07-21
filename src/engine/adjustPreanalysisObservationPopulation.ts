import type {
  DistanceObservation,
  GpsObservation,
  Observation,
  ParseOptions,
  StationId,
  StationMap,
  ZenithObservation,
} from '../types';

interface PopulatePreanalysisObservationsOptions {
  centeringLineGeometry: (
    _fromID: StationId,
    _toID: StationId,
    _hi?: number,
    _ht?: number,
  ) => { horiz: number; slope: number; elev: number };
  correctedDistanceModel: (
    _obs: DistanceObservation,
    _calcDistRaw: number,
  ) => {
    calcDistance: number;
    mapScale: number;
    prismCorrection: number;
    horizontalDerivativeFactor?: number;
    verticalDerivativeFactor?: number;
    useReducedSlopeDerivatives?: boolean;
  };
  defaultDistanceSigmaMeters: (_obs: DistanceObservation) => number;
  getAzimuth: (_fromID: StationId, _toID: StationId) => { az: number; dist: number };
  getModeledZenith: (_obs: ZenithObservation) => {
    z: number;
    dist: number;
    horiz: number;
    dh: number;
    crCorr: number;
    horizontalScale: number;
  };
  is2D: boolean;
  log: (_msg: string) => void;
  modeledAzimuth: (_rawAz: number, _atStationId?: StationId, _applyConvergence?: boolean) => number;
  observations: Observation[];
  parseState?: ParseOptions;
  plannedGpsRawVector: (_obs: GpsObservation) => { dE: number; dN: number; dU?: number };
  stations: StationMap;
}

export const populatePreanalysisObservations = ({
  centeringLineGeometry,
  correctedDistanceModel,
  defaultDistanceSigmaMeters,
  getAzimuth,
  getModeledZenith,
  is2D,
  log,
  modeledAzimuth,
  observations,
  parseState,
  plannedGpsRawVector,
  stations,
}: PopulatePreanalysisObservationsOptions): void => {
  let plannedCount = 0;
  observations.forEach((obs) => {
    if (!obs.planned) return;
    plannedCount += 1;
    if (obs.type === 'dist') {
      const geom = centeringLineGeometry(obs.from, obs.to, obs.hi ?? 0, obs.ht ?? 0);
      const rawDistance = is2D ? geom.horiz : obs.mode === 'slope' ? geom.slope : geom.horiz;
      obs.obs = correctedDistanceModel(obs, rawDistance).calcDistance;
      if (obs.sigmaSource === 'default') {
        obs.stdDev = defaultDistanceSigmaMeters(obs);
      }
      return;
    }
    if (obs.type === 'angle') {
      const azTo = getAzimuth(obs.at, obs.to).az;
      const azFrom = getAzimuth(obs.at, obs.from).az;
      let modeled = azTo - azFrom;
      if (modeled < 0) modeled += 2 * Math.PI;
      obs.obs = modeled;
      return;
    }
    if (obs.type === 'direction') {
      obs.obs = getAzimuth(obs.at, obs.to).az;
      return;
    }
    if (obs.type === 'bearing' || obs.type === 'dir') {
      obs.obs = modeledAzimuth(
        getAzimuth(obs.from, obs.to).az,
        obs.from,
        obs.gridObsMode !== 'grid',
      );
      return;
    }
    if (obs.type === 'zenith') {
      obs.obs = getModeledZenith(obs).z;
      return;
    }
    if (obs.type === 'lev') {
      const from = stations[obs.from];
      const to = stations[obs.to];
      if (!from || !to) return;
      obs.obs = to.h - from.h;
      return;
    }
    if (obs.type === 'gps') {
      obs.obs = plannedGpsRawVector(obs);
    }
  });
  if (parseState) {
    parseState.preanalysisMode = true;
    parseState.plannedObservationCount = plannedCount;
    parseState.robustMode = 'none';
    parseState.autoAdjustEnabled = false;
  }
  log(
    `Preanalysis mode: resolved ${plannedCount} planned observation(s) from approximate geometry; residual-based QC disabled.`,
  );
};
