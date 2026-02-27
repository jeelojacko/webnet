import { describe, expect, it } from 'vitest';
import {
  geoidGridMetadataSummary,
  interpolateGeoidUndulation,
  loadBuiltinGeoidGridModel,
  parseGeoidInterpolationToken,
} from '../src/engine/geoid';

describe('geoid grid pipeline', () => {
  it('loads builtin models with cache behavior and metadata', () => {
    const first = loadBuiltinGeoidGridModel('NGS-DEMO');
    expect(first.model).toBeDefined();
    expect(first.fromCache).toBe(false);
    const second = loadBuiltinGeoidGridModel('NGS-DEMO');
    expect(second.model).toBeDefined();
    expect(second.fromCache).toBe(true);
    const meta = geoidGridMetadataSummary(first.model!);
    expect(meta).toContain('NGS-DEMO');
    expect(meta).toContain('3x3');
  });

  it('supports bilinear and nearest interpolation inside model extent', () => {
    const loaded = loadBuiltinGeoidGridModel('NGS-DEMO');
    expect(loaded.model).toBeDefined();
    const model = loaded.model!;
    const bilinear = interpolateGeoidUndulation(model, 40.0, -105.0, 'bilinear');
    const nearest = interpolateGeoidUndulation(model, 40.0, -105.0, 'nearest');
    expect(bilinear).not.toBeNull();
    expect(nearest).not.toBeNull();
    expect((bilinear ?? 0) < -29.5).toBe(true);
    expect((nearest ?? 0) < -29.5).toBe(true);
  });

  it('returns null outside model bounds and parses interpolation tokens', () => {
    const loaded = loadBuiltinGeoidGridModel('NRC-DEMO');
    expect(loaded.model).toBeDefined();
    const outside = interpolateGeoidUndulation(loaded.model!, 30.0, -90.0, 'bilinear');
    expect(outside).toBeNull();
    expect(parseGeoidInterpolationToken('bilinear')).toBe('bilinear');
    expect(parseGeoidInterpolationToken('nearest')).toBe('nearest');
    expect(parseGeoidInterpolationToken('unknown')).toBeNull();
  });
});
