import { describe, expect, it } from 'vitest';

import { parseInput } from '../src/engine/parse';
import { SEC_TO_RAD } from '../src/engine/angles';

describe('parse conventional observation record families', () => {
  it('parses D records with explicit instrument, sigma, and HI/HT', () => {
    const parsed = parseInput(['I TS 0.001 1 2 3', 'D TS A-B 10.5 0.02 1.5/1.7'].join('\n'));

    expect(parsed.observations).toHaveLength(1);
    expect(parsed.observations[0]).toMatchObject({
      type: 'dist',
      instCode: 'TS',
      from: 'A',
      to: 'B',
      obs: 10.5,
      stdDev: 0.02,
      hi: 1.5,
      ht: 1.7,
    });
  });

  it('parses A records as angles or directions depending on angle mode', () => {
    const angleParsed = parseInput(['A AT-FROM-TO 90-00-00 3'].join('\n'));
    expect(angleParsed.observations).toHaveLength(1);
    expect(angleParsed.observations[0]).toMatchObject({
      type: 'angle',
      at: 'AT',
      from: 'FROM',
      to: 'TO',
    });

    const dirParsed = parseInput(['.AMODE DIR', 'A AT-FROM-TO 90-00-00 3'].join('\n'));
    expect(dirParsed.observations).toHaveLength(1);
    expect(dirParsed.observations[0]).toMatchObject({
      type: 'dir',
      from: 'AT',
      to: 'TO',
    });
  });

  it('parses V and DV records across slope and delta modes', () => {
    const slopeParsed = parseInput(['V A-B 90 5', 'DV A-B 10 90 0.02 3'].join('\n'));
    expect(slopeParsed.observations.map((obs) => obs.type)).toEqual(['zenith', 'dist', 'zenith']);

    const deltaParsed = parseInput(['.DELTA ON', 'V A-B 1.25 0.01', 'DV A-B 10 1.5 0.02 0.03'].join('\n'));
    expect(deltaParsed.observations.map((obs) => obs.type)).toEqual(['lev', 'dist', 'lev']);
    expect(deltaParsed.observations[0]).toMatchObject({ obs: 1.25 });
    expect(deltaParsed.observations[1]).toMatchObject({ obs: 10, mode: 'horiz' });
    expect(deltaParsed.observations[2]).toMatchObject({ obs: 1.5 });
  });

  it('parses BM records into distance, vertical, and bearing observations', () => {
    const parsed = parseInput(['.DELTA ON', 'BM A B 90-00-00 10 1.25 2 0.02 0.03'].join('\n'));

    expect(parsed.observations.map((obs) => obs.type)).toEqual(['dist', 'lev', 'bearing']);
    expect(parsed.observations[0]).toMatchObject({
      type: 'dist',
      from: 'A',
      to: 'B',
      obs: 10,
      stdDev: 0.02,
    });
    expect(parsed.observations[1]).toMatchObject({
      type: 'lev',
      from: 'A',
      to: 'B',
      obs: 1.25,
      stdDev: 0.03,
    });
    expect(parsed.observations[2]).toMatchObject({
      type: 'bearing',
      from: 'A',
      to: 'B',
    });
  });

  it('parses M records with inline triplets, HI/HT, and 2D slope reduction', () => {
    const parsed = parseInput(['.2D', 'M AT-FROM-TO 90-00-00 10 90-00-00 2 0.02 1.5/1.7'].join('\n'));

    expect(parsed.observations).toHaveLength(2);
    expect(parsed.observations[0]).toMatchObject({
      type: 'angle',
      at: 'AT',
      from: 'FROM',
      to: 'TO',
    });
    expect(parsed.observations[1]).toMatchObject({
      type: 'dist',
      from: 'AT',
      to: 'TO',
      mode: 'horiz',
      hi: 1.5,
      ht: 1.7,
    });
  });

  it('uses the exact face-2 weighting factor for turned-angle observations', () => {
    const parsed = parseInput(['A AT-FROM-TO 200-00-00 4'].join('\n'));

    expect(parsed.observations).toHaveLength(1);
    expect(parsed.observations[0]).toMatchObject({
      type: 'angle',
      at: 'AT',
      from: 'FROM',
      to: 'TO',
    });
    expect(parsed.observations[0].stdDev).toBeCloseTo((4 / Math.SQRT2) * SEC_TO_RAD, 12);
  });

  it('parses B records as plan-rotated bearings', () => {
    const parsed = parseInput(['.ROTATION 90', 'B A-B 0-00-00 2'].join('\n'));

    expect(parsed.observations).toHaveLength(1);
    expect(parsed.observations[0]).toMatchObject({
      type: 'bearing',
      from: 'A',
      to: 'B',
      stdDev: (2 / 3600) * (Math.PI / 180),
    });
    expect(parsed.observations[0].obs).toBeCloseTo(Math.PI / 2, 12);
  });
});
