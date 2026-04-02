import type { ParseSettings, SettingsState } from './appStateTypes';
import type { InstrumentLibrary } from './types';
import gnssFixtureInputRaw from '../tests/fixtures/industry_case_gnss_input.txt?raw';
import traverseFixtureRaw from '../tests/fixtures/industry_case_traverse_output.txt?raw';

export type IndustryParityCaseId = 'leveling' | 'traverse' | 'gnss' | 'combined';

export type IndustryParityHeaderNormalizationRule =
  | 'softwareVersion'
  | 'runDate'
  | 'projectFolder'
  | 'dataFileList';

export interface IndustryParityStartupDefaults {
  input: string;
  settingsPatch: Partial<SettingsState>;
  parseSettingsPatch: Partial<ParseSettings>;
  projectInstruments: InstrumentLibrary;
  selectedInstrument: string;
}

export interface IndustryParityCaseDefinition {
  id: IndustryParityCaseId;
  fixtureInputPath: string;
  fixtureOutputPath: string;
  normalizationRules: IndustryParityHeaderNormalizationRule[];
  startupDefaults?: IndustryParityStartupDefaults;
}

const LEVELING_STARTUP_INPUT = `#Level Adjustment

#Project settings use 0.001500 meters/km Elev. Diff.
#This is instrument quoted 0.0003m/km converted to 1-sigma (68% CI)

#Fixed arbitrary point:
C OOP 682579.733 5090745.219 100 ! ! !

#Station-Station   Elev Diff   Dist
L GPS3-GATE -3.452559 311.322
L GPS3-GATE -3.451928 311.333
L GATE-GPS3 3.451953 313.389
L GATE-GPS3 3.452123 313.390
L GPS2-GPS6 -3.399673 393.317
L GPS2-GPS6 -3.399693 393.335
L GPS6-GPS2 3.400005 393.045
L GPS6-GPS2 3.399985 393.051
L FM1-GPS6 -18.400838 223.285
L FM1-GPS6 -18.400867 223.300
L GPS6-FM1 18.401244 223.467
L GPS6-FM1 18.401184 223.279
L GPS2-TIMS 21.485000 339.620
L GPS2-TIMS 21.484670 339.660
L TIMS-GPS2 -21.485020 340.080
L TIMS-GPS2 -21.485360 340.120
L GPS5-GPS2 -6.991572 290.206
L GPS5-GPS2 -6.991921 290.210
L GPS2-GPS5 6.990872 290.955
L GPS2-GPS5 6.990922 290.974
L POT-GPS5 -4.639954 119.447
L POT-GPS5 -4.640285 119.554
L GPS5-POT 4.640755 118.265
L GPS5-POT 4.640995 118.229
L PITA-POT -10.403176 123.531
L PITA-POT -10.403188 123.670
L POT-PITA 10.403466 123.912
L POT-PITA 10.403053 123.924
L TIMS-PITA 0.550833 304.486
L TIMS-PITA 0.551255 304.535
L PITA-TIMS -0.551766 305.009
L PITA-TIMS -0.552004 304.938
L PEAT-TIMS -15.978460 429.940 0.000393405
L PEAT-TIMS -15.979110 429.910 0.000393405
L TIMS-PEAT 15.977280 443.620
L TIMS-PEAT 15.976280 443.570
L OOP-APOG 17.758100 425.440
L OOP-APOG 17.759100 425.110
L APOG-OOP -17.758980 421.870
L APOG-OOP -17.759420 422.030
L OOP-TIMS -5.696550 433.630
L OOP-TIMS -5.696880 433.640
L TIMS-OOP 5.695970 432.680
L TIMS-OOP 5.696260 432.670
L OOP-FM1 -12.177970 177.140
L OOP-FM1 -12.178390 177.130
L FM1-OOP 12.178740 177.090
L FM1-OOP 12.178060 177.190
L PEAT-APOG 7.478990 142.970
L PEAT-APOG 7.478990 143.010
L APOG-PEAT -7.479110 143.570
L APOG-PEAT -7.479460 143.570
L GPS3-GPS6 17.4922 480.682
L GPS3-GPS6 17.49228 480.707
L GPS6-GPS3 -17.49172 483.463
L GPS6-GPS3 -17.49177 483.478
L GATE-GPS2 24.344570 376.420
L GATE-GPS2 24.343300 376.330
L GPS2-GATE -24.342880 389.610
L GPS2-GATE -24.343920 391.060
`;

const LEVELING_STARTUP_INSTRUMENTS: InstrumentLibrary = {
  LEV_REF: {
    code: 'LEV_REF',
    desc: 'industry parity leveling default',
    edm_const: 0,
    edm_ppm: 0,
    hzPrecision_sec: 0,
    dirPrecision_sec: 0,
    azBearingPrecision_sec: 0,
    vaPrecision_sec: 0,
    instCentr_m: 0,
    tgtCentr_m: 0,
    vertCentr_m: 0,
    elevDiff_const_m: 0,
    elevDiff_ppm: 0,
    gpsStd_xy: 0,
    levStd_mmPerKm: 1.5,
  },
};

const extractReferenceInputDataSection = (raw: string): string => {
  const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  const traverseOnlyLine = lines.findIndex((line) => line.trim() === '#Traverse Only');
  if (traverseOnlyLine > 0) {
    const startLine = Math.max(0, traverseOnlyLine - 1);
    return lines.slice(startLine).join('\n').trim();
  }
  const firstCommentLine = lines.findIndex((line) => line.trimStart().startsWith('#'));
  return (firstCommentLine >= 0 ? lines.slice(firstCommentLine) : lines).join('\n').trim();
};

const TRAVERSE_STARTUP_INPUT = extractReferenceInputDataSection(traverseFixtureRaw);
const GNSS_STARTUP_INPUT = gnssFixtureInputRaw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();

const TRAVERSE_STARTUP_INSTRUMENTS: InstrumentLibrary = {
  TRAV_DEFAULT: {
    code: 'TRAV_DEFAULT',
    desc: 'industry parity traverse project default',
    edm_const: 0.001,
    edm_ppm: 1.5,
    hzPrecision_sec: 1.414,
    dirPrecision_sec: 1.0,
    azBearingPrecision_sec: 1.414,
    vaPrecision_sec: 1.0,
    instCentr_m: 0.00075,
    tgtCentr_m: 0.00075,
    vertCentr_m: 0.0005,
    elevDiff_const_m: 0.01524,
    elevDiff_ppm: 0,
    gpsStd_xy: 0,
    levStd_mmPerKm: 1.5,
  },
  S9: {
    code: 'S9',
    desc: 'corrections from isopropyl',
    edm_const: 0.003,
    edm_ppm: 2.0,
    hzPrecision_sec: 1.2357,
    dirPrecision_sec: 0.87377,
    azBearingPrecision_sec: 0.707107,
    vaPrecision_sec: 3.28473,
    instCentr_m: 0.0015,
    tgtCentr_m: 0.0015,
    vertCentr_m: 0.0005,
    elevDiff_const_m: 0.01524,
    elevDiff_ppm: 0,
    gpsStd_xy: 0,
    levStd_mmPerKm: 0,
  },
  SX12: {
    code: 'SX12',
    desc: 'n/a',
    edm_const: 0.003,
    edm_ppm: 1.5,
    hzPrecision_sec: 0.950079,
    dirPrecision_sec: 0.671807,
    azBearingPrecision_sec: 1.414,
    vaPrecision_sec: 6.064437,
    instCentr_m: 0.0015,
    tgtCentr_m: 0.0015,
    vertCentr_m: 0.0005,
    elevDiff_const_m: 0.01524,
    elevDiff_ppm: 0,
    gpsStd_xy: 0,
    levStd_mmPerKm: 0,
  },
  TS11: {
    code: 'TS11',
    desc: 'n/a',
    edm_const: 0.002,
    edm_ppm: 1.5,
    hzPrecision_sec: 1.84146,
    dirPrecision_sec: 1.302108,
    azBearingPrecision_sec: 4.0,
    vaPrecision_sec: 4.41756,
    instCentr_m: 0.0015,
    tgtCentr_m: 0.0015,
    vertCentr_m: 0.0005,
    elevDiff_const_m: 0.01524,
    elevDiff_ppm: 0,
    gpsStd_xy: 0,
    levStd_mmPerKm: 0,
  },
};

const GNSS_STARTUP_INSTRUMENTS: InstrumentLibrary = {};

const DEFAULT_NORMALIZATION_RULES: IndustryParityHeaderNormalizationRule[] = [
  'softwareVersion',
  'runDate',
  'projectFolder',
  'dataFileList',
];

export const INDUSTRY_PARITY_CASES: Record<IndustryParityCaseId, IndustryParityCaseDefinition> = {
  leveling: {
    id: 'leveling',
    fixtureInputPath: 'tests/fixtures/industry_case_leveling_input.txt',
    fixtureOutputPath: 'tests/fixtures/industry_case_leveling_output.txt',
    normalizationRules: DEFAULT_NORMALIZATION_RULES,
    startupDefaults: {
      input: LEVELING_STARTUP_INPUT,
      settingsPatch: {
        convergenceLimit: 0.001,
      },
      parseSettingsPatch: {
        coordMode: '3D',
        order: 'EN',
      },
      projectInstruments: LEVELING_STARTUP_INSTRUMENTS,
      selectedInstrument: 'LEV_REF',
    },
  },
  traverse: {
    id: 'traverse',
    fixtureInputPath: 'tests/fixtures/industry_case_traverse_output.txt',
    fixtureOutputPath: 'tests/fixtures/industry_case_traverse_input.txt',
    normalizationRules: DEFAULT_NORMALIZATION_RULES,
    startupDefaults: {
      input: TRAVERSE_STARTUP_INPUT,
      settingsPatch: {
        convergenceLimit: 0.01,
      },
      parseSettingsPatch: {
        coordMode: '3D',
        coordSystemMode: 'grid',
        crsId: 'CA_NAD83_NB83_STEREO_DOUBLE',
        order: 'NE',
        deltaMode: 'slope',
        angleStationOrder: 'atfromto',
        lonSign: 'west-positive',
        verticalDeflectionNorthSec: -2.91,
        verticalDeflectionEastSec: -1.46,
        applyCurvatureRefraction: true,
        verticalReduction: 'curvref',
        refractionCoefficient: 0.07,
      },
      projectInstruments: TRAVERSE_STARTUP_INSTRUMENTS,
      selectedInstrument: 'TRAV_DEFAULT',
    },
  },
  gnss: {
    id: 'gnss',
    fixtureInputPath: 'tests/fixtures/industry_case_gnss_input.txt',
    fixtureOutputPath: 'tests/fixtures/industry_case_gnss_output.txt',
    normalizationRules: DEFAULT_NORMALIZATION_RULES,
    startupDefaults: {
      input: GNSS_STARTUP_INPUT,
      settingsPatch: {
        convergenceLimit: 0.01,
      },
      parseSettingsPatch: {
        coordMode: '3D',
        coordSystemMode: 'grid',
        crsId: 'CA_NAD83_CSRS_NB_STEREO_DOUBLE',
        order: 'NE',
        deltaMode: 'slope',
        angleStationOrder: 'atfromto',
        lonSign: 'west-positive',
        verticalDeflectionNorthSec: -2.91,
        verticalDeflectionEastSec: -1.46,
        applyCurvatureRefraction: true,
        verticalReduction: 'curvref',
        refractionCoefficient: 0.07,
      },
      projectInstruments: GNSS_STARTUP_INSTRUMENTS,
      selectedInstrument: '',
    },
  },
  combined: {
    id: 'combined',
    fixtureInputPath: 'tests/fixtures/industry_case_combined_input.txt',
    fixtureOutputPath: 'tests/fixtures/industry_case_combined_output.txt',
    normalizationRules: DEFAULT_NORMALIZATION_RULES,
  },
};

export const ACTIVE_INDUSTRY_PARITY_CASE_ID: IndustryParityCaseId = 'gnss';
export const ACTIVE_INDUSTRY_PARITY_CASE =
  INDUSTRY_PARITY_CASES[ACTIVE_INDUSTRY_PARITY_CASE_ID];
