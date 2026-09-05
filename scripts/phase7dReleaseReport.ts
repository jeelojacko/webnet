/**
 * Phase 7D release-hardening report (deterministic, test-only, no routing).
 *
 * Re-derives the release contract gates (63/64/65 boundary, kill-switch
 * default, session exclusions, verifier empty/truncation/warn-only gates,
 * sparse-vs-TypeScript condition parity on chain-2d-08) and writes
 * machine-readable JSON plus a human-readable Markdown summary under
 * reports/phase7d/. No wall-clock fields: reruns are byte-identical.
 *
 * Note: the shared test request helper is not imported here because it
 * pulls `?raw` fixture imports that only resolve under vite/vitest. The
 * minimal builder below mirrors its values; every report input is passed
 * explicitly so DEFAULT_INPUT is never read.
 *
 * Usage: `npm run phase7d:release-report`
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { ParseSettings } from '../src/appStateTypes';
import { DEFAULT_CANADA_CRS_ID } from '../src/engine/crsCatalog';
import {
  DEFAULT_QFIX_ANGULAR_SIGMA_SEC,
  DEFAULT_QFIX_LINEAR_SIGMA_M,
  DEFAULT_S9_INSTRUMENT_CENTERING_HORIZ_M,
} from '../src/engine/defaults';
import { PHASE7B7_RELATIVE_TOLERANCE } from '../src/engine/phase7b7FullContract';
import { generatePhase5BenchmarkInput } from '../src/engine/phase5BenchmarkNetworks';
import { DEFAULT_PLANNING_MAP_STATE } from '../src/engine/planningMapState';
import { runAdjustmentSession } from '../src/engine/runSession';
import type { RunSessionRequest } from '../src/engine/runSessionTypes';
import type { InstrumentLibrary } from '../src/types';
import {
  deriveSparseAutoRouteEligibility,
  isSparseAutoRouteEnabled,
  SPARSE_AUTO_ROUTE_MAX_CAPTURED_SYSTEMS,
  SPARSE_AUTO_ROUTE_MAX_UNKNOWN_COUNT,
  SparseAutoRouteCaptureSolver,
  verifySparseAutoRouteSystems,
} from '../src/workers/adjustmentSparseAutoRoute';
import {
  countingCorrectionSolver,
  countingCovarianceSolver,
  countingRowProductsSolver,
} from '../tests/helpers/sparseTestStubs';

const buildRequest = (input: string): RunSessionRequest => {
  const instruments: InstrumentLibrary = {
    S9: {
      code: 'S9',
      desc: 'industry standard S9 0.5"',
      edm_const: 0.001,
      edm_ppm: 1,
      hzPrecision_sec: 0.5,
      dirPrecision_sec: 0.5,
      azBearingPrecision_sec: 0.5,
      vaPrecision_sec: 0.5,
      instCentr_m: DEFAULT_S9_INSTRUMENT_CENTERING_HORIZ_M,
      tgtCentr_m: 0,
      vertCentr_m: 0,
      elevDiff_const_m: 0,
      elevDiff_ppm: 0,
      gpsStd_xy: 0,
      levStd_mmPerKm: 0,
    },
  };
  const parseSettings: ParseSettings = {
    solveProfile: 'industry-parity',
    coordMode: '2D',
    coordSystemMode: 'local',
    crsId: DEFAULT_CANADA_CRS_ID,
    localDatumScheme: 'average-scale',
    averageScaleFactor: 1,
    commonElevation: 0,
    averageGeoidHeight: 0,
    gnssVectorFrameDefault: 'gridNEU',
    gnssFrameConfirmed: false,
    verticalDeflectionNorthSec: 0,
    verticalDeflectionEastSec: 0,
    observationMode: { bearing: 'grid', distance: 'measured', angle: 'measured', direction: 'measured' },
    gridBearingMode: 'grid',
    gridDistanceMode: 'measured',
    gridAngleMode: 'measured',
    gridDirectionMode: 'measured',
    runMode: 'adjustment',
    preanalysisMode: false,
    preanalysisAccuracyThresholdMeters: 0.001,
    preanalysisMaxAddedSets: 5,
    clusterDetectionEnabled: false,
    autoSideshotEnabled: true,
    autoAdjustEnabled: false,
    autoAdjustMaxCycles: 3,
    autoAdjustMaxRemovalsPerCycle: 1,
    autoAdjustStdResThreshold: 4,
    suspectImpactMode: 'off',
    order: 'EN',
    angleUnits: 'dms',
    angleStationOrder: 'atfromto',
    angleMode: 'auto',
    deltaMode: 'slope',
    mapMode: 'off',
    mapScaleFactor: 1,
    normalize: true,
    faceNormalizationMode: 'on',
    applyCurvatureRefraction: false,
    refractionCoefficient: 0.13,
    verticalReduction: 'none',
    levelWeight: undefined,
    levelLoopToleranceBaseMm: 0,
    levelLoopTolerancePerSqrtKmMm: 4,
    crsTransformEnabled: false,
    crsProjectionModel: 'legacy-equirectangular',
    crsLabel: '',
    crsGridScaleEnabled: false,
    crsGridScaleFactor: 1,
    crsConvergenceEnabled: false,
    crsConvergenceAngleRad: 0,
    geoidModelEnabled: false,
    geoidModelId: 'NGS-DEMO',
    geoidSourceFormat: 'builtin',
    geoidSourcePath: '',
    geoidInterpolation: 'bilinear',
    geoidHeightConversionEnabled: false,
    geoidOutputHeightDatum: 'orthometric',
    gpsLoopCheckEnabled: false,
    gpsAddHiHtEnabled: false,
    gpsAddHiHtHiM: 0,
    gpsAddHiHtHtM: 0,
    qFixLinearSigmaM: DEFAULT_QFIX_LINEAR_SIGMA_M,
    qFixAngularSigmaSec: DEFAULT_QFIX_ANGULAR_SIGMA_SEC,
    prismEnabled: false,
    prismOffset: 0,
    prismScope: 'global',
    descriptionReconcileMode: 'first',
    descriptionAppendDelimiter: ' | ',
    lonSign: 'west-negative',
    tsCorrelationEnabled: false,
    tsCorrelationRho: 0.25,
    tsCorrelationScope: 'set',
    robustMode: 'none',
    robustK: 1.5,
    parseCompatibilityMode: 'strict',
    parseModeMigrated: true,
  };
  return {
    input,
    lastRunInput: null,
    maxIterations: 10,
    convergenceLimit: 0.01,
    units: 'm',
    parseSettings,
    projectInstruments: instruments,
    selectedInstrument: 'S9',
    projectIncludeFiles: {},
    geoidSourceData: null,
    planningMap: DEFAULT_PLANNING_MAP_STATE,
    excludedIds: [],
    activePreanalysisAdditionIds: [],
    overrides: {},
    approvedClusterMerges: [],
  };
};

const chainRequest = (unknownCount: number, seed: number): RunSessionRequest =>
  buildRequest(
    generatePhase5BenchmarkInput({
      id: `chain-2d-${unknownCount}`,
      family: 'chain-2d',
      unknownCount,
      seed,
    }),
  );

const CHAIN_2D_08 = generatePhase5BenchmarkInput({
  id: 'chain-2d-08',
  family: 'chain-2d',
  unknownCount: 8,
  seed: 1108,
});

const twoDRequest: RunSessionRequest = buildRequest(CHAIN_2D_08);

interface GateCheck {
  id: string;
  claim: string;
  pass: boolean;
  detail: string;
}

const checks: GateCheck[] = [];
const check = (id: string, claim: string, pass: boolean, detail: string): void => {
  checks.push({ id, claim, pass, detail });
};

// 1. Size boundary.
check(
  'boundary-cap',
  'evidence-based cap is exactly 64 unknowns',
  SPARSE_AUTO_ROUTE_MAX_UNKNOWN_COUNT === 64,
  `SPARSE_AUTO_ROUTE_MAX_UNKNOWN_COUNT=${SPARSE_AUTO_ROUTE_MAX_UNKNOWN_COUNT}`,
);
for (const [unknowns, seed, want] of [
  [63, 1163, true],
  [64, 1164, true],
  [65, 1165, false],
] as const) {
  const verdict = deriveSparseAutoRouteEligibility(chainRequest(unknowns, seed));
  check(
    `boundary-${unknowns}`,
    `${unknowns} unknowns ${want ? 'admitted' : 'rejected'}`,
    verdict.eligible === want && verdict.unknownCount === unknowns,
    verdict.reasons.length === 0 ? 'no reasons' : verdict.reasons.join(' | '),
  );
}

// 2. Kill switch default.
check(
  'kill-switch-default',
  'auto-route enabled by default',
  isSparseAutoRouteEnabled(),
  `isSparseAutoRouteEnabled()=${isSparseAutoRouteEnabled()}`,
);

// 3. Session exclusions.
const preanalysis: RunSessionRequest = {
  ...twoDRequest,
  parseSettings: { ...twoDRequest.parseSettings, preanalysisMode: true },
};
const preVerdict = deriveSparseAutoRouteEligibility(preanalysis);
check(
  'exclude-preanalysis',
  'preanalysis sessions rejected',
  !preVerdict.eligible && preVerdict.reasons.includes('preanalysis mode not cleared for sparse auto-route'),
  preVerdict.reasons.join(' | '),
);

const inlineVerdict = deriveSparseAutoRouteEligibility(buildRequest(`${CHAIN_2D_08}\n.AUTOADJUST\n`));
check(
  'exclude-inline-autoadjust',
  'inline .AUTOADJUST directive rejected',
  !inlineVerdict.eligible && inlineVerdict.reasons.join(' ').includes('inline auto-adjust directive'),
  inlineVerdict.reasons.join(' | '),
);

const gpsInput = [
  '.GPS WEIGHT COVARIANCE',
  'C A 500000 0 100 ! ! !',
  'C B 500100 100 90',
  "G0 'session_a.asc",
  'G1 A-B 57.559600 280.508300 184.546200',
  'G2 1.8006862774E-06 8.9217319328E-06 9.4458864623E-06',
  'G3 -3.5520472466E-06 3.5240054785E-06 -8.6638065113E-06',
].join('\n');
const gpsVerdict = deriveSparseAutoRouteEligibility(buildRequest(gpsInput));
check(
  'exclude-gps-covariance',
  'GPS covariance weighting rejected',
  !gpsVerdict.eligible &&
    gpsVerdict.reasons.includes('GPS covariance weighting not cleared for sparse auto-route'),
  gpsVerdict.reasons.join(' | '),
);

// 4. Verifier gates.
const empty = verifySparseAutoRouteSystems([], false, 3, 1);
check(
  'verifier-empty-capture',
  'empty capture rejected',
  !empty.accepted && empty.reasons.join(' ').includes('no correction systems captured'),
  empty.reasons.join(' | '),
);
const truncated = verifySparseAutoRouteSystems([], true, 0, 1);
check(
  'verifier-capture-bound',
  `capture bound pinned at ${SPARSE_AUTO_ROUTE_MAX_CAPTURED_SYSTEMS} systems`,
  !truncated.accepted && truncated.reasons.join(' ').includes('capture truncated'),
  truncated.reasons.join(' | '),
);

// 5. Warn-only condition semantics + condition parity on a real captured run.
const capture = new SparseAutoRouteCaptureSolver(countingCorrectionSolver());
const sparseOutcome = runAdjustmentSession(twoDRequest, undefined, {
  sparseCorrectionSolver: capture,
  sparseRowProductsSolver: countingRowProductsSolver(),
  sparseSelectedCovarianceSolver: countingCovarianceSolver(),
  experimentalSelectedCovarianceMode: true,
  experimentalSelectedCovarianceLegacyAllPairs: true,
});
const reference = runAdjustmentSession(twoDRequest);
const warnOnly = verifySparseAutoRouteSystems(
  capture.systems,
  capture.truncated,
  sparseOutcome.result.iterations,
  sparseOutcome.result.condition?.estimate,
  undefined,
  1,
);
check(
  'condition-warn-only',
  'condition-threshold excess warns without rejecting',
  warnOnly.accepted && warnOnly.warnings.length > 0,
  warnOnly.warnings.join(' | ') || 'no warnings',
);
const expected = reference.result.condition?.estimate;
const actual = sparseOutcome.result.condition?.estimate;
const allowed = PHASE7B7_RELATIVE_TOLERANCE * Math.max(1, Math.abs(expected ?? 0));
const parityPass =
  sparseOutcome.result.success &&
  Number.isFinite(expected ?? NaN) &&
  Number.isFinite(actual ?? NaN) &&
  Math.abs((actual ?? NaN) - (expected ?? NaN)) <= allowed;
check(
  'condition-parity',
  'sparse result.condition agrees with TypeScript within 1e-9 relative',
  parityPass,
  `expected=${expected?.toExponential(3)} actual=${actual?.toExponential(3)} iterations=${sparseOutcome.result.iterations} captured=${capture.systems.length}`,
);

const report = {
  phase: '7D',
  scope: 'release hardening: bounded Phase 7C worker route, no cohort widening, no main merge',
  gates: checks,
  passed: checks.filter((gate) => gate.pass).length,
  total: checks.length,
};

const outDir = path.join(process.cwd(), 'reports', 'phase7d');
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, 'release-hardening.json'), `${JSON.stringify(report, null, 2)}\n`);
const lines = [
  '# Phase 7D release hardening',
  '',
  'Bounded audit of the Phase 7C worker-only sparse route. No cohort widening, no main merge.',
  '',
  `Gates: ${report.passed}/${report.total} passed.`,
  '',
  ...checks.map(
    (gate) => `- [${gate.pass ? 'x' : ' '}] **${gate.id}** — ${gate.claim} (${gate.detail})`,
  ),
  '',
];
writeFileSync(path.join(outDir, 'release-hardening.md'), lines.join('\n'));

const failed = checks.filter((gate) => !gate.pass);
if (failed.length > 0) {
  console.error(`phase7d:release-report: ${failed.length} gate(s) failed`);
  for (const gate of failed) console.error(`  - ${gate.id}: ${gate.detail}`);
  process.exit(1);
}
console.log(`phase7d:release-report: ${report.passed}/${report.total} gates passed`);
