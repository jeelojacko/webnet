//WebNet Adjustment

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Play, 
  RefreshCw, 
  FileText, 
  Activity, 
  Map as MapIcon, 
  AlertTriangle, 
  CheckCircle, 
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  Maximize2,
  Minimize2
} from 'lucide-react';

/****************************
 * MATRIX MATH HELPERS
 ****************************/
const Matrix = {
  zeros: (r, c) => Array(r).fill().map(() => Array(c).fill(0)),
  transpose: (m) => m[0].map((_, i) => m.map(row => row[i])),
  multiply: (a, b) => {
    const r1 = a.length;
    const c1 = a[0].length;
    const c2 = b[0].length;
    const res = Matrix.zeros(r1, c2);
    for (let i = 0; i < r1; i++) {
      for (let j = 0; j < c2; j++) {
        let sum = 0;
        for (let k = 0; k < c1; k++) {
          sum += a[i][k] * b[k][j];
        }
        res[i][j] = sum;
      }
    }
    return res;
  },
  inv: (m) => {
    const n = m.length;
    const aug = m.map((row, i) => [
      ...row,
      ...Array(n)
        .fill(0)
        .map((_, j) => (i === j ? 1 : 0)),
    ]);

    for (let i = 0; i < n; i++) {
      let maxRow = i;
      for (let k = i + 1; k < n; k++) {
        if (Math.abs(aug[k][i]) > Math.abs(aug[maxRow][i])) maxRow = k;
      }
      [aug[i], aug[maxRow]] = [aug[maxRow], aug[i]];
      const pivot = aug[i][i];
      if (Math.abs(pivot) < 1e-10) throw new Error('Singular Matrix');
      for (let j = i; j < 2 * n; j++) aug[i][j] /= pivot;
      for (let k = 0; k < n; k++) {
        if (k !== i) {
          const factor = aug[k][i];
          for (let j = i; j < 2 * n; j++) aug[k][j] -= factor * aug[i][j];
        }
      }
    }
    return aug.map(row => row.slice(n));
  },
};

/****************************
 * CONSTANTS & DEFAULT INPUT
 ****************************/
const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;
const SEC_TO_RAD = Math.PI / (180 * 3600);

// 10-point network, 2D + orthometric height (H). GPS gives X/Y, Leveling gives H.
// Multiple "sets" of angle and distance observations (S1/S2 tags) share the same
// geometry but are treated as independent measurements.
const DEFAULT_INPUT = `# WebNet Example - 10 Point Mixed Network
# - 3 control points with fixed XYH
# - 7 unknown stations (XYH adjusted)
# - Total station sets (angles & distances)
# - GPS vectors (planimetric)
# - Leveling height differences
# - Instrument library and usage

# --- INSTRUMENT LIBRARY ---
# I <CODE> <Desc-with-dashes> <dist_a_ppm> <dist_b_const> <angle_std(")> <gps_xy_std(m)> <lev_std(mm/km)>
I TS1   TS-Geodetic-1mm+1ppm      1.0   0.001   1.0    0.020   1.5
I TS2   TS-Construction-3mm+2ppm  2.0   0.003   3.0    0.050   2.0
I GPS1  GNSS-Base-Rover-Fix       0.5   0.002   2.0    0.010   4.0
I LEV1  Digital-Level-0.7mm       0.0   0.000   0.0    0.000   0.7

# --- CONTROL / STATIONS ---
# C <ID> <E> <N> <H> [* for fixed]
C 1000  5000.000 5000.000  100.000  *
C 1001  5300.000 5000.000  102.000  *
C 1002  5150.000 5300.000  101.500  *

C 2000  5050.000 5050.000  100.200
C 2001  5250.000 5050.000  101.000
C 2002  5200.000 5200.000  101.200
C 2003  5100.000 5200.000  100.800
C 2004  5000.000 5300.000  100.600
C 2005  5300.000 5300.000  101.400
C 2006  5150.000 5400.000  101.000

# --- TOTAL STATION DISTANCES (2 sets) ---
# D <InstCode> <SetID> <From> <To> <Dist(m)> <Std(m-raw)>
D TS1  S1  1000 2000   70.711   0.003
D TS1  S1  2000 2001  200.000   0.003
D TS1  S1  2001 1001   70.711   0.003
D TS1  S1  1001 2002  223.607   0.003
D TS1  S1  2002 2003  100.000   0.003
D TS1  S1  2003 1000  223.607   0.003

# Second set with slight differences (redundant but realistic)
D TS1  S2  1000 2000   70.712   0.003
D TS1  S2  2000 2001  200.001   0.003
D TS1  S2  2001 1001   70.710   0.003
D TS1  S2  1001 2002  223.606   0.003
D TS1  S2  2002 2003  100.000   0.003
D TS1  S2  2003 1000  223.606   0.003

# --- TOTAL STATION ANGLES (Sets S1/S2) ---
# A <InstCode> <SetID> <At> <From> <To> <Angle(dms)> <Std(")>
# Angles are generated from the station coordinates.
A TS1  S1  1000 1001 2000  315.0000  1.0
A TS1  S1  1000 2000 2003  341.3354  1.0
A TS1  S1  1001 1000 2001  045.0000  1.0
A TS1  S1  1001 2001 2002  018.2606  1.0
A TS1  S1  1002 2003 2002  306.5212  1.0
A TS1  S1  1002 2004 2005  180.0000  1.0

# Slightly perturbed second set
A TS1  S2  1000 1001 2000  315.0000  1.0
A TS1  S2  1000 2000 2003  341.3354  1.0
A TS1  S2  1001 1000 2001  044.5960  1.0
A TS1  S2  1001 2001 2002  018.2606  1.0
A TS1  S2  1002 2003 2002  306.5212  1.0
A TS1  S2  1002 2004 2005  180.0000  1.0

# --- GPS OBSERVATIONS (planimetric) ---
# G <InstCode> <From> <To> <dE(m)> <dN(m)> <Std_XY(m)>
# These are baselines derived from coordinates with tiny noise.
G GPS1 1000 1001  299.999   0.001  0.010
G GPS1 1001 1002 -149.999 299.999  0.010
G GPS1 1002 1000 -150.000 -300.000 0.010

G GPS1 1000 2004   0.001 300.001  0.020
G GPS1 1001 2005  -0.002 299.998  0.020
G GPS1 1002 2006   0.001 100.000  0.020

# --- LEVELING OBSERVATIONS ---
# L <InstCode> <From> <To> <dH(m)> <Len(km)> <Std(mm/km-raw)>
# These tie ALL unknown heights into the network.
L LEV1 1000 1001   2.0009   0.30   0.7
L LEV1 1001 1002  -0.4991   0.34   0.7
L LEV1 1002 1000  -1.5009   0.34   0.7

L LEV1 1000 2000   0.1992   0.07   0.7
L LEV1 2000 2001   0.8007   0.20   0.7
L LEV1 2001 1001   1.0005   0.07   0.7

L LEV1 1002 2003  -0.6997   0.11   0.7
L LEV1 2003 2004  -0.2004   0.14   0.7
L LEV1 2004 1000  -0.5998   0.30   0.7

# Extra lines to constrain heights of 2002, 2005, 2006
L LEV1 1001 2002  -0.7998   0.22   0.7
L LEV1 1001 2005  -0.5998   0.30   0.7
L LEV1 1002 2006  -0.5007   0.10   0.7
`;


/****************************
 * ANGLE HELPERS
 ****************************/
const dmsToRad = (dmsStr) => {
  const val = parseFloat(dmsStr);
  if (isNaN(val)) return 0;
  const sign = val < 0 ? -1 : 1;
  const absVal = Math.abs(val);
  const d = Math.floor(absVal);
  const m = Math.floor((absVal - d) * 100);
  const s = ((absVal - d) * 100 - m) * 100;
  const decimalDegrees = d + m / 60 + s / 3600;
  return decimalDegrees * DEG_TO_RAD * sign;
};

const radToDmsStr = (rad) => {
  if (rad === undefined || rad === null || isNaN(rad)) return '000-00-00.0';
  let deg = rad * RAD_TO_DEG;
  deg = deg % 360;
  if (deg < 0) deg += 360;
  const d = Math.floor(deg);
  const rem1 = (deg - d) * 60;
  const m = Math.floor(rem1);
  const s = (rem1 - m) * 60;
  return `${d.toString().padStart(3, '0')}-${m
    .toString()
    .padStart(2, '0')}-${s.toFixed(1).padStart(4, '0')}`;
};

/****************************
 * LEAST SQUARES ENGINE (XYH + GPS/Leveling)
 ****************************/
class LSAEngine {
  constructor(input, maxIterations = 10, instrumentLibrary = {}) {
    this.input = input;
    this.stations = {}; // id -> {x, y, h, fixed}
    this.observations = []; // general observation list
    this.unknowns = []; // station ids (XYH params)
    this.iterations = 0;
    this.maxIterations = maxIterations;
    this.convergenceThreshold = 0.0001;
    this.dof = 0;
    this.seuw = 0;
    this.logs = [];
    this.converged = false;
    this.instrumentLibrary = instrumentLibrary || {};
  }

  log(msg) {
    this.logs.push(msg);
  }

  parse() {
    const lines = this.input.split('\n');
    let lineNum = 0;

    for (let raw of lines) {
      lineNum++;
      let line = raw.trim();
      if (!line || line.startsWith('#')) continue;

      const parts = line.split(/\s+/);
      const code = parts[0].toUpperCase();

      try {
        if (code === 'I') {
          // I <CODE> <Desc-with-dashes> <dist_a_ppm> <dist_b_const> <angle_std(")> <gps_xy_std(m)> <lev_std(mm/km)>
          const instCode = parts[1];
          const desc = parts[2].replace(/-/g, ' ');
          const distA = parseFloat(parts[3]);
          const distB = parseFloat(parts[4]);
          const angStd = parseFloat(parts[5]);
          const gpsStd = parseFloat(parts[6]);
          const levStd = parseFloat(parts[7]);
          this.instrumentLibrary[instCode] = {
            code: instCode,
            desc,
            distA_ppm: distA,
            distB_const: distB,
            angleStd_sec: angStd,
            gpsStd_xy: gpsStd,
            levStd_mmPerKm: levStd,
          };
        } else if (code === 'C') {
          // C <ID> <E> <N> <H> [*]
          const id = parts[1];
          const east = parseFloat(parts[2]);
          const north = parseFloat(parts[3]);
          const h = parseFloat(parts[4]);
          const isFixed = parts[5] === '*';
          this.stations[id] = { x: east, y: north, h, fixed: isFixed };
        } else if (code === 'D') {
          // D <InstCode> <SetID> <From> <To> <Dist> <Std_raw>
          const instCode = parts[1];
          const setId = parts[2];
          const from = parts[3];
          const to = parts[4];
          const dist = parseFloat(parts[5]);
          const stdRaw = parseFloat(parts[6]);

          // Convert Star*Net-like dist model: sqrt( (a*ppm)^2 + b^2 + stdRaw^2 )
          const inst = this.instrumentLibrary[instCode];
          let sigma = stdRaw;
          if (inst) {
            const a = inst.distA_ppm * 1e-6 * dist;
            const b = inst.distB_const;
            sigma = Math.sqrt(a * a + b * b + stdRaw * stdRaw);
          }

          this.observations.push({
            type: 'dist',
            subtype: 'ts',
            instCode,
            setId,
            from,
            to,
            obs: dist,
            stdDev: sigma,
            calc: null,
            residual: null,
            stdRes: null,
          });
        } else if (code === 'A') {
          // A <InstCode> <SetID> <At> <From> <To> <Angle(dms)> <Std(")>
          const instCode = parts[1];
          const setId = parts[2];
          const at = parts[3];
          const from = parts[4];
          const to = parts[5];
          const angleRad = dmsToRad(parts[6]);
          const stdRawArcsec = parseFloat(parts[7]);

          const inst = this.instrumentLibrary[instCode];
          let sigmaSec = stdRawArcsec;
          if (inst && inst.angleStd_sec > 0) {
            // combine library angle std in quadrature
            sigmaSec = Math.sqrt(
              stdRawArcsec * stdRawArcsec + inst.angleStd_sec * inst.angleStd_sec,
            );
          }

          this.observations.push({
            type: 'angle',
            instCode,
            setId,
            at,
            from,
            to,
            obs: angleRad,
            stdDev: sigmaSec * SEC_TO_RAD,
            calc: null,
            residual: null,
            stdRes: null,
          });
        } else if (code === 'G') {
          // G <InstCode> <From> <To> <dE> <dN> <Std_XY>
          const instCode = parts[1];
          const from = parts[2];
          const to = parts[3];
          const dE = parseFloat(parts[4]);
          const dN = parseFloat(parts[5]);
          const stdXY = parseFloat(parts[6]);

          const inst = this.instrumentLibrary[instCode];
          let sigma = stdXY;
          if (inst && inst.gpsStd_xy > 0) {
            sigma = Math.sqrt(stdXY * stdXY + inst.gpsStd_xy * inst.gpsStd_xy);
          }

          this.observations.push({
            type: 'gps',
            instCode,
            from,
            to,
            obs: { dE, dN },
            stdDev: sigma,
            calc: null,
            residual: null, // we will store {vE, vN}
            stdRes: null, // we will store scalar equivalent
          });
        } else if (code === 'L') {
          // L <InstCode> <From> <To> <dH> <Len(km)> <Std(mm/km-raw)>
          const instCode = parts[1];
          const from = parts[2];
          const to = parts[3];
          const dH = parseFloat(parts[4]);
          const lenKm = parseFloat(parts[5]);
          const stdMmPerKmRaw = parseFloat(parts[6]);

          const inst = this.instrumentLibrary[instCode];
          let sigma = (stdMmPerKmRaw * lenKm) / 1000.0; // convert mm to m
          if (inst && inst.levStd_mmPerKm > 0) {
            const lib = (inst.levStd_mmPerKm * lenKm) / 1000.0;
            sigma = Math.sqrt(sigma * sigma + lib * lib);
          }

          this.observations.push({
            type: 'lev',
            instCode,
            from,
            to,
            obs: dH,
            lenKm,
            stdDev: sigma,
            calc: null,
            residual: null,
            stdRes: null,
          });
        }
      } catch (e) {
        this.log(`Error on line ${lineNum}: ${e.message}`);
      }
    }

    // Unknown stations: any non-fixed.
    this.unknowns = Object.keys(this.stations).filter(id => !this.stations[id].fixed);
    this.log(
      `Stations: ${Object.keys(this.stations).length} (unknown: ${this.unknowns.length}). Obs: ${this.observations.length}`,
    );
  }

  getAzimuth(fromID, toID) {
    const s1 = this.stations[fromID];
    const s2 = this.stations[toID];
    if (!s1 || !s2) return { az: 0, dist: 0 };
    const dx = s2.x - s1.x;
    const dy = s2.y - s1.y;
    let az = Math.atan2(dx, dy);
    if (az < 0) az += 2 * Math.PI;
    return { az, dist: Math.sqrt(dx * dx + dy * dy) };
  }

  solve() {
    this.parse();
    if (this.unknowns.length === 0) {
      this.log('No unknown stations to solve.');
      return false;
    }

    // Each station has 3 params: X, Y, H
    const numParams = this.unknowns.length * 3;
    const numObsEquations = this.observations.reduce((acc, o) => {
      if (o.type === 'gps') return acc + 2; // dE & dN
      return acc + 1;
    }, 0);

    this.dof = numObsEquations - numParams;
    if (this.dof < 0) {
      this.log('Error: Redundancy < 0. Under-determined.');
      return false;
    }

    const paramMap = {}; // station id -> base index
    this.unknowns.forEach((id, idx) => {
      paramMap[id] = idx * 3; // x,y,h
    });

    for (let iter = 0; iter < this.maxIterations; iter++) {
      this.iterations++;

      let A = Matrix.zeros(numObsEquations, numParams);
      let L = Matrix.zeros(numObsEquations, 1);
      let P = Matrix.zeros(numObsEquations, numObsEquations);

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

          const dAzTo_dE_To = Math.cos(azTo.az) / azTo.dist;
          const dAzTo_dN_To = -Math.sin(azTo.az) / azTo.dist;
          const dAzFrom_dE_From = Math.cos(azFrom.az) / azFrom.dist;
          const dAzFrom_dN_From = -Math.sin(azFrom.az) / azFrom.dist;

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

          // row: dE equation
          L[row][0] = vE;
          if (!s1.fixed) {
            const idx = paramMap[from];
            A[row][idx] = -1.0; // dE wrt Ex_from
          }
          if (!s2.fixed) {
            const idx = paramMap[to];
            A[row][idx] = 1.0; // dE wrt Ex_to
          }
          P[row][row] = 1.0 / (obs.stdDev * obs.stdDev);

          // row+1: dN equation
          L[row + 1][0] = vN;
          if (!s1.fixed) {
            const idx = paramMap[from];
            A[row + 1][idx + 1] = -1.0; // dN wrt Ny_from
          }
          if (!s2.fixed) {
            const idx = paramMap[to];
            A[row + 1][idx + 1] = 1.0; // dN wrt Ny_to
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
            A[row][idx + 2] = -1.0; // wrt H_from
          }
          if (!s2.fixed) {
            const idx = paramMap[to];
            A[row][idx + 2] = 1.0; // wrt H_to
          }

          const w = 1.0 / (obs.stdDev * obs.stdDev);
          P[row][row] = w;

          row += 1;
        }
      });

      try {
        const AT = Matrix.transpose(A);
        const ATP = Matrix.multiply(AT, P);
        const N = Matrix.multiply(ATP, A);
        const U = Matrix.multiply(ATP, L);
        const N_inv = Matrix.inv(N);
        const X = Matrix.multiply(N_inv, U);
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
          maxCorrection = Math.max(
            maxCorrection,
            Math.abs(dE),
            Math.abs(dN),
            Math.abs(dH),
          );
        });

        this.log(`Iter ${iter + 1}: Max Corr = ${maxCorrection.toFixed(4)}`);
        if (maxCorrection < this.convergenceThreshold) {
          this.converged = true;
          break;
        }
      } catch (e) {
        this.log('Matrix Inversion Failed (Singular).');
        this.calculateStatistics(paramMap, false);
        return false;
      }
    }

    if (!this.converged) this.log('Warning: Max iterations reached.');
    this.calculateStatistics(paramMap, !!this.Qxx);
    return this.converged;
  }

  calculateStatistics(paramMap, hasQxx) {
    let vtpv = 0;

    this.observations.forEach((obs) => {
      if (obs.type === 'dist') {
        const s1 = this.stations[obs.from];
        const s2 = this.stations[obs.to];
        const calc = Math.sqrt(
          Math.pow(s2.x - s1.x, 2) + Math.pow(s2.y - s1.y, 2),
        );
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
        if (base === undefined || !this.Qxx[base]) return;
        const qxx = this.Qxx[base][base];
        const qyy = this.Qxx[base + 1][base + 1];
        const qxy = this.Qxx[base][base + 1];

        const sx2 = qxx * s0_sq;
        const sy2 = qyy * s0_sq;
        const sxy = qxy * s0_sq;

        const term1 = (sx2 + sy2) / 2;
        const term2 = Math.sqrt(
          Math.pow((sx2 - sy2) / 2, 2) + sxy * sxy,
        );
        const semiMajor = Math.sqrt(Math.abs(term1 + term2));
        const semiMinor = Math.sqrt(Math.abs(term1 - term2));
        let theta = 0.5 * Math.atan2(2 * sxy, sx2 - sy2);

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
}

/****************************
 * UI COMPONENTS
 ****************************/
const App = () => {
  const [input, setInput] = useState(DEFAULT_INPUT);
  const [result, setResult] = useState(null);
  const [activeTab, setActiveTab] = useState('report');
  const [settings, setSettings] = useState({ maxIterations: 10, units: 'm' });
  const [instrumentLibrary, setInstrumentLibrary] = useState({});
  const [selectedInstrument, setSelectedInstrument] = useState('');
  const [splitPercent, setSplitPercent] = useState(35); // left pane width (%)
  const [isSidebarOpen, setIsSidebarOpen] = useState(true); // Sidebar visibility
  const layoutRef = useRef(null);
  const isResizingRef = useRef(false);

  useEffect(() => {
    const lines = input.split('\n');
    const lib = {};

    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;

      const parts = line.split(/\s+/);
      if (parts[0].toUpperCase() === 'I' && parts.length >= 8) {
        const instCode = parts[1];
        const desc = parts[2].replace(/-/g, ' ');
        const distA = parseFloat(parts[3]);
        const distB = parseFloat(parts[4]);
        const angStd = parseFloat(parts[5]);
        const gpsStd = parseFloat(parts[6]);
        const levStd = parseFloat(parts[7]);
        lib[instCode] = {
          code: instCode,
          desc,
          distA_ppm: distA,
          distB_const: distB,
          angleStd_sec: angStd,
          gpsStd_xy: gpsStd,
          levStd_mmPerKm: levStd,
        };
      }
    }

    setInstrumentLibrary(lib);

    const codes = Object.keys(lib);
    if (!selectedInstrument && codes.length > 0) {
      setSelectedInstrument(codes[0]);
    } else if (selectedInstrument && !lib[selectedInstrument]) {
      setSelectedInstrument(codes[0] || '');
    }
  }, [input, selectedInstrument]);

  // handle dragging of vertical divider
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isResizingRef.current || !layoutRef.current || !isSidebarOpen) return;

      const bounds = layoutRef.current.getBoundingClientRect();
      const offsetX = e.clientX - bounds.left;
      let pct = (offsetX / bounds.width) * 100;

      const min = 20; // min 20% left
      const max = 80; // max 80% left
      if (pct < min) pct = min;
      if (pct > max) pct = max;

      setSplitPercent(pct);
    };

    const handleMouseUp = () => {
      isResizingRef.current = false;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isSidebarOpen]);

  const handleDividerMouseDown = (e) => {
    e.preventDefault();
    isResizingRef.current = true;
  };

  const handleRun = () => {
    const engine = new LSAEngine(input, settings.maxIterations, { ...instrumentLibrary });
    engine.solve();
    setInstrumentLibrary(engine.instrumentLibrary);
    setResult({
      success: engine.converged,
      stations: engine.stations,
      observations: engine.observations,
      logs: engine.logs,
      seuw: engine.seuw,
      dof: engine.dof,
    });
    setActiveTab('report');
  };

  const handleUnitChange = (e) => {
    setSettings({ ...settings, units: e.target.value });
  };

  const handleIterChange = (e) => {
    const val = parseInt(e.target.value) || 1;
    setSettings({ ...settings, maxIterations: val });
  };

  return (
    <div className="fixed inset-0 flex flex-col bg-slate-900 text-slate-100 font-sans overflow-hidden">
      <header className="h-16 bg-slate-800 border-b border-slate-700 flex items-center justify-between px-4 shrink-0 w-full">
        <div className="flex items-center space-x-4">
           <button
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="p-1.5 hover:bg-slate-700 rounded text-slate-400 hover:text-white transition-colors"
            title={isSidebarOpen ? "Close Input Sidebar" : "Open Input Sidebar"}
          >
             {isSidebarOpen ? <PanelLeftClose size={20}/> : <PanelLeftOpen size={20} />}
          </button>
          <div className="flex items-center space-x-2">
            <Activity className="text-blue-400" size={24} />
            <div className="flex flex-col">
              <h1 className="text-lg font-bold tracking-wide text-white leading-none">
                WebNet <span className="text-blue-400 font-light">Adjustment</span>
              </h1>
              <span className="text-xs text-slate-500">Survey LSA · TS + GPS + Leveling</span>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-4 bg-slate-900/50 px-4 py-1.5 rounded border border-slate-700">
          {/* Units */}
          <div className="flex items-center space-x-2">
            <label className="text-xs text-slate-400 font-medium uppercase">Units</label>
            <select
              value={settings.units}
              onChange={handleUnitChange}
              className="bg-slate-800 text-xs border border-slate-600 text-white rounded px-2 py-1 outline-none focus:border-blue-500"
            >
              <option value="m">Meters (m)</option>
              <option value="ft">Feet (ft)</option>
            </select>
          </div>

          <div className="w-px h-4 bg-slate-700 mx-2" />

          {/* Max Iter */}
          <div className="flex items-center space-x-2">
            <label className="text-xs text-slate-400 font-medium uppercase">Max Iter</label>
            <input
              type="number"
              min="1"
              max="100"
              value={settings.maxIterations}
              onChange={handleIterChange}
              className="w-20 bg-slate-800 text-xs border border-slate-600 text-white rounded px-2 py-1 outline-none focus:border-blue-500 text-center"
            />
          </div>

          <div className="w-px h-4 bg-slate-700 mx-2" />

          {/* Instrument dropdown */}
          <div className="flex flex-col">
            <div className="flex items-center space-x-2">
              <Settings size={14} className="text-slate-400" />
              <label className="text-xs text-slate-400 font-medium uppercase">
                Instrument
              </label>
              <select
                value={selectedInstrument}
                onChange={(e) => setSelectedInstrument(e.target.value)}
                className="bg-slate-800 text-xs border border-slate-600 text-white rounded px-2 py-1 outline-none focus:border-blue-500"
              >
                {Object.keys(instrumentLibrary).length === 0 && (
                  <option value="">(none)</option>
                )}
                {Object.values(instrumentLibrary).map((inst) => (
                  <option key={inst.code} value={inst.code}>
                    {inst.code}
                  </option>
                ))}
              </select>
            </div>
            {selectedInstrument && instrumentLibrary[selectedInstrument] && (
              <div className="mt-1 text-[10px] text-slate-500">
                {instrumentLibrary[selectedInstrument].desc} · dist:{' '}
                {instrumentLibrary[selectedInstrument].distA_ppm}ppm +{' '}
                {instrumentLibrary[selectedInstrument].distB_const}m · angle:{' '}
                {instrumentLibrary[selectedInstrument].angleStd_sec}" · GPS:{' '}
                {instrumentLibrary[selectedInstrument].gpsStd_xy}m · lev:{' '}
                {instrumentLibrary[selectedInstrument].levStd_mmPerKm}mm/km
              </div>
            )}
          </div>
        </div>

        <div className="flex space-x-2">
          <button
            onClick={handleRun}
            className="flex items-center space-x-2 bg-green-600 hover:bg-green-500 text-white px-4 py-1.5 rounded text-sm font-medium transition-colors shadow-lg shadow-green-900/20"
          >
            <Play size={16} /> <span>Adjust</span>
          </button>
          <button
            onClick={() => setInput(DEFAULT_INPUT)}
            className="p-2 bg-slate-700 hover:bg-slate-600 rounded text-slate-300 transition-colors"
          >
            <RefreshCw size={18} />
          </button>
        </div>
      </header>

      {/* RESIZABLE MAIN LAYOUT */}
      <div ref={layoutRef} className="flex-1 flex overflow-hidden w-full">
        {/* LEFT: input pane (Collapsible) */}
        {isSidebarOpen && (
            <>
                <div
                className="border-r border-slate-700 flex flex-col min-w-[260px] flex-none"
                style={{ width: `${splitPercent}%` }}
                >
                <div className="bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-400 flex justify-between items-center">
                    <span>INPUT DATA (.dat)</span> <FileText size={14} />
                </div>
                <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    className="flex-1 bg-slate-900 text-slate-300 p-4 font-mono text-xs resize-none focus:outline-none leading-relaxed selection:bg-blue-500/30"
                    spellCheck="false"
                />
                </div>

                {/* DRAG HANDLE */}
                <div
                onMouseDown={handleDividerMouseDown}
                className="w-[4px] flex-none cursor-col-resize bg-slate-800 hover:bg-slate-600 transition-colors"
                />
            </>
        )}

	    {/* RIGHT: report pane */}
        <div className="flex flex-col bg-slate-950 flex-1 min-w-0 overflow-hidden">
			<div className="flex items-center justify-between border-b border-slate-800 bg-slate-900 pr-4">
              <div className="flex">
                  <button
                    onClick={() => setActiveTab('report')}
                    className={`px-6 py-3 text-sm font-medium flex items-center space-x-2 border-b-2 transition-colors ${
                      activeTab === 'report'
                        ? 'border-blue-500 text-white bg-slate-800'
                        : 'border-transparent text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <FileText size={16} /> <span>Adjustment Report</span>
                  </button>
              </div>
              {!isSidebarOpen && (
                  <button 
                    onClick={() => setIsSidebarOpen(true)}
                    className="text-xs flex items-center space-x-1 text-slate-500 hover:text-slate-300"
                  >
                      <Minimize2 size={12} /> <span>Show Input</span>
                  </button>
              )}
			</div>

			<div className="flex-1 overflow-auto w-full">
			  {!result ? (
				<div className="flex flex-col items-center justify-center h-full text-slate-500 space-y-4">
				  <Activity size={48} className="opacity-20" />
				  <p>Paste/edit data, then press "Adjust" to solve.</p>
				</div>
			  ) : (
				<ReportView result={result} settings={settings} />
			  )}
          </div>
        </div>
      </div>
    </div>
  );
};

const ReportView = ({ result, settings }) => {
  const units = settings.units;
  const ellipseUnit = units === 'm' ? 'cm' : 'in';
  const ellipseScale = units === 'm' ? 100 : 12;

  const sortedObs = [...result.observations]
    .map((obs, index) => ({ ...obs, originalIndex: index }))
    .sort((a, b) => Math.abs(b.stdRes || 0) - Math.abs(a.stdRes || 0));

  const byType = (type) => sortedObs.filter((o) => o.type === type);

  const analysis = sortedObs.filter((o) => Math.abs(o.stdRes || 0) > 2.0);

  const renderTable = (obsList, title) => {
    if (!obsList.length) return null;
    return (
      <div className="mb-6 bg-slate-900/30 border border-slate-800/50 rounded overflow-hidden">
        <div className="bg-slate-800/50 px-4 py-2 border-b border-slate-700 flex items-center justify-between">
          <span className="text-blue-400 font-bold uppercase tracking-wider text-xs">
            {title}
          </span>
        </div>
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-slate-500 border-b border-slate-800/50">
              <th className="py-2 px-4">Type</th>
              <th className="py-2">Stations</th>
              <th className="py-2 text-right">Obs</th>
              <th className="py-2 text-right">Calc</th>
              <th className="py-2 text-right">Residual</th>
              <th className="py-2 text-right px-4">StdRes</th>
            </tr>
          </thead>
          <tbody className="text-slate-300">
            {obsList.map((obs, i) => {
              const isFail = Math.abs(obs.stdRes || 0) > 3.0;
              const isWarn = Math.abs(obs.stdRes || 0) > 1.0 && !isFail;

              let stationsLabel = '';
              let obsStr = '';
              let calcStr = '';
              let resStr = '';

              if (obs.type === 'angle') {
                stationsLabel = `${obs.at}-${obs.from}-${obs.to}`;
                obsStr = radToDmsStr(obs.obs);
                calcStr = obs.calc != null ? radToDmsStr(obs.calc) : '-';
                resStr =
                  obs.residual != null
                    ? `${(obs.residual * RAD_TO_DEG * 3600).toFixed(2)}"`
                    : '-';
              } else if (obs.type === 'dist') {
                stationsLabel = `${obs.from}-${obs.to}`;
                obsStr = obs.obs.toFixed(4);
                calcStr = obs.calc != null ? obs.calc.toFixed(4) : '-';
                resStr = obs.residual != null ? obs.residual.toFixed(4) : '-';
              } else if (obs.type === 'gps') {
                stationsLabel = `${obs.from}-${obs.to}`;
                obsStr = `dE=${obs.obs.dE.toFixed(3)}, dN=${obs.obs.dN.toFixed(3)}`;
                calcStr =
                  obs.calc != null
                    ? `dE=${obs.calc.dE.toFixed(3)}, dN=${obs.calc.dN.toFixed(3)}`
                    : '-';
                resStr =
                  obs.residual != null
                    ? `vE=${obs.residual.vE.toFixed(3)}, vN=${obs.residual.vN.toFixed(3)}`
                    : '-';
              } else if (obs.type === 'lev') {
                stationsLabel = `${obs.from}-${obs.to}`;
                obsStr = obs.obs.toFixed(4);
                calcStr = obs.calc != null ? obs.calc.toFixed(4) : '-';
                resStr = obs.residual != null ? obs.residual.toFixed(4) : '-';
              }

              return (
                <tr key={i} className="border-b border-slate-800/30">
                  <td className="py-1 px-4 uppercase text-slate-500">{obs.type}</td>
                  <td className="py-1">{stationsLabel}</td>
                  <td className="py-1 text-right font-mono text-slate-400">{obsStr}</td>
                  <td className="py-1 text-right font-mono text-slate-500">{calcStr}</td>
                  <td
                    className={`py-1 text-right font-bold font-mono ${
                      isFail
                        ? 'text-red-500'
                        : isWarn
                        ? 'text-yellow-500'
                        : 'text-green-500'
                    }`}
                  >
                    {resStr}
                  </td>
                  <td className="py-1 px-4 text-right font-mono text-slate-400">
                    {obs.stdRes != null ? obs.stdRes.toFixed(2) : '-'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="p-6 font-mono text-sm w-full">
      {analysis.length > 0 && (
        <div className="mb-8">
          <h2 className="text-xl font-bold text-white mb-4">Outlier Analysis (&gt; 2σ)</h2>
          <div className="bg-red-900/10 border border-red-800/50 rounded p-3 flex items-start space-x-2 mb-4">
            <AlertTriangle className="text-red-400 mt-0.5" size={18} />
            <div className="text-xs text-red-100">
              Residuals above 2.0σ are highlighted. Consider re-weighting or removing gross errors.
            </div>
          </div>
        </div>
      )}

      <div className="mb-8 border-b border-slate-800 pb-6">
        <h2 className="text-xl font-bold text-white mb-4">Adjustment Summary</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div className="bg-slate-900 p-4 rounded border border-slate-800">
            <span className="block text-slate-500 text-xs mb-1">STATUS</span>
            <div
              className={`flex items-center space-x-2 ${
                result.success ? 'text-green-400' : 'text-yellow-500'
              }`}
            >
              {result.success ? <CheckCircle size={18} /> : <AlertTriangle size={18} />}
              <span className="font-bold">
                {result.success ? 'CONVERGED' : 'NOT CONVERGED / WARNING'}
              </span>
            </div>
          </div>
          <div className="bg-slate-900 p-4 rounded border border-slate-800">
            <span className="block text-slate-500 text-xs mb-1">
              STD ERROR UNIT WEIGHT (SEUW)
            </span>
            <span
              className={`font-bold text-lg ${
                result.seuw > 1.5 ? 'text-yellow-400' : 'text-blue-400'
              }`}
            >
              {result.seuw.toFixed(4)}
            </span>
            <span className="text-slate-600 text-xs ml-2">(DOF: {result.dof})</span>
          </div>
          <div className="bg-slate-900 p-4 rounded border border-slate-800 hidden md:block">
            <span className="block text-slate-500 text-xs mb-1">OBSERVATION BREAKDOWN</span>
            <div className="text-xs text-slate-300 space-y-0.5">
              <div>Distances: {byType('dist').length}</div>
              <div>Angles: {byType('angle').length}</div>
              <div>GPS: {byType('gps').length}</div>
              <div>Leveling: {byType('lev').length}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="mb-8">
        <h3 className="text-blue-400 font-bold mb-3 text-base uppercase tracking-wider">
          Adjusted Coordinates ({units})
        </h3>
        <div className="overflow-x-auto w-full">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-slate-500 border-b border-slate-800 text-xs">
                <th className="py-2 font-semibold w-20">Stn</th>
                <th className="py-2 font-semibold text-right">Northing</th>
                <th className="py-2 font-semibold text-right">Easting</th>
                <th className="py-2 font-semibold text-right">Height</th>
                <th className="py-2 font-semibold text-center">Type</th>
                <th className="py-2 font-semibold text-right w-32">
                  Ellipse ({ellipseUnit})
                </th>
                <th className="py-2 font-semibold text-right w-24">sH ({units})</th>
              </tr>
            </thead>
            <tbody className="text-slate-300">
              {Object.entries(result.stations).map(([id, stn]) => (
                <tr
                  key={id}
                  className="border-b border-slate-800/50 hover:bg-slate-900/50 transition-colors"
                >
                  <td className="py-1 font-medium text-white">{id}</td>
                  <td className="py-1 text-right text-yellow-100/90">
                    {stn.y.toFixed(4)}
                  </td>
                  <td className="py-1 text-right text-yellow-100/90">
                    {stn.x.toFixed(4)}
                  </td>
                  <td className="py-1 text-right text-yellow-100/90">
                    {stn.h.toFixed(4)}
                  </td>
                  <td className="py-1 text-center">
                    {stn.fixed ? (
                      <span className="text-xs bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded">
                        FIXED
                      </span>
                    ) : (
                      <span className="text-xs text-slate-500">ADJ</span>
                    )}
                  </td>
                  <td className="py-1 text-right text-xs text-slate-400">
                    {stn.errorEllipse
                      ? `${(stn.errorEllipse.semiMajor * ellipseScale).toFixed(1)} / ${(
                          stn.errorEllipse.semiMinor * ellipseScale
                        ).toFixed(1)}`
                      : '-'}
                  </td>
                  <td className="py-1 text-right text-xs text-slate-400">
                    {stn.sH != null ? stn.sH.toFixed(3) : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mb-8">
        <h3 className="text-blue-400 font-bold mb-3 text-base uppercase tracking-wider">
          Observations & Residuals
        </h3>
        <div className="bg-slate-800/50 rounded p-2 mb-2 text-xs text-slate-400 flex items-center justify-between">
          <span>Sorted by |StdRes|</span>
        </div>
        {renderTable(byType('angle'), 'Angles (TS)')}
        {renderTable(byType('dist'), 'Distances (TS)')}
        {renderTable(byType('gps'), 'GPS Vectors')}
        {renderTable(byType('lev'), 'Leveling dH')}
      </div>

      <div className="mt-8 bg-slate-900 p-4 rounded border border-slate-800 font-mono text-xs text-slate-400">
        <div className="font-bold text-slate-300 mb-2 uppercase">Processing Log</div>
        {result.logs.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
    </div>
  );
};

export default App;