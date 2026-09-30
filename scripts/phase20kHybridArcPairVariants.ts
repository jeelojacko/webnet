/**
 * Phase 20K Worker-VARIANTS — hybrid arc-pair VARIANT study (PURE, evidence
 * only, no production route, no `src/` changes).
 *
 * Worker-CORE owns `scripts/phase20kHybridArcPairCore.ts`; this file IMPORTS
 * its arc/member/terminal-frame seam and delegates every tie acceptance to
 * `resolveArcPairCorner` (which clears the production arc×arc guard and lets
 * `solveHybridCorner` own the seam ray, nearest root, 20J.1 agreement gates,
 * half-planes, miter extent, and GAP/OVERLAP mesh build). This module only
 * supplies the variant fixtures the core's GAP-only study does not cover —
 * the OVERLAP oracle, level-source method variants, CUT/FILL, nonzero
 * longitudinal grade, traversal reversal — plus an independent projected
 * overlap audit on the real corner mesh.
 *
 * Labels are evidence-only `ARC_PAIR_*` strings, never production enums.
 */
import { zeroDelta } from '../src/engine/cad/surfaces/volume/zero';
import { classifyCorner, cutFillSideAtCorner } from '../src/engine/cad/grading/gradingCornerMath';
import { type SectorPoint } from '../src/engine/cad/grading/gradingGroupSectors';
import {
  mergeGroupTriangles,
  validateGroupMesh,
  type MergePoint,
  type MergeTriangle,
} from '../src/engine/cad/grading/gradingGroupMerge';
import { solveGradingChord } from '../src/engine/cad/grading/solveAnalyticGradingChord';
import { buildTargetQuery, candidateTriangles } from '../src/engine/cad/grading/gradingTargetIndex';
import type { HybridCornerOutcome } from '../src/engine/cad/grading/gradingGroupHybridCorners';
import type { GradingCriterion, GradingSide } from '../src/engine/cad/grading/gradingTypes';
import type { GradingTargetMeshSnapshot, TargetQuery } from '../src/engine/cad/grading/gradingComputeTypes';
import {
  arcTerminalFrame,
  makeArcMember,
  linearizeArcMember,
  resolveArcPairCorner,
  type ArcMember,
  type ArcSpec,
  type ArcTangentModel,
  type ArcTerminalFrame,
} from './phase20kHybridArcPairCore';

export type ArcPairVariantOutcome =
  | 'ARC_PAIR_EXACT_COMMON_TIE'
  | 'ARC_PAIR_FINITE_TRANSITION'
  | 'ARC_PAIR_CHORD_DEGENERATE'
  | 'ARC_PAIR_NO_TIE'
  | 'ARC_PAIR_INVALID';

export interface StudyPoint {
  x: number;
  y: number;
  z: number;
}

export type StudyFrame = ArcTerminalFrame;

export interface ArcPairStudyInput {
  vx: number;
  vy: number;
  vz: number;
  side: GradingSide;
  surfaceArc: ArcSpec;
  surfaceCriterion: GradingCriterion;
  analyticArc: ArcSpec;
  analyticCriterion: GradingCriterion;
  target: GradingTargetMeshSnapshot;
  maxSearchDistance: number;
  /** Shared chord tolerance for BOTH linearizations. */
  curveChordTolerance: number;
  /** Build the corner strip mesh + independent overlap audit. */
  buildMesh?: boolean;
  /** Resolve the tie on the true (non-chord) joint tangents. */
  trueTangents?: boolean;
}

export interface ArcPairOverlapAudit {
  triangles: number;
  invertedTriangles: number;
  doubleCoverPairs: number;
  maxDoubleCoverArea: number;
  components: number;
  boundaryLoops: number;
  tieRetained: boolean;
  validTin: boolean;
}

export interface ArcPairStudyResult {
  outcome: ArcPairVariantOutcome;
  detail?: string;
  turn: 'GAP' | 'OVERLAP' | 'TANGENT' | null;
  cutFill: 'CUT' | 'FILL' | 'TIED' | null;
  inChords: number;
  outChords: number;
  inChord: StudyFrame | null;
  outChord: StudyFrame | null;
  inTrue: StudyFrame | null;
  outTrue: StudyFrame | null;
  /** Per-terminal-chord longitudinal grade ΔZ/|chord| (distinct from frame gs). */
  inChordGrade: number | null;
  outChordGrade: number | null;
  exact: boolean;
  tie: StudyPoint | null;
  extent: number | null;
  qs: StudyPoint | null;
  qa: StudyPoint | null;
  mesh: { points: number[]; triangles: number[] } | null;
  /** Daylight corner run (incoming end → tie → outgoing start). */
  cornerRun: StudyPoint[] | null;
  audit: ArcPairOverlapAudit | null;
  digest: string;
}

const finiteAll = (values: number[]): boolean => values.every((value) => Number.isFinite(value));

const pointOf = (p: { x: number; y: number; z: number }): StudyPoint => ({ x: p.x, y: p.y, z: p.z });

/** Reverse an arc spec B->A while preserving the physical circle. */
export const reverseArcSpec = (spec: ArcSpec): ArcSpec => ({
  ...spec,
  startAngle: spec.endAngle,
  endAngle: spec.startAngle,
  sweepCCW: !spec.sweepCCW,
  startZ: spec.endZ,
  endZ: spec.startZ,
});

/* ── member strips (per-node band, so the OVERLAP clip tiles cleanly) ── */

interface MemberStrip {
  daylight: StudyPoint[];
  tris: MergeTriangle[];
}

/**
 * Per-chord solve + per-node daylight band: an interior node takes the
 * daylight from exactly one adjacent chord (incoming → the ending chord,
 * outgoing → the starting chord), so the source/daylight polylines stay
 * index-aligned and the band has no production arc-seam notch.
 */
const buildMemberStrip = (
  member: ArcMember,
  criterion: GradingCriterion,
  side: GradingSide,
  maxSearchDistance: number,
  target: GradingTargetMeshSnapshot,
  tolerance: number,
): MemberStrip | null => {
  const chords = linearizeArcMember(member, tolerance);
  const query = buildTargetQuery(target);
  if (!chords || !query) return null;
  const source: StudyPoint[] = [];
  const daylight: StudyPoint[] = [];
  for (const chord of chords) {
    const out = solveGradingChord({
      source: { ...chord }, side, criterion, maxSearchDistance, target, query,
    });
    if (!out.ok || out.solve.sourcePts.length < 2) return null;
    const s0 = pointOf(out.solve.sourcePts[0]!);
    const s1 = pointOf(out.solve.sourcePts[out.solve.sourcePts.length - 1]!);
    const d0 = pointOf(out.solve.daylightPts[0]!);
    const d1 = pointOf(out.solve.daylightPts[out.solve.daylightPts.length - 1]!);
    if (source.length === 0) source.push(s0);
    source.push(s1);
    if (daylight.length === 0) daylight.push(d0);
    daylight.push(d1);
  }
  const tris: MergeTriangle[] = [];
  for (let i = 0; i + 1 < source.length; i += 1) {
    const a = source[i]!;
    const b = source[i + 1]!;
    const c = daylight[i + 1]!;
    const d = daylight[i]!;
    tris.push({ a, b, c }, { a, b: c, c: d });
  }
  return { daylight, tris };
};

/* ── independent projected-overlap audit (beyond validateExplicitTinPayload) ── */

const signedArea2Of = (t: MergeTriangle): number =>
  (t.b.x - t.a.x) * (t.c.y - t.a.y) - (t.c.x - t.a.x) * (t.b.y - t.a.y);

const triTriOverlapArea = (a: MergeTriangle, b: MergeTriangle): number => {
  let poly = [a.a, a.b, a.c].map((p) => ({ x: p.x, y: p.y }));
  const bOri = signedArea2Of(b);
  const sign = bOri >= 0 ? 1 : -1;
  for (const [c0, c1] of [[b.a, b.b], [b.b, b.c], [b.c, b.a]] as Array<[SectorPoint, SectorPoint]>) {
    if (poly.length === 0) break;
    const inside = (p: { x: number; y: number }): number =>
      sign * ((c1.x - c0.x) * (p.y - c0.y) - (c1.y - c0.y) * (p.x - c0.x));
    const out: Array<{ x: number; y: number }> = [];
    for (let j = 0; j < poly.length; j += 1) {
      const cur = poly[j]!;
      const prev = poly[(j + poly.length - 1) % poly.length]!;
      const curIn = inside(cur) >= -zeroDelta(inside(cur), 0);
      const prevIn = inside(prev) >= -zeroDelta(inside(prev), 0);
      if (curIn) {
        if (!prevIn) {
          const t = inside(prev) / (inside(prev) - inside(cur));
          out.push({ x: prev.x + (cur.x - prev.x) * t, y: prev.y + (cur.y - prev.y) * t });
        }
        out.push(cur);
      } else if (prevIn) {
        const t = inside(prev) / (inside(prev) - inside(cur));
        out.push({ x: prev.x + (cur.x - prev.x) * t, y: prev.y + (cur.y - prev.y) * t });
      }
    }
    poly = out;
  }
  if (poly.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    sum += p.x * q.y - q.x * p.y;
  }
  return Math.abs(sum) / 2;
};

const countComponents = (points: number[], triangles: number[]): number => {
  const parent = Array.from({ length: points.length / 3 }, (_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root]! !== root) root = parent[root]!;
    let cur = i;
    while (parent[cur]! !== root) {
      const next = parent[cur]!;
      parent[cur] = root;
      cur = next;
    }
    return root;
  };
  const used = new Set<number>();
  for (let f = 0; f + 2 < triangles.length; f += 3) {
    const ids = [triangles[f]!, triangles[f + 1]!, triangles[f + 2]!];
    const r0 = find(ids[0]!);
    for (const id of ids) {
      const r = find(id);
      if (r !== r0) parent[r] = r0;
      used.add(id);
    }
  }
  return new Set([...used].map(find)).size;
};

const boundaryLoops = (triangles: number[]): number => {
  const count = new Map<string, number>();
  const key = (a: number, b: number): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (let f = 0; f + 2 < triangles.length; f += 3) {
    const ids = [triangles[f]!, triangles[f + 1]!, triangles[f + 2]!];
    for (let e = 0; e < 3; e += 1) {
      const k = key(ids[e]!, ids[(e + 1) % 3]!);
      count.set(k, (count.get(k) ?? 0) + 1);
    }
  }
  const adj = new Map<number, number[]>();
  let edges = 0;
  for (const [k, n] of count) {
    if (n !== 1) continue;
    edges += 1;
    const [a, b] = k.split('|').map(Number) as [number, number];
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a)!.push(b);
    adj.get(b)!.push(a);
  }
  if (edges === 0) return 0;
  const seen = new Set<string>();
  let loops = 0;
  for (const start of adj.keys()) {
    const stack = [start];
    let size = 0;
    while (stack.length > 0) {
      const v = stack.pop()!;
      for (const w of adj.get(v) ?? []) {
        const k = v < w ? `${v}|${w}` : `${w}|${v}`;
        if (seen.has(k)) continue;
        seen.add(k);
        size += 1;
        stack.push(w);
      }
    }
    if (size > 0) loops += 1;
  }
  return loops;
};

const snapPoint = (p: MergePoint): MergePoint => ({
  x: Math.round(p.x * 1e9) / 1e9,
  y: Math.round(p.y * 1e9) / 1e9,
  z: Math.round(p.z * 1e9) / 1e9,
});

/** Snap near-duplicate seam vertices, merge, then audit beyond the TIN validator. */
const auditCornerMesh = (
  tris: MergeTriangle[],
  tieRetained: boolean,
): { audit: ArcPairOverlapAudit; mesh: { points: number[]; triangles: number[] } } => {
  const merged = mergeGroupTriangles(tris.map((t) => ({ a: snapPoint(t.a), b: snapPoint(t.b), c: snapPoint(t.c) })));
  const list: MergeTriangle[] = [];
  for (let f = 0; f + 2 < merged.triangles.length; f += 3) {
    const at = (i: number): StudyPoint => ({
      x: merged.points[i * 3]!, y: merged.points[i * 3 + 1]!, z: merged.points[i * 3 + 2]!,
    });
    list.push({ a: at(merged.triangles[f]!), b: at(merged.triangles[f + 1]!), c: at(merged.triangles[f + 2]!) });
  }
  let inverted = 0;
  for (const t of list) if (signedArea2Of(t) <= 0) inverted += 1;
  let doubleCoverPairs = 0;
  let maxDoubleCoverArea = 0;
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const area = triTriOverlapArea(list[i]!, list[j]!);
      if (area > 1e-9) {
        doubleCoverPairs += 1;
        maxDoubleCoverArea = Math.max(maxDoubleCoverArea, area);
      }
    }
  }
  return {
    audit: {
      triangles: list.length,
      invertedTriangles: inverted,
      doubleCoverPairs,
      maxDoubleCoverArea,
      components: countComponents(merged.points, merged.triangles),
      boundaryLoops: boundaryLoops(merged.triangles),
      tieRetained,
      validTin: validateGroupMesh(merged) === null,
    },
    mesh: merged,
  };
};

const digestOf = (mesh: { points: number[]; triangles: number[] } | null, tie: StudyPoint | null): string => {
  const parts: number[] = [];
  if (mesh) parts.push(...mesh.points, ...mesh.triangles);
  if (tie) parts.push(tie.x, tie.y, tie.z);
  return parts.map((v) => v.toPrecision(15)).join(',');
};

/** Per-terminal-chord grade ΔZ/|chord| (the study's chord-model quantity). */
export const terminalChordGrade = (
  member: ArcMember,
  atEnd: boolean,
  tolerance: number,
): number | null => {
  const chords = linearizeArcMember(member, tolerance);
  if (!chords || chords.length === 0) return null;
  const c = chords[atEnd ? chords.length - 1 : 0]!;
  const len = Math.hypot(c.endX - c.startX, c.endY - c.startY);
  return len > 0 ? (c.endZ - c.startZ) / len : null;
};

/* ── variant resolver (delegates the corner to Worker-CORE) ── */

const blank = (): ArcPairStudyResult => ({
  outcome: 'ARC_PAIR_INVALID', turn: null, cutFill: null,
  inChords: 0, outChords: 0, inChord: null, outChord: null, inTrue: null, outTrue: null,
  inChordGrade: null, outChordGrade: null,
  exact: false, tie: null, extent: null, qs: null, qa: null,
  mesh: null, cornerRun: null, audit: null, digest: '',
});

/** Resolve one arc-pair variant joint through the shared Worker-CORE seam. */
export const resolveArcPairStudy = (input: ArcPairStudyInput): ArcPairStudyResult => {
  const result = blank();
  const { vx, vy, vz, side, maxSearchDistance, curveChordTolerance } = input;
  if (!finiteAll([vx, vy, vz, maxSearchDistance, curveChordTolerance]) || !(maxSearchDistance > 0)) {
    return { ...result, detail: 'bad-input' };
  }
  const sMember = makeArcMember(input.surfaceArc);
  const aMember = makeArcMember(input.analyticArc);
  if (!sMember || !aMember) return { ...result, detail: 'arc-spec' };
  const model: ArcTangentModel = input.trueTangents ? 'true-tangent' : 'chord';
  const inChord = arcTerminalFrame(sMember, true, 'chord', side, curveChordTolerance);
  const outChord = arcTerminalFrame(aMember, false, 'chord', side, curveChordTolerance);
  const inTrue = arcTerminalFrame(sMember, true, 'true-tangent', side, curveChordTolerance);
  const outTrue = arcTerminalFrame(aMember, false, 'true-tangent', side, curveChordTolerance);
  const inChordN = linearizeArcMember(sMember, curveChordTolerance)?.length ?? 0;
  const outChordN = linearizeArcMember(aMember, curveChordTolerance)?.length ?? 0;
  result.inChords = inChordN;
  result.outChords = outChordN;
  result.inTrue = inTrue;
  result.outTrue = outTrue;
  result.inChordGrade = terminalChordGrade(sMember, true, curveChordTolerance);
  result.outChordGrade = terminalChordGrade(aMember, false, curveChordTolerance);
  const inFrame = input.trueTangents ? inTrue : inChord;
  const outFrame = input.trueTangents ? outTrue : outChord;
  result.inChord = inFrame;
  result.outChord = outFrame;
  if (!inFrame || !outFrame) return { ...result, detail: 'frame' };
  const turn = classifyCorner(inFrame.t, outFrame.t, side);
  if (!turn) return { ...result, detail: 'turn' };
  result.turn = turn;
  const frameDet = inFrame.t.nx * outFrame.t.ny - inFrame.t.ny * outFrame.t.nx;
  if (Math.abs(frameDet) <= zeroDelta(frameDet, 0)) {
    return { ...result, outcome: 'ARC_PAIR_CHORD_DEGENERATE', detail: 'parallel-terminal-chords' };
  }
  const query = buildTargetQuery(input.target);
  if (!query) return { ...result, outcome: 'ARC_PAIR_INVALID', detail: 'target' };
  const ztV = query.elevationAt(vx, vy);
  if (ztV !== null) result.cutFill = cutFillSideAtCorner(ztV, vz);
  const inStrip = buildMemberStrip(sMember, input.surfaceCriterion, side, maxSearchDistance, input.target, curveChordTolerance);
  const outStrip = buildMemberStrip(aMember, input.analyticCriterion, side, maxSearchDistance, input.target, curveChordTolerance);
  if (!inStrip || !outStrip) return { ...result, outcome: 'ARC_PAIR_INVALID', detail: 'strip' };
  result.qs = inStrip.daylight[inStrip.daylight.length - 1]!;
  result.qa = outStrip.daylight[0]!;
  const candidates = candidateTriangles(input.target, [
    { x: vx - maxSearchDistance, y: vy - maxSearchDistance },
    { x: vx + maxSearchDistance, y: vy - maxSearchDistance },
    { x: vx + maxSearchDistance, y: vy + maxSearchDistance },
    { x: vx - maxSearchDistance, y: vy + maxSearchDistance },
  ]);
  if (!candidates) return { ...result, outcome: 'ARC_PAIR_INVALID', detail: 'candidates' };
  const hybrid: HybridCornerOutcome = resolveArcPairCorner({
    vx, vy, vz,
    inMember: sMember, outMember: aMember,
    inModel: model, outModel: model,
    side, tolerance: curveChordTolerance,
    inCriterion: input.surfaceCriterion, outCriterion: input.analyticCriterion,
    query: query as TargetQuery, target: input.target, candidates, maxSearchDistance,
    qs: result.qs, qa: result.qa,
    inStrip: inStrip.tris, outStrip: outStrip.tris,
    inDaylight: inStrip.daylight, outDaylight: outStrip.daylight,
    midIn: { x: (sMember.start.x + vx) / 2, y: (sMember.start.y + vy) / 2 },
    midOut: { x: (vx + aMember.end.x) / 2, y: (vy + aMember.end.y) / 2 },
  });
  if (!hybrid.ok) {
    const finite = hybrid.detail.includes('TRANSITION_REQUIRED');
    return {
      ...result,
      outcome: finite ? 'ARC_PAIR_FINITE_TRANSITION' : 'ARC_PAIR_NO_TIE',
      detail: hybrid.detail,
    };
  }
  result.exact = true;
  result.outcome = 'ARC_PAIR_EXACT_COMMON_TIE';
  result.tie = pointOf(hybrid.tie);
  result.extent = hybrid.extent;
  result.cornerRun = hybrid.cornerRun.map(pointOf);
  if (!input.buildMesh) return result;
  const allTris = [...hybrid.inTris, ...hybrid.outTris, ...hybrid.patchTris];
  const tieHits = result.cornerRun.filter((p) => p.x === result.tie!.x && p.y === result.tie!.y && p.z === result.tie!.z).length;
  const audited = auditCornerMesh(allTris, tieHits === 1);
  result.mesh = audited.mesh;
  result.audit = audited.audit;
  result.digest = digestOf(audited.mesh, result.tie);
  return result;
};

/* ── study fixtures ── */

/** Flat/planar target patch (spanned-quad flat TIN), reused by every case. */
export const flatTin = (z: number, half = 200): GradingTargetMeshSnapshot => {
  const a = (10 * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const pts: Array<[number, number]> = [[-half, -half], [half, -half], [half, half], [-half, half]];
  return {
    points: pts.flatMap(([x, y]) => [x * c - y * s, x * s + y * c, z]),
    triangles: [0, 1, 2, 0, 2, 3],
  };
};

/** OVERLAP oracle: incoming surface arc A→V (right side stays inside). */
export const overlapSurfaceArc = (startZ = 100, endZ = 100): ArcSpec => ({
  centerX: 0, centerY: 60, radius: 60,
  startAngle: Math.PI, endAngle: 1.5 * Math.PI, sweepCCW: true,
  startZ, endZ,
});

/** OVERLAP oracle: outgoing analytic arc V→B, curving back under the joint. */
export const overlapAnalyticArc = (startZ = 100, endZ = 100): ArcSpec => ({
  centerX: 80, centerY: 0, radius: 80,
  startAngle: Math.PI, endAngle: 1.5 * Math.PI, sweepCCW: true,
  startZ, endZ,
});
