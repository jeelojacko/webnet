import { createStableRuntimeId } from '../id';
import {
  addCadSampleLine,
  addCadSampleLinesByInterval,
  addCadSectionSource,
  backfillCadSectionStyles,
  createCadSampleLineGroup,
  createCadSectionStyle,
  createCadSectionView,
  deleteCadSampleLine,
  deleteCadSampleLineGroup,
  deleteCadSectionStyle,
  deleteCadSectionView,
  isCadSampleLineGroupNameTaken,
  parseCadStationText,
  removeCadSectionSource,
  renameCadSampleLineGroup,
  renameCadSectionStyle,
  resolveSectionLayerId,
  resolveSectionRawStation,
  setCadSectionSourceStyle,
  updateCadSampleLine,
  updateCadSectionStyle,
  updateCadSectionView,
} from './cadSectionTypes';
import { commitLayerProject } from './cadTransactionsLayerCommands';
import type {
  CadCommand,
  CadCommandDefinition,
  CadCommandExecutionResult,
  CadWorkspaceSnapshot,
} from './cadTransactions.types';
import type { CadProject, CadSampleLineGroup, CadSectionView } from './cadTypes';

// ---------------------------------------------------------------------------
// Phase 18K sample lines / cross sections (definition edits only; derived
// sections are session-only and never dirty the drawing). Deleting a group
// keeps its alignment + surfaces; section views keep their binding and
// derive BROKEN_REFERENCE (reference-safe).
// ---------------------------------------------------------------------------

const nextGroupName = (project: CadProject): string => {
  const taken = new Set((project.sampleLineGroups ?? []).map((entry) => entry.name));
  let index = (project.sampleLineGroups ?? []).length + 1;
  while (taken.has(`Sample Line Group ${index}`)) index += 1;
  return `Sample Line Group ${index}`;
};

const nextSectionViewName = (project: CadProject): string => {
  const taken = new Set((project.sectionViews ?? []).map((entry) => entry.name));
  let index = (project.sectionViews ?? []).length + 1;
  while (taken.has(`Section View ${index}`)) index += 1;
  return `Section View ${index}`;
};

const findAlignment = (project: CadProject, alignmentId: string) => {
  const entity = (project.entities ?? []).find((entry) => entry.id === alignmentId);
  return entity && entity.type === 'alignment' ? entity : null;
};

const styleExists = (project: CadProject, styleId: string | undefined): boolean => {
  if (styleId == null) return true;
  return backfillCadSectionStyles(project.sectionStyles).some((style) => style.id === styleId);
};

const replaceGroup = (
  snapshot: CadWorkspaceSnapshot,
  key: CadCommand['key'],
  groups: CadSampleLineGroup[],
  label: string,
): CadCommandExecutionResult =>
  commitLayerProject(key, snapshot, { ...snapshot.project, sampleLineGroups: groups }, label);

const editGroup = (
  snapshot: CadWorkspaceSnapshot,
  key: CadCommand['key'],
  groupId: string,
  label: string,
  mutate: (_group: CadSampleLineGroup) => CadSampleLineGroup | null,
): CadCommandExecutionResult | null => {
  const groups = snapshot.project.sampleLineGroups ?? [];
  const group = groups.find((entry) => entry.id === groupId);
  if (!group) return null;
  const next = mutate(group);
  if (!next) return null;
  return replaceGroup(
    snapshot,
    key,
    groups.map((entry) => (entry.id === groupId ? next : entry)),
    label,
  );
};

type SampleGroupCreateCommand = Extract<CadCommand, { key: 'SAMPLE_GROUP_CREATE' }>;

const sampleGroupCreateCommand: CadCommandDefinition<SampleGroupCreateCommand> = {
  key: 'SAMPLE_GROUP_CREATE',
  execute: (snapshot, command) => {
    if (!findAlignment(snapshot.project, command.alignmentEntityId)) return null;
    const name = command.name?.trim() || nextGroupName(snapshot.project);
    if (isCadSampleLineGroupNameTaken(snapshot.project.sampleLineGroups ?? [], name)) return null;
    const group: CadSampleLineGroup = {
      id: createStableRuntimeId('cad-sample-group'),
      name,
      alignmentEntityId: command.alignmentEntityId,
      surfaceSources: [],
      sampleLines: [],
      layerId: resolveSectionLayerId(snapshot.project, command.layerId),
    };
    const groups = createCadSampleLineGroup(snapshot.project.sampleLineGroups ?? [], group);
    if (!groups) return null;
    return replaceGroup(snapshot, 'SAMPLE_GROUP_CREATE', groups, `SAMPLE_GROUP_CREATE (${name})`);
  },
};

type SampleGroupRenameCommand = Extract<CadCommand, { key: 'SAMPLE_GROUP_RENAME' }>;

const sampleGroupRenameCommand: CadCommandDefinition<SampleGroupRenameCommand> = {
  key: 'SAMPLE_GROUP_RENAME',
  execute: (snapshot, command) => {
    const groups = renameCadSampleLineGroup(
      snapshot.project.sampleLineGroups ?? [],
      command.groupId,
      command.name,
    );
    if (!groups) return null;
    return replaceGroup(
      snapshot,
      'SAMPLE_GROUP_RENAME',
      groups,
      `SAMPLE_GROUP_RENAME (${command.name.trim()})`,
    );
  },
};

type SampleGroupDeleteCommand = Extract<CadCommand, { key: 'SAMPLE_GROUP_DELETE' }>;

const sampleGroupDeleteCommand: CadCommandDefinition<SampleGroupDeleteCommand> = {
  key: 'SAMPLE_GROUP_DELETE',
  execute: (snapshot, command) => {
    const group = (snapshot.project.sampleLineGroups ?? []).find(
      (entry) => entry.id === command.groupId,
    );
    if (!group) return null;
    // Views keep their binding (reference-safe BROKEN_REFERENCE).
    const groups = deleteCadSampleLineGroup(snapshot.project.sampleLineGroups ?? [], command.groupId);
    if (!groups) return null;
    return replaceGroup(
      snapshot,
      'SAMPLE_GROUP_DELETE',
      groups,
      `SAMPLE_GROUP_DELETE (${group.name})`,
    );
  },
};

type SampleLineAddCommand = Extract<CadCommand, { key: 'SAMPLE_LINE_ADD' }>;

const resolveAddRawStation = (
  snapshot: CadWorkspaceSnapshot,
  group: CadSampleLineGroup,
  command: SampleLineAddCommand,
): number | null => {
  if (command.stationText != null) {
    const alignment = findAlignment(snapshot.project, group.alignmentEntityId);
    if (!alignment) return null;
    const displayStation = parseCadStationText(command.stationText);
    if (displayStation == null) return null;
    return resolveSectionRawStation(alignment, displayStation);
  }
  if (command.rawStation == null || !Number.isFinite(command.rawStation)) return null;
  return command.rawStation;
};

const sampleLineAddCommand: CadCommandDefinition<SampleLineAddCommand> = {
  key: 'SAMPLE_LINE_ADD',
  execute: (snapshot, command) => {
    const group = (snapshot.project.sampleLineGroups ?? []).find(
      (entry) => entry.id === command.groupId,
    );
    if (!group) return null;
    const rawStation = resolveAddRawStation(snapshot, group, command);
    if (rawStation == null) return null;
    const line = {
      id: createStableRuntimeId('cad-sample-line'),
      rawStation,
      leftWidth: command.leftWidth,
      rightWidth: command.rightWidth,
      skewDeg: command.skewDeg ?? 0,
      ...(command.manualName != null && command.manualName.trim() !== ''
        ? { manualName: command.manualName.trim() }
        : {}),
    };
    return editGroup(snapshot, 'SAMPLE_LINE_ADD', command.groupId, 'SAMPLE_LINE_ADD', (current) =>
      addCadSampleLine(current, line),
    );
  },
};

type SampleLineAddIntervalCommand = Extract<CadCommand, { key: 'SAMPLE_LINE_ADD_INTERVAL' }>;

const sampleLineAddIntervalCommand: CadCommandDefinition<SampleLineAddIntervalCommand> = {
  key: 'SAMPLE_LINE_ADD_INTERVAL',
  execute: (snapshot, command) => {
    const group = (snapshot.project.sampleLineGroups ?? []).find(
      (entry) => entry.id === command.groupId,
    );
    if (!group) return null;
    return editGroup(
      snapshot,
      'SAMPLE_LINE_ADD_INTERVAL',
      command.groupId,
      'SAMPLE_LINE_ADD_INTERVAL',
      (current) => {
        const intervalResult = addCadSampleLinesByInterval(current, {
          rawStart: command.rawStart,
          rawEnd: command.rawEnd,
          interval: command.interval,
          leftWidth: command.leftWidth,
          rightWidth: command.rightWidth,
          ...(command.skewDeg != null ? { skewDeg: command.skewDeg } : {}),
          makeId: () => createStableRuntimeId('cad-sample-line'),
        });
        if (!intervalResult || intervalResult.added.length === 0) return null;
        return intervalResult.group;
      },
    );
  },
};

type SampleLineUpdateCommand = Extract<CadCommand, { key: 'SAMPLE_LINE_UPDATE' }>;

const sampleLineUpdateCommand: CadCommandDefinition<SampleLineUpdateCommand> = {
  key: 'SAMPLE_LINE_UPDATE',
  execute: (snapshot, command) =>
    editGroup(snapshot, 'SAMPLE_LINE_UPDATE', command.groupId, 'SAMPLE_LINE_UPDATE', (group) =>
      updateCadSampleLine(group, command.lineId, command.patch),
    ),
};

type SampleLineDeleteCommand = Extract<CadCommand, { key: 'SAMPLE_LINE_DELETE' }>;

const sampleLineDeleteCommand: CadCommandDefinition<SampleLineDeleteCommand> = {
  key: 'SAMPLE_LINE_DELETE',
  execute: (snapshot, command) =>
    editGroup(snapshot, 'SAMPLE_LINE_DELETE', command.groupId, 'SAMPLE_LINE_DELETE', (group) =>
      deleteCadSampleLine(group, command.lineId),
    ),
};

type SectionSourceAddCommand = Extract<CadCommand, { key: 'SECTION_SOURCE_ADD' }>;

const sectionSourceAddCommand: CadCommandDefinition<SectionSourceAddCommand> = {
  key: 'SECTION_SOURCE_ADD',
  execute: (snapshot, command) => {
    const surface = (snapshot.project.surfaces ?? []).find(
      (entry) => entry.id === command.surfaceId,
    );
    if (!surface) return null;
    if (!styleExists(snapshot.project, command.sectionStyleId)) return null;
    return editGroup(snapshot, 'SECTION_SOURCE_ADD', command.groupId, 'SECTION_SOURCE_ADD', (group) =>
      addCadSectionSource(group, {
        surfaceId: command.surfaceId,
        ...(command.sectionStyleId != null ? { sectionStyleId: command.sectionStyleId } : {}),
      }),
    );
  },
};

type SectionSourceRemoveCommand = Extract<CadCommand, { key: 'SECTION_SOURCE_REMOVE' }>;

const sectionSourceRemoveCommand: CadCommandDefinition<SectionSourceRemoveCommand> = {
  key: 'SECTION_SOURCE_REMOVE',
  execute: (snapshot, command) =>
    editGroup(
      snapshot,
      'SECTION_SOURCE_REMOVE',
      command.groupId,
      'SECTION_SOURCE_REMOVE',
      (group) => removeCadSectionSource(group, command.surfaceId),
    ),
};

type SectionSourceSetStyleCommand = Extract<CadCommand, { key: 'SECTION_SOURCE_SET_STYLE' }>;

const sectionSourceSetStyleCommand: CadCommandDefinition<SectionSourceSetStyleCommand> = {
  key: 'SECTION_SOURCE_SET_STYLE',
  execute: (snapshot, command) => {
    if (!styleExists(snapshot.project, command.sectionStyleId ?? undefined)) return null;
    return editGroup(
      snapshot,
      'SECTION_SOURCE_SET_STYLE',
      command.groupId,
      'SECTION_SOURCE_SET_STYLE',
      (group) => setCadSectionSourceStyle(group, command.surfaceId, command.sectionStyleId),
    );
  },
};

type SectionStyleCreateCommand = Extract<CadCommand, { key: 'SECTION_STYLE_CREATE' }>;
type SectionStyleRenameCommand = Extract<CadCommand, { key: 'SECTION_STYLE_RENAME' }>;
type SectionStyleUpdateCommand = Extract<CadCommand, { key: 'SECTION_STYLE_UPDATE' }>;
type SectionStyleDeleteCommand = Extract<CadCommand, { key: 'SECTION_STYLE_DELETE' }>;

const sectionStyleCreateCommand: CadCommandDefinition<SectionStyleCreateCommand> = {
  key: 'SECTION_STYLE_CREATE',
  execute: (snapshot, command) => {
    const styles = backfillCadSectionStyles(snapshot.project.sectionStyles);
    const next = createCadSectionStyle(styles, command.style);
    if (!next) return null;
    return commitLayerProject('SECTION_STYLE_CREATE', snapshot, {
      ...snapshot.project,
      sectionStyles: next,
    }, `SECTION_STYLE_CREATE (${command.style.name})`);
  },
};

const sectionStyleRenameCommand: CadCommandDefinition<SectionStyleRenameCommand> = {
  key: 'SECTION_STYLE_RENAME',
  execute: (snapshot, command) => {
    const styles = backfillCadSectionStyles(snapshot.project.sectionStyles);
    const next = renameCadSectionStyle(styles, command.styleId, command.name);
    if (!next) return null;
    return commitLayerProject('SECTION_STYLE_RENAME', snapshot, {
      ...snapshot.project,
      sectionStyles: next,
    }, `SECTION_STYLE_RENAME (${command.name.trim()})`);
  },
};

const sectionStyleUpdateCommand: CadCommandDefinition<SectionStyleUpdateCommand> = {
  key: 'SECTION_STYLE_UPDATE',
  execute: (snapshot, command) => {
    const styles = backfillCadSectionStyles(snapshot.project.sectionStyles);
    const next = updateCadSectionStyle(styles, command.styleId, command.patch);
    if (!next) return null;
    return commitLayerProject('SECTION_STYLE_UPDATE', snapshot, {
      ...snapshot.project,
      sectionStyles: next,
    }, `SECTION_STYLE_UPDATE (${command.styleId})`);
  },
};

const sectionStyleDeleteCommand: CadCommandDefinition<SectionStyleDeleteCommand> = {
  key: 'SECTION_STYLE_DELETE',
  execute: (snapshot, command) => {
    const styles = backfillCadSectionStyles(snapshot.project.sectionStyles);
    const result = deleteCadSectionStyle(
      styles,
      snapshot.project.sampleLineGroups ?? [],
      snapshot.project.sectionViews ?? [],
      command.styleId,
      command.replacementId,
    );
    if (!result) return null;
    return commitLayerProject('SECTION_STYLE_DELETE', snapshot, {
      ...snapshot.project,
      sectionStyles: result.styles,
      sampleLineGroups: result.groups,
      sectionViews: result.views,
    }, `SECTION_STYLE_DELETE (${command.styleId})`);
  },
};

type SectionViewCreateCommand = Extract<CadCommand, { key: 'SECTION_VIEW_CREATE' }>;

const sectionViewCreateCommand: CadCommandDefinition<SectionViewCreateCommand> = {
  key: 'SECTION_VIEW_CREATE',
  execute: (snapshot, command) => {
    const group = (snapshot.project.sampleLineGroups ?? []).find(
      (entry) => entry.id === command.sampleLineGroupId,
    );
    if (!group || !group.sampleLines.some((line) => line.id === command.sampleLineId)) return null;
    const sourceIds = command.sourceSurfaceIds ?? group.surfaceSources.map((source) => source.surfaceId);
    const sourceSet = new Set(group.surfaceSources.map((source) => source.surfaceId));
    if (!sourceIds.every((id) => sourceSet.has(id))) return null;
    if (!styleExists(snapshot.project, command.styleId)) return null;
    const name = command.name?.trim() || nextSectionViewName(snapshot.project);
    if ((snapshot.project.sectionViews ?? []).some((entry) => entry.name === name)) return null;
    const horizontalScale = command.horizontalScale ?? 1;
    const verticalExaggeration = command.verticalExaggeration ?? 1;
    if (!(horizontalScale > 0) || !(verticalExaggeration > 0)) return null;
    const datumMode = command.datumMode ?? 'auto';
    if (datumMode === 'explicit' && command.datumElevation == null) return null;
    const view: CadSectionView = {
      id: createStableRuntimeId('cad-section-view'),
      name,
      sampleLineGroupId: group.id,
      sampleLineId: command.sampleLineId,
      sourceSurfaceIds: sourceIds,
      insertionX: command.insertionX ?? 0,
      insertionY: command.insertionY ?? 0,
      horizontalScale,
      verticalExaggeration,
      datumMode,
      ...(command.datumElevation != null ? { datumElevation: command.datumElevation } : {}),
      ...(command.offsetGridInterval != null
        ? { offsetGridInterval: command.offsetGridInterval }
        : {}),
      ...(command.elevationGridInterval != null
        ? { elevationGridInterval: command.elevationGridInterval }
        : {}),
      ...(command.showCutFill != null ? { showCutFill: command.showCutFill } : {}),
      ...(command.styleId != null ? { styleId: command.styleId } : {}),
      layerId: resolveSectionLayerId(snapshot.project, command.layerId),
    };
    const views = createCadSectionView(snapshot.project.sectionViews ?? [], view);
    if (!views) return null;
    return commitLayerProject('SECTION_VIEW_CREATE', snapshot, {
      ...snapshot.project,
      sectionViews: views,
    }, `SECTION_VIEW_CREATE (${name})`);
  },
};

type SectionViewUpdateCommand = Extract<CadCommand, { key: 'SECTION_VIEW_UPDATE' }>;

/** Display-only view update; LOCK-gated via the view's layer. */
const sectionViewUpdateCommand: CadCommandDefinition<SectionViewUpdateCommand> = {
  key: 'SECTION_VIEW_UPDATE',
  execute: (snapshot, command) => {
    const views = snapshot.project.sectionViews ?? [];
    const view = views.find((entry) => entry.id === command.viewId);
    if (!view) return null;
    if (snapshot.project.layers.find((entry) => entry.id === view.layerId)?.locked === true) {
      return null;
    }
    if (
      command.patch.styleId !== undefined &&
      !styleExists(snapshot.project, command.patch.styleId ?? undefined)
    ) {
      return null;
    }
    const next = updateCadSectionView(views, command.viewId, command.patch);
    if (!next) return null;
    return commitLayerProject('SECTION_VIEW_UPDATE', snapshot, {
      ...snapshot.project,
      sectionViews: next,
    }, `SECTION_VIEW_UPDATE (${view.name})`);
  },
};

type SectionViewDeleteCommand = Extract<CadCommand, { key: 'SECTION_VIEW_DELETE' }>;

const sectionViewDeleteCommand: CadCommandDefinition<SectionViewDeleteCommand> = {
  key: 'SECTION_VIEW_DELETE',
  execute: (snapshot, command) => {
    const view = (snapshot.project.sectionViews ?? []).find(
      (entry) => entry.id === command.viewId,
    );
    if (!view) return null;
    const views = deleteCadSectionView(snapshot.project.sectionViews ?? [], command.viewId);
    if (!views) return null;
    return commitLayerProject('SECTION_VIEW_DELETE', snapshot, {
      ...snapshot.project,
      sectionViews: views,
    }, `SECTION_VIEW_DELETE (${view.name})`);
  },
};

export const sectionCommandDefinitions = {
  SAMPLE_GROUP_CREATE: sampleGroupCreateCommand,
  SAMPLE_GROUP_RENAME: sampleGroupRenameCommand,
  SAMPLE_GROUP_DELETE: sampleGroupDeleteCommand,
  SAMPLE_LINE_ADD: sampleLineAddCommand,
  SAMPLE_LINE_ADD_INTERVAL: sampleLineAddIntervalCommand,
  SAMPLE_LINE_UPDATE: sampleLineUpdateCommand,
  SAMPLE_LINE_DELETE: sampleLineDeleteCommand,
  SECTION_SOURCE_ADD: sectionSourceAddCommand,
  SECTION_SOURCE_REMOVE: sectionSourceRemoveCommand,
  SECTION_SOURCE_SET_STYLE: sectionSourceSetStyleCommand,
  SECTION_STYLE_CREATE: sectionStyleCreateCommand,
  SECTION_STYLE_RENAME: sectionStyleRenameCommand,
  SECTION_STYLE_UPDATE: sectionStyleUpdateCommand,
  SECTION_STYLE_DELETE: sectionStyleDeleteCommand,
  SECTION_VIEW_CREATE: sectionViewCreateCommand,
  SECTION_VIEW_UPDATE: sectionViewUpdateCommand,
  SECTION_VIEW_DELETE: sectionViewDeleteCommand,
} as const;
