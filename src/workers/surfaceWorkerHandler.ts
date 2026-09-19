import { buildCadSurface, type CadSurfaceBuildResult } from '../engine/cad/cadSurfaces';
import { computeContourLevels } from '../engine/cad/surfaceContours/contourLevels';
import {
  extractSurfaceContours,
  type ExtractSurfaceContoursArgs,
} from '../engine/cad/surfaceContours/extractContours';
import type { ContourVertex } from '../engine/cad/surfaceContours/plateau';
import {
  SURFACE_CONTOUR_LEVEL_LIMIT_DIAGNOSTIC,
  SURFACE_CONTOUR_SEGMENT_LIMIT,
  SURFACE_CONTOUR_SEGMENT_LIMIT_DIAGNOSTIC,
} from '../engine/cad/surfaceContours/contourStyleRevision';
import type {
  CadSurfaceContourSet,
  ContourLevelSpec,
} from '../engine/cad/surfaceContours/contourTypes';
import type { TinAdjacency, TinEdgeKinds } from '../engine/cad/tin/tinTypes';
import type { SurfaceBuildRequest } from '../engine/cad/cadSurfaceTypes';
import type {
  CadProject,
  CadSurface,
  CadSurveyPointEntity,
  CadVolumeResult,
} from '../engine/cad/cadTypes';
import {
  computeVolumeQuantities,
  toCadVolumeResult,
} from './surfaceVolumeEngine';
import type {
  SurfaceVolumeComputeInput,
  VolumeComputeOptions,
  VolumeMesh,
  VolumeResult,
} from './surfaceVolumeEngine';

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
  grid: CadSurfaceBuildResult['grid'];
  adjacency: TinAdjacency[];
  edgeKinds: TinEdgeKinds[];
}

export type SurfaceWorkerRequestMessage =
  | { type: 'build'; requestId: string; request: SurfaceBuildRequest }
  | { type: 'contours'; requestId: string; request: SurfaceContourRequest }
  | { type: 'volume'; requestId: string; request: SurfaceVolumeRequest }
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
  | { type: 'cancelled'; requestId: string }
  | {
      type: 'contour-success';
      requestId: string;
      surfaceId: string;
      revision: string;
      geometryRevision: string;
      result: CadSurfaceContourSet;
    }
  | {
      type: 'contour-failure';
      requestId: string;
      surfaceId: string;
      revision: string;
      geometryRevision: string;
      error: string;
    }
  | {
      type: 'volume-success';
      requestId: string;
      volumeSurfaceId: string;
      volumeRevision: string;
      result: CadVolumeResult;
    }
  | {
      type: 'volume-failure';
      requestId: string;
      volumeSurfaceId: string;
      volumeRevision: string;
      error: string;
    };

export type SurfaceWorkerBuilderFn = (
  _request: SurfaceBuildRequest,
) => SurfaceWorkerMesh | Promise<SurfaceWorkerMesh>;

/** Phase 18H contour derivation request (structured-cloneable compact arrays). */
export interface SurfaceContourMeshInput {
  points: Array<{ x: number; y: number; z?: number | null }>;
  triangles: Array<readonly [number, number, number]>;
}

export interface SurfaceContourRequest {
  surfaceId: string;
  /** Parent TIN revision the mesh was built from. */
  surfaceRevision: string;
  contourGeometryRevision: string;
  drawingId?: string;
  mesh: SurfaceContourMeshInput;
  spec: ContourLevelSpec;
}

export type SurfaceContourExtractorFn = (
  _args: ExtractSurfaceContoursArgs,
) => CadSurfaceContourSet | Promise<CadSurfaceContourSet>;

/**
 * Phase 18I volume computation request: base + comparison TIN meshes in the
 * established compact worker shape, plus a display flag (No Display styles
 * request quantities only; quantities stay bitwise identical either way).
 */
export interface SurfaceVolumeRequest {
  volumeSurfaceId: string;
  /** `vrev1:` relationship revision the result must still match. */
  volumeRevision: string;
  drawingId?: string;
  base: { surfaceId: string; mesh: VolumeMesh };
  comparison: { surfaceId: string; mesh: VolumeMesh };
  includeDisplay: boolean;
}

export type SurfaceVolumeEngineFn = (
  _base: VolumeMesh,
  _comparison: VolumeMesh,
  _options: VolumeComputeOptions,
) => VolumeResult | Promise<VolumeResult>;

export interface SurfaceWorkerHandlerDeps {
  loadBuilder: () => Promise<SurfaceWorkerBuilderFn>;
  /** Phase 18H: extractor override (tests inject fakes; default is the engine sibling's). */
  loadContourExtractor?: () => Promise<SurfaceContourExtractorFn>;
  /** Phase 18I: volume engine override (tests inject fakes; default is the engine sibling's). */
  loadVolumeEngine?: () => Promise<SurfaceVolumeEngineFn>;
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
    grid: result.grid,
    adjacency: result.adjacency,
    edgeKinds: result.edgeKinds,
  };
};

export const createSurfaceWorkerHandler = (
  deps: SurfaceWorkerHandlerDeps,
): SurfaceWorkerHandler => {
  const cancelledRequestIds = new Set<string>();
  const latestRevisionBySurface = new Map<string, string>();
  const latestContourBySurface = new Map<string, string>();
  const latestVolumeBySurface = new Map<string, string>();
  const defer = deps.defer ?? ((callback) => setTimeout(callback, 0));
  const loadContourExtractor =
    deps.loadContourExtractor ?? (() => Promise.resolve(extractSurfaceContours));
  const loadVolumeEngine =
    deps.loadVolumeEngine ?? (() => Promise.resolve(computeVolumeQuantities));

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

  /**
   * Phase 18H contour derivation: pre-compute level count (limit blocks
   * with a diagnostic, never a silent bump), extract, then enforce the
   * total segment guard (limit blocks, never silent truncation). Own
   * latest-wins key per surface (surfaceRevision@geometryRevision) so a
   * late result for a superseded interval/mesh never applies.
   */
  const requestKey = (request: SurfaceContourRequest): string =>
    `${request.surfaceRevision}@${request.contourGeometryRevision}`;

  /**
   * Resolve worker args against the engine sibling's exact signature.
   * Level-limit throws map to the stable block diagnostic (never a
   * silent interval bump); other throws propagate verbatim.
   */
  const toExtractArgs = (request: SurfaceContourRequest): ExtractSurfaceContoursArgs => {
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const point of request.mesh.points) {
      if (typeof point.z === 'number' && Number.isFinite(point.z)) {
        if (point.z < minZ) minZ = point.z;
        if (point.z > maxZ) maxZ = point.z;
      }
    }
    if (!Number.isFinite(minZ) || !Number.isFinite(maxZ)) {
      throw new Error('SURFACE_CONTOUR_INVALID_RANGE: empty TIN elevation range.');
    }
    let levels: ExtractSurfaceContoursArgs['levels'];
    try {
      levels = computeContourLevels(minZ, maxZ, request.spec);
    } catch (error) {
      if ((error as { code?: unknown })?.code === 'SURFACE_CONTOUR_LEVEL_LIMIT') {
        throw new Error(SURFACE_CONTOUR_LEVEL_LIMIT_DIAGNOSTIC);
      }
      throw error;
    }
    const vertices: ContourVertex[] = request.mesh.points.map((point) => ({
      x: point.x,
      y: point.y,
      z: typeof point.z === 'number' && Number.isFinite(point.z) ? point.z : NaN,
    }));
    return {
      surfaceId: request.surfaceId,
      surfaceRevision: request.surfaceRevision,
      styleRevision: request.contourGeometryRevision,
      points: vertices,
      triangles: request.mesh.triangles.map((tri) => [tri[0], tri[1], tri[2]] as [number, number, number]),
      levels,
    };
  };

  const failContours = (requestId: string, request: SurfaceContourRequest, error: string): void => {
    if (cancelledRequestIds.has(requestId)) return;
    if (latestContourBySurface.get(request.surfaceId) !== requestKey(request)) return;
    deps.postMessage({
      type: 'contour-failure',
      requestId,
      surfaceId: request.surfaceId,
      revision: request.surfaceRevision,
      geometryRevision: request.contourGeometryRevision,
      error,
    });
  };

  const handleContours = (requestId: string, request: SurfaceContourRequest): void => {
    latestContourBySurface.set(request.surfaceId, requestKey(request));
    defer(() => {
      if (cancelledRequestIds.has(requestId)) return;
      let extractArgs: ExtractSurfaceContoursArgs;
      try {
        extractArgs = toExtractArgs(request);
      } catch (rangeError) {
        failContours(
          requestId,
          request,
          rangeError instanceof Error ? rangeError.message : String(rangeError),
        );
        return;
      }
      void loadContourExtractor()
        .then((extract) => extract(extractArgs))
        .then((result) => {
          if (cancelledRequestIds.has(requestId)) return;
          if (latestContourBySurface.get(request.surfaceId) !== requestKey(request)) return;
          if (result.stats.segmentCount > SURFACE_CONTOUR_SEGMENT_LIMIT) {
            deps.postMessage({
              type: 'contour-failure',
              requestId,
              surfaceId: request.surfaceId,
              revision: request.surfaceRevision,
              geometryRevision: request.contourGeometryRevision,
              error: SURFACE_CONTOUR_SEGMENT_LIMIT_DIAGNOSTIC,
            });
            return;
          }
          deps.postMessage({
            type: 'contour-success',
            requestId,
            surfaceId: request.surfaceId,
            revision: request.surfaceRevision,
            geometryRevision: request.contourGeometryRevision,
            result,
          });
        })
        .catch((extractError) => {
          failContours(
            requestId,
            request,
            extractError instanceof Error ? extractError.message : String(extractError),
          );
        })
        .finally(() => {
          cancelledRequestIds.delete(requestId);
        });
    });
  };

  /** Phase 18I: latest-wins key per volume = volumeSurfaceId@volumeRevision. */
  const volumeRequestKey = (request: SurfaceVolumeRequest): string =>
    `${request.volumeSurfaceId}@${request.volumeRevision}`;

  const handleVolume = (requestId: string, request: SurfaceVolumeRequest): void => {
    latestVolumeBySurface.set(request.volumeSurfaceId, volumeRequestKey(request));
    defer(() => {
      if (cancelledRequestIds.has(requestId)) return;
      const options: VolumeComputeOptions = { includeDisplay: request.includeDisplay };
      const computeInput: SurfaceVolumeComputeInput = {
        baseSurfaceId: request.base.surfaceId,
        comparisonSurfaceId: request.comparison.surfaceId,
        revision: request.volumeRevision,
        base: request.base.mesh,
        comparison: request.comparison.mesh,
        includeDisplay: request.includeDisplay,
      };
      void loadVolumeEngine()
        .then((compute) => compute(request.base.mesh, request.comparison.mesh, options))
        .then((result) => {
          if (cancelledRequestIds.has(requestId)) return;
          if (latestVolumeBySurface.get(request.volumeSurfaceId) !== volumeRequestKey(request)) return;
          deps.postMessage({
            type: 'volume-success',
            requestId,
            volumeSurfaceId: request.volumeSurfaceId,
            volumeRevision: request.volumeRevision,
            result: toCadVolumeResult(computeInput, result),
          });
        })
        .catch((computeError) => {
          if (cancelledRequestIds.has(requestId)) return;
          if (latestVolumeBySurface.get(request.volumeSurfaceId) !== volumeRequestKey(request)) return;
          deps.postMessage({
            type: 'volume-failure',
            requestId,
            volumeSurfaceId: request.volumeSurfaceId,
            volumeRevision: request.volumeRevision,
            error: computeError instanceof Error ? computeError.message : String(computeError),
          });
        })
        .finally(() => {
          cancelledRequestIds.delete(requestId);
        });
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
      if (message.type === 'contours') {
        handleContours(message.requestId, message.request);
      }
      if (message.type === 'volume') {
        handleVolume(message.requestId, message.request);
      }
    },
    resetForTests: (): void => {
      cancelledRequestIds.clear();
      latestRevisionBySurface.clear();
      latestContourBySurface.clear();
      latestVolumeBySurface.clear();
    },
  };
};


