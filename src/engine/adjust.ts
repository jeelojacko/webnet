import { RAD_TO_DEG } from './angles';
import { inv, multiply, transpose, zeros } from './matrix';
import { parseInput } from './parse';
import type {
  AdjustmentResult,
  Observation,
  Station,
  StationId,
  StationMap,
  InstrumentLibrary,
} from '../types';

interface EngineOptions {
  input: string;
  maxIterations?: number;
  instrumentLibrary?: InstrumentLibrary;
  convergenceThreshold?: number;
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

  constructor({ input, maxIterations = 10, instrumentLibrary = {}, convergenceThreshold = 0.0001 }: EngineOptions) {
    this.input = input;
    this.maxIterations = maxIterations;
    this.instrumentLibrary = { ...instrumentLibrary };
    this.convergenceThreshold = convergenceThreshold;
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

  solve(): AdjustmentResult {
    const parsed = parseInput(this.input, this.instrumentLibrary);
    this.stations = parsed.stations;
    this.observations = parsed.observations;
    this.unknowns = parsed.unknowns;
    this.instrumentLibrary = parsed.instrumentLibrary;
    this.logs = [...parsed.logs];

    if (this.unknowns.length === 0) {
      this.log('No unknown stations to solve.');
      return this.buildResult();
    }

    const numParams = this.unknowns.length * 3; // X, Y, H per station
    const numObsEquations = this.observations.reduce((acc, o) => acc + (o.type === 'gps' ? 2 : 1), 0);

    this.dof = numObsEquations - numParams;
    if (this.dof < 0) {
      this.log('Error: Redundancy < 0. Under-determined.');
      return this.buildResult();
    }

    const paramMap: Record<StationId, number> = {};
    this.unknowns.forEach((id, idx) => {
      paramMap[id] = idx * 3;
    });

    for (let iter = 0; iter < this.maxIterations; iter++) {
      this.iterations += 1;

      const A = zeros(numObsEquations, numParams);
      const L = zeros(numObsEquations, 1);
      const P = zeros(numObsEquations, numObsEquations);

      let row = 0;

      this.observations.forEach((obs) => {
        if (obs.type === 'dist') {
          const { from, to } = obs;
          const s1 = this.stations[from];
          const s2 = this.stations[to];
          if (!s1 || !s2) return;
          const dx = s2.x - s1.x;
          const dy = s2.y - s1.y;
          const calcDist = Math.sqrt(dx * dx + dy * dy);
          const v = obs.obs - calcDist;

          L[row][0] = v;
          const dD_dE2 = dx / calcDist;
          const dD_dN2 = dy / calcDist;

          if (!s1.fixed) {
            const idx = paramMap[from];
            A[row][idx] = -dD_dE2;
            A[row][idx + 1] = -dD_dN2;
          }
          if (!s2.fixed) {
            const idx = paramMap[to];
            A[row][idx] = dD_dE2;
            A[row][idx + 1] = dD_dN2;
          }

          const w = 1.0 / (obs.stdDev * obs.stdDev);
          P[row][row] = w;

          row += 1;
        } else if (obs.type === 'angle') {
          const { at, from, to } = obs;
          const azTo = this.getAzimuth(at, to);
          const azFrom = this.getAzimuth(at, from);
          let calcAngle = azTo.az - azFrom.az;
          if (calcAngle < 0) calcAngle += 2 * Math.PI;
          let diff = obs.obs - calcAngle;
          if (diff > Math.PI) diff -= 2 * Math.PI;
          if (diff < -Math.PI) diff += 2 * Math.PI;
          L[row][0] = diff;

          const dAzTo_dE_To = Math.cos(azTo.az) / (azTo.dist || 1);
          const dAzTo_dN_To = -Math.sin(azTo.az) / (azTo.dist || 1);
          const dAzFrom_dE_From = Math.cos(azFrom.az) / (azFrom.dist || 1);
          const dAzFrom_dN_From = -Math.sin(azFrom.az) / (azFrom.dist || 1);

          if (!this.stations[to].fixed) {
            const idx = paramMap[to];
            A[row][idx] = dAzTo_dE_To;
            A[row][idx + 1] = dAzTo_dN_To;
          }
          if (!this.stations[from].fixed) {
            const idx = paramMap[from];
            A[row][idx] = -dAzFrom_dE_From;
            A[row][idx + 1] = -dAzFrom_dN_From;
          }
          if (!this.stations[at].fixed) {
            const idx = paramMap[at];
            const dAzTo_dE_At = -dAzTo_dE_To;
            const dAzTo_dN_At = -dAzTo_dN_To;
            const dAzFrom_dE_At = -dAzFrom_dE_From;
            const dAzFrom_dN_At = -dAzFrom_dN_From;
            A[row][idx] = dAzTo_dE_At - dAzFrom_dE_At;
            A[row][idx + 1] = dAzTo_dN_At - dAzFrom_dN_At;
          }

          const w = 1.0 / (obs.stdDev * obs.stdDev);
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
          if (!s1.fixed) {
            const idx = paramMap[from];
            A[row][idx] = -1.0;
          }
          if (!s2.fixed) {
            const idx = paramMap[to];
            A[row][idx] = 1.0;
          }
          P[row][row] = 1.0 / (obs.stdDev * obs.stdDev);

          L[row + 1][0] = vN;
          if (!s1.fixed) {
            const idx = paramMap[from];
            A[row + 1][idx + 1] = -1.0;
          }
          if (!s2.fixed) {
            const idx = paramMap[to];
            A[row + 1][idx + 1] = 1.0;
          }
          P[row + 1][row + 1] = 1.0 / (obs.stdDev * obs.stdDev);

          row += 2;
        } else if (obs.type === 'lev') {
          const { from, to } = obs;
          const s1 = this.stations[from];
          const s2 = this.stations[to];
          if (!s1 || !s2) return;

          const calc_dH = s2.h - s1.h;
          const v = obs.obs - calc_dH;
          L[row][0] = v;

          if (!s1.fixed) {
            const idx = paramMap[from];
            A[row][idx + 2] = -1.0;
          }
          if (!s2.fixed) {
            const idx = paramMap[to];
            A[row][idx + 2] = 1.0;
          }

          const w = 1.0 / (obs.stdDev * obs.stdDev);
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

        let maxCorrection = 0;
        this.unknowns.forEach((id) => {
          const idx = paramMap[id];
          const dE = X[idx][0];
          const dN = X[idx + 1][0];
          const dH = X[idx + 2][0];
          this.stations[id].x += dE;
          this.stations[id].y += dN;
          this.stations[id].h += dH;
          maxCorrection = Math.max(maxCorrection, Math.abs(dE), Math.abs(dN), Math.abs(dH));
        });

        this.log(`Iter ${iter + 1}: Max Corr = ${maxCorrection.toFixed(4)}`);
        if (maxCorrection < this.convergenceThreshold) {
          this.converged = true;
          break;
        }
      } catch {
        this.log('Matrix Inversion Failed (Singular).');
        this.calculateStatistics(paramMap, false);
        return this.buildResult();
      }
    }

    if (!this.converged) this.log('Warning: Max iterations reached.');
    this.calculateStatistics(paramMap, !!this.Qxx);
    return this.buildResult();
  }

  private calculateStatistics(paramMap: Record<StationId, number>, hasQxx: boolean) {
    let vtpv = 0;

    this.observations.forEach((obs) => {
      if (obs.type === 'dist') {
        const s1 = this.stations[obs.from];
        const s2 = this.stations[obs.to];
        if (!s1 || !s2) return;
        const calc = Math.sqrt((s2.x - s1.x) ** 2 + (s2.y - s1.y) ** 2);
        const v = obs.obs - calc;
        obs.calc = calc;
        obs.residual = v;
        obs.stdRes = Math.abs(v) / obs.stdDev;
        vtpv += (v * v) / (obs.stdDev * obs.stdDev);
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
        obs.stdRes = Math.abs(v) / obs.stdDev;
        vtpv += (v * v) / (obs.stdDev * obs.stdDev);
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
        obs.stdRes = vMag / obs.stdDev;
        vtpv += (vE * vE + vN * vN) / (obs.stdDev * obs.stdDev);
      } else if (obs.type === 'lev') {
        const s1 = this.stations[obs.from];
        const s2 = this.stations[obs.to];
        if (!s1 || !s2) return;
        const calc_dH = s2.h - s1.h;
        const v = obs.obs - calc_dH;
        obs.calc = calc_dH;
        obs.residual = v;
        obs.stdRes = Math.abs(v) / obs.stdDev;
        vtpv += (v * v) / (obs.stdDev * obs.stdDev);
      }
    });

    this.seuw = this.dof > 0 ? Math.sqrt(vtpv / this.dof) : 0;

    if (hasQxx && this.Qxx) {
      const s0_sq = this.seuw * this.seuw;
      this.unknowns.forEach((id) => {
        const base = paramMap[id];
        if (base === undefined || !this.Qxx?.[base]) return;
        const qxx = this.Qxx[base][base];
        const qyy = this.Qxx[base + 1][base + 1];
        const qxy = this.Qxx[base][base + 1];

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

        const qhh = this.Qxx[base + 2][base + 2] * s0_sq;
        this.stations[id].sH = Math.sqrt(Math.abs(qhh));
      });
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
