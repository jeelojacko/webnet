
import { describe, expect, it } from 'vitest';
import {
  buildSurveyCadSpikeProject,
  appendCadProjectEntities,
  createCadHistoryState,
  redoCadHistory,
  runCadCommand,
  undoCadHistory,
  input,
  parseOptions,
} from './cadCommandHistoryTestSupport';

describe('Survey CAD command history', () => {
  it('creates offset alignments through history with persisted provenance', () => {
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
          id: 'alignment:test',
          type: 'alignment',
          layerId: 'planning',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          name: 'ALIGN1',
          startStation: 100,
          stationEquations: [{ backStation: 110, aheadStation: 120, rawStation: 110 }],
          elements: [
            {
              kind: 'line',
              start: { x: 0, y: 0 },
              end: { x: 100, y: 0 },
            },
            {
              kind: 'arc',
              center: { x: 100, y: 50 },
              radius: 50,
              startAngleDeg: -90,
              endAngleDeg: 0,
            },
          ],
        },
      ],
    );

    const offsetState = runCadCommand(createCadHistoryState(project), {
      key: 'ALIGNMENT_OFFSET_CREATE',
      alignmentEntityId: 'alignment:test',
      offset: 10,
    });
    const offsetAlignment = offsetState.present.project.entities.find(
      (entity): entity is Extract<(typeof offsetState.present.project.entities)[number], { type: 'alignment' }> =>
        entity.type === 'alignment' && entity.id !== 'alignment:test',
    );
    expect(offsetAlignment?.name).toBe('ALIGN2');
    expect(offsetAlignment?.startStation).toBe(100);
    expect(offsetAlignment?.stationEquations).toEqual([
      { backStation: 110, aheadStation: 120, rawStation: 110 },
    ]);
    expect(offsetAlignment?.elements).toHaveLength(2);
    expect(offsetAlignment?.elements[0]).toEqual({
      kind: 'line',
      start: { x: 0, y: 10 },
      end: { x: 100, y: 10 },
      sourceEntityId: undefined,
    });
    expect(offsetState.present.project.cogoComputations.at(-1)?.toolKey).toBe('ALIGNMENT_OFFSET');
    expect(offsetState.present.project.cogoComputations.at(-1)?.report.title).toBe('Offset Alignment');
    expect(
      offsetState.present.project.cogoComputations.at(-1)?.report.rows.find((row) => row.label === 'End station')?.value,
    ).toBe('2+72.832');

    const undoneState = undoCadHistory(offsetState);
    expect(
      undoneState.present.project.entities.filter((entity) => entity.type === 'alignment'),
    ).toHaveLength(1);

    const redoneState = redoCadHistory(undoneState);
    expect(
      redoneState.present.project.entities.filter((entity) => entity.type === 'alignment'),
    ).toHaveLength(2);
  });

  it('creates alignment interval points through history with persisted provenance', () => {
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
          id: 'alignment:test',
          type: 'alignment',
          layerId: 'planning',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          name: 'ALIGN1',
          startStation: 100,
          elements: [
            {
              kind: 'line',
              start: { x: 0, y: 0 },
              end: { x: 60, y: 40 },
            },
          ],
        },
      ],
    );

    const pointState = runCadCommand(createCadHistoryState(project), {
      key: 'ALIGNMENT_INTERVAL_POINTS',
      alignmentEntityId: 'alignment:test',
      startStation: 100,
      endStation: 130,
      interval: 10,
      labelPrefix: 'INT',
    });
    expect(
      pointState.present.project.entities.filter(
        (entity) => entity.type === 'survey-point' && /^INT\d+$/.test(entity.stationId),
      ),
    ).toHaveLength(4);
    expect(
      pointState.present.project.entities
        .filter(
          (entity): entity is Extract<(typeof pointState.present.project.entities)[number], { type: 'text' }> =>
            entity.type === 'text' && /^label:INT\d+$/.test(entity.id),
        )
        .map((entity) => entity.text),
    ).toEqual([
      'INT1\nSTA 1+00.000',
      'INT2\nSTA 1+10.000',
      'INT3\nSTA 1+20.000',
      'INT4\nSTA 1+30.000',
    ]);
    expect(pointState.present.project.cogoComputations.at(-1)?.toolKey).toBe('ALIGNMENT_INTERVALS');
    expect(pointState.present.project.cogoComputations.at(-1)?.report.title).toBe('Alignment Interval Points');
    expect(
      pointState.present.project.cogoComputations.at(-1)?.report.rows.find((row) => row.label === 'Start station')?.value,
    ).toBe('1+00.000');
    expect(
      pointState.present.project.cogoComputations.at(-1)?.report.rows.find((row) => row.label === 'End station')?.value,
    ).toBe('1+30.000');

    const undoneState = undoCadHistory(pointState);
    expect(
      undoneState.present.project.entities.some(
        (entity) => entity.type === 'survey-point' && /^INT\d+$/.test(entity.stationId),
      ),
    ).toBe(false);

    const redoneState = redoCadHistory(undoneState);
    expect(
      redoneState.present.project.entities.filter(
        (entity) => entity.type === 'survey-point' && /^INT\d+$/.test(entity.stationId),
      ),
    ).toHaveLength(4);
  });

  it('creates three-point and tangent-curve arc entities through history with undo/redo', () => {
    const project = buildSurveyCadSpikeProject({
      input,
      instrumentLibrary: {},
      parseOptions,
      units: 'm',
      result: null,
    });

    const arc3ptState = runCadCommand(createCadHistoryState(project), {
      key: 'ARC_3PT',
      start: { x: 5, y: 0, label: 'S' },
      through: { x: 0, y: 5, label: 'M' },
      end: { x: -5, y: 0, label: 'E' },
    });
    const threePointArc = arc3ptState.present.project.entities.find((entity) => entity.type === 'arc');
    expect(threePointArc?.type).toBe('arc');
    if (threePointArc?.type !== 'arc') throw new Error('Three-point arc missing');
    expect(threePointArc.centerX).toBeCloseTo(0, 6);
    expect(threePointArc.centerY).toBeCloseTo(0, 6);
    expect(threePointArc.radius).toBeCloseTo(5, 6);
    expect(threePointArc.metadata?.entityName).toBe('CURVE1');
    expect(
      arc3ptState.present.project.entities.some(
        (entity) => entity.type === 'survey-point' && entity.stationId === 'BC1',
      ),
    ).toBe(true);
    expect(
      arc3ptState.present.project.entities.some(
        (entity) => entity.type === 'survey-point' && entity.stationId === 'MP1',
      ),
    ).toBe(true);
    expect(
      arc3ptState.present.project.entities.some(
        (entity) => entity.type === 'survey-point' && entity.stationId === 'EC1',
      ),
    ).toBe(true);
    expect(
      arc3ptState.present.project.entities.some(
        (entity) => entity.type === 'survey-point' && entity.stationId === 'R1',
      ),
    ).toBe(true);
    expect(arc3ptState.present.project.cogoComputations[0]?.report.summary).toBe(
      'Created CURVE1 with BC1, MP1, EC1, R1',
    );
    expect(arc3ptState.present.project.cogoComputations[0]?.provenance.sourcePointIds).toEqual([
      'BC1',
      'MP1',
      'EC1',
      'R1',
    ]);

    const tangentState = runCadCommand(arc3ptState, {
      key: 'TANGENT_CURVE',
      pi: { x: 0, y: 0, label: 'PI' },
      backTangentPoint: { x: -10, y: 0, label: 'BACK' },
      aheadTangentPoint: { x: 0, y: 10, label: 'AHEAD' },
      radius: 10,
    });
    const tangentArc = tangentState.present.project.entities.find(
      (entity) => entity.type === 'arc' && entity.id !== threePointArc.id,
    );
    expect(tangentState.present.project.cogoComputations.map((entry) => entry.toolKey)).toEqual([
      'ARC_CREATE',
      'TANGENT_CURVE',
    ]);
    expect(tangentState.present.project.cogoComputations[1]?.report.summary).toBe(
      'Created CURVE2 tangent curve with BC2, MP2, EC2, R2',
    );
    expect(tangentArc?.type).toBe('arc');
    if (tangentArc?.type !== 'arc') throw new Error('Tangent curve arc missing');
    expect(tangentArc.centerX).toBeCloseTo(-10, 6);
    expect(tangentArc.centerY).toBeCloseTo(10, 6);
    expect(tangentArc.radius).toBeCloseTo(10, 6);
    expect(tangentArc.metadata?.entityName).toBe('CURVE2');
    expect(
      tangentState.present.project.entities.some(
        (entity) => entity.type === 'survey-point' && entity.stationId === 'R2',
      ),
    ).toBe(true);

    const undoneState = undoCadHistory(tangentState);
    expect(
      undoneState.present.project.entities.some(
        (entity) => entity.type === 'arc' && entity.id === tangentArc.id,
      ),
    ).toBe(false);

    const redoneState = redoCadHistory(undoneState);
    expect(
      redoneState.present.project.entities.some(
        (entity) => entity.type === 'arc' && entity.id === tangentArc.id,
      ),
    ).toBe(true);
  });

  it('creates parcel entities with closure metrics from a selected traverse/polyline seam', () => {
    const project = buildSurveyCadSpikeProject({
      input,
      instrumentLibrary: {},
      parseOptions,
      units: 'm',
      result: null,
    });

    const traverseState = runCadCommand(createCadHistoryState(project), {
      key: 'TRAVERSE',
      vertices: [
        { x: 0, y: 0, label: 'A' },
        { x: 25, y: 0, label: 'P1' },
        { x: 25, y: 15, label: 'P2' },
        { x: 0, y: 0, label: 'A' },
      ],
    });
    const traversePolyline = traverseState.present.project.entities.find(
      (entity) => entity.type === 'polyline',
    );
    expect(traversePolyline?.type).toBe('polyline');
    if (traversePolyline?.type !== 'polyline') throw new Error('Traverse polyline missing');

    const parcelState = runCadCommand(
      {
        ...traverseState,
        present: {
          ...traverseState.present,
          selection: {
            selectedEntityIds: [traversePolyline.id],
          },
        },
      },
      {
        key: 'PARCEL_CREATE',
        sourceEntityIds: [traversePolyline.id],
      },
    );
    const parcel = parcelState.present.project.entities.find((entity) => entity.type === 'parcel');
    expect(parcel?.type).toBe('parcel');
    if (parcel?.type !== 'parcel') throw new Error('Parcel missing');
    expect(parcelState.present.project.cogoComputations.map((entry) => entry.toolKey)).toEqual([
      'TRAVERSE',
      'PARCEL_CREATE',
    ]);
    expect(parcel.metadata?.cogo).toMatchObject({
      toolKey: 'PARCEL_CREATE',
      sourceEntityIds: [traversePolyline.id],
    });
    expect(parcel.areaSquareMeters).toBeCloseTo(187.5, 6);
    expect(parcel.perimeterMeters).toBeCloseTo(69.154759, 6);
    expect(parcel.closureDistanceMeters).toBeCloseTo(0, 6);
    const parcelReportRows = parcelState.present.project.cogoComputations.at(-1)?.report.rows ?? [];
    expect(parcelReportRows).toEqual(
      expect.arrayContaining([
        { label: 'Course 1', value: 'A-P1 N90-00-00.00E' },
        { label: 'Course 1 Distance', value: '25.000', unit: 'm' },
        { label: 'Course 2', value: 'P1-P2 N00-00-00.00E' },
        { label: 'Course 3', value: 'P2-A S59-02-10.48W' },
      ]),
    );

    const undoneParcelState = undoCadHistory(parcelState);
    expect(
      undoneParcelState.present.project.entities.some(
        (entity) => entity.type === 'parcel' && entity.id === parcel.id,
      ),
    ).toBe(false);

    const redoneParcelState = redoCadHistory(undoneParcelState);
    expect(
      redoneParcelState.present.project.entities.some(
        (entity) => entity.type === 'parcel' && entity.id === parcel.id,
      ),
    ).toBe(true);
  });

});
