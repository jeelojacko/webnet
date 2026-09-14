import { buildCadInverseSummary } from './cadCogoSummaries';
import { cadBuildCurveMetricsSummaryFromRadiusDelta } from './cadCogoCurveMetrics';
import type { CadWorldPoint } from './cadGeometry';
import type { DraftPrecisionProfile } from './cadDraftTypes';
import {
  deriveInverseAutoText,
  formatDraftCoordinate,
  formatDraftDistance,
} from './cadLabelEngine';

export type DraftTableOrder = 'selection' | 'entityId' | 'pointId';
export type DraftTableWarning = 'OVERFLOW';

export interface DraftTable<THeaders extends string = string> {
  headers: THeaders[];
  rows: string[][];
  warnings: DraftTableWarning[];
}

export interface DraftPointTableEntry {
  pointId: string;
  entityId?: string;
  northing: number;
  easting: number;
  elevation?: number;
  description?: string;
}

export interface DraftLineTableLeg {
  lineId: string;
  fromId: string;
  toId: string;
  from: CadWorldPoint;
  to: CadWorldPoint;
}

export interface DraftCurveTableEntry {
  curveId: string;
  radius: number;
  deltaDeg: number;
}

interface TableOptions {
  order?: DraftTableOrder;
  selectionOrder?: readonly string[];
  precision?: Partial<DraftPrecisionProfile>;
  maxRows?: number;
}

const collate = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export const checkDraftTableOverflow = (
  rowCount: number,
  maxRows?: number,
): { clipped: boolean; warning?: DraftTableWarning } => {
  if (maxRows == null || !Number.isFinite(maxRows) || maxRows < 0) {
    return { clipped: false };
  }
  return rowCount > maxRows ? { clipped: true, warning: 'OVERFLOW' } : { clipped: false };
};

const clipWithWarning = (rowCount: number, maxRows?: number): DraftTableWarning[] => {
  const { warning } = checkDraftTableOverflow(rowCount, maxRows);
  return warning ? [warning] : [];
};

export const buildDraftPointTable = (
  entries: readonly DraftPointTableEntry[],
  options: TableOptions = {},
): DraftTable<'Point' | 'Northing' | 'Easting' | 'Elevation' | 'Description'> => {
  const order = options.order ?? 'pointId';
  const ranked = [...entries];
  if (order === 'pointId') {
    ranked.sort((a, b) => collate(a.pointId, b.pointId));
  } else if (order === 'entityId') {
    ranked.sort((a, b) => collate(a.entityId ?? a.pointId, b.entityId ?? b.pointId));
  } else if (options.selectionOrder) {
    const rank = new Map(options.selectionOrder.map((id, index) => [id, index]));
    ranked.sort(
      (a, b) => (rank.get(a.pointId) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.pointId) ?? Number.MAX_SAFE_INTEGER),
    );
  }
  const allRows = ranked.map((entry) => [
    entry.pointId,
    formatDraftCoordinate(entry.northing, options.precision),
    formatDraftCoordinate(entry.easting, options.precision),
    entry.elevation == null ? '—' : formatDraftCoordinate(entry.elevation, options.precision),
    entry.description ?? '',
  ]);
  const warnings = clipWithWarning(allRows.length, options.maxRows);
  const rows = options.maxRows != null ? allRows.slice(0, Math.max(0, Math.floor(options.maxRows))) : allRows;
  return { headers: ['Point', 'Northing', 'Easting', 'Elevation', 'Description'], rows, warnings };
};

export const buildDraftLineTable = (
  legs: readonly DraftLineTableLeg[],
  options: TableOptions = {},
): DraftTable<'LineID' | 'From' | 'To' | 'Bearing' | 'Distance'> => {
  const ranked = [...legs];
  if ((options.order ?? 'entityId') === 'selection' && options.selectionOrder) {
    const rank = new Map(options.selectionOrder.map((id, index) => [id, index]));
    ranked.sort(
      (a, b) => (rank.get(a.lineId) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.lineId) ?? Number.MAX_SAFE_INTEGER),
    );
  } else {
    ranked.sort((a, b) => collate(a.lineId, b.lineId));
  }
  const allRows = ranked.map((leg) => {
    const summary = buildCadInverseSummary(leg.from, leg.to);
    void summary;
    const bearing = deriveInverseAutoText(leg.from, leg.to, 'bearing', options.precision);
    const distance = deriveInverseAutoText(leg.from, leg.to, 'distance', options.precision);
    return [leg.lineId, leg.fromId, leg.toId, bearing, distance];
  });
  const warnings = clipWithWarning(allRows.length, options.maxRows);
  const rows = options.maxRows != null ? allRows.slice(0, Math.max(0, Math.floor(options.maxRows))) : allRows;
  return { headers: ['LineID', 'From', 'To', 'Bearing', 'Distance'], rows, warnings };
};

export const buildDraftCurveTable = (
  curves: readonly DraftCurveTableEntry[],
  options: TableOptions = {},
): DraftTable<'CurveID' | 'Radius' | 'Arc' | 'Chord' | 'Delta'> => {
  const ranked = [...curves];
  if ((options.order ?? 'entityId') === 'selection' && options.selectionOrder) {
    const rank = new Map(options.selectionOrder.map((id, index) => [id, index]));
    ranked.sort(
      (a, b) => (rank.get(a.curveId) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.curveId) ?? Number.MAX_SAFE_INTEGER),
    );
  } else {
    ranked.sort((a, b) => collate(a.curveId, b.curveId));
  }
  const allRows = ranked.map((curve) => {
    const summary = cadBuildCurveMetricsSummaryFromRadiusDelta(curve.radius, curve.deltaDeg);
    const dist = (v: number | undefined): string =>
      v == null || !Number.isFinite(v) ? '—' : formatDraftDistance(v, options.precision);
    return [
      curve.curveId,
      dist(summary?.radius),
      dist(summary?.arcLength),
      dist(summary?.chordLength),
      summary ? `${summary.deltaDeg.toFixed(0)}°` : '—',
    ];
  });
  const warnings = clipWithWarning(allRows.length, options.maxRows);
  const rows = options.maxRows != null ? allRows.slice(0, Math.max(0, Math.floor(options.maxRows))) : allRows;
  return { headers: ['CurveID', 'Radius', 'Arc', 'Chord', 'Delta'], rows, warnings };
};
