import proj4 from 'proj4';

import { RAD_TO_DEG } from './angles';
import { getCanadianCrsDefinitionForTest } from './canadianCrsTestCatalog';
import { computeElevationFactor, computeGridFactors } from './geodesy';
import type {
  SyntheticCanadianNetwork,
  TrueStation,
} from './generateSyntheticCanadianNetwork';

export type SyntheticObservationNoiseMode = 'noise-free' | 'noisy';
export interface SyntheticObservationGenerationOptions {
  includeBearings?: boolean;
  includeAngles?: boolean;
  includeDirections?: boolean;
}
export interface SyntheticObservationInputRenderOptions {
  observationOrder?: 'default' | 'reverse';
  directionSetupOrder?: 'default' | 'reverse';
}

export interface SyntheticObservationJob {
  input: string;
  headerLines: string[];
  stationLines: string[];
  plainObservationLines: string[];
  directionSetBlocks: string[][];
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

const wrap360 = (value: number): number => {
  let wrapped = value % 360;
  if (wrapped < 0) wrapped += 360;
  return wrapped;
};

const turnedAngleDeg = (at: TrueStation, from: TrueStation, to: TrueStation): number =>
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

const angleTripletsForTemplate = (network: SyntheticCanadianNetwork): Array<[string, string, string]> => {
  switch (network.template) {
    case 'braced-quadrilateral':
      return [
        ['C', 'A', 'D'],
        ['D', 'C', 'B'],
        ['D', 'C', 'L'],
      ];
    case 'short-traverse':
      return [
        ['C', 'A', 'D'],
        ['D', 'C', 'B'],
        ['L', 'D', 'B'],
      ];
    case 'loop':
      return [
        ['C', 'A', 'B'],
        ['D', 'C', 'E'],
        ['E', 'D', 'B'],
      ];
    case 'mixed-3d':
      return [
        ['C', 'A', 'D'],
        ['D', 'B', 'L'],
        ['L', 'C', 'E'],
      ];
    default:
      return [];
  }
};

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

const directionSetConfigsForTemplate = (
  network: SyntheticCanadianNetwork,
): Array<{ occupy: string; backsight: string; targets: string[] }> => {
  switch (network.template) {
    case 'braced-quadrilateral':
      return [
        { occupy: 'C', backsight: 'A', targets: ['D', 'L'] },
        { occupy: 'D', backsight: 'B', targets: ['C', 'L'] },
      ];
    case 'short-traverse':
      return [
        { occupy: 'C', backsight: 'A', targets: ['D'] },
        { occupy: 'D', backsight: 'B', targets: ['C', 'L'] },
      ];
    case 'loop':
      return [
        { occupy: 'C', backsight: 'A', targets: ['B', 'D'] },
        { occupy: 'D', backsight: 'C', targets: ['E', 'L'] },
      ];
    case 'mixed-3d':
      return [
        { occupy: 'C', backsight: 'A', targets: ['B', 'D', 'L'] },
        { occupy: 'D', backsight: 'B', targets: ['C', 'E', 'L'] },
      ];
    default:
      return [];
  }
};

export const renderSyntheticObservationJob = (
  job: Pick<
    SyntheticObservationJob,
    'headerLines' | 'stationLines' | 'plainObservationLines' | 'directionSetBlocks'
  >,
  options: SyntheticObservationInputRenderOptions = {},
): string => {
  const observationOrder = options.observationOrder ?? 'default';
  const directionSetupOrder = options.directionSetupOrder ?? 'default';
  const plainObservationLines =
    observationOrder === 'reverse'
      ? [...job.plainObservationLines].reverse()
      : [...job.plainObservationLines];
  const directionSetBlocks =
    directionSetupOrder === 'reverse'
      ? [...job.directionSetBlocks].reverse()
      : [...job.directionSetBlocks];
  return [
    ...job.headerLines,
    ...job.stationLines,
    ...plainObservationLines,
    ...directionSetBlocks.flat(),
  ].join('\n');
};

const renameStationToken = (token: string, mapping: Record<string, string>): string =>
  mapping[token] ?? token;

const renamePairToken = (token: string, mapping: Record<string, string>): string =>
  token
    .split('-')
    .map((part) => renameStationToken(part, mapping))
    .join('-');

const renameSyntheticObservationLine = (line: string, mapping: Record<string, string>): string => {
  const parts = line.split(' ');
  const code = parts[0];
  if (code == null) return line;
  if (code === 'C' && parts[1]) {
    parts[1] = renameStationToken(parts[1], mapping);
    return parts.join(' ');
  }
  if ((code === 'D' || code === 'B' || code === 'V' || code === 'DV' || code === 'A') && parts[1]) {
    parts[1] = renamePairToken(parts[1], mapping);
    return parts.join(' ');
  }
  if (code === 'DB') {
    if (parts[1]) parts[1] = renameStationToken(parts[1], mapping);
    if (parts[2]) parts[2] = renameStationToken(parts[2], mapping);
    return parts.join(' ');
  }
  if ((code === 'DN' || code === 'DM') && parts[1]) {
    parts[1] = renameStationToken(parts[1], mapping);
    return parts.join(' ');
  }
  return line;
};

export const renameSyntheticObservationJob = (
  job: SyntheticObservationJob,
  mapping: Record<string, string>,
): SyntheticObservationJob => {
  const stationLines = job.stationLines.map((line) => renameSyntheticObservationLine(line, mapping));
  const plainObservationLines = job.plainObservationLines.map((line) =>
    renameSyntheticObservationLine(line, mapping),
  );
  const directionSetBlocks = job.directionSetBlocks.map((block) =>
    block.map((line) => renameSyntheticObservationLine(line, mapping)),
  );
  const approximateStations = job.approximateStations.map((station) => ({
    ...station,
    id: renameStationToken(station.id, mapping),
  }));
  return {
    ...job,
    stationLines,
    plainObservationLines,
    directionSetBlocks,
    approximateStations,
    input: renderSyntheticObservationJob({
      headerLines: job.headerLines,
      stationLines,
      plainObservationLines,
      directionSetBlocks,
    }),
  };
};

export const generateSyntheticObservations = ({
  network,
  mode = 'noise-free',
  distanceSigmaM = 0.002,
  bearingSigmaSec = 1.5,
  zenithSigmaSec = 2.0,
  defaultHiM = 1.5,
  defaultHtM = 1.7,
  includeBearings = true,
  includeAngles = false,
  includeDirections = false,
}: {
  network: SyntheticCanadianNetwork;
  mode?: SyntheticObservationNoiseMode;
  distanceSigmaM?: number;
  bearingSigmaSec?: number;
  zenithSigmaSec?: number;
  defaultHiM?: number;
  defaultHtM?: number;
} & SyntheticObservationGenerationOptions): SyntheticObservationJob => {
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
  const angle = (atId: string, fromId: string, toId: string): string => {
    const at = findStation(network, atId);
    const from = findStation(network, fromId);
    const to = findStation(network, toId);
    const value = turnedAngleDeg(at, from, to) + measurementNoise(bearingSigmaSec / 3600);
    return `A ${atId}-${fromId}-${toId} ${value.toFixed(8)} ${bearingSigmaSec.toFixed(2)}`;
  };
  const directionSetBlock = (occupyId: string, backsightId: string, targetIds: string[]): string[] => {
    const occupy = findStation(network, occupyId);
    const backsight = findStation(network, backsightId);
    const backsightReading = measurementNoise(bearingSigmaSec / 3600);
    const lines = [
      `DB ${occupyId} ${backsightId}`,
      `DN ${backsightId} ${wrap360(backsightReading).toFixed(8)} ${bearingSigmaSec.toFixed(2)}`,
    ];
    targetIds.forEach((targetId) => {
      const target = findStation(network, targetId);
      const directionValue =
        wrap360(azimuthDeg(occupy, target) - azimuthDeg(occupy, backsight)) +
        measurementNoise(bearingSigmaSec / 3600);
      const distanceValue =
        distanceMeters(occupy, target, defaultHiM, defaultHtM, network.coordMode) +
        measurementNoise(distanceSigmaM);
      if (network.coordMode === '3D') {
        const zenithValue =
          zenithDeg(network, occupy, target, defaultHiM, defaultHtM) +
          measurementNoise(zenithSigmaSec / 3600);
        lines.push(
          `DM ${targetId} ${directionValue.toFixed(8)} ${distanceValue.toFixed(4)} ${zenithValue.toFixed(8)} ${bearingSigmaSec.toFixed(2)} ${distanceSigmaM.toFixed(4)} ${zenithSigmaSec.toFixed(2)} ${hiHtToken(defaultHiM, defaultHtM)}`,
        );
      } else {
        lines.push(
          `DM ${targetId} ${directionValue.toFixed(8)} ${distanceValue.toFixed(4)} 90.00000000 ${bearingSigmaSec.toFixed(2)} ${distanceSigmaM.toFixed(4)} ${zenithSigmaSec.toFixed(2)} ${hiHtToken(defaultHiM, defaultHtM)}`,
        );
      }
    });
    lines.push('DE');
    return lines;
  };

  const headerLines = [
    network.coordMode === '3D' ? '.3D' : '.2D',
    '.UNITS METERS DD',
    '.ORDER EN',
    `.CRS GRID ${network.crsId}`,
  ];
  const stationLines: string[] = [];
  const approximateStations = network.stations.map((station) => {
    const approx = perturbApproximation(station);
    const fixedSuffix =
      station.role === 'fixed'
        ? network.coordMode === '3D'
          ? ' ! ! !'
          : ' ! !'
        : '';
    stationLines.push(
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

  const plainObservationLines: string[] = [];
  edges.forEach(([fromId, toId]) => {
    if (network.coordMode === '3D') {
      plainObservationLines.push(distanceAndZenith(fromId, toId));
    } else {
      plainObservationLines.push(dist(fromId, toId));
    }
    if (includeBearings) {
      plainObservationLines.push(bearing(fromId, toId));
    }
  });
  if (includeAngles) {
    angleTripletsForTemplate(network).forEach(([atId, fromId, toId]) => {
      plainObservationLines.push(angle(atId, fromId, toId));
    });
  }
  const directionSetBlocks = includeDirections
    ? directionSetConfigsForTemplate(network).map((config) =>
        directionSetBlock(config.occupy, config.backsight, config.targets),
      )
    : [];
  const input = renderSyntheticObservationJob({
    headerLines,
    stationLines,
    plainObservationLines,
    directionSetBlocks,
  });

  return {
    input,
    headerLines,
    stationLines,
    plainObservationLines,
    directionSetBlocks,
    approximateStations,
  };
};
