import { describe, expect, it } from 'vitest';

import type { ParseSettings } from '../src/appStateTypes';
import {
  buildImportConflictResolutionDefaults,
  buildImportConflictSummary,
  buildResolvedImportText,
} from '../src/engine/importConflictReview';
import type { ImportedDataset } from '../src/engine/importers';
import type { ImportReviewModel } from '../src/engine/importReview';

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

  it('applies deterministic reconciliation resolutions when building the final import text', () => {
    const currentInput = [
      "C P1 100.0000 200.0000 10.0000 'Existing control",
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
          sourceLine: 7,
        },
      ],
      observations: [
        {
          kind: 'distance',
          fromId: 'P1',
          toId: 'P2',
          distanceM: 15,
          sourceLine: 8,
        },
      ],
      trace: [],
    };

    const reviewModel: ImportReviewModel = {
      groups: [
        {
          key: 'control',
          kind: 'control',
          label: 'Control',
          defaultComment: 'CONTROL',
          itemIds: ['control:0'],
        },
        {
          key: 'setup:P1',
          kind: 'setup',
          label: 'Setup P1',
          defaultComment: 'SETUP P1',
          setupId: 'P1',
          itemIds: ['observation:0'],
        },
      ],
      items: [
        {
          id: 'control:0',
          kind: 'control',
          index: 0,
          groupKey: 'control',
          sourceType: 'Control Point',
          stationId: 'P1',
        },
        {
          id: 'observation:0',
          kind: 'observation',
          index: 0,
          groupKey: 'setup:P1',
          sourceType: 'Distance',
          sourceObservationKind: 'distance',
          setupId: 'P1',
          targetId: 'P2',
        },
      ],
      warnings: [],
      errors: [],
    };

    const conflicts = buildImportConflictSummary({
      currentInput,
      currentIncludeFiles: {},
      parseSettings,
      projectInstruments: {},
      importedDataset,
    });
    const defaults = buildImportConflictResolutionDefaults(conflicts);

    const keepExisting = buildResolvedImportText({
      currentInput,
      currentIncludeFiles: {},
      parseSettings,
      projectInstruments: {},
      importedDataset,
      reviewModel,
      includedItemIds: new Set(['control:0', 'observation:0']),
      coordMode: '3D',
      force2D: false,
      conflicts,
      conflictResolutions: defaults,
      conflictRenameValues: {},
    });
    expect(keepExisting.text).toContain("C P1 100.0000 200.0000 10.0000 'Existing control");
    expect(keepExisting.text).not.toContain('C P1 101.0000 201.0000 11.0000');
    expect(keepExisting.text).not.toContain('D P1 P2 15.0000');

    const replaceIncoming = buildResolvedImportText({
      currentInput,
      currentIncludeFiles: {},
      parseSettings,
      projectInstruments: {},
      importedDataset,
      reviewModel,
      includedItemIds: new Set(['control:0', 'observation:0']),
      coordMode: '3D',
      force2D: false,
      conflicts,
      conflictResolutions: {
        ...defaults,
        'control:0': 'replace-with-incoming',
        'observation:0': 'replace-with-incoming',
      },
      conflictRenameValues: {},
    });
    expect(replaceIncoming.text).toContain('C P1 101.0000 201.0000 11.0000');
    expect(replaceIncoming.text).toContain('D P1 P2 15.0000');
    expect(replaceIncoming.text).not.toContain("C P1 100.0000 200.0000 10.0000 'Existing control");
    expect(replaceIncoming.text).not.toContain('D P1 P2 12.3456');

    const renameIncoming = buildResolvedImportText({
      currentInput,
      currentIncludeFiles: {},
      parseSettings,
      projectInstruments: {},
      importedDataset,
      reviewModel,
      includedItemIds: new Set(['control:0', 'observation:0']),
      coordMode: '3D',
      force2D: false,
      conflicts,
      conflictResolutions: {
        ...defaults,
        'control:0': 'rename-incoming',
        'observation:0': 'keep-both',
      },
      conflictRenameValues: {
        'control:0': 'P1_IMPORT',
      },
    });
    expect(renameIncoming.missingRenameKeys).toEqual([]);
    expect(renameIncoming.text).toContain('C P1_IMPORT 101.0000 201.0000 11.0000');
    expect(renameIncoming.text).toContain('D P1_IMPORT P2 15.0000');

    const keepBoth = buildResolvedImportText({
      currentInput,
      currentIncludeFiles: {},
      parseSettings,
      projectInstruments: {},
      importedDataset,
      reviewModel,
      includedItemIds: new Set(['control:0', 'observation:0']),
      coordMode: '3D',
      force2D: false,
      conflicts,
      conflictResolutions: {
        ...defaults,
        'control:0': 'keep-both',
        'observation:0': 'keep-both',
      },
      conflictRenameValues: {},
    });
    expect(keepBoth.text).toContain('# KEEP BOTH: imported station id already exists in editor for P1');
    expect(keepBoth.text).toContain('# KEEP BOTH: imported observation family already exists in editor for the same endpoints for P1 -> P2');
  });
});
