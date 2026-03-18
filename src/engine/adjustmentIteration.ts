import { multiply, transpose, zeros } from './matrix';
import type { StationMap } from '../types';
import type {
  EquationRowInfo,
  IterationSolveDependencies,
  SolveParameterIndex,
} from './adjustmentSolveTypes';

export interface AdjustmentIterationComputationResult {
  correction: number[][];
  qxx: number[][];
  solvedP: number[][];
  sumBefore: number;
  sumAfter: number;
  maxBefore: number;
  maxAfter: number;
}

export const solveAdjustmentIteration = (
  dependencies: IterationSolveDependencies,
  A: number[][],
  L: number[][],
  P: number[][],
  rowInfo: EquationRowInfo[],
  iterationNumber: number,
): AdjustmentIterationComputationResult => {
  const AT = transpose(A);
  const numParams = A[0]?.length ?? 0;
  let correction = zeros(numParams, 1);
  let qxx = zeros(numParams, numParams);
  let solvedP = P;

  if (dependencies.robustMode === 'huber') {
    const baseWeights = dependencies.captureRobustWeightBase(P, rowInfo);
    let factors = new Array(P.length).fill(1);
    let finalSummary = null as ReturnType<typeof dependencies.computeRobustWeightSummary> | null;
    let finalWeightDelta = 0;
    const maxInnerIterations = 5;
    const weightTolerance = 1e-3;
    for (let inner = 0; inner < maxInnerIterations; inner += 1) {
      dependencies.applyRobustWeightFactors(P, baseWeights, factors);
      solvedP = P;
      const ATP = multiply(AT, solvedP);
      const N = multiply(ATP, A);
      dependencies.recordConditionEstimate(dependencies.estimateCondition(N));
      const U = multiply(ATP, L);
      const normalSolution = dependencies.solveNormalEquations(N, U);
      correction = normalSolution.correction;
      qxx = normalSolution.qxx;
      const AX = multiply(A, correction);
      const residuals = AX.map((rowValue, index) => rowValue[0] - L[index][0]);
      finalSummary = dependencies.computeRobustWeightSummary(residuals, rowInfo);
      finalWeightDelta = dependencies.maxRobustWeightDelta(factors, finalSummary.factors);
      if (finalWeightDelta < weightTolerance) {
        break;
      }
      factors = finalSummary.factors.slice();
    }
    if (finalSummary) {
      dependencies.recordRobustDiagnostics(iterationNumber, finalSummary, finalWeightDelta);
    }
  } else {
    const ATP = multiply(AT, P);
    const N = multiply(ATP, A);
    dependencies.recordConditionEstimate(dependencies.estimateCondition(N));
    const U = multiply(ATP, L);
    const normalSolution = dependencies.solveNormalEquations(N, U);
    correction = normalSolution.correction;
    qxx = normalSolution.qxx;
  }

  const AX = multiply(A, correction);
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

  return {
    correction,
    qxx,
    solvedP,
    sumBefore: dependencies.weightedQuadratic(solvedP, L),
    sumAfter: dependencies.weightedQuadratic(solvedP, Vnew),
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
