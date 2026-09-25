import type { CachedSurfaceMesh, CadSurfaceCache } from '../../engine/cad/cadSurfaceCache';
import {
  queryMeshElevation,
  queryMeshSlope,
  resolveSurfaceDisplayStatus,
  resolveSurfaceLayerId,
  surfaceContentRevision,
  surfaceStatusText,
  type SurfaceStatusText,
} from '../../engine/cad/cadSurfaceView';
import { backfillCadSurfaceStyles } from '../../engine/cad/cadSurfaceStyles';
import { formatSurfaceSlopeAnswer } from '../../engine/cad/surfaceAnalysis';
import { contourLevelSpecFromStyle } from '../../engine/cad/cadSurfaceContourView';
import { surfacePointGroupIds } from '../../engine/cad/cadTypes';
import type { CadProject, CadSurfaceEdit, CadSurfaceStatus } from '../../engine/cad/cadTypes';
import {
  deriveCadSurfaceEditSummaries,
  shortPointLabel,
  type CadSurfaceEditSummary,
} from './cadSurfaceEditSummaries';
import type { SurfaceSelectionSourceFilter } from '../../hooks/surveyCad/surfaceBulkSelectionUtils';

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
  /** Phase 18L: 'imported-tin' hides point-group/breakline edit controls. */
  sourceKind: 'native' | 'imported-tin';
  importedSourceText: string | null;
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
  /** Planimetric (XY) area — paired distinctly with area3D below. */
  area: number;
  /** Sum of 3D face areas (≥ planimetric). */
  area3D: number;
  /** Planimetric-area-weighted mean elevation. */
  meanElevation: number | null;
  /** Face-slope percents (100×ratio); mean is 100× the area-weighted mean RATIO. */
  minSlopePercent: number | null;
  meanSlopePercent: number | null;
  maxSlopePercent: number | null;
  /** atan of the area-weighted mean ratio (mean(angle) ≠ angle(mean)). */
  meanSlopeAngleDeg: number | null;
  skippedMissingZ: number;
  stale: boolean;
}

export interface CadSurfaceRow {
  id: string;
  name: string;
  /** Production rebuild route. 'worker' is the production path (BUILDING
   * status is the live proof); 'sync-fallback' marks a CURRENT mesh built
   * by the bounded sync fallback while the worker was unavailable (the
   * completion notice says so too). Matched by revision, so a source edit
   * expires the marker. */
  buildPath: 'worker' | 'sync-fallback';
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
  /** Phase 18S — ordered edit stack (readable refs + derived status). */
  edits: CadSurfaceEditSummary[];
  editCount: number;
  /** Phase 18T — authoritative stack reference (render-only) for the
   * dependency inspector (missing/disabled-producer warnings). */
  editStack: CadSurfaceEdit[];
  enabledEditCount: number;
  /** Phase 18T — concise group counts (no record dump in Properties). */
  topologyEditCount: number;
  pointEditCount: number;
  elevationEditCount: number;
  brokenEditCount: number;
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

export interface CadSurfaceStyleSummary {
  id: string;
  name: string;
  showContours: boolean;
  minorContourInterval: number | null;
  majorContourEvery: number | null;
  contourBaseElevation: number | null;
  minorColor: string | null;
  majorColor: string | null;
  showContourLabels: boolean;
  labelMajorOnly: boolean;
  contourLabelSpacing: number | null;
  contourLabelPrecision: number | null;
}

export interface CadSurfaceSnapshot {
  surfaces: CadSurfaceRow[];
  selectedSurfaceId: string | null;
  styles: CadSurfaceStyleSummary[];
  lastInquiry: CadSurfaceInquiry | null;
  /** Phase 18V — session point-selection summary (never persisted). */
  selection: CadSurfaceSelectionSummary;
}

/** Phase 18V — session/UI-only selected-point summary for the ribbon/manager. */
export interface CadSurfaceSelectionSummary {
  surfaceId: string | null;
  /** Effective selected refs after the source filter. */
  count: number;
  /** Non-addressable boundary/Steiner vertices in the current final mesh. */
  syntheticExcluded: number;
  stale: boolean;
  filter: SurfaceSelectionSourceFilter;
}

export const EMPTY_SURFACE_SELECTION: CadSurfaceSelectionSummary = {
  surfaceId: null,
  count: 0,
  syntheticExcluded: 0,
  stale: false,
  filter: 'all',
};

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

/** Structured slope/aspect inquiry (parallel to elevation; no string parsing). */
export const querySurfaceSlopeText = (
  project: CadProject,
  cache: CadSurfaceCache,
  surfaceId: string,
  x: number,
  y: number,
): string | null => {
  const surface = (project.surfaces ?? []).find((entry) => entry.id === surfaceId);
  if (!surface) return null;
  const mesh = cache.get(surfaceId, surfaceContentRevision(project, surface));
  if (!mesh) return formatSurfaceSlopeAnswer(surface.name, x, y, null, false);
  return formatSurfaceSlopeAnswer(surface.name, x, y, queryMeshSlope(mesh, x, y), true);
};

const meshStats = (mesh: CachedSurfaceMesh, stale: boolean): CadSurfaceStatsSummary => ({
  points: mesh.stats.usedPointCount,
  vertices: mesh.points.length,
  triangles: mesh.stats.triangleCount,
  minZ: mesh.stats.minZ,
  maxZ: mesh.stats.maxZ,
  area: mesh.stats.planimetricArea,
  area3D: mesh.stats.surface3DArea,
  meanElevation: mesh.stats.meanElevation,
  minSlopePercent: mesh.stats.minFaceSlopeRatio != null ? 100 * mesh.stats.minFaceSlopeRatio : null,
  meanSlopePercent: mesh.stats.meanFaceSlopeRatio != null ? 100 * mesh.stats.meanFaceSlopeRatio : null,
  maxSlopePercent: mesh.stats.maxFaceSlopeRatio != null ? 100 * mesh.stats.maxFaceSlopeRatio : null,
  meanSlopeAngleDeg:
    mesh.stats.meanFaceSlopeRatio != null
      ? (Math.atan(mesh.stats.meanFaceSlopeRatio) * 180) / Math.PI
      : null,
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
    /** Session BUILDING set (pending worker requests, never persisted). */
    buildingSurfaceIds?: ReadonlySet<string>;
    /**
     * Session failure diagnostics by surface id (worker transport
     * failures only; applied solely when the revision still matches —
     * a source edit expires them, never CURRENT).
     */
    sessionDiagnostics?: ReadonlyMap<string, { revision: string; error: string }>;
    /** Revisions whose CURRENT mesh came from the sync fallback, by surface. */
    syncFallbackRevisions?: ReadonlyMap<string, string>;
    /** Phase 18V — session point selection (UI-only; never persisted). */
    selection?: CadSurfaceSelectionSummary;
  },
): CadSurfaceSnapshot => {
  const layers = new Map(project.layers.map((layer) => [layer.id, layer]));
  const styles = new Map(backfillCadSurfaceStyles(project.surfaceStyles).map((style) => [style.id, style.name]));
  const entityLabels = new Map(
    project.entities.map((entity) => [entity.id, entity.type] as const),
  );
  // Phase 18S — stable native ref labels: source:<entityId> resolves to the
  // survey point's short station label (never the raw entity id).
  const pointLabels = new Map(
    project.entities
      .filter((entity): entity is Extract<typeof entity, { type: 'survey-point' }> => entity.type === 'survey-point')
      .map((entity) => [entity.id, shortPointLabel(entity.stationId)] as const),
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
    // Session overlays (never persisted): BUILDING while a worker request
    // is pending; FAILED with the bounded session diagnostic when the
    // transport failed for the current revision. Broken references stay
    // definition truth under both overlays.
    let status = displayStatus.status;
    let diagnostic: string | null = surface.buildDiagnostic ?? null;
    if (displayStatus.status !== 'BROKEN_REFERENCE') {
      if (options?.buildingSurfaceIds?.has(surface.id)) {
        status = 'BUILDING';
      } else {
        const sessionFailure = options?.sessionDiagnostics?.get(surface.id);
        if (sessionFailure && sessionFailure.revision === revision) {
          status = 'FAILED';
          diagnostic = sessionFailure.error;
        }
      }
    }
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
    const edits = deriveCadSurfaceEditSummaries(surface, pointLabels, mesh != null);
    return {
      id: surface.id,
      name: surface.name,
      buildPath:
        options?.syncFallbackRevisions?.get(surface.id) === revision
          ? 'sync-fallback'
          : 'worker',
      layerId,
      layerName: layer?.name ?? layerId,
      layerLocked: layer?.locked === true,
      styleId: surface.styleId ?? null,
      styleName: (surface.styleId != null ? styles.get(surface.styleId) : undefined) ?? 'Default',
      status,
      statusText: surfaceStatusText(status),
      stale,
      revision,
      cachedRevision: surface.cachedRevision ?? null,
      diagnostic,
      stats: mesh ? meshStats(mesh, stale) : null,
      definition: {
        pointSourceKind: source.kind,
        sourceKind: surface.definition.sourceKind === 'imported-tin' ? 'imported-tin' : 'native',
        importedSourceText: surface.definition.sourceKind === 'imported-tin' && surface.definition.importedTin
          ? `Imported LandXML TIN — ${surface.definition.importedTin.vertices.length / 3} vertices, ` +
            `${surface.definition.importedTin.faces.length / 3} faces ` +
            `(file: ${surface.definition.importedTin.provenance.fileName}, ` +
            `surface: ${surface.definition.importedTin.provenance.surfaceName})`
          : null,
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
      edits,
      editCount: edits.length,
      editStack: surface.definition.edits ?? [],
      enabledEditCount: edits.filter((edit) => edit.enabled).length,
      topologyEditCount: edits.filter((edit) => edit.kind === 'swap-edge' || edit.kind === 'add-line' || edit.kind === 'delete-line').length,
      pointEditCount: edits.filter((edit) => edit.kind === 'add-point' || edit.kind === 'delete-point' || edit.kind === 'move-point').length,
      elevationEditCount: edits.filter((edit) => edit.kind === 'set-elevation' || edit.kind === 'raise-lower-surface').length,
      brokenEditCount: edits.filter((edit) => edit.status === 'broken-reference').length,
      brokenIds: displayStatus.brokenIds,
      brokenNames: displayStatus.brokenNames,
    };
  });
  return {
    surfaces,
    selectedSurfaceId: selectedSurfaceId != null && surfaces.some((entry) => entry.id === selectedSurfaceId)
      ? selectedSurfaceId
      : null,
    styles: backfillCadSurfaceStyles(project.surfaceStyles).map((style) => ({
      id: style.id,
      name: style.name,
      showContours: style.showContours === true && contourLevelSpecFromStyle(style) != null,
      minorContourInterval: style.minorContourInterval ?? null,
      majorContourEvery: style.majorContourEvery ?? null,
      contourBaseElevation: style.contourBaseElevation ?? null,
      minorColor: style.minorContour?.color ?? null,
      majorColor: style.majorContour?.color ?? null,
      showContourLabels: style.showContourLabels ?? true,
      labelMajorOnly: style.labelMajorOnly ?? true,
      contourLabelSpacing: style.contourLabelSpacing ?? null,
      contourLabelPrecision: style.contourLabelPrecision ?? null,
    })),
    lastInquiry: options?.lastInquiry ?? null,
    selection: options?.selection ?? EMPTY_SURFACE_SELECTION,
  };
};
