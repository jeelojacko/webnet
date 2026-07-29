import { ecefDeltaToLocalEnu, geodeticToEcef } from './adjustGpsMath';
import type {
  GpsSolveVector,
  GpsVectorComponents,
  GpsVectorDerivatives,
} from './adjustTypes';
import type { GnssVectorFrame, GpsObservation, ParseOptions, Station, StationId, StationMap } from '../types';

export const gpsModeledVectorFromStationValues = (
  obs: GpsObservation,
  fromValues: { x: number; y: number; h: number },
  toValues: { x: number; y: number; h: number },
  options: {
    applyGpsVerticalDeflection: (
      _vector: Required<Pick<GpsSolveVector, 'dE' | 'dN' | 'dU'>>,
    ) => Required<Pick<GpsSolveVector, 'dE' | 'dN' | 'dU'>>;
    coordSystemMode: ParseOptions['coordSystemMode'];
    gpsUsesLocalSolveFrame: (_frame: GnssVectorFrame) => boolean;
    is2D: boolean;
    parseState?: ParseOptions;
    stationEllipsoidHeightFromValues: (
      _station: Station,
      _h: number,
      _latDeg?: number,
      _lonDeg?: number,
    ) => number;
    stationGeodeticFromCoordinates: (
      _stationId: StationId,
      _x: number,
      _y: number,
    ) => { latDeg: number; lonDeg: number } | null;
    stations: StationMap;
  },
): GpsVectorComponents => {
  const includeVertical = !options.is2D && Number.isFinite(obs.obs.dU ?? Number.NaN);
  const frame: GnssVectorFrame =
    obs.gnssVectorFrame ?? options.parseState?.gnssVectorFrameDefault ?? 'gridNEU';

  if (!options.gpsUsesLocalSolveFrame(frame) || options.coordSystemMode !== 'grid') {
    return {
      dE: toValues.x - fromValues.x,
      dN: toValues.y - fromValues.y,
      dU: includeVertical ? toValues.h - fromValues.h : undefined,
    };
  }

  const fromGeo = options.stationGeodeticFromCoordinates(obs.from, fromValues.x, fromValues.y);
  const toGeo = options.stationGeodeticFromCoordinates(obs.to, toValues.x, toValues.y);
  if (!fromGeo || !toGeo) {
    return {
      dE: toValues.x - fromValues.x,
      dN: toValues.y - fromValues.y,
      dU: includeVertical ? toValues.h - fromValues.h : undefined,
    };
  }

  const fromStation = options.stations[obs.from];
  const toStation = options.stations[obs.to];
  if (!fromStation || !toStation) {
    return {
      dE: toValues.x - fromValues.x,
      dN: toValues.y - fromValues.y,
      dU: includeVertical ? toValues.h - fromValues.h : undefined,
    };
  }

  const fromEllipsoidHeight = options.stationEllipsoidHeightFromValues(
    fromStation,
    fromValues.h,
    fromGeo.latDeg,
    fromGeo.lonDeg,
  );
  const toEllipsoidHeight = options.stationEllipsoidHeightFromValues(
    toStation,
    toValues.h,
    toGeo.latDeg,
    toGeo.lonDeg,
  );
  const fromEcef = geodeticToEcef(fromGeo.latDeg, fromGeo.lonDeg, fromEllipsoidHeight);
  const toEcef = geodeticToEcef(toGeo.latDeg, toGeo.lonDeg, toEllipsoidHeight);
  const local = ecefDeltaToLocalEnu(
    toEcef.x - fromEcef.x,
    toEcef.y - fromEcef.y,
    toEcef.z - fromEcef.z,
    fromGeo.latDeg,
    fromGeo.lonDeg,
  );
  const deflected = options.applyGpsVerticalDeflection(local);
  return {
    dE: deflected.dE,
    dN: deflected.dN,
    dU: includeVertical ? deflected.dU : undefined,
  };
};

export const gpsModeledVector = (
  obs: GpsObservation,
  options: {
    gpsModeledVectorFromStationValues: (
      _obs: GpsObservation,
      _fromValues: { x: number; y: number; h: number },
      _toValues: { x: number; y: number; h: number },
    ) => GpsVectorComponents;
    stations: StationMap;
  },
): GpsSolveVector => {
  const fromStation = options.stations[obs.from];
  const toStation = options.stations[obs.to];
  if (!fromStation || !toStation) return { dE: 0, dN: 0, dU: 0, scale: 1 };
  const modeled = options.gpsModeledVectorFromStationValues(
    obs,
    { x: fromStation.x, y: fromStation.y, h: fromStation.h },
    { x: toStation.x, y: toStation.y, h: toStation.h },
  );
  return { ...modeled, scale: 1 };
};

export const gpsModeledVectorDerivatives = (
  obs: GpsObservation,
  options: {
    gpsModeledVectorFromStationValues: (
      _obs: GpsObservation,
      _fromValues: { x: number; y: number; h: number },
      _toValues: { x: number; y: number; h: number },
    ) => GpsVectorComponents;
    is2D: boolean;
    stations: StationMap;
  },
): GpsVectorDerivatives => {
  const fromStation = options.stations[obs.from];
  const toStation = options.stations[obs.to];
  const empty: GpsVectorDerivatives = { from: {}, to: {} };
  if (!fromStation || !toStation) return empty;

  const delta = 1e-4;
  const differentiate = (
    endpoint: 'from' | 'to',
    component: 'x' | 'y' | 'h',
  ): GpsVectorComponents | undefined => {
    if (component === 'h' && options.is2D) return undefined;
    const fromBase = { x: fromStation.x, y: fromStation.y, h: fromStation.h };
    const toBase = { x: toStation.x, y: toStation.y, h: toStation.h };
    const fromPlus = { ...fromBase };
    const fromMinus = { ...fromBase };
    const toPlus = { ...toBase };
    const toMinus = { ...toBase };
    if (endpoint === 'from') {
      fromPlus[component] += delta;
      fromMinus[component] -= delta;
    } else {
      toPlus[component] += delta;
      toMinus[component] -= delta;
    }
    const plus = options.gpsModeledVectorFromStationValues(obs, fromPlus, toPlus);
    const minus = options.gpsModeledVectorFromStationValues(obs, fromMinus, toMinus);
    return {
      dE: (plus.dE - minus.dE) / (2 * delta),
      dN: (plus.dN - minus.dN) / (2 * delta),
      dU:
        !options.is2D &&
        Number.isFinite(plus.dU ?? Number.NaN) &&
        Number.isFinite(minus.dU ?? Number.NaN)
          ? ((plus.dU as number) - (minus.dU as number)) / (2 * delta)
          : undefined,
    };
  };

  empty.from.x = differentiate('from', 'x');
  empty.from.y = differentiate('from', 'y');
  empty.to.x = differentiate('to', 'x');
  empty.to.y = differentiate('to', 'y');
  if (!options.is2D) {
    empty.from.h = differentiate('from', 'h');
    empty.to.h = differentiate('to', 'h');
  }
  return empty;
};
