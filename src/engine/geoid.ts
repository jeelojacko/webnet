import type { GeoidInterpolationMethod, GeoidSourceFormat } from '../types';

export interface GeoidGridModel {
  id: string;
  name: string;
  source: string;
  rows: number;
  cols: number;
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
  dLat: number;
  dLon: number;
  values: number[][];
}

export interface GeoidGridLoadOptions {
  modelId?: string;
  sourceFormat?: GeoidSourceFormat;
  sourcePath?: string;
  sourceData?: ArrayBuffer | Uint8Array | null;
}

export interface GeoidGridLoadResult {
  model: GeoidGridModel | null;
  fromCache: boolean;
  warning?: string;
  resolvedFormat: GeoidSourceFormat;
  fallbackUsed: boolean;
}

const BUILTIN_GEOID_GRIDS: Record<string, string> = {
  'NGS-DEMO': `
# WEBNET GEOID GRID V1
ID NGS-DEMO
NAME NGS Demo Geoid
SOURCE Synthetic NGS-like sample
ROWS 3
COLS 3
LAT_MIN 39.0
LAT_MAX 41.0
LON_MIN -106.0
LON_MAX -104.0
VALUES
-29.9000,-29.8500,-29.8000
-29.7000,-29.6500,-29.6000
-29.5000,-29.4500,-29.4000
`.trim(),
  'NRC-DEMO': `
# WEBNET GEOID GRID V1
ID NRC-DEMO
NAME NRC Demo Geoid
SOURCE Synthetic NRC-like sample
ROWS 3
COLS 3
LAT_MIN 49.0
LAT_MAX 51.0
LON_MIN -115.0
LON_MAX -113.0
VALUES
-34.1000,-34.0500,-34.0000
-33.9000,-33.8500,-33.8000
-33.7000,-33.6500,-33.6000
`.trim(),
  'NAD83-CSRS-DEMO': `
# WEBNET GEOID GRID V1
ID NAD83-CSRS-DEMO
NAME NAD83(CSRS) Demo Geoid
SOURCE Synthetic Canada NAD83(CSRS) sample (CGG2013A-style)
ROWS 4
COLS 4
LAT_MIN 44.0
LAT_MAX 60.0
LON_MIN -136.0
LON_MAX -52.0
VALUES
-34.8000,-33.9000,-31.6000,-30.2000
-35.1000,-34.2000,-32.0000,-30.5000
-35.5000,-34.6000,-32.3000,-30.8000
-35.9000,-35.0000,-32.7000,-31.1000
`.trim(),
};

const BUILTIN_GEOID_MODEL_ALIASES: Record<string, string> = {
  'NAD83-CSRS': 'NAD83-CSRS-DEMO',
  NAD83CSRS: 'NAD83-CSRS-DEMO',
  CGG2013A: 'NAD83-CSRS-DEMO',
  'CGG2013A-CSRS': 'NAD83-CSRS-DEMO',
  CGVD2013A: 'NAD83-CSRS-DEMO',
  'CGVD2013A-CSRS': 'NAD83-CSRS-DEMO',
};

const modelCache = new Map<string, GeoidGridModel>();
const externalModelCache = new Map<string, GeoidGridModel>();

const parsePositiveInt = (token: string | undefined): number | null => {
  if (!token) return null;
  const parsed = Number.parseInt(token, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
};

const parseFinite = (token: string | undefined): number | null => {
  if (!token) return null;
  const parsed = Number.parseFloat(token);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
};

const normalizeLongitude = (lonDeg: number): number => {
  let normalized = lonDeg;
  while (normalized > 180) normalized -= 360;
  while (normalized < -180) normalized += 360;
  return normalized;
};

const isReasonableSpan = (min: number, max: number, step: number): boolean =>
  Number.isFinite(min) &&
  Number.isFinite(max) &&
  Number.isFinite(step) &&
  max > min &&
  step > 0 &&
  step <= Math.abs(max - min);

const validateGridShape = (rows: number, cols: number): boolean =>
  Number.isFinite(rows) && Number.isFinite(cols) && rows >= 2 && cols >= 2 && rows <= 200000 && cols <= 200000;

const hashBytes = (bytes: Uint8Array): string => {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < bytes.length; i += 1) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
};

const sourceDataToBytes = (sourceData?: ArrayBuffer | Uint8Array | null): Uint8Array | null => {
  if (!sourceData) return null;
  if (sourceData instanceof Uint8Array) return sourceData;
  if (sourceData instanceof ArrayBuffer) return new Uint8Array(sourceData);
  return null;
};

const readBinaryFromPathSync = (path: string): { bytes?: Uint8Array; warning?: string } => {
  const trimmed = path.trim();
  if (!trimmed) return { warning: 'empty external geoid/grid source path.' };
  try {
    const loader = new Function(
      'return typeof process !== "undefined" && process.versions && process.versions.node && typeof require !== "undefined" ? require("node:fs") : null;',
    ) as () => { readFileSync: (_path: string) => Uint8Array } | null;
    const fs = loader();
    if (!fs) {
      return {
        warning:
          'external geoid/grid source path was supplied but file loading is unavailable in this runtime.',
      };
    }
    const bytes = fs.readFileSync(trimmed);
    return { bytes: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { warning: `failed to read external geoid/grid source "${trimmed}": ${message}` };
  }
};

export const parseGeoidInterpolationToken = (
  token?: string,
): GeoidInterpolationMethod | null => {
  if (!token) return null;
  const upper = token.trim().toUpperCase();
  if (!upper) return null;
  if (upper === 'BILINEAR' || upper === 'BI') return 'bilinear';
  if (upper === 'NEAREST' || upper === 'NN') return 'nearest';
  return null;
};

export const normalizeGeoidModelId = (token?: string): string => {
  const normalized = String(token ?? '').trim().toUpperCase();
  if (!normalized) return 'NGS-DEMO';
  return BUILTIN_GEOID_MODEL_ALIASES[normalized] ?? normalized;
};

const parseBuiltinModelText = (text: string, fallbackId: string): GeoidGridModel | null => {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
  if (lines.length === 0) return null;

  let id = fallbackId;
  let name = fallbackId;
  let source = 'builtin';
  let rows = 0;
  let cols = 0;
  let latMin = 0;
  let latMax = 0;
  let lonMin = 0;
  let lonMax = 0;
  const values: number[][] = [];
  let inValues = false;

  for (const line of lines) {
    if (!inValues) {
      if (line.toUpperCase() === 'VALUES') {
        inValues = true;
        continue;
      }
      const parts = line.split(/\s+/);
      const key = parts[0].toUpperCase();
      const rest = parts.slice(1);
      if (key === 'ID') id = normalizeGeoidModelId(rest.join(' '));
      else if (key === 'NAME') name = rest.join(' ') || name;
      else if (key === 'SOURCE') source = rest.join(' ') || source;
      else if (key === 'ROWS') rows = parsePositiveInt(rest[0]) ?? 0;
      else if (key === 'COLS') cols = parsePositiveInt(rest[0]) ?? 0;
      else if (key === 'LAT_MIN') latMin = parseFinite(rest[0]) ?? latMin;
      else if (key === 'LAT_MAX') latMax = parseFinite(rest[0]) ?? latMax;
      else if (key === 'LON_MIN') lonMin = parseFinite(rest[0]) ?? lonMin;
      else if (key === 'LON_MAX') lonMax = parseFinite(rest[0]) ?? lonMax;
      continue;
    }
    const row = line
      .split(/[,\s]+/)
      .map((token) => Number.parseFloat(token))
      .filter((value) => Number.isFinite(value));
    if (row.length > 0) values.push(row);
  }

  if (!validateGridShape(rows, cols)) return null;
  if (!isReasonableSpan(latMin, latMax, (latMax - latMin) / (rows - 1))) return null;
  if (!isReasonableSpan(lonMin, lonMax, (lonMax - lonMin) / (cols - 1))) return null;
  if (values.length !== rows) return null;
  if (values.some((row) => row.length !== cols)) return null;

  const dLat = (latMax - latMin) / (rows - 1);
  const dLon = (lonMax - lonMin) / (cols - 1);
  if (!(dLat > 0) || !(dLon > 0)) return null;

  return {
    id,
    name,
    source,
    rows,
    cols,
    latMin,
    latMax,
    lonMin,
    lonMax,
    dLat,
    dLon,
    values,
  };
};

export const loadBuiltinGeoidGridModel = (rawId?: string): {
  model: GeoidGridModel | null;
  fromCache: boolean;
  warning?: string;
} => {
  const id = normalizeGeoidModelId(rawId);
  const cached = modelCache.get(id);
  if (cached) return { model: cached, fromCache: true };
  const text = BUILTIN_GEOID_GRIDS[id];
  if (!text) {
    return {
      model: null,
      fromCache: false,
      warning: `Unknown geoid/grid model "${id}". Available: ${Object.keys(BUILTIN_GEOID_GRIDS).join(', ')}`,
    };
  }
  const parsed = parseBuiltinModelText(text, id);
  if (!parsed) {
    return {
      model: null,
      fromCache: false,
      warning: `Invalid geoid/grid model "${id}" (failed validation).`,
    };
  }
  modelCache.set(id, parsed);
  return { model: parsed, fromCache: false };
};

const buildGridModelFromMatrix = (
  id: string,
  source: string,
  rows: number,
  cols: number,
  latMin: number,
  latMax: number,
  lonMin: number,
  lonMax: number,
  values: number[][],
): GeoidGridModel | null => {
  if (!validateGridShape(rows, cols)) return null;
  if (!isReasonableSpan(latMin, latMax, (latMax - latMin) / (rows - 1))) return null;
  if (!isReasonableSpan(lonMin, lonMax, (lonMax - lonMin) / (cols - 1))) return null;
  if (values.length !== rows) return null;
  if (values.some((row) => row.length !== cols)) return null;
  const dLat = (latMax - latMin) / (rows - 1);
  const dLon = (lonMax - lonMin) / (cols - 1);
  return {
    id: normalizeGeoidModelId(id),
    name: normalizeGeoidModelId(id),
    source,
    rows,
    cols,
    latMin,
    latMax,
    lonMin,
    lonMax,
    dLat,
    dLon,
    values,
  };
};

type GtxHeader = {
  lat0: number;
  lon0: number;
  dLat: number;
  dLon: number;
  rows: number;
  cols: number;
  littleEndian: boolean;
};

const parseGtxHeader = (view: DataView, littleEndian: boolean): GtxHeader | null => {
  if (view.byteLength < 40) return null;
  const lat0 = view.getFloat64(0, littleEndian);
  const lon0 = view.getFloat64(8, littleEndian);
  const dLat = view.getFloat64(16, littleEndian);
  const dLon = view.getFloat64(24, littleEndian);
  const rows = view.getInt32(32, littleEndian);
  const cols = view.getInt32(36, littleEndian);
  if (!validateGridShape(rows, cols)) return null;
  if (!Number.isFinite(lat0) || !Number.isFinite(lon0)) return null;
  if (!Number.isFinite(dLat) || !Number.isFinite(dLon)) return null;
  if (Math.abs(dLat) <= 0 || Math.abs(dLon) <= 0) return null;
  const lat1 = lat0 + dLat * (rows - 1);
  const lon1 = lon0 + dLon * (cols - 1);
  const latMin = Math.min(lat0, lat1);
  const latMax = Math.max(lat0, lat1);
  if (latMin < -90.5 || latMax > 90.5) return null;
  if (Math.abs(lon0) > 720 || Math.abs(lon1) > 720) return null;
  return { lat0, lon0, dLat, dLon, rows, cols, littleEndian };
};

const parseGtxGridModel = (
  bytes: Uint8Array,
  modelId: string,
  sourceLabel: string,
): GeoidGridModel | null => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const bigHeader = parseGtxHeader(view, false);
  const littleHeader = parseGtxHeader(view, true);
  const header = bigHeader ?? littleHeader;
  if (!header) return null;

  const count = header.rows * header.cols;
  const expectedFloat = 40 + count * 4;
  const expectedDouble = 40 + count * 8;
  const usesDouble = bytes.byteLength >= expectedDouble && bytes.byteLength < expectedFloat;
  if (bytes.byteLength < expectedFloat && bytes.byteLength < expectedDouble) return null;
  const valueSize = usesDouble ? 8 : 4;

  const fileRows: number[][] = Array.from({ length: header.rows }, () => Array(header.cols).fill(0));
  let offset = 40;
  for (let r = 0; r < header.rows; r += 1) {
    for (let c = 0; c < header.cols; c += 1) {
      if (offset + valueSize > view.byteLength) return null;
      const raw = valueSize === 8
        ? view.getFloat64(offset, header.littleEndian)
        : view.getFloat32(offset, header.littleEndian);
      offset += valueSize;
      fileRows[r][c] = Math.abs(raw + 88.8888) < 1e-5 ? Number.NaN : raw;
    }
  }

  const rowsByLat = header.dLat < 0 ? [...fileRows].reverse() : fileRows;
  const values =
    header.dLon < 0
      ? rowsByLat.map((row) => [...row].reverse())
      : rowsByLat.map((row) => [...row]);

  const lat0 = header.dLat < 0 ? header.lat0 + header.dLat * (header.rows - 1) : header.lat0;
  const lat1 = header.dLat < 0 ? header.lat0 : header.lat0 + header.dLat * (header.rows - 1);
  const lon0Raw = header.dLon < 0 ? header.lon0 + header.dLon * (header.cols - 1) : header.lon0;
  const lon1Raw = header.dLon < 0 ? header.lon0 : header.lon0 + header.dLon * (header.cols - 1);
  const lon0 = normalizeLongitude(lon0Raw);
  const lon1 = normalizeLongitude(lon1Raw);
  const lonMin = Math.min(lon0, lon1);
  const lonMax = Math.max(lon0, lon1);

  return buildGridModelFromMatrix(
    modelId,
    sourceLabel,
    header.rows,
    header.cols,
    Math.min(lat0, lat1),
    Math.max(lat0, lat1),
    lonMin,
    lonMax,
    values,
  );
};

type BynHeader = {
  southArcSec: number;
  northArcSec: number;
  westArcSec: number;
  eastArcSec: number;
  dLatArcSec: number;
  dLonArcSec: number;
  dataType: number;
  factor: number;
  sizeOfData: number;
  byteOrderFlag: number;
  scaleFlag: number;
  littleEndianHeader: boolean;
};

const parseBynHeader = (view: DataView, littleEndianHeader: boolean): BynHeader | null => {
  if (view.byteLength < 80) return null;
  const southArcSec = view.getInt32(0, littleEndianHeader);
  const northArcSec = view.getInt32(4, littleEndianHeader);
  const westArcSec = view.getInt32(8, littleEndianHeader);
  const eastArcSec = view.getInt32(12, littleEndianHeader);
  const dLatArcSec = Math.abs(view.getInt16(16, littleEndianHeader));
  const dLonArcSec = Math.abs(view.getInt16(18, littleEndianHeader));
  const dataType = view.getInt16(22, littleEndianHeader);
  const factor = view.getFloat64(24, littleEndianHeader);
  const sizeOfData = view.getInt16(32, littleEndianHeader);
  const byteOrderFlag = view.getInt16(48, littleEndianHeader);
  const scaleFlag = view.getInt16(50, littleEndianHeader);
  if (!(northArcSec > southArcSec)) return null;
  if (!(eastArcSec > westArcSec)) return null;
  if (!(dLatArcSec > 0) || !(dLonArcSec > 0)) return null;
  if (!Number.isFinite(factor) || Math.abs(factor) < 1e-12) return null;
  if (sizeOfData !== 2 && sizeOfData !== 4 && sizeOfData !== 8) return null;
  if (byteOrderFlag !== 0 && byteOrderFlag !== 1) return null;
  if (scaleFlag !== 0 && scaleFlag !== 1) return null;
  if (dataType < 1 || dataType > 6) return null;
  return {
    southArcSec,
    northArcSec,
    westArcSec,
    eastArcSec,
    dLatArcSec,
    dLonArcSec,
    dataType,
    factor,
    sizeOfData,
    byteOrderFlag,
    scaleFlag,
    littleEndianHeader,
  };
};

const parseBynGridModel = (
  bytes: Uint8Array,
  modelId: string,
  sourceLabel: string,
): GeoidGridModel | null => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLE = parseBynHeader(view, true);
  const headerBE = parseBynHeader(view, false);
  const header = headerLE ?? headerBE;
  if (!header) return null;

  const scaleDivisor = header.scaleFlag === 1 ? 1000 : 1;
  const southArcSec = header.southArcSec / scaleDivisor;
  const northArcSec = header.northArcSec / scaleDivisor;
  const westArcSec = header.westArcSec / scaleDivisor;
  const eastArcSec = header.eastArcSec / scaleDivisor;
  const dLatArcSec = header.dLatArcSec / scaleDivisor;
  const dLonArcSec = header.dLonArcSec / scaleDivisor;
  const rows = Math.round((northArcSec - southArcSec) / dLatArcSec) + 1;
  const cols = Math.round((eastArcSec - westArcSec) / dLonArcSec) + 1;
  if (!validateGridShape(rows, cols)) return null;

  const dataOffset = 80;
  const expectedBytes = dataOffset + rows * cols * header.sizeOfData;
  if (bytes.byteLength < expectedBytes) return null;
  const dataLittleEndian = header.byteOrderFlag === 1;
  const factor = header.factor;

  const values: number[][] = Array.from({ length: rows }, () => Array(cols).fill(Number.NaN));
  let offset = dataOffset;
  const undefined4Byte = Math.round(9999 * factor);
  for (let fileRow = 0; fileRow < rows; fileRow += 1) {
    const row = rows - 1 - fileRow; // BYN values are north->south; internal values are south->north.
    for (let c = 0; c < cols; c += 1) {
      if (offset + header.sizeOfData > view.byteLength) return null;
      let value = Number.NaN;
      if (header.sizeOfData === 2) {
        const raw = view.getInt16(offset, dataLittleEndian);
        if (raw !== 32767) value = raw / factor;
      } else if (header.sizeOfData === 4) {
        if (header.dataType === 3 || header.dataType === 6) {
          const rawFloat = view.getFloat32(offset, dataLittleEndian);
          if (Number.isFinite(rawFloat) && Math.abs(rawFloat - 9999) > 1e-6) {
            value = rawFloat;
          }
        } else {
          const raw = view.getInt32(offset, dataLittleEndian);
          if (raw !== undefined4Byte) value = raw / factor;
        }
      } else {
        const rawDouble = view.getFloat64(offset, dataLittleEndian);
        if (Number.isFinite(rawDouble) && Math.abs(rawDouble - 9999) > 1e-9) {
          value = rawDouble;
        }
      }
      values[row][c] = value;
      offset += header.sizeOfData;
    }
  }

  const latMin = southArcSec / 3600;
  const latMax = northArcSec / 3600;
  const lonMin = normalizeLongitude(westArcSec / 3600);
  const lonMax = normalizeLongitude(eastArcSec / 3600);
  const normalizedLonMin = Math.min(lonMin, lonMax);
  const normalizedLonMax = Math.max(lonMin, lonMax);

  return buildGridModelFromMatrix(
    modelId,
    sourceLabel,
    rows,
    cols,
    latMin,
    latMax,
    normalizedLonMin,
    normalizedLonMax,
    values,
  );
};

const parseExternalGridModel = (
  sourceFormat: 'gtx' | 'byn',
  sourceBytes: Uint8Array,
  modelId: string,
  sourceLabel: string,
): GeoidGridModel | null => {
  if (sourceFormat === 'gtx') return parseGtxGridModel(sourceBytes, modelId, sourceLabel);
  return parseBynGridModel(sourceBytes, modelId, sourceLabel);
};

export const loadGeoidGridModel = ({
  modelId,
  sourceFormat = 'builtin',
  sourcePath = '',
  sourceData,
}: GeoidGridLoadOptions): GeoidGridLoadResult => {
  const normalizedId = normalizeGeoidModelId(modelId);
  if (sourceFormat === 'builtin') {
    const loaded = loadBuiltinGeoidGridModel(normalizedId);
    return {
      model: loaded.model,
      fromCache: loaded.fromCache,
      warning: loaded.warning,
      resolvedFormat: 'builtin',
      fallbackUsed: false,
    };
  }

  let bytes = sourceDataToBytes(sourceData);
  let sourceWarning: string | undefined;
  if (!bytes && sourcePath.trim()) {
    const loaded = readBinaryFromPathSync(sourcePath);
    bytes = loaded.bytes ?? null;
    sourceWarning = loaded.warning;
  }
  if (!bytes) {
    const fallback = loadBuiltinGeoidGridModel(normalizedId);
    return {
      model: fallback.model,
      fromCache: fallback.fromCache,
      warning:
        sourceWarning ??
        `external geoid/grid source (${sourceFormat.toUpperCase()}) was requested but no binary source data is available.`,
      resolvedFormat: fallback.model ? 'builtin' : sourceFormat,
      fallbackUsed: Boolean(fallback.model),
    };
  }

  const cacheKey =
    sourcePath.trim().length > 0
      ? `${sourceFormat}:${sourcePath.trim()}`
      : `${sourceFormat}:bytes:${bytes.byteLength}:${hashBytes(bytes)}`;
  const cached = externalModelCache.get(cacheKey);
  if (cached) {
    return {
      model: cached,
      fromCache: true,
      resolvedFormat: sourceFormat,
      fallbackUsed: false,
    };
  }

  const sourceLabel = `external:${sourceFormat.toUpperCase()}${sourcePath ? `(${sourcePath})` : ''}`;
  const parsed = parseExternalGridModel(sourceFormat, bytes, normalizedId, sourceLabel);
  if (!parsed) {
    const fallback = loadBuiltinGeoidGridModel(normalizedId);
    return {
      model: fallback.model,
      fromCache: fallback.fromCache,
      warning:
        `failed to parse ${sourceFormat.toUpperCase()} geoid/grid source; falling back to built-in model "${normalizedId}"` +
        (sourcePath ? ` from "${sourcePath}"` : '.'),
      resolvedFormat: fallback.model ? 'builtin' : sourceFormat,
      fallbackUsed: Boolean(fallback.model),
    };
  }

  externalModelCache.set(cacheKey, parsed);
  return {
    model: parsed,
    fromCache: false,
    resolvedFormat: sourceFormat,
    fallbackUsed: false,
  };
};

export const geoidGridMetadataSummary = (model: GeoidGridModel): string =>
  `${model.id} ${model.rows}x${model.cols} lat=[${model.latMin.toFixed(4)},${model.latMax.toFixed(
    4,
  )}] lon=[${model.lonMin.toFixed(4)},${model.lonMax.toFixed(4)}] source=${model.source}`;

export const interpolateGeoidUndulation = (
  model: GeoidGridModel,
  latDeg: number,
  lonDeg: number,
  method: GeoidInterpolationMethod = 'bilinear',
): number | null => {
  if (
    !Number.isFinite(latDeg) ||
    !Number.isFinite(lonDeg) ||
    latDeg < model.latMin ||
    latDeg > model.latMax ||
    lonDeg < model.lonMin ||
    lonDeg > model.lonMax
  ) {
    return null;
  }

  const u = (latDeg - model.latMin) / model.dLat;
  const v = (lonDeg - model.lonMin) / model.dLon;

  if (method === 'nearest') {
    const i = Math.max(0, Math.min(model.rows - 1, Math.round(u)));
    const j = Math.max(0, Math.min(model.cols - 1, Math.round(v)));
    const value = model.values[i][j];
    return Number.isFinite(value) ? value : null;
  }

  const i0 = Math.max(0, Math.min(model.rows - 2, Math.floor(u)));
  const j0 = Math.max(0, Math.min(model.cols - 2, Math.floor(v)));
  const i1 = i0 + 1;
  const j1 = j0 + 1;
  const fu = u - i0;
  const fv = v - j0;

  const z00 = model.values[i0][j0];
  const z10 = model.values[i1][j0];
  const z01 = model.values[i0][j1];
  const z11 = model.values[i1][j1];
  if (!Number.isFinite(z00) || !Number.isFinite(z10) || !Number.isFinite(z01) || !Number.isFinite(z11)) {
    return null;
  }

  return (
    (1 - fu) * (1 - fv) * z00 +
    fu * (1 - fv) * z10 +
    (1 - fu) * fv * z01 +
    fu * fv * z11
  );
};
