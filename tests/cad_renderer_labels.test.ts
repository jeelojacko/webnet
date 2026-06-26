import { describe, expect, it } from 'vitest';
import { buildSurveyCadSpikeProject } from '../src/engine/cad/cadModel';
import { executeCadCommand, type CadWorkspaceSnapshot } from '../src/engine/cad/cadTransactions';
import { createCadSelectionState } from '../src/engine/cad/cadSelection';
import { buildCadDisplayScene } from '../src/engine/cad/cadRenderer';
import { cadSignedSweepDeg } from '../src/engine/cad/cadGeometry';
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
      expect(Math.abs(primitive.rotationDeg ?? 0)).toBeLessThanOrEqual(90);
    });
  });

  it('keeps traverse labels upright and does not create point text labels for traverse-created stations', () => {
    const traverseResult = executeCadCommand(createSnapshot(), {
      key: 'TRAVERSE',
      vertices: [
        { x: 110, y: 10, label: 'T1' },
        { x: 10, y: 10, label: 'T2' },
      ],
    });
    if (!traverseResult) throw new Error('Traverse result missing');

    const traverseId = traverseResult.addedEntityIds[traverseResult.addedEntityIds.length - 1];
    const scene = buildCadDisplayScene(traverseResult.nextSnapshot.project);
    const traverseLabels = scene.primitives.filter(
      (primitive) => primitive.kind === 'text' && primitive.sourceEntityId === traverseId,
    );
    const pointLabels = scene.primitives.filter(
      (primitive) =>
        primitive.kind === 'text' &&
        traverseResult.addedEntityIds.includes(primitive.sourceEntityId) &&
        primitive.sourceEntityId !== traverseId,
    );

    expect(traverseResult.addedEntityIds).toHaveLength(3);
    expect(pointLabels).toHaveLength(0);
    traverseLabels.forEach((primitive) => {
      if (primitive.kind !== 'text') return;
      expect(Math.abs(primitive.rotationDeg ?? 0)).toBeLessThanOrEqual(90);
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
      sourceEntityIds: [traverseResult.addedEntityIds[traverseResult.addedEntityIds.length - 1]!],
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

  it('renders geometry-tied labels for arcs without adding labels to ordinary LINE entities', () => {
    const arcResult = executeCadCommand(createSnapshot(), {
      key: 'ARC_3PT',
      start: { x: 0, y: 0, label: 'A' },
      through: { x: 50, y: 50, label: 'B' },
      end: { x: 100, y: 0, label: 'C' },
    });
    if (!arcResult) throw new Error('Arc result missing');

    const arcId = arcResult.addedEntityIds[0];
    const scene = buildCadDisplayScene(arcResult.nextSnapshot.project);
    const arcLabels = scene.primitives.filter(
      (primitive) => primitive.kind === 'text' && primitive.sourceEntityId === arcId,
    );

    expect(arcLabels).toHaveLength(1);
    const arcLabel = arcLabels[0];
    if (arcLabel.kind !== 'text') throw new Error('Arc label primitive missing');
    expect(arcLabel.text).toContain('180°00\'00"');
    expect(arcLabel.text).toContain('R 50.000 m');
    expect(arcLabel.text).toContain('L 157.080 m');
    expect(arcLabel.textAnchor).toBe('middle');
    expect(Math.abs(arcLabel.rotationDeg ?? 0)).toBeLessThanOrEqual(90);
  });

  it('renders one upright alignment label with alignment name and displayed station range', () => {
    const scene = buildCadDisplayScene({
      ...createSnapshot().project,
      entities: [
        {
          id: 'alignment:label-test',
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
              end: { x: 100, y: 0 },
            },
          ],
        },
      ],
    });

    const labels = scene.primitives.filter(
      (primitive) => primitive.kind === 'text' && primitive.sourceEntityId === 'alignment:label-test',
    );

    expect(labels).toHaveLength(1);
    const label = labels[0];
    if (label.kind !== 'text') throw new Error('Alignment label primitive missing');
    expect(label.text).toBe('ALIGN1\nSTA 1+00.000 - 2+00.000');
    expect(label.textAnchor).toBe('middle');
    expect(Math.abs(label.rotationDeg ?? 0)).toBeLessThanOrEqual(90);
  });

  it('uses displayed station equations in alignment label range text', () => {
    const scene = buildCadDisplayScene({
      ...createSnapshot().project,
      entities: [
        {
          id: 'alignment:eq-label-test',
          type: 'alignment',
          layerId: 'planning',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          name: 'ALIGN2',
          startStation: 100,
          stationEquations: [{ backStation: 110, aheadStation: 120, rawStation: 110 }],
          elements: [
            {
              kind: 'line',
              start: { x: 0, y: 0 },
              end: { x: 100, y: 0 },
            },
          ],
        },
      ],
    });

    const labels = scene.primitives.filter(
      (primitive) =>
        primitive.kind === 'text' &&
        primitive.sourceEntityId === 'alignment:eq-label-test' &&
        primitive.id.includes('alignment-label'),
    );

    expect(labels).toHaveLength(1);
    const label = labels[0];
    if (label.kind !== 'text') throw new Error('Alignment label primitive missing');
    expect(label.text).toBe('ALIGN2\nSTA 1+00.000 - 2+10.000');
  });

  it('renders station-equation marker labels at equation locations on alignments', () => {
    const scene = buildCadDisplayScene({
      ...createSnapshot().project,
      entities: [
        {
          id: 'alignment:eq-marker-test',
          type: 'alignment',
          layerId: 'planning',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          name: 'ALIGN3',
          startStation: 100,
          stationEquations: [{ backStation: 110, aheadStation: 120, rawStation: 110 }],
          elements: [
            {
              kind: 'line',
              start: { x: 0, y: 0 },
              end: { x: 100, y: 0 },
            },
          ],
        },
      ],
    });

    const equationLabels = scene.primitives.filter(
      (primitive) =>
        primitive.kind === 'text' &&
        primitive.sourceEntityId === 'alignment:eq-marker-test' &&
        primitive.id.includes('station-equation-label'),
    );

    expect(equationLabels).toHaveLength(1);
    const label = equationLabels[0];
    if (label.kind !== 'text') throw new Error('Alignment station-equation label primitive missing');
    expect(label.text).toBe('EQ 1+10.000 = 1+20.000');
    expect(label.textAnchor).toBe('middle');
    expect(Math.abs(label.rotationDeg ?? 0)).toBeLessThanOrEqual(90);
  });

  it('preserves full-circle sweep and label text for clockwise and counterclockwise arcs', () => {
    expect(cadSignedSweepDeg(180, -180)).toBe(-360);

    const scene = buildCadDisplayScene({
      ...createSnapshot().project,
      entities: [
        {
          id: 'arc:full-ccw',
          type: 'arc',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          centerX: 50,
          centerY: 20,
          radius: 12,
          startAngleDeg: 0,
          endAngleDeg: 360,
        },
        {
          id: 'arc:full-cw',
          type: 'arc',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          centerX: 80,
          centerY: 20,
          radius: 12,
          startAngleDeg: 180,
          endAngleDeg: -180,
        },
      ],
    });

    const labels = scene.primitives.filter((primitive) => primitive.kind === 'text');
    expect(labels).toHaveLength(2);
    labels.forEach((label) => {
      if (label.kind !== 'text') return;
      expect(label.text).toContain('360°00\'00"');
      expect(label.text).toContain('L 75.398 m');
    });
  });
});
