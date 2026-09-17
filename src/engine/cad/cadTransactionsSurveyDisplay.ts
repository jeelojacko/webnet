import { checkCadEntityEditable } from './cadAppearance';
import { backfillCadPointLabelStyles } from './cadPointLabelStyles';
import { backfillCadPointGroups, validatePointGroupQuery } from './cadPointGroups';
import { backfillCadPointStyles } from './cadPointStyles';
import { createCadSelectionState } from './cadSelection';
import { isSurveyNameTaken, surveyPointsOf } from './cadSurveyDisplayRefs';
import type {
  CadCommand,
  CadCommandDefinition,
  CadCommandExecutionResult,
  CadWorkspaceSnapshot,
} from './cadTransactions.types';
import { commitLayerProject } from './cadTransactionsLayerCommands';
import type {
  CadPointGroup,
  CadPointLabelStyle,
  CadPointStyle,
  CadProject,
  CadSurveyPointEntity,
} from './cadTypes';

/**
 * Phase 18D survey-display transactions (points overrides + style/group
 * tables). Undoable CadCommands over the EXISTING history path — no new
 * state framework. Pure project rewrites; fail closed (return null) on
 * unknown ids, invalid queries, or guarded deletes. Delete policy (which
 * refs block, replacement rewire, catalog treatment) lives in
 * cadSurveyDisplayRefs.ts.
 */

const nonEmptyName = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const commitSurvey = (
  key: CadCommand['key'],
  snapshot: CadWorkspaceSnapshot,
  nextProject: CadProject,
  label: string,
): CadCommandExecutionResult =>
  commitLayerProject(key, snapshot, nextProject, label);

type OverrideCommand = Extract<CadCommand, { key: 'SURVEY_POINT_OVERRIDE' }>;

/** Batch set/clear MANUAL overrides (undefined = leave, null = clear). Never touches coordinates. */
export const surveyPointOverrideCommand: CadCommandDefinition<OverrideCommand> = {
  key: 'SURVEY_POINT_OVERRIDE',
  execute: (snapshot, command) => {
    if (command.entityIds.length === 0) return null;
    const pointStyles = backfillCadPointStyles(snapshot.project.pointStyles);
    const labelStyles = backfillCadPointLabelStyles(snapshot.project.labelStyles);
    if (
      (command.pointStyleOverrideId != null &&
        !pointStyles.some((style) => style.id === command.pointStyleOverrideId)) ||
      (command.pointLabelStyleOverrideId != null &&
        !labelStyles.some((style) => style.id === command.pointLabelStyleOverrideId))
    ) {
      return null;
    }
    const targets = new Set(command.entityIds);
    let touched = false;
    const entities = snapshot.project.entities.map((entity) => {
      if (entity.type !== 'survey-point' || !targets.has(entity.id)) return entity;
      if (!checkCadEntityEditable(snapshot.project, entity).editable) return entity;
      touched = true;
      const next: CadSurveyPointEntity = { ...entity };
      if (command.pointStyleOverrideId !== undefined) {
        if (command.pointStyleOverrideId == null) delete next.pointStyleOverrideId;
        else next.pointStyleOverrideId = command.pointStyleOverrideId;
      }
      if (command.pointLabelStyleOverrideId !== undefined) {
        if (command.pointLabelStyleOverrideId == null) delete next.pointLabelStyleOverrideId;
        else next.pointLabelStyleOverrideId = command.pointLabelStyleOverrideId;
      }
      return next;
    });
    if (!touched) return null;
    return commitSurvey('SURVEY_POINT_OVERRIDE', snapshot, { ...snapshot.project, entities }, 'SURVEY_POINT_OVERRIDE');
  },
};

type StyleTableCommand = Extract<CadCommand, { key: 'SURVEY_STYLE_TABLE' }>;

const symbolIdsOf = (project: CadProject): Set<string> =>
  new Set(project.styleLibrary.pointSymbols.map((symbol) => symbol.id));

const textStyleIdsOf = (project: CadProject): Set<string> =>
  new Set(project.styleLibrary.textStyles.map((style) => style.id));

const clampLabelDecimals = (value: unknown): number =>
  Number.isFinite(value) ? Math.min(4, Math.max(0, Math.floor(value as number))) : 3;

const KNOWN_LABEL_COMPONENTS = ['pointNumber', 'description', 'elevation', 'featureCode'] as const;

const sanitizeLabelStyle = (
  style: CadPointLabelStyle,
  textStyles: Set<string>,
): CadPointLabelStyle | null => {
  if (!nonEmptyName(style.name) || !textStyles.has(style.textStyleId)) return null;
  const order = style.componentOrder.filter((entry): entry is (typeof KNOWN_LABEL_COMPONENTS)[number] =>
    (KNOWN_LABEL_COMPONENTS as readonly string[]).includes(entry),
  );
  return {
    ...style,
    name: style.name.trim(),
    componentOrder: [...new Set(order)],
    elevationDecimals: clampLabelDecimals(style.elevationDecimals),
    offsetX: Number.isFinite(style.offsetX) ? style.offsetX : 0,
    offsetY: Number.isFinite(style.offsetY) ? style.offsetY : 0,
  };
};

const rewireStyleRefs = (
  project: CadProject,
  table: 'point' | 'label',
  fromId: string,
  toId: string,
): CadProject => {
  const entities = project.entities.map((entity) => {
    if (entity.type !== 'survey-point') return entity;
    const next = { ...entity };
    if (table === 'point') {
      if (next.pointStyleId === fromId) next.pointStyleId = toId;
      if (next.pointStyleOverrideId === fromId) next.pointStyleOverrideId = toId;
    } else {
      if (next.pointLabelStyleId === fromId) next.pointLabelStyleId = toId;
      if (next.pointLabelStyleOverrideId === fromId) next.pointLabelStyleOverrideId = toId;
    }
    return next;
  });
  const pointGroups = (project.pointGroups ?? []).map((group) => {
    const next = { ...group };
    if (table === 'point' && next.pointStyleOverrideId === fromId) next.pointStyleOverrideId = toId;
    if (table === 'label' && next.pointLabelStyleOverrideId === fromId) next.pointLabelStyleOverrideId = toId;
    return next;
  });
  return { ...project, entities, pointGroups };
};

export const surveyStyleTableCommand: CadCommandDefinition<StyleTableCommand> = {
  key: 'SURVEY_STYLE_TABLE',
  execute: (snapshot, command) => {
    // Delete carries the refcount guard + replacement rewire (fail closed).
    if (command.op === 'delete') {
      const guarded = withSurveyDeleteGuard(snapshot, command);
      if (!guarded) return null;
      const styles =
        command.table === 'point'
          ? backfillCadPointStyles(guarded.project.pointStyles)
          : backfillCadPointLabelStyles(guarded.project.labelStyles);
      const remaining = styles.filter((entry) => entry.id !== command.styleId);
      const nextProject =
        command.table === 'point'
          ? { ...guarded.project, pointStyles: remaining as CadPointStyle[] }
          : { ...guarded.project, labelStyles: remaining as CadPointLabelStyle[] };
      return commitSurvey('SURVEY_STYLE_TABLE', { ...snapshot, project: guarded.project }, nextProject, 'SURVEY_STYLE_TABLE (delete)');
    }
    const project = snapshot.project;
    if (command.table === 'point') {
      const styles = backfillCadPointStyles(project.pointStyles);
      const symbols = symbolIdsOf(project);
      const next = applyPointStyleOp(styles, command, symbols);
      if (!next) return null;
      return commitSurvey('SURVEY_STYLE_TABLE', snapshot, { ...project, pointStyles: next }, `SURVEY_STYLE_TABLE (${command.op})`);
    }
    const styles = backfillCadPointLabelStyles(project.labelStyles);
    const next = applyLabelStyleOp(styles, command, textStyleIdsOf(project));
    if (!next) return null;
    return commitSurvey('SURVEY_STYLE_TABLE', snapshot, { ...project, labelStyles: next }, `SURVEY_STYLE_TABLE (${command.op})`);
  },
};

const applyPointStyleOp = (
  styles: CadPointStyle[],
  command: StyleTableCommand,
  symbols: Set<string>,
): CadPointStyle[] | null => {
  if (command.table !== 'point') return null;
  switch (command.op) {
    case 'create': {
      const style = command.style;
      if (!nonEmptyName(style?.id) || styles.some((entry) => entry.id === style.id)) return null;
      if (!nonEmptyName(style.name) || isSurveyNameTaken(styles, style.name)) return null;
      if (!symbols.has(style.markerSymbolId)) return null;
      return [...styles, { ...style, name: style.name.trim() }];
    }
    case 'duplicate': {
      const source = styles.find((entry) => entry.id === command.styleId);
      if (!source || !nonEmptyName(command.name) || isSurveyNameTaken(styles, command.name)) return null;
      return [...styles, { ...source, id: command.newId, name: command.name.trim() }];
    }
    case 'rename': {
      if (!nonEmptyName(command.name) || isSurveyNameTaken(styles, command.name, command.styleId)) return null;
      if (!styles.some((entry) => entry.id === command.styleId)) return null;
      return styles.map((entry) =>
        entry.id === command.styleId ? { ...entry, name: command.name.trim() } : entry,
      );
    }
    case 'update': {
      const target = styles.find((entry) => entry.id === command.styleId);
      if (!target) return null;
      const patch = command.patch;
      if (patch.name !== undefined && (!nonEmptyName(patch.name) || isSurveyNameTaken(styles, patch.name, command.styleId))) {
        return null;
      }
      if (patch.markerSymbolId !== undefined && !symbols.has(patch.markerSymbolId)) return null;
      if (patch.markerScale !== undefined && !(Number.isFinite(patch.markerScale) && (patch.markerScale as number) > 0)) {
        return null;
      }
      const { id: _droppedId, ...safePatch } = patch;
      void _droppedId;
      return styles.map((entry) =>
        entry.id === command.styleId
          ? { ...entry, ...safePatch, name: (safePatch.name ?? entry.name).trim() }
          : entry,
      );
    }
    case 'delete': {
      // Project-aware path: execute routes deletes through withSurveyDeleteGuard
      // (refcount + rewire). This pure-table fallback only drops the row.
      if (!styles.some((entry) => entry.id === command.styleId) || styles.length <= 1) return null;
      return styles.filter((entry) => entry.id !== command.styleId);
    }
  }
};

const applyLabelStyleOp = (
  styles: CadPointLabelStyle[],
  command: StyleTableCommand,
  textStyles: Set<string>,
): CadPointLabelStyle[] | null => {
  if (command.table !== 'label') return null;
  switch (command.op) {
    case 'create': {
      const clean = sanitizeLabelStyle(command.style, textStyles);
      if (!clean || styles.some((entry) => entry.id === clean.id)) return null;
      if (isSurveyNameTaken(styles, clean.name)) return null;
      return [...styles, clean];
    }
    case 'duplicate': {
      const source = styles.find((entry) => entry.id === command.styleId);
      if (!source || !nonEmptyName(command.name) || isSurveyNameTaken(styles, command.name)) return null;
      return [...styles, { ...source, id: command.newId, name: command.name.trim() }];
    }
    case 'rename': {
      if (!nonEmptyName(command.name) || isSurveyNameTaken(styles, command.name, command.styleId)) return null;
      if (!styles.some((entry) => entry.id === command.styleId)) return null;
      return styles.map((entry) =>
        entry.id === command.styleId ? { ...entry, name: command.name.trim() } : entry,
      );
    }
    case 'update': {
      const target = styles.find((entry) => entry.id === command.styleId);
      if (!target) return null;
      const merged = sanitizeLabelStyle({ ...target, ...command.patch, id: target.id }, textStyles);
      if (!merged || isSurveyNameTaken(styles, merged.name, command.styleId)) return null;
      return styles.map((entry) => (entry.id === command.styleId ? merged : entry));
    }
    case 'delete': {
      if (!styles.some((entry) => entry.id === command.styleId) || styles.length <= 1) return null;
      return styles.filter((entry) => entry.id !== command.styleId);
    }
  }
};

type GroupTableCommand = Extract<CadCommand, { key: 'SURVEY_GROUP_TABLE' }>;

const sortedGroups = (groups: CadPointGroup[]): CadPointGroup[] =>
  groups
    .map((group, index) => ({ group, index }))
    .sort((a, b) => a.group.priority - b.group.priority || a.index - b.index)
    .map(({ group }) => group);

const renumberPriorities = (groups: CadPointGroup[]): CadPointGroup[] =>
  groups.map((group, index) => ({ ...group, priority: index }));

const validOverrideRef = (
  project: CadProject,
  table: 'point' | 'label',
  id: string | undefined,
): boolean => {
  if (id == null) return true;
  const tableIds =
    table === 'point'
      ? backfillCadPointStyles(project.pointStyles).map((style) => style.id)
      : backfillCadPointLabelStyles(project.labelStyles).map((style) => style.id);
  return tableIds.includes(id);
};

/** Group CRUD + priority move. Delete is always allowed (display-only rules). */
export const surveyGroupTableCommand: CadCommandDefinition<GroupTableCommand> = {
  key: 'SURVEY_GROUP_TABLE',
  execute: (snapshot, command) => {
    const project = snapshot.project;
    const groups = backfillCadPointGroups(project.pointGroups);
    switch (command.op) {
      case 'create': {
        const group = command.group;
        if (!nonEmptyName(group?.id) || groups.some((entry) => entry.id === group.id)) return null;
        if (!nonEmptyName(group.name) || isSurveyNameTaken(groups, group.name)) return null;
        if (validatePointGroupQuery(group.query).length > 0) return null;
        if (
          !validOverrideRef(project, 'point', group.pointStyleOverrideId) ||
          !validOverrideRef(project, 'label', group.pointLabelStyleOverrideId)
        ) {
          return null;
        }
        const maxPriority = groups.reduce((max, entry) => Math.max(max, entry.priority), -1);
        return commitSurvey('SURVEY_GROUP_TABLE', snapshot, {
          ...project,
          pointGroups: [...groups, { ...group, name: group.name.trim(), priority: group.priority ?? maxPriority + 1 }],
        }, 'SURVEY_GROUP_TABLE (create)');
      }
      case 'rename': {
        if (!nonEmptyName(command.name) || isSurveyNameTaken(groups, command.name, command.groupId)) return null;
        if (!groups.some((entry) => entry.id === command.groupId)) return null;
        return commitSurvey('SURVEY_GROUP_TABLE', snapshot, {
          ...project,
          pointGroups: groups.map((entry) =>
            entry.id === command.groupId ? { ...entry, name: command.name.trim() } : entry,
          ),
        }, 'SURVEY_GROUP_TABLE (rename)');
      }
      case 'update': {
        const target = groups.find((entry) => entry.id === command.groupId);
        if (!target) return null;
        const nextQuery = command.query !== undefined ? { ...target.query, ...command.query } : target.query;
        if (validatePointGroupQuery(nextQuery).length > 0) return null;
        const nextPointOverride =
          command.pointStyleOverrideId !== undefined ? command.pointStyleOverrideId ?? undefined : target.pointStyleOverrideId;
        const nextLabelOverride =
          command.pointLabelStyleOverrideId !== undefined ? command.pointLabelStyleOverrideId ?? undefined : target.pointLabelStyleOverrideId;
        if (
          !validOverrideRef(project, 'point', nextPointOverride) ||
          !validOverrideRef(project, 'label', nextLabelOverride)
        ) {
          return null;
        }
        return commitSurvey('SURVEY_GROUP_TABLE', snapshot, {
          ...project,
          pointGroups: groups.map((entry) =>
            entry.id === command.groupId
              ? {
                  ...entry,
                  query: nextQuery,
                  description: command.description !== undefined ? command.description ?? undefined : entry.description,
                  pointStyleOverrideId: nextPointOverride,
                  pointLabelStyleOverrideId: nextLabelOverride,
                }
              : entry,
          ),
        }, 'SURVEY_GROUP_TABLE (update)');
      }
      case 'move': {
        const ordered = renumberPriorities(sortedGroups(groups));
        const index = ordered.findIndex((entry) => entry.id === command.groupId);
        if (index < 0) return null;
        const swapWith = command.direction === 'up' ? index - 1 : index + 1;
        if (swapWith < 0 || swapWith >= ordered.length) return null;
        const reordered = [...ordered];
        const moving = reordered.splice(index, 1)[0]!;
        reordered.splice(swapWith, 0, moving);
        return commitSurvey('SURVEY_GROUP_TABLE', snapshot, {
          ...project,
          pointGroups: renumberPriorities(reordered),
        }, 'SURVEY_GROUP_TABLE (move)');
      }
      case 'delete': {
        if (!groups.some((entry) => entry.id === command.groupId)) return null;
        return commitSurvey('SURVEY_GROUP_TABLE', snapshot, {
          ...project,
          pointGroups: groups.filter((entry) => entry.id !== command.groupId),
        }, 'SURVEY_GROUP_TABLE (delete)');
      }
    }
  },
};

/**
 * Project-aware style delete with refcount guard + replacement rewire.
 * Kept separate from SURVEY_STYLE_TABLE so the table op stays a pure
 * table edit; the manager dispatches through this helper's command.
 */
export const buildStyleDeleteCommand = (
  project: CadProject,
  table: 'point' | 'label',
  styleId: string,
  replacementId?: string,
): StyleTableCommand | null => {
  const styles =
    table === 'point'
      ? backfillCadPointStyles(project.pointStyles)
      : backfillCadPointLabelStyles(project.labelStyles);
  const target = styles.find((entry) => entry.id === styleId);
  if (!target || styles.length <= 1) return null;
  if (replacementId !== undefined) {
    if (replacementId === styleId || !styles.some((entry) => entry.id === replacementId)) return null;
  }
  return { key: 'SURVEY_STYLE_TABLE', table, op: 'delete', styleId, replacementId } as StyleTableCommand;
};

export const surveyDisplayCommandDefinitions = {
  SURVEY_POINT_OVERRIDE: surveyPointOverrideCommand,
  SURVEY_STYLE_TABLE: surveyStyleTableCommand,
  SURVEY_GROUP_TABLE: surveyGroupTableCommand,
};

export const withSurveyDeleteGuard = (
  snapshot: CadWorkspaceSnapshot,
  command: StyleTableCommand,
): CadWorkspaceSnapshot | null => {
  if (command.op !== 'delete') return snapshot;
  const project = snapshot.project;
  const styles =
    command.table === 'point'
      ? backfillCadPointStyles(project.pointStyles)
      : backfillCadPointLabelStyles(project.labelStyles);
  const target = styles.find((entry) => entry.id === command.styleId);
  if (!target || styles.length <= 1) return null;
  const points = surveyPointsOf(project);
  const groups = project.pointGroups ?? [];
  const hardRefs =
    command.table === 'point'
      ? points.filter((point) => point.pointStyleId === command.styleId || point.pointStyleOverrideId === command.styleId).length +
        groups.filter((group) => group.pointStyleOverrideId === command.styleId).length
      : points.filter((point) => point.pointLabelStyleId === command.styleId || point.pointLabelStyleOverrideId === command.styleId).length +
        groups.filter((group) => group.pointLabelStyleOverrideId === command.styleId).length;
  if (hardRefs > 0 && command.replacementId == null) return null;
  if (command.replacementId !== undefined) {
    if (command.replacementId === command.styleId || !styles.some((entry) => entry.id === command.replacementId)) {
      return null;
    }
  }
  const rewired =
    command.replacementId != null ? rewireStyleRefs(project, command.table, command.styleId, command.replacementId) : project;
  return {
    project: rewired,
    selection: createCadSelectionState(rewired, snapshot.selection.selectedEntityIds),
  };
};
