import { describe, expect, it } from 'vitest';
import {
  buildCadInverseSummary,
  cadIntersectLineLikeEntities,
  cadPointFromBearingDistance,
  formatCadBearing,
} from '../src/engine/cad/cadCogo';

describe('Survey CAD COGO helpers', () => {
  it('builds inverse summaries with azimuth and survey bearing formatting', () => {
    const inverse = buildCadInverseSummary({ x: 0, y: 0 }, { x: 100, y: 100 });

    expect(inverse.distance).toBeCloseTo(141.421356, 6);
    expect(inverse.azimuthDeg).toBeCloseTo(45, 6);
    expect(inverse.bearing).toBe('N45-00-00.00E');
    expect(formatCadBearing(225)).toBe('S45-00-00.00W');
  });

  it('creates points from survey bearing-distance input', () => {
    const point = cadPointFromBearingDistance({ x: 0, y: 0 }, 'S45-00-00E', 100);

    expect(point).not.toBeNull();
    expect(point?.x ?? Number.NaN).toBeCloseTo(70.710678, 6);
    expect(point?.y ?? Number.NaN).toBeCloseTo(-70.710678, 6);
  });

  it('finds deterministic line-like intersections', () => {
    const intersection = cadIntersectLineLikeEntities(
      {
        id: 'line:a',
        type: 'line',
        layerId: 'observation-lines',
        visible: true,
        locked: false,
        fromStationId: 'A',
        toStationId: 'B',
        fromX: 0,
        fromY: 0,
        toX: 100,
        toY: 100,
        sourceObservationIds: [],
      },
      {
        id: 'pline:c',
        type: 'polyline',
        layerId: 'observation-lines',
        visible: true,
        locked: false,
        vertices: [
          { x: 0, y: 100 },
          { x: 100, y: 0 },
        ],
        vertexLabels: ['C', 'D'],
        closed: false,
      },
    );

    expect(intersection).not.toBeNull();
    expect(intersection?.point.x ?? Number.NaN).toBeCloseTo(50, 6);
    expect(intersection?.point.y ?? Number.NaN).toBeCloseTo(50, 6);
    expect(intersection?.label).toContain('A-B');
  });
});
