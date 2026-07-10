import type { AdjustmentResult, ParseOptions, StationId } from '../types';

export type TsCorrelationResidualGroups = Map<
  string,
  {
    station: StationId;
    setId?: string;
    rows: Array<{ v: number; sigma: number; groupLabel: string }>;
  }
>;

type TsCorrelationDiagnosticsOptions = {
  enabled: boolean;
  rho: number;
  scope: NonNullable<ParseOptions['tsCorrelationScope']>;
  rows: TsCorrelationResidualGroups;
};

type GroupContribution = {
  label: string;
  contribution: number;
};

export type TsCorrelationDiagnosticsResult = {
  diagnostics: AdjustmentResult['tsCorrelationDiagnostics'];
  vtpvDelta: number;
  groupContributions: GroupContribution[];
  logLine?: string;
};

export const buildTsCorrelationDiagnostics = ({
  enabled,
  rho,
  scope,
  rows,
}: TsCorrelationDiagnosticsOptions): TsCorrelationDiagnosticsResult => {
  if (!enabled) {
    return {
      diagnostics: {
        enabled: false,
        rho: 0,
        scope,
        groupCount: 0,
        equationCount: 0,
        pairCount: 0,
        maxGroupSize: 0,
        groups: [],
      },
      vtpvDelta: 0,
      groupContributions: [],
    };
  }

  const boundedRho = Math.min(0.95, Math.max(0, rho));
  let vtpvDelta = 0;
  let equationCount = 0;
  let pairCountTotal = 0;
  let maxGroupSize = 0;
  let offDiagAbsSumTotal = 0;
  const groupContributions: GroupContribution[] = [];
  const groups: NonNullable<AdjustmentResult['tsCorrelationDiagnostics']>['groups'] = [];

  rows.forEach((entry, key) => {
    const n = entry.rows.length;
    equationCount += n;
    maxGroupSize = Math.max(maxGroupSize, n);
    if (n < 2) {
      groups.push({
        key,
        station: entry.station,
        setId: entry.setId,
        rows: n,
        pairCount: 0,
      });
      return;
    }
    const denom = (1 - boundedRho) * (1 - boundedRho + n * boundedRho);
    if (!Number.isFinite(denom) || denom <= 1e-24) return;
    const a = 1 / (1 - boundedRho);
    const b = boundedRho / denom;
    let pairCount = 0;
    let offDiagAbsSum = 0;

    entry.rows.forEach((row) => {
      const baseDiag = 1 / (row.sigma * row.sigma);
      const corrDiag = (a - b) / (row.sigma * row.sigma);
      const delta = (corrDiag - baseDiag) * row.v * row.v;
      vtpvDelta += delta;
      groupContributions.push({ label: row.groupLabel, contribution: delta });
    });
    for (let i = 0; i < n; i += 1) {
      const ri = entry.rows[i];
      for (let j = i + 1; j < n; j += 1) {
        const rj = entry.rows[j];
        const w = -b / (ri.sigma * rj.sigma);
        const contribution = 2 * w * ri.v * rj.v;
        vtpvDelta += contribution;
        if (ri.groupLabel === rj.groupLabel) {
          groupContributions.push({ label: ri.groupLabel, contribution });
        } else {
          groupContributions.push({ label: ri.groupLabel, contribution: contribution * 0.5 });
          groupContributions.push({ label: rj.groupLabel, contribution: contribution * 0.5 });
        }
        pairCount += 1;
        offDiagAbsSum += Math.abs(w);
      }
    }

    pairCountTotal += pairCount;
    offDiagAbsSumTotal += offDiagAbsSum;
    groups.push({
      key,
      station: entry.station,
      setId: entry.setId,
      rows: n,
      pairCount,
      meanAbsOffDiagWeight: pairCount > 0 ? offDiagAbsSum / pairCount : undefined,
    });
  });

  const diagnostics = {
    enabled: true,
    rho: boundedRho,
    scope,
    groupCount: rows.size,
    equationCount,
    pairCount: pairCountTotal,
    maxGroupSize,
    meanAbsOffDiagWeight: pairCountTotal > 0 ? offDiagAbsSumTotal / pairCountTotal : undefined,
    groups: groups.sort((a, b) => {
      if (b.rows !== a.rows) return b.rows - a.rows;
      if (b.pairCount !== a.pairCount) return b.pairCount - a.pairCount;
      return a.key.localeCompare(b.key);
    }),
  };

  return {
    diagnostics,
    vtpvDelta,
    groupContributions,
    logLine: `TS correlation diagnostics: groups=${diagnostics.groupCount}, eq=${diagnostics.equationCount}, pairs=${diagnostics.pairCount}, maxGroup=${diagnostics.maxGroupSize}, mean|offdiagW|=${diagnostics.meanAbsOffDiagWeight != null ? diagnostics.meanAbsOffDiagWeight.toExponential(3) : '-'}`,
  };
};
