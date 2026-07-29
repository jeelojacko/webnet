import type { ImportedControlStationRecord } from '../importers';
import {
  parseDmsAngleDegrees,
  parseQuadrantBearingDegrees,
  sanitizeStationId,
  takeLeadingLines,
} from './shared';
import { detectFieldGeniusRaw } from './fieldGeniusImporter';

export const RW5_RECORD_CODES = new Set([
  'JB',
  'MO',
  'OC',
  'SP',
  'PT',
  'BK',
  'LS',
  'SS',
  'TR',
  'FR',
  'FS',
  'FD',
  'BD',
  'BR',
  'CL',
  'AB',
]);

const RW5_INLINE_FIELD_KEYS = [
  'TARGET',
  'POINT',
  'FROM',
  'DESC',
  'POS1',
  'POS2',
  'POS3',
  'OP',
  'PN',
  'FP',
  'BP',
  'BS',
  'BC',
  'HI',
  'HR',
  'HT',
  'IH',
  'AR',
  'AL',
  'AZ',
  'BR',
  'DR',
  'DL',
  'ZE',
  'VA',
  'CE',
  'DH',
  'SD',
  'HD',
  'EL',
  'NM',
  'DT',
  'UN',
  'SF',
  'AD',
  'FC',
  'N',
  'E',
].sort((a, b) => b.length - a.length);

const RW5_KEY_VALUE_PATTERN = /^([A-Za-z]{1,8})(.*)$/;
const normalizedFieldKeyCache = new Map<string, string>();

const normalizeFieldKey = (value: string): string => {
  const cached = normalizedFieldKeyCache.get(value);
  if (cached != null) return cached;
  const normalized = value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  normalizedFieldKeyCache.set(value, normalized);
  return normalized;
};

export interface ParsedRw5Line {
  code: string;
  fields: Record<string, string>;
  raw: string;
}

export interface Rw5Context {
  occupyId?: string;
  backsightId?: string;
  hiM?: number;
  htM?: number;
  backsightAzimuthDeg?: number;
  setCircleDeg?: number;
}

const looksLikeRw5Raw = (input: string): boolean => {
  const recognized = takeLeadingLines(input, 40)
    .map((line) => parseRw5Line(line))
    .filter((row): row is ParsedRw5Line => row != null && RW5_RECORD_CODES.has(row.code));
  if (recognized.length < 2) return false;
  return recognized.some((row) => !row.raw.includes('=') && !row.raw.includes(':'));
};

export const parseRw5Line = (line: string): ParsedRw5Line | null => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#') || trimmed.startsWith('//')) {
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
    if (token.startsWith('--')) {
      const description = token.slice(2).trim();
      if (description) fields.DESC = description;
      continue;
    }

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

    const inlineKey = RW5_INLINE_FIELD_KEYS.find(
      (candidate) => token.toUpperCase().startsWith(candidate) && token.length > candidate.length,
    );
    if (inlineKey) {
      fields[normalizeFieldKey(inlineKey)] = token.slice(inlineKey.length).trim();
      continue;
    }

    const keyValueMatch = token.match(RW5_KEY_VALUE_PATTERN);
    if (keyValueMatch) {
      const key = normalizeFieldKey(keyValueMatch[1]);
      const remainder = keyValueMatch[2].trim();
      if (remainder) {
        fields[key] = remainder;
        continue;
      }
      if (i + 1 < tokens.length) {
        fields[key] = tokens[i + 1].trim();
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

export const detectCarlsonRw5 = (input: string, sourceName?: string): boolean => {
  const fileName = sourceName?.toLowerCase() ?? '';
  if (detectFieldGeniusRaw(input, sourceName)) return false;
  if (!looksLikeRw5Raw(input)) return false;
  return fileName.endsWith('.rw5') || fileName.endsWith('.cr5') || /CARLSON/i.test(input);
};

export const detectTdsRaw = (input: string, sourceName?: string): boolean => {
  const fileName = sourceName?.toLowerCase() ?? '';
  if (detectFieldGeniusRaw(input, sourceName)) return false;
  if (!looksLikeRw5Raw(input)) return false;
  return fileName.endsWith('.raw') || /\bTDS\b/i.test(input);
};

export const pickRw5Field = (fields: Record<string, string>, keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = fields[normalizeFieldKey(key)];
    if (value != null && value !== '') return value;
  }
  return undefined;
};

export const pickRw5NumberField = (fields: Record<string, string>, keys: string[]): number | undefined => {
  const rawValue = pickRw5Field(fields, keys);
  if (rawValue == null) return undefined;
  const parsed = Number.parseFloat(rawValue.replace(/[^\d+\-.]/g, ''));
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const parseRw5AngleToken = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  return parseDmsAngleDegrees(value);
};

const parseRw5BearingToken = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  return parseQuadrantBearingDegrees(value);
};

export const buildLocalStationFromRw5 = (
  code: string,
  fields: Record<string, string>,
  sourceLine: number,
): ImportedControlStationRecord | null => {
  const rawPointId =
    pickRw5Field(fields, ['PN', 'PT', 'POINT', 'POINTID', 'NAME']) ??
    (code === 'OC' ? pickRw5Field(fields, ['OP']) : undefined);
  if (!rawPointId) return null;
  const eastM = pickRw5NumberField(fields, ['E', 'EAST', 'EASTING', 'X']);
  const northM = pickRw5NumberField(fields, ['N', 'NORTH', 'NORTHING', 'Y']);
  const heightM = pickRw5NumberField(fields, ['EL', 'ELEV', 'ELEVATION', 'Z', 'H', 'HEIGHT']) ?? 0;
  if (eastM == null || northM == null) return null;
  return {
    kind: 'control-station',
    coordinateMode: 'local',
    stationId: sanitizeStationId(rawPointId),
    eastM,
    northM,
    heightM,
    description: pickRw5Field(fields, ['DESC', 'CODE', 'FC']),
    sourceLine,
    sourceCode: code,
  };
};

export const resolveRw5ShotOrientation = (
  context: Rw5Context,
  fields: Record<string, string>,
): { angleDeg?: number; bearingDeg?: number } => {
  const azimuthDeg = parseRw5AngleToken(pickRw5Field(fields, ['AZ']));
  if (azimuthDeg != null) return { bearingDeg: azimuthDeg };

  const bearingDeg = parseRw5BearingToken(pickRw5Field(fields, ['BR']));
  if (bearingDeg != null) return { bearingDeg };

  const angleRightDeg = parseRw5AngleToken(pickRw5Field(fields, ['AR']));
  if (angleRightDeg != null) {
    if (context.backsightId) return { angleDeg: angleRightDeg };
    if (context.backsightAzimuthDeg != null) {
      return {
        bearingDeg: context.backsightAzimuthDeg - (context.setCircleDeg ?? 0) + angleRightDeg,
      };
    }
  }

  const angleLeftDeg = parseRw5AngleToken(pickRw5Field(fields, ['AL']));
  if (angleLeftDeg != null) {
    const rightEquivalent = 360 - angleLeftDeg;
    if (context.backsightId) return { angleDeg: rightEquivalent };
    if (context.backsightAzimuthDeg != null) {
      return {
        bearingDeg: context.backsightAzimuthDeg - (context.setCircleDeg ?? 0) + rightEquivalent,
      };
    }
  }

  const deflectRightDeg = parseRw5AngleToken(pickRw5Field(fields, ['DR']));
  if (deflectRightDeg != null) {
    const rightEquivalent = 180 - deflectRightDeg;
    if (context.backsightId) return { angleDeg: rightEquivalent };
    if (context.backsightAzimuthDeg != null) {
      return {
        bearingDeg: context.backsightAzimuthDeg - (context.setCircleDeg ?? 0) + rightEquivalent,
      };
    }
  }

  const deflectLeftDeg = parseRw5AngleToken(pickRw5Field(fields, ['DL']));
  if (deflectLeftDeg != null) {
    const rightEquivalent = 180 + deflectLeftDeg;
    if (context.backsightId) return { angleDeg: rightEquivalent };
    if (context.backsightAzimuthDeg != null) {
      return {
        bearingDeg: context.backsightAzimuthDeg - (context.setCircleDeg ?? 0) + rightEquivalent,
      };
    }
  }

  return {};
};

export const resolveRw5VerticalPayload = (
  fields: Record<string, string>,
): { verticalMode?: 'zenith' | 'delta-h'; verticalValue?: number } => {
  const zenithDeg = parseRw5AngleToken(pickRw5Field(fields, ['ZE']));
  if (zenithDeg != null) return { verticalMode: 'zenith', verticalValue: zenithDeg };

  const verticalAngleDeg = parseRw5AngleToken(pickRw5Field(fields, ['VA']));
  if (verticalAngleDeg != null) {
    return { verticalMode: 'zenith', verticalValue: 90 - verticalAngleDeg };
  }

  const deltaHM = pickRw5NumberField(fields, ['CE', 'DH']);
  if (deltaHM != null) return { verticalMode: 'delta-h', verticalValue: deltaHM };

  return {};
};
