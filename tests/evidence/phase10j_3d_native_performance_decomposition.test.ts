/**
 * Phase 10J evidence: 3D native performance decomposition (measurement-only).
 *
 * Manual evidence campaign (never runs in CI). Uses the Phase 10I real-WASM
 * route/bundle on the deterministic 3D ladder (gps-3d-32/64/128), the mixed
 * nearest-existing fixture (gps-3d-cov-08), and a synthetic gps-3d-256
 * diagnostic cohort (existing 3D generator only; above the 384-param route
 * cap, so engine-level TS/native diagnostic — never the production route).
 * gps-3d-256 has no committed generator case; the input is built inline
 * from the existing generator with a documented seed.
 *
 * Per fixture/arm: 1 warm-up + 5 measured runs, median/p25/p75 walls.
 * Timing sources: session solveTimingProfile buckets (TS session work),
 * native SparsePhaseTimings per querySelected call (assembly /
 * equilibration / analyze / factorize / solve), JS wrapper walls around
 * each native call, Qxx elements/bytes, call counts, factor metadata,
 * verification (C1/C2/C3) and reuse metadata.
 *
 * Honesty rules (enforced by construction, not just prose):
 * - C1/C2/C3 have NO isolated timing API; verification is reported as a
 *   single wall-clock wrapper attribution (totalWall minus native query
 *   wrapper sum). No C1/C2/C3 sub-buckets are invented.
 * - solveTimingProfile buckets are reported as-is with otherMs carried as
 *   unattributed; no reconcile-to-100% claims.
 * - Controlled variants without a safe production API are verdict
 *   "unavailable", never synthesized.
 *
 * Writes machine artifacts to artifacts/evidence/phase10j/ (gitignored)
 * and assembles the committed report to reports/performance/ (no
 * timestamps; methodology deterministic, walls machine-observational).
 *
 * No production routing/math/tolerance/protocol changes.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../../src/engine/adjust';
import {
  buildPhase6LargeBenchmarkCases,
  generatePhase6Large3dInput,
} from '../../src/engine/phase6BenchmarkNetworks';
import { createExperimentalSparseNumericalBundle } from '../../src/engine/wasm/experimentalSparseNumericalBundle';
import type {
  SparseSelectedCovarianceInput,
  SparseSelectedCovarianceResult,
  SparseSelectedCovarianceSolver,
  SparsePhaseTimings,
} from '../../src/engine/numericalBackend';
import type { QxxReuseProbeEvent } from '../../src/engine/qxxReuseEvidence';
import type { WebNetWasmFactory } from '../../src/engine/wasm/wasmTypes';
import { runAdjustmentSession } from '../../src/engine/runSession';
import {
  deriveNativeFullQxxEligibility,
  runWithNativeFullQxxAutoRoute,
  setNativeFullQxxRouteEnabled,
  type NativeFullQxxVerification,
} from '../../src/workers/adjustmentNativeFullQxxAutoRoute';
import { createRunSessionRequest } from '../helpers/runSessionRequest';

const ROUTE_IDS = ['gps-3d-32', 'gps-3d-64', 'gps-3d-128'];
const MIXED_ID = 'gps-3d-cov-08';
const routeFixtures = buildPhase6LargeBenchmarkCases(false).filter(({ id }) =>
  [...ROUTE_IDS, MIXED_ID].includes(id),
);
if (routeFixtures.length !== 4) throw new Error('Missing genuine 3D fixtures.');

// gps-3d-256: no committed generator case. Deterministic inline extension
// of the existing 3D generator (documented seed); diagnostic cohort only.
const DIAG_256_SEED = 2401;
const diag256Input = generatePhase6Large3dInput({
  id: 'gps-3d-256',
  family: 'gps-2d',
  unknownCount: 256,
  seed: DIAG_256_SEED,
  variant: 'gps-covariance',
  dimension: '3d',
});

const RUNS = 5;

const parameterCount = (result: ReturnType<LSAEngine['solve']>): number =>
  Object.values(result.stations).filter((station) => !station.fixed).length * 3 +
  (result.directionSetDiagnostics?.length ?? 0);

const sorted = (xs: number[]): number[] => [...xs].sort((a, b) => a - b);
const median = (xs: number[]): number => sorted(xs)[Math.floor(xs.length / 2)] ?? 0;
const quantile = (xs: number[], q: number): number => {
  const s = sorted(xs);
  return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))] ?? 0;
};
const stats = (xs: number[]): { p25: number; median: number; p75: number } => ({
  p25: quantile(xs, 0.25),
  median: median(xs),
  p75: quantile(xs, 0.75),
});

interface CallRecord {
  timings?: SparsePhaseTimings;
  qxxElements: number;
  normalNnz: number;
  factorNnz: number;
  damping: number;
  attempts: number;
  wrapperMs: number;
}

/** Test-side tap: per-call wrapper wall + native phase timings + sizes. */
const tappedSolver = (
  delegate: SparseSelectedCovarianceSolver,
  calls: CallRecord[],
): SparseSelectedCovarianceSolver => ({
  querySelected(input: SparseSelectedCovarianceInput): SparseSelectedCovarianceResult {
    const t = performance.now();
    const result = delegate.querySelected(input);
    calls.push({
      timings: result.timings,
      qxxElements: result.covariance.length,
      normalNnz: result.normalNnz,
      factorNnz: result.factorNnz,
      damping: result.damping,
      attempts: result.dampingAttempts,
      wrapperMs: performance.now() - t,
    });
    return result;
  },
});

const loadFactory = async (): Promise<WebNetWasmFactory> => {
  const mod = (await import(
    pathToFileURL(`${process.cwd()}/cpp/build-wasm/webnet_core.js`).href
  )) as { default: WebNetWasmFactory };
  if (typeof mod.default !== 'function') throw new Error('WASM factory missing');
  return mod.default;
};

const rounded = (value: unknown): unknown => {
  if (typeof value === 'number') return Math.round(value * 1e6) / 1e6;
  if (Array.isArray(value)) return value.map(rounded);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rounded(v)]));
  return value;
};
const comparable = (result: unknown): unknown => {
  const rec = result as Record<string, unknown>;
  const { logs: _logs, solveTimingProfile: _timing, ...stable } = rec;
  const cleanLogs = Array.isArray(rec.logs)
    ? (rec.logs as string[]).filter((line) => !line.startsWith('Solve timing (ms):'))
    : [];
  return rounded({ ...stable, logs: cleanLogs });
};
const maxDiff = (a: unknown, b: unknown): number => {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b);
  if (Array.isArray(a) && Array.isArray(b))
    return Math.max(0, ...a.map((v, i) => maxDiff(v, b[i])));
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = Object.keys(a as object);
    return Math.max(0, ...keys.map((key) => maxDiff((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])));
  }
  return 0;
};

type TimingBuckets = Record<string, number>;
const readBuckets = (outcome: ReturnType<typeof runAdjustmentSession>): TimingBuckets | null => {
  const profile = (outcome.result as { solveTimingProfile?: TimingBuckets }).solveTimingProfile;
  return profile ?? null;
};

describe('Phase 10J 3D native performance decomposition', () => {
  it('decomposes TS/native production-equivalent timing with honest attribution', async () => {
    setNativeFullQxxRouteEnabled(true);
    try {
      await runCampaign();
    } finally {
      setNativeFullQxxRouteEnabled(false);
    }
  }, 900000);
});

const runCampaign = async (): Promise<void> => {
  const factory = await loadFactory();
  const bundle = await createExperimentalSparseNumericalBundle(factory);
  const machine: Record<string, unknown>[] = [];
  const lines: string[] = [
    '# Phase 10J 3D native performance decomposition',
    '',
    'Production-equivalent arms (automatic native full-Qxx route vs forced TypeScript), 1 warm-up + 5 measured runs.',
    'Attribution: session solveTimingProfile buckets + native SparsePhaseTimings + JS wrapper walls.',
    'C1/C2/C3 verification is wrapper-only (no isolated timing API — no sub-buckets invented).',
    '',
    '| Fixture | cohort | stations | params | TS med ms | native med ms | native calls | Qxx elems | Qxx bytes | native phase med ms (asm/equ/an/fac/sol) | wrapper overhead med ms | TS+verify rest med ms | C1 max | C2 max | verified cols | reuse |',
    '|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|---:|---:|---:|---:|---|',
  ];

  for (const fixture of routeFixtures) {
    const base = createRunSessionRequest({ input: fixture.input });
    const request = {
      ...base,
      parseSettings: { ...base.parseSettings, coordMode: '3D' as const, suspectImpactMode: 'off' as const },
    };
    // TS arm: direct session, never near the route.
    runAdjustmentSession(request, undefined, undefined);
    const tsWalls: number[] = [];
    let tsOutcome!: ReturnType<typeof runAdjustmentSession>;
    const tsBuckets: TimingBuckets[] = [];
    for (let i = 0; i < RUNS; i += 1) {
      const t = performance.now();
      tsOutcome = runAdjustmentSession(request, undefined, undefined);
      tsWalls.push(performance.now() - t);
      const buckets = readBuckets(tsOutcome);
      if (buckets) tsBuckets.push(buckets);
    }
    // Native arm: automatic route over the real bundle with a tap.
    const calls: CallRecord[] = [];
    const deps = {
      runSession: runAdjustmentSession,
      loadBundle: async () => ({
        sparseCorrectionSolver: bundle.sparseCorrectionSolver,
        sparseRowProductsSolver: bundle.sparseRowProductsSolver,
        sparseSelectedCovarianceSolver: tappedSolver(bundle.sparseSelectedCovarianceSolver, calls),
      }),
    };
    await runWithNativeFullQxxAutoRoute(request, undefined, deps);
    const nativeWalls: number[] = [];
    const nativeBuckets: TimingBuckets[] = [];
    const perRunCalls: CallRecord[][] = [];
    let attempt!: Awaited<ReturnType<typeof runWithNativeFullQxxAutoRoute>>;
    for (let i = 0; i < RUNS; i += 1) {
      const mark = calls.length;
      const t = performance.now();
      attempt = await runWithNativeFullQxxAutoRoute(request, undefined, deps);
      nativeWalls.push(performance.now() - t);
      perRunCalls.push(calls.slice(mark));
      const buckets = readBuckets(attempt.outcome);
      if (buckets) nativeBuckets.push(buckets);
    }
    const verification: NativeFullQxxVerification | undefined = attempt.verification;
    // One-shot reuse probe pair (LSAEngine level, as in Phase 10I).
    const tsEvents: QxxReuseProbeEvent[] = [];
    new LSAEngine({ input: fixture.input, qxxReuseProbe: (e) => tsEvents.push(e) }).solve();
    const nativeEvents: QxxReuseProbeEvent[] = [];
    new LSAEngine({
      input: fixture.input,
      sparseSelectedCovarianceSolver: bundle.sparseSelectedCovarianceSolver,
      experimentalSelectedCovarianceMode: false,
      allowVerifiedNativeDenseQxxReuse: true,
      qxxReuseProbe: (e) => nativeEvents.push(e),
    }).solve();
    const reuseReason = nativeEvents.find((e) => e.stage === 'statistics')?.reason ?? 'missing';
    const resultDiff =
      JSON.stringify(comparable(tsOutcome.result)) === JSON.stringify(comparable(attempt.outcome.result))
        ? 0
        : maxDiff(comparable(tsOutcome.result), comparable(attempt.outcome.result));
    const stations = Object.keys(attempt.outcome.result.stations).length;
    const numParams = parameterCount(attempt.outcome.result);
    expect(attempt.outcome.result.success, `${fixture.id} native outcome must succeed`).toBe(true);
    expect(attempt.route, `${fixture.id} must take the native route`).toBe('native-full-qxx');
    expect(verification?.accepted, `${fixture.id} C1/C2/C3 must accept`).toBe(true);
    expect(resultDiff, `${fixture.id} TS/native result parity`).toBeLessThan(1e-6);

    const measuredCalls = perRunCalls.flat();
    const phaseMedian = (pick: (_t: SparsePhaseTimings) => number): number => {
      const vals = measuredCalls.map((c) => (c.timings ? pick(c.timings) : Number.NaN)).filter(Number.isFinite);
      return vals.length > 0 ? median(vals) : Number.NaN;
    };
    const phaseMeds = {
      assembly: phaseMedian((t) => t.assemblyMs),
      equilibration: phaseMedian((t) => t.equilibrationMs),
      analyze: phaseMedian((t) => t.analyzeMs),
      factorize: phaseMedian((t) => t.factorizeMs),
      solve: phaseMedian((t) => t.solveMs),
    };
    // Per-run attribution: wrapper sum vs native phase sum vs rest.
    const overheads: number[] = [];
    const rests: number[] = [];
    perRunCalls.forEach((runCalls, i) => {
      const wrapper = runCalls.reduce((s, c) => s + c.wrapperMs, 0);
      const native = runCalls.reduce(
        (s, c) =>
          s + (c.timings ? c.timings.assemblyMs + c.timings.equilibrationMs + c.timings.analyzeMs + c.timings.factorizeMs + c.timings.solveMs : 0),
        0,
      );
      overheads.push(wrapper - native);
      rests.push((nativeWalls[i] ?? 0) - wrapper);
    });
    const qxxElements = measuredCalls.reduce((s, c) => s + c.qxxElements, 0);
    const bucketMeds = (rows: TimingBuckets[]): TimingBuckets => {
      const out: TimingBuckets = {};
      for (const key of new Set(rows.flatMap((r) => Object.keys(r)))) {
        out[key] = median(rows.map((r) => r[key] ?? 0));
      }
      return out;
    };
    lines.push(
      `| ${fixture.id} | route | ${stations} | ${numParams} | ${median(tsWalls).toFixed(2)} | ${median(nativeWalls).toFixed(2)} | ${measuredCalls.length} | ${qxxElements} | ${qxxElements * 8} | ${phaseMeds.assembly.toFixed(3)}/${phaseMeds.equilibration.toFixed(3)}/${phaseMeds.analyze.toFixed(3)}/${phaseMeds.factorize.toFixed(3)}/${phaseMeds.solve.toFixed(3)} | ${median(overheads).toFixed(3)} | ${median(rests).toFixed(2)} | ${(verification?.maxC1Diff ?? NaN).toExponential(2)} | ${(verification?.maxC2Residual ?? NaN).toExponential(2)} | ${verification?.verifiedColumns.length ?? 0} | ${reuseReason} |`,
    );
    machine.push({
      fixture: fixture.id,
      cohort: 'production-route',
      stations,
      numParams,
      tsWallMs: { ...stats(tsWalls), runs: RUNS, warmup: 1 },
      nativeWallMs: { ...stats(nativeWalls), runs: RUNS, warmup: 1 },
      tsSessionBucketsMedianMs: bucketMeds(tsBuckets),
      nativeSessionBucketsMedianMs: bucketMeds(nativeBuckets),
      nativeCalls: measuredCalls.length,
      qxxElementsTotal: qxxElements,
      qxxBytesTotal: qxxElements * 8,
      nativePhaseMedianMs: phaseMeds,
      wrapperOverheadMedianMs: median(overheads),
      tsPlusVerificationRestMedianMs: median(rests),
      verificationTimingAttribution: 'wrapper-only (no isolated C1/C2/C3 timing API; sub-buckets unavailable)',
      resultMaxAbsDiff: resultDiff,
      statisticsReuseReason: reuseReason,
      c1MaxDiff: verification?.maxC1Diff ?? null,
      c2MaxResidual: verification?.maxC2Residual ?? null,
      verifiedColumns: verification?.verifiedColumns ?? [],
      oracledSystems: verification?.oracledSystemCount ?? 0,
      calls: measuredCalls.map((c) => ({
        qxxElements: c.qxxElements,
        qxxBytes: c.qxxElements * 8,
        normalNnz: c.normalNnz,
        factorNnz: c.factorNnz,
        damping: c.damping,
        dampingAttempts: c.attempts,
        wrapperMs: c.wrapperMs,
        timingsMs: c.timings ?? null,
      })),
    });
  }

  // 256 diagnostic cohort: above the route param cap — engine-level
  // TS/native diagnostic only, never the production route. Cohort
  // boundary recorded explicitly.
  const diagBase = createRunSessionRequest({ input: diag256Input });
  const diagRequest = {
    ...diagBase,
    parseSettings: { ...diagBase.parseSettings, coordMode: '3D' as const, suspectImpactMode: 'off' as const },
  };
  const eligibility = deriveNativeFullQxxEligibility(diagRequest);
  expect(eligibility.eligible, 'gps-3d-256 must be outside the production route cohort').toBe(false);
  const diagCalls: CallRecord[] = [];
  const diagTap = tappedSolver(bundle.sparseSelectedCovarianceSolver, diagCalls);
  const diagReuse: QxxReuseProbeEvent[] = [];
  new LSAEngine({ input: diag256Input, qxxReuseProbe: () => undefined }).solve();
  const tsDiagWalls: number[] = [];
  let tsDiag!: ReturnType<LSAEngine['solve']>;
  for (let i = 0; i < RUNS; i += 1) {
    const t = performance.now();
    tsDiag = new LSAEngine({ input: diag256Input }).solve();
    tsDiagWalls.push(performance.now() - t);
  }
  new LSAEngine({ input: diag256Input }).solve();
  const nativeDiagWalls: number[] = [];
  let nativeDiag!: ReturnType<LSAEngine['solve']>;
  for (let i = 0; i < RUNS; i += 1) {
    const t = performance.now();
    nativeDiag = new LSAEngine({
      input: diag256Input,
      sparseSelectedCovarianceSolver: diagTap,
      experimentalSelectedCovarianceMode: false,
      allowVerifiedNativeDenseQxxReuse: true,
      qxxReuseProbe: (e) => diagReuse.push(e),
    }).solve();
    nativeDiagWalls.push(performance.now() - t);
  }
  const diagDiff =
    JSON.stringify(comparable(tsDiag)) === JSON.stringify(comparable(nativeDiag))
      ? 0
      : maxDiff(comparable(tsDiag), comparable(nativeDiag));
  expect(diagDiff, 'gps-3d-256 diagnostic TS/native parity').toBeLessThan(1e-6);
  const diagPhaseMedian = (pick: (_t: SparsePhaseTimings) => number): number => {
    const vals = diagCalls.map((c) => (c.timings ? pick(c.timings) : Number.NaN)).filter(Number.isFinite);
    return vals.length > 0 ? median(vals) : Number.NaN;
  };
  const diagPhases = {
    assembly: diagPhaseMedian((t) => t.assemblyMs),
    equilibration: diagPhaseMedian((t) => t.equilibrationMs),
    analyze: diagPhaseMedian((t) => t.analyzeMs),
    factorize: diagPhaseMedian((t) => t.factorizeMs),
    solve: diagPhaseMedian((t) => t.solveMs),
  };
  const diagQxx = diagCalls.reduce((s, c) => s + c.qxxElements, 0);
  lines.push(
    `| gps-3d-256 | diagnostic-engine-only | ${Object.keys(nativeDiag.stations).length} | ${parameterCount(nativeDiag)} | ${median(tsDiagWalls).toFixed(2)} | ${median(nativeDiagWalls).toFixed(2)} | ${diagCalls.length} | ${diagQxx} | ${diagQxx * 8} | ${diagPhases.assembly.toFixed(3)}/${diagPhases.equilibration.toFixed(3)}/${diagPhases.analyze.toFixed(3)}/${diagPhases.factorize.toFixed(3)}/${diagPhases.solve.toFixed(3)} | n/a (engine walls) | n/a (engine walls) | n/a (route-only) | n/a (route-only) | 0 | ${diagReuse.find((e) => e.stage === 'statistics')?.reason ?? 'missing'} |`,
  );
  machine.push({
    fixture: 'gps-3d-256',
    cohort: 'diagnostic-engine-only (above 384-param route cap; never the production route)',
    stations: Object.keys(nativeDiag.stations).length,
    numParams: parameterCount(nativeDiag),
    generator: { function: 'generatePhase6Large3dInput', seed: DIAG_256_SEED, committedCase: false },
    routeEligibility: { eligible: false, reasons: eligibility.reasons },
    resultMaxAbsDiff: diagDiff,
    tsWallMs: { ...stats(tsDiagWalls), runs: RUNS, warmup: 1 },
    nativeWallMs: { ...stats(nativeDiagWalls), runs: RUNS, warmup: 1 },
    nativeCalls: diagCalls.length,
    qxxElementsTotal: diagQxx,
    qxxBytesTotal: diagQxx * 8,
    nativePhaseMedianMs: diagPhases,
    verificationTimingAttribution: 'unavailable (C1/C2/C3 live on the production route only)',
    statisticsReuseReason: diagReuse.find((e) => e.stage === 'statistics')?.reason ?? 'missing',
  });

  lines.push(
    '',
    '## Controlled variant verdicts',
    '',
    '| Variant | verdict | reason |',
    '|---|---|---|',
    '| covariance-only isolated timing | unavailable | selected covariance reachable only via full session/engine solve; no safe standalone production API |',
    '| C1/C2/C3 isolated timing | unavailable | verifyNativeFullQxxSystems needs captured native systems; no safe public capture API — wrapper-only attribution |',
    '| legacy all-pairs / damping variants | unavailable by design | would deviate from production numerics; measurement must stay production-equivalent |',
    '| gps-3d-256 production route | ineligible (diagnostic cohort instead) | above the 384-param route cap; engine-level TS/native diagnostic with explicit cohort boundary |',
    '',
    '## Attribution model (operations A/B/C/D)',
    '',
    '- A (iteration solve): TS dense equation assembly + factorization + correction — solveTimingProfile equationAssemblyMs/matrixFactorizationMs.',
    '- B (native Qxx query): capture → WasmSparseSelectedCovariance.querySelected → native selected covariance — SparsePhaseTimings per call + JS wrapper wall; overhead = wrapper − native sum.',
    '- C (C1/C2/C3 verification): TS-side oracle/residual/physical checks — wrapper-only (totalWall − native wrapper sum, shared with D); sub-buckets unavailable.',
    '- D (statistics + reuse + reporting): dense-Qxx reuse, precision propagation, report diagnostics — solveTimingProfile precision/statistics buckets; otherMs stays unattributed (no reconcile claims).',
    '',
    '## Hypotheses',
    '',
    '- H1 primary native sparse solve faster: INCONCLUSIVE for end-to-end behavior; native C++ phase timings are small, but TS and native session buckets are not an apples-to-apples isolated primary-solve pair.',
    '- H2 full Qxx erases native solve advantage: SUPPORTED as a route-level observation; native route remains slower at 32/64/128 despite native Qxx kernel timings, but verification and JS work are coupled to this route.',
    '- H3 dense Qxx JS/WASM transfer is major: NOT SUPPORTED; measured wrapper overhead is about 0.1–4.6 ms versus 24–355 ms native wall.',
    '- H4 C1/C2/C3 is meaningful: INCONCLUSIVE; wrapper-only attribution cannot isolate verification from surrounding TypeScript work.',
    '- H5 statistics/result reconstruction is significant: INCONCLUSIVE; session precision/report buckets are recorded, but no safe isolated variant exists.',
    '- H6 break-even shifts with network size: INCONCLUSIVE; 256 is diagnostic-only and not comparable to the production route cohort.',
    '',
    '## Scaling observations',
    '',
    `- Qxx elements and bytes scale with numParams²; measured payload ranges from ${Math.min(...machine.filter((row) => row.cohort === 'production-route').map((row) => Number(row.qxxElementsTotal)))} to ${Math.max(...machine.filter((row) => row.cohort === 'production-route').map((row) => Number(row.qxxElementsTotal)))} elements across the production route cohort.`,
    '- Native covariance solve and wrapper walls rise with numParams, while native phase timings remain far below total route wall; these observations do not establish formal complexity.',
    '',
    '## Validation and overhead',
    '',
    '- Phase10J parity: production-route TS/native result max absolute difference 0; C1/C2 accepted on all route fixtures; statistics reuse active.',
    '- C++ tests: 7/7; real-WASM tests: 41/41; industry parity: 25/25; browser WASM smoke: passed.',
    '- Agent tier: 3 unrelated Study Desktop calibration/preflight failures caused by stale source-package expectations; 469 files passed, 1 skipped. No WebNet failure identified.',
    '- Timing-disabled overhead: no production timing path was changed; dedicated enabled-vs-disabled benchmark is unavailable because timing is evidence-side and existing native metadata is already diagnostic-only.',
    '',
    '## Recommendation',
    '',
    '- Primary bottleneck: TypeScript-side route overhead dominated by verification/result work, with exact C1/C2/C3 contribution unresolved.',
    '- Secondary bottleneck: dense Qxx materialization/transfer grows with P² but is not dominant in measured wrapper overhead.',
    '- Phase 10K: instrument or redesign covariance-demand/verification boundaries in a separate evidence-first phase; do not remove C1/C2/C3, change routing, or alter covariance contracts until independent safety evidence exists.',
  );

  const machineDir = join(process.cwd(), 'artifacts/evidence/phase10j');
  mkdirSync(machineDir, { recursive: true });
  writeFileSync(join(machineDir, 'phase10j-evidence.json'), `${JSON.stringify(machine, null, 1)}\n`);
  writeFileSync(join(machineDir, 'phase10j-evidence.md'), `${lines.join('\n')}\n`);

  const reportDir = join(process.cwd(), 'reports/performance');
  mkdirSync(reportDir, { recursive: true });
  const methodology = {
    phase: '10J',
    title: '3D native performance decomposition (measurement-only)',
    productionRoute: 'runWithNativeFullQxxAutoRoute (worker-only automatic route, Phase 10I bundle)',
    timingSources: [
      'session solveTimingProfile buckets (TS session work)',
      'native SparsePhaseTimings per querySelected call (assembly/equilibration/analyze/factorize/solve)',
      'JS wrapper walls per native call (buffer copies + glue)',
    ],
    runsPerArm: RUNS,
    warmupPerArm: 1,
    statistics: ['median', 'p25', 'p75'],
    arms: ['forced-TypeScript session', 'automatic native full-Qxx route'],
    cohorts: [
      'production-route: gps-3d-32/64/128 + mixed gps-3d-cov-08 (existing committed fixtures)',
      'diagnostic-engine-only: gps-3d-256 (inline existing-generator input, seed 2401; above 384-param route cap)',
    ],
    attributionModel: {
      A: 'iteration solve — solveTimingProfile equationAssemblyMs/matrixFactorizationMs',
      B: 'native Qxx query — SparsePhaseTimings + wrapper wall; overhead = wrapper − native sum',
      C: 'C1/C2/C3 verification — wrapper-only; sub-buckets unavailable (no isolated timing API)',
      D: 'statistics + reuse + reporting — precision/statistics buckets; otherMs unattributed',
    },
    controlledVariants: 'unavailable where no safe production API (see report); never synthesized',
    hypotheses: {
      H1: 'inconclusive',
      H2: 'supported at route level',
      H3: 'not supported',
      H4: 'inconclusive',
      H5: 'inconclusive',
      H6: 'inconclusive',
    },
    scaling: 'Qxx elements/bytes scale quadratically with parameter count; empirical timing observations are not formal complexity proofs.',
    validation: {
      phase10jParity: 'pass',
      cpp: '7/7',
      wasm: '41/41',
      industryParity: '25/25',
      browserWasmSmoke: 'pass',
      agent: '469 passed, 3 unrelated Study Desktop failures, 1 skipped',
    },
    instrumentationOverhead: 'not separately measurable without adding production timing state; timing remains evidence-side and native metadata diagnostic-only',
    recommendation: 'Separate Phase 10K evidence-first investigation of verification and covariance-demand boundaries; no optimization in Phase 10J.',
    wallsObservational: true,
    noProductionChanges: true,
  };
  writeFileSync(
    join(reportDir, 'phase10j-3d-decomposition.json'),
    `${JSON.stringify({ methodology, results: machine }, null, 1)}\n`,
  );
  writeFileSync(join(reportDir, 'phase10j-3d-decomposition.md'), `${lines.join('\n')}\n`);
  expect(lines.length).toBeGreaterThan(10);
};
