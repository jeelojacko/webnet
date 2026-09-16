import { olsTrend, residualSign, signRunStats } from './systematicPatternTrends';
import type { GpsObservation, LevelObservation, Observation } from '../types';
import type {
  SystematicGnssPatterns,
  SystematicLevelingPatterns,
  SystematicSignRun,
} from './systematicPatternTypes';
import {
  MAX_TREND_COLLINEARITY,
  MIN_FAMILY_MEAN_COUNT,
  MIN_LEVEL_DRIFT_COUNT,
  MIN_LEVEL_DRIFT_KM,
  meanOf,
  rmsOf,
  scalarResidual,
} from './systematicPatternShared';

export const buildLevelingPatterns = (active: Observation[]): SystematicLevelingPatterns => {
  const base: Omit<SystematicLevelingPatterns, 'count' | 'status' | 'reason'> = {
    orderedBy: 'input-sequence',
    cumulativeKm: null,
    driftMmPerKm: null,
    posCount: 0,
    negCount: 0,
    longestPos: 0,
    longestNeg: 0,
    signChanges: 0,
  };
  const obs = (active.filter((o) => o.type === 'lev') as LevelObservation[]).filter(
    (o) => typeof o.residual === 'number' && Number.isFinite(o.residual),
  );
  if (obs.length === 0) {
    return {
      ...base, count: 0, status: 'unavailable', reason: 'no leveling residuals available',
    };
  }
  // Global parser/input sequence is observation id ascending: parseInputCore
  // assigns ids monotonically in input order, while sourceLine is file-local
  // document order (reset per file) and may be absent. Every residual row is
  // kept; nothing is dropped for lacking sourceLine. Input sequence only —
  // never time.
  const ordered = [...obs].sort((a, b) => a.id - b.id);
  const signs = ordered.map((o) => residualSign(o.residual as number));
  const runs = signRunStats(signs);
  const cumulativeKm = ordered.reduce(
    (sum, o) => sum + (Number.isFinite(o.lenKm) && o.lenKm > 0 ? o.lenKm : 0),
    0,
  );
  const count = ordered.length;
  if (count < MIN_LEVEL_DRIFT_COUNT || !(cumulativeKm >= MIN_LEVEL_DRIFT_KM)) {
    return {
      ...base,
      count,
      cumulativeKm,
      posCount: runs.pos,
      negCount: runs.neg,
      longestPos: runs.longestPos,
      longestNeg: runs.longestNeg,
      signChanges: runs.signChanges,
      status: 'insufficient-data',
      reason: 'needs at least 5 leveling residuals over meaningful cumulative distance',
    };
  }
  let km = 0;
  const xs: number[] = [];
  const ys: number[] = [];
  ordered.forEach((o) => {
    const len = Number.isFinite(o.lenKm) && o.lenKm > 0 ? o.lenKm : 0;
    km += len;
    xs.push(km);
    ys.push((o.residual as number) * 1000);
  });
  const fit = olsTrend(xs, ys);
  const drift =
    fit && Math.abs(fit.designCollinearity) < MAX_TREND_COLLINEARITY ? fit.slope : null;
  return {
    ...base,
    count,
    cumulativeKm,
    driftMmPerKm: drift,
    posCount: runs.pos,
    negCount: runs.neg,
    longestPos: runs.longestPos,
    longestNeg: runs.longestNeg,
    signChanges: runs.signChanges,
    status: 'descriptive',
    ...(drift == null ? { reason: 'drift pattern not separable over this sequence' } : {}),
  };
};

export const buildGnssPatterns = (active: Observation[]): SystematicGnssPatterns => {
  const obs = (active.filter((o) => o.type === 'gps') as GpsObservation[]).filter(
    (o) => o.residual != null && Number.isFinite(o.residual.vE) && Number.isFinite(o.residual.vN),
  );
  const count = obs.length;
  if (count < MIN_FAMILY_MEAN_COUNT) {
    return {
      count, meanEMm: null, meanNMm: null, meanUMm: null,
      rmsEMm: null, rmsNMm: null, rmsUMm: null,
      status: 'insufficient-data', reason: 'needs at least 2 GNSS residuals',
    };
  }
  const eVals = obs.map((o) => (o.residual as { vE: number }).vE * 1000);
  const nVals = obs.map((o) => (o.residual as { vN: number }).vN * 1000);
  const uVals = obs
    .map((o) => o.residual?.vU)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    .map((v) => v * 1000);
  return {
    count,
    meanEMm: meanOf(eVals),
    meanNMm: meanOf(nVals),
    meanUMm: uVals.length === count ? meanOf(uVals) : null,
    rmsEMm: rmsOf(eVals),
    rmsNMm: rmsOf(nVals),
    rmsUMm: uVals.length === count ? rmsOf(uVals) : null,
    status: 'descriptive',
  };
};

export const buildSignRuns = (active: Observation[]): SystematicSignRun[] => {
  const rows: SystematicSignRun[] = [];
  // Direction sets in set order (setId order is the meaningful per-set grouping).
  const dirGroups = new Map<string, number[]>();
  active.forEach((obs) => {
    if (obs.type !== 'direction') return;
    const setId = typeof obs.setId === 'string' && obs.setId.length > 0 ? obs.setId : 'unknown';
    const r = scalarResidual(obs);
    if (r == null) return;
    const list = dirGroups.get(setId) ?? [];
    list.push(residualSign(r));
    dirGroups.set(setId, list);
  });
  Array.from(dirGroups.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([setId, signs]) => {
      const nz = signs.filter((s) => s !== 0).length;
      const runs = signRunStats(signs);
      rows.push({
        key: `direction-set:${setId}`,
        count: signs.length,
        pos: runs.pos,
        neg: runs.neg,
        longestPos: runs.longestPos,
        longestNeg: runs.longestNeg,
        signChanges: runs.signChanges,
        status: nz > 0 ? 'descriptive' : 'insufficient-data',
      });
    });
  // Leveling input sequence: observation id ascending (global parser/input
  // sequence), never file-local sourceLine, never time.
  const lev = (active.filter((o) => o.type === 'lev') as LevelObservation[])
    .filter((o) => typeof o.residual === 'number' && Number.isFinite(o.residual))
    .sort((a, b) => a.id - b.id);
  if (lev.length > 0) {
    const signs = lev.map((o) => residualSign(o.residual as number));
    const runs = signRunStats(signs);
    rows.push({
      key: 'leveling:input-sequence',
      count: signs.length,
      pos: runs.pos,
      neg: runs.neg,
      longestPos: runs.longestPos,
      longestNeg: runs.longestNeg,
      signChanges: runs.signChanges,
      status: runs.pos + runs.neg > 0 ? 'descriptive' : 'insufficient-data',
    });
  }
  return rows;
};
