import { describe, expect, it } from 'vitest';

import { parseInput } from '../src/engine/parse';

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
});
