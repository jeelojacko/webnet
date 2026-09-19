import { computeCadSurfaceSourceRevision, deriveSurfaceStatus } from '../engine/cad/cadSurfaces';
import type { CadSurfaceGrid } from '../engine/cad/cadSurfaces';
import type { CadSurfaceCache as CadTinCache } from '../engine/cad/cadSurfaceCache';
import type { CadProfileCache } from '../engine/cad/profileCache';
import { computeSurfaceProfileRevision } from '../engine/cad/cadProfileRevision';
import { deriveSurfaceProfileStatus } from '../engine/cad/cadProfileStatus';
import type {
  CadAlignmentElement,
  CadProject,
  CadStationEquation,
  CadSurfaceProfile,
  SurfaceProfileStatus,
} from '../engine/cad/cadTypes';
import type { CadSurfaceProfileResult } from '../engine/cad/profiles/profileExtraction';
import type { PendingSurfaceProfile } from './surfaceWorkerClient';
import type { SurfaceProfileRequest } from './surfaceWorkerHandler';

/**
 * Phase 18J — surface-profile derivation control plane (one per session).
 *
 * Mirrors SurfaceVolumeService ownership: request identity is
 * {drawingId, profileId, profileRevision, requestId}; late, foreign, or
 * stale results NEVER become CURRENT. Manual derivation only (a source
 * rebuild or alignment edit never auto-starts profile work):
 * `notifyMeshBuilt`/`notifyAlignmentChanged` cancel in-flight work for
 * affected profiles and let status re-derive from the revision.
 *
 * Never touches the TIN cache or history: a profile FAILURE leaves the
 * source TIN CURRENT and surface inquiries working. Requests block when
 * the source TIN is not CURRENT for the current revision.
 */

const DIAGNOSTIC_LIMIT = 300;

export interface SurfaceProfileSessionDiagnostic {
  revision: string;
  error: string;
}

/** Minimal transport surface (SurfaceWorkerClient satisfies this). */
export interface SurfaceProfileTransport {
  readonly alive: boolean;
  deriveProfile: (_request: SurfaceProfileRequest) => PendingSurfaceProfile;
  cancel: (_requestId: string) => void;
  dispose: () => void;
}

export interface SurfaceProfileServiceDeps {
  drawingId: string;
  getProject: () => CadProject;
  getDrawingId: () => string;
  tinCache: CadTinCache;
  profileCache: CadProfileCache;
  createTransport: () => SurfaceProfileTransport | null;
  notify: (_message: string) => void;
  onStateChange: () => void;
}

interface ProfilePendingEntry {
  requestId: string;
  revision: string;
  surfaceRevision: string;
}

interface ProfileBuiltInfo {
  revision: string;
  surfaceRevision: string;
}

const truncateDiagnostic = (error: string): string =>
  error.length > DIAGNOSTIC_LIMIT ? `${error.slice(0, DIAGNOSTIC_LIMIT)}…` : error;

const findProfile = (project: CadProject, profileId: string) =>
  (project.surfaceProfiles ?? []).find((entry) => entry.id === profileId);

const findSurface = (project: CadProject, surfaceId: string) =>
  (project.surfaces ?? []).find((entry) => entry.id === surfaceId);

const findAlignment = (project: CadProject, alignmentId: string) => {
  const entity = (project.entities ?? []).find((entry) => entry.id === alignmentId);
  if (!entity || entity.type !== 'alignment') return null;
  return entity;
};

/** Current content revision of a profile definition (re-derived by every caller). */
const profileRevisionOf = (
  profile: Pick<CadSurfaceProfile, 'id' | 'alignmentEntityId' | 'surfaceId'>,
  alignment: NonNullable<ReturnType<typeof findAlignment>>,
  surfaceRevision: string | null,
): string =>
  computeSurfaceProfileRevision(
    profile,
    {
      id: alignment.id,
      elements: alignment.elements as readonly CadAlignmentElement[],
      startStation: alignment.startStation,
      ...(alignment.stationEquations != null
        ? { stationEquations: alignment.stationEquations as CadStationEquation[] }
        : {}),
    },
    surfaceRevision,
  );

/** Flatten cached TIN meshes to the worker's structured-clone flat arrays. */
const toProfileMesh = (
  points: ReadonlyArray<{ x: number; y: number; z: number }>,
  triangles: ReadonlyArray<readonly [number, number, number]>,
  grid: CadSurfaceGrid,
): { points: number[]; triangles: number[]; grid: CadSurfaceGrid } => {
  const flatPoints: number[] = [];
  for (const point of points) flatPoints.push(point.x, point.y, point.z);
  const flatTriangles: number[] = [];
  for (const triangle of triangles) flatTriangles.push(triangle[0], triangle[1], triangle[2]);
  return { points: flatPoints, triangles: flatTriangles, grid };
};

export class SurfaceProfileService {
  private readonly deps: SurfaceProfileServiceDeps;
  private readonly drawingId: string;
  private transport: SurfaceProfileTransport | null = null;
  private transportFailed = false;
  private readonly pending = new Map<string, ProfilePendingEntry>();
  private readonly built = new Map<string, ProfileBuiltInfo>();
  private readonly diagnostics = new Map<string, SurfaceProfileSessionDiagnostic>();
  private disposed = false;

  constructor(deps: SurfaceProfileServiceDeps) {
    this.deps = deps;
    this.drawingId = deps.drawingId;
  }

  /** Session BUILDING set (profile derivation only — never TIN status). */
  buildingProfileIds(): ReadonlySet<string> {
    return new Set(this.pending.keys());
  }

  profileDiagnostics(): ReadonlyMap<string, SurfaceProfileSessionDiagnostic> {
    return new Map(this.diagnostics);
  }

  statusOf(profileId: string): { status: SurfaceProfileStatus; stale: boolean } {
    const project = this.deps.getProject();
    const profile = findProfile(project, profileId);
    if (!profile) return { status: 'BROKEN_REFERENCE', stale: false };
    const alignment = findAlignment(project, profile.alignmentEntityId);
    const surface = findSurface(project, profile.surfaceId);
    if (!alignment || !surface) return { status: 'BROKEN_REFERENCE', stale: false };
    const currentSurfaceRevision = computeCadSurfaceSourceRevision(project, surface);
    const currentRevision = profileRevisionOf(profile, alignment, currentSurfaceRevision);
    const retained = this.deps.profileCache.retained(profileId);
    const newest = retained.length > 0 ? retained[retained.length - 1]! : null;
    const built = this.built.get(profileId);
    // Revision re-derivation guard: recompute the revision with the
    // retained result's surface revision. A match means the definition
    // (alignment/profile) is unchanged and only the surface moved — the
    // stale result still counts (NEEDS_REBUILD). A mismatch means the
    // definition itself moved — the retained result must NEVER read as
    // CURRENT (UNBUILT instead).
    const surfaceOnlyChanged =
      newest != null &&
      built != null &&
      newest.revision === built.revision &&
      newest.revision !== currentRevision &&
      profileRevisionOf(profile, alignment, built.surfaceRevision) === newest.revision;
    const hasResult =
      newest != null && (newest.revision === currentRevision || surfaceOnlyChanged);
    const status = deriveSurfaceProfileStatus({
      profileExists: true,
      alignmentExists: true,
      // Session TIN currency is the cache hit (cachedRevision is never
      // written in-session); otherwise fall back to the derived status.
      surfaceStatus:
        this.deps.tinCache.get(surface.id, currentSurfaceRevision) != null
          ? 'CURRENT'
          : deriveSurfaceStatus(project, surface),
      surfaceRevisionAtBuild: newest?.revision === built?.revision ? (built?.surfaceRevision ?? null) : null,
      currentSurfaceRevision,
      hasResult,
      building: this.pending.has(profileId),
      ...(this.diagnostics.has(profileId)
        ? { diagnostic: this.diagnostics.get(profileId)?.error }
        : {}),
      ...(newest ? { hasOverlap: newest.coveredLength > 0 } : {}),
    });
    return {
      status,
      stale: retained.length > 0 && this.deps.profileCache.get(profileId, currentRevision) == null,
    };
  }

  requestProfile(profileId: string): string {
    if (this.disposed) return 'Surface profile not found.';
    const project = this.deps.getProject();
    const profile = findProfile(project, profileId);
    if (!profile) return 'Surface profile not found.';
    const alignment = findAlignment(project, profile.alignmentEntityId);
    const surface = findSurface(project, profile.surfaceId);
    if (!alignment || !surface) {
      return `Profile derivation blocked: “${profile.name}” has a missing alignment or surface reference.`;
    }
    const surfaceRevision = computeCadSurfaceSourceRevision(project, surface);
    const revision = profileRevisionOf(profile, alignment, surfaceRevision);
    if (this.deps.profileCache.get(profileId, revision)) {
      return `Profile for “${profile.name}” is already current.`;
    }
    const mesh = this.deps.tinCache.get(surface.id, surfaceRevision);
    if (!mesh) {
      this.diagnostics.delete(profileId);
      this.deps.onStateChange();
      return `Profile derivation blocked: source TIN for “${surface.name}” is not CURRENT — rebuild it first.`;
    }
    this.diagnostics.delete(profileId);
    const transport = this.transportFor();
    if (!transport) {
      this.diagnostics.set(profileId, {
        revision,
        error: truncateDiagnostic('Surface profile worker unavailable.'),
      });
      this.deps.onStateChange();
      return `Profile derivation blocked: worker unavailable for “${profile.name}”.`;
    }
    this.supersede(profileId);
    const pendingProfile = transport.deriveProfile({
      profileId,
      profileRevision: revision,
      drawingId: this.drawingId,
      surfaceRevision,
      alignmentElements: [...(alignment.elements as readonly CadAlignmentElement[])],
      startStation: alignment.startStation,
      ...(alignment.stationEquations != null
        ? { stationEquations: [...(alignment.stationEquations as CadStationEquation[])] }
        : {}),
      mesh: toProfileMesh(mesh.points, mesh.triangles, mesh.grid),
    });
    this.pending.set(profileId, {
      requestId: pendingProfile.requestId,
      revision,
      surfaceRevision,
    });
    this.deps.onStateChange();
    void pendingProfile.done.then(
      (result) => this.complete(profileId, pendingProfile.requestId, result, null),
      (error) => this.complete(profileId, pendingProfile.requestId, null, error),
    );
    return `Computing profile for “${profile.name}”…`;
  }

  /**
   * Manual-derivation default: a source rebuild never auto-starts profile
   * work. It cancels in-flight work for affected profiles (their revision
   * moved) and lets status derive NEEDS_REBUILD from the revision.
   */
  notifyMeshBuilt(surfaceId: string): void {
    if (this.disposed) return;
    const project = this.deps.getProject();
    for (const profile of project.surfaceProfiles ?? []) {
      if (profile.surfaceId === surfaceId) {
        this.supersede(profile.id);
      }
    }
  }

  /**
   * Alignment edits never auto-rederive either: cancel in-flight work for
   * bound profiles; the revision guard keeps stale results from CURRENT.
   */
  notifyAlignmentChanged(alignmentId: string): void {
    if (this.disposed) return;
    const project = this.deps.getProject();
    for (const profile of project.surfaceProfiles ?? []) {
      if (profile.alignmentEntityId === alignmentId) {
        this.supersede(profile.id);
      }
    }
  }

  cancelProfile(profileId: string): void {
    this.supersede(profileId);
  }

  handleProfileDeleted(profileId: string): void {
    this.supersede(profileId);
    this.deps.profileCache.invalidate(profileId);
    this.built.delete(profileId);
    this.diagnostics.delete(profileId);
    this.deps.onStateChange();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [profileId, entry] of this.pending) {
      try {
        this.transport?.cancel(entry.requestId);
      } catch {
        // Superseded derivations settle silently regardless.
      }
      this.pending.delete(profileId);
    }
    this.built.clear();
    this.diagnostics.clear();
    try {
      this.transport?.dispose();
    } catch {
      // Disposal never throws.
    }
    this.transport = null;
    this.deps.profileCache.clear();
  }

  private transportFor(): SurfaceProfileTransport | null {
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

  private supersede(profileId: string): void {
    const entry = this.pending.get(profileId);
    if (!entry) return;
    this.pending.delete(profileId);
    try {
      this.transport?.cancel(entry.requestId);
    } catch {
      // Superseded derivations settle silently regardless.
    }
    this.deps.onStateChange();
  }

  private complete(
    profileId: string,
    requestId: string,
    result: CadSurfaceProfileResult | null,
    error: unknown,
  ): void {
    const entry = this.pending.get(profileId);
    // Superseded, cancelled, or disposed: a late arrival never applies.
    if (!entry || entry.requestId !== requestId) return;
    this.pending.delete(profileId);
    if (result == null && error == null) {
      this.deps.onStateChange();
      return;
    }
    const project = this.deps.getProject();
    const profile = findProfile(project, profileId);
    const alignment = profile ? findAlignment(project, profile.alignmentEntityId) : null;
    const surface = profile ? findSurface(project, profile.surfaceId) : undefined;
    const revision =
      profile && alignment && surface
        ? profileRevisionOf(
            profile,
            alignment,
            computeCadSurfaceSourceRevision(project, surface),
          )
        : null;
    // Cross-drawing, deleted, or source-changed: discard, never CURRENT.
    if (this.disposed || this.deps.getDrawingId() !== this.drawingId || revision !== entry.revision) {
      this.deps.onStateChange();
      return;
    }
    if (error != null || result == null) {
      const raw = error instanceof Error ? error.message : String(error ?? 'Profile derivation failed.');
      this.diagnostics.set(profileId, {
        revision: entry.revision,
        error: truncateDiagnostic(raw),
      });
      this.deps.onStateChange();
      return;
    }
    // Stale-mesh gating: only the requested revision wins.
    if (result.profileId !== profileId || result.revision !== entry.revision) {
      this.deps.onStateChange();
      return;
    }
    this.deps.profileCache.set(profileId, result);
    this.built.set(profileId, { revision: entry.revision, surfaceRevision: entry.surfaceRevision });
    this.diagnostics.delete(profileId);
    this.deps.onStateChange();
  }
}
