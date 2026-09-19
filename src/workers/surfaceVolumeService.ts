import { computeCadSurfaceSourceRevision } from '../engine/cad/cadSurfaces';
import type { CadSurfaceCache as CadTinCache } from '../engine/cad/cadSurfaceCache';
import type { CadSurfaceVolumeCache } from '../engine/cad/surfaceVolumeCache';
import {
  backfillVolumeSurfaceStyles,
  computeVolumeSurfaceRevision,
  deriveVolumeSurfaceStatus,
  VOLUME_STYLE_CUT_FILL_ID,
} from '../engine/cad/cadVolumeSurfaces';
import type { CadProject, CadVolumeResult, VolumeSurfaceStatus } from '../engine/cad/cadTypes';
import type { SurfaceVolumeRequest } from './surfaceWorkerHandler';
import type { PendingSurfaceVolume } from './surfaceWorkerClient';

/**
 * Phase 18I — TIN-to-TIN volume derivation control plane (one per session).
 *
 * Mirrors SurfaceContourService ownership: request identity is
 * {drawingId, volumeSurfaceId, volumeRevision, requestId}; late, foreign, or
 * stale results NEVER become CURRENT. Manual calculation only (a source
 * rebuild never auto-starts volume work): `notifyMeshBuilt` cancels
 * in-flight work for affected volumes and lets status derive stale.
 *
 * Never touches the TIN cache or history: a volume FAILURE leaves both
 * source TINs CURRENT and surface inquiries working. Requests block when
 * either source TIN is not CURRENT for the current revision.
 */

const DIAGNOSTIC_LIMIT = 300;

export interface SurfaceVolumeSessionDiagnostic {
  revision: string;
  error: string;
}

/** Minimal transport surface (SurfaceWorkerClient satisfies this). */
export interface SurfaceVolumeTransport {
  readonly alive: boolean;
  deriveVolume: (_request: SurfaceVolumeRequest) => PendingSurfaceVolume;
  cancel: (_requestId: string) => void;
  dispose: () => void;
}

export interface SurfaceVolumeServiceDeps {
  drawingId: string;
  getProject: () => CadProject;
  getDrawingId: () => string;
  tinCache: CadTinCache;
  volumeCache: CadSurfaceVolumeCache;
  createTransport: () => SurfaceVolumeTransport | null;
  notify: (_message: string) => void;
  onStateChange: () => void;
}

interface VolumePendingEntry {
  requestId: string;
  revision: string;
}

const truncateDiagnostic = (error: string): string =>
  error.length > DIAGNOSTIC_LIMIT ? `${error.slice(0, DIAGNOSTIC_LIMIT)}…` : error;

const findVolume = (project: CadProject, volumeSurfaceId: string) =>
  (project.volumeSurfaces ?? []).find((entry) => entry.id === volumeSurfaceId);

const findSurface = (project: CadProject, surfaceId: string) =>
  (project.surfaces ?? []).find((entry) => entry.id === surfaceId);

/** Flatten cached TIN meshes to the worker's structured-clone flat arrays. */
const toVolumeMesh = (
  points: ReadonlyArray<{ x: number; y: number; z: number }>,
  triangles: ReadonlyArray<readonly [number, number, number]>,
): { points: number[]; triangles: number[] } => {
  const flatPoints: number[] = [];
  for (const point of points) flatPoints.push(point.x, point.y, point.z);
  const flatTriangles: number[] = [];
  for (const triangle of triangles) flatTriangles.push(triangle[0], triangle[1], triangle[2]);
  return { points: flatPoints, triangles: flatTriangles };
};

export class SurfaceVolumeService {
  private readonly deps: SurfaceVolumeServiceDeps;
  private readonly drawingId: string;
  private transport: SurfaceVolumeTransport | null = null;
  private transportFailed = false;
  private readonly pending = new Map<string, VolumePendingEntry>();
  private readonly diagnostics = new Map<string, SurfaceVolumeSessionDiagnostic>();
  private disposed = false;

  constructor(deps: SurfaceVolumeServiceDeps) {
    this.deps = deps;
    this.drawingId = deps.drawingId;
  }

  /** Session BUILDING set (volume derivation only — never TIN status). */
  buildingVolumeIds(): ReadonlySet<string> {
    return new Set(this.pending.keys());
  }

  volumeDiagnostics(): ReadonlyMap<string, SurfaceVolumeSessionDiagnostic> {
    return new Map(this.diagnostics);
  }

  statusOf(volumeSurfaceId: string): { status: VolumeSurfaceStatus; stale: boolean } {
    const project = this.deps.getProject();
    const volume = findVolume(project, volumeSurfaceId);
    if (!volume) return { status: 'BROKEN_REFERENCE', stale: false };
    const base = findSurface(project, volume.baseSurfaceId);
    const comparison = findSurface(project, volume.comparisonSurfaceId);
    const baseRevision = base ? computeCadSurfaceSourceRevision(project, base) : null;
    const comparisonRevision = comparison ? computeCadSurfaceSourceRevision(project, comparison) : null;
    const revision =
      base && comparison
        ? computeVolumeSurfaceRevision({
            baseId: base.id,
            baseRev: baseRevision,
            cmpId: comparison.id,
            cmpRev: comparisonRevision,
          })
        : null;
    const result = revision != null ? this.deps.volumeCache.get(volumeSurfaceId, revision) ?? null : null;
    const retained = this.deps.volumeCache.retained(volumeSurfaceId);
    const status = deriveVolumeSurfaceStatus(project, volume, {
      building: this.pending.has(volumeSurfaceId),
      result,
      ...(base && baseRevision != null
        ? { baseCurrent: this.deps.tinCache.get(base.id, baseRevision) != null }
        : {}),
      ...(comparison && comparisonRevision != null
        ? { comparisonCurrent: this.deps.tinCache.get(comparison.id, comparisonRevision) != null }
        : {}),
      ...(this.diagnostics.has(volumeSurfaceId)
        ? { diagnostic: this.diagnostics.get(volumeSurfaceId)?.error }
        : {}),
    });
    return { status, stale: retained.length > 0 && result == null };
  }

  requestVolume(volumeSurfaceId: string): string {
    if (this.disposed) return 'Volume surface not found.';
    const project = this.deps.getProject();
    const volume = findVolume(project, volumeSurfaceId);
    if (!volume) return 'Volume surface not found.';
    const base = findSurface(project, volume.baseSurfaceId);
    const comparison = findSurface(project, volume.comparisonSurfaceId);
    if (!base || !comparison || base.id === comparison.id) {
      return `Volume calculation blocked: “${volume.name}” has a missing or invalid source surface.`;
    }
    const baseRevision = computeCadSurfaceSourceRevision(project, base);
    const comparisonRevision = computeCadSurfaceSourceRevision(project, comparison);
    const revision = computeVolumeSurfaceRevision({
      baseId: base.id,
      baseRev: baseRevision,
      cmpId: comparison.id,
      cmpRev: comparisonRevision,
    });
    if (this.deps.volumeCache.get(volumeSurfaceId, revision)) {
      return `Volumes for “${volume.name}” are already current.`;
    }
    const baseMesh = this.deps.tinCache.get(base.id, baseRevision);
    const comparisonMesh = this.deps.tinCache.get(comparison.id, comparisonRevision);
    if (!baseMesh || !comparisonMesh) {
      this.diagnostics.delete(volumeSurfaceId);
      this.deps.onStateChange();
      const missing = !baseMesh ? base.name : comparison.name;
      return `Volume calculation blocked: source TIN for “${missing}” is not CURRENT — rebuild it first.`;
    }
    this.diagnostics.delete(volumeSurfaceId);
    const transport = this.transportFor();
    if (!transport) {
      this.diagnostics.set(volumeSurfaceId, {
        revision,
        error: truncateDiagnostic('Surface volume worker unavailable.'),
      });
      this.deps.onStateChange();
      return `Volume calculation blocked: worker unavailable for “${volume.name}”.`;
    }
    this.supersede(volumeSurfaceId);
    const pendingVolume = transport.deriveVolume({
      volumeSurfaceId,
      volumeRevision: revision,
      drawingId: this.drawingId,
      base: { surfaceId: base.id, mesh: toVolumeMesh(baseMesh.points, baseMesh.triangles) },
      comparison: {
        surfaceId: comparison.id,
        mesh: toVolumeMesh(comparisonMesh.points, comparisonMesh.triangles),
      },
      includeDisplay: this.includeDisplay(project, volume.styleId),
    });
    this.pending.set(volumeSurfaceId, { requestId: pendingVolume.requestId, revision });
    this.deps.onStateChange();
    void pendingVolume.done.then(
      (result) => this.complete(volumeSurfaceId, pendingVolume.requestId, result, null),
      (error) => this.complete(volumeSurfaceId, pendingVolume.requestId, null, error),
    );
    return `Computing volumes for “${volume.name}”…`;
  }

  /**
   * Manual-calc default: a source rebuild never auto-starts volume work. It
   * cancels in-flight work for affected volumes (their revision moved) and
   * lets status derive NEEDS_RECALC/SOURCE_NOT_CURRENT from the revision.
   */
  notifyMeshBuilt(surfaceId: string): void {
    if (this.disposed) return;
    const project = this.deps.getProject();
    for (const volume of project.volumeSurfaces ?? []) {
      if (volume.baseSurfaceId === surfaceId || volume.comparisonSurfaceId === surfaceId) {
        this.supersede(volume.id);
      }
    }
  }

  cancelVolume(volumeSurfaceId: string): void {
    this.supersede(volumeSurfaceId);
  }

  handleVolumeDeleted(volumeSurfaceId: string): void {
    this.supersede(volumeSurfaceId);
    this.deps.volumeCache.invalidate(volumeSurfaceId);
    this.diagnostics.delete(volumeSurfaceId);
    this.deps.onStateChange();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [volumeId, entry] of this.pending) {
      try {
        this.transport?.cancel(entry.requestId);
      } catch {
        // Superseded computations settle silently regardless.
      }
      this.pending.delete(volumeId);
    }
    this.diagnostics.clear();
    try {
      this.transport?.dispose();
    } catch {
      // Disposal never throws.
    }
    this.transport = null;
    this.deps.volumeCache.clear();
  }

  private includeDisplay(project: CadProject, styleId: string | undefined): boolean {
    const style = backfillVolumeSurfaceStyles(project.volumeSurfaceStyles).find(
      (entry) => entry.id === (styleId ?? VOLUME_STYLE_CUT_FILL_ID),
    );
    return style ? style.showCut || style.showFill : true;
  }

  private transportFor(): SurfaceVolumeTransport | null {
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

  private supersede(volumeSurfaceId: string): void {
    const entry = this.pending.get(volumeSurfaceId);
    if (!entry) return;
    this.pending.delete(volumeSurfaceId);
    try {
      this.transport?.cancel(entry.requestId);
    } catch {
      // Superseded computations settle silently regardless.
    }
    this.deps.onStateChange();
  }

  private complete(
    volumeSurfaceId: string,
    requestId: string,
    result: CadVolumeResult | null,
    error: unknown,
  ): void {
    const entry = this.pending.get(volumeSurfaceId);
    // Superseded, cancelled, or disposed: a late arrival never applies.
    if (!entry || entry.requestId !== requestId) return;
    this.pending.delete(volumeSurfaceId);
    if (result == null && error == null) {
      this.deps.onStateChange();
      return;
    }
    const project = this.deps.getProject();
    const volume = findVolume(project, volumeSurfaceId);
    const base = volume ? findSurface(project, volume.baseSurfaceId) : undefined;
    const comparison = volume ? findSurface(project, volume.comparisonSurfaceId) : undefined;
    const revision =
      volume && base && comparison
        ? computeVolumeSurfaceRevision({
            baseId: base.id,
            baseRev: computeCadSurfaceSourceRevision(project, base),
            cmpId: comparison.id,
            cmpRev: computeCadSurfaceSourceRevision(project, comparison),
          })
        : null;
    // Cross-drawing, deleted, or source-changed: discard, never CURRENT.
    if (this.disposed || this.deps.getDrawingId() !== this.drawingId || revision !== entry.revision) {
      this.deps.onStateChange();
      return;
    }
    if (error != null || result == null) {
      const raw = error instanceof Error ? error.message : String(error ?? 'Volume computation failed.');
      this.diagnostics.set(volumeSurfaceId, {
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
    this.deps.volumeCache.set(volumeSurfaceId, result);
    this.diagnostics.delete(volumeSurfaceId);
    this.deps.onStateChange();
  }
}
