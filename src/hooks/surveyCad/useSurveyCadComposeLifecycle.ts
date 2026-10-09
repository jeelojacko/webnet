/**
 * STRUCT-194.6 — exact two-surface composition control plane lifecycle.
 *
 * Extracted verbatim from `SurveyCadWorkspace` with no behavior change. Holds
 * the per-drawing `SurfaceComposeService` and the UI-owned pending-mode map:
 *   - `pendingComposeModeRef` is the shared `Map<pairKey, 'copy' | 'paste'>`
 *     the shell actions write before requesting and the APPLY seam consumes,
 *   - the one-worker-per-drawing `SurfaceComposeService`, its disposal effect,
 *     and the `applyCompose` history seam.
 *
 * The worker only computes the composed topology; the UI-owned `applyCompose`
 * dispatches the payload-carrying `SURFCOMPOSE` / `SURFCOMPOSEPASTE`
 * transaction through `cadWorkspace.runLayerCommand` (the service never mutates
 * history). A rejected / stale / locked commit is a no-op on history.
 *
 * Called once, unconditionally, at the exact former compose render position
 * (after the workspace destructure, before the analysis snapshot), so the
 * flattened primitive sequence is the original useRef -> useMemo -> useEffect.
 * The memo deps are the original `[drawingId, surfaceCache, cadWorkspace]`, so
 * a drawing switch, a fresh cache, or a fresh workspace identity replaces the
 * service (and disposes the old one exactly once).
 *
 * Worker URL note: the original `../workers/surfaceWorker.ts` resolved from
 * `src/components`; from `src/hooks/surveyCad` the same module is addressed as
 * `../../workers/surfaceWorker.ts` (verified `src/workers/surfaceWorker.ts`).
 * The `Worker`-undefined / construction-throw fallback to `null` is
 * byte-identical.
 */
import { useEffect, useMemo, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { CadProject } from '../../engine/cad/cadTypes';
import type { CadSurfaceCache } from '../../engine/cad/cadSurfaceCache';
import type { CadCommand } from '../../engine/cad/cadTransactions.types';
import { computeCadSurfaceSourceRevision } from '../../engine/cad/cadSurfaces';
import {
  buildComposeCopyCommand,
  buildComposePasteCommand,
  type CadSurfaceComposeMode,
} from '../../cad-app/shell/cadSurfaceCompose';
import { SurfaceComposeService } from '../../workers/surfaceComposeService';
import { SurfaceWorkerClient } from '../../workers/surfaceWorkerClient';

/** Minimal workspace seam the APPLY transaction needs (identity is the memo key). */
export interface SurveyCadComposeWorkspace {
  runLayerCommand: (_command: CadCommand) => boolean;
}

export interface SurveyCadComposeLifecycleArgs {
  /** Live drawing id; keys the compose service. */
  drawingId: string;
  /** Per-drawing TIN cache (both sources must be CURRENT for their revision). */
  surfaceCache: CadSurfaceCache;
  /** Live project reader (mirrors the build lifecycle ref). */
  activeProjectForBuildsRef: RefObject<CadProject>;
  /** Live drawing-id reader (guards late results across drawing switches). */
  drawingIdForBuildsRef: RefObject<string>;
  /** Current workspace; identity is a memo dep so a new workspace re-binds. */
  cadWorkspace: SurveyCadComposeWorkspace;
  setFileStatusText: Dispatch<SetStateAction<string>>;
}

export interface SurveyCadComposeLifecycle {
  composeService: SurfaceComposeService;
  pendingComposeModeRef: { current: Map<string, CadSurfaceComposeMode> };
}

export const useSurveyCadComposeLifecycle = ({
  drawingId,
  surfaceCache,
  activeProjectForBuildsRef,
  drawingIdForBuildsRef,
  cadWorkspace,
  setFileStatusText,
}: SurveyCadComposeLifecycleArgs): SurveyCadComposeLifecycle => {
  const pendingComposeModeRef = useRef(new Map<string, CadSurfaceComposeMode>());
  const composeService = useMemo(
    () =>
      new SurfaceComposeService({
        drawingId,
        getProject: () => activeProjectForBuildsRef.current,
        getDrawingId: () => drawingIdForBuildsRef.current,
        tinCache: surfaceCache,
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
        notify: (message) => setFileStatusText(message),
        onStateChange: () => {},
        applyCompose: (computed) => {
          const project = activeProjectForBuildsRef.current;
          const base = (project.surfaces ?? []).find((entry) => entry.id === computed.baseSurfaceId);
          const overlay = (project.surfaces ?? []).find((entry) => entry.id === computed.overlaySurfaceId);
          if (!base || !overlay) return;
          const key = `${computed.baseSurfaceId}|${computed.overlaySurfaceId}`;
          const mode = pendingComposeModeRef.current.get(key) ?? 'copy';
          pendingComposeModeRef.current.delete(key);
          const payload = { vertices: computed.vertices, faces: computed.faces };
          const command = mode === 'paste'
            ? buildComposePasteCommand({
                id: base.id,
                name: base.name,
                revision: computeCadSurfaceSourceRevision(project, base),
                current: true,
              }, {
                id: overlay.id,
                name: overlay.name,
                revision: computeCadSurfaceSourceRevision(project, overlay),
                current: true,
              }, payload)
            : buildComposeCopyCommand({
                id: base.id,
                name: base.name,
                revision: computeCadSurfaceSourceRevision(project, base),
                current: true,
              }, {
                id: overlay.id,
                name: overlay.name,
                revision: computeCadSurfaceSourceRevision(project, overlay),
                current: true,
              }, payload);
          const ok = cadWorkspace.runLayerCommand(command);
          setFileStatusText(ok
            ? (mode === 'paste'
              ? `Pasted “${overlay.name}” into “${base.name}”.`
              : `Composite copy created from “${base.name}” + “${overlay.name}”.`)
            : 'Compose rejected — a source revision moved or the target layer is locked.');
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [drawingId, surfaceCache, cadWorkspace],
  );
  useEffect(() => () => composeService.dispose(), [composeService]);
  return { composeService, pendingComposeModeRef };
};
