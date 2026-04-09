import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
  sanitizeAdjustedPointsExportSettings,
} from '../src/engine/adjustedPointsExport';
import { parseProjectFile, serializeProjectFile } from '../src/engine/projectFile';
import type { RunSettingsSnapshot } from '../src/appStateTypes';
import type { AdjustmentResult, InstrumentLibrary } from '../src/types';

const savedRunResult = {
  success: true,
  converged: true,
  iterations: 2,
  seuw: 1.05,
  dof: 8,
  stations: {
    A: { x: 0, y: 0, h: 0, fixed: true },
  },
  observations: [],
  logs: [],
} as unknown as AdjustmentResult;

const defaults = {
  settings: {
    maxIterations: 10,
    convergenceLimit: 0.01,
    precisionReportingMode: 'industry-standard',
    units: 'm',
    listingShowLostStations: true,
  },
  parseSettings: {
    solveProfile: 'industry-parity',
    coordMode: '3D',
    order: 'EN',
    angleUnits: 'dms',
    parseCompatibilityMode: 'strict',
    parseModeMigrated: true,
  },
  exportFormat: 'webnet' as const,
  adjustedPointsExport: DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
  projectInstruments: {
    S9: {
      code: 'S9',
      desc: 'industry standard S9',
      edm_const: 0.001,
      edm_ppm: 1,
      hzPrecision_sec: 0.5,
      dirPrecision_sec: 0.5,
      azBearingPrecision_sec: 0.5,
      vaPrecision_sec: 0.5,
      instCentr_m: 0.0007,
      tgtCentr_m: 0,
      vertCentr_m: 0,
      elevDiff_const_m: 0,
      elevDiff_ppm: 0,
      gpsStd_xy: 0,
      levStd_mmPerKm: 0,
    },
  } as InstrumentLibrary,
  selectedInstrument: 'S9',
  levelLoopCustomPresets: [{ id: 'c1', name: 'Custom 1', baseMm: 2, perSqrtKmMm: 5 }],
};

describe('project file serialization/parsing', () => {
  it('round-trips project payload for input/settings/instruments/export config', () => {
    const text = serializeProjectFile({
      input: '.2D\nC A 0 0 0 ! !',
      includeFiles: {
        'sub/job1.dat': 'C X 1 1 0',
      },
      savedRuns: [
        {
          id: 'saved-run-1',
          sourceRunId: 'run-2',
          createdAt: '2026-03-20T10:00:00.000Z',
          savedAt: '2026-03-20T10:05:00.000Z',
          label: 'Saved Run 02',
          notes: 'checkpoint',
          inputFingerprint: 'fnv1a:input',
          settingsFingerprint: 'fnv1a:settings',
          summary: {
            converged: true,
            iterations: 2,
            seuw: 1.05,
            dof: 8,
            stationCount: 1,
            observationCount: 0,
            suspectObservationCount: 0,
            maxAbsStdRes: 0,
          },
          result: savedRunResult,
          runDiagnostics: null,
          settingsSnapshot: {
            maxIterations: 15,
            convergenceLimit: 0.1,
            precisionReportingMode: 'posterior-scaled',
          } as unknown as RunSettingsSnapshot,
          excludedIds: [4],
          overrideIds: [9],
          overrides: {
            9: { stdDev: 0.25 },
          },
          approvedClusterMerges: [{ aliasId: 'P1', canonicalId: 'A' }],
          reopenState: {
            activeTab: 'map',
            review: {
              reportView: {
                ellipseMode: '95',
                reportFilterQuery: 'p1',
                reportObservationTypeFilter: 'dist',
                reportExclusionFilter: 'included',
                tableRowLimits: { observations: 25 },
                pinnedDetailSections: [{ id: 'angles-ts', label: 'Angles (TS)' }],
                collapsedDetailSections: { 'angles-ts': true },
              },
              selection: {
                stationId: 'P1',
                observationId: 9,
                sourceLine: 12,
                origin: 'compare',
              },
              pinnedObservationIds: [9],
            },
            comparisonSelection: {
              baselineRunId: 'saved-run-0',
              pinnedBaselineRunId: null,
              stationMovementThreshold: 0.01,
              residualDeltaThreshold: 0.5,
            },
          },
        },
      ],
      ui: {
        settings: {
          maxIterations: 15,
          convergenceLimit: 0.1,
          precisionReportingMode: 'posterior-scaled',
          units: 'ft',
          listingShowLostStations: false,
        },
        parseSettings: {
          solveProfile: 'webnet',
          coordMode: '2D',
          order: 'NE',
          angleUnits: 'dd',
        },
        exportFormat: 'industry-style',
        adjustedPointsExport: sanitizeAdjustedPointsExportSettings({
          format: 'text',
          delimiter: 'tab',
          columns: ['P', 'E', 'N', 'Z'],
          includeLostStations: false,
          transform: {
            referenceStationId: 'A1',
            scope: 'selected',
            selectedStationIds: ['A2', 'A3'],
            rotation: {
              enabled: true,
              angleDeg: 12.5,
            },
            translation: {
              enabled: false,
              method: 'direction-distance',
              azimuthDeg: 0,
              distance: 0,
              targetE: 0,
              targetN: 0,
            },
            scale: { enabled: false, factor: 1 },
          },
        }),
      },
      project: {
        projectInstruments: defaults.projectInstruments,
        selectedInstrument: 'S9',
        levelLoopCustomPresets: defaults.levelLoopCustomPresets,
      },
    });

    const parsed = parseProjectFile(text, defaults);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.project.schemaVersion).toBe(3);
    expect(parsed.project.input).toContain('C A');
    expect(parsed.project.includeFiles['sub/job1.dat']).toContain('C X');
    expect(parsed.project.savedRuns).toHaveLength(1);
    expect(parsed.project.savedRuns[0]?.label).toBe('Saved Run 02');
    expect(parsed.project.savedRuns[0]?.notes).toBe('checkpoint');
    expect(parsed.project.savedRuns[0]?.overrides).toEqual({ 9: { stdDev: 0.25 } });
    expect(parsed.project.savedRuns[0]?.approvedClusterMerges).toEqual([
      { aliasId: 'P1', canonicalId: 'A' },
    ]);
    expect(parsed.project.savedRuns[0]?.reopenState?.activeTab).toBe('map');
    expect(parsed.project.savedRuns[0]?.reopenState?.review.selection.stationId).toBe('P1');
    expect(parsed.project.savedRuns[0]?.settingsSnapshot.precisionReportingMode).toBe(
      'industry-standard',
    );
    expect(parsed.project.ui.exportFormat).toBe('industry-style');
    expect(parsed.project.ui.settings.convergenceLimit).toBe(0.1);
    expect(parsed.project.ui.settings.precisionReportingMode).toBe('industry-standard');
    expect(parsed.project.ui.adjustedPointsExport.columns).toEqual(['P', 'E', 'N', 'Z']);
    expect(parsed.project.ui.adjustedPointsExport.transform.referenceStationId).toBe('A1');
    expect(parsed.project.ui.adjustedPointsExport.transform.scope).toBe('selected');
    expect(parsed.project.ui.adjustedPointsExport.transform.selectedStationIds).toEqual([
      'A2',
      'A3',
    ]);
    expect(parsed.project.ui.adjustedPointsExport.transform.rotation.enabled).toBe(true);
    expect(parsed.project.ui.adjustedPointsExport.transform.rotation.angleDeg).toBe(12.5);
    expect(parsed.project.project.selectedInstrument).toBe('S9');
    expect(parsed.project.project.levelLoopCustomPresets).toHaveLength(1);
  });

  it('rejects unknown project kind/schema versions', () => {
    const parsed = parseProjectFile(
      JSON.stringify({
        kind: 'not-webnet',
        schemaVersion: 99,
        input: '',
      }),
      defaults,
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors.some((line) => line.includes('kind'))).toBe(true);
    expect(parsed.errors.some((line) => line.includes('schemaVersion'))).toBe(true);
  });

  it('sanitizes partial payloads with defaults when fields are missing or malformed', () => {
    const parsed = parseProjectFile(
      JSON.stringify({
        kind: 'webnet-project',
        schemaVersion: 1,
        input: '.3D',
        ui: {
          settings: {
            maxIterations: 'bad',
            convergenceLimit: 'bad',
            units: 'm',
          },
          parseSettings: {
            solveProfile: 'industry-parity',
          },
          adjustedPointsExport: {
            columns: ['P', 'N', 'E', 'Z', 'D', 'LAT', 'LON'],
          },
        },
        project: {
          projectInstruments: {},
          selectedInstrument: 'missing',
        },
      }),
      defaults,
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.project.schemaVersion).toBe(1);
    expect(parsed.project.includeFiles).toEqual({});
    expect(parsed.project.savedRuns).toEqual([]);
    expect(parsed.project.ui.settings.maxIterations).toBe(defaults.settings.maxIterations);
    expect(parsed.project.ui.settings.convergenceLimit).toBe(defaults.settings.convergenceLimit);
    expect(parsed.project.ui.parseSettings.parseCompatibilityMode).toBe('strict');
    expect(parsed.project.ui.parseSettings.parseModeMigrated).toBe(true);
    expect(parsed.project.ui.adjustedPointsExport.columns.length).toBe(6);
    expect(parsed.project.ui.adjustedPointsExport.transform.rotation.enabled).toBe(false);
    expect(parsed.project.ui.adjustedPointsExport.transform.scope).toBe('all');
    expect(parsed.project.ui.adjustedPointsExport.transform.referenceStationId).toBe('');
    expect(parsed.project.project.selectedInstrument).toBe('S9');
  });

  it('honors schema v2 parser migration metadata and strict mode', () => {
    const parsed = parseProjectFile(
      JSON.stringify({
        kind: 'webnet-project',
        schemaVersion: 2,
        input: '.3D',
        ui: {
          settings: {
            maxIterations: 7,
          },
          parseSettings: {
            solveProfile: 'industry-parity',
            parseCompatibilityMode: 'strict',
            parseModeMigrated: true,
          },
          migration: {
            parseModeMigrated: true,
            migratedAt: '2026-03-09T12:00:00.000Z',
          },
        },
        project: {
          projectInstruments: defaults.projectInstruments,
          selectedInstrument: 'S9',
          levelLoopCustomPresets: [],
        },
      }),
      defaults,
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.project.schemaVersion).toBe(2);
    expect(parsed.project.includeFiles).toEqual({});
    expect(parsed.project.savedRuns).toEqual([]);
    expect(parsed.project.ui.parseSettings.parseCompatibilityMode).toBe('strict');
    expect(parsed.project.ui.parseSettings.parseModeMigrated).toBe(true);
    expect(parsed.project.ui.migration?.parseModeMigrated).toBe(true);
    expect(parsed.project.ui.migration?.migratedAt).toBe('2026-03-09T12:00:00.000Z');
  });

  it('migrates legacy rotation pivot/scope/selection fields into shared transform fields', () => {
    const parsed = parseProjectFile(
      JSON.stringify({
        kind: 'webnet-project',
        schemaVersion: 3,
        mainInput: '.2D',
        includeFiles: {},
        savedRuns: [
          {
            id: 'saved-run-2',
            label: 'Legacy Saved',
            result: savedRunResult,
            settingsSnapshot: { maxIterations: 7 },
          },
        ],
        ui: {
          settings: {},
          parseSettings: {},
          adjustedPointsExport: {
            transform: {
              rotation: {
                enabled: true,
                angleDeg: 20,
                pivotStationId: 'LEGACY_PIVOT',
                scope: 'selected',
                selectedStationIds: ['A', 'B'],
              },
            },
          },
        },
        project: {
          projectInstruments: defaults.projectInstruments,
          selectedInstrument: 'S9',
          levelLoopCustomPresets: [],
        },
      }),
      defaults,
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.project.ui.adjustedPointsExport.transform.referenceStationId).toBe('LEGACY_PIVOT');
    expect(parsed.project.ui.adjustedPointsExport.transform.scope).toBe('selected');
    expect(parsed.project.ui.adjustedPointsExport.transform.selectedStationIds).toEqual(['A', 'B']);
    expect(parsed.project.ui.adjustedPointsExport.transform.rotation.enabled).toBe(true);
    expect(parsed.project.ui.adjustedPointsExport.transform.rotation.angleDeg).toBe(20);
    expect(parsed.project.savedRuns[0]?.settingsFingerprint).toContain('fnv1a:');
    expect(parsed.project.savedRuns[0]?.summary.stationCount).toBe(1);
  });

  it('loads schema v3 include bundles using mainInput/includeFiles fields', () => {
    const parsed = parseProjectFile(
      JSON.stringify({
        kind: 'webnet-project',
        schemaVersion: 3,
        mainInput: '.INCLUDE field/set1.dat',
        includeFiles: {
          'field/set1.dat': 'C A 0 0 0 ! !',
        },
        savedRuns: [],
        ui: {
          settings: {
            maxIterations: 7,
          },
          parseSettings: {
            solveProfile: 'industry-parity',
            parseCompatibilityMode: 'strict',
            parseModeMigrated: true,
          },
          migration: {
            parseModeMigrated: true,
          },
        },
        project: {
          projectInstruments: defaults.projectInstruments,
          selectedInstrument: 'S9',
          levelLoopCustomPresets: [],
        },
      }),
      defaults,
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.project.schemaVersion).toBe(3);
    expect(parsed.project.input).toContain('.INCLUDE field/set1.dat');
    expect(parsed.project.includeFiles['field/set1.dat']).toContain('C A 0 0 0 ! !');
    expect(parsed.project.savedRuns).toEqual([]);
  });

  it('round-trips newly added export selector values through project files', () => {
    const text = serializeProjectFile({
      input: '.2D',
      includeFiles: {},
      savedRuns: [],
      ui: {
        settings: defaults.settings,
        parseSettings: defaults.parseSettings,
        exportFormat: 'geojson',
        adjustedPointsExport: DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
      },
      project: {
        projectInstruments: defaults.projectInstruments,
        selectedInstrument: 'S9',
        levelLoopCustomPresets: defaults.levelLoopCustomPresets,
      },
    });

    const parsed = parseProjectFile(text, defaults);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.project.ui.exportFormat).toBe('geojson');
  });
});
