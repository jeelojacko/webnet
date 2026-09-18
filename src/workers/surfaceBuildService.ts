import {
  applySurfaceBuildSuccess,
  type CadSurfaceCache,
} from '../engine/cad/cadSurfaceCache';
import {
  buildCadSurface,
  computeCadSurfaceSourceRevision,
  type CadSurfaceBuildResult,
} from '../engine/cad/cadSurfaces';
import { buildSurfaceBuildRequest } from '../engine/cad/cadSurfaceTypes';
import type { CadProject } from '../engine/cad/cadTypes';
import type { TinAdjacency, TinEdgeKinds } from '../engine/cad/tin/tinTypes';
import {
  SURFACE_BUILD_UNAVAILABLE,
  type SurfaceBuildTransport,
  type SurfaceWorkerMesh,
} from './surfaceWorkerClient';

/**
 * Phase 18G — production surface build service (control plane only).
 *
 * Owns the worker request lifecycle for one drawing session: requestId +
 * surfaceId + sourceRevision + drawing id, pending tracking with
 * cancel/supersede per surface, serialized rebuild-all queue through the
 * single worker, session BUILDING/FAILED state, and bounded sync fallback.
 *
 * Session-only: completions populate the mesh cache and the built-revision
 * index; the worker-apply helpers are reused as the latest-wins guard but
 * the returned project is discarded (rebuild never enters history and
 * never dirties the drawing — CURRENT derives from the session cache hit,
 * exactly like the 18F sync path). Worker result meshes are treated
 * opaquely and passed through untouched.
 *
 * Sync fallback budget: docs/evidence/phase18f-surface-performance.md
 * measures ~11 ms engine + ~2 ms display edges for 1,000 points (Node 22),
 * comfortably main-thread-safe; 10k costs ~120 ms and 50k stays
 * sub-second for the engine but needs browser QA. The fallback therefore
 * allows ≤1000 snapshot points and blocks above it — never a silent 50k
 * main-thread triangulation.
 */

export const SYNC_FALLBACK_POINT_LIMIT = 1000;
const DIAGNOSTIC_LIMIT = 300;

export interface SurfaceBuildSessionDiagnostic {
  revision: string;
  error: string;
}

export interface SurfaceBuildServiceDeps {
  drawingId: string;
  getProject: () => CadProject;
  getDrawingId: () => string;
  cache: CadSurfaceCache;
  /** Null/throw = Worker construction failed → bounded sync fallback. */
  createTransport: () => SurfaceBuildTransport | null;
  syncBuild?: (_project: CadProject, _surfaceId: string) => CadSurfaceBuildResult;
  getBuiltRevisions: (_surfaceId: string) => readonly string[];
  recordRevision: (_surfaceId: string, _revision: string) => void;
  notify: (_message: string) => void;
  onStateChange: () => void;
}

interface PendingEntry {
  requestId: string;
  revision: string;
  queued: boolean;
  startedAt: number;
}

const truncateDiagnostic = (error: string): string =>
  error.length > DIAGNOSTIC_LIMIT ? `${error.slice(0, DIAGNOSTIC_LIMIT)}…` : error;

const findSurface = (project: CadProject, surfaceId: string) =>
  (project.surfaces ?? []).find((entry) => entry.id === surfaceId);

export class SurfaceBuildService {
  private readonly deps: SurfaceBuildServiceDeps;
  private readonly drawingId: string;
  private transport: SurfaceBuildTransport | null = null;
  private transportFailed = false;
  private readonly pending = new Map<string, PendingEntry>();
  private readonly diagnostics = new Map<string, SurfaceBuildSessionDiagnostic>();
  private readonly queue: string[] = [];
  private queueActive = false;
  private tally = { rebuilt: 0, current: 0, blocked: 0 };
  private disposed = false;
  /** surfaceId -> revision last built via the sync fallback (route seam). */
  private readonly fallbackRoutes = new Map<string, string>();

  constructor(deps: SurfaceBuildServiceDeps) {
    this.deps = deps;
    this.drawingId = deps.drawingId;
  }

  /** Session BUILDING set for the snapshot seam (drawing-scoped). */
  buildingSurfaceIds(): ReadonlySet<string> {
    return new Set(this.pending.keys());
  }

  /** Session failure diagnostics for the snapshot seam (revision-scoped). */
  sessionDiagnostics(): ReadonlyMap<string, SurfaceBuildSessionDiagnostic> {
    return new Map(this.diagnostics);
  }

  /** Revisions whose CURRENT mesh came from the sync fallback, by surface. */
  syncFallbackRevisions(): ReadonlyMap<string, string> {
    return new Map(this.fallbackRoutes);
  }

  rebuildSurface(surfaceId: string): string {
    if (this.disposed) return 'Surface not found.';
    const project = this.deps.getProject();
    const surface = findSurface(project, surfaceId);
    if (!surface) return 'Surface not found.';
    const revision = computeCadSurfaceSourceRevision(project, surface);
    if (this.deps.cache.get(surfaceId, revision)) {
      return `“${surface.name}” is already current.`;
    }
    this.diagnostics.delete(surfaceId);
    const request = buildSurfaceBuildRequest(project, surfaceId, revision);
    if (!request) return 'Surface not found.';
    const transport = this.transportFor();
    if (!transport) return this.syncFallback(surfaceId, surface.name, request.points.length, false);
    this.supersede(surfaceId);
    const pendingBuild = transport.build({ ...request, drawingId: this.drawingId });
    this.pending.set(surfaceId, {
      requestId: pendingBuild.requestId,
      revision,
      queued: false,
      startedAt: Date.now(),
    });
    this.deps.onStateChange();
    void pendingBuild.done.then(
      (mesh) => this.complete(surfaceId, pendingBuild.requestId, mesh, null),
      (error) => this.complete(surfaceId, pendingBuild.requestId, null, error),
    );
    return `“${surface.name}” building…`;
  }

  rebuildAllSurfaces(): string {
    if (this.disposed) return 'No surfaces to rebuild.';
    const project = this.deps.getProject();
    const surfaces = project.surfaces ?? [];
    if (surfaces.length === 0) return 'No surfaces to rebuild.';
    this.queue.length = 0;
    this.tally = { rebuilt: 0, current: 0, blocked: 0 };
    for (const surface of surfaces) {
      const revision = computeCadSurfaceSourceRevision(project, surface);
      if (this.deps.cache.get(surface.id, revision)) this.tally.current += 1;
      else this.queue.push(surface.id);
    }
    if (this.queue.length === 0) return this.summary();
    this.queueActive = true;
    const total = this.queue.length;
    this.pumpQueue();
    return total === 1 ? 'Rebuilding 1 surface…' : `Rebuilding ${total} surfaces…`;
  }

  cancelSurface(surfaceId: string): void {
    this.supersede(surfaceId);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.queue.length = 0;
    this.queueActive = false;
    for (const [surfaceId, entry] of this.pending) {
      this.transport?.cancel(entry.requestId);
      this.pending.delete(surfaceId);
    }
    this.diagnostics.clear();
    this.fallbackRoutes.clear();
    try {
      this.transport?.dispose();
    } catch {
      // Disposal never throws.
    }
    this.transport = null;
    this.deps.cache.clear();
  }

  private summary(): string {
    return `Rebuilt ${this.tally.rebuilt}, already current ${this.tally.current}, ${this.tally.blocked} not built.`;
  }

  private transportFor(): SurfaceBuildTransport | null {
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

  private dropTransport(): void {
    try {
      this.transport?.dispose();
    } catch {
      // Death path never throws.
    }
    this.transport = null;
  }

  private supersede(surfaceId: string): void {
    const entry = this.pending.get(surfaceId);
    if (!entry) return;
    this.pending.delete(surfaceId);
    try {
      this.transport?.cancel(entry.requestId);
    } catch {
      // Superseded builds settle silently regardless.
    }
    this.deps.onStateChange();
  }

  private pumpQueue(): void {
    if (!this.queueActive || this.disposed) return;
    const nextId = this.queue.shift();
    if (nextId == null) {
      this.queueActive = false;
      this.deps.notify(this.summary());
      return;
    }
    const project = this.deps.getProject();
    const surface = findSurface(project, nextId);
    if (!surface) {
      this.tally.blocked += 1;
      this.pumpQueue();
      return;
    }
    const revision = computeCadSurfaceSourceRevision(project, surface);
    if (this.deps.cache.get(nextId, revision)) {
      this.tally.current += 1;
      this.pumpQueue();
      return;
    }
    const request = buildSurfaceBuildRequest(project, nextId, revision);
    if (!request) {
      this.tally.blocked += 1;
      this.pumpQueue();
      return;
    }
    const transport = this.transportFor();
    if (!transport) {
      this.syncFallback(nextId, surface.name, request.points.length, true);
      this.pumpQueue();
      return;
    }
    this.supersede(nextId);
    const pendingBuild = transport.build({ ...request, drawingId: this.drawingId });
    this.pending.set(nextId, {
      requestId: pendingBuild.requestId,
      revision,
      queued: true,
      startedAt: Date.now(),
    });
    this.deps.onStateChange();
    void pendingBuild.done.then(
      (mesh) => this.complete(nextId, pendingBuild.requestId, mesh, null),
      (error) => this.complete(nextId, pendingBuild.requestId, null, error),
    );
  }

  private syncFallback(surfaceId: string, name: string, pointCount: number, queued: boolean): string {
    if (pointCount > SYNC_FALLBACK_POINT_LIMIT) {
      const error =
        `worker unavailable (surface exceeds ${SYNC_FALLBACK_POINT_LIMIT}-point sync fallback limit)`;
      const project = this.deps.getProject();
      const surface = findSurface(project, surfaceId);
      const revision = surface ? computeCadSurfaceSourceRevision(project, surface) : '';
      this.diagnostics.set(surfaceId, { revision, error: truncateDiagnostic(error) });
      this.deps.onStateChange();
      const message = `“${name}” build blocked: worker unavailable and the surface exceeds the ${SYNC_FALLBACK_POINT_LIMIT}-point sync fallback limit.`;
      if (queued) this.tally.blocked += 1;
      else this.deps.notify(message);
      return message;
    }
    let result: CadSurfaceBuildResult;
    try {
      const project = this.deps.getProject();
      result = (this.deps.syncBuild ?? defaultSyncBuild)(project, surfaceId);
    } catch (error) {
      const message = `“${name}” rebuild failed: ${error instanceof Error ? error.message : 'unknown error'}. (sync fallback — worker unavailable)`;
      if (queued) this.tally.blocked += 1;
      else this.deps.notify(message);
      return message;
    }
    if (result.outcome !== 'ok') {
      const detail = result.reasonCodes.length > 0 ? `: ${result.reasonCodes.join(', ')}` : '.';
      const message = result.outcome === 'insufficient'
        ? `“${name}” has insufficient data${detail} (sync fallback — worker unavailable)`
        : `“${name}” build blocked${detail} (sync fallback — worker unavailable)`;
      if (queued) this.tally.blocked += 1;
      else this.deps.notify(message);
      return message;
    }
    this.storeMesh(surfaceId, result.revision, {
      outcome: result.outcome,
      revision: result.revision,
      reasonCodes: result.reasonCodes,
      points: result.points,
      triangles: result.triangles,
      stats: result.stats,
      grid: result.grid,
      adjacency: result.adjacency,
      edgeKinds: result.edgeKinds,
    });
    this.diagnostics.delete(surfaceId);
    this.fallbackRoutes.set(surfaceId, result.revision);
    this.deps.onStateChange();
    const message = `“${name}” rebuilt: ${result.stats.triangleCount} triangles from ${result.stats.usedPointCount} points. (sync fallback — worker unavailable)`;
    if (queued) this.tally.rebuilt += 1;
    else this.deps.notify(message);
    return message;
  }

  private complete(
    surfaceId: string,
    requestId: string,
    mesh: SurfaceWorkerMesh | null,
    error: unknown,
  ): void {
    const entry = this.pending.get(surfaceId);
    // Superseded, cancelled, or disposed: a late arrival never applies.
    if (!entry || entry.requestId !== requestId) return;
    this.pending.delete(surfaceId);
    if (mesh == null && error == null) {
      this.deps.onStateChange();
      if (entry.queued) this.pumpQueue();
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
      if (entry.queued) this.pumpQueue();
      return;
    }
    if (error != null) {
      if (this.transport && !this.transport.alive) this.dropTransport();
      const raw = error instanceof Error ? error.message : String(error);
      this.diagnostics.set(surfaceId, { revision: entry.revision, error: truncateDiagnostic(raw) });
      this.deps.onStateChange();
      const message = `“${surface.name}” rebuild failed: ${raw}.`;
      if (entry.queued) {
        this.tally.blocked += 1;
        this.pumpQueue();
      } else {
        this.deps.notify(message);
      }
      return;
    }
    const result = mesh!;
    if (result.revision !== entry.revision) {
      this.deps.onStateChange();
      if (entry.queued) this.pumpQueue();
      return;
    }
    // Non-ok engine outcome: nothing cached (the apply helper enforces
    // this too); status derives from the definition itself
    // (INSUFFICIENT_DATA/FAILED), message only.
    if (result.outcome !== 'ok') {
      const detail = result.reasonCodes.length > 0 ? `: ${result.reasonCodes.join(', ')}` : '.';
      const message = result.outcome === 'insufficient'
        ? `“${surface.name}” has insufficient data${detail}`
        : `“${surface.name}” build blocked${detail}`;
      this.deps.onStateChange();
      if (entry.queued) {
        this.tally.blocked += 1;
        this.pumpQueue();
      } else {
        this.deps.notify(message);
      }
      return;
    }
    // Latest-wins guard + cache population; the returned project is
    // discarded on purpose (rebuild never enters history/dirties).
    const guarded = applySurfaceBuildSuccess(project, this.deps.cache, surfaceId, entry.revision, result);
    if (guarded === project) {
      this.deps.onStateChange();
      if (entry.queued) this.pumpQueue();
      return;
    }
    this.storeMeshBounded(surfaceId, entry.revision);
    this.deps.recordRevision(surfaceId, entry.revision);
    this.fallbackRoutes.delete(surfaceId);
    this.diagnostics.delete(surfaceId);
    this.deps.onStateChange();
    const message = `“${surface.name}” rebuilt: ${result.stats.triangleCount} triangles from ${result.stats.usedPointCount} points.`;
    if (entry.queued) {
      this.tally.rebuilt += 1;
      this.pumpQueue();
    } else {
      this.deps.notify(message);
    }
  }

  private storeMesh(surfaceId: string, revision: string, mesh: SurfaceWorkerMesh): void {
    this.deps.cache.set(surfaceId, revision, {
      revision,
      points: mesh.points.map((point) => ({ ...point })),
      triangles: mesh.triangles.map((tri) => [tri[0], tri[1], tri[2]] as [number, number, number]),
      stats: { ...mesh.stats },
      grid: {
        minX: mesh.grid.minX,
        minY: mesh.grid.minY,
        cellSize: mesh.grid.cellSize,
        cells: new Map([...mesh.grid.cells].map(([key, list]) => [key, [...list]] as [string, number[]])),
      },
      adjacency: mesh.adjacency.map((row) => [row[0], row[1], row[2]] as TinAdjacency),
      edgeKinds: mesh.edgeKinds.map((row) => [row[0], row[1], row[2]] as TinEdgeKinds),
    });
    this.storeMeshBounded(surfaceId, revision);
    this.deps.recordRevision(surfaceId, revision);
  }

  /**
   * Bounded cache policy (current + ≤1 previous stale revision per
   * surface) without touching cadSurfaceCache: re-set the keepers around
   * an invalidate, since the cache exposes no single-revision delete.
   */
  private storeMeshBounded(surfaceId: string, revision: string): void {
    const previous = this.deps.getBuiltRevisions(surfaceId).filter((entry) => entry !== revision);
    const keep = [...previous, revision].slice(-2);
    const keepers = new Map(
      keep.map((entry) => [entry, this.deps.cache.get(surfaceId, entry)] as const),
    );
    this.deps.cache.invalidate(surfaceId);
    for (const [entry, mesh] of keepers) {
      if (mesh) this.deps.cache.set(surfaceId, entry, mesh);
    }
  }
}

const defaultSyncBuild = (project: CadProject, surfaceId: string): CadSurfaceBuildResult => {
  const surface = findSurface(project, surfaceId);
  if (!surface) throw new Error('Surface not found.');
  return buildCadSurface(project, surface);
};

export const surfaceWorkerUnavailableMessage = SURFACE_BUILD_UNAVAILABLE;
