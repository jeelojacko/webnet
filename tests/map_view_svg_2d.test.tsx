/** @vitest-environment jsdom */

import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';

import MapViewSvg2d from '../src/components/mapView/MapViewSvg2d';
import {
  getLatestMapViewPerfCapture,
  resetMapViewPerfCapture,
} from '../src/components/mapView/mapViewPerf';

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
            showLabels={true}
            interactionPhase="idle"
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
                fromId: 'A',
                toId: 'B',
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
            selectedPlanningPolygonIds={['osm-building-1']}
            bracePreviewPoints2d={[
              {
                scenarioId: 'brace-1',
                stationId: 'B-1',
                templateLabel: 'Brace B-1 [A-B]',
                x: 210,
                y: 220,
                active: true,
              },
            ]}
            selectionBoxRect={{ x: 10, y: 20, width: 30, height: 40, mode: 'crossing' }}
            onPlanningVertexMouseDown={onPlanningVertexMouseDown}
            project2d={(x, y) => ({ x: x * 10, y: y * 10 })}
          />
        </svg>,
      );
    });

    expect(container.querySelector('[data-map-observation="7"]')).not.toBeNull();
    expect(container.querySelector('[data-map-station-selection="A"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-map-label="TX1"]').length).toBeGreaterThan(0);
    expect(container.querySelector('[data-map-brace-preview="B-1"]')).not.toBeNull();
    expect(container.querySelector('[data-map-label="B-1"]')).not.toBeNull();
    expect(container.querySelector('[data-planning-polygon-id="osm-building-1"]')).not.toBeNull();
    expect(container.querySelector('[data-planning-vertex="osm-building-1:0"]')).not.toBeNull();
    expect(container.querySelector('[data-map-selection-box="true"]')).not.toBeNull();
    expect(container.querySelector('[data-map-selection-mode="crossing"]')).not.toBeNull();
    expect(
      (container.querySelector('[data-planning-polygon-id="osm-building-1"]') as SVGPolygonElement).compareDocumentPosition(
        container.querySelector('[data-map-label="B-1"]') as SVGTextElement,
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      (container.querySelector('[data-map-observation="7"]') as SVGLineElement).compareDocumentPosition(
        container.querySelector('[data-map-label="TX1"]') as SVGTextElement,
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      (container.querySelector('[data-map-observation-selection="7"]') as SVGLineElement).getAttribute(
        'stroke',
      ),
    ).toBe('#facc15');
    expect((container.querySelector('[data-map-observation="7"]') as SVGLineElement).getAttribute('stroke')).toBe(
      '#22d3ee',
    );
    expect(
      (container.querySelector('[data-map-station-selection="A"]') as SVGCircleElement).getAttribute('stroke'),
    ).toBe('#facc15');
    const transformedPoint = container.querySelector('[data-map-transformed-point="TX1"]') as SVGCircleElement | null;
    expect(transformedPoint).not.toBeNull();
    expect(transformedPoint?.getAttribute('fill')).toBe('#ff7a18');
    expect(transformedPoint?.getAttribute('stroke')).toBe('#2563eb');

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

  it('keeps heavy world-content sections memoized when only view2d changes', async () => {
    (globalThis as { __WEBNET_ENABLE_MAP_PERF_CAPTURE__?: boolean }).__WEBNET_ENABLE_MAP_PERF_CAPTURE__ =
      true;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    resetMapViewPerfCapture('svg-view-transform-only');

    const baseProps = {
      marker2d: 6,
      showLabels: true,
      interactionPhase: 'idle' as const,
      originalGeometryOpacity: 1,
      filteredVisiblePoints2d: [
        { id: 'A', fixed: true, x: 100, y: 100, screenX: 100, screenY: 100 },
      ],
      visiblePointLabels2d: new Set(['A']),
      labelOffset2d: 10,
      labelFont2d: 12,
      labelStroke2d: 1,
      filteredVisibleMapLines2d: [
        {
          key: 'A:B',
          observationId: 7,
          pairKey: 'A|B',
          sourceLine: 1,
          fromId: 'A',
          toId: 'B',
          x1: 100,
          y1: 100,
          x2: 150,
          y2: 150,
          screenX1: 100,
          screenY1: 100,
          screenX2: 150,
          screenY2: 150,
        },
      ],
      selectedObservationId: 7,
      selectedObservationPairKey: 'A|B',
      lineWidth2d: 1,
      selectedStationId: 'A',
      pointRadius2d: 4,
      transformedOverlayActive: false,
      transformedLines2d: [] as Array<{ key: string; x1: number; y1: number; x2: number; y2: number }>,
      transformedPoints2d: [] as Array<{ id: string; x: number; y: number; fixed: boolean }>,
      project2d: (x: number, y: number) => ({ x, y }),
    };

    await act(async () => {
      root.render(
        <svg viewBox="0 0 1000 700">
          <MapViewSvg2d {...baseProps} view2d={{ zoom: 1, panX: 0, panY: 0 }} />
        </svg>,
      );
    });

    await act(async () => {
      root.render(
        <svg viewBox="0 0 1000 700">
          <MapViewSvg2d {...baseProps} view2d={{ zoom: 1.5, panX: 20, panY: 10 }} />
        </svg>,
      );
    });

    const snapshot = getLatestMapViewPerfCapture();
    expect(snapshot?.counters['svg:renders']).toBe(2);
    expect(snapshot?.counters['svg:labels:renders']).toBe(1);
    expect(snapshot?.counters['svg:selection-layer:renders']).toBe(1);
    expect(snapshot?.counters['svg:planning-layer:renders'] ?? 0).toBeLessThanOrEqual(1);

    await act(async () => {
      root.unmount();
    });
    container.remove();
    (globalThis as { __WEBNET_ENABLE_MAP_PERF_CAPTURE__?: boolean }).__WEBNET_ENABLE_MAP_PERF_CAPTURE__ =
      false;
  });

  it('hides synthetic scenario labels when showLabels is off', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    await act(async () => {
      root.render(
        <svg viewBox="0 0 1000 700">
          <MapViewSvg2d
            marker2d={6}
            view2d={{ zoom: 1, panX: 0, panY: 0 }}
            showLabels={false}
            interactionPhase="idle"
            originalGeometryOpacity={1}
            filteredVisiblePoints2d={[]}
            visiblePointLabels2d={new Set()}
            labelOffset2d={10}
            labelFont2d={12}
            labelStroke2d={1}
            filteredVisibleMapLines2d={[]}
            selectedObservationId={null}
            selectedObservationPairKey={null}
            lineWidth2d={1}
            selectedStationId={null}
            pointRadius2d={4}
            transformedOverlayActive={false}
            transformedLines2d={[]}
            transformedPoints2d={[]}
            bracePreviewPoints2d={[
              {
                scenarioId: 'brace-1',
                stationId: 'B-1',
                templateLabel: 'Brace B-1 [A-B]',
                x: 210,
                y: 220,
                active: true,
              },
            ]}
            project2d={(x, y) => ({ x, y })}
          />
        </svg>,
      );
    });

    expect(container.querySelector('[data-map-brace-preview="B-1"]')).not.toBeNull();
    expect(container.querySelector('[data-map-label="B-1"]')).toBeNull();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('keeps station labels fully opaque even when base geometry is dimmed', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    await act(async () => {
      root.render(
        <svg viewBox="0 0 1000 700">
          <MapViewSvg2d
            marker2d={6}
            view2d={{ zoom: 1, panX: 0, panY: 0 }}
            showLabels={true}
            interactionPhase="idle"
            originalGeometryOpacity={0.25}
            filteredVisiblePoints2d={[
              { id: 'A', fixed: true, x: 100, y: 100, screenX: 100, screenY: 100 },
            ]}
            visiblePointLabels2d={new Set(['A'])}
            labelOffset2d={10}
            labelFont2d={12}
            labelStroke2d={1}
            filteredVisibleMapLines2d={[]}
            selectedObservationId={null}
            selectedObservationPairKey={null}
            lineWidth2d={1}
            selectedStationId={null}
            pointRadius2d={4}
            transformedOverlayActive={false}
            transformedLines2d={[]}
            transformedPoints2d={[]}
            project2d={(x, y) => ({ x, y })}
          />
        </svg>,
      );
    });

    const label = container.querySelector('[data-map-label="A"]') as SVGTextElement | null;
    expect(label).not.toBeNull();
    expect(label?.parentElement?.getAttribute('opacity')).toBeNull();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
