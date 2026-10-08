/** @vitest-environment jsdom */
import React, { useEffect, useState } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { CadDisplayPrimitive, CadDisplayScene, CadProject } from '../src/engine/cad/cadTypes';
import SurveyCadPreviewStaticPrimitives, {
  type SurveyCadPrimitiveDispatch,
} from '../src/components/surveyCad/SurveyCadPreviewStaticPrimitives';
import SurveyCadPreview from '../src/components/surveyCad/SurveyCadPreview';
import { useSurveyCadSnapping } from '../src/hooks/surveyCad/useSurveyCadSnapping';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Deterministic probe for how many primitives the static layer actually maps
// (after memo bail-out and viewport culling). Never a wall-clock threshold.
const renderSpy = vi.hoisted(() => ({ calls: 0 }));
vi.mock('../src/components/surveyCad/SurveyCadPreviewPrimitive', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../src/components/surveyCad/SurveyCadPreviewPrimitive')>();
  return {
    ...actual,
    renderPrimitive: (options: Parameters<typeof actual.renderPrimitive>[0]) => {
      renderSpy.calls += 1;
      return actual.renderPrimitive(options);
    },
  };
});

const render = async (node: React.ReactNode): Promise<{ container: HTMLElement; root: Root }> => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(node);
  });
  return { container, root };
};

// ---------------------------------------------------------------------------
// Static layer: memo skip + selection invalidation + culling element count.
// ---------------------------------------------------------------------------

const identityProject = (x: number, y: number): { x: number; y: number } => ({ x, y });
const EMPTY_OVERRIDES: Readonly<Record<string, number>> = {};
const SNAP_PREFERENCES = {
  'point-node': true,
  endpoint: true,
  midpoint: true,
  center: true,
  'arc-midpoint': true,
  quadrant: true,
  intersection: true,
  'apparent-intersection': true,
  extension: true,
  perpendicular: true,
  parallel: true,
  direction: true,
  tangent: true,
  nearest: true,
};
const STATIC_DISPATCH: SurveyCadPrimitiveDispatch = { onEntityClick: () => undefined };
const STATIC_DISPATCH_REF = { current: STATIC_DISPATCH };

type LinePrimitive = Extract<CadDisplayPrimitive, { kind: 'line' }>;

const visibleLine = (index: number): LinePrimitive => ({
  kind: 'line',
  id: `line:${index}`,
  layerId: '0',
  sourceEntityId: `line:${index}`,
  sourceSegmentId: `line:${index}#0`,
  stroke: '#fff',
  points: [{ x: 10 + index, y: 10 }, { x: 20 + index, y: 20 }],
  strokeWidth: 1,
});

const offscreenLine = (index: number): LinePrimitive => ({
  ...visibleLine(index),
  id: `off:${index}`,
  sourceEntityId: `off:${index}`,
  points: [{ x: 5000 + index, y: 10 }, { x: 5010 + index, y: 20 }],
});

const basePrimitives: CadDisplayPrimitive[] = [visibleLine(0), visibleLine(1)];

describe('PERF-183.1 static primitive layer memoization', () => {
  it('skips the static map when scene/viewport/selection/opacity are unchanged', async () => {
    renderSpy.calls = 0;
    const MemoHarness = () => {
      const [tick, setTick] = useState(0);
      const [selection, setSelection] = useState<ReadonlySet<string>>(() => new Set());
      return (
        <div>
          <button data-bump onClick={() => setTick((value) => value + 1)}>
            bump
          </button>
          <button data-select onClick={() => setSelection(new Set(['line:0']))}>
            select
          </button>
          <SurveyCadPreviewStaticPrimitives
            primitives={basePrimitives}
            project={identityProject}
            scale={1}
            selectedEntityIdSet={selection}
            entityOpacityOverrides={EMPTY_OVERRIDES}
            dispatchRef={STATIC_DISPATCH_REF}
          />
          <span data-tick>{tick}</span>
        </div>
      );
    };
    const { container } = await render(<MemoHarness />);
    expect(renderSpy.calls).toBe(2);

    await act(async () => {
      (container.querySelector('[data-bump]') as HTMLButtonElement).click();
    });
    // Parent re-rendered but the memoized static layer did no primitive work.
    expect(renderSpy.calls).toBe(2);
    expect(container.querySelector('[data-tick]')?.textContent).toBe('1');

    await act(async () => {
      (container.querySelector('[data-select]') as HTMLButtonElement).click();
    });
    expect(renderSpy.calls).toBe(4);
  });

  it('maps only the visible slice of a dense scene and creates no offscreen elements', async () => {
    renderSpy.calls = 0;
    const primitives: CadDisplayPrimitive[] = [];
    for (let index = 0; index < 1500; index += 1) primitives.push(offscreenLine(index));
    for (let index = 0; index < 40; index += 1) primitives.push(visibleLine(index));
    const { container } = await render(
      <svg>
        <SurveyCadPreviewStaticPrimitives
          primitives={primitives}
          project={identityProject}
          scale={1}
          selectedEntityIdSet={new Set()}
          entityOpacityOverrides={EMPTY_OVERRIDES}
          dispatchRef={STATIC_DISPATCH_REF}
        />
      </svg>,
    );
    expect(renderSpy.calls).toBe(40);
    expect(container.querySelectorAll('[data-survey-cad-render-entity-id]').length).toBe(40);
    expect(container.querySelectorAll('[data-survey-cad-hit-target]').length).toBe(40);
    expect(container.querySelectorAll('[data-survey-cad-static-primitives]').length).toBe(1);
  });

  it('keeps the real preview static layer static across idle pointer moves', async () => {
    renderSpy.calls = 0;
    const primitives: CadDisplayPrimitive[] = [];
    for (let index = 0; index < 1000; index += 1) {
      primitives.push({
        kind: 'line',
        id: `scene:${index}`,
        layerId: '0',
        sourceEntityId: `scene:${index}`,
        stroke: '#fff',
        points: [{ x: index, y: 0 }, { x: index + 0.5, y: 10 }],
        strokeWidth: 1,
      });
    }
    const scene: CadDisplayScene = { bounds: { minX: 0, minY: 0, maxX: 1000, maxY: 10 }, primitives };
    const viewBounds = { minX: 0, minY: 0, maxX: 1000, maxY: 10 };
    let lastPointer: { x: number; y: number } | null = null;
    const PreviewHarness = () => (
        <SurveyCadPreview
          scene={scene}
          viewBounds={viewBounds}
          selectedEntityIds={[]}
          selectedParcelReport={null}
          activeSnap={null}
          commandPreviewPrimitives={[]}
          commandStatusText=""
          commandHelpText=""
          commandModifierHint=""
          constructionHint=""
          snapPreferences={SNAP_PREFERENCES}
          commandInputValue=""
          commandInputPlaceholder=""
          commandInputEnabled={false}
          viewport={{ zoom: 1, panX: 0, panY: 0 }}
          commandActive={false}
          commandPointInputActive={false}
          onViewportChange={() => undefined}
          onSelectEntity={() => undefined}
          onSelectEntities={() => undefined}
          onConsumeInteractionPoint={() => undefined}
          onPointerWorldPointChange={(point) => { lastPointer = point; }}
          onSnapPreferenceChange={() => undefined}
          onCommandInputChange={() => undefined}
          onCommandInputEnter={() => undefined}
          onCommandInputEscape={() => undefined}
          onZoomExtents={() => undefined}
        />
    );
    const { container } = await render(<PreviewHarness />);
    expect(renderSpy.calls).toBe(1000);
    const svg = container.querySelector('[data-survey-cad-preview]') as SVGSVGElement;
    Object.defineProperty(svg, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        x: 0, y: 0, left: 0, top: 0, width: 900, height: 520, right: 900, bottom: 520,
        toJSON: () => ({}),
      }),
    });
    await act(async () => {
      for (const clientX of [400, 420, 440]) {
        svg.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX, clientY: 260 }));
      }
    });
    // Idle moves produced no static primitive work.
    expect(renderSpy.calls).toBe(1000);
    expect(lastPointer).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Snapping hook: per-move root-commit reduction + snap parity.
// ---------------------------------------------------------------------------

const buildSnapProject = (): CadProject => ({
  version: 2,
  id: 'perf-183-project',
  name: 'PERF-183',
  metadata: {
    source: 'parsed-input',
    runMode: 'adjustment',
    units: 'm',
    stationCount: 1,
    observationCount: 0,
    adjustedStationCount: 1,
  },
  layers: [
    { id: 'planning', name: 'Planning', color: '#38bdf8', visible: true, locked: false, role: 'planning' },
  ],
  styleLibrary: {
    lineTypes: [{ id: 'continuous', name: 'Continuous', dashPattern: [] }],
    textStyles: [],
    pointSymbols: [],
    styles: [{ id: 'style-line', name: 'Line', color: '#38bdf8', strokeWidth: 1.25 }],
  },
  entities: [
    {
      id: 'line:1',
      type: 'line',
      layerId: 'planning',
      styleId: 'style-line',
      visible: true,
      locked: false,
      fromStationId: 'A',
      toStationId: 'B',
      fromX: 0,
      fromY: 0,
      toX: 10,
      toY: 0,
      sourceObservationIds: [],
    },
    {
      id: 'line:2',
      type: 'line',
      layerId: 'planning',
      styleId: 'style-line',
      visible: true,
      locked: false,
      fromStationId: 'C',
      toStationId: 'D',
      fromX: 2,
      fromY: -5,
      toX: 2,
      toY: 3,
      sourceObservationIds: [],
    },
    {
      id: 'sp:1',
      type: 'survey-point',
      layerId: 'planning',
      visible: true,
      locked: false,
      stationId: 'P1',
      x: 7,
      y: 3,
      pointClass: 'free',
      source: 'parsed-input',
    },
  ],
  bounds: { minX: -1, minY: -6, maxX: 11, maxY: 6 },
  cogoComputations: [],
});

type Snapping = ReturnType<typeof useSurveyCadSnapping>;

interface SnapProbeProps {
  project: CadProject;
  viewportRef: { current: number };
  probeRef: { current: Snapping | null };
  onRender?: () => void;
}

const SnapProbe: React.FC<SnapProbeProps> = ({ project, viewportRef, probeRef, onRender }) => {
  const snapping = useSurveyCadSnapping(project, { active: false, basePoint: null }, viewportRef);
  // Commit counter and latest hook closure: run once per committed render
  // (React may render more than once before committing under concurrent
  // scheduling; refs must not be written during render).
  useEffect(() => {
    probeRef.current = snapping;
    onRender?.();
  });
  return null;
};

describe('PERF-183.1 snapping state dedupe and pointer gating', () => {
  it('does not commit root state on idle no-snap moves and dedupes unchanged snaps', async () => {
    const project = buildSnapProject();
    const viewportRef = { current: 5 };
    const probeRef: { current: Snapping | null } = { current: null };
    let renderCount = 0;
    const view = await render(
      <SnapProbe
        project={project}
        viewportRef={viewportRef}
        probeRef={probeRef}
        onRender={() => { renderCount += 1; }}
      />,
    );
    expect(renderCount).toBe(1);

    // Steady-state idle no-snap moves: imperative pointer channel only.
    await act(async () => {
      probeRef.current!.updatePointerWorldPoint({ x: 50, y: 50 }, 1);
      probeRef.current!.updatePointerWorldPoint({ x: 51, y: 50.5 }, 1);
      probeRef.current!.updatePointerWorldPoint({ x: 52, y: 51 }, 1);
    });
    expect(renderCount).toBe(1);
    expect(probeRef.current!.pointerWorldPointRef.current).toEqual({ x: 52, y: 51 });
    expect(probeRef.current!.pointerWorldPoint).toBeNull();

    // Genuine snap immediately before an endpoint commits once.
    await act(async () => {
      probeRef.current!.updatePointerWorldPoint({ x: 0.01, y: 0.01 }, 1);
    });
    expect(renderCount).toBe(2);
    expect(probeRef.current!.activeSnap?.kind).toBe('endpoint');
    expect(probeRef.current!.activeSnap?.sourceSegmentId).toBe('line:1#0');
    expect(probeRef.current!.activeSnap?.computedScale).toBe(1);
    expect(probeRef.current!.activeSnap?.viewportGeneration).toBe(5);

    // Re-resolving the identical snap bails out (semantic dedupe).
    await act(async () => {
      probeRef.current!.updatePointerWorldPoint({ x: 0.01, y: 0.01 }, 1);
    });
    expect(renderCount).toBe(2);

    // A different snap commits again; midpoint sourceSegmentId stays exact.
    await act(async () => {
      probeRef.current!.updatePointerWorldPoint({ x: 5, y: 0.01 }, 1);
    });
    expect(renderCount).toBe(3);
    expect(probeRef.current!.activeSnap?.kind).toBe('midpoint');
    expect(probeRef.current!.activeSnap?.sourceSegmentId).toBe('line:1#0');

    // Crossing point not at a midpoint resolves to intersection.
    await act(async () => {
      probeRef.current!.updatePointerWorldPoint({ x: 2, y: 0.01 }, 1);
    });
    expect(probeRef.current!.activeSnap?.kind).toBe('intersection');

    // Tab/cycle moves to another nearby candidate when tolerance admits more.
    await act(async () => {
      probeRef.current!.updatePointerWorldPoint({ x: 2, y: 0.01 }, 100);
    });
    const beforeCycleId = probeRef.current!.activeSnap?.id;
    await act(async () => {
      probeRef.current!.cycleActiveSnap();
    });
    expect(probeRef.current!.activeSnap?.id).not.toBe(beforeCycleId);

    // Leaving the canvas resets snap + pointer.
    await act(async () => {
      probeRef.current!.updatePointerWorldPoint(null);
    });
    expect(probeRef.current!.activeSnap).toBeNull();
    expect(probeRef.current!.pointerWorldPointRef.current).toBeNull();
    view.root.unmount();
  });

  it('commits reactive pointer state only while a command requests a preview', async () => {
    const project = buildSnapProject();
    const viewportRef = { current: 1 };
    const probeRef: { current: Snapping | null } = { current: null };
    let renderCount = 0;
    const view = await render(
      <SnapProbe
        project={project}
        viewportRef={viewportRef}
        probeRef={probeRef}
        onRender={() => { renderCount += 1; }}
      />,
    );
    expect(renderCount).toBe(1);

    await act(async () => {
      probeRef.current!.updatePointerWorldPoint({ x: 50, y: 50 }, 1, { reactivePreview: false });
    });
    expect(renderCount).toBe(1);

    await act(async () => {
      probeRef.current!.updatePointerWorldPoint({ x: 50, y: 50 }, 1, { reactivePreview: true });
    });
    expect(renderCount).toBe(2);
    expect(probeRef.current!.pointerWorldPoint).toEqual({ x: 50, y: 50 });
    view.root.unmount();
  });

  it('resets snap/pointer when the project reference changes', async () => {
    const project = buildSnapProject();
    const probeRef: { current: Snapping | null } = { current: null };
    const viewportRef = { current: 1 };
    const Swap: React.FC<{ activeProject: CadProject }> = ({ activeProject }) => (
      <SnapProbe project={activeProject} viewportRef={viewportRef} probeRef={probeRef} />
    );
    const { root } = await render(<Swap activeProject={project} />);
    await act(async () => {
      probeRef.current!.updatePointerWorldPoint({ x: 0.01, y: 0.01 }, 1);
    });
    expect(probeRef.current!.activeSnap).not.toBeNull();
    const renamed: CadProject = { ...project, id: 'perf-183-project-2' };
    await act(async () => {
      root.render(<Swap activeProject={renamed} />);
    });
    expect(probeRef.current!.activeSnap).toBeNull();
    expect(probeRef.current!.pointerWorldPointRef.current).toBeNull();
  });
});
