/**
 * Phase 13D — generic terrestrial coordinate CSV importer.
 *
 * Header-driven control-station import. Point/ID + Northing + Easting are
 * required; Elevation, Code, Description, and Note are optional. Units come
 * from an explicit caller-supplied param (never inferred from magnitudes),
 * CRS is recorded but never transformed here, and Northing/Easting are
 * never swapped. Includes a Trimble Access named preset plus manual column
 * mapping passthrough.
 */
import type {
  ExternalInputImporter,
  ImportedControlStationRecord,
  ImportedDataset,
  ImportedTraceEntry,
} from './importers';
import {
  buildTraceDetailLine,
  choosePreferredStation,
  plural,
  sanitizeStationId,
  sourceLeaf,
  splitImportedCodeDescription,
} from './importers/shared';

export type TerrestrialCsvUnits = 'm' | 'mm' | 'cm' | 'ft' | 'usft';
export type TerrestrialCsvPreset = 'generic' | 'trimble-access';

export interface TerrestrialCsvColumnMapping {
  id?: string;
  northing?: string;
  easting?: string;
  elevation?: string;
  code?: string;
  description?: string;
  note?: string;
}

export interface TerrestrialCsvImportOptions {
  /** Explicit linear unit of the coordinate columns. Required — never guessed. */
  units: TerrestrialCsvUnits | string;
  delimiter?: string;
  preset?: TerrestrialCsvPreset | string;
  /** Canonical field -> exact header name in the file. Bypasses alias lookup. */
  columnMapping?: TerrestrialCsvColumnMapping;
  /** CRS label recorded on the dataset. Assigned by the caller; no transform applied. */
  crs?: string;
  sourceFile?: string;
}

type CanonicalField = keyof Required<TerrestrialCsvColumnMapping>;

const MAX_FILE_CHARS = 5_000_000;
const MAX_ROWS = 50_000;
const MAX_FIELD_CHARS = 256;

const UNIT_TO_METERS: Record<string, number> = {
  m: 1,
  mm: 0.001,
  cm: 0.01,
  ft: 0.3048,
  usft: 1200 / 3937,
};

/** Header (lowercased, trimmed) -> canonical field. Explicit aliases only. */
const COLUMN_ALIASES: Record<string, CanonicalField> = {
  point: 'id',
  'point name': 'id',
  pointname: 'id',
  id: 'id',
  name: 'id',
  station: 'id',
  stationid: 'id',
  'station id': 'id',
  northing: 'northing',
  north: 'northing',
  n: 'northing',
  y: 'northing',
  easting: 'easting',
  east: 'easting',
  e: 'easting',
  x: 'easting',
  elevation: 'elevation',
  elev: 'elevation',
  height: 'elevation',
  h: 'elevation',
  z: 'elevation',
  up: 'elevation',
  code: 'code',
  'point code': 'code',
  pointcode: 'code',
  featurecode: 'code',
  'feature code': 'code',
  description: 'description',
  desc: 'description',
  note: 'note',
  notes: 'note',
  comment: 'note',
  remarks: 'note',
};

/** Trimble Access CSV export headers: Point Name, Point Code, Northing, Easting, Elevation. */
const TRIMBLE_ACCESS_COLUMNS: Record<string, CanonicalField> = {
  'point name': 'id',
  'point code': 'code',
  northing: 'northing',
  easting: 'easting',
  elevation: 'elevation',
};

const sniffDelimiter = (headerLine: string): string => {
  const counts = [',', ';', '\t'].map(
    (delimiter) => headerLine.split(delimiter).length - 1,
  );
  const best = counts.indexOf(Math.max(...counts));
  return [',', ';', '\t'][best] ?? ',';
};

/** Minimal RFC4180 field split: quotes, embedded delimiters, "" escapes. */
const splitCsvLine = (line: string, delimiter: string): string[] | null => {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i] ?? '';
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (inQuotes) return null;
  fields.push(current);
  return fields;
};

const lookupColumn = (
  headers: string[],
  field: CanonicalField,
  options: TerrestrialCsvImportOptions,
): number | undefined => {
  const manual = options.columnMapping?.[field]?.trim().toLowerCase();
  if (manual) {
    const exact = headers.findIndex((header) => header.trim().toLowerCase() === manual);
    return exact >= 0 ? exact : undefined;
  }
  const table = options.preset === 'trimble-access' ? TRIMBLE_ACCESS_COLUMNS : COLUMN_ALIASES;
  const isPresetTable = options.preset === 'trimble-access';
  for (let i = 0; i < headers.length; i += 1) {
    const key = headers[i]?.trim().toLowerCase() ?? '';
    const mapped = table[key] ?? (isPresetTable ? COLUMN_ALIASES[key] : undefined);
    if (mapped === field) return i;
  }
  return undefined;
};

const parseFiniteNumber = (value: string): number | undefined => {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const parseTerrestrialCoordinateCsv = (
  input: string,
  options: TerrestrialCsvImportOptions,
  sourceName?: string,
): ImportedDataset | null => {
  const fileLabel = sourceLeaf(sourceName ?? options.sourceFile);
  if (input.length > MAX_FILE_CHARS) return null;
  const unitKey = options.units?.trim().toLowerCase() ?? '';
  const toMeters = UNIT_TO_METERS[unitKey];
  if (toMeters == null) return null;

  const trace: ImportedTraceEntry[] = [];
  const rawLines = input.split('\n').map((line) => line.replace(/\r$/, ''));
  const dataLines = rawLines.filter((line) => line.trim() !== '' && !line.trim().startsWith('#'));
  if (dataLines.length < 2) return null;
  if (dataLines.length - 1 > MAX_ROWS) return null;

  const delimiter = options.delimiter ?? sniffDelimiter(dataLines[0] ?? '');
  const headers = splitCsvLine(dataLines[0] ?? '', delimiter);
  if (!headers) return null;

  const idCol = lookupColumn(headers, 'id', options);
  const northCol = lookupColumn(headers, 'northing', options);
  const eastCol = lookupColumn(headers, 'easting', options);
  if (idCol == null || northCol == null || eastCol == null) return null;
  const elevCol = lookupColumn(headers, 'elevation', options);
  const codeCol = lookupColumn(headers, 'code', options);
  const descCol = lookupColumn(headers, 'description', options);
  const noteCol = lookupColumn(headers, 'note', options);

  const stationMap = new Map<string, ImportedControlStationRecord>();
  dataLines.slice(1).forEach((line, rowIndex) => {
    const sourceLine = rowIndex + 2;
    const fields = splitCsvLine(line, delimiter);
    if (!fields) {
      trace.push({
        level: 'warning',
        sourceLine,
        sourceCode: 'CSV',
        message: 'Skipped row with an unterminated quoted field.',
      });
      return;
    }
    const cell = (col?: number): string => (col == null ? '' : (fields[col] ?? '').trim());
    const rawId = cell(idCol);
    if (!rawId || rawId.length > MAX_FIELD_CHARS) {
      trace.push({
        level: 'warning',
        sourceLine,
        sourceCode: 'CSV',
        message: 'Skipped row without a usable point identifier.',
      });
      return;
    }
    const northRaw = cell(northCol);
    const eastRaw = cell(eastCol);
    if (northRaw.length > MAX_FIELD_CHARS || eastRaw.length > MAX_FIELD_CHARS) {
      trace.push({
        level: 'warning',
        sourceLine,
        sourceCode: 'CSV',
        message: `Skipped point ${rawId} with an overlong coordinate field.`,
      });
      return;
    }
    const north = parseFiniteNumber(northRaw);
    const east = parseFiniteNumber(eastRaw);
    if (north == null || east == null) {
      trace.push({
        level: 'warning',
        sourceLine,
        sourceCode: 'CSV',
        message: `Skipped point ${rawId} with non-numeric Northing/Easting.`,
      });
      return;
    }
    const stationId = sanitizeStationId(rawId);
    const split = splitImportedCodeDescription(cell(codeCol) || undefined, cell(descCol) || undefined, sourceLine);
    const candidate: ImportedControlStationRecord = {
      kind: 'control-station',
      coordinateMode: 'local',
      stationId,
      northM: north * toMeters,
      eastM: east * toMeters,
      heightM: (elevCol != null && cell(elevCol) ? parseFiniteNumber(cell(elevCol)) ?? 0 : 0) * toMeters,
      description: split.description,
      feature: split.feature,
      note: cell(noteCol) || undefined,
      sourceLine,
      sourceCode: 'CSV',
    };
    const existing = stationMap.get(stationId);
    if (existing) {
      trace.push({
        level: 'warning',
        sourceLine,
        sourceCode: 'CSV',
        message: `Duplicate point ${stationId}; keeping the richer coordinate record.`,
      });
    }
    stationMap.set(stationId, choosePreferredStation(existing, candidate));
  });

  const controlStations = [...stationMap.values()];
  if (controlStations.length === 0) return null;
  const detailLines = [
    `Imported ${plural(controlStations.length, 'point')} from ${fileLabel} into normalized WebNet input.`,
    `Units: ${unitKey}; CRS: ${options.crs ?? 'caller-assigned (no transform applied)'}.`,
  ];
  const traceDetail = buildTraceDetailLine(trace);
  if (traceDetail) detailLines.push(traceDetail);

  return {
    importerId: 'terrestrial-csv',
    formatLabel: 'Terrestrial coordinate CSV',
    summary: `Imported CSV dataset with ${plural(controlStations.length, 'point')}`,
    notice: { title: 'Imported terrestrial CSV dataset', detailLines },
    comments: [
      'Imported from terrestrial coordinate CSV',
      `Source file: ${fileLabel}`,
      `Units: ${unitKey}`,
      `CRS: ${options.crs ?? 'unassigned'}`,
      `Imported points: ${controlStations.length}`,
    ],
    controlStations,
    observations: [],
    trace,
  };
};

export const detectTerrestrialCoordinateCsv = (input: string, sourceName?: string): boolean => {
  if (!/\.csv$/i.test(sourceName ?? '')) return false;
  const firstLine = input.split('\n').map((line) => line.replace(/\r$/, '')).find(
    (line) => line.trim() !== '' && !line.trim().startsWith('#'),
  );
  if (!firstLine) return false;
  const delimiter = sniffDelimiter(firstLine);
  const headers = splitCsvLine(firstLine, delimiter);
  if (!headers || headers.length < 3) return false;
  const keys = new Set(headers.map((header) => header.trim().toLowerCase()));
  const has = (field: CanonicalField): boolean =>
    [...keys].some((key) => COLUMN_ALIASES[key] === field || TRIMBLE_ACCESS_COLUMNS[key] === field);
  return has('id') && has('northing') && has('easting');
};

export const terrestrialCsvImporter: ExternalInputImporter = {
  id: 'terrestrial-csv',
  formatLabel: 'Terrestrial coordinate CSV',
  detect: (input, sourceName) => detectTerrestrialCoordinateCsv(input, sourceName),
  parse: (input, sourceName, options) =>
    parseTerrestrialCoordinateCsv(
      input,
      {
        units: options?.terrestrialCsv?.units ?? 'm',
        delimiter: options?.terrestrialCsv?.delimiter,
        preset: options?.terrestrialCsv?.preset,
        columnMapping: options?.terrestrialCsv?.columnMapping,
        crs: options?.terrestrialCsv?.crs,
        sourceFile: sourceName,
      },
      sourceName,
    ),
};

export interface TerrestrialCsvRegistryOptions {
  units?: string;
  delimiter?: string;
  preset?: string;
  columnMapping?: TerrestrialCsvColumnMapping;
  crs?: string;
}
