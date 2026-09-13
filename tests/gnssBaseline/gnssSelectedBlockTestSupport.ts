/**
 * Phase 12F.2 test-only support: small-network packed systems with a TS
 * dense Qxx oracle for selected-block tests (no WASM, no production use).
 */
import { assembleAdjustmentEquations } from '../../src/engine/adjustmentEquationAssembly';
import { buildSolveParameterIndex } from '../../src/engine/adjustmentPreprocessing';
import { invertNormalMatrixForStats } from '../../src/engine/adjustNormalEquationHelpers';
import { applyGnssSetupUncertainty } from '../../src/engine/gnssBaselineSetupUncertainty';
import { runGnssBaselinePreflight } from '../../src/engine/gnssBaselinePreflight';
import { accumulateNormalEquationsFromSparseRows } from '../../src/engine/matrixSparse';
import type { SolveParameterIndex } from '../../src/engine/adjustmentSolveTypes';
import type { SparseEquationSystem } from '../../src/engine/numericalBackend';
import {
  packSparseDesignRows,
  packUpperTriangleWeights,
} from '../../src/engine/sparseEquationPacking';
import type { StationMap } from '../../src/types';
import {
  buildGnssAdjustInput,
  generateAuditNetwork,
  gnssAssemblyContext,
  type AuditTopology,
} from '../../scripts/gnss/gnssNativeArchitectureAudit';
import type { GnssBaselineObservation } from '../../src/engine/gnssBaselineTypes';

export interface BlockTestNetwork {
  readonly stations: StationMap;
  readonly baselines: GnssBaselineObservation[];
  readonly paramIndex: SolveParameterIndex;
  readonly numParams: number;
  readonly system: SparseEquationSystem;
  /** TS dense Qxx oracle over the identical packed system. */
  readonly qxx: number[][];
}

/** Single final assembly at intake coords; covariance math is identical either way. */
export const buildBlockTestNetwork = (
  topology: AuditTopology,
  stationCount: number,
  seed: number,
): BlockTestNetwork => {
  const input = buildGnssAdjustInput(generateAuditNetwork(topology, stationCount, seed));
  const stations: StationMap = Object.fromEntries(
    Object.entries(input.stations).map(([id, station]) => [id, { ...station }]),
  );
  const baselines = [...input.baselines].sort((a, b) => a.id - b.id);
  const setupApplied = applyGnssSetupUncertainty({
    stations,
    baselines,
    setup: input.setupUncertainty,
    ellipsoid: input.ellipsoid,
  });
  const effectiveBaselines = setupApplied.baselines;
  const preflight = runGnssBaselinePreflight({
    stations,
    baselines: effectiveBaselines,
    referenceFrame: input.referenceFrame,
    epoch: input.epoch,
    ellipsoid: input.ellipsoid,
  });
  const unknowns = preflight.components
    .flat()
    .filter((stationIdValue) => {
      const station = stations[stationIdValue];
      return !!station && !(station.fixedX && station.fixedY && station.fixedH);
    })
    .sort();
  const { paramIndex, stationParamCount } = buildSolveParameterIndex(stations, unknowns, false);
  const numParams = stationParamCount;
  const assembled = assembleAdjustmentEquations(
    gnssAssemblyContext(stations, paramIndex) as Parameters<typeof assembleAdjustmentEquations>[0],
    effectiveBaselines as unknown[] as Parameters<typeof assembleAdjustmentEquations>[1],
    [],
    preflight.equationCount,
    numParams,
    1,
  );
  const finalP = assembled.P ?? [];
  const system: SparseEquationSystem = {
    design: packSparseDesignRows(assembled.sparseRows),
    weights: packUpperTriangleWeights(finalP, assembled.L.length),
    observationEquationCount: assembled.L.length,
    parameterCount: numParams,
  };
  const { normal } = accumulateNormalEquationsFromSparseRows(
    assembled.sparseRows,
    assembled.L,
    finalP,
    numParams,
  );
  const qxx = invertNormalMatrixForStats(normal, () => {});
  return { stations, baselines: effectiveBaselines, paramIndex, numParams, system, qxx };
};
