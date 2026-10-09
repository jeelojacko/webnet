/**
 * STRUCT-194.4 — early surface-build lifecycle.
 *
 * Extracted verbatim from `SurveyCadWorkspace` with no behavior change. Holds
 * the session TIN state and the production `SurfaceBuildService`:
 *   - the per-surface bounded built-revision index (`surfaceMeshSessions`),
 *   - the per-drawing TIN cache (`surfaceCache`) and its revision index,
 *   - the three live refs late worker completions guard against
 *     (`activeProjectForBuildsRef` / `drawingIdForBuildsRef` /
 *     `surfaceMeshSessionsForBuildsRef`), assigned synchronously every render,
 *   - the build state version, the one-worker-per-drawing service, its
 *     disposal effect, and the revision-keyed snapshot inputs.
 *
 * Called once, unconditionally, immediately before the contour lifecycle at
 * the exact former surface/contour render position, so the primitive hook
 * order (useState/useMemo/useRef/useEffect) and state identity are unchanged.
 *
 * Worker URL note: the original `../workers/surfaceWorker.ts` resolved from
 * `src/components`; from `src/hooks/surveyCad` the same module is addressed as
 * `../../workers/surfaceWorker.ts` (verified `src/workers/surfaceWorker.ts`).
 * The `Worker`-undefined / construction-throw fallback is byte-identical.
 */
import { useEffect, useMemo, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { createCadSurfaceCache, type CadSurfaceCache } from '../../engine/cad/cadSurfaceCache';
import type { CadProject } from '../../engine/cad/cadTypes';
import { SurfaceWorkerClient } from '../../workers/surfaceWorkerClient';
import {
  SurfaceBuildService,
  type SurfaceBuildSessionDiagnostic,
} from '../../workers/surfaceBuildService';

export interface SurveyCadSurfaceBuildLifecycleArgs {
  /** Live drawing id; keys the TIN cache + service, never the project. */
  activeDrawingId: string;
  /** Live project mirrored into the build ref every render. */
  cadProject: CadProject;
  setFileStatusText: (_text: string) => void;
}

export interface SurveyCadSurfaceBuildInputs {
  buildVersion: number;
  buildingSurfaceIds: ReadonlySet<string>;
  sessionDiagnostics: ReadonlyMap<string, SurfaceBuildSessionDiagnostic>;
  syncFallbackRevisions: ReadonlyMap<string, string>;
}

export interface SurveyCadSurfaceBuildLifecycle {
  surfaceMeshSessions: Record<string, string[]>;
  setSurfaceMeshSessions: Dispatch<SetStateAction<Record<string, string[]>>>;
  surfaceCache: CadSurfaceCache;
  surfaceRevisionIndex: ReadonlyMap<string, string[]>;
  surfaceBuildService: SurfaceBuildService;
  surfaceBuildVersion: number;
  surfaceBuildInputs: SurveyCadSurfaceBuildInputs;
  activeProjectForBuildsRef: RefObject<CadProject>;
  drawingIdForBuildsRef: RefObject<string>;
  surfaceMeshSessionsForBuildsRef: RefObject<Record<string, string[]>>;
}

export const useSurveyCadSurfaceBuildLifecycle = ({
  activeDrawingId,
  cadProject,
  setFileStatusText,
}: SurveyCadSurfaceBuildLifecycleArgs): SurveyCadSurfaceBuildLifecycle => {
  const [surfaceMeshSessions, setSurfaceMeshSessions] = useState<Record<string, string[]>>({});
  const surfaceCache = useMemo(
    () => createCadSurfaceCache(activeDrawingId),
    [activeDrawingId],
  );
  const surfaceRevisionIndex = useMemo(
    () => new Map(Object.entries(surfaceMeshSessions)),
    [surfaceMeshSessions],
  );
  // Phase 18G — production builds run through the surface build service
  // (one worker per drawing session; async completion populates the
  // session mesh cache). Refs mirror render state so late worker
  // completions always guard against the live project/drawing.
  const activeProjectForBuildsRef = useRef(cadProject);
  activeProjectForBuildsRef.current = cadProject;
  const drawingIdForBuildsRef = useRef(activeDrawingId);
  drawingIdForBuildsRef.current = activeDrawingId;
  const surfaceMeshSessionsForBuildsRef = useRef(surfaceMeshSessions);
  surfaceMeshSessionsForBuildsRef.current = surfaceMeshSessions;
  const [surfaceBuildVersion, setSurfaceBuildVersion] = useState(0);
  const surfaceBuildService = useMemo(
    () =>
      new SurfaceBuildService({
        drawingId: activeDrawingId,
        getProject: () => activeProjectForBuildsRef.current,
        getDrawingId: () => drawingIdForBuildsRef.current,
        cache: surfaceCache,
        createTransport: () => {
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
        },
        getBuiltRevisions: (surfaceId) => surfaceMeshSessionsForBuildsRef.current[surfaceId] ?? [],
        // Bounded index: current + ≤1 previous stale revision per surface.
        recordRevision: (surfaceId, revision) =>
          setSurfaceMeshSessions((previous) => ({
            ...previous,
            [surfaceId]: [...(previous[surfaceId] ?? []), revision].slice(-2),
          })),
        notify: (message) => setFileStatusText(message),
        onStateChange: () => setSurfaceBuildVersion((version) => version + 1),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeDrawingId, surfaceCache],
  );
  useEffect(() => () => surfaceBuildService.dispose(), [surfaceBuildService]);
  // Snapshot inputs refresh only when the service reports a state change
  // (pending/diagnostic transitions), not on every render.
  const surfaceBuildInputs = useMemo(
    () => ({
      // Version tag: refreshes snapshot inputs whenever the service reports
      // a state change (pending/diagnostic transitions), not on every render.
      buildVersion: surfaceBuildVersion,
      buildingSurfaceIds: surfaceBuildService.buildingSurfaceIds(),
      sessionDiagnostics: surfaceBuildService.sessionDiagnostics(),
      syncFallbackRevisions: surfaceBuildService.syncFallbackRevisions(),
    }),
    [surfaceBuildService, surfaceBuildVersion],
  );
  return {
    surfaceMeshSessions,
    setSurfaceMeshSessions,
    surfaceCache,
    surfaceRevisionIndex,
    surfaceBuildService,
    surfaceBuildVersion,
    surfaceBuildInputs,
    activeProjectForBuildsRef,
    drawingIdForBuildsRef,
    surfaceMeshSessionsForBuildsRef,
  };
};
