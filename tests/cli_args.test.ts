import { describe, expect, it } from 'vitest';
import { parseArgs } from '../src/cli';

describe('CLI argument parsing', () => {
  it('normalizes canonical and EPSG CRS aliases without spawning the CLI process', () => {
    const cases: Array<{ input: string; expected: string }> = [
      { input: 'EPSG:2953', expected: 'CA_NAD83_CSRS_NB_STEREO_DOUBLE' },
      { input: 'EPSG:3799', expected: 'CA_NAD83_CSRS_QC_LAMBERT' },
      { input: 'CA_NAD83_CSRS_SK_ATS', expected: 'CA_NAD83_CSRS_SK_ATS' },
      { input: 'CA_NAD83_CSRS_MB_3TM', expected: 'CA_NAD83_CSRS_MB_3TM' },
      { input: 'CA_NAD83_CSRS_NU_STEREOGRAPHIC', expected: 'CA_NAD83_CSRS_NU_STEREOGRAPHIC' },
      { input: 'EPSG:3402', expected: 'CA_NAD83_CSRS_AB_10TM_FOREST' },
      { input: 'EPSG:5321', expected: 'CA_NAD83_CSRS_ON_TERANET_LAMBERT' },
      { input: 'EPSG:6103', expected: 'CA_NAD83_CSRS_ARCTIC_LCC_3_29' },
      { input: 'US_NAD83_2011_SPCS_NY_EAST', expected: 'US_NAD83_2011_SPCS_NY_EAST' },
      { input: 'EPSG:6419', expected: 'US_NAD83_2011_SPCS_CA_ZONE_3' },
      { input: 'EPSG:6537', expected: 'US_NAD83_2011_SPCS_NY_EAST_FTUS' },
      { input: 'EPSG:6588', expected: 'US_NAD83_2011_SPCS_TX_SOUTH_CENTRAL_FTUS' },
      { input: 'EPSG:6403', expected: 'US_NAD83_2011_SPCS_AK_ZONE_10' },
      { input: 'EPSG:6546', expected: 'US_NAD83_2011_SPCS_ND_SOUTH' },
      { input: 'EPSG:6561', expected: 'US_NAD83_2011_SPCS_OR_SOUTH_FTUS' },
      { input: 'EPSG:6570', expected: 'US_NAD83_2011_SPCS_SC_FTUS' },
    ];

    cases.forEach(({ input, expected }) => {
      const parsed = parseArgs([
        '--input',
        'fixture.dat',
        '--coord-system-mode',
        'grid',
        '--crs-id',
        input,
      ]);
      expect(parsed.parseOptions.coordSystemMode).toBe('grid');
      expect(parsed.parseOptions.crsId).toBe(expected);
    });
  });
});
