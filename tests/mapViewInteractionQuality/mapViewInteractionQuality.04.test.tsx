/** @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest';
import {
  React,
  act,
  createRoot,
  MapView,
  DEFAULT_PLANNING_MAP_STATE,
  georeferencedResult,
  setSvgRect,
} from './mapViewInteractionQualityTestSupport';
import type {
  Root,
  PlanningMapState,
} from './mapViewInteractionQualityTestSupport';

describe('MapView interaction quality', () => {
  it('keeps labels visible and fetches planning obstacles even when OSM basemap is off', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        elements: [
          {
            id: 101,
            tags: { building: 'yes' },
            geometry: [
              { lat: 45.0001, lon: -63.0001 },
              { lat: 45.0001, lon: -62.9998 },
              { lat: 45.0003, lon: -62.9998 },
            ],
          },
        ],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    const Harness: React.FC = () => {
      const [planningMap, setPlanningMap] = React.useState<PlanningMapState>({
        ...DEFAULT_PLANNING_MAP_STATE,
        basemapMode: 'none' as const,
      });
      return (
        <>
          <div data-testid="obstacle-count">{planningMap.obstaclePolygons.length}</div>
          <MapView
            result={georeferencedResult}
            units="m"
            planningMap={planningMap}
            onPlanningMapChange={setPlanningMap}
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

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-map-label="A"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="obstacle-count"]')?.textContent).toBe('1');

    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
  });

  it('keeps visible point labels when OSM basemap is on for planning-sized networks', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    const Harness: React.FC = () => {
      const [planningMap, setPlanningMap] = React.useState<PlanningMapState>({
        ...DEFAULT_PLANNING_MAP_STATE,
        basemapMode: 'osm' as const,
      });
      return (
        <MapView
          result={georeferencedResult}
          units="m"
          planningMap={planningMap}
          onPlanningMapChange={setPlanningMap}
        />
      );
    };

    await act(async () => {
      root.render(<Harness />);
    });

    const svg = container.querySelector('svg') as SVGSVGElement | null;
    if (!svg) throw new Error('Expected map svg');
    setSvgRect(svg);

    await act(async () => {
      await Promise.resolve();
    });

    const planningCanvas = container.querySelector(
      '[data-testid="map-planning-canvas"]',
    ) as HTMLCanvasElement | null;
    const overlaySvg = container.querySelector('svg') as SVGSVGElement | null;
    if (!planningCanvas || !overlaySvg) throw new Error('Expected 2D map overlay stack');

    expect(container.querySelectorAll('[data-map-label]').length).toBeGreaterThan(0);
    expect(container.querySelector('[data-map-label="A"]')).not.toBeNull();
    expect(planningCanvas.className).toContain('z-10');
    expect(overlaySvg.className.baseVal).toContain('z-30');
    expect(
      planningCanvas.compareDocumentPosition(overlaySvg) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
