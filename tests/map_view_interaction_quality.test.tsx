/** @vitest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import MapView from '../src/components/MapView';
import { LSAEngine } from '../src/engine/adjust';
import { DEFAULT_PLANNING_MAP_STATE } from '../src/engine/planningMapState';
import type { PlanningMapState } from '../src/types';

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

const projectMapPoint2d = (
  stations: Record<string, { x: number; y: number }>,
  point: { x: number; y: number },
) => {
  const rows = Object.values(stations);
  const xs = rows.map((station) => station.x);
  const ys = rows.map((station) => station.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const pad = Math.max((maxX - minX) * 0.1, (maxY - minY) * 0.1, 1);
  const width = maxX - minX + pad * 2;
  const height = maxY - minY + pad * 2;
  const scale = Math.min(1000 / width, 700 / height);
  const offsetX = (1000 - width * scale) * 0.5;
  const offsetY = (700 - height * scale) * 0.5;
  return {
    x: offsetX + (point.x - (minX - pad)) * scale,
    y: 700 - (offsetY + (point.y - (minY - pad)) * scale),
  };
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
    setSvgRect(svg);
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
    expect(Number(phaseNode.dataset.mapViewPanX ?? '0')).not.toBe(0);
    expect(Number(phaseNode.dataset.mapViewPanY ?? '0')).not.toBe(0);
    expect(Number(phaseNode.dataset.mapDerivedViewPanX ?? '0')).toBe(0);
    expect(Number(phaseNode.dataset.mapDerivedViewPanY ?? '0')).toBe(0);
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
    expect(snapshots.filter((snapshot) => snapshot.panX !== 0 || snapshot.panY !== 0).length).toBe(1);

    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('shows OSM attribution, clears selection on empty click/Escape, and applies directional box selection rules for planning polygons', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    const Harness: React.FC = () => {
      const [planningMap, setPlanningMap] = React.useState<PlanningMapState>({
        ...DEFAULT_PLANNING_MAP_STATE,
        basemapMode: 'osm' as const,
        showBlockedAreas: true,
        blockedPolygons: [
          {
            id: 'poly-1',
            source: 'user' as const,
            kind: 'blocked-area' as const,
            label: 'Blocked 1',
            vertices: [
              { x: 50, y: 20 },
              { x: 80, y: 20 },
              { x: 80, y: 55 },
              { x: 50, y: 55 },
            ],
          },
          {
            id: 'poly-2',
            source: 'user' as const,
            kind: 'blocked-area' as const,
            label: 'Blocked 2',
            vertices: [
              { x: 12, y: 10 },
              { x: 28, y: 10 },
              { x: 28, y: 24 },
              { x: 12, y: 24 },
            ],
          },
          {
            id: 'poly-3',
            source: 'user' as const,
            kind: 'blocked-area' as const,
            label: 'Blocked 3',
            vertices: [
              { x: 32, y: 10 },
              { x: 46, y: 10 },
              { x: 46, y: 24 },
              { x: 32, y: 24 },
            ],
          },
        ],
      });
      const [selectedStationId, setSelectedStationId] = React.useState<string | null>('C');
      const [selectedObservationId, setSelectedObservationId] = React.useState<number | null>(
        result.observations[0]?.id ?? null,
      );
      return (
        <>
          <div data-testid="selected-station">{selectedStationId ?? '-'}</div>
          <div data-testid="selected-observation">{selectedObservationId ?? '-'}</div>
          <MapView
            result={result}
            units="m"
            planningMap={planningMap}
            onPlanningMapChange={setPlanningMap}
            selectedStationId={selectedStationId}
            selectedObservationId={selectedObservationId}
            onSelectStation={setSelectedStationId}
            onSelectObservation={setSelectedObservationId}
          />
        </>
      );
    };

    await act(async () => {
      root.render(<Harness />);
    });

    const svg = container.querySelector('svg') as SVGSVGElement | null;
    if (!svg) throw new Error('Expected map svg');
    setSvgRect(svg);
    expect(container.textContent).toContain('Basemap © OpenStreetMap contributors');
    expect(container.querySelector('[data-testid="map-planning-canvas"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="map-renderer-badge"]')?.textContent).toContain(
      'Renderer:',
    );

    const empty = projectMapPoint2d(result.stations, { x: -10, y: -10 });
    const polygonClick = projectMapPoint2d(result.stations, { x: 60, y: 35 });
    const windowStart = projectMapPoint2d(result.stations, { x: 10, y: 8 });
    const windowEnd = projectMapPoint2d(result.stations, { x: 40, y: 26 });
    const crossingStart = projectMapPoint2d(result.stations, { x: 48, y: 28 });
    const crossingEnd = projectMapPoint2d(result.stations, { x: 8, y: 6 });

    await act(async () => {
      svg.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: polygonClick.x,
          clientY: polygonClick.y,
        }),
      );
    });
    expect(container.querySelector('[data-planning-vertex="poly-1:0"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="selected-station"]')?.textContent).toBe('-');
    expect(container.querySelector('[data-testid="selected-observation"]')?.textContent).toBe('-');

    await act(async () => {
      svg.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: empty.x,
          clientY: empty.y,
        }),
      );
    });
    expect(container.querySelector('[data-testid="selected-station"]')?.textContent).toBe('-');
    expect(container.querySelector('[data-testid="selected-observation"]')?.textContent).toBe('-');
    expect(container.querySelector('[data-map-selection-box="true"]')).toBeNull();

    await act(async () => {
      svg.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: windowStart.x,
          clientY: windowStart.y,
        }),
      );
    });
    const selectionBox = container.querySelector('[data-map-selection-box="true"]') as SVGRectElement | null;
    expect(selectionBox).not.toBeNull();
    expect(Number(selectionBox?.getAttribute('x') ?? 'NaN')).toBeCloseTo(windowStart.x, 1);
    expect(Number(selectionBox?.getAttribute('y') ?? 'NaN')).toBeCloseTo(windowStart.y, 1);
    expect(selectionBox?.getAttribute('data-map-selection-mode')).toBe('window');

    await act(async () => {
      window.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: windowEnd.x,
          clientY: windowEnd.y,
        }),
      );
    });
    const activeWindowBox = container.querySelector('[data-map-selection-box="true"]') as SVGRectElement | null;
    expect(activeWindowBox?.getAttribute('data-map-selection-mode')).toBe('window');
    expect(activeWindowBox?.getAttribute('stroke')).toBe('#67e8f9');

    await act(async () => {
      svg.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: windowEnd.x,
          clientY: windowEnd.y,
        }),
      );
    });
    expect(container.querySelector('[data-map-selection-box="true"]')).toBeNull();
    expect(container.querySelector('[data-planning-vertex="poly-2:0"]')).not.toBeNull();
    expect(container.querySelector('[data-planning-vertex="poly-3:0"]')).toBeNull();

    await act(async () => {
      svg.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: empty.x,
          clientY: empty.y,
        }),
      );
    });
    await act(async () => {
      svg.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: crossingStart.x,
          clientY: crossingStart.y,
        }),
      );
    });
    await act(async () => {
      window.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: crossingEnd.x,
          clientY: crossingEnd.y,
        }),
      );
    });
    const activeCrossingBox = container.querySelector('[data-map-selection-box="true"]') as SVGRectElement | null;
    expect(activeCrossingBox?.getAttribute('data-map-selection-mode')).toBe('crossing');
    expect(activeCrossingBox?.getAttribute('stroke')).toBe('#fbbf24');

    await act(async () => {
      svg.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: crossingEnd.x,
          clientY: crossingEnd.y,
        }),
      );
    });
    expect(container.querySelector('[data-map-selection-box="true"]')).toBeNull();
    expect(container.querySelector('[data-planning-vertex="poly-2:0"]')).toBeNull();
    expect(container.querySelector('[data-planning-vertex="poly-3:0"]')).toBeNull();

    const secondPolygonPoint = projectMapPoint2d(result.stations, { x: 14, y: 12 });
    await act(async () => {
      svg.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          clientX: secondPolygonPoint.x,
          clientY: secondPolygonPoint.y,
        }),
      );
    });
    expect(container.textContent).toContain('Delete selected obstacles');
    expect(container.querySelector('[data-planning-vertex="poly-2:0"]')).toBeNull();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(container.querySelector('[data-planning-vertex="poly-2:0"]')).toBeNull();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
