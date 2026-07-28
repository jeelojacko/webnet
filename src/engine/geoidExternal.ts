import {
  buildGridModelFromMatrix,
  normalizeLongitude,
  validateGridShape,
} from './geoidGridHelpers';
import type { GeoidGridModel } from './geoidTypes';

type GtxHeader = {
  lat0: number;
  lon0: number;
  dLat: number;
  dLon: number;
  rows: number;
  cols: number;
  littleEndian: boolean;
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

export const parseExternalGridModel = (
  sourceFormat: 'gtx' | 'byn',
  sourceBytes: Uint8Array,
  modelId: string,
  sourceLabel: string,
  normalizeId: (_id: string) => string,
): GeoidGridModel | null => {
  if (sourceFormat === 'gtx') {
    return parseGtxGridModel(sourceBytes, modelId, sourceLabel, normalizeId);
  }
  return parseBynGridModel(sourceBytes, modelId, sourceLabel, normalizeId);
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
  normalizeId: (_id: string) => string,
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

  const fileRows: number[][] = Array.from({ length: header.rows }, () =>
    Array(header.cols).fill(0),
  );
  let offset = 40;
  for (let r = 0; r < header.rows; r += 1) {
    for (let c = 0; c < header.cols; c += 1) {
      if (offset + valueSize > view.byteLength) return null;
      const raw =
        valueSize === 8
          ? view.getFloat64(offset, header.littleEndian)
          : view.getFloat32(offset, header.littleEndian);
      offset += valueSize;
      fileRows[r][c] = Math.abs(raw + 88.8888) < 1e-5 ? Number.NaN : raw;
    }
  }

  const rowsByLat = header.dLat < 0 ? [...fileRows].reverse() : fileRows;
  const values =
    header.dLon < 0 ? rowsByLat.map((row) => [...row].reverse()) : rowsByLat.map((row) => [...row]);

  const lat0 = header.dLat < 0 ? header.lat0 + header.dLat * (header.rows - 1) : header.lat0;
  const lat1 = header.dLat < 0 ? header.lat0 : header.lat0 + header.dLat * (header.rows - 1);
  const lon0Raw = header.dLon < 0 ? header.lon0 + header.dLon * (header.cols - 1) : header.lon0;
  const lon1Raw = header.dLon < 0 ? header.lon0 : header.lon0 + header.dLon * (header.cols - 1);
  const lon0 = normalizeLongitude(lon0Raw);
  const lon1 = normalizeLongitude(lon1Raw);

  return buildGridModelFromMatrix(
    modelId,
    sourceLabel,
    header.rows,
    header.cols,
    Math.min(lat0, lat1),
    Math.max(lat0, lat1),
    Math.min(lon0, lon1),
    Math.max(lon0, lon1),
    values,
    normalizeId,
  );
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
  normalizeId: (_id: string) => string,
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
    const row = rows - 1 - fileRow;
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

  return buildGridModelFromMatrix(
    modelId,
    sourceLabel,
    rows,
    cols,
    latMin,
    latMax,
    Math.min(lonMin, lonMax),
    Math.max(lonMin, lonMax),
    values,
    normalizeId,
  );
};
