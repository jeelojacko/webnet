/** @vitest-environment jsdom */

/**
 * Phase 19A slice C — survey table UI/shell wiring. Store-level creation,
 * row editing, lock gating, undo/redo, the session→engine commit path, the
 * shell registry + ribbon entries, and the properties/row-editor panel.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

import { CAD_COMMAND_REGISTRY } from '../src/engine/cad/cadTransactions';
import {
  createCadHistoryState,
  redoCadHistory,
  runCadCommand,
  undoCadHistory,
} from '../src/engine/cad/cadUndoRedo';
import { replaceCadProjectEntities } from '../src/engine/cad/cadProjectState';
import { cloneCadProject } from '../src/engine/cad/cadPersistence';
import type {
  CadLineEntity,
  CadParcelEntity,
  CadProject,
  CadSurveyTableEntity,
} from '../src/engine/cad/cadTypes';
import {
  CAD_SHELL_COMMANDS,
  resolveShellCommandText,
} from '../src/cad-app/shell/cadCommandRegistry';
import { buildCadSurveyTableSnapshot } from '../src/cad-app/shell/cadSurveyTableSnapshot';
import { CadSurveyTablePanel } from '../src/cad-app/shell/CadSurveyTablePanel';
import { SurveyTableStylesNode, SurveyTablesNode } from '../src/cad-app/shell/CadSurveyTableToolspace';
import { CadAnnotateRibbonGroups } from '../src/cad-app/annotation/CadAnnotateRibbonGroups';
import type { CadShellActions, CadWorkspaceSnapshot } from '../src/cad-app/shell/cadShellTypes';
import { handleSurveyCadConsumePoint } from '../src/hooks/surveyCad/useSurveyCadConsumePoint';
import type { CommandSession } from '../src/hooks/surveyCad/useSurveyCadCommandTypes';
import type { CadCommand } from '../src/engine/cad/cadTransactions.types';
import {
  buildSurveyCadSpikeProject,
  input,
  parseOptions,
} from './surveyCadWorkspace/surveyCadWorkspaceTestSupport';

const TABLE_COMMAND_KEYS = [
  'LINETABLE',
  'CURVETABLE',
  'PARCELTABLE',
  'POINTTABLE',
  'PARCELREPORT',
  'PARCELDESC',
  'TABLESTYLE',
] as const;

const spikeProject = (): CadProject =>
  buildSurveyCadSpikeProject({
    input,
    instrumentLibrary: {},
    parseOptions,
    units: 'm',
    result: null,
  });

const withTestParcel = (project: CadProject): { project: CadProject; parcelId: string } => {
  const parcel: CadParcelEntity = {
    id: 'parcel:ui-19a',
    type: 'parcel',
    layerId: project.layers[0]!.id,
    visible: true,
    locked: false,
    vertices: [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 30 },
      { x: 0, y: 30 },
    ],
    vertexLabels: ['A', 'B', 'C', 'D'],
    parcelName: 'Parcel 19A',
  };
  return { project: replaceCadProjectEntities(project, [...project.entities, parcel]), parcelId: parcel.id };
};

const lineIdsOf = (project: CadProject, count: number): string[] =>
  project.entities
    .filter((entity): entity is CadLineEntity => entity.type === 'line')
    .slice(0, count)
    .map((entity) => entity.id);

const findTable = (project: CadProject): CadSurveyTableEntity => {
  const table = project.entities.find(
    (entity): entity is CadSurveyTableEntity => entity.type === 'survey-table',
  );
  if (!table) throw new Error('survey-table entity not found');
  return table;
};

describe('Phase 19A survey table commands + registry', () => {
  it('registers every table command in the engine registry and the shell registry', () => {
    for (const key of TABLE_COMMAND_KEYS) {
      expect(Object.prototype.hasOwnProperty.call(CAD_COMMAND_REGISTRY, key)).toBe(true);
      expect(CAD_SHELL_COMMANDS.some((def) => def.key === key)).toBe(true);
    }
    expect(Object.prototype.hasOwnProperty.call(CAD_COMMAND_REGISTRY, 'SURVEYTABLE_EDIT')).toBe(true);
    expect(resolveShellCommandText('LINETABLE')?.key).toBe('LINETABLE');
    expect(resolveShellCommandText('lt')?.key).toBe('LINETABLE');
    expect(resolveShellCommandText('PARCELSUMMARYTABLE')?.key).toBe('PARCELREPORT');
    expect(resolveShellCommandText('TABLESTYLES')?.key).toBe('TABLESTYLE');
  });

  it('renders the ANNOTATE Tables ribbon group and the SURVEY Tables group', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    await act(async () => {
      root.render(<CadAnnotateRibbonGroups snapshot={null} actions={null} />);
    });
    expect(container.textContent).toContain('Tables');
    for (const key of TABLE_COMMAND_KEYS) {
      expect(container.querySelector(`[data-cad-annotation-command="${key}"]`)).not.toBeNull();
    }
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('exposes Toolspace nodes for tables and styles', async () => {
    const project = spikeProject();
    const history = runCadCommand(createCadHistoryState(project), {
      key: 'LINETABLE',
      insertX: 0,
      insertY: 0,
      sourceEntityIds: lineIdsOf(project, 1),
    });
    const tableId = findTable(history.present.project).id;
    const snapshot = {
      surveyTable: buildCadSurveyTableSnapshot(history.present.project, [tableId]),
      selectedEntityIds: [tableId],
    } as unknown as CadWorkspaceSnapshot;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    await act(async () => {
      root.render(
        <>
          <SurveyTablesNode snapshot={snapshot} actions={null} />
          <SurveyTableStylesNode snapshot={snapshot} actions={null} />
        </>,
      );
    });
    expect(container.querySelector(`[data-cad-survey-table-node="${tableId}"]`)).not.toBeNull();
    expect(container.querySelector('[data-cad-survey-table-styles="true"]')).not.toBeNull();
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});

describe('Phase 19A survey table store-level creation', () => {
  it('creates a line table from the selected lines in one transaction', () => {
    const project = spikeProject();
    const history = createCadHistoryState(project);
    const created = runCadCommand(history, {
      key: 'LINETABLE',
      insertX: 2,
      insertY: 3,
      sourceEntityIds: lineIdsOf(project, 2),
    });
    expect(created).not.toBe(history);
    expect(created.undoStack).toHaveLength(1);
    const table = findTable(created.present.project);
    expect(table.tableKind).toBe('line');
    expect(table.rows).toHaveLength(2);
    expect(table.x).toBe(2);
    expect(table.y).toBe(3);
  });

  it('creates a point table in Station ID order when nothing is selected', () => {
    const project = spikeProject();
    const orderedPointIds = project.entities
      .filter((entity) => entity.type === 'survey-point')
      .map((entity) => entity.id);
    const created = runCadCommand(createCadHistoryState(project), {
      key: 'POINTTABLE',
      insertX: 0,
      insertY: 0,
      sourceEntityIds: orderedPointIds,
    });
    const table = findTable(created.present.project);
    expect(table.tableKind).toBe('point');
    expect(table.rows).toHaveLength(orderedPointIds.length);
  });

  it('creates parcel course + summary tables and reports', () => {
    const { project, parcelId } = withTestParcel(spikeProject());
    const courseTable = runCadCommand(createCadHistoryState(project), {
      key: 'PARCELTABLE',
      insertX: 0,
      insertY: 0,
      sourceEntityIds: [parcelId],
    });
    const table = findTable(courseTable.present.project);
    expect(table.tableKind).toBe('parcel-course');
    expect(table.rows).toHaveLength(4);

    const reportTable = runCadCommand(createCadHistoryState(project), {
      key: 'PARCELREPORT',
      parcelEntityId: parcelId,
      insertX: 0,
      insertY: 0,
    });
    expect(findTable(reportTable.present.project).tableKind).toBe('parcel-summary');
  });
});

describe('Phase 19A survey table row editing', () => {
  const createdTable = (): { history: ReturnType<typeof createCadHistoryState>; table: CadSurveyTableEntity; project: CadProject } => {
    const project = spikeProject();
    const history = runCadCommand(createCadHistoryState(project), {
      key: 'LINETABLE',
      insertX: 0,
      insertY: 0,
      sourceEntityIds: lineIdsOf(project, 2),
    });
    return { history, table: findTable(history.present.project), project: history.present.project };
  };

  it('adds, removes and reorders rows (one transaction each)', () => {
    const { history, table } = createdTable();
    const lineId = table.rows[0]!.source.kind === 'line' ? table.rows[0]!.source.entityId : '';
    const added = runCadCommand(history, {
      key: 'SURVEYTABLE_EDIT',
      tableEntityId: table.id,
      edit: { kind: 'add-row', source: { kind: 'line', entityId: lineId } },
    });
    expect(added.undoStack).toHaveLength(history.undoStack.length + 1);
    // Duplicate source produces a suffixed row id rather than colliding.
    expect(findTable(added.present.project).rows).toHaveLength(3);

    const removed = runCadCommand(added, {
      key: 'SURVEYTABLE_EDIT',
      tableEntityId: table.id,
      edit: { kind: 'remove-row', rowId: table.rows[0]!.id },
    });
    expect(findTable(removed.present.project).rows).toHaveLength(2);

    const secondRowId = findTable(history.present.project).rows[1]!.id;
    const reordered = runCadCommand(history, {
      key: 'SURVEYTABLE_EDIT',
      tableEntityId: table.id,
      edit: { kind: 'reorder-row', rowId: secondRowId, direction: 'up' },
    });
    expect(findTable(reordered.present.project).rows[0]!.id).toBe(secondRowId);
  });

  it('replaces a same-type source preserving code, order and tag offset', () => {
    const { history, table, project } = createdTable();
    const firstRow = findTable(history.present.project).rows[0]!;
    // Pre-seed a custom code + tag offset on the row being replaced.
    const withCode = runCadCommand(history, {
      key: 'SURVEYTABLE_EDIT',
      tableEntityId: table.id,
      edit: { kind: 'set-custom-code', rowId: firstRow.id, customCode: 'KEEP-1' },
    });
    const withTag = runCadCommand(withCode, {
      key: 'SURVEYTABLE_EDIT',
      tableEntityId: table.id,
      edit: { kind: 'move-tag', rowId: firstRow.id, dx: 4, dy: 5 },
    });
    const otherLine = project.entities.find(
      (entity): entity is CadLineEntity =>
        entity.type === 'line' && entity.id !== (firstRow.source.kind === 'line' ? firstRow.source.entityId : ''),
    );
    if (!otherLine) throw new Error('expected a second line');
    const replaced = runCadCommand(withTag, {
      key: 'SURVEYTABLE_EDIT',
      tableEntityId: table.id,
      edit: { kind: 'replace-source', rowId: firstRow.id, source: { kind: 'line', entityId: otherLine.id } },
    });
    const row = findTable(replaced.present.project).rows[0]!;
    expect(row.id).toBe(firstRow.id);
    expect(row.customCode).toBe('KEEP-1');
    expect(row.tagOffset).toEqual({ dx: 4, dy: 5 });
    expect(row.source.kind === 'line' && row.source.entityId).toBe(otherLine.id);

    // Cross-type replace is rejected (no transaction).
    const rejected = runCadCommand(withTag, {
      key: 'SURVEYTABLE_EDIT',
      tableEntityId: table.id,
      edit: { kind: 'replace-source', rowId: firstRow.id, source: { kind: 'arc', entityId: 'nope' } },
    });
    expect(rejected).toBe(withTag);
  });

  it('updates table options in one transaction', () => {
    const { history, table } = createdTable();
    const updated = runCadCommand(history, {
      key: 'SURVEYTABLE_EDIT',
      tableEntityId: table.id,
      edit: {
        kind: 'set-options',
        patch: { title: 'Parcel Line Table', prefix: 'PL', startNumber: 10, showHeader: false, showTitle: false },
      },
    });
    const next = findTable(updated.present.project);
    expect(next.title).toBe('Parcel Line Table');
    expect(next.prefix).toBe('PL');
    expect(next.startNumber).toBe(10);
    expect(next.showHeader).toBe(false);
    expect(next.showTitle).toBe(false);
  });

  it('blocks every table edit on a locked table layer and restores through undo/redo', () => {
    const { history, table, project } = createdTable();
    const lockedProject = {
      ...project,
      layers: project.layers.map((layer) =>
        layer.id === table.layerId ? { ...layer, locked: true } : layer,
      ),
    };
    const lockedHistory = createCadHistoryState(lockedProject);
    const blocked = runCadCommand(lockedHistory, {
      key: 'SURVEYTABLE_EDIT',
      tableEntityId: table.id,
      edit: { kind: 'remove-row', rowId: table.rows[0]!.id },
    });
    expect(blocked).toBe(lockedHistory);

    const undone = undoCadHistory(history);
    expect(undone.present.project.entities.some((entity) => entity.type === 'survey-table')).toBe(false);
    const redone = redoCadHistory(undone);
    expect(redone.present.project.entities.some((entity) => entity.type === 'survey-table')).toBe(true);
  });
});

describe('Phase 19A survey table styles + persistence', () => {
  it('creates, updates, deletes and re-points table styles', () => {
    const project = spikeProject();
    const withTable = runCadCommand(createCadHistoryState(project), {
      key: 'LINETABLE',
      insertX: 0,
      insertY: 0,
      sourceEntityIds: lineIdsOf(project, 1),
    }).present.project;
    const table = findTable(withTable);
    const created = runCadCommand(createCadHistoryState(withTable), {
      key: 'TABLESTYLE',
      action: 'create',
      name: 'Wide',
      patch: { rowHeight: 5 },
    });
    const style = created.present.project.surveyTableStyles?.find((entry) => entry.name === 'Wide');
    expect(style).toBeDefined();
    const applied = runCadCommand(created, {
      key: 'TABLESTYLE',
      action: 'update',
      styleId: style!.id,
      patch: { showInnerGrid: false },
    });
    expect(applied.present.project.surveyTableStyles?.find((entry) => entry.id === style!.id)?.showInnerGrid).toBe(false);

    const assigned = runCadCommand(applied, {
      key: 'SURVEYTABLE_EDIT',
      tableEntityId: table.id,
      edit: { kind: 'set-options', patch: { tableStyleId: style!.id } },
    });
    const deleted = runCadCommand(assigned, {
      key: 'TABLESTYLE',
      action: 'delete',
      styleId: style!.id,
    });
    expect(findTable(deleted.present.project).tableStyleId).not.toBe(style!.id);
  });

  it('round-trips table rows and styles through cloneCadProject', () => {
    const project = spikeProject();
    const created = runCadCommand(createCadHistoryState(project), {
      key: 'CURVETABLE',
      insertX: 1,
      insertY: 2,
      sourceEntityIds: [],
    });
    // No arcs in the spike fixture: creation is a no-op, never a fake table.
    expect(created).toStrictEqual(createCadHistoryState(project));

    const withTable = runCadCommand(createCadHistoryState(project), {
      key: 'LINETABLE',
      insertX: 1,
      insertY: 2,
      sourceEntityIds: lineIdsOf(project, 2),
    }).present.project;
    const cloned = cloneCadProject(withTable);
    const clonedTable = findTable(cloned);
    const sourceTable = findTable(withTable);
    expect(clonedTable.rows).toEqual(sourceTable.rows);
    expect(clonedTable.tableStyleId).toBe(sourceTable.tableStyleId);
    expect(cloned.surveyTableStyles).toEqual(withTable.surveyTableStyles);
  });
});

describe('Phase 19A survey table session → engine commit', () => {
  const consume = (
    project: CadProject,
    session: Extract<CommandSession, { key: 'SURVEYTABLE' }>,
  ): { project: CadProject; replaced: boolean } => {
    let history = createCadHistoryState(project);
    let replaced = false;
    handleSurveyCadConsumePoint({
      applyHistoryUpdate: (updater) => {
        history = updater(history);
      },
      commitArcDefinition: () => false,
      current: session,
      history,
      point: { x: 7, y: 9, label: 'PT' },
      projectStationIds: [],
      publishReport: () => undefined,
      replaceSession: (next) => {
        replaced = next === null;
      },
      reverseDirectionModifier: false,
    });
    return { project: history.present.project, replaced };
  };

  it('commits a line table on the insertion pick and clears the session', () => {
    const project = spikeProject();
    const result = consume(project, {
      key: 'SURVEYTABLE',
      inputValue: '',
      engineKey: 'LINETABLE',
      tableKind: 'line',
      sourceEntityIds: lineIdsOf(project, 2),
      insertion: null,
    });
    const table = findTable(result.project);
    expect(table.rows).toHaveLength(2);
    expect(table.x).toBe(7);
    expect(table.y).toBe(9);
    expect(result.replaced).toBe(true);
  });

  it('commits a parcel report from the selected parcel id', () => {
    const { project, parcelId } = withTestParcel(spikeProject());
    const result = consume(project, {
      key: 'SURVEYTABLE',
      inputValue: '',
      engineKey: 'PARCELREPORT',
      tableKind: 'parcel-summary',
      sourceEntityIds: [parcelId],
      insertion: null,
    });
    expect(findTable(result.project).tableKind).toBe('parcel-summary');
  });
});

describe('Phase 19A survey table properties + row editor panel', () => {
  const renderPanel = (project: CadProject, selectedEntityIds: string[], selectionPreview: CadWorkspaceSnapshot['selectionPreview']) => {
    const calls: CadCommand[] = [];
    const actions = {
      runSurveyCommand: (command: CadCommand) => {
        calls.push(command);
        return true;
      },
    } as unknown as CadShellActions;
    const snapshot = {
      surveyTable: buildCadSurveyTableSnapshot(project, selectedEntityIds),
      selectedEntityIds,
      selectionPreview,
    } as unknown as CadWorkspaceSnapshot;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    return { actions, snapshot, container, root, calls };
  };

  it('shows table properties and row cells, and routes row edits through one command', async () => {
    const project = spikeProject();
    const history = runCadCommand(createCadHistoryState(project), {
      key: 'LINETABLE',
      insertX: 0,
      insertY: 0,
      sourceEntityIds: lineIdsOf(project, 2),
    });
    const table = findTable(history.present.project);
    const fixtures = renderPanel(history.present.project, [table.id], [
      { id: lineIdsOf(project, 3)[2] ?? lineIdsOf(project, 3)[0]!, type: 'line', label: 'Extra line' },
    ]);
    await act(async () => {
      fixtures.root.render(<CadSurveyTablePanel snapshot={fixtures.snapshot} actions={fixtures.actions} />);
    });
    expect(fixtures.container.querySelector('[data-cad-survey-table-kind]')?.textContent).toContain('Line');
    expect(fixtures.container.querySelectorAll('[data-cad-survey-table-row]')).toHaveLength(2);

    await act(async () => {
      (fixtures.container.querySelector('[data-cad-survey-table-row-remove]') as HTMLButtonElement).click();
    });
    expect(fixtures.calls[0]).toMatchObject({ key: 'SURVEYTABLE_EDIT', edit: { kind: 'remove-row' } });

    await act(async () => {
      const upButtons = fixtures.container.querySelectorAll('[data-cad-survey-table-row-up]');
      (upButtons[1] as HTMLButtonElement).click();
    });
    expect(fixtures.calls[1]).toMatchObject({ key: 'SURVEYTABLE_EDIT', edit: { kind: 'reorder-row' } });

    await act(async () => {
      (fixtures.container.querySelector('[data-cad-survey-table-add-selected]') as HTMLButtonElement).click();
    });
    expect(fixtures.calls[2]).toMatchObject({ key: 'SURVEYTABLE_EDIT', edit: { kind: 'add-row' } });

    await act(async () => {
      (fixtures.container.querySelector('[data-cad-survey-table-row-replace]') as HTMLButtonElement).click();
    });
    expect(fixtures.calls[3]).toMatchObject({ key: 'SURVEYTABLE_EDIT', edit: { kind: 'replace-source' } });

    await act(async () => {
      fixtures.root.unmount();
    });
    fixtures.container.remove();
  });
});
