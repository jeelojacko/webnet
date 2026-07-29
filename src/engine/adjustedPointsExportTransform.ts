import type {
  AdjustedPointsExportSettings,
  AdjustedPointsTransformScope,
  AdjustedPointsTransformSettings,
  AdjustedPointsTranslationMethod,
  AdjustmentResult,
} from '../types';
import { DEG_TO_RAD, RAD_TO_DEG } from './angles';
import { sanitizeAdjustedPointsExportSettings } from './adjustedPointsExportSettings';

const FT_PER_M = 3.280839895;
const TRANSFORM_ZERO_EPSILON = 1e-10;

export interface AdjustedPointsTransformPreview {
  enabled: boolean;
  available: boolean;
  reason: string;
  referenceStationId: string;
  scope: AdjustedPointsTransformScope;
  scopedStationIds: string[];
  transformedByStationId: Map<string, { east: number; north: number }>;
  scaleEnabled: boolean;
  scaleFactor: number;
  rotationEnabled: boolean;
  rotationAngleDeg: number;
  translationEnabled: boolean;
  translationMethod: AdjustedPointsTranslationMethod;
  translationAzimuthDeg: number;
  translationDistanceM: number;
  translationDeltaEastM: number;
  translationDeltaNorthM: number;
}

const normalizeAngle360 = (valueDeg: number): number => {
  if (!Number.isFinite(valueDeg)) return 0;
  let wrapped = valueDeg % 360;
  if (wrapped < 0) wrapped += 360;
  if (Math.abs(wrapped) < TRANSFORM_ZERO_EPSILON) return 0;
  return wrapped;
};

const hasAnyTransformEnabled = (transform: AdjustedPointsTransformSettings): boolean =>
  transform.rotation.enabled || transform.translation.enabled || transform.scale.enabled;

export const getAdjustedPointsExportStationIds = (
  result: AdjustmentResult,
  includeLostStations: boolean,
): string[] =>
  Object.entries(result.stations)
    .filter(([, station]) => includeLostStations || !station.lost)
    .map(([stationId]) => stationId)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

export const validateAdjustedPointsTransform = (params: {
  result: AdjustmentResult;
  settings: AdjustedPointsExportSettings;
  includeLostStations?: boolean;
}): { valid: true } | { valid: false; message: string } => {
  const { result, settings, includeLostStations } = params;
  const cleanSettings = sanitizeAdjustedPointsExportSettings(settings);
  const transform = cleanSettings.transform;
  if (!hasAnyTransformEnabled(transform)) return { valid: true };
  if (!transform.referenceStationId) {
    return { valid: false, message: 'Transform requires a reference station.' };
  }
  const exportIncludeLostStations = includeLostStations ?? cleanSettings.includeLostStations;
  const stationIds = getAdjustedPointsExportStationIds(result, exportIncludeLostStations);
  const stationIdSet = new Set(stationIds);
  if (!stationIdSet.has(transform.referenceStationId)) {
    return {
      valid: false,
      message: 'Transform reference station must be in the current adjusted-points export set.',
    };
  }
  if (transform.scale.enabled && (!Number.isFinite(transform.scale.factor) || transform.scale.factor <= 0)) {
    return { valid: false, message: 'Scale factor must be greater than 0.' };
  }
  if (transform.rotation.enabled) {
    if (!Number.isFinite(transform.rotation.angleDeg)) {
      return { valid: false, message: 'Rotation angle must be a valid number.' };
    }
    if (transform.rotation.angleDeg > 360) {
      return { valid: false, message: 'Rotation direction cannot be above 360.' };
    }
  }
  if (transform.translation.enabled) {
    if (transform.translation.method === 'direction-distance') {
      if (!Number.isFinite(transform.translation.azimuthDeg)) {
        return { valid: false, message: 'Translation azimuth must be a valid angle.' };
      }
      if (transform.translation.azimuthDeg < 0 || transform.translation.azimuthDeg > 360) {
        return { valid: false, message: 'Translation direction must be between 0 and 360.' };
      }
      if (!Number.isFinite(transform.translation.distance) || transform.translation.distance < 0) {
        return { valid: false, message: 'Translation distance must be zero or greater.' };
      }
    } else if (
      !Number.isFinite(transform.translation.targetE) ||
      !Number.isFinite(transform.translation.targetN)
    ) {
      return { valid: false, message: 'Translation target E/N must be valid numbers.' };
    }
  }
  return { valid: true };
};

export const validateAdjustedPointsRotationTransform = (params: {
  result: AdjustmentResult;
  settings: AdjustedPointsExportSettings;
}): { valid: true } | { valid: false; message: string } => {
  const cleanSettings = sanitizeAdjustedPointsExportSettings(params.settings);
  if (!cleanSettings.transform.rotation.enabled) return { valid: true };
  const rotationOnlySettings: AdjustedPointsExportSettings = {
    ...cleanSettings,
    transform: {
      ...cleanSettings.transform,
      translation: { ...cleanSettings.transform.translation, enabled: false },
      scale: { ...cleanSettings.transform.scale, enabled: false, factor: 1 },
    },
  };
  const validation = validateAdjustedPointsTransform({
    result: params.result,
    settings: rotationOnlySettings,
  });
  if (validation.valid) return validation;
  if (validation.message === 'Transform requires a reference station.') {
    return { valid: false, message: 'Rotation requires a pivot station.' };
  }
  if (validation.message.includes('reference station')) {
    return {
      valid: false,
      message: 'Rotation pivot must be in the current adjusted-points export set.',
    };
  }
  return validation;
};

const toMeters = (value: number, units: 'm' | 'ft'): number =>
  units === 'ft' ? value / FT_PER_M : value;

const clampTiny = (value: number): number =>
  Math.abs(value) < TRANSFORM_ZERO_EPSILON ? 0 : value;

const resolveTransformScopeStationIds = (params: {
  stationIds: string[];
  transform: AdjustedPointsTransformSettings;
}): string[] => {
  const { stationIds, transform } = params;
  if (transform.scope === 'all') return [...stationIds];
  const stationIdSet = new Set(stationIds);
  return [
    ...new Set(
      [...transform.selectedStationIds, transform.referenceStationId].filter((stationId) =>
        stationIdSet.has(stationId),
      ),
    ),
  ];
};

export const buildAdjustedPointsTransformPreview = (params: {
  result: AdjustmentResult;
  settings: AdjustedPointsExportSettings;
  units: 'm' | 'ft';
  includeLostStations?: boolean;
}): AdjustedPointsTransformPreview => {
  const { result, settings, units, includeLostStations } = params;
  const cleanSettings = sanitizeAdjustedPointsExportSettings(settings);
  const transform = cleanSettings.transform;
  const emptyMap = new Map<string, { east: number; north: number }>();
  const enabled = hasAnyTransformEnabled(transform);
  const exportIncludeLostStations = includeLostStations ?? cleanSettings.includeLostStations;
  const stationIds = getAdjustedPointsExportStationIds(result, exportIncludeLostStations);

  const basePreview: AdjustedPointsTransformPreview = {
    enabled,
    available: false,
    reason: '',
    referenceStationId: transform.referenceStationId,
    scope: transform.scope,
    scopedStationIds: [],
    transformedByStationId: emptyMap,
    scaleEnabled: transform.scale.enabled,
    scaleFactor: transform.scale.factor,
    rotationEnabled: transform.rotation.enabled,
    rotationAngleDeg: transform.rotation.angleDeg,
    translationEnabled: transform.translation.enabled,
    translationMethod: transform.translation.method,
    translationAzimuthDeg: transform.translation.azimuthDeg,
    translationDistanceM: 0,
    translationDeltaEastM: 0,
    translationDeltaNorthM: 0,
  };
  if (!enabled) return basePreview;

  const validation = validateAdjustedPointsTransform({
    result,
    settings: cleanSettings,
    includeLostStations: exportIncludeLostStations,
  });
  if (!validation.valid) {
    return { ...basePreview, reason: validation.message };
  }
  const reference = result.stations[transform.referenceStationId];
  if (!reference) {
    return {
      ...basePreview,
      reason: 'Transform reference station was not found in adjusted stations.',
    };
  }
  const scopedStationIds = resolveTransformScopeStationIds({ stationIds, transform });
  if (scopedStationIds.length === 0) {
    return {
      ...basePreview,
      reason: 'Transform scope resolved to no stations in the current export set.',
    };
  }
  const scopedStationSet = new Set(scopedStationIds);
  let translationDeltaEastM = 0;
  let translationDeltaNorthM = 0;
  let translationDistanceM = 0;
  let translationAzimuthDeg = transform.translation.azimuthDeg;
  if (transform.translation.enabled) {
    if (transform.translation.method === 'direction-distance') {
      translationDistanceM = Math.max(0, toMeters(transform.translation.distance, units));
      const azimuthRad = normalizeAngle360(transform.translation.azimuthDeg) * DEG_TO_RAD;
      translationDeltaEastM = translationDistanceM * Math.sin(azimuthRad);
      translationDeltaNorthM = translationDistanceM * Math.cos(azimuthRad);
      translationAzimuthDeg = normalizeAngle360(transform.translation.azimuthDeg);
    } else {
      const targetEastM = toMeters(transform.translation.targetE, units);
      const targetNorthM = toMeters(transform.translation.targetN, units);
      translationDeltaEastM = targetEastM - reference.x;
      translationDeltaNorthM = targetNorthM - reference.y;
      translationDistanceM = Math.hypot(translationDeltaEastM, translationDeltaNorthM);
      translationAzimuthDeg =
        translationDistanceM > TRANSFORM_ZERO_EPSILON
          ? normalizeAngle360(Math.atan2(translationDeltaEastM, translationDeltaNorthM) * RAD_TO_DEG)
          : 0;
    }
  }

  const rotationAngleRad = transform.rotation.angleDeg * DEG_TO_RAD;
  const rotationCos = Math.cos(rotationAngleRad);
  const rotationSin = Math.sin(rotationAngleRad);
  const transformedByStationId = new Map<string, { east: number; north: number }>();
  stationIds.forEach((stationId) => {
    const station = result.stations[stationId];
    if (!station) return;
    let east = station.x;
    let north = station.y;
    if (scopedStationSet.has(stationId)) {
      if (transform.scale.enabled) {
        east = reference.x + (east - reference.x) * transform.scale.factor;
        north = reference.y + (north - reference.y) * transform.scale.factor;
      }
      if (transform.rotation.enabled) {
        const dEast = east - reference.x;
        const dNorth = north - reference.y;
        east = reference.x + dEast * rotationCos - dNorth * rotationSin;
        north = reference.y + dEast * rotationSin + dNorth * rotationCos;
      }
      if (transform.translation.enabled) {
        east += translationDeltaEastM;
        north += translationDeltaNorthM;
      }
    }
    transformedByStationId.set(stationId, {
      east: clampTiny(east),
      north: clampTiny(north),
    });
  });

  return {
    ...basePreview,
    available: transformedByStationId.size > 0,
    reason:
      transformedByStationId.size > 0
        ? ''
        : 'Transform scope resolved to no adjusted stations after filtering.',
    scopedStationIds,
    transformedByStationId,
    translationAzimuthDeg,
    translationDistanceM,
    translationDeltaEastM,
    translationDeltaNorthM,
  };
};
