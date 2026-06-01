import { describe, expect, it } from 'vitest';
import { appendCadProjectEntities } from '../src/engine/cad/cadProjectState';
import { buildSurveyCadSpikeProject } from '../src/engine/cad/cadModel';
import { buildCadSpatialIndex } from '../src/engine/cad/cadSpatialIndex';
import { buildCadDisplayScene } from '../src/engine/cad/cadRenderer';
import type { ParseOptions } from '../src/types';

const input = ['.2D', 'C A 0 0 0 ! !', 'C B 100 0 0 ! !', 'C C 60 40 0', 'D A-C 72.1110255 0.005', 'D B-C 56.5685425 0.005'].join('\n');

const parseOptions: ParseOptions = {
  units: 'm',
  coordMode: '2D',
  coordSystemMode: 'local',
  localDatumScheme: 'average-scale',
  averageScaleFactor: 1,
  commonElevation: 0,
  averageGeoidHeight: 0,
  observationMode: {
    bearing: 'grid',
    distance: 'measured',
    angle: 'measured',
    direction: 'measured',
  },
  gridBearingMode: 'grid',
  gridDistanceMode: 'measured',
  gridAngleMode: 'measured',
  gridDirectionMode: 'measured',
  runMode: 'adjustment',
  preanalysisMode: false,
  order: 'EN',
  angleStationOrder: 'atfromto',
  deltaMode: 'slope',
  mapMode: 'off',
  normalize: true,
  faceNormalizationMode: 'on',
  lonSign: 'west-negative',
};

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

    const pointNode = index.queryNearestSnap({ x: 0.4, y: 0.3 }, 2);
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
    expect(nearest?.x).toBeCloseTo(6.4926, 3);
    expect(nearest?.y).toBeCloseTo(7.6056, 3);

    const lineArcIntersection = index.queryNearestSnap({ x: 0.1, y: 9.8 }, 1, ['intersection']);
    expect(lineArcIntersection?.kind).toBe('intersection');
    expect(lineArcIntersection?.label).toContain('L1-L2');
    expect(lineArcIntersection?.label).toContain('arc:upper');
    expect(lineArcIntersection?.x).toBeCloseTo(0, 6);
    expect(lineArcIntersection?.y).toBeCloseTo(10, 6);

    const arcArcIntersection = index.queryNearestSnap({ x: 4, y: 9.1 }, 1, ['intersection']);
    expect(arcArcIntersection?.kind).toBe('intersection');
    expect(arcArcIntersection?.label).toContain('arc:upper');
    expect(arcArcIntersection?.label).toContain('arc:right-upper');
    expect(arcArcIntersection?.x).toBeCloseTo(4, 6);
    expect(arcArcIntersection?.y).toBeCloseTo(Math.sqrt(84), 6);
  });
});
