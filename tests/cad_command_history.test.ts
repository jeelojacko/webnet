import { describe, expect, it } from 'vitest';
import { buildSurveyCadSpikeProject } from '../src/engine/cad/cadModel';
import { createCadHistoryState, redoCadHistory, runCadCommand, undoCadHistory } from '../src/engine/cad/cadUndoRedo';
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

describe('Survey CAD command history', () => {
  it('replays multi-entity erase through undo and redo deterministically', () => {
    const project = buildSurveyCadSpikeProject({
      input,
      instrumentLibrary: {},
      parseOptions,
      units: 'm',
      result: null,
    });

    const pointIds = project.entities
      .filter((entity) => entity.type === 'survey-point')
      .slice(0, 2)
      .map((entity) => entity.id);
    const initialState = createCadHistoryState(project, pointIds);
    const erasedState = runCadCommand(initialState, { key: 'ERASE' });

    expect(erasedState.present.project.entities.some((entity) => pointIds.includes(entity.id))).toBe(false);
    expect(erasedState.undoStack).toHaveLength(1);
    expect(erasedState.commandState.prompt).toContain('ERASE committed');

    const undoneState = undoCadHistory(erasedState);
    expect(undoneState.present.project.entities.some((entity) => entity.id === pointIds[0])).toBe(true);
    expect(undoneState.redoStack).toHaveLength(1);
    expect(undoneState.commandState.prompt).toContain('Undo ERASE');

    const redoneState = redoCadHistory(undoneState);
    expect(redoneState.present.project.entities.some((entity) => entity.id === pointIds[0])).toBe(false);
    expect(redoneState.undoStack).toHaveLength(1);
    expect(redoneState.commandState.prompt).toContain('Redo ERASE');
  });

  it('tracks selection commands in deterministic project order', () => {
    const project = buildSurveyCadSpikeProject({
      input,
      instrumentLibrary: {},
      parseOptions,
      units: 'm',
      result: null,
    });

    const initialState = createCadHistoryState(project);
    const selectedState = runCadCommand(initialState, { key: 'SELECT_ALL' });

    expect(selectedState.present.selection.selectedEntityIds).toEqual(
      project.entities.map((entity) => entity.id),
    );

    const clearedState = runCadCommand(selectedState, { key: 'CLEAR_SELECTION' });
    expect(clearedState.present.selection.selectedEntityIds).toEqual([]);
    expect(clearedState.undoStack).toHaveLength(2);
  });
});
