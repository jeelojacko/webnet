import { describe, expect, it } from 'vitest';

import {
  defaults,
  parseProjectFile,
  savedRunResult,
} from './projectFileTestSupport';

describe('project file schema defaults and migrations', () => {
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
    expect(parsed.project.schemaVersion).toBe(5);
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
    expect(parsed.project.schemaVersion).toBe(5);
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
    expect(parsed.project.schemaVersion).toBe(5);
    expect(parsed.project.input).toContain('.INCLUDE field/set1.dat');
    expect(parsed.project.includeFiles['field/set1.dat']).toContain('C A 0 0 0 ! !');
    expect(parsed.project.savedRuns).toEqual([]);
  });
});
