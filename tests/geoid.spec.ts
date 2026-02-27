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

  it('matches known undulation checkpoints for NGS-DEMO grid nodes and midpoint', () => {
    const loaded = loadBuiltinGeoidGridModel('NGS-DEMO');
    expect(loaded.model).toBeDefined();
    const model = loaded.model!;

    const node1 = interpolateGeoidUndulation(model, 40.0, -105.0, 'bilinear');
    const node2 = interpolateGeoidUndulation(model, 41.0, -104.0, 'bilinear');
    const midpoint = interpolateGeoidUndulation(model, 40.5, -104.5, 'bilinear');
    const nearestLow = interpolateGeoidUndulation(model, 40.49, -104.51, 'nearest');
    const nearestHigh = interpolateGeoidUndulation(model, 40.51, -104.49, 'nearest');

    expect(node1).toBeCloseTo(-29.65, 10);
    expect(node2).toBeCloseTo(-29.4, 10);
    expect(midpoint).toBeCloseTo(-29.525, 10);
    expect(nearestLow).toBeCloseTo(-29.65, 10);
    expect(nearestHigh).toBeCloseTo(-29.4, 10);
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
