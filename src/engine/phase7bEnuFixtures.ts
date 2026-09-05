/**
 * Phase 7B deterministic full-ENU 3D fixtures.
 *
 * Parser audit result: the only field syntax that carries a full 3D
 * covariance block with nonzero off-diagonals is the G0/G1/G2/G3 GNSS
 * covariance path (`parseFieldGpsVectorRecords.ts`), which stores
 * `gpsCovariance3d` (cXX/cYY/cZZ/cXY/cXZ/cYZ). Plain `G` vectors carry only
 * dE/dN plus sigmaE/sigmaN/corrEN, and no parser path sets corrEU/corrNU or
 * stdDevU, so EU/NU weight terms cannot originate from plain `G` syntax.
 *
 * Solve-frame audit result: `transformGpsCovarianceToSolveFrame` resolves
 * ecefDelta blocks through `stationGeodetic`, which returns null outside
 * grid/CRS mode. In LOCAL mode the solve falls back to a diagonal proxy
 * (cEE=cNN=cUU=mean variance, EN/EU/NU=0) with an explicit geodetic
 * warning, so full-ENU weights require grid mode. These fixtures therefore
 * use `.CRS GRID CA_NAD83_CSRS_NB_STEREO_DOUBLE` with projected control.
 * All covariance blocks below are hand-checked symmetric positive-definite.
 */

export const PHASE7B_ENU_GRID_CRS = 'CA_NAD83_CSRS_NB_STEREO_DOUBLE';

/** Small manageable fixture: 2 fixed controls, 2 unknowns, 3 full-ENU vectors. */
export const buildPhase7bEnuSmallInput = (): string =>
  [
    '# Phase 7B deterministic full-ENU fixture (grid mode, nonzero EN/EU/NU)',
    '.3D',
    '.UNITS M',
    '.ORDER EN',
    `.CRS GRID ${PHASE7B_ENU_GRID_CRS}`,
    '.GPS WEIGHT COVARIANCE',
    'C C1 2505000.000 7505000.000 50.000 ! ! !',
    'C C2 2505400.000 7505400.000 52.000 ! ! !',
    'C U1 2505100.100 7505090.200 50.100',
    'C U2 2505300.200 7505290.300 51.200',
    'G0 VEC-C1-U1',
    'G1 C1-U1 100.0 90.0 0.5',
    'G2 0.000100 0.000100 0.000400',
    'G3 0.000030 0.000020 0.000040',
    'G0 VEC-U1-U2',
    'G1 U1-U2 200.0 200.0 1.0',
    'G2 0.000144 0.000121 0.000441',
    'G3 -0.000040 0.000030 -0.000050',
    'G0 VEC-U2-C2',
    'G1 U2-C2 100.0 110.0 0.5',
    'G2 0.000081 0.000100 0.000361',
    'G3 0.000020 -0.000015 0.000030',
    'D C1-U1 134.5000 0.003',
    '',
  ].join('\n');

export interface Phase7bEnuScalingSpec {
  unknownCount: number;
}

const SCALING_COVARIANCE_BLOCKS: Array<[string, string, string]> = [
  ['G2 0.000100 0.000100 0.000400', 'G3 0.000030 0.000020 0.000040', ''],
  ['G2 0.000144 0.000121 0.000441', 'G3 -0.000040 0.000030 -0.000050', ''],
  ['G2 0.000081 0.000100 0.000361', 'G3 0.000020 -0.000015 0.000030', ''],
];

/**
 * Larger deterministic chain for sparse-only scaling (no dense reference).
 * Stations step ~100 m in grid coordinates; each leg carries a full-ENU
 * G0-G3 block cycling the three audited SPD covariance shapes above.
 */
export const buildPhase7bEnuScalingInput = (spec: Phase7bEnuScalingSpec): string => {
  const lines = [
    '# Phase 7B deterministic full-ENU scaling fixture (grid mode)',
    '.3D',
    '.UNITS M',
    '.ORDER EN',
    `.CRS GRID ${PHASE7B_ENU_GRID_CRS}`,
    '.GPS WEIGHT COVARIANCE',
    'C C1 2505000.000 7505000.000 50.000 ! ! !',
  ];
  for (let i = 1; i <= spec.unknownCount; i += 1) {
    const e = (2505000 + i * 100).toFixed(3);
    const n = (7505000 + i * 90).toFixed(3);
    const h = (50 + i * 0.2).toFixed(3);
    lines.push(`C U${i} ${e} ${n} ${h}`);
  }
  const lastE = (2505000 + (spec.unknownCount + 1) * 100).toFixed(3);
  const lastN = (7505000 + (spec.unknownCount + 1) * 90).toFixed(3);
  lines.push(`C C2 ${lastE} ${lastN} 52.000 ! ! !`);
  const order = ['C1', ...Array.from({ length: spec.unknownCount }, (_, i) => `U${i + 1}`), 'C2'];
  order.forEach((from, leg) => {
    const to = order[leg + 1];
    if (!to) return;
    const block = SCALING_COVARIANCE_BLOCKS[leg % SCALING_COVARIANCE_BLOCKS.length] as [
      string,
      string,
      string,
    ];
    lines.push(`G0 VEC-${from}-${to}`);
    lines.push(`G1 ${from}-${to} 100.0 90.0 0.2`);
    lines.push(block[0]);
    lines.push(block[1]);
  });
  lines.push('');
  return lines.join('\n');
};
