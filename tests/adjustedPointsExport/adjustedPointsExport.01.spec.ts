import { describe, expect, it } from 'vitest';

import {
  ADJUSTED_POINTS_PRESET_COLUMNS,
  DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
  buildAdjustedPointsExportText,
  inferAdjustedPointsPresetId,
  sanitizeAdjustedPointsExportSettings,
} from '../../src/engine/adjustedPointsExport';
import type { AdjustedPointsExportSettings } from '../../src/types';
import { buildResult } from './adjustedPointsExportTestSupport';

describe('adjusted points export formatting', () => {
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
});
