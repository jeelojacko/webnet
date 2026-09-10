/**
 * Phase 10B evidence: genuine-3D native correction comparison.
 *
 * Evidence-only manual campaign (never runs in CI). Uses the authoritative
 * genuine 3D corpus (industry_demo + deterministic mixed 3D generator) and
 * the existing real-WASM injected sparse correction seam:
 *
 * - Level 1: identical packed systems — the test-only per-iteration probe
 *   captures the exact packed design/weights/misclosures from the dense
 *   TypeScript solve; each captured system is solved directly by the real
 *   WASM sparse correction solver and the correction vectors are compared.
 * - Level 2: full correction-loop comparison — a full solve with the
 *   injected WASM sparse correction solver (dense covariance/statistics
 *   preserved) is compared against the pure TypeScript reference with the
 *   shared shadow comparator, plus wall-clock medians for both routes.
 *
 * Production routing, tolerances, math, protocol, and worker behavior are
 * untouched: 3D stays ineligible for production sparse dispatch, and the
 * injected solver is test-only. Requires the real cpp/build-wasm artifact;
 * a missing artifact fails loudly instead of silently skipping. Detailed
 * stage timings come from the opt-in internal profiler (no public
 * result-contract fields).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { LSAEngine } from '../../src/engine/adjust';
import {
  createDetailedSolveProfiler,
  type DetailedSolveProfile,
  type IterationSystemProbeInput,
} from '../../src/engine/adjustDetailedSolveProfile';
import { buildPhase6LargeBenchmarkCases } from '../../src/engine/phase6BenchmarkNetworks';
import { compareSparseShadowResults } from '../../src/engine/phase6SparseShadowCompare';
import { createExperimentalSparseNumericalBundle } from '../../src/engine/wasm/experimentalSparseNumericalBundle';
import { createExperimentalSparseRouteDiagnostics } from '../../src/engine/experimentalSparseDiagnostics';
import type { WebNetWasmFactory } from '../../src/engine/wasm/wasmTypes';

const CORRECTION_TOLERANCE = 1e-6;
const SHADOW_TOLERANCE_M = 1e-6;
const SEUW_TOLERANCE = 1e-9;
const MEASURED_RUNS = 3;

const industryDemo = readFileSync(join(process.cwd(), 'public/examples/industry_demo.dat'), 'utf8');
const generated = buildPhase6LargeBenchmarkCases(false).filter((item) =>
  ['gps-3d-cov-08', 'gps-3d-16', 'gps-3d-32', 'gps-3d-64', 'gps-3d-128'].includes(item.id),
);
const cases = [
  { id: 'industry_demo-3d-terrestrial', input: industryDemo },
  ...generated.map((item) => ({ id: item.id, input: item.input })),
];

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
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

const wasmFactory = await loadWasmFactory();

interface Level1SystemResult {
  iteration: number;
  parameterCount: number;
  equationCount: number;
  maxCorrectionAbsDiff: number;
  damping: number;
  dampingAttempts: number;
  pass: boolean;
}

interface CaseEvidence {
  fixture: string;
  dimension: '3D';
  admissible: boolean;
  inadmissibilityReason: string | null;
  tsDamped: boolean;
  totalParameters: number;
  scalarEquations: number;
  iterations: number;
  success: boolean;
  converged: boolean;
  /** Uninstrumented production-path wall median (headline timing). */
  tsWallMedianMs: number;
  /** Profiled-run wall median (includes profiler/probe capture overhead). */
  tsProfiledWallMedianMs: number;
  sparseWallMedianMs: number;
  wallSpeedupSparseOverTs: number | null;
  stageMediansMs: {
    assembly: number;
    accumulate: number;
    factorSolve: number;
    stateUpdate: number;
    covarianceAssembly: number;
    covarianceAccumulate: number;
    covarianceInvert: number;
    statistics: number;
  };
  covarianceCalls: number;
  totalAssemblies: number;
  level1: {
    systems: number;
    maxCorrectionAbsDiff: number;
    pass: boolean | null;
    perSystem: Level1SystemResult[];
  };
  level2: {
    pass: boolean | null;
    passReasons: string[];
    maxCoordDiffM: number;
    maxHeightDiffM: number;
    maxResidualDiff: number;
    maxStdResDiff: number;
    seuwDiff: number;
    iterationsMatch: boolean;
    sparseCorrectionFallbacks: number;
    tsCondition: number | null;
    sparseCondition: number | null;
  };
  amdahl: {
    factorFractionOfWall: number;
    maxSpeedupFactorOnly: number | null;
  };
}

describe('Phase 10B genuine-3D native correction evidence', () => {
  it('compares identical packed systems and full correction loops with real WASM', async () => {
    if (wasmFactory == null) {
      const outputDir = join(process.cwd(), 'artifacts/evidence/phase10b');
      mkdirSync(outputDir, { recursive: true });
      writeFileSync(
        join(outputDir, 'phase10b-native-correction.json'),
        `${JSON.stringify({ status: 'blocked', reason: 'missing cpp/build-wasm artifact' }, null, 2)}\n`,
      );
      expect.fail('Blocked: real WASM artifact cpp/build-wasm/webnet_core.js is unavailable.');
    }
    const bundle = await createExperimentalSparseNumericalBundle(wasmFactory);
    const caseEvidence: CaseEvidence[] = [];

    for (const { id, input } of cases) {
      // Headline walls: uninstrumented production path (1 warm-up + measured).
      new LSAEngine({ input }).solve();
      const plainWalls: number[] = [];
      for (let run = 0; run < MEASURED_RUNS; run += 1) {
        const started = performance.now();
        new LSAEngine({ input }).solve();
        plainWalls.push(performance.now() - started);
      }
      const tsWall = median(plainWalls);
      // Profiled runs: stages + probe (walls carry capture overhead).
      const walls: number[] = [];
      const profiles: DetailedSolveProfile[] = [];
      let probed: IterationSystemProbeInput[] = [];
      let reference: ReturnType<LSAEngine['solve']> | null = null;
      for (let run = 0; run < MEASURED_RUNS; run += 1) {
        const profiler = createDetailedSolveProfiler();
        const runProbed: IterationSystemProbeInput[] = [];
        const started = performance.now();
        const result = new LSAEngine({
          input,
          detailedSolveProfiler: profiler,
          iterationSystemProbe: (system) => {
            runProbed.push(system);
          },
        }).solve();
        walls.push(performance.now() - started);
        profiles.push(profiler.profile);
        if (run === 0) {
          probed = runProbed;
          reference = result;
        }
      }
      const ref = reference!;
      // Native parity is only meaningful on admissible systems: converged
      // references whose dense path needed no diagonal damping. The weak
      // industry_demo case is ill-conditioned (TS damped path, native
      // undamped) and is recorded as inadmissible, not as a parity failure.
      const tsDamped = ref.logs.some((line) =>
        line.includes('diagonal damping'),
      );
      const admissible = ref.success && ref.converged && !tsDamped;
      const inadmissibilityReason = admissible
        ? null
        : `weak-case observation: success=${ref.success} converged=${ref.converged} tsDamped=${tsDamped} condition=${typeof ref.condition?.estimate === 'number' ? ref.condition.estimate.toExponential(2) : 'n/a'}`;
      const profile = (field: (_p: DetailedSolveProfile) => number): number =>
        median(profiles.map(field));
      const stageMediansMs = {
        assembly: profile((p) => p.assemblyMs),
        accumulate: profile((p) => p.accumulateMs),
        factorSolve: profile((p) => p.factorSolveMs),
        stateUpdate: profile((p) => p.stateUpdateMs),
        covarianceAssembly: profile((p) => p.covariance.assemblyMs),
        covarianceAccumulate: profile((p) => p.covariance.accumulateMs),
        covarianceInvert: profile((p) => p.covariance.invertMs),
        statistics: profile((p) => p.statisticsMs),
      };
      const totalParameters =
        (Object.keys(ref.stations).length -
          Object.values(ref.stations).filter((s) => s.fixed).length) *
          3 +
        (ref.directionSetDiagnostics?.length ?? 0);
      const scalarEquations = ref.observations.reduce(
        (count, obs) => count + (obs.type === 'gps' ? 3 : 1),
        0,
      );

      // Level 1: identical packed systems through the real native solver.
      const perSystem: Level1SystemResult[] = probed.map((system) => {
        const native = bundle.sparseCorrectionSolver.solveFromEquations({
          design: system.design,
          weights: system.weights,
          misclosures: system.misclosures,
          observationEquationCount: system.observationEquationCount,
          parameterCount: system.parameterCount,
        });
        const nativeCorrection = Array.from(
          { length: system.parameterCount },
          (_, i) => native.correction[i]?.[0] ?? Number.NaN,
        );
        let maxDiff = 0;
        for (let i = 0; i < system.parameterCount; i += 1) {
          maxDiff = Math.max(maxDiff, Math.abs(nativeCorrection[i]! - system.tsCorrection[i]!));
        }
        return {
          iteration: system.iteration,
          parameterCount: system.parameterCount,
          equationCount: system.observationEquationCount,
          maxCorrectionAbsDiff: maxDiff,
          damping: native.damping,
          dampingAttempts: native.dampingAttempts,
          pass: maxDiff <= CORRECTION_TOLERANCE && native.damping === 0,
        };
      });
      const level1Pass = perSystem.length > 0 && perSystem.every((s) => s.pass);

      // Level 2: full correction-loop comparison with injected native correction.
      const diagnostics = createExperimentalSparseRouteDiagnostics();
      new LSAEngine({
        input,
        sparseCorrectionSolver: bundle.sparseCorrectionSolver,
        experimentalSparseDiagnostics: diagnostics,
      }).solve();
      const sparseWalls: number[] = [];
      let sparseCandidate = new LSAEngine({
        input,
        sparseCorrectionSolver: bundle.sparseCorrectionSolver,
        experimentalSparseDiagnostics: diagnostics,
      }).solve();
      for (let run = 0; run < MEASURED_RUNS; run += 1) {
        const started = performance.now();
        sparseCandidate = new LSAEngine({
          input,
          sparseCorrectionSolver: bundle.sparseCorrectionSolver,
          experimentalSparseDiagnostics: diagnostics,
        }).solve();
        sparseWalls.push(performance.now() - started);
      }
      const comparison = compareSparseShadowResults(ref, sparseCandidate, SHADOW_TOLERANCE_M);
      const explicitContractReasons = [
        ...(comparison.maxHeightDiffM <= SHADOW_TOLERANCE_M
          ? []
          : [`max height diff ${comparison.maxHeightDiffM} exceeds ${SHADOW_TOLERANCE_M}`]),
        ...(comparison.maxResidualDiff <= SHADOW_TOLERANCE_M
          ? []
          : [`max residual diff ${comparison.maxResidualDiff} exceeds ${SHADOW_TOLERANCE_M}`]),
        ...(comparison.maxStdResDiff <= SHADOW_TOLERANCE_M
          ? []
          : [`max standardized residual diff ${comparison.maxStdResDiff} exceeds ${SHADOW_TOLERANCE_M}`]),
        ...(comparison.seuwDiff <= SEUW_TOLERANCE
          ? []
          : [`SEUW diff ${comparison.seuwDiff} exceeds ${SEUW_TOLERANCE}`]),
      ];
      const level2Pass =
        comparison.pass &&
        explicitContractReasons.length === 0 &&
        diagnostics.sparseCorrectionFallbacks === 0;
      const sparseWall = median(sparseWalls);
      const factorFraction = tsWall > 0 ? stageMediansMs.factorSolve / tsWall : 0;

      caseEvidence.push({
        fixture: id,
        dimension: '3D',
        admissible,
        inadmissibilityReason,
        tsDamped,
        totalParameters,
        scalarEquations,
        iterations: ref.iterations,
        success: ref.success,
        converged: ref.converged,
        tsWallMedianMs: tsWall,
        tsProfiledWallMedianMs: median(walls),
        sparseWallMedianMs: sparseWall,
        wallSpeedupSparseOverTs: sparseWall > 0 ? tsWall / sparseWall : null,
        stageMediansMs,
        covarianceCalls: profiles[0]?.covariance.calls ?? 0,
        totalAssemblies: ref.iterations + (profiles[0]?.covariance.calls ?? 0),
        level1: {
          systems: perSystem.length,
          maxCorrectionAbsDiff: Math.max(...perSystem.map((s) => s.maxCorrectionAbsDiff), 0),
          pass: admissible ? level1Pass : null,
          perSystem,
        },
        level2: {
          pass: admissible ? level2Pass : null,
          passReasons: [
            ...comparison.passReasons,
            ...explicitContractReasons,
            ...(diagnostics.sparseCorrectionFallbacks === 0
              ? []
              : [`sparse correction fallbacks=${diagnostics.sparseCorrectionFallbacks}`]),
          ],
          maxCoordDiffM: comparison.maxCoordDiffM,
          maxHeightDiffM: comparison.maxHeightDiffM,
          maxResidualDiff: comparison.maxResidualDiff,
          maxStdResDiff: comparison.maxStdResDiff,
          seuwDiff: comparison.seuwDiff,
          iterationsMatch: comparison.iterationsMatch,
          sparseCorrectionFallbacks: diagnostics.sparseCorrectionFallbacks,
          tsCondition: typeof ref.condition?.estimate === 'number' ? ref.condition.estimate : null,
          sparseCondition:
            typeof sparseCandidate.condition?.estimate === 'number'
              ? sparseCandidate.condition.estimate
              : null,
        },
        amdahl: {
          factorFractionOfWall: factorFraction,
          maxSpeedupFactorOnly:
            factorFraction > 0 && factorFraction < 1 ? 1 / (1 - factorFraction) : null,
        },
      });
    }

    const outputDir = join(process.cwd(), 'artifacts/evidence/phase10b');
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(
      join(outputDir, 'phase10b-native-correction.json'),
      `${JSON.stringify({ status: 'complete', cases: caseEvidence }, null, 2)}\n`,
    );
    const markdown = [
      '# Phase 10B genuine-3D native correction evidence',
      '',
      'Real-WASM injected sparse correction seam. Level 1 = identical packed systems; Level 2 = full correction-loop comparison. Timings: Node process, one warm-up, three measured runs; medians reported.',
      '',
      '| Fixture | params | rows | iters | TS wall ms | sparse wall ms | L1 max corr diff | L1 | L2 |',
      '|---|---:|---:|---:|---:|---:|---:|---|---|',
      ...caseEvidence.map(
        (c) =>
          `| ${c.fixture} | ${c.totalParameters} | ${c.scalarEquations} | ${c.iterations} | ${c.tsWallMedianMs.toFixed(2)} | ${c.sparseWallMedianMs.toFixed(2)} | ${c.level1.maxCorrectionAbsDiff.toExponential(2)} | ${c.level1.pass === null ? 'N/A' : c.level1.pass ? 'PASS' : 'FAIL'} | ${c.level2.pass === null ? 'N/A' : c.level2.pass ? 'PASS' : 'FAIL'} |`,
      ),
      '',
      '## Interpretation',
      '',
      '- Level 1 solves the exact packed systems captured from the TypeScript reference with the real native solver; no re-assembly or re-linearization is involved.',
      '- Level 2 preserves dense covariance/statistics; only the per-iteration correction goes native.',
      '- TS wall is the uninstrumented production path; the JSON also carries `tsProfiledWallMedianMs` (profiler/probe capture overhead included) alongside the stage medians.',
    ].join('\n');
    writeFileSync(join(outputDir, 'phase10b-native-correction.md'), `${markdown}\n`);

    for (const c of caseEvidence) {
      if (!c.admissible) {
        expect(c.inadmissibilityReason).toContain('weak-case observation');
        expect(c.level1.pass).toBeNull();
        expect(c.level2.pass).toBeNull();
        continue;
      }
      expect(c.level1.pass, `${c.fixture} Level 1 identical-system parity`).toBe(true);
      expect(c.level2.pass, `${c.fixture} Level 2 correction-loop parity`).toBe(true);
    }
    expect(caseEvidence.filter((c) => c.admissible).map((c) => c.fixture)).toEqual([
      'gps-3d-cov-08',
      'gps-3d-16',
      'gps-3d-32',
      'gps-3d-64',
      'gps-3d-128',
    ]);
  }, 600000);
});
