import { describe, expect, it } from 'vitest';

import { parseInput } from '../src/engine/parse';

describe('parse control record families', () => {
  it('parses C and E control records into weighted and fixed constraints', () => {
    const parsed = parseInput(['.3D', 'C P1 100 200 50 0.01 0.02 0.03', 'E P2 25 0.5 !'].join('\n'));

    expect(parsed.stations.P1).toMatchObject({
      x: 100,
      y: 200,
      h: 50,
      sx: 0.01,
      sy: 0.02,
      sh: 0.03,
      constraintX: 100,
      constraintY: 200,
      constraintH: 50,
      constraintModeX: 'weighted',
      constraintModeY: 'weighted',
      constraintModeH: 'weighted',
    });
    expect(parsed.stations.P2).toMatchObject({
      h: 25,
      fixedH: true,
      constraintModeH: 'fixed',
    });
  });

  it('parses P and PH records with projected EN coordinates and preserved height type', () => {
    const parsed = parseInput(
      ['.3D', 'P A 45 63 100 0.01 0.02 0.03', 'PH B 45.0001 63.0001 110 0.02 0.03 0.04'].join(
        '\n',
      ),
    );

    expect(parsed.parseState.originLatDeg).toBe(45);
    expect(parsed.parseState.originLonDeg).toBe(63);
    expect(parsed.stations.A).toMatchObject({
      latDeg: 45,
      lonDeg: 63,
      h: 100,
      heightType: 'orthometric',
      constraintModeX: 'weighted',
      constraintModeY: 'weighted',
      constraintModeH: 'weighted',
    });
    expect(parsed.stations.B).toMatchObject({
      latDeg: 45.0001,
      lonDeg: 63.0001,
      h: 110,
      heightType: 'ellipsoid',
    });
    expect(parsed.logs.some((line) => line.includes('P origin set to 45.000000, 63.000000'))).toBe(
      true,
    );
  });

  it('parses CH and EH records as ellipsoid-height control rows', () => {
    const parsed = parseInput(['.3D', 'CH C1 100 200 50 0.01 0.02 0.03', 'EH C2 110 210 60'].join('\n'));

    expect(parsed.stations.C1).toMatchObject({
      x: 100,
      y: 200,
      h: 50,
      heightType: 'ellipsoid',
      constraintModeH: 'weighted',
    });
    expect(parsed.stations.C2).toMatchObject({
      x: 110,
      y: 210,
      h: 60,
      heightType: 'ellipsoid',
    });
  });
});
