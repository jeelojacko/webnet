import { describe, expect, it } from 'vitest';

import {
  buildDerivedMapState2d,
  buildFilteredVisiblePoints2d,
  buildProjection2d,
  buildVisiblePointLabels2d,
  projectPoint2d,
  type ProjectablePoint2D,
  type ProjectedMapLine2D,
  type ProjectedPoint2D,
} from '../src/components/mapView/mapView2d';

describe('mapView2d helpers', () => {
  it('projects 2D points into the shared map viewport', () => {
    const projection = buildProjection2d({ minX: 0, minY: 0, width: 100, height: 50 }, 1000, 700);
    const point = projectPoint2d(50, 25, { minX: 0, minY: 0 }, projection, 700);

    expect(projection.scale).toBe(10);
    expect(point.x).toBeCloseTo(500, 6);
    expect(point.y).toBeCloseTo(350, 6);
  });

  it('keeps the selected station label in dense mode', () => {
    const points: ProjectedPoint2D[] = [
      { id: 'A', fixed: true, x: 10, y: 10, screenX: 10, screenY: 10 },
      { id: 'B', fixed: false, x: 12, y: 12, screenX: 12, screenY: 12 },
      { id: 'C', fixed: false, x: 14, y: 14, screenX: 14, screenY: 14 },
    ];

    const labels = buildVisiblePointLabels2d({
      showLabels: true,
      visiblePoints2d: points,
      visibleMapLines2dLength: 250,
      interactionDenseMode: false,
      selectedStationId: 'B',
      pointThreshold: 2,
      edgeThreshold: 10,
      labelGridPx: 48,
      scorePriority: (point) => (point.id === 'B' ? 100 : 1),
    });

    expect(labels.has('B')).toBe(true);
    expect(labels.size).toBeGreaterThanOrEqual(1);
  });

  it('filters focus-selection points down to the selected station graph', () => {
    const points: ProjectedPoint2D[] = [
      { id: 'A', fixed: true, x: 0, y: 0, screenX: 0, screenY: 0 },
      { id: 'B', fixed: false, x: 10, y: 0, screenX: 10, screenY: 0 },
      { id: 'C', fixed: false, x: 20, y: 0, screenX: 20, screenY: 0 },
    ];
    const lines: ProjectedMapLine2D[] = [
      {
        key: 'A:B',
        observationId: 1,
        pairKey: 'A|B',
        sourceLine: 1,
        x1: 0,
        y1: 0,
        x2: 10,
        y2: 0,
        screenX1: 0,
        screenY1: 0,
        screenX2: 10,
        screenY2: 0,
      },
    ];

    const filtered = buildFilteredVisiblePoints2d({
      visiblePoints2d: points,
      filteredVisibleMapLines2d: lines,
      focusSelection: true,
      selectedStationId: 'A',
    });

    expect(filtered.map((point) => point.id)).toEqual(['A', 'B']);
  });

  it('builds the combined 2D derived state with dense interaction filtering', () => {
    const points: ProjectablePoint2D[] = [
      { id: 'A', fixed: true, x: 0, y: 0 },
      { id: 'B', fixed: false, x: 10, y: 0 },
      { id: 'C', fixed: false, x: 20, y: 0 },
    ];
    const mapLinks = [
      {
        key: 'A:B',
        observationId: 1,
        type: 'dist' as const,
        pairKey: 'A|B',
        sourceLine: 10,
        fromId: 'A',
        toId: 'B',
      },
      {
        key: 'B:C',
        observationId: 2,
        type: 'dist' as const,
        pairKey: 'B|C',
        sourceLine: 11,
        fromId: 'B',
        toId: 'C',
      },
    ];

    const derived = buildDerivedMapState2d({
      mapLinks,
      stations: {
        A: { x: 0, y: 0, h: 0, fixed: true, lost: false },
        B: { x: 10, y: 0, h: 0, fixed: false, lost: false },
        C: { x: 20, y: 0, h: 0, fixed: false, lost: false },
      },
      showLostStations: true,
      points,
      projectPoint: (x, y) => ({ x, y }),
      view2d: { zoom: 1, panX: 0, panY: 0 },
      selectedObservationId: null,
      selectedObservationPairKey: null,
      selectedStationId: 'B',
      viewportBounds: { minX: -5, maxX: 25, minY: -5, maxY: 5 },
      interactionPhaseInteracting: true,
      interactionDensePointThreshold: 2,
      interactionDenseLineThreshold: 1,
      showLabels: true,
      hideMinorGeometry: false,
      focusSelection: true,
      pointThreshold: 2,
      edgeThreshold: 1,
      labelGridPx: 48,
      scorePriority: (point) => (point.id === 'B' ? 100 : 1),
    });

    expect(derived.interactionDenseMode).toBe(true);
    expect(derived.visiblePointLabels2d.has('B')).toBe(true);
    expect(derived.visiblePointLabels2d.size).toBe(1);
    expect(derived.filteredVisibleMapLines2d).toHaveLength(2);
    expect(derived.filteredVisiblePoints2d.map((point) => point.id)).toEqual(['A', 'B', 'C']);
    expect(derived.unselectedCanvasLines2d).toHaveLength(2);
    expect(derived.mapDensitySummary.dense).toBe(true);
  });
});
