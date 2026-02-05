import { RAD_TO_DEG, DEG_TO_RAD } from './angles';
import { inv, multiply, transpose, zeros } from './matrix';
import { parseInput } from './parse';
import type {
  AdjustmentResult,
  Observation,
  Station,
  StationId,
  StationMap,
  InstrumentLibrary,
  Instrument,
  ObservationOverride,
  ParseOptions,
} from '../types';

interface EngineOptions {
  input: string;
  maxIterations?: number;
  instrumentLibrary?: InstrumentLibrary;
  convergenceThreshold?: number;
  excludeIds?: Set<number>;
  overrides?: Record<number, ObservationOverride>;
  parseOptions?: Partial<ParseOptions>;
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
  private parseOptions?: Partial<ParseOptions>;
  private coordMode: ParseOptions['coordMode'] = '3D';
  private is2D = false;
  private directionOrientations: Record<string, number> = {};
  private paramIndex: Record<StationId, { x?: number; y?: number; h?: number }> = {};
  private addCenteringToExplicit = false;
  private applyCentering = true;
  private debug = false;

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

  private getZenith(fromID: StationId, toID: StationId, hi = 0, ht = 0): { z: number; dist: number; horiz: number; dh: number } {
    const s1 = this.stations[fromID];
    const s2 = this.stations[toID];
    if (!s1 || !s2) return { z: 0, dist: 0, horiz: 0, dh: 0 };
    const dx = s2.x - s1.x;
    const dy = s2.y - s1.y;
    const dh = (s2.h + ht) - (s1.h + hi);
    const horiz = Math.sqrt(dx * dx + dy * dy);
    const dist = Math.sqrt(horiz * horiz + dh * dh);
    const z = dist === 0 ? 0 : Math.acos(dh / dist);
    return { z, dist, horiz, dh };
  }

  private isObservationActive(obs: Observation): boolean {
    if (this.excludeIds?.has(obs.id)) return false;
    if (typeof obs.calc === 'object' && (obs.calc as any)?.sideshot) return false;
    if (this.is2D && (obs.type === 'lev' || obs.type === 'zenith')) return false;
    return true;
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
    this.is2D = this.coordMode === '2D';

    // Apply overrides before any unit normalization
    if (this.overrides) {
      this.observations.forEach((obs) => {
        const over = this.overrides?.[obs.id];
        if (!over) return;
        if (over.stdDev != null) {
          obs.stdDev = over.stdDev;
        }
        if (over.obs != null) {
          if ((obs.type === 'angle' || obs.type === 'direction') && typeof over.obs === 'number') {
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
      return this.buildResult();
    }

    const activeObservations = this.observations.filter((obs) => this.isObservationActive(obs));
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
    const numParams = stationParamCount + directionSetIds.length; // X, Y (+H) + dir orientations
    const numObsEquations = activeObservations.reduce(
      (acc, o) => acc + (o.type === 'gps' ? 2 : 1),
      0,
    );

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
          const calcDist = this.is2D
            ? horiz
            : obs.mode === 'slope'
              ? Math.sqrt(horiz * horiz + dz * dz)
              : horiz;
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
          const denom = calcDist || 1;
          const dD_dE2 = dx / denom;
          const dD_dN2 = dy / denom;
          const dD_dH2 = !this.is2D && obs.mode === 'slope' ? dz / denom : 0;

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
            const sigma = this.effectiveStdDev(obs);
            P[row][row] = 1.0 / (sigma * sigma);
          }

          L[row + 1][0] = vN;
          if (fromIdx?.y != null) {
            A[row + 1][fromIdx.y] = -1.0;
          }
          if (toIdx?.y != null) {
            A[row + 1][toIdx.y] = 1.0;
          }
          {
            const sigma = this.effectiveStdDev(obs);
            P[row + 1][row + 1] = 1.0 / (sigma * sigma);
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
              )}°/${wRad.toFixed(8)}rad norm=${norm.toFixed(3)} sigma=${sigmaUsed.toFixed(8)}rad`,
            );
          }

          const denom = Math.sqrt(Math.max(1 - (zv.dist === 0 ? 0 : (zv.dh / zv.dist) ** 2), 1e-12));
          const common = zv.dist === 0 ? 0 : 1 / (zv.dist * zv.dist * zv.dist * denom);
          const dZ_dE = zv.dh * (this.stations[to].x - this.stations[from].x) * common;
          const dZ_dN = zv.dh * (this.stations[to].y - this.stations[from].y) * common;
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

      try {
        const AT = transpose(A);
        const ATP = multiply(AT, P);
        const N = multiply(ATP, A);
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
    const directionStats = new Map<
      string,
      { count: number; sum: number; sumSq: number; maxAbs: number; occupy: StationId; orientation: number }
    >();

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
        const calc = this.is2D
          ? horiz
          : obs.mode === 'slope'
            ? Math.sqrt(horiz * horiz + dz * dz)
            : horiz;
        const v = obs.obs - calc;
        obs.calc = calc;
        obs.residual = v;
        const sigma = this.effectiveStdDev(obs);
        obs.stdRes = Math.abs(v) / sigma;
        vtpv += (v * v) / (sigma * sigma);
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
        const vMag = Math.sqrt(vE * vE + vN * vN);
        const sigma = this.effectiveStdDev(obs);
        obs.stdRes = vMag / sigma;
        vtpv += (vE * vE + vN * vN) / (sigma * sigma);
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
          sum: 0,
          sumSq: 0,
          maxAbs: 0,
          occupy: dir.at,
          orientation,
        };
        const arcsec = v * RAD_TO_DEG * 3600;
        stat.count += 1;
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

    this.seuw = this.dof > 0 ? Math.sqrt(vtpv / this.dof) : 0;

    // Flag very large standardized residuals
    const flagged = this.observations.filter((o) => Math.abs(o.stdRes || 0) > this.maxStdRes);
    if (flagged.length) {
      this.log(
        `Warning: ${flagged.length} obs exceed ${this.maxStdRes} sigma (consider excluding/reweighting).`,
      );
    }

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

        if (!this.is2D && idx.h != null) {
          const qhh = this.Qxx[idx.h][idx.h] * s0_sq;
          this.stations[id].sH = Math.sqrt(Math.abs(qhh));
        }
      });
    }

    if (directionStats.size > 0) {
      const summaries = Array.from(directionStats.entries()).sort((a, b) => a[0].localeCompare(b[0]));
      this.logs.push('Direction set summary (arcsec residuals):');
      summaries.forEach(([setId, stat]) => {
        const mean = stat.sum / stat.count;
        const rms = Math.sqrt(stat.sumSq / stat.count);
        const orientDeg = (stat.orientation * RAD_TO_DEG) % 360;
        const orientStr = orientDeg < 0 ? orientDeg + 360 : orientDeg;
        this.logs.push(
          `  ${setId} @ ${stat.occupy}: n=${stat.count}, mean=${mean.toFixed(2)}", rms=${rms.toFixed(2)}", max=${stat.maxAbs.toFixed(2)}", orient=${orientStr.toFixed(4)}°`,
        );
      });
    }

    if (closureResiduals.length) {
      this.logs.push(...closureResiduals);
      const netE = closureVectors.reduce((acc, v) => acc + v.dE, 0);
      const netN = closureVectors.reduce((acc, v) => acc + v.dN, 0);
      if (closureVectors.length) {
        const mag = Math.hypot(netE, netN);
        this.logs.push(
          `Traverse misclosure vector: dE=${netE.toFixed(4)} m, dN=${netN.toFixed(4)} m, Mag=${mag.toFixed(4)} m`,
        );
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
      this.logs.push('Traverse closure residual not computed (insufficient closure geometry).');
    }
  }

  private buildResult(): AdjustmentResult {
    return {
      success: this.converged,
      converged: this.converged,
      iterations: this.iterations,
      stations: this.stations,
      observations: this.observations,
      logs: this.logs,
      seuw: this.seuw,
      dof: this.dof,
    };
  }
}
