import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
  buildAdjustedPointsExportText,
  parseAdjustedPointsTransformAngleDegrees,
  sanitizeAdjustedPointsExportSettings,
  validateAdjustedPointsTransform,
  validateAdjustedPointsRotationTransform,
} from '../../src/engine/adjustedPointsExport';
import { buildResult } from './adjustedPointsExportTestSupport';

describe('adjusted points export transforms', () => {
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
