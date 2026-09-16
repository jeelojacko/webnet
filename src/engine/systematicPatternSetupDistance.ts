import { olsTrend, residualSign, signRunStats } from './systematicPatternTrends';
import type { Observation, StationId } from '../types';
import type { SystematicDistanceTrend, SystematicSetupFamily } from './systematicPatternTypes';
import {
  ARCSEC_PER_RAD,
  MAX_TREND_COLLINEARITY,
  MIN_FAMILY_MEAN_COUNT,
  MIN_TREND_COUNT,
  MIN_TREND_REL_SPAN,
  MIN_TREND_SPAN_M,
  meanOf,
  rmsOf,
  scalarResidual,
} from './systematicPatternShared';

const familyOf = (obs: Observation): SystematicSetupFamily['family'] | null => {
  if (obs.type === 'dist') return 'distance';
  if (obs.type === 'direction' || obs.type === 'angle' || obs.type === 'dir') return 'direction';
  if (obs.type === 'bearing') return 'direction';
  if (obs.type === 'zenith') return 'zenith';
  if (obs.type === 'lev') return 'leveling';
  // GNSS vectors have no scalar residual: they are described by the GNSS
  // component-means section, never by scalar setup-family rows.
  return null;
};

const stationOf = (obs: Observation): StationId => {
  if (obs.type === 'direction' || obs.type === 'angle') return obs.at;
  return obs.from;
};

/**
 * Display unit and native-to-display factor per scalar setup family.
 * Angular direction/zenith residuals are native radians → arcseconds;
 * linear distance/leveling residuals are native meters → millimeters.
 * Conversion happens only here at the display boundary.
 */
export const setupFamilyDisplayUnit = (
  family: SystematicSetupFamily['family'],
): { unit: '"' | 'mm'; factor: number } =>
  family === 'direction' || family === 'zenith'
    ? { unit: '"', factor: ARCSEC_PER_RAD }
    : { unit: 'mm', factor: 1000 };

export const buildSetupFamilies = (active: Observation[]): SystematicSetupFamily[] => {
  const groups = new Map<
    string,
    { station: StationId; family: SystematicSetupFamily['family']; obs: Observation[] }
  >();
  active.forEach((obs) => {
    const family = familyOf(obs);
    if (!family) return;
    const station = stationOf(obs);
    const key = `${station}>>${family}`;
    const entry = groups.get(key) ?? { station, family, obs: [] };
    entry.obs.push(obs);
    groups.set(key, entry);
  });
  return Array.from(groups.values())
    .map(({ station, family, obs }) => {
      const count = obs.length;
      const residuals = obs
        .map((o) => scalarResidual(o))
        .filter((v): v is number => v != null);
      const complete = residuals.length === count && count > 0;
      const stdVals = obs
        .map((o) => (Number.isFinite(o.stdRes) ? Math.abs(o.stdRes as number) : null))
        .filter((v): v is number => v != null);
      const hasAbsStd = stdVals.length === count && count >= MIN_FAMILY_MEAN_COUNT;
      let posCount = 0;
      let negCount = 0;
      let zeroCount = 0;
      let missingCount = 0;
      obs.forEach((o) => {
        const r = scalarResidual(o);
        if (r == null) {
          missingCount += 1;
          return;
        }
        const s = residualSign(r);
        if (s > 0) posCount += 1;
        else if (s < 0) negCount += 1;
        else zeroCount += 1;
      });
      const runs =
        posCount + negCount > 0
          ? signRunStats(obs.map((o) => residualSign(scalarResidual(o) ?? NaN)))
          : null;
      return {
        station,
        family,
        count,
        meanResidual: complete && count >= MIN_FAMILY_MEAN_COUNT ? meanOf(residuals) : null,
        rmsResidual: complete ? rmsOf(residuals) : null,
        maxAbsResidual: complete ? Math.max(...residuals.map((v) => Math.abs(v))) : null,
        meanAbsStdRes: hasAbsStd ? meanOf(stdVals) : null,
        stdResNote: hasAbsStd
          ? 'mean |StdRes| (absolute standardized residuals), correlated descriptive magnitude only'
          : 'mean |StdRes| withheld: incomplete or insufficient data',
        posCount,
        negCount,
        zeroCount,
        missingCount,
        longestSameSignRun: runs ? runs.longestSameSign : undefined,
        localFailCount: obs.filter((o) => o.localTest?.pass === false).length,
      };
    })
    .sort((a, b) => a.station.localeCompare(b.station) || a.family.localeCompare(b.family));
};

const distLengthOf = (obs: Observation & { type: 'dist' }): number | null => {
  if (Number.isFinite(obs.obs)) return obs.obs;
  if (typeof obs.effectiveDistance === 'number' && Number.isFinite(obs.effectiveDistance)) {
    return obs.effectiveDistance;
  }
  return null;
};

export const insufficientTrend = (
  count: number,
  minDist: number | null,
  maxDist: number | null,
  span: number | null,
  reason: string,
): SystematicDistanceTrend => ({
  count,
  minDist,
  maxDist,
  span,
  slopeMmPerKm: null,
  interceptMm: null,
  designCollinearity: null,
  separable: false,
  status: 'insufficient-data',
  reason,
});

export const buildDistanceTrend = (active: Observation[]): SystematicDistanceTrend => {
  const rows: { x: number; yMm: number }[] = [];
  (active.filter((o) => o.type === 'dist') as (Observation & { type: 'dist' })[]).forEach((obs) => {
    const x = distLengthOf(obs);
    const r = scalarResidual(obs);
    if (x == null || r == null || !(x > 0)) return;
    rows.push({ x, yMm: r * 1000 });
  });
  if (rows.length < MIN_TREND_COUNT) {
    return insufficientTrend(
      rows.length, null, null, null,
      `needs at least ${MIN_TREND_COUNT} distance residuals`,
    );
  }
  const sorted = rows.map((r) => r.x).sort((a, b) => a - b);
  const minDist = sorted[0];
  const maxDist = sorted[sorted.length - 1];
  const span = maxDist - minDist;
  if (!(span >= MIN_TREND_SPAN_M) || span / maxDist < MIN_TREND_REL_SPAN) {
    return insufficientTrend(
      rows.length, minDist, maxDist, span,
      'distance range too narrow to separate intercept pattern from slope pattern',
    );
  }
  const fit = olsTrend(
    rows.map((r) => r.x / 1000),
    rows.map((r) => r.yMm),
  );
  if (!fit) {
    return insufficientTrend(
      rows.length, minDist, maxDist, span, 'degenerate distance spread',
    );
  }
  if (Math.abs(fit.designCollinearity) >= MAX_TREND_COLLINEARITY) {
    return {
      count: rows.length, minDist, maxDist, span,
      slopeMmPerKm: null, interceptMm: null, designCollinearity: fit.designCollinearity,
      separable: false, status: 'insufficient-data',
      reason: 'intercept pattern and slope pattern not separable over this range',
    };
  }
  return {
    count: rows.length, minDist, maxDist, span,
    slopeMmPerKm: fit.slope, interceptMm: fit.intercept,
    designCollinearity: fit.designCollinearity,
    separable: true, status: 'descriptive',
  };
};
