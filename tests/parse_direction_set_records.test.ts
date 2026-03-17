import { describe, expect, it } from 'vitest';

import { parseInput } from '../src/engine/parse';

describe('parse direction-set record families', () => {
  it('parses DB/DN/DE into reduced direction observations', () => {
    const parsed = parseInput(['DB AT BS', 'DN TO 10-00-00 2', 'DE'].join('\n'));

    expect(parsed.observations).toHaveLength(1);
    expect(parsed.observations[0]).toMatchObject({
      type: 'direction',
      at: 'AT',
      to: 'TO',
      rawCount: 1,
    });
  });

  it('parses DM records into distance, vertical, and reduced direction outputs', () => {
    const parsed = parseInput(['.DELTA ON', 'DB AT BS', 'DM TO 10-00-00 5 1.25 2 0.02 0.03', 'DE'].join('\n'));

    expect(parsed.observations.map((obs) => obs.type)).toEqual(['dist', 'lev', 'direction']);
    expect(parsed.observations[0]).toMatchObject({
      type: 'dist',
      from: 'AT',
      to: 'TO',
      obs: 5,
    });
    expect(parsed.observations[1]).toMatchObject({
      type: 'lev',
      from: 'AT',
      to: 'TO',
      obs: 1.25,
    });
    expect(parsed.observations[2]).toMatchObject({
      type: 'direction',
      at: 'AT',
      to: 'TO',
      rawCount: 1,
    });
  });
});
