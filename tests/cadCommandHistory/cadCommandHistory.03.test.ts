
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
  it('creates alignments from selected line and arc chains and replays them via undo/redo', () => {
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
          id: 'arc:alignment-test',
          type: 'arc',
          layerId: 'planning',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          centerX: 60,
          centerY: 60,
          radius: 20,
          startAngleDeg: -90,
          endAngleDeg: 0,
        },
      ],
    );

    const alignmentState = runCadCommand(
      createCadHistoryState(project),
      {
        key: 'ALIGNMENT_CREATE',
        sourceEntityIds: ['line:A|C', 'arc:alignment-test'],
      },
    );
    const alignment = alignmentState.present.project.entities.find((entity) => entity.type === 'alignment');
    expect(alignment?.type).toBe('alignment');
    expect(alignmentState.commandState.prompt).toContain('ALIGN committed');
    expect(alignmentState.present.project.cogoComputations.at(-1)?.toolKey).toBe('ALIGNMENT');
    expect(alignment?.metadata?.cogo).toMatchObject({
      toolKey: 'ALIGNMENT',
      sourceEntityIds: ['line:A|C', 'arc:alignment-test'],
    });

    const undoneState = undoCadHistory(alignmentState);
    expect(undoneState.present.project.entities.some((entity) => entity.type === 'alignment')).toBe(false);

    const redoneState = redoCadHistory(undoneState);
    expect(redoneState.present.project.entities.some((entity) => entity.type === 'alignment')).toBe(true);
  });

  it('persists alignment station reports for selected alignment and point geometry', () => {
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

    const reportState = runCadCommand(createCadHistoryState(project), {
      key: 'ALIGNMENT_STATION_REPORT',
      alignmentEntityId: 'alignment:test',
      pointEntityId: 'pt:C',
    });
    expect(reportState.present.project.cogoComputations.at(-1)?.toolKey).toBe('ALIGNMENT_STATION');
    expect(reportState.present.project.cogoComputations.at(-1)?.report.title).toBe('Alignment Station');
    expect(
      reportState.present.project.cogoComputations.at(-1)?.report.rows.find((row) => row.label === 'Station')?.value,
    ).toBe('1+72.111');

    const undoneState = undoCadHistory(reportState);
    expect(undoneState.present.project.cogoComputations.some((entry) => entry.toolKey === 'ALIGNMENT_STATION')).toBe(false);

    const redoneState = redoCadHistory(undoneState);
    expect(redoneState.present.project.cogoComputations.some((entry) => entry.toolKey === 'ALIGNMENT_STATION')).toBe(true);
  });

  it('creates alignment station-offset points through history with persisted provenance', () => {
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
      key: 'ALIGNMENT_OFFSET_POINT',
      alignmentEntityId: 'alignment:test',
      station: 110,
      offset: 5,
      label: 'SO1',
    });
    const pointEntity = pointState.present.project.entities.find(
      (entity): entity is Extract<(typeof pointState.present.project.entities)[number], { type: 'survey-point' }> =>
        entity.type === 'survey-point' && entity.stationId === 'SO1',
    );
    const labelEntity = pointState.present.project.entities.find(
      (entity): entity is Extract<(typeof pointState.present.project.entities)[number], { type: 'text' }> =>
        entity.type === 'text' && entity.id === 'label:SO1',
    );
    expect(pointEntity?.type).toBe('survey-point');
    expect(labelEntity?.type).toBe('text');
    expect(pointEntity?.x ?? Number.NaN).toBeCloseTo(5.54700196, 6);
    expect(pointEntity?.y ?? Number.NaN).toBeCloseTo(9.70725343, 6);
    expect(labelEntity?.text).toBe('SO1\nSTA 1+10.000\nOFF 5.000 m');
    expect(pointEntity?.metadata?.alignmentName).toBe('ALIGN1');
    expect(pointEntity?.metadata?.alignmentStation).toBe('1+10.000');
    expect(pointEntity?.metadata?.alignmentOffset).toBe(5);
    expect(pointState.present.project.cogoComputations.at(-1)?.toolKey).toBe('ALIGNMENT_POINT');
    expect(pointState.present.project.cogoComputations.at(-1)?.report.title).toBe(
      'Alignment Station Offset Point',
    );
    expect(
      pointState.present.project.cogoComputations.at(-1)?.report.rows.find((row) => row.label === 'Station')?.value,
    ).toBe('1+10.000');

    const undoneState = undoCadHistory(pointState);
    expect(
      undoneState.present.project.entities.some(
        (entity) => entity.type === 'survey-point' && entity.stationId === 'SO1',
      ),
    ).toBe(false);

    const redoneState = redoCadHistory(undoneState);
    expect(
      redoneState.present.project.entities.some(
        (entity) => entity.type === 'survey-point' && entity.stationId === 'SO1',
      ),
    ).toBe(true);
  });

  it('renames stakeout point labels through history without losing multiline station text', () => {
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
      key: 'ALIGNMENT_OFFSET_POINT',
      alignmentEntityId: 'alignment:test',
      station: 110,
      offset: 5,
      label: 'SO1',
    });
    const renamedState = runCadCommand(pointState, {
      key: 'EDIT_ENTITY',
      entityId: 'pt:SO1',
      edit: {
        kind: 'entity-name',
        value: 'SO2',
      },
    });

    const renamedPoint = renamedState.present.project.entities.find(
      (entity) => entity.type === 'survey-point' && entity.id === 'pt:SO1',
    );
    const renamedLabel = renamedState.present.project.entities.find(
      (entity) => entity.type === 'text' && entity.id === 'label:SO1',
    );
    expect(renamedPoint?.type).toBe('survey-point');
    expect(renamedPoint?.type === 'survey-point' ? renamedPoint.stationId : null).toBe('SO2');
    expect(renamedLabel?.type).toBe('text');
    expect(renamedLabel?.type === 'text' ? renamedLabel.text : null).toBe('SO2\nSTA 1+10.000\nOFF 5.000 m');
    expect(renamedLabel?.type === 'text' ? renamedLabel.metadata?.stationId : null).toBe('SO2');
  });

  it('adds alignment station equations through history and applies them to later station input', () => {
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

    const equationState = runCadCommand(createCadHistoryState(project), {
      key: 'ALIGNMENT_STATION_EQUATION',
      alignmentEntityId: 'alignment:test',
      backStation: 110,
      aheadStation: 120,
    });
    const alignmentEntity = equationState.present.project.entities.find(
      (entity): entity is Extract<(typeof equationState.present.project.entities)[number], { type: 'alignment' }> =>
        entity.type === 'alignment' && entity.id === 'alignment:test',
    );
    expect(alignmentEntity?.stationEquations).toEqual([
      { backStation: 110, aheadStation: 120, rawStation: 110 },
    ]);
    expect(equationState.present.project.cogoComputations.at(-1)?.toolKey).toBe('ALIGNMENT_STATION_EQUATION');
    expect(equationState.present.project.cogoComputations.at(-1)?.report.title).toBe('Alignment Station Equation');
    expect(
      equationState.present.project.cogoComputations.at(-1)?.report.rows.find((row) => row.label === 'Back station')?.value,
    ).toBe('1+10.000');
    expect(
      equationState.present.project.cogoComputations.at(-1)?.report.rows.find((row) => row.label === 'Ahead station')?.value,
    ).toBe('1+20.000');

    const pointState = runCadCommand(equationState, {
      key: 'ALIGNMENT_OFFSET_POINT',
      alignmentEntityId: 'alignment:test',
      station: 125,
      offset: 0,
      label: 'SEQ1',
    });
    const pointEntity = pointState.present.project.entities.find(
      (entity): entity is Extract<(typeof pointState.present.project.entities)[number], { type: 'survey-point' }> =>
        entity.type === 'survey-point' && entity.stationId === 'SEQ1',
    );
    expect(pointEntity?.x ?? Number.NaN).toBeCloseTo(12.48075442, 6);
    expect(pointEntity?.y ?? Number.NaN).toBeCloseTo(8.32050294, 6);

    const undoneState = undoCadHistory(pointState);
    expect(
      undoneState.present.project.entities.some(
        (entity) => entity.type === 'survey-point' && entity.stationId === 'SEQ1',
      ),
    ).toBe(false);

    const redoneState = redoCadHistory(undoneState);
    expect(
      redoneState.present.project.entities.some(
        (entity) => entity.type === 'survey-point' && entity.stationId === 'SEQ1',
      ),
    ).toBe(true);
  });

});
