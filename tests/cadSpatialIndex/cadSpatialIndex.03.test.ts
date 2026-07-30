import { describe, expect, it } from 'vitest';
import {
  appendCadProjectEntities,
  buildSurveyCadSpikeProject,
  buildCadSpatialIndex,
  input,
  parseOptions,
} from './cadSpatialIndexTestSupport';

describe('Survey CAD spatial index', () => {
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

  it('keeps local parallel snaps available for attached linework after fail-closed scoping', () => {
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
          fromStationId: 'A',
          toStationId: 'B',
          fromX: 0,
          fromY: 0,
          toX: 10,
          toY: 0,
          sourceObservationIds: [],
        },
        {
          id: 'line:attached-parallel',
          type: 'line',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'B',
          toStationId: 'C',
          fromX: 10,
          fromY: 0,
          toX: 20,
          toY: 0,
          sourceObservationIds: [],
        },
      ],
    );
    const index = buildCadSpatialIndex(project);

    const localParallel = index.queryNearestSnap(
      { x: 16, y: 5.72 },
      1,
      ['parallel'],
      {
        active: true,
        basePoint: { x: 10, y: 5 },
        scopeSeedSegmentId: 'line:base#0',
      },
    );
    expect(localParallel?.kind).toBe('parallel');
    expect(localParallel?.y).toBeCloseTo(5, 6);
  });

  it('fails closed for parallel snaps when an explicit construction seed cannot be resolved', () => {
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
          fromStationId: 'A',
          toStationId: 'B',
          fromX: 0,
          fromY: 0,
          toX: 10,
          toY: 0,
          sourceObservationIds: [],
        },
        {
          id: 'line:remote',
          type: 'line',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'R1',
          toStationId: 'R2',
          fromX: 0,
          fromY: 20,
          toX: 10,
          toY: 20,
          sourceObservationIds: [],
        },
      ],
    );
    const index = buildCadSpatialIndex(project);

    const filteredParallel = index.queryNearestSnap(
      { x: 5, y: 20.2 },
      1,
      ['parallel'],
      {
        active: true,
        basePoint: { x: 5, y: 0 },
        scopeSeedSegmentId: 'line:missing#0',
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

});
