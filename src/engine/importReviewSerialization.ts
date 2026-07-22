import { DEG_TO_RAD, RAD_TO_DEG } from './angles';
import type {
  ImportedAngleObservationRecord,
  ImportedMeasurementObservationRecord,
  ImportedObservationRecord,
} from './importers';
import { serializeImportedObservationRecord } from './importedRecordSerialization';
import type { ImportReviewOutputPreset, ImportReviewRowTypeOverride } from './importReviewTypes';
import {
  formatAngleDms,
  formatFromToToken,
  formatLinear,
  formatLinear3,
  inferDirectionFaceFromZenithDeg,
  isResectionSetupType,
  normalizeDirectionAngleDeg,
  normalizeDirectionFace,
} from './importReviewFormatters';

export const isIndustryStyleMeasurement = (
  observation: ImportedObservationRecord,
): observation is ImportedMeasurementObservationRecord =>
  observation.kind === 'measurement' &&
  observation.jobXml?.isDirectReading === true &&
  observation.jobXml?.isMta !== true &&
  observation.jobXml?.rawHorizontalCircleDeg != null &&
  observation.jobXml?.observationOrder != null;

const getIndustryStyleObservationCode = (
  observation: ImportedMeasurementObservationRecord,
): string | undefined =>
  observation.description?.trim() ||
  observation.jobXml?.pointCode?.trim() ||
  observation.jobXml?.targetCode?.trim() ||
  undefined;

const getIndustryStyleHiHt = (
  observation: ImportedMeasurementObservationRecord,
): { hiM?: number; htM?: number } => ({
  hiM: observation.jobXml?.effectiveHiM ?? observation.hiM,
  htM: observation.jobXml?.effectiveHtM ?? observation.htM,
});

const normalizeIndustryStyleDirectionAngleDeg = (
  observation: ImportedMeasurementObservationRecord,
): number => {
  const rawHzDeg = observation.jobXml?.rawHorizontalCircleDeg ?? observation.angleDeg;
  let face = normalizeDirectionFace(observation.sourceMeta?.face);
  if (face === 'unresolved') {
    face =
      observation.verticalMode === 'zenith' && observation.verticalValue != null
        ? inferDirectionFaceFromZenithDeg(observation.verticalValue)
        : 'unresolved';
  }
  return normalizeDirectionAngleDeg(face === 'face2' ? rawHzDeg - 180 : rawHzDeg);
};

export const meanIndustryStyleDirectionAngleDeg = (
  observations: ImportedMeasurementObservationRecord[],
): number | undefined => {
  if (observations.length === 0) return undefined;
  const components = observations.map((observation) => {
    const radians = normalizeIndustryStyleDirectionAngleDeg(observation) * DEG_TO_RAD;
    return { sin: Math.sin(radians), cos: Math.cos(radians) };
  });
  const sumSin = components.reduce((acc, value) => acc + value.sin, 0);
  const sumCos = components.reduce((acc, value) => acc + value.cos, 0);
  if (!Number.isFinite(sumSin) || !Number.isFinite(sumCos)) return undefined;
  return normalizeDirectionAngleDeg(Math.atan2(sumSin, sumCos) * RAD_TO_DEG);
};

export const serializeIndustryStyleMeasurement = (
  observation: ImportedMeasurementObservationRecord,
): string => {
  const rawHzDeg = observation.jobXml?.rawHorizontalCircleDeg ?? observation.angleDeg;
  const distanceM = observation.jobXml?.correctedSlopeDistanceM ?? observation.distanceM;
  const rawVerticalDeg =
    observation.jobXml?.rawVerticalCircleDeg ??
    (observation.verticalMode === 'zenith' ? observation.verticalValue : undefined);
  const { hiM, htM } = getIndustryStyleHiHt(observation);
  const tokens = ['DM', observation.toId, formatAngleDms(rawHzDeg), formatLinear(distanceM)];
  if (rawVerticalDeg != null) tokens.push(formatAngleDms(rawVerticalDeg));
  if (hiM != null || htM != null) {
    tokens.push(`${formatLinear3(hiM ?? 0)}/${formatLinear3(htM ?? 0)}`);
  }
  const description = getIndustryStyleObservationCode(observation);
  if (description) tokens.push(`'${description}`);
  return tokens.join(' ');
};

export const serializeObservationPreview = (
  observation: ImportedObservationRecord,
  preset: ImportReviewOutputPreset,
): string => {
  if (preset === 'industry-style' && isIndustryStyleMeasurement(observation)) {
    return serializeIndustryStyleMeasurement(observation);
  }

  const isResection =
    (observation.kind === 'measurement' || observation.kind === 'angle') &&
    isResectionSetupType(observation.sourceMeta?.setupType);

  if (preset !== 'ts-direction-set' || !isResection) {
    return serializeImportedObservationRecord(observation)
      .filter((line) => !line.startsWith('.'))
      .join(' | ');
  }

  if (observation.kind === 'measurement') {
    const tokens = [
      'DM',
      observation.toId,
      formatAngleDms(observation.angleDeg),
      formatLinear(observation.distanceM),
    ];
    if (observation.verticalMode && observation.verticalValue != null) {
      tokens.push(
        observation.verticalMode === 'zenith'
          ? formatAngleDms(observation.verticalValue)
          : formatLinear(observation.verticalValue),
      );
    }
    if (observation.hiM != null || observation.htM != null) {
      tokens.push(`${formatLinear(observation.hiM ?? 0)}/${formatLinear(observation.htM ?? 0)}`);
    }
    return tokens.join(' ');
  }

  if (observation.kind === 'angle') {
    return ['DN', observation.toId, formatAngleDms(observation.angleDeg)].join(' ');
  }

  return serializeImportedObservationRecord(observation)
    .filter((line) => !line.startsWith('.'))
    .join(' | ');
};

const serializeDistanceFocusedObservation = (observation: ImportedObservationRecord): string[] => {
  if (observation.kind === 'measurement') {
    return [
      ['D', observation.atId, observation.toId, formatLinear(observation.distanceM)].join(' '),
    ];
  }
  if (observation.kind === 'distance-vertical') {
    return [
      ['D', observation.fromId, observation.toId, formatLinear(observation.distanceM)].join(' '),
    ];
  }
  if (observation.kind === 'distance') {
    return [
      ['D', observation.fromId, observation.toId, formatLinear(observation.distanceM)].join(' '),
    ];
  }
  return serializeImportedObservationRecord(observation);
};

const serializeDistanceVerticalFocusedObservation = (
  observation: ImportedObservationRecord,
): string[] => {
  if (observation.kind === 'measurement') {
    if (observation.verticalMode && observation.verticalValue != null) {
      return [
        observation.verticalMode === 'delta-h' ? '.DELTA ON' : '.DELTA OFF',
        [
          'DV',
          observation.atId,
          observation.toId,
          formatLinear(observation.distanceM),
          observation.verticalMode === 'zenith'
            ? formatAngleDms(observation.verticalValue)
            : formatLinear(observation.verticalValue),
        ].join(' '),
      ];
    }
    return [
      ['D', observation.atId, observation.toId, formatLinear(observation.distanceM)].join(' '),
    ];
  }
  if (observation.kind === 'distance-vertical') {
    return [
      observation.verticalMode === 'delta-h' ? '.DELTA ON' : '.DELTA OFF',
      [
        'DV',
        observation.fromId,
        observation.toId,
        formatLinear(observation.distanceM),
        observation.verticalMode === 'zenith'
          ? formatAngleDms(observation.verticalValue)
          : formatLinear(observation.verticalValue),
      ].join(' '),
    ];
  }
  if (observation.kind === 'distance') {
    return [
      ['D', observation.fromId, observation.toId, formatLinear(observation.distanceM)].join(' '),
    ];
  }
  return serializeImportedObservationRecord(observation);
};

const serializeAngleFocusedObservation = (observation: ImportedObservationRecord): string[] => {
  if (observation.kind === 'measurement') {
    return [
      [
        'A',
        `${observation.atId}-${observation.fromId}-${observation.toId}`,
        formatAngleDms(observation.angleDeg),
      ].join(' '),
    ];
  }
  if (observation.kind === 'angle') {
    return [
      [
        'A',
        `${observation.atId}-${observation.fromId}-${observation.toId}`,
        formatAngleDms(observation.angleDeg),
      ].join(' '),
    ];
  }
  return serializeImportedObservationRecord(observation);
};

const serializeVerticalFocusedObservation = (observation: ImportedObservationRecord): string[] => {
  if (
    observation.kind === 'measurement' &&
    observation.verticalMode &&
    observation.verticalValue != null
  ) {
    return [
      observation.verticalMode === 'delta-h' ? '.DELTA ON' : '.DELTA OFF',
      [
        'V',
        formatFromToToken(observation.atId, observation.toId),
        observation.verticalMode === 'zenith'
          ? formatAngleDms(observation.verticalValue)
          : formatLinear(observation.verticalValue),
      ].join(' '),
    ];
  }
  if (observation.kind === 'distance-vertical' || observation.kind === 'vertical') {
    return [
      observation.verticalMode === 'delta-h' ? '.DELTA ON' : '.DELTA OFF',
      [
        'V',
        formatFromToToken(observation.fromId, observation.toId),
        observation.verticalMode === 'zenith'
          ? formatAngleDms(observation.verticalValue)
          : formatLinear(observation.verticalValue),
      ].join(' '),
    ];
  }
  return serializeImportedObservationRecord(observation);
};

const serializeBearingFocusedObservation = (observation: ImportedObservationRecord): string[] => {
  if (observation.kind === 'bearing') {
    return [
      ['B', observation.fromId, observation.toId, formatLinear(observation.bearingDeg)].join(' '),
    ];
  }
  return serializeImportedObservationRecord(observation);
};

const serializeDirectionAngleFocusedObservation = (
  observation: ImportedObservationRecord,
): string[] => {
  if (observation.kind === 'measurement') {
    return [['DN', observation.toId, formatAngleDms(observation.angleDeg)].join(' ')];
  }
  if (observation.kind === 'angle') {
    return [['DN', observation.toId, formatAngleDms(observation.angleDeg)].join(' ')];
  }
  return serializeImportedObservationRecord(observation);
};

const serializeDirectionMeasurementFocusedObservation = (
  observation: ImportedObservationRecord,
): string[] => {
  if (observation.kind === 'measurement') {
    const tokens = [
      'DM',
      observation.toId,
      formatAngleDms(observation.angleDeg),
      formatLinear(observation.distanceM),
    ];
    if (observation.verticalMode && observation.verticalValue != null) {
      tokens.push(
        observation.verticalMode === 'zenith'
          ? formatAngleDms(observation.verticalValue)
          : formatLinear(observation.verticalValue),
      );
    }
    return [tokens.join(' ')];
  }
  if (observation.kind === 'angle') {
    return [['DN', observation.toId, formatAngleDms(observation.angleDeg)].join(' ')];
  }
  return serializeImportedObservationRecord(observation);
};

const serializeTsDirectionSetMeasurement = (
  observation: ImportedMeasurementObservationRecord,
): string => {
  return [
    'DM',
    observation.toId,
    formatAngleDms(observation.angleDeg),
    formatLinear(observation.distanceM),
  ].join(' ');
};

const serializeTsDirectionSetAngle = (observation: ImportedAngleObservationRecord): string => {
  return ['DN', observation.toId, formatAngleDms(observation.angleDeg)].join(' ');
};

export const serializeTsDirectionSetRecord = (observation: ImportedObservationRecord): string[] => {
  if (observation.kind === 'measurement') {
    return [serializeTsDirectionSetMeasurement(observation)];
  }
  if (observation.kind === 'angle') {
    return [serializeTsDirectionSetAngle(observation)];
  }
  if (observation.kind === 'distance') {
    return [
      ['D', `${observation.fromId}-${observation.toId}`, formatLinear(observation.distanceM)].join(
        ' ',
      ),
    ];
  }
  if (observation.kind === 'bearing') {
    return [
      [
        'B',
        `${observation.fromId}-${observation.toId}`,
        formatAngleDms(observation.bearingDeg),
      ].join(' '),
    ];
  }
  return serializeImportedObservationRecord(observation);
};

export const serializeObservationForImport = (
  observation: ImportedObservationRecord,
  preset: ImportReviewOutputPreset,
  rowTypeOverride: ImportReviewRowTypeOverride,
): string[] => {
  if (rowTypeOverride === 'distance') {
    return serializeDistanceFocusedObservation(observation);
  }
  if (rowTypeOverride === 'distance-vertical') {
    return serializeDistanceVerticalFocusedObservation(observation);
  }
  if (rowTypeOverride === 'angle') {
    return serializeAngleFocusedObservation(observation);
  }
  if (rowTypeOverride === 'vertical') {
    return serializeVerticalFocusedObservation(observation);
  }
  if (rowTypeOverride === 'bearing') {
    return serializeBearingFocusedObservation(observation);
  }
  if (rowTypeOverride === 'direction-angle') {
    return serializeDirectionAngleFocusedObservation(observation);
  }
  if (rowTypeOverride === 'direction-measurement') {
    return serializeDirectionMeasurementFocusedObservation(observation);
  }
  if (rowTypeOverride === 'measurement') {
    return serializeImportedObservationRecord(observation);
  }
  if (preset === 'industry-style' && isIndustryStyleMeasurement(observation)) {
    return [serializeIndustryStyleMeasurement(observation)];
  }
  if (preset === 'ts-direction-set') {
    return serializeTsDirectionSetRecord(observation);
  }
  return serializeImportedObservationRecord(observation);
};
