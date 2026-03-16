import { describe, expect, it } from 'vitest';

import {
  ADJUSTED_POINTS_PRESET_COLUMNS,
  DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
  buildAdjustedPointsExportText,
  inferAdjustedPointsPresetId,
  parseAdjustedPointsTransformAngleDegrees,
  sanitizeAdjustedPointsExportSettings,
  validateAdjustedPointsTransform,
  validateAdjustedPointsRotationTransform,
} from '../src/engine/adjustedPointsExport';
import type { AdjustedPointsExportSettings, AdjustmentResult } from '../src/types';

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
    const base: AdjustedPointsExportSettings = {
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

  it('keeps legacy output when all transforms are disabled', () => {
    const text = buildAdjustedPointsExportText({
      result: buildResult(),
      units: 'm',
      settings: DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
    });
    expect(text).not.toContain('# TRANSFORM NOTES');
    expect(text).not.toContain('# TRANSFORMED COORDINATES');
  });

  it('parses transform angles from decimal or dms strings', () => {
    expect(parseAdjustedPointsTransformAngleDegrees('273-22-56.3')).toBeCloseTo(273.3823055556, 8);
    expect(parseAdjustedPointsTransformAngleDegrees('90.5')).toBeCloseTo(90.5, 10);
  });

  it('rotates all points counterclockwise with positive angle and keeps reference unchanged', () => {
    const text = buildAdjustedPointsExportText({
      result: buildResult(),
      units: 'm',
      settings: sanitizeAdjustedPointsExportSettings({
        ...DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
        columns: ['P', 'E', 'N'],
        transform: {
          referenceStationId: 'CTRL',
          scope: 'all',
          selectedStationIds: [],
          rotation: {
            enabled: true,
            angleDeg: 90,
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
    });
    expect(text).toContain('# TRANSFORM NOTES');
    expect(text).toContain('# Rotation: positive angle convention is counterclockwise about reference');
    expect(text).toContain('# Scope: ALL');
    const rotatedHeaderIndex = text
      .split('\n')
      .findIndex((line) => line === '# TRANSFORMED COORDINATES');
    expect(rotatedHeaderIndex).toBeGreaterThan(0);
    const rotatedRows = text.split('\n').slice(rotatedHeaderIndex + 2);
    const ctrl = rotatedRows.find((row) => row.startsWith('CTRL,'));
    const p1 = rotatedRows.find((row) => row.startsWith('P1,'));
    expect(ctrl).toBe('CTRL,1000.0000,2000.0000');
    expect(p1).toBe('P1,997.6544,2001.2345');
  });

  it('selected scope transforms selected points plus reference and keeps unscoped points unchanged', () => {
    const text = buildAdjustedPointsExportText({
      result: buildResult(),
      units: 'm',
      settings: sanitizeAdjustedPointsExportSettings({
        ...DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
        columns: ['P', 'E', 'N'],
        transform: {
          referenceStationId: 'CTRL',
          scope: 'selected',
          selectedStationIds: ['P1'],
          rotation: {
            enabled: true,
            angleDeg: 15,
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
    });
    const rotatedHeaderIndex = text
      .split('\n')
      .findIndex((line) => line === '# TRANSFORMED COORDINATES');
    const rotatedRows = text.split('\n').slice(rotatedHeaderIndex + 2);
    expect(rotatedRows.some((row) => row.startsWith('CTRL,'))).toBe(true);
    expect(rotatedRows.some((row) => row.startsWith('P1,'))).toBe(true);
    expect(rotatedRows.some((row) => row.startsWith('LOST1,999.5000,1999.5000'))).toBe(true);
  });

  it('applies direction-distance translation using surveying azimuth convention', () => {
    const text = buildAdjustedPointsExportText({
      result: buildResult(),
      units: 'm',
      settings: sanitizeAdjustedPointsExportSettings({
        ...DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
        columns: ['P', 'E', 'N'],
        transform: {
          referenceStationId: 'CTRL',
          scope: 'all',
          selectedStationIds: [],
          rotation: { enabled: false, angleDeg: 0 },
          translation: {
            enabled: true,
            method: 'direction-distance',
            azimuthDeg: 90,
            distance: 10,
            targetE: 0,
            targetN: 0,
          },
          scale: { enabled: false, factor: 1 },
        },
      }),
    });
    const transformedHeaderIndex = text
      .split('\n')
      .findIndex((line) => line === '# TRANSFORMED COORDINATES');
    const transformedRows = text.split('\n').slice(transformedHeaderIndex + 2);
    expect(transformedRows.find((row) => row.startsWith('CTRL,'))).toBe('CTRL,1010.0000,2000.0000');
    expect(transformedRows.find((row) => row.startsWith('P1,'))).toBe('P1,1011.2345,2002.3456');
  });

  it('applies anchor-coordinate translation by shifting reference to target E/N', () => {
    const text = buildAdjustedPointsExportText({
      result: buildResult(),
      units: 'm',
      settings: sanitizeAdjustedPointsExportSettings({
        ...DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
        columns: ['P', 'E', 'N'],
        transform: {
          referenceStationId: 'CTRL',
          scope: 'all',
          selectedStationIds: [],
          rotation: { enabled: false, angleDeg: 0 },
          translation: {
            enabled: true,
            method: 'anchor-coordinate',
            azimuthDeg: 0,
            distance: 0,
            targetE: 1100,
            targetN: 2100,
          },
          scale: { enabled: false, factor: 1 },
        },
      }),
    });
    const transformedHeaderIndex = text
      .split('\n')
      .findIndex((line) => line === '# TRANSFORMED COORDINATES');
    const transformedRows = text.split('\n').slice(transformedHeaderIndex + 2);
    expect(transformedRows.find((row) => row.startsWith('CTRL,'))).toBe('CTRL,1100.0000,2100.0000');
    expect(transformedRows.find((row) => row.startsWith('P1,'))).toBe('P1,1101.2345,2102.3456');
  });

  it('scales coordinates about the shared reference point', () => {
    const text = buildAdjustedPointsExportText({
      result: buildResult(),
      units: 'm',
      settings: sanitizeAdjustedPointsExportSettings({
        ...DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
        columns: ['P', 'E', 'N'],
        transform: {
          referenceStationId: 'CTRL',
          scope: 'all',
          selectedStationIds: [],
          rotation: { enabled: false, angleDeg: 0 },
          translation: {
            enabled: false,
            method: 'direction-distance',
            azimuthDeg: 0,
            distance: 0,
            targetE: 0,
            targetN: 0,
          },
          scale: { enabled: true, factor: 2 },
        },
      }),
    });
    const transformedHeaderIndex = text
      .split('\n')
      .findIndex((line) => line === '# TRANSFORMED COORDINATES');
    const transformedRows = text.split('\n').slice(transformedHeaderIndex + 2);
    expect(transformedRows.find((row) => row.startsWith('CTRL,'))).toBe('CTRL,1000.0000,2000.0000');
    expect(transformedRows.find((row) => row.startsWith('P1,'))).toBe('P1,1002.4690,2004.6912');
  });

  it('keeps transform chain order as scale then rotate then translate', () => {
    const text = buildAdjustedPointsExportText({
      result: buildResult(),
      units: 'm',
      settings: sanitizeAdjustedPointsExportSettings({
        ...DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
        columns: ['P', 'E', 'N'],
        transform: {
          referenceStationId: 'CTRL',
          scope: 'all',
          selectedStationIds: [],
          rotation: { enabled: true, angleDeg: 90 },
          translation: {
            enabled: true,
            method: 'direction-distance',
            azimuthDeg: 90,
            distance: 10,
            targetE: 0,
            targetN: 0,
          },
          scale: { enabled: true, factor: 2 },
        },
      }),
    });
    const transformedHeaderIndex = text
      .split('\n')
      .findIndex((line) => line === '# TRANSFORMED COORDINATES');
    const transformedRows = text.split('\n').slice(transformedHeaderIndex + 2);
    expect(transformedRows.find((row) => row.startsWith('P1,'))).toBe('P1,1005.3088,2002.4690');
  });

  it('validates missing pivot when rotation is enabled', () => {
    const validation = validateAdjustedPointsRotationTransform({
      result: buildResult(),
      settings: sanitizeAdjustedPointsExportSettings({
        ...DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
        transform: {
          referenceStationId: '',
          scope: 'all',
          selectedStationIds: [],
          rotation: {
            enabled: true,
            angleDeg: 10,
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
    });
    expect(validation.valid).toBe(false);
    if (validation.valid) return;
    expect(validation.message).toContain('pivot');
  });

  it('validates scale factor > 0 in the combined transform validator', () => {
    const validation = validateAdjustedPointsTransform({
      result: buildResult(),
      settings: sanitizeAdjustedPointsExportSettings({
        ...DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
        transform: {
          referenceStationId: 'CTRL',
          scope: 'all',
          selectedStationIds: [],
          rotation: { enabled: false, angleDeg: 0 },
          translation: {
            enabled: false,
            method: 'direction-distance',
            azimuthDeg: 0,
            distance: 0,
            targetE: 0,
            targetN: 0,
          },
          scale: { enabled: true, factor: 0 },
        },
      }),
    });
    expect(validation.valid).toBe(false);
    if (validation.valid) return;
    expect(validation.message).toContain('Scale factor');
  });
});
