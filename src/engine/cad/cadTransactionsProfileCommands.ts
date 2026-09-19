import { createStableRuntimeId } from '../id';
import {
  backfillCadProfileStyles,
  createCadProfileStyle,
  deleteCadProfileStyle,
  duplicateCadProfileStyle,
  renameCadProfileStyle,
  updateCadProfileStyle,
} from './cadProfileTypes';
import { commitLayerProject } from './cadTransactionsLayerCommands';
import type {
  CadCommand,
  CadCommandDefinition,
  CadCommandExecutionResult,
  CadWorkspaceSnapshot,
} from './cadTransactions.types';
import type { CadProfileView, CadProject, CadSurfaceProfile } from './cadTypes';

// ---------------------------------------------------------------------------
// Phase 18J surface profiles (definition edits only; derived samples are
// session-only and never dirty the drawing). All LOCK-gated via the
// profile's layer; alignment and surface refs must exist. Deleting a
// profile prunes it from every view's membership (views are presentation
// only and survive with fewer members — including zero).
// ---------------------------------------------------------------------------

const nextProfileName = (project: CadProject): string => {
  const taken = new Set((project.surfaceProfiles ?? []).map((entry) => entry.name));
  let index = (project.surfaceProfiles ?? []).length + 1;
  while (taken.has(`Profile ${index}`)) index += 1;
  return `Profile ${index}`;
};

const nextProfileViewName = (project: CadProject): string => {
  const taken = new Set((project.profileViews ?? []).map((entry) => entry.name));
  let index = (project.profileViews ?? []).length + 1;
  while (taken.has(`Profile View ${index}`)) index += 1;
  return `Profile View ${index}`;
};

const findAlignment = (project: CadProject, alignmentId: string) => {
  const entity = (project.entities ?? []).find((entry) => entry.id === alignmentId);
  return entity && entity.type === 'alignment' ? entity : null;
};

const styleExists = (project: CadProject, styleId: string | undefined): boolean => {
  if (styleId == null) return true;
  return backfillCadProfileStyles(project.profileStyles).some((style) => style.id === styleId);
};

/** Definition edits never clear a derived cache; status re-derives from refs. */
const editProfile = (
  snapshot: CadWorkspaceSnapshot,
  key: CadCommand['key'],
  profileId: string,
  label: string,
  mutate: (_profile: CadSurfaceProfile) => CadSurfaceProfile | null,
): CadCommandExecutionResult | null => {
  const profiles = snapshot.project.surfaceProfiles ?? [];
  const profile = profiles.find((entry) => entry.id === profileId);
  if (!profile) return null;
  const next = mutate({ ...profile });
  if (!next) return null;
  return commitLayerProject(key, snapshot, {
    ...snapshot.project,
    surfaceProfiles: profiles.map((entry) => (entry.id === profileId ? next : entry)),
  }, label);
};

type ProfileCreateCommand = Extract<CadCommand, { key: 'PROFILE_CREATE' }>;

const profileCreateCommand: CadCommandDefinition<ProfileCreateCommand> = {
  key: 'PROFILE_CREATE',
  execute: (snapshot, command) => {
    const alignment = findAlignment(snapshot.project, command.alignmentEntityId);
    const surface = (snapshot.project.surfaces ?? []).find(
      (entry) => entry.id === command.surfaceId,
    );
    if (!alignment || !surface) return null;
    const name = command.name?.trim() || nextProfileName(snapshot.project);
    if ((snapshot.project.surfaceProfiles ?? []).some((entry) => entry.name === name)) return null;
    if (!styleExists(snapshot.project, command.styleId ?? undefined)) return null;
    const profile: CadSurfaceProfile = {
      id: createStableRuntimeId('cad-surface-profile'),
      name,
      alignmentEntityId: alignment.id,
      surfaceId: surface.id,
      ...(command.styleId != null ? { styleId: command.styleId } : {}),
      ...(command.description != null ? { description: command.description } : {}),
    };
    return commitLayerProject('PROFILE_CREATE', snapshot, {
      ...snapshot.project,
      surfaceProfiles: [...(snapshot.project.surfaceProfiles ?? []), profile],
    }, `PROFILE_CREATE (${name})`);
  },
};

type ProfileRebuildCommand = Extract<CadCommand, { key: 'PROFILE_REBUILD' }>;

const profileRebuildCommand: CadCommandDefinition<ProfileRebuildCommand> = {
  key: 'PROFILE_REBUILD',
  execute: (snapshot, command) => {
    if (command.alignmentEntityId != null) {
      if (!findAlignment(snapshot.project, command.alignmentEntityId)) return null;
    }
    if (command.surfaceId != null) {
      const surface = (snapshot.project.surfaces ?? []).find(
        (entry) => entry.id === command.surfaceId,
      );
      if (!surface) return null;
    }
    if (!styleExists(snapshot.project, command.styleId ?? undefined)) return null;
    const name = command.name?.trim();
    if (name != null) {
      if (name === '') return null;
      const clash = (snapshot.project.surfaceProfiles ?? []).some(
        (entry) => entry.id !== command.profileId && entry.name === name,
      );
      if (clash) return null;
    }
    return editProfile(
      snapshot,
      'PROFILE_REBUILD',
      command.profileId,
      'PROFILE_REBUILD',
      (profile) => {
        const next: CadSurfaceProfile = { ...profile };
        let changed = false;
        if (command.alignmentEntityId != null && command.alignmentEntityId !== profile.alignmentEntityId) {
          next.alignmentEntityId = command.alignmentEntityId;
          changed = true;
        }
        if (command.surfaceId != null && command.surfaceId !== profile.surfaceId) {
          next.surfaceId = command.surfaceId;
          changed = true;
        }
        if (name != null && name !== profile.name) {
          next.name = name;
          changed = true;
        }
        if (command.styleId !== undefined) {
          const styleId = command.styleId ?? undefined;
          if (styleId !== profile.styleId) {
            if (styleId == null) delete next.styleId;
            else next.styleId = styleId;
            changed = true;
          }
        }
        if (command.description !== undefined && command.description !== profile.description) {
          const description = command.description ?? undefined;
          if (description == null) delete next.description;
          else next.description = description;
          changed = true;
        }
        return changed ? next : null;
      },
    );
  },
};

type ProfileDeleteCommand = Extract<CadCommand, { key: 'PROFILE_DELETE' }>;

const profileDeleteCommand: CadCommandDefinition<ProfileDeleteCommand> = {
  key: 'PROFILE_DELETE',
  execute: (snapshot, command) => {
    const profile = (snapshot.project.surfaceProfiles ?? []).find(
      (entry) => entry.id === command.profileId,
    );
    if (!profile) return null;
    return commitLayerProject('PROFILE_DELETE', snapshot, {
      ...snapshot.project,
      surfaceProfiles: (snapshot.project.surfaceProfiles ?? []).filter(
        (entry) => entry.id !== command.profileId,
      ),
      // Refcount vs views: views survive with the member pruned.
      profileViews: (snapshot.project.profileViews ?? []).map((view) =>
        view.profileIds.includes(command.profileId)
          ? { ...view, profileIds: view.profileIds.filter((id) => id !== command.profileId) }
          : view,
      ),
    }, `PROFILE_DELETE (${profile.name})`);
  },
};

type ProfileViewCreateCommand = Extract<CadCommand, { key: 'PROFILE_VIEW_CREATE' }>;

const profileViewCreateCommand: CadCommandDefinition<ProfileViewCreateCommand> = {
  key: 'PROFILE_VIEW_CREATE',
  execute: (snapshot, command) => {
    const alignment = findAlignment(snapshot.project, command.alignmentEntityId);
    if (!alignment) return null;
    const profiles = snapshot.project.surfaceProfiles ?? [];
    const memberIds = command.profileIds ?? [];
    for (const memberId of memberIds) {
      if (!profiles.some((entry) => entry.id === memberId)) return null;
    }
    const name = command.name?.trim() || nextProfileViewName(snapshot.project);
    if ((snapshot.project.profileViews ?? []).some((entry) => entry.name === name)) return null;
    if (!styleExists(snapshot.project, command.styleId ?? undefined)) return null;
    const horizontalScale = command.horizontalScale ?? 1;
    const verticalExaggeration = command.verticalExaggeration ?? 1;
    if (!(horizontalScale > 0) || !(verticalExaggeration > 0)) return null;
    const view: CadProfileView = {
      id: createStableRuntimeId('cad-profile-view'),
      name,
      alignmentEntityId: alignment.id,
      profileIds: [...memberIds],
      insertionX: command.insertionX ?? 0,
      insertionY: command.insertionY ?? 0,
      ...(command.width != null ? { width: command.width } : {}),
      ...(command.height != null ? { height: command.height } : {}),
      horizontalScale,
      verticalExaggeration,
      ...(command.datumElevation != null ? { datumElevation: command.datumElevation } : {}),
      datumMode: command.datumMode ?? 'auto',
      ...(command.datumStep != null ? { datumStep: command.datumStep } : {}),
      ...(command.majorStationInterval != null
        ? { majorStationInterval: command.majorStationInterval }
        : {}),
      ...(command.minorStationInterval != null
        ? { minorStationInterval: command.minorStationInterval }
        : {}),
      ...(command.elevationGridInterval != null
        ? { elevationGridInterval: command.elevationGridInterval }
        : {}),
      ...(command.styleId != null ? { styleId: command.styleId } : {}),
    };
    return commitLayerProject('PROFILE_VIEW_CREATE', snapshot, {
      ...snapshot.project,
      profileViews: [...(snapshot.project.profileViews ?? []), view],
    }, `PROFILE_VIEW_CREATE (${name})`);
  },
};

type ProfileViewDeleteCommand = Extract<CadCommand, { key: 'PROFILE_VIEW_DELETE' }>;

const profileViewDeleteCommand: CadCommandDefinition<ProfileViewDeleteCommand> = {
  key: 'PROFILE_VIEW_DELETE',
  execute: (snapshot, command) => {
    const view = (snapshot.project.profileViews ?? []).find(
      (entry) => entry.id === command.viewId,
    );
    if (!view) return null;
    return commitLayerProject('PROFILE_VIEW_DELETE', snapshot, {
      ...snapshot.project,
      profileViews: (snapshot.project.profileViews ?? []).filter(
        (entry) => entry.id !== command.viewId,
      ),
    }, `PROFILE_VIEW_DELETE (${view.name})`);
  },
};

type ProfileStyleCreateCommand = Extract<CadCommand, { key: 'PROFILE_STYLE_CREATE' }>;
type ProfileStyleDuplicateCommand = Extract<CadCommand, { key: 'PROFILE_STYLE_DUPLICATE' }>;
type ProfileStyleRenameCommand = Extract<CadCommand, { key: 'PROFILE_STYLE_RENAME' }>;
type ProfileStyleUpdateCommand = Extract<CadCommand, { key: 'PROFILE_STYLE_UPDATE' }>;
type ProfileStyleDeleteCommand = Extract<CadCommand, { key: 'PROFILE_STYLE_DELETE' }>;

const profileStyleCreateCommand: CadCommandDefinition<ProfileStyleCreateCommand> = {
  key: 'PROFILE_STYLE_CREATE',
  execute: (snapshot, command) => {
    const styles = backfillCadProfileStyles(snapshot.project.profileStyles);
    const next = createCadProfileStyle(styles, command.style);
    if (!next) return null;
    return commitLayerProject('PROFILE_STYLE_CREATE', snapshot, {
      ...snapshot.project,
      profileStyles: next,
    }, `PROFILE_STYLE_CREATE (${command.style.name})`);
  },
};

const profileStyleDuplicateCommand: CadCommandDefinition<ProfileStyleDuplicateCommand> = {
  key: 'PROFILE_STYLE_DUPLICATE',
  execute: (snapshot, command) => {
    const styles = backfillCadProfileStyles(snapshot.project.profileStyles);
    const next = duplicateCadProfileStyle(styles, command.styleId, command.newId, command.name);
    if (!next) return null;
    return commitLayerProject('PROFILE_STYLE_DUPLICATE', snapshot, {
      ...snapshot.project,
      profileStyles: next,
    }, `PROFILE_STYLE_DUPLICATE (${command.name})`);
  },
};

const profileStyleRenameCommand: CadCommandDefinition<ProfileStyleRenameCommand> = {
  key: 'PROFILE_STYLE_RENAME',
  execute: (snapshot, command) => {
    const styles = backfillCadProfileStyles(snapshot.project.profileStyles);
    const next = renameCadProfileStyle(styles, command.styleId, command.name);
    if (!next) return null;
    return commitLayerProject('PROFILE_STYLE_RENAME', snapshot, {
      ...snapshot.project,
      profileStyles: next,
    }, `PROFILE_STYLE_RENAME (${command.name.trim()})`);
  },
};

const profileStyleUpdateCommand: CadCommandDefinition<ProfileStyleUpdateCommand> = {
  key: 'PROFILE_STYLE_UPDATE',
  execute: (snapshot, command) => {
    const styles = backfillCadProfileStyles(snapshot.project.profileStyles);
    const next = updateCadProfileStyle(styles, command.styleId, command.patch);
    if (!next) return null;
    return commitLayerProject('PROFILE_STYLE_UPDATE', snapshot, {
      ...snapshot.project,
      profileStyles: next,
    }, `PROFILE_STYLE_UPDATE (${command.styleId})`);
  },
};

const profileStyleDeleteCommand: CadCommandDefinition<ProfileStyleDeleteCommand> = {
  key: 'PROFILE_STYLE_DELETE',
  execute: (snapshot, command) => {
    const styles = backfillCadProfileStyles(snapshot.project.profileStyles);
    const result = deleteCadProfileStyle(
      styles,
      snapshot.project.surfaceProfiles ?? [],
      snapshot.project.profileViews ?? [],
      command.styleId,
      command.replacementId,
    );
    if (!result) return null;
    return commitLayerProject('PROFILE_STYLE_DELETE', snapshot, {
      ...snapshot.project,
      profileStyles: result.styles,
      surfaceProfiles: result.profiles,
      profileViews: result.views,
    }, `PROFILE_STYLE_DELETE (${command.styleId})`);
  },
};

export const profileCommandDefinitions = {
  PROFILE_CREATE: profileCreateCommand,
  PROFILE_REBUILD: profileRebuildCommand,
  PROFILE_DELETE: profileDeleteCommand,
  PROFILE_VIEW_CREATE: profileViewCreateCommand,
  PROFILE_VIEW_DELETE: profileViewDeleteCommand,
  PROFILE_STYLE_CREATE: profileStyleCreateCommand,
  PROFILE_STYLE_DUPLICATE: profileStyleDuplicateCommand,
  PROFILE_STYLE_RENAME: profileStyleRenameCommand,
  PROFILE_STYLE_UPDATE: profileStyleUpdateCommand,
  PROFILE_STYLE_DELETE: profileStyleDeleteCommand,
} as const;
