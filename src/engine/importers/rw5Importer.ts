import type {
  ExternalInputImporter,
  ImportedControlStationRecord,
  ImportedDataset,
  ImportedObservationRecord,
  ImportedTraceEntry,
} from '../importers';
import {
  appendImportedObservationBundle,
  buildTraceDetailLine,
  parseDmsAngleDegrees,
  parseQuadrantBearingDegrees,
  choosePreferredStation,
  plural,
  sanitizeStationId,
  sourceLeaf,
  takeLeadingLines,
} from '../importers';
import { detectFieldGeniusRaw } from './fieldGeniusImporter';

const RW5_RECORD_CODES = new Set([
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

interface ParsedRw5Line {
  code: string;
  fields: Record<string, string>;
  raw: string;
}

interface Rw5Context {
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

const parseRw5Line = (line: string): ParsedRw5Line | null => {
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

const pickRw5Field = (fields: Record<string, string>, keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = fields[normalizeFieldKey(key)];
    if (value != null && value !== '') return value;
  }
  return undefined;
};

const pickRw5NumberField = (fields: Record<string, string>, keys: string[]): number | undefined => {
  const rawValue = pickRw5Field(fields, keys);
  if (rawValue == null) return undefined;
  const parsed = Number.parseFloat(rawValue.replace(/[^\d+\-.]/g, ''));
  return Number.isFinite(parsed) ? parsed : undefined;
};

const parseRw5AngleToken = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  return parseDmsAngleDegrees(value);
};

const parseRw5BearingToken = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  return parseQuadrantBearingDegrees(value);
};

const buildLocalStationFromRw5 = (
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

const resolveRw5ShotOrientation = (
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

const resolveRw5VerticalPayload = (
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

export const parseRw5Dataset = (
  input: string,
  sourceName: string | undefined,
  flavor: 'carlson' | 'tds',
): ImportedDataset | null => {
  const detect = flavor === 'carlson' ? detectCarlsonRw5 : detectTdsRaw;
  if (!detect(input, sourceName)) return null;

  const trace: ImportedTraceEntry[] = [];
  const controlStations = new Map<string, ImportedControlStationRecord>();
  const observations: ImportedObservationRecord[] = [];
  const fileLabel = sourceLeaf(sourceName);
  const context: Rw5Context = {};

  input.split(/\r?\n/).forEach((line, index) => {
    const sourceLine = index + 1;
    const parsed = parseRw5Line(line);
    if (!parsed) return;

    const { code, fields, raw } = parsed;
    if (!RW5_RECORD_CODES.has(code)) {
      trace.push({
        level: 'warning',
        sourceLine,
        sourceCode: code,
        message: 'Unsupported Carlson/TDS record type was not converted.',
        raw,
      });
      return;
    }

    const localStation = buildLocalStationFromRw5(code, fields, sourceLine);
    if (localStation) {
      const existing = controlStations.get(localStation.stationId);
      controlStations.set(localStation.stationId, choosePreferredStation(existing, localStation));
    }

    if (code === 'JB' || code === 'MO') return;

    if (code === 'OC') {
      const rawPointId = pickRw5Field(fields, ['OP', 'PN', 'POINT', 'NAME']);
      if (!rawPointId) {
        trace.push({
          level: 'error',
          sourceLine,
          sourceCode: code,
          message: 'Occupy record missing station identifier.',
          raw,
        });
        return;
      }
      context.occupyId = sanitizeStationId(rawPointId);
      context.hiM = pickRw5NumberField(fields, ['HI', 'IH']) ?? context.hiM;
      context.backsightId = undefined;
      context.backsightAzimuthDeg = undefined;
      context.setCircleDeg = undefined;
      return;
    }

    if (code === 'BK') {
      const backsightPoint = pickRw5Field(fields, ['BP', 'BSPOINT', 'PN']);
      const backsightAzimuth = parseRw5AngleToken(pickRw5Field(fields, ['BS', 'AZ']));
      context.backsightId = backsightPoint ? sanitizeStationId(backsightPoint) : undefined;
      context.backsightAzimuthDeg = backsightAzimuth;
      context.setCircleDeg = parseRw5AngleToken(pickRw5Field(fields, ['BC', 'SC'])) ?? 0;
      return;
    }

    if (code === 'LS') {
      context.hiM = pickRw5NumberField(fields, ['HI', 'IH']) ?? context.hiM;
      context.htM = pickRw5NumberField(fields, ['HR', 'HT', 'RH']) ?? context.htM;
      return;
    }

    if (code === 'SP' || code === 'PT') {
      if (!localStation) {
        trace.push({
          level: 'error',
          sourceLine,
          sourceCode: code,
          message: 'Point record missing East/North coordinates and was skipped.',
          raw,
        });
      }
      return;
    }

    if (
      code === 'SS' ||
      code === 'TR' ||
      code === 'FR' ||
      code === 'FS' ||
      code === 'FD' ||
      code === 'BD' ||
      code === 'BR' ||
      code === 'CL' ||
      code === 'AB'
    ) {
      const occupyId =
        context.occupyId ??
        (pickRw5Field(fields, ['OP', 'FROM', 'AT'])
          ? sanitizeStationId(pickRw5Field(fields, ['OP', 'FROM', 'AT'])!)
          : undefined);
      if (!occupyId) {
        trace.push({
          level: 'error',
          sourceLine,
          sourceCode: code,
          message: 'Shot record encountered before any occupy setup.',
          raw,
        });
        return;
      }

      const targetRaw = pickRw5Field(fields, ['FP', 'PN', 'POINT', 'TO', 'TARGET', 'POS1']);
      if (!targetRaw) {
        trace.push({
          level: 'error',
          sourceLine,
          sourceCode: code,
          message: 'Shot record missing target point identifier.',
          raw,
        });
        return;
      }

      const targetId = sanitizeStationId(targetRaw);
      const distanceM = pickRw5NumberField(fields, ['SD', 'DIST', 'DISTANCE', 'SLOPE', 'HD']);
      const distanceMode =
        pickRw5Field(fields, ['SD', 'DIST', 'DISTANCE', 'SLOPE']) != null
          ? 'slope'
          : pickRw5Field(fields, ['HD']) != null
            ? 'horizontal'
            : undefined;
      const htM = pickRw5NumberField(fields, ['HR', 'HT', 'RH']) ?? context.htM;
      const { angleDeg, bearingDeg } = resolveRw5ShotOrientation(context, fields);
      const { verticalMode, verticalValue } = resolveRw5VerticalPayload(fields);

      appendImportedObservationBundle({
        observations,
        trace,
        sourceLine,
        sourceCode: code,
        occupyId,
        targetId,
        backsightId: context.backsightId,
        angleDeg,
        bearingDeg,
        distanceM,
        distanceMode,
        verticalMode,
        verticalValue,
        hiM: context.hiM,
        htM,
        raw,
        tracePrefix: 'Shot',
      });
      return;
    }

    trace.push({
      level: 'warning',
      sourceLine,
      sourceCode: code,
      message: 'Supported Carlson/TDS record was recognized but not yet converted.',
      raw,
    });
  });

  const stations = [...controlStations.values()];
  if (stations.length === 0 && observations.length === 0) return null;

  const formatLabel = flavor === 'carlson' ? 'Carlson RW5 field data' : 'TDS raw field data';
  const title = flavor === 'carlson' ? 'Imported Carlson dataset' : 'Imported TDS dataset';
  const traceDetail = buildTraceDetailLine(trace);
  const detailLines = [
    `Imported ${plural(stations.length, 'point')} and ${plural(observations.length, 'observation')} from ${fileLabel} into normalized WebNet input.`,
  ];
  if (traceDetail) detailLines.push(traceDetail);

  return {
    importerId: flavor === 'carlson' ? 'carlson-rw5' : 'tds-raw',
    formatLabel,
    summary: `Imported ${flavor === 'carlson' ? 'Carlson' : 'TDS'} dataset with ${plural(stations.length, 'point')} and ${plural(observations.length, 'observation')}`,
    notice: {
      title,
      detailLines,
    },
    comments: [
      `Imported from ${flavor === 'carlson' ? 'Carlson RW5' : 'TDS raw'} data`,
      `Source file: ${fileLabel}`,
      `Imported points: ${stations.length}`,
      `Imported observations: ${observations.length}`,
    ],
    controlStations: stations,
    observations,
    trace,
  };
};

export const carlsonImporter: ExternalInputImporter = {
  id: 'carlson-rw5',
  formatLabel: 'Carlson RW5 field data',
  detect: (input, sourceName) => detectCarlsonRw5(input, sourceName),
  parse: (input, sourceName) => parseRw5Dataset(input, sourceName, 'carlson'),
};

export const tdsImporter: ExternalInputImporter = {
  id: 'tds-raw',
  formatLabel: 'TDS raw field data',
  detect: (input, sourceName) => detectTdsRaw(input, sourceName),
  parse: (input, sourceName) => parseRw5Dataset(input, sourceName, 'tds'),
};
