/**
 * STRUCT-194.4 — contour derivation lifecycle.
 *
 * Extracted verbatim from `SurveyCadWorkspace` with no behavior change,
 * mirroring the `SurfaceBuildService` ownership model. Holds:
 *   - the per-drawing contour cache + state version,
 *   - the one-worker-per-drawing `SurfaceContourService` (+ disposal effect),
 *   - the stable auto-derive epoch and effect (style index first-wins,
 *     CURRENT-TIN gate, cache-hit skip, revision-aware pending gate; the
 *     A→B supersession contract is preserved and `contourVersion` stays
 *     intentionally excluded to avoid loops),
 *   - the contour scene-input memo (CURRENT-only when the TIN is fresh,
 *     newest retained stale set for display otherwise).
 *
 * Called immediately after `useSurveyCadSurfaceBuildLifecycle` at the exact
 * former contour render position, consuming that hook's `surfaceCache` and
 * `surfaceBuildVersion`, so primitive hook order is flattened identically.
 *
 * Worker URL note: `../../workers/surfaceWorker.ts` addresses the same
 * `src/workers/surfaceWorker.ts` module as the original `../workers/...`
 * path from `src/components`; the `Worker`-undefined / throw fallback is
 * byte-identical.
 */
import { useEffect, useMemo, useState, type RefObject } from 'react';
import type { CadSurfaceCache } from '../../engine/cad/cadSurfaceCache';
import type { CadProject, CadSurface } from '../../engine/cad/cadTypes';
import {
  createCadSurfaceContourCache,
  type CadSurfaceContourCache,
} from '../../engine/cad/surfaceContourCache';
import { findCadSurfaceStyle, indexCadSurfaceStylesById } from '../../engine/cad/cadSurfaceStyles';
import { contourLevelSpecFromStyle } from '../../engine/cad/cadSurfaceContourView';
import {
  computeContourGeometryRevision,
  toContourGeometrySpec,
} from '../../engine/cad/surfaceContours/contourStyleRevision';
import { surfaceContentRevision, type SurfaceContourDisplayInput } from '../../engine/cad/cadSurfaceView';
import { SurfaceWorkerClient } from '../../workers/surfaceWorkerClient';
import { SurfaceContourService } from '../../workers/surfaceContourService';

export interface SurveyCadContourLifecycleArgs {
  /** Live drawing id; keys the contour cache + service. */
  activeDrawingId: string;
  /** Live project driving the auto-derive epoch. */
  cadProject: CadProject;
  /** Parent TIN cache from the surface-build lifecycle. */
  surfaceCache: CadSurfaceCache;
  /** Build state version from the surface-build lifecycle. */
  surfaceBuildVersion: number;
  /** Live project ref from the surface-build lifecycle. */
  activeProjectForBuildsRef: RefObject<CadProject>;
  /** Live drawing-id ref from the surface-build lifecycle. */
  drawingIdForBuildsRef: RefObject<string>;
  setFileStatusText: (_text: string) => void;
}

export interface SurveyCadContourInputs {
  version: number;
  getContours: (_surfaceId: string) => SurfaceContourDisplayInput | null;
}

export interface SurveyCadContourLifecycle {
  contourCache: CadSurfaceContourCache;
  contourService: SurfaceContourService;
  contourVersion: number;
  contourAutoDeriveInput: { project: CadProject; buildVersion: number };
  surfaceContourInputs: SurveyCadContourInputs;
}

/**
 * One auto-derive sweep: every surface whose style enables contours and whose
 * parent TIN is CURRENT gets a cached set for the style's geometry revision.
 * Guarded (cached / pending / current-TIN checks) so the effect converges
 * instead of re-requesting. Fires on project edits (style or definition) and
 * TIN completions (the build epoch); never touches the TIN. `contourVersion`
 * is intentionally NOT part of the caller's dependency array — completion /
 * diagnostic transitions must not re-trigger the sweep. Revision-aware pending
 * gate: skip only when the in-flight request already matches the current
 * (source revision, geometry revision); on an interval A → B change under a
 * pending request the sweep falls through so `requestContours` supersedes A
 * with B (latest-wins).
 */
const sweepContourAutoDerive = (
  project: CadProject,
  surfaceCache: CadSurfaceCache,
  contourCache: CadSurfaceContourCache,
  contourService: SurfaceContourService,
): void => {
  // One style clone per sweep (never one per surface). First-wins on
  // duplicate ids, matching the prior `.find()` read path.
  const styleById = indexCadSurfaceStylesById(project.surfaceStyles);
  for (const surface of project.surfaces ?? []) {
    const style = styleById.get(surface.styleId ?? '');
    if (!style) continue;
    const spec = contourLevelSpecFromStyle(style);
    if (!spec) continue;
    // Session CURRENT = fresh TIN cache hit (cachedRevision is never written
    // in-session; see resolveSurfaceDisplayStatus). A fresh source revision
    // without a rebuilt TIN misses here and never promotes stale contours.
    const revision = surfaceContentRevision(project, surface);
    if (!surfaceCache.get(surface.id, revision)) continue;
    const geometryRevision = computeContourGeometryRevision(toContourGeometrySpec(spec));
    if (contourCache.get(surface.id, revision, geometryRevision)) continue;
    const pending = contourService.pendingContourRequest(surface.id);
    if (
      pending != null &&
      pending.revision === revision &&
      pending.geometryRevision === geometryRevision
    ) {
      continue;
    }
    contourService.requestContours(surface.id, spec);
  }
};

/**
 * Scene-input lookup: current-geometry set when the TIN is fresh, newest
 * retained set as stale display otherwise (mirrors the stale-mesh contract).
 * Null = no contour display (definition-only, legacy style, or nothing derived
 * yet). Both indexes are first-wins, matching the prior `.find()` read paths
 * (surface ids should be unique; the guard keeps the contract identical if a
 * duplicate ever loads).
 */
const buildContourLookup = (
  project: CadProject,
  surfaceCache: CadSurfaceCache,
  contourCache: CadSurfaceContourCache,
): ((_surfaceId: string) => SurfaceContourDisplayInput | null) => {
  const styleById = indexCadSurfaceStylesById(project.surfaceStyles);
  const surfaceById = new Map<string, CadSurface>();
  for (const surface of project.surfaces ?? []) {
    if (!surfaceById.has(surface.id)) surfaceById.set(surface.id, surface);
  }
  return (surfaceId: string): SurfaceContourDisplayInput | null => {
    const surface = surfaceById.get(surfaceId);
    if (!surface) return null;
    const style = styleById.get(surface.styleId ?? '');
    if (!style) return null;
    const spec = contourLevelSpecFromStyle(style);
    if (!spec) return null;
    const revision = surfaceContentRevision(project, surface);
    if (surfaceCache.get(surfaceId, revision)) {
      const geometryRevision = computeContourGeometryRevision(toContourGeometrySpec(spec));
      const set = contourCache.get(surfaceId, revision, geometryRevision);
      return set ? { set } : null;
    }
    const retained = contourCache.retained(surfaceId);
    const stale = retained.length > 0 ? retained[retained.length - 1]! : undefined;
    return stale ? { set: stale } : null;
  };
};

export const useSurveyCadContourLifecycle = ({
  activeDrawingId,
  cadProject,
  surfaceCache,
  surfaceBuildVersion,
  activeProjectForBuildsRef,
  drawingIdForBuildsRef,
  setFileStatusText,
}: SurveyCadContourLifecycleArgs): SurveyCadContourLifecycle => {
  // Phase 18H — contour derivation control plane (one per drawing session,
  // mirrors SurfaceBuildService ownership). Derivations consume the cached TIN
  // (never rebuild it) and populate the session contour cache; late results
  // from an old interval/mesh/drawing never replace the current set
  // (latest-wins per surface, owned by the service).
  const contourCache = useMemo(
    () => createCadSurfaceContourCache(activeDrawingId),
    [activeDrawingId],
  );
  const [contourVersion, setContourVersion] = useState(0);
  const contourService = useMemo(
    () =>
      new SurfaceContourService({
        drawingId: activeDrawingId,
        getProject: () => activeProjectForBuildsRef.current,
        getDrawingId: () => drawingIdForBuildsRef.current,
        tinCache: surfaceCache,
        contourCache,
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
        shouldAutoDerive: (surfaceId) => {
          const project = activeProjectForBuildsRef.current;
          const surface = (project.surfaces ?? []).find((entry) => entry.id === surfaceId);
          if (!surface) return false;
          const style = findCadSurfaceStyle(project.surfaceStyles, surface.styleId);
          return style != null && contourLevelSpecFromStyle(style) != null;
        },
        notify: (message) => setFileStatusText(message),
        onStateChange: () => setContourVersion((version) => version + 1),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeDrawingId, surfaceCache, contourCache],
  );
  useEffect(() => () => contourService.dispose(), [contourService]);
  // The epoch bundles the project revision and the mesh-build version so the
  // dependency is explicit and identity-stable across unrelated renders — no
  // fresh-each-render dependency, no bare ref read, no missing cache epoch.
  // The contour service identity already covers a drawing switch (one service
  // per drawing).
  const contourAutoDeriveInput = useMemo(
    () => ({ project: cadProject, buildVersion: surfaceBuildVersion }),
    [cadProject, surfaceBuildVersion],
  );
  useEffect(() => {
    sweepContourAutoDerive(
      contourAutoDeriveInput.project,
      surfaceCache,
      contourCache,
      contourService,
    );
  }, [contourAutoDeriveInput, contourService, surfaceCache, contourCache]);
  const surfaceContourInputs = useMemo(
    () => ({
      version: contourVersion,
      getContours: buildContourLookup(cadProject, surfaceCache, contourCache),
    }),
    [contourVersion, surfaceCache, contourCache, cadProject],
  );
  return {
    contourCache,
    contourService,
    contourVersion,
    contourAutoDeriveInput,
    surfaceContourInputs,
  };
};
