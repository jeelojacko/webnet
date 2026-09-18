import { computeCadSurfaceSourceRevision } from '../engine/cad/cadSurfaces';
import type { CadSurfaceContourCache } from '../engine/cad/surfaceContourCache';
import type { CadSurfaceCache as CadTinCache } from '../engine/cad/cadSurfaceCache';
import {
  deriveSurfaceContourStatus,
  type SurfaceContourStatus,
} from '../engine/cad/surfaceContourStatus';
import type { CadSurfaceContourSet, ContourLevelSpec } from '../engine/cad/surfaceContours/contourTypes';
import {
  computeContourGeometryRevision,
  SURFACE_CONTOUR_STALE_TIN_DIAGNOSTIC,
  toContourGeometrySpec,
} from '../engine/cad/surfaceContours/contourStyleRevision';
import type { CadProject } from '../engine/cad/cadTypes';
import type { SurfaceContourRequest } from './surfaceWorkerHandler';
import type { PendingSurfaceContours } from './surfaceWorkerClient';

/**
 * Phase 18H — contour derivation control plane (one per drawing session).
 *
 * Mirrors SurfaceBuildService ownership: request identity is
 * {drawingId, surfaceId, surfaceRevision, contourGeometryRevision,
 * requestId}; late results from an old interval/mesh/drawing NEVER replace
 * the current cache (latest-wins per surface). Changing interval/base,
 * mesh, or drawing supersedes in-flight requests with no leaked BUILDING
 * status (pending entries are dropped on supersede/cancel/dispose).
 *
 * Never touches the TIN cache or history: a contour FAILURE leaves the
 * parent TIN CURRENT and TIN inquiries working. Stale-TIN policy: new
 * derivation requires the parent TIN CURRENT for the same revision;
 * otherwise the request blocks with SURFACE_CONTOUR_STALE_TIN and an older
 * set may show stale-marked only. A new TIN revision auto-derives via
 * `notifyMeshBuilt` when `shouldAutoDerive` (style.showContours) holds —
 * an interval change never rebuilds the TIN.
 */

const DIAGNOSTIC_LIMIT = 300;

export interface SurfaceContourSessionDiagnostic {
  revision: string;
  geometryRevision: string;
  error: string;
}

/** Minimal transport surface (SurfaceWorkerClient satisfies this). */
export interface SurfaceContourTransport {
  readonly alive: boolean;
  deriveContours: (_request: SurfaceContourRequest) => PendingSurfaceContours;
  cancel: (_requestId: string) => void;
  dispose: () => void;
}

export interface SurfaceContourServiceDeps {
  drawingId: string;
  getProject: () => CadProject;
  getDrawingId: () => string;
  tinCache: CadTinCache;
  contourCache: CadSurfaceContourCache;
  createTransport: () => SurfaceContourTransport | null;
  shouldAutoDerive: (_surfaceId: string) => boolean;
  notify: (_message: string) => void;
  onStateChange: () => void;
}

interface ContourPendingEntry {
  requestId: string;
  revision: string;
  geometryRevision: string;
}

const truncateDiagnostic = (error: string): string =>
  error.length > DIAGNOSTIC_LIMIT ? `${error.slice(0, DIAGNOSTIC_LIMIT)}…` : error;

const findSurface = (project: CadProject, surfaceId: string) =>
  (project.surfaces ?? []).find((entry) => entry.id === surfaceId);

export class SurfaceContourService {
  private readonly deps: SurfaceContourServiceDeps;
  private readonly drawingId: string;
  private transport: SurfaceContourTransport | null = null;
  private transportFailed = false;
  private readonly pending = new Map<string, ContourPendingEntry>();
  private readonly diagnostics = new Map<string, SurfaceContourSessionDiagnostic>();
  private disposed = false;

  constructor(deps: SurfaceContourServiceDeps) {
    this.deps = deps;
    this.drawingId = deps.drawingId;
  }

  /** Session BUILDING set (contour derivation only — never TIN status). */
  buildingContourIds(): ReadonlySet<string> {
    return new Set(this.pending.keys());
  }

  contourDiagnostics(): ReadonlyMap<string, SurfaceContourSessionDiagnostic> {
    return new Map(this.diagnostics);
  }

  statusOf(
    surfaceId: string,
    geometryRevision: string,
  ): { status: SurfaceContourStatus; stale: boolean } {
    const project = this.deps.getProject();
    const surface = findSurface(project, surfaceId);
    if (!surface) return { status: 'NOT_REQUESTED', stale: false };
    const revision = computeCadSurfaceSourceRevision(project, surface);
    const tinCurrent =
      surface.cachedRevision === revision && this.deps.tinCache.get(surfaceId, revision) != null;
    const cacheHit =
      this.deps.contourCache.get(surfaceId, revision, geometryRevision) != null;
    const retained = this.deps.contourCache.retained(surfaceId);
    return deriveSurfaceContourStatus({
      tinCurrent,
      building: this.pending.has(surfaceId),
      cacheHit,
      diagnostic: this.diagnostics.get(surfaceId)?.error,
      hasStale: retained.length > 0 && !cacheHit,
    });
  }

  requestContours(surfaceId: string, spec: ContourLevelSpec): string {
    if (this.disposed) return 'Surface not found.';
    const project = this.deps.getProject();
    const surface = findSurface(project, surfaceId);
    if (!surface) return 'Surface not found.';
    const revision = computeCadSurfaceSourceRevision(project, surface);
    const geometryRevision = computeContourGeometryRevision(toContourGeometrySpec(spec));
    if (this.deps.contourCache.get(surfaceId, revision, geometryRevision)) {
      return `Contours for “${surface.name}” are already current.`;
    }
    const mesh = this.deps.tinCache.get(surfaceId, revision);
    if (surface.cachedRevision !== revision || !mesh) {
      const error = SURFACE_CONTOUR_STALE_TIN_DIAGNOSTIC;
      this.diagnostics.set(surfaceId, { revision, geometryRevision, error: truncateDiagnostic(error) });
      this.deps.onStateChange();
      return `Contour derivation blocked: parent TIN for “${surface.name}” is not CURRENT — rebuild the surface first.`;
    }
    this.diagnostics.delete(surfaceId);
    const transport = this.transportFor();
    if (!transport) {
      const error = 'Surface contour worker unavailable.';
      this.diagnostics.set(surfaceId, { revision, geometryRevision, error: truncateDiagnostic(error) });
      this.deps.onStateChange();
      return `Contour derivation blocked: worker unavailable for “${surface.name}”.`;
    }
    this.supersede(surfaceId);
    const pendingContours = transport.deriveContours({
      surfaceId,
      surfaceRevision: revision,
      contourGeometryRevision: geometryRevision,
      drawingId: this.drawingId,
      mesh: { points: mesh.points, triangles: mesh.triangles },
      spec,
    });
    this.pending.set(surfaceId, { requestId: pendingContours.requestId, revision, geometryRevision });
    this.deps.onStateChange();
    void pendingContours.done.then(
      (set) => this.complete(surfaceId, pendingContours.requestId, set, null),
      (error) => this.complete(surfaceId, pendingContours.requestId, null, error),
    );
    return `Deriving contours for “${surface.name}”…`;
  }

  /** New TIN revision auto-derives contours when style.showContours holds (lazy — never rebuilds the TIN). */
  notifyMeshBuilt(surfaceId: string, spec: ContourLevelSpec): void {
    if (this.disposed) return;
    if (!this.deps.shouldAutoDerive(surfaceId)) return;
    this.requestContours(surfaceId, spec);
  }

  cancelSurface(surfaceId: string): void {
    this.supersede(surfaceId);
  }

  handleSurfaceDeleted(surfaceId: string): void {
    this.supersede(surfaceId);
    this.deps.contourCache.invalidate(surfaceId);
    this.diagnostics.delete(surfaceId);
    this.deps.onStateChange();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [surfaceId, entry] of this.pending) {
      try {
        this.transport?.cancel(entry.requestId);
      } catch {
        // Superseded derivations settle silently regardless.
      }
      this.pending.delete(surfaceId);
    }
    this.diagnostics.clear();
    try {
      this.transport?.dispose();
    } catch {
      // Disposal never throws.
    }
    this.transport = null;
    this.deps.contourCache.clear();
  }

  private transportFor(): SurfaceContourTransport | null {
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

  private supersede(surfaceId: string): void {
    const entry = this.pending.get(surfaceId);
    if (!entry) return;
    this.pending.delete(surfaceId);
    try {
      this.transport?.cancel(entry.requestId);
    } catch {
      // Superseded derivations settle silently regardless.
    }
    this.deps.onStateChange();
  }

  private complete(
    surfaceId: string,
    requestId: string,
    set: CadSurfaceContourSet | null,
    error: unknown,
  ): void {
    const entry = this.pending.get(surfaceId);
    // Superseded, cancelled, or disposed: a late arrival never applies.
    if (!entry || entry.requestId !== requestId) return;
    this.pending.delete(surfaceId);
    if (set == null && error == null) {
      this.deps.onStateChange();
      return;
    }
    const project = this.deps.getProject();
    const surface = findSurface(project, surfaceId);
    const revision = surface ? computeCadSurfaceSourceRevision(project, surface) : null;
    // Cross-drawing, deleted, or source-changed: discard, never CURRENT.
    if (
      this.disposed ||
      this.deps.getDrawingId() !== this.drawingId ||
      !surface ||
      revision !== entry.revision
    ) {
      this.deps.onStateChange();
      return;
    }
    if (error != null || set == null) {
      const raw = error instanceof Error ? error.message : String(error ?? 'Contour derivation failed.');
      this.diagnostics.set(surfaceId, {
        revision: entry.revision,
        geometryRevision: entry.geometryRevision,
        error: truncateDiagnostic(raw),
      });
      this.deps.onStateChange();
      return;
    }
    // Stale-mesh gating: only the requested (revision, geometry) wins.
    if (set.surfaceRevision !== entry.revision || set.styleRevision !== entry.geometryRevision) {
      this.deps.onStateChange();
      return;
    }
    if (revision !== entry.revision) {
      this.deps.onStateChange();
      return;
    }
    this.deps.contourCache.set(surfaceId, set);
    this.diagnostics.delete(surfaceId);
    this.deps.onStateChange();
  }
}
