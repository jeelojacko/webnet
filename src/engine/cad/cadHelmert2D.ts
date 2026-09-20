// Phase 18Q: Helmert 2D solver + ALIGN2D derivation + Grid/Ground math.
// Pure engine only (no UI/commands). All 2D (E/N); no Z anywhere. No rounding.
// Model: E' = tE + a*E - b*N; N' = tN + b*E + a*N, with a = s*cos(r), b = s*sin(r).
// Centred normal equations (mandatory for E~2e6 / N~7e6 stability).

import {
  compose,
  rotationAbout,
  translation,
  uniformScaleAbout,
  type CadTransform2D,
} from './cadTransform2D';

export type HelmertMode = 'RIGID' | 'SIMILARITY';

export interface HelmertControlPair {
  sourceE: number;
  sourceN: number;
  targetE: number;
  targetN: number;
}

export interface HelmertResidual {
  dE: number;
  dN: number;
  r: number;
}

export type HelmertResult =
  | {
      ok: true;
      transform: CadTransform2D;
      translationE: number;
      translationN: number;
      rotationDeg: number;
      scale: number;
      scalePpm: number;
      residuals: HelmertResidual[];
      rmsResidual: number;
      maxResidual: number;
    }
  | { ok: false; reason: string };

export interface AlignPoint {
  e: number;
  n: number;
}

export type AlignResult =
  | {
      ok: true;
      transform: CadTransform2D;
      rotationDeg: number;
      scale: number;
      translationE: number;
      translationN: number;
    }
  | { ok: false; reason: string };

export type GridGroundResult =
  | { ok: true; transform: CadTransform2D; effectiveFactor: number; formula: string }
  | { ok: false; reason: string };

const isFiniteNumber = (v: number): boolean => Number.isFinite(v);

const DEG_PER_RAD = 180 / Math.PI;

export function solveHelmert2D(pairs: HelmertControlPair[], mode: HelmertMode): HelmertResult {
  if (!Array.isArray(pairs) || pairs.length < 2) {
    return { ok: false, reason: 'Helmert2D requires at least 2 control pairs.' };
  }
  for (const p of pairs) {
    if (!isFiniteNumber(p.sourceE) || !isFiniteNumber(p.sourceN) ||
        !isFiniteNumber(p.targetE) || !isFiniteNumber(p.targetN)) {
      return { ok: false, reason: 'Helmert2D control pairs must be finite numbers.' };
    }
  }
  const n = pairs.length;
  // Deterministic summation order: input order, no sorting.
  let srcE = 0;
  let srcN = 0;
  let tgtE = 0;
  let tgtN = 0;
  for (const p of pairs) {
    srcE += p.sourceE;
    srcN += p.sourceN;
    tgtE += p.targetE;
    tgtN += p.targetN;
  }
  srcE /= n;
  srcN /= n;
  tgtE /= n;
  tgtN /= n;
  if (!isFiniteNumber(srcE) || !isFiniteNumber(srcN) || !isFiniteNumber(tgtE) || !isFiniteNumber(tgtN)) {
    return { ok: false, reason: 'Helmert2D centroids are non-finite.' };
  }
  let spread = 0;
  let numA = 0;
  let numB = 0;
  for (const p of pairs) {
    const se = p.sourceE - srcE;
    const sn = p.sourceN - srcN;
    const te = p.targetE - tgtE;
    const tn = p.targetN - tgtN;
    spread += se * se + sn * sn;
    numA += se * te + sn * tn;
    numB += se * tn - sn * te;
  }
  if (!isFiniteNumber(spread) || !isFiniteNumber(numA) || !isFiniteNumber(numB)) {
    return { ok: false, reason: 'Helmert2D normal equations are non-finite.' };
  }
  // Degenerate when the source spread is zero or negligible relative to magnitude
  // (coincident sources lose all orientation information in float64).
  const mag2 = srcE * srcE + srcN * srcN;
  if (!(spread > 1e-24 * Math.max(1, mag2))) {
    return { ok: false, reason: 'Helmert2D sources are coincident or have near-zero spread.' };
  }
  let a: number;
  let b: number;
  let scale: number;
  if (mode === 'RIGID') {
    const length = Math.hypot(numA, numB);
    if (!(length > 0) || !isFiniteNumber(length)) {
      return { ok: false, reason: 'Helmert2D RIGID rotation is undefined (degenerate targets).' };
    }
    a = numA / length;
    b = numB / length;
    scale = 1;
  } else {
    a = numA / spread;
    b = numB / spread;
    scale = Math.hypot(a, b);
    if (!(scale > 0) || !isFiniteNumber(scale)) {
      return { ok: false, reason: 'Helmert2D similarity scale is degenerate.' };
    }
  }
  if (!isFiniteNumber(a) || !isFiniteNumber(b)) {
    return { ok: false, reason: 'Helmert2D solution is non-finite.' };
  }
  const translationE = tgtE - a * srcE + b * srcN;
  const translationN = tgtN - b * srcE - a * srcN;
  if (!isFiniteNumber(translationE) || !isFiniteNumber(translationN)) {
    return { ok: false, reason: 'Helmert2D translation is non-finite.' };
  }
  const transform: CadTransform2D = { a, b, c: -b, d: a, tx: translationE, ty: translationN };
  const rotationDeg = Math.atan2(b, a) * DEG_PER_RAD;
  const residuals: HelmertResidual[] = pairs.map((p) => {
    const dE = translationE + a * p.sourceE - b * p.sourceN - p.targetE;
    const dN = translationN + b * p.sourceE + a * p.sourceN - p.targetN;
    return { dE, dN, r: Math.hypot(dE, dN) };
  });
  let sumSq = 0;
  let maxResidual = 0;
  for (const r of residuals) {
    sumSq += r.r * r.r;
    if (r.r > maxResidual) maxResidual = r.r;
  }
  const rmsResidual = Math.sqrt(sumSq / n);
  return {
    ok: true,
    transform,
    translationE,
    translationN,
    rotationDeg,
    scale,
    scalePpm: (scale - 1) * 1e6,
    residuals,
    rmsResidual,
    maxResidual,
  };
}

const finitePoint = (p: AlignPoint): boolean => isFiniteNumber(p.e) && isFiniteNumber(p.n);

export function deriveAlign2DTransform(
  source1: AlignPoint,
  source2: AlignPoint,
  target1: AlignPoint,
  target2: AlignPoint,
  scaleToFit: boolean,
): AlignResult {
  for (const p of [source1, source2, target1, target2]) {
    if (!p || !finitePoint(p)) return { ok: false, reason: 'ALIGN2D points must be finite.' };
  }
  const dsE = source2.e - source1.e;
  const dsN = source2.n - source1.n;
  const dtE = target2.e - target1.e;
  const dtN = target2.n - target1.n;
  const srcLen = Math.hypot(dsE, dsN);
  if (!(srcLen > 0) || !isFiniteNumber(srcLen)) {
    return { ok: false, reason: 'ALIGN2D source points are coincident.' };
  }
  const tgtLen = Math.hypot(dtE, dtN);
  let scale = 1;
  if (scaleToFit) {
    const mag = Math.max(1, Math.abs(target1.e), Math.abs(target1.n));
    if (!(tgtLen > 1e-12 * mag) || !isFiniteNumber(tgtLen)) {
      return { ok: false, reason: 'ALIGN2D target points are coincident.' };
    }
    scale = tgtLen / srcLen;
    if (!(scale > 0) || !isFiniteNumber(scale)) {
      return { ok: false, reason: 'ALIGN2D scale-to-fit is degenerate.' };
    }
  }
  const rotationDeg =
    (Math.atan2(dtN, dtE) - Math.atan2(dsN, dsE)) * DEG_PER_RAD;
  // Orientation-preserving only: rotate about source1, optional uniform scale
  // about source1, then translate source1 -> target1. Length preserved when rigid.
  const rotate = rotationAbout(source1.e, source1.n, rotationDeg);
  const move = translation(target1.e - source1.e, target1.n - source1.n);
  const transform = scaleToFit
    ? compose(move, compose(rotate, uniformScaleAbout(source1.e, source1.n, scale)))
    : compose(move, rotate);
  return {
    ok: true,
    transform,
    rotationDeg,
    scale,
    translationE: transform.tx,
    translationN: transform.ty,
  };
}

export function gridGroundTransform(
  originE: number,
  originN: number,
  combinedScaleFactor: number,
  direction: 'GRID_TO_GROUND' | 'GROUND_TO_GRID',
): GridGroundResult {
  if (!isFiniteNumber(originE) || !isFiniteNumber(originN)) {
    return { ok: false, reason: 'Grid/Ground origin must be finite.' };
  }
  if (!isFiniteNumber(combinedScaleFactor) || !(combinedScaleFactor > 0)) {
    return { ok: false, reason: 'Combined scale factor must be finite and > 0.' };
  }
  const effectiveFactor =
    direction === 'GRID_TO_GROUND' ? 1 / combinedScaleFactor : combinedScaleFactor;
  if (!isFiniteNumber(effectiveFactor) || !(effectiveFactor > 0)) {
    return { ok: false, reason: 'Grid/Ground effective factor is degenerate.' };
  }
  const formula =
    direction === 'GRID_TO_GROUND'
      ? `Grid->Ground: factor = 1/${combinedScaleFactor}`
      : `Ground->Grid: factor = ${combinedScaleFactor}`;
  return {
    ok: true,
    transform: uniformScaleAbout(originE, originN, effectiveFactor),
    effectiveFactor,
    formula,
  };
}
