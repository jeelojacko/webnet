import { describe, expect, it } from 'vitest';

import {
  createParseSigmaResolvers,
  defaultDistanceSigma,
  extractSigmaTokens,
  parseSigmaToken,
  resolveSigma,
} from '../src/engine/parseSigmaResolution';
import type { Instrument, ParseOptions } from '../src/types';

describe('parseSigmaResolution', () => {
  it('parses and extracts sigma tokens without consuming HI/HT tails', () => {
    expect(parseSigmaToken('&')).toEqual({ kind: 'default' });
    expect(parseSigmaToken('!')).toEqual({ kind: 'fixed' });
    expect(parseSigmaToken('*')).toEqual({ kind: 'float' });
    expect(parseSigmaToken('0.25')).toEqual({ kind: 'numeric', value: 0.25 });
    expect(parseSigmaToken('HI/HT')).toBeNull();

    const extracted = extractSigmaTokens(['0.25', '!', '1.5/1.7', 'tail'], 3);
    expect(extracted.sigmas).toEqual([{ kind: 'numeric', value: 0.25 }, { kind: 'fixed' }]);
    expect(extracted.rest).toEqual(['1.5/1.7', 'tail']);

    const packed = extractSigmaTokens(['&&*', 'tail'], 3);
    expect(packed.sigmas).toEqual([
      { kind: 'default' },
      { kind: 'default' },
      { kind: 'float' },
    ]);
    expect(packed.rest).toEqual(['tail']);
  });

  it('resolves default, fixed, float, and additive-vs-propagated distance sigmas', () => {
    expect(resolveSigma(undefined, 0.5)).toEqual({ sigma: 0.5, source: 'default' });
    expect(resolveSigma({ kind: 'fixed' }, 0.5, 0.01)).toEqual({
      sigma: 0.01,
      source: 'fixed',
    });
    expect(resolveSigma({ kind: 'float' }, 0.5, 0.01, 10)).toEqual({
      sigma: 10,
      source: 'float',
    });

    const inst: Instrument = {
      code: 'TS',
      desc: 'test',
      edm_const: 0.002,
      edm_ppm: 5,
      hzPrecision_sec: 1,
      vaPrecision_sec: 1,
      dirPrecision_sec: 1,
      azBearingPrecision_sec: 1,
      instCentr_m: 0,
      tgtCentr_m: 0,
      vertCentr_m: 0,
      elevDiff_const_m: 0.001,
      elevDiff_ppm: 2,
      gpsStd_xy: 0,
      levStd_mmPerKm: 0,
    };

    expect(defaultDistanceSigma(inst, 1000, 'additive')).toBeCloseTo(0.007, 9);
    expect(defaultDistanceSigma(inst, 1000, 'propagated')).toBeCloseTo(
      Math.sqrt(0.002 ** 2 + 0.005 ** 2),
      9,
    );
  });

  it('builds qfix-aware linear/angular resolvers and logs LWEIGHT fallback use', () => {
    const state: ParseOptions = {
      units: 'ft',
      coordMode: '3D',
      order: 'EN',
      deltaMode: 'slope',
      mapMode: 'off',
      normalize: true,
      qFixLinearSigmaM: 0.003,
      qFixAngularSigmaSec: 2.5,
      levelWeight: 4,
    };
    const logs: string[] = [];
    const resolvers = createParseSigmaResolvers(state, logs);

    const fixedLinear = resolvers.resolveLinearSigma({ kind: 'fixed' }, 1);
    const fixedAngular = resolvers.resolveAngularSigma({ kind: 'fixed' }, 1);
    const level = resolvers.resolveLevelingSigma(undefined, undefined, 250, 'L', 42);

    expect(fixedLinear).toEqual({
      sigma: 0.003 * 3.280839895,
      source: 'fixed',
    });
    expect(fixedAngular).toEqual({ sigma: 2.5, source: 'fixed' });
    expect(level.source).toBe('default');
    expect(level.sigma).toBeCloseTo(0.001, 9);
    expect(logs).toContain('.LWEIGHT fallback applied for L at line 42: 4 mm/km over 0.2500 km');
  });
});
