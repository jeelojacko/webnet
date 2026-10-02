/**
 * Phase 20L.1 Task 7 — POLICY CORPUS generator (STUDY, evidence only).
 *
 * Deterministic cross product: 31 join fixtures x criterion families, plus a
 * maxSearch ladder and transform checks on the admitted subset. Emits
 * docs/evidence/phase20l1/policy-corpus.json (sorted keys, stable float
 * formatting). No new constant: the only bound reused is maxSearchDistance.
 * Zero `src/` changes; nothing here is wired anywhere.
 *
 * Task-7 reviewer fixes (vs Task-5 generator):
 * - `d` is resolved through the study-only executable predicate
 *   (`phase20l1EffectiveCriterion.ts`, itself a thin wrapper over the
 *   production `resolveAnalyticCriterionAt`), never a fixed label.
 * - Corner-candidacy audit is computed independently of the admission
 *   fields (own on-curve / on-body / branch-sign / turn / Roff checks);
 *   mesh-level topology is recorded N/A with reason (corner classifier:
 *   no facets, no area, no boundary cycles).
 * - Scale transforms co-scale the effective criterion-derived `d` with the
 *   geometry; invariance compares classification AND normalized join
 *   geometry (not admit booleans alone).
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { classifyCorner } from '../src/engine/cad/grading/gradingCornerMath';
import { seamParameterAgreementTol } from '../src/engine/cad/grading/gradingGroupSectors';
import type { GradingCriterion, GradingSide } from '../src/engine/cad/grading/gradingTypes';
import { scaleGradingCriterion } from '../src/engine/cad/cadProjectTransformGrading';
import { classifyOffsetJoin, memberTangent, offsetCurveOf } from './phase20lOffsetJoinCore';
import {
  extentJVWithin,
  gateRadiusOffset,
  joinWorldScale,
  radialSignOf,
  resolveCornerEffective,
} from './phase20l1EffectiveCriterion';
import {
  JOIN_FIXTURES,
  transformInput,
  type JoinFixture,
} from './phase20lOffsetRadiusVariants';

/** Study criterion + source-elevation assignment per family (plan fixtures carry no Z). */
interface FamilyDef {
  family: 'DISTANCE' | 'REL_EL' | 'ELEV_FLAT' | 'ELEV_SLOPED' | 'SURF_FIXED' | 'SURF_CUTFILL';
  proof: string;
  criterion: GradingCriterion;
  zStart: number;
  zEnd: number;
}

const FAMILIES: FamilyDef[] = [
  {
    family: 'DISTANCE', proof: 'A: distance D=5 via resolveAnalyticCriterionAt',
    criterion: { kind: 'distance', gradeRatio: 1, distance: 5 }, zStart: 0, zEnd: 0,
  },
  {
    family: 'REL_EL', proof: 'A: relative-elevation Δ=5/g=1 via resolveAnalyticCriterionAt',
    criterion: { kind: 'relative-elevation', gradeRatio: 1, relativeElevation: 5 }, zStart: 0, zEnd: 0,
  },
  {
    family: 'ELEV_FLAT', proof: 'B: elevation E=5 flat z0=0 via resolveAnalyticCriterionAt, startZ===endZ exact',
    criterion: { kind: 'elevation', gradeRatio: 1, targetElevation: 5 }, zStart: 0, zEnd: 0,
  },
  {
    family: 'ELEV_SLOPED', proof: 'C: elevation sloped 0→10, d(s) linear, rejected',
    criterion: { kind: 'elevation', gradeRatio: 1, targetElevation: 5 }, zStart: 0, zEnd: 10,
  },
  {
    family: 'SURF_FIXED', proof: 'D: fixed TIN root, target-dependent, rejected',
    criterion: { kind: 'fixed', gradeRatio: 1 }, zStart: 0, zEnd: 0,
  },
  {
    family: 'SURF_CUTFILL', proof: 'D: cut-fill branch-switching TIN root, rejected',
    criterion: { kind: 'cut-fill', cutGradeRatio: 1, fillGradeRatio: 1 }, zStart: 0, zEnd: 0,
  },
];

const LADDER = [4, 5, 7, 100];
const ARC_PAIR = (f: JoinFixture): boolean =>
  f.input.incoming.kind === 'arc' && f.input.outgoing.kind === 'arc';

const wrapAngle = (a: number): number => {
  let x = a;
  while (x > Math.PI) x -= 2 * Math.PI;
  while (x <= -Math.PI) x += 2 * Math.PI;
  return x;
};

/** Display-only Roff label (exact sign; the admission gate lives in the predicate). */
export const roffClassDisplay = (f: JoinFixture, d: number): string => {
  for (const m of [f.input.incoming, f.input.outgoing]) {
    if (m.kind !== 'arc') continue;
    if (!(m.radius > 0) || !Number.isFinite(m.radius)) return 'RADIUS_NONFINITE';
    const inward =
      (f.input.side === 'left' && m.kind === 'arc' && m.dir === 1) ||
      (f.input.side === 'right' && m.kind === 'arc' && m.dir === -1);
    const roff = inward ? m.radius - d : m.radius + d;
    if (roff === 0) return 'COLLAPSE';
    if (roff < 0 || !Number.isFinite(roff)) return 'INVERTED';
  }
  return 'OK_OR_NA';
};

export interface CandidacyAudit {
  pass: boolean;
  detail: string;
  joinX: number | null;
  joinY: number | null;
  distV: number | null;
  turn: string | null;
}

/**
 * Independent corner-candidacy audit. Recomputes everything from the fixture
 * input + `d` with its own arithmetic (own u-params, own on-curve residual,
 * own branch-sign rule, production classifyCorner for turn, predicate
 * radial-sign path for Roff) — it never reads the admission booleans.
 * Mesh-level topology is out of scope for a corner classifier (no facets,
 * no area, no boundary cycles) and recorded N/A at the row level.
 */
export const auditCornerCandidacy = (
  f: JoinFixture,
  d: number,
  maxSearch: number,
): CandidacyAudit => {
  const nope = (detail: string): CandidacyAudit =>
    ({ pass: false, detail, joinX: null, joinY: null, distV: null, turn: null });
  const tIn = memberTangent(f.input.incoming);
  const tOut = memberTangent(f.input.outgoing);
  if (!tIn || !tOut) return nope('AUDIT_DEGENERATE_TANGENT');
  const turn = classifyCorner(tIn, tOut, f.input.side);
  if (turn === null || turn === 'TANGENT') return nope('AUDIT_NO_TURN');
  const ocIn = offsetCurveOf(f.input.incoming, f.input.side, d);
  const ocOut = offsetCurveOf(f.input.outgoing, f.input.side, d);
  if (!ocIn || !ocOut) return nope('AUDIT_DEGENERATE_OFFSET_CURVE');
  // Exact Roff gate via the predicate's radial-sign path (not the display lookup).
  for (const m of [f.input.incoming, f.input.outgoing]) {
    if (m.kind !== 'arc') continue;
    const sign = radialSignOf(m, f.input.side);
    if (sign === null) return nope('AUDIT_RSIGN');
    if (!gateRadiusOffset(m.radius, sign, d).ok) return nope('AUDIT_ROFF');
  }
  const r = classifyOffsetJoin({ ...f.input, offset: d, maxSearchDistance: maxSearch });
  const worldScale = joinWorldScale(f.input.incoming.vx, f.input.incoming.vy);
  const ownU = (m: JoinFixture['input']['incoming'], x: number, y: number): number => {
    if (m.kind === 'line') {
      const len = Math.hypot(m.tx, m.ty);
      return ((x - m.vx) * m.tx + (y - m.vy) * m.ty) / len;
    }
    const r0 = Math.hypot(x - m.cx, y - m.cy);
    const a = Math.atan2(y - m.cy, x - m.cx);
    const v = Math.atan2(m.vy - m.cy, m.vx - m.cx);
    return r0 * wrapAngle(a - v) * m.dir;
  };
  const passers: { x: number; y: number; distV: number }[] = [];
  for (const c of r.candidates) {
    // On-curve residual against freshly built offset curves (not classifier flags).
    const res = (oc: NonNullable<typeof ocIn>, x: number, y: number): number =>
      oc.kind === 'line'
        ? Math.abs((x - oc.ox) * oc.ty - (y - oc.oy) * oc.tx) / Math.hypot(oc.tx, oc.ty)
        : Math.abs(Math.hypot(x - oc.cx, y - oc.cy) - Math.abs(oc.radius));
    const scale = Math.max(1, Math.abs(c.x), Math.abs(c.y), Math.abs(d));
    const tol = seamParameterAgreementTol(0, res(ocIn, c.x, c.y), scale, worldScale);
    const tol2 = seamParameterAgreementTol(0, res(ocOut, c.x, c.y), scale, worldScale);
    if (!(res(ocIn, c.x, c.y) <= tol && res(ocOut, c.x, c.y) <= tol2)) continue;
    const uIn = ownU(f.input.incoming, c.x, c.y);
    const uOut = ownU(f.input.outgoing, c.x, c.y);
    if (!Number.isFinite(uIn) || !Number.isFinite(uOut)) continue;
    const spanOk = (m: JoinFixture['input']['incoming'], u: number): boolean => {
      const span = Math.max(Math.abs(m.spanStart), Math.abs(m.spanEnd));
      const loT = seamParameterAgreementTol(Math.min(m.spanStart, m.spanEnd), u, span, worldScale);
      const hiT = seamParameterAgreementTol(Math.max(m.spanStart, m.spanEnd), u, span, worldScale);
      return u >= Math.min(m.spanStart, m.spanEnd) - loT && u <= Math.max(m.spanStart, m.spanEnd) + hiT;
    };
    if (!spanOk(f.input.incoming, uIn) || !spanOk(f.input.outgoing, uOut)) continue;
    const bt = seamParameterAgreementTol(uIn, uOut, Math.max(Math.abs(uIn), Math.abs(uOut)), worldScale);
    const branchOk = turn === 'GAP' ? uIn >= -bt && uOut <= bt : uIn <= bt && uOut >= -bt;
    if (!branchOk) continue;
    const distV = Math.hypot(c.x - f.input.incoming.vx, c.y - f.input.incoming.vy);
    if (!(d <= maxSearch && extentJVWithin(distV, maxSearch, worldScale))) continue;
    passers.push({ x: c.x, y: c.y, distV });
  }
  if (passers.length !== 1) return nope(passers.length === 0 ? 'AUDIT_NO_PASSER' : 'AUDIT_MULTI_PASSER');
  const j = passers[0]!;
  return { pass: true, detail: 'CANDIDACY_OK', joinX: j.x, joinY: j.y, distV: j.distV, turn };
};

/** P0 verdict for one (fixture, family, maxSearch) cell. No new constant. */
const decide = (f: JoinFixture, fam: FamilyDef, maxSearch: number) => {
  const eff = resolveCornerEffective(
    fam.criterion,
    [
      { member: f.input.incoming, startZ: fam.zStart, endZ: fam.zEnd },
      { member: f.input.outgoing, startZ: fam.zStart, endZ: fam.zEnd },
    ],
    f.input.side,
    maxSearch,
  );
  if (!eff.proven) {
    const reason =
      eff.reason === 'ELEVATION_SLOPED_SOURCE' ? 'REJECT_CIRCULARITY_SLOPED'
      : eff.reason === 'ELEVATION_MEMBER_MISMATCH' ? 'REJECT_CIRCULARITY_MISMATCH'
      : eff.reason === 'SURFACE_TARGET' ? 'REJECT_CIRCULARITY_SURFACE'
      : eff.reason === 'RADIUS' ? 'REJECT_ROFF'
      : eff.reason === 'INVALID_CRITERION' ? 'REJECT_INVALID_CRITERION'
      : 'REJECT_DEGENERATE_SOURCE';
    return { admit: false, reason, d: null as number | null, distV: null as number | null, join: null as { x: number; y: number } | null, joinClass: 'NOT_EVALUATED', adm: 0, onBody: false, dPass: false, jvPass: false, roff: 'EXCLUDED', audit: null as CandidacyAudit | null };
  }
  const d = eff.d;
  if (ARC_PAIR(f)) {
    return { admit: false, reason: 'REJECT_ARC_PAIR_NO_GO', d, distV: null as number | null, join: null as { x: number; y: number } | null, joinClass: 'NOT_EVALUATED', adm: 0, onBody: false, dPass: d <= maxSearch, jvPass: false, roff: 'EXCLUDED', audit: null as CandidacyAudit | null };
  }
  const r = classifyOffsetJoin({ ...f.input, offset: d, maxSearchDistance: maxSearch });
  const adm = r.candidates.filter((c) => c.inSpan && c.branchConsistent);
  const sel = adm.length === 1 ? adm[0]! : null;
  const distV = sel ? sel.distV : null; // classifier-local V-frame distance (never world hypot)
  const worldScale = joinWorldScale(f.input.incoming.vx, f.input.incoming.vy);
  const dPass = d <= maxSearch;
  const jvPass = distV !== null && extentJVWithin(distV, maxSearch, worldScale);
  const roff = roffClassDisplay(f, d);
  const audit = auditCornerCandidacy(f, d, maxSearch);
  if (r.classification !== 'OFFSET_JOIN_UNIQUE' || adm.length !== 1 || !sel) {
    return { admit: false, reason: r.classification === 'OFFSET_JOIN_AMBIGUOUS' ? 'REJECT_AMBIGUITY_B0' : 'REJECT_NON_UNIQUE', d, distV, join: null as { x: number; y: number } | null, joinClass: r.classification, adm: adm.length, onBody: false, dPass, jvPass, roff, audit };
  }
  if (roff !== 'OK_OR_NA') return { admit: false, reason: 'REJECT_ROFF', d, distV, join: null, joinClass: r.classification, adm: 1, onBody: true, dPass, jvPass, roff, audit };
  if (!dPass) return { admit: false, reason: 'REJECT_EXTENT_D', d, distV, join: null, joinClass: r.classification, adm: 1, onBody: true, dPass, jvPass, roff, audit };
  if (!jvPass) return { admit: false, reason: 'REJECT_EXTENT_JV', d, distV, joinClass: r.classification, adm: 1, onBody: true, dPass, jvPass, roff, audit, join: null as { x: number; y: number } | null };
  if (!audit.pass) return { admit: false, reason: 'REJECT_CANDIDACY_AUDIT', d, distV, join: null as { x: number; y: number } | null, joinClass: r.classification, adm: 1, onBody: true, dPass, jvPass, roff, audit };
  return { admit: true, reason: 'ADMIT_P0', d, distV, join: { x: sel.x, y: sel.y }, joinClass: r.classification, adm: 1, onBody: true, dPass, jvPass, roff, audit };
};

const digestOf = (v: unknown): string =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16);

export interface PolicyRow {
  fixtureId: string; family: FamilyDef['family']; maxSearchDistance: number;
  circularityProof: string; effectiveReason: string; d: number | null; roffClass: string;
  joinClass: string; branchCount: number; onBody: boolean;
  distV: number | null; extentDPass: boolean; extentJVPass: boolean;
  ambiguityPolicy: string; extensionPolicy: string;
  cornerCandidacyPass: boolean; candidacyDetail: string;
  meshTopology: string;
  admit: boolean; reasonCode: string; digest: string;
}

const MESH_NA = 'NOT_APPLICABLE_CORNER_CLASSIFIER_NO_MESH';

const main = (): void => {
  const rows: PolicyRow[] = [];
  for (const f of [...JOIN_FIXTURES].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    for (const fam of FAMILIES) {
      const nativeMax = f.input.maxSearchDistance;
      for (const ms of [nativeMax]) {
        const r = decide(f, fam, ms);
        const effReason = r.d !== null && r.admit
          ? (fam.family === 'DISTANCE' ? 'DISTANCE' : fam.family === 'REL_EL' ? 'RELATIVE_ELEVATION' : 'ELEVATION_FLAT_SOURCE')
          : (fam.family === 'ELEV_SLOPED' ? 'ELEVATION_SLOPED_SOURCE' : fam.family === 'SURF_FIXED' || fam.family === 'SURF_CUTFILL' ? 'SURFACE_TARGET' : r.admit ? 'PROVEN' : 'NOT_PROVEN');
        const row = {
          fixtureId: f.id, family: fam.family, maxSearchDistance: ms,
          circularityProof: fam.proof, effectiveReason: effReason, d: r.d, roffClass: r.roff,
          joinClass: r.joinClass, branchCount: r.adm, onBody: r.onBody,
          distV: r.distV !== null && Number.isFinite(r.distV) ? Number(r.distV.toFixed(9)) : r.distV,
          extentDPass: r.dPass, extentJVPass: r.jvPass,
          ambiguityPolicy: r.adm >= 2 ? 'B0_FAIL_CLOSED' : r.joinClass === 'OFFSET_JOIN_AMBIGUOUS' ? 'B0_FAIL_CLOSED' : 'B0_UNIQUE_OK',
          extensionPolicy: r.joinClass === 'OFFSET_JOIN_NONLOCAL' ? 'C0_NO_EXTENSION' : 'C0_ON_BODY',
          cornerCandidacyPass: r.audit !== null && r.admit && r.audit.pass,
          candidacyDetail: r.audit ? r.audit.detail : 'AUDIT_NOT_RUN',
          meshTopology: MESH_NA,
          admit: r.admit, reasonCode: r.reason,
        };
        rows.push({ ...row, digest: digestOf(row) });
      }
    }
  }
  // MaxSearch ladder on the P0-admitted fixtures only (gate-behavior pins).
  const ladder: Record<string, Record<number, string>> = {};
  for (const f of JOIN_FIXTURES) {
    const base = decide(f, FAMILIES[0]!, f.input.maxSearchDistance);
    if (!base.admit && base.reason !== 'REJECT_EXTENT_JV' && base.reason !== 'REJECT_EXTENT_D') continue;
    if (ARC_PAIR(f)) continue;
    const r0 = classifyOffsetJoin({ ...f.input, offset: 5, maxSearchDistance: f.input.maxSearchDistance });
    if (r0.classification !== 'OFFSET_JOIN_UNIQUE') continue;
    ladder[f.id] = {};
    for (const ms of LADDER) ladder[f.id]![ms] = decide(f, FAMILIES[0]!, ms).reason;
  }
  // Transform invariance on admitted P0 rows: classification AND normalized
  // join geometry. Scale transforms co-scale the effective criterion (via
  // the production scaleGradingCriterion) and maxSearch with the geometry.
  const admitted = rows.filter((r) => r.admit).map((r) => r.fixtureId);
  const uniqAdmitted = [...new Set(admitted)];
  const mirror = (inp: JoinFixture['input']): JoinFixture['input'] => {
    const m = (mem: JoinFixture['input']['incoming']): typeof mem =>
      mem.kind === 'line'
        ? { ...mem, vy: -mem.vy, ty: -mem.ty }
        : { ...mem, vy: -mem.vy, cy: -mem.cy, dir: (mem.dir === 1 ? -1 : 1) as 1 | -1 };
    return { ...inp, incoming: m(inp.incoming), outgoing: m(inp.outgoing), side: (inp.side === 'left' ? 'right' : 'left') as JoinFixture['input']['side'] };
  };
  const flipSide = (s: GradingSide): GradingSide => (s === 'left' ? 'right' : 'left');
  const flipMember = (mem: JoinFixture['input']['incoming']): typeof mem =>
    mem.kind === 'line'
      ? { ...mem, tx: -mem.tx, ty: -mem.ty, spanStart: -mem.spanEnd, spanEnd: -mem.spanStart }
      : { ...mem, dir: (mem.dir === 1 ? -1 : 1) as 1 | -1, spanStart: -mem.spanEnd, spanEnd: -mem.spanStart };
  const scaleMembers = (inp: JoinFixture['input'], k: number): JoinFixture['input'] => {
    const s = (mem: JoinFixture['input']['incoming']): typeof mem =>
      mem.kind === 'line'
        ? { ...mem, vx: mem.vx * k, vy: mem.vy * k, spanStart: mem.spanStart * k, spanEnd: mem.spanEnd * k }
        : { ...mem, vx: mem.vx * k, vy: mem.vy * k, cx: mem.cx * k, cy: mem.cy * k, radius: mem.radius * k, spanStart: mem.spanStart * k, spanEnd: mem.spanEnd * k };
    return { ...inp, incoming: s(inp.incoming), outgoing: s(inp.outgoing) };
  };
  interface InvCell { class: string; agree: boolean; joinErr: number | null }
  const invariance: Record<string, Record<string, InvCell>> = {};
  const fam0 = FAMILIES[0]!;
  for (const id of uniqAdmitted) {
    const f = JOIN_FIXTURES.find((x) => x.id === id)!;
    const ms = f.input.maxSearchDistance;
    const base = decide(f, fam0, ms);
    const baseJoin = base.join!;
    const baseClass = base.joinClass;
    const check = (
      input: JoinFixture['input'], criterion: GradingCriterion, msT: number,
      normalize: (_x: number, _y: number) => [number, number],
    ): InvCell => {
      const t = decide({ ...f, input }, { ...fam0, criterion }, msT);
      if (!t.admit || !t.join) return { class: t.joinClass, agree: false, joinErr: null };
      const [nx, ny] = normalize(t.join.x, t.join.y);
      const err = Math.hypot(nx - baseJoin.x, ny - baseJoin.y);
      return {
        class: t.joinClass,
        agree: t.joinClass === baseClass && err <= 1e-6,
        joinErr: Number(err.toFixed(9)),
      };
    };
    const ident = (x: number, y: number): [number, number] => [x, y];
    const cells: Record<string, InvCell> = {};
    // Origin shifts (same d, same ms).
    for (const [name, dx, dy] of [['origin_1e6', 1e6, -2e6], ['origin_1e8', 1e8, 1e8]] as const) {
      cells[name] = check(transformInput(f.input, 0, dx, dy), fam0.criterion, ms, (x, y) => [x - dx, y - dy]);
    }
    // Rotation about V then translate.
    {
      const a = 0.9; const dx = 123.4; const dy = -56.7;
      const cos = Math.cos(a); const sin = Math.sin(a);
      cells['rotation_0_9'] = check(transformInput(f.input, a, dx, dy), fam0.criterion, ms, (x, y) => {
        const px = x - dx; const py = y - dy;
        return [cos * px + sin * py, -sin * px + cos * py];
      });
    }
    // Uniform scales up + down: co-scale criterion (production
    // scaleGradingCriterion: distance D scales, grade invariant) and ms.
    for (const [name, k] of [['scale_up_1e3', 1000], ['scale_down_1e3', 0.001]] as const) {
      const crit = scaleGradingCriterion(fam0.criterion, k);
      const inp = { ...scaleMembers(f.input, k), maxSearchDistance: ms * k };
      cells[name] = check(inp, crit, ms * k, (x, y) => [x / k, y / k]);
    }
    // Mirror-Y with side flip.
    cells['mirror_y'] = check(mirror(f.input), fam0.criterion, ms, (x, y) => [x, -y]);
    // Chain order-reversal (travel flip + side flip): same physical corner.
    cells['reverse_chain'] = check(
      { ...f.input, incoming: flipMember(f.input.outgoing), outgoing: flipMember(f.input.incoming), side: flipSide(f.input.side) },
      fam0.criterion, ms, ident,
    );
    void base;
    invariance[id] = cells;
  }
  const payload = {
    generator: 'scripts/phase20l1PolicyCorpus.ts',
    baseline: 'PR #146 merge 4e25d803',
    extentRule: 'criterion d<=maxSearchDistance EXACT (production resolveAnalyticCriterionAt); |J-V| within maxSearchDistance + seam-parameter agreement band (E1, one shared helper: admission + audit identical)',
    ambiguityRule: 'B0 fail-closed (B1 rejected); extension C0 no-extension (C1 rejected)',
    candidacyRule: 'corner-classifier candidacy only (independent audit); mesh topology N/A (no facets/area/cycles)',
    counts: {
      fixtures: JOIN_FIXTURES.length,
      families: FAMILIES.length,
      rows: rows.length,
      admittedP0: rows.filter((r) => r.admit).length,
    },
    rows,
    maxSearchLadder: ladder,
    transformInvariance: invariance,
  };
  const out = join(dirname(new URL(import.meta.url).pathname), '..', 'docs', 'evidence', 'phase20l1', 'policy-corpus.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`);
  const admitIds = rows.filter((r) => r.admit).map((r) => `${r.fixtureId}/${r.family}`);
  console.log(`fixtures=${JOIN_FIXTURES.length} rows=${rows.length} admittedP0=${admitIds.length}`);
  console.log(`admitted: ${admitIds.join(' ') || '(none)'}`);
  console.log(`corpus digest: ${digestOf(rows)}`);
}

main();
