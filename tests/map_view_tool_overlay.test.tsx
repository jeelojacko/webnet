/** @vitest-environment jsdom */

import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import type { VisibleStationRow } from '../src/engine/resultDerivedModels';
import MapViewContextMenu from '../src/components/mapView/MapViewContextMenu';
import MapViewToolOverlay from '../src/components/mapView/MapViewToolOverlay';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const visibleStationRows: VisibleStationRow[] = [
  {
    id: 'A',
    station: { x: 100, y: 200, h: 10, fixed: true, sN: 0.01, sE: 0.02, sH: 0.03 },
    severity: 'watch',
  },
  {
    id: 'B',
    station: { x: 130, y: 240, h: 11, fixed: false, sN: 0.02, sE: 0.03, sH: 0.04 },
    severity: null,
  },
  {
    id: 'C',
    station: { x: 145, y: 255, h: 12, fixed: false, sN: 0.03, sE: 0.04, sH: 0.05 },
    severity: 'weak',
  },
];

describe('MapView tool surface', () => {
  it('renders context menu actions and emits selected tool', async () => {
    const onOpenTool = vi.fn();
    const onEditPlanningPolygon = vi.fn();
    const onDeletePlanningPolygon = vi.fn();
    const onDeleteSelectedPlanningPolygons = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    await act(async () => {
      root.render(
        <MapViewContextMenu
          x={24}
          y={36}
          onOpenTool={onOpenTool}
          planningPolygonLabel="OSM building"
          selectedPlanningPolygonCount={3}
          onEditPlanningPolygon={onEditPlanningPolygon}
          onDeletePlanningPolygon={onDeletePlanningPolygon}
          onDeleteSelectedPlanningPolygons={onDeleteSelectedPlanningPolygons}
        />,
      );
    });

    const editButton = Array.from(container.querySelectorAll('button')).find(
      (entry) => entry.textContent?.trim() === 'Edit boundary',
    );
    const inverseButton = Array.from(container.querySelectorAll('button')).find(
      (entry) => entry.textContent?.trim() === 'Inverse',
    );
    const deleteSelectedButton = Array.from(container.querySelectorAll('button')).find(
      (entry) => entry.textContent?.trim() === 'Delete 3 selected obstacles',
    );
    expect(editButton).toBeTruthy();
    expect(inverseButton).toBeTruthy();
    expect(deleteSelectedButton).toBeTruthy();
    expect(container.querySelector('[data-testid="map-context-menu"]')?.className).toContain('z-[70]');
    await act(async () => {
      editButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      deleteSelectedButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      inverseButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onEditPlanningPolygon).toHaveBeenCalledTimes(1);
    expect(onDeleteSelectedPlanningPolygons).toHaveBeenCalledTimes(1);
    expect(onOpenTool).toHaveBeenCalledWith('inverse');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('renders inverse and angle tool content with computed outputs', async () => {
    const onClose = vi.fn();
    const onInverseFromInputChange = vi.fn();
    const onInverseToInputChange = vi.fn();
    const onTogglePickTarget = vi.fn();
    const onAnglePivotInputChange = vi.fn();
    const onAngleFromInputChange = vi.fn();
    const onAngleToInputChange = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    await act(async () => {
      root.render(
        <>
          <MapViewToolOverlay
            activeTool="inverse"
            visibleStationRows={visibleStationRows}
            isPreanalysis={false}
            units="m"
            unitScale={1}
            onClose={onClose}
            inverseFromInput="A"
            inverseToInput="B"
            inverseFromId="A"
            inverseToId="B"
            onInverseFromInputChange={onInverseFromInputChange}
            onInverseToInputChange={onInverseToInputChange}
            pickTarget={null}
            onTogglePickTarget={onTogglePickTarget}
            inverse={{
              azimuthFromToRad: Math.PI / 4,
              azimuthToFromRad: (Math.PI * 5) / 4,
              distance2d: 42.1234,
            }}
            anglePivotInput="A"
            angleFromInput="B"
            angleToInput="C"
            anglePivotId="A"
            angleFromId="B"
            angleToId="C"
            onAnglePivotInputChange={onAnglePivotInputChange}
            onAngleFromInputChange={onAngleFromInputChange}
            onAngleToInputChange={onAngleToInputChange}
            angleBetween={null}
          />
          <MapViewToolOverlay
            activeTool="angles"
            visibleStationRows={visibleStationRows}
            isPreanalysis={false}
            units="m"
            unitScale={1}
            onClose={onClose}
            inverseFromInput="A"
            inverseToInput="B"
            inverseFromId="A"
            inverseToId="B"
            onInverseFromInputChange={onInverseFromInputChange}
            onInverseToInputChange={onInverseToInputChange}
            pickTarget="angle-pivot"
            onTogglePickTarget={onTogglePickTarget}
            inverse={null}
            anglePivotInput="A"
            angleFromInput="B"
            angleToInput="C"
            anglePivotId="A"
            angleFromId="B"
            angleToId="C"
            onAnglePivotInputChange={onAnglePivotInputChange}
            onAngleFromInputChange={onAngleFromInputChange}
            onAngleToInputChange={onAngleToInputChange}
            angleBetween={{
              insideAngleRad: Math.PI / 2,
              outsideAngleRad: (Math.PI * 3) / 2,
            }}
          />
        </>,
      );
    });

    expect(container.textContent).toContain('Horizontal distance:');
    expect(container.textContent).toContain('42.1234 m');
    expect(container.textContent).toContain('Inside angle at A:');
    expect(container.textContent).toContain('Outside angle at A:');
    expect(container.querySelector('[data-testid="map-tool-overlay"]')?.className).toContain('z-[70]');
    expect(container.querySelector('[data-testid="inverse-from-input"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="angle-pivot-input"]')).not.toBeNull();

    const pickButtons = Array.from(container.querySelectorAll('button')).filter(
      (entry) => entry.textContent?.trim() === 'Pick',
    );
    await act(async () => {
      pickButtons[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onTogglePickTarget).toHaveBeenCalled();

    const closeButtons = Array.from(container.querySelectorAll('button')).filter(
      (entry) => entry.textContent?.trim() === 'Close',
    );
    await act(async () => {
      closeButtons[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
