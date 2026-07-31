import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
  defaults,
  parseProjectFile,
  serializeProjectFile,
} from './projectFileTestSupport';

describe('project file settings and CRS migrations', () => {
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

  it('round-trips coordinate-system parse settings and browser geoid source state', () => {
    const text = serializeProjectFile({
      input: '.2D',
      includeFiles: {},
      savedRuns: [],
      ui: {
        settings: defaults.settings,
        parseSettings: {
          ...defaults.parseSettings,
          coordSystemMode: 'grid',
          crsId: 'CA_NAD83_CSRS_UTM_20N',
          localDatumScheme: 'average-elevation',
          averageScaleFactor: 0.99991234,
          commonElevation: 125.5,
          averageGeoidHeight: -31.25,
          gridBearingMode: 'grid',
          gridDistanceMode: 'ellipsoidal',
          gridAngleMode: 'grid',
          gridDirectionMode: 'grid',
          geoidModelEnabled: true,
          geoidModelId: 'CGVD2013A',
          geoidSourceFormat: 'gtx',
          geoidSourcePath: 'geoids/cgvd2013a.gtx',
          geoidInterpolation: 'nearest',
          geoidHeightConversionEnabled: true,
          geoidOutputHeightDatum: 'ellipsoid',
        },
        exportFormat: 'webnet',
        adjustedPointsExport: DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
        geoidSourceDataBase64: 'AQIDBA==',
        geoidSourceDataLabel: 'cgvd2013a.gtx',
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
    expect(parsed.project.ui.parseSettings.coordSystemMode).toBe('grid');
    expect(parsed.project.ui.parseSettings.crsId).toBe('CA_NAD83_CSRS_UTM_20N');
    expect(parsed.project.ui.parseSettings.localDatumScheme).toBe('average-elevation');
    expect(parsed.project.ui.parseSettings.averageScaleFactor).toBe(0.99991234);
    expect(parsed.project.ui.parseSettings.commonElevation).toBe(125.5);
    expect(parsed.project.ui.parseSettings.averageGeoidHeight).toBe(-31.25);
    expect(parsed.project.ui.parseSettings.gridBearingMode).toBe('grid');
    expect(parsed.project.ui.parseSettings.gridDistanceMode).toBe('ellipsoidal');
    expect(parsed.project.ui.parseSettings.gridAngleMode).toBe('grid');
    expect(parsed.project.ui.parseSettings.gridDirectionMode).toBe('grid');
    expect(parsed.project.ui.parseSettings.geoidModelEnabled).toBe(true);
    expect(parsed.project.ui.parseSettings.geoidModelId).toBe('CGVD2013A');
    expect(parsed.project.ui.parseSettings.geoidSourceFormat).toBe('gtx');
    expect(parsed.project.ui.parseSettings.geoidSourcePath).toBe('geoids/cgvd2013a.gtx');
    expect(parsed.project.ui.parseSettings.geoidInterpolation).toBe('nearest');
    expect(parsed.project.ui.parseSettings.geoidHeightConversionEnabled).toBe(true);
    expect(parsed.project.ui.parseSettings.geoidOutputHeightDatum).toBe('ellipsoid');
    expect(parsed.project.ui.geoidSourceDataBase64).toBe('AQIDBA==');
    expect(parsed.project.ui.geoidSourceDataLabel).toBe('cgvd2013a.gtx');
  });

  it('normalizes retired legacy CRS transform fields on save and load', () => {
    const text = serializeProjectFile({
      input: '.2D',
      includeFiles: {},
      savedRuns: [],
      ui: {
        settings: defaults.settings,
        parseSettings: {
          ...defaults.parseSettings,
          crsTransformEnabled: true,
          crsProjectionModel: 'local-enu',
          crsLabel: 'Legacy Grid',
        },
        exportFormat: 'webnet',
        adjustedPointsExport: DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
      },
      project: {
        projectInstruments: defaults.projectInstruments,
        selectedInstrument: 'S9',
        levelLoopCustomPresets: defaults.levelLoopCustomPresets,
      },
    });

    expect(text).toContain('"crsTransformEnabled": false');
    expect(text).toContain('"crsProjectionModel": "legacy-equirectangular"');
    expect(text).toContain('"crsLabel": ""');
    expect(text).not.toContain('"crsProjectionModel": "local-enu"');
    expect(text).not.toContain('"crsLabel": "Legacy Grid"');

    const parsed = parseProjectFile(text, defaults);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.project.ui.parseSettings.crsTransformEnabled).toBe(false);
    expect(parsed.project.ui.parseSettings.crsProjectionModel).toBe('legacy-equirectangular');
    expect(parsed.project.ui.parseSettings.crsLabel).toBe('');
  });

  it('maps legacy residual sort mode to stdResidual when migration flag is missing', () => {
    const parsed = parseProjectFile(
      JSON.stringify({
        kind: 'webnet-project',
        schemaVersion: 5,
        projectId: 'legacy-sort-1',
        name: 'Legacy Sort',
        createdAt: '2026-04-20T10:00:00.000Z',
        updatedAt: '2026-04-20T10:00:00.000Z',
        files: [
          {
            id: 'file-main',
            name: 'main.dat',
            kind: 'dat',
            path: 'data/file-main-main.dat',
            enabled: true,
            order: 0,
          },
        ],
        fileContents: {
          'file-main': '.2D',
        },
        ui: {
          settings: {
            ...defaults.settings,
            listingSortObservationsBy: 'residual',
          },
          parseSettings: defaults.parseSettings,
          exportFormat: 'industry-style',
          adjustedPointsExport: defaults.adjustedPointsExport,
          migration: {
            parseModeMigrated: true,
          },
        },
        project: {
          projectInstruments: defaults.projectInstruments,
          selectedInstrument: defaults.selectedInstrument,
          levelLoopCustomPresets: defaults.levelLoopCustomPresets,
        },
      }),
      defaults,
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.project.ui.settings.listingSortObservationsBy).toBe('stdResidual');
    expect(parsed.project.ui.migration?.listingSortModeVersion).toBe(1);
  });

  it('preserves raw residual sort mode when migration flag is v2', () => {
    const parsed = parseProjectFile(
      JSON.stringify({
        kind: 'webnet-project',
        schemaVersion: 5,
        projectId: 'new-sort-1',
        name: 'New Sort',
        createdAt: '2026-04-20T10:00:00.000Z',
        updatedAt: '2026-04-20T10:00:00.000Z',
        files: [
          {
            id: 'file-main',
            name: 'main.dat',
            kind: 'dat',
            path: 'data/file-main-main.dat',
            enabled: true,
            order: 0,
          },
        ],
        fileContents: {
          'file-main': '.2D',
        },
        ui: {
          settings: {
            ...defaults.settings,
            listingSortObservationsBy: 'residual',
          },
          parseSettings: defaults.parseSettings,
          exportFormat: 'industry-style',
          adjustedPointsExport: defaults.adjustedPointsExport,
          migration: {
            parseModeMigrated: true,
            listingSortModeVersion: 2,
          },
        },
        project: {
          projectInstruments: defaults.projectInstruments,
          selectedInstrument: defaults.selectedInstrument,
          levelLoopCustomPresets: defaults.levelLoopCustomPresets,
        },
      }),
      defaults,
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.project.ui.settings.listingSortObservationsBy).toBe('residual');
    expect(parsed.project.ui.migration?.listingSortModeVersion).toBe(2);
  });
});
