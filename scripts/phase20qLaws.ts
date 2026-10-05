/**
 * Phase 20Q STUDY ONLY — candidate vertical-profile law oracles as pure
 * functions. Imports production `evaluateTransitionLinearV1`,
 * `resolveAnalyticCriterionAt`, `transitionDaylightAt` and
 * `gradingSideNormal` (never copies their math). Zero `src/` edits.
 */
import { evaluateTransitionLinearV1 } from '../src/engine/cad/grading/gradingTransitionPolicy';
import { resolveAnalyticCriterionAt } from '../src/engine/cad/grading/gradingAnalyticCriterion';
import { transitionDaylightAt } from '../src/engine/cad/grading/gradingGroupTransitionTile';
import { gradingSideNormal } from '../src/engine/cad/grading/gradingCourseFrame';
import type { GradingCriterion } from '../src/engine/cad/grading/gradingTypes';
import type { Phase20qCase, Phase20qCriterion } from './phase20qFixtures';

export type Phase20qLawId = 'S1' | 'S2' | 'S3' | 'J1' | 'J2' | 'J3' | 'J4';
export const PHASE20Q_SLOPED_LAWS: Phase20qLawId[] = ['S1', 'S2', 'S3'];
export const PHASE20Q_STEP_LAWS: Phase20qLawId[] = ['J1', 'J2', 'J3', 'J4'];
/** S3 smoothing tension: exposed debt, never defaulted (fail if hidden). */
// ponytail: fixed tau 0.5, sweep the tension response if S3 survives triage
export const PHASE20Q_S3_TAU = 0.5;

export interface Phase20qStation {
  s: number;
  tag: 'cutL' | 'midL' | 'jointL' | 'jointR' | 'midR' | 'cutR' | 'end0' | 'end1';
}

/** Native (production) source + daylight at station s, via production helpers. */
export const phase20qNativePoint = (
  c: Phase20qCase,
  s: number,
  leftSide: boolean,
  shift?: { dx?: number; dy?: number; dz?: number },
): { srcX: number; srcY: number; srcZ: number; scalarV: number; dayX: number; dayY: number; dayZ: number; d: number } => {
  const dx = shift?.dx ?? 0;
  const dy = shift?.dy ?? 0;
  const dz = shift?.dz ?? 0;
  const joint = c.LL;
  const zSrc =
    (leftSide
      ? c.jointZL + c.srcSlopeL * (s - joint)
      : c.jointZR + c.srcSlopeR * (s - joint)) + dz;
  const crit = asCriterion(leftSide ? c.criterionL : c.criterionR);
  const r = resolveOrThrow(crit, zSrc, c.maxSearchDistance, 'native');
  const v = scalarFrom(crit, zSrc, r.horizontalDistance, r.limitElevation);
  const { nx, ny } = normalOf(c.side);
  const q = transitionDaylightAt(c.family, v, c.gradeRatio, zSrc, s + dx, dy, nx, ny);
  return { srcX: s + dx, srcY: dy, srcZ: zSrc, scalarV: v, dayX: q.x, dayY: q.y, dayZ: q.z, d: q.d };
};

/** Deterministic sample stations: cuts, joint (both sides), mids, ends. */
export const phase20qStations = (c: Phase20qCase): Phase20qStation[] => {
  const joint = c.LL;
  const cutL = joint + c.sL;
  const cutR = joint + c.sR;
  const raw: Phase20qStation[] = [
    { s: 0, tag: 'end0' },
    { s: cutL, tag: 'cutL' },
    { s: (cutL + joint) / 2, tag: 'midL' },
    { s: joint, tag: 'jointL' },
    { s: joint, tag: 'jointR' },
    { s: (joint + cutR) / 2, tag: 'midR' },
    { s: cutR, tag: 'cutR' },
    { s: c.total, tag: 'end1' },
  ];
  const seen = new Set<string>();
  return raw.filter((st) => {
    const key = `${st.s}|${st.tag}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export interface Phase20qLawPoint {
  s: number;
  tag: string;
  srcX: number;
  srcY: number;
  srcZ: number;
  scalarV: number;
  dayX: number;
  dayY: number;
  dayZ: number;
  d: number;
  /** Native-criterion residual at this station (null when unresolvable). */
  residual: number | null;
}

export interface Phase20qLawResult {
  law: Phase20qLawId;
  vL: number;
  vR: number;
  points: Phase20qLawPoint[];
  maxResidual: number | null;
  c0JointGap: number;
  c0CutL: number;
  c0CutR: number;
  /** Source tangent deflection at the joint (radians, vertical plane). */
  c1Source: number;
  /** Daylight tangent deflection across the joint (radians). */
  c1Daylight: number;
  rejectReason: string | null;
  authorityViolation: boolean;
  tensionParam: number | null;
}

const asCriterion = (c: Phase20qCriterion): GradingCriterion => c as GradingCriterion;

/** Endpoint scalar from a resolution only (never a second formula). */
const scalarFrom = (
  criterion: GradingCriterion,
  sourceZ: number,
  horizontalDistance: number,
  limitElevation: number,
): number => {
  if (criterion.kind === 'distance') return horizontalDistance;
  if (criterion.kind === 'relative-elevation') return limitElevation - sourceZ;
  return limitElevation;
};

const resolveOrThrow = (
  criterion: GradingCriterion,
  sourceZ: number,
  maxSearch: number,
  what: string,
): { horizontalDistance: number; limitElevation: number } => {
  const r = resolveAnalyticCriterionAt(criterion, sourceZ, maxSearch);
  if (!r.ok) throw new Error(`${what}: native unresolvable (${r.code})`);
  return r.value;
};

const jointStationOf = (c: Phase20qCase): number => c.LL;

const normalOf = (side: 'left' | 'right'): { nx: number; ny: number } => {
  const n = gradingSideNormal(1, 0, side);
  if (!n) throw new Error('degenerate +X frame');
  return n;
};

/** Physical piecewise-linear source Z (native per half, exact at joint). */
const physicalSourceZ = (c: Phase20qCase, s: number, joint: number, leftSide: boolean): number =>
  leftSide
    ? c.jointZL + c.srcSlopeL * (s - joint)
    : c.jointZR + c.srcSlopeR * (s - joint);

/** S2 control: cosine-smoothed Z bridge across [sL, sR] (authority-violating). */
const smoothedBridgeZ = (c: Phase20qCase, s: number, joint: number, sLo: number, sHi: number): number => {
  const zl = c.jointZL + c.srcSlopeL * (s - joint);
  const zr = c.jointZR + c.srcSlopeR * (s - joint);
  const t = (s - sLo) / (sHi - sLo);
  const w = (1 - Math.cos(Math.PI * t)) / 2;
  return (1 - w) * zl + w * zr;
};

export const evaluatePhase20qLaw = (
  law: Phase20qLawId,
  c: Phase20qCase,
  stations: Phase20qStation[],
  tensionTau?: number,
  shift?: { dx?: number; dy?: number; dz?: number },
): Phase20qLawResult => {
  const joint = jointStationOf(c);
  const sLo = joint + c.sL;
  const sHi = joint + c.sR;
  const { nx, ny } = normalOf(c.side);
  const critL = asCriterion(c.criterionL);
  const critR = asCriterion(c.criterionR);
  // Endpoint scalars resolve at each half's own joint Z (coincide if continuous).
  const resL = resolveOrThrow(critL, c.jointZL, c.maxSearchDistance, 'vL');
  const resR = resolveOrThrow(critR, c.jointZR, c.maxSearchDistance, 'vR');
  const vL = scalarFrom(critL, c.jointZL, resL.horizontalDistance, resL.limitElevation);
  const vR = scalarFrom(critR, c.jointZR, resR.horizontalDistance, resR.limitElevation);
  if (law === 'S3' && tensionTau === undefined) {
    throw new Error('S3 tension tau hidden: pass PHASE20Q_S3_TAU explicitly');
  }
  const tau = law === 'S3' ? tensionTau! : null;
  const dx = shift?.dx ?? 0;
  const dy = shift?.dy ?? 0;
  const dz = shift?.dz ?? 0;
  // Daylight-Z bridge endpoints for J3/S3 (physical Z at the cuts).
  const bridgeEndZ = (sideL: boolean): number => {
    const sCut = sideL ? sLo : sHi;
    const zSrc = physicalSourceZ(c, sCut, joint, sideL) + dz;
    const vCut = evaluateTransitionLinearV1(vL, vR, c.sL, c.sR, sCut - joint);
    return transitionDaylightAt(c.family, vCut, c.gradeRatio, zSrc, sCut + dx, dy, nx, ny).z;
  };
  const bridgeZL = law === 'J3' || law === 'S3' ? bridgeEndZ(true) : NaN;
  const bridgeZR = law === 'J3' || law === 'S3' ? bridgeEndZ(false) : NaN;

  const sourceZAt = (s: number, leftSide: boolean): number => {
    if (law === 'S2') {
      if (s < sLo || s > sHi) return physicalSourceZ(c, s, joint, s < joint);
      return smoothedBridgeZ(c, s, joint, sLo, sHi);
    }
    if (law === 'J2') {
      if (s <= sLo) return c.jointZL + c.srcSlopeL * (sLo - joint) + c.srcSlopeL * (s - sLo);
      if (s >= sHi) return c.jointZR + c.srcSlopeR * (sHi - joint) + c.srcSlopeR * (s - sHi);
      const t = (s - sLo) / (sHi - sLo);
      return c.jointZL + (c.jointZR - c.jointZL) * t;
    }
    return physicalSourceZ(c, s, joint, leftSide);
  };

  const at = (s: number, leftSide: boolean, tag: string): Phase20qLawPoint => {
    const v = evaluateTransitionLinearV1(vL, vR, c.sL, c.sR, s - joint);
    const zSrc = sourceZAt(s, leftSide) + dz;
    const zForDaylight =
      law === 'J4' ? c.jointZL + dz : zSrc;
    const dl = transitionDaylightAt(c.family, v, c.gradeRatio, zForDaylight, s + dx, dy, nx, ny);
    let dayZ = dl.z;
    if (law === 'J3' || law === 'S3') {
      if (s >= sLo && s <= sHi) {
        const t = (s - sLo) / (sHi - sLo);
        dayZ = bridgeZL + (bridgeZR - bridgeZL) * t;
        if (law === 'S3') dayZ = (1 - tau!) * dl.z + tau! * dayZ;
      }
    }
    const crit = leftSide ? critL : critR;
    const r = resolveAnalyticCriterionAt(crit, zSrc, c.maxSearchDistance);
    let residual: number | null = null;
    if (r.ok) {
      const obsD = Math.hypot(dl.x - (s + dx), dl.y - dy);
      residual =
        c.family === 'distance'
          ? Math.abs(obsD - r.value.horizontalDistance)
          : Math.abs(dayZ - r.value.limitElevation);
    }
    return { s, tag, srcX: s + dx, srcY: dy, srcZ: zSrc, scalarV: v, dayX: dl.x, dayY: dl.y, dayZ, d: dl.d, residual };
  };

  const points = stations.map((st) => at(st.s, st.tag === 'jointR' || st.tag === 'midR' || st.tag === 'cutR' || st.tag === 'end1' ? false : true, st.tag));
  let maxResidual: number | null = null;
  for (const p of points) {
    if (p.residual !== null) maxResidual = maxResidual === null ? p.residual : Math.max(maxResidual, p.residual);
  }
  const jL = at(joint, true, 'jointL');
  const jR = at(joint, false, 'jointR');
  const c0JointGap = Math.hypot(jL.dayX - jR.dayX, jL.dayY - jR.dayY, jL.dayZ - jR.dayZ);
  const cutPoint = (sCut: number, leftSide: boolean): number => {
    const p = at(sCut, leftSide, 'cut');
    const zN = physicalSourceZ(c, sCut, joint, leftSide) + dz;
    const crit = leftSide ? critL : critR;
    const rn = resolveOrThrow(crit, zN, c.maxSearchDistance, 'cut-native');
    const vN = scalarFrom(crit, zN, rn.horizontalDistance, rn.limitElevation);
    const q = transitionDaylightAt(c.family, vN, c.gradeRatio, zN, sCut + dx, dy, nx, ny);
    return Math.hypot(p.dayX - q.x, p.dayY - q.y, p.dayZ - q.z);
  };
  const c0CutL = cutPoint(sLo, true);
  const c0CutR = cutPoint(sHi, false);
  const c1Source = Math.abs(Math.atan2(c.srcSlopeR, 1) - Math.atan2(c.srcSlopeL, 1));
  const midL = at((sLo + joint) / 2, true, 'midL');
  const midR = at((joint + sHi) / 2, false, 'midR');
  const jx = joint + dx;
  const vIn = [jx - midL.dayX, dy - midL.dayY, ((jL.dayZ + jR.dayZ) / 2) - midL.dayZ];
  const vOut = [midR.dayX - jx, midR.dayY - dy, midR.dayZ - ((jL.dayZ + jR.dayZ) / 2)];
  const nIn = Math.hypot(vIn[0]!, vIn[1]!, vIn[2]!);
  const nOut = Math.hypot(vOut[0]!, vOut[1]!, vOut[2]!);
  const c1Daylight =
    nIn > 0 && nOut > 0
      ? Math.acos(Math.min(1, Math.max(-1, (vIn[0]! * vOut[0]! + vIn[1]! * vOut[1]! + vIn[2]! * vOut[2]!) / (nIn * nOut))))
      : 0;
  const rejectReason =
    law === 'S1' || law === 'J1' || law === 'J4'
      ? null
      : law === 'S2'
        ? 'AUTHORITY_VIOLATING_SMOOTHED_Z'
        : law === 'S3'
          ? `RESULT_Z_SMOOTHED_TENSION_${String(tau)}`
          : law === 'J2'
            ? 'SOURCE_Z_BRIDGED_INVENTED'
            : 'DAYLIGHT_Z_BRIDGED';
  return {
    law,
    vL,
    vR,
    points,
    maxResidual,
    c0JointGap,
    c0CutL,
    c0CutR,
    c1Source,
    c1Daylight,
    rejectReason,
    authorityViolation: law === 'S2',
    tensionParam: tau,
  };
};

/**
 * Hybrid tiled points (mirrors production tiling): law oracle inside the
 * transition interval, production natives outside (never extrapolated V1).
 */
export const phase20qHybridPoints = (
  c: Phase20qCase,
  law: Phase20qLawId,
  tensionTau?: number,
  shift?: { dx?: number; dy?: number; dz?: number },
): Phase20qLawPoint[] => {
  const stations = phase20qStations(c);
  const joint = jointStationOf(c);
  const sLo = joint + c.sL;
  const sHi = joint + c.sR;
  const lawPts = evaluatePhase20qLaw(law, c, stations, tensionTau, shift).points;
  return lawPts.map((p, i) => {
    const st = stations[i]!;
    const leftSide = !(st.tag === 'jointR' || st.tag === 'midR' || st.tag === 'cutR' || st.tag === 'end1');
    if (p.s < sLo || p.s > sHi) {
      const n = phase20qNativePoint(c, p.s, leftSide, shift);
      return {
        s: p.s, tag: p.tag, srcX: n.srcX, srcY: n.srcY, srcZ: n.srcZ,
        scalarV: n.scalarV, dayX: n.dayX, dayY: n.dayY, dayZ: n.dayZ, d: n.d,
        residual: 0,
      };
    }
    return p;
  });
};

/**
 * Zero-slope / zero-step reduction: on the law's domain (inside the
 * interval; natives rule outside by construction) the law must reproduce
 * the production flat path (constant joint Z + legislated V1 +
 * transitionDaylightAt) bitwise exactly. True only on exact `===`.
 */
export const checkFlatReductionExact = (c: Phase20qCase, result: Phase20qLawResult): boolean | null => {
  if (!(c.srcSlopeL === 0 && c.srcSlopeR === 0 && c.step === 0)) return null;
  const joint = jointStationOf(c);
  const sLo = joint + c.sL;
  const sHi = joint + c.sR;
  const { nx, ny } = normalOf(c.side);
  for (const p of result.points) {
    if (p.s < sLo || p.s > sHi) continue;
    const v = evaluateTransitionLinearV1(result.vL, result.vR, c.sL, c.sR, p.s - joint);
    if (!(v === p.scalarV)) return false;
    const q = transitionDaylightAt(c.family, v, c.gradeRatio, c.jointZ, p.s, 0, nx, ny);
    if (!(q.x === p.dayX && q.y === p.dayY && q.z === p.dayZ)) return false;
  }
  return true;
};
