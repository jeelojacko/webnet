import { RAD_TO_DEG, DEG_TO_RAD } from './angles';
import { inv, multiply, transpose, zeros } from './matrix';
import { parseInput } from './parse';
import type {
  AdjustmentResult,
  DirectionObservation,
  Observation,
  Station,
  StationId,
  StationMap,
  InstrumentLibrary,
  Instrument,
  ObservationOverride,
  ParseOptions,
} from '../types';

const EPS = 1e-10;
const EARTH_RADIUS_M = 6378137;

const gammln = (xx: number): number => {
  const cof = [
    76.180091729471,
    -86.505320329417,
    24.014098240831,
    -1.23173957245,
    1.208650973866e-3,
    -5.395239384953e-6,
  ];
  let x = xx;
  let y = xx;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < cof.length; j += 1) {
    y += 1;
    ser += cof[j] / y;
  }
  return -tmp + Math.log(2.506628274631 * ser / x);
};

const gser = (a: number, x: number): number => {
  if (x <= 0) return 0;
  let sum = 1 / a;
  let del = sum;
  let ap = a;
  for (let n = 1; n <= 100; n += 1) {
    ap += 1;
    del *= x / ap;
    sum += del;
    if (Math.abs(del) < Math.abs(sum) * EPS) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - gammln(a));
};

const gcf = (a: number, x: number): number => {
  let b = x + 1 - a;
  let c = 1 / 1e-30;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= 100; i += 1) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = b + an / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return Math.exp(-x + a * Math.log(x) - gammln(a)) * h;
};

const gammp = (a: number, x: number): number => {
  if (x < 0 || a <= 0) return 0;
  if (x < a + 1) {
    return gser(a, x);
  }
  return 1 - gcf(a, x);
};

const chiSquarePValue = (T: number, dof: number): number => {
  if (dof <= 0 || T < 0) return 0;
  const a = dof / 2;
  const x = T / 2;
  const cdf = gammp(a, x);
  return Math.max(0, Math.min(1, 1 - cdf));
};

const chiSquareQuantile = (prob: number, dof: number): number => {
  if (dof <= 0) return 0;
  if (prob <= 0) return 0;
  if (prob >= 1) return Number.POSITIVE_INFINITY;
  const a = dof / 2;
  const cdf = (x: number) => gammp(a, x / 2);

  let lo = 0;
  let hi = Math.max(1, dof + 10 * Math.sqrt(2 * dof));
  while (cdf(hi) < prob) {
    hi *= 2;
    if (hi > 1e9) break;
  }

  for (let i = 0; i < 80; i += 1) {
    const mid = 0.5 * (lo + hi);
    if (cdf(mid) < prob) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return 0.5 * (lo + hi);
};

interface EngineOptions {
  input: string;
  maxIterations?: number;
  instrumentLibrary?: InstrumentLibrary;
  convergenceThreshold?: number;
  excludeIds?: Set<number>;
  overrides?: Record<number, ObservationOverride>;
  parseOptions?: Partial<ParseOptions>;
}

interface CoordinateConstraintEquation {
  stationId: StationId;
  component: 'x' | 'y' | 'h';
  index: number;
  target: number;
  sigma: number;
}

export class LSAEngine {
  input: string;
  stations: StationMap = {};
  observations: Observation[] = [];
  unknowns: StationId[] = [];
  iterations = 0;
  maxIterations: number;
  convergenceThreshold: number;
  dof = 0;
  seuw = 0;
  logs: string[] = [];
  converged = false;
  instrumentLibrary: InstrumentLibrary;
  private Qxx: number[][] | null = null;
  private excludeIds?: Set<number>;
  private overrides?: Record<number, ObservationOverride>;
  private maxCondition = 1e12;
  private maxStdRes = 10;
  private localTestCritical = 3.29;
  private parseOptions?: Partial<ParseOptions>;
  private coordMode: ParseOptions['coordMode'] = '3D';
  private is2D = false;
  private directionOrientations: Record<string, number> = {};
  private paramIndex: Record<StationId, { x?: number; y?: number; h?: number }> = {};
  private addCenteringToExplicit = false;
  private applyCentering = true;
  private debug = false;
  private mapMode: ParseOptions['mapMode'] = 'off';
  private mapScaleFactor = 1;
  private applyCurvatureRefraction = false;
  private refractionCoefficient = 0.13;
  private verticalReduction: ParseOptions['verticalReduction'] = 'none';
  private chiSquare?: AdjustmentResult['chiSquare'];
  private typeSummary?: Record<
    string,
    {
      count: number;
      rms: number;
      maxAbs: number;
      maxStdRes: number;
      over3: number;
      over4: number;
      unit: string;
    }
  >;
  private relativePrecision?: AdjustmentResult['relativePrecision'];
  private directionSetDiagnostics?: AdjustmentResult['directionSetDiagnostics'];
  private directionTargetDiagnostics?: AdjustmentResult['directionTargetDiagnostics'];
  private setupDiagnostics?: AdjustmentResult['setupDiagnostics'];
  private traverseDiagnostics?: AdjustmentResult['traverseDiagnostics'];
  private sideshots?: AdjustmentResult['sideshots'];
  private condition?: AdjustmentResult['condition'];
  private controlConstraints?: AdjustmentResult['controlConstraints'];
  private conditionWarned = false;

  private getInstrument(obs: Observation): Instrument | undefined {
    if (!obs.instCode) return undefined;
    return this.instrumentLibrary[obs.instCode];
  }

  private effectiveStdDev(obs: Observation): number {
    const inst = this.getInstrument(obs);
    let sigma = obs.stdDev || 0;
    if (!inst) return sigma || 1;

    const source = obs.sigmaSource ?? 'explicit';
    if (source === 'fixed' || source === 'float') return sigma || 1;
    if (!this.applyCentering) return sigma || 1;
    if (source === 'explicit' && !this.addCenteringToExplicit) return sigma || 1;

    const center = Math.hypot(inst.instCentr_m || 0, inst.tgtCentr_m || 0);
    if (center <= 0) return sigma || 1;

    if (obs.type === 'dist') {
      return Math.sqrt(sigma * sigma + center * center);
    }
    if (obs.type === 'direction') {
      const az = this.getAzimuth(obs.at, obs.to);
      const term = az.dist > 0 ? center / az.dist : 0;
      return Math.sqrt(sigma * sigma + term * term);
    }
    if (obs.type === 'bearing') {
      const az = this.getAzimuth(obs.from, obs.to);
      const term = az.dist > 0 ? center / az.dist : 0;
      return Math.sqrt(sigma * sigma + term * term);
    }
    if (obs.type === 'dir') {
      const az = this.getAzimuth(obs.from, obs.to);
      const term = az.dist > 0 ? center / az.dist : 0;
      return Math.sqrt(sigma * sigma + term * term);
    }
    if (obs.type === 'angle') {
      const azTo = this.getAzimuth(obs.at, obs.to);
      const azFrom = this.getAzimuth(obs.at, obs.from);
      const termTo = azTo.dist > 0 ? center / azTo.dist : 0;
      const termFrom = azFrom.dist > 0 ? center / azFrom.dist : 0;
      const term = Math.sqrt(termTo * termTo + termFrom * termFrom);
      return Math.sqrt(sigma * sigma + term * term);
    }
    if (obs.type === 'zenith') {
      const z = this.getZenith(obs.from, obs.to, obs.hi ?? 0, obs.ht ?? 0);
      const term = z.dist > 0 ? center / z.dist : 0;
      return Math.sqrt(sigma * sigma + term * term);
    }

    return sigma || 1;
  }

  private gpsCovariance(obs: Observation): { cEE: number; cNN: number; cEN: number } {
    if (obs.type !== 'gps') {
      const s = obs.stdDev || 1;
      return { cEE: s * s, cNN: s * s, cEN: 0 };
    }
    const gps = obs;
    const sE = Math.max(gps.stdDevE ?? gps.stdDev ?? 0.01, 1e-12);
    const sN = Math.max(gps.stdDevN ?? gps.stdDev ?? 0.01, 1e-12);
    const corr = Math.max(-0.999, Math.min(0.999, gps.corrEN ?? 0));
    return {
      cEE: sE * sE,
      cNN: sN * sN,
      cEN: corr * sE * sN,
    };
  }

  private gpsWeight(obs: Observation): { wEE: number; wNN: number; wEN: number } {
    const cov = this.gpsCovariance(obs);
    const det = cov.cEE * cov.cNN - cov.cEN * cov.cEN;
    if (!Number.isFinite(det) || det <= 1e-24) {
      return {
        wEE: 1 / Math.max(cov.cEE, 1e-24),
        wNN: 1 / Math.max(cov.cNN, 1e-24),
        wEN: 0,
      };
    }
    return {
      wEE: cov.cNN / det,
      wNN: cov.cEE / det,
      wEN: -cov.cEN / det,
    };
  }

  private computeDirectionSetPrefit(
    activeObservations: Observation[],
    directionSetIds: string[],
  ): void {
    const groups = new Map<
      string,
      { count: number; sumSin: number; sumCos: number; occupy: StationId }
    >();
    const diffsBySet = new Map<string, number[]>();

    activeObservations.forEach((obs) => {
      if (obs.type !== 'direction') return;
      const dir = obs as any;
      if (!this.stations[dir.at] || !this.stations[dir.to]) return;
      const az = this.getAzimuth(dir.at, dir.to).az;
      const diff = ((dir.obs - az + Math.PI) % (2 * Math.PI)) - Math.PI;
      const entry = groups.get(dir.setId) ?? {
        count: 0,
        sumSin: 0,
        sumCos: 0,
        occupy: dir.at,
      };
      entry.count += 1;
      entry.sumSin += Math.sin(diff);
      entry.sumCos += Math.cos(diff);
      entry.occupy = dir.at ?? entry.occupy;
      groups.set(dir.setId, entry);
      const arr = diffsBySet.get(dir.setId) ?? [];
      arr.push(diff);
      diffsBySet.set(dir.setId, arr);
    });

    if (!groups.size) return;

    this.logs.push('Direction set prefit (initial coords, arcsec residuals):');
    const sorted = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    sorted.forEach(([setId, entry]) => {
      const orient = Math.atan2(entry.sumSin, entry.sumCos);
      this.directionOrientations[setId] = orient;
      const diffs = diffsBySet.get(setId) ?? [];
      let sum = 0;
      let sumSq = 0;
      let maxAbs = 0;
      diffs.forEach((d) => {
        const v = ((d - orient + Math.PI) % (2 * Math.PI)) - Math.PI;
        const arcsec = v * RAD_TO_DEG * 3600;
        sum += arcsec;
        sumSq += arcsec * arcsec;
        maxAbs = Math.max(maxAbs, Math.abs(arcsec));
      });
      const mean = diffs.length ? sum / diffs.length : 0;
      const rms = diffs.length ? Math.sqrt(sumSq / diffs.length) : 0;
      const orientDeg = (orient * RAD_TO_DEG + 360) % 360;
      this.logs.push(
        `  ${setId} @ ${entry.occupy}: n=${diffs.length}, mean=${mean.toFixed(
          2,
        )}", rms=${rms.toFixed(2)}", max=${maxAbs.toFixed(2)}", orient=${orientDeg.toFixed(4)}°`,
      );
    });

    // Ensure all direction sets have an initialization
    directionSetIds.forEach((id) => {
      if (this.directionOrientations[id] == null) this.directionOrientations[id] = 0;
    });
  }

  private logNetworkDiagnostics(activeObservations: Observation[]) {
    const stationObsCount = new Map<StationId, number>();
    const otherObsCount = new Map<StationId, number>();
    const directionAt = new Set<StationId>();
    const directionTargets = new Map<StationId, Set<StationId>>();
    const directionSetCounts = new Map<string, number>();

    const mark = (id: StationId) => {
      stationObsCount.set(id, (stationObsCount.get(id) ?? 0) + 1);
    };
    const markOther = (id: StationId) => {
      otherObsCount.set(id, (otherObsCount.get(id) ?? 0) + 1);
    };

    activeObservations.forEach((obs) => {
      if (obs.type === 'direction') {
        const dir = obs as any;
        mark(dir.at);
        mark(dir.to);
        directionAt.add(dir.at);
        const set = directionTargets.get(dir.to) ?? new Set<StationId>();
        set.add(dir.at);
        directionTargets.set(dir.to, set);
        directionSetCounts.set(dir.setId, (directionSetCounts.get(dir.setId) ?? 0) + 1);
        return;
      }

      if (obs.type === 'angle') {
        mark(obs.at);
        mark(obs.from);
        mark(obs.to);
        markOther(obs.at);
        markOther(obs.from);
        markOther(obs.to);
        return;
      }
      if (obs.type === 'dist' || obs.type === 'bearing' || obs.type === 'lev' || obs.type === 'zenith') {
        mark(obs.from);
        mark(obs.to);
        markOther(obs.from);
        markOther(obs.to);
        return;
      }
      if (obs.type === 'dir') {
        mark(obs.from);
        mark(obs.to);
        markOther(obs.from);
        markOther(obs.to);
        return;
      }
      if (obs.type === 'gps') {
        mark(obs.from);
        mark(obs.to);
        markOther(obs.from);
        markOther(obs.to);
      }
    });

    this.unknowns.forEach((id) => {
      if (!stationObsCount.has(id)) {
        this.log(`Warning: unknown station ${id} has no observations and will cause a singular network.`);
        return;
      }

      const hasOther = (otherObsCount.get(id) ?? 0) > 0;
      if (!directionAt.has(id) && !hasOther) {
        const atCount = directionTargets.get(id)?.size ?? 0;
        if (atCount < 2) {
          this.log(
            `Warning: station ${id} is only targeted by directions from ${atCount} station(s). ` +
              `At least two occupies or distance/GNSS observations are required to solve it.`,
          );
        }
      }
    });

    directionSetCounts.forEach((count, setId) => {
      if (count < 2) {
        this.log(
          `Warning: direction set ${setId} has only ${count} observation(s); orientation may be weak.`,
        );
      }
    });
  }

  constructor({
    input,
    maxIterations = 10,
    instrumentLibrary = {},
    convergenceThreshold = 0.0001,
    excludeIds,
    overrides,
    parseOptions,
  }: EngineOptions) {
    this.input = input;
    this.maxIterations = maxIterations;
    this.instrumentLibrary = { ...instrumentLibrary };
    this.convergenceThreshold = convergenceThreshold;
    this.excludeIds = excludeIds;
    this.overrides = overrides;
    this.parseOptions = parseOptions;
  }

  private log(msg: string) {
    this.logs.push(msg);
  }

  private getAzimuth(fromID: StationId, toID: StationId): { az: number; dist: number } {
    const s1 = this.stations[fromID];
    const s2 = this.stations[toID];
    if (!s1 || !s2) return { az: 0, dist: 0 };
    const dx = s2.x - s1.x;
    const dy = s2.y - s1.y;
    let az = Math.atan2(dx, dy);
    if (az < 0) az += 2 * Math.PI;
    return { az, dist: Math.sqrt(dx * dx + dy * dy) };
  }

  private wrapToPi(val: number): number {
    let v = val;
    if (v > Math.PI) v -= 2 * Math.PI;
    if (v < -Math.PI) v += 2 * Math.PI;
    return v;
  }

  private logObsDebug(iteration: number, label: string, details: string) {
    if (!this.debug) return;
    this.logs.push(`Iter ${iteration} ${label}: ${details}`);
  }

  private distanceScaleForObservation(obs: Observation): number {
    if (obs.type !== 'dist') return 1;
    if (this.mapMode === 'off') return 1;
    if (this.is2D) return this.mapScaleFactor;
    return obs.mode === 'horiz' ? this.mapScaleFactor : 1;
  }

  private curvatureRefractionAngle(horiz: number): number {
    if (!this.applyCurvatureRefraction) return 0;
    if (this.verticalReduction !== 'curvref') return 0;
    if (!Number.isFinite(horiz) || horiz <= 0) return 0;
    return ((1 - this.refractionCoefficient) * horiz) / (2 * EARTH_RADIUS_M);
  }

  private getZenith(
    fromID: StationId,
    toID: StationId,
    hi = 0,
    ht = 0,
  ): { z: number; dist: number; horiz: number; dh: number; crCorr: number } {
    const s1 = this.stations[fromID];
    const s2 = this.stations[toID];
    if (!s1 || !s2) return { z: 0, dist: 0, horiz: 0, dh: 0, crCorr: 0 };
    const dx = s2.x - s1.x;
    const dy = s2.y - s1.y;
    const dh = (s2.h + ht) - (s1.h + hi);
    const horiz = Math.sqrt(dx * dx + dy * dy);
    const dist = Math.sqrt(horiz * horiz + dh * dh);
    const zGeom = dist === 0 ? 0 : Math.acos(dh / dist);
    const crCorr = this.curvatureRefractionAngle(horiz);
    const z = Math.min(Math.PI, Math.max(0, zGeom + crCorr));
    return { z, dist, horiz, dh, crCorr };
  }

  private isObservationActive(obs: Observation): boolean {
    if (this.excludeIds?.has(obs.id)) return false;
    if (typeof obs.calc === 'object' && (obs.calc as any)?.sideshot) return false;
    if (this.is2D && (obs.type === 'lev' || obs.type === 'zenith')) return false;
    return true;
  }

  private buildCoordinateConstraints(
    paramIndex: Record<StationId, { x?: number; y?: number; h?: number }>,
  ): CoordinateConstraintEquation[] {
    const constraints: CoordinateConstraintEquation[] = [];
    Object.entries(paramIndex).forEach(([stationId, idx]) => {
      const st = this.stations[stationId];
      if (!st) return;
      if (idx.x != null && st.sx != null && st.constraintX != null && Number.isFinite(st.sx) && st.sx > 0) {
        constraints.push({
          stationId,
          component: 'x',
          index: idx.x,
          target: st.constraintX,
          sigma: st.sx,
        });
      }
      if (idx.y != null && st.sy != null && st.constraintY != null && Number.isFinite(st.sy) && st.sy > 0) {
        constraints.push({
          stationId,
          component: 'y',
          index: idx.y,
          target: st.constraintY,
          sigma: st.sy,
        });
      }
      if (
        !this.is2D &&
        idx.h != null &&
        st.sh != null &&
        st.constraintH != null &&
        Number.isFinite(st.sh) &&
        st.sh > 0
      ) {
        constraints.push({
          stationId,
          component: 'h',
          index: idx.h,
          target: st.constraintH,
          sigma: st.sh,
        });
      }
    });
    return constraints;
  }

  private summarizeConstraints(constraints: CoordinateConstraintEquation[]) {
    const x = constraints.filter((c) => c.component === 'x').length;
    const y = constraints.filter((c) => c.component === 'y').length;
    const h = constraints.filter((c) => c.component === 'h').length;
    return { count: constraints.length, x, y, h };
  }

  private computeSideshotResults(): AdjustmentResult['sideshots'] {
    const isSideshot = (obs: Observation): boolean =>
      typeof obs.calc === 'object' && (obs.calc as any)?.sideshot === true;
    const verticalByKey = new Map<string, Observation>();
    this.observations.forEach((obs) => {
      if (!isSideshot(obs)) return;
      if ((obs.type !== 'lev' && obs.type !== 'zenith') || !('from' in obs) || !('to' in obs)) return;
      const key = `${obs.from}|${obs.to}|${obs.sourceLine ?? -1}`;
      verticalByKey.set(key, obs);
    });

    const rows: NonNullable<AdjustmentResult['sideshots']> = [];
    this.observations.forEach((obs) => {
      if (!isSideshot(obs) || obs.type !== 'dist') return;
      const from = obs.from;
      const to = obs.to;
      const sourceLine = obs.sourceLine;
      const key = `${from}|${to}|${sourceLine ?? -1}`;
      const vertical = verticalByKey.get(key);
      const fromSt = this.stations[from];
      const toSt = this.stations[to];
      const calcMeta =
        typeof obs.calc === 'object' && (obs.calc as any)?.sideshot ? (obs.calc as any) : undefined;
      if (!fromSt) return;

      const mode = obs.mode ?? 'slope';
      const distSigma = this.effectiveStdDev(obs);
      let horizDistance = obs.obs;
      let sigmaHoriz = distSigma;
      let deltaH: number | undefined;
      let sigmaDh = 0;

      if (mode === 'slope') {
        const zen = vertical && vertical.type === 'zenith' ? vertical : undefined;
        if (zen) {
          const z = zen.obs;
          const sigmaZ = this.effectiveStdDev(zen);
          horizDistance = obs.obs * Math.sin(z);
          deltaH = obs.obs * Math.cos(z);
          sigmaHoriz = Math.sqrt(
            (Math.sin(z) * distSigma) ** 2 + (obs.obs * Math.cos(z) * sigmaZ) ** 2,
          );
          sigmaDh = Math.sqrt(
            (Math.cos(z) * distSigma) ** 2 + (obs.obs * Math.sin(z) * sigmaZ) ** 2,
          );
        }
      } else {
        horizDistance = obs.obs;
        sigmaHoriz = distSigma;
        const lev = vertical && vertical.type === 'lev' ? vertical : undefined;
        if (lev) {
          deltaH = lev.obs;
          sigmaDh = this.effectiveStdDev(lev);
        }
      }

      if (this.mapMode !== 'off') {
        horizDistance *= this.mapScaleFactor;
        sigmaHoriz *= this.mapScaleFactor;
      }

      const explicitAz = calcMeta?.azimuthObs;
      const explicitSigmaAz = calcMeta?.azimuthStdDev;
      const setupHz = calcMeta?.hzObs;
      const setupSigmaHz = calcMeta?.hzStdDev;
      const backsightId = calcMeta?.backsightId as StationId | undefined;
      const hasExplicitAz = Number.isFinite(explicitAz);
      const hasSetupHz = Number.isFinite(setupHz);
      const backsightSt = backsightId ? this.stations[backsightId] : undefined;
      const hasTargetAz = !!toSt;
      let setupAzimuth: number | undefined;
      if (hasSetupHz && backsightId && backsightSt) {
        const bs = this.getAzimuth(from, backsightId).az;
        setupAzimuth = (bs + (setupHz as number)) % (2 * Math.PI);
        if (setupAzimuth < 0) setupAzimuth += 2 * Math.PI;
      }
      const hasAzimuth = hasExplicitAz || setupAzimuth != null || hasTargetAz;
      const azimuth = hasExplicitAz
        ? (explicitAz as number)
        : setupAzimuth != null
          ? setupAzimuth
        : hasTargetAz
          ? this.getAzimuth(from, to).az
          : undefined;
      let sigmaAz = hasExplicitAz ? (explicitSigmaAz ?? 0) : 0;
      if (!hasExplicitAz && setupAzimuth != null && backsightId && backsightSt) {
        const azBs = this.getAzimuth(from, backsightId);
        const d = Math.max(azBs.dist, 1e-12);
        const dAz_dE_To = Math.cos(azBs.az) / d;
        const dAz_dN_To = -Math.sin(azBs.az) / d;
        const dAz_dE_From = -dAz_dE_To;
        const dAz_dN_From = -dAz_dN_To;
        const sETo = backsightSt.sE ?? 0;
        const sNTo = backsightSt.sN ?? 0;
        const sEFrom = fromSt.sE ?? 0;
        const sNFrom = fromSt.sN ?? 0;
        const sigmaAzBs = Math.sqrt(
          (dAz_dE_To * sETo) ** 2 +
            (dAz_dN_To * sNTo) ** 2 +
            (dAz_dE_From * sEFrom) ** 2 +
            (dAz_dN_From * sNFrom) ** 2,
        );
        sigmaAz = Math.sqrt((setupSigmaHz ?? 0) ** 2 + sigmaAzBs ** 2);
      } else if (!hasExplicitAz && setupAzimuth == null && hasTargetAz && azimuth != null) {
        const az = this.getAzimuth(from, to);
        const d = Math.max(az.dist, 1e-12);
        const dAz_dE_To = Math.cos(az.az) / d;
        const dAz_dN_To = -Math.sin(az.az) / d;
        const dAz_dE_From = -dAz_dE_To;
        const dAz_dN_From = -dAz_dN_To;
        const sETo = toSt?.sE ?? 0;
        const sNTo = toSt?.sN ?? 0;
        const sEFrom = fromSt.sE ?? 0;
        const sNFrom = fromSt.sN ?? 0;
        sigmaAz = Math.sqrt(
          (dAz_dE_To * sETo) ** 2 +
            (dAz_dN_To * sNTo) ** 2 +
            (dAz_dE_From * sEFrom) ** 2 +
            (dAz_dN_From * sNFrom) ** 2,
        );
      }
      const easting =
        hasAzimuth && azimuth != null ? fromSt.x + horizDistance * Math.sin(azimuth) : undefined;
      const northing =
        hasAzimuth && azimuth != null ? fromSt.y + horizDistance * Math.cos(azimuth) : undefined;
      const height = deltaH != null ? fromSt.h + deltaH : undefined;

      const sigmaFromE = fromSt.sE ?? 0;
      const sigmaFromN = fromSt.sN ?? 0;
      const sigmaFromH = fromSt.sH ?? 0;
      const sigmaE =
        hasAzimuth && azimuth != null
          ? Math.sqrt(
              sigmaFromE * sigmaFromE +
                (Math.sin(azimuth) * sigmaHoriz) ** 2 +
                (horizDistance * Math.cos(azimuth) * sigmaAz) ** 2,
            )
          : undefined;
      const sigmaN =
        hasAzimuth && azimuth != null
          ? Math.sqrt(
              sigmaFromN * sigmaFromN +
                (Math.cos(azimuth) * sigmaHoriz) ** 2 +
                (horizDistance * Math.sin(azimuth) * sigmaAz) ** 2,
            )
          : undefined;
      const sigmaH =
        deltaH != null ? Math.sqrt(sigmaFromH * sigmaFromH + sigmaDh * sigmaDh) : undefined;

      const notes: string[] = [];
      if (hasSetupHz && !backsightSt) {
        notes.push('setup horizontal angle provided but backsight is unavailable')
      }
      if (!hasAzimuth) notes.push('target station has no approximate coordinates; azimuth unavailable');
      if (mode === 'slope' && (!vertical || vertical.type !== 'zenith')) {
        notes.push('no zenith with slope distance; used slope as horizontal proxy');
      }

      rows.push({
        id: `${from}->${to}@${sourceLine ?? rows.length + 1}`,
        sourceLine,
        from,
        to,
        mode,
        hasAzimuth,
        azimuth,
        azimuthSource: hasExplicitAz
          ? 'explicit'
          : setupAzimuth != null
            ? 'setup'
            : hasTargetAz
              ? 'target'
              : undefined,
        sigmaAz: hasAzimuth ? sigmaAz : undefined,
        distance: obs.obs,
        horizDistance,
        deltaH,
        easting,
        northing,
        height,
        sigmaE,
        sigmaN,
        sigmaH,
        note: notes.length ? notes.join('; ') : undefined,
      });
    });

    return rows.sort((a, b) => {
      const la = a.sourceLine ?? Number.MAX_SAFE_INTEGER;
      const lb = b.sourceLine ?? Number.MAX_SAFE_INTEGER;
      if (la !== lb) return la - lb;
      return a.id.localeCompare(b.id);
    });
  }

  solve(): AdjustmentResult {
    const parsed = parseInput(this.input, this.instrumentLibrary, this.parseOptions);
    this.stations = parsed.stations;
    this.observations = parsed.observations;
    this.unknowns = parsed.unknowns;
    this.instrumentLibrary = parsed.instrumentLibrary;
    this.logs = [...parsed.logs];
    this.coordMode = parsed.parseState?.coordMode ?? this.parseOptions?.coordMode ?? '3D';
    this.addCenteringToExplicit = parsed.parseState?.addCenteringToExplicit ?? false;
    this.applyCentering = parsed.parseState?.applyCentering ?? true;
    this.debug = parsed.parseState?.debug ?? false;
    this.mapMode = parsed.parseState?.mapMode ?? this.parseOptions?.mapMode ?? 'off';
    this.mapScaleFactor = parsed.parseState?.mapScaleFactor ?? this.parseOptions?.mapScaleFactor ?? 1;
    this.applyCurvatureRefraction =
      parsed.parseState?.applyCurvatureRefraction ??
      this.parseOptions?.applyCurvatureRefraction ??
      false;
    this.refractionCoefficient =
      parsed.parseState?.refractionCoefficient ?? this.parseOptions?.refractionCoefficient ?? 0.13;
    this.verticalReduction =
      parsed.parseState?.verticalReduction ?? this.parseOptions?.verticalReduction ?? 'none';
    this.is2D = this.coordMode === '2D';
    this.condition = undefined;
    this.controlConstraints = undefined;
    this.sideshots = undefined;
    this.conditionWarned = false;

    if (this.mapMode !== 'off') {
      this.log(
        `Map reduction active: mode=${this.mapMode}, scale=${this.mapScaleFactor.toFixed(8)}`,
      );
    }
    if (this.applyCurvatureRefraction && this.verticalReduction === 'curvref') {
      this.log(
        `Vertical reduction active: curvature/refraction (k=${this.refractionCoefficient.toFixed(
          3,
        )})`,
      );
    }

    // Apply overrides before any unit normalization
    if (this.overrides) {
      this.observations.forEach((obs) => {
        const over = this.overrides?.[obs.id];
        if (!over) return;
        if (over.stdDev != null) {
          obs.stdDev = over.stdDev;
          if (obs.type === 'gps') {
            obs.stdDevE = over.stdDev;
            obs.stdDevN = over.stdDev;
            obs.corrEN = 0;
          }
        }
        if (over.obs != null) {
          if (
            (obs.type === 'angle' ||
              obs.type === 'direction' ||
              obs.type === 'bearing' ||
              obs.type === 'dir' ||
              obs.type === 'zenith') &&
            typeof over.obs === 'number'
          ) {
            obs.obs = (over.obs as number) * DEG_TO_RAD;
          } else if ((obs.type === 'dist' || obs.type === 'lev') && typeof over.obs === 'number') {
            obs.obs = over.obs as number;
          } else if (obs.type === 'gps' && typeof over.obs === 'object') {
            const val = over.obs as { dE: number; dN: number };
            obs.obs = { dE: val.dE, dN: val.dN };
          }
        }
      });
    }

    if (this.unknowns.length === 0) {
      this.log('No unknown stations to solve.');
      this.sideshots = this.computeSideshotResults();
      if (this.sideshots.length) {
        this.log(`Sideshots (post-adjust): ${this.sideshots.length}`);
      }
      return this.buildResult();
    }

    const activeObservations = this.observations.filter((obs) => this.isObservationActive(obs));
    const hasVertical: Record<StationId, boolean> = {};
    if (!this.is2D) {
      const markVertical = (id?: StationId) => {
        if (!id) return;
        hasVertical[id] = true;
      };
      activeObservations.forEach((obs) => {
        if (obs.type === 'lev' || obs.type === 'zenith') {
          markVertical(obs.from);
          markVertical(obs.to);
          return;
        }
        if (obs.type === 'dist' && obs.mode === 'slope') {
          markVertical(obs.from);
          markVertical(obs.to);
        }
      });
    }

    if (!this.is2D) {
      const autoDropped: StationId[] = [];
      this.unknowns.forEach((id) => {
        const st = this.stations[id];
        if (!st) return;
        if (st.fixedH) return;
        if (hasVertical[id]) return;
        st.fixedH = true;
        const fx = st.fixedX ?? false;
        const fy = st.fixedY ?? false;
        st.fixed = fx && fy && st.fixedH;
        autoDropped.push(id);
      });
      if (autoDropped.length) {
        this.log(
          `Auto-drop H for stations with no vertical observations: ${autoDropped.join(', ')}`,
        );
      }
    }
    if (this.is2D) {
      const skippedVertical = this.observations.filter(
        (o) =>
          (o.type === 'lev' || o.type === 'zenith') &&
          !(typeof o.calc === 'object' && (o.calc as any)?.sideshot),
      ).length;
      if (skippedVertical > 0) {
        this.log(`2D mode: skipped ${skippedVertical} vertical observations (lev/zenith).`);
      }
    }
    this.logNetworkDiagnostics(activeObservations);

    const directionSetIds = Array.from(
      new Set(
        activeObservations
          .filter((o) => o.type === 'direction')
          .map((o) => (o as any).setId as string),
      ),
    );
    this.directionOrientations = {};
    this.computeDirectionSetPrefit(activeObservations, directionSetIds);

    this.paramIndex = {};
    let stationParamCount = 0;
    this.unknowns.forEach((id) => {
      const st = this.stations[id];
      if (!st) return;
      const idx: { x?: number; y?: number; h?: number } = {};
      if (!st.fixedX) {
        idx.x = stationParamCount;
        stationParamCount += 1;
      }
      if (!st.fixedY) {
        idx.y = stationParamCount;
        stationParamCount += 1;
      }
      if (!this.is2D && !st.fixedH) {
        idx.h = stationParamCount;
        stationParamCount += 1;
      }
      if (idx.x != null || idx.y != null || idx.h != null) {
        this.paramIndex[id] = idx;
      }
    });
    const constraints = this.buildCoordinateConstraints(this.paramIndex);
    this.controlConstraints = this.summarizeConstraints(constraints);
    if (constraints.length) {
      this.log(
        `Weighted control constraints: ${constraints.length} (E=${this.controlConstraints.x}, N=${this.controlConstraints.y}, H=${this.controlConstraints.h})`,
      );
    }
    const numParams = stationParamCount + directionSetIds.length; // X, Y (+H) + dir orientations
    const numObsEquations =
      activeObservations.reduce((acc, o) => acc + (o.type === 'gps' ? 2 : 1), 0) +
      constraints.length;

    this.dof = numObsEquations - numParams;
    if (this.dof < 0) {
      this.log('Error: Redundancy < 0. Under-determined.');
      return this.buildResult();
    }

    const dirParamMap: Record<string, number> = {};
    directionSetIds.forEach((id, idx) => {
      dirParamMap[id] = stationParamCount + idx;
    });

    for (let iter = 0; iter < this.maxIterations; iter++) {
      this.iterations += 1;

      const A = zeros(numObsEquations, numParams);
      const L = zeros(numObsEquations, 1);
      const P = zeros(numObsEquations, numObsEquations);

      let row = 0;

      activeObservations.forEach((obs) => {
        if (obs.type === 'dist') {
          const { from, to } = obs;
          const s1 = this.stations[from];
          const s2 = this.stations[to];
          if (!s1 || !s2) return;
          const dx = s2.x - s1.x;
          const dy = s2.y - s1.y;
          const dz = (s2.h + (obs.ht ?? 0)) - (s1.h + (obs.hi ?? 0));
          const horiz = Math.sqrt(dx * dx + dy * dy);
          const calcDistRaw = this.is2D
            ? horiz
            : obs.mode === 'slope'
              ? Math.sqrt(horiz * horiz + dz * dz)
              : horiz;
          const mapScale = this.distanceScaleForObservation(obs);
          const calcDist = calcDistRaw * mapScale;
          const v = obs.obs - calcDist;

          L[row][0] = v;
          if (this.debug) {
            const sigmaUsed = this.effectiveStdDev(obs);
            const wRad = v;
            const norm = sigmaUsed ? wRad / sigmaUsed : 0;
            this.logObsDebug(
              iter + 1,
              `DIST#${obs.id}`,
              `from=${from} to=${to} obs=${obs.obs.toFixed(4)}m calc=${calcDist.toFixed(
                4,
              )}m w=${wRad.toFixed(6)}m norm=${norm.toFixed(3)} sigma=${sigmaUsed.toFixed(6)}m mode=${obs.mode}`,
            );
          }
          const denom = calcDistRaw || 1;
          const dD_dE2 = (dx / denom) * mapScale;
          const dD_dN2 = (dy / denom) * mapScale;
          const dD_dH2 = !this.is2D && obs.mode === 'slope' ? (dz / denom) * mapScale : 0;

          const fromIdx = this.paramIndex[from];
          if (fromIdx?.x != null) {
            A[row][fromIdx.x] = -dD_dE2;
          }
          if (fromIdx?.y != null) {
            A[row][fromIdx.y] = -dD_dN2;
          }
          if (!this.is2D && fromIdx?.h != null) {
            A[row][fromIdx.h] = -dD_dH2;
          }
          const toIdx = this.paramIndex[to];
          if (toIdx?.x != null) {
            A[row][toIdx.x] = dD_dE2;
          }
          if (toIdx?.y != null) {
            A[row][toIdx.y] = dD_dN2;
          }
          if (!this.is2D && toIdx?.h != null) {
            A[row][toIdx.h] = dD_dH2;
          }

          const sigma = this.effectiveStdDev(obs);
          const w = 1.0 / (sigma * sigma);
          P[row][row] = w;

          row += 1;
        } else if (obs.type === 'angle') {
          const { at, from, to } = obs;
          if (!this.stations[at] || !this.stations[from] || !this.stations[to]) return;
          const azTo = this.getAzimuth(at, to);
          const azFrom = this.getAzimuth(at, from);
          let calcAngle = azTo.az - azFrom.az;
          if (calcAngle < 0) calcAngle += 2 * Math.PI;
          let diff = obs.obs - calcAngle;
          diff = this.wrapToPi(diff);
          L[row][0] = diff;
          if (this.debug) {
            const sigmaUsed = this.effectiveStdDev(obs);
            const wRad = diff;
            const wDeg = wRad * RAD_TO_DEG;
            const norm = sigmaUsed ? wRad / sigmaUsed : 0;
            this.logObsDebug(
              iter + 1,
              `ANGLE#${obs.id}`,
              `at=${at} from=${from} to=${to} obs=${(obs.obs * RAD_TO_DEG).toFixed(
                6,
              )}°/${obs.obs.toFixed(6)}rad azTo=${(azTo.az * RAD_TO_DEG).toFixed(
                6,
              )}° azFrom=${(azFrom.az * RAD_TO_DEG).toFixed(
                6,
              )}° calc=${(calcAngle * RAD_TO_DEG).toFixed(6)}° w=${wDeg.toFixed(
                6,
              )}°/${wRad.toFixed(8)}rad norm=${norm.toFixed(3)} sigma=${sigmaUsed.toFixed(8)}rad`,
            );
          }

          const dAzTo_dE_To = Math.cos(azTo.az) / (azTo.dist || 1);
          const dAzTo_dN_To = -Math.sin(azTo.az) / (azTo.dist || 1);
          const dAzFrom_dE_From = Math.cos(azFrom.az) / (azFrom.dist || 1);
          const dAzFrom_dN_From = -Math.sin(azFrom.az) / (azFrom.dist || 1);

          const toIdx = this.paramIndex[to];
          if (toIdx?.x != null) {
            A[row][toIdx.x] = dAzTo_dE_To;
          }
          if (toIdx?.y != null) {
            A[row][toIdx.y] = dAzTo_dN_To;
          }
          const fromIdx = this.paramIndex[from];
          if (fromIdx?.x != null) {
            A[row][fromIdx.x] = -dAzFrom_dE_From;
          }
          if (fromIdx?.y != null) {
            A[row][fromIdx.y] = -dAzFrom_dN_From;
          }
          const atIdx = this.paramIndex[at];
          if (atIdx?.x != null || atIdx?.y != null) {
            const dAzTo_dE_At = -dAzTo_dE_To;
            const dAzTo_dN_At = -dAzTo_dN_To;
            const dAzFrom_dE_At = -dAzFrom_dE_From;
            const dAzFrom_dN_At = -dAzFrom_dN_From;
            if (atIdx?.x != null) {
              A[row][atIdx.x] = dAzTo_dE_At - dAzFrom_dE_At;
            }
            if (atIdx?.y != null) {
              A[row][atIdx.y] = dAzTo_dN_At - dAzFrom_dN_At;
            }
          }

          const sigma = this.effectiveStdDev(obs);
          const w = 1.0 / (sigma * sigma);
          P[row][row] = w;

          row += 1;
        } else if (obs.type === 'gps') {
          const { from, to } = obs;
          const s1 = this.stations[from];
          const s2 = this.stations[to];
          if (!s1 || !s2) return;

          const calc_dE = s2.x - s1.x;
          const calc_dN = s2.y - s1.y;
          const vE = obs.obs.dE - calc_dE;
          const vN = obs.obs.dN - calc_dN;

          L[row][0] = vE;
          const fromIdx = this.paramIndex[from];
          if (fromIdx?.x != null) {
            A[row][fromIdx.x] = -1.0;
          }
          const toIdx = this.paramIndex[to];
          if (toIdx?.x != null) {
            A[row][toIdx.x] = 1.0;
          }
          {
            const w = this.gpsWeight(obs);
            P[row][row] = w.wEE;
            P[row][row + 1] = w.wEN;
            P[row + 1][row] = w.wEN;
            P[row + 1][row + 1] = w.wNN;
          }

          L[row + 1][0] = vN;
          if (fromIdx?.y != null) {
            A[row + 1][fromIdx.y] = -1.0;
          }
          if (toIdx?.y != null) {
            A[row + 1][toIdx.y] = 1.0;
          }

          row += 2;
        } else if (obs.type === 'lev') {
          const { from, to } = obs;
          const s1 = this.stations[from];
          const s2 = this.stations[to];
          if (!s1 || !s2) return;

          const calc_dH = s2.h - s1.h;
          const v = obs.obs - calc_dH;
          L[row][0] = v;

          const fromIdx = this.paramIndex[from];
          if (fromIdx?.h != null) {
            A[row][fromIdx.h] = -1.0;
          }
          const toIdx = this.paramIndex[to];
          if (toIdx?.h != null) {
            A[row][toIdx.h] = 1.0;
          }

          const sigma = this.effectiveStdDev(obs);
          const w = 1.0 / (sigma * sigma);
          P[row][row] = w;

          row += 1;
        } else if (obs.type === 'bearing') {
          const { from, to } = obs;
          const az = this.getAzimuth(from, to);
          const calc = az.az;
          let v = obs.obs - calc;
          if (v > Math.PI) v -= 2 * Math.PI;
          if (v < -Math.PI) v += 2 * Math.PI;
          L[row][0] = v;

          const dAz_dE_To = Math.cos(calc) / (az.dist || 1);
          const dAz_dN_To = -Math.sin(calc) / (az.dist || 1);

          const toIdx = this.paramIndex[to];
          if (toIdx?.x != null) {
            A[row][toIdx.x] = dAz_dE_To;
          }
          if (toIdx?.y != null) {
            A[row][toIdx.y] = dAz_dN_To;
          }
          const fromIdx = this.paramIndex[from];
          if (fromIdx?.x != null) {
            A[row][fromIdx.x] = -dAz_dE_To;
          }
          if (fromIdx?.y != null) {
            A[row][fromIdx.y] = -dAz_dN_To;
          }

          const sigma = this.effectiveStdDev(obs);
          const w = 1.0 / (sigma * sigma);
          P[row][row] = w;

          row += 1;
        } else if (obs.type === 'dir') {
          const { from, to } = obs;
          const az = this.getAzimuth(from, to);
          const calc = az.az;
          let v0 = obs.obs - calc;
          if (v0 > Math.PI) v0 -= 2 * Math.PI;
          if (v0 < -Math.PI) v0 += 2 * Math.PI;
          let v = v0;
          if (obs.flip180) {
            let v1 = obs.obs + Math.PI - calc;
            if (v1 > Math.PI) v1 -= 2 * Math.PI;
            if (v1 < -Math.PI) v1 += 2 * Math.PI;
            if (Math.abs(v1) < Math.abs(v0)) v = v1;
          }
          L[row][0] = v;
          if (this.debug) {
            const sigmaUsed = this.effectiveStdDev(obs);
            const wRad = v;
            const wDeg = wRad * RAD_TO_DEG;
            const norm = sigmaUsed ? wRad / sigmaUsed : 0;
            this.logObsDebug(
              iter + 1,
              `DIRAZ#${obs.id}`,
              `from=${from} to=${to} obs=${(obs.obs * RAD_TO_DEG).toFixed(6)}°/${obs.obs.toFixed(
                6,
              )}rad calc=${(calc * RAD_TO_DEG).toFixed(6)}° w=${wDeg.toFixed(
                6,
              )}°/${wRad.toFixed(8)}rad norm=${norm.toFixed(3)} sigma=${sigmaUsed.toFixed(
                8,
              )}rad`,
            );
          }

          const dAz_dE_To = Math.cos(calc) / (az.dist || 1);
          const dAz_dN_To = -Math.sin(calc) / (az.dist || 1);

          const toIdx = this.paramIndex[to];
          if (toIdx?.x != null) {
            A[row][toIdx.x] = dAz_dE_To;
          }
          if (toIdx?.y != null) {
            A[row][toIdx.y] = dAz_dN_To;
          }
          const fromIdx = this.paramIndex[from];
          if (fromIdx?.x != null) {
            A[row][fromIdx.x] = -dAz_dE_To;
          }
          if (fromIdx?.y != null) {
            A[row][fromIdx.y] = -dAz_dN_To;
          }

          const sigma = this.effectiveStdDev(obs);
          const w = 1.0 / (sigma * sigma);
          P[row][row] = w;

          row += 1;
        } else if (obs.type === 'direction') {
          const { at, to, setId } = obs as any;
          if (!this.stations[at] || !this.stations[to]) return;
          const az = this.getAzimuth(at, to);
          const orientation = this.directionOrientations[setId] ?? 0;
          let calc = orientation + az.az;
          calc %= 2 * Math.PI;
          if (calc < 0) calc += 2 * Math.PI;
          let v = obs.obs - calc;
          v = this.wrapToPi(v);
          L[row][0] = v;
          if (this.debug) {
            const sigmaUsed = this.effectiveStdDev(obs);
            const wRad = v;
            const wDeg = wRad * RAD_TO_DEG;
            const norm = sigmaUsed ? wRad / sigmaUsed : 0;
            this.logObsDebug(
              iter + 1,
              `DIR#${obs.id}`,
              `at=${at} to=${to} set=${setId} obs=${(obs.obs * RAD_TO_DEG).toFixed(
                6,
              )}°/${obs.obs.toFixed(6)}rad az=${(az.az * RAD_TO_DEG).toFixed(
                6,
              )}° orient=${(orientation * RAD_TO_DEG).toFixed(6)}° calc=${(
                calc * RAD_TO_DEG
              ).toFixed(6)}° w=${wDeg.toFixed(6)}°/${wRad.toFixed(
                8,
              )}rad norm=${norm.toFixed(3)} sigma=${sigmaUsed.toFixed(8)}rad`,
            );
          }

          const dAz_dE_To = Math.cos(az.az) / (az.dist || 1);
          const dAz_dN_To = -Math.sin(az.az) / (az.dist || 1);

          const toIdx = this.paramIndex[to];
          if (toIdx?.x != null) {
            A[row][toIdx.x] = dAz_dE_To;
          }
          if (toIdx?.y != null) {
            A[row][toIdx.y] = dAz_dN_To;
          }
          const atIdx = this.paramIndex[at];
          if (atIdx?.x != null) {
            A[row][atIdx.x] = -dAz_dE_To;
          }
          if (atIdx?.y != null) {
            A[row][atIdx.y] = -dAz_dN_To;
          }

          const dirIdx = dirParamMap[setId];
          if (dirIdx != null) {
            A[row][dirIdx] = 1;
          }

          const sigma = this.effectiveStdDev(obs);
          const w = 1.0 / (sigma * sigma);
          P[row][row] = w;

          row += 1;
        } else if (obs.type === 'zenith') {
          const { from, to } = obs;
          if (!this.stations[from] || !this.stations[to]) return;
          const zv = this.getZenith(from, to, obs.hi ?? 0, obs.ht ?? 0);
          const calc = zv.z;
          let v = obs.obs - calc;
          v = this.wrapToPi(v);
          L[row][0] = v;
          if (this.debug) {
            const sigmaUsed = this.effectiveStdDev(obs);
            const wRad = v;
            const wDeg = wRad * RAD_TO_DEG;
            const norm = sigmaUsed ? wRad / sigmaUsed : 0;
            this.logObsDebug(
              iter + 1,
              `ZEN#${obs.id}`,
              `from=${from} to=${to} obs=${(obs.obs * RAD_TO_DEG).toFixed(6)}°/${obs.obs.toFixed(
                6,
              )}rad calc=${(calc * RAD_TO_DEG).toFixed(6)}° w=${wDeg.toFixed(
                6,
              )}°/${wRad.toFixed(8)}rad norm=${norm.toFixed(3)} sigma=${sigmaUsed.toFixed(8)}rad cr=${(
                zv.crCorr * RAD_TO_DEG * 3600
              ).toFixed(2)}"`,
            );
          }

          const denom = Math.sqrt(Math.max(1 - (zv.dist === 0 ? 0 : (zv.dh / zv.dist) ** 2), 1e-12));
          const common = zv.dist === 0 ? 0 : 1 / (zv.dist * zv.dist * zv.dist * denom);
          const dx = this.stations[to].x - this.stations[from].x;
          const dy = this.stations[to].y - this.stations[from].y;
          const dZ_dEGeom = zv.dh * dx * common;
          const dZ_dNGeom = zv.dh * dy * common;
          const dC_dHoriz = this.curvatureRefractionAngle(1);
          const dHoriz_dE = zv.horiz > 0 ? dx / zv.horiz : 0;
          const dHoriz_dN = zv.horiz > 0 ? dy / zv.horiz : 0;
          const dZ_dE = dZ_dEGeom + dC_dHoriz * dHoriz_dE;
          const dZ_dN = dZ_dNGeom + dC_dHoriz * dHoriz_dN;
          const dZ_dH = -(zv.horiz * zv.horiz) * common;

          const toIdx = this.paramIndex[to];
          if (toIdx?.x != null) {
            A[row][toIdx.x] = dZ_dE;
          }
          if (toIdx?.y != null) {
            A[row][toIdx.y] = dZ_dN;
          }
          if (toIdx?.h != null) {
            A[row][toIdx.h] = dZ_dH;
          }
          const fromIdx = this.paramIndex[from];
          if (fromIdx?.x != null) {
            A[row][fromIdx.x] = -dZ_dE;
          }
          if (fromIdx?.y != null) {
            A[row][fromIdx.y] = -dZ_dN;
          }
          if (fromIdx?.h != null) {
            A[row][fromIdx.h] = -dZ_dH;
          }

          const sigma = this.effectiveStdDev(obs);
          const w = 1.0 / (sigma * sigma);
          P[row][row] = w;

          row += 1;
        }
      });

      constraints.forEach((constraint) => {
        const st = this.stations[constraint.stationId];
        if (!st) return;
        const current =
          constraint.component === 'x'
            ? st.x
            : constraint.component === 'y'
              ? st.y
              : st.h;
        const v = constraint.target - current;
        L[row][0] = v;
        A[row][constraint.index] = 1;
        P[row][row] = 1 / (constraint.sigma * constraint.sigma);
        row += 1;
      });

      try {
        const AT = transpose(A);
        const ATP = multiply(AT, P);
        const N = multiply(ATP, A);
        const conditionEstimate = this.estimateCondition(N);
        this.condition = {
          estimate: conditionEstimate,
          threshold: this.maxCondition,
          flagged: conditionEstimate > this.maxCondition,
        };
        if (conditionEstimate > this.maxCondition && !this.conditionWarned) {
          this.log(
            `Warning: normal matrix appears ill-conditioned (estimate=${conditionEstimate.toExponential(
              3,
            )}, threshold=${this.maxCondition.toExponential(3)}).`,
          );
          this.conditionWarned = true;
        }
        const U = multiply(ATP, L);
        const N_inv = inv(N);
        const X = multiply(N_inv, U);
        this.Qxx = N_inv;

        if (this.debug) {
          const AX = multiply(A, X);
          let sumBefore = 0;
          let sumAfter = 0;
          let maxBefore = 0;
          let maxAfter = 0;
          for (let i = 0; i < numObsEquations; i += 1) {
            const w = P[i][i] || 0;
            const v0 = L[i][0];
            const v1 = v0 - AX[i][0];
            sumBefore += w * v0 * v0;
            sumAfter += w * v1 * v1;
            maxBefore = Math.max(maxBefore, Math.abs(v0));
            maxAfter = Math.max(maxAfter, Math.abs(v1));
          }
          const ratio = sumBefore > 0 ? sumAfter / sumBefore : 0;
          const msg =
            `Iter ${iter + 1} step check: ` +
            `weightedV0=${sumBefore.toExponential(3)} ` +
            `weightedV1=${sumAfter.toExponential(3)} ` +
            `ratio=${ratio.toFixed(3)} ` +
            `max|w|=${maxBefore.toExponential(3)} ` +
            `max|wnew|=${maxAfter.toExponential(3)}`;
          this.logs.push(msg);
          if (ratio > 1.05) {
            this.logs.push(
              `Warning: Iter ${iter + 1} predicted residuals increased. ` +
                `Check sign convention and angle/zenith units (radians vs degrees).`,
            );
          }
        }

        let maxCorrection = 0;
        Object.entries(this.paramIndex).forEach(([id, idx]) => {
          const st = this.stations[id];
          if (!st) return;
          if (idx.x != null) {
            const dE = X[idx.x][0];
            st.x += dE;
            maxCorrection = Math.max(maxCorrection, Math.abs(dE));
          }
          if (idx.y != null) {
            const dN = X[idx.y][0];
            st.y += dN;
            maxCorrection = Math.max(maxCorrection, Math.abs(dN));
          }
          if (!this.is2D && idx.h != null) {
            const dH = X[idx.h][0];
            st.h += dH;
            maxCorrection = Math.max(maxCorrection, Math.abs(dH));
          }
        });

        directionSetIds.forEach((id) => {
          const idx = dirParamMap[id];
          if (idx == null) return;
          const dOri = X[idx][0];
          const next = (this.directionOrientations[id] ?? 0) + dOri;
          let wrapped = next % (2 * Math.PI);
          if (wrapped < 0) wrapped += 2 * Math.PI;
          this.directionOrientations[id] = wrapped;
          maxCorrection = Math.max(maxCorrection, Math.abs(dOri));
        });

        this.log(`Iter ${iter + 1}: Max Corr = ${maxCorrection.toFixed(4)}`);
        if (maxCorrection < this.convergenceThreshold) {
          this.converged = true;
          break;
        }
      } catch {
        this.log('Matrix Inversion Failed (Singular).');
        this.calculateStatistics(this.paramIndex, false);
        return this.buildResult();
      }
    }

    if (!this.converged) this.log('Warning: Max iterations reached.');
    this.calculateStatistics(this.paramIndex, !!this.Qxx);
    return this.buildResult();
  }

  private estimateCondition(N: number[][]): number {
    // crude condition estimate via row/col norm product to avoid expensive SVD
    const n = N.length;
    if (!n) return 0;
    let rowMax = 0;
    let colMax = 0;
    for (let i = 0; i < n; i++) {
      let rsum = 0;
      let csum = 0;
      for (let j = 0; j < n; j++) {
        rsum += Math.abs(N[i][j]);
        csum += Math.abs(N[j][i]);
      }
      rowMax = Math.max(rowMax, rsum);
      colMax = Math.max(colMax, csum);
    }
    return rowMax * colMax;
  }

  private calculateStatistics(
    paramIndex: Record<StationId, { x?: number; y?: number; h?: number }>,
    hasQxx: boolean,
  ) {
    let vtpv = 0;
    const closureResiduals: string[] = [];
    const closureVectors: { from: StationId; to: StationId; dE: number; dN: number }[] = [];
    const loopVectors: Record<string, { dE: number; dN: number }> = {};
    const hasClosureObs = this.observations.some(
      (o) => (o as any).setId && String((o as any).setId).toUpperCase() === 'TE',
    );
    const coordClosureVectors: { from: StationId; to: StationId; dE: number; dN: number }[] = [];
    let totalTraverseDistance = 0;
    const directionStats = new Map<
      string,
      {
        count: number;
        rawCount: number;
        reducedCount: number;
        face1Count: number;
        face2Count: number;
        pairedTargets: number;
        sum: number;
        sumSq: number;
        maxAbs: number;
        occupy: StationId;
        orientation: number;
      }
    >();
    const activeObservations = this.observations.filter((obs) => this.isObservationActive(obs));
    const constraints = this.buildCoordinateConstraints(paramIndex);

    this.observations.forEach((obs) => {
      if (!this.isObservationActive(obs)) return;
      if (obs.type === 'dist') {
        const s1 = this.stations[obs.from];
        const s2 = this.stations[obs.to];
        if (!s1 || !s2) return;
        const dx = s2.x - s1.x;
        const dy = s2.y - s1.y;
        const dz = (s2.h + (obs.ht ?? 0)) - (s1.h + (obs.hi ?? 0));
        const horiz = Math.sqrt(dx * dx + dy * dy);
        const calcRaw = this.is2D
          ? horiz
          : obs.mode === 'slope'
            ? Math.sqrt(horiz * horiz + dz * dz)
            : horiz;
        const calc = calcRaw * this.distanceScaleForObservation(obs);
        const v = obs.obs - calc;
        obs.calc = calc;
        obs.residual = v;
        const sigma = this.effectiveStdDev(obs);
        obs.stdRes = Math.abs(v) / sigma;
        vtpv += (v * v) / (sigma * sigma);
        const setTag = String((obs as any).setId ?? '').toUpperCase();
        if (setTag === 'T' || setTag === 'TE') {
          totalTraverseDistance += Math.abs(obs.obs);
        }
      } else if (obs.type === 'angle') {
        const azTo = this.getAzimuth(obs.at, obs.to).az;
        const azFrom = this.getAzimuth(obs.at, obs.from).az;
        let calcAngle = azTo - azFrom;
        if (calcAngle < 0) calcAngle += 2 * Math.PI;
        let v = obs.obs - calcAngle;
        if (v > Math.PI) v -= 2 * Math.PI;
        if (v < -Math.PI) v += 2 * Math.PI;
        obs.calc = calcAngle;
        obs.residual = v;
        const sigma = this.effectiveStdDev(obs);
        obs.stdRes = Math.abs(v) / sigma;
        vtpv += (v * v) / (sigma * sigma);
      } else if (obs.type === 'gps') {
        const s1 = this.stations[obs.from];
        const s2 = this.stations[obs.to];
        if (!s1 || !s2) return;
        const calc_dE = s2.x - s1.x;
        const calc_dN = s2.y - s1.y;
        const vE = obs.obs.dE - calc_dE;
        const vN = obs.obs.dN - calc_dN;
        obs.calc = { dE: calc_dE, dN: calc_dN };
        obs.residual = { vE, vN };
        const w = this.gpsWeight(obs);
        const quad = w.wEE * vE * vE + 2 * w.wEN * vE * vN + w.wNN * vN * vN;
        obs.stdRes = Math.sqrt(Math.max(quad, 0));
        vtpv += quad;
      } else if (obs.type === 'lev') {
        const s1 = this.stations[obs.from];
        const s2 = this.stations[obs.to];
        if (!s1 || !s2) return;
        const calc_dH = s2.h - s1.h;
        const v = obs.obs - calc_dH;
        obs.calc = calc_dH;
        obs.residual = v;
        const sigma = this.effectiveStdDev(obs);
        obs.stdRes = Math.abs(v) / sigma;
        vtpv += (v * v) / (sigma * sigma);
      } else if (obs.type === 'bearing') {
        const calcAz = this.getAzimuth(obs.from, obs.to).az;
        let v = obs.obs - calcAz;
        if (v > Math.PI) v -= 2 * Math.PI;
        if (v < -Math.PI) v += 2 * Math.PI;
        obs.calc = calcAz;
        obs.residual = v;
        const sigma = this.effectiveStdDev(obs);
        obs.stdRes = Math.abs(v) / sigma;
        vtpv += (v * v) / (sigma * sigma);
      } else if (obs.type === 'dir') {
        const calcAz = this.getAzimuth(obs.from, obs.to).az;
        let v0 = obs.obs - calcAz;
        if (v0 > Math.PI) v0 -= 2 * Math.PI;
        if (v0 < -Math.PI) v0 += 2 * Math.PI;
        let v = v0;
        if (obs.flip180) {
          let v1 = obs.obs + Math.PI - calcAz;
          if (v1 > Math.PI) v1 -= 2 * Math.PI;
          if (v1 < -Math.PI) v1 += 2 * Math.PI;
          if (Math.abs(v1) < Math.abs(v0)) v = v1;
        }
        obs.calc = calcAz;
        obs.residual = v;
        const sigma = this.effectiveStdDev(obs);
        obs.stdRes = Math.abs(v) / sigma;
        vtpv += (v * v) / (sigma * sigma);
      } else if (obs.type === 'direction') {
        const dir = obs as any;
        const az = this.getAzimuth(dir.at, dir.to).az;
        const orientation = this.directionOrientations[dir.setId] ?? 0;
        let calc = orientation + az;
        calc %= 2 * Math.PI;
        if (calc < 0) calc += 2 * Math.PI;
        let v = dir.obs - calc;
        if (v > Math.PI) v -= 2 * Math.PI;
        if (v < -Math.PI) v += 2 * Math.PI;
        dir.calc = calc;
        dir.residual = v;
        const sigma = this.effectiveStdDev(dir);
        dir.stdRes = Math.abs(v) / sigma;
        vtpv += (v * v) / (sigma * sigma);

        const setId = String(dir.setId ?? 'unknown');
        const stat = directionStats.get(setId) ?? {
          count: 0,
          rawCount: 0,
          reducedCount: 0,
          face1Count: 0,
          face2Count: 0,
          pairedTargets: 0,
          sum: 0,
          sumSq: 0,
          maxAbs: 0,
          occupy: dir.at,
          orientation,
        };
        const arcsec = v * RAD_TO_DEG * 3600;
        const rawCount = typeof dir.rawCount === 'number' && dir.rawCount > 0 ? dir.rawCount : 1;
        const face1Count =
          typeof dir.rawFace1Count === 'number'
            ? dir.rawFace1Count
            : dir.obs >= Math.PI
              ? 0
              : rawCount;
        const face2Count =
          typeof dir.rawFace2Count === 'number' ? dir.rawFace2Count : Math.max(0, rawCount - face1Count);
        stat.count += 1;
        stat.rawCount += rawCount;
        stat.reducedCount += 1;
        stat.face1Count += face1Count;
        stat.face2Count += face2Count;
        if (face1Count > 0 && face2Count > 0) stat.pairedTargets += 1;
        stat.sum += arcsec;
        stat.sumSq += arcsec * arcsec;
        stat.maxAbs = Math.max(stat.maxAbs, Math.abs(arcsec));
        stat.occupy = dir.at ?? stat.occupy;
        stat.orientation = orientation;
        directionStats.set(setId, stat);
      } else if (obs.type === 'zenith') {
        const zv = this.getZenith(obs.from, obs.to, obs.hi ?? 0, obs.ht ?? 0).z;
        let v = obs.obs - zv;
        if (v > Math.PI) v -= 2 * Math.PI;
        if (v < -Math.PI) v += 2 * Math.PI;
        obs.calc = zv;
        obs.residual = v;
        const sigma = this.effectiveStdDev(obs);
        obs.stdRes = Math.abs(v) / sigma;
        vtpv += (v * v) / (sigma * sigma);
      }

      if (obs.setId === 'TE' && typeof obs.residual === 'number') {
        if (obs.type === 'dist') {
          const az = this.getAzimuth(obs.from, obs.to).az;
          const dE = obs.residual * Math.sin(az);
          const dN = obs.residual * Math.cos(az);
          closureVectors.push({ from: obs.from, to: obs.to, dE, dN });
          const key = `${obs.from}->${obs.to}`;
          loopVectors[key] = loopVectors[key] || { dE: 0, dN: 0 };
          loopVectors[key].dE += dE;
          loopVectors[key].dN += dN;
          closureResiduals.push(
            `Traverse closure residual ${obs.from}-${obs.to}: ${obs.residual.toFixed(4)} m`,
          );
          const s1 = this.stations[obs.from];
          const s2 = this.stations[obs.to];
          if (s1 && s2) {
            coordClosureVectors.push({
              from: obs.from,
              to: obs.to,
              dE: s2.x - s1.x,
              dN: s2.y - s1.y,
            });
          }
        } else if (obs.type === 'angle') {
          closureResiduals.push(
            `Traverse closure residual (angle) ${obs.from}-${obs.to}: ${(obs.residual * RAD_TO_DEG * 3600).toFixed(2)}"`,
          );
        }
      }
    });

    constraints.forEach((constraint) => {
      const st = this.stations[constraint.stationId];
      if (!st) return;
      const current =
        constraint.component === 'x'
          ? st.x
          : constraint.component === 'y'
            ? st.y
            : st.h;
      const v = constraint.target - current;
      vtpv += (v * v) / (constraint.sigma * constraint.sigma);
    });

    this.seuw = this.dof > 0 ? Math.sqrt(vtpv / this.dof) : 0;

    this.chiSquare = undefined;
    this.typeSummary = undefined;
    this.directionSetDiagnostics = undefined;
    this.directionTargetDiagnostics = undefined;
    this.setupDiagnostics = undefined;
    this.traverseDiagnostics = undefined;

    if (this.dof > 0) {
      const alpha = 0.05;
      const lower = chiSquareQuantile(alpha / 2, this.dof);
      const upper = chiSquareQuantile(1 - alpha / 2, this.dof);
      const pUpper = chiSquarePValue(vtpv, this.dof);
      const pLower = 1 - pUpper;
      const pTwo = Math.max(0, Math.min(1, 2 * Math.min(pUpper, pLower)));
      const varianceFactor = vtpv / this.dof;
      this.chiSquare = {
        T: vtpv,
        dof: this.dof,
        p: pTwo,
        pass95: vtpv >= lower && vtpv <= upper,
        alpha,
        lower,
        upper,
        varianceFactor,
        varianceFactorLower: lower / this.dof,
        varianceFactorUpper: upper / this.dof,
      };
    }

    if (hasQxx) {
      const stationParamCount = Object.values(paramIndex).reduce((max, idx) => {
        const vals = [idx.x ?? -1, idx.y ?? -1, idx.h ?? -1];
        return Math.max(max, ...vals);
      }, -1) + 1;
      const directionSetIds = Array.from(
        new Set(
          activeObservations
            .filter((o) => o.type === 'direction')
            .map((o) => (o as any).setId as string),
        ),
      );
      const dirParamMap: Record<string, number> = {};
      directionSetIds.forEach((id, idx) => {
        dirParamMap[id] = stationParamCount + idx;
      });
      const numParams = stationParamCount + directionSetIds.length;
      const numObsEquations =
        activeObservations.reduce((acc, o) => acc + (o.type === 'gps' ? 2 : 1), 0) +
        constraints.length;

      if (numParams > 0 && numObsEquations > 0) {
        const A = zeros(numObsEquations, numParams);
        const P = zeros(numObsEquations, numObsEquations);
        const L = zeros(numObsEquations, 1);
        const rowInfo: Array<{ obs: Observation; component?: 'E' | 'N' } | null> = [];
        let row = 0;

        activeObservations.forEach((obs) => {
          if (obs.type === 'dist') {
            const s1 = this.stations[obs.from];
            const s2 = this.stations[obs.to];
            if (!s1 || !s2) return;
            const dx = s2.x - s1.x;
            const dy = s2.y - s1.y;
            const dz = (s2.h + (obs.ht ?? 0)) - (s1.h + (obs.hi ?? 0));
            const horiz = Math.sqrt(dx * dx + dy * dy);
            const calcDistRaw = this.is2D
              ? horiz
              : obs.mode === 'slope'
                ? Math.sqrt(horiz * horiz + dz * dz)
                : horiz;
            const mapScale = this.distanceScaleForObservation(obs);
            const calcDist = calcDistRaw * mapScale;
            const v = obs.obs - calcDist;
            L[row][0] = v;
            rowInfo.push({ obs });

            const denom = calcDistRaw || 1;
            const dD_dE2 = (dx / denom) * mapScale;
            const dD_dN2 = (dy / denom) * mapScale;
            const dD_dH2 = !this.is2D && obs.mode === 'slope' ? (dz / denom) * mapScale : 0;

            const fromIdx = this.paramIndex[obs.from];
            if (fromIdx?.x != null) A[row][fromIdx.x] = -dD_dE2;
            if (fromIdx?.y != null) A[row][fromIdx.y] = -dD_dN2;
            if (!this.is2D && fromIdx?.h != null) A[row][fromIdx.h] = -dD_dH2;
            const toIdx = this.paramIndex[obs.to];
            if (toIdx?.x != null) A[row][toIdx.x] = dD_dE2;
            if (toIdx?.y != null) A[row][toIdx.y] = dD_dN2;
            if (!this.is2D && toIdx?.h != null) A[row][toIdx.h] = dD_dH2;

            const sigma = this.effectiveStdDev(obs);
            P[row][row] = 1.0 / (sigma * sigma);
            row += 1;
            return;
          }

          if (obs.type === 'angle') {
            const azTo = this.getAzimuth(obs.at, obs.to);
            const azFrom = this.getAzimuth(obs.at, obs.from);
            let calcAngle = azTo.az - azFrom.az;
            if (calcAngle < 0) calcAngle += 2 * Math.PI;
            let diff = obs.obs - calcAngle;
            diff = this.wrapToPi(diff);
            L[row][0] = diff;
            rowInfo.push({ obs });

            const dAzTo_dE_To = Math.cos(azTo.az) / (azTo.dist || 1);
            const dAzTo_dN_To = -Math.sin(azTo.az) / (azTo.dist || 1);
            const dAzFrom_dE_From = Math.cos(azFrom.az) / (azFrom.dist || 1);
            const dAzFrom_dN_From = -Math.sin(azFrom.az) / (azFrom.dist || 1);

            const toIdx = this.paramIndex[obs.to];
            if (toIdx?.x != null) A[row][toIdx.x] = dAzTo_dE_To;
            if (toIdx?.y != null) A[row][toIdx.y] = dAzTo_dN_To;
            const fromIdx = this.paramIndex[obs.from];
            if (fromIdx?.x != null) A[row][fromIdx.x] = -dAzFrom_dE_From;
            if (fromIdx?.y != null) A[row][fromIdx.y] = -dAzFrom_dN_From;
            const atIdx = this.paramIndex[obs.at];
            if (atIdx?.x != null || atIdx?.y != null) {
              const dAzTo_dE_At = -dAzTo_dE_To;
              const dAzTo_dN_At = -dAzTo_dN_To;
              const dAzFrom_dE_At = -dAzFrom_dE_From;
              const dAzFrom_dN_At = -dAzFrom_dN_From;
              if (atIdx?.x != null) A[row][atIdx.x] = dAzTo_dE_At - dAzFrom_dE_At;
              if (atIdx?.y != null) A[row][atIdx.y] = dAzTo_dN_At - dAzFrom_dN_At;
            }

            const sigma = this.effectiveStdDev(obs);
            P[row][row] = 1.0 / (sigma * sigma);
            row += 1;
            return;
          }

          if (obs.type === 'gps') {
            const s1 = this.stations[obs.from];
            const s2 = this.stations[obs.to];
            if (!s1 || !s2) return;
            const calc_dE = s2.x - s1.x;
            const calc_dN = s2.y - s1.y;
            const vE = obs.obs.dE - calc_dE;
            const vN = obs.obs.dN - calc_dN;
            L[row][0] = vE;
            rowInfo.push({ obs, component: 'E' });
            const fromIdx = this.paramIndex[obs.from];
            const toIdx = this.paramIndex[obs.to];
            if (fromIdx?.x != null) A[row][fromIdx.x] = -1.0;
            if (toIdx?.x != null) A[row][toIdx.x] = 1.0;
            const w = this.gpsWeight(obs);
            P[row][row] = w.wEE;
            P[row][row + 1] = w.wEN;
            P[row + 1][row] = w.wEN;
            P[row + 1][row + 1] = w.wNN;

            L[row + 1][0] = vN;
            rowInfo.push({ obs, component: 'N' });
            if (fromIdx?.y != null) A[row + 1][fromIdx.y] = -1.0;
            if (toIdx?.y != null) A[row + 1][toIdx.y] = 1.0;

            row += 2;
            return;
          }

          if (obs.type === 'lev') {
            const s1 = this.stations[obs.from];
            const s2 = this.stations[obs.to];
            if (!s1 || !s2) return;
            const calc_dH = s2.h - s1.h;
            const v = obs.obs - calc_dH;
            L[row][0] = v;
            rowInfo.push({ obs });
            const fromIdx = this.paramIndex[obs.from];
            const toIdx = this.paramIndex[obs.to];
            if (fromIdx?.h != null) A[row][fromIdx.h] = -1.0;
            if (toIdx?.h != null) A[row][toIdx.h] = 1.0;
            const sigma = this.effectiveStdDev(obs);
            P[row][row] = 1.0 / (sigma * sigma);
            row += 1;
            return;
          }

          if (obs.type === 'bearing') {
            const az = this.getAzimuth(obs.from, obs.to);
            const calc = az.az;
            let v = obs.obs - calc;
            if (v > Math.PI) v -= 2 * Math.PI;
            if (v < -Math.PI) v += 2 * Math.PI;
            L[row][0] = v;
            rowInfo.push({ obs });

            const dAz_dE_To = Math.cos(calc) / (az.dist || 1);
            const dAz_dN_To = -Math.sin(calc) / (az.dist || 1);
            const toIdx = this.paramIndex[obs.to];
            const fromIdx = this.paramIndex[obs.from];
            if (toIdx?.x != null) A[row][toIdx.x] = dAz_dE_To;
            if (toIdx?.y != null) A[row][toIdx.y] = dAz_dN_To;
            if (fromIdx?.x != null) A[row][fromIdx.x] = -dAz_dE_To;
            if (fromIdx?.y != null) A[row][fromIdx.y] = -dAz_dN_To;

            const sigma = this.effectiveStdDev(obs);
            P[row][row] = 1.0 / (sigma * sigma);
            row += 1;
            return;
          }

          if (obs.type === 'dir') {
            const az = this.getAzimuth(obs.from, obs.to);
            const calc = az.az;
            let v0 = obs.obs - calc;
            if (v0 > Math.PI) v0 -= 2 * Math.PI;
            if (v0 < -Math.PI) v0 += 2 * Math.PI;
            let v = v0;
            if (obs.flip180) {
              let v1 = obs.obs + Math.PI - calc;
              if (v1 > Math.PI) v1 -= 2 * Math.PI;
              if (v1 < -Math.PI) v1 += 2 * Math.PI;
              if (Math.abs(v1) < Math.abs(v0)) v = v1;
            }
            L[row][0] = v;
            rowInfo.push({ obs });

            const dAz_dE_To = Math.cos(calc) / (az.dist || 1);
            const dAz_dN_To = -Math.sin(calc) / (az.dist || 1);
            const toIdx = this.paramIndex[obs.to];
            const fromIdx = this.paramIndex[obs.from];
            if (toIdx?.x != null) A[row][toIdx.x] = dAz_dE_To;
            if (toIdx?.y != null) A[row][toIdx.y] = dAz_dN_To;
            if (fromIdx?.x != null) A[row][fromIdx.x] = -dAz_dE_To;
            if (fromIdx?.y != null) A[row][fromIdx.y] = -dAz_dN_To;

            const sigma = this.effectiveStdDev(obs);
            P[row][row] = 1.0 / (sigma * sigma);
            row += 1;
            return;
          }

          if (obs.type === 'direction') {
            const dir = obs as any;
            const az = this.getAzimuth(dir.at, dir.to);
            const orientation = this.directionOrientations[dir.setId] ?? 0;
            let calc = orientation + az.az;
            calc %= 2 * Math.PI;
            if (calc < 0) calc += 2 * Math.PI;
            let v = dir.obs - calc;
            if (v > Math.PI) v -= 2 * Math.PI;
            if (v < -Math.PI) v += 2 * Math.PI;
            L[row][0] = v;
            rowInfo.push({ obs });

            const dAz_dE_To = Math.cos(az.az) / (az.dist || 1);
            const dAz_dN_To = -Math.sin(az.az) / (az.dist || 1);
            const toIdx = this.paramIndex[dir.to];
            const atIdx = this.paramIndex[dir.at];
            if (toIdx?.x != null) A[row][toIdx.x] = dAz_dE_To;
            if (toIdx?.y != null) A[row][toIdx.y] = dAz_dN_To;
            if (atIdx?.x != null) A[row][atIdx.x] = -dAz_dE_To;
            if (atIdx?.y != null) A[row][atIdx.y] = -dAz_dN_To;

            const dirIdx = dirParamMap[dir.setId];
            if (dirIdx != null) A[row][dirIdx] = 1;

            const sigma = this.effectiveStdDev(dir);
            P[row][row] = 1.0 / (sigma * sigma);
            row += 1;
            return;
          }

          if (obs.type === 'zenith') {
            const zv = this.getZenith(obs.from, obs.to, obs.hi ?? 0, obs.ht ?? 0);
            const calc = zv.z;
            let v = obs.obs - calc;
            if (v > Math.PI) v -= 2 * Math.PI;
            if (v < -Math.PI) v += 2 * Math.PI;
            L[row][0] = v;
            rowInfo.push({ obs });

            const denom = Math.sqrt(Math.max(1 - (zv.dist === 0 ? 0 : (zv.dh / zv.dist) ** 2), 1e-12));
            const common = zv.dist === 0 ? 0 : 1 / (zv.dist * zv.dist * zv.dist * denom);
            const dx = this.stations[obs.to].x - this.stations[obs.from].x;
            const dy = this.stations[obs.to].y - this.stations[obs.from].y;
            const dZ_dEGeom = zv.dh * dx * common;
            const dZ_dNGeom = zv.dh * dy * common;
            const dC_dHoriz = this.curvatureRefractionAngle(1);
            const dHoriz_dE = zv.horiz > 0 ? dx / zv.horiz : 0;
            const dHoriz_dN = zv.horiz > 0 ? dy / zv.horiz : 0;
            const dZ_dE = dZ_dEGeom + dC_dHoriz * dHoriz_dE;
            const dZ_dN = dZ_dNGeom + dC_dHoriz * dHoriz_dN;
            const dZ_dH = -(zv.horiz * zv.horiz) * common;

            const toIdx = this.paramIndex[obs.to];
            const fromIdx = this.paramIndex[obs.from];
            if (toIdx?.x != null) A[row][toIdx.x] = dZ_dE;
            if (toIdx?.y != null) A[row][toIdx.y] = dZ_dN;
            if (toIdx?.h != null) A[row][toIdx.h] = dZ_dH;
            if (fromIdx?.x != null) A[row][fromIdx.x] = -dZ_dE;
            if (fromIdx?.y != null) A[row][fromIdx.y] = -dZ_dN;
            if (fromIdx?.h != null) A[row][fromIdx.h] = -dZ_dH;

            const sigma = this.effectiveStdDev(obs);
            P[row][row] = 1.0 / (sigma * sigma);
            row += 1;
          }
        });

        constraints.forEach((constraint) => {
          const st = this.stations[constraint.stationId];
          if (!st) return;
          const current =
            constraint.component === 'x'
              ? st.x
              : constraint.component === 'y'
                ? st.y
                : st.h;
          L[row][0] = constraint.target - current;
          A[row][constraint.index] = 1;
          P[row][row] = 1.0 / (constraint.sigma * constraint.sigma);
          rowInfo.push(null);
          row += 1;
        });

        try {
          const AT = transpose(A);
          const N = multiply(multiply(AT, P), A);
          const QxxStats = inv(N);
          const B = multiply(A, QxxStats);
          const rowStats = new Map<
            number,
            { t: number[]; r: number[]; mdb: number[]; pass: boolean[]; comps: ('E' | 'N' | undefined)[] }
          >();
          const s0 = this.seuw || 1;
          for (let i = 0; i < numObsEquations; i += 1) {
            const info = rowInfo[i];
            if (!info) continue;
            let qll = P[i][i] > 0 ? 1 / P[i][i] : 0;
            if (info.obs.type === 'gps') {
              const cov = this.gpsCovariance(info.obs);
              qll = info.component === 'N' ? cov.cNN : cov.cEE;
            }
            let diag = 0;
            for (let j = 0; j < numParams; j += 1) {
              diag += B[i][j] * A[i][j];
            }
            const qvv = Math.max(qll - diag, 1e-20);
            const t = L[i][0] / (s0 * Math.sqrt(qvv));
            const r = qll > 0 ? qvv / qll : 0;
            const pass = Math.abs(t) <= this.localTestCritical;
            const sigma = Math.sqrt(Math.max(qll, 0));
            const mdb =
              r > 1e-12
                ? (this.localTestCritical * s0 * sigma) / Math.sqrt(r)
                : Number.POSITIVE_INFINITY;
            const entry = rowStats.get(info.obs.id) ?? {
              t: [],
              r: [],
              mdb: [],
              pass: [],
              comps: [],
            };
            entry.t.push(t);
            entry.r.push(r);
            entry.mdb.push(mdb);
            entry.pass.push(pass);
            entry.comps.push(info.component);
            rowStats.set(info.obs.id, entry);
          }

          activeObservations.forEach((obs) => {
            const entry = rowStats.get(obs.id);
            if (!entry) return;
            if (entry.t.length === 2 && entry.comps.includes('E') && entry.comps.includes('N')) {
              const idxE = entry.comps.indexOf('E');
              const idxN = entry.comps.indexOf('N');
              const tE = entry.t[idxE];
              const tN = entry.t[idxN];
              const rE = entry.r[idxE];
              const rN = entry.r[idxN];
              const mE = entry.mdb[idxE];
              const mN = entry.mdb[idxN];
              const passE = entry.pass[idxE];
              const passN = entry.pass[idxN];
              obs.stdResComponents = { tE, tN };
              obs.stdRes = Math.max(Math.abs(tE), Math.abs(tN));
              obs.redundancy = { rE, rN };
              obs.localTest = { critical: this.localTestCritical, pass: passE && passN };
              obs.localTestComponents = { passE, passN };
              obs.mdbComponents = { mE, mN };
            } else {
              obs.stdRes = Math.abs(entry.t[0]);
              obs.redundancy = entry.r[0];
              obs.localTest = { critical: this.localTestCritical, pass: entry.pass[0] };
              obs.mdb = entry.mdb[0];
            }
          });
        } catch {
          this.log('Warning: Standardized residuals not computed (Qvv inversion failed).');
        }
      }
    }

    // Flag very large standardized residuals
    const flagged = this.observations.filter((o) => Math.abs(o.stdRes || 0) > this.maxStdRes);
    if (flagged.length) {
      this.log(
        `Warning: ${flagged.length} obs exceed ${this.maxStdRes} sigma (consider excluding/reweighting).`,
      );
    }
    const localFailed = this.observations.filter(
      (o) => this.isObservationActive(o) && o.localTest != null && !o.localTest.pass,
    );
    if (localFailed.length) {
      this.log(
        `Local test: ${localFailed.length} observation(s) exceed critical |t|>${this.localTestCritical.toFixed(
          2,
        )}.`,
      );
    }

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
      const entry =
        summary[type] ??
        ({ count: 0, sumSq: 0, maxAbs: 0, maxStdRes: 0, over3: 0, over4: 0, unit } as const);
      entry.count += 1;
      entry.sumSq += value * value;
      entry.maxAbs = Math.max(entry.maxAbs, Math.abs(value));
      entry.maxStdRes = Math.max(entry.maxStdRes, Math.abs(stdRes));
      if (Math.abs(stdRes) > 3) entry.over3 += 1;
      if (Math.abs(stdRes) > 4) entry.over4 += 1;
      summary[type] = entry as any;
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
        const arcsec = (obs.residual as number) * RAD_TO_DEG * 3600;
        addSummary(obs.type, arcsec, stdRes, 'arcsec');
      } else if (obs.type === 'dist' || obs.type === 'lev') {
        addSummary(obs.type, obs.residual as number, stdRes, 'm');
      } else if (obs.type === 'gps') {
        const v = obs.residual as { vE: number; vN: number };
        const mag = Math.hypot(v.vE, v.vN);
        addSummary(obs.type, mag, stdRes, 'm');
      }
    });
    const typeSummary: AdjustmentResult['typeSummary'] = {};
    Object.entries(summary).forEach(([type, entry]) => {
      const rms = entry.count ? Math.sqrt(entry.sumSq / entry.count) : 0;
      typeSummary[type] = {
        count: entry.count,
        rms,
        maxAbs: entry.maxAbs,
        maxStdRes: entry.maxStdRes,
        over3: entry.over3,
        over4: entry.over4,
        unit: entry.unit,
      };
    });
    this.typeSummary = typeSummary;

    if (hasQxx && this.Qxx) {
      const s0_sq = this.seuw * this.seuw;
      this.unknowns.forEach((id) => {
        const idx = paramIndex[id];
        if (!idx) return;
        if (idx.x == null || idx.y == null) return;
        if (!this.Qxx?.[idx.x] || !this.Qxx?.[idx.y]) return;
        const qxx = this.Qxx[idx.x][idx.x];
        const qyy = this.Qxx[idx.y][idx.y];
        const qxy = this.Qxx[idx.x][idx.y];

        const sx2 = qxx * s0_sq;
        const sy2 = qyy * s0_sq;
        const sxy = qxy * s0_sq;

        const term1 = (sx2 + sy2) / 2;
        const term2 = Math.sqrt(((sx2 - sy2) / 2) ** 2 + sxy * sxy);
        const semiMajor = Math.sqrt(Math.abs(term1 + term2));
        const semiMinor = Math.sqrt(Math.abs(term1 - term2));
        const theta = 0.5 * Math.atan2(2 * sxy, sx2 - sy2);

        this.stations[id].errorEllipse = {
          semiMajor,
          semiMinor,
          theta: theta * RAD_TO_DEG,
        };
        this.stations[id].sE = Math.sqrt(Math.abs(sx2));
        this.stations[id].sN = Math.sqrt(Math.abs(sy2));

        if (!this.is2D && idx.h != null) {
          const qhh = this.Qxx[idx.h][idx.h] * s0_sq;
          this.stations[id].sH = Math.sqrt(Math.abs(qhh));
        }
      });

      const cov = (a?: number, b?: number): number => {
        if (a == null || b == null) return 0;
        if (!this.Qxx?.[a] || this.Qxx?.[a][b] == null) return 0;
        return this.Qxx[a][b] * s0_sq;
      };

      const relative: NonNullable<AdjustmentResult['relativePrecision']> = [];
      for (let i = 0; i < this.unknowns.length; i += 1) {
        for (let j = i + 1; j < this.unknowns.length; j += 1) {
          const from = this.unknowns[i];
          const to = this.unknowns[j];
          const idxFrom = paramIndex[from];
          const idxTo = paramIndex[to];
          if (!idxFrom && !idxTo) continue;

          const dE = this.stations[to].x - this.stations[from].x;
          const dN = this.stations[to].y - this.stations[from].y;
          const dist = Math.hypot(dE, dN);

          const varE =
            cov(idxTo?.x, idxTo?.x) +
            cov(idxFrom?.x, idxFrom?.x) -
            2 * cov(idxFrom?.x, idxTo?.x);
          const varN =
            cov(idxTo?.y, idxTo?.y) +
            cov(idxFrom?.y, idxFrom?.y) -
            2 * cov(idxFrom?.y, idxTo?.y);
          const covNE =
            cov(idxTo?.y, idxTo?.x) +
            cov(idxFrom?.y, idxFrom?.x) -
            cov(idxFrom?.y, idxTo?.x) -
            cov(idxTo?.y, idxFrom?.x);

          const term1 = (varE + varN) / 2;
          const term2 = Math.sqrt(((varE - varN) / 2) ** 2 + covNE * covNE);
          const semiMajor = Math.sqrt(Math.abs(term1 + term2));
          const semiMinor = Math.sqrt(Math.abs(term1 - term2));
          const theta = 0.5 * Math.atan2(2 * covNE, varE - varN);

          let sigmaDist: number | undefined;
          let sigmaAz: number | undefined;
          if (dist > 0) {
            const inv = 1 / (dist * dist);
            const varDist =
              inv * (dE * dE * varE + dN * dN * varN + 2 * dE * dN * covNE);
            sigmaDist = Math.sqrt(Math.abs(varDist));
            const varAz =
              (dN * dN * varE + dE * dE * varN - 2 * dE * dN * covNE) * inv * inv;
            sigmaAz = Math.sqrt(Math.abs(varAz));
          }

          relative.push({
            from,
            to,
            sigmaN: Math.sqrt(Math.abs(varN)),
            sigmaE: Math.sqrt(Math.abs(varE)),
            sigmaDist,
            sigmaAz,
            ellipse: { semiMajor, semiMinor, theta: theta * RAD_TO_DEG },
          });
        }
      }
      this.relativePrecision = relative;
    }

    this.sideshots = this.computeSideshotResults();
    if (this.sideshots.length) {
      this.log(`Sideshots (post-adjust): ${this.sideshots.length}`);
    }

    if (directionStats.size > 0) {
      const summaries = Array.from(directionStats.entries()).sort((a, b) => a[0].localeCompare(b[0]));
      this.directionSetDiagnostics = summaries.map(([setId, stat]) => {
        const mean = stat.sum / Math.max(stat.count, 1);
        const rms = Math.sqrt(stat.sumSq / Math.max(stat.count, 1));
        const orientDeg = ((stat.orientation * RAD_TO_DEG) % 360 + 360) % 360;
        const orientationSeArcSec = stat.count > 0 ? rms / Math.sqrt(stat.count) : undefined;
        return {
          setId,
          occupy: stat.occupy,
          rawCount: stat.rawCount,
          reducedCount: stat.reducedCount,
          face1Count: stat.face1Count,
          face2Count: stat.face2Count,
          pairedTargets: stat.pairedTargets,
          orientationDeg: orientDeg,
          residualMeanArcSec: mean,
          residualRmsArcSec: rms,
          residualMaxArcSec: stat.maxAbs,
          orientationSeArcSec,
        };
      });

      this.logs.push('Direction set summary (arcsec residuals):');
      this.directionSetDiagnostics.forEach((stat) => {
        this.logs.push(
          `  ${stat.setId} @ ${stat.occupy}: raw=${stat.rawCount}, reduced=${stat.reducedCount}, pairs=${stat.pairedTargets}, F1=${stat.face1Count}, F2=${stat.face2Count}, mean=${(stat.residualMeanArcSec ?? 0).toFixed(2)}", rms=${(stat.residualRmsArcSec ?? 0).toFixed(2)}", max=${(stat.residualMaxArcSec ?? 0).toFixed(2)}", orient=${(stat.orientationDeg ?? 0).toFixed(4)}°, orientSE=${(stat.orientationSeArcSec ?? 0).toFixed(2)}"`,
        );
      });
    }

    {
      const directionTargets = activeObservations
        .filter((obs): obs is DirectionObservation => obs.type === 'direction')
        .map((dir) => {
          const rawCount = typeof dir.rawCount === 'number' && dir.rawCount > 0 ? dir.rawCount : 1;
          const face1Count =
            typeof dir.rawFace1Count === 'number'
              ? dir.rawFace1Count
              : dir.obs >= Math.PI
                ? 0
                : rawCount;
          const face2Count =
            typeof dir.rawFace2Count === 'number'
              ? dir.rawFace2Count
              : Math.max(0, rawCount - face1Count);
          const faceBalanced = rawCount <= 1 ? true : Math.abs(face1Count - face2Count) <= 1;
          const rawSpreadArcSec =
            typeof dir.rawSpread === 'number'
              ? Math.abs(dir.rawSpread) * RAD_TO_DEG * 3600
              : undefined;
          const reducedSigmaArcSec =
            typeof dir.reducedSigma === 'number'
              ? Math.abs(dir.reducedSigma) * RAD_TO_DEG * 3600
              : Math.abs(dir.stdDev) * RAD_TO_DEG * 3600;
          const residualArcSec =
            typeof dir.residual === 'number' ? dir.residual * RAD_TO_DEG * 3600 : undefined;
          const stdResAbs = Number.isFinite(dir.stdRes) ? Math.abs(dir.stdRes ?? 0) : undefined;
          const localPass = dir.localTest?.pass;
          const mdbArcSec = dir.mdb != null ? dir.mdb * RAD_TO_DEG * 3600 : undefined;

          let suspectScore = 0;
          if (localPass === false) suspectScore += 100;
          suspectScore += (stdResAbs ?? 0) * 10;
          suspectScore += Math.min((rawSpreadArcSec ?? 0) / 2, 50);
          if (!faceBalanced) suspectScore += 8;
          if (rawCount < 2) suspectScore += 4;

          return {
            setId: String(dir.setId ?? ''),
            occupy: dir.at,
            target: dir.to,
            sourceLine: dir.sourceLine,
            rawCount,
            face1Count,
            face2Count,
            faceBalanced,
            rawSpreadArcSec,
            reducedSigmaArcSec,
            residualArcSec,
            stdRes: stdResAbs,
            localPass,
            mdbArcSec,
            suspectScore,
          };
        })
        .sort((a, b) => {
          if (b.suspectScore !== a.suspectScore) return b.suspectScore - a.suspectScore;
          const bStd = b.stdRes ?? 0;
          const aStd = a.stdRes ?? 0;
          if (bStd !== aStd) return bStd - aStd;
          const bSpread = b.rawSpreadArcSec ?? 0;
          const aSpread = a.rawSpreadArcSec ?? 0;
          if (bSpread !== aSpread) return bSpread - aSpread;
          const setCmp = a.setId.localeCompare(b.setId);
          if (setCmp !== 0) return setCmp;
          return a.target.localeCompare(b.target);
        });

      if (directionTargets.length > 0) {
        this.directionTargetDiagnostics = directionTargets;
        this.logs.push('Direction target repeatability (top suspects):');
        directionTargets.slice(0, 8).forEach((d) => {
          this.logs.push(
            `  ${d.setId} ${d.occupy}->${d.target}: raw=${d.rawCount}, F1=${d.face1Count}, F2=${d.face2Count}, spread=${d.rawSpreadArcSec != null ? `${d.rawSpreadArcSec.toFixed(2)}"` : '-'}, stdRes=${d.stdRes != null ? d.stdRes.toFixed(2) : '-'}, local=${d.localPass == null ? '-' : d.localPass ? 'PASS' : 'FAIL'}, score=${d.suspectScore.toFixed(1)}`,
          );
        });
      }
    }

    {
      const setupMap = new Map<
        StationId,
        {
          station: StationId;
          directionSetIds: Set<string>;
          directionObsCount: number;
          angleObsCount: number;
          distanceObsCount: number;
          bearingObsCount: number;
          zenithObsCount: number;
          levelingObsCount: number;
          gpsObsCount: number;
          traverseDistance: number;
          orientationRmsSum: number;
          orientationSeSum: number;
          orientationCount: number;
          stdResCount: number;
          stdResSumSq: number;
          stdResMaxAbs: number;
          localFailCount: number;
          worstObsType?: string;
          worstObsStations?: string;
          worstObsLine?: number;
        }
      >();
      const obsSetupStation = (obs: Observation): StationId | undefined => {
        if (obs.type === 'direction' || obs.type === 'angle') return obs.at;
        if (
          obs.type === 'dist' ||
          obs.type === 'bearing' ||
          obs.type === 'zenith' ||
          obs.type === 'lev' ||
          obs.type === 'gps' ||
          obs.type === 'dir'
        ) {
          return obs.from;
        }
        return undefined;
      };
      const obsStationsLabel = (obs: Observation): string => {
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
      const ensureSetup = (station: StationId) => {
        const existing = setupMap.get(station);
        if (existing) return existing;
        const created = {
          station,
          directionSetIds: new Set<string>(),
          directionObsCount: 0,
          angleObsCount: 0,
          distanceObsCount: 0,
          bearingObsCount: 0,
          zenithObsCount: 0,
          levelingObsCount: 0,
          gpsObsCount: 0,
          traverseDistance: 0,
          orientationRmsSum: 0,
          orientationSeSum: 0,
          orientationCount: 0,
          stdResCount: 0,
          stdResSumSq: 0,
          stdResMaxAbs: 0,
          localFailCount: 0,
          worstObsType: undefined,
          worstObsStations: undefined,
          worstObsLine: undefined,
        };
        setupMap.set(station, created);
        return created;
      };
      activeObservations.forEach((obs) => {
        const setupId = obsSetupStation(obs);
        if (!setupId) return;
        const setup = ensureSetup(setupId);
        if (obs.type === 'direction') {
          setup.directionObsCount += 1;
          setup.directionSetIds.add(String((obs as any).setId));
        } else if (obs.type === 'angle') {
          setup.angleObsCount += 1;
        } else if (obs.type === 'dir') {
          setup.directionObsCount += 1;
        } else if (obs.type === 'dist') {
          setup.distanceObsCount += 1;
          const setTag = String((obs as any).setId ?? '').toUpperCase();
          if (setTag === 'T' || setTag === 'TE') {
            setup.traverseDistance += Math.abs(obs.obs);
          }
        } else if (obs.type === 'bearing') {
          setup.bearingObsCount += 1;
        } else if (obs.type === 'zenith') {
          setup.zenithObsCount += 1;
        } else if (obs.type === 'lev') {
          setup.levelingObsCount += 1;
        } else if (obs.type === 'gps') {
          setup.gpsObsCount += 1;
        }

        const absStdRes = Number.isFinite(obs.stdRes) ? Math.abs(obs.stdRes) : undefined;
        if (absStdRes != null) {
          setup.stdResCount += 1;
          setup.stdResSumSq += absStdRes * absStdRes;
          if (absStdRes > setup.stdResMaxAbs) {
            setup.stdResMaxAbs = absStdRes;
            setup.worstObsType = obs.type;
            setup.worstObsStations = obsStationsLabel(obs);
            setup.worstObsLine = obs.sourceLine;
          }
        }

        const localComp = obs.localTestComponents;
        if (localComp) {
          if (!localComp.passE) setup.localFailCount += 1;
          if (!localComp.passN) setup.localFailCount += 1;
        } else if (obs.localTest && !obs.localTest.pass) {
          setup.localFailCount += 1;
        }
      });
      (this.directionSetDiagnostics ?? []).forEach((d) => {
        const setup = ensureSetup(d.occupy);
        if (d.residualRmsArcSec != null) setup.orientationRmsSum += d.residualRmsArcSec;
        if (d.orientationSeArcSec != null) setup.orientationSeSum += d.orientationSeArcSec;
        setup.orientationCount += 1;
      });

      if (setupMap.size > 0) {
        this.setupDiagnostics = Array.from(setupMap.values())
          .map((s) => ({
            station: s.station,
            directionSetCount: s.directionSetIds.size,
            directionObsCount: s.directionObsCount,
            angleObsCount: s.angleObsCount,
            distanceObsCount: s.distanceObsCount,
            bearingObsCount: s.bearingObsCount,
            zenithObsCount: s.zenithObsCount,
            levelingObsCount: s.levelingObsCount,
            gpsObsCount: s.gpsObsCount,
            traverseDistance: s.traverseDistance,
            orientationRmsArcSec:
              s.orientationCount > 0 ? s.orientationRmsSum / s.orientationCount : undefined,
            orientationSeArcSec:
              s.orientationCount > 0 ? s.orientationSeSum / s.orientationCount : undefined,
            stdResCount: s.stdResCount,
            rmsStdRes: s.stdResCount > 0 ? Math.sqrt(s.stdResSumSq / s.stdResCount) : undefined,
            maxStdRes: s.stdResCount > 0 ? s.stdResMaxAbs : undefined,
            localFailCount: s.localFailCount,
            worstObsType: s.worstObsType,
            worstObsStations: s.worstObsStations,
            worstObsLine: s.worstObsLine,
          }))
          .sort((a, b) => a.station.localeCompare(b.station));
        this.logs.push('Setup summary:');
        this.setupDiagnostics.forEach((s) => {
          this.logs.push(
            `  ${s.station}: dirSets=${s.directionSetCount}, dirObs=${s.directionObsCount}, ang=${s.angleObsCount}, dist=${s.distanceObsCount}, zen=${s.zenithObsCount}, lev=${s.levelingObsCount}, gps=${s.gpsObsCount}, travDist=${s.traverseDistance.toFixed(3)}m, orientRMS=${s.orientationRmsArcSec != null ? `${s.orientationRmsArcSec.toFixed(2)}"` : '-'}, orientSE=${s.orientationSeArcSec != null ? `${s.orientationSeArcSec.toFixed(2)}"` : '-'}, rms|t|=${s.rmsStdRes != null ? s.rmsStdRes.toFixed(2) : '-'}, max|t|=${s.maxStdRes != null ? s.maxStdRes.toFixed(2) : '-'}, localFail=${s.localFailCount}`,
          );
        });
      }
    }

    if (closureResiduals.length) {
      this.logs.push(...closureResiduals);
      const netE = closureVectors.reduce((acc, v) => acc + v.dE, 0);
      const netN = closureVectors.reduce((acc, v) => acc + v.dN, 0);
      if (closureVectors.length) {
        const mag = Math.hypot(netE, netN);
        this.traverseDiagnostics = {
          closureCount: closureVectors.length,
          misclosureE: netE,
          misclosureN: netN,
          misclosureMag: mag,
          totalTraverseDistance,
          closureRatio: mag > 1e-12 ? totalTraverseDistance / mag : undefined,
        };
        this.logs.push(
          `Traverse misclosure vector: dE=${netE.toFixed(4)} m, dN=${netN.toFixed(4)} m, Mag=${mag.toFixed(4)} m`,
        );
        if (totalTraverseDistance > 0) {
          this.logs.push(`Traverse distance sum: ${totalTraverseDistance.toFixed(4)} m`);
        }
        if (this.traverseDiagnostics.closureRatio != null) {
          this.logs.push(`Traverse closure ratio: 1:${this.traverseDiagnostics.closureRatio.toFixed(0)}`);
        }
      }
      Object.entries(loopVectors).forEach(([k, v]) => {
        const mag = Math.hypot(v.dE, v.dN);
        this.logs.push(`Closure loop ${k}: dE=${v.dE.toFixed(4)} m, dN=${v.dN.toFixed(4)} m, Mag=${mag.toFixed(4)} m`);
      });
      if (coordClosureVectors.length) {
        coordClosureVectors.forEach((v) => {
          const mag = Math.hypot(v.dE, v.dN);
          this.logs.push(
            `Closure geometry ${v.from}-${v.to}: dE=${v.dE.toFixed(4)} m, dN=${v.dN.toFixed(4)} m, Mag=${mag.toFixed(4)} m`,
          );
        });
      }
    } else if (hasClosureObs) {
      this.traverseDiagnostics = {
        closureCount: 0,
        misclosureE: 0,
        misclosureN: 0,
        misclosureMag: 0,
        totalTraverseDistance,
        closureRatio: undefined,
      };
      this.logs.push('Traverse closure residual not computed (insufficient closure geometry).');
      if (totalTraverseDistance > 0) {
        this.logs.push(`Traverse distance sum: ${totalTraverseDistance.toFixed(4)} m`);
      }
    }
  }

  private buildResult(): AdjustmentResult {
    if (!this.sideshots) {
      this.sideshots = this.computeSideshotResults();
    }
    return {
      success: this.converged,
      converged: this.converged,
      iterations: this.iterations,
      stations: this.stations,
      observations: this.observations,
      logs: this.logs,
      seuw: this.seuw,
      dof: this.dof,
      condition: this.condition,
      controlConstraints: this.controlConstraints,
      chiSquare: this.chiSquare,
      typeSummary: this.typeSummary,
      relativePrecision: this.relativePrecision,
      directionSetDiagnostics: this.directionSetDiagnostics,
      directionTargetDiagnostics: this.directionTargetDiagnostics,
      setupDiagnostics: this.setupDiagnostics,
      traverseDiagnostics: this.traverseDiagnostics,
      sideshots: this.sideshots,
    };
  }
}
