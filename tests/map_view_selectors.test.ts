import { describe, expect, it } from 'vitest';

import type { Map3DCamera, Map3DScene } from '../src/engine/map3d';
import type { Observation, StationMap } from '../src/types';
import {
  buildMapScenePointBounds2d,
  buildMapToolMetrics,
  buildMapViewStyle2d,
  buildProjectedMapState3d,
  buildTransformedOverlayGeometry2d,
} from '../src/components/mapView/mapViewSelectors';

describe('mapViewSelectors', () => {
  it('builds padded 2D bounds and point rows from the 3D scene', () => {
    const scene3d: Pick<Map3DScene, 'stations'> = {
      stations: [
        {
          id: 'A',
          position: { x: 10, y: 20, z: 5 },
          fixed: true,
          lost: false,
        },
        {
          id: 'B',
          position: { x: 30, y: 50, z: 8 },
          fixed: false,
          lost: false,
          ellipsoid: { semiMajor: 0.02, semiMinor: 0.01, semiVertical: 0.015, thetaDeg: 10 },
        },
      ],
    };

    const derived = buildMapScenePointBounds2d(scene3d);

    expect(derived.points.map((point) => point.id)).toEqual(['A', 'B']);
    expect(derived.points[1].ellipsoid?.semiMajor).toBe(0.02);
    expect(derived.bbox.minX).toBe(7);
    expect(derived.bbox.minY).toBe(17);
    expect(derived.bbox.width).toBe(26);
    expect(derived.bbox.height).toBe(36);
  });

  it('derives 2D map styling from zoom and overlay state', () => {
    const derived = buildMapViewStyle2d({ zoom: 4 }, true);

    expect(derived.originalGeometryOpacity).toBe(0.25);
    expect(derived.lineWidth2d).toBeCloseTo(0.15, 6);
    expect(derived.pointRadius2d).toBeCloseTo(0.875, 6);
    expect(derived.labelFont2d).toBeGreaterThan(3);
    expect(derived.marker2d).toBeLessThan(2);
  });

  it('builds transformed overlay lines and points from available transformed stations', () => {
    const observations: Observation[] = [
      {
        id: 1,
        type: 'dist',
        subtype: 'ts',
        from: 'A',
        to: 'B',
        instCode: 'D',
        obs: 10,
        stdDev: 0.01,
      },
      {
        id: 2,
        type: 'angle',
        from: 'A',
        at: 'B',
        to: 'C',
        instCode: 'A',
        obs: 1,
        stdDev: 0.01,
      },
      {
        id: 3,
        type: 'gps',
        from: 'B',
        to: 'C',
        instCode: 'G',
        obs: { dE: 1, dN: 2, dU: 0 },
        stdDev: 0.02,
      },
    ];
    const stations: StationMap = {
      A: { x: 0, y: 0, h: 0, fixed: true, lost: false },
      B: { x: 10, y: 0, h: 0, fixed: false, lost: false },
      C: { x: 20, y: 0, h: 0, fixed: false, lost: true },
    };

    const derived = buildTransformedOverlayGeometry2d({
      transformedOverlayActive: true,
      observations,
      stations,
      showLostStations: false,
      transformedByStationId: new Map([
        ['A', { east: 100, north: 200 }],
        ['B', { east: 110, north: 205 }],
      ]),
      points: [
        { id: 'A', x: 0, y: 0, fixed: true },
        { id: 'B', x: 10, y: 0, fixed: false },
        { id: 'C', x: 20, y: 0, fixed: false },
      ],
    });

    expect(derived.transformedLines2d).toEqual([
      { key: 'tx-line-0', x1: 100, y1: 200, x2: 110, y2: 205 },
    ]);
    expect(derived.transformedPoints2d).toEqual([
      { id: 'A', x: 100, y: 200, fixed: true },
      { id: 'B', x: 110, y: 205, fixed: false },
    ]);
  });

  it('builds projected 3D state and tool metrics from focused inputs', () => {
    const scene3d: Map3DScene = {
      stations: [
        {
          id: 'A',
          position: { x: 0, y: 0, z: 0 },
          fixed: true,
          lost: false,
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
    const camera3d: Map3DCamera = {
      yawDeg: -35,
      pitchDeg: 25,
      distance: 40,
      target: { x: 5, y: 0, z: 0 },
      panX: 0,
      panY: 0,
      zoom: 1,
    };
    const stations: StationMap = {
      A: { x: 0, y: 0, h: 0, fixed: true, lost: false },
      B: { x: 10, y: 0, h: 0, fixed: false, lost: false },
      C: { x: 10, y: 10, h: 0, fixed: false, lost: false },
    };

    const projected = buildProjectedMapState3d({
      effectiveMode: '3d',
      camera3d,
      scene3d,
      selectedStationId: 'A',
      denseLabelPointThreshold: 1,
      labelGridPx: 48,
      viewWidth: 1000,
      viewHeight: 700,
    });
    const tools = buildMapToolMetrics({
      stations,
      inverseFromId: 'A',
      inverseToId: 'B',
      anglePivotId: 'A',
      angleFromId: 'B',
      angleToId: 'C',
    });

    expect(projected.projected3d).toHaveLength(2);
    expect(projected.projected3dById.has('A')).toBe(true);
    expect(projected.visiblePointLabels3d.has('A')).toBe(true);
    expect(tools.inverse?.distance2d).toBeCloseTo(10, 6);
    expect(tools.angleBetween?.insideAngleRad).toBeCloseTo(Math.PI / 4, 6);
  });
});
