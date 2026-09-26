/**
 * Phase 19A — survey table properties + dense row editor. One component, two
 * stacked sections: the selected table's placement/options, and a row-by-row
 * editor (code/source/status + per-kind cells) with Add Selected, Remove,
 * Up/Down, Replace Source, custom code and tag-offset editing. Every mutation
 * routes through one `SURVEYTABLE_EDIT` / `TABLESTYLE` undo entry.
 */
import React, { useEffect, useState } from 'react';
import type { CadSurveyTableRowSource } from '../../engine/cad/cadTypes';
import type {
  CadSurveyTableEdit,
  CadSurveyTableOptionsPatch,
} from '../../engine/cad/cadSurveyTables';
import type { CadShellActions, CadWorkspaceSnapshot } from './cadShellTypes';

interface CadSurveyTablePanelProps {
  snapshot: CadWorkspaceSnapshot | null;
  actions: CadShellActions | null;
}

const KIND_LABEL: Record<string, string> = {
  line: 'Line',
  curve: 'Curve',
  'parcel-course': 'Parcel Course',
  'parcel-summary': 'Parcel Summary',
  point: 'Point',
};

const sourceForSelection = (
  tableKind: string,
  selectionPreview: CadWorkspaceSnapshot['selectionPreview'],
): CadSurveyTableRowSource | null => {
  const expectedType =
    tableKind === 'line'
      ? 'line'
      : tableKind === 'curve'
        ? 'arc'
        : tableKind === 'point'
          ? 'survey-point'
          : null;
  if (expectedType == null) return null;
  const match = selectionPreview.find((entry) => entry.type === expectedType);
  if (!match) return null;
  if (expectedType === 'line') return { kind: 'line', entityId: match.id };
  if (expectedType === 'arc') return { kind: 'arc', entityId: match.id };
  return { kind: 'survey-point', entityId: match.id };
};

const sameKindSourceForRow = (
  row: { sourceKind: CadSurveyTableRowSource['kind'] },
  selectionPreview: CadWorkspaceSnapshot['selectionPreview'],
): CadSurveyTableRowSource | null => {
  if (row.sourceKind === 'line' || row.sourceKind === 'arc' || row.sourceKind === 'survey-point') {
    return sourceForSelection(
      row.sourceKind === 'line' ? 'line' : row.sourceKind === 'arc' ? 'curve' : 'point',
      selectionPreview,
    );
  }
  return null;
};

export const CadSurveyTablePanel: React.FC<CadSurveyTablePanelProps> = ({ snapshot, actions }) => {
  const table = snapshot?.surveyTable?.selectedTable ?? null;
  const rows = snapshot?.surveyTable?.selectedRows ?? [];
  const columns = snapshot?.surveyTable?.selectedColumns ?? [];
  const styles = snapshot?.surveyTable?.styles ?? [];
  const [title, setTitle] = useState('');
  const [prefix, setPrefix] = useState('');
  const [startNumber, setStartNumber] = useState('1');

  useEffect(() => {
    setTitle(table?.title ?? '');
    setPrefix(table?.prefix ?? '');
    setStartNumber(`${table?.startNumber ?? 1}`);
  }, [table?.id, table?.title, table?.prefix, table?.startNumber]);

  if (!table || !snapshot) {
    return (
      <div className="cad-survey-table-panel" data-cad-survey-table-panel="empty">
        <p className="cad-shell-empty">Select a survey table to edit its options and rows.</p>
      </div>
    );
  }

  const edit = (payload: CadSurveyTableEdit): void => {
    actions?.runSurveyCommand({
      key: 'SURVEYTABLE_EDIT',
      tableEntityId: table.id,
      edit: payload,
    });
  };
  const setOptions = (patch: CadSurveyTableOptionsPatch): void => edit({ kind: 'set-options', patch });
  const selectedSource = sourceForSelection(table.tableKind, snapshot.selectionPreview);

  return (
    <div className="cad-survey-table-panel" data-cad-survey-table-panel="true">
      <section aria-label="Survey table properties">
        <h4>Survey Table</h4>
        <label>
          Title
          <input
            data-cad-survey-table-title
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={() => setOptions({ title })}
            onKeyDown={(event) => {
              if (event.key === 'Enter') setOptions({ title });
            }}
          />
        </label>
        <dl>
          <dt>Kind</dt>
          <dd data-cad-survey-table-kind>{KIND_LABEL[table.tableKind] ?? table.tableKind}</dd>
          <dt>Rows</dt>
          <dd data-cad-survey-table-row-count>{table.rows.length}</dd>
          <dt>Insertion</dt>
          <dd data-cad-survey-table-insertion>
            {table.x.toFixed(3)}, {table.y.toFixed(3)}
          </dd>
          <dt>Rotation</dt>
          <dd data-cad-survey-table-rotation>{table.rotationDeg.toFixed(3)}</dd>
        </dl>
        <label>
          Style
          <select
            data-cad-survey-table-style
            value={table.tableStyleId}
            onChange={(event) => setOptions({ tableStyleId: event.target.value })}
          >
            {styles.map((style) => (
              <option key={style.id} value={style.id}>
                {style.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Prefix
          <input
            data-cad-survey-table-prefix
            value={prefix}
            onChange={(event) => setPrefix(event.target.value)}
            onBlur={() => setOptions({ prefix })}
          />
        </label>
        <label>
          Start number
          <input
            data-cad-survey-table-start-number
            type="number"
            value={startNumber}
            onChange={(event) => setStartNumber(event.target.value)}
            onBlur={() => setOptions({ startNumber: Number.parseInt(startNumber, 10) || 1 })}
          />
        </label>
        <label>
          <input
            type="checkbox"
            data-cad-survey-table-show-header
            checked={table.showHeader ?? true}
            onChange={(event) => setOptions({ showHeader: event.target.checked })}
          />
          Show header
        </label>
        <label>
          <input
            type="checkbox"
            data-cad-survey-table-show-title
            checked={table.showTitle ?? true}
            onChange={(event) => setOptions({ showTitle: event.target.checked })}
          />
          Show title
        </label>
        <label>
          <input
            type="checkbox"
            data-cad-survey-table-show-tags
            checked={table.tagSettings?.showTags ?? false}
            onChange={(event) =>
              setOptions({ tagSettings: { ...(table.tagSettings ?? {}), showTags: event.target.checked } })
            }
          />
          Show tags
        </label>
      </section>
      <section aria-label="Survey table rows">
        <div className="cad-survey-table-rows-header">
          <h4>Rows</h4>
          <button
            type="button"
            disabled={selectedSource == null}
            title={
              selectedSource == null
                ? 'Select a compatible entity in the viewport first (parcel kinds use Parcel Report/Description).'
                : 'Append the selected entity as a row.'
            }
            data-cad-survey-table-add-selected
            onClick={() => {
              if (selectedSource != null) edit({ kind: 'add-row', source: selectedSource });
            }}
          >
            Add Selected
          </button>
        </div>
        <table className="cad-survey-table-rows">
          <thead>
            <tr>
              <th>Code</th>
              <th>Source</th>
              <th>Status</th>
              {columns.map((column) => (
                <th key={column.key}>{column.label}</th>
              ))}
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.rowId} data-cad-survey-table-row={row.rowId}>
                <td>
                  <input
                    data-cad-survey-table-row-code
                    defaultValue={row.customCode ?? row.code}
                    onBlur={(event) => edit({ kind: 'set-custom-code', rowId: row.rowId, customCode: event.target.value })}
                  />
                </td>
                <td data-cad-survey-table-row-source>{row.sourceKind}</td>
                <td data-cad-survey-table-row-status>{row.status}</td>
                {columns.map((column, columnIndex) => (
                  <td key={column.key}>{row.cells[columnIndex]?.value ?? '—'}</td>
                ))}
                <td>
                  <button
                    type="button"
                    disabled={index === 0}
                    data-cad-survey-table-row-up
                    onClick={() => edit({ kind: 'reorder-row', rowId: row.rowId, direction: 'up' })}
                  >
                    Up
                  </button>
                  <button
                    type="button"
                    disabled={index === rows.length - 1}
                    data-cad-survey-table-row-down
                    onClick={() => edit({ kind: 'reorder-row', rowId: row.rowId, direction: 'down' })}
                  >
                    Down
                  </button>
                  <button
                    type="button"
                    data-cad-survey-table-row-remove
                    onClick={() => edit({ kind: 'remove-row', rowId: row.rowId })}
                  >
                    Remove
                  </button>
                  <button
                    type="button"
                    disabled={sameKindSourceForRow(row, snapshot.selectionPreview) == null}
                    title="Replace this row's source with the selected same-type entity (keeps code, order, tag offset)."
                    data-cad-survey-table-row-replace
                    onClick={() => {
                      const source = sameKindSourceForRow(row, snapshot.selectionPreview);
                      if (source != null) edit({ kind: 'replace-source', rowId: row.rowId, source });
                    }}
                  >
                    Replace Source
                  </button>
                  <label className="cad-survey-table-tag" title="Tag offset (drawing units)">
                    dx
                    <input
                      type="number"
                      data-cad-survey-table-row-tag-dx
                      defaultValue={row.tagOffset.dx}
                      onBlur={(event) =>
                        edit({
                          kind: 'move-tag',
                          rowId: row.rowId,
                          dx: Number.parseFloat(event.target.value) || 0,
                          dy: row.tagOffset.dy,
                        })
                      }
                    />
                    dy
                    <input
                      type="number"
                      data-cad-survey-table-row-tag-dy
                      defaultValue={row.tagOffset.dy}
                      onBlur={(event) =>
                        edit({
                          kind: 'move-tag',
                          rowId: row.rowId,
                          dx: row.tagOffset.dx,
                          dy: Number.parseFloat(event.target.value) || 0,
                        })
                      }
                    />
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? (
          <p className="cad-shell-empty" data-cad-survey-table-rows-empty>
            No rows — select sources and use Add Selected.
          </p>
        ) : null}
      </section>
    </div>
  );
};
