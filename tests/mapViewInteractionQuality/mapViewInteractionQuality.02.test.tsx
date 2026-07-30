/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest';
import {
  React,
  act,
  createRoot,
  MapView,
  DEFAULT_PLANNING_MAP_STATE,
  result,
  setSvgRect,
  projectMapPoint2d,
} from './mapViewInteractionQualityTestSupport';
import type {
  Root,
  PlanningMapState,
} from './mapViewInteractionQualityTestSupport';

describe('MapView interaction quality', () => {
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
    expect(container.querySelector('[data-testid="map-context-menu"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="map-context-menu"]')?.className).toContain('z-[70]');
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
