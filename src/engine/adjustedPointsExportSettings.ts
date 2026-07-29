import type {
  AdjustedPointsColumnId,
  AdjustedPointsDelimiter,
  AdjustedPointsExportSettings,
  AdjustedPointsPresetId,
  AdjustedPointsTransformScope,
  AdjustedPointsTransformSettings,
  AdjustedPointsTranslationMethod,
} from '../types';
import { RAD_TO_DEG, dmsToRad } from './angles';

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

export const sanitizeAdjustedPointsTransformSettings = (
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

export const adjustedPointsDelimiterToken = (delimiter: AdjustedPointsDelimiter): string =>
  delimiter === 'comma' ? ',' : delimiter === 'tab' ? '\t' : ' ';

export const maybeQuoteAdjustedPointsCell = (
  value: string,
  delimiter: AdjustedPointsDelimiter,
  _format: AdjustedPointsExportSettings['format'],
): string => {
  if (!value) return value;
  const delimiterChar = adjustedPointsDelimiterToken(delimiter);
  const needsQuote =
    value.includes('"') ||
    value.includes('\n') ||
    value.includes('\r') ||
    value.includes(delimiterChar) ||
    (delimiter === 'space' && /\s/.test(value));
  return needsQuote ? `"${value.replaceAll('"', '""')}"` : value;
};
