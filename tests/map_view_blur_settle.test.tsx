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

describe('MapView blur settle', () => {
  it('returns to full DPR canvas redraw after interaction settle', async () => {
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
    const canvas = container.querySelector('[data-testid="map-base-canvas"]') as HTMLCanvasElement | null;
    expect(svg).toBeTruthy();
    expect(canvas).toBeTruthy();
    if (!svg || !canvas) throw new Error('Expected map canvas and svg');
    setSvgRect(svg);
    expect(canvas.width).toBe(2000);

    await act(async () => {
      svg.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY: -90,
          clientX: 500,
          clientY: 350,
          bubbles: true,
          cancelable: true,
        }),
      );
      await Promise.resolve();
    });
    expect(canvas.width).toBe(1000);

    const commitFrame = rafQueue.shift();
    if (!commitFrame) throw new Error('Expected view commit frame');
    await act(async () => {
      commitFrame(performance.now());
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(90);
      await Promise.resolve();
    });
    const settleFrame = rafQueue.shift();
    if (!settleFrame) throw new Error('Expected settle frame');
    await act(async () => {
      settleFrame(performance.now());
      await Promise.resolve();
    });
    expect(canvas.width).toBe(2000);

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
