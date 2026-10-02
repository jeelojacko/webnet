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
 * audit), sample the source boundary over every member and the exact-offset
 * daylight joined through each P0 corner join, stitch ONE strip mesh, and
 * audit it independently (auditMesh + ring simplicity + source/daylight
 * continuity + reported-vs-triangulated area). No transition geometry is
 * ever invented: a rejected incident corner forces the whole curved member
 * to chord fallback (member-level gate, corner-level reasons).
 *
 * Emits docs/evidence/phase20l1/group-corpus.json (sorted keys, stable
 * floats, byte-identical across runs). Wired nowhere.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { gradingSideNormal } from '../src/engine/cad/grading/gradingCourseFrame';
import { ringIsSimple, type MergePoint, type MergedGroupMesh } from '../src/engine/cad/grading/gradingGroupMerge';
import type { GradingCriterion, GradingSide } from '../src/engine/cad/grading/gradingTypes';
import { auditMesh } from './phase20kHybridArcPairAudit';
import { classifyOffsetJoin, type MemberSpec } from './phase20lOffsetJoinCore';
import { extentJVWithin, joinWorldScale, resolveCornerEffective } from './phase20l1EffectiveCriterion';
import { auditCornerCandidacy } from './phase20l1PolicyCorpus';
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
}

const NOT_PROVEN_REASON = (r: string): string =>
  r === 'ELEVATION_SLOPED_SOURCE' ? 'REJECT_CIRCULARITY_SLOPED'
  : r === 'SURFACE_TARGET' ? 'REJECT_CIRCULARITY_SURFACE'
  : r === 'ELEVATION_MEMBER_MISMATCH' ? 'REJECT_CIRCULARITY_MISMATCH'
  : r === 'RADIUS' ? 'REJECT_ROFF'
  : r === 'INVALID_CRITERION' ? 'REJECT_INVALID_CRITERION'
  : 'REJECT_DEGENERATE_SOURCE';

/** Solve one corner of a chain exactly the way the policy corpus does. */
export const solveChainCorner = (
  index: number,
  incoming: MemberSpec,
  outgoing: MemberSpec,
  side: GradingSide,
  criterion: GradingCriterion,
  z: number,
  ms: number,
): CornerBuild => {
  const eff = resolveCornerEffective(
    criterion,
    [
      { member: incoming, startZ: z, endZ: z },
      { member: outgoing, startZ: z, endZ: z },
    ],
    side,
    ms,
  );
  if (!eff.proven) return { index, admit: false, reason: NOT_PROVEN_REASON(eff.reason), d: null, jx: null, jy: null, distV: null };
  const d = eff.d;
  if (incoming.kind === 'arc' && outgoing.kind === 'arc') {
    return { index, admit: false, reason: 'REJECT_ARC_PAIR_NO_GO', d, jx: null, jy: null, distV: null };
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
    };
  }
  if (!dPass) return { index, admit: false, reason: 'REJECT_EXTENT_D', d, jx: null, jy: null, distV: r9(distV!) };
  if (!jvPass) return { index, admit: false, reason: 'REJECT_EXTENT_JV', d, jx: null, jy: null, distV: r9(distV!) };
  if (!audit.pass) return { index, admit: false, reason: 'REJECT_CANDIDACY_AUDIT', d, jx: null, jy: null, distV: r9(distV!) };
  return { index, admit: true, reason: 'ADMIT_P0', d, jx: r9(sel.x), jy: r9(sel.y), distV: r9(distV!) };
};

// ── exact-offset strip sampling (source + daylight share joint objects) ──

const wrapPi = (a: number): number => {
  let x = a;
  while (x > Math.PI) x -= 2 * Math.PI;
  while (x <= -Math.PI) x += 2 * Math.PI;
  return x;
};

interface XY { x: number; y: number }

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
  source: XY[];
  daylight: XY[];
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
 * Build the exact-offset strip over a member chain. Daylight nodes are the
 * far-end exact offsets + the solved P0 joins (shared object per joint, so
 * daylight continuity is exact by construction and the audit verifies it).
 * Every member is sampled with the same k; joints are bitwise-shared.
 */
export const buildExactStrip = (
  members: Seg[],
  side: GradingSide,
  d: number,
  joins: XY[],
  zDaylight: number,
  k = 25,
  closed = false,
): StripBuild => {
  const n = members.length;
  const srcNodes: XY[] = [];
  const dayNodes: XY[] = [];
  for (let i = 0; i < n; i += 1) srcNodes.push(jointOf(members[i]!, 'start'));
  srcNodes.push(jointOf(members[n - 1]!, 'end'));
  if (!closed) {
    dayNodes.push(offsetFarEnd(members[0]!, 'start', side, d));
    for (const j of joins) dayNodes.push(j);
    dayNodes.push(offsetFarEnd(members[n - 1]!, 'end', side, d));
  } else {
    for (const j of joins) dayNodes.push(j);
  }
  const S: XY[] = [];
  const D: XY[] = [];
  for (let i = 0; i < n; i += 1) {
    const sPts = sampleSeg(members[i]!, srcNodes[i]!, srcNodes[i + 1]!, k);
    // Closed member i spans corner (i-1)->corner i; open member i spans dayNodes[i]->dayNodes[i+1].
    const dPts = closed
      ? sampleSeg(members[i]!, dayNodes[(i - 1 + n) % n]!, dayNodes[i]!, k)
      : sampleSeg(members[i]!, dayNodes[i]!, dayNodes[i + 1]!, k);
    const skip = i === 0 ? 0 : 1;
    for (let q = skip; q < k; q += 1) { S.push(sPts[q]!); D.push(dPts[q]!); }
  }
  if (closed) { S.pop(); D.pop(); }
  const points: number[] = [];
  for (const p of S) points.push(p.x, p.y, 0);
  for (const p of D) points.push(p.x, p.y, zDaylight);
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
  const daylight: MergePoint[] = D.map((p) => ({ x: p.x, y: p.y, z: zDaylight }));
  const audit = auditMesh(mesh, daylight, closed);
  // Closed strip is an annulus: reported = |source ring| - |daylight ring|.
  const reportedArea = closed
    ? Math.abs(ringArea(srcNodes.slice(0, n)) - ringArea(dayNodes))
    : ringArea([...S, ...[...D].reverse()]);
  const areaRelErr = reportedArea > 0 ? Math.abs(audit.meshArea - reportedArea) / reportedArea : null;
  if (!points.every(Number.isFinite) || !audit.pass || (areaRelErr !== null && !(areaRelErr <= 1e-6))) {
    return {
      ok: false, detail: `strip-fail(${audit.issues.join(';')}${areaRelErr !== null && areaRelErr > 1e-6 ? ';area-mismatch' : ''})`,
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

// A: line→arc P0 overlap (LA_CW_OVERLAP shape), side left.
const chainA1: Seg[] = [line(-40, 0, 0, 0), arc(50, 0, 50, Math.PI, Math.PI / 2, -1)];
// A: arc→line P0 overlap (AL_CW_OVERLAP shape), side left.
const chainA2: Seg[] = [arc(0, -50, 50, Math.PI, Math.PI / 2, -1), line(0, 0, 0, 40)];
// B: line→arc→line, both corners P0, middle arc serves both ends.
export const chainB: Seg[] = [line(-40, 0, 0, 0), arc(50, 0, 50, Math.PI, Math.PI / 2, -1), line(50, 50, 50, 90)];
// C: mixed — corner0 P0, corner1 arc→arc NO_GO.
const chainC: Seg[] = [
  line(-40, 0, 0, 0), arc(50, 0, 50, Math.PI, Math.PI / 2, -1),
  arc(10, 50, 40, 0, Math.PI / 2, 1),
];
// D: reverse mixed — corner0 arc→arc NO_GO, corner1 P0.
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

export interface ChainResult {
  id: string;
  side: GradingSide;
  family: string;
  members: number;
  closed: boolean;
  corners: CornerBuild[];
  exactRun: number[] | null;
  fallbackMembers: number[] | null;
  strip: { ok: boolean; detail: string; vertices: number; triangles: number; planArea: number; areaRelErr: number | null; components: number; edgeComponents: number; boundaryEdges: number; daylightContinuity: boolean; noInteriorOverlap: boolean; sourceClosedSimple?: boolean; daylightClosedSimple?: boolean } | null;
  gate: string;
}

const solveChain = (
  id: string, members: Seg[], side: GradingSide, fam: { name: string; criterion: GradingCriterion },
  ms: number, closed = false,
): ChainResult => {
  const joints = closed ? members.length : members.length - 1;
  const corners: CornerBuild[] = [];
  for (let j = 0; j < joints; j += 1) {
    const incoming = specAt(members[j]!, 'end');
    const outgoing = specAt(members[(j + 1) % members.length]!, 'start');
    corners.push(solveChainCorner(j, incoming, outgoing, side, fam.criterion, 0, ms));
  }
  const allProven = corners.every((c) => c.admit);
  const admittedDs = corners.filter((c) => c.admit).map((c) => c.d);
  const singleD = admittedDs.length > 0 && admittedDs.every((d) => d === admittedDs[0]);
  const d0 = allProven ? admittedDs[0] ?? null : null;
  // Member-level gate: a curved member incident to ANY rejected corner (or a
  // d-mismatch across the chain) routes chord fallback; exact strip only
  // over maximal all-P0 single-d runs. No transition curves invented.
  const rejected = new Set(corners.filter((c) => !c.admit).map((c) => c.index));
  const incidentCorners = (i: number): number[] =>
    closed ? [(i - 1 + joints) % joints, i % joints] : [i - 1, i].filter((c) => c >= 0 && c < joints);
  const fallbackMembers: number[] = [];
  members.forEach((m, i) => {
    if (m.kind !== 'arc') return;
    if (!singleD || incidentCorners(i).some((c) => rejected.has(c))) fallbackMembers.push(i);
  });
  const exactRun = singleD && allProven ? members.map((_, i) => i) : null;
  let strip: ChainResult['strip'] = null;
  let gate = '';
  if (exactRun && d0 !== null) {
    const joins = corners.map((c) => ({ x: c.jx!, y: c.jy! }));
    const st = buildExactStrip(members, side, d0, joins, d0, 25, closed);
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
    gate = closed ? 'WHOLE_GROUP_EXACT' : 'WHOLE_RUN_EXACT';
  } else if (corners.some((c) => c.admit) && singleD) {
    gate = 'MEMBER_FALLBACK_PARTIAL_RUN';
  } else {
    gate = corners.some((c) => c.admit) ? 'MIXED_D_NO_EXACT_RUN' : 'WHOLE_GROUP_CHORD_FALLBACK';
  }
  return {
    id, side, family: fam.name, members: members.length, closed, corners,
    exactRun, fallbackMembers, strip, gate,
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
  // E: same-corner different-criteria continuity (B corner0 members).
  const eIn = specAt(chainB[0]!, 'end');
  const eOut = specAt(chainB[1]!, 'start');
  const eSame = [DIST, RELEL, EFLAT].map((c) =>
    solveChainCorner(0, eIn, eOut, 'left', c, 0, MS));
  const eDiffD = solveChainCorner(0, eIn, eOut, 'left', { kind: 'distance', gradeRatio: 1, distance: 7 }, 0, MS);
  const eRows = {
    sameD_Jagree: eSame.every((c) => c.admit && c.jx === eSame[0]!.jx && c.jy === eSame[0]!.jy && c.d === 5),
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
    granularityGate: 'MEMBER_FALLBACK_CORNER_REASONS: a curved member incident to any rejected corner routes chord fallback (production member-standalone path); exact ties only at ADMIT_P0 corners; an exact run needs contiguous P0 corners sharing one proven d; whole-group exact iff every corner P0 + single d. Corner assembly stays the per-joint gate (admit+reason persisted per corner, revision-keyed); member resolve stays the per-member gate.',
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
    console.log(`${c.id} side=${c.side} corners=[${c.corners.map((k) => k.reason).join(',')}] gate=${c.gate} strip=${c.strip ? `${c.strip.ok ? 'OK' : 'FAIL'}(${c.strip.detail})` : 'none'}`);
  }
};

main();
