import type {
  CadEntity,
  CadLayerId,
  CadPointGroup,
  CadProject,
  CadSurface,
  CadSurfaceDefinition,
  CadSurveyPointEntity,
} from './cadTypes';
import { surfacePointGroupIds } from './cadTypes';

/**
 * Phase 18F persistence helpers (consume the engine-owned surface model in
 * cadTypes.ts + triangulation in cadSurfaces.ts; this file owns only the
 * persistence/transaction contract).
 *
 * Definitions persist in .wncad and are undoable. The derived mesh NEVER
 * persists — it lives only in a scoped CadSurfaceCache and is rebuilt via
 * surfaceWorker.ts. Revision is content-derived
 * (computeCadSurfaceSourceRevision); status is derived (deriveSurfaceStatus).
 */

export const cloneCadSurfaceDefinition = (definition: CadSurfaceDefinition): CadSurfaceDefinition => ({
  pointSource:
    definition.pointSource.kind === 'points'
      ? { kind: 'points', pointEntityIds: [...definition.pointSource.pointEntityIds] }
      : { kind: 'point-group', pointGroupIds: surfacePointGroupIds(definition.pointSource) },
  ...(definition.breaklines != null
    ? {
        breaklines: definition.breaklines.map((entry) => ({
          ...entry,
          source:
            entry.source.kind === 'point-chain'
              ? { kind: 'point-chain' as const, pointEntityIds: [...entry.source.pointEntityIds] }
              : { ...entry.source },
        })),
      }
    : {}),
  ...(definition.boundaries != null
    ? { boundaries: definition.boundaries.map((entry) => ({ ...entry })) }
    : {}),
  ...(definition.buildOptions != null ? { buildOptions: { ...definition.buildOptions } } : {}),
});

export const cloneCadSurface = (surface: CadSurface): CadSurface => ({
  ...surface,
  definition: cloneCadSurfaceDefinition(surface.definition),
});

export const cloneCadSurfaces = (surfaces: CadSurface[] | undefined): CadSurface[] =>
  (surfaces ?? []).map(cloneCadSurface);

/**
 * Load-time backfill: legacy drawings (field absent) open with no surfaces;
 * legacy single-group sources ({ pointGroupId }) migrate to the one-element
 * canonical list. Additive — no schema bump.
 */
export const backfillCadSurfaces = (surfaces: CadSurface[] | undefined): CadSurface[] =>
  cloneCadSurfaces(surfaces);

/**
 * Reopen normalization: meshes never persist, so a stored cachedRevision can
 * never be trusted — definitions reload with no cached revision (derived
 * UNBUILT, never false CURRENT) and no stale diagnostic.
 */
export const clearSurfaceBuildCacheOnLoad = (surface: CadSurface): CadSurface => ({
  ...surface,
  definition: cloneCadSurfaceDefinition(surface.definition),
  cachedRevision: null,
  buildDiagnostic: undefined,
});

/**
 * 18C visibility contract for surfaces: layer OFF/FROZEN hides display
 * without a rebuild. Absent/unknown layer stays visible (same fail-open as
 * resolveCadEntityAppearance). Pure inspection — never mutates, never builds.
 */
export const isSurfaceDisplayVisible = (
  project: { layers: Array<{ id: string; visible: boolean; frozen?: boolean }> },
  surface: Pick<CadSurface, 'layerId'>,
): boolean => {
  if (surface.layerId == null) return true;
  const layer = project.layers.find((entry) => entry.id === surface.layerId);
  if (!layer) return true;
  return layer.visible && layer.frozen !== true;
};

/** Destructive surface edits are blocked when the surface layer is locked. */
export const isSurfaceLayerLocked = (
  project: { layers: Array<{ id: string; locked: boolean }> },
  surface: Pick<CadSurface, 'layerId'>,
): boolean => {
  if (surface.layerId == null) return false;
  return project.layers.find((entry) => entry.id === surface.layerId)?.locked === true;
};

/** Resolve the display/lock layer for a new or moved surface. */
export const resolveSurfaceLayerId = (
  project: Pick<CadProject, 'layers' | 'currentLayerId'>,
  layerId?: CadLayerId,
): CadLayerId => {
  if (layerId != null && project.layers.some((entry) => entry.id === layerId)) return layerId;
  if (project.currentLayerId != null && project.layers.some((entry) => entry.id === project.currentLayerId)) {
    return project.currentLayerId;
  }
  return 'general';
};

// ---------------------------------------------------------------------------
// Worker request (serialization-friendly; no React types, no whole project)
// ---------------------------------------------------------------------------

/** Compact survey-point snapshot; carries every field group matching reads. */
export interface SurfacePointSnapshot {
  id: string;
  stationId: string;
  x: number;
  y: number;
  z?: number | null;
  pointClass?: 'control' | 'free' | 'unknown';
  source?: 'adjustment-result' | 'parsed-input';
  layerId?: string;
  description?: string;
  featureCode?: string;
}

export interface SurfaceBuildRequest {
  surfaceId: string;
  /** Opaque content revision (srev1:...) the result must still match. */
  revision: string;
  /** All survey-point entities (compact); worker rebuilds lookup indexes. */
  points: SurfacePointSnapshot[];
  /** Referenced breakline/boundary entities only (full entity objects). */
  extraEntities: CadEntity[];
  /** Referenced point groups (union source); legacy single-group loads backfill to one element. */
  pointGroups?: CadPointGroup[];
  /** Legacy single-group snapshot (superseded by pointGroups; read-only compat). */
  pointGroup?: CadPointGroup;
  definition: CadSurfaceDefinition;
}

const surveyPointsOf = (project: CadProject): CadSurveyPointEntity[] =>
  project.entities.filter((entity): entity is CadSurveyPointEntity => entity.type === 'survey-point');

/**
 * Collect the minimal snapshot a worker needs to reproduce the engine build
 * exactly: every survey point (station-id fallback + group evaluation read
 * the whole set), the referenced point groups, and the referenced
 * breakline/boundary entities. Pure; broken refs flow through (the engine
 * derives BROKEN_REFERENCE deterministically on both sides).
 */
export const buildSurfaceBuildRequest = (
  project: CadProject,
  surfaceId: string,
  revision: string,
): SurfaceBuildRequest | null => {
  const surface = (project.surfaces ?? []).find((entry) => entry.id === surfaceId);
  if (!surface) return null;
  const wanted = new Set<string>();
  for (const breakline of surface.definition.breaklines ?? []) {
    if (breakline.source.kind === 'entity') wanted.add(breakline.source.entityId);
  }
  for (const boundary of surface.definition.boundaries ?? []) {
    wanted.add(boundary.sourceEntityId);
  }
  const wantedIds = wanted;
  const pointSource = surface.definition.pointSource;
  const groupIds =
    pointSource.kind === 'point-group' ? [...new Set(surfacePointGroupIds(pointSource))].sort() : [];
  const byGroupId = new Map((project.pointGroups ?? []).map((entry) => [entry.id, entry]));
  return {
    surfaceId: surface.id,
    revision,
    points: surveyPointsOf(project).map((point) => ({
      id: point.id,
      stationId: point.stationId,
      x: point.x,
      y: point.y,
      z: point.z ?? null,
      pointClass: point.pointClass,
      source: point.source,
      layerId: point.layerId,
      ...(point.description != null ? { description: point.description } : {}),
      ...(point.featureCode != null ? { featureCode: point.featureCode } : {}),
    })),
    extraEntities: project.entities.filter((entity) => wantedIds.has(entity.id)),
    pointGroups: groupIds.map((id) => byGroupId.get(id)).filter((entry) => entry != null),
    definition: cloneCadSurfaceDefinition(surface.definition),
  };
};
