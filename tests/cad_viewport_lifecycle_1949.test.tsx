/** @vitest-environment jsdom */
/**
 * STRUCT-194.9 — `useSurveyCadViewportLifecycle`.
 *
 * Real production hook mounted through a tiny harness that mirrors the exact
 * root drawing-switch reset effect (`applyViewport(default)` + `setViewBounds(
 * cloneCadBounds(bounds))`). Pins:
 *   - the lazy `cloneCadBounds` initializer (source mutation never leaks in),
 *   - no reinitialization of `viewBounds` on unrelated rerenders,
 *   - `applyViewport` bumps the generation exactly once per call — including a
 *     no-op and a pan-only reset — so a stale snap can be rejected,
 *   - a stable `useCallback` identity across rerenders,
 *   - the drawing-switch reset + re-clone (generation advances, stale rejected),
 *   - no idle state churn on an unrelated parent rerender.
 *
 * Fast + deterministic; agent tier.
 */
import React, { StrictMode, act, useEffect, useImperativeHandle, useState, type RefObject } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import {
  useSurveyCadViewportLifecycle,
  type SurveyCadViewportLifecycle,
} from '../src/hooks/surveyCad/useSurveyCadViewportLifecycle';
import { cloneCadBounds } from '../src/hooks/surveyCad/useSurveyCadDrawingSource';
import type { CadBounds } from '../src/engine/cad/cadTypes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const bounds = (minX: number, minY: number, maxX: number, maxY: number): CadBounds => ({ minX, minY, maxX, maxY });

interface ViewportControls {
  apply: (_action: { zoom: number; panX: number; panY: number }) => void;
  setDrawing: (_drawingId: string, _nextBounds: CadBounds | null) => void;
  bump: () => void;
}

const Harness: React.FC<{
  controls: RefObject<ViewportControls | null>;
  initialDrawingId: string;
  initialBounds: CadBounds | null;
  onApi: (_api: SurveyCadViewportLifecycle) => void;
}> = ({ controls, initialDrawingId, initialBounds, onApi }) => {
  const [drawingId, setDrawingId] = useState(initialDrawingId);
  const [cadBounds, setCadBounds] = useState<CadBounds | null>(initialBounds);
  const [, setEpoch] = useState(0);
  const api = useSurveyCadViewportLifecycle({ cadBounds });
  // Root-shaped drawing-switch reset (same calls + dependency set).
  useEffect(() => {
    api.applyViewport({ zoom: 1, panX: 0, panY: 0 });
    api.setViewBounds(cloneCadBounds(cadBounds));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawingId, cadBounds, api.applyViewport]);
  useEffect(() => {
    onApi(api);
  });
  useImperativeHandle(controls, () => ({
    apply: (action) => api.applyViewport(action),
    setDrawing: (nextDrawingId, nextBounds) => {
      setDrawingId(nextDrawingId);
      setCadBounds(nextBounds);
    },
    bump: () => setEpoch((value) => value + 1),
  }));
  return null;
};

interface Mounted {
  root: Root;
  container: HTMLElement;
  controls: RefObject<ViewportControls | null>;
  api: () => SurveyCadViewportLifecycle;
}

const mounted: Mounted[] = [];

const mountViewport = async (
  initialDrawingId = 'd1',
  initialBounds: CadBounds | null = bounds(0, 0, 10, 10),
  strict = false,
): Promise<Mounted> => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const controls: RefObject<ViewportControls | null> = { current: null };
  let api: SurveyCadViewportLifecycle | null = null;
  const element = (
    <Harness
      controls={controls}
      initialDrawingId={initialDrawingId}
      initialBounds={initialBounds}
      onApi={(value) => {
        api = value;
      }}
    />
  );
  await act(async () => {
    root.render(strict ? <StrictMode>{element}</StrictMode> : element);
  });
  const view: Mounted = {
    root,
    container,
    controls,
    api: () => {
      if (!api) throw new Error('hook not mounted');
      return api;
    },
  };
  mounted.push(view);
  return view;
};

afterEach(async () => {
  for (const view of mounted.splice(0)) {
    await act(async () => {
      view.root.unmount();
    });
    view.container.remove();
  }
});

describe('STRUCT-194.9 useSurveyCadViewportLifecycle', () => {
  it('lazily clones the initial bounds and never reinitializes on rerender', async () => {
    const source = bounds(0, 0, 10, 10);
    const view = await mountViewport('d1', source);
    const initial = view.api().viewBounds!;
    expect(initial).toEqual(bounds(0, 0, 10, 10));
    expect(initial).not.toBe(source);

    // Mutating the source object must not leak into the cloned state.
    source.minX = 99;
    expect(view.api().viewBounds!.minX).toBe(0);

    await act(async () => {
      view.controls.current!.bump();
    });
    expect(view.api().viewBounds).toBe(initial);

    // A viewport transform never touches the bounds state.
    await act(async () => {
      view.controls.current!.apply({ zoom: 2, panX: 1, panY: 1 });
    });
    expect(view.api().viewBounds).toBe(initial);
  });

  it('bumps the generation exactly once per applyViewport including no-op and pan-only', async () => {
    const view = await mountViewport();
    const g0 = view.api().viewportGenerationRef.current;
    await act(async () => {
      view.controls.current!.apply({ zoom: 1, panX: 0, panY: 0 }); // no-op
    });
    const g1 = view.api().viewportGenerationRef.current;
    expect(g1).toBe(g0 + 1);
    await act(async () => {
      view.controls.current!.apply({ zoom: 1, panX: 5, panY: 0 }); // pan-only
    });
    const g2 = view.api().viewportGenerationRef.current;
    expect(g2).toBe(g1 + 1);
    await act(async () => {
      view.controls.current!.apply({ zoom: 3, panX: 5, panY: 0 });
    });
    expect(view.api().viewportGenerationRef.current).toBe(g2 + 1);
    expect(view.api().viewport).toEqual({ zoom: 3, panX: 5, panY: 0 });
  });

  it('keeps the applyViewport callback identity stable across rerenders', async () => {
    const view = await mountViewport();
    const first = view.api().applyViewport;
    await act(async () => {
      view.controls.current!.bump();
      view.controls.current!.bump();
    });
    expect(view.api().applyViewport).toBe(first);
  });

  it('resets viewport + re-clones bounds on a drawing switch and rejects a stale generation', async () => {
    const view = await mountViewport('d1', bounds(0, 0, 10, 10));
    await act(async () => {
      view.controls.current!.apply({ zoom: 4, panX: 7, panY: 2 });
    });
    expect(view.api().viewport).toEqual({ zoom: 4, panX: 7, panY: 2 });
    // A snap computed now is stamped with this generation.
    const staleGeneration = view.api().viewportGenerationRef.current;
    const previousBounds = view.api().viewBounds;

    await act(async () => {
      view.controls.current!.setDrawing('d2', bounds(0, 0, 20, 30));
    });
    expect(view.api().viewport).toEqual({ zoom: 1, panX: 0, panY: 0 });
    expect(view.api().viewBounds).toEqual(bounds(0, 0, 20, 30));
    expect(view.api().viewBounds).not.toBe(previousBounds);
    expect(view.api().viewportGenerationRef.current).toBeGreaterThan(staleGeneration);
  });

  it('does not reset or churn state on an unrelated parent rerender', async () => {
    const view = await mountViewport();
    await act(async () => {
      view.controls.current!.apply({ zoom: 2, panX: 1, panY: 1 });
    });
    const viewport = view.api().viewport;
    const boundsState = view.api().viewBounds;
    const generation = view.api().viewportGenerationRef.current;
    await act(async () => {
      view.controls.current!.bump();
    });
    expect(view.api().viewport).toBe(viewport);
    expect(view.api().viewBounds).toBe(boundsState);
    expect(view.api().viewportGenerationRef.current).toBe(generation);
  });

  it('mounts and transforms cleanly under StrictMode', async () => {
    const view = await mountViewport('d1', bounds(0, 0, 10, 10), true);
    const before = view.api().viewportGenerationRef.current;
    await act(async () => {
      view.controls.current!.apply({ zoom: 5, panX: 2, panY: 3 });
    });
    expect(view.api().viewport).toEqual({ zoom: 5, panX: 2, panY: 3 });
    expect(view.api().viewportGenerationRef.current).toBe(before + 1);
    expect(view.api().viewBounds).toEqual(bounds(0, 0, 10, 10));
  });
});
