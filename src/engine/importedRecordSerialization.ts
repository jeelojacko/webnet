import { DEG_TO_RAD, radToDmsStr } from './angles';
import type {
  ImportedControlStationRecord,
  ImportedObservationRecord,
} from './importers';

const formatNumber = (value: number, decimals: number): string => value.toFixed(decimals);

const toDmsString = (valueDeg: number): string => radToDmsStr(valueDeg * DEG_TO_RAD);

const appendDescription = (line: string, description?: string): string =>
  description ? `${line} '${description}` : line;

const formatHiHt = (hiM?: number, htM?: number): string | undefined =>
  hiM != null || htM != null ? `${formatNumber(hiM ?? 0, 4)}/${formatNumber(htM ?? 0, 4)}` : undefined;

const formatImportedVerticalValue = (
  verticalMode: 'delta-h' | 'zenith',
  verticalValue: number,
): string => (verticalMode === 'zenith' ? toDmsString(verticalValue) : formatNumber(verticalValue, 4));

const formatFromToToken = (fromId: string, toId: string): string => `${fromId}-${toId}`;

export const serializeImportedControlStationRecord = (
  station: ImportedControlStationRecord,
  _coordMode: '2D' | '3D' = '3D',
  stripHeight = false,
  orderMode: 'EN' | 'NE' = 'EN',
): string => {
  if (station.coordinateMode === 'geodetic') {
    const includeHeight = !stripHeight;
    const recordType = includeHeight && station.heightDatum === 'ellipsoid' ? 'PH' : 'P';
    const tokens = [
      recordType,
      station.stationId,
      formatNumber(station.latitudeDeg ?? 0, 9),
      formatNumber(station.longitudeDeg ?? 0, 9),
    ];
    if (includeHeight) {
      tokens.push(formatNumber(station.heightM ?? 0, 4));
    }
    if (
      station.sigmaNorthM != null ||
      station.sigmaEastM != null ||
      (includeHeight && station.sigmaHeightM != null) ||
      station.corrEN != null
    ) {
      tokens.push(
        formatNumber(station.sigmaNorthM ?? 0, 4),
        formatNumber(station.sigmaEastM ?? 0, 4),
      );
      if (includeHeight) {
        tokens.push(formatNumber(station.sigmaHeightM ?? 0, 4));
      }
      if (station.corrEN != null) {
        tokens.push(formatNumber(station.corrEN ?? 0, 4));
      }
    }
    return appendDescription(tokens.join(' '), station.description);
  }

  const includeHeight = !stripHeight;
  const coordinateTokens =
    orderMode === 'NE'
      ? [formatNumber(station.northM ?? 0, 4), formatNumber(station.eastM ?? 0, 4)]
      : [formatNumber(station.eastM ?? 0, 4), formatNumber(station.northM ?? 0, 4)];
  const tokens = [
    'C',
    station.stationId,
    ...coordinateTokens,
  ];
  if (includeHeight) {
    tokens.push(formatNumber(station.heightM ?? 0, 4));
  }
  if (
    station.sigmaEastM != null ||
    station.sigmaNorthM != null ||
    (includeHeight && station.sigmaHeightM != null) ||
    station.corrEN != null
  ) {
    tokens.push(
      ...(orderMode === 'NE'
        ? [formatNumber(station.sigmaNorthM ?? 0, 4), formatNumber(station.sigmaEastM ?? 0, 4)]
        : [formatNumber(station.sigmaEastM ?? 0, 4), formatNumber(station.sigmaNorthM ?? 0, 4)]),
    );
    if (includeHeight) {
      tokens.push(formatNumber(station.sigmaHeightM ?? 0, 4));
    }
    if (station.corrEN != null) {
      tokens.push(formatNumber(station.corrEN ?? 0, 4));
    }
  }
  return appendDescription(tokens.join(' '), station.description);
};

export const serializeImportedObservationRecord = (
  observation: ImportedObservationRecord,
): string[] => {
  if (observation.kind === 'gnss-vector') {
    const tokens = [
      'G',
      'GPS',
      observation.fromId,
      observation.toId,
      formatNumber(observation.deltaEastM, 4),
      formatNumber(observation.deltaNorthM, 4),
    ];
    if (observation.deltaHeightM != null) {
      tokens.push(
        formatNumber(observation.deltaHeightM, 4),
        formatNumber(observation.sigmaEastM ?? 0, 4),
        formatNumber(observation.sigmaNorthM ?? 0, 4),
        formatNumber(observation.sigmaHeightM ?? 0, 4),
        formatNumber(observation.corrEN ?? 0, 4),
      );
    } else {
      tokens.push(
        formatNumber(observation.sigmaEastM ?? 0, 4),
        formatNumber(observation.sigmaNorthM ?? observation.sigmaEastM ?? 0, 4),
        formatNumber(observation.corrEN ?? 0, 4),
      );
    }
    return [tokens.join(' ')];
  }

  if (observation.kind === 'distance') {
    const tokens = [
      'D',
      observation.fromId,
      observation.toId,
      formatNumber(observation.distanceM, 4),
    ];
    const hiHt = formatHiHt(observation.hiM, observation.htM);
    if (hiHt) tokens.push(hiHt);
    return [tokens.join(' ')];
  }

  if (observation.kind === 'distance-vertical') {
    const tokens = [
      'DV',
      observation.fromId,
      observation.toId,
      formatNumber(observation.distanceM, 4),
      formatImportedVerticalValue(observation.verticalMode, observation.verticalValue),
    ];
    const hiHt = formatHiHt(observation.hiM, observation.htM);
    if (hiHt) tokens.push(hiHt);
    return [observation.verticalMode === 'delta-h' ? '.DELTA ON' : '.DELTA OFF', tokens.join(' ')];
  }

  if (observation.kind === 'vertical') {
    const tokens = [
      'V',
      formatFromToToken(observation.fromId, observation.toId),
      formatImportedVerticalValue(observation.verticalMode, observation.verticalValue),
    ];
    const hiHt = formatHiHt(observation.hiM, observation.htM);
    if (hiHt) tokens.push(hiHt);
    return [observation.verticalMode === 'delta-h' ? '.DELTA ON' : '.DELTA OFF', tokens.join(' ')];
  }

  if (observation.kind === 'bearing') {
    return [
      ['B', observation.fromId, observation.toId, formatNumber(observation.bearingDeg, 4)].join(
        ' ',
      ),
    ];
  }

  if (observation.kind === 'angle') {
    return [
      [
        'A',
        `${observation.atId}-${observation.fromId}-${observation.toId}`,
        toDmsString(observation.angleDeg),
      ].join(' '),
    ];
  }

  if (observation.kind === 'measurement') {
    const tokens = [
      'M',
      `${observation.atId}-${observation.fromId}-${observation.toId}`,
      toDmsString(observation.angleDeg),
      formatNumber(observation.distanceM, 4),
    ];
    if (observation.verticalMode && observation.verticalValue != null) {
      tokens.push(formatImportedVerticalValue(observation.verticalMode, observation.verticalValue));
    }
    const hiHt = formatHiHt(observation.hiM, observation.htM);
    if (hiHt) tokens.push(hiHt);
    return [observation.verticalMode === 'delta-h' ? '.DELTA ON' : '.DELTA OFF', tokens.join(' ')];
  }

  return [];
};
