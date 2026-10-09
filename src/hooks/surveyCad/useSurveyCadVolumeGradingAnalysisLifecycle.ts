/**
 * STRUCT-194.5 — volume / grading / group / analysis service lifecycles.
 *
 * Extracted verbatim from `SurveyCadWorkspace` with no behavior change. Holds
 * the derivation control planes that consume the per-drawing TIN cache:
 *   - the one-worker `SurfaceVolumeService` (+ disposal),
 *   - the one-worker `SurfaceGradingService` (+ disposal) and its
 *     pending-request reconciliation sweep,
 *   - the grading / grading-group snapshot-input memos,
 *   - the one-worker analysis control plane (`createCadAnalysisControlPlane`)
 *     (+ disposal; worker-backed with the sync fallback when workers are
 *     unavailable).
 *
 * The early primitive state/memos that key these services (`volumeCache`,
 * `volumeVersion`, `gradingCache`, `gradingVersion`, `groupCache`,
 * `analysisVersion`) deliberately stay in the root at their original position
 * so the flattened hook order is unchanged; this hook receives them through
 * grouped typed contexts and returns the long-lived services the remaining
 * root effects/snapshots consume.
 *
 * Called once, unconditionally, at the exact former `volumeService` position
 * (after the build + contour lifecycles, before the profile + section
 * lifecycle). Manual Calculate only: source rebuilds never auto-start work; the
 * reconciliation sweep cancels stale pending work and never starts Calculate.
 *
 * Worker URL note: the original `../workers/surfaceWorker.ts` resolved from
 * `src/components`; from `src/hooks/surveyCad` the same module is addressed as
 * `../../workers/surfaceWorker.ts` (verified `src/workers/surfaceWorker.ts`).
 * The `Worker`-undefined / construction-throw fallback is byte-identical.
 */
import { useEffect, useMemo, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { CadProject } from '../../engine/cad/cadTypes';
import type { CadSurfaceCache } from '../../engine/cad/cadSurfaceCache';
import type { CadSurfaceVolumeCache } from '../../engine/cad/surfaceVolumeCache';
import type { CadGradingCache } from '../../engine/cad/grading/gradingCache';
import type { CadGradingGroupCache } from '../../engine/cad/grading/gradingGroupCache';
import {
  createCadAnalysisControlPlane,
  type CadAnalysisControlPlane,
} from '../../cad-app/shell/cadAnalysisAdapters';
import { SurfaceWorkerClient } from '../../workers/surfaceWorkerClient';
import { SurfaceVolumeService } from '../../workers/surfaceVolumeService';
import {
  SurfaceGradingService,
  type SurfaceGradingSessionDiagnostic,
} from '../../workers/surfaceGradingService';

/**
 * Shared worker-transport factory (all three services). Resolves the SAME
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

/** Per-drawing caches consumed by the three lifecycle services. */
export interface SurveyCadVolumeGradingAnalysisCaches {
  /** Parent TIN cache from the surface-build lifecycle. */
  surfaceCache: CadSurfaceCache;
  /** Phase 18I volume result cache (one per drawing). */
  volumeCache: CadSurfaceVolumeCache;
  /** Phase 20B grading result cache (one per drawing). */
  gradingCache: CadGradingCache;
  /** Phase 20C grading-group result cache (one per drawing). */
  groupCache: CadGradingGroupCache;
}

/** Early root primitive state the services report into / read from. */
export interface SurveyCadVolumeGradingAnalysisState {
  /** Shared grading + grading-group version (root primitive). */
  gradingVersion: number;
  setVolumeVersion: Dispatch<SetStateAction<number>>;
  setGradingVersion: Dispatch<SetStateAction<number>>;
  setAnalysisVersion: Dispatch<SetStateAction<number>>;
}

export interface SurveyCadVolumeGradingAnalysisLifecycleArgs {
  /** Live drawing id; keys every cache + service. */
  drawingId: string;
  /** Live project driving the reconciliation sweep. */
  project: CadProject;
  caches: SurveyCadVolumeGradingAnalysisCaches;
  state: SurveyCadVolumeGradingAnalysisState;
  /** Live project ref from the surface-build lifecycle. */
  activeProjectForBuildsRef: RefObject<CadProject>;
  /** Live drawing-id ref from the surface-build lifecycle. */
  drawingIdForBuildsRef: RefObject<string>;
  setFileStatusText: Dispatch<SetStateAction<string>>;
}

/** Grading snapshot inputs, refreshed only on a service state transition. */
export interface SurveyCadGradingInputs {
  version: number;
  buildingGradingIds: ReadonlySet<string>;
  sessionDiagnostics: ReadonlyMap<string, SurfaceGradingSessionDiagnostic>;
}

/** Grading-group snapshot inputs, refreshed on the same transition. */
export interface SurveyCadGroupInputs {
  version: number;
  buildingGroupIds: ReadonlySet<string>;
  sessionDiagnostics: ReadonlyMap<string, SurfaceGradingSessionDiagnostic>;
}

export interface SurveyCadVolumeGradingAnalysisLifecycle {
  volumeService: SurfaceVolumeService;
  gradingService: SurfaceGradingService;
  analysisPlane: CadAnalysisControlPlane;
  gradingInputs: SurveyCadGradingInputs;
  groupInputs: SurveyCadGroupInputs;
}

export const useSurveyCadVolumeGradingAnalysisLifecycle = ({
  drawingId,
  project,
  caches,
  state,
  activeProjectForBuildsRef,
  drawingIdForBuildsRef,
  setFileStatusText,
}: SurveyCadVolumeGradingAnalysisLifecycleArgs): SurveyCadVolumeGradingAnalysisLifecycle => {
  const { surfaceCache, volumeCache, gradingCache, groupCache } = caches;
  const { gradingVersion, setVolumeVersion, setGradingVersion, setAnalysisVersion } = state;
  // Phase 18I — volume derivation control plane (one per drawing session,
  // mirrors SurfaceBuildService ownership). Manual calculation only: source
  // rebuilds never auto-start volume work; notifyMeshBuilt cancels in-flight
  // work for affected volumes and lets status derive stale from the revision.
  // No-Display styles request quantity-only (includeDisplay false, decided
  // inside the service).
  const volumeService = useMemo(
    () =>
      new SurfaceVolumeService({
        drawingId,
        getProject: () => activeProjectForBuildsRef.current,
        getDrawingId: () => drawingIdForBuildsRef.current,
        tinCache: surfaceCache,
        volumeCache,
        createTransport: createSurfaceWorkerTransport,
        notify: (message) => setFileStatusText(message),
        onStateChange: () => setVolumeVersion((version) => version + 1),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [drawingId, surfaceCache, volumeCache],
  );
  useEffect(() => () => volumeService.dispose(), [volumeService]);
  // Phase 20B — grading derivation control plane (one per drawing session).
  // Calculate is explicit only; source/target rebuilds re-derive status from
  // revisions and never auto-start work.
  const gradingService = useMemo(
    () =>
      new SurfaceGradingService({
        drawingId,
        getProject: () => activeProjectForBuildsRef.current,
        getDrawingId: () => drawingIdForBuildsRef.current,
        tinCache: surfaceCache,
        gradingCache,
        groupCache,
        createTransport: createSurfaceWorkerTransport,
        notify: (message) => setFileStatusText(message),
        onStateChange: () => setGradingVersion((version) => version + 1),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [drawingId, surfaceCache, gradingCache, groupCache],
  );
  useEffect(() => () => gradingService.dispose(), [gradingService]);
  // Phase 20F.2 §§8-12 — pending-request reconciliation seam. Every actual
  // definition/source edit (Feature Line geometry, criterion/override, span,
  // target reassignment, delete, Project Transform, Grid/Ground project-level,
  // undo/redo) moves the resolved `grev1:`/`ggrev1:` revision, so one bounded
  // sweep retires in-flight work whose revision no longer matches. Keyed on the
  // project reference — never per render — and idempotent: the service bumps
  // `gradingVersion` only when the pending set actually changed, so this cannot
  // loop. It cancels stale work; it never auto-starts Calculate.
  useEffect(() => {
    gradingService.reconcilePendingWithProject();
  }, [project, gradingService]);
  const gradingInputs = useMemo(
    () => ({
      version: gradingVersion,
      buildingGradingIds: gradingService.buildingGradingIds(),
      sessionDiagnostics: gradingService.gradingDiagnostics(),
    }),
    [gradingService, gradingVersion],
  );
  // Phase 20C — group derivation inputs refresh on the same service state
  // change (pending/diagnostic transitions), never auto-starting work.
  const groupInputs = useMemo(
    () => ({
      version: gradingVersion,
      buildingGroupIds: gradingService.buildingGroupIds(),
      sessionDiagnostics: gradingService.groupGradingDiagnostics(),
    }),
    [gradingService, gradingVersion],
  );
  // Phase 18U — analysis control plane (one per drawing session). Session
  // results are keyed by `arev1:` (source revision + band thresholds), so a
  // source rebuild or threshold edit re-derives NEEDS_RECALC/SOURCE_NOT_CURRENT
  // automatically while color/label/opacity edits never invalidate a result.
  // Calculate is explicit only.
  const analysisPlane = useMemo(
    () =>
      createCadAnalysisControlPlane({
        drawingId,
        getProject: () => activeProjectForBuildsRef.current,
        getDrawingId: () => drawingIdForBuildsRef.current,
        tinCache: surfaceCache,
        // Worker-backed when available; the control plane falls back to the
        // shared band engines (same cache shape) when workers are unavailable.
        createTransport: createSurfaceWorkerTransport,
        notify: (message) => setFileStatusText(message),
        onStateChange: () => setAnalysisVersion((version) => version + 1),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [drawingId, surfaceCache],
  );
  useEffect(() => () => analysisPlane.dispose(), [analysisPlane]);
  return { volumeService, gradingService, analysisPlane, gradingInputs, groupInputs };
};
