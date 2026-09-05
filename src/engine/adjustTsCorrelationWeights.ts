import type { EquationRowInfo } from './adjustmentSolveTypes';
import type { WeightMatrixWriter } from './adjustmentWeightWriter';
import { DenseWeightWriter } from './sparseWeightRepresentation';
import { getObservationSetId } from './observationMetadata';
import type { AdjustmentResult, Observation, ParseOptions, StationId } from '../types';

type TsCorrelationGroup = {
  key: string;
  station: StationId;
  setId?: string;
};

export const isTsCorrelationObservation = (obs: Observation): boolean =>
  obs.type === 'angle' ||
  obs.type === 'direction' ||
  obs.type === 'bearing' ||
  obs.type === 'dir';

export const tsCorrelationGroup = ({
  enabled,
  obs,
  scope,
}: {
  enabled: boolean;
  obs: Observation;
  scope: ParseOptions['tsCorrelationScope'];
}): TsCorrelationGroup | null => {
  if (!enabled || !isTsCorrelationObservation(obs)) return null;
  const station = obs.type === 'angle' || obs.type === 'direction' ? obs.at : obs.from;
  const setId = getObservationSetId(obs);
  const key = scope === 'setup' ? station : `${station}|${setId ?? obs.type}`;
  return { key, station, setId };
};

const emptyDiagnostics = ({
  enabled,
  rho,
  scope,
}: {
  enabled: boolean;
  rho: number;
  scope: ParseOptions['tsCorrelationScope'];
}): NonNullable<AdjustmentResult['tsCorrelationDiagnostics']> => ({
  enabled,
  rho,
  scope: scope ?? 'set',
  groupCount: 0,
  equationCount: 0,
  pairCount: 0,
  maxGroupSize: 0,
  groups: [],
});

export const applyTsCorrelationToWeightWriter = ({
  captureDiagnostics,
  effectiveStdDev,
  enabled,
  weights,
  rho,
  rowInfo,
  scope,
  tsCorrelationGroup,
}: {
  captureDiagnostics: boolean;
  effectiveStdDev: (_obs: Observation) => number;
  enabled: boolean;
  weights: WeightMatrixWriter;
  rho: number;
  rowInfo: EquationRowInfo[];
  scope: ParseOptions['tsCorrelationScope'];
  tsCorrelationGroup: (_obs: Observation) => TsCorrelationGroup | null;
}): AdjustmentResult['tsCorrelationDiagnostics'] | undefined => {
  if (!enabled) {
    return captureDiagnostics ? emptyDiagnostics({ enabled: false, rho: 0, scope }) : undefined;
  }

  const rhoBase = Math.min(0.95, Math.max(0, rho || 0));
  if (rhoBase <= 0) {
    return captureDiagnostics ? emptyDiagnostics({ enabled: true, rho: rhoBase, scope }) : undefined;
  }

  const groups = new Map<
    string,
    { station: StationId; setId?: string; rows: Array<{ index: number; sigma: number }> }
  >();
  rowInfo.forEach((info, index) => {
    if (!info || info.component) return;
    const group = tsCorrelationGroup(info.obs);
    if (!group) return;
    const sigma = effectiveStdDev(info.obs);
    if (!Number.isFinite(sigma) || sigma <= 0) return;
    const entry = groups.get(group.key) ?? {
      station: group.station,
      setId: group.setId,
      rows: [],
    };
    entry.rows.push({ index, sigma });
    groups.set(group.key, entry);
  });

  let equationCount = 0;
  let pairCountTotal = 0;
  let maxGroupSize = 0;
  let offDiagAbsSumTotal = 0;
  const diagRows: NonNullable<AdjustmentResult['tsCorrelationDiagnostics']>['groups'] = [];

  groups.forEach((entry, key) => {
    const n = entry.rows.length;
    equationCount += n;
    maxGroupSize = Math.max(maxGroupSize, n);
    if (n < 2) {
      if (captureDiagnostics) {
        diagRows.push({
          key,
          station: entry.station,
          setId: entry.setId,
          rows: n,
          pairCount: 0,
        });
      }
      return;
    }

    const boundedRho = Math.min(0.999999, Math.max(0, rhoBase));
    const denom = (1 - boundedRho) * (1 - boundedRho + n * boundedRho);
    if (!Number.isFinite(denom) || denom <= 1e-24) return;
    const a = 1 / (1 - boundedRho);
    const b = boundedRho / denom;
    let pairCount = 0;
    let offDiagAbsSum = 0;

    entry.rows.forEach((row) => {
      weights.setDiagonal(row.index, (a - b) / (row.sigma * row.sigma));
    });
    for (let i = 0; i < n; i += 1) {
      const ri = entry.rows[i];
      for (let j = i + 1; j < n; j += 1) {
        const rj = entry.rows[j];
        const w = -b / (ri.sigma * rj.sigma);
        weights.set(ri.index, rj.index, w);
        pairCount += 1;
        offDiagAbsSum += Math.abs(w);
      }
    }

    pairCountTotal += pairCount;
    offDiagAbsSumTotal += offDiagAbsSum;
    if (captureDiagnostics) {
      diagRows.push({
        key,
        station: entry.station,
        setId: entry.setId,
        rows: n,
        pairCount,
        meanAbsOffDiagWeight: pairCount > 0 ? offDiagAbsSum / pairCount : undefined,
      });
    }
  });

  if (!captureDiagnostics) return undefined;
  return {
    enabled: true,
    rho: rhoBase,
    scope: scope ?? 'set',
    groupCount: groups.size,
    equationCount,
    pairCount: pairCountTotal,
    maxGroupSize,
    meanAbsOffDiagWeight: pairCountTotal > 0 ? offDiagAbsSumTotal / pairCountTotal : undefined,
    groups: diagRows.sort((a, b) => {
      if (b.rows !== a.rows) return b.rows - a.rows;
      if (b.pairCount !== a.pairCount) return b.pairCount - a.pairCount;
      return a.key.localeCompare(b.key);
    }),
  };
};

export const applyTsCorrelationToWeightMatrix = ({
  captureDiagnostics,
  effectiveStdDev,
  enabled,
  matrix,
  rho,
  rowInfo,
  scope,
  tsCorrelationGroup,
}: {
  captureDiagnostics: boolean;
  effectiveStdDev: (_obs: Observation) => number;
  enabled: boolean;
  matrix: number[][];
  rho: number;
  rowInfo: EquationRowInfo[];
  scope: ParseOptions['tsCorrelationScope'];
  tsCorrelationGroup: (_obs: Observation) => TsCorrelationGroup | null;
}): AdjustmentResult['tsCorrelationDiagnostics'] | undefined =>
  applyTsCorrelationToWeightWriter({
    captureDiagnostics,
    effectiveStdDev,
    enabled,
    weights: new DenseWeightWriter(matrix),
    rho,
    rowInfo,
    scope,
    tsCorrelationGroup,
  });
