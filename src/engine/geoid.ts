import type { GeoidInterpolationMethod } from '../types';

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
};

const modelCache = new Map<string, GeoidGridModel>();

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
  return normalized || 'NGS-DEMO';
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

  if (rows < 2 || cols < 2) return null;
  if (!(latMax > latMin) || !(lonMax > lonMin)) return null;
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

export const geoidGridMetadataSummary = (model: GeoidGridModel): string =>
  `${model.id} ${model.rows}x${model.cols} lat=[${model.latMin.toFixed(4)},${model.latMax.toFixed(
    4,
  )}] lon=[${model.lonMin.toFixed(4)},${model.lonMax.toFixed(4)}]`;

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
    return model.values[i][j];
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

  return (
    (1 - fu) * (1 - fv) * z00 +
    fu * (1 - fv) * z10 +
    (1 - fu) * fv * z01 +
    fu * fv * z11
  );
};
