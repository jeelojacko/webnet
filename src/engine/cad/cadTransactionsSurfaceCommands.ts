import { createStableRuntimeId } from '../id';
import { breaklineChainSelfIntersects, validateBreaklineChainRefs } from './cadBreaklineChainValidation';
import { canonicalizeBulkVertexRefs } from './cadSurfaceEditBulk';
import { breaklineEntityRefs, collectSources } from './cadSurfaceRevision';
import { isImportedTinDefinition } from './cadTypes';
import { surfacePointGroupIds } from './cadTypes';
import { backfillCadSurfaceStyles, createCadSurfaceStyle, deleteCadSurfaceStyle, duplicateCadSurfaceStyle, renameCadSurfaceStyle, updateCadSurfaceStyle } from './cadSurfaceStyles';
import { isSurfaceLayerLocked, resolveSurfaceLayerId } from './cadSurfaceTypes';
import { commitLayerProject } from './cadTransactionsLayerCommands';
import { surfaceBoundaryCommandDefinitions } from './cadTransactionsSurfaceBoundaryCommands';
import type {
  CadCommand,
  CadCommandDefinition,
  CadCommandExecutionResult,
  CadWorkspaceSnapshot,
} from './cadTransactions.types';
import type {
  CadProject,
  CadSurface,
  CadSurfaceBreakline,
  CadSurfaceEdit,
  CadSurveyPointEntity,
} from './cadTypes';
import { breaklinesCross, computeCadSurfaceSourceRevision } from './cadSurfaces';

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

export const commitSurface = (
  key: CadCommand['key'],
  snapshot: CadWorkspaceSnapshot,
  nextProject: CadProject,
  label: string,
): CadCommandExecutionResult =>
  commitLayerProject(key, snapshot, nextProject, label);

/**
 * Native source-definition mutations: rejected on imported-TIN definitions
 * (their topology is the stored payload, never entity refs). 18S/T/V
 * final-mesh edits (SURFACE_*_EDIT) stay allowed — they are not listed here.
 */
const NATIVE_SOURCE_MUTATION_KEYS: ReadonlySet<CadCommand['key']> = new Set([
  'SURFACE_ADD_POINT_GROUP',
  'SURFACE_REMOVE_POINT_GROUP',
  'SURFACE_ADD_POINTS',
  'SURFACE_REMOVE_SOURCE',
  'SURFACE_ADD_BREAKLINE',
  'SURFACE_REMOVE_BREAKLINE',
  'SURFACE_RENAME_BREAKLINE',
  'SURFACE_BREAKLINE_INSERT_POINT',
  'SURFACE_BREAKLINE_REMOVE_POINT',
  'SURFACE_BREAKLINE_REVERSE',
  'SURFACE_BREAKLINE_REPLACE_CHAIN',
  'SURFACE_BREAKLINE_CONVERT_TO_POINT_CHAIN',
  'SURFACE_ADD_BOUNDARY',
  'SURFACE_REMOVE_BOUNDARY',
]);

/** Geometry edits clear the cached build; renames/binding leave it. */
export const editSurface = (
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
  if (isImportedTinDefinition(surface.definition) && NATIVE_SOURCE_MUTATION_KEYS.has(key)) {
    return null;
  }
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

// ---------------------------------------------------------------------------
// Phase 18W: breakline source-definition transactions (point-chain edits)
// ---------------------------------------------------------------------------

/** Resolve chain refs exactly as source collection does (entity id, then station id). */
const resolveChainCoords = (
  project: CadProject,
  refs: readonly string[],
): Array<{ x: number; y: number; z: number }> | null => {
  const byEntityId = new Map<string, CadSurveyPointEntity>();
  for (const entity of project.entities) {
    if (entity.type === 'survey-point') byEntityId.set(entity.id, entity);
  }
  const byStationId = new Map<string, CadSurveyPointEntity>();
  for (const id of [...byEntityId.keys()].sort()) {
    const point = byEntityId.get(id)!;
    if (!byStationId.has(point.stationId)) byStationId.set(point.stationId, point);
  }
  const coords: Array<{ x: number; y: number; z: number }> = [];
  for (const ref of refs) {
    const point = byEntityId.get(ref) ?? byStationId.get(ref);
    if (
      !point || !Number.isFinite(point.x) || !Number.isFinite(point.y) ||
      !Number.isFinite(point.z)
    ) {
      return null;
    }
    coords.push({ x: point.x, y: point.y, z: point.z as number });
  }
  return coords;
};

/** Ref validity + finite-Z resolution + self-intersection (fail closed). */
const resolveValidChain = (
  project: CadProject,
  ids: readonly string[],
): Array<{ x: number; y: number; z: number }> | null => {
  if (validateBreaklineChainRefs(ids) != null) return null;
  const coords = resolveChainCoords(project, ids);
  if (!coords || breaklineChainSelfIntersects(coords)) return null;
  return coords;
};

/** Candidate preflight mirroring the engine contract: full collection + breaklinesCross gate. */
const preflightBreaklineChains = (
  project: CadProject,
  surface: CadSurface,
  breaklines: CadSurfaceBreakline[],
): boolean => {
  const collected = collectSources(project, {
    ...surface,
    definition: { ...surface.definition, breaklines },
  });
  if (collected.breaklineError || collected.boundaryError || collected.duplicateConflict) {
    return false;
  }
  if (collected.brokenRefs.length > 0) return false;
  const ordered = [...collected.points].sort((a, b) =>
    a.x !== b.x ? a.x - b.x : a.y !== b.y ? a.y - b.y : a.z !== b.z ? a.z - b.z
      : a.entityId < b.entityId ? -1 : 1);
  const localIndex = new Map(ordered.map((point, index) => [point.entityId, index]));
  const segments: Array<{ a: number; b: number }> = [];
  for (const chain of collected.breaklines) {
    const remapped: number[] = [];
    for (const worldIndex of chain) {
      const at = localIndex.get(collected.points[worldIndex]!.entityId);
      if (at === undefined) return false;
      if (remapped[remapped.length - 1] !== at) remapped.push(at);
    }
    for (let i = 0; i + 1 < remapped.length; i += 1) {
      segments.push({ a: remapped[i]!, b: remapped[i + 1]! });
    }
  }
  return !breaklinesCross(ordered, segments);
};

const withPointChain = (
  breaklines: CadSurfaceBreakline[],
  breaklineId: string,
  pointEntityIds: string[],
): CadSurfaceBreakline[] | null => {
  if (!breaklines.some((entry) => entry.id === breaklineId)) return null;
  return breaklines.map((entry) =>
    entry.id !== breaklineId ? entry : {
      ...entry,
      source: { kind: 'point-chain' as const, pointEntityIds },
    });
};

type RenameBreaklineCommand = Extract<CadCommand, { key: 'SURFACE_RENAME_BREAKLINE' }>;

const surfaceRenameBreaklineCommand: CadCommandDefinition<RenameBreaklineCommand> = {
  key: 'SURFACE_RENAME_BREAKLINE',
  execute: (snapshot, command) =>
    editSurface(snapshot, 'SURFACE_RENAME_BREAKLINE', command.surfaceId, 'SURFACE_RENAME_BREAKLINE',
      (surface) => {
        const breaklines = surface.definition.breaklines ?? [];
        if (!breaklines.some((entry) => entry.id === command.breaklineId)) return null;
        // Display-only: names are excluded from the source revision by
        // construction, so geometry=false never stales the surface.
        const name = command.name?.trim() ?? '';
        return {
          ...surface,
          definition: {
            ...surface.definition,
            breaklines: breaklines.map((entry) => {
              if (entry.id !== command.breaklineId) return entry;
              if (!name) {
                const { name: _dropped, ...rest } = entry;
                return rest;
              }
              return { ...entry, name };
            }),
          },
        };
      }, false),
};

type InsertBreaklinePointCommand = Extract<CadCommand, { key: 'SURFACE_BREAKLINE_INSERT_POINT' }>;

const surfaceBreaklineInsertPointCommand: CadCommandDefinition<InsertBreaklinePointCommand> = {
  key: 'SURFACE_BREAKLINE_INSERT_POINT',
  execute: (snapshot, command) =>
    editSurface(snapshot, 'SURFACE_BREAKLINE_INSERT_POINT', command.surfaceId,
      'SURFACE_BREAKLINE_INSERT_POINT', (surface) => {
        const breaklines = surface.definition.breaklines ?? [];
        const current = breaklines.find((entry) => entry.id === command.breaklineId);
        if (!current || current.source.kind !== 'point-chain') return null;
        if (!Number.isFinite(command.insertIndex)) return null;
        if (!resolveChainCoords(snapshot.project, [command.pointEntityId])) return null;
        const ids = [...current.source.pointEntityIds];
        const at = Math.min(Math.max(Math.floor(command.insertIndex), 0), ids.length);
        ids.splice(at, 0, command.pointEntityId);
        if (!resolveValidChain(snapshot.project, ids)) return null;
        const next = withPointChain(breaklines, command.breaklineId, ids);
        if (!next || !preflightBreaklineChains(snapshot.project, surface, next)) return null;
        return { ...surface, definition: { ...surface.definition, breaklines: next } };
      }, true),
};

type RemoveBreaklinePointCommand = Extract<CadCommand, { key: 'SURFACE_BREAKLINE_REMOVE_POINT' }>;

const surfaceBreaklineRemovePointCommand: CadCommandDefinition<RemoveBreaklinePointCommand> = {
  key: 'SURFACE_BREAKLINE_REMOVE_POINT',
  execute: (snapshot, command) =>
    editSurface(snapshot, 'SURFACE_BREAKLINE_REMOVE_POINT', command.surfaceId,
      'SURFACE_BREAKLINE_REMOVE_POINT', (surface) => {
        const breaklines = surface.definition.breaklines ?? [];
        const current = breaklines.find((entry) => entry.id === command.breaklineId);
        if (!current || current.source.kind !== 'point-chain') return null;
        const ids = [...current.source.pointEntityIds];
        let at = -1;
        if (command.index != null) {
          if (!Number.isInteger(command.index)) return null;
          at = command.index;
        } else if (command.pointEntityId != null) {
          at = ids.indexOf(command.pointEntityId);
        } else {
          return null;
        }
        if (at < 0 || at >= ids.length) return null;
        ids.splice(at, 1);
        // No auto-delete: a sub-2 remainder blocks instead of removing the breakline.
        if (ids.length < 2) return null;
        const next = withPointChain(breaklines, command.breaklineId, ids);
        if (!next) return null;
        return { ...surface, definition: { ...surface.definition, breaklines: next } };
      }, true),
};

type ReverseBreaklineCommand = Extract<CadCommand, { key: 'SURFACE_BREAKLINE_REVERSE' }>;

const surfaceBreaklineReverseCommand: CadCommandDefinition<ReverseBreaklineCommand> = {
  key: 'SURFACE_BREAKLINE_REVERSE',
  execute: (snapshot, command) =>
    editSurface(snapshot, 'SURFACE_BREAKLINE_REVERSE', command.surfaceId, 'SURFACE_BREAKLINE_REVERSE',
      (surface) => {
        const breaklines = surface.definition.breaklines ?? [];
        const current = breaklines.find((entry) => entry.id === command.breaklineId);
        if (!current || current.source.kind !== 'point-chain') return null;
        // Same segments reversed: geometry equivalent, revision changes by construction.
        const next = withPointChain(breaklines, command.breaklineId, [...current.source.pointEntityIds].reverse());
        if (!next) return null;
        return { ...surface, definition: { ...surface.definition, breaklines: next } };
      }, true),
};

type ReplaceBreaklineChainCommand = Extract<CadCommand, { key: 'SURFACE_BREAKLINE_REPLACE_CHAIN' }>;

const surfaceBreaklineReplaceChainCommand: CadCommandDefinition<ReplaceBreaklineChainCommand> = {
  key: 'SURFACE_BREAKLINE_REPLACE_CHAIN',
  execute: (snapshot, command) =>
    editSurface(snapshot, 'SURFACE_BREAKLINE_REPLACE_CHAIN', command.surfaceId,
      'SURFACE_BREAKLINE_REPLACE_CHAIN', (surface) => {
        const breaklines = surface.definition.breaklines ?? [];
        if (!breaklines.some((entry) => entry.id === command.breaklineId)) return null;
        const ids = [...command.pointEntityIds];
        if (!resolveValidChain(snapshot.project, ids)) return null;
        // Id/name/type preserved via spread; the source becomes a point chain.
        const next = withPointChain(breaklines, command.breaklineId, ids);
        if (!next || !preflightBreaklineChains(snapshot.project, surface, next)) return null;
        return { ...surface, definition: { ...surface.definition, breaklines: next } };
      }, true),
};

type ConvertBreaklineCommand = Extract<CadCommand, { key: 'SURFACE_BREAKLINE_CONVERT_TO_POINT_CHAIN' }>;

const surfaceBreaklineConvertCommand: CadCommandDefinition<ConvertBreaklineCommand> = {
  key: 'SURFACE_BREAKLINE_CONVERT_TO_POINT_CHAIN',
  execute: (snapshot, command) =>
    editSurface(snapshot, 'SURFACE_BREAKLINE_CONVERT_TO_POINT_CHAIN', command.surfaceId,
      'SURFACE_BREAKLINE_CONVERT_TO_POINT_CHAIN', (surface) => {
        const breaklines = surface.definition.breaklines ?? [];
        const current = breaklines.find((entry) => entry.id === command.breaklineId);
        const source = current?.source;
        if (!current || !source || source.kind !== 'entity') return null;
        const entity = snapshot.project.entities.find((entry) => entry.id === source.entityId);
        if (!entity) return null;
        // Deterministic refs only (same resolution as collection); the CAD entity is untouched.
        const refs = breaklineEntityRefs(entity);
        const collapsed = refs.filter((ref, index) => index === 0 || ref !== refs[index - 1]);
        if (!resolveValidChain(snapshot.project, collapsed)) return null;
        const next = withPointChain(breaklines, command.breaklineId, collapsed);
        if (!next || !preflightBreaklineChains(snapshot.project, surface, next)) return null;
        return { ...surface, definition: { ...surface.definition, breaklines: next } };
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

type AddEditCommand = Extract<CadCommand, { key: 'SURFACE_ADD_EDIT' }>;
type DeleteEditCommand = Extract<CadCommand, { key: 'SURFACE_DELETE_EDIT' }>;
type MoveEditCommand = Extract<CadCommand, { key: 'SURFACE_MOVE_EDIT' }>;
type SetEditEnabledCommand = Extract<CadCommand, { key: 'SURFACE_SET_EDIT_ENABLED' }>;

/** Stale-pick rejection: the caller must re-pick against the fresh revision. */
export const SURFACE_EDIT_STALE_REVISION = 'SURFACE_EDIT_STALE_REVISION';

export const checkSurfaceEditRevision = (
  project: CadProject,
  surfaceId: string,
  expectedRevision: string,
): 'ok' | 'SURFACE_NOT_FOUND' | typeof SURFACE_EDIT_STALE_REVISION => {
  // Volume surfaces live in volumeSurfaces (separate array): their ids
  // never resolve here, so no edit op can target a volume surface.
  const surface = (project.surfaces ?? []).find((entry) => entry.id === surfaceId);
  if (!surface) return 'SURFACE_NOT_FOUND';
  return computeCadSurfaceSourceRevision(project, surface) === expectedRevision
    ? 'ok'
    : SURFACE_EDIT_STALE_REVISION;
};

const validEditRef = (ref: unknown): ref is { key: string } =>
  typeof ref === 'object' && ref != null && typeof (ref as { key: unknown }).key === 'string' &&
  (ref as { key: string }).key.length > 0;

const finiteNum = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** Validate an id-less edit draft; null = reject (fail-closed, never partial). */
const buildSurfaceEdit = (id: string, draft: AddEditCommand['edit']): CadSurfaceEdit | null => {
  if (draft.kind === 'swap-edge' || draft.kind === 'delete-line') {
    if (!validEditRef(draft.edge?.a) || !validEditRef(draft.edge?.b)) return null;
    return {
      id,
      kind: draft.kind,
      ...(draft.enabled === false ? { enabled: false as const } : {}),
      edge: { a: { key: draft.edge.a.key }, b: { key: draft.edge.b.key } },
    };
  }
  if (draft.kind === 'add-line') {
    if (!validEditRef(draft.from) || !validEditRef(draft.to)) return null;
    return {
      id,
      kind: 'add-line',
      ...(draft.enabled === false ? { enabled: false as const } : {}),
      from: { key: draft.from.key },
      to: { key: draft.to.key },
    };
  }
  if (draft.kind === 'add-point') {
    if (!finiteNum(draft.x) || !finiteNum(draft.y) || !finiteNum(draft.z)) return null;
    return {
      id,
      kind: 'add-point',
      ...(draft.enabled === false ? { enabled: false as const } : {}),
      x: draft.x,
      y: draft.y,
      z: draft.z,
    };
  }
  if (draft.kind === 'delete-point') {
    if (!validEditRef(draft.vertex)) return null;
    return {
      id,
      kind: 'delete-point' as const,
      ...(draft.enabled === false ? { enabled: false as const } : {}),
      vertex: { key: draft.vertex.key },
    };
  }
  if (draft.kind === 'set-elevation') {
    if (!validEditRef(draft.vertex) || !finiteNum(draft.z)) return null;
    return {
      id,
      kind: 'set-elevation' as const,
      ...(draft.enabled === false ? { enabled: false as const } : {}),
      vertex: { key: draft.vertex.key },
      z: draft.z,
    };
  }
  if (draft.kind === 'move-point') {
    if (!validEditRef(draft.vertex) || !finiteNum(draft.x) || !finiteNum(draft.y)) return null;
    return {
      id,
      kind: 'move-point',
      ...(draft.enabled === false ? { enabled: false as const } : {}),
      vertex: { key: draft.vertex.key },
      x: draft.x,
      y: draft.y,
    };
  }
  if (draft.kind === 'raise-lower-surface') {
    if (!finiteNum(draft.deltaZ)) return null;
    return {
      id,
      kind: 'raise-lower-surface',
      ...(draft.enabled === false ? { enabled: false as const } : {}),
      deltaZ: draft.deltaZ,
    };
  }
  if (draft.kind === 'set-elevation-many') {
    if (!finiteNum(draft.z)) return null;
    const incoming: unknown = draft.vertices;
    if (!Array.isArray(incoming) || incoming.length === 0) return null;
    const raw = incoming.filter(validEditRef);
    if (raw.length !== incoming.length) return null;
    return {
      id,
      kind: 'set-elevation-many' as const,
      ...(draft.enabled === false ? { enabled: false as const } : {}),
      vertices: canonicalizeBulkVertexRefs(raw),
      z: draft.z,
    };
  }
  if (draft.kind === 'raise-lower-points') {
    if (!finiteNum(draft.deltaZ)) return null;
    const incoming: unknown = draft.vertices;
    if (!Array.isArray(incoming) || incoming.length === 0) return null;
    const raw = incoming.filter(validEditRef);
    if (raw.length !== incoming.length) return null;
    return {
      id,
      kind: 'raise-lower-points' as const,
      ...(draft.enabled === false ? { enabled: false as const } : {}),
      vertices: canonicalizeBulkVertexRefs(raw),
      deltaZ: draft.deltaZ,
    };
  }
  if (draft.kind === 'move-points') {
    if (!finiteNum(draft.deltaX) || !finiteNum(draft.deltaY)) return null;
    const incoming: unknown = draft.vertices;
    if (!Array.isArray(incoming) || incoming.length === 0) return null;
    const raw = incoming.filter(validEditRef);
    if (raw.length !== incoming.length) return null;
    return {
      id,
      kind: 'move-points' as const,
      ...(draft.enabled === false ? { enabled: false as const } : {}),
      vertices: canonicalizeBulkVertexRefs(raw),
      deltaX: draft.deltaX,
      deltaY: draft.deltaY,
    };
  }
  return null;
};

const surfaceAddEditCommand: CadCommandDefinition<AddEditCommand> = {
  key: 'SURFACE_ADD_EDIT',
  execute: (snapshot, command) => {
    if (checkSurfaceEditRevision(snapshot.project, command.surfaceId, command.expectedRevision) !== 'ok') {
      return null;
    }
    const edit = buildSurfaceEdit(createStableRuntimeId('cad-surface-edit'), command.edit);
    if (!edit) return null;
    return editSurface(snapshot, 'SURFACE_ADD_EDIT', command.surfaceId, `SURFACE_ADD_EDIT (${edit.kind})`,
      (surface) => ({
        ...surface,
        definition: { ...surface.definition, edits: [...(surface.definition.edits ?? []), edit] },
      }), true);
  },
};

const surfaceDeleteEditCommand: CadCommandDefinition<DeleteEditCommand> = {
  key: 'SURFACE_DELETE_EDIT',
  execute: (snapshot, command) => {
    if (checkSurfaceEditRevision(snapshot.project, command.surfaceId, command.expectedRevision) !== 'ok') {
      return null;
    }
    return editSurface(snapshot, 'SURFACE_DELETE_EDIT', command.surfaceId, 'SURFACE_DELETE_EDIT',
      (surface) => {
        const edits = surface.definition.edits ?? [];
        if (!edits.some((entry) => entry.id === command.editId)) return null;
        return {
          ...surface,
          definition: { ...surface.definition, edits: edits.filter((entry) => entry.id !== command.editId) },
        };
      }, true);
  },
};

const surfaceMoveEditCommand: CadCommandDefinition<MoveEditCommand> = {
  key: 'SURFACE_MOVE_EDIT',
  execute: (snapshot, command) => {
    if (checkSurfaceEditRevision(snapshot.project, command.surfaceId, command.expectedRevision) !== 'ok') {
      return null;
    }
    return editSurface(snapshot, 'SURFACE_MOVE_EDIT', command.surfaceId, 'SURFACE_MOVE_EDIT',
      (surface) => {
        const edits = [...(surface.definition.edits ?? [])];
        const at = edits.findIndex((entry) => entry.id === command.editId);
        const to = command.direction === 'up' ? at - 1 : at + 1;
        if (at < 0 || to < 0 || to >= edits.length) return null;
        [edits[at], edits[to]] = [edits[to]!, edits[at]!];
        return { ...surface, definition: { ...surface.definition, edits } };
      }, true);
  },
};

const surfaceSetEditEnabledCommand: CadCommandDefinition<SetEditEnabledCommand> = {
  key: 'SURFACE_SET_EDIT_ENABLED',
  execute: (snapshot, command) => {
    if (checkSurfaceEditRevision(snapshot.project, command.surfaceId, command.expectedRevision) !== 'ok') {
      return null;
    }
    return editSurface(snapshot, 'SURFACE_SET_EDIT_ENABLED', command.surfaceId, 'SURFACE_SET_EDIT_ENABLED',
      (surface) => {
        const edits = surface.definition.edits ?? [];
        const at = edits.findIndex((entry) => entry.id === command.editId);
        if (at < 0) return null;
        const current = edits[at]!;
        // Canonical: enabled:true is the absent field (matches fresh ADD truth).
        const next = command.enabled
          ? (({ enabled: _drop, ...rest }) => rest)(current)
          : { ...current, enabled: false as const };
        if ((current.enabled ?? true) === command.enabled) return null;
        const copy = [...edits];
        copy[at] = next as CadSurfaceEdit;
        return { ...surface, definition: { ...surface.definition, edits: copy } };
      }, true);
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
  SURFACE_RENAME_BREAKLINE: surfaceRenameBreaklineCommand,
  SURFACE_BREAKLINE_INSERT_POINT: surfaceBreaklineInsertPointCommand,
  SURFACE_BREAKLINE_REMOVE_POINT: surfaceBreaklineRemovePointCommand,
  SURFACE_BREAKLINE_REVERSE: surfaceBreaklineReverseCommand,
  SURFACE_BREAKLINE_REPLACE_CHAIN: surfaceBreaklineReplaceChainCommand,
  SURFACE_BREAKLINE_CONVERT_TO_POINT_CHAIN: surfaceBreaklineConvertCommand,
  ...surfaceBoundaryCommandDefinitions,
  SURFACE_ADD_EDIT: surfaceAddEditCommand,
  SURFACE_DELETE_EDIT: surfaceDeleteEditCommand,
  SURFACE_MOVE_EDIT: surfaceMoveEditCommand,
  SURFACE_SET_EDIT_ENABLED: surfaceSetEditEnabledCommand,
  SURFACE_STYLE_CREATE: surfaceStyleCreateCommand,
  SURFACE_STYLE_DUPLICATE: surfaceStyleDuplicateCommand,
  SURFACE_STYLE_RENAME: surfaceStyleRenameCommand,
  SURFACE_STYLE_UPDATE: surfaceStyleUpdateCommand,
  SURFACE_STYLE_DELETE: surfaceStyleDeleteCommand,
};
