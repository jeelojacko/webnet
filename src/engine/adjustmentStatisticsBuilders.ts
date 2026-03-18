import { RAD_TO_DEG } from './angles';
import type { AdjustmentResult, Observation } from '../types';

type WeightedGroupEntry = {
  count: number;
  sumSquares: number;
};

const diagnosticRedundancyValue = (obs: Observation): number | undefined => {
  if (typeof obs.redundancy === 'number') {
    return Number.isFinite(obs.redundancy) ? obs.redundancy : undefined;
  }
  if (obs.redundancy && typeof obs.redundancy === 'object') {
    const vals = [obs.redundancy.rE, obs.redundancy.rN].filter((v) => Number.isFinite(v));
    if (vals.length > 0) return Math.min(...vals);
  }
  return undefined;
};

const stationLabel = (obs: Observation): string => {
  if (obs.type === 'angle') return `${obs.at}-${obs.from}-${obs.to}`;
  if (obs.type === 'direction') return `${obs.at}-${obs.to}`;
  if (
    obs.type === 'dist' ||
    obs.type === 'bearing' ||
    obs.type === 'dir' ||
    obs.type === 'gps' ||
    obs.type === 'lev' ||
    obs.type === 'zenith'
  ) {
    return `${obs.from}-${obs.to}`;
  }
  return '-';
};

export const buildStatisticalSummary = (
  weightedByGroup: ReadonlyMap<string, WeightedGroupEntry>,
  groupOrder: readonly string[],
  dof: number,
): NonNullable<AdjustmentResult['statisticalSummary']> => {
  const rows = Array.from(weightedByGroup.entries())
    .map(([label, row]) => ({
      label,
      count: row.count,
      sumSquares: row.sumSquares,
      errorFactor: row.count > 0 ? Math.sqrt(Math.max(row.sumSquares, 0) / row.count) : 0,
    }))
    .sort((a, b) => {
      const ai = groupOrder.indexOf(a.label);
      const bi = groupOrder.indexOf(b.label);
      const ao = ai >= 0 ? ai : Number.MAX_SAFE_INTEGER;
      const bo = bi >= 0 ? bi : Number.MAX_SAFE_INTEGER;
      if (ao !== bo) return ao - bo;
      return a.label.localeCompare(b.label);
    });
  const totalCount = rows.reduce((sum, row) => sum + row.count, 0);
  const totalSumSquares = rows.reduce((sum, row) => sum + row.sumSquares, 0);
  const scaleToGlobalDof = dof > 0 && totalCount > 0 ? Math.sqrt(totalCount / dof) : 1;

  return {
    byGroup: rows.map((row) => ({
      ...row,
      errorFactor: row.errorFactor * scaleToGlobalDof,
    })),
    totalCount,
    totalSumSquares,
    totalErrorFactorByCount:
      totalCount > 0 ? Math.sqrt(Math.max(totalSumSquares, 0) / totalCount) : 0,
    totalErrorFactorByDof: dof > 0 ? Math.sqrt(Math.max(totalSumSquares, 0) / dof) : 0,
  };
};

export const buildResidualDiagnostics = (
  activeObservations: Observation[],
  localTestCritical: number,
): NonNullable<AdjustmentResult['residualDiagnostics']> => {
  const withStd = activeObservations.filter((obs) => Number.isFinite(obs.stdRes));
  const over2 = withStd.filter((obs) => Math.abs(obs.stdRes ?? 0) > 2).length;
  const over3 = withStd.filter((obs) => Math.abs(obs.stdRes ?? 0) > 3).length;
  const over4 = withStd.filter((obs) => Math.abs(obs.stdRes ?? 0) > 4).length;
  const localFailCount = activeObservations.filter(
    (obs) => obs.localTest != null && !obs.localTest.pass,
  ).length;

  const redundancies = activeObservations
    .map((obs) => diagnosticRedundancyValue(obs))
    .filter((value): value is number => value != null && Number.isFinite(value));
  const meanRedundancy =
    redundancies.length > 0
      ? redundancies.reduce((acc, value) => acc + value, 0) / redundancies.length
      : undefined;
  const minRedundancy = redundancies.length > 0 ? Math.min(...redundancies) : undefined;
  const lowRedundancyCount = redundancies.filter((value) => value < 0.2).length;
  const veryLowRedundancyCount = redundancies.filter((value) => value < 0.1).length;

  const worstObs = withStd
    .map((obs) => ({
      obs,
      stdRes: Math.abs(obs.stdRes ?? 0),
      redundancy: diagnosticRedundancyValue(obs),
      localPass: obs.localTest?.pass,
    }))
    .sort((a, b) => {
      if (b.stdRes !== a.stdRes) return b.stdRes - a.stdRes;
      if ((a.localPass === false ? 1 : 0) !== (b.localPass === false ? 1 : 0)) {
        return (b.localPass === false ? 1 : 0) - (a.localPass === false ? 1 : 0);
      }
      const aRedundancy = a.redundancy ?? Number.POSITIVE_INFINITY;
      const bRedundancy = b.redundancy ?? Number.POSITIVE_INFINITY;
      if (aRedundancy !== bRedundancy) return aRedundancy - bRedundancy;
      return a.obs.id - b.obs.id;
    })[0];

  const byTypeMap = new Map<
    Observation['type'],
    {
      type: Observation['type'];
      count: number;
      withStdResCount: number;
      localFailCount: number;
      over3SigmaCount: number;
      maxStdRes?: number;
      redundancies: number[];
    }
  >();
  activeObservations.forEach((obs) => {
    const row = byTypeMap.get(obs.type) ?? {
      type: obs.type,
      count: 0,
      withStdResCount: 0,
      localFailCount: 0,
      over3SigmaCount: 0,
      maxStdRes: undefined,
      redundancies: [],
    };
    row.count += 1;
    if (Number.isFinite(obs.stdRes)) {
      row.withStdResCount += 1;
      row.maxStdRes = Math.max(row.maxStdRes ?? 0, Math.abs(obs.stdRes ?? 0));
      if (Math.abs(obs.stdRes ?? 0) > 3) row.over3SigmaCount += 1;
    }
    if (obs.localTest != null && !obs.localTest.pass) row.localFailCount += 1;
    const redundancy = diagnosticRedundancyValue(obs);
    if (redundancy != null && Number.isFinite(redundancy)) {
      row.redundancies.push(redundancy);
    }
    byTypeMap.set(obs.type, row);
  });

  return {
    criticalT: localTestCritical,
    observationCount: activeObservations.length,
    withStdResCount: withStd.length,
    over2SigmaCount: over2,
    over3SigmaCount: over3,
    over4SigmaCount: over4,
    localFailCount,
    lowRedundancyCount,
    veryLowRedundancyCount,
    meanRedundancy,
    minRedundancy,
    maxStdRes:
      withStd.length > 0 ? Math.max(...withStd.map((obs) => Math.abs(obs.stdRes ?? 0))) : undefined,
    worst: worstObs
      ? {
          obsId: worstObs.obs.id,
          type: worstObs.obs.type,
          stations: stationLabel(worstObs.obs),
          sourceLine: worstObs.obs.sourceLine,
          stdRes: worstObs.stdRes,
          redundancy: worstObs.redundancy,
          localPass: worstObs.localPass,
        }
      : undefined,
    byType: Array.from(byTypeMap.values())
      .map((row) => ({
        type: row.type,
        count: row.count,
        withStdResCount: row.withStdResCount,
        localFailCount: row.localFailCount,
        over3SigmaCount: row.over3SigmaCount,
        maxStdRes: row.maxStdRes,
        meanRedundancy:
          row.redundancies.length > 0
            ? row.redundancies.reduce((acc, value) => acc + value, 0) / row.redundancies.length
            : undefined,
        minRedundancy: row.redundancies.length > 0 ? Math.min(...row.redundancies) : undefined,
      }))
      .sort((a, b) => {
        if (b.localFailCount !== a.localFailCount) return b.localFailCount - a.localFailCount;
        const bMax = b.maxStdRes ?? 0;
        const aMax = a.maxStdRes ?? 0;
        if (bMax !== aMax) return bMax - aMax;
        return String(a.type).localeCompare(String(b.type));
      }),
  };
};

export const buildObservationTypeSummary = (
  activeObservations: Observation[],
): NonNullable<AdjustmentResult['typeSummary']> => {
  const summary: Record<
    string,
    {
      count: number;
      sumSq: number;
      maxAbs: number;
      maxStdRes: number;
      over3: number;
      over4: number;
      unit: string;
    }
  > = {};

  const addSummary = (type: string, value: number, stdRes: number, unit: string) => {
    const entry = summary[type] ?? { count: 0, sumSq: 0, maxAbs: 0, maxStdRes: 0, over3: 0, over4: 0, unit };
    entry.count += 1;
    entry.sumSq += value * value;
    entry.maxAbs = Math.max(entry.maxAbs, Math.abs(value));
    entry.maxStdRes = Math.max(entry.maxStdRes, Math.abs(stdRes));
    if (Math.abs(stdRes) > 3) entry.over3 += 1;
    if (Math.abs(stdRes) > 4) entry.over4 += 1;
    summary[type] = entry;
  };

  activeObservations.forEach((obs) => {
    if (obs.residual == null) return;
    const stdRes = obs.stdRes ?? 0;
    if (
      obs.type === 'angle' ||
      obs.type === 'direction' ||
      obs.type === 'dir' ||
      obs.type === 'bearing' ||
      obs.type === 'zenith'
    ) {
      addSummary(obs.type, (obs.residual as number) * RAD_TO_DEG * 3600, stdRes, 'arcsec');
      return;
    }
    if (obs.type === 'dist' || obs.type === 'lev') {
      addSummary(obs.type, obs.residual as number, stdRes, 'm');
      return;
    }
    if (obs.type === 'gps') {
      const residual = obs.residual as { vE: number; vN: number };
      addSummary(obs.type, Math.hypot(residual.vE, residual.vN), stdRes, 'm');
    }
  });

  const typeSummary: AdjustmentResult['typeSummary'] = {};
  Object.entries(summary).forEach(([type, entry]) => {
    typeSummary[type] = {
      count: entry.count,
      rms: entry.count ? Math.sqrt(entry.sumSq / entry.count) : 0,
      maxAbs: entry.maxAbs,
      maxStdRes: entry.maxStdRes,
      over3: entry.over3,
      over4: entry.over4,
      unit: entry.unit,
    };
  });
  return typeSummary;
};
