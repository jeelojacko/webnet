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

describe('MapView interaction quality', () => {
  it('coalesces burst wheel updates into a frame-based view commit and transitions interaction phase', async () => {
    vi.useFakeTimers();
    const rafQueue: RafCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: RafCallback) => {
      rafQueue.push(callback);
      return rafQueue.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});

    const snapshots: Array<{ zoom: number }> = [];
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    await act(async () => {
      root.render(
        <MapView
          result={result}
          units="m"
          showLostStations={true}
          onSnapshotChange={(snapshot) => {
            snapshots.push({ zoom: snapshot.view2d.zoom });
          }}
        />,
      );
    });

    const svg = container.querySelector('svg') as SVGSVGElement | null;
    const phaseNode = container.querySelector('[data-map-interaction-phase]') as HTMLElement | null;
    expect(svg).toBeTruthy();
    expect(phaseNode).toBeTruthy();
    if (!svg || !phaseNode) throw new Error('MapView root nodes not found');
    setSvgRect(svg);

    await act(async () => {
      svg.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY: -80,
          clientX: 480,
          clientY: 320,
          bubbles: true,
          cancelable: true,
        }),
      );
      svg.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY: -80,
          clientX: 500,
          clientY: 340,
          bubbles: true,
          cancelable: true,
        }),
      );
      svg.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY: -80,
          clientX: 520,
          clientY: 360,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(phaseNode.dataset.mapInteractionPhase).toBe('interacting');
    expect(snapshots.filter((snapshot) => snapshot.zoom !== 1).length).toBe(0);
    expect(rafQueue.length).toBeGreaterThan(0);

    const commitFrame = rafQueue.shift();
    if (!commitFrame) throw new Error('Expected queued frame commit');
    await act(async () => {
      commitFrame(performance.now());
      await Promise.resolve();
    });

    expect(snapshots.filter((snapshot) => snapshot.zoom > 1).length).toBe(1);

    await act(async () => {
      vi.advanceTimersByTime(90);
      await Promise.resolve();
    });
    expect(phaseNode.dataset.mapInteractionPhase).toBe('settling');

    const settleFrame = rafQueue.shift();
    if (!settleFrame) throw new Error('Expected settling frame');
    await act(async () => {
      settleFrame(performance.now());
      await Promise.resolve();
    });
    expect(phaseNode.dataset.mapInteractionPhase).toBe('idle');

    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
});
