import proj4 from 'proj4';

import { RAD_TO_DEG } from './angles';
import { getCanadianCrsDefinitionForTest } from './canadianCrsTestCatalog';
import { computeElevationFactor, computeGridFactors } from './geodesy';
import type {
  SyntheticObservationPrecisionMode,
} from './generateSyntheticObservations.types';
import type {
  SyntheticCanadianNetwork,
  TrueStation,
} from './generateSyntheticCanadianNetwork';

export const createMulberry32 = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const gaussianNoise = (random: () => number): number => {
  const u1 = Math.max(random(), 1e-12);
  const u2 = Math.max(random(), 1e-12);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
};

export const azimuthDeg = (from: TrueStation, to: TrueStation): number => {
  const az = Math.atan2(to.easting - from.easting, to.northing - from.northing) * RAD_TO_DEG;
  return az >= 0 ? az : az + 360;
};

export const wrap360 = (value: number): number => {
  let wrapped = value % 360;
  if (wrapped < 0) wrapped += 360;
  return wrapped;
};

export const turnedAngleDeg = (at: TrueStation, from: TrueStation, to: TrueStation): number =>
  wrap360(azimuthDeg(at, to) - azimuthDeg(at, from));

const geodeticFromProjected = (
  network: SyntheticCanadianNetwork,
  station: TrueStation,
): { latDeg: number; lonDeg: number } | null => {
  const def = getCanadianCrsDefinitionForTest(network.crsId);
  const inverse = proj4(def.proj4, 'WGS84', [station.easting, station.northing]);
  const lonDeg = inverse[0];
  const latDeg = inverse[1];
  if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) {
    return null;
  }
  return { latDeg, lonDeg };
};

const combinedScaleAtStation = (network: SyntheticCanadianNetwork, station: TrueStation): number => {
  const geodetic = geodeticFromProjected(network, station);
  if (!geodetic) return 1;
  const factors = computeGridFactors(geodetic.latDeg, geodetic.lonDeg, network.crsId);
  const gridScale = factors?.gridScaleFactor ?? 1;
  const elevationFactor = computeElevationFactor(station.elevation);
  const combined = gridScale * elevationFactor;
  return Number.isFinite(combined) && combined > 0 ? combined : 1;
};

const zenithHorizontalMeters = (
  network: SyntheticCanadianNetwork,
  from: TrueStation,
  to: TrueStation,
): number => {
  const projectedHorizontal = Math.hypot(to.easting - from.easting, to.northing - from.northing);
  if (network.coordMode !== '3D') return projectedHorizontal;
  const combinedScale =
    (combinedScaleAtStation(network, from) + combinedScaleAtStation(network, to)) * 0.5;
  return projectedHorizontal / combinedScale;
};

export const distanceMeters = (
  from: TrueStation,
  to: TrueStation,
  hi = 0,
  ht = 0,
  coordMode: '2D' | '3D' = '2D',
): number => {
  const dE = to.easting - from.easting;
  const dN = to.northing - from.northing;
  const horizontal = Math.hypot(dE, dN);
  if (coordMode === '2D') return horizontal;
  const dH = to.elevation + ht - (from.elevation + hi);
  return Math.hypot(horizontal, dH);
};

export const zenithDeg = (
  network: SyntheticCanadianNetwork,
  from: TrueStation,
  to: TrueStation,
  hi = 0,
  ht = 0,
): number => {
  const horizontal = zenithHorizontalMeters(network, from, to);
  const dH = to.elevation + ht - (from.elevation + hi);
  const slope = Math.hypot(horizontal, dH);
  return Math.acos(dH / slope) * RAD_TO_DEG;
};

export const findStation = (network: SyntheticCanadianNetwork, id: string): TrueStation => {
  const station = network.stations.find((row) => row.id === id);
  if (!station) throw new Error(`Synthetic station missing: ${id}`);
  return station;
};

export const hiHtToken = (hi = 1.5, ht = 1.7): string => `${hi.toFixed(4)}/${ht.toFixed(4)}`;

export const precisionDigits = (precisionMode: SyntheticObservationPrecisionMode) =>
  precisionMode === 'perfect'
    ? {
        stationEN: 10,
        stationH: 6,
        distance: 12,
        angle: 12,
        sigmaDistance: 6,
        sigmaAngle: 4,
      }
    : {
        stationEN: 4,
        stationH: 3,
        distance: 4,
        angle: 8,
        sigmaDistance: 4,
        sigmaAngle: 2,
      };
