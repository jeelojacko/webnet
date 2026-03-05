import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
  sanitizeAdjustedPointsExportSettings,
} from '../src/engine/adjustedPointsExport';
import { parseProjectFile, serializeProjectFile } from '../src/engine/projectFile';
import type { InstrumentLibrary } from '../src/types';

const defaults = {
  settings: {
    maxIterations: 10,
    units: 'm',
    listingShowLostStations: true,
  },
  parseSettings: {
    solveProfile: 'industry-parity',
    coordMode: '3D',
    order: 'EN',
    angleUnits: 'dms',
  },
  exportFormat: 'webnet' as const,
  adjustedPointsExport: DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
  projectInstruments: {
    S9: {
      code: 'S9',
      desc: 'Trimble S9',
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
  levelLoopCustomPresets: [
    { id: 'c1', name: 'Custom 1', baseMm: 2, perSqrtKmMm: 5 },
  ],
};

describe('project file serialization/parsing', () => {
  it('round-trips project payload for input/settings/instruments/export config', () => {
    const text = serializeProjectFile({
      input: '.2D\nC A 0 0 0 ! !',
      ui: {
        settings: {
          maxIterations: 15,
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
    expect(parsed.project.input).toContain('C A');
    expect(parsed.project.ui.exportFormat).toBe('industry-style');
    expect(parsed.project.ui.adjustedPointsExport.columns).toEqual(['P', 'E', 'N', 'Z']);
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
    expect(parsed.project.ui.settings.maxIterations).toBe(defaults.settings.maxIterations);
    expect(parsed.project.ui.adjustedPointsExport.columns.length).toBe(6);
    expect(parsed.project.project.selectedInstrument).toBe('S9');
  });
});

