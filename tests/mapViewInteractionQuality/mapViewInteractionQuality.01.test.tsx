/** @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest';
import {
  act,
  createRoot,
  MapView,
  result,
  setMutableSvgRect,
} from './mapViewInteractionQualityTestSupport';
import type {
  Root,
  RafCallback,
} from './mapViewInteractionQualityTestSupport';

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
    const rectState = { left: 0, top: 0, width: 1000, height: 700 };
    setMutableSvgRect(svg, rectState);
    while (rafQueue.length > 0) {
      const frame = rafQueue.shift();
      if (!frame) break;
      await act(async () => {
        frame(performance.now());
        await Promise.resolve();
      });
    }

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
    expect(Number(phaseNode.dataset.mapViewZoom ?? '1')).toBe(1);
    expect(rafQueue.length).toBeGreaterThan(0);

    while (rafQueue.length > 0 && Number(phaseNode.dataset.mapViewZoom ?? '1') === 1) {
      const queuedFrame = rafQueue.shift();
      if (!queuedFrame) break;
      await act(async () => {
        queuedFrame(performance.now());
        await Promise.resolve();
      });
    }

    expect(Number(phaseNode.dataset.mapViewZoom ?? '1')).toBeGreaterThan(1);

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
    expect(snapshots.filter((snapshot) => snapshot.zoom > 1).length).toBe(1);

    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('coalesces burst pan moves into one frame-based view commit', async () => {
    vi.useFakeTimers();
    const rafQueue: RafCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: RafCallback) => {
      rafQueue.push(callback);
      return rafQueue.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});

    const snapshots: Array<{ panX: number; panY: number }> = [];
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
            snapshots.push({ panX: snapshot.view2d.panX, panY: snapshot.view2d.panY });
          }}
        />,
      );
    });

    const svg = container.querySelector('svg') as SVGSVGElement | null;
    const phaseNode = container.querySelector('[data-map-interaction-phase]') as HTMLElement | null;
    if (!svg || !phaseNode) throw new Error('MapView root nodes not found');
    const rectState = { left: 0, top: 0, width: 1000, height: 700 };
    setMutableSvgRect(svg, rectState);
    while (rafQueue.length > 0) {
      const frame = rafQueue.shift();
      if (!frame) break;
      await act(async () => {
        frame(performance.now());
        await Promise.resolve();
      });
    }

    await act(async () => {
      svg.dispatchEvent(
        new MouseEvent('mousedown', {
          button: 1,
          buttons: 4,
          clientX: 500,
          clientY: 350,
          bubbles: true,
          cancelable: true,
        }),
      );
      await Promise.resolve();
    });

    await act(async () => {
      window.dispatchEvent(
        new MouseEvent('mousemove', {
          button: 1,
          buttons: 4,
          clientX: 520,
          clientY: 360,
          bubbles: true,
          cancelable: true,
        }),
      );
      window.dispatchEvent(
        new MouseEvent('mousemove', {
          button: 1,
          buttons: 4,
          clientX: 540,
          clientY: 372,
          bubbles: true,
          cancelable: true,
        }),
      );
      window.dispatchEvent(
        new MouseEvent('mousemove', {
          button: 1,
          buttons: 4,
          clientX: 560,
          clientY: 384,
          bubbles: true,
          cancelable: true,
        }),
      );
      await Promise.resolve();
    });
    rectState.left = 20;
    rectState.top = 10;

    expect(phaseNode.dataset.mapInteractionPhase).toBe('idle');
    expect(Number(phaseNode.dataset.mapViewPanX ?? '0')).toBe(0);
    expect(Number(phaseNode.dataset.mapViewPanY ?? '0')).toBe(0);
    expect(Number(phaseNode.dataset.mapDerivedViewPanX ?? '0')).toBe(0);
    expect(Number(phaseNode.dataset.mapDerivedViewPanY ?? '0')).toBe(0);
    expect(rafQueue.length).toBeGreaterThan(0);

    while (
      rafQueue.length > 0 &&
      Number(phaseNode.dataset.mapViewPanX ?? '0') === 0 &&
      Number(phaseNode.dataset.mapViewPanY ?? '0') === 0
    ) {
      const queuedFrame = rafQueue.shift();
      if (!queuedFrame) break;
      await act(async () => {
        queuedFrame(performance.now());
        await Promise.resolve();
      });
    }

    expect(phaseNode.dataset.mapInteractionPhase).toBe('interacting');
    expect(Number(phaseNode.dataset.mapViewPanX ?? '0')).toBe(0);
    expect(Number(phaseNode.dataset.mapViewPanY ?? '0')).toBe(0);
    expect(Number(phaseNode.dataset.mapDerivedViewPanX ?? '0')).toBe(0);
    expect(Number(phaseNode.dataset.mapDerivedViewPanY ?? '0')).toBe(0);
    expect(Number(phaseNode.dataset.mapPreviewPanX ?? '0')).toBeCloseTo(60, 6);
    expect(Number(phaseNode.dataset.mapPreviewPanY ?? '0')).toBeCloseTo(34, 6);
    expect(snapshots.filter((snapshot) => snapshot.panX !== 0 || snapshot.panY !== 0).length).toBe(0);

    await act(async () => {
      window.dispatchEvent(
        new MouseEvent('mouseup', {
          button: 1,
          buttons: 0,
          clientX: 560,
          clientY: 384,
          bubbles: true,
          cancelable: true,
        }),
      );
      await Promise.resolve();
    });

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
    expect(Number(phaseNode.dataset.mapDerivedViewPanX ?? '0')).not.toBe(0);
    expect(Number(phaseNode.dataset.mapDerivedViewPanY ?? '0')).not.toBe(0);
    expect(Number(phaseNode.dataset.mapPreviewPanX ?? '0')).toBe(0);
    expect(Number(phaseNode.dataset.mapPreviewPanY ?? '0')).toBe(0);
    expect(Number(phaseNode.dataset.mapViewPanX ?? '0')).not.toBe(0);
    expect(Number(phaseNode.dataset.mapViewPanY ?? '0')).not.toBe(0);
    expect(snapshots.filter((snapshot) => snapshot.panX !== 0 || snapshot.panY !== 0).length).toBe(1);

    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

});
