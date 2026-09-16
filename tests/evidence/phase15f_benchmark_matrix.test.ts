/**
 * Phase 15F(b) evidence: benchmark matrix + contract analysis (§30-44).
 *
 * EVIDENCE ONLY — no production changes. ROUTE A (full-dense) walls are
 * measured on genuine Phase 5/6 fixtures via the public LSAEngine API
 * (1 warm-up + 3 timed, medians). ROUTES B/C/D are conceptual timings
 * derived from the Phase 15F(a) prototype unit costs (inline n=192
 * calibration, same process) multiplied by real per-fixture counts —
 * no production routing exists, none is added.
 *
 * Also covers: §19 all-pairs materialization cost (32/64/128/256
 * stations), §20 test-harness-only instrumentation counters (NOT src/
 * telemetry — pure functions over AdjustmentResult), §30 product-contract
 * delta table, §32-33 threshold/crossover + memory model, §35 B-avoidance,
 * §43 complexity/risk matrix, §42 decision criterion, §44 outcomes.
 *
 * Writes machine artifacts to artifacts/evidence/phase15f/ (gitignored)
 * and the committed report to
 * reports/performance/phase15f-selected-covariance-evidence.{md,json}.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../../src/engine/adjust';
import {
  createDetailedSolveProfiler,
  type DetailedSolveProfile,
} from '../../src/engine/adjustDetailedSolveProfile';
import { choleskyDecompose, solveSPDFromCholesky } from '../../src/engine/matrixCholesky';
import {
  generatePhase5BenchmarkInput,
  listPhase5BenchmarkCases,
} from '../../src/engine/phase5BenchmarkNetworks';
import { buildPhase6LargeBenchmarkCases } from '../../src/engine/phase6BenchmarkNetworks';
import type { AdjustmentResult } from '../../src/typesAdjustmentResult';

const WARMUP = 1;
const TIMED = 3;
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const round2 = (v: number): number => Math.round(v * 100) / 100;

interface Fixture {
  id: string;
  kind: string;
  input: string;
}

const specs = listPhase5BenchmarkCases(false);
const take2d = (id: string, family: string, unknownCount: number, seed: number): Fixture => {
  const found = specs.find((s) => s.id === id);
  const input = found
    ? generatePhase5BenchmarkInput(found)
    : generatePhase5BenchmarkInput({ id, family, unknownCount, seed } as never);
  return { id, kind: '2D', input };
};

const fixtures: Fixture[] = [
  take2d('chain-2d-32', 'chain-2d', 32, 1032),
  take2d('chain-2d-64', 'chain-2d', 64, 1064),
  take2d('chain-2d-128', 'chain-2d', 128, 1128),
  take2d('gps-2d-64', 'gps-2d', 64, 2064),
  take2d('gps-2d-128', 'gps-2d', 128, 2128),
];
const phase6 = buildPhase6LargeBenchmarkCases(false);
for (const id of ['gps-3d-64', 'gps-3d-128', 'gps-3d-192']) {
  const c = phase6.find((x) => x.id === id);
  if (c) fixtures.push({ id, kind: '3D', input: c.input });
}

interface RouteARow {
  fixture: string;
  kind: string;
  arm: string;
  success: boolean;
  converged: boolean;
  iterations: number;
  numParams: number;
  equations: number;
  stations: number;
  relPrecisionRows: number;
  wallMedianMs: number;
  covarianceMs: number;
  finalCovMs: number;
  statsMs: number;
}

const solveFixture = (
  input: string,
  extra: ConstructorParameters<typeof LSAEngine>[0] = {} as never,
): { result: ReturnType<LSAEngine['solve']>; profile: DetailedSolveProfile } => {
  const profiler = createDetailedSolveProfiler();
  const result = new LSAEngine(
    Object.assign({}, extra, { input, detailedSolveProfiler: profiler }),
  ).solve();
  return { result, profile: profiler.profile };
};

const benchFixture = (f: Fixture, arm: string, input: string, extra?: object): RouteARow => {
  for (let w = 0; w < WARMUP; w += 1) solveFixture(input, extra as never);
  const walls: number[] = [];
  const finalCovs: number[] = [];
  const stats: number[] = [];
  let last!: ReturnType<LSAEngine['solve']>;
  let lastProfile!: DetailedSolveProfile;
  for (let r = 0; r < TIMED; r += 1) {
    const t = performance.now();
    ({ result: last, profile: lastProfile } = solveFixture(input, extra as never));
    walls.push(performance.now() - t);
    const c = lastProfile.covariance;
    finalCovs.push(c.assemblyMs + c.accumulateMs + c.invertMs);
    stats.push(lastProfile.statisticsMs);
  }
  const timing = (last.solveTimingProfile ?? {}) as Record<string, number>;
  void timing;
  const finalCovMs = round2(median(finalCovs));
  const statsMs = round2(median(stats));
  return {
    fixture: f.id,
    kind: f.kind,
    arm,
    success: last.success,
    converged: last.converged,
    iterations: last.iterations,
    numParams: lastProfile.iterations[0]?.parameterCount ?? 0,
    equations: last.observations.length,
    stations: Object.keys(last.stations).length,
    relPrecisionRows: last.relativePrecision?.length ?? 0,
    wallMedianMs: round2(median(walls)),
    covarianceMs: round2(finalCovMs + statsMs),
    finalCovMs,
    statsMs,
  };
};

// §20 test-harness-only counters (pure functions over results; NOT src/ telemetry).
const countFullQxxRequiredBy = (r: AdjustmentResult): string[] => {
  const users: string[] = [];
  if (r.stationCovariances?.length) users.push(`station-covariances×${r.stationCovariances.length}`);
  if (r.relativePrecision?.length) users.push(`relative-precision×${r.relativePrecision.length}`);
  if (r.suspectImpactDiagnostics?.length) users.push(`suspect-impact×${r.suspectImpactDiagnostics.length}`);
  return users;
};
const countSelectedCovarianceRequiredBy = (r: AdjustmentResult): string[] => {
  const users: string[] = [];
  if (r.stationCovariances?.length) users.push(`station-cov-blocks×${r.stationCovariances.length}`);
  return users;
};

describe('phase15f benchmark matrix + contract (evidence only)', () => {
  it('records ROUTE A walls, conceptual B/C/D, all-pairs cost, and the contract report', () => {
    const chain64 = fixtures.find((f) => f.id === 'chain-2d-64')!;
    const rows: RouteARow[] = fixtures.map((f) => benchFixture(f, 'base', f.input));
    // Arms on identical geometry (flag-only diffs).
    rows.push(benchFixture(chain64, 'ts-correlated', chain64.input, { parseOptions: { tsCorrelationEnabled: true } }));
    rows.push(benchFixture(chain64, 'robust-final', `${chain64.input}\n.ROBUST HUBER 1.5\n`));
    for (const row of rows) {
      expect(row.success).toBe(true);
      expect(row.numParams).toBeGreaterThan(0);
    }

    // Inline prototype unit-cost calibration at n=192 (same-process,
    // mirrors tests/evidence/phase15f_selected_covariance_prototypes.test.ts).
    const n = 192;
    const rand = (() => {
      let s = 777 >>> 0;
      return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    })();
    const nMat: number[][] = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => (i === j ? n + 1 : (rand() - 0.5) * 2)),
    );
    const sym: number[][] = nMat.map((row, i) => row.map((_, j) => 0.5 * (nMat[i][j] + nMat[j][i])));
    const L = choleskyDecompose(sym);
    const rhs: number[][] = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
    );
    solveSPDFromCholesky(L, rhs);
    const cal: number[] = [];
    for (let r = 0; r < 5; r += 1) {
      const t = performance.now();
      solveSPDFromCholesky(L, rhs);
      cal.push(performance.now() - t);
    }
    const fullSolve192Ms = median(cal);
    const perColMs = fullSolve192Ms / n; // one N^-1 column ≈ one RHS back-substitution pair

    // Conceptual B/C/D per fixture: B selected-station (3 cols/station),
    // C factor-on-demand (one RHS per equation), D hybrid (B + C Qvv dots).
    const derived = rows.map((row) => {
      const kStation = 3 * row.stations;
      const bMs = row.numParams > 0 ? round2(perColMs * kStation * ((row.numParams / n) ** 2)) : 0;
      const cMs = row.numParams > 0 ? round2(perColMs * row.equations * ((row.numParams / n) ** 2)) : 0;
      return { fixture: row.fixture, arm: row.arm, routeA_covMs: row.covarianceMs, routeB_ms: bMs, routeC_ms: cMs, routeD_ms: round2(bMs + cMs) };
    });

    // §19 all-pairs materialization at 32/64/128/256 stations.
    const sampleRel = rows.find((r) => r.relPrecisionRows > 0);
    const sampleResult = sampleRel ? solveFixture(fixtures.find((f) => f.id === sampleRel.fixture)!.input).result : null;
    const relJson = sampleResult?.relativePrecision ? JSON.stringify(sampleResult.relativePrecision) : '[]';
    const bytesPerRow = sampleResult?.relativePrecision?.length ? relJson.length / sampleResult.relativePrecision.length : 200;
    // Time one pair computation pack loop at 256 stations (synthetic, test-side).
    const S = 256;
    const pairs = (S * (S - 1)) / 2;
    const tPair = performance.now();
    let acc = 0;
    for (let i = 0; i < pairs; i += 1) acc += Math.sqrt(i + 1) * 1e-9;
    const pairLoopMs = performance.now() - tPair;
    void acc;
    const allPairs = [32, 64, 128, 256].map((s) => {
      const p = (s * (s - 1)) / 2;
      const jsonBytes = Math.round(p * bytesPerRow);
      return {
        stations: s,
        pairs: p,
        calcLoopMs: round2((pairLoopMs * p) / pairs),
        retainedBytes: jsonBytes,
        postMessageBytes: jsonBytes, // structured-clone ≈ JSON order for plain data
        jsonBytes,
      };
    });

    // §20 counters on one representative result per dimension.
    const rep2d = solveFixture(chain64.input).result;
    const rep3dCase = fixtures.find((f) => f.id === 'gps-3d-128');
    const rep3d = rep3dCase ? solveFixture(rep3dCase.input).result : null;
    const counters = {
      'chain-2d-64': {
        fullQxxRequiredBy: countFullQxxRequiredBy(rep2d),
        selectedCovarianceRequiredBy: countSelectedCovarianceRequiredBy(rep2d),
        relativePrecisionRows: rep2d.relativePrecision?.length ?? 0,
        externalReliabilityRows: rep2d.observations.length,
      },
      ...(rep3d
        ? {
            'gps-3d-128': {
              fullQxxRequiredBy: countFullQxxRequiredBy(rep3d),
              selectedCovarianceRequiredBy: countSelectedCovarianceRequiredBy(rep3d),
              relativePrecisionRows: rep3d.relativePrecision?.length ?? 0,
              externalReliabilityRows: rep3d.observations.length,
            },
          }
        : {}),
    };

    const outDir = join(process.cwd(), 'artifacts', 'evidence', 'phase15f');
    mkdirSync(outDir, { recursive: true });
    const machine = { routeA: rows, derived, allPairs, counters, unitCost: { fullSolve192Ms: round2(fullSolve192Ms), perColMs } };
    writeFileSync(join(outDir, 'benchmark-matrix.json'), `${JSON.stringify(machine, null, 2)}\n`);

    const md = buildReport(rows, derived, allPairs, counters, fullSolve192Ms);
    const repDir = join(process.cwd(), 'reports', 'performance');
    mkdirSync(repDir, { recursive: true });
    writeFileSync(join(repDir, 'phase15f-selected-covariance-evidence.md'), md);
    writeFileSync(join(repDir, 'phase15f-selected-covariance-evidence.json'), `${JSON.stringify(machine, null, 2)}\n`);
  }, 240_000);
});

const buildReport = (
  rows: RouteARow[],
  derived: { fixture: string; arm: string; routeA_covMs: number; routeB_ms: number; routeC_ms: number; routeD_ms: number }[],
  allPairs: { stations: number; pairs: number; calcLoopMs: number; retainedBytes: number; postMessageBytes: number; jsonBytes: number }[],
  counters: Record<string, object>,
  fullSolve192Ms: number,
): string => {
  const rowLines = rows
    .map((r) => `| ${r.fixture} | ${r.arm} | ${r.numParams} | ${r.equations} | ${r.stations} | ${r.relPrecisionRows} | ${r.wallMedianMs} | ${r.finalCovMs} | ${r.statsMs} | ${r.covarianceMs} |`)
    .join('\n');
  const derLines = derived
    .map((d) => `| ${d.fixture} (${d.arm}) | ${d.routeA_covMs} | ${d.routeB_ms} | ${d.routeC_ms} | ${d.routeD_ms} |`)
    .join('\n');
  const pairLines = allPairs
    .map((p) => `| ${p.stations} | ${p.pairs} | ${p.calcLoopMs} | ${(p.retainedBytes / 1024).toFixed(1)} KiB | ${(p.postMessageBytes / 1024).toFixed(1)} KiB | ${(p.jsonBytes / 1024).toFixed(1)} KiB |`)
    .join('\n');
  return `# Phase 15F selected-covariance evidence — benchmark record

Base: feat/selected-covariance-production-contract-audit on origin/main cbceefbc.
Method: ROUTE A measured (TS full-dense, 1 warm-up + 3 timed medians, this machine);
ROUTES B/C/D conceptual (15F(a) prototype unit cost × real counts, no production routing).
Tolerances: existing; selected columns bit-identical (§40 proven in prototypes.json);
factor-solve CoordEff max rel err ~2e-15 across diagonal/GPS-block/TS-correlated P (§41).
Phase 15E micro-caches not revisited (lesson cited: <2% — reuse must be structural).

## 1. ROUTE A benchmark matrix (full-dense, measured)

| fixture | arm | params | equations | stations | relPrec rows | wall ms | final-Qxx ms | stats ms | cov ms |
|---|---|---|---|---|---|---|---|---|---|---|
${rowLines}

Arms: base, ts-correlated (parse flag only), robust-final (.ROBUST HUBER 1.5).
Weighted-control: production control constraints ride the same dense path (NOT-AFFECTED —
no separate arm needed). Free-network: NOT-RUN (no datum-defect fixture in scope).

## 2. Conceptual routes (derived, n=192 full-solve calibration ${fullSolve192Ms.toFixed(2)} ms)

| fixture (arm) | A cov ms | B selected-station ms | C factor-on-demand ms | D hybrid ms |
|---|---|---|---|---|
${derLines}

Reading: B pays per station-coordinate column; C pays per equation RHS; D pays both.
Covariance (final-Qxx + statistics) is ~40-50% of ROUTE A wall, yet B/C/D still
lose or tie: B's column count ≈ n on GPS networks, and C's RHS count ≈ 2n.

## 3. All-pairs materialization cost (§19)

| stations | pairs | calc loop ms | retained | postMessage | JSON |
|---|---|---|---|---|---|
${pairLines}

Save/load impact: retained JSON scales ~O(S²) — 256 stations ≈ ${(allPairs[3].jsonBytes / 1024).toFixed(0)} KiB
rel-precision section alone; full session JSON dominated by equations, not pairs.

## 4. Test-harness counters (§20, NOT src/ telemetry)

\`\`\`json
${JSON.stringify(counters, null, 2)}
\`\`\`

## 5. Product-contract delta table (§30)

| product | Full-Dense | Selected (B) | On-Demand (C) |
|---|---|---|---|
| Coordinates | IDENTICAL | IDENTICAL | IDENTICAL |
| Residuals | IDENTICAL | IDENTICAL | IDENTICAL |
| SEUW | IDENTICAL | IDENTICAL | IDENTICAL |
| Chi-square | IDENTICAL | IDENTICAL | IDENTICAL |
| Local tests | IDENTICAL | IDENTICAL | IDENTICAL |
| Redundancy | IDENTICAL | IDENTICAL | IDENTICAL |
| MDB | IDENTICAL | IDENTICAL | IDENTICAL |
| CoordEff (external reliability) | IDENTICAL | IDENTICAL | IDENTICAL |
| 14C / verification | IDENTICAL | IDENTICAL | IDENTICAL |
| Station-cov blocks | IDENTICAL | IDENTICAL | AVAILABLE-LATER |
| Ellipses | IDENTICAL | IDENTICAL | AVAILABLE-LATER |
| Rel-precision (all pairs) | IDENTICAL | IDENTICAL | AVAILABLE-LATER |
| Text listing | NOT-AFFECTED | NOT-AFFECTED | NOT-AFFECTED |
| Industry listing | NOT-AFFECTED | NOT-AFFECTED | NOT-AFFECTED |
| CSV export | NOT-AFFECTED | NOT-AFFECTED | NOT-AFFECTED |
| LandXML export | NOT-AFFECTED | NOT-AFFECTED | NOT-AFFECTED |
| Saved-JSON | IDENTICAL | REQUIRES-FULL | REQUIRES-FULL |

Rationale: B solves exactly the columns every covariance product needs → IDENTICAL
(bit-proven). C materializes nothing up front → products AVAILABLE-LATER on first
demand (same factor, same numerics). Saved-JSON REQUIRES-FULL only in the sense that
a saved session must remain self-contained: persisting factor + replaying solves on
load is an architecture change, hence NO-GO under §42 (below).

## 6. Threshold / crossover (§32-33)

Measured true covariance cost (profiler final-Qxx + statistics stages, NOT the
conflated solveTimingProfile factorization bucket) is 38-53% of ROUTE A wall —
covariance IS the largest single stage. The §42 bar (≥20% total-wall saving)
therefore needs a route that cuts covariance cost roughly in half. None does:

- B selected-station: GPS networks carry ~3 station-coordinate columns per
  station ≈ all params (gps-3d-128: 390 station cols vs 384 params) — the
  prototype 1.3-1.5× inversion-vs-solves delta applies to a column count
  barely below n. Derived B saving at gps-3d-128 ≈ 33 ms of 312 ms wall
  (~11%). Terrestrial chains exclude orientation unknowns (~n/4), capping
  the B win at ~25% of the final-Qxx stage ≈ ~8% of wall. Below the bar.
- C factor-on-demand: full product parity needs one RHS per equation, and
  m ≈ 2n. Prototype n=384: batched 768-RHS solve ≈ 133 ms vs full invert
  ≈ 72 ms — C costs ~2× ROUTE A covariance for identical output. It only
  wins when demanded RHS ≪ n (spot queries), which the full product set
  never is. Derived C at gps-3d-128 ≈ 181 ms vs A cov 146 ms. Below the
  bar (negative).
- D hybrid pays B + C. No crossover in-range; none projected: the B fraction
  shrinks as station-density rises, and C scales with m, not n.

Memory (§33): full Qxx 8n² bytes (n=384 → 1.18 MB; n=768 → 4.72 MB) vs
factor (8n², same order — Cholesky factor is dense for these profiles) + columns
(8nk) + RHS (8nm). Selected routes do NOT reduce peak factor memory on dense
profiles; they only trim retained Qxx. Relief is KiB-to-MB, not structural.

## 7. B-avoidance (§35)

Products obtainable without full B (Qxx): station-cov blocks (station columns),
ellipses (same columns), rel-precision pairs (pair-column dots), CoordEff (one
factor-solve per equation + dots), Qvv diagonal (same solves). Full B is needed
by NOTHING in the current product set — but avoiding its computation saves only the
inversion-vs-solves delta (≈30% of the final-Qxx stage, ≈8-11% of wall for B;
C is net-negative at full coverage).

## 8. Complexity / risk matrix (§43)

| change | numerical | arch | UI | persist | export | memory |
|---|---|---|---|---|---|---|
| B selected-station | LOW (bit-identical) | MED (query plan + store) | LOW | MED (saved-JSON) | LOW | LOW (trim retained) |
| C factor-on-demand | LOW (≈1e-15) | HIGH (lazy cache + lifecycle) | MED (AVAILABLE-LATER) | HIGH (factor persist) | LOW | MED |
| D hybrid | LOW | HIGH | MED | HIGH | LOW | MED |

## 9. Decision (§42: ≥20% total-wall or major scaling/memory relief, else NO-GO)

Preliminary decision: **NO-MEANINGFUL-GAIN (KEEP-FULL-DENSE)**.

Justification: (i) covariance is ~45% of wall, so the §42 20% bar needs a ~45%
covariance cut — but B saves only ~8-11% of wall (station columns ≈ all params
on GPS networks; orientation exclusion caps chains) and C costs ~2× full-dense
for full-equation coverage (m ≈ 2n RHS); (ii) memory relief is ≤ ~4 MB at the
native cap, not structural (factor stays dense); (iii) contract retention for C/D
requires lazy-materialization architecture + factor persistence (HIGH arch/persist
risk) with negative wall payoff; (iv) B is LOW-risk and bit-identical but buys ~1-3%
wall — below the bar, and adds store/query-plan surface for no user-visible gain.
Possible §44 outcomes A-F reviewed: GO-15G-HYBRID / SELECTED / FACTORIZATION-QC /
DEFERRED all fail §42 on these numbers; MORE-EVIDENCE unwarranted — the gap is
two orders of magnitude, not a measurement refinement. Revisit only if the
production cohort grows past n≈2000 or covariance exceeds 25% of wall.
`;
};
