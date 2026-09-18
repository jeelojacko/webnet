import { buildCadSurface, type CadSurfaceBuildResult } from '../engine/cad/cadSurfaces';
import type { SurfaceBuildRequest } from '../engine/cad/cadSurfaceTypes';
import type {
  CadProject,
  CadSurface,
  CadSurveyPointEntity,
} from '../engine/cad/cadTypes';

/**
 * Phase 18F surface build worker.
 *
 * Rebuild is manual (source edit => NEEDS_REBUILD; the operator runs Rebuild
 * Surface) and never dirties the drawing. The client resolves the surface
 * definition to a compact snapshot (no React types, no whole CadProject);
 * the worker rebuilds an equivalent minimal project and runs the engine
 * build (buildCadSurface, pure + deterministic) off the main thread.
 *
 * Protocol mirrors createAdjustmentWorkerHandler: request id, surface id +
 * source revision, cancellation/supersession, latest-wins per surface
 * (a late result for a superseded revision is discarded, never CURRENT),
 * and failure posts a diagnostic the client records without CURRENT.
 */

export type SurfaceWorkerPhase = 'queued' | 'building' | 'finalizing';

export interface SurfaceWorkerMesh {
  outcome: CadSurfaceBuildResult['outcome'];
  revision: string;
  reasonCodes: CadSurfaceBuildResult['reasonCodes'];
  points: CadSurfaceBuildResult['points'];
  triangles: CadSurfaceBuildResult['triangles'];
  stats: CadSurfaceBuildResult['stats'];
}

export type SurfaceWorkerRequestMessage =
  | { type: 'build'; requestId: string; request: SurfaceBuildRequest }
  | { type: 'cancel'; requestId: string };

export type SurfaceWorkerResponseMessage =
  | {
      type: 'progress';
      requestId: string;
      surfaceId: string;
      revision: string;
      phase: SurfaceWorkerPhase;
    }
  | {
      type: 'success';
      requestId: string;
      surfaceId: string;
      revision: string;
      result: SurfaceWorkerMesh;
    }
  | {
      type: 'failure';
      requestId: string;
      surfaceId: string;
      revision: string;
      error: string;
    }
  | { type: 'cancelled'; requestId: string };

export type SurfaceWorkerBuilderFn = (
  _request: SurfaceBuildRequest,
) => SurfaceWorkerMesh | Promise<SurfaceWorkerMesh>;

export interface SurfaceWorkerHandlerDeps {
  loadBuilder: () => Promise<SurfaceWorkerBuilderFn>;
  postMessage: (_message: SurfaceWorkerResponseMessage) => void;
  defer?: (_callback: () => void) => void;
}

export interface SurfaceWorkerHandler {
  handleMessage: (_message: SurfaceWorkerRequestMessage) => void;
  resetForTests: () => void;
}

/**
 * Default builder: replays the engine build on a minimal project rebuilt
 * from the snapshot. Group membership, station fallbacks, and revision
 * inputs reproduce exactly because the snapshot carries every field the
 * engine reads (ids, stations, xyz, class, source, layer, codes).
 */
export const buildSurfaceMeshFromRequest = (
  request: SurfaceBuildRequest,
): SurfaceWorkerMesh => {
  const pointEntities: CadSurveyPointEntity[] = request.points.map((point) => ({
    id: point.id,
    type: 'survey-point',
    layerId: point.layerId ?? 'general',
    visible: true,
    locked: false,
    stationId: point.stationId,
    x: point.x,
    y: point.y,
    ...(point.z == null ? {} : { z: point.z }),
    pointClass: point.pointClass ?? 'unknown',
    source: point.source ?? 'parsed-input',
    ...(point.description != null ? { description: point.description } : {}),
    ...(point.featureCode != null ? { featureCode: point.featureCode } : {}),
  }));
  const project: CadProject = {
    version: 2,
    id: `surface-worker:${request.surfaceId}`,
    name: 'surface-worker',
    metadata: {
      source: 'parsed-input',
      runMode: 'unknown',
      units: 'm',
      stationCount: 0,
      observationCount: 0,
      adjustedStationCount: 0,
    },
    layers: [],
    styleLibrary: { lineTypes: [], textStyles: [], pointSymbols: [], styles: [] },
    pointGroups: request.pointGroups ?? (request.pointGroup ? [request.pointGroup] : []),
    entities: [...pointEntities, ...request.extraEntities],
    cogoComputations: [],
    bounds: null,
  };
  const surface: CadSurface = {
    id: request.surfaceId,
    name: request.surfaceId,
    definition: request.definition,
    cachedRevision: null,
  };
  const result = buildCadSurface(project, surface);
  return {
    outcome: result.outcome,
    revision: result.revision,
    reasonCodes: result.reasonCodes,
    points: result.points,
    triangles: result.triangles,
    stats: result.stats,
  };
};

export const createSurfaceWorkerHandler = (
  deps: SurfaceWorkerHandlerDeps,
): SurfaceWorkerHandler => {
  const cancelledRequestIds = new Set<string>();
  const latestRevisionBySurface = new Map<string, string>();
  const defer = deps.defer ?? ((callback) => setTimeout(callback, 0));

  const handleBuild = (requestId: string, request: SurfaceBuildRequest): void => {
    latestRevisionBySurface.set(request.surfaceId, request.revision);
    deps.postMessage({
      type: 'progress',
      requestId,
      surfaceId: request.surfaceId,
      revision: request.revision,
      phase: 'queued',
    });
    defer(() => {
      if (cancelledRequestIds.has(requestId)) return;
      try {
        deps.postMessage({
          type: 'progress',
          requestId,
          surfaceId: request.surfaceId,
          revision: request.revision,
          phase: 'building',
        });
        void deps
          .loadBuilder()
          .then((builder) => builder(request))
          .then((result) => {
            if (cancelledRequestIds.has(requestId)) return;
            // Latest-wins: a newer build for this surface supersedes us.
            if (latestRevisionBySurface.get(request.surfaceId) !== request.revision) return;
            deps.postMessage({
              type: 'progress',
              requestId,
              surfaceId: request.surfaceId,
              revision: request.revision,
              phase: 'finalizing',
            });
            deps.postMessage({
              type: 'success',
              requestId,
              surfaceId: request.surfaceId,
              revision: request.revision,
              result,
            });
          })
          .catch((error) => {
            if (cancelledRequestIds.has(requestId)) return;
            if (latestRevisionBySurface.get(request.surfaceId) !== request.revision) return;
            deps.postMessage({
              type: 'failure',
              requestId,
              surfaceId: request.surfaceId,
              revision: request.revision,
              error: error instanceof Error ? error.message : String(error),
            });
          })
          .finally(() => {
            cancelledRequestIds.delete(requestId);
          });
      } catch (error) {
        if (cancelledRequestIds.has(requestId)) return;
        if (latestRevisionBySurface.get(request.surfaceId) !== request.revision) return;
        deps.postMessage({
          type: 'failure',
          requestId,
          surfaceId: request.surfaceId,
          revision: request.revision,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  };

  return {
    handleMessage: (message: SurfaceWorkerRequestMessage): void => {
      if (!message) return;
      if (message.type === 'cancel') {
        cancelledRequestIds.add(message.requestId);
        deps.postMessage({ type: 'cancelled', requestId: message.requestId });
        return;
      }
      if (message.type === 'build') {
        handleBuild(message.requestId, message.request);
      }
    },
    resetForTests: (): void => {
      cancelledRequestIds.clear();
      latestRevisionBySurface.clear();
    },
  };
};


