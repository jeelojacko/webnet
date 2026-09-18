import { createStableRuntimeId } from '../id';
import {
  backfillVolumeSurfaceStyles,
  createCadVolumeSurfaceStyle,
  deleteCadVolumeSurfaceStyle,
  duplicateCadVolumeSurfaceStyle,
  renameCadVolumeSurfaceStyle,
  updateCadVolumeSurfaceStyle,
} from './cadVolumeSurfaces';
import { isSurfaceLayerLocked, resolveSurfaceLayerId } from './cadSurfaceTypes';
import { commitLayerProject } from './cadTransactionsLayerCommands';
import type {
  CadCommand,
  CadCommandDefinition,
  CadCommandExecutionResult,
  CadWorkspaceSnapshot,
} from './cadTransactions.types';
import type { CadProject, CadVolumeSurface } from './cadTypes';

// ---------------------------------------------------------------------------
// Phase 18I volume surfaces (relationship edits only; derived results are
// session-only and never dirty the drawing). All LOCK-gated via the volume's
// layer; base and comparison must exist and differ.
// ---------------------------------------------------------------------------

const nextVolumeName = (project: CadProject): string => {
  const taken = new Set((project.volumeSurfaces ?? []).map((entry) => entry.name));
  let index = (project.volumeSurfaces ?? []).length + 1;
  while (taken.has(`Volume ${index}`)) index += 1;
  return `Volume ${index}`;
};

/** Relationship edits never clear a derived cache; status re-derives from refs. */
const editVolume = (
  snapshot: CadWorkspaceSnapshot,
  key: CadCommand['key'],
  volumeSurfaceId: string,
  label: string,
  mutate: (_volume: CadVolumeSurface) => CadVolumeSurface | null,
): CadCommandExecutionResult | null => {
  const volumes = snapshot.project.volumeSurfaces ?? [];
  const volume = volumes.find((entry) => entry.id === volumeSurfaceId);
  if (!volume || isSurfaceLayerLocked(snapshot.project, volume)) return null;
  const next = mutate({ ...volume });
  if (!next) return null;
  return commitLayerProject(key, snapshot, {
    ...snapshot.project,
    volumeSurfaces: volumes.map((entry) => (entry.id === volumeSurfaceId ? next : entry)),
  }, label);
};

type VolumeCreateCommand = Extract<CadCommand, { key: 'VOLUME_SURFACE_CREATE' }>;

const volumeSurfaceCreateCommand: CadCommandDefinition<VolumeCreateCommand> = {
  key: 'VOLUME_SURFACE_CREATE',
  execute: (snapshot, command) => {
    const surfaces = snapshot.project.surfaces ?? [];
    const base = surfaces.find((entry) => entry.id === command.baseSurfaceId);
    const comparison = surfaces.find((entry) => entry.id === command.comparisonSurfaceId);
    if (!base || !comparison || base.id === comparison.id) return null;
    const name = command.name?.trim() || nextVolumeName(snapshot.project);
    if ((snapshot.project.volumeSurfaces ?? []).some((entry) => entry.name === name)) return null;
    const styles = backfillVolumeSurfaceStyles(snapshot.project.volumeSurfaceStyles);
    if (command.styleId != null && !styles.some((style) => style.id === command.styleId)) return null;
    const volume: CadVolumeSurface = {
      id: createStableRuntimeId('cad-volume-surface'),
      name,
      baseSurfaceId: base.id,
      comparisonSurfaceId: comparison.id,
      ...(command.styleId != null ? { styleId: command.styleId } : {}),
      layerId: resolveSurfaceLayerId(snapshot.project, command.layerId),
    };
    return commitLayerProject('VOLUME_SURFACE_CREATE', snapshot, {
      ...snapshot.project,
      volumeSurfaces: [...(snapshot.project.volumeSurfaces ?? []), volume],
    }, `VOLUME_SURFACE_CREATE (${name})`);
  },
};

type VolumeDeleteCommand = Extract<CadCommand, { key: 'VOLUME_SURFACE_DELETE' }>;

const volumeSurfaceDeleteCommand: CadCommandDefinition<VolumeDeleteCommand> = {
  key: 'VOLUME_SURFACE_DELETE',
  execute: (snapshot, command) => {
    const volume = (snapshot.project.volumeSurfaces ?? []).find(
      (entry) => entry.id === command.volumeSurfaceId,
    );
    if (!volume || isSurfaceLayerLocked(snapshot.project, volume)) return null;
    return commitLayerProject('VOLUME_SURFACE_DELETE', snapshot, {
      ...snapshot.project,
      volumeSurfaces: (snapshot.project.volumeSurfaces ?? []).filter(
        (entry) => entry.id !== command.volumeSurfaceId,
      ),
    }, `VOLUME_SURFACE_DELETE (${volume.name})`);
  },
};

type VolumeUpdateSourcesCommand = Extract<CadCommand, { key: 'VOLUME_SURFACE_UPDATE_SOURCES' }>;

const volumeSurfaceUpdateSourcesCommand: CadCommandDefinition<VolumeUpdateSourcesCommand> = {
  key: 'VOLUME_SURFACE_UPDATE_SOURCES',
  execute: (snapshot, command) => {
    const surfaces = snapshot.project.surfaces ?? [];
    const base = surfaces.find((entry) => entry.id === command.baseSurfaceId);
    const comparison = surfaces.find((entry) => entry.id === command.comparisonSurfaceId);
    if (!base || !comparison || base.id === comparison.id) return null;
    return editVolume(
      snapshot,
      'VOLUME_SURFACE_UPDATE_SOURCES',
      command.volumeSurfaceId,
      'VOLUME_SURFACE_UPDATE_SOURCES',
      (volume) =>
        volume.baseSurfaceId === base.id && volume.comparisonSurfaceId === comparison.id
          ? null
          : { ...volume, baseSurfaceId: base.id, comparisonSurfaceId: comparison.id },
    );
  },
};

type VolumeSetLayerStyleCommand = Extract<CadCommand, { key: 'VOLUME_SURFACE_SET_LAYER_STYLE' }>;

const volumeSurfaceSetLayerStyleCommand: CadCommandDefinition<VolumeSetLayerStyleCommand> = {
  key: 'VOLUME_SURFACE_SET_LAYER_STYLE',
  execute: (snapshot, command) => {
    const styles = backfillVolumeSurfaceStyles(snapshot.project.volumeSurfaceStyles);
    if (command.styleId != null && !styles.some((style) => style.id === command.styleId)) return null;
    if (command.layerId != null) {
      const target = snapshot.project.layers.find((entry) => entry.id === command.layerId);
      if (!target || target.locked) return null;
    }
    return editVolume(
      snapshot,
      'VOLUME_SURFACE_SET_LAYER_STYLE',
      command.volumeSurfaceId,
      'VOLUME_SURFACE_SET_LAYER_STYLE',
      (volume) => {
        const next: CadVolumeSurface = { ...volume };
        let changed = false;
        if (command.layerId !== undefined && command.layerId !== volume.layerId) {
          next.layerId = command.layerId;
          changed = true;
        }
        if (command.styleId !== undefined) {
          const styleId = command.styleId ?? undefined;
          if (styleId !== volume.styleId) {
            if (styleId == null) delete next.styleId;
            else next.styleId = styleId;
            changed = true;
          }
        }
        return changed ? next : null;
      },
    );
  },
};

type VolumeStyleCreateCommand = Extract<CadCommand, { key: 'VOLUME_STYLE_CREATE' }>;
type VolumeStyleDuplicateCommand = Extract<CadCommand, { key: 'VOLUME_STYLE_DUPLICATE' }>;
type VolumeStyleRenameCommand = Extract<CadCommand, { key: 'VOLUME_STYLE_RENAME' }>;
type VolumeStyleUpdateCommand = Extract<CadCommand, { key: 'VOLUME_STYLE_UPDATE' }>;
type VolumeStyleDeleteCommand = Extract<CadCommand, { key: 'VOLUME_STYLE_DELETE' }>;

const volumeStyleCreateCommand: CadCommandDefinition<VolumeStyleCreateCommand> = {
  key: 'VOLUME_STYLE_CREATE',
  execute: (snapshot, command) => {
    const styles = backfillVolumeSurfaceStyles(snapshot.project.volumeSurfaceStyles);
    const next = createCadVolumeSurfaceStyle(styles, command.style);
    if (!next) return null;
    return commitLayerProject('VOLUME_STYLE_CREATE', snapshot, {
      ...snapshot.project,
      volumeSurfaceStyles: next,
    }, `VOLUME_STYLE_CREATE (${command.style.name})`);
  },
};

const volumeStyleDuplicateCommand: CadCommandDefinition<VolumeStyleDuplicateCommand> = {
  key: 'VOLUME_STYLE_DUPLICATE',
  execute: (snapshot, command) => {
    const styles = backfillVolumeSurfaceStyles(snapshot.project.volumeSurfaceStyles);
    const next = duplicateCadVolumeSurfaceStyle(styles, command.styleId, command.newId, command.name);
    if (!next) return null;
    return commitLayerProject('VOLUME_STYLE_DUPLICATE', snapshot, {
      ...snapshot.project,
      volumeSurfaceStyles: next,
    }, `VOLUME_STYLE_DUPLICATE (${command.name})`);
  },
};

const volumeStyleRenameCommand: CadCommandDefinition<VolumeStyleRenameCommand> = {
  key: 'VOLUME_STYLE_RENAME',
  execute: (snapshot, command) => {
    const styles = backfillVolumeSurfaceStyles(snapshot.project.volumeSurfaceStyles);
    const next = renameCadVolumeSurfaceStyle(styles, command.styleId, command.name);
    if (!next) return null;
    return commitLayerProject('VOLUME_STYLE_RENAME', snapshot, {
      ...snapshot.project,
      volumeSurfaceStyles: next,
    }, `VOLUME_STYLE_RENAME (${command.name.trim()})`);
  },
};

const volumeStyleUpdateCommand: CadCommandDefinition<VolumeStyleUpdateCommand> = {
  key: 'VOLUME_STYLE_UPDATE',
  execute: (snapshot, command) => {
    const styles = backfillVolumeSurfaceStyles(snapshot.project.volumeSurfaceStyles);
    const next = updateCadVolumeSurfaceStyle(styles, command.styleId, command.patch);
    if (!next) return null;
    return commitLayerProject('VOLUME_STYLE_UPDATE', snapshot, {
      ...snapshot.project,
      volumeSurfaceStyles: next,
    }, `VOLUME_STYLE_UPDATE (${command.styleId})`);
  },
};

const volumeStyleDeleteCommand: CadCommandDefinition<VolumeStyleDeleteCommand> = {
  key: 'VOLUME_STYLE_DELETE',
  execute: (snapshot, command) => {
    const styles = backfillVolumeSurfaceStyles(snapshot.project.volumeSurfaceStyles);
    const result = deleteCadVolumeSurfaceStyle(
      styles,
      snapshot.project.volumeSurfaces ?? [],
      command.styleId,
      command.replacementId,
    );
    if (!result) return null;
    return commitLayerProject('VOLUME_STYLE_DELETE', snapshot, {
      ...snapshot.project,
      volumeSurfaceStyles: result.styles,
      volumeSurfaces: result.volumeSurfaces,
    }, `VOLUME_STYLE_DELETE (${command.styleId})`);
  },
};

export const volumeCommandDefinitions = {
  VOLUME_SURFACE_CREATE: volumeSurfaceCreateCommand,
  VOLUME_SURFACE_DELETE: volumeSurfaceDeleteCommand,
  VOLUME_SURFACE_UPDATE_SOURCES: volumeSurfaceUpdateSourcesCommand,
  VOLUME_SURFACE_SET_LAYER_STYLE: volumeSurfaceSetLayerStyleCommand,
  VOLUME_STYLE_CREATE: volumeStyleCreateCommand,
  VOLUME_STYLE_DUPLICATE: volumeStyleDuplicateCommand,
  VOLUME_STYLE_RENAME: volumeStyleRenameCommand,
  VOLUME_STYLE_UPDATE: volumeStyleUpdateCommand,
  VOLUME_STYLE_DELETE: volumeStyleDeleteCommand,
} as const;
