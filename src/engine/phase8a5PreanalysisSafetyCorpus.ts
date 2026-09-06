/**
 * Phase 8A.5 deterministic preanalysis safety corpus (TEST/EVIDENCE ONLY).
 *
 * Pure generators for the numerical-safety calibration corpus. No parsing,
 * no solving, no worker, no production imports. Every generator is a pure
 * function of its arguments, so rebuilding the corpus is byte-identical.
 *
 * Families: size ladder (chain-star 8..256 unknowns, GPS 8/32/64),
 * weight sweeps, condition family (weak resection, collinear, angle-only,
 * single-tie, narrow brace), braced/mixed redundancy, rank-deficient
 * experimental, and 3D / GPS-covariance / robust / TS-correlation
 * experimental exclusions. The four Phase 8A anchors are merged by the
 * evidence test; this module owns the generated cases only.
 */

export type Phase8a5CorpusFamily =
  | 'anchor'
  | 'size-chain'
  | 'size-gps'
  | 'weight-sweep'
  | 'condition'
  | 'redundant'
  | 'rank-experimental'
  | 'exclusion';

export type Phase8a5ExpectedKind =
  | 'eligible-2d'
  | 'experimental-3d'
  | 'experimental-gps-covariance'
  | 'experimental-rank'
  | 'ineligible-robust'
  | 'ineligible-ts-correlation';

export interface Phase8a5GeneratedSpec {
  id: string;
  family: Phase8a5CorpusFamily;
  input: string;
  coordMode: '2D' | '3D';
  robustMode: string;
  tsCorrelationEnabled: boolean;
  expectedKind: Phase8a5ExpectedKind;
  note: string;
}

const FIXED_A = 'C A 0 0 0 ! ! !';
const FIXED_B = 'C B 100 0 0 ! ! !';

/** Deterministic pseudo-grid free-station position for index i. */
const freePosition = (i: number): { x: number; y: number } => ({
  x: 20 + ((i * 37) % 80),
  y: 20 + ((i * 53) % 60),
});

/** Star geometry: every free station tied to both fixed controls. */
export const buildChainStarInput = (
  freeCount: number,
  distSigma = 0.003,
  angleSigmaSec = 1.0,
): string => {
  const lines = ['.2D', FIXED_A, FIXED_B];
  for (let i = 0; i < freeCount; i += 1) {
    const { x, y } = freePosition(i);
    lines.push(`C P${i} ${x} ${y} 0`);
  }
  for (let i = 0; i < freeCount; i += 1) {
    lines.push(`D A-P${i} ? ${distSigma}`);
    lines.push(`D B-P${i} ? ${distSigma}`);
    lines.push(`A P${i}-A-B ? ${angleSigmaSec}`);
  }
  return lines.join('\n');
};

/** GPS baseline network: two vectors per free station. */
export const buildGpsNetworkInput = (freeCount: number, sigma = 0.01): string => {
  const lines = ['.2D', FIXED_A, FIXED_B];
  for (let i = 0; i < freeCount; i += 1) {
    const { x, y } = freePosition(i);
    lines.push(`C Q${i} ${x} ${y} 0`);
  }
  for (let i = 0; i < freeCount; i += 1) {
    lines.push(`G G1 A Q${i} ? ? ${sigma} ${sigma}`);
    lines.push(`G G1 B Q${i} ? ? ${sigma} ${sigma}`);
  }
  return lines.join('\n');
};

const GPS_COV_INPUT = [
  '.2D',
  FIXED_A,
  FIXED_B,
  'C P 60 40 0',
  'G0 V1',
  'G1 A-P 60 40 0',
  'G2 0.0001 0.0001 0.0001',
  'G3 0 0 0',
  'G G1 B P ? ? 0.010 0.010',
].join('\n');

const SMALL_3D_INPUT = [
  '.3D',
  FIXED_A,
  FIXED_B,
  'C P 60 40 10',
  'D A-P ? 0.003',
  'D B-P ? 0.003',
  'A P-A-B ? 1.0',
].join('\n');

/** Near-collinear weak resection: short baseline, distant rover. */
const WEAK_RESECTION_INPUT = [
  '.2D',
  'C A 0 0 0 ! ! !',
  'C B 10 0 0 ! ! !',
  'C R 1000 2 0',
  'D A-R ? 0.003',
  'D B-R ? 0.003',
  'A R-A-B ? 0.5',
].join('\n');

/** Near-collinear corridor observed by distances only. */
const COLLINEAR_INPUT = [
  '.2D',
  'C A 0 0 0 ! ! !',
  'C B 200 0 0 ! ! !',
  'C C1 50 0.2 0',
  'C C2 100 0.1 0',
  'C C3 150 0.3 0',
  'D A-C1 ? 0.003',
  'D C1-C2 ? 0.003',
  'D C2-C3 ? 0.003',
  'D C3-B ? 0.003',
  'D A-C2 ? 0.003',
  'D C1-C3 ? 0.003',
].join('\n');

/** Angles only: scale/datum weakness by construction. */
const ANGLE_ONLY_INPUT = [
  '.2D',
  FIXED_A,
  FIXED_B,
  'C T1 30 40 0',
  'C T2 60 45 0',
  'C T3 80 30 0',
  'A T1-A-B ? 1.0',
  'A T2-A-B ? 1.0',
  'A T3-A-B ? 1.0',
  'A T1-T2-T3 ? 1.0',
  'A A-T1-T2 ? 1.0',
].join('\n');

/** Single tie: one distance for two unknowns (underdetermined). */
const SINGLE_TIE_INPUT = ['.2D', FIXED_A, 'C L 60 40 0', 'D A-L ? 0.003'].join('\n');

/** Narrow brace: quad with a very short height. */
const NARROW_BRACE_INPUT = [
  '.2D',
  FIXED_A,
  FIXED_B,
  'C N1 40 1.0 0',
  'C N2 60 1.2 0',
  'D A-N1 ? 0.003',
  'D B-N1 ? 0.003',
  'D A-N2 ? 0.003',
  'D B-N2 ? 0.003',
  'D N1-N2 ? 0.003',
  'A N1-A-B ? 1.0',
  'A N2-A-B ? 1.0',
].join('\n');

/** Braced quad with diagonals: well-redundant control case. */
const BRACED_QUAD_INPUT = [
  '.2D',
  FIXED_A,
  FIXED_B,
  'C R1 30 30 0',
  'C R2 70 30 0',
  'C R3 70 60 0',
  'C R4 30 60 0',
  'D A-R1 ? 0.003',
  'D B-R2 ? 0.003',
  'D R1-R2 ? 0.003',
  'D R2-R3 ? 0.003',
  'D R3-R4 ? 0.003',
  'D R4-R1 ? 0.003',
  'D R1-R3 ? 0.003',
  'D R2-R4 ? 0.003',
  'A R1-A-B ? 1.0',
  'A R3-R1-R2 ? 1.0',
].join('\n');

/** Mixed chain with a branch spur. */
const CHAIN_BRANCH_INPUT = [
  '.2D',
  FIXED_A,
  FIXED_B,
  'C S1 25 20 0',
  'C S2 50 35 0',
  'C S3 75 20 0',
  'C S4 50 60 0',
  'D A-S1 ? 0.003',
  'D S1-S2 ? 0.003',
  'D S2-S3 ? 0.003',
  'D S3-B ? 0.003',
  'D S2-S4 ? 0.003',
  'A S1-A-S2 ? 1.0',
  'A S2-S1-S3 ? 1.0',
  'A S4-S2-S3 ? 1.0',
].join('\n');

/** Redundant star: small geometry, doubled ties. */
const REDUNDANT_STAR_INPUT = [
  '.2D',
  FIXED_A,
  FIXED_B,
  'C W1 40 50 0',
  'C W2 60 50 0',
  'D A-W1 ? 0.003',
  'D B-W1 ? 0.003',
  'D A-W2 ? 0.003',
  'D B-W2 ? 0.003',
  'D W1-W2 ? 0.002',
  'D A-W1 ? 0.005',
  'A W1-A-B ? 1.0',
  'A W2-A-B ? 1.0',
  'A W1-W2-B ? 1.0',
].join('\n');

/** Free pair at distance: long weak ties off the control baseline. */
const DISTANT_PAIR_INPUT = [
  '.2D',
  FIXED_A,
  FIXED_B,
  'C F1 500 3 0',
  'C F2 520 4 0',
  'D A-F1 ? 0.003',
  'D B-F1 ? 0.003',
  'D A-F2 ? 0.003',
  'D F1-F2 ? 0.003',
  'A F1-A-B ? 1.0',
].join('\n');

/** Redundant ring: closed loop of free stations with cross-ties. */
const REDUNDANT_RING_INPUT = [
  '.2D',
  FIXED_A,
  FIXED_B,
  'C K1 30 25 0',
  'C K2 70 25 0',
  'C K3 70 55 0',
  'C K4 30 55 0',
  'D A-K1 ? 0.003',
  'D K1-K2 ? 0.003',
  'D K2-K3 ? 0.003',
  'D K3-K4 ? 0.003',
  'D K4-K1 ? 0.003',
  'D K1-K3 ? 0.003',
  'D K3-B ? 0.003',
  'A K1-A-K2 ? 1.0',
  'A K3-K1-K2 ? 1.0',
].join('\n');

/** Datum-defect chain: no fixed controls (rank deficient by design). */
const FLOATING_CHAIN_INPUT = [
  '.2D',
  'C F1 0 0 0',
  'C F2 50 10 0',
  'C F3 100 0 0',
  'D F1-F2 ? 0.003',
  'D F2-F3 ? 0.003',
  'A F2-F1-F3 ? 1.0',
].join('\n');

/** Free collinear pair: datum plus transverse weakness. */
const FREE_PAIR_INPUT = [
  '.2D',
  'C V1 0 0 0',
  'C V2 100 0.1 0',
  'D V1-V2 ? 0.003',
].join('\n');

const spec = (
  id: string,
  family: Phase8a5CorpusFamily,
  input: string,
  note: string,
  extra: Partial<Phase8a5GeneratedSpec> = {},
): Phase8a5GeneratedSpec => ({
  id,
  family,
  input,
  coordMode: '2D',
  robustMode: 'none',
  tsCorrelationEnabled: false,
  expectedKind: 'eligible-2d',
  note,
  ...extra,
});

/** Builds the full deterministic generated corpus (anchors merged by the test). */
export const buildPhase8a5GeneratedCorpus = (): Phase8a5GeneratedSpec[] => {
  const cases: Phase8a5GeneratedSpec[] = [];
  const chainSizes: Array<{ free: number; label: string }> = [
    { free: 8, label: '008' },
    { free: 16, label: '016' },
    { free: 32, label: '032' },
    { free: 48, label: '048' },
    { free: 64, label: '064' },
    { free: 96, label: '096' },
    { free: 128, label: '128' },
    { free: 256, label: '256' },
  ];
  for (const size of chainSizes) {
    cases.push(
      spec(
        `p-size-chain-${size.label}`,
        'size-chain',
        buildChainStarInput(size.free),
        `chain-star size ladder, ${size.free * 2} unknowns`,
      ),
    );
  }
  const gpsSizes = [
    { free: 4, label: '008' },
    { free: 8, label: '016' },
    { free: 16, label: '032' },
    { free: 32, label: '064' },
  ];
  for (const size of gpsSizes) {
    cases.push(
      spec(
        `p-size-gps-${size.label}`,
        'size-gps',
        buildGpsNetworkInput(size.free),
        `gps size ladder, ${size.free * 2} unknowns`,
      ),
    );
  }
  cases.push(
    spec('p-weight-tight', 'weight-sweep', buildChainStarInput(4, 0.001, 0.5), 'tight distance+angle sigmas'),
    spec('p-weight-loose-dist', 'weight-sweep', buildChainStarInput(4, 0.05, 1.0), 'loose distance sigma'),
    spec('p-weight-loose-angle', 'weight-sweep', buildChainStarInput(4, 0.003, 5.0), 'loose angle sigma'),
    spec('p-weight-mixed', 'weight-sweep', buildChainStarInput(8, 0.01, 2.0), 'mixed mid sigmas, 8 unknowns'),
    spec('p-weight-loose-both', 'weight-sweep', buildChainStarInput(4, 0.05, 5.0), 'loose distance and angle sigmas'),
    spec('p-cond-resection-weak', 'condition', WEAK_RESECTION_INPUT, 'distant rover off a short baseline'),
    spec('p-cond-collinear', 'condition', COLLINEAR_INPUT, 'near-collinear corridor, distances only'),
    spec('p-cond-angle-only', 'condition', ANGLE_ONLY_INPUT, 'angles only, weak scale'),
    spec('p-cond-single-tie', 'condition', SINGLE_TIE_INPUT, 'single distance for two unknowns'),
    spec('p-cond-narrow-brace', 'condition', NARROW_BRACE_INPUT, 'quad with very short height'),
    spec('p-cond-distant-pair', 'condition', DISTANT_PAIR_INPUT, 'far pair on long weak ties'),
    spec('p-braced-quad', 'redundant', BRACED_QUAD_INPUT, 'well-redundant braced quad'),
    spec('p-chain-branch', 'redundant', CHAIN_BRANCH_INPUT, 'chain with branch spur'),
    spec('p-redundant-star', 'redundant', REDUNDANT_STAR_INPUT, 'small geometry, doubled ties'),
    spec('p-redundant-ring', 'redundant', REDUNDANT_RING_INPUT, 'closed loop with cross-ties'),
    spec('p-mixed-dag', 'redundant', buildChainStarInput(6, 0.002, 0.8), 'dense small star, 6 unknowns'),
    spec('p-rank-floating', 'rank-experimental', FLOATING_CHAIN_INPUT, 'no fixed controls; datum defect', {
      expectedKind: 'experimental-rank',
    }),
    spec('p-rank-free-pair', 'rank-experimental', FREE_PAIR_INPUT, 'free pair; datum plus transverse weakness', {
      expectedKind: 'experimental-rank',
    }),
    spec('p-excl-3d', 'exclusion', SMALL_3D_INPUT, '3D planning geometry', {
      coordMode: '3D',
      expectedKind: 'experimental-3d',
    }),
    spec('p-excl-gps-cov', 'exclusion', GPS_COV_INPUT, 'full GPS covariance weighting', {
      expectedKind: 'experimental-gps-covariance',
    }),
    spec('p-excl-robust', 'exclusion', buildChainStarInput(4), 'robust reweighting requested', {
      robustMode: 'huber',
      expectedKind: 'ineligible-robust',
    }),
    spec('p-excl-tscorr', 'exclusion', buildChainStarInput(4), 'TS correlation requested', {
      tsCorrelationEnabled: true,
      expectedKind: 'ineligible-ts-correlation',
    }),
  );
  return cases;
};
