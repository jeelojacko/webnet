/**
 * Phase 20L.1 Task B — GROUP/MEMBER BUILDABILITY STUDY (STUDY ONLY).
 *
 * External review: local P0 corner candidacy (15/186 rows) != member/group
 * buildability. This module builds exact-offset strip meshes over 2- and
 * 3-member open chains and closed chains from the Phase 20L primitives
 * (classifyOffsetJoin + offsetCurveOf + resolveCornerEffective + auditMesh),
 * with NO production-algorithm copies and ZERO src/ changes.
 *
 * Method per chain: resolve one proven d per corner (study predicate, d from
 * the production analytic authority), solve each corner join (UNIQUE +
 * in-span + branch-consistent + BOTH extent gates + independent candidacy
 * audit), THEN prove the XYZ tie per corner through the production
 * analytic corner authority (`xyzRunTieOk`: same plan d + single-valued
 * daylight Z, ordered 8-gate contract), and route at the WHOLE-CHAIN unit
 * (R0 all-or-fallback): the exact strip is stitched ONLY when every
 * required corner is a local P0 candidate AND XYZ-tied sharing one proven
 * d (closed groups additionally require line-only — a closed group
 * containing any arc routes CHORD_FALLBACK as curved-closed support, not
 * control). Mixed chains build NO exact strip: local P0 candidacy at one
 * corner never activates exact geometry anywhere, and a plan-admitted
 * corner whose members disagree in daylight Z (same-d/diff-Z) is tied
 * INACTIVE by the XYZ gate. No transition geometry is ever invented.
 *
 * Vocabulary (kept distinct everywhere): LOCAL_P0_CANDIDATE (per-corner
 * candidacy) vs ACTIVE_EXACT_CORNER (candidacy + whole-chain route EXACT)
 * vs INACTIVE_DUE_TO_GROUP_FALLBACK (candidate but route fell back).
 *
 * Emits docs/evidence/phase20l1/group-corpus.json (sorted keys, stable
 * floats, byte-identical across runs). Wired nowhere.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { gradingSideNormal } from '../src/engine/cad/grading/gradingCourseFrame';
import { resolveAnalyticCriterionAt } from '../src/engine/cad/grading/gradingAnalyticCriterion';
import { zeroDelta } from '../src/engine/cad/surfaces/volume/zero';
import { ringIsSimple, type MergePoint, type MergedGroupMesh } from '../src/engine/cad/grading/gradingGroupMerge';
import type { GradingCriterion, GradingSide } from '../src/engine/cad/grading/gradingTypes';
import { auditMesh } from './phase20kHybridArcPairAudit';
import { classifyOffsetJoin, type MemberSpec } from './phase20lOffsetJoinCore';
import { extentJVWithin, joinWorldScale, resolveCornerEffective } from './phase20l1EffectiveCriterion';
import { auditCornerCandidacy } from './phase20l1PolicyCorpus';
import { xyzRunTieOk } from './phase20l1XyzTies';
import type { JoinFixture } from './phase20lOffsetRadiusVariants';

const sha16 = (v: unknown): string => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16);
const r9 = (n: number): number => (Number.isFinite(n) ? Number(n.toFixed(9)) : n);

// ── chain segment model (study-owned; MemberSpecs derived per corner) ──

interface LineSeg { kind: 'line'; x0: number; y0: number; x1: number; y1: number }
interface ArcSeg { kind: 'arc'; cx: number; cy: number; r: number; a0: number; a1: number; dir: 1 | -1 }
type Seg = LineSeg | ArcSeg;

const segLen = (s: Seg): number =>
  s.kind === 'line' ? Math.hypot(s.x1 - s.x0, s.y1 - s.y0) : Math.abs(s.r * (s.a1 - s.a0));

const segTangent = (s: Seg, at: 'start' | 'end'): { nx: number; ny: number } => {
  if (s.kind === 'line') {
    const l = Math.hypot(s.x1 - s.x0, s.y1 - s.y0);
    return { nx: (s.x1 - s.x0) / l, ny: (s.y1 - s.y0) / l };
  }
  const a = at === 'start' ? s.a0 : s.a1;
  return { nx: s.dir * -Math.sin(a), ny: s.dir * Math.cos(a) };
};

const jointOf = (s: Seg, at: 'start' | 'end'): { x: number; y: number } =>
  s.kind === 'line'
    ? at === 'start' ? { x: s.x0, y: s.y0 } : { x: s.x1, y: s.y1 }
    : { x: s.cx + s.r * Math.cos(at === 'start' ? s.a0 : s.a1), y: s.cy + s.r * Math.sin(at === 'start' ? s.a0 : s.a1) };

/** MemberSpec of one chain member at one of its ends (V = that joint). Exported for tests. */
export const specAt = (s: Seg, at: 'start' | 'end'): MemberSpec => {
  const v = jointOf(s, at);
  const L = segLen(s);
  const inSpan: [number, number] = at === 'end' ? [-L, 0] : [0, L];
  if (s.kind === 'line') {
    const t = segTangent(s, 'start');
    return { kind: 'line', vx: v.x, vy: v.y, tx: t.nx, ty: t.ny, spanStart: inSpan[0], spanEnd: inSpan[1] };
  }
  return {
    kind: 'arc', vx: v.x, vy: v.y, cx: s.cx, cy: s.cy, radius: s.r, dir: s.dir,
    spanStart: inSpan[0], spanEnd: inSpan[1],
  };
};

// ── P0 corner solve (consumes the 20L.1 extent-gate admission as-is) ──

export interface CornerBuild {
  index: number;
  admit: boolean;
  reason: string;
  d: number | null;
  jx: number | null;
  jy: number | null;
  distV: number | null;
  /** Local candidacy (= admit). Never implies built geometry on its own. */
  localP0: boolean;
  /** True only when the whole-chain route is EXACT (R0). Set by solveChain. */
  activeExact: boolean;
  /** Production XYZ tie outcome per corner (`xyzRunTieOk` reason code;
   *  XYZ_TIE_NOT_EVALUATED when the plan gate already rejected the corner).
   *  ACTIVE_EXACT_CORNER requires localP0 AND tieOk. */
  xyzTie: string;
  /** True iff the production analytic tie is single-valued (Z_TIE_OK path). */
  tieOk: boolean;
  /** Daylight Z per side at the tie (null unless the tie was evaluated). */
  zIn: number | null;
  zOut: number | null;
  tieZ: number | null;
  /** Agreed single law Z at the admitted join (the built corner-node height;
   *  null unless the tie-at-join gate agreed it). */
  joinZ: number | null;
}

const NOT_PROVEN_REASON = (r: string): string =>
  r === 'ELEVATION_SLOPED_SOURCE' ? 'REJECT_CIRCULARITY_SLOPED'
  : r === 'SURFACE_TARGET' ? 'REJECT_CIRCULARITY_SURFACE'
  : r === 'ELEVATION_MEMBER_MISMATCH' ? 'REJECT_CIRCULARITY_MISMATCH'
  : r === 'RADIUS' ? 'REJECT_ROFF'
  : r === 'INVALID_CRITERION' ? 'REJECT_INVALID_CRITERION'
  : 'REJECT_DEGENERATE_SOURCE';

/** Per-member tie context: which production criterion + flat Z each incident
 *  member carries. Absent = homogeneous (corner criterion, z for both). */
export interface CornerTieContext {
  inCriterion: GradingCriterion;
  outCriterion: GradingCriterion;
  inZ: number;
  outZ: number;
}

const TIE_UNEVALUATED = 'XYZ_TIE_NOT_EVALUATED';

/** Solve one corner of a chain exactly the way the policy corpus does,
 *  then prove the XYZ tie through the production analytic authority.
 *  Returns LOCAL_P0_CANDIDATE candidacy + tie outcome; solveChain decides
 *  ACTIVE_EXACT (requires both). */
export const solveChainCorner = (
  index: number,
  incoming: MemberSpec,
  outgoing: MemberSpec,
  side: GradingSide,
  criterion: GradingCriterion,
  z: number,
  ms: number,
  tie?: CornerTieContext,
): CornerBuild => {
  const inCriterion = tie?.inCriterion ?? criterion;
  const outCriterion = tie?.outCriterion ?? criterion;
  const zIn = tie?.inZ ?? z;
  const zOut = tie?.outZ ?? z;
  const eff = resolveCornerEffective(
    criterion,
    [
      { member: incoming, startZ: zIn, endZ: zIn },
      { member: outgoing, startZ: zOut, endZ: zOut },
    ],
    side,
    ms,
  );
  if (!eff.proven) return { index, admit: false, reason: NOT_PROVEN_REASON(eff.reason), d: null, jx: null, jy: null, distV: null, localP0: false, activeExact: false, xyzTie: TIE_UNEVALUATED, tieOk: false, zIn: null, zOut: null, tieZ: null, joinZ: null };
  const d = eff.d;
  if (incoming.kind === 'arc' && outgoing.kind === 'arc') {
    return { index, admit: false, reason: 'REJECT_ARC_PAIR_NO_GO', d, jx: null, jy: null, distV: null, localP0: false, activeExact: false, xyzTie: TIE_UNEVALUATED, tieOk: false, zIn: null, zOut: null, tieZ: null, joinZ: null };
  }
  const r = classifyOffsetJoin({ incoming, outgoing, side, offset: d, maxSearchDistance: ms });
  const adm = r.candidates.filter((c) => c.inSpan && c.branchConsistent);
  const sel = adm.length === 1 && r.classification === 'OFFSET_JOIN_UNIQUE' ? adm[0]! : null;
  const distV = sel ? sel.distV : null;
  const dPass = d <= ms;
  // Extent comparison consumed from the boundary worker's helper (never re-derived here).
  const jvPass = distV !== null && extentJVWithin(distV, ms, joinWorldScale(incoming.vx, incoming.vy));
  const fix: JoinFixture = {
    id: `chain-corner-${index}`, note: 'study chain corner',
    input: { incoming, outgoing, side, offset: d, maxSearchDistance: ms },
  };
  const audit = auditCornerCandidacy(fix, d, ms);
  if (!sel) {
    return {
      index, admit: false, d, jx: null, jy: null, distV: r9(distV ?? NaN),
      reason: r.classification === 'OFFSET_JOIN_AMBIGUOUS' ? 'REJECT_AMBIGUITY_B0' : 'REJECT_NON_UNIQUE',
      localP0: false, activeExact: false, xyzTie: TIE_UNEVALUATED, tieOk: false, zIn: null, zOut: null, tieZ: null, joinZ: null,
    };
  }
  if (!dPass) return { index, admit: false, reason: 'REJECT_EXTENT_D', d, jx: null, jy: null, distV: r9(distV!), localP0: false, activeExact: false, xyzTie: TIE_UNEVALUATED, tieOk: false, zIn: null, zOut: null, tieZ: null, joinZ: null };
  if (!jvPass) return { index, admit: false, reason: 'REJECT_EXTENT_JV', d, jx: null, jy: null, distV: r9(distV!), localP0: false, activeExact: false, xyzTie: TIE_UNEVALUATED, tieOk: false, zIn: null, zOut: null, tieZ: null, joinZ: null };
  if (!audit.pass) return { index, admit: false, reason: 'REJECT_CANDIDACY_AUDIT', d, jx: null, jy: null, distV: r9(distV!), localP0: false, activeExact: false, xyzTie: TIE_UNEVALUATED, tieOk: false, zIn: null, zOut: null, tieZ: null, joinZ: null };
  // Plan admits: prove the XYZ tie through the production authority. A
  // same-d/diff-Z corner (Distance vs RelEl at different daylight Z) is
  // tied INACTIVE here even though its plan join is UNIQUE and in-extent.
  const gate = xyzRunTieOk({
    incoming: { member: incoming, criterion: inCriterion, startZ: zIn, endZ: zIn },
    outgoing: { member: outgoing, criterion: outCriterion, startZ: zOut, endZ: zOut },
    side, maxSearchDistance: ms,
  });
  const tieZ = gate.tieXYZ ? r9(gate.tieXYZ.z) : null;
  if (!gate.ok) {
    return {
      index, admit: false, reason: gate.reason, d, jx: r9(sel.x), jy: r9(sel.y), distV: r9(distV!),
      localP0: true, activeExact: false, xyzTie: gate.reason, tieOk: false,
      zIn: gate.zIn, zOut: gate.zOut, tieZ, joinZ: gate.joinZ,
    };
  }
  return { index, admit: true, reason: 'LOCAL_P0_CANDIDATE', d, jx: r9(sel.x), jy: r9(sel.y), distV: r9(distV!), localP0: true, activeExact: false, xyzTie: gate.reason, tieOk: true, zIn: gate.zIn, zOut: gate.zOut, tieZ, joinZ: gate.joinZ };
};

// ── exact-offset strip sampling (source + daylight share joint objects) ──

const wrapPi = (a: number): number => {
  let x = a;
  while (x > Math.PI) x -= 2 * Math.PI;
  while (x <= -Math.PI) x += 2 * Math.PI;
  return x;
};

interface XY { x: number; y: number }
interface XYZ { x: number; y: number; z: number }

/** Daylight node of one member end: exact offset point (far ends) or the corner join (joints). */
const offsetFarEnd = (s: Seg, at: 'start' | 'end', side: GradingSide, d: number): XY => {
  if (s.kind === 'line') {
    const t = segTangent(s, 'start');
    const n = gradingSideNormal(t.nx, t.ny, side)!;
    const p = jointOf(s, at);
    return { x: p.x + d * n.nx, y: p.y + d * n.ny };
  }
  const p = jointOf(s, at);
  const ang = Math.atan2(p.y - s.cy, p.x - s.cx);
  const t = segTangent(s, at);
  const n = gradingSideNormal(t.nx, t.ny, side)!;
  const rx = Math.cos(ang);
  const ry = Math.sin(ang);
  const roff = s.r + d * (n.nx * rx + n.ny * ry);
  return { x: s.cx + roff * Math.cos(ang), y: s.cy + roff * Math.sin(ang) };
};

const sampleSeg = (s: Seg, a: XY, b: XY, k: number): XY[] => {
  if (s.kind === 'line') {
    const out: XY[] = [];
    for (let i = 0; i < k; i += 1) out.push({ x: a.x + ((b.x - a.x) * i) / (k - 1), y: a.y + ((b.y - a.y) * i) / (k - 1) });
    return out;
  }
  const aa = Math.atan2(a.y - s.cy, a.x - s.cx);
  const ab = Math.atan2(b.y - s.cy, b.x - s.cx);
  let sweep = wrapPi(ab - aa);
  if (s.dir === 1 && sweep < 0) sweep += 2 * Math.PI;
  if (s.dir === -1 && sweep > 0) sweep -= 2 * Math.PI;
  const r = Math.hypot(a.x - s.cx, a.y - s.cy);
  const out: XY[] = [];
  for (let i = 0; i < k; i += 1) {
    const ang = aa + (sweep * i) / (k - 1);
    out.push({ x: s.cx + r * Math.cos(ang), y: s.cy + r * Math.sin(ang) });
  }
  return out;
};

export interface StripBuild {
  ok: boolean;
  detail: string;
  source: XYZ[];
  daylight: XYZ[];
  mesh: MergedGroupMesh;
  audit: ReturnType<typeof auditMesh>;
  sourceClosedSimple?: boolean;
  daylightClosedSimple?: boolean;
  reportedArea: number;
  areaRelErr: number | null;
}

const ringArea = (ring: XY[]): number => {
  let a = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const p = ring[i]!;
    const q = ring[(i + 1) % ring.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
};

/**
 * Build the exact-offset strip over a member chain. Daylight Z comes from
 * each member's PRODUCTION limit law per vertex (never the `z = d`
 * assumption): interior/far vertices resolve through
 * `resolveAnalyticCriterionAt` at the member source Z, corner nodes carry
 * the verified single agreed join Z (tie-at-join gate) checked consistent
 * with both incident member limits (fail closed otherwise). Source vertices
 * carry the member source Z. Daylight nodes are the far-end exact offsets +
 * the solved P0 joins, so daylight continuity is exact by construction and
 * the audit verifies it. Every member is sampled with the same k.
 */
export interface StripZContext {
  /** Production criterion per member (mixed chains differ per member). */
  memberCriteria: GradingCriterion[];
  /** Source Z per member. */
  memberZ: number[];
  ms: number;
}

export const buildExactStrip = (
  members: Seg[],
  side: GradingSide,
  d: number,
  joins: XYZ[],
  zc: StripZContext,
  k = 25,
  closed = false,
): StripBuild => {
  const n = members.length;
  const limitOf = (i: number): number | null => {
    const r = resolveAnalyticCriterionAt(zc.memberCriteria[i]!, zc.memberZ[i]!, zc.ms);
    return r.ok ? r.value.limitElevation : null;
  };
  const lim: (number | null)[] = members.map((_, i) => limitOf(i));
  const srcNodes: XYZ[] = [];
  const dayNodes: XYZ[] = [];
  for (let i = 0; i < n; i += 1) srcNodes.push({ ...jointOf(members[i]!, 'start'), z: zc.memberZ[i]! });
  srcNodes.push({ ...jointOf(members[n - 1]!, 'end'), z: zc.memberZ[n - 1]! });
  if (!closed) {
    dayNodes.push({ ...offsetFarEnd(members[0]!, 'start', side, d), z: lim[0] ?? NaN });
    for (const j of joins) dayNodes.push(j);
    dayNodes.push({ ...offsetFarEnd(members[n - 1]!, 'end', side, d), z: lim[n - 1] ?? NaN });
  } else {
    for (const j of joins) dayNodes.push(j);
  }
  // Verified common corner nodes: each join Z must equal both incident
  // member production limits within production zeroDelta.
  let cornerMismatch = false;
  for (let j = 0; j < joins.length; j += 1) {
    const [a, b] = closed ? [j % n, (j + 1) % n] : [j, j + 1];
    const jz = joins[j]!.z;
    const la = lim[a!]!;
    const lb = lim[b!]!;
    if (!Number.isFinite(jz) || la === null || lb === null ||
      Math.abs(jz - la) > zeroDelta(jz, la) || Math.abs(jz - lb) > zeroDelta(jz, lb)) {
      cornerMismatch = true;
    }
  }
  const S: XYZ[] = [];
  const D: XYZ[] = [];
  for (let i = 0; i < n; i += 1) {
    const sPts = sampleSeg(members[i]!, srcNodes[i]!, srcNodes[i + 1]!, k);
    // Closed member i spans corner (i-1)->corner i; open member i spans dayNodes[i]->dayNodes[i+1].
    const dPair = closed
      ? [dayNodes[(i - 1 + n) % n]!, dayNodes[i]!]
      : [dayNodes[i]!, dayNodes[i + 1]!];
    const dPts = sampleSeg(members[i]!, dPair[0], dPair[1], k);
    const skip = i === 0 ? 0 : 1;
    for (let q = skip; q < k; q += 1) {
      S.push({ ...sPts[q]!, z: zc.memberZ[i]! });
      const dz = q === 0 ? dPair[0].z : q === k - 1 ? dPair[1].z : (lim[i] ?? NaN);
      D.push({ ...dPts[q]!, z: dz });
    }
  }
  if (closed) { S.pop(); D.pop(); }
  const points: number[] = [];
  for (const p of S) points.push(p.x, p.y, p.z);
  for (const p of D) points.push(p.x, p.y, p.z);
  const tris: number[] = [];
  const emit = (a: number, b: number, c: number): void => {
    const area2 =
      (points[b * 3]! - points[a * 3]!) * (points[c * 3 + 1]! - points[a * 3 + 1]!) -
      (points[c * 3]! - points[a * 3]!) * (points[b * 3 + 1]! - points[a * 3 + 1]!);
    if (area2 === 0) return;
    if (area2 > 0) tris.push(a, b, c);
    else tris.push(a, c, b);
  };
  const m = S.length;
  const segs = closed ? m : m - 1;
  for (let i = 0; i < segs; i += 1) {
    const j = (i + 1) % m;
    const s0 = i;
    const s1 = j;
    const o0 = m + i;
    const o1 = m + j;
    emit(s0, s1, o1);
    emit(s0, o1, o0);
  }
  const mesh: MergedGroupMesh = { points, triangles: tris };
  const daylight: MergePoint[] = D.map((p) => ({ x: p.x, y: p.y, z: p.z }));
  const audit = auditMesh(mesh, daylight, closed);
  // Closed strip is an annulus: reported = |source ring| - |daylight ring|.
  const reportedArea = closed
    ? Math.abs(ringArea(srcNodes.slice(0, n)) - ringArea(dayNodes))
    : ringArea([...S, ...[...D].reverse()]);
  const areaRelErr = reportedArea > 0 ? Math.abs(audit.meshArea - reportedArea) / reportedArea : null;
  if (!points.every(Number.isFinite) || !audit.pass || cornerMismatch || (areaRelErr !== null && !(areaRelErr <= 1e-6))) {
    return {
      ok: false, detail: `strip-fail(${audit.issues.join(';')}${areaRelErr !== null && areaRelErr > 1e-6 ? ';area-mismatch' : ''}${cornerMismatch ? ';corner-z-mismatch' : ''})`,
      source: S, daylight: D, mesh, audit, reportedArea: r9(reportedArea),
      areaRelErr: areaRelErr === null ? null : r9(areaRelErr),
    };
  }
  const toMP = (ps: XY[]): MergePoint[] => ps.map((p) => ({ x: p.x, y: p.y, z: 0 }));
  return {
    ok: true, detail: 'STRIP_OK', source: S, daylight: D, mesh, audit,
    sourceClosedSimple: closed ? ringIsSimple(toMP(srcNodes.slice(0, n))) : undefined,
    daylightClosedSimple: closed ? ringIsSimple(toMP(dayNodes.slice(0, n))) : undefined,
    reportedArea: r9(reportedArea), areaRelErr: areaRelErr === null ? null : r9(areaRelErr),
  };
};

// ── chains (all joints exact by construction; V shared per corner) ──

const DIST: GradingCriterion = { kind: 'distance', gradeRatio: 1, distance: 5 };
const RELEL: GradingCriterion = { kind: 'relative-elevation', gradeRatio: 1, relativeElevation: 5 };
const EFLAT: GradingCriterion = { kind: 'elevation', gradeRatio: 1, targetElevation: 5 };
const MS = 100;

const line = (x0: number, y0: number, x1: number, y1: number): LineSeg => ({ kind: 'line', x0, y0, x1, y1 });
const arc = (cx: number, cy: number, r: number, a0: number, a1: number, dir: 1 | -1): ArcSeg =>
  ({ kind: 'arc', cx, cy, r, a0, a1, dir });

// A: line→arc local-P0 overlap (LA_CW_OVERLAP shape), side left.
const chainA1: Seg[] = [line(-40, 0, 0, 0), arc(50, 0, 50, Math.PI, Math.PI / 2, -1)];
// A: arc→line local-P0 overlap (AL_CW_OVERLAP shape), side left.
const chainA2: Seg[] = [arc(0, -50, 50, Math.PI, Math.PI / 2, -1), line(0, 0, 0, 40)];
// B: line→arc→line, both corners local-P0, middle arc serves both ends.
export const chainB: Seg[] = [line(-40, 0, 0, 0), arc(50, 0, 50, Math.PI, Math.PI / 2, -1), line(50, 50, 50, 90)];
// C: mixed — corner0 local-P0, corner1 arc→arc NO_GO.
const chainC: Seg[] = [
  line(-40, 0, 0, 0), arc(50, 0, 50, Math.PI, Math.PI / 2, -1),
  arc(10, 50, 40, 0, Math.PI / 2, 1),
];
// D: reverse mixed — corner0 arc→arc NO_GO, corner1 local-P0.
const chainD: Seg[] = [
  arc(0, -50, 50, Math.PI, Math.PI / 2, -1), arc(50, 0, 50, Math.PI, Math.PI / 2, -1), line(50, 50, 50, 90),
];
// F1: closed line-only square (CCW, left = inside); F1cw mirrors it (CW, right = inside).
const chainF1: Seg[] = [line(0, 0, 40, 0), line(40, 0, 40, 40), line(40, 40, 0, 40), line(0, 40, 0, 0)];
const chainF1cw: Seg[] = [line(0, 0, 0, 40), line(0, 40, 40, 40), line(40, 40, 40, 0), line(40, 0, 0, 0)];
// F2: closed stadium (alternating line/arc, no arc→arc pair).
const chainF2: Seg[] = [
  line(0, 0, 60, 0), arc(60, 20, 20, -Math.PI / 2, Math.PI / 2, 1),
  line(60, 40, 0, 40), arc(0, 20, 20, Math.PI / 2, (3 * Math.PI) / 2, 1),
];

export type MemberRepresentation = 'EXACT_OFFSET' | 'CHORD_FALLBACK';
export type ChainRoute = 'EXACT_OFFSET' | 'CHORD_FALLBACK';

export interface ChainResult {
  id: string;
  side: GradingSide;
  family: string;
  members: number;
  closed: boolean;
  corners: CornerBuild[];
  /** Local P0 candidacy count (per-corner gate only; never implies built geometry). */
  localP0Count: number;
  /** Corners whose candidacy is ACTIVE under the whole-chain route (R0). */
  activeExactCorners: number[];
  /** Per-member daylight representation under the final route (uniform under R0). */
  memberRepresentation: MemberRepresentation[];
  /** Final route unit: the whole connected chain/group. R0 routes nothing smaller. */
  routeUnit: 'OPEN_CHAIN' | 'CLOSED_GROUP';
  /** Whole-chain decision: EXACT_OFFSET iff every required corner is a local P0
   *  candidate sharing one proven d (closed groups additionally line-only). */
  route: ChainRoute;
  stripPresent: boolean;
  /** Chord-daylight fallback reference: the production member-standalone chord
   *  path (label only — this study builds no fallback geometry). */
  fallbackRef: string;
  topology: string;
  continuity: string;
  routeReason: string;
  strip: { ok: boolean; detail: string; vertices: number; triangles: number; planArea: number; areaRelErr: number | null; components: number; edgeComponents: number; boundaryEdges: number; daylightContinuity: boolean; noInteriorOverlap: boolean; sourceClosedSimple?: boolean; daylightClosedSimple?: boolean } | null;
}

const solveChain = (
  id: string, members: Seg[], side: GradingSide, fam: { name: string; criterion: GradingCriterion },
  ms: number, closed = false,
  mix?: { criteria: GradingCriterion[]; z: number[] },
): ChainResult => {
  const joints = closed ? members.length : members.length - 1;
  const corners: CornerBuild[] = [];
  for (let j = 0; j < joints; j += 1) {
    const inIdx = closed ? j % members.length : j;
    const outIdx = closed ? (j + 1) % members.length : j + 1;
    const incoming = specAt(members[inIdx]!, 'end');
    const outgoing = specAt(members[outIdx]!, 'start');
    corners.push(solveChainCorner(j, incoming, outgoing, side, fam.criterion, 0, ms, mix ? {
      inCriterion: mix.criteria[inIdx]!,
      outCriterion: mix.criteria[outIdx]!,
      inZ: mix.z[inIdx]!,
      outZ: mix.z[outIdx]!,
    } : undefined));
  }
  const allAdmit = corners.every((c) => c.admit);
  // single-d is a plan-level comparison over local-P0 corners (tie failures
  // keep their plan d, so a same-d/diff-Z chain still reads single-d true
  // and falls back for the honest XYZ reason, not a spurious D_MISMATCH).
  const localDs = corners.filter((c) => c.localP0).map((c) => c.d);
  const singleD = localDs.length > 0 && localDs.every((d) => d === localDs[0]);
  const d0 = allAdmit && singleD ? corners[0]?.d ?? null : null;
  // R0 whole-chain gate (narrowest-honest): exact geometry exists ONLY when
  // every required corner is a LOCAL_P0_CANDIDATE AND production-XYZ-tied
  // (Z_TIE_OK path) sharing one proven d, and (closed scope) the group is
  // line-only — LINE_ONLY_EXACT_CONTROL. A closed group containing any arc routes CHORD_FALLBACK (CURVED_CLOSED_SUPPORT):
  // curved-closed exactness is not proven by this study. R1 (fixed-point
  // partial-exact runs) and R2 (contiguous exact runs with proven boundary
  // transitions) are NOT adopted: both need an invented exact↔chord splice
  // no existing authority provides. Candidates on a fallen-back chain stay
  // INACTIVE_DUE_TO_GROUP_FALLBACK — local candidacy activates nothing alone.
  const closedHasArc = closed && members.some((m) => m.kind === 'arc');
  const localP0Count = corners.filter((c) => c.localP0).length;
  const xyzFailed = corners.filter((c) => c.localP0 && !c.tieOk);
  let route: ChainRoute = 'CHORD_FALLBACK';
  let routeReason = '';
  if (!allAdmit) {
    routeReason = corners.some((c) => c.reason === 'REJECT_SOURCE_JOINT_STEP')
      ? 'CHAIN_FALLBACK_SOURCE_JOINT_STEP'
      : corners.every((c) => c.localP0) && singleD && xyzFailed.length > 0
        ? 'CHAIN_FALLBACK_XYZ_TIE_MISMATCH'
        : singleD || localP0Count === 0 ? 'CHAIN_FALLBACK_MIXED_CANDIDACY' : 'CHAIN_FALLBACK_MIXED_CANDIDACY_D_MISMATCH';
  } else if (!singleD) {
    routeReason = 'CHAIN_FALLBACK_D_MISMATCH';
  } else if (closedHasArc) {
    routeReason = 'CHAIN_FALLBACK_CLOSED_ARC_SUPPORT_ONLY';
  } else if (d0 === null) {
    routeReason = 'CHAIN_FALLBACK_NO_PROVEN_D';
  } else {
    route = 'EXACT_OFFSET';
    routeReason = closed ? 'CHAIN_EXACT_WHOLE_GROUP' : 'CHAIN_EXACT_WHOLE_CHAIN';
  }
  let activeExactCorners = route === 'EXACT_OFFSET' ? corners.map((c) => c.index) : [];
  for (const c of corners) c.activeExact = route === 'EXACT_OFFSET' && c.admit;
  let memberRepresentation: MemberRepresentation[] = members.map(() =>
    route === 'EXACT_OFFSET' ? 'EXACT_OFFSET' : 'CHORD_FALLBACK');
  const routeUnit = closed ? 'CLOSED_GROUP' : 'OPEN_CHAIN';
  const stripPresent = route === 'EXACT_OFFSET' && d0 !== null;
  let strip: ChainResult['strip'] = null;
  if (stripPresent && d0 !== null) {
    const joins = corners.map((c) => ({ x: c.jx!, y: c.jy!, z: c.joinZ ?? NaN }));
    const st = buildExactStrip(members, side, d0, joins, {
      memberCriteria: mix ? mix.criteria : members.map(() => fam.criterion),
      memberZ: mix ? mix.z : members.map(() => 0),
      ms,
    }, 25, closed);
    strip = {
      ok: st.ok, detail: st.detail,
      vertices: st.mesh.points.length / 3, triangles: st.mesh.triangles.length / 3,
      planArea: r9(st.audit.meshArea), areaRelErr: st.areaRelErr,
      components: st.audit.components, edgeComponents: st.audit.edgeComponents,
      boundaryEdges: st.audit.boundaryEdges,
      daylightContinuity: st.audit.checks.daylight === true,
      noInteriorOverlap: st.audit.checks.noInteriorOverlap === true,
      ...(closed ? { sourceClosedSimple: st.sourceClosedSimple, daylightClosedSimple: st.daylightClosedSimple } : {}),
    };
    // Defense-in-depth revocation: a failed construction revokes the route —
    // EXACT_OFFSET is only ever reported for actually-built + audited strips.
    if (!st.ok) {
      route = 'CHORD_FALLBACK';
      routeReason = `ROUTE_REVOKED_STRIP_FAIL(${st.detail})`;
      activeExactCorners = [];
      for (const c of corners) c.activeExact = false;
      memberRepresentation = members.map(() => 'CHORD_FALLBACK');
    }
  }
  const topology = strip
    ? `components=${strip.components} edgeComponents=${strip.edgeComponents} boundaryEdges=${strip.boundaryEdges}`
    : 'TOPOLOGY_UNBUILT_FALLBACK_LABEL_ONLY';
  const continuity = strip
    ? `daylightContinuity=${strip.daylightContinuity} noInteriorOverlap=${strip.noInteriorOverlap}`
    : 'CONTINUITY_UNPROVEN_NO_FALLBACK_GEOMETRY_BUILT';
  return {
    id, side, family: fam.name, members: members.length, closed, corners,
    localP0Count, activeExactCorners, memberRepresentation, routeUnit, route,
    stripPresent, fallbackRef: 'PRODUCTION_MEMBER_STANDALONE_CHORD_PATH_LABEL_ONLY',
    topology, continuity, routeReason, strip,
  };
};


const FAMS = [
  { name: 'DISTANCE', criterion: DIST },
  { name: 'REL_EL', criterion: RELEL },
  { name: 'ELEV_FLAT', criterion: EFLAT },
];

const main = (): void => {
  const chains: ChainResult[] = [];
  for (const fam of FAMS) {
    chains.push(solveChain(`A1-line-arc-${fam.name}`, chainA1, 'left', fam, MS));
    chains.push(solveChain(`A2-arc-line-${fam.name}`, chainA2, 'left', fam, MS));
    chains.push(solveChain(`B-3member-${fam.name}`, chainB, 'left', fam, MS));
  }
  for (const fam of FAMS.slice(0, 1)) {
    chains.push(solveChain(`C-mixed-${fam.name}`, chainC, 'left', fam, MS));
    chains.push(solveChain(`D-reverse-mixed-${fam.name}`, chainD, 'left', fam, MS));
    chains.push(solveChain('F1-square-left', chainF1, 'left', fam, MS, true));
    chains.push(solveChain('F1-square-right-cw', chainF1cw, 'right', fam, MS, true));
    chains.push(solveChain('F2-stadium-left', chainF2, 'left', fam, MS, true));
    chains.push(solveChain('F2-stadium-right', chainF2, 'right', fam, MS, true));
  }
  // G: mixed same-d/diff-Z mirror of XYZ fixture F (Distance g=1,D=5 vs
  // RelEl g=2,Delta=10): plan admits both corners at d=5, the XYZ gate ties
  // both INACTIVE (GRADING_ANALYTIC_CORNER_Z: daylight 5 vs 10).
  const distFam = FAMS[0]!;
  chains.push(solveChain('G-mixed-sameD-diffZ', chainB, 'left',
    { name: 'MIXED_SAME_D_DIFF_Z', criterion: distFam.criterion }, MS, false,
    {
      criteria: [
        distFam.criterion,
        { kind: 'relative-elevation', gradeRatio: 2, relativeElevation: 10 },
        distFam.criterion,
      ],
      z: [0, 0, 0],
    }));
  // H: mixed same-d/same-Z mirror of XYZ fixture E (Distance g=1,D=5 vs
  // RelEl g=1,Delta=5): plan admits AND the XYZ gate ties Z_TIE_OK (daylight
  // 5 vs 5) — admission through the wired gate.
  chains.push(solveChain('H-mixed-sameD-sameZ', chainB, 'left',
    { name: 'MIXED_SAME_D_SAME_Z', criterion: distFam.criterion }, MS, false,
    {
      criteria: [
        distFam.criterion,
        { kind: 'relative-elevation', gradeRatio: 1, relativeElevation: 5 },
        distFam.criterion,
      ],
      z: [0, 0, 0],
    }));
  // I: source-joint step mirror of XYZ fixture I (flat DIST members, joint
  // 0 stepped 0-vs-2): plan admits both corners at d=5 (local=2), the joint
  // gate rejects corner 0 REJECT_SOURCE_JOINT_STEP (true limits 5 vs 7) →
  // whole-chain CHORD_FALLBACK, corner 1 tied-but-inactive.
  chains.push(solveChain('I-source-step-0-vs-2', chainB, 'left',
    { name: 'STEP_0_VS_2', criterion: distFam.criterion }, MS, false,
    { criteria: [distFam.criterion, distFam.criterion, distFam.criterion], z: [0, 2, 2] }));
  // E: same-corner different-criteria continuity (B corner0 members).
  const eIn = specAt(chainB[0]!, 'end');
  const eOut = specAt(chainB[1]!, 'start');
  const eSame = [DIST, RELEL, EFLAT].map((c) =>
    solveChainCorner(0, eIn, eOut, 'left', c, 0, MS));
  const eDiffD = solveChainCorner(0, eIn, eOut, 'left', { kind: 'distance', gradeRatio: 1, distance: 7 }, 0, MS);
  const eRows = {
    sameD_sameJoin: eSame.every((c) => c.admit && c.jx === eSame[0]!.jx && c.jy === eSame[0]!.jy && c.d === 5),
    diffD_rejectsOrMoves: eDiffD.admit
      ? (eDiffD.jx !== eSame[0]!.jx || eDiffD.jy !== eSame[0]!.jy)
      : eDiffD.reason,
  };
  // E: flat-Z same vs different member elevations (elevation family only).
  const elevAt = (z0: number, z1: number): string => {
    const eff = resolveCornerEffective(
      EFLAT,
      [
        { member: eIn, startZ: z0, endZ: z0 },
        { member: eOut, startZ: z1, endZ: z1 },
      ],
      'left', MS,
    );
    return eff.proven ? `PROVEN d=${eff.d}` : `NOT_PROVEN ${eff.reason}`;
  };
  const eFlat = { sameFlat: elevAt(0, 0), diffFlat: elevAt(0, 2) };
  const payload = {
    generator: 'scripts/phase20l1GroupBuild.ts',
    baseline: 'PR #147 research/phase20l1-offset-radius-policy-resolution @ fca43c5d',
    routingPolicy: 'R0_WHOLE_CHAIN_ALL_OR_FALLBACK',
    routingAlternatives: 'R1_FIXED_POINT_PARTIAL_EXACT rejected: needs an invented exact↔chord splice no authority provides (no fixed-point run, no mixed strip, metadata alone insufficient). R2_CONTIGUOUS_RUNS rejected: run-boundary transitions unproven with existing authorities. R0 adopted as narrowest-honest: whole connected chain/group all-or-fallback; PARTIAL_GO stays valid narrower.',
    granularityGate: 'R0_WHOLE_CHAIN_ALL_OR_FALLBACK: local P0 candidacy per corner (existing predicate: UNIQUE + in-span + branch-consistent + E1 extent + candidacy audit) AND a production XYZ tie per corner (xyzRunTieOk: same required plan d + production analytic acceptance + tie in the same search neighborhood as the built join (structural locality, NOT numerical agreement) + single-valued daylight-Z laws AT THE JOIN within production zeroDelta (the tie-at-join law) + FLAT-ONLY predicate in gate code: each member startZ===endZ exactly, sloped rejects REJECT_SLOPED_SOURCE from 1e-13 to gross; the analytic tie is structural compatibility + provenance, never the certified point) + final route decision at the whole-chain/group unit. EXACT_OFFSET iff every required corner is LOCAL_P0_CANDIDATE and XYZ-tied (Z_TIE_OK path) sharing one proven d (closed groups additionally line-only: LINE_ONLY_EXACT_CONTROL; closed+arc routes CHORD_FALLBACK as CURVED_CLOSED_SUPPORT). A plan-admitted corner failing the tie is INACTIVE with the tie reason (REJECT_XYZ_TIE_MISMATCH same-d/diff-Z flat, REJECT_SLOPED_SOURCE any slope, or the analytic-corner reject) and forces whole-chain CHORD_FALLBACK (CHAIN_FALLBACK_XYZ_TIE_MISMATCH); every member then takes the production member-standalone chord path (label only), no exact strip. A failed strip construction revokes the route (defense in depth): strip ok:false forces whole-chain CHORD_FALLBACK with activeExactCorners=[] and ROUTE_REVOKED_STRIP_FAIL cause — EXACT_OFFSET is only reported for actually-built + audited strips. Candidates on a fallen-back chain stay INACTIVE_DUE_TO_GROUP_FALLBACK — local candidacy activates nothing alone. Corner assembly stays the per-joint gate (admit+reason+tie persisted per corner, revision-keyed); member resolve stays the per-member gate.',
    extentRule: 'consumed as-is from the boundary worker extent gate (E1): d<=maxSearchDistance exact + extentJVWithin(|J-V|, ms) shared helper; never re-derived here',
    noTransitionGeometry: true,
    chains,
    criterionContinuity: { ...eRows, flatZ: eFlat },
  };
  const out = join(dirname(new URL(import.meta.url).pathname), '..', 'docs', 'evidence', 'phase20l1', 'group-corpus.json');
  mkdirSync(dirname(out), { recursive: true });
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  writeFileSync(out, body);
  const again = `${JSON.stringify(JSON.parse(body), null, 2)}\n`;
  console.log(`chains=${chains.length} exactStrips=${chains.filter((c) => c.strip?.ok).length} digest=${sha16(payload)} regenIdentical=${again === body}`);
  for (const c of chains) {
    console.log(`${c.id} side=${c.side} corners=[${c.corners.map((k) => k.reason).join(',')}] local=${c.localP0Count} active=[${c.activeExactCorners.join(',')}] route=${c.routeUnit}:${c.route} strip=${c.strip ? `${c.strip.ok ? 'OK' : 'FAIL'}(${c.strip.detail})` : 'none'}`);
  }
};

main();
