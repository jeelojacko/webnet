/**
 * Phase 19A — Toolspace nodes for survey tables. Counts and statuses read
 * from the derived snapshot; clicking a table selects it (row editor in the
 * properties dock), and style nodes open the Survey Table Style manager.
 * No inline mutations here.
 */
import React from 'react';
import type { CadShellActions, CadWorkspaceSnapshot } from './cadShellTypes';

const TreeGroup: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <details className="cad-shell-tree-group" open>
    <summary>{label}</summary>
    <div className="cad-shell-tree-children">{children}</div>
  </details>
);

const KIND_LABEL: Record<string, string> = {
  line: 'Line',
  curve: 'Curve',
  'parcel-course': 'Parcel Course',
  'parcel-summary': 'Parcel Summary',
  point: 'Point',
};

export const SurveyTablesNode: React.FC<{
  snapshot: CadWorkspaceSnapshot | null;
  actions: CadShellActions | null;
}> = ({ snapshot, actions }) => {
  const tables = snapshot?.surveyTable?.tables ?? [];
  return (
    <TreeGroup label={`Survey Tables (${tables.length})`}>
      {tables.length === 0 ? (
        <div className="cad-shell-tree-row cad-shell-empty" data-cad-survey-table-toolspace="empty">
          No survey tables — run Line Table / Curve Table / Point Table.
        </div>
      ) : (
        tables.map((table) => (
          <button
            key={table.id}
            type="button"
            className="cad-shell-tree-node"
            title={`${KIND_LABEL[table.tableKind] ?? table.tableKind} — ${table.rowCount} rows (${table.status})`}
            data-cad-survey-table-node={table.id}
            onClick={() => actions?.selectEntities([table.id])}
          >
            {table.title || `${KIND_LABEL[table.tableKind] ?? table.tableKind} Table`}
            <span className="cad-shell-count">{table.rowCount}</span>
          </button>
        ))
      )}
    </TreeGroup>
  );
};

export const SurveyTableStylesNode: React.FC<{
  snapshot: CadWorkspaceSnapshot | null;
  actions: CadShellActions | null;
}> = ({ snapshot, actions }) => {
  const styles = snapshot?.surveyTable?.styles ?? [];
  const canOpen = actions?.openSurveyTableManager != null;
  return (
    <TreeGroup label="Survey Table Styles">
      <div className="cad-shell-tree-row" data-cad-survey-table-styles="true">
        {styles.length === 0 ? 'No survey table styles.' : `${styles.length} style${styles.length === 1 ? '' : 's'}`}
      </div>
      {styles.map((style) => (
        <button
          key={style.id}
          type="button"
          className="cad-shell-tree-node"
          disabled={!canOpen}
          title={canOpen ? `Open the Survey Table Style manager (${style.name}).` : 'Survey table manager unavailable.'}
          data-cad-survey-table-style-node={style.id}
          onClick={() => actions?.openSurveyTableManager?.()}
        >
          {style.name}
        </button>
      ))}
    </TreeGroup>
  );
};

/**
 * Parcel node children: Courses (course table) and Reports (summary table)
 * for the selected parcel. Both arm the pick-insertion session.
 */
export const ParcelSurveyTablesNode: React.FC<{
  snapshot: CadWorkspaceSnapshot | null;
  actions: CadShellActions | null;
}> = ({ snapshot, actions }) => {
  const selectedParcelId =
    snapshot?.selectedEntityIds.find((id) => id.startsWith('cad-parcel')) ?? null;
  const tables = (snapshot?.surveyTable?.tables ?? []).filter(
    (table) => table.tableKind === 'parcel-course' || table.tableKind === 'parcel-summary',
  );
  const run = (key: 'PARCELTABLE' | 'PARCELREPORT' | 'PARCELDESC'): void => {
    actions?.startCommand?.(key);
  };
  return (
    <TreeGroup label="Parcels">
      <div className="cad-shell-tree-row" data-cad-parcel-tables="courses">
        Courses
      </div>
      <button
        type="button"
        className="cad-shell-tree-node"
        disabled={!snapshot || !actions || selectedParcelId == null}
        title="Create a parcel course table from the selected parcel."
        data-cad-parcel-course-table="true"
        onClick={() => run('PARCELTABLE')}
      >
        + Course Table
      </button>
      <div className="cad-shell-tree-row" data-cad-parcel-tables="reports">
        Reports
      </div>
      <button
        type="button"
        className="cad-shell-tree-node"
        disabled={!snapshot || !actions || selectedParcelId == null}
        title="Create a parcel summary report table from the selected parcel."
        data-cad-parcel-report-table="true"
        onClick={() => run('PARCELREPORT')}
      >
        + Parcel Report
      </button>
      <button
        type="button"
        className="cad-shell-tree-node"
        disabled={!snapshot || !actions || selectedParcelId == null}
        title="Create a parcel description table from the selected parcel."
        data-cad-parcel-desc-table="true"
        onClick={() => run('PARCELDESC')}
      >
        + Parcel Description
      </button>
      {tables.length > 0 ? (
        <div className="cad-shell-tree-row" data-cad-parcel-table-count={tables.length}>
          {tables.length} parcel table{tables.length === 1 ? '' : 's'}
        </div>
      ) : null}
    </TreeGroup>
  );
};
