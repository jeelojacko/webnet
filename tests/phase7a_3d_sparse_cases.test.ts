/**
 * Phase 7A serious deterministic 3D survey cases: generator, TS truth, and
 * manageable TS-vs-sparse coverage with separate horizontal/height checks.
 *
 * Sparse comparisons need the real WASM module and skip gracefully when it
 * is unavailable; TS convergence/truth coverage always runs. No production
 * routing or tolerances are touched.
 */
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../src/engine/adjust';
import {
  buildPhase6LargeBenchmarkCases,
  listPhase6LargeBenchmarkCases,
  phase6ChainTruth,
  phase6HeightTruth,
  phase6TruthDiffs,
} from '../src/engine/phase6BenchmarkNetworks';
import { compareSparseShadowResults } from '../src/engine/phase6SparseShadowCompare';
import {
  buildExperimentalSparseEngineOptions,
  createExperimentalSparseNumericalBundle,
} from '../src/engine/wasm/experimentalSparseNumericalBundle';
import { createExperimentalSparseRouteDiagnostics } from '../src/engine/experimentalSparseDiagnostics';
import type { WebNetWasmFactory } from '../src/engine/wasm/wasmTypes';

const NEW_3D_IDS = ['gps-3d-16', 'gps-3d-32', 'gps-3d-64', 'gps-3d-128'];
const TRUTH_TOLERANCE_M = 0.1;
const SHADOW_TOLERANCE_M = 1e-6;

const solveTs = (input: string) => new LSAEngine({ input }).solve();

/** Loads the real WASM factory, or null when the build is absent. */
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

describe('phase 7A deterministic 3D survey cases', () => {
  it('lists the new 3D cases in full mode and gps-3d-16 in quick mode', () => {
    const fullIds = listPhase6LargeBenchmarkCases(false).map((c) => c.id);
    for (const id of NEW_3D_IDS) expect(fullIds).toContain(id);
    expect(listPhase6LargeBenchmarkCases(true).map((c) => c.id)).toContain('gps-3d-16');
  });

  it('builds real WebNet 3D syntax with mixed observations and EN correlation', () => {
    for (const benchmarkCase of buildPhase6LargeBenchmarkCases(false)) {
      if (!NEW_3D_IDS.includes(benchmarkCase.id)) continue;
      expect(benchmarkCase.dimension).toBe('3d');
      expect(benchmarkCase.variant).toBe('gps-covariance');
      expect(benchmarkCase.stationCount).toBe(benchmarkCase.unknownCount + 2);
      expect(benchmarkCase.input).toContain('.3D');
      expect(benchmarkCase.input).toContain('.GPS WEIGHT COVARIANCE');
      // Mixed horizontal + vertical observations.
      expect(benchmarkCase.input).toContain('\nD CTRLA-U1 ');
      expect(benchmarkCase.input).toContain('\nB CTRLA-U1 ');
      expect(benchmarkCase.input).toContain('\nV CTRLA-U1 ');
      // Correlated GPS EN vectors (explicit sigmaE sigmaN corrEN).
      expect(benchmarkCase.input).toContain(' 0.010 0.010 0.35');
      expect(benchmarkCase.input).toContain('C CTRLA 0.0000 0.0000 10.0000 ! ! !');
    }
  });

  it('regenerates byte-identical 3D inputs', () => {
    const first = buildPhase6LargeBenchmarkCases(false);
    const second = buildPhase6LargeBenchmarkCases(false);
    for (const id of NEW_3D_IDS) {
      expect(first.find((c) => c.id === id)?.input).toBe(
        second.find((c) => c.id === id)?.input,
      );
    }
  });

  it('solves every new 3D case to convergence with separate horizontal/height truth checks', () => {
    for (const benchmarkCase of buildPhase6LargeBenchmarkCases(false)) {
      if (!NEW_3D_IDS.includes(benchmarkCase.id)) continue;
      const result = solveTs(benchmarkCase.input);
      expect(result.success).toBe(true);
      expect(result.converged).toBe(true);
      expect(Object.keys(result.stations)).toHaveLength(benchmarkCase.stationCount);
      const types = new Set<string>(result.observations.map((obs) => obs.type));
      for (const expected of ['dist', 'bearing', 'lev', 'gps']) {
        expect(types.has(expected)).toBe(true);
      }
      const { horizontalM, heightM } = phase6TruthDiffs(result.stations, benchmarkCase);
      expect(horizontalM).toBeLessThanOrEqual(TRUTH_TOLERANCE_M);
      expect(heightM).toBeLessThanOrEqual(TRUTH_TOLERANCE_M);
    }
  });

  it('checks truth helpers against the generated chain/height layout', () => {
    const built = buildPhase6LargeBenchmarkCases(false).find((c) => c.id === 'gps-3d-16');
    const result = solveTs(built?.input ?? '');
    const { horizontalM, heightM } = phase6TruthDiffs(result.stations, {
      unknownCount: 16,
      dimension: '3d',
    });
    // Spot-check the helper against a direct per-station computation.
    let expectedH = 0;
    let expectedV = 0;
    for (let i = 0; i < 16; i += 1) {
      const station = result.stations[`U${i + 1}`];
      const truth = phase6ChainTruth(i);
      expectedH = Math.max(expectedH, Math.abs(station.x - truth.e), Math.abs(station.y - truth.n));
      expectedV = Math.max(expectedV, Math.abs(station.h - phase6HeightTruth(i + 1)));
    }
    expect(horizontalM).toBe(expectedH);
    expect(heightM).toBe(expectedV);
  });

  it('fails the truth helper closed on missing stations', () => {
    expect(phase6TruthDiffs({}, { unknownCount: 4, dimension: '3d' })).toEqual({
      horizontalM: Number.POSITIVE_INFINITY,
      heightM: Number.POSITIVE_INFINITY,
    });
  });
});

describe.runIf(wasmFactory != null)('phase 7A TS-vs-sparse 3D agreement', () => {
  it.each(['gps-3d-16', 'gps-3d-32'])(
    'matches the TS reference on %s with zero fallbacks',
    async (id) => {
      const benchmarkCase = buildPhase6LargeBenchmarkCases(false).find((c) => c.id === id);
      const reference = solveTs(benchmarkCase?.input ?? '');
      const bundle = await createExperimentalSparseNumericalBundle(wasmFactory!);
      const diagnostics = createExperimentalSparseRouteDiagnostics();
      const candidate = new LSAEngine({
        input: benchmarkCase?.input ?? '',
        ...buildExperimentalSparseEngineOptions(bundle, diagnostics, true),
      }).solve();
      const comparison = compareSparseShadowResults(reference, candidate, SHADOW_TOLERANCE_M);
      expect(comparison.pass).toBe(true);
      expect(comparison.passReasons).toEqual([]);
      expect(
        diagnostics.sparseCorrectionFallbacks +
          diagnostics.rowProductsFallbacks +
          diagnostics.selectedCovarianceFallbacks,
      ).toBe(0);
      // Separate horizontal/height diagnostics on the sparse result.
      const { horizontalM, heightM } = phase6TruthDiffs(candidate.stations, {
        unknownCount: benchmarkCase?.unknownCount ?? 0,
        dimension: '3d',
      });
      expect(horizontalM).toBeLessThanOrEqual(TRUTH_TOLERANCE_M);
      expect(heightM).toBeLessThanOrEqual(TRUTH_TOLERANCE_M);
    },
  );
});
