/**
 * Phase 20Q STUDY ONLY — deterministic fixture builders (vertical-profile
 * transition laws). Zero `src/` edits, zero production imports: pure data
 * plus exact arithmetic. Joint continuity uses one shared variable (never
 * epsilon equality); a case is continuous iff `step === 0` exactly.
 */
export type Phase20qFamily = 'distance' | 'relative-elevation' | 'elevation';
export type Phase20qSide = 'left' | 'right';
export type Phase20qMatrix = 'sloped' | 'step';

export type Phase20qCriterion =
  | { kind: 'distance'; gradeRatio: number; distance: number }
  | { kind: 'relative-elevation'; gradeRatio: number; relativeElevation: number }
  | { kind: 'elevation'; gradeRatio: number; targetElevation: number };

export interface Phase20qCase {
  caseId: string;
  matrix: Phase20qMatrix;
  slopePattern: string;
  slopeMag: number;
  family: Phase20qFamily;
  side: Phase20qSide;
  LL: number;
  LR: number;
  total: number;
  startX: number;
  startY: number;
  startZ: number;
  jointX: number;
  jointY: number;
  /** Left member end Z (authoritative joint Z for sloped cases). */
  jointZL: number;
  /** Right member start Z (differs from jointZL iff step !== 0). */
  jointZR: number;
  endX: number;
  endY: number;
  endZ: number;
  /** Source grades dZ/ds per half (plan is collinear forward along +X). */
  srcSlopeL: number;
  srcSlopeR: number;
  jointZ: number;
  /** jointZR - jointZL; continuous iff exactly 0 (never epsilon-tied). */
  step: number;
  W: number;
  sL: number;
  sR: number;
  gradeRatio: number;
  maxSearchDistance: number;
  criterionL: Phase20qCriterion;
  criterionR: Phase20qCriterion;
}

export const PHASE20Q_GRADE = 0.5;
export const PHASE20Q_LL = 30;
export const PHASE20Q_LR = 50;
export const PHASE20Q_JOINT_Z = 10;
export const PHASE20Q_MAX_SEARCH = 500;
const FAMILIES: Phase20qFamily[] = ['distance', 'relative-elevation', 'elevation'];
const SIDES: Phase20qSide[] = ['left', 'right'];
const FULL_MAGS = [0.000000001, 0.01, 0.05, 0.15, 0.5];
const NARROW_MAGS = [0.01, 0.05, 0.15];

interface SlopePattern {
  name: string;
  mags: number[];
  slopes: (_m: number) => [number, number];
}

const SLOPE_PATTERNS: SlopePattern[] = [
  { name: 'EQ_POS', mags: FULL_MAGS, slopes: (m) => [m, m] },
  { name: 'EQ_NEG', mags: FULL_MAGS, slopes: (m) => [-m, -m] },
  { name: 'FLAT_TO_POS', mags: FULL_MAGS, slopes: (m) => [0, m] },
  { name: 'POS_TO_FLAT', mags: FULL_MAGS, slopes: (m) => [m, 0] },
  { name: 'STEEPER', mags: NARROW_MAGS, slopes: (m) => [m, 2 * m] },
  { name: 'SHALLOWER', mags: NARROW_MAGS, slopes: (m) => [2 * m, m] },
  { name: 'CREST', mags: FULL_MAGS, slopes: (m) => [m, -m] },
  { name: 'SAG', mags: FULL_MAGS, slopes: (m) => [-m, m] },
  { name: 'FLAT_FLAT', mags: [0], slopes: () => [0, 0] },
];

/** Exactly 1 ULP above 10 in binary64 (1.25 rounded half-to-even to 1 ULP). */
export const PHASE20Q_ULP_STEP = 10 * (1 + Number.EPSILON) - 10;
const STEP_MAGS = [
  PHASE20Q_ULP_STEP,
  0.001,
  0.01,
  0.1,
  1,
  10,
];
const WIDTHS_SLOPED = [2, 10, 2 * Math.min(PHASE20Q_LL, PHASE20Q_LR)];
const WIDTHS_STEP = [10, 2 * Math.min(PHASE20Q_LL, PHASE20Q_LR)];

const magTag = (m: number): string =>
  m === 0 ? 'm0' : m === PHASE20Q_ULP_STEP ? 'mULP' : `m${String(m).replace('.', 'p')}`;
const widthTag = (w: number): string => `W${String(w).replace('.', 'p')}`;

const criteriaFor = (
  family: Phase20qFamily,
  maxSourceZ: number,
): { criterionL: Phase20qCriterion; criterionR: Phase20qCriterion } => {
  if (family === 'distance') {
    return {
      criterionL: { kind: 'distance', gradeRatio: PHASE20Q_GRADE, distance: 5 },
      criterionR: { kind: 'distance', gradeRatio: PHASE20Q_GRADE, distance: 7 },
    };
  }
  if (family === 'relative-elevation') {
    return {
      criterionL: { kind: 'relative-elevation', gradeRatio: PHASE20Q_GRADE, relativeElevation: 2.5 },
      criterionR: { kind: 'relative-elevation', gradeRatio: PHASE20Q_GRADE, relativeElevation: 3.5 },
    };
  }
  return {
    criterionL: { kind: 'elevation', gradeRatio: PHASE20Q_GRADE, targetElevation: maxSourceZ + 2.5 },
    criterionR: { kind: 'elevation', gradeRatio: PHASE20Q_GRADE, targetElevation: maxSourceZ + 3.5 },
  };
};

const assembleCase = (
  caseId: string,
  matrix: Phase20qMatrix,
  slopePattern: string,
  slopeMag: number,
  family: Phase20qFamily,
  side: Phase20qSide,
  srcSlopeL: number,
  srcSlopeR: number,
  jointZL: number,
  jointZR: number,
  W: number,
): Phase20qCase => {
  const LL = PHASE20Q_LL;
  const LR = PHASE20Q_LR;
  const startZ = jointZL - srcSlopeL * LL;
  const endZ = jointZR + srcSlopeR * LR;
  const maxSourceZ = Math.max(startZ, jointZL, jointZR, endZ);
  const { criterionL, criterionR } = criteriaFor(family, maxSourceZ);
  return {
    caseId,
    matrix,
    slopePattern,
    slopeMag,
    family,
    side,
    LL,
    LR,
    total: LL + LR,
    startX: 0,
    startY: 0,
    startZ,
    jointX: LL,
    jointY: 0,
    jointZL,
    jointZR,
    endX: LL + LR,
    endY: 0,
    endZ,
    srcSlopeL,
    srcSlopeR,
    jointZ: jointZL,
    step: jointZR - jointZL,
    W,
    sL: -W / 2,
    sR: W / 2,
    gradeRatio: PHASE20Q_GRADE,
    maxSearchDistance: PHASE20Q_MAX_SEARCH,
    criterionL,
    criterionR,
  };
};

/** Full deterministic matrix: sloped (continuous joint) + step (flat + jump). */
export const buildPhase20qCases = (): Phase20qCase[] => {
  const out: Phase20qCase[] = [];
  for (const pattern of SLOPE_PATTERNS) {
    for (const m of pattern.mags) {
      const [slopeL, slopeR] = pattern.slopes(m);
      for (const W of WIDTHS_SLOPED) {
        for (const family of FAMILIES) {
          for (const side of SIDES) {
            out.push(
              assembleCase(
                `q20-slope-${pattern.name}-${magTag(m)}-${widthTag(W)}-${family}-${side}`,
                'sloped',
                pattern.name,
                m,
                family,
                side,
                slopeL,
                slopeR,
                PHASE20Q_JOINT_Z,
                PHASE20Q_JOINT_Z,
                W,
              ),
            );
          }
        }
      }
    }
  }
  const stepSpecs: { tag: string; step: number }[] = [{ tag: 'm0', step: 0 }];
  for (const m of STEP_MAGS) {
    stepSpecs.push({ tag: `${magTag(m)}-pos`, step: m });
    stepSpecs.push({ tag: `${magTag(m)}-neg`, step: -m });
  }
  for (const spec of stepSpecs) {
    for (const W of WIDTHS_STEP) {
      for (const family of FAMILIES) {
        for (const side of SIDES) {
          out.push(
            assembleCase(
              `q20-step-${spec.tag}-${widthTag(W)}-${family}-${side}`,
              'step',
              spec.step === 0 ? 'ZERO' : 'STEP',
              0,
              family,
              side,
              0,
              0,
              PHASE20Q_JOINT_Z,
              PHASE20Q_JOINT_Z + spec.step,
              W,
            ),
          );
        }
      }
    }
  }
  return out;
};

/** Never epsilon-tied: nonzero means step, even at 1 ULP. */
export const classifyPhase20qStep = (c: Phase20qCase): 'continuous' | 'step' =>
  c.step === 0 ? 'continuous' : 'step';
