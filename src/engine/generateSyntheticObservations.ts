import proj4 from 'proj4';

import { RAD_TO_DEG } from './angles';
import { getCanadianCrsDefinitionForTest } from './canadianCrsTestCatalog';
import { computeElevationFactor, computeGridFactors } from './geodesy';
import type {
  SyntheticCanadianNetwork,
  TrueStation,
} from './generateSyntheticCanadianNetwork';

export type SyntheticObservationNoiseMode = 'noise-free' | 'noisy';

export interface SyntheticObservationJob {
  input: string;
  approximateStations: Array<{
    id: string;
    easting: number;
    northing: number;
    elevation: number;
  }>;
}

const createMulberry32 = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const gaussianNoise = (random: () => number): number => {
  const u1 = Math.max(random(), 1e-12);
  const u2 = Math.max(random(), 1e-12);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
};

const azimuthDeg = (from: TrueStation, to: TrueStation): number => {
  const az = Math.atan2(to.easting - from.easting, to.northing - from.northing) * RAD_TO_DEG;
  return az >= 0 ? az : az + 360;
};

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

const distanceMeters = (
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

const zenithDeg = (
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

const findStation = (network: SyntheticCanadianNetwork, id: string): TrueStation => {
  const station = network.stations.find((row) => row.id === id);
  if (!station) throw new Error(`Synthetic station missing: ${id}`);
  return station;
};

const hiHtToken = (hi = 1.5, ht = 1.7): string => `${hi.toFixed(4)}/${ht.toFixed(4)}`;

const edgesForTemplate = (network: SyntheticCanadianNetwork): Array<[string, string]> => {
  switch (network.template) {
    case 'braced-quadrilateral':
      return [
        ['A', 'C'],
        ['B', 'C'],
        ['A', 'D'],
        ['B', 'D'],
        ['C', 'D'],
        ['C', 'L'],
        ['D', 'L'],
      ];
    case 'short-traverse':
      return [
        ['A', 'C'],
        ['C', 'D'],
        ['B', 'D'],
        ['A', 'D'],
        ['D', 'L'],
        ['B', 'L'],
      ];
    case 'loop':
      return [
        ['A', 'C'],
        ['C', 'D'],
        ['D', 'E'],
        ['E', 'B'],
        ['B', 'C'],
        ['D', 'L'],
        ['E', 'L'],
      ];
    case 'mixed-3d':
      return [
        ['A', 'C'],
        ['B', 'C'],
        ['E', 'C'],
        ['A', 'D'],
        ['B', 'D'],
        ['E', 'D'],
        ['C', 'D'],
        ['E', 'L'],
        ['B', 'L'],
        ['C', 'L'],
        ['D', 'L'],
      ];
    default:
      return [];
  }
};

export const generateSyntheticObservations = ({
  network,
  mode = 'noise-free',
  distanceSigmaM = 0.002,
  bearingSigmaSec = 1.5,
  zenithSigmaSec = 2.0,
  defaultHiM = 1.5,
  defaultHtM = 1.7,
}: {
  network: SyntheticCanadianNetwork;
  mode?: SyntheticObservationNoiseMode;
  distanceSigmaM?: number;
  bearingSigmaSec?: number;
  zenithSigmaSec?: number;
  defaultHiM?: number;
  defaultHtM?: number;
}): SyntheticObservationJob => {
  const random = createMulberry32(network.seed ^ 0x9e3779b9);
  const measurementNoise = (sigma: number): number =>
    mode === 'noisy' ? gaussianNoise(random) * sigma : 0;
  const perturbApproximation = (
    station: TrueStation,
  ): { easting: number; northing: number; elevation: number } => {
    if (station.role === 'fixed') {
      return {
        easting: station.easting,
        northing: station.northing,
        elevation: station.elevation,
      };
    }
    return {
      easting: station.easting + (random() - 0.5) * 1.5,
      northing: station.northing + (random() - 0.5) * 1.5,
      elevation:
        network.coordMode === '3D'
          ? station.elevation + (random() - 0.5) * 0.35
          : station.elevation,
    };
  };
  const dist = (fromId: string, toId: string): string => {
    const from = findStation(network, fromId);
    const to = findStation(network, toId);
    const value =
      distanceMeters(from, to, defaultHiM, defaultHtM, network.coordMode) +
      measurementNoise(distanceSigmaM);
    return network.coordMode === '3D'
      ? `D ${fromId}-${toId} ${value.toFixed(4)} ${distanceSigmaM.toFixed(4)} ${hiHtToken(defaultHiM, defaultHtM)}`
      : `D ${fromId}-${toId} ${value.toFixed(4)} ${distanceSigmaM.toFixed(4)}`;
  };
  const bearing = (fromId: string, toId: string): string => {
    const from = findStation(network, fromId);
    const to = findStation(network, toId);
    const value = azimuthDeg(from, to) + measurementNoise(bearingSigmaSec / 3600);
    return `B ${fromId}-${toId} ${value.toFixed(8)} ${bearingSigmaSec.toFixed(2)}`;
  };
  const distanceAndZenith = (fromId: string, toId: string): string => {
    const from = findStation(network, fromId);
    const to = findStation(network, toId);
    const distanceValue =
      distanceMeters(from, to, defaultHiM, defaultHtM, network.coordMode) +
      measurementNoise(distanceSigmaM);
    const zenithValue =
      zenithDeg(network, from, to, defaultHiM, defaultHtM) +
      measurementNoise(zenithSigmaSec / 3600);
    return `DV ${fromId}-${toId} ${distanceValue.toFixed(4)} ${zenithValue.toFixed(8)} ${distanceSigmaM.toFixed(4)} ${zenithSigmaSec.toFixed(2)} ${hiHtToken(defaultHiM, defaultHtM)}`;
  };

  const lines = [
    network.coordMode === '3D' ? '.3D' : '.2D',
    '.UNITS METERS DD',
    '.ORDER EN',
    `.CRS GRID ${network.crsId}`,
  ];
  const approximateStations = network.stations.map((station) => {
    const approx = perturbApproximation(station);
    const fixedSuffix =
      station.role === 'fixed'
        ? network.coordMode === '3D'
          ? ' ! ! !'
          : ' ! !'
        : '';
    lines.push(
      `C ${station.id} ${approx.easting.toFixed(4)} ${approx.northing.toFixed(4)} ${approx.elevation.toFixed(3)}${fixedSuffix}`,
    );
    return {
      id: station.id,
      easting: approx.easting,
      northing: approx.northing,
      elevation: approx.elevation,
    };
  });

  const edges = edgesForTemplate(network);
  if (edges.length === 0) {
    throw new Error(`Synthetic observation generator has no edge list for template ${network.template}`);
  }

  edges.forEach(([fromId, toId]) => {
    if (network.coordMode === '3D') {
      lines.push(distanceAndZenith(fromId, toId));
    } else {
      lines.push(dist(fromId, toId));
    }
    lines.push(bearing(fromId, toId));
  });

  return {
    input: lines.join('\n'),
    approximateStations,
  };
};
