import { createStableRuntimeId } from '../id';
import { surfacePointGroupIds } from './cadTypes';
import { backfillCadSurfaceStyles, createCadSurfaceStyle, deleteCadSurfaceStyle, duplicateCadSurfaceStyle, renameCadSurfaceStyle, updateCadSurfaceStyle } from './cadSurfaceStyles';
import { isSurfaceLayerLocked, resolveSurfaceLayerId } from './cadSurfaceTypes';
import { commitLayerProject } from './cadTransactionsLayerCommands';
import type {
  CadCommand,
  CadCommandDefinition,
  CadCommandExecutionResult,
  CadWorkspaceSnapshot,
} from './cadTransactions.types';
import type { CadProject, CadSurface } from './cadTypes';

/**
 * Phase 18F surface transactions. Definition edits only (sources,
 * breaklines, boundaries, options, layer/style binding, style table) —
 * undoable CadCommands over the existing history path. The derived mesh is
 * never touched here (never dirties, never in history); geometry edits
 * clear the cached revision so the status re-derives NEEDS_REBUILD.
 * Destructive edits are blocked when the surface layer is locked.
 */

const nonEmptyName = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const commitSurface = (
  key: CadCommand['key'],
  snapshot: CadWorkspaceSnapshot,
  nextProject: CadProject,
  label: string,
): CadCommandExecutionResult =>
  commitLayerProject(key, snapshot, nextProject, label);

/** Geometry edits clear the cached build; renames/binding leave it. */
const editSurface = (
  snapshot: CadWorkspaceSnapshot,
  key: CadCommand['key'],
  surfaceId: string,
  label: string,
  mutate: (_surface: CadSurface) => CadSurface | null,
  geometry: boolean,
): CadCommandExecutionResult | null => {
  const surfaces = snapshot.project.surfaces ?? [];
  const surface = surfaces.find((entry) => entry.id === surfaceId);
  if (!surface) return null;
  if (isSurfaceLayerLocked(snapshot.project, surface)) return null;
  const next = mutate({ ...surface });
  if (!next) return null;
  const touched: CadSurface =
    geometry && next.cachedRevision != null
      ? { ...next, cachedRevision: null, buildDiagnostic: undefined }
      : next;
  return commitSurface(key, snapshot, {
    ...snapshot.project,
    surfaces: surfaces.map((entry) => (entry.id === surfaceId ? touched : entry)),
  }, label);
};

const nextSurfaceName = (project: CadProject): string => {
  const taken = new Set((project.surfaces ?? []).map((entry) => entry.name));
  let index = (project.surfaces ?? []).length + 1;
  while (taken.has(`Surface ${index}`)) index += 1;
  return `Surface ${index}`;
};

type CreateCommand = Extract<CadCommand, { key: 'SURFACE_CREATE' }>;

const surfaceCreateCommand: CadCommandDefinition<CreateCommand> = {
  key: 'SURFACE_CREATE',
  execute: (snapshot, command) => {
    const name = command.name?.trim() || nextSurfaceName(snapshot.project);
    if ((snapshot.project.surfaces ?? []).some((entry) => entry.name === name)) return null;
    const styles = backfillCadSurfaceStyles(snapshot.project.surfaceStyles);
    if (command.styleId != null && !styles.some((style) => style.id === command.styleId)) {
      return null;
    }
    if (command.pointSource?.kind === 'point-group') {
      const groupIds = surfacePointGroupIds(command.pointSource);
      if (groupIds.length === 0) return null;
      if (!groupIds.every((groupId) => (snapshot.project.pointGroups ?? []).some((group) => group.id === groupId))) {
        return null;
      }
    }
    const maxEdgeLength = command.buildOptions?.maxEdgeLength;
    const surface: CadSurface = {
      id: createStableRuntimeId('cad-surface'),
      name,
      definition: {
        pointSource: command.pointSource
          ? command.pointSource.kind === 'points'
            ? { kind: 'points', pointEntityIds: [...command.pointSource.pointEntityIds] }
            : { kind: 'point-group', pointGroupIds: surfacePointGroupIds(command.pointSource) }
          : { kind: 'points', pointEntityIds: [] },
        ...(Number.isFinite(maxEdgeLength) && (maxEdgeLength as number) > 0
          ? { buildOptions: { maxEdgeLength: maxEdgeLength as number } }
          : {}),
      },
      ...(command.styleId != null ? { styleId: command.styleId } : {}),
      layerId: resolveSurfaceLayerId(snapshot.project, command.layerId),
      cachedRevision: null,
    };
    return commitSurface('SURFACE_CREATE', snapshot, {
      ...snapshot.project,
      surfaces: [...(snapshot.project.surfaces ?? []), surface],
    }, `SURFACE_CREATE (${name})`);
  },
};

type DeleteCommand = Extract<CadCommand, { key: 'SURFACE_DELETE' }>;

const surfaceDeleteCommand: CadCommandDefinition<DeleteCommand> = {
  key: 'SURFACE_DELETE',
  execute: (snapshot, command) => {
    const surface = (snapshot.project.surfaces ?? []).find((entry) => entry.id === command.surfaceId);
    if (!surface || isSurfaceLayerLocked(snapshot.project, surface)) return null;
    return commitSurface('SURFACE_DELETE', snapshot, {
      ...snapshot.project,
      surfaces: (snapshot.project.surfaces ?? []).filter((entry) => entry.id !== command.surfaceId),
    }, `SURFACE_DELETE (${surface.name})`);
  },
};

type RenameCommand = Extract<CadCommand, { key: 'SURFACE_RENAME' }>;

const surfaceRenameCommand: CadCommandDefinition<RenameCommand> = {
  key: 'SURFACE_RENAME',
  execute: (snapshot, command) => {
    if (!nonEmptyName(command.name)) return null;
    const name = command.name.trim();
    if ((snapshot.project.surfaces ?? []).some((entry) => entry.id !== command.surfaceId && entry.name === name)) {
      return null;
    }
    return editSurface(snapshot, 'SURFACE_RENAME', command.surfaceId, `SURFACE_RENAME (${name})`,
      (surface) => (surface.name === name ? null : { ...surface, name }), false);
  },
};

type SetLayerStyleCommand = Extract<CadCommand, { key: 'SURFACE_SET_LAYER_STYLE' }>;

const surfaceSetLayerStyleCommand: CadCommandDefinition<SetLayerStyleCommand> = {
  key: 'SURFACE_SET_LAYER_STYLE',
  execute: (snapshot, command) => {
    const styles = backfillCadSurfaceStyles(snapshot.project.surfaceStyles);
    if (command.styleId != null && !styles.some((style) => style.id === command.styleId)) return null;
    if (command.layerId != null) {
      const target = snapshot.project.layers.find((entry) => entry.id === command.layerId);
      if (!target || target.locked) return null;
    }
    return editSurface(snapshot, 'SURFACE_SET_LAYER_STYLE', command.surfaceId, 'SURFACE_SET_LAYER_STYLE',
      (surface) => {
        const next: CadSurface = { ...surface };
        let changed = false;
        if (command.layerId !== undefined && command.layerId !== surface.layerId) {
          next.layerId = command.layerId;
          changed = true;
        }
        if (command.styleId !== undefined) {
          const styleId = command.styleId ?? undefined;
          if (styleId !== surface.styleId) {
            if (styleId == null) delete next.styleId;
            else next.styleId = styleId;
            changed = true;
          }
        }
        return changed ? next : null;
      }, false);
  },
};

type AddPointGroupCommand = Extract<CadCommand, { key: 'SURFACE_ADD_POINT_GROUP' }>;

const surfaceAddPointGroupCommand: CadCommandDefinition<AddPointGroupCommand> = {
  key: 'SURFACE_ADD_POINT_GROUP',
  execute: (snapshot, command) => {
    if (!(snapshot.project.pointGroups ?? []).some((group) => group.id === command.pointGroupId)) {
      return null;
    }
    return editSurface(snapshot, 'SURFACE_ADD_POINT_GROUP', command.surfaceId, 'SURFACE_ADD_POINT_GROUP',
      (surface) => {
        // Additive multi-group: a points-kind source converts to the first
        // group (legacy replace path); group sources append without dupes.
        const current = surface.definition.pointSource.kind === 'point-group'
          ? surfacePointGroupIds(surface.definition.pointSource)
          : [];
        if (current.includes(command.pointGroupId)) return null;
        return {
          ...surface,
          definition: {
            ...surface.definition,
            pointSource: { kind: 'point-group', pointGroupIds: [...current, command.pointGroupId] },
          },
        };
      }, true);
  },
};

type RemovePointGroupCommand = Extract<CadCommand, { key: 'SURFACE_REMOVE_POINT_GROUP' }>;

const surfaceRemovePointGroupCommand: CadCommandDefinition<RemovePointGroupCommand> = {
  key: 'SURFACE_REMOVE_POINT_GROUP',
  execute: (snapshot, command) =>
    editSurface(snapshot, 'SURFACE_REMOVE_POINT_GROUP', command.surfaceId, 'SURFACE_REMOVE_POINT_GROUP',
      (surface) => {
        if (surface.definition.pointSource.kind !== 'point-group') return null;
        const current = surfacePointGroupIds(surface.definition.pointSource);
        if (!current.includes(command.pointGroupId)) return null;
        return {
          ...surface,
          definition: {
            ...surface.definition,
            pointSource: {
              kind: 'point-group',
              pointGroupIds: current.filter((id) => id !== command.pointGroupId),
            },
          },
        };
      }, true),
};

type AddPointsCommand = Extract<CadCommand, { key: 'SURFACE_ADD_POINTS' }>;

const surfaceAddPointsCommand: CadCommandDefinition<AddPointsCommand> = {
  key: 'SURFACE_ADD_POINTS',
  execute: (snapshot, command) => {
    const ids = command.pointIds.filter((id) => typeof id === 'string' && id !== '');
    if (ids.length === 0) return null;
    return editSurface(snapshot, 'SURFACE_ADD_POINTS', command.surfaceId, 'SURFACE_ADD_POINTS',
      (surface) => {
        const current =
          surface.definition.pointSource.kind === 'points'
            ? surface.definition.pointSource.pointEntityIds
            : [];
        const merged = [...current];
        for (const id of ids) {
          if (!merged.includes(id)) merged.push(id);
        }
        if (merged.length === current.length) return null;
        return {
          ...surface,
          definition: { ...surface.definition, pointSource: { kind: 'points', pointEntityIds: merged } },
        };
      }, true);
  },
};

type RemoveSourceCommand = Extract<CadCommand, { key: 'SURFACE_REMOVE_SOURCE' }>;

const surfaceRemoveSourceCommand: CadCommandDefinition<RemoveSourceCommand> = {
  key: 'SURFACE_REMOVE_SOURCE',
  execute: (snapshot, command) =>
    editSurface(snapshot, 'SURFACE_REMOVE_SOURCE', command.surfaceId, 'SURFACE_REMOVE_SOURCE',
      (surface) => {
        const source = surface.definition.pointSource;
        const empty = source.kind === 'points' && source.pointEntityIds.length === 0;
        if (empty) return null;
        return {
          ...surface,
          definition: { ...surface.definition, pointSource: { kind: 'points', pointEntityIds: [] } },
        };
      }, true),
};

type AddBreaklineCommand = Extract<CadCommand, { key: 'SURFACE_ADD_BREAKLINE' }>;

const surfaceAddBreaklineCommand: CadCommandDefinition<AddBreaklineCommand> = {
  key: 'SURFACE_ADD_BREAKLINE',
  execute: (snapshot, command) => {
    const ids = command.pointIds.filter((id) => typeof id === 'string' && id !== '');
    if (ids.length === 0) return null;
    return editSurface(snapshot, 'SURFACE_ADD_BREAKLINE', command.surfaceId, 'SURFACE_ADD_BREAKLINE',
      (surface) => ({
        ...surface,
        definition: {
          ...surface.definition,
          breaklines: [
            ...(surface.definition.breaklines ?? []),
            {
              id: createStableRuntimeId('cad-breakline'),
              type: 'standard' as const,
              source: { kind: 'point-chain' as const, pointEntityIds: ids },
              ...(command.name?.trim() ? { name: command.name.trim() } : {}),
            },
          ],
        },
      }), true);
  },
};

type RemoveBreaklineCommand = Extract<CadCommand, { key: 'SURFACE_REMOVE_BREAKLINE' }>;

const surfaceRemoveBreaklineCommand: CadCommandDefinition<RemoveBreaklineCommand> = {
  key: 'SURFACE_REMOVE_BREAKLINE',
  execute: (snapshot, command) =>
    editSurface(snapshot, 'SURFACE_REMOVE_BREAKLINE', command.surfaceId, 'SURFACE_REMOVE_BREAKLINE',
      (surface) => {
        const breaklines = surface.definition.breaklines ?? [];
        if (!breaklines.some((entry) => entry.id === command.breaklineId)) return null;
        return {
          ...surface,
          definition: {
            ...surface.definition,
            breaklines: breaklines.filter((entry) => entry.id !== command.breaklineId),
          },
        };
      }, true),
};

const RING_ENTITY_TYPES = new Set(['polyline', 'polygon', 'parcel']);

type AddBoundaryCommand = Extract<CadCommand, { key: 'SURFACE_ADD_BOUNDARY' }>;

const surfaceAddBoundaryCommand: CadCommandDefinition<AddBoundaryCommand> = {
  key: 'SURFACE_ADD_BOUNDARY',
  execute: (snapshot, command) => {
    const entity = snapshot.project.entities.find((entry) => entry.id === command.sourceEntityId);
    if (!entity || !RING_ENTITY_TYPES.has(entity.type)) return null;
    return editSurface(snapshot, 'SURFACE_ADD_BOUNDARY', command.surfaceId, 'SURFACE_ADD_BOUNDARY',
      (surface) => {
        const rest = (surface.definition.boundaries ?? []).filter(
          (entry) => command.kind === 'outer' ? entry.type !== 'outer' : true,
        );
        return {
          ...surface,
          definition: {
            ...surface.definition,
            boundaries: [...rest, { type: command.kind, sourceEntityId: command.sourceEntityId }],
          },
        };
      }, true);
  },
};

type RemoveBoundaryCommand = Extract<CadCommand, { key: 'SURFACE_REMOVE_BOUNDARY' }>;

const surfaceRemoveBoundaryCommand: CadCommandDefinition<RemoveBoundaryCommand> = {
  key: 'SURFACE_REMOVE_BOUNDARY',
  execute: (snapshot, command) =>
    editSurface(snapshot, 'SURFACE_REMOVE_BOUNDARY', command.surfaceId, 'SURFACE_REMOVE_BOUNDARY',
      (surface) => {
        const boundaries = surface.definition.boundaries ?? [];
        const kept = boundaries.filter((entry) =>
          entry.type !== command.kind ||
          (command.sourceEntityId != null && entry.sourceEntityId !== command.sourceEntityId),
        );
        if (kept.length === boundaries.length) return null;
        return {
          ...surface,
          definition: { ...surface.definition, boundaries: kept },
        };
      }, true),
};

type StyleCreateCommand = Extract<CadCommand, { key: 'SURFACE_STYLE_CREATE' }>;
type StyleDuplicateCommand = Extract<CadCommand, { key: 'SURFACE_STYLE_DUPLICATE' }>;
type StyleRenameCommand = Extract<CadCommand, { key: 'SURFACE_STYLE_RENAME' }>;
type StyleUpdateCommand = Extract<CadCommand, { key: 'SURFACE_STYLE_UPDATE' }>;
type StyleDeleteCommand = Extract<CadCommand, { key: 'SURFACE_STYLE_DELETE' }>;

const surfaceStyleCreateCommand: CadCommandDefinition<StyleCreateCommand> = {
  key: 'SURFACE_STYLE_CREATE',
  execute: (snapshot, command) => {
    const styles = backfillCadSurfaceStyles(snapshot.project.surfaceStyles);
    const next = createCadSurfaceStyle(styles, command.style);
    if (!next) return null;
    return commitSurface('SURFACE_STYLE_CREATE', snapshot, { ...snapshot.project, surfaceStyles: next },
      `SURFACE_STYLE_CREATE (${command.style.name})`);
  },
};

const surfaceStyleDuplicateCommand: CadCommandDefinition<StyleDuplicateCommand> = {
  key: 'SURFACE_STYLE_DUPLICATE',
  execute: (snapshot, command) => {
    const styles = backfillCadSurfaceStyles(snapshot.project.surfaceStyles);
    const next = duplicateCadSurfaceStyle(styles, command.styleId, command.newId, command.name);
    if (!next) return null;
    return commitSurface('SURFACE_STYLE_DUPLICATE', snapshot, { ...snapshot.project, surfaceStyles: next },
      `SURFACE_STYLE_DUPLICATE (${command.name})`);
  },
};

const surfaceStyleRenameCommand: CadCommandDefinition<StyleRenameCommand> = {
  key: 'SURFACE_STYLE_RENAME',
  execute: (snapshot, command) => {
    const styles = backfillCadSurfaceStyles(snapshot.project.surfaceStyles);
    const next = renameCadSurfaceStyle(styles, command.styleId, command.name);
    if (!next) return null;
    return commitSurface('SURFACE_STYLE_RENAME', snapshot, { ...snapshot.project, surfaceStyles: next },
      `SURFACE_STYLE_RENAME (${command.name.trim()})`);
  },
};

const surfaceStyleUpdateCommand: CadCommandDefinition<StyleUpdateCommand> = {
  key: 'SURFACE_STYLE_UPDATE',
  execute: (snapshot, command) => {
    const styles = backfillCadSurfaceStyles(snapshot.project.surfaceStyles);
    const next = updateCadSurfaceStyle(styles, command.styleId, command.patch);
    if (!next) return null;
    return commitSurface('SURFACE_STYLE_UPDATE', snapshot, { ...snapshot.project, surfaceStyles: next },
      `SURFACE_STYLE_UPDATE (${command.styleId})`);
  },
};

const surfaceStyleDeleteCommand: CadCommandDefinition<StyleDeleteCommand> = {
  key: 'SURFACE_STYLE_DELETE',
  execute: (snapshot, command) => {
    const styles = backfillCadSurfaceStyles(snapshot.project.surfaceStyles);
    const result = deleteCadSurfaceStyle(styles, snapshot.project.surfaces ?? [], command.styleId, command.replacementId);
    if (!result) return null;
    return commitSurface('SURFACE_STYLE_DELETE', snapshot, {
      ...snapshot.project,
      surfaceStyles: result.styles,
      surfaces: result.surfaces,
    }, `SURFACE_STYLE_DELETE (${command.styleId})`);
  },
};

export const surfaceCommandDefinitions = {
  SURFACE_CREATE: surfaceCreateCommand,
  SURFACE_DELETE: surfaceDeleteCommand,
  SURFACE_RENAME: surfaceRenameCommand,
  SURFACE_SET_LAYER_STYLE: surfaceSetLayerStyleCommand,
  SURFACE_ADD_POINT_GROUP: surfaceAddPointGroupCommand,
  SURFACE_REMOVE_POINT_GROUP: surfaceRemovePointGroupCommand,
  SURFACE_ADD_POINTS: surfaceAddPointsCommand,
  SURFACE_REMOVE_SOURCE: surfaceRemoveSourceCommand,
  SURFACE_ADD_BREAKLINE: surfaceAddBreaklineCommand,
  SURFACE_REMOVE_BREAKLINE: surfaceRemoveBreaklineCommand,
  SURFACE_ADD_BOUNDARY: surfaceAddBoundaryCommand,
  SURFACE_REMOVE_BOUNDARY: surfaceRemoveBoundaryCommand,
  SURFACE_STYLE_CREATE: surfaceStyleCreateCommand,
  SURFACE_STYLE_DUPLICATE: surfaceStyleDuplicateCommand,
  SURFACE_STYLE_RENAME: surfaceStyleRenameCommand,
  SURFACE_STYLE_UPDATE: surfaceStyleUpdateCommand,
  SURFACE_STYLE_DELETE: surfaceStyleDeleteCommand,
};
