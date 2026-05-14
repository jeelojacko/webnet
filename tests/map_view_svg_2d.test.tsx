/** @vitest-environment jsdom */

import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';

import MapViewSvg2d from '../src/components/mapView/MapViewSvg2d';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('MapViewSvg2d', () => {
  it('renders selected overlays and transformed labels', async () => {
    const onSelectObservation = vi.fn();
    const onPlanningVertexMouseDown = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    await act(async () => {
      root.render(
        <svg viewBox="0 0 1000 700">
          <MapViewSvg2d
            marker2d={6}
            view2d={{ zoom: 1, panX: 0, panY: 0 }}
            originalGeometryOpacity={1}
            filteredVisiblePoints2d={[
              { id: 'A', fixed: true, x: 100, y: 100, screenX: 100, screenY: 100 },
            ]}
            visiblePointLabels2d={new Set(['A', 'TX1'])}
            labelOffset2d={10}
            labelFont2d={12}
            labelStroke2d={1}
            filteredVisibleMapLines2d={[
              {
                key: 'A:B',
                observationId: 7,
                pairKey: 'A|B',
                sourceLine: 1,
                x1: 100,
                y1: 100,
                x2: 150,
                y2: 150,
                screenX1: 100,
                screenY1: 100,
                screenX2: 150,
                screenY2: 150,
              },
            ]}
            selectedObservationId={7}
            selectedObservationPairKey="A|B"
            lineWidth2d={1}
            onSelectObservation={onSelectObservation}
            selectedStationId="A"
            pointRadius2d={4}
            transformedOverlayActive={true}
            transformedLines2d={[{ key: 'tx-1', x1: 1, y1: 2, x2: 3, y2: 4 }]}
            transformedPoints2d={[{ id: 'TX1', x: 10, y: 20, fixed: false }]}
            planningPolygons2d={[
              {
                id: 'osm-building-1',
                source: 'osm',
                kind: 'building',
                label: 'OSM building',
                vertices: [
                  { x: 30, y: 30 },
                  { x: 60, y: 30 },
                  { x: 60, y: 60 },
                ],
                pointsAttr: '30,30 60,30 60,60',
              },
            ]}
            selectedPlanningPolygonId="osm-building-1"
            bracePreviewPoints2d={[
              {
                scenarioId: 'brace-1',
                stationId: 'BRACE_A_B',
                templateLabel: 'Brace BRACE_A_B [A-B]',
                x: 210,
                y: 220,
                active: true,
              },
            ]}
            onPlanningVertexMouseDown={onPlanningVertexMouseDown}
            project2d={(x, y) => ({ x: x * 10, y: y * 10 })}
          />
        </svg>,
      );
    });

    expect(container.querySelector('[data-map-observation="7"]')).not.toBeNull();
    expect(container.querySelector('[data-map-station-selection="A"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-map-label="TX1"]').length).toBeGreaterThan(0);
    expect(container.querySelector('[data-map-brace-preview="BRACE_A_B"]')).not.toBeNull();
    expect(container.querySelector('[data-planning-polygon-id="osm-building-1"]')).not.toBeNull();
    expect(container.querySelector('[data-planning-vertex="osm-building-1:0"]')).not.toBeNull();

    await act(async () => {
      (container.querySelector('[data-map-observation="7"]') as SVGLineElement).dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });

    expect(onSelectObservation).toHaveBeenCalledWith(7);

    await act(async () => {
      (container.querySelector('[data-planning-vertex="osm-building-1:0"]') as SVGCircleElement).dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true }),
      );
    });

    expect(onPlanningVertexMouseDown).toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
