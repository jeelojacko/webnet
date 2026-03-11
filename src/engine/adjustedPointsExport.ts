import type {
  AdjustedPointsColumnId,
  AdjustedPointsDelimiter,
  AdjustedPointsExportSettings,
  AdjustedPointsPresetId,
  AdjustedPointsRotationScope,
  AdjustedPointsTransformSettings,
  AdjustmentResult,
} from '../types';

const FT_PER_M = 3.280839895;
const MAX_COLUMNS = 6;
const ROTATION_ZERO_EPSILON = 1e-10;

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

export const DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS: AdjustedPointsExportSettings = {
  format: 'csv',
  delimiter: 'comma',
  columns: [...ADJUSTED_POINTS_PRESET_COLUMNS.PNEZD],
  presetId: 'PNEZD',
  includeLostStations: true,
  transform: {
    rotation: {
      enabled: false,
      angleDeg: 0,
      pivotStationId: '',
      scope: 'all',
      selectedStationIds: [],
    },
    translation: {
      enabled: false,
    },
    scale: {
      enabled: false,
    },
  },
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

const sanitizeRotationScope = (value: unknown): AdjustedPointsRotationScope =>
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
  const angleDegCandidate = rotationRecord.angleDeg;
  const angleDeg =
    typeof angleDegCandidate === 'number' && Number.isFinite(angleDegCandidate)
      ? angleDegCandidate
      : fallback.rotation.angleDeg;
  const pivotStationId =
    typeof rotationRecord.pivotStationId === 'string'
      ? rotationRecord.pivotStationId.trim()
      : fallback.rotation.pivotStationId;
  return {
    rotation: {
      enabled:
        typeof rotationRecord.enabled === 'boolean'
          ? rotationRecord.enabled
          : fallback.rotation.enabled,
      angleDeg,
      pivotStationId,
      scope: sanitizeRotationScope(rotationRecord.scope ?? fallback.rotation.scope),
      selectedStationIds: sanitizeStationIdList(
        rotationRecord.selectedStationIds ?? fallback.rotation.selectedStationIds,
      ),
    },
    translation: {
      enabled:
        typeof translationRecord.enabled === 'boolean'
          ? translationRecord.enabled
          : fallback.translation.enabled,
    },
    scale: {
      enabled:
        typeof scaleRecord.enabled === 'boolean' ? scaleRecord.enabled : fallback.scale.enabled,
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
    rotation: {
      ...settings.transform.rotation,
      selectedStationIds: [...settings.transform.rotation.selectedStationIds],
    },
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

export const validateAdjustedPointsRotationTransform = (params: {
  result: AdjustmentResult;
  settings: AdjustedPointsExportSettings;
}): { valid: true } | { valid: false; message: string } => {
  const { result, settings } = params;
  const cleanSettings = sanitizeAdjustedPointsExportSettings(settings);
  const rotation = cleanSettings.transform.rotation;
  if (!rotation.enabled) return { valid: true };
  if (!rotation.pivotStationId) {
    return { valid: false, message: 'Rotation requires a pivot station.' };
  }
  const stationIds = new Set(
    getAdjustedPointsExportStationIds(result, cleanSettings.includeLostStations),
  );
  if (!stationIds.has(rotation.pivotStationId)) {
    return {
      valid: false,
      message: 'Rotation pivot must be in the current adjusted-points export set.',
    };
  }
  return { valid: true };
};

const formatLinear = (valueMeters: number, units: 'm' | 'ft'): string =>
  ((units === 'ft' ? valueMeters * FT_PER_M : valueMeters) ?? 0).toFixed(4);

const formatGeodetic = (value?: number): string =>
  Number.isFinite(value) ? (value as number).toFixed(9) : '';

const clampRotationTiny = (value: number): number =>
  Math.abs(value) < ROTATION_ZERO_EPSILON ? 0 : value;

const toOutputRows = (params: {
  entries: Array<readonly [string, AdjustmentResult['stations'][string]]>;
  units: 'm' | 'ft';
  settings: AdjustedPointsExportSettings;
  descriptions: Record<string, string>;
  overrideNeByStationId?: Record<string, { northM: number; eastM: number }>;
}): string[] => {
  const { entries, units, settings, descriptions, overrideNeByStationId } = params;
  return entries.map(([stationId, station]) => {
    const override = overrideNeByStationId?.[stationId];
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
  const rotation = cleanSettings.transform.rotation;
  const validation = validateAdjustedPointsRotationTransform({ result, settings: cleanSettings });
  if (!rotation.enabled || !validation.valid) {
    return originalSection.join('\n');
  }

  const pivot = result.stations[rotation.pivotStationId];
  if (!pivot) return originalSection.join('\n');

  const angleRad = (rotation.angleDeg * Math.PI) / 180;
  const cosTheta = Math.cos(angleRad);
  const sinTheta = Math.sin(angleRad);
  const exportedStationIds = entries.map(([stationId]) => stationId);
  const exportedStationIdSet = new Set(exportedStationIds);
  const rotateStationIds =
    rotation.scope === 'all'
      ? exportedStationIds
      : [
          ...new Set(
            [...rotation.selectedStationIds, rotation.pivotStationId].filter((stationId) =>
              exportedStationIdSet.has(stationId),
            ),
          ),
        ];
  const rotateStationIdSet = new Set(rotateStationIds);
  const rotatedEntries =
    rotation.scope === 'all'
      ? entries
      : entries.filter(([stationId]) => rotateStationIdSet.has(stationId));
  const overrideNeByStationId: Record<string, { northM: number; eastM: number }> = {};
  rotatedEntries.forEach(([stationId, station]) => {
    const dEast = station.x - pivot.x;
    const dNorth = station.y - pivot.y;
    const rotatedEast = clampRotationTiny(pivot.x + dEast * cosTheta - dNorth * sinTheta);
    const rotatedNorth = clampRotationTiny(pivot.y + dEast * sinTheta + dNorth * cosTheta);
    overrideNeByStationId[stationId] = {
      northM: rotatedNorth,
      eastM: rotatedEast,
    };
  });
  const rotatedRows = toOutputRows({
    entries: rotatedEntries,
    units,
    settings: cleanSettings,
    descriptions,
    overrideNeByStationId,
  });
  const scopeLabel = rotation.scope === 'all' ? 'ALL' : 'SELECTED+PIVOT';
  const noteLines = [
    '# TRANSFORM NOTES',
    '# Rotation enabled (post-adjustment export only)',
    '# Positive angle convention: counterclockwise about pivot',
    `# Pivot: ${rotation.pivotStationId}`,
    `# Rotation angle (deg): ${rotation.angleDeg.toFixed(6)}`,
    `# Scope: ${scopeLabel}`,
    '# Formula: E\' = E0 + (E-E0)*cos(theta) - (N-N0)*sin(theta)',
    '# Formula: N\' = N0 + (E-E0)*sin(theta) + (N-N0)*cos(theta)',
  ];
  const rotatedSection = ['# ROTATED COORDINATES', header, ...rotatedRows];
  return [...originalSection, '', ...noteLines, '', ...rotatedSection].join('\n');
};
