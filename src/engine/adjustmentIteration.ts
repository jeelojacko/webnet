import {
  accumulateNormalEquationsFromSparseRows,
  denseRowsToSparseRows,
  multiplySparseRowsByDenseMatrix,
  zeros,
} from './matrix';
import type { SparseMatrixRows } from './matrix';
import type { ExperimentalSparseRouteDiagnostics } from './experimentalSparseDiagnostics';
import { recordSparseCorrectionCall } from './experimentalSparseDiagnostics';
import type { StationMap } from '../types';
import { buildSparseSolveInput, buildSparseSolveInputWithPackedWeights } from './sparseEquationPacking';
import { structuredQuadraticForm, structuredWeightsToPackedUpper } from './sparseWeightRepresentation';
import type { StructuredSymmetricWeights } from './sparseWeightRepresentation';
import { runHuberWeightLoop } from './adjustmentHuberLoop';
import type {
  EquationRowInfo,
  IterationSolveDependencies,
  SolveParameterIndex,
} from './adjustmentSolveTypes';

export interface AdjustmentIterationComputationResult {
  correction: number[][];
  qxx?: number[][];
  solvedP?: number[][];
  sumBefore: number;
  sumAfter: number;
  maxBefore: number;
  maxAfter: number;
}

export const solveAdjustmentIteration = (
  dependencies: IterationSolveDependencies,
  A: number[][],
  L: number[][],
  P: number[][] | undefined,
  rowInfo: EquationRowInfo[],
  iterationNumber: number,
  options?: {
    sparseRows?: SparseMatrixRows;
    numParams?: number;
    structuredWeights?: StructuredSymmetricWeights;
  },
): AdjustmentIterationComputationResult => {
  const sparseRows = options?.sparseRows ?? denseRowsToSparseRows(A);
  const numParams = options?.numParams ?? A[0]?.length ?? 0;
  const { structuredWeights } = options ?? {};
  let packedWeights = structuredWeights
    ? structuredWeightsToPackedUpper(structuredWeights)
    : undefined;
  let correction = zeros(numParams, 1);
  let qxx: number[][] | undefined;
  // Sparse assembly uses [] as the legacy-compatible omitted-P sentinel.
  let solvedP = P && P.length > 0 ? P : undefined;
  const shouldEstimateCondition = iterationNumber === 1;
  const requireDenseWeights = (): number[][] => {
    if (!solvedP?.length) {
      throw new Error(
        'Dense weight matrix is required for this solve path; use dense assembly or disable robust Huber.',
      );
    }
    return solvedP;
  };
  const solveWithDenseWeights = (dense: number[][]): void => {
    if (dependencies.sparseCorrectionSolver) {
      recordSparseCorrectionCall(dependencies.experimentalSparseDiagnostics);
      correction = dependencies.sparseCorrectionSolver.solveFromEquations(
        buildSparseSolveInput(sparseRows, dense, L, numParams),
      ).correction;
      qxx = undefined;
      return;
    }
    const { normal: N, rhs: U } = accumulateNormalEquationsFromSparseRows(
      sparseRows,
      L,
      dense,
      numParams,
    );
    if (shouldEstimateCondition) dependencies.recordConditionEstimate(dependencies.estimateCondition(N));
    const normalSolution = dependencies.solveNormalEquations(N, U, { recoverCovariance: false });
    correction = normalSolution.correction;
    qxx = normalSolution.qxx;
  };
  const solveCorrection = (weights?: number[][]): void => {
    // Explicit length: omitDenseP yields undefined (never a truthy empty matrix).
    if (weights?.length) {
      solveWithDenseWeights(weights);
      return;
    }
    if (dependencies.sparseCorrectionSolver && packedWeights) {
      recordSparseCorrectionCall(dependencies.experimentalSparseDiagnostics);
      correction = dependencies.sparseCorrectionSolver.solveFromEquations(
        buildSparseSolveInputWithPackedWeights(sparseRows, packedWeights, L, numParams),
      ).correction;
      qxx = undefined;
      return;
    }
    solveWithDenseWeights(requireDenseWeights());
  };

  if (dependencies.robustMode === 'huber') {
    const huber = runHuberWeightLoop({
      dependencies,
      sparseRows,
      L,
      rowInfo,
      iterationNumber,
      dense: solvedP,
      structuredWeights,
      solveCorrection,
      readCorrection: () => correction,
      setPackedWeights: (packed) => {
        packedWeights = packed;
      },
    });
    solvedP = huber.solvedP;
  } else {
    solveCorrection(solvedP);
  }

  const AX = multiplySparseRowsByDenseMatrix(sparseRows, correction);
  const Vnew = zeros(L.length, 1);
  let maxBefore = 0;
  let maxAfter = 0;
  for (let index = 0; index < L.length; index += 1) {
    const v0 = L[index][0];
    const v1 = v0 - AX[index][0];
    Vnew[index][0] = v1;
    maxBefore = Math.max(maxBefore, Math.abs(v0));
    maxAfter = Math.max(maxAfter, Math.abs(v1));
  }

  const quadratic = (v: number[][]): number => {
    if (solvedP?.length) return dependencies.weightedQuadratic(solvedP, v);
    if (structuredWeights) return structuredQuadraticForm(structuredWeights, v);
    return dependencies.weightedQuadratic(requireDenseWeights(), v);
  };

  return {
    correction,
    qxx,
    solvedP,
    sumBefore: quadratic(L),
    sumAfter: quadratic(Vnew),
    maxBefore,
    maxAfter,
  };
};

export const applyAdjustmentCorrections = (
  stations: StationMap,
  paramIndex: SolveParameterIndex,
  is2D: boolean,
  directionOrientations: Record<string, number>,
  dirParamMap: Record<string, number>,
  correction: number[][],
): number => {
  let maxCorrection = 0;
  Object.entries(paramIndex).forEach(([stationId, idx]) => {
    const station = stations[stationId];
    if (!station) return;
    if (idx.x != null) {
      const dE = correction[idx.x][0];
      station.x += dE;
      maxCorrection = Math.max(maxCorrection, Math.abs(dE));
    }
    if (idx.y != null) {
      const dN = correction[idx.y][0];
      station.y += dN;
      maxCorrection = Math.max(maxCorrection, Math.abs(dN));
    }
    if (!is2D && idx.h != null) {
      const dH = correction[idx.h][0];
      station.h += dH;
      maxCorrection = Math.max(maxCorrection, Math.abs(dH));
    }
  });

  Object.entries(dirParamMap).forEach(([setId, index]) => {
    const dOri = correction[index]?.[0] ?? 0;
    const next = (directionOrientations[setId] ?? 0) + dOri;
    let wrapped = next % (2 * Math.PI);
    if (wrapped < 0) wrapped += 2 * Math.PI;
    directionOrientations[setId] = wrapped;
    maxCorrection = Math.max(maxCorrection, Math.abs(dOri));
  });

  return maxCorrection;
};
