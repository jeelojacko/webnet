import { describe, expect, it } from 'vitest';
import { buildSurveyCadSpikeProject } from '../src/engine/cad/cadModel';
import { executeCadCommand, type CadWorkspaceSnapshot } from '../src/engine/cad/cadTransactions';
import { createCadSelectionState } from '../src/engine/cad/cadSelection';
import { buildCadDisplayScene } from '../src/engine/cad/cadRenderer';
import type { ParseOptions } from '../src/types';

const input = ['.2D', 'C A 0 0 0 ! !', 'C B 100 0 0 ! !', 'C C 25 15 0 ! !'].join('\n');

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

const createSnapshot = (): CadWorkspaceSnapshot => {
  const project = buildSurveyCadSpikeProject({
    input,
    instrumentLibrary: {},
    parseOptions,
    units: 'm',
    result: null,
  });
  return {
    project,
    selection: createCadSelectionState(project),
  };
};

describe('CAD renderer labels', () => {
  it('does not render azimuth-distance labels for ordinary LINE geometry', () => {
    const lineResult = executeCadCommand(createSnapshot(), {
      key: 'LINE',
      start: { x: 0, y: 0, label: 'A' },
      end: { x: 100, y: 0, label: 'B' },
    });
    if (!lineResult) throw new Error('Line result missing');

    const lineId = lineResult.addedEntityIds[0];
    const scene = buildCadDisplayScene(lineResult.nextSnapshot.project);
    const labels = scene.primitives.filter(
      (primitive) => primitive.kind === 'text' && primitive.sourceEntityId === lineId,
    );

    expect(labels).toHaveLength(0);
  });

  it('renders north-azimuth and distance labels centered on traverse segments only', () => {
    const traverseResult = executeCadCommand(createSnapshot(), {
      key: 'TRAVERSE',
      vertices: [
        { x: 0, y: 0, label: 'A' },
        { x: 100, y: 0, label: 'B' },
        { x: 100, y: 100, label: 'C' },
      ],
    });
    if (!traverseResult) throw new Error('Traverse result missing');

    const traverseId = traverseResult.addedEntityIds[traverseResult.addedEntityIds.length - 1];
    const scene = buildCadDisplayScene(traverseResult.nextSnapshot.project);
    const labels = scene.primitives.filter(
      (primitive) => primitive.kind === 'text' && primitive.sourceEntityId === traverseId,
    );

    expect(labels).toHaveLength(4);
    expect(labels.map((primitive) => primitive.kind === 'text' ? primitive.text : '')).toContain('90°00\'00"');
    expect(labels.map((primitive) => primitive.kind === 'text' ? primitive.text : '')).toContain('100.000 m');
    expect(labels.map((primitive) => primitive.kind === 'text' ? primitive.text : '')).toContain('0°00\'00"');
    labels.forEach((primitive) => {
      if (primitive.kind !== 'text') return;
      expect(primitive.textAnchor).toBe('middle');
    });
  });

  it('renders stacked parcel area and perimeter text without a separate parcel label entity', () => {
    const traverseResult = executeCadCommand(createSnapshot(), {
      key: 'TRAVERSE',
      vertices: [
        { x: 0, y: 0, label: 'A' },
        { x: 25, y: 0, label: 'B' },
        { x: 25, y: 15, label: 'C' },
        { x: 0, y: 0, label: 'A' },
      ],
    });
    if (!traverseResult) throw new Error('Traverse result missing');

    const parcelResult = executeCadCommand(traverseResult.nextSnapshot, {
      key: 'PARCEL_CREATE',
      sourceEntityId: traverseResult.addedEntityIds[traverseResult.addedEntityIds.length - 1]!,
    });
    if (!parcelResult) throw new Error('Parcel result missing');

    const parcelId = parcelResult.addedEntityIds[0];
    const scene = buildCadDisplayScene(parcelResult.nextSnapshot.project);
    const parcelLabels = scene.primitives.filter(
      (primitive) => primitive.kind === 'text' && primitive.sourceEntityId === parcelId,
    );

    expect(parcelResult.addedEntityIds).toHaveLength(1);
    expect(parcelLabels).toHaveLength(1);
    const parcelLabel = parcelLabels[0];
    if (parcelLabel.kind !== 'text') throw new Error('Parcel label primitive missing');
    expect(parcelLabel.text).toBe('187.500 m²\n69.155 m');
    expect(parcelLabel.textAnchor).toBe('middle');
  });
});
