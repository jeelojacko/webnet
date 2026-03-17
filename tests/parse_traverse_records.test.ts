import { describe, expect, it } from 'vitest';

import { parseInput } from '../src/engine/parse';

describe('parse traverse record families', () => {
  it('parses conventional TB/T/TE legs into angle, distance, and zenith observations', () => {
    const parsed = parseInput(
      [
        'C BS 0 0 0 ! ! !',
        'C AT 10 0 0',
        'C TO 10 10 0',
        'TB AT BS',
        'T TO 90-00-00 10 90-00-00 2 0.02 3',
        'TE BS 90-00-00 10 90-00-00 2 0.02 3',
      ].join('\n'),
    );

    expect(parsed.observations.map((obs) => obs.type)).toEqual([
      'angle',
      'dist',
      'zenith',
      'angle',
      'dist',
      'zenith',
    ]);
    expect(parsed.observations[0]).toMatchObject({
      type: 'angle',
      at: 'AT',
      from: 'BS',
      to: 'TO',
    });
    expect(parsed.observations[1]).toMatchObject({
      type: 'dist',
      from: 'AT',
      to: 'TO',
      obs: 10,
    });
  });

  it('parses map-anglecalc traverse legs into bearing, angle, and distance observations', () => {
    const parsed = parseInput(
      [
        '.MAPMODE ANGLECALC',
        'TB 0-00-00 BS AT',
        'T TO 90-00-00 10',
      ].join('\n'),
    );

    expect(parsed.observations.map((obs) => obs.type)).toEqual(['bearing', 'angle', 'dist']);
    expect(parsed.observations[0]).toMatchObject({
      type: 'bearing',
      from: 'AT',
      to: 'TO',
    });
    expect(parsed.observations[1]).toMatchObject({
      type: 'angle',
      at: 'AT',
      from: 'BS',
      to: 'TO',
    });
    expect(parsed.observations[2]).toMatchObject({
      type: 'dist',
      from: 'AT',
      to: 'TO',
      mode: 'horiz',
    });
  });
});
