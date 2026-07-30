import { describe, expect, it } from 'vitest';
import {
  appendCadProjectEntities,
  buildSurveyCadSpikeProject,
  buildCadSpatialIndex,
  buildCadDisplayScene,
  input,
  parseOptions,
} from './cadSpatialIndexTestSupport';

describe('Survey CAD spatial index', () => {
  it('resolves point-node, endpoint, midpoint, and nearest snaps from native entities', () => {
    const project = buildSurveyCadSpikeProject({
      input,
      instrumentLibrary: {},
      parseOptions,
      units: 'm',
      result: null,
    });
    const index = buildCadSpatialIndex(project);

    const pointNode = index.queryNearestSnap({ x: 0.4, y: 0.3 }, 2, ['point-node']);
    expect(pointNode?.kind).toBe('point-node');
    expect(pointNode?.label).toBe('A');

    const endpoint = index.queryNearestSnap({ x: 99.5, y: 0.2 }, 2, ['endpoint']);
    expect(endpoint?.kind).toBe('endpoint');
    expect(endpoint?.label).toBe('B');

    const midpoint = index.queryNearestSnap({ x: 30.1, y: 20.2 }, 3, ['midpoint']);
    expect(midpoint?.kind).toBe('midpoint');
    expect(midpoint?.label).toBe('A-C');
    expect(midpoint?.x).toBeCloseTo(30, 6);
    expect(midpoint?.y).toBeCloseTo(20, 6);

    const intersection = index.queryNearestSnap({ x: 60.2, y: 39.7 }, 2, ['intersection']);
    expect(intersection?.kind).toBe('intersection');
    expect(intersection?.label).toContain('A-C');

    const nearest = index.queryNearestSnap({ x: 31, y: 18 }, 6, ['nearest']);
    expect(nearest?.kind).toBe('nearest');
    expect(nearest?.label).toBe('A-C');
    expect(nearest?.distance ?? Infinity).toBeLessThan(6);
  });

  it('uses style library settings in display primitives', () => {
    const project = buildSurveyCadSpikeProject({
      input,
      instrumentLibrary: {},
      parseOptions,
      units: 'm',
      result: null,
    });

    expect(project.styleLibrary.styles.some((style) => style.id === 'style-control-point')).toBe(true);
    const displayScene = buildCadDisplayScene(project);
    const pointPrimitive = displayScene.primitives.find((primitive) => primitive.sourceEntityId === 'pt:A');
    const textPrimitive = displayScene.primitives.find((primitive) => primitive.sourceEntityId === 'label:A');

    expect(pointPrimitive?.kind).toBe('point');
    if (pointPrimitive?.kind === 'point') {
      expect(pointPrimitive.radius).toBeGreaterThan(2);
    }
    expect(textPrimitive?.kind).toBe('text');
    if (textPrimitive?.kind === 'text') {
      expect(textPrimitive.fontSize).toBe(11);
    }
  });

  it('indexes polyline segments for display and snap queries', () => {
    const project = appendCadProjectEntities(
      buildSurveyCadSpikeProject({
        input,
        instrumentLibrary: {},
        parseOptions,
        units: 'm',
        result: null,
      }),
      [
        {
          id: 'pline:test',
          type: 'polyline',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          vertices: [
            { x: 0, y: 0 },
            { x: 20, y: 10 },
            { x: 40, y: 0 },
          ],
          vertexLabels: ['A', 'P1', 'P2'],
          closed: false,
        },
      ],
    );
    const index = buildCadSpatialIndex(project);
    const displayScene = buildCadDisplayScene(project);

    expect(
      displayScene.primitives.filter((primitive) => primitive.sourceEntityId === 'pline:test' && primitive.kind === 'line'),
    ).toHaveLength(2);

    const midpoint = index.queryNearestSnap({ x: 10, y: 5 }, 2, ['midpoint']);
    expect(midpoint?.kind).toBe('midpoint');
    expect(midpoint?.sourceEntityId).toBe('pline:test');
    expect(midpoint?.label).toBe('A-P1');

    const endpoint = index.queryNearestSnap({ x: 39.8, y: 0.2 }, 2, ['endpoint']);
    expect(endpoint?.kind).toBe('endpoint');
    expect(endpoint?.label).toBe('P2');
  });

  it('indexes arc centers, arc endpoints, arc midpoint, quadrants, nearest, and curve intersections', () => {
    const project = appendCadProjectEntities(
      buildSurveyCadSpikeProject({
        input,
        instrumentLibrary: {},
        parseOptions,
        units: 'm',
        result: null,
      }),
      [
        {
          id: 'line:axis-y',
          type: 'line',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'L1',
          toStationId: 'L2',
          fromX: 0,
          fromY: -15,
          toX: 0,
          toY: 15,
          sourceObservationIds: [],
        },
        {
          id: 'arc:upper',
          type: 'arc',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          centerX: 0,
          centerY: 0,
          radius: 10,
          startAngleDeg: 0,
          endAngleDeg: 180,
          metadata: {
            entityName: 'CURVE1',
          },
        },
        {
          id: 'arc:right-upper',
          type: 'arc',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          centerX: 8,
          centerY: 0,
          radius: 10,
          startAngleDeg: 90,
          endAngleDeg: 180,
          metadata: {
            entityName: 'CURVE2',
          },
        },
      ],
    );
    const index = buildCadSpatialIndex(project);

    const center = index.queryNearestSnap({ x: 0.3, y: 0.2 }, 1, ['center']);
    expect(center?.kind).toBe('center');
    expect(center?.sourceEntityId).toBe('arc:upper');
    expect(center?.x).toBeCloseTo(0, 6);
    expect(center?.y).toBeCloseTo(0, 6);

    const endpoint = index.queryNearestSnap({ x: 9.8, y: 0.1 }, 1, ['endpoint']);
    expect(endpoint?.kind).toBe('endpoint');
    expect(endpoint?.sourceEntityId).toBe('arc:upper');
    expect(endpoint?.x).toBeCloseTo(10, 6);
    expect(endpoint?.y).toBeCloseTo(0, 6);

    const arcMidpoint = index.queryNearestSnap({ x: 0.2, y: 9.8 }, 1, ['arc-midpoint']);
    expect(arcMidpoint?.kind).toBe('arc-midpoint');
    expect(arcMidpoint?.sourceEntityId).toBe('arc:upper');
    expect(arcMidpoint?.x).toBeCloseTo(0, 6);
    expect(arcMidpoint?.y).toBeCloseTo(10, 6);

    const quadrant = index.queryNearestSnap({ x: -10.1, y: 0.1 }, 1, ['quadrant']);
    expect(quadrant?.kind).toBe('quadrant');
    expect(quadrant?.sourceEntityId).toBe('arc:upper');
    expect(quadrant?.x).toBeCloseTo(-10, 6);
    expect(quadrant?.y).toBeCloseTo(0, 6);

    const nearest = index.queryNearestSnap({ x: 7, y: 8.2 }, 2, ['nearest']);
    expect(nearest?.kind).toBe('nearest');
    expect(nearest?.sourceEntityId).toBe('arc:upper');
    expect(nearest?.label).toBe('CURVE1');
    expect(nearest?.x).toBeCloseTo(6.4926, 3);
    expect(nearest?.y).toBeCloseTo(7.6056, 3);

    const lineArcIntersection = index.queryNearestSnap({ x: 0.1, y: 9.8 }, 1, ['intersection']);
    expect(lineArcIntersection?.kind).toBe('intersection');
    expect(lineArcIntersection?.label).toContain('L1-L2');
    expect(lineArcIntersection?.label).toContain('CURVE1');
    expect(lineArcIntersection?.x).toBeCloseTo(0, 6);
    expect(lineArcIntersection?.y).toBeCloseTo(10, 6);

    const arcArcIntersection = index.queryNearestSnap({ x: 4, y: 9.1 }, 1, ['intersection']);
    expect(arcArcIntersection?.kind).toBe('intersection');
    expect(arcArcIntersection?.label).toContain('CURVE1');
    expect(arcArcIntersection?.label).toContain('CURVE2');
    expect(arcArcIntersection?.x).toBeCloseTo(4, 6);
    expect(arcArcIntersection?.y).toBeCloseTo(Math.sqrt(84), 6);
  });

  it('prefers endpoint then midpoint, while still letting nearest win outside tighter exact-snap ranges', () => {
    const project = appendCadProjectEntities(
      buildSurveyCadSpikeProject({
        input,
        instrumentLibrary: {},
        parseOptions,
        units: 'm',
        result: null,
      }),
      [
        {
          id: 'arc:priority-test',
          type: 'arc',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          centerX: 50,
          centerY: 20,
          radius: 12,
          startAngleDeg: 0,
          endAngleDeg: 180,
        },
      ],
    );
    const index = buildCadSpatialIndex(project);

    const endpoint = index.queryNearestSnap({ x: 61.2, y: 20.2 }, 2, ['endpoint', 'nearest']);
    expect(endpoint?.kind).toBe('endpoint');
    expect(endpoint?.sourceEntityId).toBe('arc:priority-test');

    const arcMidpoint = index.queryNearestSnap(
      { x: 50.2, y: 31.6 },
      2,
      ['arc-midpoint', 'nearest', 'center'],
    );
    expect(arcMidpoint?.kind).toBe('arc-midpoint');
    expect(arcMidpoint?.sourceEntityId).toBe('arc:priority-test');

    const nearest = index.queryNearestSnap(
      { x: 57.2, y: 29.6 },
      2,
      ['endpoint', 'arc-midpoint', 'center', 'nearest'],
    );
    expect(nearest?.kind).toBe('nearest');
    expect(nearest?.sourceEntityId).toBe('arc:priority-test');
    expect(nearest?.x).toBeCloseTo(7.2 + 50, 1);
    expect(nearest?.y).toBeCloseTo(9.6 + 20, 1);
  });

  it('lets arc-body nearest beat arc endpoints when the cursor is clearly closer to the curve body', () => {
    const project = appendCadProjectEntities(
      buildSurveyCadSpikeProject({
        input,
        instrumentLibrary: {},
        parseOptions,
        units: 'm',
        result: null,
      }),
      [
        {
          id: 'arc:small-priority-test',
          type: 'arc',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          centerX: 0,
          centerY: 0,
          radius: 1,
          startAngleDeg: 0,
          endAngleDeg: 180,
        },
      ],
    );
    const index = buildCadSpatialIndex(project);

    const snap = index.queryNearestSnap(
      { x: 0, y: 1 },
      2,
      ['endpoint', 'arc-midpoint', 'nearest'],
    );
    expect(snap?.kind).toBe('nearest');
    expect(snap?.sourceEntityId).toBe('arc:small-priority-test');
    expect(snap?.x).toBeCloseTo(0, 6);
    expect(snap?.y).toBeCloseTo(1, 6);
  });

});
