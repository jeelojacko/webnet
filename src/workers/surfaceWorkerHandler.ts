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
  CadAlignmentElement,
  CadStationEquation,
} from '../engine/cad/cadTypes';
import {
  computeVolumeQuantities,
  toCadVolumeResult,
} from './surfaceVolumeEngine';
import {
  extractSurfaceProfile,
  type ExtractSurfaceProfileInput,
} from '../engine/cad/profiles/profileExtraction';
import type { CadSurfaceProfileResult } from '../engine/cad/profiles/profileExtraction';
import type { CadSurfaceGrid } from '../engine/cad/cadSurfaces';
import type {
  SurfaceVolumeComputeInput,
  VolumeComputeOptions,
  VolumeMesh,
  VolumeResult,
} from './surfaceVolumeEngine';
import type {
  CadSurfaceSectionResult,
  ExtractSurfaceSectionInput,
  SurfaceSectionExtractorFn,
} from '../engine/cad/cadSectionTypes';
import {
  extractSampleLine,
  resolveSampleFrame,
  resolveTangentAtRawStation,
} from '../engine/cad/sections';

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
  | { type: 'profile'; requestId: string; request: SurfaceProfileRequest }
  | { type: 'sections'; requestId: string; request: SurfaceSectionsRequest }
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
    }
  | {
      type: 'profile-success';
      requestId: string;
      profileId: string;
      profileRevision: string;
      result: CadSurfaceProfileResult;
    }
  | {
      type: 'profile-failure';
      requestId: string;
      profileId: string;
      profileRevision: string;
      error: string;
    }
  | {
      type: 'sections-success';
      requestId: string;
      groupId: string;
      groupRevision: string;
      results: CadSurfaceSectionResult[];
    }
  | {
      type: 'sections-failure';
      requestId: string;
      groupId: string;
      groupRevision: string;
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

/**
 * Phase 18J profile derivation request: compact alignment geometry +
 * equations + surface mesh snapshot in the established flat-array worker
 * shape — never the whole project.
 */
export interface SurfaceProfileRequest {
  profileId: string;
  /** `prev1:` profile revision the result must still match. */
  profileRevision: string;
  drawingId?: string;
  /** Source surface `srev1` the mesh was built from. */
  surfaceRevision: string;
  alignmentElements: CadAlignmentElement[];
  startStation: number;
  stationEquations?: CadStationEquation[];
  mesh: { points: number[]; triangles: number[]; grid: CadSurfaceGrid };
}

export type SurfaceProfileExtractorFn = (
  _input: ExtractSurfaceProfileInput,
) => CadSurfaceProfileResult | Promise<CadSurfaceProfileResult>;

/**
 * Phase 18K section derivation request. GO-level batching: each source mesh
 * is sent ONCE as a flat-array snapshot, plus an array of sample-line
 * geometries; the worker materialises each mesh once and extracts many
 * sections per request (never one request per line).
 */
export interface SurfaceSectionsSourceMesh {
  surfaceId: string;
  /** Source surface `srev1` the mesh was built from. */
  surfaceRevision: string;
  mesh: { points: number[]; triangles: number[]; grid: CadSurfaceGrid };
}

export interface SurfaceSectionsLineInput {
  lineId: string;
  /** Per-line content revision the result must still match. */
  lineRevision: string;
  rawStation: number;
  leftWidth: number;
  rightWidth: number;
  skewDeg: number;
}

export interface SurfaceSectionsRequest {
  groupId: string;
  /** `secg1:` group revision the batch must still match. */
  groupRevision: string;
  drawingId?: string;
  alignmentElements: CadAlignmentElement[];
  startStation: number;
  /** Display labels only; excluded from the section revision. */
  stationEquations?: CadStationEquation[];
  sources: SurfaceSectionsSourceMesh[];
  lines: SurfaceSectionsLineInput[];
}

export interface SurfaceWorkerHandlerDeps {
  loadBuilder: () => Promise<SurfaceWorkerBuilderFn>;
  /** Phase 18H: extractor override (tests inject fakes; default is the engine sibling's). */
  loadContourExtractor?: () => Promise<SurfaceContourExtractorFn>;
  /** Phase 18I: volume engine override (tests inject fakes; default is the engine sibling's). */
  loadVolumeEngine?: () => Promise<SurfaceVolumeEngineFn>;
  /** Phase 18J: profile extractor override (tests inject fakes; default is the engine sibling's). */
  loadProfileExtractor?: () => Promise<SurfaceProfileExtractorFn>;
  /**
   * Phase 18K: section extractor (engine sections slice). Tests inject fakes;
   * production defaults to a clear seam error until the engine slice lands.
   */
  loadSectionExtractor?: () => Promise<SurfaceSectionExtractorFn>;
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

/**
 * Default section extractor: resolves the exact raw-station tangent + skewed
 * sample frame from the alignment and walks the TIN once (engine section
 * slice). Fail-closed: geometry errors raise a stable SECTION_* diagnostic.
 */
const defaultSectionExtractor: SurfaceSectionExtractorFn = (input) => {
  const tangent = resolveTangentAtRawStation(
    input.alignmentElements,
    input.startStation,
    input.rawStation,
  );
  if (!tangent.ok) throw new Error(`SECTION_${tangent.code}`);
  const frame = resolveSampleFrame(tangent.value.tangent, input.skewDeg);
  if (!frame.ok) throw new Error(`SECTION_${frame.code}`);
  const extracted = extractSampleLine({
    mesh: { points: input.mesh.points, triangles: input.mesh.triangles, grid: input.mesh.grid },
    center: tangent.value.point,
    direction: frame.value.d,
    leftWidth: input.leftWidth,
    rightWidth: input.rightWidth,
    rawStation: input.rawStation,
    lineId: input.lineId,
  });
  if (!extracted.ok) throw new Error(`SECTION_${extracted.code}`);
  const section = extracted.section;
  return {
    groupId: input.groupId,
    lineId: input.lineId,
    surfaceId: input.surfaceId,
    revision: input.revision,
    surfaceRevision: input.surfaceRevision,
    rawStation: input.rawStation,
    segments: section.segments,
    minElevation: section.minElevation,
    maxElevation: section.maxElevation,
    coveredWidth: section.coveredWidth,
    gapWidth: section.gapWidth,
    diagnostics: section.diagnostics,
  };
};

export const createSurfaceWorkerHandler = (
  deps: SurfaceWorkerHandlerDeps,
): SurfaceWorkerHandler => {
  const cancelledRequestIds = new Set<string>();
  const latestRevisionBySurface = new Map<string, string>();
  const latestContourBySurface = new Map<string, string>();
  const latestVolumeBySurface = new Map<string, string>();
  const latestProfileByProfile = new Map<string, string>();
  const latestSectionsByGroup = new Map<string, string>();
  const defer = deps.defer ?? ((callback) => setTimeout(callback, 0));
  const loadContourExtractor =
    deps.loadContourExtractor ?? (() => Promise.resolve(extractSurfaceContours));
  const loadVolumeEngine =
    deps.loadVolumeEngine ?? (() => Promise.resolve(computeVolumeQuantities));
  const loadProfileExtractor =
    deps.loadProfileExtractor ?? (() => Promise.resolve(extractSurfaceProfile));
  const loadSectionExtractor =
    deps.loadSectionExtractor ?? (() => Promise.resolve(defaultSectionExtractor));

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

  /** Phase 18J: latest-wins key per profile = profileId@profileRevision. */
  const profileRequestKey = (request: SurfaceProfileRequest): string =>
    `${request.profileId}@${request.profileRevision}`;

  const handleProfile = (requestId: string, request: SurfaceProfileRequest): void => {
    latestProfileByProfile.set(request.profileId, profileRequestKey(request));
    defer(() => {
      if (cancelledRequestIds.has(requestId)) return;
      const flatPoints = request.mesh.points;
      const flatTriangles = request.mesh.triangles;
      const points: Array<{ x: number; y: number; z: number }> = [];
      for (let index = 0; index + 2 < flatPoints.length + 1; index += 3) {
        points.push({
          x: flatPoints[index]!,
          y: flatPoints[index + 1]!,
          z: flatPoints[index + 2]!,
        });
      }
      const triangles: Array<[number, number, number]> = [];
      for (let index = 0; index + 2 < flatTriangles.length + 1; index += 3) {
        triangles.push([flatTriangles[index]!, flatTriangles[index + 1]!, flatTriangles[index + 2]!]);
      }
      const input: ExtractSurfaceProfileInput = {
        profileId: request.profileId,
        revision: request.profileRevision,
        alignmentElements: request.alignmentElements,
        startStation: request.startStation,
        ...(request.stationEquations != null ? { stationEquations: request.stationEquations } : {}),
        mesh: { points, triangles, grid: request.mesh.grid },
      };
      void loadProfileExtractor()
        .then((extract) => extract(input))
        .then((result) => {
          if (cancelledRequestIds.has(requestId)) return;
          if (latestProfileByProfile.get(request.profileId) !== profileRequestKey(request)) return;
          deps.postMessage({
            type: 'profile-success',
            requestId,
            profileId: request.profileId,
            profileRevision: request.profileRevision,
            result,
          });
        })
        .catch((extractError) => {
          if (cancelledRequestIds.has(requestId)) return;
          if (latestProfileByProfile.get(request.profileId) !== profileRequestKey(request)) return;
          deps.postMessage({
            type: 'profile-failure',
            requestId,
            profileId: request.profileId,
            profileRevision: request.profileRevision,
            error: extractError instanceof Error ? extractError.message : String(extractError),
          });
        })
        .finally(() => {
          cancelledRequestIds.delete(requestId);
        });
    });
  };

  /** Phase 18K: latest-wins key per group = groupId@groupRevision. */
  const sectionsRequestKey = (request: SurfaceSectionsRequest): string =>
    `${request.groupId}@${request.groupRevision}`;

  const parseSectionMesh = (
    flat: SurfaceSectionsSourceMesh['mesh'],
  ): ExtractSurfaceSectionInput['mesh'] => {
    const points: Array<{ x: number; y: number; z: number }> = [];
    for (let index = 0; index + 2 < flat.points.length + 1; index += 3) {
      points.push({ x: flat.points[index]!, y: flat.points[index + 1]!, z: flat.points[index + 2]! });
    }
    const triangles: Array<[number, number, number]> = [];
    for (let index = 0; index + 2 < flat.triangles.length + 1; index += 3) {
      triangles.push([flat.triangles[index]!, flat.triangles[index + 1]!, flat.triangles[index + 2]!]);
    }
    return { points, triangles, grid: flat.grid };
  };

  /**
   * Phase 18K batched sections: materialise each source mesh ONCE, then
   * extract every (line x source) pair from the same mesh objects. One
   * request/response per group batch keeps structured-clone cost O(mesh).
   */
  const handleSections = (requestId: string, request: SurfaceSectionsRequest): void => {
    latestSectionsByGroup.set(request.groupId, sectionsRequestKey(request));
    defer(() => {
      if (cancelledRequestIds.has(requestId)) return;
      // Materialise once (never per line).
      const materialized = request.sources.map((source) => ({
        surfaceId: source.surfaceId,
        surfaceRevision: source.surfaceRevision,
        mesh: parseSectionMesh(source.mesh),
      }));
      void loadSectionExtractor()
        .then(async (extract) => {
          const results: CadSurfaceSectionResult[] = [];
          for (const line of request.lines) {
            for (const source of materialized) {
              const input: ExtractSurfaceSectionInput = {
                groupId: request.groupId,
                groupRevision: request.groupRevision,
                lineId: line.lineId,
                revision: line.lineRevision,
                surfaceId: source.surfaceId,
                surfaceRevision: source.surfaceRevision,
                alignmentElements: request.alignmentElements,
                startStation: request.startStation,
                ...(request.stationEquations != null
                  ? { stationEquations: request.stationEquations }
                  : {}),
                rawStation: line.rawStation,
                leftWidth: line.leftWidth,
                rightWidth: line.rightWidth,
                skewDeg: line.skewDeg,
                mesh: source.mesh,
              };
              results.push(await extract(input));
            }
          }
          return results;
        })
        .then((results) => {
          if (cancelledRequestIds.has(requestId)) return;
          if (latestSectionsByGroup.get(request.groupId) !== sectionsRequestKey(request)) return;
          deps.postMessage({
            type: 'sections-success',
            requestId,
            groupId: request.groupId,
            groupRevision: request.groupRevision,
            results,
          });
        })
        .catch((extractError) => {
          if (cancelledRequestIds.has(requestId)) return;
          if (latestSectionsByGroup.get(request.groupId) !== sectionsRequestKey(request)) return;
          deps.postMessage({
            type: 'sections-failure',
            requestId,
            groupId: request.groupId,
            groupRevision: request.groupRevision,
            error: extractError instanceof Error ? extractError.message : String(extractError),
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
      if (message.type === 'profile') {
        handleProfile(message.requestId, message.request);
      }
      if (message.type === 'sections') {
        handleSections(message.requestId, message.request);
      }
    },
    resetForTests: (): void => {
      cancelledRequestIds.clear();
      latestRevisionBySurface.clear();
      latestContourBySurface.clear();
      latestVolumeBySurface.clear();
      latestProfileByProfile.clear();
      latestSectionsByGroup.clear();
    },
  };
};


