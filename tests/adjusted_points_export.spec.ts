import { describe, expect, it } from 'vitest';

import {
  ADJUSTED_POINTS_PRESET_COLUMNS,
  DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
  buildAdjustedPointsExportText,
  inferAdjustedPointsPresetId,
  sanitizeAdjustedPointsExportSettings,
} from '../src/engine/adjustedPointsExport';
import type { AdjustmentResult } from '../src/types';

const buildResult = (): AdjustmentResult =>
  ({
    success: true,
    converged: true,
    iterations: 3,
    stations: {
      CTRL: {
        x: 1000,
        y: 2000,
        h: 10,
        fixed: true,
      },
      P1: {
        x: 1001.2345,
        y: 2002.3456,
        h: 11.5,
        fixed: false,
        latDeg: 45.123456789,
        lonDeg: -63.987654321,
      },
      LOST1: {
        x: 999.5,
        y: 1999.5,
        h: 9.5,
        fixed: false,
        lost: true,
      },
    },
    observations: [],
    logs: [],
    seuw: 1,
    dof: 1,
    parseState: {
      units: 'm',
      coordMode: '3D',
      order: 'EN',
      angleUnits: 'dms',
      angleStationOrder: 'atfromto',
      deltaMode: 'slope',
      mapMode: 'off',
      normalize: true,
      lonSign: 'west-negative',
      currentInstrument: '',
      edmMode: 'additive',
      applyCentering: true,
      addCenteringToExplicit: false,
      debug: false,
      angleMode: 'auto',
      verticalReduction: 'none',
      tsCorrelationEnabled: false,
      tsCorrelationScope: 'set',
      tsCorrelationRho: 0.25,
      robustMode: 'none',
      robustK: 1.5,
      autoAdjustEnabled: false,
      autoAdjustMaxCycles: 3,
      autoAdjustMaxRemovalsPerCycle: 1,
      autoAdjustStdResThreshold: 4,
      autoSideshotEnabled: true,
      qFixLinearSigmaM: 1e-9,
      qFixAngularSigmaSec: 1e-9,
      descriptionReconcileMode: 'first',
      descriptionAppendDelimiter: ' | ',
      crsTransformEnabled: false,
      crsProjectionModel: 'legacy-equirectangular',
      crsLabel: '',
      crsGridScaleEnabled: false,
      crsGridScaleFactor: 1,
      crsConvergenceEnabled: false,
      crsConvergenceAngleRad: 0,
      geoidModelEnabled: false,
      geoidModelId: 'NGS-DEMO',
      geoidInterpolation: 'bilinear',
      geoidHeightConversionEnabled: false,
      geoidOutputHeightDatum: 'orthometric',
      gpsVectorMode: 'network',
      gpsAddHiHtEnabled: false,
      gpsAddHiHtHiM: 0,
      gpsAddHiHtHtM: 0,
      gpsLoopCheckEnabled: false,
      mapScaleFactor: 1,
      levelLoopToleranceBaseMm: 0,
      levelLoopTolerancePerSqrtKmMm: 4,
      reconciledDescriptions: {
        P1: 'Main point, near stairs',
      },
    },
  }) as AdjustmentResult;

describe('adjusted points export', () => {
  it('uses preset headers and preserves ordered preset columns', () => {
    const text = buildAdjustedPointsExportText({
      result: buildResult(),
      units: 'm',
      settings: {
        ...DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
        presetId: 'PENZ',
        columns: ADJUSTED_POINTS_PRESET_COLUMNS.PENZ,
      },
    });
    expect(text.split('\n')[0]).toBe('P,E,N,Z');
  });

  it('keeps custom column order and detects custom preset id', () => {
    const settings = sanitizeAdjustedPointsExportSettings({
      ...DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
      columns: ['P', 'LAT', 'LON', 'E'],
    });
    expect(settings.columns).toEqual(['P', 'LAT', 'LON', 'E']);
    expect(inferAdjustedPointsPresetId(settings.columns)).toBe('custom');
  });

  it('supports comma, space, and tab delimiters with quoting for descriptions', () => {
    const base = {
      ...DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
      columns: ['P', 'D'],
    };
    const csv = buildAdjustedPointsExportText({
      result: buildResult(),
      units: 'm',
      settings: { ...base, delimiter: 'comma', format: 'csv' },
    });
    expect(csv).toContain('"Main point, near stairs"');

    const spaced = buildAdjustedPointsExportText({
      result: buildResult(),
      units: 'm',
      settings: { ...base, delimiter: 'space', format: 'text' },
    });
    expect(spaced.split('\n')[0]).toBe('P D');

    const tabbed = buildAdjustedPointsExportText({
      result: buildResult(),
      units: 'm',
      settings: { ...base, delimiter: 'tab', format: 'text' },
    });
    expect(tabbed.split('\n')[0]).toBe('P\tD');
  });

  it('leaves LAT/LON blank when unavailable, maps Z and EL to the same value, and can exclude lost stations', () => {
    const text = buildAdjustedPointsExportText({
      result: buildResult(),
      units: 'm',
      settings: {
        ...DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
        includeLostStations: false,
        columns: ['P', 'LAT', 'LON', 'Z', 'EL'],
      },
    });
    const rows = text.split('\n');
    expect(rows.some((row) => row.startsWith('LOST1,'))).toBe(false);
    const ctrl = rows.find((row) => row.startsWith('CTRL,'));
    expect(ctrl).toBeDefined();
    expect(ctrl?.split(',').slice(1, 3)).toEqual(['', '']);
    const p1 = rows.find((row) => row.startsWith('P1,'));
    expect(p1).toBeDefined();
    const parts = p1?.split(',') ?? [];
    expect(parts[3]).toBe(parts[4]);
  });

  it('enforces max six selected columns in sanitized settings', () => {
    const settings = sanitizeAdjustedPointsExportSettings({
      columns: ['P', 'N', 'E', 'Z', 'D', 'LAT', 'LON', 'EL'],
    });
    expect(settings.columns).toHaveLength(6);
  });
});

