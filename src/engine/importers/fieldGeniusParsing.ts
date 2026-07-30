import type { ImportedControlStationRecord } from '../importers';
import {
  choosePreferredStation,
  sanitizeStationId,
  takeLeadingLines,
} from './shared';

export const FIELDGENIUS_RECORD_CODES = new Set([
  'OC',
  'LS',
  'STN',
  'BK',
  'BS',
  'SS',
  'TR',
  'FR',
  'FS',
  'SP',
  'PT',
  'GS',
  'CV',
]);

export interface ParsedFieldGeniusLine {
  code: string;
  fields: Record<string, string>;
  raw: string;
}

const normalizedFieldKeyCache = new Map<string, string>();
const normalizeFieldKey = (value: string): string => {
  const cached = normalizedFieldKeyCache.get(value);
  if (cached != null) return cached;
  const normalized = value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  normalizedFieldKeyCache.set(value, normalized);
  return normalized;
};

const FIELDGENIUS_BARE_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

export const parseFieldGeniusLine = (line: string): ParsedFieldGeniusLine | null => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#') || trimmed.startsWith('//')) {
    return null;
  }
  if (/^FIELDGENIUS\b/i.test(trimmed) && !trimmed.includes(',')) {
    return null;
  }
  const tokens = trimmed
    .split(/\s*,\s*/)
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) return null;
  const code = tokens[0].toUpperCase();
  const fields: Record<string, string> = {};
  const positional: string[] = [];

  for (let i = 1; i < tokens.length; i += 1) {
    const token = tokens[i];
    const eqIndex = token.indexOf('=');
    const colonIndex = token.indexOf(':');
    const sepIndex =
      eqIndex >= 0 && colonIndex >= 0
        ? Math.min(eqIndex, colonIndex)
        : Math.max(eqIndex, colonIndex);
    if (sepIndex > 0) {
      const key = normalizeFieldKey(token.slice(0, sepIndex));
      const value = token.slice(sepIndex + 1).trim();
      if (key) fields[key] = value;
      continue;
    }

    if (FIELDGENIUS_BARE_KEY_PATTERN.test(token) && i + 1 < tokens.length) {
      const next = tokens[i + 1];
      if (!next.includes('=') && !next.includes(':')) {
        fields[normalizeFieldKey(token)] = next.trim();
        i += 1;
        continue;
      }
    }

    positional.push(token);
  }

  positional.forEach((value, index) => {
    fields[`POS${index + 1}`] = value;
  });

  return { code, fields, raw: trimmed };
};

export const detectFieldGeniusRaw = (input: string, sourceName?: string): boolean => {
  const fileName = sourceName?.toLowerCase() ?? '';
  const lines = takeLeadingLines(input, 20);
  const parsedRows = lines
    .map((line) => parseFieldGeniusLine(line))
    .filter(
      (row): row is ParsedFieldGeniusLine => row != null && FIELDGENIUS_RECORD_CODES.has(row.code),
    );
  const recognized = parsedRows.length;
  const hasExplicitAssignments = parsedRows.some(
    (row) => row.raw.includes('=') || row.raw.includes(':'),
  );
  return (
    /FIELDGENIUS/i.test(input) ||
    ((fileName.endsWith('.raw') || recognized >= 2) && hasExplicitAssignments)
  );
};

export const pickField = (fields: Record<string, string>, keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = fields[normalizeFieldKey(key)];
    if (value != null && value !== '') return value;
  }
  return undefined;
};

export const pickNumberField = (fields: Record<string, string>, keys: string[]): number | undefined => {
  const value = pickField(fields, keys);
  if (value == null) return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const buildLocalStationFromFieldGenius = (
  code: string,
  fields: Record<string, string>,
  sourceLine: number,
): ImportedControlStationRecord | null => {
  const rawPointId = pickField(fields, ['PN', 'PT', 'POINT', 'POINTID', 'NAME', 'ID', 'POS1']);
  if (!rawPointId) return null;
  const eastM = pickNumberField(fields, ['E', 'EAST', 'EASTING', 'X']);
  const northM = pickNumberField(fields, ['N', 'NORTH', 'NORTHING', 'Y']);
  const heightM = pickNumberField(fields, ['Z', 'EL', 'ELEV', 'ELEVATION', 'H', 'HEIGHT']) ?? 0;
  if (eastM == null || northM == null) return null;
  return {
    kind: 'control-station',
    coordinateMode: 'local',
    stationId: sanitizeStationId(rawPointId),
    eastM,
    northM,
    heightM,
    description: pickField(fields, ['DESC', 'DESCRIPTION', 'CODE', 'FC']),
    sourceLine,
    sourceCode: code,
  };
};

export const upsertPreferredFieldGeniusStation = (
  controlStations: Map<string, ImportedControlStationRecord>,
  localStation: ImportedControlStationRecord,
): void => {
  const existing = controlStations.get(localStation.stationId);
  controlStations.set(localStation.stationId, choosePreferredStation(existing, localStation));
};
