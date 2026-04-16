import { RAD_TO_DEG } from './angles';
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

const distanceMeters = (from: TrueStation, to: TrueStation): number =>
  Math.hypot(to.easting - from.easting, to.northing - from.northing);

const findStation = (network: SyntheticCanadianNetwork, id: string): TrueStation => {
  const station = network.stations.find((row) => row.id === id);
  if (!station) throw new Error(`Synthetic station missing: ${id}`);
  return station;
};

export const generateSyntheticObservations = ({
  network,
  mode = 'noise-free',
  distanceSigmaM = 0.002,
  bearingSigmaSec = 1.5,
}: {
  network: SyntheticCanadianNetwork;
  mode?: SyntheticObservationNoiseMode;
  distanceSigmaM?: number;
  bearingSigmaSec?: number;
}): SyntheticObservationJob => {
  const random = createMulberry32(network.seed ^ 0x9e3779b9);
  const stationMap = new Map(network.stations.map((station) => [station.id, station] as const));
  const perturbApproximation = (station: TrueStation): { easting: number; northing: number } => {
    if (station.role === 'fixed') {
      return { easting: station.easting, northing: station.northing };
    }
    return {
      easting: station.easting + (random() - 0.5) * 1.5,
      northing: station.northing + (random() - 0.5) * 1.5,
    };
  };
  const measurementNoise = (sigma: number): number =>
    mode === 'noisy' ? gaussianNoise(random) * sigma : 0;
  const dist = (fromId: string, toId: string): string => {
    const from = findStation(network, fromId);
    const to = findStation(network, toId);
    const value = distanceMeters(from, to) + measurementNoise(distanceSigmaM);
    return `D ${fromId}-${toId} ${value.toFixed(4)} ${distanceSigmaM.toFixed(4)}`;
  };
  const bearing = (fromId: string, toId: string): string => {
    const from = findStation(network, fromId);
    const to = findStation(network, toId);
    const value = azimuthDeg(from, to) + measurementNoise(bearingSigmaSec / 3600);
    return `B ${fromId}-${toId} ${value.toFixed(8)} ${bearingSigmaSec.toFixed(2)}`;
  };

  const lines = [
    '.2D',
    '.UNITS METERS DD',
    '.ORDER EN',
    `.CRS GRID ${network.crsId}`,
  ];
  const approximateStations = network.stations.map((station) => {
    const approx = perturbApproximation(station);
    const fixedSuffix = station.role === 'fixed' ? ' ! !' : '';
    lines.push(
      `C ${station.id} ${approx.easting.toFixed(4)} ${approx.northing.toFixed(4)} ${station.elevation.toFixed(3)}${fixedSuffix}`,
    );
    return {
      id: station.id,
      easting: approx.easting,
      northing: approx.northing,
      elevation: station.elevation,
    };
  });
  const observationLines = [
    dist('A', 'C'),
    bearing('A', 'C'),
    dist('B', 'C'),
    bearing('B', 'C'),
    dist('A', 'D'),
    bearing('A', 'D'),
    dist('B', 'D'),
    bearing('B', 'D'),
    dist('C', 'D'),
    dist('C', 'L'),
    dist('D', 'L'),
  ];
  lines.push(...observationLines);

  if (!stationMap.has('A') || !stationMap.has('B')) {
    throw new Error('Synthetic observation generator requires fixed A/B control stations.');
  }

  return {
    input: lines.join('\n'),
    approximateStations,
  };
};
