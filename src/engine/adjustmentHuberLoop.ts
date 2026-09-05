import { multiplySparseRowsByDenseMatrix } from './matrix';
import type { SparseMatrixRows } from './matrix';
import { structuredWeightsToPackedUpper } from './sparseWeightRepresentation';
import type { StructuredSymmetricWeights } from './sparseWeightRepresentation';
import type { PackedUpperTriangle } from './sparseEquationPacking';
import type {
  EquationRowInfo,
  IterationSolveDependencies,
  RobustWeightMatrixBase,
} from './adjustmentSolveTypes';

export interface HuberLoopInput {
  dependencies: IterationSolveDependencies;
  sparseRows: SparseMatrixRows;
  L: number[][];
  rowInfo: EquationRowInfo[];
  iterationNumber: number;
  dense: number[][] | undefined;
  structuredWeights?: StructuredSymmetricWeights;
  solveCorrection: (_weights?: number[][]) => void;
  readCorrection: () => number[][];
  setPackedWeights: (_packed: PackedUpperTriangle | undefined) => void;
}

export interface HuberLoopResult {
  solvedP: number[][] | undefined;
}

type HuberWeights =
  | { kind: 'structured'; weights: StructuredSymmetricWeights }
  | { kind: 'dense'; dense: number[][] };

const resolveHuberWeights = (
  dependencies: IterationSolveDependencies,
  dense: number[][] | undefined,
  structuredWeights: StructuredSymmetricWeights | undefined,
): HuberWeights => {
  // Explicit length: an omitted dense P is undefined, and a truthy empty matrix
  // must never route to the dense path.
  if (dense?.length) return { kind: 'dense', dense };
  const captureStructured = dependencies.captureRobustWeightBaseFromStructured;
  const applyStructured = dependencies.applyRobustWeightFactorsToStructured;
  if (structuredWeights && captureStructured && applyStructured) {
    return { kind: 'structured', weights: structuredWeights };
  }
  throw new Error(
    'Dense weight matrix is required for this solve path; use dense assembly or disable robust Huber.',
  );
};

const captureHuberBase = (
  dependencies: IterationSolveDependencies,
  resolved: HuberWeights,
  rowInfo: EquationRowInfo[],
): RobustWeightMatrixBase => {
  if (resolved.kind === 'structured') {
    const capture = dependencies.captureRobustWeightBaseFromStructured as NonNullable<
      IterationSolveDependencies['captureRobustWeightBaseFromStructured']
    >;
    return capture(resolved.weights, rowInfo);
  }
  return dependencies.captureRobustWeightBase(resolved.dense, rowInfo);
};

/**
 * Iteratively reweighted Huber loop shared by dense and experimental sparse
 * weight paths. Structured weights are updated in place through the injected
 * sparse builder helpers; dense weights go through the classic mutating path.
 */
export const runHuberWeightLoop = (input: HuberLoopInput): HuberLoopResult => {
  const { dependencies, sparseRows, L, rowInfo, iterationNumber } = input;
  const resolved = resolveHuberWeights(input.dependencies, input.dense, input.structuredWeights);
  const baseWeights = captureHuberBase(dependencies, resolved, rowInfo);
  const equationCount =
    resolved.kind === 'structured' ? resolved.weights.size : resolved.dense.length;
  let factors = new Array<number>(equationCount).fill(1);
  let solvedP = resolved.kind === 'dense' ? resolved.dense : undefined;
  let finalSummary: ReturnType<typeof dependencies.computeRobustWeightSummary> | null = null;
  let finalWeightDelta = 0;
  const maxInnerIterations = 5;
  const weightTolerance = 1e-3;
  for (let inner = 0; inner < maxInnerIterations; inner += 1) {
    if (resolved.kind === 'structured') {
      const apply = dependencies.applyRobustWeightFactorsToStructured as NonNullable<
        IterationSolveDependencies['applyRobustWeightFactorsToStructured']
      >;
      apply(resolved.weights, baseWeights, factors);
      input.setPackedWeights(structuredWeightsToPackedUpper(resolved.weights));
      input.solveCorrection();
    } else {
      dependencies.applyRobustWeightFactors(resolved.dense, baseWeights, factors);
      solvedP = resolved.dense;
      input.solveCorrection(solvedP);
    }
    const correction = input.readCorrection();
    const AX = multiplySparseRowsByDenseMatrix(sparseRows, correction);
    const residuals = AX.map((rowValue, index) => rowValue[0] - (L[index]?.[0] ?? 0));
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
  return { solvedP };
};
