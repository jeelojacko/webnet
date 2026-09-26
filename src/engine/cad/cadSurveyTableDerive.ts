/**
 * Phase 19A slice B — pure survey table derivation.
 *
 * `deriveCadSurveyTable(table, project)` layers readable presentation on top
 * of the reference-only table entity: title, column registry (with per-column
 * visibility/heading overrides), formatted cells, metrics, world-space frame
 * grid, tag anchors, and a CURRENT/BROKEN/PARTIAL/EMPTY status.
 *
 * Every value string is read at call time from the authoritative COGO helpers
 * (`resolveCadSurveyTableRows` → parcel/line/arc/point formatters). Nothing
 * derived is persisted; the table stores references only. Auto codes are
 * prefix + running sequence (L1.., C1.., P1..); manual codes survive and
 * consume a sequence slot, so a reorder renumbers only the autos. Broken rows
 * stay visible with a `missing` status and `—` cells — never dropped.
 *
 * Paper-mode style dimensions convert through the Phase 18O annotation scale,
 * so 1:500 → 1:1000 scales model geometry while strings stay byte-identical.
 */
import type {
  CadEntity,
  CadProject,
  CadSurveyTableColumnOverride,
  CadSurveyTableEntity,
  CadSurveyTableRow,
  CadSurveyTableStyle,
} from './cadTypes';
import {
  cadSurveyTableColumns,
  defaultCadSurveyTablePrefix,
  resolveCadSurveyTableRows,
  resolveCadSurveyTableStyle,
  type CadSurveyTableResolvedColumn,
  type CadSurveyTableResolvedRow,
} from './cadSurveyTables';
import { resolveCadParcelCourses } from './cadParcelCourses';
import { cadArcMidpoint } from './cadGeometryArcPrimitives';
import type { CadWorldPoint } from './cadGeometry';
import {
  resolveAnnotationScaleDenominator,
  paperHeightMmToModelMeters,
} from './annotation/cadAnnotationSettings';
import { resolveCadAnnotationTextMetrics } from './annotation/cadAnnotationTextMetrics';

export type CadSurveyTableStatus =
  | 'CURRENT'
  | 'BROKEN_REFERENCE'
  | 'PARTIAL_BROKEN_REFERENCE'
  | 'EMPTY';

export type CadSurveyTableRowStatus = 'ok' | 'missing';

export interface CadSurveyTableDerivedRow {
  index: number;
  rowId: string;
  source: CadSurveyTableRow['source'];
  status: CadSurveyTableRowStatus;
  /** Visible code (manual code when set, else the auto prefix+sequence). */
  code: string;
  autoCode: string;
  customCode?: string;
  isAuto: boolean;
  /** Cell strings aligned with `columns`. */
  cells: string[];
  anchor?: CadWorldPoint;
}

export interface CadSurveyTableTagAnchor {
  rowIndex: number;
  rowId: string;
  code: string;
  /** Derived source anchor (line/arc/course midpoint or point). */
  anchorX: number;
  anchorY: number;
  /** Final tag position (anchor + auto normal + manual offset). */
  x: number;
  y: number;
  /** Horizontal readability (never rotated upside down). */
  rotationDeg: number;
}

export interface CadSurveyTableMetrics {
  textHeightModel: number;
  headerTextHeightModel: number;
  rowHeightModel: number;
  cellPaddingModel: number;
  borderWidthModel: number;
  titleGapModel: number;
  columnWidths: number[];
  tableWidth: number;
  titleHeight: number;
  headerHeight: number;
  bodyHeight: number;
  tableHeight: number;
}

export interface CadSurveyTableGridCell {
  /** -2 = title band, -1 = header band, >= 0 = body row index. */
  row: number;
  column: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CadSurveyTableGridLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface CadSurveyTableGrid {
  /** Local top-left insertion frame; null when the table has no bands. */
  frame: { x: number; y: number; width: number; height: number } | null;
  /** World frame corners (TL, TR, BR, BL); empty when no frame. */
  corners: CadWorldPoint[];
  cells: CadSurveyTableGridCell[];
  lines: CadSurveyTableGridLine[];
}

export interface CadSurveyTableColumn extends CadSurveyTableResolvedColumn {
  /** Always `code` for the leading column. */
  key: string;
}

export interface CadSurveyTableDerivation {
  tableId: string;
  kind: CadSurveyTableEntity['tableKind'];
  status: CadSurveyTableStatus;
  styleId: string;
  title: string | null;
  columns: CadSurveyTableColumn[];
  rows: CadSurveyTableDerivedRow[];
  metrics: CadSurveyTableMetrics;
  grid: CadSurveyTableGrid;
  tags: CadSurveyTableTagAnchor[];
  /** Visible codes that collide (a blocked edit). Deterministic order. */
  duplicateCodes: string[];
}

export function resolveCadSurveyTableColumns(
  table: CadSurveyTableEntity,
): CadSurveyTableColumn[] {
  const overrides = new Map<string, CadSurveyTableColumnOverride>();
  for (const override of table.columnOverrides ?? []) {
    if (override != null && typeof override.key === 'string') overrides.set(override.key, override);
  }
  const base: CadSurveyTableColumn[] = [
    { key: 'code', label: 'Code' },
    ...cadSurveyTableColumns(table.tableKind).map((column) => ({ ...column })),
  ];
  return base
    .filter((column) => overrides.get(column.key)?.visible !== false)
    .map((column) => {
      const heading = overrides.get(column.key)?.heading;
      return typeof heading === 'string' && heading.length > 0
        ? { key: column.key, label: heading }
        : column;
    });
}

interface CodeAssignment {
  code: string;
  autoCode: string;
  customCode?: string;
  isAuto: boolean;
}

/**
 * Recompute auto codes in persisted order. Manual codes win and consume their
 * sequence slot; an auto candidate that would collide with any manual code
 * skips forward. Pure and idempotent — the base of the Renumber operation.
 */
export function renumberCadSurveyTableCodes(
  table: CadSurveyTableEntity,
): CodeAssignment[] {
  const startNumber = Number.isFinite(table.startNumber) ? Math.trunc(table.startNumber!) : 1;
  const customCodes = new Set<string>();
  for (const row of table.rows) {
    const custom = row.customCode?.trim();
    if (custom) customCodes.add(custom);
  }
  const sequenceByPrefix = new Map<string, number>();
  return table.rows.map((row) => {
    const prefix = table.prefix?.trim() || defaultCadSurveyTablePrefix(table.tableKind);
    let sequence = (sequenceByPrefix.get(prefix) ?? startNumber - 1) + 1;
    let autoCode = `${prefix}${sequence}`;
    const customCode = row.customCode?.trim();
    // Manual codes consume their slot untouched; only auto candidates skip
    // forward past a manual code so the visible set stays duplicate-free.
    if (!customCode) {
      while (customCodes.has(autoCode)) {
        sequence += 1;
        autoCode = `${prefix}${sequence}`;
      }
    }
    sequenceByPrefix.set(prefix, sequence);
    return customCode
      ? { code: customCode, autoCode, customCode, isAuto: false }
      : { code: autoCode, autoCode, isAuto: true };
  });
}

export function findDuplicateSurveyTableCodes(rows: readonly { code: string }[]): string[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.code.length === 0) continue;
    counts.set(row.code, (counts.get(row.code) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([code]) => code)
    .sort();
}

const dimensionToModel = (
  value: number,
  mode: CadSurveyTableStyle['rowHeightMode'] | undefined,
  denominator: number,
  unitsMode: CadProject['metadata']['units'],
): number => {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return mode === 'paper' ? paperHeightMmToModelMeters(value, denominator, unitsMode) : value;
};

const textStyleMetrics = (
  project: CadProject,
  textStyleId: string | undefined,
  denominator: number,
): { modelHeight: number; widthFactor: number } => {
  const textStyle =
    textStyleId != null
      ? project.styleLibrary.textStyles.find((style) => style.id === textStyleId)
      : undefined;
  if (!textStyle) return { modelHeight: 2.5, widthFactor: 1 };
  const metrics = resolveCadAnnotationTextMetrics({
    fontFamily: textStyle.fontFamily,
    fontSize: textStyle.fontSize,
    heightMode: textStyle.heightMode,
    modelHeight: textStyle.modelHeight,
    paperHeightMm: textStyle.paperHeightMm,
    widthFactor: textStyle.widthFactor,
    lineSpacingFactor: textStyle.lineSpacingFactor,
    fontWeight: textStyle.fontWeight === 'bold' ? 700 : 400,
    fontStyle: textStyle.fontStyle,
    annotationScaleDenominator: denominator,
    unitsMode: project.metadata.units,
  });
  return { modelHeight: metrics.modelHeight, widthFactor: metrics.widthFactor };
};

const estimateTextWidth = (text: string, height: number, widthFactor: number): number => {
  const widest = text.split('\n').reduce((longest, line) => Math.max(longest, line.length), 0);
  return widest * 0.6 * height * widthFactor;
};

const findEntity = (project: CadProject, entityId: string | undefined): CadEntity | undefined =>
  entityId == null ? undefined : project.entities.find((entity) => entity.id === entityId);

interface RowAnchor {
  anchor: CadWorldPoint;
  normal: CadWorldPoint;
}

/** Derived tag anchor for a row source (line/arc/course midpoint or point). */
function resolveRowAnchor(project: CadProject, row: CadSurveyTableRow): RowAnchor | undefined {
  const source = row.source;
  switch (source.kind) {
    case 'line': {
      const line = findEntity(project, source.entityId);
      if (line?.type !== 'line') return undefined;
      const dx = line.toX - line.fromX;
      const dy = line.toY - line.fromY;
      const length = Math.hypot(dx, dy);
      return {
        anchor: { x: (line.fromX + line.toX) / 2, y: (line.fromY + line.toY) / 2 },
        normal: length > 1e-12 ? { x: -dy / length, y: dx / length } : { x: 0, y: 1 },
      };
    }
    case 'arc': {
      const arc = findEntity(project, source.entityId);
      if (arc?.type !== 'arc') return undefined;
      const center = { x: arc.centerX, y: arc.centerY };
      const anchor = cadArcMidpoint(center, arc.radius, arc.startAngleDeg, arc.endAngleDeg);
      const radial = { x: anchor.x - center.x, y: anchor.y - center.y };
      const length = Math.hypot(radial.x, radial.y);
      return {
        anchor,
        normal: length > 1e-12 ? { x: radial.x / length, y: radial.y / length } : { x: 0, y: 1 },
      };
    }
    case 'parcel-course': {
      const parcel = findEntity(project, source.parcelId);
      if (parcel?.type !== 'parcel') return undefined;
      const course = resolveCadParcelCourses(parcel).find(
        (entry) => entry.courseId === source.courseId,
      );
      if (!course) return undefined;
      return {
        anchor: course.midpoint,
        normal: { x: -course.directionY, y: course.directionX },
      };
    }
    case 'parcel':
      return undefined;
    case 'survey-point': {
      const point = findEntity(project, source.entityId);
      if (point?.type !== 'survey-point') return undefined;
      return { anchor: { x: point.x, y: point.y }, normal: { x: 0, y: 1 } };
    }
  }
}

const localToWorld = (table: CadSurveyTableEntity, u: number, v: number): CadWorldPoint => {
  const radians = (table.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: table.x + u * cos + v * sin,
    y: table.y + u * sin - v * cos,
  };
};

/** Local table (u right, v down) → world point. Shared by renderer/bounds. */
export const cadSurveyTableLocalToWorld = localToWorld;

function buildGrid(
  table: CadSurveyTableEntity,
  style: CadSurveyTableStyle,
  metrics: CadSurveyTableMetrics,
  rowCount: number,
): CadSurveyTableGrid {
  const { tableWidth, tableHeight, titleHeight, headerHeight, rowHeightModel, columnWidths } = metrics;
  const showHeader = table.showHeader !== false;
  const hasTitle = titleHeight > 0;
  const frame =
    tableWidth > 0 && tableHeight > 0
      ? { x: 0, y: 0, width: tableWidth, height: tableHeight }
      : null;
  const cells: CadSurveyTableGridCell[] = [];
  const lines: CadSurveyTableGridLine[] = [];
  const addLine = (x1: number, y1: number, x2: number, y2: number): void => {
    const a = localToWorld(table, x1, y1);
    const b = localToWorld(table, x2, y2);
    lines.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
  };
  const yBreaks = [0];
  if (hasTitle) yBreaks.push(titleHeight);
  if (showHeader) yBreaks.push(titleHeight + headerHeight);
  for (let index = 0; index < rowCount; index += 1) {
    yBreaks.push(titleHeight + headerHeight + (index + 1) * rowHeightModel);
  }
  const xBreaks: number[] = [0];
  let cursor = 0;
  for (const width of columnWidths) {
    cursor += width;
    xBreaks.push(cursor);
  }
  if (style.showInnerGrid) {
    for (let index = 1; index < yBreaks.length - 1; index += 1) {
      const y = yBreaks[index]!;
      addLine(0, y, tableWidth, y);
    }
    for (let index = 1; index < xBreaks.length - 1; index += 1) {
      const x = xBreaks[index]!;
      addLine(x, 0, x, tableHeight);
    }
  }
  if (style.showOuterBorder) {
    addLine(0, 0, tableWidth, 0);
    addLine(tableWidth, 0, tableWidth, tableHeight);
    addLine(tableWidth, tableHeight, 0, tableHeight);
    addLine(0, tableHeight, 0, 0);
  }
  if (hasTitle) cells.push({ row: -2, column: 0, x: 0, y: 0, width: tableWidth, height: titleHeight });
  if (showHeader) {
    let x = 0;
    for (let column = 0; column < columnWidths.length; column += 1) {
      const width = columnWidths[column]!;
      cells.push({ row: -1, column, x, y: titleHeight, width, height: headerHeight });
      x += width;
    }
  }
  for (let row = 0; row < rowCount; row += 1) {
    let x = 0;
    const y = titleHeight + headerHeight + row * rowHeightModel;
    for (let column = 0; column < columnWidths.length; column += 1) {
      const width = columnWidths[column]!;
      cells.push({ row, column, x, y, width, height: rowHeightModel });
      x += width;
    }
  }
  const corners = frame
    ? [
        localToWorld(table, 0, 0),
        localToWorld(table, tableWidth, 0),
        localToWorld(table, tableWidth, tableHeight),
        localToWorld(table, 0, tableHeight),
      ]
    : [];
  return { frame, corners, cells, lines };
}

const cellsFor = (
  columns: readonly CadSurveyTableColumn[],
  resolved: CadSurveyTableResolvedRow,
  code: string,
): string[] =>
  columns.map((column) => {
    if (column.key === 'code') return code;
    const value = resolved.values.find((entry) => entry.key === column.key);
    return value?.value ?? '';
  });

export function deriveCadSurveyTable(
  table: CadSurveyTableEntity,
  project: CadProject,
): CadSurveyTableDerivation {
  const style = resolveCadSurveyTableStyle(project, table.tableStyleId);
  const denominator = resolveAnnotationScaleDenominator(project);
  const unitsMode = project.metadata.units;
  const bodyText = textStyleMetrics(project, style.textStyleId, denominator);
  const headerText =
    style.headerTextStyleId != null
      ? textStyleMetrics(project, style.headerTextStyleId, denominator)
      : bodyText;
  const rowHeightModel = dimensionToModel(style.rowHeight, style.rowHeightMode, denominator, unitsMode);
  const cellPaddingModel = dimensionToModel(style.cellPadding, style.cellPaddingMode, denominator, unitsMode);
  const columns = resolveCadSurveyTableColumns(table);
  const resolvedRows = resolveCadSurveyTableRows(project, table);
  const assignments = renumberCadSurveyTableCodes(table);
  const rows: CadSurveyTableDerivedRow[] = resolvedRows.map((resolved, index) => {
    const assignment = assignments[index]!;
    const source = table.rows[index]!.source;
    const anchor = resolveRowAnchor(project, table.rows[index]!);
    return {
      index,
      rowId: resolved.rowId,
      source,
      status: resolved.status,
      code: assignment.code,
      autoCode: assignment.autoCode,
      ...(assignment.customCode != null ? { customCode: assignment.customCode } : {}),
      isAuto: assignment.isAuto,
      cells: cellsFor(columns, resolved, assignment.code),
      ...(anchor != null ? { anchor: anchor.anchor } : {}),
    };
  });
  const columnWidths = columns.map((column, columnIndex) => {
    let widest = estimateTextWidth(column.label, headerText.modelHeight, headerText.widthFactor);
    for (const row of rows) {
      widest = Math.max(
        widest,
        estimateTextWidth(
          row.cells[columnIndex] ?? '',
          bodyText.modelHeight,
          bodyText.widthFactor,
        ),
      );
    }
    return widest + 2 * cellPaddingModel;
  });
  const tableWidth = columnWidths.reduce((total, width) => total + width, 0);
  const headerHeight = table.showHeader !== false ? headerText.modelHeight + 2 * cellPaddingModel : 0;
  const titleText = table.title?.trim() ?? '';
  const titleHeight =
    titleText.length > 0 && table.showTitle !== false
      ? bodyText.modelHeight + style.titleGap
      : 0;
  const bodyHeight = rows.length * rowHeightModel;
  const metrics: CadSurveyTableMetrics = {
    textHeightModel: bodyText.modelHeight,
    headerTextHeightModel: headerText.modelHeight,
    rowHeightModel,
    cellPaddingModel,
    borderWidthModel: style.borderWidth,
    titleGapModel: style.titleGap,
    columnWidths,
    tableWidth,
    titleHeight,
    headerHeight,
    bodyHeight,
    tableHeight: titleHeight + headerHeight + bodyHeight,
  };
  const grid = buildGrid(table, style, metrics, rows.length);
  const tagSettings = table.tagSettings;
  const showTags = tagSettings?.showTags ?? true;
  const tags: CadSurveyTableTagAnchor[] = [];
  if (showTags) {
    const autoNormal = bodyText.modelHeight * 1.5;
    const defaultOffset = tagSettings?.tagOffset ?? { dx: 0, dy: 0 };
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]!;
      const anchor = row.anchor;
      if (row.status !== 'ok' || anchor == null) continue;
      const rowAnchor = resolveRowAnchor(project, table.rows[index]!);
      if (!rowAnchor) continue;
      const manual = table.rows[index]!.tagOffset ?? defaultOffset;
      const tagPrefix = tagSettings?.tagPrefix ?? '';
      tags.push({
        rowIndex: index,
        rowId: row.rowId,
        code: `${tagPrefix}${row.code}`,
        anchorX: anchor.x,
        anchorY: anchor.y,
        x: anchor.x + rowAnchor.normal.x * autoNormal + manual.dx,
        y: anchor.y + rowAnchor.normal.y * autoNormal + manual.dy,
        rotationDeg: 0,
      });
    }
  }
  const duplicateCodes = findDuplicateSurveyTableCodes(rows);
  const missingCount = rows.filter((row) => row.status === 'missing').length;
  const status: CadSurveyTableStatus =
    rows.length === 0
      ? 'EMPTY'
      : missingCount === rows.length
        ? 'BROKEN_REFERENCE'
        : missingCount > 0
          ? 'PARTIAL_BROKEN_REFERENCE'
          : 'CURRENT';
  return {
    tableId: table.id,
    kind: table.tableKind,
    status,
    styleId: style.id,
    title: titleText.length > 0 ? titleText : null,
    columns,
    rows,
    metrics,
    grid,
    tags,
    duplicateCodes,
  };
}

/** World bounds of the derived table frame (shared by renderer/hit-test/selection). */
export function cadSurveyTableWorldBounds(
  table: CadSurveyTableEntity,
  project: CadProject,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const corners = deriveCadSurveyTable(table, project).grid.corners;
  if (corners.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const corner of corners) {
    minX = Math.min(minX, corner.x);
    minY = Math.min(minY, corner.y);
    maxX = Math.max(maxX, corner.x);
    maxY = Math.max(maxY, corner.y);
  }
  return { minX, minY, maxX, maxY };
}
