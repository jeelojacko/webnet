import type {
  AdjustedPointsColumnId,
  AdjustedPointsDelimiter,
  AdjustedPointsExportSettings,
  AdjustedPointsPresetId,
  AdjustmentResult,
} from '../types';

const FT_PER_M = 3.280839895;
const MAX_COLUMNS = 6;

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
  const presetId = inferAdjustedPointsPresetId(columns);
  return {
    format,
    delimiter,
    columns,
    includeLostStations,
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

const formatLinear = (valueMeters: number, units: 'm' | 'ft'): string =>
  ((units === 'ft' ? valueMeters * FT_PER_M : valueMeters) ?? 0).toFixed(4);

const formatGeodetic = (value?: number): string =>
  Number.isFinite(value) ? (value as number).toFixed(9) : '';

export const buildAdjustedPointsExportText = (params: {
  result: AdjustmentResult;
  units: 'm' | 'ft';
  settings: AdjustedPointsExportSettings;
}): string => {
  const { result, units, settings } = params;
  const cleanSettings = sanitizeAdjustedPointsExportSettings(settings);
  const delimiter = delimiterToken(cleanSettings.delimiter);
  const descriptions = result.parseState?.reconciledDescriptions ?? {};
  const rows = Object.entries(result.stations)
    .filter(([, station]) => cleanSettings.includeLostStations || !station.lost)
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([stationId, station]) => {
      const description = descriptions[stationId] ?? '';
      const fields: Record<AdjustedPointsColumnId, string> = {
        P: stationId,
        N: formatLinear(station.y, units),
        E: formatLinear(station.x, units),
        Z: formatLinear(station.h, units),
        D: description,
        LAT: formatGeodetic(station.latDeg),
        LON: formatGeodetic(station.lonDeg),
        EL: formatLinear(station.h, units),
      };
      return cleanSettings.columns.map((columnId) =>
        maybeQuoteCell(fields[columnId], cleanSettings.delimiter, cleanSettings.format),
      );
    });

  const header = cleanSettings.columns.join(delimiter);
  const body = rows.map((row) => row.join(delimiter));
  return [header, ...body].join('\n');
};
