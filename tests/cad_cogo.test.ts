import { describe, expect, it } from 'vitest';
import {
  buildCadInverseSummary,
  cadBuildParallelLine,
  cadBuildPerpendicularFoot,
  cadIntersectLineLikeEntities,
  cadIntersectArcEntities,
  cadIntersectLineArcEntity,
  cadOffsetLineSegment,
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

  it('finds line-arc intersections on visible arc sweep', () => {
    const intersections = cadIntersectLineArcEntity(
      {
        id: 'line:east-west',
        type: 'line',
        layerId: 'observation-lines',
        visible: true,
        locked: false,
        fromStationId: 'W',
        toStationId: 'E',
        fromX: -10,
        fromY: 0,
        toX: 10,
        toY: 0,
        sourceObservationIds: [],
      },
      {
        id: 'arc:north',
        type: 'arc',
        layerId: 'planning',
        visible: true,
        locked: false,
        centerX: 0,
        centerY: 0,
        radius: 5,
        startAngleDeg: 0,
        endAngleDeg: 180,
      },
    );

    expect(intersections).toHaveLength(2);
    expect(intersections[0]?.point.x ?? Number.NaN).toBeCloseTo(-5, 6);
    expect(intersections[0]?.point.y ?? Number.NaN).toBeCloseTo(0, 6);
    expect(intersections[1]?.point.x ?? Number.NaN).toBeCloseTo(5, 6);
    expect(intersections[1]?.point.y ?? Number.NaN).toBeCloseTo(0, 6);
  });

  it('finds arc-arc intersections deterministically', () => {
    const intersections = cadIntersectArcEntities(
      {
        id: 'arc:left',
        type: 'arc',
        layerId: 'planning',
        visible: true,
        locked: false,
        centerX: 0,
        centerY: 0,
        radius: 5,
        startAngleDeg: 0,
        endAngleDeg: 180,
      },
      {
        id: 'arc:right',
        type: 'arc',
        layerId: 'planning',
        visible: true,
        locked: false,
        centerX: 4,
        centerY: 0,
        radius: 5,
        startAngleDeg: 0,
        endAngleDeg: 180,
      },
    );

    expect(intersections).toHaveLength(1);
    expect(intersections[0]?.point.x ?? Number.NaN).toBeCloseTo(2, 6);
    expect(intersections[0]?.point.y ?? Number.NaN).toBeCloseTo(Math.sqrt(21), 6);
  });

  it('builds first offset, parallel, and perpendicular helpers from base geometry', () => {
    const offset = cadOffsetLineSegment({ x: 0, y: 0 }, { x: 10, y: 0 }, 3);
    expect(offset.start.x).toBeCloseTo(0, 6);
    expect(offset.start.y).toBeCloseTo(3, 6);
    expect(offset.end.x).toBeCloseTo(10, 6);
    expect(offset.end.y).toBeCloseTo(3, 6);

    const parallel = cadBuildParallelLine({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 2, y: 4 });
    expect(parallel.start.x).toBeCloseTo(2, 6);
    expect(parallel.start.y).toBeCloseTo(4, 6);
    expect(parallel.end.x).toBeCloseTo(12, 6);
    expect(parallel.end.y).toBeCloseTo(4, 6);

    const foot = cadBuildPerpendicularFoot({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 3, y: 7 });
    expect(foot.x).toBeCloseTo(3, 6);
    expect(foot.y).toBeCloseTo(0, 6);
  });
});
