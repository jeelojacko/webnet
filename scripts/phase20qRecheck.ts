/**
 * Phase 20Q STUDY ONLY — source-Z-aware post-solve check (B2) + persisted
 * independent recomputation (B3). The production mesh validator checks
 * boundary cuts at a single jointZ; this study-side check validates every
 * cut against its OWN source Z via production `resolveAnalyticCriterionAt`
 * (per family), so sloped rows get a real per-family PASS/FAIL instead of
 * a not-applicable mark. B3 persists sufficient inputs per corpus row and
 * rebuilds worker views + pinned plan SOLELY from those persisted fields
 * in a separate function (never the in-memory fixture). Zero `src/` edits.
 */
import { resolveAnalyticCriterionAt } from '../src/engine/cad/grading/gradingAnalyticCriterion';
import { evaluateTransitionLinearV1 } from '../src/engine/cad/grading/gradingTransitionPolicy';
import { transitionDaylightAt } from '../src/engine/cad/grading/gradingGroupTransitionTile';
import { gradingSideNormal } from '../src/engine/cad/grading/gradingCourseFrame';
import {
  checkGroupTransitionAgreement,
  validateTransitionResultMesh,
  type GroupTransitionMemberView,
  type GroupTransitionPlan,
} from '../src/workers/surfaceGradingCompute';
import type { GradingCriterion } from '../src/engine/cad/grading/gradingTypes';
import {
  PHASE20Q_GRADE,
  PHASE20Q_LL,
  PHASE20Q_LR,
  PHASE20Q_MAX_SEARCH,
  type Phase20qCase,
  type Phase20qCriterion,
  type Phase20qFamily,
  type Phase20qSide,
} from './phase20qFixtures';
import {
  evaluatePhase20qLaw,
  phase20qHybridPoints,
  phase20qStations,
  PHASE20Q_S3_TAU,
  type Phase20qLawId,
} from './phase20qLaws';

const asCriterion = (c: Phase20qCriterion): GradingCriterion => c as GradingCriterion;

/**
 * Source-Z-aware post-solve check, every family: (a) EVERY station must be
 * self-consistent — daylight === production `transitionDaylightAt` of the
 * row's own (v(s), physical source Z(s)) — via `===`; (b) the CUT and END
 * stations (never mid/joint, where the V1 blend legitimately differs from
 * either native) must additionally satisfy their OWN native criterion at
 * that same source Z via production `resolveAnalyticCriterionAt`, per
 * family. Returns 'PASS' or the first bounded failure code. Physical laws
 * (S1, J1) pass everywhere; smoothed/bridged/fixed-Z laws fail at (a) on
 * the stations where they rewrite geometry (S2/J2 source bridge, S3/J3
 * daylight bridge, J4 fixed-Z daylight); J4 additionally fails (b) at cutR.
 * A jointZ-fixed daylight on a sloped source fails (see jointZControl).
 */
export const phase20qSourceZAwareCheck = (c: Phase20qCase, law: Phase20qLawId): string => {
  try {
    const n = gradingSideNormal(1, 0, c.side);
    if (!n) return 'study-frame-degenerate';
    const pts = phase20qHybridPoints(c, law, PHASE20Q_S3_TAU);
    for (const p of pts) {
      const leftSide = !(p.tag === 'jointR' || p.tag === 'midR' || p.tag === 'cutR' || p.tag === 'end1');
      const zSrc = leftSide ? c.jointZL + c.srcSlopeL * (p.s - c.LL) : c.jointZR + c.srcSlopeR * (p.s - c.LL);
      // (a) self-consistency at every station (exact production re-derivation).
      if (!(p.srcZ === zSrc)) return 'study-sourceZ-divergent';
      const q = transitionDaylightAt(c.family, p.scalarV, c.gradeRatio, zSrc, p.s, 0, n.nx, n.ny);
      if (!(q.x === p.dayX && q.y === p.dayY && q.z === p.dayZ)) return 'study-daylight-divergent';
      // (b) native-equality only where the law must meet the native: cuts + ends.
      // Mid/joint stations carry the V1 blend, never either endpoint native.
      if (p.tag !== 'cutL' && p.tag !== 'cutR' && p.tag !== 'end0' && p.tag !== 'end1') continue;
      const crit = asCriterion(leftSide ? c.criterionL : c.criterionR);
      const r = resolveAnalyticCriterionAt(crit, zSrc, c.maxSearchDistance);
      if (!r.ok) return `native-unresolvable:${r.code}`;
      if (c.family === 'distance') {
        const obs = Math.hypot(p.dayX - p.srcX, p.dayY - p.srcY);
        if (!(obs === r.value.horizontalDistance)) return 'study-native-mismatch';
      } else if (!(p.dayZ === r.value.limitElevation)) {
        return 'study-native-mismatch';
      }
    }
    return 'PASS';
  } catch {
    return 'study-oracle-error';
  }
};

/**
 * Untampered validator checkpoints (cutL/jointL/cutR) from the law oracle.
 * Shared by the per-family M1 table, the width tamper, and the flat
 * meshCheck — one builder, never three copies of the same triple.
 */
export const phase20qUntamperedCheckpoints = (
  c: Phase20qCase,
  law: Phase20qLawId,
): { vL: number; vR: number; daylight: number[]; source: number[] } | null => {
  try {
    const oracle = evaluatePhase20qLaw(law, c, phase20qStations(c), PHASE20Q_S3_TAU);
    const byTag = new Map(oracle.points.map((pt) => [pt.tag, pt]));
    const qL = byTag.get('cutL')!;
    const q0 = byTag.get('jointL')!;
    const qR = byTag.get('cutR')!;
    return {
      vL: oracle.vL,
      vR: oracle.vR,
      daylight: [qL.dayX, qL.dayY, qL.dayZ, q0.dayX, q0.dayY, q0.dayZ, qR.dayX, qR.dayY, qR.dayZ],
      source: [qL.srcX, qL.srcY, qL.srcZ, q0.srcX, q0.srcY, q0.srcZ, qR.srcX, qR.srcY, qR.srcZ],
    };
  } catch {
    return null;
  }
};

/**
 * M1: the REAL production `validateTransitionResultMesh` on UNtampered
 * sloped S1 checkpoints, per family. Reports the exact code (null =
 * pass). Per-family outcome on sloped S1: distance + elevation reject
 * at GRADING_AGREEMENT_TRANSITION_OFF_LAW (single-jointZ native +
 * fixed-Z plan gate), relative-elevation passes (source-Z difference
 * cancels); near-flat (1e-9, W2) distance rows pass inside tolerance.
 */
export const phase20qValidatorMeshUntampered = (c: Phase20qCase, law: Phase20qLawId): string | null => {
  const pts = phase20qUntamperedCheckpoints(c, law);
  if (!pts) return 'study-oracle-error';
  return validateTransitionResultMesh({
    family: c.family, sL: c.sL, sR: c.sR, vL: pts.vL, vR: pts.vR,
    daylightCheckpoints: pts.daylight, sourceCheckpoints: pts.source,
    criterionL: asCriterion(c.criterionL), criterionR: asCriterion(c.criterionR),
    jointZ: c.jointZ, maxSearchDistance: c.maxSearchDistance,
    daylightPoints: pts.daylight, sourceBoundaryPoints: pts.source, side: c.side,
  });
};

/**
 * M1 extension proof: validator-shaped gate with per-checkpoint source Z.
 * Mirrors the production validator's three gates (legislated V1 at own
 * station via `===`, native boundary at OWN source Z via production
 * `resolveAnalyticCriterionAt`, plan offset toward the production side
 * normal with the per-station family-mapped Z) — but resolves each cut
 * against its own physical source Z instead of the single jointZ. Sloped
 * S1 passes every family where the jointZ-fixed validator rejects; J1
 * passes everywhere (physical law). S2/J2 coincide with the physical law
 * AT these three checkpoints (bridges meet physical at cuts+joint), so
 * they pass here — their interior divergence is B2's every-station job,
 * never the validator's. S3/J3/J4 daylight bridges move the joint
 * checkpoint and fail with bounded study codes (family-dependent).
 * Study-side only: production keeps the jointZ gate (fail-closed); this
 * proves the ONLY missing piece is the per-checkpoint Z parameterization.
 */
export const phase20qPerCheckpointSourceZExtension = (c: Phase20qCase, law: Phase20qLawId): string => {
  try {
    const pts = phase20qUntamperedCheckpoints(c, law);
    if (!pts) return 'study-oracle-error';
    const n = gradingSideNormal(1, 0, c.side);
    if (!n) return 'study-frame-degenerate';
    const stations = [c.sL, 0, c.sR];
    const srcZ = [pts.source[2]!, pts.source[5]!, pts.source[8]!];
    const g = c.gradeRatio;
    for (let i = 0; i < 3; i += 1) {
      const st = stations[i]!;
      const z = srcZ[i]!;
      const dx = pts.daylight[i * 3]! - pts.source[i * 3]!;
      const dy = pts.daylight[i * 3 + 1]! - pts.source[i * 3 + 1]!;
      const dz = pts.daylight[i * 3 + 2]!;
      // Gate 1: legislated V1 at its own station (exact, like the validator).
      const v = evaluateTransitionLinearV1(pts.vL, pts.vR, c.sL, c.sR, st);
      // Gate 2: native boundary at the checkpoint's OWN source Z — cuts
      // only. The joint station carries the V1 blend of both natives,
      // never either endpoint native (same reason the B2 check skips
      // mid/joint stations).
      if (i === 0 || i === 2) {
      const crit = asCriterion(i < 2 ? c.criterionL : c.criterionR);
      const r = resolveAnalyticCriterionAt(crit, z, c.maxSearchDistance);
      if (!r.ok) return `native-unresolvable:${r.code}`;
      if (c.family === 'distance') {
        if (!(Math.hypot(dx, dy) === r.value.horizontalDistance)) return 'study-native-mismatch';
      } else if (!(dz === r.value.limitElevation)) {
        return 'study-native-mismatch';
      }
      }
      // Gate 3: plan offset toward the production side normal, per-station Z.
      const d = c.family === 'distance' ? v : c.family === 'relative-elevation' ? v / g : (v - z) / g;
      if (!(dx === d * n.nx && dy === d * n.ny)) return 'study-plan-mismatch';
      if (c.family === 'distance' && !(dz === z + g * v)) return 'study-plan-mismatch';
    }
    return 'PASS';
  } catch {
    return 'study-oracle-error';
  }
};

/**
 * Negative control: the same check with daylight fixed at jointZ (the
 * production flat-Z assumption). Must PASS on flat rows, FAIL on sloped
 * rows — proving the check is genuinely source-Z-aware, not vacuous.
 */
export const phase20qJointZControl = (c: Phase20qCase, law: Phase20qLawId): string => {
  try {
    const oracle = evaluatePhase20qLaw(law, c, phase20qStations(c), PHASE20Q_S3_TAU);
    const n = gradingSideNormal(1, 0, c.side);
    if (!n) return 'study-frame-degenerate';
    for (const p of oracle.points) {
      const q = transitionDaylightAt(c.family, p.scalarV, c.gradeRatio, c.jointZ, p.s, 0, n.nx, n.ny);
      if (!(q.x === p.dayX && q.y === p.dayY && q.z === p.dayZ)) return 'FAIL-expected-sloped-divergence';
    }
    return 'PASS-flat';
  } catch {
    return 'study-oracle-error';
  }
};

/** Sufficient persisted inputs per corpus row (B3 schema). */
export interface Phase20qPersistedInputs {
  caseId: string;
  matrix: string;
  slopePattern: string;
  slopeMag: number;
  family: Phase20qFamily;
  side: Phase20qSide;
  LL: number;
  LR: number;
  startX: number;
  startY: number;
  startZ: number;
  jointX: number;
  jointY: number;
  jointZL: number;
  jointZR: number;
  endX: number;
  endY: number;
  endZ: number;
  srcSlopeL: number;
  srcSlopeR: number;
  jointZ: number;
  step: number;
  W: number;
  sL: number;
  sR: number;
  gradeRatio: number;
  maxSearchDistance: number;
  criterionL: Phase20qCriterion;
  criterionR: Phase20qCriterion;
  law: Phase20qLawId;
  lawVersion: string;
  sideLaw: string;
}

export const persistPhase20qInputs = (c: Phase20qCase, law: Phase20qLawId): Phase20qPersistedInputs => ({
  caseId: c.caseId, matrix: c.matrix, slopePattern: c.slopePattern, slopeMag: c.slopeMag,
  family: c.family, side: c.side, LL: c.LL, LR: c.LR,
  startX: c.startX, startY: c.startY, startZ: c.startZ,
  jointX: c.jointX, jointY: c.jointY, jointZL: c.jointZL, jointZR: c.jointZR,
  endX: c.endX, endY: c.endY, endZ: c.endZ,
  srcSlopeL: c.srcSlopeL, srcSlopeR: c.srcSlopeR, jointZ: c.jointZ, step: c.step,
  W: c.W, sL: c.sL, sR: c.sR, gradeRatio: c.gradeRatio, maxSearchDistance: c.maxSearchDistance,
  criterionL: { ...c.criterionL }, criterionR: { ...c.criterionR },
  law, lawVersion: 'v1', sideLaw: 'TRANSITION_LINEAR_V1',
});

/** Rebuild the case SOLELY from persisted fields (never the fixture). */
export const reassemblePhase20qCase = (p: Phase20qPersistedInputs): Phase20qCase => ({
  caseId: p.caseId, matrix: p.matrix as Phase20qCase['matrix'],
  slopePattern: p.slopePattern, slopeMag: p.slopeMag, family: p.family, side: p.side,
  LL: p.LL, LR: p.LR, total: p.LL + p.LR,
  startX: p.startX, startY: p.startY, startZ: p.startZ,
  jointX: p.jointX, jointY: p.jointY, jointZL: p.jointZL, jointZR: p.jointZR,
  endX: p.endX, endY: p.endY, endZ: p.endZ,
  srcSlopeL: p.srcSlopeL, srcSlopeR: p.srcSlopeR, jointZ: p.jointZ, step: p.step,
  W: p.W, sL: p.sL, sR: p.sR, gradeRatio: p.gradeRatio, maxSearchDistance: p.maxSearchDistance,
  criterionL: { ...p.criterionL }, criterionR: { ...p.criterionR },
});

const REVISION = 'ggrev1:phase20q-study';

const viewsFrom = (c: Phase20qCase): GroupTransitionMemberView[] => [
  { memberId: `${c.caseId}:L`, criterion: asCriterion(c.criterionL), length: c.LL, dirX: c.jointX - c.startX, dirY: 0, startZ: c.startZ, endZ: c.jointZL, isArc: false, maxSearchDistance: c.maxSearchDistance },
  { memberId: `${c.caseId}:R`, criterion: asCriterion(c.criterionR), length: c.LR, dirX: c.endX - c.jointX, dirY: 0, startZ: c.jointZR, endZ: c.endZ, isArc: false, maxSearchDistance: c.maxSearchDistance },
];

const planFrom = (c: Phase20qCase, vL: number, vR: number): GroupTransitionPlan => ({
  policyVersion: 'trp1', jointId: 'joint:0', memberIds: [`${c.caseId}:L`, `${c.caseId}:R`],
  width: c.W, lawKind: 'TRANSITION_LINEAR_V1', lawVersion: 'v1', criterionFamily: c.family,
  side: c.side, groupSide: c.side, isOpen: true, transitionCount: 1, jointZ: c.jointZ,
  endpointEvidence: { vL, vR, gL: c.gradeRatio, gR: c.gradeRatio },
  jointStation: c.LL, recordedRevision: REVISION,
});

export interface Phase20qIndependentRecompute {
  vL: number | null;
  vR: number | null;
  matchVsRow: boolean | null;
  agreement: string | null;
  error: string | null;
}

/**
 * Independent recomputation SOLELY from persisted fields: reassemble the
 * case, re-resolve endpoint scalars via production, re-run the law oracle,
 * re-check worker agreement. No in-memory fixture reuse.
 */
export const phase20qIndependentRecompute = (
  p: Phase20qPersistedInputs,
  rowVL: number | null,
  rowVR: number | null,
): Phase20qIndependentRecompute => {
  try {
    const c = reassemblePhase20qCase(p);
    if (!(c.LL === PHASE20Q_LL && c.LR === PHASE20Q_LR && c.gradeRatio === PHASE20Q_GRADE && c.maxSearchDistance === PHASE20Q_MAX_SEARCH)) {
      return { vL: null, vR: null, matchVsRow: false, agreement: 'persisted-constant-mismatch', error: null };
    }
    const rL = resolveAnalyticCriterionAt(asCriterion(c.criterionL), c.jointZL, c.maxSearchDistance);
    const rR = resolveAnalyticCriterionAt(asCriterion(c.criterionR), c.jointZR, c.maxSearchDistance);
    const scalarOf = (crit: GradingCriterion, z: number, h: number, lim: number): number =>
      crit.kind === 'distance' ? h : crit.kind === 'relative-elevation' ? lim - z : lim;
    const vL = rL.ok ? scalarOf(asCriterion(c.criterionL), c.jointZL, rL.value.horizontalDistance, rL.value.limitElevation) : null;
    const vR = rR.ok ? scalarOf(asCriterion(c.criterionR), c.jointZR, rR.value.horizontalDistance, rR.value.limitElevation) : null;
    const oracle = evaluatePhase20qLaw(p.law, c, phase20qStations(c), PHASE20Q_S3_TAU);
    const matchVsRow =
      vL !== null && vR !== null && rowVL !== null && rowVR !== null
        ? vL === oracle.vL && vR === oracle.vR && vL === rowVL && vR === rowVR
        : null;
    const agreementOut = checkGroupTransitionAgreement(planFrom(c, vL ?? NaN, vR ?? NaN), viewsFrom(c), REVISION);
    return { vL, vR, matchVsRow, agreement: agreementOut.ok ? null : agreementOut.code, error: null };
  } catch (error) {
    return { vL: null, vR: null, matchVsRow: null, agreement: null, error: error instanceof Error ? error.message : String(error) };
  }
};

export interface Phase20qTamper {
  probe: string;
  caught: boolean;
  detail: string;
}

export interface Phase20qWorkerFacts {
  recomputeVL: number | null;
  recomputeVR: number | null;
  recomputeMatch: boolean | null;
  agreement: string | null;
  meshCheck: string | null;
  tampers: Phase20qTamper[];
  error: string | null;
}

export interface Phase20qWidthTamper {
  untampered: string | null;
  tampered: string | null;
  /** M2: false when untampered already rejects (expected-reject bucket). */
  applicable: boolean;
  /** M2: untampered===null && tampered!==null — never counted when inapplicable. */
  caught: boolean;
}

/**
 * ACTUAL validator width-tamper rejection: run the real production
 * `validateTransitionResultMesh` with the true checkpoints but an
 * ASYMMETRIC sL (left half doubled, s = 0 pinned). A symmetric doubling
 * is invisible at the 3 checkpoints (V1 endpoint clamp + midpoint), so it
 * proves nothing; the asymmetric tamper moves the legislated joint value
 * off the checkpoint (by (vR-vL)/6, all families) and the real validator
 * rejects OFF_LAW/GEOMETRY. Untampered flat controls pass (null).
 */
export const phase20qWidthTamperViaValidator = (c: Phase20qCase, law: Phase20qLawId): Phase20qWidthTamper => {
  try {
    const pts = phase20qUntamperedCheckpoints(c, law);
    if (!pts) return { untampered: 'study-oracle-error', tampered: null, applicable: false, caught: false };
    const base = {
      family: c.family, vL: pts.vL, vR: pts.vR,
      daylightCheckpoints: pts.daylight, sourceCheckpoints: pts.source,
      criterionL: asCriterion(c.criterionL), criterionR: asCriterion(c.criterionR),
      jointZ: c.jointZ, maxSearchDistance: c.maxSearchDistance,
      daylightPoints: pts.daylight, sourceBoundaryPoints: pts.source, side: c.side,
    } as const;
    const untampered = validateTransitionResultMesh({ ...base, sL: c.sL, sR: c.sR });
    // Asymmetric: left half doubled, joint station pinned at 0.
    const tampered = validateTransitionResultMesh({ ...base, sL: 2 * c.sL, sR: c.sR });
    const applicable = untampered === null;
    return { untampered, tampered, applicable, caught: applicable && tampered !== null };
  } catch {
    return { untampered: 'study-oracle-error', tampered: null, applicable: false, caught: false };
  }
};

/** Primary worker facts (in-memory path): recompute + agreement + probes. */
export const phase20qWorkerFacts = (c: Phase20qCase, law: Phase20qLawId): Phase20qWorkerFacts => {
  try {
    const rL = resolveAnalyticCriterionAt(asCriterion(c.criterionL), c.jointZL, c.maxSearchDistance);
    const rR = resolveAnalyticCriterionAt(asCriterion(c.criterionR), c.jointZR, c.maxSearchDistance);
    const scalarOfRes = (crit: GradingCriterion, z: number, h: number, lim: number): number =>
      crit.kind === 'distance' ? h : crit.kind === 'relative-elevation' ? lim - z : lim;
    const recomputeVL = rL.ok ? scalarOfRes(asCriterion(c.criterionL), c.jointZL, rL.value.horizontalDistance, rL.value.limitElevation) : null;
    const recomputeVR = rR.ok ? scalarOfRes(asCriterion(c.criterionR), c.jointZR, rR.value.horizontalDistance, rR.value.limitElevation) : null;
    let recomputeMatch: boolean | null = null;
    try {
      const oracle = evaluatePhase20qLaw(law, c, phase20qStations(c), PHASE20Q_S3_TAU);
      recomputeMatch =
        recomputeVL !== null && recomputeVR !== null
          ? recomputeVL === oracle.vL && recomputeVR === oracle.vR
          : null;
    } catch {
      recomputeMatch = null;
    }
    const members = viewsFrom(c);
    const basePlan = planFrom(c, recomputeVL ?? NaN, recomputeVR ?? NaN);
    const agreement = checkGroupTransitionAgreement(basePlan, members, REVISION);
    const agreementCode = agreement.ok ? null : agreement.code;
    // Flat controls: production validator. Every other row: the study-side
    // source-Z-aware per-family check (B2 replaces the not-applicable mark).
    let meshCheck: string | null;
    if (c.srcSlopeL === 0 && c.srcSlopeR === 0 && c.step === 0 && (law === 'S1' || law === 'J1')) {
      meshCheck = phase20qValidatorMeshUntampered(c, law);
    } else {
      meshCheck = `sourceZ:${phase20qSourceZAwareCheck(c, law)}`;
    }
    const tampers: Phase20qTamper[] = [];
    // M2 strict: caught requires untampered-pass && tampered-reject.
    // Untampered-reject rows are inapplicable (code in detail), never caught.
    const untamperedOk = agreementCode === null;
    const probeAgreement = (label: string, mutate: (_m: GroupTransitionMemberView[]) => void, mutatePlan?: (_p: GroupTransitionPlan) => void): void => {
      const tm = viewsFrom(c);
      mutate(tm);
      const tp: GroupTransitionPlan = { ...basePlan, memberIds: [...basePlan.memberIds], endpointEvidence: { ...basePlan.endpointEvidence } };
      mutatePlan?.(tp);
      const out = checkGroupTransitionAgreement(tp, tm, REVISION);
      if (!untamperedOk) {
        tampers.push({ probe: label, caught: false, detail: `inapplicable:untampered=${agreementCode}` });
        return;
      }
      tampers.push({ probe: label, caught: !out.ok, detail: out.ok ? 'agreement-held' : out.code });
    };
    probeAgreement('tampered-sourceZ', (tm) => {
      tm[0] = { ...tm[0]!, endZ: tm[0]!.endZ + 0.5 };
    });
    probeAgreement('tampered-slope', (tm) => {
      tm[0] = { ...tm[0]!, startZ: tm[0]!.startZ + 1 };
    });
    probeAgreement('tampered-scalar', (tm) => tm, (tp) => {
      tp.endpointEvidence = { ...tp.endpointEvidence, vL: tp.endpointEvidence.vL + 1 };
    });
    probeAgreement('tampered-family', (tm) => tm, (tp) => {
      tp.criterionFamily = tp.criterionFamily === 'distance' ? 'elevation' : 'distance';
    });
    probeAgreement('tampered-side', (tm) => tm, (tp) => {
      tp.side = tp.side === 'left' ? 'right' : 'left';
    });
    // Width tamper goes through the REAL production mesh validator (B3).
    // M2: inapplicable rows (untampered already rejects) record the
    // expected-reject code in detail and NEVER count as caught.
    const widthProbe = phase20qWidthTamperViaValidator(c, law);
    tampers.push({
      probe: 'tampered-width',
      caught: widthProbe.caught,
      detail: widthProbe.applicable
        ? (widthProbe.tampered ?? 'validator-held')
        : `inapplicable:untampered=${widthProbe.untampered}`,
    });
    return { recomputeVL, recomputeVR, recomputeMatch, agreement: agreementCode, meshCheck, tampers, error: null };
  } catch (error) {
    return {
      recomputeVL: null, recomputeVR: null, recomputeMatch: null, agreement: null,
      meshCheck: null, tampers: [], error: error instanceof Error ? error.message : String(error),
    };
  }
};

export interface Phase20qPersistedBytesVerdict {
  file: string;
  rows: number;
  scalarMatch: number;
  agreementMatch: number;
  mismatches: string[];
}

/**
 * m3: persisted-bytes check — reads the WRITTEN corpus.json from DISK in
 * isolation (never the in-memory assembler), recomputes worker values
 * SOLELY from each row's stored `persisted` fields, and compares against
 * the stored `worker` + `independent` values. Any drift between what was
 * written and what the fields prove fails the verdict.
 */
export const verifyPhase20qPersistedBytesFromDisk = async (file: string): Promise<Phase20qPersistedBytesVerdict> => {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(file, 'utf8');
  const rows = JSON.parse(raw) as {
    caseId: string;
    worker: { recomputeVL: number | null; recomputeVR: number | null; agreement: string | null };
    persisted: Phase20qPersistedInputs;
    independent: { vL: number | null; vR: number | null; matchVsRow: boolean | null; agreement: string | null };
  }[];
  let scalarMatch = 0;
  let agreementMatch = 0;
  const mismatches: string[] = [];
  for (const r of rows) {
    const ind = phase20qIndependentRecompute(r.persisted, r.worker.recomputeVL, r.worker.recomputeVR);
    const scalarOk = ind.vL === r.independent.vL && ind.vR === r.independent.vR
      && ind.vL === r.worker.recomputeVL && ind.vR === r.worker.recomputeVR;
    const agreementOk = ind.agreement === r.independent.agreement && ind.agreement === r.worker.agreement;
    if (scalarOk) scalarMatch += 1; else mismatches.push(`${r.caseId}:scalar`);
    if (agreementOk) agreementMatch += 1; else mismatches.push(`${r.caseId}:agreement`);
    if (mismatches.length > 8) break;
  }
  return { file, rows: rows.length, scalarMatch, agreementMatch, mismatches };
};
