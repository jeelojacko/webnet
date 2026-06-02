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

  it('resolves construction snaps only when active command context supplies a base point', () => {
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
          id: 'line:base',
          type: 'line',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'L1',
          toStationId: 'L2',
          fromX: 0,
          fromY: 0,
          toX: 10,
          toY: 0,
          sourceObservationIds: [],
        },
        {
          id: 'line:apparent',
          type: 'line',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'L3',
          toStationId: 'L4',
          fromX: 20,
          fromY: -5,
          toX: 20,
          toY: 5,
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
      ],
    );
    const index = buildCadSpatialIndex(project);
    const inactiveContext = { active: false, basePoint: null };
    const activeContext = { active: true, basePoint: { x: 5, y: 10 } };

    expect(index.queryNearestSnap({ x: 15, y: 0.1 }, 1, ['extension'], inactiveContext)).toBeNull();

    const extension = index.queryNearestSnap({ x: 15, y: 0.1 }, 1, ['extension'], activeContext);
    expect(extension?.kind).toBe('extension');
    expect(extension?.x).toBeCloseTo(15, 6);
    expect(extension?.y).toBeCloseTo(0, 6);

    const perpendicular = index.queryNearestSnap({ x: 5.2, y: 0.1 }, 1, ['perpendicular'], activeContext);
    expect(perpendicular?.kind).toBe('perpendicular');
    expect(perpendicular?.x).toBeCloseTo(5, 6);
    expect(perpendicular?.y).toBeCloseTo(0, 6);

    const parallel = index.queryNearestSnap({ x: 15.1, y: 10.2 }, 1, ['parallel'], activeContext);
    expect(parallel?.kind).toBe('parallel');
    expect(parallel?.x).toBeCloseTo(15.1, 6);
    expect(parallel?.y).toBeCloseTo(10, 6);
    expect(parallel?.guideSegments).toHaveLength(2);

    const apparentIntersection = index.queryNearestSnap(
      { x: 20.1, y: 0.2 },
      1,
      ['apparent-intersection'],
      activeContext,
    );
    expect(apparentIntersection?.kind).toBe('apparent-intersection');
    expect(apparentIntersection?.x).toBeCloseTo(20, 6);
    expect(apparentIntersection?.y).toBeCloseTo(0, 6);

    const arcPerpendicular = index.queryNearestSnap(
      { x: 0.1, y: 10.2 },
      1,
      ['perpendicular'],
      { active: true, basePoint: { x: 0, y: 30 } },
    );
    expect(arcPerpendicular?.kind).toBe('perpendicular');
    expect(arcPerpendicular?.sourceEntityId).toBe('arc:upper');
    expect(arcPerpendicular?.x).toBeCloseTo(0, 6);
    expect(arcPerpendicular?.y).toBeCloseTo(10, 6);
  });

  it('limits parallel candidates to segments within one hop of the captured endpoint', () => {
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
          id: 'pline:chain',
          type: 'polyline',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          closed: false,
          vertices: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 20, y: 0 },
            { x: 20, y: 20 },
          ],
          vertexLabels: ['P1', 'P2', 'P3', 'P4'],
        },
        {
          id: 'line:remote-vertical',
          type: 'line',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'L5',
          toStationId: 'L6',
          fromX: 40,
          fromY: -20,
          toX: 40,
          toY: 20,
          sourceObservationIds: [],
        },
      ],
    );
    const index = buildCadSpatialIndex(project);

    const filteredParallel = index.queryNearestSnap(
      { x: 0.1, y: 15 },
      1,
      ['parallel'],
      {
        active: true,
        basePoint: { x: 0, y: 0 },
      },
    );
    expect(filteredParallel).toBeNull();
  });

  it('uses the captured start segment to scope parallel snaps even when the base point is not a graph endpoint', () => {
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
          id: 'pline:chain',
          type: 'polyline',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          closed: false,
          vertices: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 20, y: 0 },
            { x: 20, y: 20 },
          ],
          vertexLabels: ['P1', 'P2', 'P3', 'P4'],
        },
      ],
    );
    const index = buildCadSpatialIndex(project);

    const filteredParallel = index.queryNearestSnap(
      { x: 0.1, y: 15 },
      1,
      ['parallel'],
      {
        active: true,
        basePoint: { x: 5, y: 0 },
        scopeSeedSegmentId: 'pline:chain#0',
      },
    );
    expect(filteredParallel).toBeNull();
  });

  it('limits extension candidates to linework within two hops of the captured endpoint', () => {
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
          id: 'pline:chain',
          type: 'polyline',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          closed: false,
          vertices: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 20, y: 0 },
            { x: 20, y: 20 },
            { x: 40, y: 20 },
          ],
          vertexLabels: ['P1', 'P2', 'P3', 'P4', 'P5'],
        },
      ],
    );
    const index = buildCadSpatialIndex(project);

    const allowedExtension = index.queryNearestSnap(
      { x: 20.1, y: 30 },
      1,
      ['extension'],
      {
        active: true,
        basePoint: { x: 0, y: 0 },
      },
    );
    expect(allowedExtension?.kind).toBe('extension');
    expect(allowedExtension?.x).toBeCloseTo(20, 6);
    expect(allowedExtension?.y).toBeCloseTo(30, 6);

    const filteredExtension = index.queryNearestSnap(
      { x: 50, y: 20.1 },
      1,
      ['extension'],
      {
        active: true,
        basePoint: { x: 0, y: 0 },
      },
    );
    expect(filteredExtension).toBeNull();
  });

  it('limits apparent intersections to linework within two hops of the captured endpoint', () => {
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
          id: 'pline:chain',
          type: 'polyline',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          closed: false,
          vertices: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 20, y: 0 },
            { x: 20, y: 20 },
            { x: 40, y: 20 },
          ],
          vertexLabels: ['P1', 'P2', 'P3', 'P4', 'P5'],
        },
        {
          id: 'line:remote-vertical',
          type: 'line',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'L5',
          toStationId: 'L6',
          fromX: 50,
          fromY: 0,
          toX: 50,
          toY: 30,
          sourceObservationIds: [],
        },
      ],
    );
    const index = buildCadSpatialIndex(project);

    const filteredApparent = index.queryNearestSnap(
      { x: 50, y: 20 },
      1,
      ['apparent-intersection'],
      {
        active: true,
        basePoint: { x: 0, y: 0 },
      },
    );
    expect(filteredApparent).toBeNull();
  });

  it('keeps a locked construction snap while refining onto an on-line apparent intersection', () => {
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
          id: 'line:base',
          type: 'line',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'L1',
          toStationId: 'L2',
          fromX: 0,
          fromY: 0,
          toX: 10,
          toY: 0,
          sourceObservationIds: [],
        },
        {
          id: 'line:short-vertical',
          type: 'line',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'L3',
          toStationId: 'L4',
          fromX: 5,
          fromY: 15,
          toX: 5,
          toY: 25,
          sourceObservationIds: [],
        },
      ],
    );
    const index = buildCadSpatialIndex(project);

    const compoundPerpendicular = index.queryNearestSnap(
      { x: 5.1, y: 0.2 },
      1,
      ['perpendicular', 'apparent-intersection'],
      { active: true, basePoint: { x: 5, y: 10 } },
    );
    expect(compoundPerpendicular?.kind).toBe('perpendicular');
    expect(compoundPerpendicular?.compoundKinds).toEqual(['perpendicular', 'apparent-intersection']);
    expect(compoundPerpendicular?.label).toContain('perp');
    expect(compoundPerpendicular?.label).toContain('apparent');
    expect(compoundPerpendicular?.x).toBeCloseTo(5, 6);
    expect(compoundPerpendicular?.y).toBeCloseTo(0, 6);
    expect(compoundPerpendicular?.guideSegments?.length).toBeGreaterThanOrEqual(3);
  });

  it('resolves tangent-to-arc and line-arc apparent intersections from construction context', () => {
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
          id: 'line:high',
          type: 'line',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'L1',
          toStationId: 'L2',
          fromX: 20,
          fromY: 9,
          toX: 22,
          toY: 9,
          sourceObservationIds: [],
        },
        {
          id: 'arc:right',
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
      ],
    );
    const index = buildCadSpatialIndex(project);

    const tangent = index.queryNearestSnap(
      { x: 8.7, y: 5.1 },
      1,
      ['tangent'],
      { active: true, basePoint: { x: 0, y: 20 } },
    );
    expect(tangent?.kind).toBe('tangent');
    expect(tangent?.sourceEntityId).toBe('arc:right');
    expect(tangent?.x).toBeCloseTo(8.660254, 6);
    expect(tangent?.y).toBeCloseTo(5, 6);
    expect(tangent?.guideSegments).toHaveLength(2);
    expect(tangent?.guideSegments?.[0]?.[0]?.x).toBeCloseTo(0, 6);
    expect(tangent?.guideSegments?.[0]?.[0]?.y).toBeCloseTo(20, 6);

    const apparentLineArc = index.queryNearestSnap(
      { x: 4.4, y: 9.1 },
      1,
      ['apparent-intersection'],
      { active: true, basePoint: { x: 20, y: 9 } },
    );
    expect(apparentLineArc?.kind).toBe('apparent-intersection');
    expect(apparentLineArc?.label).toContain('L1-L2');
    expect(apparentLineArc?.label).toContain('arc:right');
    expect(apparentLineArc?.x).toBeCloseTo(Math.sqrt(19), 6);
    expect(apparentLineArc?.y).toBeCloseTo(9, 6);
    expect(apparentLineArc?.guideSegments).toHaveLength(2);
  });

  it('resolves arc-arc apparent intersections when the visible sweeps do not meet at the full-circle crossings', () => {
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
          id: 'arc:left-upper',
          type: 'arc',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          centerX: 0,
          centerY: 0,
          radius: 5,
          startAngleDeg: 170,
          endAngleDeg: 250,
        },
        {
          id: 'arc:right-upper',
          type: 'arc',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          centerX: 6,
          centerY: 0,
          radius: 5,
          startAngleDeg: -70,
          endAngleDeg: 10,
        },
      ],
    );
    const index = buildCadSpatialIndex(project);

    const apparentArcArc = index.queryNearestSnap(
      { x: 3, y: 4.1 },
      0.5,
      ['apparent-intersection'],
      { active: true, basePoint: { x: 0, y: 0 } },
    );
    expect(apparentArcArc?.kind).toBe('apparent-intersection');
    expect(apparentArcArc?.label).toContain('arc:left-upper');
    expect(apparentArcArc?.label).toContain('arc:right-upper');
    expect(apparentArcArc?.x).toBeCloseTo(3, 6);
    expect(apparentArcArc?.y).toBeCloseTo(4, 6);
  });
});
