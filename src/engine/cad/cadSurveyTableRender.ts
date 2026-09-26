/**
 * Phase 19A slice B — survey table presentation primitives.
 *
 * One `survey-table` entity becomes a small, bounded primitive set (frame +
 * grid lines + cell text + optional tag labels) — never hundreds of child
 * entities. Positions derive from `deriveCadSurveyTable`, so MOVE (x/y only),
 * ROTATE (rotationDeg), style changes, and annotation scale all flow through
 * without touching persisted values. Layer OFF/FROZEN hiding is handled by the
 * existing layer filter because every primitive carries the entity layerId.
 */
import type { CadProject, CadSurveyTableEntity } from './cadTypes';
import type { CadDisplayPrimitive } from './cadDisplayTypes';
import {
  cadSurveyTableLocalToWorld,
  deriveCadSurveyTable,
  type CadSurveyTableGridCell,
} from './cadSurveyTableDerive';

export interface CadSurveyTableRenderStyle {
  stroke: string;
  strokeWidthPx: number;
  fontSize: number;
  tagFontSize: number;
  opacity?: number;
}

const cellTextX = (
  cell: CadSurveyTableGridCell,
  padding: number,
  alignment: 'left' | 'center' | 'right',
): number =>
  alignment === 'center'
    ? cell.x + cell.width / 2
    : alignment === 'right'
      ? cell.x + cell.width - padding
      : cell.x + padding;

const textAnchorFor = (
  alignment: 'left' | 'center' | 'right',
): 'start' | 'middle' | 'end' =>
  alignment === 'center' ? 'middle' : alignment === 'right' ? 'end' : 'start';

export function buildCadSurveyTablePrimitives(
  table: CadSurveyTableEntity,
  project: CadProject,
  style: CadSurveyTableRenderStyle,
): CadDisplayPrimitive[] {
  const derived = deriveCadSurveyTable(table, project);
  const { stroke, strokeWidthPx, fontSize, tagFontSize, opacity } = style;
  const { metrics, grid, columns, rows } = derived;
  const base = {
    layerId: table.layerId,
    sourceEntityId: table.id,
    stroke,
    ...(opacity != null ? { opacity } : {}),
  } as const;
  const primitives: CadDisplayPrimitive[] = [];

  // Frame + grid lines (bounded: rows + columns + 4, never per-cell).
  grid.lines.forEach((line, index) => {
    primitives.push({
      ...base,
      kind: 'line',
      id: `primitive:${table.id}:grid:${index + 1}`,
      points: [
        { x: line.x1, y: line.y1 },
        { x: line.x2, y: line.y2 },
      ],
      strokeWidth: strokeWidthPx,
    });
  });

  const textAt = (
    id: string,
    u: number,
    v: number,
    rotationDeg: number,
    text: string,
    size: number,
    anchor: 'start' | 'middle' | 'end',
  ): void => {
    if (text.length === 0) return;
    const world = cadSurveyTableLocalToWorld(table, u, v);
    primitives.push({
      ...base,
      kind: 'text',
      id,
      point: world,
      text,
      fontSize: size,
      ...(rotationDeg !== 0 ? { rotationDeg } : {}),
      textAnchor: anchor,
    });
  };

  // Title band (centered).
  if (derived.title != null && metrics.titleHeight > 0) {
    textAt(
      `primitive:${table.id}:title`,
      metrics.tableWidth / 2,
      metrics.titleHeight / 2 + metrics.textHeightModel * 0.35,
      table.rotationDeg,
      derived.title,
      fontSize,
      'middle',
    );
  }

  // Header + body cells: one text primitive per non-empty cell.
  for (const cell of grid.cells) {
    if (cell.row === -2) continue;
    const isHeader = cell.row === -1;
    const column = columns[cell.column];
    if (!column) continue;
    const text = isHeader ? column.label : rows[cell.row]?.cells[cell.column];
    if (text == null || text.length === 0) continue;
    const alignment = isHeader ? tableStyleHeaderAlignment(project, table) : tableStyleBodyAlignment(project, table);
    const size = isHeader ? metrics.headerTextHeightModel : metrics.textHeightModel;
    // Font px is style-provided; keep header/body visually proportional.
    const scale = metrics.textHeightModel > 0 ? size / metrics.textHeightModel : 1;
    textAt(
      `primitive:${table.id}:cell:${cell.row}:${cell.column}`,
      cellTextX(cell, metrics.cellPaddingModel, alignment),
      cell.y + cell.height / 2 + metrics.textHeightModel * 0.35,
      table.rotationDeg,
      text,
      isHeader ? fontSize * scale : fontSize,
      textAnchorFor(alignment),
    );
  }

  // Tags (L#/C#) near their source anchors, horizontally readable.
  for (const tag of derived.tags) {
    primitives.push({
      ...base,
      kind: 'text',
      id: `primitive:${table.id}:tag:${tag.rowIndex + 1}`,
      point: { x: tag.x, y: tag.y },
      text: tag.code,
      fontSize: tagFontSize,
      ...(tag.rotationDeg !== 0 ? { rotationDeg: tag.rotationDeg } : {}),
      textAnchor: 'middle',
    });
  }

  return primitives;
}

const tableStyleHeaderAlignment = (
  project: CadProject,
  table: CadSurveyTableEntity,
): 'left' | 'center' | 'right' =>
  project.surveyTableStyles?.find((style) => style.id === table.tableStyleId)?.headerAlignment ??
  'center';

const tableStyleBodyAlignment = (
  project: CadProject,
  table: CadSurveyTableEntity,
): 'left' | 'center' | 'right' =>
  project.surveyTableStyles?.find((style) => style.id === table.tableStyleId)?.bodyAlignment ??
  'left';
