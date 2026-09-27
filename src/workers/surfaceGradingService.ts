import { type CadSurfaceGrid } from '../engine/cad/cadSurfaces';
import { getSurfaceElevationAt } from '../engine/cad/cadSurfaceInterpolation';
import type { CadSurfaceCache as CadTinCache } from '../engine/cad/cadSurfaceCache';
import type { CadProject } from '../engine/cad/cadTypes';
import type { CadGradingCache } from '../engine/cad/grading/gradingCache';
import { resolveGradingInputs, type ResolvedGradingInputs } from '../engine/cad/grading/gradingResolve';
import { deriveGradingStatus } from '../engine/cad/grading/gradingStatus';
import type { CadGradingResult, GradingStatus } from '../engine/cad/grading/gradingTypes';
import {
  validateGradingResultAgainstTarget,
  type GradingComputeSource,
} from './surfaceGradingCompute';
import type { SurfaceGradingRequest } from './surfaceWorkerHandler';
import type { PendingSurfaceGrading } from './surfaceWorkerClient';

/**
 * Phase 20B — grade-to-surface derivation control plane (one per session).
 *
 * Mirrors SurfaceVolumeService ownership: request identity is
 * {drawingId, gradingId, revision, requestId}; late, foreign, or stale
 * results NEVER become CURRENT. Manual calculation only (a source/target
 * change never auto-starts grading work): notify* cancels in-flight work
 * for affected gradings and lets status re-derive.
 *
 * Never touches history: Calculate and worker results produce no history
 * entries. Cut/fill coverage blocking and the daylight/target agreement
 * gate both fail closed here (SOURCE_NOT_CURRENT / reject, never CURRENT).
 */

const DIAGNOSTIC_LIMIT = 300;

export interface SurfaceGradingSessionDiagnostic {
  revision: string;
  error: string;
}

/** Minimal transport surface (SurfaceWorkerClient satisfies this). */
export interface SurfaceGradingTransport {
  readonly alive: boolean;
  deriveGrading: (_request: SurfaceGradingRequest) => PendingSurfaceGrading;
  cancel: (_requestId: string) => void;
  dispose: () => void;
}

export interface SurfaceGradingServiceDeps {
  drawingId: string;
  getProject: () => CadProject;
  getDrawingId: () => string;
  tinCache: CadTinCache;
  gradingCache: CadGradingCache;
  createTransport: () => SurfaceGradingTransport | null;
  notify: (_message: string) => void;
  onStateChange: () => void;
}

interface GradingPendingEntry {
  requestId: string;
  revision: string;
  resolvedSource: GradingComputeSource;
}

const truncateDiagnostic = (error: string): string =>
  error.length > DIAGNOSTIC_LIMIT ? `${error.slice(0, DIAGNOSTIC_LIMIT)}…` : error;


/** Flatten a cached TIN mesh to the worker's structured-clone flat arrays. */
const toTargetSnapshot = (
  points: ReadonlyArray<{ x: number; y: number; z: number }>,
  triangles: ReadonlyArray<readonly [number, number, number]>,
): { points: number[]; triangles: number[] } => {
  const flatPoints: number[] = [];
  for (const point of points) flatPoints.push(point.x, point.y, point.z);
  const flatTriangles: number[] = [];
  for (const triangle of triangles) flatTriangles.push(triangle[0], triangle[1], triangle[2]);
  return { points: flatPoints, triangles: flatTriangles };
};

export class SurfaceGradingService {
  private readonly deps: SurfaceGradingServiceDeps;
  private readonly drawingId: string;
  private transport: SurfaceGradingTransport | null = null;
  private transportFailed = false;
  private readonly pending = new Map<string, GradingPendingEntry>();
  private readonly diagnostics = new Map<string, SurfaceGradingSessionDiagnostic>();
  private disposed = false;

  constructor(deps: SurfaceGradingServiceDeps) {
    this.deps = deps;
    this.drawingId = deps.drawingId;
  }

  /** Session BUILDING set (grading derivation only — never definition status). */
  buildingGradingIds(): ReadonlySet<string> {
    return new Set(this.pending.keys());
  }

  gradingDiagnostics(): ReadonlyMap<string, SurfaceGradingSessionDiagnostic> {
    return new Map(this.diagnostics);
  }

  statusOf(gradingId: string): { status: GradingStatus; stale: boolean } {
    const project = this.deps.getProject();
    const inputs = resolveGradingInputs(project, gradingId);
    if (!inputs) return { status: 'BROKEN_REFERENCE', stale: false };
    const targetMesh = this.deps.tinCache.get(inputs.target.id, inputs.targetRevision);
    const retained = this.deps.gradingCache.retained(gradingId);
    const result = this.deps.gradingCache.get(gradingId, inputs.revision) ?? null;
    // A retained stale result (another revision) proves a prior calculation:
    // target/current mismatch then reads NEEDS_RECALC, never false UNBUILT.
    const effective = result ?? (retained.length > 0 ? retained[retained.length - 1]! : null);
    const building = this.pending.has(gradingId);
    let status = deriveGradingStatus({
      courseResolved: true,
      targetCurrent: targetMesh != null,
      targetExists: true,
      sourceExists: true,
      hasResult: effective != null,
      resultRevision: effective?.revision ?? null,
      currentRevision: inputs.revision,
      building,
    });
    // FAILED is set only by the build path (never derived): a recorded
    // worker/agreement failure with no current result reads FAILED.
    if (!building && result == null && this.diagnostics.has(gradingId)) {
      status = 'FAILED';
    }
    return { status, stale: retained.length > 0 && result == null };
  }

  /**
   * Explicit Calculate dispatch (NO history entry). Requires a CURRENT
   * target TIN (else SOURCE_NOT_CURRENT fail-closed); cut/fill source
   * coverage is enforced in the worker (TARGET_GAP fail-closed).
   */
  requestGrading(gradingId: string): string {
    if (this.disposed) return 'Grading not found.';
    const project = this.deps.getProject();
    const inputs = resolveGradingInputs(project, gradingId);
    if (!inputs) return `Grading calculation blocked: grading “${gradingId}” has a broken source or target reference.`;
    const { grading, resolvedSource, target, targetRevision, revision } = inputs;
    // Target currency gates even the already-current shortcut: a lost
    // session mesh reads SOURCE_NOT_CURRENT, never false CURRENT.
    const targetMesh = this.deps.tinCache.get(target.id, targetRevision);
    if (!targetMesh) {
      this.diagnostics.delete(gradingId);
      this.deps.onStateChange();
      return `Grading calculation blocked: target TIN for “${target.name}” is not CURRENT (SOURCE_NOT_CURRENT) — rebuild it first.`;
    }
    if (this.deps.gradingCache.get(gradingId, revision)) {
      return `Grading “${grading.name}” is already current.`;
    }
    this.diagnostics.delete(gradingId);
    const transport = this.transportFor();
    if (!transport) {
      this.diagnostics.set(gradingId, {
        revision,
        error: truncateDiagnostic('Surface grading worker unavailable.'),
      });
      this.deps.onStateChange();
      return `Grading calculation blocked: worker unavailable for “${grading.name}”.`;
    }
    this.supersede(gradingId);
    const pendingGrading = transport.deriveGrading({
      gradingId,
      revision,
      drawingId: this.drawingId,
      source: resolvedSource,
      side: grading.side,
      criterion: grading.criterion,
      maxSearchDistance: grading.maxSearchDistance,
      curveChordTolerance: grading.curveChordTolerance,
      target: toTargetSnapshot(targetMesh.points, targetMesh.triangles),
    });
    this.pending.set(gradingId, { requestId: pendingGrading.requestId, revision, resolvedSource });
    this.deps.onStateChange();
    void pendingGrading.done.then(
      (result) => this.complete(gradingId, pendingGrading.requestId, result, null),
      (error) => this.complete(gradingId, pendingGrading.requestId, null, error),
    );
    return `Computing grading for “${grading.name}”…`;
  }

  /**
   * Manual-calc default: a target rebuild never auto-starts grading work. It
   * cancels in-flight work for affected gradings (their revision moved) and
   * lets status derive NEEDS_RECALC/SOURCE_NOT_CURRENT from the revision.
   */
  notifyTargetBuilt(surfaceId: string): void {
    if (this.disposed) return;
    const project = this.deps.getProject();
    for (const grading of project.gradings ?? []) {
      if (grading.targetSurfaceId === surfaceId) this.supersede(grading.id);
    }
  }

  /** Source feature-line edits never auto-recalculate: cancel in-flight work. */
  notifySourceChanged(featureLineId: string): void {
    if (this.disposed) return;
    const project = this.deps.getProject();
    for (const grading of project.gradings ?? []) {
      if (grading.sourceFeatureLineId === featureLineId) this.supersede(grading.id);
    }
  }

  cancelGrading(gradingId: string): void {
    this.supersede(gradingId);
  }

  handleGradingDeleted(gradingId: string): void {
    this.supersede(gradingId);
    this.deps.gradingCache.invalidate(gradingId);
    this.diagnostics.delete(gradingId);
    this.deps.onStateChange();
  }

  /** Definition edits move the revision: drop the pending run, keep history. */
  handleGradingChanged(gradingId: string): void {
    this.supersede(gradingId);
    this.deps.onStateChange();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [gradingId, entry] of this.pending) {
      try {
        this.transport?.cancel(entry.requestId);
      } catch {
        // Superseded computations settle silently regardless.
      }
      this.pending.delete(gradingId);
    }
    this.diagnostics.clear();
    try {
      this.transport?.dispose();
    } catch {
      // Disposal never throws.
    }
    this.transport = null;
    this.deps.gradingCache.clear();
  }

  private transportFor(): SurfaceGradingTransport | null {
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

  private supersede(gradingId: string): void {
    const entry = this.pending.get(gradingId);
    if (!entry) return;
    this.pending.delete(gradingId);
    try {
      this.transport?.cancel(entry.requestId);
    } catch {
      // Superseded computations settle silently regardless.
    }
    this.deps.onStateChange();
  }

  private complete(
    gradingId: string,
    requestId: string,
    result: CadGradingResult | null,
    error: unknown,
  ): void {
    const entry = this.pending.get(gradingId);
    // Superseded, cancelled, or disposed: a late arrival never applies.
    if (!entry || entry.requestId !== requestId) return;
    this.pending.delete(gradingId);
    if (result == null && error == null) {
      this.deps.onStateChange();
      return;
    }
    const project = this.deps.getProject();
    const inputs = resolveGradingInputs(project, gradingId);
    // Cross-drawing, deleted, or source-changed: discard, never CURRENT.
    if (this.disposed || this.deps.getDrawingId() !== this.drawingId || !inputs) {
      this.deps.onStateChange();
      return;
    }
    if (inputs.revision !== entry.revision) {
      this.deps.onStateChange();
      return;
    }
    if (error != null || result == null) {
      const raw = error instanceof Error ? error.message : String(error ?? 'Grading computation failed.');
      this.diagnostics.set(gradingId, { revision: entry.revision, error: truncateDiagnostic(raw) });
      this.deps.onStateChange();
      return;
    }
    // Stale-mesh gating: only the requested revision wins.
    if (result.revision !== entry.revision || result.gradingId !== gradingId) {
      this.deps.onStateChange();
      return;
    }
    // Daylight/target agreement gate: reject tampered or drifted geometry.
    const gateReject = this.agreementReject(inputs, entry, result);
    if (gateReject) {
      this.diagnostics.set(gradingId, { revision: entry.revision, error: truncateDiagnostic(gateReject) });
      this.deps.onStateChange();
      return;
    }
    this.deps.gradingCache.set(gradingId, result);
    this.diagnostics.delete(gradingId);
    this.deps.onStateChange();
  }

  /** GO-gate: daylight ↔ CURRENT target agreement + source boundary equality. */
  private agreementReject(
    inputs: ResolvedGradingInputs,
    entry: GradingPendingEntry,
    result: CadGradingResult,
  ): string | null {
    const targetMesh = this.deps.tinCache.get(inputs.target.id, inputs.targetRevision);
    if (!targetMesh) return 'Grading agreement rejected: target TIN is not CURRENT.';
    const build = {
      outcome: 'ok' as const,
      points: targetMesh.points,
      triangles: targetMesh.triangles,
      grid: targetMesh.grid as CadSurfaceGrid,
    };
    const query = {
      elevationAt: (x: number, y: number) =>
        getSurfaceElevationAt(
          build as unknown as Parameters<typeof getSurfaceElevationAt>[0],
          x,
          y,
        ),
    };
    const atSource = (u: number): { x: number; y: number; z: number } => {
      const src = entry.resolvedSource;
      const len = Math.hypot(src.endX - src.startX, src.endY - src.startY);
      const gs = (src.endZ - src.startZ) / src.length;
      return {
        x: src.startX + ((src.endX - src.startX) / len) * u,
        y: src.startY + ((src.endY - src.startY) / len) * u,
        z: src.startZ + gs * u,
      };
    };
    return validateGradingResultAgainstTarget(result.daylightPoints, query, {
      first: atSource(0),
      last: atSource(entry.resolvedSource.length),
      expectedFirst: { x: inputs.resolvedSource.startX, y: inputs.resolvedSource.startY, z: inputs.resolvedSource.startZ },
      expectedLast: { x: inputs.resolvedSource.endX, y: inputs.resolvedSource.endY, z: inputs.resolvedSource.endZ },
    });
  }
}
