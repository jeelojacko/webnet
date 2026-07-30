import { describe, expect, it } from 'vitest';
import {
  parseInput,
  crsGridAliasCases,
} from './parseTestSupport';

describe('parseInput', () => {
  it('supports .CRS MODE/ID and .CRS GRID <id> aliases for coordinate-system selection', () => {
    const viaModeId = parseInput(
      ['.CRS MODE GRID', '.CRS ID CA_NAD83_CSRS_UTM_19N', 'C A 0 0 0 ! !'].join('\n'),
    );
    expect(viaModeId.parseState.coordSystemMode).toBe('grid');
    expect(viaModeId.parseState.crsId).toBe('CA_NAD83_CSRS_UTM_19N');

    const viaGridAlias = parseInput(
      ['.CRS LOCAL', '.CRS GRID CA_NAD83_CSRS_UTM_20N', 'C A 0 0 0 ! !'].join('\n'),
    );
    expect(viaGridAlias.parseState.coordSystemMode).toBe('grid');
    expect(viaGridAlias.parseState.crsId).toBe('CA_NAD83_CSRS_UTM_20N');
    expect(viaGridAlias.logs.some((line) => line.includes('Coordinate system mode set to GRID'))).toBe(
      true,
    );

    crsGridAliasCases.forEach(({ directive, expected }) => {
      const parsed = parseInput([directive, 'C A 0 0 0 ! !'].join('\n'));
      expect(parsed.parseState.coordSystemMode).toBe('grid');
      expect(parsed.parseState.crsId).toBe(expected);
    });
  });
});
