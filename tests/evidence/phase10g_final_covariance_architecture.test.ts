/**
 * Phase 10G evidence: final-covariance architecture decision campaign.
 *
 * Evidence-only manual campaign (never runs in CI). Uses the Phase 10F
 * corpus (industry_demo terrestrial + gps-3d-cov-08/16/32/64/128 plus an
 * evidence-only synthetic orientation-heavy 3D case derived from
 * gps-3d-16) to measure/reference the final-covariance architecture
 * choice. Per fixture: dense baseline (warm-up + 3 solves, wall median)
 * + reuse probe; analytic demand (A all-entry P^2, B legacy all-pairs,
 * C selected network; raw/unique-column counts); native legs via the real
 * WASM bundle when present (all-entry Qxx, legacy-all-pairs store,
 * selected-network store, row products) with boundary walls (1+5) +
 * diagnostics + 1e-6 equivalence; semantic audit (mixed/REL-PTOL/TSCORR/
 * robust variants, dense + probe).
 *
 * Native phase timings are NOT exposed via the ABI/diagnostics: boundary
 * walls only (stated limitation). Dense baseline uses production automatic
 * Qxx reuse while every native leg fails closed out of reuse; native
 * diagnostics counts are per measured solve only. industry_demo is inadmissible
 * (weak-case observation). Artifacts only to `artifacts/evidence/phase10g/`
 * (gitignored).
 *
 * No production engine changes.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../../src/engine/adjust';
import { buildPhase6LargeBenchmarkCases } from '../../src/engine/phase6BenchmarkNetworks';
import type { QxxReuseProbeEvent } from '../../src/engine/qxxReuseEvidence';
import type { WebNetWasmFactory } from '../../src/engine/wasm/wasmTypes';

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

const stableResultJson = (result: ReturnType<LSAEngine['solve']>): string => {
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
  conditionEstimate: number | null;
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
  conditionEstimate: null,
});

describe('Phase 10G final-covariance architecture evidence', () => {
  it('references dense baseline, demand model, and native sparse legs on the 3D corpus', async () => {
    const wasmFactory = await loadWasmFactory();
    const bundle =
      wasmFactory == null
        ? null
        : await (
            await import('../../src/engine/wasm/experimentalSparseNumericalBundle')
          ).createExperimentalSparseNumericalBundle(wasmFactory);
    const caseEvidence: CaseEvidence[] = [];

    for (const { id, input, synthetic = false } of cases) {
      new LSAEngine({ input }).solve();
      const walls: number[] = [];
      let ref: ReturnType<LSAEngine['solve']> | null = null;
      for (let run = 0; run < MEASURED_RUNS; run += 1) {
        const started = performance.now();
        const solved = new LSAEngine({ input }).solve();
        walls.push(performance.now() - started);
        ref ??= solved;
      }
      const reference = ref!;
      const probeEvents: QxxReuseProbeEvent[] = [];
      const probed = new LSAEngine({
        input,
        qxxReuseProbe: (event) => {
          probeEvents.push(event);
        },
      }).solve();
      const statsEvent = probeEvents.find((e) => e.stage === 'statistics');
      const finalEvent = probeEvents.find((e) => e.stage === 'final-covariance');

      const unknowns = Object.values(reference.stations).filter((s) => !s.fixed).length;
      const orientationParameters = reference.directionSetDiagnostics?.length ?? 0;
      const totalParameters = unknowns * 3 + orientationParameters;
      const scalarEquations = reference.observations.reduce(
        (count, obs) =>
          count + (obs.type === 'gps' && Number.isFinite(obs.obs.dU) ? 3 : obs.type === 'gps' ? 2 : 1),
        0,
      );
      const gpsObservations = reference.observations.filter((o) => o.type === 'gps').length;
      const allPairsRows = reference.relativePrecision?.length ?? 0;
      const expectedAllPairsRows = (unknowns * (unknowns - 1)) / 2;
      const relativeCovarianceRows = reference.relativeCovariances?.length ?? 0;
      const connectedUniquePairs = new Set(
        (reference.relativeCovariances ?? []).map((r) =>
          r.from < r.to ? `${r.from}\u0000${r.to}` : `${r.to}\u0000${r.from}`,
        ),
      ).size;
      const requestedRelPtolPairs =
        reference.relativeCovariances?.filter(
          (r) => r.selectedByRelativeDirective || r.selectedByPositionalToleranceDirective,
        ).length ?? 0;

      // Demand reference (plan-shaped, no production calls): the selected
      // plan covers station coordinate columns only, so B/C demand
      // coordColumns while Mode A demands all P columns.
      const pairCount = (unknowns * (unknowns - 1)) / 2;
      const stationRaw = unknowns * 9;
      const stationUnique = unknowns * 6;
      const coordColumns = unknowns * 3;
      const avoidedOrientationPct =
        totalParameters > 0 ? (orientationParameters / totalParameters) * 100 : 0;
      const demand: DemandModel = {
        modeAAllEntry: {
          rawQueries: totalParameters * totalParameters,
          uniqueSymmetric: (totalParameters * (totalParameters + 1)) / 2,
          uniqueColumns: totalParameters,
        },
        modeBLegacyAllPairs: {
          rawQueries: stationRaw + pairCount * 9,
          uniqueSymmetric: stationUnique + pairCount * 9,
          uniqueColumns: coordColumns,
        },
        modeCSelectedNetwork: {
          rawQueries: stationRaw + connectedUniquePairs * 9,
          uniqueSymmetric: stationUnique + connectedUniquePairs * 9,
          uniqueColumns: coordColumns,
          connectedPairs: connectedUniquePairs,
        },
      };

      const nativeAvailable = bundle != null;
      const legs = { allEntryDense: emptyLeg(), legacyAllPairs: emptyLeg(), selectedNetwork: emptyLeg(), rowProducts: emptyLeg() };
      if (bundle != null) {
        const { createExperimentalSparseRouteDiagnostics } = await import(
          '../../src/engine/experimentalSparseDiagnostics'
        );
        const runLeg = (
          options: Record<string, unknown>,
          kind: 'selected' | 'rowProducts',
        ): NativeLeg => {
          const leg = emptyLeg();
          try {
            const warmupDiagnostics = createExperimentalSparseRouteDiagnostics();
            new LSAEngine({
              input,
              ...options,
              experimentalSparseDiagnostics: warmupDiagnostics,
              qxxReuseProbe: () => {},
            }).solve();
            const diagnostics = createExperimentalSparseRouteDiagnostics();
            const nativeProbe: QxxReuseProbeEvent[] = [];
            const injected = {
              ...options,
              experimentalSparseDiagnostics: diagnostics,
              qxxReuseProbe: (event: QxxReuseProbeEvent) => {
                nativeProbe.push(event);
              },
            };
            const walls: number[] = [];
            let solved: ReturnType<LSAEngine['solve']> | null = null;
            for (let run = 0; run < NATIVE_RUNS; run += 1) {
              const started = performance.now();
              solved = new LSAEngine({ input, ...injected }).solve();
              walls.push(performance.now() - started);
            }
            const last = solved as ReturnType<LSAEngine['solve']>;
            leg.ran = true;
            leg.wallMs = median(walls);
            leg.wallMinMs = Math.min(...walls);
            leg.wallMaxMs = Math.max(...walls);
            // Fair Route B reading: the reuse gate rejects active sparse
            // solvers, so this reason documents the reuse boundary.
            leg.statsReuseReason =
              nativeProbe.find((e) => e.stage === 'statistics')?.reason ?? 'no-event';
            // Factor metadata (normalNnz/factorNnz/damping/attempts) is not
            // exposed via diagnostics/probe; damping is inferred fail-closed
            // (damping>0 throws into a recorded fallback). Each selected /
            // row-product call performs one factorization.
            const dampingHit = leg.fallbackReasons.some((r) =>
              r.toLowerCase().includes('damping'),
            );
            leg.dampingInferred = dampingHit ? 'fallback-with-damping-reason' : 0;
            leg.success = last.success;
            leg.converged = last.converged;
            leg.stationRowsMatch =
              (last.stationCovariances?.length ?? -1) === (reference.stationCovariances?.length ?? -2);
            leg.allPairsRowsMatch =
              (last.relativePrecision?.length ?? -1) === allPairsRows;
            leg.selectedCalls = diagnostics.selectedCovarianceCalls;
            leg.selectedFallbacks = diagnostics.selectedCovarianceFallbacks;
            leg.rowProductsCalls = diagnostics.rowProductsCalls;
            leg.rowProductsFallbacks = diagnostics.rowProductsFallbacks;
            leg.fallbackReasons = [
              ...diagnostics.selectedCovarianceFallbackReasons,
              ...diagnostics.rowProductsFallbackReasons,
              ...diagnostics.sparseCorrectionFallbackReasons,
            ].slice(0, 3);
            leg.conditionEstimate = diagnostics.sparseConditionEstimates[0] ?? null;
            const fellBack =
              kind === 'selected'
                ? diagnostics.selectedCovarianceFallbacks > 0
                : diagnostics.rowProductsFallbacks > 0;
            if (!fellBack) {
              leg.fullResultParity = stableResultJson(last) === stableResultJson(probed);
              // FP-order noise expected: 1e-6 equivalence on the numeric
              // result (logs embed unrounded digits, excluded).
              const numericOf = (result: ReturnType<LSAEngine['solve']>): unknown => {
                const parsed = JSON.parse(stableResultJson(result)) as Record<string, unknown>;
                const { logs: _dropped, ...numeric } = parsed;
                return roundNumbers(numeric);
              };
              leg.toleranceParity =
                JSON.stringify(numericOf(last)) === JSON.stringify(numericOf(probed));
            } else {
              leg.fullResultParity = null;
              leg.toleranceParity = null;
            }
          } catch (error) {
            leg.ran = true;
            leg.fallbackReasons = [error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300)];
          }
          return leg;
        };
        const bundleOptions = (await import('../../src/engine/wasm/experimentalSparseNumericalBundle')).buildExperimentalSparseEngineOptions;
        legs.allEntryDense = runLeg(bundleOptions(bundle, undefined), 'selected');
        legs.legacyAllPairs = runLeg(bundleOptions(bundle, undefined, true, true), 'selected');
        legs.selectedNetwork = runLeg(bundleOptions(bundle, undefined, true, false), 'selected');
        legs.rowProducts = runLeg({ sparseRowProductsSolver: bundle.sparseRowProductsSolver }, 'rowProducts');
      }

      const reuseEligible =
        (statsEvent?.reused ?? false) && statsEvent?.reason === 'reused-final-dense-qxx';
      const admissible = synthetic
        ? reference.success && reference.converged && reuseEligible
        : id !== 'industry_demo-3d-terrestrial' && reference.success && reference.converged;

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
        totalParameters,
        coordinateColumns: coordColumns,
        avoidedOrientationPct,
        scalarEquations,
        gpsObservations,
        unknownStations: unknowns,
        orientationParameters,
        orientationRatio: totalParameters > 0 ? orientationParameters / totalParameters : 0,
        denseWallMedianMs: median(walls),
        qxxDimension: finalEvent?.qxxDimension ?? (totalParameters > 0 ? totalParameters : null),
        reuseReason: statsEvent?.reason ?? 'no-event',
        allPairsRows,
        expectedAllPairsRows,
        stationCovarianceRows: reference.stationCovariances?.length ?? 0,
        relativeCovarianceRows,
        requestedRelPtolPairs,
        demand,
        rowProductDemand: { equationRows: scalarEquations, gpsCrossGroups: gpsObservations },
        native: { artifactAvailable: nativeAvailable, ...legs },
      });
    }

    // Compact semantic audit on existing inputs/deterministic variants
    // (dense path + reuse probe only): proves the corpus features the
    // demand model assumes and documents every fail-closed route.
    const auditInput = (id: string, input: string, coverage: string) => {
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
    const gps08 = generated.find((g) => g.id === 'gps-3d-cov-08');
    if (!gps08) throw new Error('Missing gps-3d-cov-08 base fixture.');
    const robust16 = buildPhase6LargeBenchmarkCases(false).find(
      (g) => g.id === 'chain-2d-robust-tscorr-16',
    );
    if (!robust16) throw new Error('Missing chain-2d-robust-tscorr-16 fixture.');
    const mixedInput = readFileSync(join(process.cwd(), 'public/examples/mixed_grid_tutorial.dat'), 'utf8');
    const semanticAudit: ReturnType<typeof auditInput>[] = [
      auditInput('mixed-ts-gnss-lev-control', mixedInput, 'mixed TS+GNSS+leveling with fixed control'),
      auditInput('rel-ptol-requested', `${gps08.input}\n.RELATIVE U1->U2\n.PTOLERANCE U1->U3\n`, 'REL/PTOL-requested pairs'),
      auditInput('tscorr-admissible', `${gps08.input}\n.TSCORR ON\n`, 'TS correlation'),
      auditInput('robust-tscorr-fail-closed', robust16.input, 'robust Huber + TSCORR (2D)'),
    ];
    // Unobserved here (fail-closed by gate/parser construction):
    // augmentation rows (no 3D slope-dist trigger, per 10D) and excluded
    // observations (no exclude directive in any corpus input).
    semanticAudit.push({
      id: 'augmentation-excluded-unobserved',
      coverage: 'covariance augmentation rows; excluded observations',
      obsMix: {},
      fixedStations: 0,
      success: true,
      converged: true,
      reuseReason: 'unobserved-on-corpus (fail-closed by gate/parser)',
      requestedRelPtolPairs: 0,
      status: 'unobserved-fail-closed-by-construction',
    });

    const artifactDir = join(process.cwd(), 'artifacts/evidence/phase10g');
    mkdirSync(artifactDir, { recursive: true });
    const payload = {
      status: 'complete',
      method:
        'dense warm-up + 3 solves (median) + probe; analytic A/B/C demand; native 1+5 injected solves (median/min/max) + diagnostics; semantic audit (dense + probe); boundary walls only, no timing assertions',
      limitation:
        'WASM ABI exposes factor metadata + condition estimate only; no per-phase timings; diagnostics count calls/fallbacks/reasons only.',
      measuredRuns: MEASURED_RUNS,
      nativeRuns: NATIVE_RUNS,
      cases: caseEvidence,
      semanticAudit,
    };
    writeFileSync(join(artifactDir, 'phase10g-evidence.json'), `${JSON.stringify(payload, null, 2)}\n`);

    const markdown = [
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
    writeFileSync(join(artifactDir, 'phase10g-evidence.md'), `${markdown}\n`);

    expect(caseEvidence.map((c) => c.fixture)).toEqual([
      'industry_demo-3d-terrestrial',
      'gps-3d-cov-08',
      'gps-3d-16',
      'gps-3d-32',
      'gps-3d-64',
      'gps-3d-128',
      'gps-3d-16-orientation-synth',
    ]);
    for (const c of caseEvidence) {
      expect(c.allPairsRows, `${c.fixture} dense all-pairs count`).toBe(c.expectedAllPairsRows);
      expect(c.stationCovarianceRows, `${c.fixture} station rows cover unknowns`).toBe(c.unknownStations);
      expect(c.requestedRelPtolPairs, `${c.fixture} no requested pairs`).toBe(0);
      // Demand ordering holds on the admissible cohort (connected pairs among
      // unknowns); industry_demo's connected set can reference fixed datum
      // stations outside the unknown-pair universe, so it is recorded only.
      if (c.admissible) {
        expect(c.demand.modeCSelectedNetwork.rawQueries, `${c.fixture} selected upper bound`).toBeLessThanOrEqual(
          c.demand.modeBLegacyAllPairs.rawQueries,
        );
        expect(c.demand.modeBLegacyAllPairs.rawQueries, `${c.fixture} legacy below dense`).toBeLessThanOrEqual(
          c.demand.modeAAllEntry.rawQueries,
        );
      }
      expect(c.demand.modeAAllEntry.uniqueColumns, `${c.fixture} dense demands all columns`).toBe(c.totalParameters);
      // Selected plan covers station coordinate columns only.
      expect(c.demand.modeBLegacyAllPairs.uniqueColumns, `${c.fixture} legacy demands coordinate columns`).toBe(c.coordinateColumns);
      expect(c.demand.modeCSelectedNetwork.uniqueColumns, `${c.fixture} selected demands coordinate columns`).toBe(c.coordinateColumns);
      expect(c.coordinateColumns, `${c.fixture} coordinate columns`).toBe(c.unknownStations * 3);
      if (c.synthetic) {
        // Orientation-heavy case: 16 of 64 columns avoided by the plan.
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
          continue;
        }
      } else if (!c.admissible) {
        expect(c.inadmissibilityReason).toContain('weak-case observation');
        continue;
      }
      expect(c.success && c.converged, `${c.fixture} reference solves`).toBe(true);
      expect(c.reuseReason, `${c.fixture} production reason`).toBe('reused-final-dense-qxx');
      if (c.native.artifactAvailable) {
        // Fail-closed: every native leg must either run clean or record
        // an explicit fallback reason; silent success divergence is banned.
        for (const [name, leg] of Object.entries({
          allEntry: c.native.allEntryDense,
          legacy: c.native.legacyAllPairs,
          selected: c.native.selectedNetwork,
          rowProducts: c.native.rowProducts,
        })) {
          expect(leg.ran, `${c.fixture} native ${name} ran`).toBe(true);
          const fellBack =
            (leg.selectedFallbacks ?? 0) > 0 ||
            (leg.rowProductsFallbacks ?? 0) > 0 ||
            leg.fallbackReasons.length > 0;
          if (!fellBack) {
            expect(leg.success && leg.converged, `${c.fixture} native ${name} solves`).toBe(true);
            if (name !== 'selected') {
              expect(leg.toleranceParity, `${c.fixture} native ${name} equivalent to 1e-6`).toBe(true);
            }
          }
        }
        // Damping evidence (dense path only): 'reused-final-dense-qxx'
        // requires finalCovarianceDamping == 0, so the asserted reuse reason
        // already proves zero dense-path damping; native per-solve damping
        // metadata is not routed through route diagnostics and is not captured.
        expect(c.reuseReason, `${c.fixture} zero dense-path damping via reuse eligibility`).toBe(
          'reused-final-dense-qxx',
        );
      }
    }

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
  }, 600000);
});
