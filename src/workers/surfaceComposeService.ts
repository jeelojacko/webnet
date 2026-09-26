import { computeCadSurfaceSourceRevision } from '../engine/cad/cadSurfaces';
import type { CadSurfaceCache as CadTinCache } from '../engine/cad/cadSurfaceCache';
import {
  SURFACE_COMPOSE_EMPTY,
  SURFACE_COMPOSE_SAME_SOURCE,
  SURFACE_COMPOSE_STALE_REVISION,
} from '../engine/cad/cadTransactionsSurfaceComposeCommands';
import type { CadProject } from '../engine/cad/cadTypes';
import type {
  SurfaceComposePolicy,
  SurfaceComposeRequest,
  SurfaceComposeResultPayload,
} from './surfaceWorkerHandler';
import type { PendingSurfaceCompose } from './surfaceWorkerClient';

/**
 * Phase 18Y — exact two-surface composition control plane (one per session).
 *
 * Mirrors SurfaceVolumeService ownership: request identity is
 * {drawingId, baseId@baseRevision, overlayId@overlayRevision, policy,
 * requestId}; late, foreign, or stale results NEVER apply. The worker only
 * computes the composed topology — history mutation lives in the
 * SURFCOMPOSE / SURFCOMPOSEPASTE transactions, which the UI dispatches from
 * `applyCompose`. A composition FAILURE or discard leaves both sources
 * byte-identical and CURRENT.
 *
 * Requests block when either source TIN is not CURRENT for the current
 * revision (the worker needs both meshes). Same-source pairs are rejected
 * before a worker is created.
 */

const DIAGNOSTIC_LIMIT = 300;

export interface SurfaceComposeSessionDiagnostic {
  revision: string;
  error: string;
}

/** Minimal transport surface (SurfaceWorkerClient satisfies this). */
export interface SurfaceComposeTransport {
  readonly alive: boolean;
  deriveCompose: (_request: SurfaceComposeRequest) => PendingSurfaceCompose;
  cancel: (_requestId: string) => void;
  dispose: () => void;
}

/** Composed, still-uncommitted payload handed to the history-owning caller. */
export interface SurfaceComposeComputed {
  baseSurfaceId: string;
  baseRevision: string;
  overlaySurfaceId: string;
  overlayRevision: string;
  policy: SurfaceComposePolicy;
  vertices: number[];
  faces: number[];
  diagnostics: SurfaceComposeResultPayload['diagnostics'];
}

export interface SurfaceComposeRequestSpec {
  baseSurfaceId: string;
  overlaySurfaceId: string;
  policy: SurfaceComposePolicy;
}

export interface SurfaceComposeServiceDeps {
  drawingId: string;
  getProject: () => CadProject;
  getDrawingId: () => string;
  tinCache: CadTinCache;
  createTransport: () => SurfaceComposeTransport | null;
  notify: (_message: string) => void;
  onStateChange: () => void;
  /** UI-owned history dispatch. The service (and the worker) never mutate it. */
  applyCompose: (_computed: SurfaceComposeComputed) => void;
}

interface ComposePendingEntry {
  requestId: string;
  baseSurfaceId: string;
  overlaySurfaceId: string;
  baseRevision: string;
  overlayRevision: string;
  policy: SurfaceComposePolicy;
}

const truncateDiagnostic = (error: string): string =>
  error.length > DIAGNOSTIC_LIMIT ? `${error.slice(0, DIAGNOSTIC_LIMIT)}…` : error;

const findSurface = (project: CadProject, surfaceId: string) =>
  (project.surfaces ?? []).find((entry) => entry.id === surfaceId);

const ownershipKey = (
  baseSurfaceId: string,
  overlaySurfaceId: string,
  policy: SurfaceComposePolicy,
): string => `${baseSurfaceId}|${overlaySurfaceId}|${policy.id}`;

/** Flatten a cached TIN mesh to the worker's structured-clone flat arrays. */
const toComposeMesh = (
  points: ReadonlyArray<{ x: number; y: number; z: number }>,
  triangles: ReadonlyArray<readonly [number, number, number]>,
): { points: number[]; triangles: number[] } => {
  const flatPoints: number[] = [];
  for (const point of points) flatPoints.push(point.x, point.y, point.z);
  const flatTriangles: number[] = [];
  for (const triangle of triangles) flatTriangles.push(triangle[0], triangle[1], triangle[2]);
  return { points: flatPoints, triangles: flatTriangles };
};

export class SurfaceComposeService {
  private readonly deps: SurfaceComposeServiceDeps;
  private readonly drawingId: string;
  private transport: SurfaceComposeTransport | null = null;
  private transportFailed = false;
  private readonly pending = new Map<string, ComposePendingEntry>();
  private readonly diagnostics = new Map<string, SurfaceComposeSessionDiagnostic>();
  private disposed = false;

  constructor(deps: SurfaceComposeServiceDeps) {
    this.deps = deps;
    this.drawingId = deps.drawingId;
  }

  /** Session in-flight composition keys (base|overlay|policy). */
  buildingComposeKeys(): ReadonlySet<string> {
    return new Set(this.pending.keys());
  }

  composeDiagnostics(): ReadonlyMap<string, SurfaceComposeSessionDiagnostic> {
    return new Map(this.diagnostics);
  }

  isBuilding(spec: SurfaceComposeRequestSpec): boolean {
    return this.pending.has(ownershipKey(spec.baseSurfaceId, spec.overlaySurfaceId, spec.policy));
  }

  /**
   * Manual compose request. Resolves both source meshes from the session TIN
   * cache at their current revisions and asks the worker for the composed
   * topology. Latest-wins per ownership key. Returns a user-facing message;
   * a successful completion dispatches `applyCompose` exactly once.
   */
  requestCompose(spec: SurfaceComposeRequestSpec): string {
    if (this.disposed) return 'Composition unavailable.';
    const project = this.deps.getProject();
    const base = findSurface(project, spec.baseSurfaceId);
    const overlay = findSurface(project, spec.overlaySurfaceId);
    if (!base || !overlay) return 'Composition blocked: a source surface is missing.';
    if (base.id === overlay.id) return SURFACE_COMPOSE_SAME_SOURCE;
    const baseRevision = computeCadSurfaceSourceRevision(project, base);
    const overlayRevision = computeCadSurfaceSourceRevision(project, overlay);
    const baseMesh = this.deps.tinCache.get(base.id, baseRevision);
    const overlayMesh = this.deps.tinCache.get(overlay.id, overlayRevision);
    if (!baseMesh || !overlayMesh) {
      const missing = !baseMesh ? base.name : overlay.name;
      return `Composition blocked: source TIN for “${missing}” is not CURRENT — rebuild it first.`;
    }
    const key = ownershipKey(base.id, overlay.id, spec.policy);
    const transport = this.transportFor();
    if (!transport) {
      this.diagnostics.set(key, {
        revision: `${baseRevision}|${overlayRevision}`,
        error: truncateDiagnostic('Surface compose worker unavailable.'),
      });
      this.deps.onStateChange();
      return 'Composition blocked: worker unavailable.';
    }
    this.diagnostics.delete(key);
    this.supersede(key);
    const pendingCompose = transport.deriveCompose({
      drawingId: this.drawingId,
      base: {
        surfaceId: base.id,
        surfaceName: base.name,
        revision: baseRevision,
        mesh: toComposeMesh(baseMesh.points, baseMesh.triangles),
      },
      overlay: {
        surfaceId: overlay.id,
        surfaceName: overlay.name,
        revision: overlayRevision,
        mesh: toComposeMesh(overlayMesh.points, overlayMesh.triangles),
      },
      policy: spec.policy,
    });
    this.pending.set(key, {
      requestId: pendingCompose.requestId,
      baseSurfaceId: base.id,
      overlaySurfaceId: overlay.id,
      baseRevision,
      overlayRevision,
      policy: spec.policy,
    });
    this.deps.onStateChange();
    void pendingCompose.done.then(
      (result) => this.complete(key, pendingCompose.requestId, result, null),
      (error) => this.complete(key, pendingCompose.requestId, null, error),
    );
    return `Composing “${base.name}” + “${overlay.name}”…`;
  }

  cancelCompose(spec: SurfaceComposeRequestSpec): void {
    this.supersede(ownershipKey(spec.baseSurfaceId, spec.overlaySurfaceId, spec.policy));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [key, entry] of this.pending) {
      try {
        this.transport?.cancel(entry.requestId);
      } catch {
        // Superseded compositions settle silently regardless.
      }
      this.pending.delete(key);
    }
    this.diagnostics.clear();
    try {
      this.transport?.dispose();
    } catch {
      // Disposal never throws.
    }
    this.transport = null;
  }

  private transportFor(): SurfaceComposeTransport | null {
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

  private supersede(key: string): void {
    const entry = this.pending.get(key);
    if (!entry) return;
    this.pending.delete(key);
    try {
      this.transport?.cancel(entry.requestId);
    } catch {
      // Superseded compositions settle silently regardless.
    }
    this.deps.onStateChange();
  }

  private complete(
    key: string,
    requestId: string,
    result: SurfaceComposeResultPayload | null,
    error: unknown,
  ): void {
    const entry = this.pending.get(key);
    // Superseded, cancelled, or disposed: a late arrival never applies.
    if (!entry || entry.requestId !== requestId) return;
    this.pending.delete(key);
    if (this.disposed || this.deps.getDrawingId() !== this.drawingId) {
      this.deps.onStateChange();
      return;
    }
    if (error != null) {
      const raw = error instanceof Error ? error.message : String(error);
      this.diagnostics.set(key, {
        revision: `${entry.baseRevision}|${entry.overlayRevision}`,
        error: truncateDiagnostic(raw),
      });
      this.deps.onStateChange();
      return;
    }
    if (result == null) {
      this.deps.onStateChange();
      return;
    }
    const project = this.deps.getProject();
    const base = findSurface(project, entry.baseSurfaceId);
    const overlay = findSurface(project, entry.overlaySurfaceId);
    if (!base || !overlay) {
      this.deps.onStateChange();
      return;
    }
    // Revision-change discard: a source definition moved while the worker ran.
    const baseRevision = computeCadSurfaceSourceRevision(project, base);
    const overlayRevision = computeCadSurfaceSourceRevision(project, overlay);
    if (baseRevision !== entry.baseRevision || overlayRevision !== entry.overlayRevision) {
      this.deps.notify(SURFACE_COMPOSE_STALE_REVISION);
      this.deps.onStateChange();
      return;
    }
    if (result.vertices.length < 9 || result.faces.length < 3) {
      this.deps.notify(SURFACE_COMPOSE_EMPTY);
      this.deps.onStateChange();
      return;
    }
    this.deps.applyCompose({
      baseSurfaceId: base.id,
      baseRevision,
      overlaySurfaceId: overlay.id,
      overlayRevision,
      policy: entry.policy,
      vertices: result.vertices,
      faces: result.faces,
      diagnostics: result.diagnostics,
    });
    this.deps.onStateChange();
  }
}
