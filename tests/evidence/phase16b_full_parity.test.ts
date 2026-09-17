/**
 * Phase 16B full-result parity + iteration parity at scale + BEFORE/AFTER
 * proof + wall-time gate (evidence tier).
 *
 * Full-result parity (§35): candidate-ON vs forced-legacy with only
 * timing/routing telemetry stripped — adjusted stations, orientations,
 * residuals, SEUW, chi-square, stdRes, local tests, redundancy, MDB,
 * CoordEff, 14C, station covariance, ellipses, relative precision. LOO
 * primary+alternates (§33, emulated through the exact solveEngine +
 * excludeIds path LOO uses) and auto-adjust cycles (§34) included.
 * Iteration parity: real-solver correction equality at m=512.
 * BEFORE/AFTER (§38): per-solve dense-P allocations + bytes on a large
 * admitted case, with peak-memory honesty (§39) and cumulative churn (§40).
 * Wall-time gate (§§41-42): >=10% total-wall OR >=20% assembly-stage OR
 * >=50% solve-time weight-memory reduction, no admitted regression >5%.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../../src/engine/adjust';
import { solveEngine } from '../../src/engine/solveEngine';
import { solveNormalEquations } from '../../src/engine/adjustNormalEquationHelpers';
import { weightedQuadratic } from '../../src/engine/adjustRobustWeights';
import { symmetricQuadraticForm } from '../../src/engine/matrixSparse';
import { structuredQuadraticForm } from '../../src/engine/sparseWeightRepresentation';
import { assembleBoth, buildChain2D, heapDeltaMb, maxDiff, medianWallMs, round4 } from './phase16aWeightEvidenceShared';
import {
  solveAdjustmentIteration,
} from '../../src/engine/adjustmentIteration';
import type { IterationSolveDependencies } from '../../src/engine/adjustmentSolveTypes';
import {
  resetStructuredWeightTelemetry,
  snapshotStructuredWeightTelemetry,
} from '../../src/engine/structuredWeightTelemetry';
import type { AdjustmentResult } from '../../src/types';

/** Timing/routing-only fields stripped before comparison — never numerics. */
const VOLATILE_KEYS = new Set(['solveTimingProfile', 'elapsedMs']);

const stripVolatile = (value: unknown, key?: string): unknown => {
  if (Array.isArray(value)) {
    // The solve-timing summary log line carries wall-clock milliseconds;
    // everything else in logs is deterministic solver output.
    const entries = key === 'logs'
      ? value.filter((entry) => !(typeof entry === 'string' && entry.startsWith('Solve timing (ms):')))
      : value;
    return entries.map((entry) => stripVolatile(entry));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [entryKey, entry] of Object.entries(value as Record<string, unknown>)) {
      if (VOLATILE_KEYS.has(entryKey)) continue;
      out[entryKey] = stripVolatile(entry, entryKey);
    }
    return out;
  }
  return value;
};

const fingerprint = (result: AdjustmentResult): string => JSON.stringify(stripVolatile(result));

const solveBoth = (
  input: string,
  base: ConstructorParameters<typeof LSAEngine>[0] = { input },
): { candidate: AdjustmentResult; legacy: AdjustmentResult } => ({
  candidate: new LSAEngine({ ...base, input }).solve(),
  legacy: new LSAEngine({ ...base, input, structuredWeightTransfer: false }).solve(),
});

const parityCases: Array<{
  id: string;
  fixture?: string;
  engineOptions?: ConstructorParameters<typeof LSAEngine>[0];
}> = [
  { id: 'cli-smoke', fixture: 'tests/fixtures/cli_smoke.dat' },
  { id: 'gps-loop', fixture: 'tests/fixtures/gps_loop_phase3_pass.dat' },
  { id: 'traverse', fixture: 'tests/fixtures/traverse.dat' },
  { id: 'mixed', fixture: 'tests/fixtures/alias_phase4_mixed.dat' },
  {
    id: 'ts-correlation',
    fixture: 'tests/fixtures/direction_faceset.dat',
    engineOptions: {
      input: '',
      parseOptions: { tsCorrelationEnabled: true, tsCorrelationRho: 0.5 },
    },
  },
  {
    id: 'industry-phase2',
    fixture: 'tests/fixtures/industry_parity_phase2.dat',
    engineOptions: {
      input: '',
      maxIterations: 15,
      convergenceThreshold: 0.001,
    },
  },
];

/** Chain network text: n unknowns, dist+bearing per link plus long sights.
 * The optional blunder kinks one short-leg bearing by a degree (a
 * transverse error the network cannot absorb radially, so it must show
 * in the residuals). */
const buildChainInput = (stations: number, blunderLeg: number | null): string => {
  const lines = ['.2D', 'C A 0 0 0 ! !'];
  const trueX = (i: number): number => 10 * i;
  const trueY = (i: number): number => 2 * i;
  const dms = (radians: number): string => {
    const total = (radians * 180) / Math.PI;
    const degrees = Math.floor(total);
    const minutes = Math.floor((total - degrees) * 60);
    const seconds = ((total - degrees) * 3600 - minutes * 60).toFixed(1);
    return `${String(degrees).padStart(3, '0')}-${String(minutes).padStart(2, '0')}-${seconds.padStart(4, '0')}`;
  };
  for (let i = 1; i <= stations; i += 1) {
    lines.push(`C U${i} ${(trueX(i) + 0.4).toFixed(4)} ${(trueY(i) + 0.3).toFixed(4)} 0`);
  }
  for (let i = 1; i <= stations; i += 1) {
    const from = i === 1 ? 'A' : `U${i - 1}`;
    lines.push(`D ${from}-U${i} ${Math.hypot(10, 2).toFixed(4)} 0.002`);
    const bearing = Math.atan2(10, 2) + (blunderLeg === i ? Math.PI / 180 : 0);
    lines.push(`B ${from}-U${i} ${dms(bearing)} 1.0`);
  }
  for (let i = 2; i <= stations; i += 2) {
    lines.push(`B A-U${i} ${dms(Math.atan2(trueX(i), trueY(i)))} 1.0`);
  }
  return lines.join('\n');
};

describe('phase 16B full-result parity: fixtures', () => {
  for (const parityCase of parityCases) {
    it(`solves whole-result-identical for ${parityCase.id}`, () => {
      const input = parityCase.fixture
        ? readFileSync(parityCase.fixture, 'utf-8')
        : (parityCase.engineOptions?.input as string);
      const base = parityCase.engineOptions ?? { input };
      const { candidate, legacy } = solveBoth(input, base);
      expect(fingerprint(candidate)).toBe(fingerprint(legacy));
    });
  }
});

describe('phase 16B full-result parity: large admitted network', () => {
  const input = buildChainInput(80, null);

  it('solves whole-result-identical at m=200 (loop + recovery admitted)', () => {
    const { candidate, legacy } = solveBoth(input);
    expect(candidate.converged).toBe(true);
    expect(candidate.iterations).toBe(legacy.iterations);
    expect(fingerprint(candidate)).toBe(fingerprint(legacy));
  });

  it('proves per-solve dense-P BEFORE/AFTER with exact attribution (§38)', () => {
    resetStructuredWeightTelemetry();
    const candidate = new LSAEngine({ input }).solve();
    const candidateTelemetry = snapshotStructuredWeightTelemetry();
    resetStructuredWeightTelemetry();
    const legacy = new LSAEngine({ input, structuredWeightTransfer: false }).solve();
    const legacyTelemetry = snapshotStructuredWeightTelemetry();
    expect(fingerprint(candidate)).toBe(fingerprint(legacy));
    const iterations = candidate.iterations;
    expect(iterations).toBeGreaterThan(0);
    // The ONLY dense-P difference between the modes is the correction loop
    // (one assembly per iteration) plus one final-covariance recovery:
    // statistics keeps its own identical dense assembly in both modes, so
    // it cancels exactly in the difference.
    expect(legacyTelemetry.densePAllocations - candidateTelemetry.densePAllocations).toBe(
      iterations + 1,
    );
    // Solve-time structured builds are exactly the admitted assemblies.
    expect(candidateTelemetry.structuredWeightBuilds).toBe(iterations + 1);
    expect(legacyTelemetry.structuredWeightBuilds).toBe(0);
    // No fallback, no post-solve materialization on this shape.
    expect(candidateTelemetry.structuredFallbacks).toBe(0);
    expect(candidateTelemetry.denseMaterializations).toBe(0);
    const equationCount = 200;
    expect(
      legacyTelemetry.densePBytesAllocated - candidateTelemetry.densePBytesAllocated,
    ).toBe((iterations + 1) * equationCount * equationCount * 8);
    const reduction =
      (legacyTelemetry.densePBytesAllocated - candidateTelemetry.densePBytesAllocated) /
      legacyTelemetry.densePBytesAllocated;
    console.log(
      `\n16B BEFORE/AFTER m=${equationCount} iters=${iterations}: ` +
        `dense-P allocs ${legacyTelemetry.densePAllocations} -> ${candidateTelemetry.densePAllocations} ` +
        `bytes ${legacyTelemetry.densePBytesAllocated} -> ${candidateTelemetry.densePBytesAllocated} ` +
        `reduction=${round4(reduction * 100)}%`,
    );
    expect(reduction).toBeGreaterThanOrEqual(0.5);
  });

  it('meets the wall-time gate with no admitted regression (§§41-42, §39-40)', () => {
    const wallMs = (structuredOff: boolean): number =>
      medianWallMs(3, () => {
        new LSAEngine({ input, structuredWeightTransfer: structuredOff ? false : undefined }).solve();
      });
    const candidateMs = wallMs(false);
    const legacyMs = wallMs(true);
    // Peak-memory honesty: heap delta around one full solve per mode.
    const candidateHeap = heapDeltaMb(() => {
      new LSAEngine({ input }).solve();
    });
    const legacyHeap = heapDeltaMb(() => {
      new LSAEngine({ input, structuredWeightTransfer: false }).solve();
    });
    console.log(
      `\n16B wall m=200: candidate=${round4(candidateMs)} legacy=${round4(legacyMs)} ` +
        `heap candidate=${round4(candidateHeap)}MB legacy=${round4(legacyHeap)}MB`,
    );
    expect(candidateMs).toBeLessThanOrEqual(legacyMs * 1.05);
  });
});

describe('phase 16B iteration parity at scale with the real solver', () => {
  it('matches dense correction bit-identically at m=512', () => {
    const network = buildChain2D('it-scale', 256);
    expect(network.numObsEquations).toBe(512);
    const { dense, sparse } = assembleBoth(network);
    const solveReal = (
      captured: { normal?: number[][]; rhs?: number[][] },
    ): IterationSolveDependencies => ({
      robustMode: 'none',
      solveNormalEquations: (normal, rhs) => {
        captured.normal = normal;
        captured.rhs = rhs;
        return solveNormalEquations(normal, rhs, { log: () => undefined });
      },
      estimateCondition: () => 0,
      recordConditionEstimate: () => undefined,
      captureRobustWeightBase: () => ({ diagonal: [], correlatedPairs: [] }),
      applyRobustWeightFactors: () => undefined,
      computeRobustWeightSummary: () => ({
        factors: [],
        downweightedRows: 0,
        minWeight: 1,
        maxNorm: 0,
        meanWeight: 1,
        topRows: [],
      }),
      maxRobustWeightDelta: () => 0,
      recordRobustDiagnostics: () => undefined,
      weightedQuadratic,
    });
    const denseCaptured: { normal?: number[][]; rhs?: number[][] } = {};
    const denseResult = solveAdjustmentIteration(
      solveReal(denseCaptured), [], sparse.L, dense.P!, sparse.rowInfo, 1,
      { sparseRows: sparse.sparseRows, numParams: network.numParams },
    );
    const structuredCaptured: { normal?: number[][]; rhs?: number[][] } = {};
    const structuredResult = solveAdjustmentIteration(
      solveReal(structuredCaptured), [], sparse.L, undefined, sparse.rowInfo, 1,
      {
        sparseRows: sparse.sparseRows,
        numParams: network.numParams,
        structuredWeights: sparse.structuredWeights!,
      },
    );
    expect(maxDiff(structuredCaptured.normal!, denseCaptured.normal!).maxAbs).toBe(0);
    expect(maxDiff(structuredCaptured.rhs!, denseCaptured.rhs!).maxAbs).toBe(0);
    expect(structuredResult.correction).toEqual(denseResult.correction);
    // vTPv summation order differs (packed triplets vs full matrix), so
    // report against the existing 1e-12 ceiling rather than exact.
    const v = sparse.L.map((row) => [row[0] * 0.37 + 1e-6]);
    const denseQ = symmetricQuadraticForm(dense.P!, v);
    const structuredQ = structuredQuadraticForm(sparse.structuredWeights!, v);
    expect(Math.abs(structuredQ - denseQ) / Math.max(Math.abs(denseQ), 1e-300)).toBeLessThan(
      1e-12,
    );
  });
});

describe('phase 16B LOO alternates and auto-adjust parity', () => {
  const blunderInput = buildChainInput(80, 40);

  it('matches on the LOO primary and the blunder-excluded alternate (§33)', () => {
    const primary = solveBoth(blunderInput);
    expect(fingerprint(primary.candidate)).toBe(fingerprint(primary.legacy));
    const ranked = [...primary.candidate.observations].sort(
      (a, b) =>
        Math.abs((b as { residual?: number }).residual ?? 0) -
        Math.abs((a as { residual?: number }).residual ?? 0),
    );
    const worst = ranked[0] as { id: number; type: string; residual?: number };
    // The degree kink surfaces as a 26 mm leg residual (the kink itself is
    // absorbed into downstream geometry); what matters for the LOO path
    // is that the TRUE blunder row — the kinked leg-40 bearing — is
    // excludable and its removal cleans the solve.
    expect(Math.abs(worst.residual ?? 0)).toBeGreaterThan(0.005);
    const kinkedBearings = primary.candidate.observations.filter(
      (obs) =>
        obs.type === 'bearing' && (obs as { from?: string }).from === 'U39',
    );
    expect(kinkedBearings).toHaveLength(1);
    const excludeIds = new Set([(kinkedBearings[0] as { id: number }).id]);
    const alternateCandidate = solveEngine({
      input: blunderInput,
      maxIterations: 10,
      excludeIds,
      runtime: {},
    });
    const alternateLegacy = solveEngine({
      input: blunderInput,
      maxIterations: 10,
      excludeIds,
      runtime: { structuredWeightTransfer: false },
    });
    expect(fingerprint(alternateCandidate)).toBe(fingerprint(alternateLegacy));
    // The exclusion actually removes the blunder (alternate is clean).
    const alternateWorst = Math.max(
      ...alternateCandidate.observations.map(
        (obs) => Math.abs((obs as { residual?: number }).residual ?? 0),
      ),
    );
    expect(alternateWorst).toBeLessThan(0.001);
  });

  it('matches through auto-adjust cycles with a planted blunder (§34)', () => {
    // GPS loop-closure network: the blundered A-U40 baseline has
    // redundancy 0.25, so auto-adjust really removes it (cycles=2,
    // removed=[blunder], final seuw=0) through nested trial+final solves.
    const lines = ['.2D', 'C A 0 0 0 ! !'];
    for (let i = 1; i <= 70; i += 1) {
      lines.push(`C U${i} ${(10 * i + 0.3).toFixed(4)} ${(2 * i + 0.2).toFixed(4)} 0`);
    }
    for (let i = 1; i <= 70; i += 1) {
      const from = i === 1 ? 'A' : `U${i - 1}`;
      lines.push(`G S1 ${from} U${i} 10.0000 2.0000 0.0100 0.0100`);
    }
    for (let i = 5; i <= 70; i += 5) {
      const blunder = i === 40 ? 0.5 : 0;
      lines.push(`G S1 A U${i} ${(10 * i + blunder).toFixed(4)} ${(2 * i).toFixed(4)} 0.0100 0.0100`);
    }
    const gpsInput = lines.join('\n');
    const base = {
      input: gpsInput,
      parseOptions: { autoAdjustEnabled: true },
    };
    const { candidate, legacy } = solveBoth(gpsInput, base);
    expect(candidate.parseState?.autoAdjustEnabled).toBe(true);
    const diagnostics = (
      candidate as {
        autoAdjustDiagnostics?: { removed: Array<{ obsId: number }>; cycles: unknown[] };
      }
    ).autoAdjustDiagnostics;
    expect(diagnostics?.removed.length).toBeGreaterThan(0);
    expect(fingerprint(candidate)).toBe(fingerprint(legacy));
  });
});
