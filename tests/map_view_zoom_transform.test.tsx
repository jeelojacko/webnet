/** @vitest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import MapView from '../src/components/MapView';
import { LSAEngine } from '../src/engine/adjust';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const input = [
  '.2D',
  'C A 0 0 0 ! !',
  'C B 100 0 0 ! !',
  'C C 60 40 0',
  'D A-C 72.1110255 0.005',
  'D B-C 56.5685425 0.005',
  'A C-A-B 90-00-00 3',
].join('\n');

const result = new LSAEngine({ input, maxIterations: 8 }).solve();
type RafCallback = (_timestamp: number) => void;

const setSvgRect = (svg: SVGSVGElement) => {
  Object.defineProperty(svg, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      left: 0,
      top: 0,
      width: 1000,
      height: 700,
      right: 1000,
      bottom: 700,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  });
};

const createMock2dContext = () =>
  ({
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    save: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    restore: vi.fn(),
    rotate: vi.fn(),
    ellipse: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    lineCap: 'round',
    lineJoin: 'round',
    strokeStyle: '#000',
    lineWidth: 1,
    globalAlpha: 1,
    fillStyle: '#000',
  }) as unknown as CanvasRenderingContext2D;

const shapeRenderingOf = (svg: SVGSVGElement) =>
  svg.getAttribute('shape-rendering') ?? svg.getAttribute('shapeRendering');

describe('MapView zoom gesture transform snapshot', () => {
  it('applies the same per-frame view transform to the SVG group and the canvas layers', async () => {
    vi.useFakeTimers();
    const rafQueue: RafCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: RafCallback) => {
      rafQueue.push(callback);
      return rafQueue.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    (globalThis as { __WEBNET_ENABLE_CANVAS_RENDER_TEST__?: boolean }).__WEBNET_ENABLE_CANVAS_RENDER_TEST__ =
      true;
    Object.defineProperty(window, 'devicePixelRatio', {
      configurable: true,
      value: 2,
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => createMock2dContext());

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    await act(async () => {
      root.render(<MapView result={result} units="m" showLostStations={true} />);
    });

    const svg = container.querySelector('svg') as SVGSVGElement | null;
    const phaseNode = container.querySelector('[data-map-interaction-phase]') as HTMLElement | null;
    const basemapCanvas = container.querySelector(
      '[data-testid="map-base-canvas"]',
    ) as HTMLCanvasElement | null;
    const geometryCanvas = container.querySelector(
      '[data-testid="map-geometry-canvas"]',
    ) as HTMLCanvasElement | null;
    if (!svg || !phaseNode || !basemapCanvas || !geometryCanvas) {
      throw new Error('Expected 2D map overlay stack');
    }
    setSvgRect(svg);

    const runFrame = async () => {
      const frame = rafQueue.shift();
      if (!frame) return false;
      await act(async () => {
        frame(performance.now());
        await Promise.resolve();
      });
      return true;
    };

    const assertSharedSnapshot = () => {
      const containerZoom = Number(phaseNode.dataset.mapViewZoom ?? '1');
      const containerPanX = Number(phaseNode.dataset.mapViewPanX ?? '0');
      const containerPanY = Number(phaseNode.dataset.mapViewPanY ?? '0');
      const groups = Array.from(
        svg.querySelectorAll('[data-map-view-transform]'),
      ) as SVGGElement[];
      expect(groups.length).toBeGreaterThan(0);
      const transforms = [
        ...groups.map((group) => group.getAttribute('data-map-view-transform')),
        basemapCanvas.dataset.mapViewTransform,
        geometryCanvas.dataset.mapViewTransform,
      ];
      // Every layer records the exact same per-frame transform snapshot.
      expect(new Set(transforms).size).toBe(1);
      const transform = transforms[0] ?? '';
      const match = transform.match(
        /^translate\(([-0-9.eE]+) ([-0-9.eE]+)\) scale\(([-0-9.eE]+)\)$/,
      );
      expect(match).not.toBeNull();
      if (!match) return;
      expect(Number(match[3])).toBeCloseTo(containerZoom, 5);
      expect(Number(match[1])).toBeCloseTo(containerPanX, 4);
      expect(Number(match[2])).toBeCloseTo(containerPanY, 4);
    };

    await act(async () => {
      svg.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY: -80,
          clientX: 500,
          clientY: 350,
          bubbles: true,
          cancelable: true,
        }),
      );
      await Promise.resolve();
    });

    expect(phaseNode.dataset.mapInteractionPhase).toBe('interacting');
    expect(shapeRenderingOf(svg)).toBe('optimizeSpeed');

    for (let index = 0; index < 5; index += 1) {
      await act(async () => {
        svg.dispatchEvent(
          new WheelEvent('wheel', {
            deltaY: -80,
            clientX: 500,
            clientY: 350,
            bubbles: true,
            cancelable: true,
          }),
        );
        await Promise.resolve();
      });
      while (rafQueue.length > 0) {
        await runFrame();
        if (Number(phaseNode.dataset.mapViewZoom ?? '1') > 1) break;
      }
      expect(phaseNode.dataset.mapInteractionPhase).toBe('interacting');
      expect(shapeRenderingOf(svg)).toBe('optimizeSpeed');
      assertSharedSnapshot();
    }

    await act(async () => {
      vi.advanceTimersByTime(90);
      await Promise.resolve();
    });
    expect(phaseNode.dataset.mapInteractionPhase).toBe('settling');
    // shapeRendering must not flip back while the gesture is still settling.
    expect(shapeRenderingOf(svg)).toBe('optimizeSpeed');

    const settleFrame = rafQueue.shift();
    if (settleFrame) {
      await act(async () => {
        settleFrame(performance.now());
        await Promise.resolve();
      });
    }
    await runFrame();
    expect(phaseNode.dataset.mapInteractionPhase).toBe('idle');
    expect(shapeRenderingOf(svg)).toBe('geometricPrecision');
    assertSharedSnapshot();

    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
    (globalThis as { __WEBNET_ENABLE_CANVAS_RENDER_TEST__?: boolean }).__WEBNET_ENABLE_CANVAS_RENDER_TEST__ =
      false;
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
});
