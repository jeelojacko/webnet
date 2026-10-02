/**
 * Phase 20L.1 Task C — FULL XYZ TIE CONTINUITY STUDY (STUDY ONLY, zero src/).
 *
 * Problem: `sameD_Jagree` in the group corpus is plan-only. Two members can
 * require the SAME plan distance `d` yet their daylight limit surfaces sit at
 * DIFFERENT Z at the same plan join — e.g. Distance g=1,D=5 (Z=sourceZ+5) vs
 * Relative-elevation g=2,Δ=10 (d=5, Z=sourceZ+10). Joining them is an invalid
 * tie. This module adds the missing run-compatibility contract.
 *
 * Everything is production-authority driven:
 *   - source Z            : gradingCurve.ts arc/line interpolation rule;
 *   - flat-only predicate : each member startZ===endZ exactly (===) — gate
 *                           code ahead of every admission, never prose;
 *   - joint continuity    : incoming.endZ===outgoing.startZ exactly (===),
 *                           mirroring production exactXyz (Z leg);
 *   - daylight limit Z    : `resolveAnalyticCriterionAt` per sampled source
 *                           point (never the `zDaylight = d` assumption);
 *   - corner XYZ tie      : `solveAnalyticCorner` for structural acceptance
 *                           + the tie-at-join law (both member laws
 *                           single-valued AT THE ADMITTED JOIN within
 *                           production zeroDelta; the tie point itself is
 *                           never the certified point — no wall/average/weld);
 *   - local plan candidacy : the Phase 20L `classifyOffsetJoin` + the shared
 *                           extent gates (E1) — consumed, never re-derived.
 *
 * `xyzRunTieOk` is the exported gate with a stable signature: it implements
 * the run-compatibility contract for one adjacent pair and reports a named
 * reason. The parallel routing worker owns the route decision (the R-hook);
 * this study only produces the gate + fixture outcomes.
 *
 * Emits docs/evidence/phase20l1/xyz-corpus.json (deterministic). Wired nowhere.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { zeroDelta } from '../src/engine/cad/surfaces/volume/zero';
import { resolveAnalyticCriterionAt } from '../src/engine/cad/grading/gradingAnalyticCriterion';
import { gradingSideNormal, type PlanVector } from '../src/engine/cad/grading/gradingCourseFrame';
import { linearizeGradingArc } from '../src/engine/cad/grading/gradingCurve';
import {
  analyticTerminalLine,
  solveAnalyticCorner,
} from '../src/engine/cad/grading/gradingGroupAnalyticCorners';
import type { MergePoint, MergedGroupMesh } from '../src/engine/cad/grading/gradingGroupMerge';
import type { GradingCriterion, GradingSide } from '../src/engine/cad/grading/gradingTypes';
import { auditMesh } from './phase20kHybridArcPairAudit';
import { classifyOffsetJoin, memberTangent, type MemberSpec } from './phase20lOffsetJoinCore';
import { extentJVWithin, gateRadiusOffset, joinWorldScale, radialSignOf } from './phase20l1EffectiveCriterion';

const TAU = Math.PI * 2;
const sha16 = (v: unknown): string => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16);
const r9 = (n: number): number => (Number.isFinite(n) ? Number(n.toFixed(9)) : n);
const q = (p: { x: number; y: number; z: number }): { x: number; y: number; z: number } =>
  ({ x: r9(p.x), y: r9(p.y), z: r9(p.z) });

// ───────────────────────── gate ─────────────────────────

export type XyzTieReason =
  | 'Z_TIE_OK'
  | 'XY_AGREE'
  | 'REJECT_PLAN_LAW_NONCONSTANT'
  | 'REJECT_D_MISMATCH'
  | 'REJECT_ELEVATION_MEMBER_MISMATCH'
  | 'REJECT_ROFF'
  | 'REJECT_PLAN_JOIN'
  | 'REJECT_ANALYTIC_CORNER'
  | 'REJECT_XY_TIE_MISMATCH'
  | 'REJECT_XYZ_TIE_MISMATCH'
  | 'REJECT_TIE_OUTSIDE_SEARCH'
  | 'REJECT_JOIN_Z_MISMATCH'
  | 'REJECT_SLOPED_SOURCE'
  | 'REJECT_SOURCE_JOINT_STEP'
  | 'REJECT_FALLBACK';

export interface XyzTieMemberInput {
  member: MemberSpec;
  criterion: GradingCriterion;
  startZ: number;
  endZ: number;
}

export interface XyzTieCornerInput {
  incoming: XyzTieMemberInput;
  outgoing: XyzTieMemberInput;
  side: GradingSide;
  maxSearchDistance: number;
  /** A member incident to a rejected plan corner routes chord fallback. */
  incidentFallback?: boolean;
}

export interface XyzTieResult {
  ok: boolean;
  reason: XyzTieReason;
  /** Plan-level P0 candidacy (local), computed independently of the XYZ tie. */
  localP0: boolean;
  d: number | null;
  dIn: number | null;
  dOut: number | null;
  planReasonIn: string;
  planReasonOut: string;
  joinXY: { x: number; y: number } | null;
  tieXYZ: { x: number; y: number; z: number } | null;
  /** Member daylight-Z laws evaluated AT THE ADMITTED JOIN (the built node),
   *  never at the analytic tie. Single-valuedness here is the tie-at-join law. */
  zIn: number | null;
  zOut: number | null;
  /** Agreed single corner Z at the join (null unless the tie is ok). */
  joinZ: number | null;
  /** Plan distance between the analytic tie and the admitted join. The two
   *  constructions legitimately differ (measured 0.2277 m on arc corners);
   *  coincidence is NOT required — the tie must only lie in the same search
   *  neighborhood as the built join (structural locality, NOT numerical
   *  agreement), and Z must agree AT the join. */
  tieJoinDist: number | null;
  xyAgree: boolean;
  /** True iff both member laws agree at the join within production zeroDelta. */
  zAgree: boolean;
  detail: string;
}

const memberLen = (m: MemberSpec): number => Math.abs(m.spanEnd - m.spanStart);
const memberGrade = (m: XyzTieMemberInput): number => (m.endZ - m.startZ) / memberLen(m.member);

/** Per-member plan law: constant along the member? which required plan d? */
const planLawOf = (
  m: XyzTieMemberInput,
  ms: number,
): { constant: boolean; d: number | null; reason: string } => {
  const kind = m.criterion.kind;
  if (kind !== 'distance' && kind !== 'relative-elevation' && kind !== 'elevation') {
    return { constant: false, d: null, reason: 'NON_ANALYTIC' };
  }
  if (kind === 'elevation' && m.startZ !== m.endZ) {
    return { constant: false, d: null, reason: 'ELEVATION_SLOPED_SOURCE' };
  }
  const res = resolveAnalyticCriterionAt(m.criterion, m.startZ, ms);
  if (!res.ok) return { constant: false, d: null, reason: 'INVALID_CRITERION' };
  const d = res.value.horizontalDistance;
  if (!Number.isFinite(d) || !(d > 0)) return { constant: false, d: null, reason: 'INVALID_CRITERION' };
  const reason = kind === 'distance' ? 'DISTANCE' : kind === 'relative-elevation' ? 'RELATIVE_ELEVATION' : 'ELEVATION_FLAT_SOURCE';
  return { constant: true, d, reason };
};

/** Z of a 3D terminal line at a plan XY (production `analyticTerminalLine`). */
const lineZAt = (
  l: { ox: number; oy: number; oz: number; dx: number; dy: number; dz: number },
  x: number,
  y: number,
): number | null => {
  const s = l.dx * l.dx + l.dy * l.dy;
  if (!(s > 0)) return null;
  const u = ((x - l.ox) * l.dx + (y - l.oy) * l.dy) / s;
  const z = l.oz + u * l.dz;
  return Number.isFinite(z) ? z : null;
};

/**
 * Run-compatibility contract for one adjacent pair. `Z_TIE_OK` means the two
 * members share the same required plan `d`, the production analytic corner
 * accepts the corner, the analytic tie lies in the same search neighborhood
 * as the admitted offset join (structural locality, NOT numerical agreement —
 * coincidence is NOT required, the two constructions differ by 0.2277 m on
 * arc corners), both member daylight-Z laws agree AT THE JOIN (the built
 * node) within production zeroDelta, AND both members are exactly flat
 * (startZ===endZ, ===). `REJECT_JOIN_Z_MISMATCH` is the same-plan-d, tie-accepted, but
 * different-law-Z-at-join case (sloped members: 11 mm on fixture B).
 * `REJECT_XYZ_TIE_MISMATCH` stays the analytic-corner Z rejection at the tie.
 */
export const xyzRunTieOk = (corner: XyzTieCornerInput): XyzTieResult => {
  const { incoming, outgoing, side, maxSearchDistance: ms } = corner;
  const base: XyzTieResult = {
    ok: false, reason: 'REJECT_PLAN_LAW_NONCONSTANT', localP0: false,
    d: null, dIn: null, dOut: null, planReasonIn: 'UNKNOWN', planReasonOut: 'UNKNOWN',
    joinXY: null, tieXYZ: null, zIn: null, zOut: null, joinZ: null, tieJoinDist: null,
    xyAgree: false, zAgree: false, detail: '',
  };
  const lawIn = planLawOf(incoming, ms);
  const lawOut = planLawOf(outgoing, ms);
  base.planReasonIn = lawIn.reason;
  base.planReasonOut = lawOut.reason;
  base.dIn = lawIn.d;
  base.dOut = lawOut.d;
  if (!lawIn.constant || !lawOut.constant) {
    return { ...base, detail: `plan-law:${lawIn.reason}/${lawOut.reason}` };
  }
  const dIn = lawIn.d!;
  const dOut = lawOut.d!;
  // Local plan P0 candidacy is computed at the incoming d (independent of tie).
  const ws = joinWorldScale(incoming.member.vx, incoming.member.vy);
  const r = classifyOffsetJoin({ incoming: incoming.member, outgoing: outgoing.member, side, offset: dIn, maxSearchDistance: ms });
  const adm = r.candidates.filter((c) => c.inSpan && c.branchConsistent);
  const sel = adm.length === 1 && r.classification === 'OFFSET_JOIN_UNIQUE' && extentJVWithin(adm[0]!.distV, ms, ws) ? adm[0]! : null;
  if (sel) base.joinXY = { x: sel.x, y: sel.y };
  base.localP0 = sel !== null;
  // (3) exact Roff for every arc.
  for (const m of [incoming, outgoing]) {
    if (m.member.kind !== 'arc') continue;
    const sign = radialSignOf(m.member, side);
    if (sign === null || !gateRadiusOffset(m.member.radius, sign, dIn).ok) {
      return { ...base, reason: 'REJECT_ROFF', detail: 'roff' };
    }
  }
  // (2) same required plan d (necessary for a run).
  if (dIn !== dOut) {
    const bothElev = incoming.criterion.kind === 'elevation' && outgoing.criterion.kind === 'elevation';
    return {
      ...base, d: dIn,
      reason: bothElev ? 'REJECT_ELEVATION_MEMBER_MISMATCH' : 'REJECT_D_MISMATCH',
      detail: `d-in=${dIn} d-out=${dOut}`,
    };
  }
  const d = dIn;
  base.d = d;
  // (4) local P0 plan join unique/on-body/in-extent.
  if (!sel) {
    return { ...base, reason: 'REJECT_PLAN_JOIN', detail: r.classification };
  }
  // (5) production analytic corner tie (target-free terminal lines), then
  // (9) tie-in-neighborhood of the built join + (10) single-valued law Z
  // AT THE JOIN (tie-at-join law — the mesh corner node is the join, so the
  // laws must agree there, not at the tie where they agree by construction).
  const tie = evaluateAnalyticTie(incoming, outgoing, side, ms, base.joinXY!);
  base.tieXYZ = tie.tieXYZ;
  base.zIn = tie.zIn;
  base.zOut = tie.zOut;
  base.joinZ = tie.joinZ;
  base.tieJoinDist = tie.tieJoinDist;
  base.zAgree = tie.zAgree;
  base.xyAgree = tie.xyAgree;
  // (11) FLAT-ONLY ENFORCEMENT as predicate code (===, no tolerance), ahead
  // of every admission: any sloped member — 1e-13 or gross — rejects
  // REJECT_SLOPED_SOURCE identically, before zeroDelta leniency anywhere can
  // admit it. Join-law measurements stay reported as provenance.
  if (incoming.startZ !== incoming.endZ || outgoing.startZ !== outgoing.endZ) {
    return {
      ...base, reason: 'REJECT_SLOPED_SOURCE', zAgree: false,
      detail: `sloped-source in=${incoming.startZ}/${incoming.endZ} out=${outgoing.startZ}/${outgoing.endZ}`,
    };
  }
  if (tie.reason !== null) return { ...base, reason: tie.reason, detail: tie.detail };
  // (8) no incident fallback.
  if (corner.incidentFallback) {
    return { ...base, reason: 'REJECT_FALLBACK', detail: 'incident-member-fallback' };
  }
  return { ...base, ok: true, reason: 'Z_TIE_OK', detail: 'same-d + single-valued join Z' };
};

interface TieEval {
  tieXYZ: { x: number; y: number; z: number } | null;
  /** Laws at the admitted join (the built node). */
  zIn: number | null;
  zOut: number | null;
  /** Agreed single Z at the join (null unless zAgree). */
  joinZ: number | null;
  /** |tie - join| plan distance (null unless the tie exists). */
  tieJoinDist: number | null;
  zAgree: boolean;
  xyAgree: boolean;
  reason: XyzTieReason | null;
  detail: string;
}

/** Steps 5–7: production analytic tie; steps 9–10: tie-at-join law. */
const evaluateAnalyticTie = (
  incoming: XyzTieMemberInput,
  outgoing: XyzTieMemberInput,
  side: GradingSide,
  ms: number,
  joinXY: { x: number; y: number },
): TieEval => {
  const empty: TieEval = { tieXYZ: null, zIn: null, zOut: null, joinZ: null, tieJoinDist: null, zAgree: false, xyAgree: false, reason: null, detail: '' };
  const inT = memberTangent(incoming.member);
  const outT = memberTangent(outgoing.member);
  const inN = inT ? gradingSideNormal(inT.nx, inT.ny, side) : null;
  const outN = outT ? gradingSideNormal(outT.nx, outT.ny, side) : null;
  if (!inT || !outT || !inN || !outN) {
    return { ...empty, reason: 'REJECT_ANALYTIC_CORNER', detail: 'degenerate-terminal' };
  }
  const vx = incoming.member.vx;
  const vy = incoming.member.vy;
  // Each member's law at its OWN joint elevation (never one member's Z for
  // both): incoming at its endZ, outgoing at its startZ.
  const vzIn = incoming.endZ;
  const vzOut = outgoing.startZ;
  const inGs = memberGrade(incoming);
  const outGs = memberGrade(outgoing);
  // Independent daylight-Z check through the production terminal-line authority.
  const lIn = analyticTerminalLine(vx, vy, vzIn, inT, inN, inGs, incoming.criterion, ms);
  const lOut = analyticTerminalLine(vx, vy, vzOut, outT, outN, outGs, outgoing.criterion, ms);
  if (!lIn || !lOut) {
    return { ...empty, reason: 'REJECT_ANALYTIC_CORNER', detail: 'terminal-line' };
  }
  // (12) source-joint continuity (mirrors production `exactXyz`:
  // gradingGroupCompute.ts:137-138 requires endX===startX && endY===startY
  // && endZ===startZ exactly, failing closed GRADING_GROUP_CORNER_MISMATCH
  // at :279-280 — same === semantics on the Z leg; the XY legs coincide by
  // chain construction, so the study enforces the free variable. A 0-vs-2
  // step is a genuine source discontinuity, not an exact joint.
  if (vzIn !== vzOut) {
    const zJIn0 = lineZAt(lIn, joinXY.x, joinXY.y);
    const zJOut0 = lineZAt(lOut, joinXY.x, joinXY.y);
    return {
      ...empty,
      zIn: zJIn0 === null ? null : r9(zJIn0), zOut: zJOut0 === null ? null : r9(zJOut0),
      reason: 'REJECT_SOURCE_JOINT_STEP',
      detail: `source-step in-end=${vzIn} out-start=${vzOut}`,
    };
  }
  const sol = solveAnalyticCorner({
    vx, vy, vz: vzIn, inT, inN, inGs, outT, outN, outGs,
    inCriterion: incoming.criterion, outCriterion: outgoing.criterion, maxSearchDistance: ms,
  });
  // Laws at the admitted join (the built node) — evaluated once, reported on
  // every path so a rejection still shows what the join laws said.
  const zJIn = lineZAt(lIn, joinXY.x, joinXY.y);
  const zJOut = lineZAt(lOut, joinXY.x, joinXY.y);
  const out: TieEval = { ...empty, zIn: zJIn === null ? null : r9(zJIn), zOut: zJOut === null ? null : r9(zJOut) };
  if (!sol.ok) {
    return sol.detail === 'GRADING_ANALYTIC_CORNER_Z'
      ? { ...out, reason: 'REJECT_XYZ_TIE_MISMATCH', detail: sol.detail }
      : { ...out, reason: 'REJECT_ANALYTIC_CORNER', detail: sol.detail };
  }
  if (sol.kind === 'coincident') {
    return { ...out, reason: 'REJECT_XY_TIE_MISMATCH', detail: 'coincident-no-tie' };
  }
  const tieJoinDist = Math.hypot(sol.tie.x - joinXY.x, sol.tie.y - joinXY.y);
  const tieOut: TieEval = {
    ...out, tieXYZ: q(sol.tie), tieJoinDist: r9(tieJoinDist),
    xyAgree: Number.isFinite(sol.tie.x) && Number.isFinite(sol.tie.y), zAgree: false,
  };
  // (9) search-neighborhood (structural, NOT numerical agreement): the
  // certifying tie must lie within the same search neighborhood that admits
  // the built join — |tie-join| within maxSearchDistance via the shared
  // extent comparison (reused bound, no new constant). This certifies ONLY
  // locality: both points derive from the same corner's P0 candidacy under
  // one maxSearchDistance. Coincidence is NOT required and NOT claimed:
  // offset-intersection vs terminal-miter differ structurally (0.2277 m on
  // every arc corner). It is explicitly NOT an E1 numerical-agreement claim
  // (the ~7.1e-13 band only guards ULP flips at the bound).
  if (!extentJVWithin(tieJoinDist, ms, joinWorldScale(joinXY.x, joinXY.y))) {
    return { ...tieOut, reason: 'REJECT_TIE_OUTSIDE_SEARCH', detail: `|tie-join|=${r9(tieJoinDist)}` };
  }
  // (10) tie-at-join law: both member laws single-valued AT THE JOIN within
  // production zeroDelta. Sloped laws vary along plan (11 mm on fixture B
  // corner 0: 5.238612788 vs 5.25); flat laws are plan-constant (gs=0), so
  // the tie-join distance cannot introduce Z ambiguity there. Exact, with
  // that justification — no agreement band on Z.
  const zAgree = zJIn !== null && zJOut !== null && Math.abs(zJIn - zJOut) <= zeroDelta(zJIn, zJOut);
  if (!zAgree) {
    return { ...tieOut, reason: 'REJECT_JOIN_Z_MISMATCH', detail: `join-z-in=${tieOut.zIn} join-z-out=${tieOut.zOut}` };
  }
  return { ...tieOut, joinZ: r9(zJIn!), zAgree: true };
};

// ───────────────────────── fixture geometry ─────────────────────────

interface LineSeg { kind: 'line'; x0: number; y0: number; x1: number; y1: number }
interface ArcSeg { kind: 'arc'; cx: number; cy: number; r: number; a0: number; a1: number; dir: 1 | -1 }
type Seg = LineSeg | ArcSeg;

const jointOf = (s: Seg, at: 'start' | 'end'): { x: number; y: number } =>
  s.kind === 'line'
    ? (at === 'start' ? { x: s.x0, y: s.y0 } : { x: s.x1, y: s.y1 })
    : { x: s.cx + s.r * Math.cos(at === 'start' ? s.a0 : s.a1), y: s.cy + s.r * Math.sin(at === 'start' ? s.a0 : s.a1) };

const segTangent = (s: Seg, at: 'start' | 'end'): PlanVector => {
  if (s.kind === 'line') {
    const l = Math.hypot(s.x1 - s.x0, s.y1 - s.y0);
    return { nx: (s.x1 - s.x0) / l, ny: (s.y1 - s.y0) / l };
  }
  const a = at === 'start' ? s.a0 : s.a1;
  return { nx: s.dir * -Math.sin(a), ny: s.dir * Math.cos(a) };
};

const segLen = (s: Seg): number => (s.kind === 'line' ? Math.hypot(s.x1 - s.x0, s.y1 - s.y0) : Math.abs(s.r * (s.a1 - s.a0)));

/** Member terminal at one end (V = that joint), spans [-L,0] / [0,L]. */
const specAt = (s: Seg, at: 'start' | 'end'): MemberSpec => {
  const v = jointOf(s, at);
  const L = segLen(s);
  const span: [number, number] = at === 'end' ? [-L, 0] : [0, L];
  if (s.kind === 'line') {
    const t = segTangent(s, 'start');
    return { kind: 'line', vx: v.x, vy: v.y, tx: t.nx, ty: t.ny, spanStart: span[0], spanEnd: span[1] };
  }
  return { kind: 'arc', vx: v.x, vy: v.y, cx: s.cx, cy: s.cy, radius: s.r, dir: s.dir, spanStart: span[0], spanEnd: span[1] };
};

// Fixed 3-member chain: line → arc → line (the Phase 20L/20L.1 B shape).
const CHAIN: Seg[] = [
  { kind: 'line', x0: -40, y0: 0, x1: 0, y1: 0 },
  { kind: 'arc', cx: 50, cy: 0, r: 50, a0: Math.PI, a1: Math.PI / 2, dir: -1 },
  { kind: 'line', x0: 50, y0: 50, x1: 50, y1: 90 },
];
const SIDE: GradingSide = 'left';
const MS = 100;
const ARC_LEN = 50 * (Math.PI / 2);
const G_ARC = 0.05;

interface MemberZ { startZ: number; endZ: number }

const FLAT_Z: MemberZ[] = [{ startZ: 0, endZ: 0 }, { startZ: 0, endZ: 0 }, { startZ: 0, endZ: 0 }];
// gs_lines = -G, gs_arc = +G: makes both terminal-line ties Z-agree.
const SLOPED_Z: MemberZ[] = [
  { startZ: 2, endZ: 0 },
  { startZ: 0, endZ: G_ARC * ARC_LEN },
  { startZ: G_ARC * ARC_LEN, endZ: G_ARC * ARC_LEN - 2 },
];
const UNEQUAL_FLAT_Z: MemberZ[] = [{ startZ: 0, endZ: 0 }, { startZ: 2, endZ: 2 }, { startZ: 2, endZ: 2 }];

const DIST = (distance: number): GradingCriterion => ({ kind: 'distance', gradeRatio: 1, distance });
const RELEL = (gradeRatio: number, relativeElevation: number): GradingCriterion =>
  ({ kind: 'relative-elevation', gradeRatio, relativeElevation });
const EFLAT = (targetElevation: number): GradingCriterion => ({ kind: 'elevation', gradeRatio: 1, targetElevation });

interface FixtureSpec {
  id: string;
  family: string;
  description: string;
  z: MemberZ[];
  criteria: GradingCriterion[];
  expected: 'ADMIT' | 'REJECT';
  expectedReason: XyzTieReason;
}

const FIXTURES: FixtureSpec[] = [
  { id: 'A', family: 'DIST_FLAT', description: 'homogeneous Distance, flat source (control)', z: FLAT_Z, criteria: [DIST(5), DIST(5), DIST(5)], expected: 'ADMIT', expectedReason: 'Z_TIE_OK' },
  { id: 'B', family: 'DIST_SLOPED_ARC', description: 'homogeneous Distance, sloped source: flat-only predicate rejects (join laws 5.238612788 vs 5.25 kept as provenance)', z: SLOPED_Z, criteria: [DIST(5), DIST(5), DIST(5)], expected: 'REJECT', expectedReason: 'REJECT_SLOPED_SOURCE' },
  { id: 'C', family: 'REL_EL_SLOPED', description: 'homogeneous Relative-elevation, sloped source: flat-only predicate rejects (same 11 mm provenance)', z: SLOPED_Z, criteria: [RELEL(1, 5), RELEL(1, 5), RELEL(1, 5)], expected: 'REJECT', expectedReason: 'REJECT_SLOPED_SOURCE' },
  { id: 'D', family: 'ELEV_FLAT', description: 'homogeneous flat Elevation (control)', z: FLAT_Z, criteria: [EFLAT(5), EFLAT(5), EFLAT(5)], expected: 'ADMIT', expectedReason: 'Z_TIE_OK' },
  { id: 'E', family: 'MIXED_SAME_D_SAME_Z', description: 'mixed Distance↔RelEl on sloped source: flat-only predicate rejects (same d, 11 mm join provenance)', z: SLOPED_Z, criteria: [DIST(5), RELEL(1, 5), DIST(5)], expected: 'REJECT', expectedReason: 'REJECT_SLOPED_SOURCE' },
  { id: 'F', family: 'MIXED_SAME_D_DIFF_Z', description: 'Distance D=5 (Z+5) vs RelEl g=2,Δ=10 (d=5, Z+10): same d, different Z', z: FLAT_Z, criteria: [DIST(5), RELEL(2, 10), DIST(5)], expected: 'REJECT', expectedReason: 'REJECT_XYZ_TIE_MISMATCH' },
  { id: 'G', family: 'DIFF_D', description: 'Distance D=5 vs Distance D=7: different required plan d', z: FLAT_Z, criteria: [DIST(5), DIST(7), DIST(5)], expected: 'REJECT', expectedReason: 'REJECT_D_MISMATCH' },
  { id: 'H', family: 'ELEV_MEMBER_MISMATCH', description: 'flat Elevation on unequal member flats (z=0 vs z=2): d=5 vs d=3', z: UNEQUAL_FLAT_Z, criteria: [EFLAT(5), EFLAT(5), EFLAT(5)], expected: 'REJECT', expectedReason: 'REJECT_ELEVATION_MEMBER_MISMATCH' },
  { id: 'I', family: 'DIST_STEP_0_VS_2', description: 'Distance, flat members with a 0-vs-2 source-joint step: true limits 5 vs 7, step rejects', z: [{ startZ: 0, endZ: 0 }, { startZ: 2, endZ: 2 }, { startZ: 2, endZ: 2 }], criteria: [DIST(5), DIST(5), DIST(5)], expected: 'REJECT', expectedReason: 'REJECT_SOURCE_JOINT_STEP' },
];

// ───────────────────────── mesh (exact offset + per-point Z) ─────────────────────────

interface Xyz { x: number; y: number; z: number }
interface XY { x: number; y: number }

const farOffset = (s: Seg, at: 'start' | 'end', side: GradingSide, d: number): XY => {
  const p = jointOf(s, at);
  const t = segTangent(s, at);
  const n = gradingSideNormal(t.nx, t.ny, side)!;
  return { x: p.x + d * n.nx, y: p.y + d * n.ny };
};

/** Source samples with the production arc/line Z interpolation rule. */
const sourceSamples = (s: Seg, mz: MemberZ, k: number): Xyz[] => {
  if (s.kind === 'line') {
    const out: Xyz[] = [];
    for (let i = 0; i < k; i += 1) {
      const f = i / (k - 1);
      out.push({ x: s.x0 + (s.x1 - s.x0) * f, y: s.y0 + (s.y1 - s.y0) * f, z: mz.startZ + (mz.endZ - mz.startZ) * f });
    }
    return out;
  }
  const lin = linearizeGradingArc(s.cx, s.cy, s.r, s.a0, s.a1, s.dir === 1, mz.startZ, mz.endZ, 1e-6);
  if (!lin) return [];
  let sweep = s.dir === 1 ? s.a1 - s.a0 : s.a0 - s.a1;
  sweep = ((sweep % TAU) + TAU) % TAU;
  const out: Xyz[] = [];
  for (let i = 0; i < k; i += 1) {
    const f = i / (k - 1);
    const ang = s.a0 + s.dir * sweep * f;
    out.push({ x: s.cx + s.r * Math.cos(ang), y: s.cy + s.r * Math.sin(ang), z: mz.startZ + (mz.endZ - mz.startZ) * f });
  }
  return out;
};

/** Offset (daylight) sample XY at the same fraction between two offset nodes. */
const offsetSample = (m: MemberSpec, from: XY, to: XY, i: number, k: number, rOff: number): XY => {
  const f = i / (k - 1);
  if (m.kind === 'line') {
    return { x: from.x + (to.x - from.x) * f, y: from.y + (to.y - from.y) * f };
  }
  const lon = Math.atan2(from.y - m.cy, from.x - m.cx);
  const lat = Math.atan2(to.y - m.cy, to.x - m.cx);
  let sweep = m.dir === 1 ? lat - lon : lon - lat;
  sweep = ((sweep % TAU) + TAU) % TAU;
  const ang = lon + m.dir * sweep * f;
  return { x: m.cx + rOff * Math.cos(ang), y: m.cy + rOff * Math.sin(ang) };
};

interface CornerArtifact {
  joinXY: XY | null;
  tieXYZ: { x: number; y: number; z: number } | null;
  zIn: number | null;
  zOut: number | null;
  /** Agreed single Z at the join (the honest corner-node height). */
  joinZ: number | null;
  d: number | null;
}

interface FixtureMesh {
  built: boolean;
  exact: boolean;
  finite: boolean;
  components: number;
  edgeComponents: number;
  boundaryEdges: number;
  daylightContinuity: boolean;
  noInteriorOverlap: boolean;
  meshArea: number;
  sourceZContinuous: boolean;
  daylightZTieOk: boolean;
  detail: string;
}

const failMesh = (detail: string): FixtureMesh => ({
  built: false, exact: false, finite: false, components: 0, edgeComponents: 0, boundaryEdges: 0,
  daylightContinuity: false, noInteriorOverlap: false, meshArea: 0, sourceZContinuous: false, daylightZTieOk: false, detail,
});

/** Build the exact-offset XYZ strip; corner nodes carry the production tie Z. */
const buildFixtureMesh = (
  f: FixtureSpec,
  corners: CornerArtifact[],
  memberD: (number | null)[],
  k = 25,
): FixtureMesh => {
  const srcNodes: Xyz[] = [{ ...jointOf(CHAIN[0]!, 'start'), z: f.z[0]!.startZ }];
  for (let j = 0; j < 2; j += 1) srcNodes.push({ ...jointOf(CHAIN[j]!, 'end'), z: f.z[j]!.endZ });
  srcNodes.push({ ...jointOf(CHAIN[2]!, 'end'), z: f.z[2]!.endZ });
  const dayNodes: Xyz[] = [
    { ...farOffset(CHAIN[0]!, 'start', SIDE, memberD[0] ?? 5), z: 0 },
  ];
  for (let j = 0; j < 2; j += 1) {
    const c = corners[j]!;
    const join = c.joinXY ?? { x: srcNodes[j + 1]!.x, y: srcNodes[j + 1]!.y };
    dayNodes.push({ x: join.x, y: join.y, z: c.joinZ ?? c.tieXYZ?.z ?? c.zIn ?? 0 });
  }
  dayNodes.push({ ...farOffset(CHAIN[2]!, 'end', SIDE, memberD[2] ?? 5), z: 0 });
  const S: Xyz[] = [];
  const D: Xyz[] = [];
  for (let i = 0; i < 3; i += 1) {
    const dMember = memberD[i] ?? 5;
    const member = specAt(CHAIN[i]!, 'end');
    const sSamples = sourceSamples(CHAIN[i]!, f.z[i]!, k);
    if (sSamples.length !== k) return failMesh('SOURCE_SAMPLES');
    const arc = CHAIN[i]!.kind === 'arc' ? (CHAIN[i] as ArcSeg) : null;
    const rOff = arc ? arc.r + (radialSignOf(member, SIDE) ?? 0) * dMember : 0;
    const from = i === 0 ? dayNodes[0]! : dayNodes[i]!;
    const to = i === 2 ? dayNodes[3]! : dayNodes[i + 1]!;
    const dSamples: Xyz[] = [];
    for (let p = 0; p < k; p += 1) {
      const src = sSamples[p]!;
      const off = offsetSample(member, from, to, p, k, rOff);
      const limit = resolveAnalyticCriterionAt(f.criteria[i]!, src.z, MS);
      let z = limit.ok ? limit.value.limitElevation : src.z;
      if (p === 0 && i > 0) z = dayNodes[i]!.z;
      if (p === k - 1 && i < 2) z = dayNodes[i + 1]!.z;
      dSamples.push({ x: off.x, y: off.y, z });
    }
    const skip = i === 0 ? 0 : 1;
    for (let p = skip; p < k; p += 1) { S.push(sSamples[p]!); D.push(dSamples[p]!); }
  }
  const points: number[] = [];
  for (const p of S) points.push(p.x, p.y, p.z);
  for (const p of D) points.push(p.x, p.y, p.z);
  const tris: number[] = [];
  const emit = (a: number, b: number, c: number): void => {
    const area2 =
      (points[b * 3]! - points[a * 3]!) * (points[c * 3 + 1]! - points[a * 3 + 1]!) -
      (points[c * 3]! - points[a * 3]!) * (points[b * 3 + 1]! - points[a * 3 + 1]!);
    if (area2 === 0) return;
    if (area2 > 0) tris.push(a, b, c); else tris.push(a, c, b);
  };
  const m = S.length;
  for (let i = 0; i + 1 < m; i += 1) {
    emit(i, i + 1, m + i + 1);
    emit(i, m + i + 1, m + i);
  }
  const mesh: MergedGroupMesh = { points, triangles: tris };
  const daylight: MergePoint[] = D.map((p) => ({ x: p.x, y: p.y, z: p.z }));
  const audit = auditMesh(mesh, daylight, false);
  const sourceZContinuous = f.z[0]!.endZ === f.z[1]!.startZ && f.z[1]!.endZ === f.z[2]!.startZ;
  const daylightZTieOk = corners.every((c) =>
    c.tieXYZ !== null && c.zIn !== null && c.zOut !== null && Math.abs(c.zIn - c.zOut) <= zeroDelta(c.zIn, c.zOut));
  return {
    built: true, exact: corners.every((c) => c.joinZ !== null),
    finite: audit.checks.finite === true && mesh.points.every(Number.isFinite),
    components: audit.components, edgeComponents: audit.edgeComponents, boundaryEdges: audit.boundaryEdges,
    daylightContinuity: audit.checks.daylight === true,
    noInteriorOverlap: audit.checks.noInteriorOverlap === true,
    meshArea: r9(audit.meshArea),
    sourceZContinuous, daylightZTieOk,
    detail: audit.pass ? 'AUDIT_OK' : `AUDIT_FAIL(${audit.issues.join(';')})`,
  };
};

// ───────────────────────── corpus ─────────────────────────

interface CorpusCorner {
  index: number;
  localP0: boolean;
  planReasonIn: string;
  planReasonOut: string;
  d: number | null;
  dIn: number | null;
  dOut: number | null;
  joinXY: XY | null;
  tieXYZ: { x: number; y: number; z: number } | null;
  /** Laws at the admitted join (the built node). */
  zIn: number | null;
  zOut: number | null;
  /** Agreed single Z at the join (null unless tied). */
  joinZ: number | null;
  /** |tie - join| plan distance. */
  tieJoinDist: number | null;
  xyAgree: boolean;
  zAgree: boolean;
  reason: XyzTieReason;
  active: boolean;
  detail: string;
}

/** Stable fixture entry point for tests: the gate input for one fixture corner. */
export const xyzFixtureTieInput = (id: string, j: number): XyzTieCornerInput => {
  const f = FIXTURES.find((x) => x.id === id);
  if (!f) throw new Error(`unknown xyz fixture ${id}`);
  return {
    incoming: { member: specAt(CHAIN[j]!, 'end'), criterion: f.criteria[j]!, startZ: f.z[j]!.startZ, endZ: f.z[j]!.endZ },
    outgoing: { member: specAt(CHAIN[j + 1]!, 'start'), criterion: f.criteria[j + 1]!, startZ: f.z[j + 1]!.startZ, endZ: f.z[j + 1]!.endZ },
    side: SIDE, maxSearchDistance: MS,
  };
};

const buildCorner = (f: FixtureSpec, j: number): CorpusCorner => {
  const res = xyzRunTieOk(xyzFixtureTieInput(f.id, j));
  return {
    index: j, localP0: res.localP0, planReasonIn: res.planReasonIn, planReasonOut: res.planReasonOut,
    d: res.d === null ? null : r9(res.d), dIn: res.dIn === null ? null : r9(res.dIn), dOut: res.dOut === null ? null : r9(res.dOut),
    joinXY: res.joinXY ? { x: r9(res.joinXY.x), y: r9(res.joinXY.y) } : null,
    tieXYZ: res.tieXYZ, zIn: res.zIn, zOut: res.zOut,
    joinZ: res.joinZ, tieJoinDist: res.tieJoinDist,
    xyAgree: res.xyAgree, zAgree: res.zAgree, reason: res.reason,
    active: res.ok, detail: res.detail,
  };
};

export const buildCorpus = () => {
  const fixtures = FIXTURES.map((f) => {
    const corners = [buildCorner(f, 0), buildCorner(f, 1)];
    const memberD = f.z.map((mz, i) => planLawOf({ member: specAt(CHAIN[i]!, 'end'), criterion: f.criteria[i]!, startZ: mz.startZ, endZ: mz.endZ }, MS).d);
    const mesh = buildFixtureMesh(f, corners, memberD);
    const gateOk = corners.every((c) => c.reason === 'Z_TIE_OK');
    return {
      id: f.id, family: f.family, description: f.description,
      expected: f.expected, expectedReason: f.expectedReason,
      members: CHAIN.map((s, i) => ({
        kind: s.kind, length: r9(segLen(s)),
        startZ: r9(f.z[i]!.startZ), endZ: r9(f.z[i]!.endZ),
        grade: r9((f.z[i]!.endZ - f.z[i]!.startZ) / segLen(s)),
        criterion: { ...f.criteria[i]! },
      })),
      corners,
      gate: { ok: gateOk, reason: gateOk ? 'Z_TIE_OK' : corners.find((c) => c.reason !== 'Z_TIE_OK')!.reason, activeCorners: corners.filter((c) => c.active).map((c) => c.index) },
      mesh,
    };
  });
  const payload = {
    generator: 'scripts/phase20l1XyzTies.ts',
    baseline: 'PR #147 research/phase20l1-offset-radius-policy-resolution @ 952a5d0f (Task C study)',
    contract: 'xyzRunTieOk(one adjacent pair): (1) each member plan law analytically constant, (2) SAME required plan d, (3) every arc Roff>0 exact, (4) local P0 plan join UNIQUE/on-body/in-extent, (5) production solveAnalyticCorner accepts the tie, (6) analytic tie XY exact under the analytic authority, (7) [SUPERSEDED by 10: tie-Z agreement vacuous — laws agree at the tie by construction], (8) no incident fallback, (9) search-neighborhood (structural, NOT numerical agreement): the certifying tie lies within the same search neighborhood that admits the join (|tie-join| within maxSearchDistance via the shared extent comparison — reused bound; coincidence NOT required, constructions differ 0.2277 m on arc corners; explicitly NOT an E1 numerical-agreement claim), (10) tie-at-join law: both member daylight-Z laws single-valued AT THE JOIN within production zeroDelta (flat laws plan-constant, so exact with justification; sloped 11 mm fails), (11) FLAT-ONLY predicate (gate code, ===, no tolerance): each member startZ===endZ exactly — sloped members reject REJECT_SLOPED_SOURCE identically from 1e-13 to gross, before any zeroDelta leniency. (12) source-joint continuity (mirrors production exactXyz gradingGroupCompute.ts:137-138, same === on the Z leg; XY legs coincide by construction): incoming.endZ===outgoing.startZ exactly — a 0-vs-2 step rejects REJECT_SOURCE_JOINT_STEP with true per-member limits (5 vs 7) in provenance. Mixed families need same-d NECESSARY + same-join-Z REQUIRED, all flat, all joint-continuous.',
    provenBehavior: 'only analytically-proven plan laws resolve d (distance/relative-elevation constant; elevation flat only); a proven same-d run is still rejected unless both member laws agree at the admitted join — the built node — within production zeroDelta, and both members are exactly flat (===). The analytic tie is structural compatibility + provenance, never the certified point. Flatness is gate code, not prose; joint continuity mirrors production exactXyz (Z leg).',
    reasonCodes: ['Z_TIE_OK', 'XY_AGREE', 'REJECT_PLAN_LAW_NONCONSTANT', 'REJECT_D_MISMATCH', 'REJECT_ELEVATION_MEMBER_MISMATCH', 'REJECT_ROFF', 'REJECT_PLAN_JOIN', 'REJECT_ANALYTIC_CORNER', 'REJECT_XY_TIE_MISMATCH', 'REJECT_XYZ_TIE_MISMATCH', 'REJECT_TIE_OUTSIDE_SEARCH', 'REJECT_JOIN_Z_MISMATCH', 'REJECT_SLOPED_SOURCE', 'REJECT_SOURCE_JOINT_STEP', 'REJECT_FALLBACK'],
    rHook: { point: 'phase20l1GroupBuild CornerBuild.xyzTie', gate: 'xyzRunTieOk', routeDecision: 'owned by the parallel routing worker; this study pins only the gate + fixture outcomes' },
    scope: { curvedClosed: 'OUT_OF_SCOPE_CHORD_FALLBACK: closed curved groups remain whole-group chord in group-corpus.json (every curved stadium corner is B0); no exact curved-closed tie is claimed here.' },
    noTransitionGeometry: true,
    extentRule: 'consumed as-is from the boundary worker (E1): criterion d<=maxSearchDistance exact + extentJVWithin(|J-V|, ms) shared helper; never re-derived or edited here.',
    fixtures,
  };
  return { ...payload, digest: sha16(payload) };
};

const main = (): void => {
  const corpus = buildCorpus();
  const out = join(dirname(new URL(import.meta.url).pathname), '..', 'docs', 'evidence', 'phase20l1', 'xyz-corpus.json');
  mkdirSync(dirname(out), { recursive: true });
  const body = `${JSON.stringify(corpus, null, 2)}\n`;
  writeFileSync(out, body);
  const again = `${JSON.stringify(buildCorpus(), null, 2)}\n`;
  console.log(`fixtures=${corpus.fixtures.length} digest=${corpus.digest} regenIdentical=${again === body}`);
  for (const f of corpus.fixtures as Array<{ id: string; corners: CorpusCorner[]; gate: { reason: string }; mesh: FixtureMesh }>) {
    console.log(`${f.id} corners=[${f.corners.map((c) => `${c.reason}${c.localP0 ? '(local)' : ''}`).join(',')}] gate=${f.gate.reason} mesh=${f.mesh.detail} exact=${f.mesh.exact} zTie=${f.mesh.daylightZTieOk}`);
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
