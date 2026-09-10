/**
 * Phase 10B agent-tier contract: opt-in detailed stage timing/call-count
 * instrumentation and the per-iteration packed-system probe.
 *
 * Fast unit-scope checks (no WASM, no repeated campaigns): disabled by
 * default with zero public-contract change, enabled collection is sane,
 * and production 2D-only sparse eligibility is untouched.
 */
import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../src/engine/adjust';
import {
  createDetailedSolveProfiler,
  type IterationSystemProbeInput,
} from '../src/engine/adjustDetailedSolveProfile';
import { buildPhase6LargeBenchmarkCases } from '../src/engine/phase6BenchmarkNetworks';
import { evaluateSparseProductionEligibility } from '../src/engine/sparseProductionEligibility';

const fixture = buildPhase6LargeBenchmarkCases(false).find(
  (item) => item.id === 'gps-3d-cov-08',
);
if (!fixture) throw new Error('Missing genuine 3D fixture gps-3d-cov-08.');

const stripVolatile = (result: ReturnType<LSAEngine['solve']>) => {
  const logs = result.logs.filter((line) => !line.startsWith('Solve timing (ms):'));
  return JSON.stringify({
    success: result.success,
    converged: result.converged,
    iterations: result.iterations,
    dof: result.dof,
    seuw: result.seuw,
    stations: result.stations,
    observations: result.observations,
    condition: result.condition,
    logs,
  });
};

describe('Phase 10B detailed timing/probe contract', () => {
  it('leaves the public result contract unchanged when enabled', () => {
    const reference = new LSAEngine({ input: fixture.input }).solve();
    const profiler = createDetailedSolveProfiler();
    const probed: IterationSystemProbeInput[] = [];
    const instrumented = new LSAEngine({
      input: fixture.input,
      detailedSolveProfiler: profiler,
      iterationSystemProbe: (system) => {
        probed.push(system);
      },
    }).solve();
    expect(stripVolatile(instrumented)).toBe(stripVolatile(reference));
    expect('detailedSolveProfile' in instrumented).toBe(false);
  });

  it('collects sane per-stage timing and call counts', () => {
    const profiler = createDetailedSolveProfiler();
    const result = new LSAEngine({
      input: fixture.input,
      detailedSolveProfiler: profiler,
    }).solve();
    expect(result.success).toBe(true);
    expect(result.converged).toBe(true);
    expect(profiler.profile.iterationCount).toBe(result.iterations);
    expect(profiler.profile.iterations).toHaveLength(result.iterations);
    for (const record of profiler.profile.iterations) {
      expect(record.parameterCount).toBeGreaterThan(0);
      expect(record.equationCount).toBeGreaterThan(0);
      expect(record.designNnz).toBeGreaterThan(0);
      expect(record.weightNnz).toBeGreaterThan(0);
      expect(record.assemblyMs).toBeGreaterThanOrEqual(0);
      expect(record.accumulateMs).toBeGreaterThanOrEqual(0);
      expect(record.factorSolveMs).toBeGreaterThanOrEqual(0);
    }
    // Stage totals equal the per-iteration sums.
    const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0);
    expect(profiler.profile.assemblyMs).toBe(
      sum(profiler.profile.iterations.map((r) => r.assemblyMs)),
    );
    expect(profiler.profile.accumulateMs).toBe(
      sum(profiler.profile.iterations.map((r) => r.accumulateMs)),
    );
    // Dense covariance recovery runs once per converged solve.
    expect(profiler.profile.covariance.calls).toBe(1);
    expect(profiler.profile.covariance.invertMs).toBeGreaterThanOrEqual(0);
    expect(profiler.profile.statisticsMs).toBeGreaterThanOrEqual(0);
  });

  it('captures one well-formed packed system per iteration', () => {
    const probed: IterationSystemProbeInput[] = [];
    const result = new LSAEngine({
      input: fixture.input,
      iterationSystemProbe: (system) => {
        probed.push(system);
      },
    }).solve();
    expect(probed).toHaveLength(result.iterations);
    for (const system of probed) {
      expect(system.parameterCount).toBeGreaterThan(0);
      expect(system.observationEquationCount).toBeGreaterThan(0);
      expect(system.design.rowOffsets).toHaveLength(system.observationEquationCount + 1);
      expect(system.tsCorrection).toHaveLength(system.parameterCount);
      expect(system.misclosures).toHaveLength(system.observationEquationCount);
      expect(system.design.values.every((v) => Number.isFinite(v))).toBe(true);
      expect(system.weights.values.every((v) => Number.isFinite(v))).toBe(true);
      expect(system.tsCorrection.every((v) => Number.isFinite(v))).toBe(true);
    }
  });

  it('preserves production 2D-only sparse eligibility for 3D', () => {
    const verdict = evaluateSparseProductionEligibility({
      runMode: 'adjustment',
      wasmAvailable: true,
      workerAvailable: true,
      robustWeighting: false,
      tsCorrelation: false,
      gpsCovarianceWeighting: false,
      dimension: '3d',
      unknownCount: 8,
      maxUnknownCount: 64,
      rankRisk: 'none',
    });
    expect(verdict.eligible).toBe(false);
    expect(verdict.reasons.join(' ')).toContain("dimension '3d'");
  });
});
