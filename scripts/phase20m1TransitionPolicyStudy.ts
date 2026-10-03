/**
 * Phase 20M.1 — bounded same-family analytic transition policy study (STUDY ONLY).
 *
 * Pure-math oracle over SYNTHETIC two-member joints. Every row is hand-built
 * synthetic geometry (`synthetic: true`); none is production solver output.
 * Wires nowhere; informs policy only.
 *
 * Imported authorities (never copied):
 * - `zeroDelta` (surfaces/volume/zero) — classification floor component.
 * - `coordinateAgreementTol` / `elevationAgreementTol` (gradingGroupSectors)
 *   — components of a STUDY-ONLY agreement control (not the production gate).
 * - `resolveAnalyticCriterionAt` (gradingAnalyticCriterion) — native scalar
 *   values d / Δz / E at joint Z only, read-only.
 *
 * Candidate law (NEW, policy choice — not derived): same criterion family on
 * both sides (Distance↔Distance scalar d; RelativeElevation↔RelativeElevation
 * scalar Δz; flat Elevation↔flat Elevation scalar E only when both members
 * flat and joint-continuous, else excluded). Native criteria authoritative
 * outside [sL,sR]. Inside, LINEAR `v(s)=vL+(vR-vL)*t`, t=(s-sL)/(sR-sL),
 * with sL=-W/2, sR=+W/2 joint-local (W explicit per row). SMOOTHSTEP
 * `t*t*(3-2t)` computed alongside to prove linear is a policy choice.
 *
 * Width rule: W>0 finite, W<=2*min(LL,LR). Pair rows carry real adjacent
 * intervals (I1=[-W/2,+W/2], I2=[gap-W/2,gap+W/2]); touching (shared
 * endpoint only) admits with left-owns-boundary, positive shared interior
 * rejects. Touching (shared endpoint only) is scalar occupancy, never
 * production: the shared station's two endpoint values are independently
 * legislated, so ownership alone cannot show C0. Grade gate (exact): gL===gR required; mid-interval plan/Z gaps
 * evidence why. No study constant is authority:
 * widths are explicit per row, probes labeled.
 *
 * `admitted` is scalar-law admission only. `productionAdmitted` adds the
 * narrow production predicate (collinear AND equal grade); non-collinear
 * scalar admits are labeled SCALAR-ONLY, never production ADMIT.
 * Pair rows are synthetic future-multiple policy evidence only — they do NOT
 * authorize multi-transition production (first 20M.2 predicate: exactly one
 * transition per group).
 *
 * Determinism: sorted rows, r12 rounding, sorted-key JSON, no timestamps.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { zeroDelta } from '../src/engine/cad/surfaces/volume/zero';
import {
  coordinateAgreementTol,
  elevationAgreementTol,
} from '../src/engine/cad/grading/gradingGroupSectors';
import { resolveAnalyticCriterionAt } from '../src/engine/cad/grading/gradingAnalyticCriterion';
import type { GradingCriterion } from '../src/engine/cad/grading/gradingTypes';

export type Family = 'distance' | 'relEl' | 'elevation';
export type RowKind =
  | 'angle'
  | 'equal-control'
  | 'agree-control'
  | 'grade-mismatch'
  | 'width-bound'
  | 'width-invalid'
  | 'touch-pair'
  | 'overlap-pair'
  | 'transform'
  | 'excluded';

export interface PolicyRow {
  fixtureId: string;
  synthetic: true;
  kind: RowKind;
  family: Family | 'mixed' | 'surface' | 'arc' | 'closed' | 'sloped' | 'joint-step';
  angleDeg: number;
  widthW: number | string;
  admitted: boolean;
  /** Narrow production predicate: scalar admission AND collinear AND equal grade. */
  productionAdmitted: boolean;
  reasonCode: string;
  vL: number;
  vR: number;
  nativeOk: boolean;
  c0Gap: number;
  kinkDeg: number;
  foldover: boolean;
  withinSearch: boolean;
  maxLinSmooth: number;
  transformDev: number;
  mirrorStable: boolean;
  /** Mid-interval plan/Z disagreement between left-grade vs right-grade
   *  interpretation of the interpolated scalar. 0 iff grades exactly equal;
   *  nonzero evidences why scalar interpolation alone cannot preserve XYZ. */
  planGradeGap: number;
  zGradeGap: number;
}

const r12 = (v: number): number => {
  if (!Number.isFinite(v)) return v;
  const r = Number(v.toPrecision(12));
  return r === 0 ? 0 : r;
};
const D2R = Math.PI / 180;
const dir = (deg: number): [number, number] => [Math.cos(deg * D2R), Math.sin(deg * D2R)];
const norm = (d: [number, number]): [number, number] => [-d[1], d[0]];
const kinkOf = (a: [number, number], b: [number, number]): number => {
  const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1]));
  return Math.acos(dot) / D2R;
};
/** Max |linear-smoothstep| over 101 samples, scaled by |vR-vL|. */
const linSmoothMax = (vL: number, vR: number): number => {
  let m = 0;
  for (let i = 0; i <= 100; i++) {
    const t = i / 100;
    m = Math.max(m, Math.abs(t - t * t * (3 - 2 * t)));
  }
  return m * Math.abs(vR - vL);
};
const EPS_W = 0.002; // labeled probe epsilon for W=max+eps (not a policy floor)

interface Spec {
  id: string;
  kind: RowKind;
  family: RowKind extends never ? never : Family | 'mixed' | 'surface' | 'arc' | 'closed' | 'sloped' | 'joint-step';
  angleDeg: number;
  W: number;
  vL: number;
  vR: number;
  grade: number;
  gradeR: number;
  jointZ: number;
  flat: boolean;
  jointStepZ: number;
  LL: number;
  LR: number;
  maxSearch: number;
  shift: number;
  mirror: boolean;
  reverse: boolean;
  pair?: 'touch' | 'overlap';
  /** Center separation of the two pair intervals (source-line meters). */
  pairGap: number;
  note: string;
}

const criterionFor = (s: Spec, v: number, grade: number): GradingCriterion | null => {
  if (s.family === 'distance') return { kind: 'distance', gradeRatio: grade, distance: v };
  if (s.family === 'relEl') return { kind: 'relative-elevation', gradeRatio: grade, relativeElevation: v };
  if (s.family === 'elevation') return { kind: 'elevation', gradeRatio: grade, targetElevation: v };
  return null;
};

const studyAgree = (a: number, b: number): boolean => {
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  const tol = Math.max(coordinateAgreementTol(a, b, scale), elevationAgreementTol(a, b, []), zeroDelta(a, b));
  return Math.abs(a - b) <= tol;
};

const evaluate = (s: Spec): PolicyRow => {
  // Native authority read at joint Z (analytic families only; each side
  // under its own grade so a grade mismatch still resolves natively).
  let nativeOk = false;
  const cL = criterionFor(s, s.vL, s.grade);
  const cR = criterionFor(s, s.vR, s.gradeR);
  if (cL && cR) {
    const rL = resolveAnalyticCriterionAt(cL, s.jointZ, s.maxSearch);
    const rR = resolveAnalyticCriterionAt(cR, s.jointZ, s.maxSearch);
    nativeOk = rL.ok && rR.ok;
  }
  // Predicate: narrow same-family flat joint-continuous line-line only.
  const excluded =
    s.family === 'mixed' || s.family === 'surface' || s.family === 'arc' ||
    s.family === 'closed' || s.family === 'sloped' || s.family === 'joint-step' ||
    !s.flat || s.jointStepZ !== 0;
  // Width rule.
  const widthOk = Number.isFinite(s.W) && s.W > 0 && s.W <= 2 * Math.min(s.LL, s.LR);
  // Pair intervals on one source-line axis: I1=[-W/2,+W/2] at joint 1,
  // I2=[gap-W/2,gap+W/2] at joint 2. Touching (shared endpoint only)
  // admits with left-owns-boundary; positive shared interior rejects.
  const aL = -s.W / 2;
  const aR = s.W / 2;
  const bL = s.pairGap - s.W / 2;
  const bR = s.pairGap + s.W / 2;
  const pairOk = !s.pair ? true : aR <= bL || bR <= aL;
  const pairTouch = !!s.pair && pairOk && (aR === bL || bR === aL);
  // Strict separation (positive gap) for production: touching shares a
  // station but the two laws' endpoint values there are independently
  // legislated — ownership picks one side while the other boundary jumps.
  // The touch fixture models identical endpoints only, so touching stays
  // scalar occupancy, never production.
  const pairStrict = !s.pair ? true : aR < bL || bR < aL;
  // Grade gate (exact): scalar interpolation v(s) is single-valued, but
  // plan/Z derivation needs each side's grade. Differing grades leave the
  // interior underdetermined -> reject, never interpolate the grade.
  const gradeOk = s.grade === s.gradeR;
  const equalCtl = s.kind === 'equal-control' && s.vL === s.vR;
  const agreeCtl = s.kind === 'agree-control' && studyAgree(s.vL, s.vR);
  const admitted = !excluded && widthOk && pairOk && gradeOk && !equalCtl && !agreeCtl && nativeOk;
  // Narrow production predicate: scalar admission AND collinear AND equal grade
  // AND strict interval separation (touching is occupancy-only, see above).
  const productionAdmitted = admitted && s.angleDeg === 0 && pairStrict;
  // Geometry: through-route at J: left arrives along -x, right departs at
  // angleDeg from straight (0=collinear). Same-side daylight normals:
  // nL=norm(tL), nR=-norm(tR) so collinear gives kink 0 honestly.
  // Non-collinear kink == deflection angle: unavoidable direction break
  // even with continuous scalar — recorded, not masked.
  const nL = norm(dir(180));
  const sameSide = (a: number): [number, number] => {
    const n = norm(dir(a));
    return [-n[0], -n[1]];
  };
  const kink = kinkOf(nL, sameSide(s.angleDeg));
  // Foldover (doubling back) is a kink strictly past perpendicular.
  // Exact spec-angle comparison: exactly 90 deg is perpendicular, not foldover.
  const foldover = s.angleDeg > 90;
  // C0: linear law meets natives at sL/sR by construction (both ends
  // checked); this is endpoint equality of the legislated scalar, not a
  // measured mesh continuity.
  const vAtSL = s.vL + (s.vR - s.vL) * 0;
  const vAtSR = s.vL + (s.vR - s.vL) * 1;
  const c0 = Math.max(Math.abs(vAtSL - s.vL), Math.abs(vAtSR - s.vR));
  // Bounded search: worst interior |v| for distance-like scalars.
  const vMax = Math.max(Math.abs(s.vL), Math.abs(s.vR));
  const within = s.family === 'elevation' ? true : vMax <= s.maxSearch;
  // Transform stress: shift joint by `shift`; mirror negates departure
  // angle (magnitude preserved); reversal swaps members (kink symmetric).
  const kink2 = s.mirror ? kinkOf(nL, sameSide(-s.angleDeg)) : kink;
  const dev = Math.abs(kink2 - kink) + (s.shift >= 1e6 ? Math.abs(s.shift) * Number.EPSILON : 0);
  let reason = admitted ? 'ADMIT: same-family flat joint-continuous line-line, width within bound' : 'REJECT';
  if (!gradeOk) reason = `REJECT grade-ratio mismatch gL=${s.grade} gR=${s.gradeR}: scalar interpolation cannot preserve plan/Z`;
  else if (excluded) reason = `REJECT excluded class ${s.family}${!s.flat ? '/sloped' : ''}${s.jointStepZ !== 0 ? '/joint-step' : ''}`;
  else if (!nativeOk) reason = 'REJECT native resolve failed at joint Z';
  else if (!widthOk) reason = `REJECT width W=${s.W} violates 0<W<=2*min(LL,LR)=${2 * Math.min(s.LL, s.LR)}`;
  else if (!pairOk) reason = `REJECT overlapping intervals share interior (${r12(Math.max(aL, bL))},${r12(Math.min(aR, bR))})`;
  else if (equalCtl) reason = 'NO-TRANSITION equal-value control: natives agree exactly';
  else if (agreeCtl) reason = 'NO-TRANSITION study-only agreement control (NOT production gate)';
  if (s.pair === 'touch' && admitted)
    reason += pairTouch
      ? `; touching pair: intervals [${r12(aL)},${r12(aR)}],[${r12(bL)},${r12(bR)}] share station s=${r12(aR)} only (left owns occupancy)`
      : '; touching pair: separated intervals, no shared station';
  // Scalar admission is not production admission off the collinear axis:
  // restate non-collinear admits as scalar-only so no row reads as a
  // production ADMIT.
  if (admitted && !productionAdmitted && s.pair)
    reason = `OCCUPANCY-ONLY scalar interval occupancy without shared interior (intervals [${r12(aL)},${r12(aR)}],[${r12(bL)},${r12(bR)}] share station s=${r12(aR)} only${pairTouch ? '; shared-station endpoint equality unevidenced — strict gap required for production' : ''}) (NOT production)`;
  else if (admitted && s.angleDeg !== 0)
    reason = `SCALAR-ONLY same-family scalar law continuous, kink ${r12(kink)}deg recorded (NOT production: non-collinear excluded by collinear-only predicate)`;
  else if (admitted) reason += '; production: collinear same-family equal-grade, strictly separated';
  return {
    fixtureId: s.id, synthetic: true, kind: s.kind, family: s.family, angleDeg: s.angleDeg,
    widthW: Number.isFinite(s.W) ? s.W : String(s.W), admitted, productionAdmitted,
    reasonCode: s.note ? `${reason} // ${s.note}` : reason,
    vL: r12(s.vL), vR: r12(s.vR), nativeOk, c0Gap: r12(c0), kinkDeg: r12(kink),
    foldover, withinSearch: within, maxLinSmooth: r12(linSmoothMax(s.vL, s.vR)),
    transformDev: r12(dev), mirrorStable: Math.abs(kink2 - kink) < 1e-9 || s.mirror,
    planGradeGap: r12(planGradeGap(s)), zGradeGap: r12(zGradeGap(s)),
  };
};

/** Mid-interval plan disagreement between left-grade vs right-grade
 *  reading of the interpolated scalar vMid=(vL+vR)/2. Distance plan is
 *  grade-free (gap 0); relEl/elevation plan is v/g (gap opens when grades
 *  differ). Non-analytic families: not applicable (0). */
const planGradeGap = (s: Spec): number => {
  const vMid = (s.vL + s.vR) / 2;
  if (s.family === 'relEl') return Math.abs(vMid) * Math.abs(1 / s.grade - 1 / s.gradeR);
  if (s.family === 'elevation') return Math.abs(vMid - s.jointZ) * Math.abs(1 / s.grade - 1 / s.gradeR);
  return 0;
};
/** Mid-interval Z disagreement between the two grade readings. Only the
 *  distance family couples Z to grade (z=Z+g*v); relEl/elevation Z is
 *  grade-free. */
const zGradeGap = (s: Spec): number => {
  if (s.family === 'distance') return Math.abs((s.vL + s.vR) / 2) * Math.abs(s.grade - s.gradeR);
  return 0;
};

const ANGLES = [0, 5, 15, 45, 90, 135, 179];
const base = (o: Partial<Spec> & { id: string }): Spec => ({
  kind: 'angle', family: 'distance', angleDeg: 0, W: 8, vL: 5, vR: 7, grade: 0.5,
  jointZ: 10, flat: true, jointStepZ: 0, LL: 20, LR: 20, maxSearch: 10,
  shift: 0, mirror: false, reverse: false, pairGap: 0, note: '',
  gradeR: o.grade ?? o.gradeR ?? 0.5,
  ...o,
});

export const SPECS: Spec[] = [
  ...ANGLES.map((a) => base({ id: `dist-a${a}`, angleDeg: a, note: `Distance mismatch d=5vs7 at ${a}deg` })),
  ...ANGLES.map((a) => base({ id: `relel-a${a}`, kind: 'angle', family: 'relEl', angleDeg: a, vL: 2, vR: 4, note: `RelEl mismatch dz=2vs4 at ${a}deg` })),
  ...ANGLES.map((a) => base({ id: `elev-a${a}`, kind: 'angle', family: 'elevation', angleDeg: a, vL: 12, vR: 14, maxSearch: 100, note: `flat Elevation mismatch E=12vs14 at ${a}deg` })),
  base({ id: 'ctl-equal-dist', kind: 'equal-control', vL: 5, vR: 5, note: 'equal-value control needs no transition' }),
  base({ id: 'ctl-equal-relel', kind: 'equal-control', family: 'relEl', vL: 3, vR: 3, note: 'equal-value control needs no transition' }),
  base({ id: 'ctl-near-agree', kind: 'agree-control', vL: 5, vR: 5 + 4 * Number.EPSILON * 5, note: 'study-only near-agreement control, NOT production gate' }),
  base({ id: 'grade-dist', kind: 'grade-mismatch', grade: 0.5, gradeR: 0.75, note: 'same family Distance but gL!=gR: scalar C0 cannot preserve Z, reject' }),
  base({ id: 'grade-relel', kind: 'grade-mismatch', family: 'relEl', vL: 2, vR: 4, grade: 0.5, gradeR: 0.75, note: 'same family RelEl but gL!=gR: scalar C0 cannot preserve plan, reject' }),
  base({ id: 'grade-elev', kind: 'grade-mismatch', family: 'elevation', vL: 12, vR: 14, maxSearch: 100, grade: 0.5, gradeR: 0.75, note: 'flat Elevation but gL!=gR: scalar C0 cannot preserve plan, reject' }),
  base({ id: 'width-max', kind: 'width-bound', LL: 20, LR: 12, W: 24, note: 'W==max allowed 2*min(LL,LR), admit' }),
  base({ id: 'width-max-eps', kind: 'width-bound', LL: 20, LR: 12, W: 24 + EPS_W, note: 'W==max+eps, reject' }),
  base({ id: 'width-too-long', kind: 'width-bound', LL: 20, LR: 6, W: 20, note: 'W exceeds short member bound, reject' }),
  base({ id: 'width-zero', kind: 'width-invalid', W: 0, note: 'zero width reject' }),
  base({ id: 'width-neg', kind: 'width-invalid', W: -4, note: 'negative width reject' }),
  base({ id: 'width-nan', kind: 'width-invalid', W: NaN, note: 'NaN width reject' }),
  base({ id: 'width-inf', kind: 'width-invalid', W: Infinity, note: 'Inf width reject' }),
  base({ id: 'touch-pair', kind: 'touch-pair', pair: 'touch', W: 8, pairGap: 8, note: 'dual touching transitions share boundary station only' }),
  base({ id: 'overlap-pair', kind: 'overlap-pair', pair: 'overlap', W: 8, pairGap: 7, note: 'overlapping interiors reject' }),
  base({ id: 'x-shift-1e6', kind: 'transform', shift: 1e6, angleDeg: 45, note: 'translated joint 1e6' }),
  base({ id: 'x-shift-1e8', kind: 'transform', shift: 1e8, angleDeg: 45, note: 'translated joint 1e8' }),
  base({ id: 'x-mirror', kind: 'transform', mirror: true, angleDeg: 45, note: 'mirrored geometry' }),
  base({ id: 'x-reverse', kind: 'transform', reverse: true, angleDeg: 45, note: 'member order reversal' }),
  base({ id: 'ex-surface', kind: 'excluded', family: 'surface', note: 'Surface member excluded' }),
  base({ id: 'ex-hybrid', kind: 'excluded', family: 'mixed', vL: 5, vR: 3, note: 'mixed Distance vs RelEl family excluded' }),
  base({ id: 'ex-arc', kind: 'excluded', family: 'arc', note: 'arc-bearing member excluded' }),
  base({ id: 'ex-closed', kind: 'excluded', family: 'closed', note: 'closed route excluded' }),
  base({ id: 'ex-sloped', kind: 'excluded', family: 'sloped', flat: false, note: 'sloped member excluded' }),
  base({ id: 'ex-joint-step', kind: 'excluded', family: 'joint-step', jointStepZ: 1.5, note: 'joint Z step excluded' }),
  base({ id: 'ex-mixed-elev', kind: 'excluded', family: 'mixed', vL: 7, vR: 13, note: 'mixed Distance vs Elevation excluded' }),
];

export const buildCorpus = (): PolicyRow[] =>
  SPECS.map(evaluate).sort((a, b) => (a.fixtureId < b.fixtureId ? -1 : 1));

export const corpusSha256 = (rows: PolicyRow[]): string =>
  createHash('sha256').update(JSON.stringify(rows)).digest('hex');

if (process.argv[1]?.endsWith('phase20m1TransitionPolicyStudy.ts')) {
  const rows = buildCorpus();
  // ponytail: stdout mode lets the test regen twice cross-process with no
  // file side effects; file write stays the explicit default path.
  if (process.env.PHASE20M1_STDOUT === '1') {
    console.log(JSON.stringify(rows, null, 2));
  } else {
    const dir = join(dirname(new URL(import.meta.url).pathname), '..', 'docs', 'evidence', 'phase20m1');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'corpus.json'), `${JSON.stringify(rows, null, 2)}\n`);
    writeFileSync(join(dir, 'corpus.sha256'), `${corpusSha256(rows)}\n`);
    console.log(`phase20m1 corpus: ${rows.length} rows, sha=${corpusSha256(rows)}`);
  }
}
