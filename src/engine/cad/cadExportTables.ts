import type { DraftDocument } from './cadDraftTypes';
import { fragmentTitleForView, resolveFragmentView } from './cadDraftTables';
import type { ExportItem } from './cadExportScene';

// Paper-mm continued-table renderer (Phase 13C §§22-30). One definition
// feeds the canonical export scene (preview/SVG/PDF) and layout DXF, so
// all paper deliverables place identical table text. Model geometry is
// never touched: input is logical rows + fragment row ranges only.
export const TABLE_LAYER_ID = 'tables';
export const TABLE_TITLE_HEIGHT_MM = 3.5;
export const TABLE_ROW_HEIGHT_MM = 6;
export const TABLE_COLUMN_WIDTH_MM = 30;
const TABLE_TITLE_GAP_MM = 6;

export const buildTableFragmentItems = (draft: DraftDocument, sheetId: string): ExportItem[] => {
  const items: ExportItem[] = [];
  const tablesById = new Map((draft.tables ?? []).map((table) => [table.id, table]));
  const fragments = (draft.tableFragments ?? [])
    .filter((fragment) => fragment.sheetId === sheetId && tablesById.has(fragment.logicalTableId))
    .sort((a, b) => {
      const ta = tablesById.get(a.logicalTableId)?.name ?? '';
      const tb = tablesById.get(b.logicalTableId)?.name ?? '';
      if (ta !== tb) return ta < tb ? -1 : 1;
      if (a.fragmentIndex !== b.fragmentIndex) return a.fragmentIndex - b.fragmentIndex;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  fragments.forEach((fragment) => {
    const table = tablesById.get(fragment.logicalTableId);
    if (!table) return;
    const view = resolveFragmentView(table, fragment);
    const title = fragmentTitleForView(table.name, fragment.fragmentIndex, view.continued);
    const originX = fragment.paperXmm;
    const originY = fragment.paperYmm;
    items.push({
      kind: 'text',
      layer: TABLE_LAYER_ID,
      x: originX,
      y: originY + TABLE_TITLE_GAP_MM - 2,
      text: title,
      heightMm: TABLE_TITLE_HEIGHT_MM,
      anchor: 'start',
    });
    const bodyRows: string[][] = view.headers.length > 0 ? [view.headers, ...view.rows] : [...view.rows];
    const columnCount = bodyRows.reduce((widest, row) => Math.max(widest, row.length), 0);
    if (columnCount === 0) return;
    const gridTop = originY + TABLE_TITLE_GAP_MM;
    bodyRows.forEach((row, rowIndex) => {
      const yCell = gridTop + rowIndex * TABLE_ROW_HEIGHT_MM;
      for (let column = 0; column < columnCount; column += 1) {
        const xCell = originX + column * TABLE_COLUMN_WIDTH_MM;
        items.push({
          kind: 'rect',
          layer: TABLE_LAYER_ID,
          x: xCell,
          y: yCell,
          width: TABLE_COLUMN_WIDTH_MM,
          height: TABLE_ROW_HEIGHT_MM,
        });
        const cell = row[column] ?? '';
        if (cell !== '') {
          items.push({
            kind: 'text',
            layer: TABLE_LAYER_ID,
            x: xCell + 2,
            y: yCell + TABLE_ROW_HEIGHT_MM / 2 + 1,
            text: cell,
            heightMm: 2.5,
            anchor: 'start',
          });
        }
      }
    });
  });
  return items;
};
