import { computeCadSurfaceSourceRevision } from '../engine/cad/cadSurfaces';
import type { CadSurfaceCache as CadTinCache } from '../engine/cad/cadSurfaceCache';
import { resolveCurrentAnalysisRevision } from '../engine/cad/cadAnalysisView.service';
import { deriveAnalysisStatus } from '../engine/cad/cadAnalysisStatus';
import type { CadAnalysisMap, CadAnalysisStatus } from '../engine/cad/cadAnalysisTypes';
import {
  createSurfaceAnalysisCache,
  type CachedAnalysisResult,
  type SurfaceAnalysisCache,
} from '../engine/cad/surfaceAnalysisCache';
import type { CadProject } from '../engine/cad/cadTypes';
import type { SurfaceAnalysisRequest, SurfaceAnalysisResultPayload } from './surfaceWorkerHandler';
import type { PendingSurfaceAnalysis } from './surfaceWorkerClient';

export type { SurfaceAnalysisCache };
export { createSurfaceAnalysisCache };

/**
 * Phase 18U — analysis-map derivation control plane (one per session).
 *
 * Mirrors SurfaceVolumeService ownership: request identity is
 * {drawingId, analysisId, geometryRevision, requestId}; late, foreign, or
 * stale results NEVER become CURRENT. Calculation is explicit only (a
 * source edit never auto-starts analysis work): source changes cancel
 * in-flight work for affected maps and status derives NEEDS_RECALC from
 * the `arev1:` revision compare.
 *
 * Retained-stale policy: a superseded result stays in the session cache
 * for STALE-labeled quantity display, but renderers only use the CURRENT
 * revision — stale is never rendered as current (see cadAnalysisView).
 * A FAILURE leaves source TINs CURRENT and inquiries working.
 */

const DIAGNOSTIC_LIMIT = 300;

export interface SurfaceAnalysisSessionDiagnostic {
  revision: string;
  error: string;
}

/** Minimal transport surface (SurfaceWorkerClient satisfies this). */
export interface SurfaceAnalysisTransport {
  readonly alive: boolean;
  deriveAnalysis: (_request: SurfaceAnalysisRequest) => PendingSurfaceAnalysis;
  cancel: (_requestId: string) => void;
  dispose: () => void;
}

export interface SurfaceAnalysisServiceDeps {
  drawingId: string;
  getProject: () => CadProject;
  getDrawingId: () => string;
  tinCache: CadTinCache;
  analysisCache: SurfaceAnalysisCache;
  createTransport: () => SurfaceAnalysisTransport | null;
  notify: (_message: string) => void;
  onStateChange: () => void;
}

interface AnalysisPendingEntry {
  requestId: string;
  revision: string;
}

const truncateDiagnostic = (error: string): string =>
  error.length > DIAGNOSTIC_LIMIT ? `${error.slice(0, DIAGNOSTIC_LIMIT)}…` : error;

const findAnalysis = (project: CadProject, analysisId: string): CadAnalysisMap | undefined =>
  (project.analysisMaps ?? []).find((entry) => entry.id === analysisId);

const findSurface = (project: CadProject, surfaceId: string) =>
  (project.surfaces ?? []).find((entry) => entry.id === surfaceId);

const findVolume = (project: CadProject, volumeSurfaceId: string) =>
  (project.volumeSurfaces ?? []).find((entry) => entry.id === volumeSurfaceId);

/** Flatten a cached TIN mesh to the worker's structured-clone flat arrays. */
const toAnalysisMesh = (
  points: ReadonlyArray<{ x: number; y: number; z: number }>,
  triangles: ReadonlyArray<readonly [number, number, number]>,
): { points: number[]; triangles: number[] } => {
  const flatPoints: number[] = [];
  for (const point of points) flatPoints.push(point.x, point.y, point.z);
  const flatTriangles: number[] = [];
  for (const triangle of triangles) flatTriangles.push(triangle[0], triangle[1], triangle[2]);
  return { points: flatPoints, triangles: flatTriangles };
};

export class SurfaceAnalysisService {
  private readonly deps: SurfaceAnalysisServiceDeps;
  private readonly drawingId: string;
  private transport: SurfaceAnalysisTransport | null = null;
  private transportFailed = false;
  private readonly pending = new Map<string, AnalysisPendingEntry>();
  private readonly diagnostics = new Map<string, SurfaceAnalysisSessionDiagnostic>();
  private disposed = false;

  constructor(deps: SurfaceAnalysisServiceDeps) {
    this.deps = deps;
    this.drawingId = deps.drawingId;
  }

  /** Session BUILDING set (analysis derivation only — never source status). */
  buildingAnalysisIds(): ReadonlySet<string> {
    return new Set(this.pending.keys());
  }

  analysisDiagnostics(): ReadonlyMap<string, SurfaceAnalysisSessionDiagnostic> {
    return new Map(this.diagnostics);
  }

  /** Current `arev1:` geometry revision for a map (null when unresolvable). */
  geometryRevisionOf(analysisId: string): string | null {
    const project = this.deps.getProject();
    const def = findAnalysis(project, analysisId);
    if (!def) return null;
    return this.geometryRevisionFor(project, def);
  }

  statusOf(analysisId: string): { status: CadAnalysisStatus; stale: boolean } {
    const project = this.deps.getProject();
    const def = findAnalysis(project, analysisId);
    if (!def) return { status: 'BROKEN_REFERENCE', stale: false };
    const source = this.resolveSource(project, def);
    const revision = source.ok ? this.geometryRevisionFor(project, def) : null;
    const result =
      revision != null ? (this.deps.analysisCache.get(analysisId, revision) ?? null) : null;
    const retained = this.deps.analysisCache.retained(analysisId);
    // A retained stale result still counts as a result: revision mismatch
    // then derives NEEDS_RECALC (never UNBUILT) per the status contract.
    const latestRetained = retained.length > 0 ? retained[retained.length - 1]! : null;
    const status = deriveAnalysisStatus(
      def,
      source.ok ? { found: true, status: 'CURRENT' } : { found: source.found, status: null },
      latestRetained != null,
      latestRetained?.revision ?? null,
      revision ?? '',
      {
        ...(this.pending.has(analysisId) ? { building: true } : {}),
        ...(this.diagnostics.has(analysisId) ? { failed: true } : {}),
        ...(result?.empty === true ? { noData: true } : {}),
      },
    );
    return { status, stale: retained.length > 0 && result == null };
  }

  requestAnalysis(analysisId: string): string {
    if (this.disposed) return 'Analysis map not found.';
    const project = this.deps.getProject();
    const def = findAnalysis(project, analysisId);
    if (!def) return 'Analysis map not found.';
    const source = this.resolveSource(project, def);
    if (!source.ok) {
      return `Analysis blocked: “${def.name}” has a missing or not-current source.`;
    }
    const revision = this.geometryRevisionFor(project, def);
    if (this.deps.analysisCache.get(analysisId, revision)) {
      return `Analysis for “${def.name}” is already current.`;
    }
    this.diagnostics.delete(analysisId);
    const transport = this.transportFor();
    if (!transport) {
      this.diagnostics.set(analysisId, {
        revision,
        error: truncateDiagnostic('Surface analysis worker unavailable.'),
      });
      this.deps.onStateChange();
      return `Analysis blocked: worker unavailable for “${def.name}”.`;
    }
    this.supersede(analysisId);
    const pendingAnalysis = transport.deriveAnalysis({
      analysisId,
      geometryRevision: revision,
      metric: def.source.metric,
      sourceKind: def.source.kind,
      bands: def.bands.map((band) => ({ id: band.id, lower: band.lower, upper: band.upper })),
      ...(source.surfaceMesh ? { surfaceMesh: source.surfaceMesh } : {}),
      ...(source.baseMesh ? { baseMesh: source.baseMesh } : {}),
      ...(source.comparisonMesh ? { comparisonMesh: source.comparisonMesh } : {}),
      includeDisplay: true,
      drawingId: this.drawingId,
    });
    this.pending.set(analysisId, { requestId: pendingAnalysis.requestId, revision });
    this.deps.onStateChange();
    void pendingAnalysis.done.then(
      (result) => this.complete(analysisId, pendingAnalysis.requestId, result, null),
      (error) => this.complete(analysisId, pendingAnalysis.requestId, null, error),
    );
    return `Computing analysis for “${def.name}”…`;
  }

  /**
   * Manual-calc default: a source rebuild never auto-starts analysis work.
   * It cancels in-flight work for affected maps (their revision moved) and
   * lets status derive NEEDS_RECALC/SOURCE_NOT_CURRENT from the revision.
   */
  notifyMeshBuilt(surfaceId: string): void {
    if (this.disposed) return;
    const project = this.deps.getProject();
    for (const def of project.analysisMaps ?? []) {
      if (def.source.kind === 'surface' && def.source.surfaceId === surfaceId) {
        this.supersede(def.id);
      } else if (def.source.kind === 'volume') {
        const volume = findVolume(project, def.source.volumeSurfaceId);
        if (volume && (volume.baseSurfaceId === surfaceId || volume.comparisonSurfaceId === surfaceId)) {
          this.supersede(def.id);
        }
      }
    }
  }

  cancelAnalysis(analysisId: string): void {
    this.supersede(analysisId);
  }

  handleAnalysisDeleted(analysisId: string): void {
    this.supersede(analysisId);
    this.deps.analysisCache.invalidate(analysisId);
    this.diagnostics.delete(analysisId);
    this.deps.onStateChange();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [analysisId, entry] of this.pending) {
      try {
        this.transport?.cancel(entry.requestId);
      } catch {
        // Superseded computations settle silently regardless.
      }
      this.pending.delete(analysisId);
    }
    this.diagnostics.clear();
    try {
      this.transport?.dispose();
    } catch {
      // Disposal never throws.
    }
    this.transport = null;
    this.deps.analysisCache.clear();
  }

  private geometryRevisionFor(project: CadProject, def: CadAnalysisMap): string {
    return resolveCurrentAnalysisRevision(project, def);
  }

  private resolveSource(
    project: CadProject,
    def: CadAnalysisMap,
  ):
    | {
        ok: true;
        surfaceMesh?: { points: number[]; triangles: number[] };
        baseMesh?: { points: number[]; triangles: number[] };
        comparisonMesh?: { points: number[]; triangles: number[] };
      }
    | { ok: false; found: boolean } {
    if (def.source.kind === 'surface') {
      const surface = findSurface(project, def.source.surfaceId);
      if (!surface) return { ok: false, found: false };
      const revision = computeCadSurfaceSourceRevision(project, surface);
      const mesh = this.deps.tinCache.get(surface.id, revision);
      if (!mesh) return { ok: false, found: true };
      return { ok: true, surfaceMesh: toAnalysisMesh(mesh.points, mesh.triangles) };
    }
    const volume = findVolume(project, def.source.volumeSurfaceId);
    if (!volume) return { ok: false, found: false };
    const base = findSurface(project, volume.baseSurfaceId);
    const comparison = findSurface(project, volume.comparisonSurfaceId);
    if (!base || !comparison) return { ok: false, found: true };
    const baseMesh = this.deps.tinCache.get(base.id, computeCadSurfaceSourceRevision(project, base));
    const cmpMesh = this.deps.tinCache.get(
      comparison.id,
      computeCadSurfaceSourceRevision(project, comparison),
    );
    if (!baseMesh || !cmpMesh) return { ok: false, found: true };
    return {
      ok: true,
      baseMesh: toAnalysisMesh(baseMesh.points, baseMesh.triangles),
      comparisonMesh: toAnalysisMesh(cmpMesh.points, cmpMesh.triangles),
    };
  }

  private transportFor(): SurfaceAnalysisTransport | null {
    if (this.disposed) return null;
    if (this.transport) return this.transport.alive ? this.transport : null;
    if (this.transportFailed) return null;
    try {
      const created = this.deps.createTransport();
      if (!created || !created.alive) return null;
      this.transport = created;
      return created;
    } catch {
      this.transportFailed = true;
      return null;
    }
  }

  private supersede(analysisId: string): void {
    const entry = this.pending.get(analysisId);
    if (!entry) return;
    this.pending.delete(analysisId);
    try {
      this.transport?.cancel(entry.requestId);
    } catch {
      // Superseded computations settle silently regardless.
    }
    this.deps.onStateChange();
  }

  private complete(
    analysisId: string,
    requestId: string,
    result: SurfaceAnalysisResultPayload | null,
    error: unknown,
  ): void {
    const entry = this.pending.get(analysisId);
    // Superseded, cancelled, or disposed: a late arrival never applies.
    if (!entry || entry.requestId !== requestId) return;
    this.pending.delete(analysisId);
    if (result == null && error == null) {
      this.deps.onStateChange();
      return;
    }
    const project = this.deps.getProject();
    const def = findAnalysis(project, analysisId);
    const revision = def ? this.geometryRevisionFor(project, def) : null;
    // Cross-drawing, deleted, or source-changed: discard, never CURRENT.
    if (this.disposed || this.deps.getDrawingId() !== this.drawingId || revision !== entry.revision) {
      this.deps.onStateChange();
      return;
    }
    if (error != null || result == null) {
      const raw = error instanceof Error ? error.message : String(error ?? 'Analysis computation failed.');
      this.diagnostics.set(analysisId, {
        revision: entry.revision,
        error: truncateDiagnostic(raw),
      });
      this.deps.onStateChange();
      return;
    }
    // Stale-mesh gating: only the requested revision wins.
    if (result.revision !== entry.revision) {
      this.deps.onStateChange();
      return;
    }
    const cached: CachedAnalysisResult = {
      analysisId,
      revision: result.revision,
      metric: result.metric,
      empty: result.empty,
      result: result.result,
    };
    this.deps.analysisCache.set(cached);
    this.diagnostics.delete(analysisId);
    this.deps.onStateChange();
  }
}
