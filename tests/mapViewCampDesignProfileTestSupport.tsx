import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { vi } from 'vitest';

import MapView from '../src/components/MapView';
import {
  getLatestMapViewPerfCapture,
  resetMapViewPerfCapture,
  type MapViewPerfSnapshot,
} from '../src/components/mapView/mapViewPerf';
import { buildQaDerivedResult } from '../src/engine/qaWorkflow';
import {
  buildCampDesignPlanningMapState,
  buildCampDesignPreanalysisResult,
  createFakeWebgl2Context,
  createMapSnapshotForScenario,
  createMock2dContext,
  loadCampProfileMatrix,
  median,
  setSvgRect,
  type CampProfileScenario,
  type CampProfileSweep,
} from './helpers/campDesignMapPerfHarness';

type RafCallback = (_timestamp: number) => void;
export type RendererMode = 'webgl' | 'canvas';

export type SweepSummary = {
  renderer: RendererMode;
  scenarioId: string;
  sweepId: string;
  sweepKind: CampProfileSweep['kind'];
  elapsedMs: number;
  counters: Record<string, number>;
  metadata: Record<string, unknown>;
  timings: Record<
    string,
    {
      count: number;
      totalMs: number;
      maxMs: number;
      medianMs: number;
    }
  >;
  topTimingNames: string[];
};

const result = buildCampDesignPreanalysisResult();
const derivedResult = buildQaDerivedResult(result);
export const matrix = loadCampProfileMatrix();

const clonePerfSnapshot = (snapshot: MapViewPerfSnapshot | null): SweepSummary['timings'] => {
  if (!snapshot) return {};
  return Object.fromEntries(
    Object.entries(snapshot.timings).map(([name, stat]) => [
      name,
      {
        count: stat.count,
        totalMs: Number(stat.totalMs.toFixed(3)),
        maxMs: Number(stat.maxMs.toFixed(3)),
        medianMs: Number(median(stat.samplesMs).toFixed(3)),
      },
    ]),
  );
};

const topTimingNames = (timings: SweepSummary['timings']): string[] =>
  Object.entries(timings)
    .sort((left, right) => right[1].totalMs - left[1].totalMs)
    .slice(0, 6)
    .map(([name]) => name);

const summarizeCapture = (
  renderer: RendererMode,
  scenario: CampProfileScenario,
  sweep: CampProfileSweep,
  elapsedMs: number,
  snapshot: MapViewPerfSnapshot | null,
): SweepSummary => {
  const timings = clonePerfSnapshot(snapshot);
  return {
    renderer,
    scenarioId: scenario.id,
    sweepId: sweep.id,
    sweepKind: sweep.kind,
    elapsedMs: Number(elapsedMs.toFixed(3)),
    counters: { ...(snapshot?.counters ?? {}) },
    metadata: { ...(snapshot?.metadata ?? {}) },
    timings,
    topTimingNames: topTimingNames(timings),
  };
};

const createMockImageClass = () =>
  class MockImage {
    width = 256;
    height = 256;
    naturalWidth = 256;
    naturalHeight = 256;
    decoding = 'async';
    loading = 'eager';
    fetchPriority = 'high';
    crossOrigin: string | null = null;
    onload: null | (() => void) = null;
    onerror: null | (() => void) = null;
    private currentSrc = '';

    get src(): string {
      return this.currentSrc;
    }

    set src(value: string) {
      this.currentSrc = value;
      setTimeout(() => {
        this.onload?.();
      }, 0);
    }
  };

const flushRafQueue = async (queue: RafCallback[]) => {
  while (queue.length > 0) {
    const frame = queue.shift();
    if (!frame) break;
    await act(async () => {
      frame(performance.now());
      await Promise.resolve();
    });
  }
};

const flushMapSettled = async (queue: RafCallback[]) => {
  for (let index = 0; index < 4; index += 1) {
    await act(async () => {
      vi.advanceTimersByTime(0);
      await Promise.resolve();
    });
    await flushRafQueue(queue);
  }
  await act(async () => {
    vi.advanceTimersByTime(120);
    await Promise.resolve();
  });
  await flushRafQueue(queue);
};

const createMiddleMouseEvent = (
  type: 'mousedown' | 'mousemove' | 'mouseup',
  clientX: number,
  clientY: number,
) => {
  const event = new MouseEvent(type, {
    button: 1,
    buttons: type === 'mouseup' ? 0 : 4,
    clientX,
    clientY,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, 'which', {
    configurable: true,
    value: 2,
  });
  return event;
};

const runPanSweep = async (
  svg: SVGSVGElement,
  queue: RafCallback[],
  sweep: Extract<CampProfileSweep, { kind: 'pan' }>,
) => {
  const startX = 480;
  const startY = 340;
  await act(async () => {
    svg.dispatchEvent(createMiddleMouseEvent('mousedown', startX, startY));
    await Promise.resolve();
  });
  await act(async () => {
    vi.advanceTimersByTime(0);
    await Promise.resolve();
  });
  for (let step = 1; step <= sweep.stepCount; step += 1) {
    await act(async () => {
      window.dispatchEvent(
        createMiddleMouseEvent(
          'mousemove',
          startX + sweep.dxPerStep * step,
          startY + sweep.dyPerStep * step,
        ),
      );
      await Promise.resolve();
    });
    if (sweep.flushEveryStep) {
      await flushRafQueue(queue);
    }
  }
  await act(async () => {
    window.dispatchEvent(
      createMiddleMouseEvent(
        'mouseup',
        startX + sweep.dxPerStep * sweep.stepCount,
        startY + sweep.dyPerStep * sweep.stepCount,
      ),
    );
    await Promise.resolve();
  });
  await flushMapSettled(queue);
};

const runZoomSweep = async (
  svg: SVGSVGElement,
  queue: RafCallback[],
  sweep: Extract<CampProfileSweep, { kind: 'zoom' }>,
) => {
  const anchorX = 500;
  const anchorY = 350;
  for (let step = 0; step < sweep.stepCount; step += 1) {
    await act(async () => {
      svg.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY: sweep.deltaYPerStep,
          clientX: anchorX + (step % 3) * 10,
          clientY: anchorY + (step % 2) * 8,
          bubbles: true,
          cancelable: true,
        }),
      );
      await Promise.resolve();
    });
    if (sweep.flushEveryStep) {
      await flushRafQueue(queue);
    }
  }
  await flushMapSettled(queue);
};

export const profileScenarioSweep = async (
  renderer: RendererMode,
  scenario: CampProfileScenario,
  sweep: CampProfileSweep,
): Promise<SweepSummary> => {
  vi.useFakeTimers();
  const rafQueue: RafCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: RafCallback) => {
    rafQueue.push(callback);
    return rafQueue.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  (globalThis as { __WEBNET_ENABLE_MAP_PERF_CAPTURE__?: boolean }).__WEBNET_ENABLE_MAP_PERF_CAPTURE__ =
    true;
  (globalThis as { __WEBNET_ENABLE_WEBGL_RENDER_TEST__?: boolean }).__WEBNET_ENABLE_WEBGL_RENDER_TEST__ =
    renderer === 'webgl';
  (globalThis as { __WEBNET_ENABLE_CANVAS_RENDER_TEST__?: boolean }).__WEBNET_ENABLE_CANVAS_RENDER_TEST__ =
    true;
  vi.stubGlobal('Image', createMockImageClass() as unknown as typeof Image);

  const webglContext = createFakeWebgl2Context();
  const canvasContext = createMock2dContext();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement,
    kind: string,
  ) {
    if (kind === 'webgl2') return (renderer === 'webgl' ? webglContext : null) as never;
    if (kind === '2d') return canvasContext as never;
    return null;
  });

  const planningMap = buildCampDesignPlanningMapState(scenario);
  const snapshot = createMapSnapshotForScenario(scenario);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  try {
    resetMapViewPerfCapture(`${renderer}:${scenario.id}:mount`, {
      renderer,
      scenarioId: scenario.id,
      sweepId: 'mount',
    });
    await act(async () => {
      root.render(
        <MapView
          result={result}
          derivedResult={derivedResult}
          units="m"
          showLostStations={true}
          planningMap={planningMap}
          inputPointsLoaded={true}
          snapshot={snapshot}
        />,
      );
    });
    const svg = container.querySelector('svg');
    if (!(svg instanceof SVGSVGElement)) {
      throw new Error(`Expected map svg for ${renderer}:${scenario.id}`);
    }
    setSvgRect(svg);
    await flushMapSettled(rafQueue);
    const warmCapture = getLatestMapViewPerfCapture();

    resetMapViewPerfCapture(`${renderer}:${scenario.id}:${sweep.id}`, {
      ...(warmCapture?.metadata ?? {}),
      renderer,
      scenarioId: scenario.id,
      sweepId: sweep.id,
      sweepKind: sweep.kind,
    });
    const startedAt = performance.now();
    if (sweep.kind === 'pan') {
      await runPanSweep(svg, rafQueue, sweep);
    } else {
      await runZoomSweep(svg, rafQueue, sweep);
    }
    const elapsedMs = performance.now() - startedAt;
    const capture = getLatestMapViewPerfCapture();
    return summarizeCapture(renderer, scenario, sweep, elapsedMs, capture);
  } finally {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
};

export const printProfileSummary = (rows: SweepSummary[]) => {
  const compact = rows.map((row) => ({
    renderer: row.renderer,
    scenario: row.scenarioId,
    sweep: row.sweepId,
    elapsedMs: row.elapsedMs,
    rendererMode: row.metadata['map:renderer2d'],
    points: row.metadata['map:visible-point-count'],
    lines: row.metadata['map:visible-line-count'],
    labels: row.metadata['svg:last-label-count'],
    polygons: row.metadata['map:planning-polygon-count'],
    tileRequests: row.counters['tiles:requested-descriptors'] ?? 0,
    wheelEvents: row.counters['map:wheel-events'] ?? 0,
    dragMoves: row.counters['map:drag-move:pan2d'] ?? 0,
    topCost: row.topTimingNames[0] ?? '-',
    topCostMs: row.topTimingNames[0] ? row.timings[row.topTimingNames[0]]?.totalMs ?? 0 : 0,
  }));
  console.table(compact);
};
