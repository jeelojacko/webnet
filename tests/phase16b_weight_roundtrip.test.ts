/**
 * Phase 16B-A round-trip oracle + full-result parity (agent tier, fast).
 *
 * - Structured round-trip (§8): sparse-assembly structured weights
 *   materialize bit-identical to the dense-assembly P on every family.
 * - N parity: the structured row-major accumulator reproduces the dense
 *   A'PA result bit-identically (same sparse rows, real L).
 * - Fail-closed: non-canonical triplets throw so callers use dense.
 * - Full-result parity: LSAEngine candidate-ON vs forced legacy dense give
 *   identical stations, residuals, SEUW, and chi-square (existing
 *   tolerances untouched — asserted exact).
 * - Preanalysis: dead-P path preserves results and tsCorrelationDiagnostics.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../src/engine/adjust';
import { accumulateNormalEquationsFromSparseRows, zeros } from '../src/engine/matrix';
import { accumulateNormalFromStructuredWeights, compareStructuredWeightsToDense } from '../src/engine/structuredWeightOracle';
import type { AdjustmentResult } from '../src/types';
import {
  assembleBoth,
  buildChain2D,
  buildCorrelatedControls,
  buildGnssBaseline,
  buildGps2D,
  buildGps3D,
  buildMixed,
  buildTsDirections,
  buildTsSetupScope,
  buildWeightedControls,
  maxDiff,
  type BuiltNetwork,
} from './evidence/phase16aWeightEvidenceShared';

const families = (): BuiltNetwork[] => [
  buildChain2D('rt-chain', 8),
  buildGps2D('rt-gps2', 4),
  buildGps3D('rt-gps3', 4),
  buildGnssBaseline('rt-gnss', 3),
  buildTsDirections('rt-ts-set', 2, 4),
  buildTsSetupScope('rt-ts-setup', 2, 4),
  buildWeightedControls('rt-weighted-controls', 8),
  buildCorrelatedControls('rt-correlated-controls', 8),
  buildMixed('rt-mixed'),
];

describe('phase 16B structured weight round-trip oracle', () => {
  for (const network of families()) {
    it(`materializes bit-identical P for ${network.id} (${network.kind})`, () => {
      const { dense, sparse } = assembleBoth(network);
      const verdict = compareStructuredWeightsToDense(
        sparse.structuredWeights!,
        dense.P!,
      );
      expect(verdict.maxAbs).toBe(0);
      expect(verdict.maxRel).toBe(0);
      expect(verdict.exact).toBe(true);
    });

    it(`accumulates bit-identical N for ${network.id} (${network.kind})`, () => {
      const { dense, sparse } = assembleBoth(network);
      const rows = sparse.sparseRows;
      const expected = accumulateNormalEquationsFromSparseRows(
        rows,
        sparse.L,
        dense.P!,
        network.numParams,
      );
      const actual = accumulateNormalFromStructuredWeights(
        rows,
        sparse.L,
        sparse.structuredWeights!,
        network.numParams,
      );
      expect(maxDiff(actual.normal, expected.normal).maxAbs).toBe(0);
      expect(maxDiff(actual.rhs, expected.rhs).maxAbs).toBe(0);
    });
  }

  it('rejects non-canonical triplets fail-closed', () => {
    const network = buildGps2D('rt-reject', 2);
    const { sparse } = assembleBoth(network);
    const weights = sparse.structuredWeights!;
    expect(weights.offValues.length).toBeGreaterThan(0);
    const reversed = {
      size: weights.size,
      diagonal: weights.diagonal,
      offRows: Int32Array.from(weights.offColumns),
      offColumns: Int32Array.from(weights.offRows),
      offValues: weights.offValues,
    };
    expect(() =>
      accumulateNormalFromStructuredWeights(
        sparse.sparseRows,
        zeros(network.numObsEquations, 1),
        reversed,
        network.numParams,
      ),
    ).toThrow();
    const outOfBounds = {
      size: weights.size,
      diagonal: weights.diagonal,
      offRows: Int32Array.of(weights.size),
      offColumns: Int32Array.of(weights.size),
      offValues: Float64Array.of(1),
    };
    expect(() =>
      accumulateNormalFromStructuredWeights(
        sparse.sparseRows,
        zeros(network.numObsEquations, 1),
        outOfBounds,
        network.numParams,
      ),
    ).toThrow();
  });
});

interface ParityCase {
  id: string;
  fixture?: string;
  input?: string;
  engineOptions?: ConstructorParameters<typeof LSAEngine>[0];
}

const parityCases = (): ParityCase[] => [
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

const fingerprint = (result: AdjustmentResult): string =>
  JSON.stringify({
    converged: result.converged,
    iterations: result.iterations,
    dof: result.dof,
    seuw: result.seuw,
    chiSquare: result.chiSquare,
    stations: result.stations,
    observations: result.observations.map((obs) => [
      obs.id,
      obs.type,
      (obs as { residual?: unknown }).residual,
      (obs as { stdRes?: unknown }).stdRes,
    ]),
    tsCorrelationDiagnostics: (
      result as { tsCorrelationDiagnostics?: unknown }
    ).tsCorrelationDiagnostics,
  });

describe('phase 16B candidate-ON vs forced-dense full parity', () => {
  for (const parityCase of parityCases()) {
    it(`solves identically for ${parityCase.id}`, () => {
      const input = parityCase.input ?? readFileSync(parityCase.fixture!, 'utf-8');
      const base = parityCase.engineOptions ?? { input };
      const candidate = new LSAEngine({ ...base, input }).solve();
      const legacy = new LSAEngine({ ...base, input, structuredWeightTransfer: false }).solve();
      expect(fingerprint(legacy)).toBe(fingerprint(candidate));
    });
  }

  it('preserves preanalysis results on the dead-P path', () => {
    const input = [
      '.3D',
      'C A 0 0 0 ! ! !',
      'C B 100 0 0 ! ! !',
      'C P 60 40 0',
      'D A-P ? 0.003',
      'D B-P ? 0.003',
      'A P-A-B ? 1.0',
    ].join('\n');
    const options = {
      input,
      maxIterations: 6,
      parseOptions: {
        preanalysisMode: true,
        coordMode: '3D' as const,
        tsCorrelationEnabled: true,
        tsCorrelationRho: 0.5,
      },
    };
    const candidate = new LSAEngine({ ...options }).solve();
    const legacy = new LSAEngine({ ...options, structuredWeightTransfer: false }).solve();
    expect(fingerprint(legacy)).toBe(fingerprint(candidate));
    expect(candidate.tsCorrelationDiagnostics).toBeDefined();
  });
});
