import { describe, expect, it } from 'vitest';

import {
  buildBaseProjectedMapLines2d,
  buildBaseProjectedPoints2d,
  buildDerivedMapState2d,
  buildFilteredVisiblePoints2d,
  buildProjectedViewportBounds,
  buildProjectedMapLines2d,
  buildProjectedPoints2d,
  buildProjection2d,
  buildVisibleBaseProjectedMapLines2d,
  buildVisibleBaseProjectedPoints2d,
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
        fromId: 'A',
        toId: 'B',
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

    const baseProjectedMapLines2d = buildBaseProjectedMapLines2d({
      mapLinks,
      stations: {
        A: { x: 0, y: 0, h: 0, fixed: true, lost: false },
        B: { x: 10, y: 0, h: 0, fixed: false, lost: false },
        C: { x: 20, y: 0, h: 0, fixed: false, lost: false },
      },
      showLostStations: true,
      projectPoint: (x, y) => ({ x, y }),
    });
    const baseProjectedPoints2d = buildBaseProjectedPoints2d({
      points,
      projectPoint: (x, y) => ({ x, y }),
    });
    const projectedViewportBounds = buildProjectedViewportBounds(
      { minX: -5, maxX: 25, minY: -5, maxY: 5 },
      { zoom: 1, panX: 0, panY: 0 },
    );
    const derived = buildDerivedMapState2d({
      projectedMapLines2d: buildProjectedMapLines2d({
        baseProjectedMapLines2d: buildVisibleBaseProjectedMapLines2d({
          baseProjectedMapLines2d,
          selectedObservationId: null,
          selectedObservationPairKey: null,
          projectedViewportBounds,
        }),
        view2d: { zoom: 1, panX: 0, panY: 0 },
      }),
      projectedPoints2d: buildProjectedPoints2d({
        baseProjectedPoints2d: buildVisibleBaseProjectedPoints2d({
          baseProjectedPoints2d,
          selectedStationId: 'B',
          projectedViewportBounds,
        }),
        view2d: { zoom: 1, panX: 0, panY: 0 },
      }),
      selectedStationId: 'B',
      interactionPhaseInteracting: true,
      interactionDensePointThreshold: 2,
      interactionDenseLineThreshold: 1,
      showLabels: true,
      hideMinorGeometry: false,
      focusSelection: true,
      pointThreshold: 2,
      edgeThreshold: 1,
      labelGridPx: 48,
      totalProjectedMapLines2dLength: baseProjectedMapLines2d.length,
      selectedObservationId: null,
      selectedObservationPairKey: null,
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

  it('culls base projected geometry before applying the 2D view transform', () => {
    const projectedViewportBounds = buildProjectedViewportBounds(
      { minX: 0, maxX: 100, minY: 0, maxY: 100 },
      { zoom: 2, panX: 10, panY: 20 },
    );
    const visibleLines = buildVisibleBaseProjectedMapLines2d({
      baseProjectedMapLines2d: [
        {
          key: 'A:B',
          observationId: 1,
          pairKey: 'A|B',
          sourceLine: 1,
          fromId: 'A',
          toId: 'B',
          x1: 5,
          y1: 5,
          x2: 20,
          y2: 10,
          minX: 5,
          maxX: 20,
          minY: 5,
          maxY: 10,
        },
        {
          key: 'C:D',
          observationId: 2,
          pairKey: 'C|D',
          sourceLine: 2,
          fromId: 'C',
          toId: 'D',
          x1: 200,
          y1: 200,
          x2: 220,
          y2: 210,
          minX: 200,
          maxX: 220,
          minY: 200,
          maxY: 210,
        },
      ],
      selectedObservationId: null,
      selectedObservationPairKey: null,
      projectedViewportBounds,
    });
    const visiblePoints = buildVisibleBaseProjectedPoints2d({
      baseProjectedPoints2d: [
        { id: 'A', fixed: true, x: 8, y: 9 },
        { id: 'B', fixed: false, x: 150, y: 160 },
      ],
      selectedStationId: null,
      projectedViewportBounds,
    });

    expect(visibleLines.map((line) => line.key)).toEqual(['A:B']);
    expect(visiblePoints.map((point) => point.id)).toEqual(['A']);
  });

  it('reuses base projected geometry while applying different 2D views', () => {
    const baseLines = buildBaseProjectedMapLines2d({
      mapLinks: [
        {
          key: 'A:B',
          observationId: 1,
          type: 'dist' as const,
          pairKey: 'A|B',
          sourceLine: 10,
          fromId: 'A',
          toId: 'B',
        },
      ],
      stations: {
        A: { x: 0, y: 0, h: 0, fixed: true, lost: false },
        B: { x: 10, y: 0, h: 0, fixed: false, lost: false },
      },
      showLostStations: true,
      projectPoint: (x, y) => ({ x: x * 2, y: y * 2 }),
    });
    const basePoints = buildBaseProjectedPoints2d({
      points: [
        { id: 'A', fixed: true, x: 0, y: 0 },
        { id: 'B', fixed: false, x: 10, y: 0 },
      ],
      projectPoint: (x, y) => ({ x: x * 2, y: y * 2 }),
    });

    const firstViewLines = buildProjectedMapLines2d({
      baseProjectedMapLines2d: baseLines,
      view2d: { zoom: 1, panX: 0, panY: 0 },
    });
    const secondViewLines = buildProjectedMapLines2d({
      baseProjectedMapLines2d: baseLines,
      view2d: { zoom: 2, panX: 5, panY: -3 },
    });
    const secondViewPoints = buildProjectedPoints2d({
      baseProjectedPoints2d: basePoints,
      view2d: { zoom: 2, panX: 5, panY: -3 },
    });

    expect(baseLines[0]?.x2).toBe(20);
    expect(firstViewLines[0]?.screenX2).toBe(20);
    expect(secondViewLines[0]?.screenX2).toBe(45);
    expect(secondViewPoints[1]?.screenX).toBe(45);
  });
});
