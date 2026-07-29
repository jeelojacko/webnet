import {
  azimuthDeg,
  createMulberry32,
  distanceMeters,
  findStation,
  gaussianNoise,
  hiHtToken,
  precisionDigits,
  turnedAngleDeg,
  wrap360,
  zenithDeg,
} from './generateSyntheticObservationGeometry';
import { renderSyntheticObservationJob } from './generateSyntheticObservationJob';
import {
  angleTripletsForTemplate,
  directionSetConfigsForTemplate,
  edgesForTemplate,
} from './generateSyntheticObservationTemplates';
import type {
  SyntheticCanadianNetwork,
  TrueStation,
} from './generateSyntheticCanadianNetwork';
import type {
  SyntheticObservationGenerationOptions,
  SyntheticObservationJob,
  SyntheticObservationNoiseMode,
} from './generateSyntheticObservations.types';

export {
  renameSyntheticObservationJob,
  renderSyntheticObservationJob,
} from './generateSyntheticObservationJob';
export type {
  SyntheticObservationGenerationOptions,
  SyntheticObservationInputRenderOptions,
  SyntheticObservationJob,
  SyntheticObservationNoiseMode,
  SyntheticObservationPrecisionMode,
} from './generateSyntheticObservations.types';

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
  precisionMode = 'standard',
}: {
  network: SyntheticCanadianNetwork;
  mode?: SyntheticObservationNoiseMode;
  distanceSigmaM?: number;
  bearingSigmaSec?: number;
  zenithSigmaSec?: number;
  defaultHiM?: number;
  defaultHtM?: number;
} & SyntheticObservationGenerationOptions): SyntheticObservationJob => {
  const digits = precisionDigits(precisionMode);
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
      ? `D ${fromId}-${toId} ${value.toFixed(digits.distance)} ${distanceSigmaM.toFixed(digits.sigmaDistance)} ${hiHtToken(defaultHiM, defaultHtM)}`
      : `D ${fromId}-${toId} ${value.toFixed(digits.distance)} ${distanceSigmaM.toFixed(digits.sigmaDistance)}`;
  };
  const bearing = (fromId: string, toId: string): string => {
    const from = findStation(network, fromId);
    const to = findStation(network, toId);
    const value = azimuthDeg(from, to) + measurementNoise(bearingSigmaSec / 3600);
    return `B ${fromId}-${toId} ${value.toFixed(digits.angle)} ${bearingSigmaSec.toFixed(digits.sigmaAngle)}`;
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
    return `DV ${fromId}-${toId} ${distanceValue.toFixed(digits.distance)} ${zenithValue.toFixed(digits.angle)} ${distanceSigmaM.toFixed(digits.sigmaDistance)} ${zenithSigmaSec.toFixed(digits.sigmaAngle)} ${hiHtToken(defaultHiM, defaultHtM)}`;
  };
  const angle = (atId: string, fromId: string, toId: string): string => {
    const at = findStation(network, atId);
    const from = findStation(network, fromId);
    const to = findStation(network, toId);
    const value = turnedAngleDeg(at, from, to) + measurementNoise(bearingSigmaSec / 3600);
    return `A ${atId}-${fromId}-${toId} ${value.toFixed(digits.angle)} ${bearingSigmaSec.toFixed(digits.sigmaAngle)}`;
  };
  const directionSetBlock = (occupyId: string, backsightId: string, targetIds: string[]): string[] => {
    const occupy = findStation(network, occupyId);
    const backsight = findStation(network, backsightId);
    const backsightReading = measurementNoise(bearingSigmaSec / 3600);
    const lines = [
      `DB ${occupyId} ${backsightId}`,
      `DN ${backsightId} ${wrap360(backsightReading).toFixed(digits.angle)} ${bearingSigmaSec.toFixed(digits.sigmaAngle)}`,
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
          `DM ${targetId} ${directionValue.toFixed(digits.angle)} ${distanceValue.toFixed(digits.distance)} ${zenithValue.toFixed(digits.angle)} ${bearingSigmaSec.toFixed(digits.sigmaAngle)} ${distanceSigmaM.toFixed(digits.sigmaDistance)} ${zenithSigmaSec.toFixed(digits.sigmaAngle)} ${hiHtToken(defaultHiM, defaultHtM)}`,
        );
      } else {
        lines.push(
          `DM ${targetId} ${directionValue.toFixed(digits.angle)} ${distanceValue.toFixed(digits.distance)} ${(90).toFixed(digits.angle)} ${bearingSigmaSec.toFixed(digits.sigmaAngle)} ${distanceSigmaM.toFixed(digits.sigmaDistance)} ${zenithSigmaSec.toFixed(digits.sigmaAngle)} ${hiHtToken(defaultHiM, defaultHtM)}`,
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
      `C ${station.id} ${approx.easting.toFixed(digits.stationEN)} ${approx.northing.toFixed(digits.stationEN)} ${approx.elevation.toFixed(digits.stationH)}${fixedSuffix}`,
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
