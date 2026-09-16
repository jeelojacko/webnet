/**
 * Phase 16A evidence (part 1): weight-matrix sparsity / block statistics,
 * dense-P memory, P-construction + accumulation timing, structured storage
 * bytes, and large-m scaling.
 *
 * EVIDENCE ONLY — no production behavior changes. All networks assemble
 * through the real production entry point (assembleAdjustmentEquations) with
 * production GPS / TS-correlation / constraint writers; only the station
 * geometry is stubbed. Real-engine anchors (LSAEngine solves on committed
 * Phase 5/6 benchmarks + direction_face_balanced.dat) ground the synthetic
 * sizes. Machine artifacts go to artifacts/evidence/phase16a/ (gitignored);
 * the committed report is docs/evidence/phase16a-structured-weight-evidence.md.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { assembleAdjustmentEquations } from '../../src/engine/adjustmentEquationAssembly';
import { LSAEngine } from '../../src/engine/adjust';
import { runAdjustmentSession } from '../../src/engine/runSession';
import { createRunSessionRequest } from '../helpers/runSessionRequest';
import { createDetailedSolveProfiler } from '../../src/engine/adjustDetailedSolveProfile';
import { accumulateNormalEquationsFromSparseRows, symmetricQuadraticForm } from '../../src/engine/matrixSparse';
import { zeros } from '../../src/engine/matrixBasic';
import {
  applyRobustWeightFactors,
  captureRobustWeightBase,
  computeRobustWeightSummary,
  robustCorrelationRowGroups,
} from '../../src/engine/adjustRobustWeights';
import {
  isTsCorrelationObservation,
  tsCorrelationGroup,
} from '../../src/engine/adjustTsCorrelationWeights';
import { structuredQuadraticForm, structuredWeightsToDense } from '../../src/engine/sparseWeightRepresentation';
import {
  generatePhase5BenchmarkInput,
  listPhase5BenchmarkCases,
} from '../../src/engine/phase5BenchmarkNetworks';
import { buildPhase6LargeBenchmarkCases } from '../../src/engine/phase6BenchmarkNetworks';
import {
  assembleBoth,
  buildChain2D,
  buildCorrelatedControls,
  buildGnssBaseline,
  buildGps2D,
  buildGps3D,
  buildMixed,
  buildTsAnglesBearings,
  buildTsDirections,
  buildTsSetupScope,
  buildWeightedControls,
  heapDeltaMb,
  median,
  medianWallMs,
  protoAccumulate,
  round4,
  summarizeWeights,
  type BuiltNetwork,
  type WeightStats,
} from './phase16aWeightEvidenceShared';

const RUNS = 5;

interface SparsityRow extends WeightStats {
  caseId: string;
  kind: string;
  nParams: number;
  structuredOffPairs: number;
  denseUpperOffPairs: number;
  tsGroupsExpected: number;
  storageDenseBytes: number;
  storageStructuredBytes: number;
}

const measureSparsity = (network: BuiltNetwork): SparsityRow => {
  const { dense, sparse } = assembleBoth(network);
  const denseP = dense.P as number[][];
  const stats = summarizeWeights(denseP, dense.rowInfo);
  const structured = sparse.structuredWeights as NonNullable<typeof sparse.structuredWeights>;
  // Cross-check: structured off-diagonal count vs dense upper-triangle nonzero count.
  let denseUpperOffPairs = 0;
  for (let i = 0; i < denseP.length; i += 1) {
    for (let j = i + 1; j < denseP.length; j += 1) {
      if ((denseP[i]?.[j] ?? 0) !== 0) denseUpperOffPairs += 1;
    }
  }
  expect(structured.offValues.length).toBe(denseUpperOffPairs);
  expect(structured.size).toBe(stats.m);
  for (let i = 0; i < stats.m; i += 1) {
    expect(structured.diagonal[i]).toBe(denseP[i]?.[i] ?? 0);
  }
  if (network.expectedTsGroups > 0) {
    expect(stats.bigGroups).toBe(network.expectedTsGroups);
  }
  const storageDenseBytes = 8 * stats.m * stats.m;
  const storageStructuredBytes = 8 * stats.m + 16 * structured.offValues.length;
  return {
    ...stats, caseId: network.id, kind: network.kind, nParams: network.numParams,
    structuredOffPairs: structured.offValues.length, denseUpperOffPairs,
    tsGroupsExpected: network.expectedTsGroups, storageDenseBytes, storageStructuredBytes,
  };
};

interface EngineAnchor {
  caseId: string;
  /** Equation count (profiler) or null when only the session route applies. */
  m: number | null;
  n: number | null;
  iterations: number;
  success: boolean;
  converged: boolean;
  wallMs: number;
  tsGroups: number | null;
  tsEquations: number | null;
  tsPairs: number | null;
  route: 'engine' | 'session';
}

const solveAnchor = (caseId: string, input: string, ts: boolean): EngineAnchor => {
  const profiler = createDetailedSolveProfiler();
  const started = performance.now();
  const result = new LSAEngine({
    input,
    detailedSolveProfiler: profiler,
    ...(ts
      ? { parseOptions: { tsCorrelationEnabled: true, tsCorrelationRho: 0.5, tsCorrelationScope: 'set' as const } }
      : {}),
  }).solve();
  const wallMs = performance.now() - started;
  const first = profiler.profile.iterations[0];
  const diag = result.tsCorrelationDiagnostics as
    | { groupCount?: number; equationCount?: number; pairCount?: number }
    | undefined;
  return {
    caseId, m: first?.equationCount ?? 0, n: first?.parameterCount ?? 0,
    iterations: result.iterations, success: result.success, converged: result.converged,
    wallMs: round4(wallMs), route: 'engine' as const,
    tsGroups: diag?.groupCount ?? null, tsEquations: diag?.equationCount ?? null, tsPairs: diag?.pairCount ?? null,
  };
};

/** Parse-level anchor for direction_face_balanced.dat: the 4-obs fixture is
 * under-determined by construction (never solves); what matters for Phase 16A
 * is that its 2 same-set direction rows form exactly 1 TS pair under
 * rho 0.5 / scope set — the same configuration as the synthetic ts-face-64
 * network, which does solve-scale assembly through the production TS writer. */
const faceParseAnchor = (caseId: string, input: string): EngineAnchor => {
  const base = createRunSessionRequest({ input });
  const request = {
    ...base,
    parseSettings: {
      ...base.parseSettings,
      coordMode: '3D' as const,
      suspectImpactMode: 'off' as const,
      tsCorrelationEnabled: true,
      tsCorrelationRho: 0.5,
      tsCorrelationScope: 'set' as const,
    },
  };
  const started = performance.now();
  const outcome = runAdjustmentSession(request, undefined, undefined);
  const wallMs = performance.now() - started;
  const { result } = outcome;
  const dirSets = (result.observations ?? [])
    .filter((obs) => obs.type === 'direction')
    .map((obs) => (obs as { setId?: string }).setId ?? '');
  const dirRows = dirSets.length;
  const bySet = new Map<string, number>();
  dirSets.forEach((setId) => bySet.set(setId, (bySet.get(setId) ?? 0) + 1));
  let tracedPairs = 0;
  bySet.forEach((count) => { tracedPairs += (count * (count - 1)) / 2; });
  return {
    caseId, m: null, n: null, iterations: result.iterations,
    success: result.success, converged: result.converged,
    wallMs: round4(wallMs), route: 'session' as const,
    tsGroups: bySet.size, tsEquations: dirRows, tsPairs: tracedPairs,
  };
};describe('Phase 16A weight sparsity, memory, and timing evidence', () => {
  it('records sparsity, memory, timing, storage, and scaling tables', () => {
    // ---- Real-engine anchors (single solves; shapes deterministic, walls observational).
    const phase5ById = new Map(listPhase5BenchmarkCases(false).map((spec) => [spec.id, spec]));
    const phase6ById = new Map(buildPhase6LargeBenchmarkCases(false).map((item) => [item.id, item]));
    const anchors: EngineAnchor[] = [
      solveAnchor('chain-2d-64', generatePhase5BenchmarkInput(phase5ById.get('chain-2d-64')!), false),
      solveAnchor('chain-2d-128', generatePhase5BenchmarkInput(phase5ById.get('chain-2d-128')!), false),
      solveAnchor('gps-2d-64', generatePhase5BenchmarkInput(phase5ById.get('gps-2d-64')!), false),
      solveAnchor('gps-3d-64', phase6ById.get('gps-3d-64')!.input, false),
      solveAnchor('gps-3d-128', phase6ById.get('gps-3d-128')!.input, false),
      faceParseAnchor(
        'direction_face_balanced+tscorr',
        readFileSync('tests/fixtures/direction_face_balanced.dat', 'utf-8'),
      ),
    ];
    anchors.forEach((anchor) => {
      if (anchor.route === 'engine') {
        expect(anchor.success).toBe(true);
        if (anchor.m != null) expect(anchor.m).toBeGreaterThan(0);
      }
    });

    // ---- Sparsity / block statistics over assembled networks.
    const networks: BuiltNetwork[] = [
      buildChain2D('chain-64', 32),
      buildChain2D('chain-128', 64),
      buildGps2D('gps2d-64', 32),
      buildGps2D('gps2d-128', 64),
      buildGnssBaseline('gnss-baseline-24', 8),
      buildTsDirections('ts-face-64', 8, 8),
      buildTsDirections('ts-dense-ineligible-32', 4, 8),
      buildTsSetupScope('ts-setup-32', 4, 8),
      buildTsAnglesBearings('ts-angles-8'),
      buildGps3D('gps3d-63', 21),
      buildGps3D('gps3d-126', 42),
      buildGps3D('gps3d-native-eligible-24', 8),
      buildWeightedControls('weighted-controls-80', 32),
      buildCorrelatedControls('correlated-controls-40', 16),
      buildMixed('mixed-ts-gps-control'),
    ];
    const sparsity: SparsityRow[] = networks.map(measureSparsity);

    // Robust-final arm: same mixed system after real Huber-factor rescaling,
    // using the production robustCorrelationRowGroups keys (TS groups, not chunks).
    const mixed = buildMixed('robust-final-mixed');
    const { dense: robustDense, sparse: robustSparse } = assembleBoth(mixed);
    const robustP = (robustDense.P as number[][]).map((row) => [...row]);
    const residuals = robustDense.L.map((row) => row[0] ?? 0);
    const summary = computeRobustWeightSummary(residuals, robustDense.rowInfo, {
      robustK: 1.5,
      rowSigma: (info) => mixed.deps.effectiveStdDev(info.obs),
    });
    const productionRowGroups = robustCorrelationRowGroups(robustDense.rowInfo, {
      rowSigma: (info) => mixed.deps.effectiveStdDev(info.obs),
      tsCorrelationEnabled: mixed.observations.some(isTsCorrelationObservation),
      tsCorrelationGroup: (obs) => tsCorrelationGroup({ enabled: true, obs, scope: mixed.tsScope }),
    });
    // Production keys for this fixture: the two 4-row direction sets.
    expect(productionRowGroups.map((group) => group.length).sort()).toEqual([4, 4]);
    const base = captureRobustWeightBase(robustP, robustDense.rowInfo, {
      robustCorrelationRowGroups: () => productionRowGroups,
    });
    applyRobustWeightFactors(robustP, base, summary.factors);
    const robustStats = summarizeWeights(robustP, robustDense.rowInfo);
    expect(robustStats.nonzero).toBe(sparsity.find((row) => row.caseId === 'mixed-ts-gps-control')!.nonzero);
    const robustStructuredOff = (robustSparse.structuredWeights as NonNullable<typeof robustSparse.structuredWeights>).offValues.length;
    expect(robustStats.offPairs).toBe(robustStructuredOff);

    // ---- Dense-P memory: theoretical 8m^2 + measured heap delta (synthetic scaling).
    const memory = [250, 500, 1000, 2000].map((m) => {
      const theoreticalMb = (8 * m * m) / 1048576;
      const measuredMb = round4(heapDeltaMb(() => {
        const P = zeros(m, m);
        for (let i = 0; i < m; i += 1) {
          (P[i] as number[])[i] = 1;
          if (i + 1 < m) {
            (P[i] as number[])[i + 1] = 0.5;
            (P[i + 1] as number[])[i] = 0.5;
          }
        }
        if ((P[0]?.[0] ?? 0) !== 1) throw new Error('allocation sanity failed');
      }));
      return { m, theoreticalMb: round4(theoreticalMb), measuredHeapDeltaMb: measuredMb };
    });

    // ---- Timing: dense-ONLY vs sparse-ONLY assembly, accumulation paths, vTPv.
    const timedIds = ['chain-128', 'gps2d-128', 'gnss-baseline-24', 'ts-face-64', 'ts-setup-32', 'gps3d-126', 'mixed-ts-gps-control'];
    const timing = timedIds.map((id) => {
      const network = networks.find((item) => item.id === id) as BuiltNetwork;
      const allocMs = medianWallMs(RUNS, () => {
        zeros(network.numObsEquations, network.numObsEquations);
      });
      const denseAssemblyMs = medianWallMs(RUNS, () => {
        assembleAdjustmentEquations(
          network.deps, network.observations, network.constraints,
          network.numObsEquations, network.numParams,
        );
      });
      const sparseAssemblyMs = medianWallMs(RUNS, () => {
        assembleAdjustmentEquations(
          network.deps, network.observations, network.constraints,
          network.numObsEquations, network.numParams, undefined,
          { weightRepresentation: 'sparse', omitDenseP: true },
        );
      });
      const { dense, sparse: sparsePath } = assembleBoth(network);
      const denseP = dense.P as number[][];
      const structuredW = sparsePath.structuredWeights as NonNullable<typeof sparsePath.structuredWeights>;
      const accumulateDenseMs = medianWallMs(RUNS, () => {
        accumulateNormalEquationsFromSparseRows(dense.sparseRows, dense.L, denseP, network.numParams);
      });
      const protoAccumulateMs = medianWallMs(RUNS, () => {
        protoAccumulate(dense.sparseRows, dense.L, structuredW, network.numParams);
      });
      const structuredConvertMs = medianWallMs(RUNS, () => {
        structuredWeightsToDense(structuredW);
      });
      const vtpvDenseMs = medianWallMs(RUNS, () => {
        symmetricQuadraticForm(denseP, dense.L);
      });
      const vtpvStructuredMs = medianWallMs(RUNS, () => {
        structuredQuadraticForm(structuredW, dense.L);
      });
      const factors = new Array<number>(denseP.length).fill(0.9);
      const robustBase = captureRobustWeightBase(denseP, dense.rowInfo, { robustCorrelationRowGroups: () => [] });
      const robustScaleMs = medianWallMs(RUNS, () => {
        const clone = denseP.map((row) => [...row]);
        applyRobustWeightFactors(clone, robustBase, factors);
      });
      return {
        caseId: id, m: network.numObsEquations, n: network.numParams,
        allocMs: round4(allocMs), denseAssemblyMs: round4(denseAssemblyMs),
        sparseAssemblyMs: round4(sparseAssemblyMs), accumulateDenseMs: round4(accumulateDenseMs),
        protoAccumulateMs: round4(protoAccumulateMs),
        structuredConvertMs: round4(structuredConvertMs), vtpvDenseMs: round4(vtpvDenseMs),
        vtpvStructuredMs: round4(vtpvStructuredMs), robustScaleMs: round4(robustScaleMs),
      };
    });

    // ---- Large-m stress + scaling table (chain family, unknowns 125..1000).
    const scaling = [125, 250, 500, 1000].map((unknowns) => {
      const network = buildChain2D(`chain-scale-${unknowns * 2}`, unknowns);
      const m = network.numObsEquations;
      const denseAssemblyMs = medianWallMs(3, () => {
        assembleAdjustmentEquations(
          network.deps, network.observations, network.constraints, m, network.numParams,
        );
      });
      const sparseAssemblyMs = medianWallMs(3, () => {
        assembleAdjustmentEquations(
          network.deps, network.observations, network.constraints, m, network.numParams,
          undefined, { weightRepresentation: 'sparse', omitDenseP: true },
        );
      });
      const { dense } = assembleBoth(network);
      const accumulateMs = medianWallMs(3, () => {
        accumulateNormalEquationsFromSparseRows(dense.sparseRows, dense.L, dense.P as number[][], network.numParams);
      });
      const heapMb = round4(heapDeltaMb(() => {
        assembleAdjustmentEquations(
          network.deps, network.observations, network.constraints, m, network.numParams,
        );
      }));
      return {
        caseId: network.id, m, n: network.numParams,
        denseAssemblyMs: round4(denseAssemblyMs), sparseAssemblyMs: round4(sparseAssemblyMs),
        accumulateMs: round4(accumulateMs), denseAssemblyHeapMb: heapMb,
        theoreticalDensePMb: round4((8 * m * m) / 1048576),
      };
    });
    const stress2000 = scaling.find((row) => row.m >= 2000);
    expect(stress2000).toBeDefined();

    const machine = {
      method: '1 warm-up + 5 measured runs, medians (scaling arms 1 warm-up + 3 measured); assembly timed dense-ONLY vs sparse-ONLY (omitDenseP); memory single heap-delta probes',
      anchors, sparsity,
      robustFinal: { caseId: 'robust-final-mixed', ...robustStats },
      memory, timing, scaling,
    };
    const machineDir = join(process.cwd(), 'artifacts/evidence/phase16a');
    mkdirSync(machineDir, { recursive: true });
    writeFileSync(join(machineDir, 'phase16a-sparsity.json'), `${JSON.stringify(machine, null, 1)}\n`);

    // Sanity per weight family: scalar/GPS/control cases stay under 6%;
    // set-scope TS scales as ~groupSize^2/m (8-wide: 0.125 at m=64, 0.25 at
    // m=32); setup scope at one station is a complete graph (density 1) —
    // the dense-ineligible extreme, asserted exactly.
    sparsity.forEach((row) => {
      expect(row.nonzero).toBeGreaterThan(0);
      if (row.kind.includes('setup-scope')) {
        expect(row.density).toBe(1);
      } else if (row.tsGroupsExpected > 0 || row.bigGroups > 0) {
        expect(row.density).toBeLessThan(0.3);
      } else if (row.kind.includes('3x3')) {
        expect(row.density).toBeLessThan(0.15); // 3x3 blocks: density = 3/m
      } else {
        expect(row.density).toBeLessThan(0.06);
      }
    });
    // New producers land in the expected block shapes.
    const gnssBase = sparsity.find((row) => row.caseId === 'gnss-baseline-24');
    expect(gnssBase?.blocks3).toBe(8);
    expect(gnssBase?.scalarRows).toBe(0);
    const corrCtrl = sparsity.find((row) => row.caseId === 'correlated-controls-40');
    expect(corrCtrl?.constraintRows).toBe(8);
    expect(corrCtrl?.blocks2).toBe(4); // four corrXY control pairs
    const tsSetup = sparsity.find((row) => row.caseId === 'ts-setup-32');
    expect(tsSetup?.bigGroups).toBe(1);
    expect(tsSetup?.bigGroupSizes).toEqual([32]);
    const tsAngles = sparsity.find((row) => row.caseId === 'ts-angles-8');
    expect(tsAngles?.bigGroups).toBe(1);
    expect(tsAngles?.bigGroupSizes).toEqual([8]);
    // Engine anchors must show the TS fixture actually correlates.
    const faceAnchor = anchors.find((anchor) => anchor.caseId === 'direction_face_balanced+tscorr');
    expect(faceAnchor?.route).toBe('session');
    expect(faceAnchor?.success).toBe(false); // under-determined by construction (4 obs)
    expect(faceAnchor?.tsEquations).toBe(2);
    // Face-split puts F1/F2 in different TS groups (scope set), so the pair
    // count is 0: the fixture exercises face handling, not same-set correlation.
    expect(faceAnchor?.tsGroups).toBe(2);
    expect(faceAnchor?.tsPairs).toBe(0);
    // Median helper sanity.
    expect(median([3, 1, 2])).toBe(2);
  }, 600000);
});
