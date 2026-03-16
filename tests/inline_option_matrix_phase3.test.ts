import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { parseInput } from '../src/engine/parse';

describe('inline option phase 3 semantics coverage', () => {
  it('applies .LWEIGHT fallback across every non-L leveling-producing record family', () => {
    const input = readFileSync('tests/fixtures/inline_option_phase3_lweight.dat', 'utf-8');
    const parsed = parseInput(input);
    const levelingRows = parsed.observations.filter((obs) => obs.type === 'lev');

    expect(levelingRows).toHaveLength(6);
    expect(levelingRows.map((obs) => obs.sourceLine)).toEqual([7, 8, 10, 12, 14, 16]);
    expect(levelingRows.every((obs) => obs.sigmaSource === 'default')).toBe(true);

    ['DV', 'M', 'BM', 'T', 'DM', 'SS'].forEach((code) => {
      expect(parsed.logs.some((line) => line.includes(`.LWEIGHT fallback applied for ${code}`))).toBe(
        true,
      );
    });
  });

  it('treats .COORD 2D and .COORD 3D as aliases for vertical-equation inclusion', () => {
    const input2d = [
      '.COORD 2D',
      'C A 0 0 0 ! !',
      'C B 100 0 0 ! !',
      'C C 100 100 0',
      'M A-B-C 90-00-00 141.421356 90.0000',
    ].join('\n');
    const input3d = [
      '.COORD 3D',
      'C A 0 0 0 ! ! !',
      'C B 100 0 0 ! ! !',
      'C C 100 100 10',
      'M A-B-C 90-00-00 141.421356 90.0000',
    ].join('\n');

    const parsed2d = parseInput(input2d);
    const parsed3d = parseInput(input3d);

    expect(parsed2d.parseState.coordMode).toBe('2D');
    expect(parsed3d.parseState.coordMode).toBe('3D');
    expect(parsed2d.observations.some((obs) => obs.type === 'zenith')).toBe(false);
    expect(parsed3d.observations.some((obs) => obs.type === 'zenith')).toBe(true);
  });

  it('stops parsing at .END and ignores later records', () => {
    const parsed = parseInput(
      ['.2D', 'C A 0 0 0 ! !', '.END', 'C B 100 0 0 ! !', 'D A-B 100.0 0.005'].join('\n'),
    );

    expect(Object.keys(parsed.stations)).toEqual(['A']);
    expect(parsed.observations).toHaveLength(0);
  });
});
