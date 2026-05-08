import type {
  ExternalInputImporter,
  ImportedControlStationRecord,
  ImportedDataset,
  ImportedObservationRecord,
  ImportedTraceEntry,
} from '../importers';
import {
  buildTraceDetailLine,
  choosePreferredStation,
  plural,
  sanitizeStationId,
  sourceLeaf,
  takeLeadingLines,
} from './shared';

const FIELDGENIUS_RECORD_CODES = new Set([
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

interface ParsedFieldGeniusLine {
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

const parseFieldGeniusLine = (line: string): ParsedFieldGeniusLine | null => {
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

const pickField = (fields: Record<string, string>, keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = fields[normalizeFieldKey(key)];
    if (value != null && value !== '') return value;
  }
  return undefined;
};

const pickNumberField = (fields: Record<string, string>, keys: string[]): number | undefined => {
  const value = pickField(fields, keys);
  if (value == null) return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const buildLocalStationFromFieldGenius = (
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

export const parseFieldGenius = (input: string, sourceName?: string): ImportedDataset | null => {
  if (!detectFieldGeniusRaw(input, sourceName)) return null;

  const trace: ImportedTraceEntry[] = [];
  const controlStations = new Map<string, ImportedControlStationRecord>();
  const observations: ImportedObservationRecord[] = [];
  const fileLabel = sourceLeaf(sourceName);
  let occupyId: string | undefined;
  let backsightId: string | undefined;
  let hiM: number | undefined;

  input.split(/\r?\n/).forEach((line, index) => {
    const sourceLine = index + 1;
    const parsed = parseFieldGeniusLine(line);
    if (!parsed) return;

    const { code, fields, raw } = parsed;
    if (!FIELDGENIUS_RECORD_CODES.has(code)) {
      trace.push({
        level: 'warning',
        sourceLine,
        sourceCode: code,
        message: 'Unsupported FieldGenius record type was not converted.',
        raw,
      });
      return;
    }

    const localStation = buildLocalStationFromFieldGenius(code, fields, sourceLine);
    if (localStation) {
      const existing = controlStations.get(localStation.stationId);
      controlStations.set(localStation.stationId, choosePreferredStation(existing, localStation));
    }

    if (code === 'OC' || code === 'LS' || code === 'STN') {
      const rawPointId = pickField(fields, ['PN', 'POINT', 'NAME', 'POS1']);
      if (!rawPointId) {
        trace.push({
          level: 'error',
          sourceLine,
          sourceCode: code,
          message: 'Setup record missing occupy point identifier.',
          raw,
        });
        return;
      }
      occupyId = sanitizeStationId(rawPointId);
      hiM = pickNumberField(fields, ['HI', 'IH', 'INSTHT']);
      if (hiM == null) hiM = pickNumberField(fields, ['POS2']);
      return;
    }

    if (code === 'BK' || code === 'BS') {
      const rawPointId = pickField(fields, ['PN', 'POINT', 'NAME', 'POS1']);
      if (!rawPointId) {
        trace.push({
          level: 'warning',
          sourceLine,
          sourceCode: code,
          message: 'Backsight record missing backsight point identifier.',
          raw,
        });
        return;
      }
      backsightId = sanitizeStationId(rawPointId);
      return;
    }

    if (code === 'SP' || code === 'PT' || code === 'GS' || code === 'CV') {
      if (!localStation) {
        trace.push({
          level: code === 'GS' || code === 'CV' ? 'warning' : 'error',
          sourceLine,
          sourceCode: code,
          message: 'Point record missing East/North coordinates and was skipped.',
          raw,
        });
      }
      return;
    }

    if (code === 'SS' || code === 'TR' || code === 'FR' || code === 'FS') {
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

      const targetIdRaw = pickField(fields, ['PN', 'POINT', 'POINTID', 'NAME', 'TARGET', 'POS1']);
      if (!targetIdRaw) {
        trace.push({
          level: 'error',
          sourceLine,
          sourceCode: code,
          message: 'Shot record missing target point identifier.',
          raw,
        });
        return;
      }
      const targetId = sanitizeStationId(targetIdRaw);
      const htM = pickNumberField(fields, ['HT', 'RH', 'RODHT', 'TARGETHT']);
      const angleDeg = pickNumberField(fields, ['HA', 'HZ', 'HORANGLE', 'ANGLE', 'HR']);
      const azimuthDeg = pickNumberField(fields, ['AZ', 'AZI', 'AZIMUTH', 'BRG', 'BEARING']);
      const distanceM = pickNumberField(fields, ['SD', 'HD', 'DIST', 'DISTANCE', 'SLOPE']);
      const zenithDeg = pickNumberField(fields, ['VA', 'ZE', 'ZENITH', 'VZ']);
      const deltaHM = pickNumberField(fields, ['DH', 'DELTAH', 'VD']);

      if (angleDeg != null && backsightId && distanceM != null) {
        observations.push({
          kind: 'measurement',
          atId: occupyId,
          fromId: backsightId,
          toId: targetId,
          angleDeg,
          distanceM,
          verticalMode: zenithDeg != null ? 'zenith' : deltaHM != null ? 'delta-h' : undefined,
          verticalValue: zenithDeg ?? deltaHM,
          hiM,
          htM,
          sourceLine,
          sourceCode: code,
          note: 'converted to M',
        });
        return;
      }

      if (angleDeg != null && backsightId) {
        observations.push({
          kind: 'angle',
          atId: occupyId,
          fromId: backsightId,
          toId: targetId,
          angleDeg,
          sourceLine,
          sourceCode: code,
          note: 'converted to A',
        });
        return;
      }

      if (azimuthDeg != null) {
        observations.push({
          kind: 'bearing',
          fromId: occupyId,
          toId: targetId,
          bearingDeg: azimuthDeg,
          sourceLine,
          sourceCode: code,
          note: 'converted to B',
        });
        if (distanceM != null && (zenithDeg != null || deltaHM != null)) {
          observations.push({
            kind: 'distance-vertical',
            fromId: occupyId,
            toId: targetId,
            distanceM,
            verticalMode: zenithDeg != null ? 'zenith' : 'delta-h',
            verticalValue: zenithDeg ?? deltaHM ?? 0,
            hiM,
            htM,
            sourceLine,
            sourceCode: code,
            note: 'converted to DV',
          });
        } else if (distanceM != null) {
          observations.push({
            kind: 'distance',
            fromId: occupyId,
            toId: targetId,
            distanceM,
            hiM,
            htM,
            sourceLine,
            sourceCode: code,
            note: 'converted to D',
          });
        }
        return;
      }

      if (distanceM != null && (zenithDeg != null || deltaHM != null)) {
        observations.push({
          kind: 'distance-vertical',
          fromId: occupyId,
          toId: targetId,
          distanceM,
          verticalMode: zenithDeg != null ? 'zenith' : 'delta-h',
          verticalValue: zenithDeg ?? deltaHM ?? 0,
          hiM,
          htM,
          sourceLine,
          sourceCode: code,
          note: 'converted to DV',
        });
        trace.push({
          level: 'warning',
          sourceLine,
          sourceCode: code,
          message: `Shot ${targetId} had no usable angle or azimuth; imported as distance/vertical only.`,
        });
        return;
      }

      if (distanceM != null) {
        observations.push({
          kind: 'distance',
          fromId: occupyId,
          toId: targetId,
          distanceM,
          hiM,
          htM,
          sourceLine,
          sourceCode: code,
          note: 'converted to D',
        });
        trace.push({
          level: 'warning',
          sourceLine,
          sourceCode: code,
          message: `Shot ${targetId} had no usable angle or azimuth; imported as distance only.`,
        });
        return;
      }

      trace.push({
        level: 'warning',
        sourceLine,
        sourceCode: code,
        message: `Shot ${targetId} did not contain a supported observation payload.`,
        raw,
      });
      return;
    }

    trace.push({
      level: 'warning',
      sourceLine,
      sourceCode: code,
      message: 'Supported FieldGenius record was recognized but not yet converted.',
      raw,
    });
  });

  const stations = [...controlStations.values()];
  if (stations.length === 0 && observations.length === 0) return null;

  const detailLines = [
    `Imported ${plural(stations.length, 'point')} and ${plural(observations.length, 'observation')} from ${fileLabel} into normalized WebNet input.`,
  ];
  const traceDetail = buildTraceDetailLine(trace);
  if (traceDetail) detailLines.push(traceDetail);

  return {
    importerId: 'fieldgenius-raw',
    formatLabel: 'FieldGenius raw field data',
    summary: `Imported FieldGenius dataset with ${plural(stations.length, 'point')} and ${plural(observations.length, 'observation')}`,
    notice: {
      title: 'Imported FieldGenius dataset',
      detailLines,
    },
    comments: [
      'Imported from FieldGenius raw data',
      `Source file: ${fileLabel}`,
      `Imported points: ${stations.length}`,
      `Imported observations: ${observations.length}`,
    ],
    controlStations: stations,
    observations,
    trace,
  };
};

export const fieldGeniusImporter: ExternalInputImporter = {
  id: 'fieldgenius-raw',
  formatLabel: 'FieldGenius raw field data',
  detect: (input, sourceName) => detectFieldGeniusRaw(input, sourceName),
  parse: (input, sourceName) => parseFieldGenius(input, sourceName),
};
