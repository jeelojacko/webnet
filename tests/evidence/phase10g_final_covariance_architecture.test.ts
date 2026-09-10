/**
 * Phase 10G evidence: final-covariance architecture decision campaign.
 *
 * Evidence-only manual campaign (never runs in CI). Uses the Phase 10F
 * corpus (industry_demo terrestrial + gps-3d-cov-08/16/32/64/128 plus an
 * evidence-only synthetic orientation-heavy 3D case derived from
 * gps-3d-16) to measure/reference the final-covariance architecture
 * choice. Per fixture: dense baseline (warm-up + 3 solves, wall median)
 * + reuse probe; demand derived from the real covariance query plan
 * (A all-entry P^2, B legacy all-pairs plan, C selected-network plan;
 * raw/unique counts via buildCovarianceQueryPlan + dedupe); native legs
 * via the real WASM bundle (all-entry Qxx, legacy-all-pairs store,
 * selected-network store, row products) with boundary walls (1+5) +
 * diagnostics + 1e-6 equivalence; semantic audit (mixed/REL-PTOL/TSCORR/
 * robust variants, dense + probe).
 *
 * The campaign fails closed without the real WASM artifact, and every
 * native leg fails on a thrown solve (no exception swallowing). Native
 * phase timings are NOT exposed via the ABI/diagnostics: boundary walls
 * only (stated limitation). Dense baseline uses production automatic Qxx
 * reuse while every native leg fails closed out of reuse; native
 * diagnostics counts are per measured solve only. industry_demo is
 * inadmissible (weak-case observation). Artifacts only to
 * `artifacts/evidence/phase10g/` (gitignored).
 *
 * No production engine changes.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../../src/engine/adjust';
import { buildSolveParameterIndex } from '../../src/engine/adjustmentPreprocessing';
import { buildCovarianceQueryPlan } from '../../src/engine/covarianceQueryPlan';
import { createExperimentalSparseRouteDiagnostics } from '../../src/engine/experimentalSparseDiagnostics';
import { buildPhase6LargeBenchmarkCases } from '../../src/engine/phase6BenchmarkNetworks';
import type { QxxReuseProbeEvent } from '../../src/engine/qxxReuseEvidence';
import {
  collectConnectedStationPairs,
  dedupeSelectedQueries,
} from '../../src/engine/selectedCovarianceStore';
import { createExperimentalSparseNumericalBundle } from '../../src/engine/wasm/experimentalSparseNumericalBundle';
import type { ExperimentalSparseNumericalBundle } from '../../src/engine/wasm/experimentalSparseNumericalBundle';
import type { WebNetWasmFactory } from '../../src/engine/wasm/wasmTypes';
import type { StationId } from '../../src/types';

type SolveResult = ReturnType<LSAEngine['solve']>;

const MEASURED_RUNS = 3;
const NATIVE_RUNS = 5;

const industryDemo = readFileSync(join(process.cwd(), 'public/examples/industry_demo.dat'), 'utf8');
const generated = buildPhase6LargeBenchmarkCases(false).filter((item) =>
  ['gps-3d-cov-08', 'gps-3d-16', 'gps-3d-32', 'gps-3d-64', 'gps-3d-128'].includes(item.id),
);
if (generated.length !== 5) throw new Error('Missing genuine 3D corpus fixtures.');

const buildOrientationSynthInput = (baseInput: string): string => {
  const coords = new Map<string, { e: number; n: number }>();
  for (const line of baseInput.split('\n')) {
    const match = line.match(/^C\s+(\S+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)/);
    if (match) coords.set(match[1], { e: Number(match[2]), n: Number(match[3]) });
  }
  const unknowns = Array.from({ length: 16 }, (_, i) => `U${i + 1}`);
  const toDms = (deg: number): string => {
    const totalSec = Math.round((((deg % 360) + 360) % 360) * 3600 * 10) / 10;
    const d = Math.floor(totalSec / 3600);
    const mnt = Math.floor((totalSec - d * 3600) / 60);
    const sec = totalSec - d * 3600 - mnt * 60;
    return `${String(d).padStart(3, '0')}-${String(mnt).padStart(2, '0')}-${sec.toFixed(1).padStart(4, '0')}`;
  };
  const blocks: string[] = [];
  unknowns.forEach((occupy, i) => {
    const o = coords.get(occupy);
    if (!o) throw new Error(`Missing coordinates for ${occupy}.`);
    const targets = [1, 2, 3].map((k) => unknowns[(i + k) % 16]);
    blocks.push(`DB ${occupy} ${targets[0]}`);
    for (const t of targets) {
      const p = coords.get(t);
      if (!p) throw new Error(`Missing coordinates for ${t}.`);
      blocks.push(`DN ${t} ${toDms((Math.atan2(p.e - o.e, p.n - o.n) * 180) / Math.PI)}`);
    }
    blocks.push('DE');
  });
  return `${baseInput}\n${blocks.join('\n')}\n`;
};

const gps16 = generated.find((g) => g.id === 'gps-3d-16');
if (!gps16) throw new Error('Missing gps-3d-16 base fixture.');
const cases: { id: string; input: string; synthetic?: boolean }[] = [
  { id: 'industry_demo-3d-terrestrial', input: industryDemo },
  ...generated.map((item) => ({ id: item.id, input: item.input })),
  { id: 'gps-3d-16-orientation-synth', input: buildOrientationSynthInput(gps16.input), synthetic: true },
];

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

const stableResultJson = (result: SolveResult): string => {
  const logs = result.logs.filter((line) => !line.startsWith('Solve timing (ms):'));
  const { solveTimingProfile: _volatile, logs: _logs, ...stable } = result;
  return JSON.stringify({ ...stable, logs });
};

const roundNumbers = (value: unknown): unknown => {
  if (typeof value === 'number') return Math.round(value * 1e6) / 1e6;
  if (Array.isArray(value)) return value.map(roundNumbers);
  if (value != null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, roundNumbers(v)]));
  }
  return value;
};

// Deep-strips omitted keys (Route C omits legacy all-pairs rows both at
// the top level and nested inside precisionModels).
const stripKeysDeep = (value: unknown, omitKeys: ReadonlySet<string>): unknown => {
  if (Array.isArray(value)) return value.map((entry) => stripKeysDeep(entry, omitKeys));
  if (value != null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !omitKeys.has(key))
        .map(([key, entry]) => [key, stripKeysDeep(entry, omitKeys)]),
    );
  }
  return value;
};

const numericJsonOf = (result: SolveResult, omitKeys: string[] = []): string => {
  const parsed = JSON.parse(stableResultJson(result)) as Record<string, unknown>;
  const { logs: _dropped, ...numeric } = parsed;
  return JSON.stringify(roundNumbers(stripKeysDeep(numeric, new Set(omitKeys))));
};

const loadWasmFactory = async (): Promise<WebNetWasmFactory | null> => {
  try {
    const imported = (await import(
      pathToFileURL(`${process.cwd()}/cpp/build-wasm/webnet_core.js`).href
    )) as unknown as { default: WebNetWasmFactory };
    if (typeof imported.default !== 'function') return null;
    return imported.default;
  } catch {
    return null;
  }
};

interface DemandModel {
  modeAAllEntry: { rawQueries: number; uniqueSymmetric: number; uniqueColumns: number };
  modeBLegacyAllPairs: { rawQueries: number; uniqueSymmetric: number; uniqueColumns: number };
  modeCSelectedNetwork: { rawQueries: number; uniqueSymmetric: number; uniqueColumns: number; connectedPairs: number };
}

interface NativeLeg {
  ran: boolean;
  wallMs: number | null;
  success: boolean | null;
  converged: boolean | null;
  fullResultParity: boolean | null;
  toleranceParity: boolean | null;
  stationRowsMatch: boolean | null;
  allPairsRowsMatch: boolean | null;
  selectedCalls: number | null;
  selectedFallbacks: number | null;
  rowProductsCalls: number | null;
  rowProductsFallbacks: number | null;
  wallMinMs: number | null;
  wallMaxMs: number | null;
  statsReuseReason: string | null;
  dampingInferred: number | string;
  fallbackReasons: string[];
}

interface CaseEvidence {
  fixture: string;
  synthetic: boolean;
  admissible: boolean;
  inadmissibilityReason: string | null;
  success: boolean;
  converged: boolean;
  iterations: number;
  totalParameters: number;
  coordinateColumns: number;
  avoidedOrientationPct: number;
  scalarEquations: number;
  gpsObservations: number;
  unknownStations: number;
  orientationParameters: number;
  orientationRatio: number;
  denseWallMedianMs: number;
  qxxDimension: number | null;
  reuseReason: string;
  allPairsRows: number;
  expectedAllPairsRows: number;
  stationCovarianceRows: number;
  relativeCovarianceRows: number;
  requestedRelPtolPairs: number;
  demand: DemandModel;
  rowProductDemand: { equationRows: number; gpsCrossGroups: number };
  native: {
    artifactAvailable: boolean;
    allEntryDense: NativeLeg;
    legacyAllPairs: NativeLeg;
    selectedNetwork: NativeLeg;
    rowProducts: NativeLeg;
  };
}

const emptyLeg = (): NativeLeg => ({
  ran: false,
  wallMs: null,
  success: null,
  converged: null,
  fullResultParity: null,
  toleranceParity: null,
  stationRowsMatch: null,
  allPairsRowsMatch: null,
  selectedCalls: null,
  selectedFallbacks: null,
  rowProductsCalls: null,
  rowProductsFallbacks: null,
  wallMinMs: null,
  wallMaxMs: null,
  statsReuseReason: null,
  dampingInferred: 'unmeasured',
  fallbackReasons: [],
});

interface DenseBaseline {
  walls: number[];
  reference: SolveResult;
  probed: SolveResult;
  probeEvents: QxxReuseProbeEvent[];
}

const measureDenseBaseline = (input: string): DenseBaseline => {
  new LSAEngine({ input }).solve();
  const walls: number[] = [];
  let ref: SolveResult | null = null;
  for (let run = 0; run < MEASURED_RUNS; run += 1) {
    const started = performance.now();
    const solved = new LSAEngine({ input }).solve();
    walls.push(performance.now() - started);
    ref ??= solved;
  }
  const probeEvents: QxxReuseProbeEvent[] = [];
  const probed = new LSAEngine({
    input,
    qxxReuseProbe: (event) => {
      probeEvents.push(event);
    },
  }).solve();
  return { walls, reference: ref!, probed, probeEvents };
};

interface DemandInfo {
  demand: DemandModel;
  unknownIds: StationId[];
  connectedBearing: number;
  totalParameters: number;
  coordColumns: number;
  orientationParameters: number;
}

const buildDemandModel = (reference: SolveResult): DemandInfo => {
  const unknownIds = Object.entries(reference.stations)
    .filter(([, station]) => !station.fixed)
    .map(([stationId]) => stationId as StationId);
  const orientationParameters = reference.directionSetDiagnostics?.length ?? 0;
  // Exact production parameter layout (station coords first, then
  // orientation unknowns); 3D corpus so height columns are included.
  const { paramIndex, stationParamCount } = buildSolveParameterIndex(reference.stations, unknownIds, false);
  const totalParameters = stationParamCount + orientationParameters;
  const connectedPairs = collectConnectedStationPairs(reference.observations);
  const connectedBearing = connectedPairs.filter(
    (pair) => paramIndex[pair.from] != null && paramIndex[pair.to] != null,
  ).length;
  // Corpus inputs carry no REL/PTOL directives, so the requested-pair plan
  // contribution is empty here (requested pairs are covered in the audit).
  const planFor = (legacyAllPairs: boolean) => {
    const plan = buildCovarianceQueryPlan({
      paramIndex,
      unknowns: unknownIds,
      stationParamCount,
      connectedPairs,
      requestedPairs: [],
      includeHeight: true,
      includeAllStationPairs: legacyAllPairs,
    });
    return { rawQueries: plan.queries.length, uniqueSymmetric: dedupeSelectedQueries(plan.queries).length };
  };
  const planB = planFor(true);
  const planC = planFor(false);
  return {
    demand: {
      modeAAllEntry: {
        rawQueries: totalParameters * totalParameters,
        uniqueSymmetric: (totalParameters * (totalParameters + 1)) / 2,
        uniqueColumns: totalParameters,
      },
      modeBLegacyAllPairs: { ...planB, uniqueColumns: stationParamCount },
      modeCSelectedNetwork: { ...planC, uniqueColumns: stationParamCount, connectedPairs: connectedBearing },
    },
    unknownIds,
    connectedBearing,
    totalParameters,
    coordColumns: stationParamCount,
    orientationParameters,
  };
};

interface NativeLegSpec {
  input: string;
  reference: SolveResult;
  probed: SolveResult;
  bundle: ExperimentalSparseNumericalBundle;
  options: Record<string, unknown>;
  kind: 'selected' | 'rowProducts';
  omitAllPairsFromParity: boolean;
}

const runNativeLeg = (spec: NativeLegSpec): NativeLeg => {
  const leg = emptyLeg();
  const warmupDiagnostics = createExperimentalSparseRouteDiagnostics();
  // A throw here (broken module, harness error, failed solve) must fail
  // the campaign: only route-diagnostic fallbacks are acceptable, never
  // exceptions escaping solve().
  new LSAEngine({
    input: spec.input,
    ...spec.options,
    experimentalSparseDiagnostics: warmupDiagnostics,
  }).solve();
  const diagnostics = createExperimentalSparseRouteDiagnostics();
  // Timed solves stay clean: an active qxxReuseProbe forces O(P^2)
  // normal/Qxx deep copies inside the measured interval, so the reuse
  // reason is collected in a separate untimed solve below.
  const injected = { ...spec.options, experimentalSparseDiagnostics: diagnostics };
  const walls: number[] = [];
  let solved: SolveResult | null = null;
  for (let run = 0; run < NATIVE_RUNS; run += 1) {
    const started = performance.now();
    solved = new LSAEngine({ input: spec.input, ...injected }).solve();
    walls.push(performance.now() - started);
  }
  const last = solved as SolveResult;
  leg.ran = true;
  leg.wallMs = median(walls);
  leg.wallMinMs = Math.min(...walls);
  leg.wallMaxMs = Math.max(...walls);
  const nativeProbe: QxxReuseProbeEvent[] = [];
  new LSAEngine({
    input: spec.input,
    ...spec.options,
    experimentalSparseDiagnostics: createExperimentalSparseRouteDiagnostics(),
    qxxReuseProbe: (event: QxxReuseProbeEvent) => {
      nativeProbe.push(event);
    },
  }).solve();
  leg.statsReuseReason = nativeProbe.find((e) => e.stage === 'statistics')?.reason ?? 'no-event';
  // Fallback reasons must be populated before damping inference reads them.
  leg.fallbackReasons = [
    ...diagnostics.selectedCovarianceFallbackReasons,
    ...diagnostics.rowProductsFallbackReasons,
    ...diagnostics.sparseCorrectionFallbackReasons,
  ].slice(0, 3);
  const dampingHit = leg.fallbackReasons.some((r) => r.toLowerCase().includes('damping'));
  leg.dampingInferred = dampingHit ? 'fallback-with-damping-reason' : 0;
  leg.success = last.success;
  leg.converged = last.converged;
  leg.stationRowsMatch =
    (last.stationCovariances?.length ?? -1) === (spec.reference.stationCovariances?.length ?? -2);
  leg.allPairsRowsMatch = (last.relativePrecision?.length ?? -1) === (spec.reference.relativePrecision?.length ?? -2);
  leg.selectedCalls = diagnostics.selectedCovarianceCalls;
  leg.selectedFallbacks = diagnostics.selectedCovarianceFallbacks;
  leg.rowProductsCalls = diagnostics.rowProductsCalls;
  leg.rowProductsFallbacks = diagnostics.rowProductsFallbacks;
  const fellBack =
    spec.kind === 'selected'
      ? diagnostics.selectedCovarianceFallbacks > 0
      : diagnostics.rowProductsFallbacks > 0;
  if (!fellBack) {
    if (spec.omitAllPairsFromParity) {
      // Route C omits legacy all-pairs rows by design, so whole-result
      // equality is impossible; compare the common output subset
      // (everything except relativePrecision) at the same 1e-6 bar.
      leg.fullResultParity = null;
      leg.toleranceParity = numericJsonOf(last, ['relativePrecision']) === numericJsonOf(spec.probed, ['relativePrecision']);
    } else {
      leg.fullResultParity = stableResultJson(last) === stableResultJson(spec.probed);
      leg.toleranceParity = numericJsonOf(last) === numericJsonOf(spec.probed);
    }
  } else {
    leg.fullResultParity = null;
    leg.toleranceParity = null;
  }
  return leg;
};

interface NativeLegSet {
  allEntryDense: NativeLeg;
  legacyAllPairs: NativeLeg;
  selectedNetwork: NativeLeg;
  rowProducts: NativeLeg;
}

const measureNativeLegs = (
  input: string,
  reference: SolveResult,
  probed: SolveResult,
  bundle: ExperimentalSparseNumericalBundle,
): NativeLegSet => {
  // Keep A/B/C walls focused on final covariance: inject only the
  // selected-covariance solver. Correction and statistics stay TS, so no
  // sparse-correction condition estimate is recorded on these legs.
  const covarianceOptions = (selectedMode: boolean, legacyAllPairs: boolean): Record<string, unknown> => ({
    sparseSelectedCovarianceSolver: bundle.sparseSelectedCovarianceSolver,
    experimentalSelectedCovarianceMode: selectedMode,
    ...(legacyAllPairs ? { experimentalSelectedCovarianceLegacyAllPairs: true } : {}),
  });
  const base = { input, reference, probed, bundle };
  return {
    allEntryDense: runNativeLeg({ ...base, options: covarianceOptions(false, false), kind: 'selected', omitAllPairsFromParity: false }),
    legacyAllPairs: runNativeLeg({ ...base, options: covarianceOptions(true, true), kind: 'selected', omitAllPairsFromParity: false }),
    selectedNetwork: runNativeLeg({ ...base, options: covarianceOptions(true, false), kind: 'selected', omitAllPairsFromParity: true }),
    rowProducts: runNativeLeg({ ...base, options: { sparseRowProductsSolver: bundle.sparseRowProductsSolver }, kind: 'rowProducts', omitAllPairsFromParity: false }),
  };
};

interface AuditRow {
  id: string;
  coverage: string;
  obsMix: Record<string, number>;
  fixedStations: number;
  // Null marks explicitly unobserved outcomes (no solve performed),
  // never a fabricated success.
  success: boolean | null;
  converged: boolean | null;
  reuseReason: string;
  requestedRelPtolPairs: number;
  status: string;
}

const auditOne = (id: string, input: string, coverage: string): AuditRow => {
  const events: QxxReuseProbeEvent[] = [];
  const solved = new LSAEngine({
    input,
    qxxReuseProbe: (event) => {
      events.push(event);
    },
  }).solve();
  const obsMix: Record<string, number> = {};
  for (const o of solved.observations) obsMix[o.type] = (obsMix[o.type] ?? 0) + 1;
  return {
    id,
    coverage,
    obsMix,
    fixedStations: Object.values(solved.stations).filter((s) => s.fixed).length,
    success: solved.success,
    converged: solved.converged,
    reuseReason: events.find((e) => e.stage === 'statistics')?.reason ?? 'no-event',
    requestedRelPtolPairs:
      solved.relativeCovariances?.filter(
        (r) => r.selectedByRelativeDirective || r.selectedByPositionalToleranceDirective,
      ).length ?? 0,
    status: 'measured',
  };
};

const collectSemanticAudit = (): AuditRow[] => {
  const gps08 = generated.find((g) => g.id === 'gps-3d-cov-08');
  if (!gps08) throw new Error('Missing gps-3d-cov-08 base fixture.');
  const robust16 = buildPhase6LargeBenchmarkCases(false).find(
    (g) => g.id === 'chain-2d-robust-tscorr-16',
  );
  if (!robust16) throw new Error('Missing chain-2d-robust-tscorr-16 fixture.');
  const mixedInput = readFileSync(join(process.cwd(), 'public/examples/mixed_grid_tutorial.dat'), 'utf8');
  const rows: AuditRow[] = [
    auditOne('mixed-ts-gnss-lev-control', mixedInput, 'mixed TS+GNSS+leveling with fixed control'),
    auditOne('rel-ptol-requested', `${gps08.input}\n.RELATIVE U1->U2\n.PTOLERANCE U1->U3\n`, 'REL/PTOL-requested pairs'),
    auditOne('tscorr-admissible', `${gps08.input}\n.TSCORR ON\n`, 'TS correlation'),
    auditOne('robust-tscorr-fail-closed', robust16.input, 'robust Huber + TSCORR (2D)'),
  ];
  // Unobserved here (fail-closed by gate/parser construction):
  // augmentation rows (no 3D slope-dist trigger, per 10D) and excluded
  // observations (no exclude directive in any corpus input).
  rows.push({
    id: 'augmentation-excluded-unobserved',
    coverage: 'covariance augmentation rows; excluded observations',
    obsMix: {},
    fixedStations: 0,
    success: null,
    converged: null,
    reuseReason: 'unobserved-on-corpus (fail-closed by gate/parser)',
    requestedRelPtolPairs: 0,
    status: 'unobserved-fail-closed-by-construction',
  });
  return rows;
};

const buildEvidenceMarkdown = (caseEvidence: CaseEvidence[]): string =>
  [
    '# Phase 10G final-covariance architecture evidence',
    '',
    'Evidence-only campaign on the Phase 10F corpus + semantic audit. Dense baseline (warm-up + 3 solves) + demand reference + native legs (1+5, boundary walls) when the WASM artifact is present. industry_demo inadmissible. No timing assertions.',
    '',
    '| Fixture | params | unknowns | orient ratio | rows | dense wall ms | reuse reason | all-pairs | Mode A raw | Mode B raw | Mode C raw | uniq cols | native all-entry parity | native fallbacks (A/B/C/R) |',
    '|---|---:|---:|---:|---:|---:|---|---|---:|---:|---:|---:|---|---|---|',
    ...caseEvidence.map(
      (c) =>
        `| ${c.fixture} | ${c.totalParameters} | ${c.unknownStations} | ${c.orientationRatio.toFixed(3)} | ${c.scalarEquations} | ${c.denseWallMedianMs.toFixed(2)} | ${c.reuseReason} | ${c.allPairsRows}/${c.expectedAllPairsRows} | ${c.demand.modeAAllEntry.rawQueries} | ${c.demand.modeBLegacyAllPairs.rawQueries} | ${c.demand.modeCSelectedNetwork.rawQueries} | ${c.demand.modeAAllEntry.uniqueColumns} | ${c.native.artifactAvailable ? (c.native.allEntryDense.fullResultParity == null ? 'n/a (fallback)' : c.native.allEntryDense.fullResultParity ? 'BIT-IDENTICAL' : 'MISMATCH') : 'no-artifact'} | ${c.native.artifactAvailable ? `${c.native.allEntryDense.selectedFallbacks}/${c.native.legacyAllPairs.selectedFallbacks}/${c.native.selectedNetwork.selectedFallbacks}/${c.native.rowProducts.rowProductsFallbacks}` : 'no-artifact'} |`,
    ),
    '',
    '- No UI, protocol, formula, or routing changes.',
  ].join('\n');

const writeArtifacts = (caseEvidence: CaseEvidence[], semanticAudit: AuditRow[]): void => {
  const artifactDir = join(process.cwd(), 'artifacts/evidence/phase10g');
  mkdirSync(artifactDir, { recursive: true });
  const payload = {
    status: 'complete',
    method:
      'dense warm-up + 3 solves (median) + probe; plan-derived A/B/C demand; native 1+5 injected solves (median/min/max) + diagnostics; semantic audit (dense + probe); boundary walls only, no timing assertions',
    limitation:
      'WASM ABI exposes factor metadata only to the internal caller; no per-phase timings or condition estimates via route diagnostics; diagnostics count calls/fallbacks/reasons only.',
    measuredRuns: MEASURED_RUNS,
    nativeRuns: NATIVE_RUNS,
    cases: caseEvidence,
    semanticAudit,
  };
  writeFileSync(join(artifactDir, 'phase10g-evidence.json'), `${JSON.stringify(payload, null, 2)}\n`);
  writeFileSync(join(artifactDir, 'phase10g-evidence.md'), `${buildEvidenceMarkdown(caseEvidence)}\n`);
};

const assertNativeLegs = (c: CaseEvidence): void => {
  const legs = {
    allEntry: c.native.allEntryDense,
    legacy: c.native.legacyAllPairs,
    selected: c.native.selectedNetwork,
    rowProducts: c.native.rowProducts,
  };
  for (const [name, leg] of Object.entries(legs)) {
    // Diagnostics must prove the native route actually executed: a
    // surrounding solve() completing is not evidence on its own.
    if (name === 'rowProducts') {
      expect(leg.rowProductsCalls ?? 0, `${c.fixture} native ${name} invoked solver`).toBeGreaterThan(0);
    } else {
      expect(leg.selectedCalls ?? 0, `${c.fixture} native ${name} invoked solver`).toBeGreaterThan(0);
    }
    expect(leg.ran, `${c.fixture} native ${name} ran`).toBe(true);
    const fellBack =
      (leg.selectedFallbacks ?? 0) > 0 ||
      (leg.rowProductsFallbacks ?? 0) > 0 ||
      leg.fallbackReasons.length > 0;
    if (!fellBack) {
      expect(leg.success && leg.converged, `${c.fixture} native ${name} solves`).toBe(true);
      // Route C omits all-pairs rows by design, so whole-result parity is
      // impossible; the common subset (minus relativePrecision) is
      // compared at 1e-6 instead and must hold.
      expect(leg.toleranceParity, `${c.fixture} native ${name} equivalent to 1e-6`).toBe(true);
    }
  }
};

const assertCaseEvidence = (c: CaseEvidence): void => {
  expect(c.allPairsRows, `${c.fixture} dense all-pairs count`).toBe(c.expectedAllPairsRows);
  expect(c.stationCovarianceRows, `${c.fixture} station rows cover unknowns`).toBe(c.unknownStations);
  expect(c.requestedRelPtolPairs, `${c.fixture} no requested pairs`).toBe(0);
  if (c.admissible) {
    expect(c.demand.modeCSelectedNetwork.rawQueries, `${c.fixture} selected upper bound`).toBeLessThanOrEqual(
      c.demand.modeBLegacyAllPairs.rawQueries,
    );
    expect(c.demand.modeBLegacyAllPairs.rawQueries, `${c.fixture} legacy below dense`).toBeLessThanOrEqual(
      c.demand.modeAAllEntry.rawQueries,
    );
  }
  expect(c.demand.modeAAllEntry.uniqueColumns, `${c.fixture} dense demands all columns`).toBe(c.totalParameters);
  expect(c.demand.modeBLegacyAllPairs.uniqueColumns, `${c.fixture} legacy demands coordinate columns`).toBe(c.coordinateColumns);
  expect(c.demand.modeCSelectedNetwork.uniqueColumns, `${c.fixture} selected demands coordinate columns`).toBe(c.coordinateColumns);
  // Coordinate columns come from the exact parameter layout, which may
  // hold individual components (e.g. industry_demo height holds).
  expect(c.coordinateColumns, `${c.fixture} coordinate columns`).toBeLessThanOrEqual(c.unknownStations * 3);
  if (c.synthetic) {
    expect(c.avoidedOrientationPct, `${c.fixture} avoided orientation`).toBeCloseTo(25, 9);
  } else {
    expect(c.avoidedOrientationPct, `${c.fixture} no orientation avoided`).toBe(0);
  }
  if (c.synthetic) {
    expect(c.orientationParameters, `${c.fixture} 16 direction sets`).toBe(16);
    expect(c.orientationRatio, `${c.fixture} orientation ratio`).toBeGreaterThan(0);
    if (!c.admissible) {
      expect(c.reuseReason, `${c.fixture} damped-final fail-closed`).toBe('damped-final-recovery');
      expect(c.inadmissibilityReason, `${c.fixture} explicit inadmissibility`).toMatch(
        /damped-final-recovery|weak-case|non-converged|reuse inadmissible/,
      );
      return;
    }
  } else if (!c.admissible) {
    expect(c.inadmissibilityReason).toContain('weak-case observation');
    return;
  }
  expect(c.success && c.converged, `${c.fixture} reference solves`).toBe(true);
  expect(c.reuseReason, `${c.fixture} production reason`).toBe('reused-final-dense-qxx');
  assertNativeLegs(c);
  expect(c.reuseReason, `${c.fixture} zero dense-path damping via reuse eligibility`).toBe(
    'reused-final-dense-qxx',
  );
};

const assertSemanticAudit = (semanticAudit: AuditRow[]): void => {
  expect(semanticAudit.map((r) => r.id)).toEqual(['mixed-ts-gnss-lev-control', 'rel-ptol-requested', 'tscorr-admissible', 'robust-tscorr-fail-closed', 'augmentation-excluded-unobserved']);
  const auditById = Object.fromEntries(semanticAudit.map((r) => [r.id, r]));
  const mixed = auditById['mixed-ts-gnss-lev-control']!;
  expect(mixed.success && mixed.converged, 'mixed tutorial solves').toBe(true);
  expect(mixed.fixedStations, 'mixed tutorial has fixed control').toBeGreaterThan(0);
  expect(Object.keys(mixed.obsMix).length, 'mixed tutorial spans families').toBeGreaterThan(1);
  const relPtol = auditById['rel-ptol-requested']!;
  expect(relPtol.success && relPtol.converged, 'REL/PTOL variant solves').toBe(true);
  expect(relPtol.requestedRelPtolPairs, 'REL/PTOL pairs requested').toBe(2);
  const tscorr = auditById['tscorr-admissible']!;
  expect(tscorr.success && tscorr.converged, 'TSCORR variant solves').toBe(true);
  const robust = auditById['robust-tscorr-fail-closed']!;
  expect(robust.reuseReason, 'robust fails closed with explicit reason').toMatch(
    /robust-mode-inadmissible|two-dimensional-legacy|preanalysis-mode|not-converged/,
  );
};

describe('Phase 10G final-covariance architecture evidence', () => {
  it('references dense baseline, demand model, and native sparse legs on the 3D corpus', async () => {
    const wasmFactory = await loadWasmFactory();
    if (wasmFactory == null) {
      expect.fail('Blocked: real WASM artifact cpp/build-wasm/webnet_core.js is unavailable.');
    }
    const bundle = await createExperimentalSparseNumericalBundle(wasmFactory);
    const caseEvidence: CaseEvidence[] = [];

    for (const { id, input, synthetic = false } of cases) {
      const { walls, reference, probed, probeEvents } = measureDenseBaseline(input);
      const demandInfo = buildDemandModel(reference);
      const statsEvent = probeEvents.find((e) => e.stage === 'statistics');
      const finalEvent = probeEvents.find((e) => e.stage === 'final-covariance');
      const unknowns = demandInfo.unknownIds.length;
      const scalarEquations = reference.observations.reduce(
        (count, obs) =>
          count + (obs.type === 'gps' && Number.isFinite(obs.obs.dU) ? 3 : obs.type === 'gps' ? 2 : 1),
        0,
      );
      const expectedAllPairsRows = (unknowns * (unknowns - 1)) / 2;
      const reuseEligible =
        (statsEvent?.reused ?? false) && statsEvent?.reason === 'reused-final-dense-qxx';
      const admissible = synthetic
        ? reference.success && reference.converged && reuseEligible
        : id !== 'industry_demo-3d-terrestrial' && reference.success && reference.converged;
      const legs = measureNativeLegs(input, reference, probed, bundle);
      caseEvidence.push({
        fixture: id,
        synthetic,
        admissible,
        inadmissibilityReason: admissible
          ? null
          : synthetic
            ? `synthetic orientation observation excluded from scaling: reuse inadmissible (reason=${statsEvent?.reason ?? 'no-event'}); success=${reference.success} converged=${reference.converged}`
            : id === 'industry_demo-3d-terrestrial'
              ? `weak-case observation excluded by policy: success=${reference.success} converged=${reference.converged}`
              : `non-converged reference: success=${reference.success} converged=${reference.converged}`,
        success: reference.success,
        converged: reference.converged,
        iterations: reference.iterations,
        totalParameters: demandInfo.totalParameters,
        coordinateColumns: demandInfo.coordColumns,
        avoidedOrientationPct:
          demandInfo.totalParameters > 0
            ? (demandInfo.orientationParameters / demandInfo.totalParameters) * 100
            : 0,
        scalarEquations,
        gpsObservations: reference.observations.filter((o) => o.type === 'gps').length,
        unknownStations: unknowns,
        orientationParameters: demandInfo.orientationParameters,
        orientationRatio:
          demandInfo.totalParameters > 0 ? demandInfo.orientationParameters / demandInfo.totalParameters : 0,
        denseWallMedianMs: median(walls),
        qxxDimension: finalEvent?.qxxDimension ?? (demandInfo.totalParameters > 0 ? demandInfo.totalParameters : null),
        reuseReason: statsEvent?.reason ?? 'no-event',
        allPairsRows: reference.relativePrecision?.length ?? 0,
        expectedAllPairsRows,
        stationCovarianceRows: reference.stationCovariances?.length ?? 0,
        relativeCovarianceRows: reference.relativeCovariances?.length ?? 0,
        requestedRelPtolPairs:
          reference.relativeCovariances?.filter(
            (r) => r.selectedByRelativeDirective || r.selectedByPositionalToleranceDirective,
          ).length ?? 0,
        demand: demandInfo.demand,
        rowProductDemand: { equationRows: scalarEquations, gpsCrossGroups: reference.observations.filter((o) => o.type === 'gps').length },
        native: { artifactAvailable: true, ...legs },
      });
    }

    const semanticAudit = collectSemanticAudit();
    writeArtifacts(caseEvidence, semanticAudit);

    expect(caseEvidence.map((c) => c.fixture)).toEqual([
      'industry_demo-3d-terrestrial',
      'gps-3d-cov-08',
      'gps-3d-16',
      'gps-3d-32',
      'gps-3d-64',
      'gps-3d-128',
      'gps-3d-16-orientation-synth',
    ]);
    for (const c of caseEvidence) assertCaseEvidence(c);
    assertSemanticAudit(semanticAudit);
  }, 600000);
});
