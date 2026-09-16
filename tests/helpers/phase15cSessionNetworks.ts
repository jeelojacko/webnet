/**
 * Phase 15C shared deterministic session fixtures (test-only).
 *
 * Hand-built minimal 3D network (2 fixed controls + 1 free station,
 * 7 equations / 3 coordinate params) with exact-truth measurements, plus
 * single-observation perturbation recipes with asserted candidate counts:
 * clean => 0 candidates (max |StdRes| ~1.65), GPS dE +0.5 m => exactly 1
 * (the GPS observation only, runner-up <= 0.45), and a seeded-generator
 * network with three +30" bearing perturbations => exactly 3.
 */
import {
  generatePhase6Large3dInput,
  phase6ChainTruth,
  phase6FarControlEasting,
  phase6HeightTruth,
} from '../../src/engine/phase6BenchmarkNetworks';

const toDms = (decimalDegrees: number): string => {
  let deg = decimalDegrees;
  if (deg < 0) deg += 360;
  const d = Math.floor(deg);
  const mFull = (deg - d) * 60;
  const m = Math.floor(mFull);
  const s = (mFull - m) * 60;
  return `${String(d).padStart(3, '0')}-${String(m).padStart(2, '0')}-${s.toFixed(1).padStart(4, '0')}`;
};

export const bearingDms = (fromE: number, fromN: number, toE: number, toN: number): string =>
  toDms((Math.atan2(toE - fromE, toN - fromN) * 180) / Math.PI);

const dist4 = (aE: number, aN: number, bE: number, bN: number): string =>
  Math.hypot(bE - aE, bN - aN).toFixed(4);

const CTRL_A = { e: 0, n: 0, h: 100 };
const CTRL_B = { e: 100, n: 0, h: 100 };
const FREE_U = { e: 50, n: 20, h: 105 };

export interface Minimal3dPerturbation {
  /** Added meters on D CTRLA-U1. */
  distAErr?: number;
  /** Added meters on V CTRLA-U1. */
  levAErr?: number;
  /** Added meters on the GPS dE component. */
  gpsEErr?: number;
}

/** Deterministic minimal 3D input; default (no perturbation) is candidate-free. */
export const buildMinimal3dInput = (perturb?: Minimal3dPerturbation): string => {
  const lines = [
    '# Phase 15C deterministic minimal 3D network (2 fixed + 1 free)',
    '.3D',
    '.UNITS METERS',
    '.ORDER EN',
    '.DELTA ON',
    'I GPS1 Probe-GNSS 0.5 0.002 2.0 0.010 4.0',
    `C CTRLA ${CTRL_A.e.toFixed(4)} ${CTRL_A.n.toFixed(4)} ${CTRL_A.h.toFixed(4)} ! ! !`,
    `C U1 ${(FREE_U.e + 0.02).toFixed(4)} ${(FREE_U.n - 0.01).toFixed(4)} ${(FREE_U.h + 0.01).toFixed(4)}`,
    `C CTRLB ${CTRL_B.e.toFixed(4)} ${CTRL_B.n.toFixed(4)} ${CTRL_B.h.toFixed(4)} ! ! !`,
    `D CTRLA-U1 ${(parseFloat(dist4(CTRL_A.e, CTRL_A.n, FREE_U.e, FREE_U.n)) + (perturb?.distAErr ?? 0)).toFixed(4)} 0.003`,
    `B CTRLA-U1 ${bearingDms(CTRL_A.e, CTRL_A.n, FREE_U.e, FREE_U.n)} 2.0`,
    `V CTRLA-U1 ${((FREE_U.h - CTRL_A.h) + (perturb?.levAErr ?? 0)).toFixed(4)} 0.003`,
    `D CTRLB-U1 ${dist4(CTRL_B.e, CTRL_B.n, FREE_U.e, FREE_U.n)} 0.003`,
    `B CTRLB-U1 ${bearingDms(CTRL_B.e, CTRL_B.n, FREE_U.e, FREE_U.n)} 2.0`,
    `V CTRLB-U1 ${(FREE_U.h - CTRL_B.h).toFixed(4)} 0.003`,
    `G GPS1 CTRLA U1 ${((FREE_U.e - CTRL_A.e) + (perturb?.gpsEErr ?? 0)).toFixed(4)} ${(FREE_U.n - CTRL_A.n).toFixed(4)} 0.010 0.010 0.35`,
  ];
  return `${lines.join('\n')}\n`;
};

const dmsToArcSec = (value: string): number => {
  const match = value.match(/(\d+)-(\d+)-([\d.]+)/);
  if (!match) throw new Error(`bad DMS value ${value}`);
  return parseInt(match[1] ?? '0', 10) * 3600 + parseInt(match[2] ?? '0', 10) * 60 + parseFloat(match[3] ?? '0');
};

const arcSecToDms = (arcSec: number): string => {
  const d = Math.floor(arcSec / 3600);
  const m = Math.floor((arcSec - d * 3600) / 60);
  const s = arcSec - d * 3600 - m * 60;
  return `${String(d).padStart(3, '0')}-${String(m).padStart(2, '0')}-${s.toFixed(1).padStart(4, '0')}`;
};

/**
 * Seeded-generator 3D network (8 unknowns, 59 observations) with three
 * distinct bearing observations perturbed +30" each. Deterministic for the
 * pinned generator seed; yields exactly 3 candidates with |StdRes| > 4.
 */
export const buildThreeCandidateInput = (): string => {
  const clean = generatePhase6Large3dInput({
    id: 'gps-3d-baseline-08',
    family: 'gps-2d',
    unknownCount: 8,
    seed: 2308,
    variant: 'gps-covariance',
    dimension: '3d',
  });
  const lines = clean.split('\n');
  // The three perturbed observations: both B U8-CTRLB repeats + first B U6-U7.
  const targets = ['B U8-CTRLB', 'B U8-CTRLB', 'B U6-U7'];
  const pending = [...targets];
  for (let i = 0; i < lines.length && pending.length > 0; i += 1) {
    const line = lines[i] ?? '';
    const hit = pending.findIndex((want) => line.startsWith(`${want} `));
    if (hit >= 0) {
      const tokens = line.split(/\s+/);
      tokens[2] = arcSecToDms(dmsToArcSec(tokens[2] ?? '0-0-0.0') + 30);
      lines[i] = tokens.join(' ');
      pending.splice(hit, 1);
    }
  }
  if (pending.length > 0) throw new Error(`missing perturbation targets: ${pending.join(',')}`);
  return `${lines.join('\n')}\n`;
};

export interface ScaledExact3dPerturbation {
  /** 1-based free-station indices whose GPS dE is biased. */
  gpsErrStations?: number[];
  /** Added meters on each listed station's GPS dE (default +0.5). */
  gpsErr?: number;
  /**
   * Deterministic micro-noise scale as a fraction of each observation
   * sigma (default 1/3). Exact-truth data converges to SEUW ~ 0, which
   * inflates studentized residuals on numerical dust and trips the
   * |StdRes| >= 2 gate; 1/3-sigma seeded noise keeps the clean network
   * candidate-free with a healthy SEUW. Seed fixed => deterministic.
   */
  noiseFrac?: number;
}

/**
 * Scaled-up Phase 15C exact-truth 3D network (test-only): the Phase 6
 * chain layout/truth with ZERO observation noise and deterministic
 * approximate coordinates, so the clean network is candidate-free and
 * GPS dE biases produce exact candidate counts (gate |StdRes| >= 2,
 * cap 3). freeCount unknowns => 3*freeCount params (64 => 192,
 * 128 => 384, mirroring the gps-3d-64/128 ladder).
 */
export const buildScaledExact3dInput = (
  freeCount: number,
  perturb?: ScaledExact3dPerturbation,
): string => {
  const truth = new Map<string, { e: number; n: number; h: number }>();
  truth.set('CTRLA', { e: 0, n: 0, h: phase6HeightTruth(0) });
  truth.set('CTRLB', {
    e: phase6FarControlEasting(freeCount),
    n: 0,
    h: phase6HeightTruth(freeCount + 1),
  });
  const names: string[] = [];
  for (let i = 0; i < freeCount; i += 1) {
    const horizontal = phase6ChainTruth(i);
    truth.set(`U${i + 1}`, { e: horizontal.e, n: horizontal.n, h: phase6HeightTruth(i + 1) });
    names.push(`U${i + 1}`);
  }
  const at = (name: string): { e: number; n: number; h: number } => {
    const point = truth.get(name);
    if (!point) throw new Error(`Unknown scaled station ${name}.`);
    return point;
  };
  const biased = new Set(perturb?.gpsErrStations ?? []);
  const err = perturb?.gpsErr ?? 0.5;
  const frac = perturb?.noiseFrac ?? 1 / 3;
  // Seeded micro-noise (deterministic per freeCount): uniform in
  // [-frac*sigma, +frac*sigma] per observation family.
  let state = (0x9e3779b9 ^ Math.imul(freeCount, 0x85ebca6b)) >>> 0;
  const rand = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
  const jitter = (sigma: number): number => (rand() * 2 - 1) * frac * sigma;
  const lines = [
    `# Phase 15C scaled exact-truth 3D network (${freeCount} free stations, ${3 * freeCount} params)`,
    '.3D',
    '.UNITS METERS',
    '.ORDER EN',
    '.DELTA ON',
    'I GPS1 Probe-GNSS 0.5 0.002 2.0 0.010 4.0',
  ];
  const origin = at('CTRLA');
  lines.push(`C CTRLA ${origin.e.toFixed(4)} ${origin.n.toFixed(4)} ${origin.h.toFixed(4)} ! ! !`);
  names.forEach((name, i) => {
    const point = at(name);
    const wobble = i % 2 === 0 ? 1 : -1;
    lines.push(
      `C ${name} ${(point.e + 0.02 * wobble).toFixed(4)} ${(point.n - 0.01 * wobble).toFixed(4)} ${(point.h + 0.01 * wobble).toFixed(4)}`,
    );
  });
  const far = at('CTRLB');
  lines.push(`C CTRLB ${far.e.toFixed(4)} ${far.n.toFixed(4)} ${far.h.toFixed(4)} ! ! !`);
  const order = ['CTRLA', ...names, 'CTRLB'];
  const observeHorizontal = (from: string, to: string): void => {
    const a = at(from);
    const b = at(to);
    const dE = b.e - a.e;
    const dN = b.n - a.n;
    lines.push(`D ${from}-${to} ${(Math.hypot(dE, dN) + jitter(0.003)).toFixed(4)} 0.003`);
    const cleanArcSec = dmsToArcSec(bearingDms(a.e, a.n, b.e, b.n));
    lines.push(`B ${from}-${to} ${arcSecToDms(cleanArcSec + jitter(2))} 2.0`);
  };
  const observeHeight = (from: string, to: string): void => {
    lines.push(`V ${from}-${to} ${(at(to).h - at(from).h + jitter(0.003)).toFixed(4)} 0.003`);
  };
  for (let i = 0; i < order.length - 1; i += 1) {
    observeHorizontal(order[i] ?? 'CTRLA', order[i + 1] ?? 'CTRLB');
    observeHeight(order[i] ?? 'CTRLA', order[i + 1] ?? 'CTRLB');
  }
  names.forEach((name, i) => {
    const anchor = i % 2 === 0 ? 'CTRLA' : 'CTRLB';
    observeHorizontal(name, anchor);
    observeHeight(name, anchor);
  });
  names.forEach((name, i) => {
    const point = at(name);
    const bias = biased.has(i + 1) ? err : 0;
    lines.push(
      `G GPS1 CTRLA ${name} ${(point.e - origin.e + bias + jitter(0.01)).toFixed(4)} ${(point.n - origin.n + jitter(0.01)).toFixed(4)} 0.010 0.010 0.35`,
    );
  });
  return `${lines.join('\n')}\n`;
};
