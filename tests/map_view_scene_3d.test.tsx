/** @vitest-environment jsdom */

import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import MapViewScene3d from '../src/components/mapView/MapViewScene3d';
import type { Map3DScene } from '../src/engine/map3d';
import type { ProjectedStation3D } from '../src/components/mapView/mapView3d';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('MapViewScene3d', () => {
  it('renders selected geometry and routes station/observation clicks', async () => {
    const onSelectObservation = vi.fn();
    const onSelectStation = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    const scene3d: Map3DScene = {
      stations: [
        {
          id: 'A',
          position: { x: 0, y: 0, z: 0 },
          fixed: true,
          lost: false,
          ellipsoid: { semiMajor: 0.02, semiMinor: 0.01, semiVertical: 0.015, thetaDeg: 15 },
        },
        {
          id: 'B',
          position: { x: 10, y: 0, z: 0 },
          fixed: false,
          lost: false,
        },
      ],
      edges: [{ from: 'A', to: 'B' }],
      extents: {
        min: { x: 0, y: 0, z: 0 },
        max: { x: 10, y: 0, z: 0 },
        center: { x: 5, y: 0, z: 0 },
        span: { x: 10, y: 1, z: 1 },
        radius: 5,
      },
    };
    const projected3d: ProjectedStation3D[] = [
      {
        node: scene3d.stations[0],
        p: { x: 100, y: 120, depth: 8, visible: true },
      },
      {
        node: scene3d.stations[1],
        p: { x: 180, y: 160, depth: 7, visible: true },
      },
    ];
    const projected3dById = new Map(projected3d.map((row) => [row.node.id, row.p]));

    await act(async () => {
      root.render(
        <svg viewBox="0 0 1000 700">
          <MapViewScene3d
            viewWidth={1000}
            viewHeight={700}
            scene3d={scene3d}
            projected3d={projected3d}
            projected3dById={projected3dById}
            visiblePointLabels3d={new Set(['A'])}
            project3d={(point) => ({
              x: point.x * 10 + 100,
              y: point.y * 10 + 120,
              depth: 8,
              visible: true,
            })}
            sceneRadius={scene3d.extents.radius}
            maxEllipsoidSamples={12}
            ellipseStroke={() => '#f59e0b'}
            stationFill={(stationId, fixed) => (fixed ? '#34d399' : '#f97316')}
            mapLinkByPairKey={new Map([['A|B', { observationId: 7 }]])}
            selectedObservationId={7}
            selectedObservationPairKey="A|B"
            onSelectObservation={onSelectObservation}
            selectedStationId="A"
            onSelectStation={onSelectStation}
          />
        </svg>,
      );
    });

    expect(container.querySelector('[data-map-observation="7"]')).not.toBeNull();
    expect(container.querySelector('[data-map-station="A"]')).not.toBeNull();
    expect(container.querySelectorAll('polyline').length).toBeGreaterThan(0);
    expect(container.querySelector('[data-map-label="A"]')).not.toBeNull();

    await act(async () => {
      (container.querySelector('[data-map-observation="7"]') as SVGLineElement).dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
      (container.querySelector('[data-map-station="A"]') as SVGCircleElement).dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });

    expect(onSelectObservation).toHaveBeenCalledWith(7);
    expect(onSelectStation).toHaveBeenCalledWith('A');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
