import { RAD_TO_DEG } from './angles';
import { olsTrend, residualSign, signRunStats } from './systematicPatternTrends';
import type {
  AdjustmentResult,
  GpsObservation,
  LevelObservation,
  Observation,
  StationId,
} from '../types';

export type SystematicStatus = 'descriptive' | 'insufficient-data' | 'unavailable';

export interface SystematicSetupFamily {
  station: StationId;
  /** Scalar setup families only; GNSS vectors are omitted here (see GNSS component means). */
  family: 'distance' | 'direction' | 'zenith' | 'leveling';
  count: number;
  /** Native units (rad for angles, m for lengths); convert at display boundaries. */
  meanResidual: number | null;
  rmsResidual: number | null;
  maxAbsResidual: number | null;
  /** Mean of |standardized residuals|; upstream stdRes is absolute, never signed. */
  meanAbsStdRes: number | null;
  stdResNote?: string;
  posCount: number;
  negCount: number;
  /** Genuine near-zero residuals only; missing residuals are counted separately. */
  zeroCount: number;
  /** Rows with no scalar residual; never counted or labeled as zero. */
  missingCount: number;
  longestSameSignRun?: number;
  localFailCount: number;
}

export interface SystematicDistanceTrend {
  count: number;
  minDist: number | null;
  maxDist: number | null;
  span: number | null;
  slopeMmPerKm: number | null;
  interceptMm: number | null;
  /** Deterministic design-collinearity proxy (regressor spread only), not a stochastic correlation. */
  designCollinearity: number | null;
  /** Heuristic practical separability of intercept vs slope descriptors; not statistical identifiability. */
  separable: boolean;
  status: SystematicStatus;
  reason?: string;
}

export interface SystematicFaceBalance {
  /** Direction set-target rows whose face counts balance (|F1-F2|<=1). */
  balancedTargets: number;
  /** Direction set-target rows whose face counts unbalance. */
  unbalancedTargets: number;
  /**
   * Singleton/unpaired set-target rows (either face count missing): face-count
   * balance not assessable, never counted as balanced or unbalanced.
   */
  unpairedTargets: number;
  /** Largest absolute raw face-pair metadata value only; not a test. */
  largestFacePairDeltaArcSec: number | null;
  largestFacePairSetId?: string;
  largestFacePairTarget?: StationId;
  status: SystematicStatus;
  reason?: string;
}

export interface SystematicRepeatSameSign {
  occupy: StationId;
  target: StationId;
  setCount: number;
  sameSignCount: number;
  dominantSign: 'pos' | 'neg' | 'mixed';
  status: SystematicStatus;
}

export interface SystematicZenithPatterns {
  count: number;
  slopeVsDistanceArcSecPerKm: number | null;
  posCount: number;
  negCount: number;
  status: SystematicStatus;
  reason?: string;
}

export interface SystematicLevelingPatterns {
  orderedBy: 'input-sequence';
  count: number;
  cumulativeKm: number | null;
  driftMmPerKm: number | null;
  posCount: number;
  negCount: number;
  longestPos: number;
  longestNeg: number;
  signChanges: number;
  status: SystematicStatus;
  reason?: string;
}

export interface SystematicGnssPatterns {
  count: number;
  meanEMm: number | null;
  meanNMm: number | null;
  meanUMm: number | null;
  rmsEMm: number | null;
  rmsNMm: number | null;
  rmsUMm: number | null;
  status: SystematicStatus;
  reason?: string;
}

export interface SystematicSignRun {
  key: string;
  count: number;
  pos: number;
  neg: number;
  longestPos: number;
  longestNeg: number;
  signChanges: number;
  status: SystematicStatus;
}

export interface SystematicDiagnostics {
  available: boolean;
  unavailableReason?: string;
  setupFamilies: SystematicSetupFamily[];
  distanceTrend: SystematicDistanceTrend;
  worstDirectionSet?: { setId: string; occupy: StationId; residualRmsArcSec?: number };
  worstDirectionRepeat?: { occupy: StationId; target: StationId; setCount: number };
  directionFaceBalance: SystematicFaceBalance;
  directionRepeatSameSign: SystematicRepeatSameSign[];
  zenithPatterns: SystematicZenithPatterns;
  levelingPatterns: SystematicLevelingPatterns;
  gnssPatterns: SystematicGnssPatterns;
  signRuns: SystematicSignRun[];
  warnings: string[];
  robustNote?: string;
  freeNetworkNote?: string;
}

export interface SystematicDiagnosticsInput {
  directionSetDiagnostics?: AdjustmentResult['directionSetDiagnostics'];
  directionTargetDiagnostics?: AdjustmentResult['directionTargetDiagnostics'];
  directionRepeatabilityDiagnostics?: AdjustmentResult['directionRepeatabilityDiagnostics'];
  isPreanalysis?: boolean;
  isDataCheck?: boolean;
  isRobust?: boolean;
  robustMode?: string;
  freeNetwork?: boolean;
  tsCorrelated?: boolean;
}

const MIN_FAMILY_MEAN_COUNT = 2;
const MIN_TREND_COUNT = 5;
const MIN_TREND_SPAN_M = 20;
const MIN_TREND_REL_SPAN = 0.05;
/**
 * Descriptive product coverage guard on the design-collinearity proxy, not a
 * calibrated test threshold: below this spread the intercept and slope shape
 * descriptors are not practically separable.
 */
const MAX_TREND_COLLINEARITY = 0.95;
const MIN_REPEAT_SETS = 2;
const MIN_LEVEL_DRIFT_COUNT = 5;
const MIN_LEVEL_DRIFT_KM = 0.05;

const ARCSEC_PER_RAD = RAD_TO_DEG * 3600;

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

/** Scalar residual in native units; GPS handled separately. Null when absent. */
const scalarResidual = (obs: Observation): number | null => {
  if (typeof obs.residual === 'number' && Number.isFinite(obs.residual)) return obs.residual;
  return null;
};

const meanOf = (vals: number[]): number | null =>
  vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;

const rmsOf = (vals: number[]): number | null =>
  vals.length > 0
    ? Math.sqrt(vals.reduce((a, b) => a + b * b, 0) / vals.length)
    : null;

const buildSetupFamilies = (active: Observation[]): SystematicSetupFamily[] => {
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

const insufficientTrend = (
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

const buildDistanceTrend = (active: Observation[]): SystematicDistanceTrend => {
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

const buildFaceBalance = (
  targets: AdjustmentResult['directionTargetDiagnostics'],
): SystematicFaceBalance => {
  if (!targets || targets.length === 0) {
    return {
      balancedTargets: 0, unpairedTargets: 0, unbalancedTargets: 0,
      largestFacePairDeltaArcSec: null,
      status: 'insufficient-data', reason: 'no direction targets available',
    };
  }
  let balanced = 0;
  let unbalanced = 0;
  let unpaired = 0;
  let largest: number | null = null;
  let largestSetId: string | undefined;
  let largestTarget: StationId | undefined;
  targets.forEach((t) => {
    // A set-target row missing either face count is unpaired: face-count
    // balance not assessable, never balanced or unbalanced.
    if (!(t.face1Count > 0) || !(t.face2Count > 0)) {
      unpaired += 1;
    } else if (t.faceBalanced) balanced += 1;
    else unbalanced += 1;
    // Largest absolute raw metadata value only; the stored value is reported as-is.
    if (t.facePairDeltaArcSec != null && Number.isFinite(t.facePairDeltaArcSec)) {
      if (largest == null || Math.abs(t.facePairDeltaArcSec) > Math.abs(largest)) {
        largest = t.facePairDeltaArcSec;
        largestSetId = t.setId;
        largestTarget = t.target;
      }
    }
  });
  return {
    balancedTargets: balanced,
    unbalancedTargets: unbalanced,
    unpairedTargets: unpaired,
    largestFacePairDeltaArcSec: largest,
    largestFacePairSetId: largestSetId,
    largestFacePairTarget: largestTarget,
    status: 'descriptive',
  };
};

const buildRepeatSameSign = (active: Observation[]): SystematicRepeatSameSign[] => {
  const groups = new Map<string, { occupy: StationId; target: StationId; signs: number[] }>();
  active.forEach((obs) => {
    if (obs.type !== 'direction') return;
    const r = scalarResidual(obs);
    if (r == null) return;
    const key = `${obs.at}>>${obs.to}`;
    const entry = groups.get(key) ?? { occupy: obs.at, target: obs.to, signs: [] };
    entry.signs.push(residualSign(r));
    groups.set(key, entry);
  });
  return Array.from(groups.values())
    .map(({ occupy, target, signs }) => {
      const setCount = signs.length;
      if (setCount < MIN_REPEAT_SETS) {
        return {
          occupy, target, setCount, sameSignCount: 0,
          dominantSign: 'mixed' as const, status: 'insufficient-data' as const,
        };
      }
      const pos = signs.filter((s) => s > 0).length;
      const neg = signs.filter((s) => s < 0).length;
      const sameSignCount = Math.max(pos, neg);
      const dominantSign = pos > neg ? 'pos' : neg > pos ? 'neg' : 'mixed';
      return {
        occupy, target, setCount, sameSignCount,
        dominantSign: dominantSign as 'pos' | 'neg' | 'mixed',
        status: 'descriptive' as const,
      };
    })
    .sort((a, b) => a.occupy.localeCompare(b.occupy) || a.target.localeCompare(b.target));
};

const zenithDistOf = (obs: Observation & { type: 'zenith' }): number | null => {
  if (typeof obs.effectiveDistance === 'number' && Number.isFinite(obs.effectiveDistance)) {
    return obs.effectiveDistance;
  }
  return null;
};

const buildZenithPatterns = (active: Observation[]): SystematicZenithPatterns => {
  const obs = active.filter((o) => o.type === 'zenith');
  const res = obs
    .map((o) => ({ o: o as Observation & { type: 'zenith' }, r: scalarResidual(o) }))
    .filter((row): row is { o: Observation & { type: 'zenith' }; r: number } => row.r != null);
  const count = res.length;
  if (count < MIN_FAMILY_MEAN_COUNT) {
    return {
      count, slopeVsDistanceArcSecPerKm: null, posCount: 0, negCount: 0,
      status: 'insufficient-data', reason: 'needs at least 2 zenith residuals',
    };
  }
  const posCount = res.filter((row) => residualSign(row.r) > 0).length;
  const negCount = res.filter((row) => residualSign(row.r) < 0).length;
  const withDist = res.filter((row) => {
    const d = zenithDistOf(row.o);
    return d != null && d > 0;
  });
  // Generic label only: 'Zenith residual vs distance'. Never refraction/collimation.
  let slope: number | null = null;
  if (withDist.length >= MIN_TREND_COUNT) {
    const fit = olsTrend(
      withDist.map((row) => (zenithDistOf(row.o) as number) / 1000),
      withDist.map((row) => row.r * ARCSEC_PER_RAD),
    );
    if (fit && Math.abs(fit.designCollinearity) < MAX_TREND_COLLINEARITY) slope = fit.slope;
  }
  return { count, slopeVsDistanceArcSecPerKm: slope, posCount, negCount, status: 'descriptive' };
};

const buildLevelingPatterns = (active: Observation[]): SystematicLevelingPatterns => {
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

const buildGnssPatterns = (active: Observation[]): SystematicGnssPatterns => {
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

const buildSignRuns = (active: Observation[]): SystematicSignRun[] => {
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

const unavailable = (reason: string): SystematicDiagnostics => ({
  available: false,
  unavailableReason: reason,
  setupFamilies: [],
  distanceTrend: insufficientTrend(0, null, null, null, reason),
  directionFaceBalance: {
    balancedTargets: 0, unbalancedTargets: 0, unpairedTargets: 0,
    largestFacePairDeltaArcSec: null,
    status: 'unavailable', reason,
  },
  directionRepeatSameSign: [],
  zenithPatterns: {
    count: 0, slopeVsDistanceArcSecPerKm: null, posCount: 0, negCount: 0,
    status: 'unavailable', reason,
  },
  levelingPatterns: {
    orderedBy: 'input-sequence', count: 0, cumulativeKm: null, driftMmPerKm: null,
    posCount: 0, negCount: 0, longestPos: 0, longestNeg: 0, signChanges: 0,
    status: 'unavailable', reason,
  },
  gnssPatterns: {
    count: 0, meanEMm: null, meanNMm: null, meanUMm: null,
    rmsEMm: null, rmsNMm: null, rmsUMm: null, status: 'unavailable', reason,
  },
  signRuns: [],
  warnings: [],
});

/**
 * Descriptive-only systematic pattern diagnostics. No p-values, no formal
 * tests, no causal labels — values describe residual association only and
 * never identify a cause. Per-set direction means are orientation-absorbed
 * and reported as such. Count/span/collinearity gates are descriptive
 * product coverage guards, not calibrated test thresholds.
 */
export const buildSystematicDiagnostics = (
  activeObservations: Observation[],
  input: SystematicDiagnosticsInput = {},
): SystematicDiagnostics | undefined => {
  if (input.isPreanalysis) {
    return unavailable('no residuals exist in preanalysis mode');
  }
  if (input.isDataCheck) {
    return unavailable('no formal residual tests in data-check mode');
  }
  const setDiags = input.directionSetDiagnostics ?? [];
  const repeatDiags = input.directionRepeatabilityDiagnostics ?? [];
  const worstSet = [...setDiags].sort(
    (a, b) => (b.residualRmsArcSec ?? 0) - (a.residualRmsArcSec ?? 0),
  )[0];
  const worstRepeat = [...repeatDiags].sort((a, b) => b.setCount - a.setCount)[0];
  const warnings: string[] = [];
  if (input.tsCorrelated) {
    warnings.push('observations correlated where applicable; patterns may reflect correlation');
  }
  let robustNote: string | undefined;
  if (input.isRobust) {
    robustNote =
      `robust mode (${input.robustMode ?? 'robust'}): these descriptors add no ` +
      'formal pattern tests and use final robust-fit residuals (descriptive only)';
    warnings.push(
      'robust reweighting active: pattern descriptors use final robust-fit residuals, descriptive only',
    );
  }
  let freeNetworkNote: string | undefined;
  if (input.freeNetwork) {
    freeNetworkNote =
      'free-network datum: observation residual descriptors are datum/gauge invariant; ' +
      'no datum-related pattern warning applies';
    warnings.push(
      'free-network datum: observation residual descriptors are datum/gauge invariant',
    );
  }
  return {
    available: true,
    setupFamilies: buildSetupFamilies(activeObservations),
    distanceTrend: buildDistanceTrend(activeObservations),
    worstDirectionSet: worstSet
      ? {
          setId: worstSet.setId,
          occupy: worstSet.occupy,
          residualRmsArcSec: worstSet.residualRmsArcSec,
        }
      : undefined,
    worstDirectionRepeat: worstRepeat
      ? { occupy: worstRepeat.occupy, target: worstRepeat.target, setCount: worstRepeat.setCount }
      : undefined,
    directionFaceBalance: buildFaceBalance(input.directionTargetDiagnostics),
    directionRepeatSameSign: buildRepeatSameSign(activeObservations),
    zenithPatterns: buildZenithPatterns(activeObservations),
    levelingPatterns: buildLevelingPatterns(activeObservations),
    gnssPatterns: buildGnssPatterns(activeObservations),
    signRuns: buildSignRuns(activeObservations),
    warnings,
    robustNote,
    freeNetworkNote,
  };
};
