/**
 * STRUCT-194.5 — profile / section service lifecycles.
 *
 * Extracted verbatim from `SurveyCadWorkspace` with no behavior change. Holds
 * the two alignment-driven derivation control planes that mirror the volume
 * service ownership:
 *   - the per-drawing profile cache + version and the one-worker
 *     `SurfaceProfileService` (+ disposal),
 *   - the per-drawing section cache + version and the one-worker
 *     `SurfaceSectionService` (+ disposal),
 *   - the two source-rebuild / alignment-edit notify effects per service
 *     (revision-array diff and `JSON.stringify(entity)` digest diff, each
 *     firing only on a genuine change) and the profile / section
 *     snapshot-input memos.
 *
 * Called once, unconditionally, immediately after the
 * volume/grading/analysis lifecycle at the exact former `profileCache`
 * position, so the flattened hook order is unchanged. The profile and section
 * diff refs are independent and persist across a `drawingId` change (the
 * notify effects key on the live sessions/project, not the drawing) exactly as
 * the original per-render refs did. Manual derivation only: source rebuilds
 * and alignment edits never auto-start work; the notify hooks cancel in-flight
 * work and status re-derives from the revision.
 *
 * Worker URL note: the original `../workers/surfaceWorker.ts` resolved from
 * `src/components`; from `src/hooks/surveyCad` the same module is addressed as
 * `../../workers/surfaceWorker.ts` (verified `src/workers/surfaceWorker.ts`).
 * The `Worker`-undefined / construction-throw fallback is byte-identical.
 */
import { useEffect, useMemo, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { CadProject } from '../../engine/cad/cadTypes';
import type { CadSurfaceCache } from '../../engine/cad/cadSurfaceCache';
import {
  createCadProfileCache,
  type CadProfileCache,
} from '../../engine/cad/profileCache';
import {
  createCadSectionCache,
  type CadSectionCache,
} from '../../engine/cad/sectionCache';
import { SurfaceWorkerClient } from '../../workers/surfaceWorkerClient';
import {
  SurfaceProfileService,
  type SurfaceProfileSessionDiagnostic,
} from '../../workers/surfaceProfileService';
import { SurfaceSectionService } from '../../workers/surfaceSectionService';

/**
 * Shared worker-transport factory (both services). Resolves the SAME
 * `src/workers/surfaceWorker.ts` module the pre-extraction root used; the
 * `Worker`-undefined / construction-throw fallback is null (byte-identical).
 */
const createSurfaceWorkerTransport = (): SurfaceWorkerClient | null => {
  try {
    if (typeof Worker === 'undefined') return null;
    return new SurfaceWorkerClient(
      new Worker(new URL('../../workers/surfaceWorker.ts', import.meta.url), {
        type: 'module',
      }),
    );
  } catch {
    return null;
  }
};

/**
 * Source-rebuild hookup: only a NEW mesh revision for a surface cancels
 * in-flight work (their revision moved). A ref diff guards it — notifying on
 * every render would supersede work that was just requested.
 */
const useMeshRevisionNotify = (
  surfaceMeshSessions: Record<string, string[]>,
  service: { notifyMeshBuilt: (_surfaceId: string) => void },
): void => {
  const notifiedRef = useRef<Record<string, string[]>>({});
  useEffect(() => {
    const previous = notifiedRef.current;
    for (const [surfaceId, revisions] of Object.entries(surfaceMeshSessions)) {
      const seen = previous[surfaceId] ?? [];
      if (revisions.length !== seen.length || revisions.some((entry, index) => entry !== seen[index])) {
        service.notifyMeshBuilt(surfaceId);
      }
    }
    notifiedRef.current = surfaceMeshSessions;
  }, [surfaceMeshSessions, service]);
};

/**
 * Alignment-edit hookup: only a CHANGED alignment entity cancels in-flight
 * work for bound results (revision guard keeps stale results from CURRENT).
 * `JSON.stringify(entity)` digest diff — not a per-render notify.
 */
const useAlignmentDigestNotify = (
  project: CadProject,
  service: { notifyAlignmentChanged: (_alignmentId: string) => void },
): void => {
  const notifiedRef = useRef<Record<string, string>>({});
  useEffect(() => {
    const previous = notifiedRef.current;
    const next: Record<string, string> = {};
    for (const entity of project.entities) {
      if (entity.type !== 'alignment') continue;
      const digest = JSON.stringify(entity);
      next[entity.id] = digest;
      if (previous[entity.id] != null && previous[entity.id] !== digest) {
        service.notifyAlignmentChanged(entity.id);
      }
    }
    notifiedRef.current = next;
  }, [project, service]);
};

export interface SurveyCadProfileSectionLifecycleArgs {
  /** Live drawing id; keys both caches + services. */
  drawingId: string;
  /** Live project driving the alignment-digest effects. */
  project: CadProject;
  /** Parent TIN cache from the surface-build lifecycle. */
  surfaceCache: CadSurfaceCache;
  /** Session mesh revisions driving the source-rebuild notify effects. */
  surfaceMeshSessions: Record<string, string[]>;
  /** Live project ref from the surface-build lifecycle. */
  activeProjectForBuildsRef: RefObject<CadProject>;
  /** Live drawing-id ref from the surface-build lifecycle. */
  drawingIdForBuildsRef: RefObject<string>;
  setFileStatusText: Dispatch<SetStateAction<string>>;
}

/** Profile snapshot inputs, refreshed only on a service state transition. */
export interface SurveyCadSurfaceProfileInputs {
  version: number;
  tinCache: CadSurfaceCache;
  profileCache: CadProfileCache;
  buildingProfileIds: ReadonlySet<string>;
  sessionDiagnostics: ReadonlyMap<string, SurfaceProfileSessionDiagnostic>;
}

/** Section snapshot inputs, refreshed on the same transition. */
export interface SurveyCadSurfaceSectionInputs {
  version: number;
  sectionCache: CadSectionCache;
  buildingGroupIds: ReadonlySet<string>;
}

export interface SurveyCadProfileSectionLifecycle {
  profileCache: CadProfileCache;
  profileService: SurfaceProfileService;
  surfaceProfileInputs: SurveyCadSurfaceProfileInputs;
  sectionCache: CadSectionCache;
  sectionService: SurfaceSectionService;
  surfaceSectionInputs: SurveyCadSurfaceSectionInputs;
}

export const useSurveyCadProfileSectionLifecycle = ({
  drawingId,
  project,
  surfaceCache,
  surfaceMeshSessions,
  activeProjectForBuildsRef,
  drawingIdForBuildsRef,
  setFileStatusText,
}: SurveyCadProfileSectionLifecycleArgs): SurveyCadProfileSectionLifecycle => {
  // Phase 18J — profile derivation control plane (one per drawing session,
  // mirrors SurfaceVolumeService ownership). Manual derivation only: source
  // rebuilds and alignment edits never auto-start profile work; the notify
  // hooks cancel in-flight work for affected profiles and status re-derives
  // from the revision. Results never persist.
  const profileCache = useMemo(
    () => createCadProfileCache(drawingId),
    [drawingId],
  );
  const [profileVersion, setProfileVersion] = useState(0);
  const profileService = useMemo(
    () =>
      new SurfaceProfileService({
        drawingId,
        getProject: () => activeProjectForBuildsRef.current,
        getDrawingId: () => drawingIdForBuildsRef.current,
        tinCache: surfaceCache,
        profileCache,
        createTransport: createSurfaceWorkerTransport,
        notify: (message) => setFileStatusText(message),
        onStateChange: () => setProfileVersion((version) => version + 1),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [drawingId, surfaceCache, profileCache],
  );
  useEffect(() => () => profileService.dispose(), [profileService]);
  useMeshRevisionNotify(surfaceMeshSessions, profileService);
  useAlignmentDigestNotify(project, profileService);
  // Scene + snapshot inputs refresh only when the service reports a
  // state change (pending/diagnostic transitions), not on every render.
  const surfaceProfileInputs = useMemo(
    () => ({
      version: profileVersion,
      tinCache: surfaceCache,
      profileCache,
      buildingProfileIds: profileService.buildingProfileIds(),
      sessionDiagnostics: profileService.profileDiagnostics(),
    }),
    [profileService, profileVersion, surfaceCache, profileCache],
  );
  // Phase 18K — section derivation control plane (one per drawing session,
  // mirrors the profile service). Manual derivation only: source rebuilds and
  // alignment edits never auto-start section work; the notify hooks cancel
  // in-flight batches for affected groups and status re-derives from the
  // revision. Results never persist.
  const sectionCache = useMemo(
    () => createCadSectionCache(drawingId),
    [drawingId],
  );
  const [sectionVersion, setSectionVersion] = useState(0);
  const sectionService = useMemo(
    () =>
      new SurfaceSectionService({
        drawingId,
        getProject: () => activeProjectForBuildsRef.current,
        getDrawingId: () => drawingIdForBuildsRef.current,
        tinCache: surfaceCache,
        sectionCache,
        createTransport: createSurfaceWorkerTransport,
        notify: (message) => setFileStatusText(message),
        onStateChange: () => setSectionVersion((version) => version + 1),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [drawingId, surfaceCache, sectionCache],
  );
  useEffect(() => () => sectionService.dispose(), [sectionService]);
  useMeshRevisionNotify(surfaceMeshSessions, sectionService);
  useAlignmentDigestNotify(project, sectionService);
  const surfaceSectionInputs = useMemo(
    () => ({
      version: sectionVersion,
      sectionCache,
      buildingGroupIds: sectionService.buildingGroupIds(),
    }),
    [sectionService, sectionVersion, sectionCache],
  );
  return {
    profileCache,
    profileService,
    surfaceProfileInputs,
    sectionCache,
    sectionService,
    surfaceSectionInputs,
  };
};
