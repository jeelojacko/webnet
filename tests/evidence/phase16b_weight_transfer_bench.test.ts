/**
 * Phase 16B weight-transfer benchmarks (EVIDENCE tier, manual-only).
 *
 * Measures construction + assembly (dense vs structured-omit, the actual
 * production candidate) across the oracle families at scale, plus dense
 * extremes (ts-setup-32 at m=32, ts-setup-128 at m=128, both density ~= 1.0)
 * and an m ~= 2000 stress. Reports wall time and transfer telemetry
 * (dense-P allocations/bytes vs structured builds/nnz) per case.
 *
 * Gate: the ROUTED outcome (structured where the hybrid policy admits,
 * dense fallback otherwise) must NOT regress >5% vs pure dense on any
 * case. The raw structured-omit column is reported for transparency: it
 * loses on dense shapes, which is why those stay dense.
 */
import { describe, expect, it } from 'vitest';

import { assembleAdjustmentEquations } from '../../src/engine/adjustmentEquationAssembly';
import type { AdjustmentEquationAssemblyOptions } from '../../src/engine/adjustmentEquationAssemblyTypes';
import {
  structuredWeightDensity,
  structuredWeightTransferEligible,
} from '../../src/engine/structuredWeightOracle';
import {
  resetStructuredWeightTelemetry,
  snapshotStructuredWeightTelemetry,
  type StructuredWeightTransferCounters,
} from '../../src/engine/structuredWeightTelemetry';
import {
  buildChain2D,
  buildGps2D,
  buildGps3D,
  buildTsDirections,
  buildTsSetupScope,
  medianWallMs,
  round4,
  type BuiltNetwork,
} from './phase16aWeightEvidenceShared';

const RUNS = 11;
/**
 * Absolute noise floor (ms): sub-ms assembly medians jitter by ~0.1-0.2
 * run to run, so a pure relative gate flakes. Real regressions (dense
 * shapes on the structured path) are 6-30 ms and still fail loudly.
 */
const NOISE_FLOOR_MS = 0.5;
const DENSE_OPTIONS: AdjustmentEquationAssemblyOptions | undefined = undefined;
const STRUCTURED_OPTIONS: AdjustmentEquationAssemblyOptions = {
  weightRepresentation: 'sparse',
  omitDenseP: true,
};

interface BenchRow {
  case: string;
  m: number;
  density: number;
  denseMs: number;
  structuredMs: number;
  routedMs: number;
  routedSpeedup: number;
  fallback: boolean;
  denseBytes: number;
  structuredNnz: number;
}

const timeAssembly = (
  network: BuiltNetwork,
  options: AdjustmentEquationAssemblyOptions | undefined,
): { ms: number; telemetry: StructuredWeightTransferCounters } => {
  resetStructuredWeightTelemetry();
  const ms = medianWallMs(RUNS, () => {
    assembleAdjustmentEquations(
      network.deps,
      network.observations,
      network.constraints,
      network.numObsEquations,
      network.numParams,
      undefined,
      options,
    );
  });
  return { ms, telemetry: snapshotStructuredWeightTelemetry() };
};

const benchCase = (network: BuiltNetwork): BenchRow => {
  const dense = timeAssembly(network, DENSE_OPTIONS);
  const structured = timeAssembly(network, STRUCTURED_OPTIONS);
  // Shipped hybrid routing: the m gate plus the exact density gate on
  // writer metadata. Production decides pre-assembly through the UB
  // estimator, which is exact on these builders (proven in
  // phase16b_iteration_structured), so the post-hoc density here matches
  // the shipped accumulation routing.
  const probe = assembleAdjustmentEquations(
    network.deps,
    network.observations,
    network.constraints,
    network.numObsEquations,
    network.numParams,
    undefined,
    STRUCTURED_OPTIONS,
  );
  const density = structuredWeightDensity(probe.structuredWeights!);
  const fallback = !structuredWeightTransferEligible(network.numObsEquations, density);
  const routed = fallback ? dense : structured;
  expect(dense.telemetry.densePAllocations).toBe(RUNS + 1);
  expect(structured.telemetry.densePAllocations).toBe(0);
  expect(structured.telemetry.structuredWeightBuilds).toBe(RUNS + 1);
  // The shipped routing never regresses >5% vs pure dense (plus a noise
  // floor for sub-ms jitter).
  expect(routed.ms).toBeLessThanOrEqual(dense.ms * 1.05 + NOISE_FLOOR_MS);
  return {
    case: network.id,
    m: network.numObsEquations,
    density: round4(density),
    denseMs: round4(dense.ms),
    structuredMs: round4(structured.ms),
    routedMs: round4(routed.ms),
    routedSpeedup: round4(dense.ms / Math.max(routed.ms, 1e-9)),
    fallback,
    denseBytes: dense.telemetry.densePBytesAllocated,
    structuredNnz: structured.telemetry.structuredNnz,
  };
};

describe('phase 16B weight transfer benchmarks', () => {
  it('reports construction + assembly across families and scale', () => {
    const networks = [
      buildChain2D('chain-128', 128),
      buildGps2D('gps-2d-128', 128),
      buildGps3D('gps-3d-128', 128),
      buildTsDirections('ts-set-8x8', 8, 8),
      buildTsDirections('ts-set-16x8', 16, 8),
      buildTsSetupScope('ts-setup-32', 4, 8),
      buildTsSetupScope('ts-setup-128', 16, 8),
      buildChain2D('chain-1000', 1000),
    ];
    const rows = networks.map(benchCase);
    console.log(`\n16B transfer bench (median of ${RUNS}, ms):`);
    for (const row of rows) {
      console.log(
        `${row.case} m=${row.m} density=${row.density} dense=${row.denseMs} structured=${row.structuredMs} ` +
          `routed=${row.routedMs} speedup=${row.routedSpeedup}x ` +
          `fallback=${row.fallback} denseBytes=${row.denseBytes} nnz=${row.structuredNnz}`,
      );
    }
    // Dense extreme (density ~= 1.0, m < crossover): dense fallback engaged.
    const denseExtreme = rows.find((row) => row.case === 'ts-setup-32');
    expect(denseExtreme).toBeDefined();
    expect(denseExtreme!.fallback).toBe(true);
    expect(denseExtreme!.structuredMs).toBeGreaterThan(denseExtreme!.denseMs);
    // Dense shape at scale (m >= crossover, density ~= 1.0): the density
    // gate — not the m gate — keeps it dense.
    const denseAtScale = rows.find((row) => row.case === 'ts-setup-128');
    expect(denseAtScale).toBeDefined();
    expect(denseAtScale!.m).toBe(128);
    expect(denseAtScale!.density).toBeGreaterThan(0.5);
    expect(denseAtScale!.fallback).toBe(true);
    expect(denseAtScale!.structuredMs).toBeGreaterThan(denseAtScale!.denseMs);
    // Correlated TS sets above the density cap stay dense even at m >= 128.
    const denseTsSet = rows.find((row) => row.case === 'ts-set-16x8');
    expect(denseTsSet).toBeDefined();
    expect(denseTsSet!.fallback).toBe(true);
    // Sub-crossover TS sets also stay dense.
    const smallTs = rows.find((row) => row.case === 'ts-set-8x8');
    expect(smallTs).toBeDefined();
    expect(smallTs!.fallback).toBe(true);
    // m ~= 2000 stress: structured engaged; dense-P churn eliminated.
    const stress = rows.find((row) => row.case === 'chain-1000');
    expect(stress).toBeDefined();
    expect(stress!.m).toBe(2000);
    expect(stress!.fallback).toBe(false);
    expect(stress!.denseBytes).toBeGreaterThan(0);
    expect(stress!.structuredNnz).toBe(0);
  });
});
