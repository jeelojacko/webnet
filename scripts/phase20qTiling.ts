/**
 * Phase 20Q STUDY ONLY — real production tiling-path probe (B1).
 *
 * Drives the REAL production tiler (`planTransitionJoint` + `transitionLegOf`
 * + `transitionDaylightAt`, never re-derived math) with source-exact member
 * endpoints for sloped fixtures. Production fixes Z=mL.endZ and runs flat
 * outer sub-solves, so sloped/stepped members must fail closed here — the
 * probe records where the flat-Z assumption breaks. The minimal study-side
 * vertical extension (parameterize Z per station, V1 + tile unchanged) is
 * explicit below; it reproduces S1 daylight exactly. Zero `src/` edits.
 */
import {
  evaluateTransitionLinearV1,
  TRANSITION_LAW_KIND,
  TRANSITION_LAW_VERSION,
  TRANSITION_POLICY_VERSION,
} from '../src/engine/cad/grading/gradingTransitionPolicy';
import {
  planTransitionJoint,
  transitionDaylightAt,
  transitionLegOf,
  type MemberSolve,
  type TransitionTileInput,
} from '../src/engine/cad/grading/gradingGroupTransitionTile';
import { gradingSideNormal } from '../src/engine/cad/grading/gradingCourseFrame';
import { solveGradingChord } from '../src/engine/cad/grading/solveAnalyticGradingChord';
import type { GradingCriterion, ResolvedGradingSource } from '../src/engine/cad/grading/gradingTypes';
import type { Phase20qCase, Phase20qCriterion } from './phase20qFixtures';
import {
  evaluatePhase20qLaw,
  phase20qHybridPoints,
  phase20qStations,
  PHASE20Q_S3_TAU,
  type Phase20qLawId,
} from './phase20qLaws';

export interface Phase20qTilingProbe {
  admitted: boolean;
  code: string | null;
  detail: string | null;
  frameError: string | null;
  runFlat: number[] | null;
  srcFlat: number[] | null;
  law: { vL: number; vR: number; sL: number; sR: number; family: string } | null;
  legDaylight: number[] | null;
}

const asCriterion = (c: Phase20qCriterion): GradingCriterion => c as GradingCriterion;
const memberId = (c: Phase20qCase, side: 'L' | 'R'): string => `${c.caseId}:${side}`;

const tileMembers = (c: Phase20qCase): ResolvedGradingSource[] => [
  { startX: c.startX, startY: 0, endX: c.jointX, endY: 0, startZ: c.startZ, endZ: c.jointZL, length: c.LL, reoriented: false, isArc: false },
  { startX: c.jointX, startY: 0, endX: c.endX, endY: 0, startZ: c.jointZR, endZ: c.endZ, length: c.LR, reoriented: false, isArc: false },
];

/**
 * Frames via the production native solver on the TRUE member geometry
 * (flat or sloped). Only tOut/nOut/stitched are read on the admit path;
 * t=(1,0) is exact by collinear-fixture construction, n comes from the
 * production `gradingSideNormal` convention.
 */
const tileFrames = (c: Phase20qCase): { frames: MemberSolve[] } | { error: string } => {
  try {
    const n = gradingSideNormal(1, 0, c.side);
    if (!n) return { error: 'degenerate +X frame' };
    const members = tileMembers(c);
    const frames: MemberSolve[] = [];
    const criteria = [asCriterion(c.criterionL), asCriterion(c.criterionR)];
    for (let i = 0; i < 2; i += 1) {
      const m = members[i]!;
      const solved = solveGradingChord({
        source: { startX: m.startX, startY: m.startY, endX: m.endX, endY: m.endY, startZ: m.startZ, endZ: m.endZ, length: m.length, reoriented: false, isArc: false },
        side: c.side,
        criterion: criteria[i]!,
        maxSearchDistance: c.maxSearchDistance,
      });
      if (!solved.ok) return { error: `frame-${i}:${solved.code}` };
      frames.push({
        chords: [], stitched: solved.solve,
        tIn: { nx: 1, ny: 0 }, tOut: { nx: 1, ny: 0 },
        nIn: { nx: n.nx, ny: n.ny }, nOut: { nx: n.nx, ny: n.ny },
        gsIn: c.gradeRatio, gsOut: c.gradeRatio,
        nodeStations: [...solved.solve.nodeStations],
      });
    }
    return { frames };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
};

/** Real production tiling path with source-exact endpoints. */
export const phase20qRealTilingProbe = (c: Phase20qCase): Phase20qTilingProbe => {
  const built = tileFrames(c);
  if ('error' in built) {
    return { admitted: false, code: null, detail: null, frameError: built.error, runFlat: null, srcFlat: null, law: null, legDaylight: null };
  }
  const input: TransitionTileInput = {
    side: c.side,
    revision: 'ggrev1:phase20q-study',
    maxSearchDistance: c.maxSearchDistance,
    transition: {
      policyVersion: TRANSITION_POLICY_VERSION,
      jointId: 'joint:0',
      memberIds: [memberId(c, 'L'), memberId(c, 'R')],
      width: c.W,
      lawKind: TRANSITION_LAW_KIND,
      lawVersion: TRANSITION_LAW_VERSION,
      criterionFamily: c.family,
      side: c.side,
    },
    transitionMemberKeys: [memberId(c, 'L'), memberId(c, 'R')],
  };
  const members = tileMembers(c);
  const criteria = [asCriterion(c.criterionL), asCriterion(c.criterionR)];
  try {
    const out = planTransitionJoint(input, members, (i) => criteria[i]!, built.frames, 1);
    if (!out.ok) {
      return { admitted: false, code: out.code, detail: out.detail ?? out.code, frameError: null, runFlat: null, srcFlat: null, law: null, legDaylight: null };
    }
    const leg = transitionLegOf(input.transition!, out.plan, c.gradeRatio, c.gradeRatio, 'ggrev1:phase20q-study');
    return {
      admitted: true, code: null, detail: null, frameError: null,
      runFlat: [...out.plan.runFlat], srcFlat: [...out.plan.srcFlat],
      law: { vL: out.plan.law.vL, vR: out.plan.law.vR, sL: out.plan.law.sL, sR: out.plan.law.sR, family: out.plan.law.family },
      legDaylight: [...leg.daylightCheckpoints],
    };
  } catch (error) {
    return { admitted: false, code: 'study-harness-throw', detail: error instanceof Error ? error.message : String(error), frameError: null, runFlat: null, srcFlat: null, law: null, legDaylight: null };
  }
};

export interface Phase20qVerticalExtension {
  /** Explicit minimal extension: production tile with Z fixed → Z(s). */
  extensionLaw: string;
  /** Max |dev| of extension daylight vs the S1 oracle (expect exactly 0). */
  extensionDev: number;
  /** Max |dev| of the UNEXTENDED fixed-Z production tile on sloped rows. */
  fixedZDev: number;
}

/**
 * Minimal study-side vertical extension, explicit and documented:
 * keep legislated V1 v(s) + production `transitionDaylightAt` untouched,
 * replace the production fixed Z=mL.endZ with the physical per-station
 * source Z(s) (exact at joint, native per half). Proves the extension
 * reproduces S1 daylight exactly AND that the unextended fixed-Z tile
 * diverges on sloped sources (so the real path cannot reproduce S1
 * without src/ changes — S1 GO rests on this study-side extension).
 */
export const phase20qVerticalExtension = (c: Phase20qCase): Phase20qVerticalExtension => {
  const oracle = evaluatePhase20qLaw('S1', c, phase20qStations(c), PHASE20Q_S3_TAU);
  const n = gradingSideNormal(1, 0, c.side)!;
  let extensionDev = 0;
  let fixedZDev = 0;
  for (const p of oracle.points) {
    const leftSide = !(p.tag === 'jointR' || p.tag === 'midR' || p.tag === 'cutR' || p.tag === 'end1');
    const zSrc = leftSide ? c.jointZL + c.srcSlopeL * (p.s - c.LL) : c.jointZR + c.srcSlopeR * (p.s - c.LL);
    const v = evaluateTransitionLinearV1(oracle.vL, oracle.vR, c.sL, c.sR, p.s - c.LL);
    const ext = transitionDaylightAt(c.family, v, c.gradeRatio, zSrc, p.s, 0, n.nx, n.ny);
    extensionDev = Math.max(extensionDev, Math.abs(ext.x - p.dayX), Math.abs(ext.y - p.dayY), Math.abs(ext.z - p.dayZ));
    const fixed = transitionDaylightAt(c.family, v, c.gradeRatio, c.jointZ, p.s, 0, n.nx, n.ny);
    fixedZDev = Math.max(fixedZDev, Math.abs(fixed.x - p.dayX), Math.abs(fixed.y - p.dayY), Math.abs(fixed.z - p.dayZ));
  }
  return {
    extensionLaw: 'Z(s):=physical per-station source Z (native per half, exact at joint); V1 v(s) + transitionDaylightAt unchanged',
    extensionDev,
    fixedZDev,
  };
};

/**
 * Zero-slope reduction against the FULL production flat solve: the real
 * tiling path must admit, and its runFlat/srcFlat/law must match the law
 * oracle bitwise exactly (===). Null outside the exact-flat domain.
 * Admission sanity on the untampered intent is recorded via the probe.
 */
export const checkFlatReductionFullSolve = (c: Phase20qCase, law: Phase20qLawId): boolean | null => {
  if (!(c.srcSlopeL === 0 && c.srcSlopeR === 0 && c.step === 0)) return null;
  const probe = phase20qRealTilingProbe(c);
  if (!probe.admitted || !probe.runFlat || !probe.srcFlat || !probe.law) return false;
  const oracle = evaluatePhase20qLaw(law, c, phase20qStations(c), PHASE20Q_S3_TAU);
  if (!(probe.law.vL === oracle.vL && probe.law.vR === oracle.vR)) return false;
  const byTag = new Map(oracle.points.map((p) => [p.tag, p]));
  const triples: [string, number][] = [['cutL', 0], ['jointL', 1], ['cutR', 2]];
  for (const [tag, i] of triples) {
    const p = byTag.get(tag);
    if (!p) return false;
    if (!(probe.runFlat[i * 3] === p.dayX && probe.runFlat[i * 3 + 1] === p.dayY && probe.runFlat[i * 3 + 2] === p.dayZ)) return false;
    if (!(probe.srcFlat[i * 3] === p.srcX && probe.srcFlat[i * 3 + 1] === p.srcY && probe.srcFlat[i * 3 + 2] === p.srcZ)) return false;
  }
  return true;
};

export interface Phase20qExtendedStudyTile {
  /** Production outer sub-solves on TRUE sloped geometry both succeed. */
  outerOk: boolean;
  outerCode: string | null;
  /** Max |dev| outer production daylight vs S1 hybrid at outer stations. */
  outerDev: number;
  /** Max |dev| extended inner tile (V1 + transitionDaylightAt at Z(s)) vs S1. */
  extensionDev: number;
  /** Checkpoints covered end-to-end (outer stations + inner stations). */
  checkpoints: number;
}

/**
 * M4: extended study tile end-to-end — outer sub-solves through the REAL
 * production `solveGradingChord` on the TRUE (sloped) outer segments
 * [0, cutL] + [cutR, total], inner interval through legislated V1 +
 * production `transitionDaylightAt` at physical Z(s). Compares every
 * checkpoint against the S1 hybrid oracle with `===`-derived max dev.
 * Production cannot run this path (admission fixes Z flat first); the
 * study tile proves the extension reproduces S1 exactly INCLUDING the
 * outer natives, so extensionDev=0 is a full-tile check, not a formula
 * re-eval. Missing for production: per-station Z parameterization in
 * `planTransitionJoint` (fixed Z=mL.endZ + flat outer sub-solves) —
 * a src/ change, out of study scope.
 */
export const phase20qExtendedStudyTile = (c: Phase20qCase): Phase20qExtendedStudyTile => {
  try {
    // Hybrid oracle: production natives outside, S1 law inside (mirrors
    // production tiling composition; the law oracle alone extrapolates
    // V1 outside and must NOT be the outer reference).
    const oracle = evaluatePhase20qLaw('S1', c, phase20qStations(c), PHASE20Q_S3_TAU);
    const hybrid = phase20qHybridPoints(c, 'S1', PHASE20Q_S3_TAU);
    const joint = c.LL;
    const sLo = joint + c.sL;
    const sHi = joint + c.sR;
    const n = gradingSideNormal(1, 0, c.side);
    if (!n) return { outerOk: false, outerCode: 'study-frame-degenerate', outerDev: NaN, extensionDev: NaN, checkpoints: 0 };
    const zAt = (s: number): number => {
      const left = s <= joint;
      return left ? c.jointZL + c.srcSlopeL * (s - joint) : c.jointZR + c.srcSlopeR * (s - joint);
    };
    // Outer sub-solves on TRUE geometry (sloped startZ/endZ preserved).
    // Zero-length outers (width == max) have no outer stations: skip.
    const outerL = sLo > 0 ? solveGradingChord({
      source: { startX: c.startX, startY: 0, endX: sLo, endY: 0, startZ: c.startZ, endZ: zAt(sLo), length: sLo, reoriented: false, isArc: false },
      side: c.side, criterion: asCriterion(c.criterionL), maxSearchDistance: c.maxSearchDistance,
    }) : null;
    if (outerL && !outerL.ok) return { outerOk: false, outerCode: `outerL:${outerL.code}`, outerDev: NaN, extensionDev: NaN, checkpoints: 0 };
    const outerRLen = c.total - sHi;
    const outerR = outerRLen > 0 ? solveGradingChord({
      source: { startX: sHi, startY: 0, endX: c.endX, endY: 0, startZ: zAt(sHi), endZ: c.endZ, length: outerRLen, reoriented: false, isArc: false },
      side: c.side, criterion: asCriterion(c.criterionR), maxSearchDistance: c.maxSearchDistance,
    }) : null;
    if (outerR && !outerR.ok) return { outerOk: false, outerCode: `outerR:${outerR.code}`, outerDev: NaN, extensionDev: NaN, checkpoints: 0 };
    const byS = new Map<number, { x: number; y: number; z: number }>();
    const indexOuter = (solve: { sourcePts: { x: number }[]; daylightPts: { x: number; y: number; z: number }[] }): void => {
      for (let i = 0; i < solve.sourcePts.length; i += 1) byS.set(solve.sourcePts[i]!.x, solve.daylightPts[i]!);
    };
    if (outerL) indexOuter(outerL.solve);
    if (outerR) indexOuter(outerR.solve);
    let outerDev = 0;
    let extensionDev = 0;
    let checkpoints = 0;
    for (const p of hybrid) {
      checkpoints += 1;
      if (p.s < sLo || p.s > sHi) {
        // Outer station: production sub-solve daylight must match the hybrid.
        const q = byS.get(p.s);
        if (!q) return { outerOk: false, outerCode: 'study-outer-station-missing', outerDev: NaN, extensionDev: NaN, checkpoints };
        outerDev = Math.max(outerDev, Math.abs(q.x - p.dayX), Math.abs(q.y - p.dayY), Math.abs(q.z - p.dayZ));
      } else {
        // Inner station: V1 + production tile at physical Z(s).
        const v = evaluateTransitionLinearV1(oracle.vL, oracle.vR, c.sL, c.sR, p.s - joint);
        const q = transitionDaylightAt(c.family, v, c.gradeRatio, zAt(p.s), p.s, 0, n.nx, n.ny);
        extensionDev = Math.max(extensionDev, Math.abs(q.x - p.dayX), Math.abs(q.y - p.dayY), Math.abs(q.z - p.dayZ));
      }
    }
    return { outerOk: true, outerCode: null, outerDev, extensionDev, checkpoints };
  } catch {
    return { outerOk: false, outerCode: 'study-oracle-error', outerDev: NaN, extensionDev: NaN, checkpoints: 0 };
  }
};
