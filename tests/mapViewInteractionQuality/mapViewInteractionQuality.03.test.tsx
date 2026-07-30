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
  setTextInputValue,
  setSelectValue,
} from './mapViewInteractionQualityTestSupport';
import type {
  Root,
  PlanningMapState,
} from './mapViewInteractionQualityTestSupport';

describe('MapView interaction quality', () => {
  it('prioritizes point and line clicks over polygon hits and keeps the selection applied', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    const stationC = result.stations.C;
    const stationA = result.stations.A;
    if (!stationC || !stationA) throw new Error('Expected fixture stations A and C');

    const lineMidpoint = {
      x: (stationA.x + stationC.x) * 0.5,
      y: (stationA.y + stationC.y) * 0.5,
    };

    const Harness: React.FC = () => {
      const [planningMap, setPlanningMap] = React.useState<PlanningMapState>({
        ...DEFAULT_PLANNING_MAP_STATE,
        basemapMode: 'osm' as const,
        showBlockedAreas: true,
        blockedPolygons: [
          {
            id: 'poly-cover',
            source: 'user' as const,
            kind: 'blocked-area' as const,
            label: 'Cover polygon',
            vertices: [
              { x: 0, y: -10 },
              { x: 70, y: -10 },
              { x: 70, y: 55 },
              { x: 0, y: 55 },
            ],
          },
        ],
      });
      const [selectedStationId, setSelectedStationId] = React.useState<string | null>(null);
      const [selectedObservationId, setSelectedObservationId] = React.useState<number | null>(null);
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

    const stationPoint = projectMapPoint2d(result.stations, { x: stationC.x, y: stationC.y });
    const linePoint = projectMapPoint2d(result.stations, lineMidpoint);

    await act(async () => {
      svg.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: stationPoint.x,
          clientY: stationPoint.y,
        }),
      );
    });

    expect(container.querySelector('[data-testid="selected-station"]')?.textContent).toBe('C');
    expect(container.querySelector('[data-testid="selected-observation"]')?.textContent).toBe('-');
    expect(container.querySelector('[data-planning-vertex="poly-cover:0"]')).toBeNull();

    await act(async () => {
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="selected-station"]')?.textContent).toBe('C');

    await act(async () => {
      svg.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: linePoint.x,
          clientY: linePoint.y,
        }),
      );
    });

    expect(container.querySelector('[data-testid="selected-station"]')?.textContent).toBe('C');
    expect(container.querySelector('[data-testid="selected-observation"]')?.textContent).toBe(
      String(result.observations[0]?.id ?? '-'),
    );
    expect(container.querySelector('[data-planning-vertex="poly-cover:0"]')).toBeNull();

    const planningCanvas = container.querySelector(
      '[data-testid="map-planning-canvas"]',
    ) as HTMLCanvasElement | null;
    const geometryCanvas = container.querySelector(
      '[data-testid="map-geometry-canvas"]',
    ) as HTMLCanvasElement | null;
    if (!planningCanvas || !geometryCanvas) throw new Error('Expected 2D map canvases');
    expect(
      planningCanvas.compareDocumentPosition(geometryCanvas) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('keeps inverse and angle tool inputs editable, syncs pick/select controls, and highlights tool geometry', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    await act(async () => {
      root.render(
        <MapView
          result={result}
          units="m"
          planningMap={DEFAULT_PLANNING_MAP_STATE}
        />,
      );
    });

    const svg = container.querySelector('svg') as SVGSVGElement | null;
    if (!svg) throw new Error('Expected map svg');
    setSvgRect(svg);

    const openTool = async (label: 'Inverse' | 'Angles Between') => {
      await act(async () => {
        svg.dispatchEvent(
          new MouseEvent('contextmenu', {
            bubbles: true,
            clientX: 500,
            clientY: 350,
          }),
        );
      });
      const button = Array.from(container.querySelectorAll('button')).find(
        (entry) => entry.textContent?.trim() === label,
      );
      if (!button) throw new Error(`Expected ${label} context action`);
      await act(async () => {
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
    };

    await openTool('Inverse');

    const inverseFromInput = container.querySelector(
      '[data-testid="inverse-from-input"]',
    ) as HTMLInputElement | null;
    const inverseToSelect = container.querySelector(
      '[data-testid="inverse-to-select"]',
    ) as HTMLSelectElement | null;
    if (!inverseFromInput || !inverseToSelect) {
      throw new Error('Expected inverse tool controls');
    }

    await act(async () => {
      setTextInputValue(inverseFromInput, 'ZZ');
    });
    expect(inverseFromInput.value).toBe('ZZ');

    const inversePickButton = container.querySelector(
      '[data-map-pick-target="inverse-from"]',
    ) as HTMLButtonElement | null;
    if (!inversePickButton) throw new Error('Expected inverse pick button');
    const stationA = result.stations.A;
    const stationB = result.stations.B;
    const stationC = result.stations.C;
    if (!stationA || !stationB || !stationC) throw new Error('Expected fixture stations');

    await act(async () => {
      inversePickButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const pointA = projectMapPoint2d(result.stations, { x: stationA.x, y: stationA.y });
    await act(async () => {
      svg.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: pointA.x,
          clientY: pointA.y,
        }),
      );
    });
    expect(inverseFromInput.value).toBe('A');

    await act(async () => {
      setSelectValue(inverseToSelect, 'B');
    });
    const inverseToInput = container.querySelector(
      '[data-testid="inverse-to-input"]',
    ) as HTMLInputElement | null;
    if (!inverseToInput) throw new Error('Expected inverse to input');
    expect(inverseToInput.value).toBe('B');
    expect(container.querySelector('[data-map-tool-station-highlight="A"]')).not.toBeNull();
    expect(container.querySelector('[data-map-tool-station-highlight="B"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-map-tool-line-highlight]').length).toBeGreaterThan(0);

    const closeButton = Array.from(container.querySelectorAll('button')).find(
      (entry) => entry.textContent?.trim() === 'Close',
    );
    if (!closeButton) throw new Error('Expected tool close button');
    await act(async () => {
      closeButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await openTool('Angles Between');

    const anglePivotInput = container.querySelector(
      '[data-testid="angle-pivot-input"]',
    ) as HTMLInputElement | null;
    const angleFromSelect = container.querySelector(
      '[data-testid="angle-from-select"]',
    ) as HTMLSelectElement | null;
    const angleToSelect = container.querySelector(
      '[data-testid="angle-to-select"]',
    ) as HTMLSelectElement | null;
    if (!anglePivotInput || !angleFromSelect || !angleToSelect) {
      throw new Error('Expected angle tool controls');
    }

    await act(async () => {
      setTextInputValue(anglePivotInput, 'BAD');
    });
    expect(anglePivotInput.value).toBe('BAD');

    const anglePivotPickButton = container.querySelector(
      '[data-map-pick-target="angle-pivot"]',
    ) as HTMLButtonElement | null;
    if (!anglePivotPickButton) throw new Error('Expected angle pivot pick button');
    const pointC = projectMapPoint2d(result.stations, { x: stationC.x, y: stationC.y });
    await act(async () => {
      anglePivotPickButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      svg.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: pointC.x,
          clientY: pointC.y,
        }),
      );
    });
    expect(anglePivotInput.value).toBe('C');

    await act(async () => {
      setSelectValue(angleFromSelect, 'A');
      setSelectValue(angleToSelect, 'B');
    });
    expect(
      (container.querySelector('[data-testid="angle-from-input"]') as HTMLInputElement | null)
        ?.value,
    ).toBe('A');
    expect(
      (container.querySelector('[data-testid="angle-to-input"]') as HTMLInputElement | null)?.value,
    ).toBe('B');
    expect(container.querySelector('[data-map-tool-station-highlight="C"]')).not.toBeNull();
    expect(container.querySelector('[data-map-tool-station-highlight="A"]')).not.toBeNull();
    expect(container.querySelector('[data-map-tool-station-highlight="B"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-map-tool-line-highlight]').length).toBe(2);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

});
