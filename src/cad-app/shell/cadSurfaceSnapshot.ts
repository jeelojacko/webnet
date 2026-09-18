import type { CachedSurfaceMesh, CadSurfaceCache } from '../../engine/cad/cadSurfaceCache';
import {
  queryMeshElevation,
  resolveSurfaceDisplayStatus,
  resolveSurfaceLayerId,
  surfaceContentRevision,
  type SurfaceStatusText,
} from '../../engine/cad/cadSurfaceView';
import { backfillCadSurfaceStyles } from '../../engine/cad/cadSurfaceStyles';
import { surfacePointGroupIds } from '../../engine/cad/cadTypes';
import type { CadProject, CadSurfaceStatus } from '../../engine/cad/cadTypes';

/**
 * Phase 18F UI — surface snapshot for Toolspace/Properties/manager.
 *
 * Dumb-renderer support: every row is derived from the drawing once per
 * publish (definition counts, display status, cached stats). Mutations
 * travel as real SURFACE_* CadCommands through the existing
 * `runSurveyCommand` undo path; the executor returns false when it rejects
 * (bad id, locked layer, duplicate name) and `trySurfaceCommand` converts
 * a missing-registry throw into false so the manager disables honestly.
 */

export interface CadSurfaceDefinitionSummary {
  pointSourceKind: 'point-group' | 'points';
  pointGroupId: string | null;
  pointGroupName: string | null;
  /** All attached groups in definition order (multi-group, phase 18F fix-up). */
  pointGroupIds: string[];
  pointGroupNames: string[];
  pointIds: string[];
  breaklines: Array<{ id: string; name: string; kind: string }>;
  boundaries: Array<{ kind: 'outer' | 'void'; sourceEntityId: string; sourceLabel: string }>;
  pointCount: number;
  breaklineCount: number;
  outerBoundaryCount: number;
  voidBoundaryCount: number;
  maxEdgeLength: number | null;
}

export interface CadSurfaceStatsSummary {
  points: number;
  vertices: number;
  triangles: number;
  minZ: number | null;
  maxZ: number | null;
  area: number;
  skippedMissingZ: number;
  stale: boolean;
}

export interface CadSurfaceRow {
  id: string;
  name: string;
  layerId: string;
  layerName: string;
  layerLocked: boolean;
  styleId: string | null;
  styleName: string;
  status: CadSurfaceStatus;
  statusText: SurfaceStatusText;
  stale: boolean;
  revision: string;
  cachedRevision: string | null;
  diagnostic: string | null;
  stats: CadSurfaceStatsSummary | null;
  definition: CadSurfaceDefinitionSummary;
  brokenIds: string[];
  brokenNames: string[];
}

export interface CadSurfaceInquiry {
  surfaceId: string;
  surfaceName: string;
  x: number;
  y: number;
  text: string;
}

export interface CadSurfaceSnapshot {
  surfaces: CadSurfaceRow[];
  selectedSurfaceId: string | null;
  styles: Array<{ id: string; name: string }>;
  lastInquiry: CadSurfaceInquiry | null;
}

/** Missing-registry guard: false when the executor rejects or is absent. */
export const trySurfaceCommand = (
  runSurveyCommand: ((_command: import('../../engine/cad/cadTransactions.types').CadCommand) => boolean) | undefined,
  command: import('../../engine/cad/cadTransactions.types').CadCommand,
): boolean => {
  if (!runSurveyCommand) return false;
  try {
    return runSurveyCommand(command);
  } catch {
    return false;
  }
};

/**
 * Format an elevation answer for display + the command/history seam.
 * `freshMesh` null = no current mesh (unbuilt or stale): honest
 * needs-rebuild text instead of a stale number.
 */
export const formatSurfaceElevationAnswer = (
  surfaceName: string,
  x: number,
  y: number,
  elevation: number | null,
  hasFreshMesh: boolean,
): string => {
  if (!hasFreshMesh) {
    return `“${surfaceName}” has no current mesh — rebuild before querying elevation.`;
  }
  return elevation == null
    ? `No surface elevation at point (${x.toFixed(3)}, ${y.toFixed(3)}) on “${surfaceName}”.`
    : `“${surfaceName}” E ${x.toFixed(3)} N ${y.toFixed(3)} elevation ${elevation.toFixed(3)}.`;
};

export const querySurfaceElevationText = (
  project: CadProject,
  cache: CadSurfaceCache,
  surfaceId: string,
  x: number,
  y: number,
): string | null => {
  const surface = (project.surfaces ?? []).find((entry) => entry.id === surfaceId);
  if (!surface) return null;
  const mesh = cache.get(surfaceId, surfaceContentRevision(project, surface));
  if (!mesh) return formatSurfaceElevationAnswer(surface.name, x, y, null, false);
  return formatSurfaceElevationAnswer(surface.name, x, y, queryMeshElevation(mesh, x, y), true);
};

const meshStats = (mesh: CachedSurfaceMesh, stale: boolean): CadSurfaceStatsSummary => ({
  points: mesh.stats.usedPointCount,
  vertices: mesh.points.length,
  triangles: mesh.stats.triangleCount,
  minZ: mesh.stats.minZ,
  maxZ: mesh.stats.maxZ,
  area: mesh.stats.planimetricArea,
  skippedMissingZ: mesh.stats.skippedMissingZCount,
  stale,
});

export const buildCadSurfaceSnapshot = (
  project: CadProject,
  cache: CadSurfaceCache | null,
  selectedSurfaceId: string | null,
  options?: {
    revisionIndex?: ReadonlyMap<string, readonly string[]>;
    lastInquiry?: CadSurfaceInquiry | null;
  },
): CadSurfaceSnapshot => {
  const layers = new Map(project.layers.map((layer) => [layer.id, layer]));
  const styles = new Map(backfillCadSurfaceStyles(project.surfaceStyles).map((style) => [style.id, style.name]));
  const entityLabels = new Map(
    project.entities.map((entity) => [entity.id, entity.type] as const),
  );
  const groupNames = new Map((project.pointGroups ?? []).map((group) => [group.id, group.name]));
  const revisionIndex = options?.revisionIndex;
  const surfaces: CadSurfaceRow[] = (project.surfaces ?? []).map((surface) => {
    const revision = surfaceContentRevision(project, surface);
    const fresh = cache?.get(surface.id, revision) ?? undefined;
    let mesh = fresh ?? undefined;
    let meshStale = false;
    if (!mesh && cache) {
      const built = revisionIndex?.get(surface.id) ?? [];
      for (let index = built.length - 1; index >= 0; index -= 1) {
        const candidate = cache.get(surface.id, built[index]!);
        if (candidate) {
          mesh = candidate;
          meshStale = true;
          break;
        }
      }
    }
    const displayStatus = resolveSurfaceDisplayStatus(project, surface, fresh != null, meshStale);
    const stale = meshStale || displayStatus.stale;
    const layerId = resolveSurfaceLayerId(surface, project);
    const layer = layers.get(layerId);
    const source = surface.definition.pointSource;
    const attachedIds = surfacePointGroupIds(source);
    const attachedNames = attachedIds.map((id) => groupNames.get(id) ?? id);
    const boundaries = (surface.definition.boundaries ?? []).map((entry) => ({
      kind: entry.type,
      sourceEntityId: entry.sourceEntityId,
      sourceLabel: entityLabels.get(entry.sourceEntityId) ?? entry.sourceEntityId,
    }));
    return {
      id: surface.id,
      name: surface.name,
      layerId,
      layerName: layer?.name ?? layerId,
      layerLocked: layer?.locked === true,
      styleId: surface.styleId ?? null,
      styleName: (surface.styleId != null ? styles.get(surface.styleId) : undefined) ?? 'Default',
      status: displayStatus.status,
      statusText: displayStatus.statusText,
      stale,
      revision,
      cachedRevision: surface.cachedRevision ?? null,
      diagnostic: surface.buildDiagnostic ?? null,
      stats: mesh ? meshStats(mesh, stale) : null,
      definition: {
        pointSourceKind: source.kind,
        pointGroupId: source.kind === 'point-group' ? (attachedIds[0] ?? null) : null,
        pointGroupName: source.kind === 'point-group'
          ? (attachedNames[0] ?? (attachedIds[0] ?? null))
          : null,
        pointGroupIds: source.kind === 'point-group' ? attachedIds : [],
        pointGroupNames: source.kind === 'point-group' ? attachedNames : [],
        pointIds: source.kind === 'points' ? [...source.pointEntityIds] : [],
        breaklines: (surface.definition.breaklines ?? []).map((entry) => ({
          id: entry.id,
          name: entry.name ?? entry.id,
          kind: entry.source.kind,
        })),
        boundaries,
        pointCount: source.kind === 'points' ? source.pointEntityIds.length : 0,
        breaklineCount: surface.definition.breaklines?.length ?? 0,
        outerBoundaryCount: boundaries.filter((entry) => entry.kind === 'outer').length,
        voidBoundaryCount: boundaries.filter((entry) => entry.kind === 'void').length,
        maxEdgeLength: surface.definition.buildOptions?.maxEdgeLength ?? null,
      },
      brokenIds: displayStatus.brokenIds,
      brokenNames: displayStatus.brokenNames,
    };
  });
  return {
    surfaces,
    selectedSurfaceId: selectedSurfaceId != null && surfaces.some((entry) => entry.id === selectedSurfaceId)
      ? selectedSurfaceId
      : null,
    styles: backfillCadSurfaceStyles(project.surfaceStyles).map((style) => ({ id: style.id, name: style.name })),
    lastInquiry: options?.lastInquiry ?? null,
  };
};
