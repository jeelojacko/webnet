/**
 * Phase 12J.1 Batch D §§19-23 — RTKLIB covariance extraction + comparison (EVIDENCE ONLY).
 *
 * Local-corpus evidence; commits no vendor data. Reads an S32 `.pos` file
 * (default `/tmp/s32_run1.pos`, override via argv[2]) produced by the pinned
 * RTKLIB-explorer v2.5.1 binary. Imports production covariance policy
 * read-only (validate + invert); makes NO engine changes.
 *
 * Run: `npx tsx scripts/gnss/gnss12j1CovarianceExtract.ts [posfile]`
 */
import { readFileSync } from 'node:fs';
import type {
  GnssBaselineCovariance,
  GnssBaselineObservation,
} from '../../src/engine/gnssBaselineTypes';
import {
  invertGnssBaselineCovariance,
  validateGnssBaselineCovariance,
} from '../../src/engine/gnssBaselineCovariance';

/** TBC B32 aposteriori covariance (m^2), lower triangle as reported. */
const TBC_B32: GnssBaselineCovariance = {
  xx: 0.0000247718,
  xy: 0.0000655581,
  xz: -0.0000531839,
  yy: 0.0003463746,
  yz: -0.0002570615,
  zz: 0.0002267204,
};

interface PosFixLine {
  time: string;
  x: number;
  y: number;
  z: number;
  status: number;
  sats: number;
  sdx: number;
  sdy: number;
  sdz: number;
  sdxy: number;
  sdyz: number;
  sdzx: number;
  ratio: number;
}

/** Last Q=1 (FIXED) epoch line of an rnx2rtkp `.pos` file. */
const parseLastFix = (path: string): PosFixLine => {
  const lines = readFileSync(path, 'utf8').split('\n');
  let last: PosFixLine | null = null;
  for (const line of lines) {
    if (/^\s*%/.test(line) || line.trim().length === 0) continue;
    const f = line.trim().split(/\s+/);
    if (f.length < 15 || Number(f[5]) !== 1) continue;
    last = {
      time: `${f[0]} ${f[1]}`,
      x: Number(f[2]),
      y: Number(f[3]),
      z: Number(f[4]),
      status: Number(f[5]),
      sats: Number(f[6]),
      sdx: Number(f[7]),
      sdy: Number(f[8]),
      sdz: Number(f[9]),
      sdxy: Number(f[10]),
      sdyz: Number(f[11]),
      sdzx: Number(f[12]),
      ratio: Number(f[14]),
    };
  }
  if (!last) throw new Error(`no FIXED (Q=1) line in ${path}`);
  return last;
};

/**
 * .pos sd columns are std-devs (m): diagonals sqrt(qr[i]), cross terms
 * sign-preserving sqrt (solution.c sqvar). Variance = sign(sd)*sd^2.
 */
const signedSquare = (sd: number): number =>
  sd < 0 ? -sd * sd : sd * sd;

const posLineToCovariance = (line: PosFixLine): GnssBaselineCovariance => ({
  xx: line.sdx * line.sdx,
  xy: signedSquare(line.sdxy),
  xz: signedSquare(line.sdzx),
  yy: line.sdy * line.sdy,
  yz: signedSquare(line.sdyz),
  zz: line.sdz * line.sdz,
});

type Dense = [[number, number, number], [number, number, number], [number, number, number]];
const toDense = (c: GnssBaselineCovariance): Dense => [
  [c.xx, c.xy, c.xz],
  [c.xy, c.yy, c.yz],
  [c.xz, c.yz, c.zz],
];

/** Cyclic Jacobi eigensolve for symmetric 3x3; returns ascending eigenvalues. */
const eigen3 = (m: Dense): { values: number[]; vectors: Dense } => {
  const a: Dense = [[m[0][0], m[0][1], m[0][2]], [m[1][0], m[1][1], m[1][2]], [m[2][0], m[2][1], m[2][2]]];
  let v: Dense = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep += 1) {
    let off = 0;
    for (let p = 0; p < 3; p += 1)
      for (let q = p + 1; q < 3; q += 1) off += a[p][q] * a[p][q];
    if (off < 1e-30) break;
    for (let p = 0; p < 3; p += 1)
      for (let q = p + 1; q < 3; q += 1) {
        const apq = a[p][q];
        if (Math.abs(apq) < 1e-30) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < 3; k += 1) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < 3; k += 1) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
  }
  const order = [0, 1, 2].sort((i, j) => a[i][i] - a[j][j]);
  return {
    values: order.map((i) => a[i][i]),
    vectors: [[0, 1, 2].map((k) => v[k][order[0]]), [0, 1, 2].map((k) => v[k][order[1]]), [0, 1, 2].map((k) => v[k][order[2]])] as Dense,
  };
};

const det3 = (m: Dense): number =>
  m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
  m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
  m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);

const correlations = (c: GnssBaselineCovariance): [number, number, number] => {
  const sx = Math.sqrt(c.xx);
  const sy = Math.sqrt(c.yy);
  const sz = Math.sqrt(c.zz);
  return [c.xy / sx / sy, c.xz / sx / sz, c.yz / sy / sz];
};

// §23 — acceptance quality contract (pure; evidence-only, not production).
type QualityVerdict = 'ACCEPTED_FIXED' | 'ACCEPTED_FLOAT' | 'LOW_QUALITY' | 'FAILED';
interface QualityInput {
  solverStatus: 'FIXED' | 'FLOAT' | 'FAILED';
  ratio: number;
  epochsFixed: number;
  epochsTotal: number;
  satellites: number;
  covarianceOk: boolean;
  warnings: string[];
}
interface QualityResult {
  verdict: QualityVerdict;
  reasons: string[];
  warnings: string[];
}
const RATIO_GATE = 3.0;
const classifyBaselineQuality = (input: QualityInput): QualityResult => {
  const reasons: string[] = [];
  if (input.solverStatus === 'FAILED') {
    reasons.push('solver reported FAILED');
    return { verdict: 'FAILED', reasons, warnings: input.warnings };
  }
  if (!input.covarianceOk) {
    reasons.push('covariance failed SPD gate');
    return { verdict: 'FAILED', reasons, warnings: input.warnings };
  }
  if (input.solverStatus === 'FLOAT') {
    reasons.push('float solution: accepted as float only');
    return { verdict: 'ACCEPTED_FLOAT', reasons, warnings: input.warnings };
  }
  if (input.ratio < RATIO_GATE) reasons.push(`ratio ${input.ratio} < ${RATIO_GATE}`);
  if (input.satellites < 4) reasons.push(`only ${input.satellites} satellites`);
  const fixFrac = input.epochsTotal > 0 ? input.epochsFixed / input.epochsTotal : 0;
  if (fixFrac < 0.5) reasons.push(`fix fraction ${fixFrac.toFixed(3)} < 0.50`);
  if (reasons.length > 0) return { verdict: 'LOW_QUALITY', reasons, warnings: input.warnings };
  reasons.push(`fixed, ratio ${input.ratio} >= ${RATIO_GATE}`);
  return { verdict: 'ACCEPTED_FIXED', reasons, warnings: input.warnings };
};

// Minimal self-checks (evidence script only — NOT a tests/ suite).
const check = (name: string, cond: boolean): void => {
  if (!cond) throw new Error(`self-check failed: ${name}`);
  console.log(`ok - ${name}`);
};

const main = (): void => {
  const posPath = process.argv[2] ?? '/tmp/s32_run1.pos';
  const fix = parseLastFix(posPath);
  const rtk = posLineToCovariance(fix);
  console.log(`FIX line: ${fix.time} sats=${fix.sats} ratio=${fix.ratio}`);

  // §19 round-trip: .pos -> raw-solution-contract -> GnssBaselineObservation -> weighting.
  const rawSolution = {
    from: 'P041',
    to: 'sixtwo',
    deltaX: fix.x - -1283634.1259,
    deltaY: fix.y - -4726427.8882,
    deltaZ: fix.z - 4074798.0251,
    covariance: { ...rtk },
    session: 'S32',
    solution: { status: 'FIXED' as const, ratio: fix.ratio, satellitesUsed: fix.sats },
    referenceFrame: 'WGS84(G1150)-class/broadcast',
  };
  const observation: GnssBaselineObservation = {
    type: 'gnssBaseline',
    id: 32,
    from: rawSolution.from,
    to: rawSolution.to,
    vector: { x: rawSolution.deltaX, y: rawSolution.deltaY, z: rawSolution.deltaZ },
    covariance: { ...rawSolution.covariance },
    frame: 'ecef',
    referenceFrame: rawSolution.referenceFrame,
    sessionId: rawSolution.session,
    solutionId: 'B32',
    sourceFile: posPath,
  };
  // §20 SPD gate = production policy, no jitter/clipping.
  validateGnssBaselineCovariance(observation.covariance, 'S32-RTKLIB');
  validateGnssBaselineCovariance(TBC_B32, 'B32-TBC');
  const weight = invertGnssBaselineCovariance(observation.covariance, 'S32-RTKLIB');
  check('RTKLIB covariance passes SPD gate', true);
  check('TBC covariance passes SPD gate', true);
  check('weight matrix finite', weight.flat().every(Number.isFinite));

  // §21 full-matrix comparison.
  const R = toDense(rtk);
  const T = toDense(TBC_B32);
  const eR = eigen3(R);
  const eT = eigen3(T);
  const sig = (c: GnssBaselineCovariance): number[] => [
    Math.sqrt(c.xx) * 1000,
    Math.sqrt(c.yy) * 1000,
    Math.sqrt(c.zz) * 1000,
  ];
  const sR = sig(rtk);
  const sT = sig(TBC_B32);
  const corrR = correlations(rtk);
  const corrT = correlations(TBC_B32);
  const dot =
    eR.vectors[2][0] * eT.vectors[2][0] +
    eR.vectors[2][1] * eT.vectors[2][1] +
    eR.vectors[2][2] * eT.vectors[2][2];
  // §22 single-scalar scaling experiment (no production scaling).
  const keys = ['xx', 'xy', 'xz', 'yy', 'yz', 'zz'] as const;
  const num = keys.reduce((s, k) => s + TBC_B32[k] * rtk[k], 0);
  const den = keys.reduce((s, k) => s + rtk[k] * rtk[k], 0);
  const alpha = num / den;
  const resid = Math.sqrt(
    keys.reduce((s, k) => s + (TBC_B32[k] - alpha * rtk[k]) ** 2, 0) /
      keys.reduce((s, k) => s + TBC_B32[k] ** 2, 0),
  );

  // §23 contract unit-checks.
  const qS32 = classifyBaselineQuality({
    solverStatus: 'FIXED',
    ratio: fix.ratio,
    epochsFixed: 90,
    epochsTotal: 93,
    satellites: fix.sats,
    covarianceOk: true,
    warnings: [],
  });
  check('S32 classifies ACCEPTED_FIXED', qS32.verdict === 'ACCEPTED_FIXED');
  check(
    'low ratio -> LOW_QUALITY',
    classifyBaselineQuality({
      solverStatus: 'FIXED', ratio: 1.5, epochsFixed: 90, epochsTotal: 93,
      satellites: 7, covarianceOk: true, warnings: [],
    }).verdict === 'LOW_QUALITY',
  );
  check(
    'float never ACCEPTED_FIXED',
    classifyBaselineQuality({
      solverStatus: 'FLOAT', ratio: 99, epochsFixed: 0, epochsTotal: 93,
      satellites: 9, covarianceOk: true, warnings: [],
    }).verdict === 'ACCEPTED_FLOAT',
  );
  check(
    'bad covariance -> FAILED',
    classifyBaselineQuality({
      solverStatus: 'FIXED', ratio: 28.6, epochsFixed: 90, epochsTotal: 93,
      satellites: 7, covarianceOk: false, warnings: ['non-SPD'],
    }).verdict === 'FAILED',
  );
  check(
    'solver FAILED -> FAILED',
    classifyBaselineQuality({
      solverStatus: 'FAILED', ratio: 0, epochsFixed: 0, epochsTotal: 93,
      satellites: 0, covarianceOk: false, warnings: ['no solution'],
    }).verdict === 'FAILED',
  );

  console.log(JSON.stringify({
    rtklibCovM2: rtk,
    tbcCovM2: { ...TBC_B32 },
    sigmaMm: { rtklib: sR, tbc: sT, ratio: sT.map((v, i) => v / sR[i]) },
    correlations: { rtklib: corrR, tbc: corrT },
    eigenM2: { rtklib: eR.values, tbc: eT.values },
    principalAxes: { rtklib: eR.vectors[2], tbc: eT.vectors[2], absDot: Math.abs(dot) },
    traceM2: { rtklib: rtk.xx + rtk.yy + rtk.zz, tbc: TBC_B32.xx + TBC_B32.yy + TBC_B32.zz },
    determinant: { rtklib: det3(R), tbc: det3(T) },
    condition: {
      rtklib: eR.values[2] / eR.values[0],
      tbc: eT.values[2] / eT.values[0],
    },
    scalarFit: { alpha, relativeResidual: resid },
    qualityS32: qS32,
  }, null, 2));
};

main();
