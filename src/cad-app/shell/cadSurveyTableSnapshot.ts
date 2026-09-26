/**
 * Phase 19A — survey table snapshot for the shell (Toolspace + row editor).
 * Derived at read time from the reference-only table entities; never a
 * second source of truth. The selected table's resolved rows carry the
 * display cells plus the persisted custom code / tag offset so the editor
 * can round-trip them without touching viewport geometry.
 */
import type {
  CadProject,
  CadSurveyTableEntity,
  CadSurveyTableRowSource,
} from '../../engine/cad/cadTypes';
import { deriveCadSurveyTable } from '../../engine/cad/cadSurveyTableDerive';
import type {
  CadSurveyTableRowStatus,
  CadSurveyTableStatus,
} from '../../engine/cad/cadSurveyTableDerive';
import { resolveCadSurveyTableStyle } from '../../engine/cad/cadSurveyTables';

export type CadSurveyTableSnapshotStatus = CadSurveyTableStatus;

export interface CadSurveyTableSnapshotRow {
  rowId: string;
  code: string;
  customCode?: string;
  status: CadSurveyTableRowStatus;
  sourceKind: CadSurveyTableRowSource['kind'];
  cells: Array<{ key: string; label: string; value: string }>;
  showTag: boolean;
  tagOffset: { dx: number; dy: number };
}

export interface CadSurveyTableSnapshotEntry {
  id: string;
  tableKind: CadSurveyTableEntity['tableKind'];
  title: string;
  rowCount: number;
  status: CadSurveyTableSnapshotStatus;
  styleId: string;
  styleName: string;
  layerId: string;
}

export interface CadSurveyTableSnapshot {
  tables: CadSurveyTableSnapshotEntry[];
  styles: Array<{ id: string; name: string; description?: string }>;
  selectedTableId: string | null;
  selectedTable: CadSurveyTableEntity | null;
  selectedColumns: Array<{ key: string; label: string }>;
  selectedRows: CadSurveyTableSnapshotRow[];
}

const surveyTablesOf = (project: CadProject): CadSurveyTableEntity[] =>
  project.entities.filter(
    (entity): entity is CadSurveyTableEntity => entity.type === 'survey-table',
  );

export const buildCadSurveyTableSnapshot = (
  project: CadProject,
  selectedEntityIds: readonly string[],
): CadSurveyTableSnapshot => {
  const tables = surveyTablesOf(project);
  const styles = (project.surveyTableStyles ?? []).map((style) => ({
    id: style.id,
    name: style.name,
    ...(style.description != null ? { description: style.description } : {}),
  }));
  const entries: CadSurveyTableSnapshotEntry[] = tables.map((table) => {
    const derived = deriveCadSurveyTable(table, project);
    const style = resolveCadSurveyTableStyle(project, table.tableStyleId);
    return {
      id: table.id,
      tableKind: table.tableKind,
      title: table.title ?? '',
      rowCount: table.rows.length,
      status: derived.status,
      styleId: table.tableStyleId,
      styleName: style.name,
      layerId: table.layerId,
    };
  });
  const selectedTable =
    tables.find((table) => selectedEntityIds.includes(table.id)) ?? null;
  if (!selectedTable) {
    return { tables: entries, styles, selectedTableId: null, selectedTable: null, selectedColumns: [], selectedRows: [] };
  }
  const derived = deriveCadSurveyTable(selectedTable, project);
  const selectedRows: CadSurveyTableSnapshotRow[] = derived.rows.map((row) => {
    const persisted = selectedTable.rows[row.index];
    return {
      rowId: row.rowId,
      code: row.code,
      ...(row.customCode != null ? { customCode: row.customCode } : {}),
      status: row.status,
      sourceKind: row.source.kind,
      cells: derived.columns.map((column, columnIndex) => ({
        key: column.key,
        label: column.label,
        value: row.cells[columnIndex] ?? '—',
      })),
      showTag: persisted?.showTag ?? selectedTable.tagSettings?.showTags ?? false,
      tagOffset: persisted?.tagOffset ?? selectedTable.tagSettings?.tagOffset ?? { dx: 0, dy: 0 },
    };
  });
  return {
    tables: entries,
    styles,
    selectedTableId: selectedTable.id,
    selectedTable,
    selectedColumns: derived.columns.map((column) => ({ key: column.key, label: column.label })),
    selectedRows,
  };
};
