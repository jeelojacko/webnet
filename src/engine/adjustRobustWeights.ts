import {
  symmetricQuadraticForm,
} from './matrix';
import type {
  EquationRowInfo,
  RobustWeightMatrixBase,
  RobustWeightSummary,
} from './adjustmentSolveTypes';
import type {
  AdjustmentResult,
  Observation,
} from '../types';

import type { StructuredSymmetricWeights } from './sparseWeightRepresentation';

export const weightedQuadratic = (P: number[][], v: number[][]): number =>
  symmetricQuadraticForm(P, v);

export const observationStations = (obs: Observation): string => {
  if (obs.type === 'angle') return `${obs.at}-${obs.from}-${obs.to}`;
  if (obs.type === 'direction') return `${obs.at}-${obs.to}`;
  if (
    obs.type === 'dist' ||
    obs.type === 'bearing' ||
    obs.type === 'zenith' ||
    obs.type === 'lev' ||
    obs.type === 'gps' ||
    obs.type === 'dir'
  ) {
    return `${obs.from}-${obs.to}`;
  }
  return '-';
};

export const robustCorrelationRowGroups = (
  rowInfo: EquationRowInfo[],
  options: {
    rowSigma: (_info: NonNullable<EquationRowInfo>) => number;
    tsCorrelationEnabled: boolean;
    tsCorrelationGroup: (_obs: Observation) => { key: string } | null;
  },
): number[][] => {
  if (!options.tsCorrelationEnabled) return [];
  const groups = new Map<string, number[]>();
  rowInfo.forEach((info, index) => {
    if (!info || info.component) return;
    const group = options.tsCorrelationGroup(info.obs);
    if (!group) return;
    const sigma = options.rowSigma(info);
    if (!Number.isFinite(sigma) || sigma <= 0) return;
    const rows = groups.get(group.key) ?? [];
    rows.push(index);
    groups.set(group.key, rows);
  });
  return [...groups.values()].filter((rows) => rows.length > 1);
};

export const applyRobustWeightFactorsToStructured = (
  weights: StructuredSymmetricWeights,
  base: RobustWeightMatrixBase,
  factors: number[],
): void => {
  for (let row = 0; row < weights.size; row += 1) {
    weights.diagonal[row] = (base.diagonal[row] ?? 0) * (factors[row] ?? 1);
  }
  if (base.correlatedPairs.length === 0) return;
  const positionByPair = new Map<string, number>();
  for (let position = 0; position < weights.offRows.length; position += 1) {
    positionByPair.set(`${weights.offRows[position]}:${weights.offColumns[position]}`, position);
  }
  base.correlatedPairs.forEach(({ i, j, base: pairBase }) => {
    const canonical = i < j ? `${i}:${j}` : `${j}:${i}`;
    const position = positionByPair.get(canonical);
    if (position == null) return;
    const scale = Math.sqrt((factors[i] ?? 1) * (factors[j] ?? 1));
    weights.offValues[position] = pairBase * scale;
  });
};

export const captureRobustWeightBase = (
  P: number[][],
  rowInfo: EquationRowInfo[],
  options: {
    robustCorrelationRowGroups: (_rowInfo: EquationRowInfo[]) => number[][];
  },
): RobustWeightMatrixBase => {
  const diagonal = P.map((row, i) => row[i] ?? 0);
  const correlatedPairs: RobustWeightMatrixBase['correlatedPairs'] = [];
  options.robustCorrelationRowGroups(rowInfo).forEach((rows) => {
    for (let a = 0; a < rows.length; a += 1) {
      const i = rows[a] as number;
      for (let b = a + 1; b < rows.length; b += 1) {
        const j = rows[b] as number;
        const base = P[i]?.[j] ?? 0;
        if (Math.abs(base) <= 0) continue;
        correlatedPairs.push({ i, j, base });
      }
    }
  });
  return { diagonal, correlatedPairs };
};

export const captureRobustWeightBaseFromStructured = (
  weights: StructuredSymmetricWeights,
  rowInfo: EquationRowInfo[],
  options: {
    robustCorrelationRowGroups: (_rowInfo: EquationRowInfo[]) => number[][];
  },
): RobustWeightMatrixBase => {
  const diagonal = Array.from(weights.diagonal);
  const valueByPair = new Map<string, number>();
  for (let position = 0; position < weights.offRows.length; position += 1) {
    valueByPair.set(
      `${weights.offRows[position]}:${weights.offColumns[position]}`,
      weights.offValues[position] ?? 0,
    );
  }
  const correlatedPairs: RobustWeightMatrixBase['correlatedPairs'] = [];
  options.robustCorrelationRowGroups(rowInfo).forEach((rows) => {
    for (let a = 0; a < rows.length; a += 1) {
      const i = rows[a] as number;
      for (let b = a + 1; b < rows.length; b += 1) {
        const j = rows[b] as number;
        const canonical = i < j ? `${i}:${j}` : `${j}:${i}`;
        const base = valueByPair.get(canonical) ?? 0;
        if (Math.abs(base) <= 0) continue;
        correlatedPairs.push({ i, j, base });
      }
    }
  });
  return { diagonal, correlatedPairs };
};

export const applyRobustWeightFactors = (
  P: number[][],
  base: RobustWeightMatrixBase,
  factors: number[],
): void => {
  for (let i = 0; i < P.length; i += 1) {
    P[i][i] = (base.diagonal[i] ?? 0) * (factors[i] ?? 1);
  }
  base.correlatedPairs.forEach(({ i, j, base: pairBase }) => {
    const scale = Math.sqrt((factors[i] ?? 1) * (factors[j] ?? 1));
    const scaled = pairBase * scale;
    P[i][j] = scaled;
    P[j][i] = scaled;
  });
};

export const computeRobustWeightSummary = (
  residuals: number[],
  rowInfo: EquationRowInfo[],
  options: {
    robustK: number;
    rowSigma: (_info: NonNullable<EquationRowInfo>) => number;
  },
): RobustWeightSummary => {
  const k = Math.max(0.5, Math.min(10, options.robustK || 1.5));
  const factors = new Array(rowInfo.length).fill(1);

  let downweightedRows = 0;
  let minWeight = 1;
  let maxNorm = 0;
  let meanWeightSum = 0;
  let meanWeightCount = 0;
  const candidates: NonNullable<AdjustmentResult['robustDiagnostics']>['topDownweightedRows'] =
    [];

  for (let i = 0; i < rowInfo.length; i += 1) {
    const info = rowInfo[i];
    if (!info) continue;
    const sigma = options.rowSigma(info);
    const norm = Math.abs(residuals[i] ?? 0) / Math.max(sigma, 1e-24);
    maxNorm = Math.max(maxNorm, norm);
    let w = 1;
    if (norm > k) w = k / norm;
    w = Math.max(0.001, Math.min(1, w));
    factors[i] = w;
    meanWeightSum += w;
    meanWeightCount += 1;
    if (w < 0.999999) {
      downweightedRows += 1;
      minWeight = Math.min(minWeight, w);
      candidates.push({
        obsId: info.obs.id,
        type: info.obs.type,
        stations: observationStations(info.obs),
        sourceLine: info.obs.sourceLine,
        weight: w,
        norm,
      });
    }
  }

  return {
    factors,
    downweightedRows,
    minWeight: downweightedRows > 0 ? minWeight : 1,
    maxNorm,
    meanWeight: meanWeightCount > 0 ? meanWeightSum / meanWeightCount : 1,
    topRows: candidates
      .sort((a, b) => {
        if (a.weight !== b.weight) return a.weight - b.weight;
        return b.norm - a.norm;
      })
      .slice(0, 15),
  };
};

export const maxRobustWeightDelta = (a: number[], b: number[]): number => {
  const count = Math.max(a.length, b.length);
  let maxDelta = 0;
  for (let i = 0; i < count; i += 1) {
    maxDelta = Math.max(maxDelta, Math.abs((a[i] ?? 1) - (b[i] ?? 1)));
  }
  return maxDelta;
};

export const recordRobustDiagnostics = ({
  iteration,
  log,
  maxWeightDelta,
  robustDiagnostics,
  robustMode,
  summary,
}: {
  iteration: number;
  log: (_message: string) => void;
  maxWeightDelta: number;
  robustDiagnostics: AdjustmentResult['robustDiagnostics'];
  robustMode: string | undefined;
  summary: RobustWeightSummary;
}): void => {
  if (!robustDiagnostics) return;
  robustDiagnostics.iterations.push({
    iteration,
    downweightedRows: summary.downweightedRows,
    meanWeight: summary.meanWeight,
    minWeight: summary.minWeight,
    maxNorm: summary.maxNorm,
    maxWeightDelta,
  });
  robustDiagnostics.topDownweightedRows = summary.topRows;
  log(
    `Iter ${iteration} robust(${robustMode}): downweighted=${summary.downweightedRows}, minW=${summary.minWeight.toFixed(3)}, meanW=${summary.meanWeight.toFixed(3)}, max|v/sigma|=${summary.maxNorm.toFixed(2)}, maxDeltaW=${maxWeightDelta.toFixed(4)}`,
  );
};
