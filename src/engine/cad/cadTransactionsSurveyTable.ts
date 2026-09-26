/**
 * Phase 19A survey table transactions. Creation resolves source references
 * into rows (never geometry); every row/option/style mutation is ONE history
 * transaction. Locked table layers (or locked tables) block every table edit,
 * mirroring the central `checkCadEntityEditable` gate. Source locks follow
 * normal semantics: a locked source renders as MISSING at read time and can
 * still be replaced/removed here.
 */
import { checkCadEntityEditable } from './cadAppearance';
import { resolveCurrentCadLayerId } from './cadLayers';
import { appendCadProjectEntities, replaceCadProjectEntities } from './cadProjectState';
import { createCadSelectionState } from './cadSelection';
import {
  buildCadSurveyTableRowsForParcel,
  buildCadSurveyTableRowsForSelection,
  createDefaultCadSurveyTableStyle,
  defaultCadSurveyTablePrefix,
  ensureCadSurveyTableStyles,
  isCadSurveyTableLocked,
  nextCadSurveyTableRowId,
  resolveCadSurveyTableStyle,
  type CadSurveyTableEdit,
} from './cadSurveyTables';
import type {
  CadCommand,
  CadCommandDefinition,
  CadCommandExecutionResult,
  CadCommandKey,
  CadWorkspaceSnapshot,
} from './cadTransactions.types';
import type {
  CadEntity,
  CadEntityId,
  CadProject,
  CadSurveyTableEntity,
  CadSurveyTableKind,
  CadSurveyTableRow,
  CadSurveyTableStyle,
  CadSurveyTableTagSettings,
} from './cadTypes';
import { createStableRuntimeId } from '../id';

const findTable = (
  snapshot: CadWorkspaceSnapshot,
  entityId: CadEntityId,
): CadSurveyTableEntity | null => {
  const entity = snapshot.project.entities.find(
    (candidate): candidate is CadSurveyTableEntity =>
      candidate.id === entityId && candidate.type === 'survey-table',
  );
  return entity ?? null;
};

const commitEntity = (
  snapshot: CadWorkspaceSnapshot,
  entity: CadSurveyTableEntity,
  key: CadCommandKey,
  label: string,
  added = false,
): CadCommandExecutionResult => {
  const nextProject = added
    ? appendCadProjectEntities(snapshot.project, [entity])
    : replaceCadProjectEntities(
        snapshot.project,
        snapshot.project.entities.map((candidate) => (candidate.id === entity.id ? entity : candidate)),
      );
  return {
    nextSnapshot: {
      project: nextProject,
      selection: createCadSelectionState(nextProject, [entity.id]),
    },
    commandState: { key, phase: 'committed', prompt: `${label} committed.` },
    transactionLabel: label,
    addedEntityIds: added ? [entity.id] : [],
    removedEntityIds: [],
  };
};

const commitProject = (
  snapshot: CadWorkspaceSnapshot,
  project: CadProject,
  key: CadCommandKey,
  label: string,
): CadCommandExecutionResult => ({
  nextSnapshot: { project, selection: snapshot.selection },
  commandState: { key, phase: 'committed', prompt: `${label} committed.` },
  transactionLabel: label,
  addedEntityIds: [],
  removedEntityIds: [],
});

const withSurveyTableStyles = (
  project: CadProject,
  styles: CadSurveyTableStyle[],
): CadProject => ({ ...project, surveyTableStyles: styles });

interface CreateTableInput {
  kind: CadSurveyTableKind;
  insertX: number;
  insertY: number;
  rows: CadSurveyTableRow[];
  title?: string;
  prefix?: string;
  startNumber?: number;
  styleId?: string;
  rotationDeg?: number;
}

const createSurveyTableEntity = (
  snapshot: CadWorkspaceSnapshot,
  input: CreateTableInput,
): CadSurveyTableEntity => {
  const styles = ensureCadSurveyTableStyles(snapshot.project);
  const requestedStyle = input.styleId ?? styles[0]!.id;
  const style = resolveCadSurveyTableStyle(
    withSurveyTableStyles(snapshot.project, styles),
    requestedStyle,
  );
  const title = input.title ?? `${input.kind === 'point' ? 'Point' : 'Line'} Table`;
  return {
    id: createStableRuntimeId('cad-survey-table'),
    type: 'survey-table',
    layerId: resolveCurrentCadLayerId(snapshot.project),
    styleId: style.id,
    visible: true,
    locked: false,
    tableKind: input.kind,
    x: input.insertX,
    y: input.insertY,
    rotationDeg: input.rotationDeg ?? 0,
    tableStyleId: style.id,
    rows: input.rows,
    title,
    prefix: input.prefix ?? defaultCadSurveyTablePrefix(input.kind),
    startNumber: input.startNumber ?? 1,
    showHeader: true,
    showTitle: true,
  };
};

const commitCreate = (
  snapshot: CadWorkspaceSnapshot,
  key: CadCommandKey,
  input: CreateTableInput,
): CadCommandExecutionResult | null => {
  if (input.rows.length === 0) return null;
  const entity = createSurveyTableEntity(snapshot, input);
  const withStyles =
    snapshot.project.surveyTableStyles != null && snapshot.project.surveyTableStyles.length > 0
      ? snapshot.project
      : withSurveyTableStyles(snapshot.project, [createDefaultCadSurveyTableStyle()]);
  const nextProject = appendCadProjectEntities(withStyles, [entity]);
  return {
    nextSnapshot: {
      project: nextProject,
      selection: createCadSelectionState(nextProject, [entity.id]),
    },
    commandState: {
      key,
      phase: 'committed',
      prompt: `${key} committed (${entity.rows.length} row${entity.rows.length === 1 ? '' : 's'}).`,
    },
    transactionLabel: `${key} (${entity.rows.length} rows)`,
    addedEntityIds: [entity.id],
    removedEntityIds: [],
  };
};

const createKindCommand = (
  key: 'LINETABLE' | 'CURVETABLE' | 'PARCELTABLE' | 'POINTTABLE',
  kind: CadSurveyTableKind,
): CadCommandDefinition<Extract<CadCommand, { key: typeof key }>> => ({
  key,
  execute: (snapshot, command) =>
    commitCreate(snapshot, key, {
      kind,
      insertX: command.insertX,
      insertY: command.insertY,
      rows: buildCadSurveyTableRowsForSelection(snapshot.project, kind, command.sourceEntityIds),
      title: command.title,
      prefix: command.prefix,
      startNumber: command.startNumber,
      styleId: command.styleId,
      rotationDeg: command.rotationDeg,
    }),
});

export const lineTableCommand = createKindCommand('LINETABLE', 'line');
export const curveTableCommand = createKindCommand('CURVETABLE', 'curve');
export const pointTableCommand = createKindCommand('POINTTABLE', 'point');
export const parcelTableCommand = createKindCommand('PARCELTABLE', 'parcel-course');

const commitParcelTable = (
  snapshot: CadWorkspaceSnapshot,
  key: 'PARCELREPORT' | 'PARCELDESC',
  kind: CadSurveyTableKind,
  command: { parcelEntityId: CadEntityId; insertX: number; insertY: number; title?: string; styleId?: string; rotationDeg?: number },
): CadCommandExecutionResult | null =>
  commitCreate(snapshot, key, {
    kind,
    insertX: command.insertX,
    insertY: command.insertY,
    rows: buildCadSurveyTableRowsForParcel(snapshot.project, kind, command.parcelEntityId),
    title: command.title ?? (kind === 'parcel-summary' ? 'Parcel Report' : 'Parcel Description'),
    styleId: command.styleId,
    rotationDeg: command.rotationDeg,
  });

export const parcelReportCommand: CadCommandDefinition<Extract<CadCommand, { key: 'PARCELREPORT' }>> = {
  key: 'PARCELREPORT',
  execute: (snapshot, command) => commitParcelTable(snapshot, 'PARCELREPORT', 'parcel-summary', command),
};

export const parcelDescCommand: CadCommandDefinition<Extract<CadCommand, { key: 'PARCELDESC' }>> = {
  key: 'PARCELDESC',
  execute: (snapshot, command) => commitParcelTable(snapshot, 'PARCELDESC', 'parcel-course', command),
};

const applyTableEdit = (
  entity: CadSurveyTableEntity,
  edit: CadSurveyTableEdit,
): CadSurveyTableEntity | null => {
  switch (edit.kind) {
    case 'add-row': {
      const row: CadSurveyTableRow = {
        id: nextCadSurveyTableRowId(entity.rows, edit.source),
        source: edit.source,
      };
      return { ...entity, rows: [...entity.rows, row] };
    }
    case 'remove-row':
      return entity.rows.some((row) => row.id === edit.rowId)
        ? { ...entity, rows: entity.rows.filter((row) => row.id !== edit.rowId) }
        : null;
    case 'reorder-row': {
      const index = entity.rows.findIndex((row) => row.id === edit.rowId);
      const target = edit.direction === 'up' ? index - 1 : index + 1;
      if (index < 0 || target < 0 || target >= entity.rows.length) return null;
      const rows = [...entity.rows];
      const [moved] = rows.splice(index, 1);
      rows.splice(target, 0, moved!);
      return { ...entity, rows };
    }
    case 'replace-source': {
      const index = entity.rows.findIndex((row) => row.id === edit.rowId);
      const existing = entity.rows[index];
      // Same-type replace: keeps row id, order, code and tag offset.
      if (!existing || existing.source.kind !== edit.source.kind) return null;
      const rows = [...entity.rows];
      rows[index] = { ...existing, source: edit.source };
      return { ...entity, rows };
    }
    case 'set-custom-code': {
      const index = entity.rows.findIndex((row) => row.id === edit.rowId);
      if (index < 0) return null;
      const rows = [...entity.rows];
      rows[index] = { ...rows[index]!, customCode: edit.customCode };
      return { ...entity, rows };
    }
    case 'move-tag': {
      const index = entity.rows.findIndex((row) => row.id === edit.rowId);
      if (index < 0) return null;
      const rows = [...entity.rows];
      rows[index] = { ...rows[index]!, tagOffset: { dx: edit.dx, dy: edit.dy } };
      return { ...entity, rows };
    }
    case 'set-options': {
      const patch = edit.patch;
      const tagSettings: CadSurveyTableTagSettings | undefined =
        patch.tagSettings === undefined ? entity.tagSettings : patch.tagSettings;
      return {
        ...entity,
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.prefix !== undefined ? { prefix: patch.prefix } : {}),
        ...(patch.startNumber !== undefined ? { startNumber: patch.startNumber } : {}),
        ...(patch.showHeader !== undefined ? { showHeader: patch.showHeader } : {}),
        ...(patch.showTitle !== undefined ? { showTitle: patch.showTitle } : {}),
        ...(patch.tableStyleId !== undefined ? { tableStyleId: patch.tableStyleId } : {}),
        ...(patch.rotationDeg !== undefined ? { rotationDeg: patch.rotationDeg } : {}),
        ...(patch.x !== undefined ? { x: patch.x } : {}),
        ...(patch.y !== undefined ? { y: patch.y } : {}),
        tagSettings,
      };
    }
    case 'delete':
      return null;
  }
};

const editLabel = (edit: CadSurveyTableEdit): string => {
  switch (edit.kind) {
    case 'add-row':
      return 'SURVEYTABLE_ADD_ROW';
    case 'remove-row':
      return 'SURVEYTABLE_REMOVE_ROW';
    case 'reorder-row':
      return 'SURVEYTABLE_REORDER';
    case 'replace-source':
      return 'SURVEYTABLE_REPLACE_SOURCE';
    case 'set-custom-code':
      return 'SURVEYTABLE_CUSTOM_CODE';
    case 'move-tag':
      return 'SURVEYTABLE_TAG_MOVE';
    case 'set-options':
      return 'SURVEYTABLE_OPTIONS';
    case 'delete':
      return 'SURVEYTABLE_DELETE';
  }
};

export const surveyTableEditCommand: CadCommandDefinition<
  Extract<CadCommand, { key: 'SURVEYTABLE_EDIT' }>
> = {
  key: 'SURVEYTABLE_EDIT',
  execute: (snapshot, command) => {
    const table = findTable(snapshot, command.tableEntityId);
    if (!table) return null;
    if (isCadSurveyTableLocked(snapshot.project, table)) return null;
    if (command.edit.kind === 'delete') {
      if (!checkCadEntityEditable(snapshot.project, table).editable) return null;
      const nextProject = replaceCadProjectEntities(
        snapshot.project,
        snapshot.project.entities.filter((entity) => entity.id !== table.id),
      );
      return {
        nextSnapshot: { project: nextProject, selection: createCadSelectionState(nextProject, []) },
        commandState: {
          key: 'SURVEYTABLE_EDIT',
          phase: 'committed',
          prompt: `Deleted survey table ${table.id}.`,
        },
        transactionLabel: 'SURVEYTABLE_DELETE',
        addedEntityIds: [],
        removedEntityIds: [table.id],
      };
    }
    const next = applyTableEdit(table, command.edit);
    if (!next) return null;
    return commitEntity(snapshot, next, 'SURVEYTABLE_EDIT', editLabel(command.edit));
  },
};

export const tableStyleCommand: CadCommandDefinition<Extract<CadCommand, { key: 'TABLESTYLE' }>> = {
  key: 'TABLESTYLE',
  execute: (snapshot, command) => {
    const styles = ensureCadSurveyTableStyles(snapshot.project);
    const action = command.action;
    if (action === 'create') {
      const style: CadSurveyTableStyle = {
        ...createDefaultCadSurveyTableStyle(),
        ...(command.patch ?? {}),
        id: command.styleId ?? createStableRuntimeId('cad-survey-table-style'),
        name: command.name ?? command.patch?.name ?? 'Survey Table Style',
      };
      return commitProject(
        snapshot,
        withSurveyTableStyles(snapshot.project, [...styles, style]),
        'TABLESTYLE',
        `TABLESTYLE create (${style.name})`,
      );
    }
    const target = styles.find((style) => style.id === command.styleId) ?? styles[0]!;
    if (action === 'duplicate') {
      const copy: CadSurveyTableStyle = {
        ...target,
        ...(command.patch ?? {}),
        id: createStableRuntimeId('cad-survey-table-style'),
        name: command.name ?? `${target.name} Copy`,
      };
      return commitProject(
        snapshot,
        withSurveyTableStyles(snapshot.project, [...styles, copy]),
        'TABLESTYLE',
        `TABLESTYLE duplicate (${copy.name})`,
      );
    }
    if (action === 'delete') {
      if (styles.length <= 1) return null;
      const next = styles.filter((style) => style.id !== target.id);
      const fallback = next[0]!.id;
      const nextProject = replaceCadProjectEntities(
        withSurveyTableStyles(snapshot.project, next),
        snapshot.project.entities.map((entity) =>
          entity.type === 'survey-table' && entity.tableStyleId === target.id
            ? { ...entity, tableStyleId: fallback }
            : entity,
        ),
      );
      return commitProject(snapshot, nextProject, 'TABLESTYLE', `TABLESTYLE delete (${target.name})`);
    }
    const patched: CadSurveyTableStyle = {
      ...target,
      ...(command.patch ?? {}),
      ...(action === 'rename' && command.name != null ? { name: command.name } : {}),
    };
    return commitProject(
      snapshot,
      withSurveyTableStyles(
        snapshot.project,
        styles.map((style) => (style.id === target.id ? patched : style)),
      ),
      'TABLESTYLE',
      `TABLESTYLE ${action} (${patched.name})`,
    );
  },
};

// Type-only re-exports keep the command file the single survey-table seam.
export type { CadEntity };
