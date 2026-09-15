import { createStableRuntimeId } from '../id';
import { buildCadInverseSummary } from './cadCogoSummaries';
import type {
  DraftDocument,
  DraftLogicalTable,
  DraftTableContinueMode,
  DraftTableFragment,
  DraftTableRowRange,
} from './cadDraftTypes';
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

// ---- Continued tables (Phase 13C §§22-30) ----
// One logical table owns rows; fragments reference deterministic row ranges
// (no data copies). All geometry is sheet/paper-mm only; moving a fragment
// never touches source rows. AUTO mode slices rows sequentially into
// subsequent fragments/sheets; columns, format, order, header, source
// selection, and precision are preserved from the logical table and text is
// never silently resized to fit.

export const CONTINUED_MARKER_TEXT = 'Continued';

export const createLogicalTableFromDraftTable = (args: {
  name: string;
  headers: readonly string[];
  rows: readonly (readonly string[])[];
  continueMode?: DraftTableContinueMode;
  headerRepeat?: boolean;
  showContinuedMarker?: boolean;
  maxRowsPerFragment?: number;
  order?: string;
  selectionIds?: readonly string[];
}): DraftLogicalTable => ({
  id: createStableRuntimeId('draft-table'),
  name: args.name,
  headers: [...args.headers],
  rows: args.rows.map((row) => [...row]),
  continueMode: args.continueMode ?? 'AUTO',
  headerRepeat: args.headerRepeat !== false,
  showContinuedMarker: args.showContinuedMarker !== false,
  maxRowsPerFragment: Math.max(1, Math.floor(args.maxRowsPerFragment ?? 25)),
  ...(args.order != null ? { order: args.order } : {}),
  ...(args.selectionIds ? { selectionIds: [...args.selectionIds] } : {}),
});

export const continuedRowRangesForCount = (rowCount: number, maxRowsPerFragment: number): DraftTableRowRange[] => {
  const per = Math.max(1, Math.floor(maxRowsPerFragment));
  const ranges: DraftTableRowRange[] = [];
  for (let start = 0; start < rowCount; start += per) {
    ranges.push({ start, count: Math.min(per, rowCount - start) });
  }
  return ranges;
};

export const continuedRangesForTable = (table: DraftLogicalTable): DraftTableRowRange[] =>
  continuedRowRangesForCount(table.rows.length, table.maxRowsPerFragment);

// Fragment view: header (repeated when enabled) plus the referenced slice.
// The slice is a view over owned rows; callers must not mutate it.
export const resolveFragmentView = (
  table: DraftLogicalTable,
  fragment: Pick<DraftTableFragment, 'rowRange' | 'fragmentIndex'>,
): { headers: string[]; rows: string[][]; continued: boolean } => {
  const { start, count } = fragment.rowRange;
  const rows = table.rows.slice(start, start + Math.max(0, count));
  return {
    headers: table.headerRepeat ? [...table.headers] : fragment.fragmentIndex === 0 ? [...table.headers] : [],
    rows,
    continued: table.showContinuedMarker && fragment.fragmentIndex > 0,
  };
};

export const fragmentTitleForView = (tableName: string, fragmentIndex: number, continued: boolean): string =>
  continued ? `${tableName} (${CONTINUED_MARKER_TEXT} ${fragmentIndex + 1})` : tableName;

// Coverage check: every source row appears exactly once, in order.
export const validateContinuedCoverage = (
  table: DraftLogicalTable,
  fragments: readonly Pick<DraftTableFragment, 'rowRange' | 'fragmentIndex'>[],
): { ok: boolean; missing: number[]; duplicated: number[] } => {
  const seen = new Map<number, number>();
  fragments.forEach((fragment) => {
    const { start, count } = fragment.rowRange;
    for (let i = start; i < start + Math.max(0, count); i += 1) {
      seen.set(i, (seen.get(i) ?? 0) + 1);
    }
  });
  const missing: number[] = [];
  const duplicated: number[] = [];
  for (let i = 0; i < table.rows.length; i += 1) {
    const hits = seen.get(i) ?? 0;
    if (hits === 0) missing.push(i);
    else if (hits > 1) duplicated.push(i);
  }
  return { ok: missing.length === 0 && duplicated.length === 0, missing, duplicated };
};

// Draft-level ops (pure; run inside runDraftSheetCommand for undo/redo).
export const addLogicalTableToDraft = (draft: DraftDocument, table: DraftLogicalTable): DraftDocument => ({
  ...draft,
  tables: [...(draft.tables ?? []), table],
});

export interface ContinuedPlacement { sheetId: string; paperXmm: number; paperYmm: number }

// Paper-mm cascade step applied per repeat cycle when AUTO ranges exceed
// the supplied placements, so repeated fragments never stack silently.
// ponytail: fixed 8mm diagonal cascade; collision-aware packing only if sheets get crowded.
export const CONTINUED_REPEAT_CASCADE_MM = 8;

// AUTO layout: one fragment per row range, placed round-robin over the
// given sheet placements (deterministic; repeats sheets when ranges exceed
// placements). Fragments that reuse a placement cascade diagonally in
// paper-mm per repeat cycle, so no two fragments share one origin.
export const layoutContinuedFragments = (
  draft: DraftDocument,
  tableId: string,
  placements: readonly ContinuedPlacement[],
): DraftDocument => {
  const table = (draft.tables ?? []).find((entry) => entry.id === tableId);
  if (!table || placements.length === 0) return draft;
  const ranges = table.continueMode === 'AUTO' ? continuedRangesForTable(table) : continuedRowRangesForCount(Math.min(table.rows.length, table.maxRowsPerFragment), table.maxRowsPerFragment);
  const kept = (draft.tableFragments ?? []).filter((fragment) => fragment.logicalTableId !== tableId);
  const created: DraftTableFragment[] = ranges.map((rowRange, fragmentIndex) => {
    const placement = placements[fragmentIndex % placements.length] as ContinuedPlacement;
    const repeatCycle = Math.floor(fragmentIndex / placements.length);
    return {
      id: createStableRuntimeId('draft-table-fragment'),
      logicalTableId: tableId,
      sheetId: placement.sheetId,
      fragmentIndex,
      rowRange: { ...rowRange },
      paperXmm: placement.paperXmm + repeatCycle * CONTINUED_REPEAT_CASCADE_MM,
      paperYmm: placement.paperYmm + repeatCycle * CONTINUED_REPEAT_CASCADE_MM,
    };
  });
  return { ...draft, tableFragments: [...kept, ...created] };
};

// Source change: replace owned rows, then recompute AUTO ranges so all
// fragments update together with no missing/duplicated rows.
export const updateLogicalTableRowsInDraft = (
  draft: DraftDocument,
  tableId: string,
  rows: readonly (readonly string[])[],
): DraftDocument => {
  const table = (draft.tables ?? []).find((entry) => entry.id === tableId);
  if (!table) return draft;
  const next: DraftLogicalTable = { ...table, rows: rows.map((row) => [...row]) };
  const ranges = next.continueMode === 'AUTO'
    ? continuedRangesForTable(next)
    : continuedRowRangesForCount(Math.min(next.rows.length, next.maxRowsPerFragment), next.maxRowsPerFragment);
  const prior = (draft.tableFragments ?? []).filter((fragment) => fragment.logicalTableId === tableId)
    .sort((a, b) => a.fragmentIndex - b.fragmentIndex);
  const fallbackSheet = prior[0]?.sheetId ?? draft.sheets[0]?.id;
  if (fallbackSheet == null) {
    return { ...draft, tables: (draft.tables ?? []).map((entry) => (entry.id === tableId ? next : entry)) };
  }
  const rebuilt: DraftTableFragment[] = ranges.map((rowRange, fragmentIndex) => {
    const keep = prior[Math.min(fragmentIndex, prior.length - 1)] as DraftTableFragment | undefined;
    return {
      id: keep && fragmentIndex < prior.length ? (prior[fragmentIndex] as DraftTableFragment).id : createStableRuntimeId('draft-table-fragment'),
      logicalTableId: tableId,
      sheetId: keep?.sheetId ?? fallbackSheet,
      fragmentIndex,
      rowRange: { ...rowRange },
      paperXmm: keep?.paperXmm ?? 10,
      paperYmm: keep?.paperYmm ?? 10,
    };
  });
  return {
    ...draft,
    tables: (draft.tables ?? []).map((entry) => (entry.id === tableId ? next : entry)),
    tableFragments: [...(draft.tableFragments ?? []).filter((fragment) => fragment.logicalTableId !== tableId), ...rebuilt],
  };
};

export const moveTableFragmentInDraft = (
  draft: DraftDocument,
  fragmentId: string,
  paper: { xMm: number; yMm: number },
): DraftDocument => ({
  ...draft,
  tableFragments: (draft.tableFragments ?? []).map((fragment) =>
    fragment.id === fragmentId ? { ...fragment, paperXmm: paper.xMm, paperYmm: paper.yMm } : fragment,
  ),
});
