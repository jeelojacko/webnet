import type {
  AdjustedPointsColumnId,
  AdjustedPointsDelimiter,
  AdjustedPointsExportSettings,
  AdjustedPointsPresetId,
  AdjustedPointsTransformScope,
  AdjustedPointsTransformSettings,
  AdjustedPointsTranslationMethod,
  AdjustmentResult,
} from '../types';
import { DEG_TO_RAD, RAD_TO_DEG, dmsToRad } from './angles';

const FT_PER_M = 3.280839895;
const MAX_COLUMNS = 6;
const TRANSFORM_ZERO_EPSILON = 1e-10;
const DMS_ANGLE_PATTERN = /^[+-]?\d{1,3}-\d{1,2}-\d{1,2}(?:\.\d+)?$/;

export const ADJUSTED_POINTS_PRESET_COLUMNS: Record<
  Exclude<AdjustedPointsPresetId, 'custom'>,
  AdjustedPointsColumnId[]
> = {
  PNEZD: ['P', 'N', 'E', 'Z', 'D'],
  PENZD: ['P', 'E', 'N', 'Z', 'D'],
  PNEZ: ['P', 'N', 'E', 'Z'],
  PENZ: ['P', 'E', 'N', 'Z'],
  NEZ: ['N', 'E', 'Z'],
  PEN: ['P', 'E', 'N'],
};

export const ADJUSTED_POINTS_ALL_COLUMNS: AdjustedPointsColumnId[] = [
  'P',
  'N',
  'E',
  'Z',
  'D',
  'LAT',
  'LON',
  'EL',
];

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

export const DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS: AdjustedPointsExportSettings = {
  format: 'csv',
  delimiter: 'comma',
  columns: [...ADJUSTED_POINTS_PRESET_COLUMNS.PNEZD],
  presetId: 'PNEZD',
  includeLostStations: true,
  transform: {
    referenceStationId: '',
    scope: 'all',
    selectedStationIds: [],
    rotation: {
      enabled: false,
      angleDeg: 0,
    },
    translation: {
      enabled: false,
      method: 'direction-distance',
      azimuthDeg: 0,
      distance: 0,
      targetE: 0,
      targetN: 0,
    },
    scale: {
      enabled: false,
      factor: 1,
    },
  },
};

const normalizeAngle360 = (valueDeg: number): number => {
  if (!Number.isFinite(valueDeg)) return 0;
  let wrapped = valueDeg % 360;
  if (wrapped < 0) wrapped += 360;
  if (Math.abs(wrapped) < TRANSFORM_ZERO_EPSILON) return 0;
  return wrapped;
};

export const parseAdjustedPointsTransformAngleDegrees = (
  value: string | number | null | undefined,
): number | null => {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return normalizeAngle360(value);
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (DMS_ANGLE_PATTERN.test(trimmed)) {
    const parsed = dmsToRad(trimmed) * RAD_TO_DEG;
    return Number.isFinite(parsed) ? normalizeAngle360(parsed) : null;
  }
  const parsed = Number.parseFloat(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return normalizeAngle360(parsed);
};

const delimiterToken = (delimiter: AdjustedPointsDelimiter): string =>
  delimiter === 'comma' ? ',' : delimiter === 'tab' ? '\t' : ' ';

const quoteCell = (value: string): string => `"${value.replaceAll('"', '""')}"`;

const maybeQuoteCell = (
  value: string,
  delimiter: AdjustedPointsDelimiter,
  format: AdjustedPointsExportSettings['format'],
): string => {
  if (!value) return value;
  const delimiterChar = delimiterToken(delimiter);
  const needsQuote =
    value.includes('"') ||
    value.includes('\n') ||
    value.includes('\r') ||
    value.includes(delimiterChar) ||
    (delimiter === 'space' && /\s/.test(value));
  if (!needsQuote) return value;
  if (format === 'csv' || delimiter !== 'tab') return quoteCell(value);
  return quoteCell(value);
};

const normalizeColumn = (value: unknown): AdjustedPointsColumnId | null => {
  if (typeof value !== 'string') return null;
  const token = value.toUpperCase() as AdjustedPointsColumnId;
  return ADJUSTED_POINTS_ALL_COLUMNS.includes(token) ? token : null;
};

const sanitizeTransformScope = (value: unknown): AdjustedPointsTransformScope =>
  value === 'selected' ? 'selected' : 'all';

const sanitizeStationIdList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const deduped: string[] = [];
  value.forEach((entry) => {
    if (typeof entry !== 'string') return;
    const trimmed = entry.trim();
    if (!trimmed) return;
    if (deduped.includes(trimmed)) return;
    deduped.push(trimmed);
  });
  return deduped;
};

const sanitizeTranslationMethod = (value: unknown): AdjustedPointsTranslationMethod =>
  value === 'anchor-coordinate' ? 'anchor-coordinate' : 'direction-distance';

const sanitizeNumber = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const sanitizeAdjustedPointsTransformSettings = (
  candidate: unknown,
  fallback: AdjustedPointsTransformSettings = DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS.transform,
): AdjustedPointsTransformSettings => {
  const record =
    typeof candidate === 'object' && candidate != null
      ? (candidate as Record<string, unknown>)
      : {};
  const rotationRecord =
    typeof record.rotation === 'object' && record.rotation != null
      ? (record.rotation as Record<string, unknown>)
      : {};
  const translationRecord =
    typeof record.translation === 'object' && record.translation != null
      ? (record.translation as Record<string, unknown>)
      : {};
  const scaleRecord =
    typeof record.scale === 'object' && record.scale != null
      ? (record.scale as Record<string, unknown>)
      : {};

  const legacyReference =
    typeof rotationRecord.pivotStationId === 'string' ? rotationRecord.pivotStationId.trim() : '';
  const legacyScope = rotationRecord.scope;
  const legacySelected = rotationRecord.selectedStationIds;
  const referenceStationId =
    typeof record.referenceStationId === 'string'
      ? record.referenceStationId.trim()
      : legacyReference || fallback.referenceStationId;

  return {
    referenceStationId,
    scope: sanitizeTransformScope(record.scope ?? legacyScope ?? fallback.scope),
    selectedStationIds: sanitizeStationIdList(
      record.selectedStationIds ?? legacySelected ?? fallback.selectedStationIds,
    ),
    rotation: {
      enabled:
        typeof rotationRecord.enabled === 'boolean'
          ? rotationRecord.enabled
          : fallback.rotation.enabled,
      angleDeg: sanitizeNumber(rotationRecord.angleDeg, fallback.rotation.angleDeg),
    },
    translation: {
      enabled:
        typeof translationRecord.enabled === 'boolean'
          ? translationRecord.enabled
          : fallback.translation.enabled,
      method: sanitizeTranslationMethod(translationRecord.method ?? fallback.translation.method),
      azimuthDeg: sanitizeNumber(translationRecord.azimuthDeg, fallback.translation.azimuthDeg),
      distance: sanitizeNumber(translationRecord.distance, fallback.translation.distance),
      targetE: sanitizeNumber(translationRecord.targetE, fallback.translation.targetE),
      targetN: sanitizeNumber(translationRecord.targetN, fallback.translation.targetN),
    },
    scale: {
      enabled:
        typeof scaleRecord.enabled === 'boolean' ? scaleRecord.enabled : fallback.scale.enabled,
      factor: sanitizeNumber(scaleRecord.factor, fallback.scale.factor),
    },
  };
};

export const inferAdjustedPointsPresetId = (
  columns: AdjustedPointsColumnId[],
): AdjustedPointsPresetId => {
  const normalized = normalizeAdjustedPointsColumns(columns);
  const preset = (
    Object.entries(ADJUSTED_POINTS_PRESET_COLUMNS) as Array<
      [Exclude<AdjustedPointsPresetId, 'custom'>, AdjustedPointsColumnId[]]
    >
  ).find(([, presetColumns]) => {
    if (presetColumns.length !== normalized.length) return false;
    return presetColumns.every((value, idx) => value === normalized[idx]);
  });
  return preset?.[0] ?? 'custom';
};

export const normalizeAdjustedPointsColumns = (
  columns: unknown,
  fallback: AdjustedPointsColumnId[] = DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS.columns,
): AdjustedPointsColumnId[] => {
  if (!Array.isArray(columns)) return [...fallback];
  const deduped: AdjustedPointsColumnId[] = [];
  columns.forEach((entry) => {
    const normalized = normalizeColumn(entry);
    if (!normalized) return;
    if (deduped.includes(normalized)) return;
    if (deduped.length >= MAX_COLUMNS) return;
    deduped.push(normalized);
  });
  if (deduped.length === 0) return [...fallback];
  return deduped;
};

export const sanitizeAdjustedPointsExportSettings = (
  candidate: unknown,
  fallback: AdjustedPointsExportSettings = DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
): AdjustedPointsExportSettings => {
  const record =
    typeof candidate === 'object' && candidate != null
      ? (candidate as Record<string, unknown>)
      : {};
  const format =
    record.format === 'text' || record.format === 'csv' ? record.format : fallback.format;
  const delimiter =
    record.delimiter === 'comma' || record.delimiter === 'space' || record.delimiter === 'tab'
      ? record.delimiter
      : fallback.delimiter;
  const columns = normalizeAdjustedPointsColumns(record.columns, fallback.columns);
  const includeLostStations =
    typeof record.includeLostStations === 'boolean'
      ? record.includeLostStations
      : fallback.includeLostStations;
  const transform = sanitizeAdjustedPointsTransformSettings(record.transform, fallback.transform);
  const presetId = inferAdjustedPointsPresetId(columns);
  return {
    format,
    delimiter,
    columns,
    includeLostStations,
    transform,
    presetId:
      record.presetId === 'custom' ||
      record.presetId === 'PNEZD' ||
      record.presetId === 'PENZD' ||
      record.presetId === 'PNEZ' ||
      record.presetId === 'PENZ' ||
      record.presetId === 'NEZ' ||
      record.presetId === 'PEN'
        ? (record.presetId as AdjustedPointsPresetId)
        : presetId,
  };
};

export const cloneAdjustedPointsExportSettings = (
  settings: AdjustedPointsExportSettings,
): AdjustedPointsExportSettings => ({
  ...settings,
  columns: [...settings.columns],
  transform: {
    ...settings.transform,
    selectedStationIds: [...settings.transform.selectedStationIds],
    rotation: { ...settings.transform.rotation },
    translation: { ...settings.transform.translation },
    scale: { ...settings.transform.scale },
  },
});

export const getAdjustedPointsExportStationIds = (
  result: AdjustmentResult,
  includeLostStations: boolean,
): string[] =>
  Object.entries(result.stations)
    .filter(([, station]) => includeLostStations || !station.lost)
    .map(([stationId]) => stationId)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

const hasAnyTransformEnabled = (transform: AdjustedPointsTransformSettings): boolean =>
  transform.rotation.enabled || transform.translation.enabled || transform.scale.enabled;

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
    } else {
      if (
        !Number.isFinite(transform.translation.targetE) ||
        !Number.isFinite(transform.translation.targetN)
      ) {
        return { valid: false, message: 'Translation target E/N must be valid numbers.' };
      }
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

const toMeters = (value: number, units: 'm' | 'ft'): number => (units === 'ft' ? value / FT_PER_M : value);

const formatLinear = (valueMeters: number, units: 'm' | 'ft'): string =>
  ((units === 'ft' ? valueMeters * FT_PER_M : valueMeters) ?? 0).toFixed(4);

const formatGeodetic = (value?: number): string =>
  Number.isFinite(value) ? (value as number).toFixed(9) : '';

const clampTiny = (value: number): number => (Math.abs(value) < TRANSFORM_ZERO_EPSILON ? 0 : value);

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

const toOutputRows = (params: {
  entries: Array<readonly [string, AdjustmentResult['stations'][string]]>;
  units: 'm' | 'ft';
  settings: AdjustedPointsExportSettings;
  descriptions: Record<string, string>;
  overrideNeByStationId?: Map<string, { northM: number; eastM: number }>;
}): string[] => {
  const { entries, units, settings, descriptions, overrideNeByStationId } = params;
  return entries.map(([stationId, station]) => {
    const override = overrideNeByStationId?.get(stationId);
    const stationNorth = override?.northM ?? station.y;
    const stationEast = override?.eastM ?? station.x;
    const description = descriptions[stationId] ?? '';
    return settings.columns
      .map((columnId) => {
        const fields: Record<AdjustedPointsColumnId, string> = {
          P: stationId,
          N: formatLinear(stationNorth, units),
          E: formatLinear(stationEast, units),
          Z: formatLinear(station.h, units),
          D: description,
          LAT: formatGeodetic(station.latDeg),
          LON: formatGeodetic(station.lonDeg),
          EL: formatLinear(station.h, units),
        };
        return maybeQuoteCell(fields[columnId], settings.delimiter, settings.format);
      })
      .join(delimiterToken(settings.delimiter));
  });
};

export const buildAdjustedPointsExportText = (params: {
  result: AdjustmentResult;
  units: 'm' | 'ft';
  settings: AdjustedPointsExportSettings;
}): string => {
  const { result, units, settings } = params;
  const cleanSettings = sanitizeAdjustedPointsExportSettings(settings);
  const delimiter = delimiterToken(cleanSettings.delimiter);
  const descriptions = result.parseState?.reconciledDescriptions ?? {};
  const entries = Object.entries(result.stations)
    .filter(([, station]) => cleanSettings.includeLostStations || !station.lost)
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([stationId, station]) => [stationId, station] as const);
  const originalRows = toOutputRows({
    entries,
    units,
    settings: cleanSettings,
    descriptions,
  });

  const header = cleanSettings.columns.join(delimiter);
  const originalSection = [header, ...originalRows];
  const transformPreview = buildAdjustedPointsTransformPreview({
    result,
    settings: cleanSettings,
    units,
  });
  if (!transformPreview.enabled || !transformPreview.available) {
    return originalSection.join('\n');
  }

  const transformedRows = toOutputRows({
    entries,
    units,
    settings: cleanSettings,
    descriptions,
    overrideNeByStationId: new Map(
      Array.from(transformPreview.transformedByStationId.entries()).map(([stationId, row]) => [
        stationId,
        {
          northM: row.north,
          eastM: row.east,
        },
      ]),
    ),
  });
  const scopeLabel = transformPreview.scope === 'all' ? 'ALL' : 'SELECTED+REFERENCE';
  const linearUnit = units === 'ft' ? 'ft' : 'm';
  const noteLines = [
    '# TRANSFORM NOTES',
    '# Transforms enabled (post-adjustment export only)',
    '# Active order: SCALE -> ROTATE -> TRANSLATE',
    `# Reference point: ${transformPreview.referenceStationId}`,
    `# Scope: ${scopeLabel}`,
  ];
  if (transformPreview.scaleEnabled) {
    noteLines.push(`# Scale: factor=${transformPreview.scaleFactor.toFixed(8)} (N/E only)`);
  }
  if (transformPreview.rotationEnabled) {
    noteLines.push('# Rotation: positive angle convention is counterclockwise about reference');
    noteLines.push(`# Rotation angle (deg): ${transformPreview.rotationAngleDeg.toFixed(6)}`);
    noteLines.push("# Rotation formula: E' = E0 + (E-E0)*cos(theta) - (N-N0)*sin(theta)");
    noteLines.push("# Rotation formula: N' = N0 + (E-E0)*sin(theta) + (N-N0)*cos(theta)");
  }
  if (transformPreview.translationEnabled) {
    const methodLabel =
      transformPreview.translationMethod === 'direction-distance'
        ? 'direction-distance'
        : 'anchor-coordinate';
    noteLines.push(`# Translation method: ${methodLabel}`);
    noteLines.push(
      `# Translation delta (${linearUnit}): dE=${formatLinear(transformPreview.translationDeltaEastM, units)}, dN=${formatLinear(transformPreview.translationDeltaNorthM, units)}`,
    );
    noteLines.push(
      `# Translation azimuth (deg): ${transformPreview.translationAzimuthDeg.toFixed(6)} (0=N, 90=E; clockwise)`,
    );
    noteLines.push(
      `# Translation distance (${linearUnit}): ${formatLinear(transformPreview.translationDistanceM, units)}`,
    );
  }
  const transformedSection = ['# TRANSFORMED COORDINATES', header, ...transformedRows];
  return [...originalSection, '', ...noteLines, '', ...transformedSection].join('\n');
};
