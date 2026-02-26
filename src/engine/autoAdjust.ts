import type { AdjustmentResult, Observation } from '../types';

export interface AutoAdjustConfig {
  enabled: boolean;
  maxCycles: number;
  maxRemovalsPerCycle: number;
  stdResThreshold: number;
  minRedundancy?: number;
}

export interface AutoAdjustRemoval {
  obsId: number;
  type: Observation['type'];
  stations: string;
  sourceLine?: number;
  stdRes: number;
  redundancy?: number;
  reason: 'local-test' | 'std-res';
}

export interface AutoAdjustCycle {
  cycle: number;
  seuw: number;
  maxAbsStdRes: number;
  removals: AutoAdjustRemoval[];
}

export interface AutoAdjustRunSummary {
  enabled: boolean;
  config: AutoAdjustConfig;
  cycles: AutoAdjustCycle[];
  finalExcludedIds: Set<number>;
  removedObsIds: number[];
  stopReason: 'disabled' | 'no-candidates' | 'max-cycles';
}

const observationStationsLabel = (obs: Observation): string => {
  if ('at' in obs && 'from' in obs && 'to' in obs) return `${obs.at}-${obs.from}-${obs.to}`;
  if ('at' in obs && 'to' in obs) return `${obs.at}-${obs.to}`;
  if ('from' in obs && 'to' in obs) return `${obs.from}-${obs.to}`;
  return '-';
};

const hasLocalFailure = (obs: Observation): boolean => {
  if (obs.localTestComponents) {
    return !obs.localTestComponents.passE || !obs.localTestComponents.passN;
  }
  if (obs.localTest) return !obs.localTest.pass;
  return false;
};

const redundancyValue = (obs: Observation): number | undefined => {
  if (typeof obs.redundancy === 'number') return Number.isFinite(obs.redundancy) ? obs.redundancy : undefined;
  if (obs.redundancy && typeof obs.redundancy === 'object') {
    const re = obs.redundancy.rE;
    const rn = obs.redundancy.rN;
    if (Number.isFinite(re) && Number.isFinite(rn)) return Math.min(re, rn);
  }
  return undefined;
};

const maxAbsStdRes = (res: AdjustmentResult): number =>
  res.observations.reduce((maxVal, obs) => {
    if (!Number.isFinite(obs.stdRes)) return maxVal;
    return Math.max(maxVal, Math.abs(obs.stdRes ?? 0));
  }, 0);

export const pickAutoAdjustRemovals = (
  result: AdjustmentResult,
  excludedIds: Set<number>,
  config: AutoAdjustConfig,
): AutoAdjustRemoval[] => {
  if (!config.enabled) return [];
  const threshold = Math.max(0, config.stdResThreshold);
  const maxRemovals = Math.max(1, Math.floor(config.maxRemovalsPerCycle));
  const minRedundancy = config.minRedundancy ?? 0.05;

  const rows = result.observations
    .filter((obs) => !excludedIds.has(obs.id))
    .filter((obs) => Number.isFinite(obs.stdRes))
    .map((obs) => {
      const stdRes = Math.abs(obs.stdRes ?? 0);
      const localFailure = hasLocalFailure(obs);
      const redundancy = redundancyValue(obs);
      const reason: AutoAdjustRemoval['reason'] = localFailure ? 'local-test' : 'std-res';
      return { obs, stdRes, localFailure, redundancy, reason };
    })
    .filter((row) => row.localFailure || row.stdRes >= threshold)
    .filter((row) => row.redundancy == null || row.redundancy >= minRedundancy)
    .sort((a, b) => {
      const af = a.localFailure ? 1 : 0;
      const bf = b.localFailure ? 1 : 0;
      if (bf !== af) return bf - af;
      if (b.stdRes !== a.stdRes) return b.stdRes - a.stdRes;
      const ar = a.redundancy ?? Number.POSITIVE_INFINITY;
      const br = b.redundancy ?? Number.POSITIVE_INFINITY;
      if (br !== ar) return br - ar;
      const al = a.obs.sourceLine ?? Number.MAX_SAFE_INTEGER;
      const bl = b.obs.sourceLine ?? Number.MAX_SAFE_INTEGER;
      if (al !== bl) return al - bl;
      return a.obs.id - b.obs.id;
    })
    .slice(0, maxRemovals)
    .map((row) => ({
      obsId: row.obs.id,
      type: row.obs.type,
      stations: observationStationsLabel(row.obs),
      sourceLine: row.obs.sourceLine,
      stdRes: row.stdRes,
      redundancy: row.redundancy,
      reason: row.reason,
    }));

  return rows;
};

export const runAutoAdjustCycles = (
  initialExcludedIds: Set<number>,
  config: AutoAdjustConfig,
  solve: (_excludeSet: Set<number>) => AdjustmentResult,
): AutoAdjustRunSummary => {
  const normalizedConfig: AutoAdjustConfig = {
    enabled: config.enabled,
    maxCycles: Math.max(1, Math.floor(config.maxCycles)),
    maxRemovalsPerCycle: Math.max(1, Math.floor(config.maxRemovalsPerCycle)),
    stdResThreshold: Math.max(0, config.stdResThreshold),
    minRedundancy: config.minRedundancy ?? 0.05,
  };
  const finalExcludedIds = new Set(initialExcludedIds);
  if (!normalizedConfig.enabled) {
    return {
      enabled: false,
      config: normalizedConfig,
      cycles: [],
      finalExcludedIds,
      removedObsIds: [],
      stopReason: 'disabled',
    };
  }

  const cycles: AutoAdjustCycle[] = [];
  const removedObsIds: number[] = [];
  let stopReason: AutoAdjustRunSummary['stopReason'] = 'max-cycles';

  for (let cycle = 1; cycle <= normalizedConfig.maxCycles; cycle += 1) {
    const cycleResult = solve(new Set(finalExcludedIds));
    const removals = pickAutoAdjustRemovals(cycleResult, finalExcludedIds, normalizedConfig);
    cycles.push({
      cycle,
      seuw: cycleResult.seuw,
      maxAbsStdRes: maxAbsStdRes(cycleResult),
      removals,
    });
    if (removals.length === 0) {
      stopReason = 'no-candidates';
      break;
    }
    removals.forEach((row) => {
      finalExcludedIds.add(row.obsId);
      removedObsIds.push(row.obsId);
    });
  }

  return {
    enabled: true,
    config: normalizedConfig,
    cycles,
    finalExcludedIds,
    removedObsIds,
    stopReason,
  };
};

export const formatAutoAdjustLogLines = (summary: AutoAdjustRunSummary): string[] => {
  if (!summary.enabled) return [];
  const lines: string[] = [];
  lines.push(
    `Auto-adjust: ON (|t|>=${summary.config.stdResThreshold.toFixed(2)}, maxCycles=${summary.config.maxCycles}, maxRemovalsPerCycle=${summary.config.maxRemovalsPerCycle}, minRedund=${(summary.config.minRedundancy ?? 0.05).toFixed(2)})`,
  );
  summary.cycles.forEach((cycle) => {
    lines.push(
      `Auto-adjust cycle ${cycle.cycle}: seuw=${cycle.seuw.toFixed(4)}, max|t|=${cycle.maxAbsStdRes.toFixed(2)}, removals=${cycle.removals.length}`,
    );
    cycle.removals.forEach((row) => {
      lines.push(
        `  remove obs#${row.obsId} ${row.type} ${row.stations} line=${row.sourceLine ?? '-'} |t|=${row.stdRes.toFixed(2)} reason=${row.reason}${row.redundancy != null ? ` redund=${row.redundancy.toFixed(3)}` : ''}`,
      );
    });
  });
  if (summary.stopReason === 'no-candidates') {
    lines.push('Auto-adjust stop: no eligible candidates remain.');
  } else if (summary.stopReason === 'max-cycles') {
    lines.push('Auto-adjust stop: reached max cycles.');
  }
  lines.push(
    `Auto-adjust removed total: ${summary.removedObsIds.length} (active exclusions=${summary.finalExcludedIds.size})`,
  );
  return lines;
};
