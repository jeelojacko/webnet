import { describe, expect, it } from 'vitest';

import type { ParseSettings } from '../src/appStateTypes';
import { buildImportConflictSummary } from '../src/engine/importConflictReview';
import type { ImportedDataset } from '../src/engine/importers';

const parseSettings = {
  coordMode: '3D',
  coordSystemMode: 'local',
  order: 'EN',
  angleUnits: 'dms',
  angleStationOrder: 'atfromto',
  angleMode: 'auto',
  deltaMode: 'slope',
  mapMode: 'off',
  normalize: true,
  faceNormalizationMode: 'on',
  applyCurvatureRefraction: false,
  refractionCoefficient: 0.13,
  verticalReduction: 'none',
  levelLoopToleranceBaseMm: 0,
  levelLoopTolerancePerSqrtKmMm: 4,
  descriptionReconcileMode: 'first',
  descriptionAppendDelimiter: ' | ',
  lonSign: 'west-negative',
  tsCorrelationEnabled: false,
  tsCorrelationRho: 0.25,
  tsCorrelationScope: 'set',
  robustMode: 'none',
  robustK: 1.5,
  parseCompatibilityMode: 'strict',
  parseModeMigrated: true,
} as ParseSettings;

describe('buildImportConflictSummary', () => {
  it('detects station collisions, coordinate deltas, description mismatches, control-state differences, and duplicate families', () => {
    const currentInput = [
      "C P1 100.0000 200.0000 10.0000 0.0100 0.0100 0.0200 'Existing control",
      "C FIX1 0.0000 0.0000 0.0000 ! ! ! 'Locked point",
      'D P1 P2 12.3456',
    ].join('\n');

    const importedDataset: ImportedDataset = {
      importerId: 'jobxml',
      formatLabel: 'JobXML',
      summary: 'summary',
      notice: { title: 'Imported JobXML dataset', detailLines: [] },
      comments: [],
      controlStations: [
        {
          kind: 'control-station',
          coordinateMode: 'local',
          stationId: 'P1',
          eastM: 101,
          northM: 201,
          heightM: 11,
          description: 'Incoming control',
        },
        {
          kind: 'control-station',
          coordinateMode: 'local',
          stationId: 'FIX1',
          eastM: 0,
          northM: 0,
          heightM: 0,
          sigmaEastM: 0.02,
          sigmaNorthM: 0.02,
          sigmaHeightM: 0.03,
          description: 'Locked point',
        },
      ],
      observations: [
        {
          kind: 'distance',
          fromId: 'P1',
          toId: 'P2',
          distanceM: 12.4,
          sourceLine: 42,
        },
      ],
      trace: [],
    };

    const conflicts = buildImportConflictSummary({
      currentInput,
      currentIncludeFiles: {},
      parseSettings,
      projectInstruments: {},
      importedDataset,
    });

    expect(conflicts.map((conflict) => conflict.type)).toEqual([
      'station-id-collision',
      'coordinate-conflict',
      'description-conflict',
      'control-state-conflict',
      'station-id-collision',
      'control-state-conflict',
      'duplicate-observation-family',
    ]);
    expect(conflicts.find((conflict) => conflict.type === 'coordinate-conflict')?.targetLabel).toBe('P1');
    expect(conflicts.find((conflict) => conflict.type === 'description-conflict')?.incomingSummary).toBe(
      'Incoming control',
    );
    expect(
      conflicts.find(
        (conflict) =>
          conflict.type === 'control-state-conflict' && conflict.targetLabel === 'FIX1',
      )?.existingSummary,
    ).toBe('fixed');
    expect(
      conflicts.find((conflict) => conflict.type === 'duplicate-observation-family')?.existingSummary,
    ).toBe('1 existing matching row');
  });

  it('returns no conflicts when the editor is empty', () => {
    const conflicts = buildImportConflictSummary({
      currentInput: '',
      currentIncludeFiles: {},
      parseSettings,
      projectInstruments: {},
      importedDataset: {
        importerId: 'jobxml',
        formatLabel: 'JobXML',
        summary: 'summary',
        notice: { title: 'Imported JobXML dataset', detailLines: [] },
        comments: [],
        controlStations: [
          {
            kind: 'control-station',
            coordinateMode: 'local',
            stationId: 'P1',
            eastM: 101,
            northM: 201,
            heightM: 11,
          },
        ],
        observations: [],
        trace: [],
      },
    });

    expect(conflicts).toEqual([]);
  });
});
