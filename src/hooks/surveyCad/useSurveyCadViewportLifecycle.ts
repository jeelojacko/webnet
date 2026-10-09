/**
 * STRUCT-194.9 — CAD viewport transform + bounds lifecycle.
 *
 * Extracted verbatim from `SurveyCadWorkspace` with no behavior change. Holds
 * the four early viewport primitives in their original order:
 *   - the zoom/pan viewport state,
 *   - the monotonic viewport generation ref,
 *   - the `applyViewport` wrapper (bumps the generation BEFORE every set, so a
 *     no-op / pan-only reset is still observed by the snap commit guards),
 *   - the lazily-cloned view bounds.
 *
 * Called once, unconditionally, at the exact former viewport position (after
 * the drawing-file lifecycle state, before the parcel layout state), so the
 * flattened primitive sequence `useState -> useRef -> useCallback -> useState`
 * is byte-identical. The drawing-switch reset effect stays in the root and
 * consumes `applyViewport` / `setViewBounds`; no new state, no new effect.
 */
import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { CadBounds } from '../../engine/cad/cadTypes';
import { cloneCadBounds } from './useSurveyCadDrawingSource';

/** Structural twin of the surface component's local `CadPreviewViewport`. */
export interface SurveyCadViewportTransform {
  zoom: number;
  panX: number;
  panY: number;
}

export interface SurveyCadViewportLifecycleArgs {
  /** Bounds snapshot for the lazy view-bounds initializer (mount-time only). */
  cadBounds: CadBounds | null;
}

export interface SurveyCadViewportLifecycle {
  viewport: SurveyCadViewportTransform;
  applyViewport: Dispatch<SetStateAction<SurveyCadViewportTransform>>;
  viewportGenerationRef: { current: number };
  viewBounds: CadBounds | null;
  setViewBounds: Dispatch<SetStateAction<CadBounds | null>>;
}

export const useSurveyCadViewportLifecycle = ({
  cadBounds,
}: SurveyCadViewportLifecycleArgs): SurveyCadViewportLifecycle => {
  const [viewport, setViewport] = useState<SurveyCadViewportTransform>({ zoom: 1, panX: 0, panY: 0 });
  // Monotonic viewport generation: bumped on EVERY viewport transform (zoom,
  // pan, zoom-extents, programmatic reset). Snap candidates are stamped with
  // it so a click-less keyboard commit can reject a snap computed before any
  // transform, including a pan-only reset that leaves zoom/scale unchanged.
  const viewportGenerationRef = useRef(0);
  const applyViewport = useCallback<typeof setViewport>((action) => {
    viewportGenerationRef.current += 1;
    setViewport(action);
  }, []);
  const [viewBounds, setViewBounds] = useState<CadBounds | null>(() => cloneCadBounds(cadBounds));
  return { viewport, applyViewport, viewportGenerationRef, viewBounds, setViewBounds };
};
