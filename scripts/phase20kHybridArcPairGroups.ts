/**
 * Phase 20K — hybrid arc×arc GROUP feasibility study assembler (EVIDENCE ONLY).
 *
 * Non-routed: this file composes the PRODUCTION member solvers and merge
 * helpers (`solveStraightChord`, `solveGradingChord`, `linearizeGradingArc`,
 * `solveHybridCorner`, `mergeGroupTriangles`, `validateGroupMesh`,
 * `clipTriangleToHalfPlane`, `ringIsSimple`, `groupMeshStats`) into full
 * open/closed hybrid groups for a genuine arc pair. It NEVER claims a
 * production route: an arc×arc hybrid joint remains blocked in production
 * (`GRADING_SURFACE_ANALYTIC_ARC_PAIR_UNSUPPORTED`); this study only answers
 * whether an honest terminal frame makes the tie buildable, as measured.
 *
 * Corner frame models are the §6 subject and live in
 * `phase20kHybridArcPairCore.ts` (Worker-CORE's file; a local stub was used
 * here because it was absent — see that file's header).
 *
 * Usage:
 *   npx tsx scripts/phase20kHybridArcPairGroups.ts   # writes corpus.json
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { zeroDelta } from '../src/engine/cad/surfaces/volume/zero';
import { linearizeGradingArc } from '../src/engine/cad/grading/gradingCurve';
import type { GradingComputeSource, TargetQuery } from '../src/engine/cad/grading/gradingComputeTypes';
import { buildTargetQuery, candidateTriangles } from '../src/engine/cad/grading/gradingTargetIndex';
import {
  groupMeshStats,
  mergeGroupTriangles,
  ringIsSimple,
  validateGroupMesh,
  type MergePoint,
  type MergeTriangle,
  type MergedGroupMesh,
} from '../src/engine/cad/grading/gradingGroupMerge';
import type { GradingTargetMeshSnapshot } from '../src/engine/cad/grading/gradingComputeTypes';
import { solveGradingChord } from '../src/engine/cad/grading/solveAnalyticGradingChord';
import { solveStraightChord, type StraightChordSolve } from '../src/engine/cad/grading/solveStraightChord';
import { seamEquals } from '../src/engine/cad/grading/arcSolve';
import {
  computeGradingGroupFromSnapshots,
  type GradingGroupComputeOutcome,
} from '../src/engine/cad/grading/gradingGroupCompute';
import type { GroupDiagnosticCode } from '../src/engine/cad/grading/gradingGroupTypes';
import {
  isTargetFreeCriterion,
  type GradingCriterion,
  type GradingSide,
} from '../src/engine/cad/grading/gradingTypes';
import {
  makeArcMember,
  resolveArcPairCorner,
  rotateArcSpec,
  type ArcMember,
  type ArcSpec,
  type ArcTangentModel,
} from './phase20kHybridArcPairCore';

export const OUT = join(dirname(process.argv[1] ?? '.'), '..', 'docs', 'evidence', 'phase20k', 'corpus.json');
const OUT_OVERRIDE = process.env.PHASE20K_CORPUS_OUT;

export const digest = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

/**
 * Canonical triangle-set signature: each face as its three rounded XYZ
 * vertices sorted, faces sorted. Order- and index-independent, so two meshes
 * that tile the same geometry compare equal regardless of merge ordering.
 */
export const canonicalTriangles = (points: number[], triangles: number[]): string[] => {
  const out: string[] = [];
  for (let f = 0; f + 2 < triangles.length; f += 3) {
    const vs = [0, 1, 2].map((k) => {
      const i = triangles[f + k]!;
      return `${points[i * 3]!.toFixed(9)},${points[i * 3 + 1]!.toFixed(9)},${points[i * 3 + 2]!.toFixed(9)}`;
    });
    vs.sort();
    out.push(vs.join(';'));
  }
  out.sort();
  return out;
};

export const FIXED = (g: number): GradingCriterion => ({ kind: 'fixed', gradeRatio: g });
export const DIST = (g: number, d: number): GradingCriterion => ({ kind: 'distance', gradeRatio: g, distance: d });
export const ELEV = (g: number, t: number): GradingCriterion => ({ kind: 'elevation', gradeRatio: g, targetElevation: t });
export const REL = (g: number, dz: number): GradingCriterion => ({ kind: 'relative-elevation', gradeRatio: g, relativeElevation: dz });

/** True when a criterion terminates without a target surface. */
const isSurfaceCriterion = (c: GradingCriterion): boolean => !isTargetFreeCriterion(c);

// ---------------------------------------------------------------------------
// §27 fixtures — genuine arc geometry.

/** Rounded-square side: chord c=100, sagitta s=5 ⇒ R=252.5, centre 247.5 out. */
export const SQUARE_RADIUS = 252.5;
export const SQUARE_SIDE = 100;

/** Bottom side A(0,0,10)→B(100,0,10), bulging toward the centre (sweep CW). */
export const bottomArcSpec = (z = 10): ArcSpec => {
  const cx = SQUARE_SIDE / 2;
  const cy = -Math.sqrt(SQUARE_RADIUS * SQUARE_RADIUS - (SQUARE_SIDE / 2) ** 2);
  return {
    centerX: cx, centerY: cy, radius: SQUARE_RADIUS,
    startAngle: Math.atan2(0 - cy, 0 - cx),
    endAngle: Math.atan2(0 - cy, SQUARE_SIDE - cx),
    sweepCCW: false, startZ: z, endZ: z,
  };
};

/**
 * Buildable rounded-square side: the spec's geometry mirrored across the
 * chord (centre (50,+247.5), minor CCW). The spec-literal centre (50,−247.5)
 * with a minor CW sweep produces INWARD-bulging arcs whose outward grading
 * offset self-intersects (production all-distance control fails
 * `GROUP_SELF_INTERSECTION`; recorded as `closed.square.literal-concave`).
 * The task requires a simple closed boundary, so the study's `§27` group
 * uses this outward (convex) mirror and documents the literal failure.
 */
export const outwardBottomSpec = (z = 10): ArcSpec => {
  const cx = SQUARE_SIDE / 2;
  const cy = Math.sqrt(SQUARE_RADIUS * SQUARE_RADIUS - (SQUARE_SIDE / 2) ** 2);
  return {
    centerX: cx, centerY: cy, radius: SQUARE_RADIUS,
    startAngle: Math.atan2(0 - cy, 0 - cx),
    endAngle: Math.atan2(0 - cy, SQUARE_SIDE - cx),
    sweepCCW: true, startZ: z, endZ: z,
  };
};

/** Canonical rounded-square corners (shared by construction ⇒ exact joints). */
export const SQUARE_CORNERS: Array<[number, number]> = [[0, 0], [SQUARE_SIDE, 0], [SQUARE_SIDE, SQUARE_SIDE], [0, SQUARE_SIDE]];

/**
 * Honest endpoint-anchored arc over the A(0,0)→B(100,0) chord: the centre
 * sits at (50, cy) with cy=sqrt(R²−50²) so A and B lie exactly on the
 * circle — no sagitta guess, no endpoint override. Returns null for R≤50.
 */
export const anchoredRadiusArc = (radius: number, z = 10): ArcMember | null => {
  const half = SQUARE_SIDE / 2;
  const cy = Math.sqrt(radius * radius - half * half);
  if (!Number.isFinite(cy)) return null;
  return makeArcMember({
    centerX: half, centerY: cy, radius,
    startAngle: Math.atan2(-cy, -half), endAngle: Math.atan2(-cy, half),
    sweepCCW: true, startZ: z, endZ: z,
  });
};

const squareFrom = (base: ArcSpec, z: number): ArcMember[] => {
  const specs = [0, 90, 180, 270].map((deg) => rotateArcSpec(base, deg, 50, 50));
  return specs.map((spec, k) => {
    const m = makeArcMember(spec)!;
    const s = SQUARE_CORNERS[k]!;
    const e = SQUARE_CORNERS[(k + 1) % 4]!;
    return {
      ...m,
      start: { x: s[0], y: s[1], z },
      end: { x: e[0], y: e[1], z },
      source: { ...m.source, startX: s[0], startY: s[1], endX: e[0], endY: e[1] },
    };
  });
};

/** Literal spec geometry (inward-bulging) — recorded as a fail-closed control. */
export const literalConcaveMembers = (z = 10): ArcMember[] => squareFrom(bottomArcSpec(z), z);

/** Outward (convex) rounded square — the §27 study group (exact ties, but
 * vertex-pinched mesh ⇒ NOT buildable; see the audit gate). */
export const roundedSquareMembers = (z = 10): ArcMember[] => squareFrom(outwardBottomSpec(z), z);

/** Primary open pair: bottom (A→B) + right (B→C) sharing B=(100,0) exactly. */
export const primaryArcPair = (z = 10): [ArcMember, ArcMember] => {
  const square = roundedSquareMembers(z);
  return [square[0]!, square[1]!];
};

/** Reverse an arc member's traversal (A↔B), preserving circle params. */
export const reverseArcMember = (m: ArcMember): ArcMember => ({
  ...m,
  start: m.end,
  end: m.start,
  source: {
    ...m.source,
    startX: m.end.x, startY: m.end.y, startZ: m.end.z,
    endX: m.start.x, endY: m.start.y, endZ: m.start.z,
    ...(m.source.arc
      ? { arc: { ...m.source.arc, startAngle: m.source.arc.endAngle, endAngle: m.source.arc.startAngle, sweepCCW: !m.source.arc.sweepCCW } }
      : {}),
  },
});

/** Translate an arc member (both endpoints, source, circle centre) by (dx,dy). */
export const translateArcMember = (m: ArcMember, dx: number, dy: number): ArcMember => ({
  ...m,
  start: { x: m.start.x + dx, y: m.start.y + dy, z: m.start.z },
  end: { x: m.end.x + dx, y: m.end.y + dy, z: m.end.z },
  source: {
    ...m.source,
    startX: m.source.startX + dx, startY: m.source.startY + dy,
    endX: m.source.endX + dx, endY: m.source.endY + dy,
    ...(m.source.arc ? { arc: { ...m.source.arc, centerX: m.source.arc.centerX + dx, centerY: m.source.arc.centerY + dy } } : {}),
  },
});

/** Translate a target TIN by (dx,dy) (Z untouched). */
export const translateTarget = (t: GradingTargetMeshSnapshot, dx: number, dy: number): GradingTargetMeshSnapshot => ({
  points: t.points.map((v, i) => (i % 3 === 2 ? v : i % 3 === 0 ? v + dx : v + dy)),
  triangles: [...t.triangles],
});

/**
 * Flat target TIN (z=0) spun 10° so every study ray cuts edges transversely
 * (the shared interval code fails closed on axis-parallel rays; see the 20I
 * study's `record.quirk-*` rows). The plane is rotation-invariant so every
 * hand-derived tie is preserved. Extends well past the grading boundary.
 */
export const flatTin = (z: number, half = 400, deg = 10): GradingTargetMeshSnapshot => {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const pts: Array<[number, number]> = [[-half, -half], [half, -half], [half, half], [-half, half]];
  return {
    points: pts.flatMap(([x, y]) => [x * c - y * s + 50, x * s + y * c + 50, z]),
    triangles: [0, 1, 2, 0, 2, 3],
  };
};

// ---------------------------------------------------------------------------
// Member solving (mirrors the production hybrid path member loop).

export interface SolvedMember {
  member: ArcMember;
  criterion: GradingCriterion;
  surface: boolean;
  model: ArcTangentModel;
  chords: number;
  stitched: StraightChordSolve;
  strips: MergeTriangle[];
  daylight: MergePoint[];
}

const linearizeMember = (member: ArcMember, tolerance: number): GradingComputeSource[] | null => {
  const linearized = linearizeGradingArc(
    member.spec.centerX, member.spec.centerY, member.spec.radius,
    member.spec.startAngle, member.spec.endAngle, member.spec.sweepCCW,
    member.spec.startZ, member.spec.endZ, tolerance,
  );
  if (!linearized) return null;
  const chords: GradingComputeSource[] = [];
  for (let k = 0; k + 1 < linearized.points.length; k += 1) {
    const p0 = linearized.points[k]!;
    const p1 = linearized.points[k + 1]!;
    const chordLen = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    if (!(chordLen > 0) || !Number.isFinite(chordLen)) return null;
    chords.push({
      startX: p0.x, startY: p0.y, endX: p1.x, endY: p1.y,
      startZ: p0.z, endZ: p1.z, length: chordLen, reoriented: false, isArc: false,
    });
  }
  return chords.length > 0 ? chords : null;
};

/** Stitch chord solves in order (the 20B arc seam convention). */
const stitchChords = (solves: StraightChordSolve[]): StraightChordSolve => {
  const out: StraightChordSolve = {
    regions: [], diagnostics: [], nodeStations: [],
    sourcePts: [], daylightPts: [], daylightFlat: [],
    distances: [], candidateTriangleCount: 0,
    intersectionSegmentCount: 0, multipleSolutionCount: 0,
  };
  for (const chord of solves) {
    let skipFirst = 0;
    if (
      out.sourcePts.length > 0 &&
      seamEquals(out.sourcePts[out.sourcePts.length - 1]!, chord.sourcePts[0]!) &&
      seamEquals(out.daylightPts[out.daylightPts.length - 1]!, chord.daylightPts[0]!)
    ) {
      skipFirst = 1;
    }
    out.regions.push(...chord.regions);
    out.diagnostics.push(...chord.diagnostics);
    for (let i = skipFirst; i < chord.sourcePts.length; i += 1) {
      out.sourcePts.push(chord.sourcePts[i]!);
      out.daylightPts.push(chord.daylightPts[i]!);
      out.distances.push(chord.distances[i]!);
      out.nodeStations.push(chord.nodeStations[i]!);
    }
    for (let i = skipFirst * 3; i < chord.daylightFlat.length; i += 1) out.daylightFlat.push(chord.daylightFlat[i]!);
    out.candidateTriangleCount += chord.candidateTriangleCount;
    out.intersectionSegmentCount += chord.intersectionSegmentCount;
    out.multipleSolutionCount += chord.multipleSolutionCount;
  }
  return out;
};

const solveMember = (
  member: ArcMember,
  criterion: GradingCriterion,
  model: ArcTangentModel,
  side: GradingSide,
  maxSearchDistance: number,
  tolerance: number,
  target: GradingTargetMeshSnapshot | undefined,
  query: TargetQuery | null,
): { ok: true; solved: SolvedMember } | { ok: false; code: GroupDiagnosticCode; detail: string } => {
  const surface = isSurfaceCriterion(criterion);
  const chords = linearizeMember(member, tolerance);
  if (!chords) return { ok: false, code: 'MEMBER_NO_SOLUTION', detail: 'GRADING_ARC_LINEARIZE' };
  const segArc = member.length / chords.length;
  const solves: StraightChordSolve[] = [];
  for (let ci = 0; ci < chords.length; ci += 1) {
    const chord = chords[ci]!;
    const stationBase = ci * segArc;
    const stationScale = segArc / chord.length;
    const out = surface
      ? solveStraightChord({
        source: chord, side, criterion, maxSearchDistance,
        target: target!, query: query!, stationBase, stationScale,
      })
      : solveGradingChord({
        source: chord, side, criterion, maxSearchDistance,
        ...(target !== undefined ? { target } : {}),
        ...(query !== null ? { query } : {}),
        stationBase, stationScale,
      });
    if (!out.ok) {
      return { ok: false, code: out.code === 'TARGET_GAP' ? 'MEMBER_TARGET_GAP' : 'MEMBER_NO_SOLUTION', detail: out.detail ?? 'member' };
    }
    solves.push(out.solve);
  }
  const stitched = stitchChords(solves);
  const strips: MergeTriangle[] = [];
  const src = stitched.sourcePts;
  const dst = stitched.daylightPts;
  for (let i = 0; i + 1 < src.length; i += 1) {
    const a = src[i]!;
    const b = src[i + 1]!;
    const c = dst[i + 1]!;
    const d = dst[i]!;
    strips.push({ a, b, c }, { a, b: c, c: d });
  }
  return {
    ok: true,
    solved: {
      member, criterion, surface, model, chords: chords.length,
      stitched, strips, daylight: stitched.daylightPts.map((p) => ({ ...p })),
    },
  };
};

// ---------------------------------------------------------------------------
// Group assembly (open path / closed ring) over genuine arcs.

export interface HybridArcGroupInput {
  members: ArcMember[];
  criteria: GradingCriterion[];
  models: ArcTangentModel[];
  side: GradingSide;
  maxSearchDistance: number;
  curveChordTolerance: number;
  closed: boolean;
  target?: GradingTargetMeshSnapshot;
  /** Perf harness only: collect stage timings (default off). */
  measure?: boolean;
}

export interface GroupCornerSummary {
  cornerIndex: number;
  classification: 'GAP' | 'OVERLAP';
  tie: [number, number, number];
  extent: number;
  rootCount: number;
  detail?: string;
}

export interface HybridArcGroupResult {
  ok: true;
  mesh: MergedGroupMesh;
  daylight: MergePoint[];
  corners: GroupCornerSummary[];
  planArea: number;
  area3d: number;
  min: number;
  max: number;
  mean: number;
  memberChords: number;
  memberPoints: number;
  /** Sum of member stitched source points (discretization size). */
  memberSourcePoints: number;
  /** Target candidate triangle count considered at the corners. */
  candidateCount: number;
  rootCounts: number[];
  accuracy: 'EXACT' | 'CURVE_APPROXIMATED';
  model: ArcTangentModel;
  closed: boolean;
  /** Mesh+boundary-only digest (comparable to the production control digest). */
  meshDigest: string;
  /** Stage timings (ms), present only when `measure` is set. */
  stageMs?: { solve: number; corner: number; merge: number; validate: number };
  digest: string;
}

export type HybridArcGroupOutcome =
  | HybridArcGroupResult
  | { ok: false; code: GroupDiagnosticCode; detail: string };

const asPoint = (p: { x: number; y: number; z: number }): MergePoint => ({ x: p.x, y: p.y, z: p.z });

/**
 * Assemble a full hybrid group over genuine arcs. Member strips use the
 * production chord solvers; every joint resolves through the study arc-pair
 * corner (frame model per member) and merges under the normal validator.
 */
export const assembleHybridArcGroup = (input: HybridArcGroupInput): HybridArcGroupOutcome => {
  const { members, criteria, models, side, maxSearchDistance, curveChordTolerance, closed, target } = input;
  if (members.length < 1) return { ok: false, code: 'MEMBER_NO_SOLUTION', detail: 'GRADING_GROUP_EMPTY' };
  if (closed && members.length < 3) return { ok: false, code: 'MEMBER_NO_SOLUTION', detail: 'GRADING_GROUP_CLOSED_TOO_SHORT' };
  if (!(maxSearchDistance > 0) || !Number.isFinite(maxSearchDistance)) {
    return { ok: false, code: 'MEMBER_NO_SOLUTION', detail: 'GRADING_BAD_SEARCH_DISTANCE' };
  }
  const jointCount = closed ? members.length : members.length - 1;
  for (let j = 0; j < jointCount; j += 1) {
    const a = members[j]!;
    const b = members[(j + 1) % members.length]!;
    if (!(a.end.x === b.start.x && a.end.y === b.start.y && a.end.z === b.start.z)) {
      return { ok: false, code: 'CORNER_INVERTED', detail: 'GRADING_GROUP_CORNER_MISMATCH' };
    }
  }
  const anySurface = criteria.some(isSurfaceCriterion);
  const query = anySurface ? (target === undefined ? null : buildTargetQuery(target)) : null;
  if (anySurface && !query) return { ok: false, code: 'MEMBER_NO_SOLUTION', detail: 'GRADING_BAD_TARGET_MESH' };
  let candidates: number[] = [];
  if (anySurface) {
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    for (const m of members) {
      minX = Math.min(minX, m.start.x, m.end.x);
      minY = Math.min(minY, m.start.y, m.end.y);
      maxX = Math.max(maxX, m.start.x, m.end.x);
      maxY = Math.max(maxY, m.start.y, m.end.y);
    }
    const built = candidateTriangles(target!, [
      { x: minX - maxSearchDistance, y: minY - maxSearchDistance },
      { x: maxX + maxSearchDistance, y: minY - maxSearchDistance },
      { x: maxX + maxSearchDistance, y: maxY + maxSearchDistance },
      { x: minX - maxSearchDistance, y: maxY + maxSearchDistance },
    ]);
    if (!built) return { ok: false, code: 'MEMBER_NO_SOLUTION', detail: 'GRADING_BAD_TARGET_MESH' };
    candidates = built;
  }

  const solved: SolvedMember[] = [];
  const tSolve = performance.now();
  for (let mi = 0; mi < members.length; mi += 1) {
    const out = solveMember(members[mi]!, criteria[mi]!, models[mi]!, side, maxSearchDistance, curveChordTolerance, target, query);
    if (!out.ok) return out;
    solved.push(out.solved);
  }
  const solveMs = performance.now() - tSolve;
  const memberTris: MergeTriangle[][] = solved.map((s) => s.strips);
  const memberDaylight: MergePoint[][] = solved.map((s) => s.daylight.map((p) => ({ ...p })));
  const corners: GroupCornerSummary[] = [];
  const patchTris: MergeTriangle[] = [];
  const tCorner = performance.now();

  for (let j = 0; j < jointCount; j += 1) {
    const inIdx = j;
    const outIdx = (j + 1) % members.length;
    const inc = solved[inIdx]!;
    const out = solved[outIdx]!;
    if (inc.surface === out.surface) {
      return { ok: false, code: 'CORNER_NO_SOLUTION', detail: 'GRADING_GROUP_MIXED_TERMINATION_DOMAIN' };
    }
    const vx = inc.member.end.x;
    const vy = inc.member.end.y;
    const vz = inc.member.end.z;
    const qsStitch = inc.surface
      ? inc.stitched.daylightPts[inc.stitched.daylightPts.length - 1]!
      : out.stitched.daylightPts[0]!;
    const qaStitch = inc.surface
      ? out.stitched.daylightPts[0]!
      : inc.stitched.daylightPts[inc.stitched.daylightPts.length - 1]!;
    const hybrid = resolveArcPairCorner({
      vx, vy, vz,
      inMember: inc.member, outMember: out.member,
      inModel: models[inIdx]!, outModel: models[outIdx]!,
      side, tolerance: curveChordTolerance,
      inCriterion: criteria[inIdx]!, outCriterion: criteria[outIdx]!,
      query: query!, target: target!, candidates, maxSearchDistance,
      qs: { x: qsStitch.x, y: qsStitch.y, z: qsStitch.z },
      qa: { x: qaStitch.x, y: qaStitch.y, z: qaStitch.z },
      inStrip: memberTris[inIdx]!, outStrip: memberTris[outIdx]!,
      inDaylight: memberDaylight[inIdx]!, outDaylight: memberDaylight[outIdx]!,
      midIn: { x: (inc.member.start.x + vx) / 2, y: (inc.member.start.y + vy) / 2 },
      midOut: { x: (vx + out.member.end.x) / 2, y: (vy + out.member.end.y) / 2 },
    });
    if (!hybrid.ok) return { ok: false, code: hybrid.code, detail: hybrid.detail };
    if (hybrid.classification === 'GAP') {
      patchTris.push(...hybrid.patchTris);
    } else {
      memberTris[inIdx] = hybrid.inTris;
      memberTris[outIdx] = hybrid.outTris;
      memberDaylight[inIdx] = hybrid.inDaylight.map(asPoint);
      memberDaylight[outIdx] = hybrid.outDaylight.map(asPoint);
    }
    corners.push({
      cornerIndex: j, classification: hybrid.classification,
      tie: [hybrid.tie.x, hybrid.tie.y, hybrid.tie.z],
      extent: hybrid.extent, rootCount: hybrid.rootCount,
    });
  }

  // Global daylight: open path or simple closed ring (production rule).
  const cornerMs = performance.now() - tCorner;
  const tMerge = performance.now();
  const runs: MergePoint[][] = members.map((_, mi) => memberDaylight[mi]!);
  let daylight = mergeDaylightRuns(runs);
  if (closed) {
    if (daylight.length > 1) {
      const first = daylight[0]!;
      const last = daylight[daylight.length - 1]!;
      if (
        Math.abs(first.x - last.x) <= zeroDelta(first.x, last.x) &&
        Math.abs(first.y - last.y) <= zeroDelta(first.y, last.y) &&
        Math.abs(first.z - last.z) <= zeroDelta(first.z, last.z)
      ) {
        daylight = daylight.slice(0, -1);
      }
    }
    if (!ringIsSimple(daylight)) {
      return { ok: false, code: 'GROUP_SELF_INTERSECTION', detail: 'GRADING_GROUP_DAYLIGHT_RING' };
    }
  }
  const merged = mergeGroupTriangles([...memberTris.flat(), ...patchTris]);
  const mergeMs = performance.now() - tMerge;
  const tValidate = performance.now();
  const meshError = validateGroupMesh(merged);
  const validateMs = performance.now() - tValidate;
  if (meshError) return { ok: false, code: 'GROUP_NON_MANIFOLD', detail: meshError };
  const distances = solved.flatMap((s) => s.stitched.distances);
  const stats = groupMeshStats(merged, distances);
  const rootCounts = solved.flatMap((s) => s.stitched.multipleSolutionCount > 0 ? [s.stitched.multipleSolutionCount + 1] : [1]);
  const base = {
    ok: true as const,
    mesh: merged,
    daylight,
    corners,
    planArea: stats.planArea,
    area3d: stats.area3d,
    min: stats.min, max: stats.max, mean: stats.mean,
    memberChords: solved.reduce((n, s) => n + s.chords, 0),
    memberPoints: merged.points.length / 3,
    memberSourcePoints: solved.reduce((n, s) => n + s.stitched.sourcePts.length, 0),
    candidateCount: candidates.length,
    rootCounts,
    accuracy: 'CURVE_APPROXIMATED' as const,
    model: models[0]!,
    closed,
  };
  const meshDigest = digest(canonicalTriangles(merged.points, merged.triangles));
  return {
    ...base, meshDigest, digest: digest(groupFingerprint(base, merged, corners, daylight)),
    ...(input.measure ? { stageMs: { solve: solveMs, corner: cornerMs, merge: mergeMs, validate: validateMs } } : {}),
  };
};

/** Concatenate daylight runs dropping zeroDelta-duplicate joints. */
const mergeDaylightRuns = (runs: MergePoint[][]): MergePoint[] => {
  const out: MergePoint[] = [];
  for (const run of runs) {
    for (const p of run) {
      const prev = out[out.length - 1];
      if (!prev || !seamEquals(prev, p)) out.push(p);
    }
  }
  return out;
};

const groupFingerprint = (
  result: Omit<HybridArcGroupResult, 'digest' | 'meshDigest'>,
  mesh: MergedGroupMesh,
  corners: GroupCornerSummary[],
  daylight: MergePoint[],
): unknown => ({
  model: result.model,
  closed: result.closed,
  points: mesh.points,
  triangles: mesh.triangles,
  daylight: daylight.flatMap((p) => [p.x, p.y, p.z]),
  corners: corners.map((c) => ({ c: c.classification, tie: c.tie, e: c.extent, r: c.rootCount })),
  planArea: result.planArea,
  area3d: result.area3d,
});

// ---------------------------------------------------------------------------
// The independent §29 topology audit lives in its own study module.
import { auditMesh, geometricDiagnostic, shoelaceBoundary } from './phase20kHybridArcPairAudit';
export { auditMesh, geometricDiagnostic, shoelaceBoundary };
export type { GeometricDiagnostic, TopologyAudit } from './phase20kHybridArcPairAudit';

// §30 corpus.

export interface CorpusRow {
  id: string;
  category: string;
  order: string;
  model: string;
  criteria: string[];
  tolerance?: number;
  closed?: boolean;
  expected: string;
  actual: string;
  match: boolean;
  tieCount: number;
  rootCounts: number[];
  meshValid: boolean | null;
  auditPass: boolean | null;
  vertices?: number;
  triangles?: number;
  planArea?: number;
  area3d?: number;
  boundaryEdges?: number;
  components?: number;
  meshDigest?: string;
  detail?: string;
  digest: string;
}

const row = (partial: Omit<CorpusRow, 'digest'> & { digest?: string }): CorpusRow => {
  const { digest: injected, ...rest } = partial;
  return { ...rest, digest: injected ?? digest({ ...rest }) };
};

const CASES: CorpusRow[] = [];

const groupExpected = 'EXACT_TIE';
const recordGroup = (
  id: string,
  category: string,
  input: HybridArcGroupInput,
  expected: string,
): HybridArcGroupOutcome => {
  const out = assembleHybridArcGroup(input);
  const jointCount = input.closed ? input.members.length : input.members.length - 1;
  if (!out.ok) {
    const actual = `${out.code}/${out.detail}`;
    CASES.push(row({
      id, category, order: input.closed ? 'closed' : 'open',
      model: input.models[0]!, criteria: input.criteria.map((c) => JSON.stringify(c)),
      tolerance: input.curveChordTolerance, closed: input.closed,
      expected, actual, match: actual.includes(expected) || expected === out.code,
      tieCount: 0, rootCounts: [], meshValid: false, auditPass: null,
      detail: out.detail,
    }));
    return out;
  }
  const audit = auditMesh(out.mesh, out.daylight, input.closed, out.planArea);
  const shell = input.closed ? shoelaceBoundary(out.daylight) : null;
  // Open groups: index-vs-geometric seam picture (diagnostic-only, §20K.1).
  const complete = out.corners.length === jointCount && out.corners.length > 0;
  const actual = complete ? groupExpected : 'PARTIAL';
  const isExact = expected === groupExpected;
  const notBuildable = expected === 'EXACT_TIE_NOT_BUILDABLE';
  const match = isExact
    ? (complete && audit.pass)
    : notBuildable
      ? (complete && !audit.pass)
      : (actual.includes(expected) || expected === 'PARTIAL');
  CASES.push(row({
    id, category, order: input.closed ? 'closed' : 'open',
    model: input.models[0]!, criteria: input.criteria.map((c) => JSON.stringify(c)),
    tolerance: input.curveChordTolerance, closed: input.closed,
    expected, actual,
    match,
    tieCount: out.corners.length,
    rootCounts: out.rootCounts,
    meshValid: true, auditPass: audit.pass,
    vertices: out.mesh.points.length / 3, triangles: out.mesh.triangles.length / 3,
    planArea: out.planArea, area3d: out.area3d,
    boundaryEdges: audit.boundaryEdges, components: audit.components,
    meshDigest: out.meshDigest,
    ...(input.closed && shell !== null ? { detail: `shoelace=${shell.toFixed(9)} edgeComponents=${audit.edgeComponents}` } : {}),
    ...(!input.closed ? { detail: geometricDiagnostic(out.mesh).summary } : {}),
    digest: out.digest,
  }));
  return out;
};

// ---------------------------------------------------------------------------
// Fallback: production all-analytic control (arc×arc A↔A is allowed).

export interface ControlResult {
  ok: boolean;
  code?: string;
  detail?: string;
  digest?: string;
  planArea?: number;
  area3d?: number;
  points?: number[];
  triangles?: number[];
  daylight?: number[];
  tieCount?: number;
  ties?: Array<[number, number, number]>;
}

export const productionControl = (
  members: ArcMember[],
  criteria: GradingCriterion[],
  _model: ArcTangentModel,
  tolerance = 0.1,
  target?: GradingTargetMeshSnapshot,
): ControlResult => {
  const out: GradingGroupComputeOutcome = computeGradingGroupFromSnapshots({
    groupId: 'phase20k-control', revision: 'study',
    members: members.map((m) => m.source),
    side: 'right', criterion: criteria[0]!, memberCriteria: criteria,
    maxSearchDistance: 100, curveChordTolerance: tolerance,
    closed: true, ...(target ? { target } : {}),
  });
  if (!out.ok) return { ok: false, code: out.code, detail: out.detail };
  const r = out.result;
  return {
    ok: true,
    digest: digest(canonicalTriangles(r.gradingMesh.points, r.gradingMesh.triangles)),
    planArea: r.gradingPlanArea, area3d: r.grading3dArea,
    points: r.gradingMesh.points, triangles: r.gradingMesh.triangles, daylight: r.daylightPoints,
    tieCount: r.corners.length,
    ties: r.corners.map((c) => c.tiePointXyz) as Array<[number, number, number]>,
  };
};

// ---------------------------------------------------------------------------
// Scenario builders (§26 open pair, §27 rounded square, §28 mismatch).

export const openPairScenarios = (): void => {
  const [bottom, right] = primaryArcPair(10);
  for (const tol of [25, 10, 0.1, 0.01]) {
    for (const model of ['chord', 'true-tangent'] as ArcTangentModel[]) {
      const id = `open.pair.tol-${tol}.${model}`;
      recordGroup(id, 'open-pair', {
        members: [bottom, right],
        criteria: [FIXED(-0.5), DIST(-0.5, 20)],
        models: [model, model],
        side: 'right', maxSearchDistance: 100, curveChordTolerance: tol,
        closed: false, target: flatTin(0),
      }, 'EXACT_TIE_NOT_BUILDABLE');
    }
  }
};

export const roundedSquareScenarios = (): { hybrid?: HybridArcGroupResult; control?: ControlResult } => {
  const members = roundedSquareMembers(10);
  const hybridCriteria = [FIXED(-0.5), DIST(-0.5, 20), FIXED(-0.5), REL(-0.5, -10)];
  const tol = 0.1;
  const model: ArcTangentModel = 'chord';
  const hybrid = recordGroup('closed.square.hybrid', 'rounded-square', {
    members, criteria: hybridCriteria, models: [model, model, model, model],
    side: 'right', maxSearchDistance: 100, curveChordTolerance: tol,
    closed: true, target: flatTin(0),
    // 4 exact ties but edgeComponents=8 (vertex pinch) ⇒ NOT buildable.
  }, 'EXACT_TIE_NOT_BUILDABLE');
  // Spec-literal centre/sweep (inward-bulging arcs) — the outward grading
  // offset self-intersects; record both the study assembler and the
  // production all-distance control failing in the same way.
  const literal = literalConcaveMembers(10);
  recordGroup('closed.square.literal-concave', 'rounded-square-spec-literal', {
    members: literal, criteria: hybridCriteria, models: [model, model, model, model],
    side: 'right', maxSearchDistance: 100, curveChordTolerance: tol,
    closed: true, target: flatTin(0),
  }, 'GROUP_SELF_INTERSECTION');
  const literalDist = productionControl(literal, [DIST(-0.5, 20), DIST(-0.5, 20), DIST(-0.5, 20), DIST(-0.5, 20)], model, tol);
  CASES.push(row({
    id: 'closed.square.literal-concave.all-distance', category: 'rounded-square-spec-literal', order: 'closed',
    model, criteria: ['DIST(-0.5,20) x4'], tolerance: tol, closed: true,
    expected: 'GROUP_SELF_INTERSECTION', actual: literalDist.ok ? 'ok' : `${literalDist.code}/${literalDist.detail}`,
    match: !literalDist.ok && literalDist.code === 'GROUP_SELF_INTERSECTION',
    tieCount: literalDist.tieCount ?? 0, rootCounts: [], meshValid: literalDist.ok, auditPass: null,
    detail: literalDist.detail, digest: literalDist.digest ?? '',
  }));
  // all-Surface control (surface-only ⇒ production path, no hybrid guard).
  const allCriteria = [FIXED(-0.5), FIXED(-0.5), FIXED(-0.5), FIXED(-0.5)];
  const surf = productionControl(members, allCriteria, model, tol, flatTin(0));
  CASES.push(row({
    id: 'closed.square.control.all-surface', category: 'rounded-square-control', order: 'closed',
    model, criteria: allCriteria.map((c) => JSON.stringify(c)), tolerance: tol, closed: true,
    expected: 'CORNER_NO_SOLUTION', actual: surf.ok ? 'ok' : `${surf.code}/${surf.detail}`,
    match: !surf.ok && surf.code === 'CORNER_NO_SOLUTION',
    tieCount: surf.tieCount ?? 0, rootCounts: [], meshValid: surf.ok, auditPass: null,
    planArea: surf.planArea, detail: surf.detail, digest: surf.digest ?? '',
  }));
  // all-Distance control — on a flat target every member is the same 20 m
  // outward offset at grade −0.5, so it must match the hybrid geometry.
  const distCriteria = [DIST(-0.5, 20), DIST(-0.5, 20), DIST(-0.5, 20), DIST(-0.5, 20)];
  const dist = productionControl(members, distCriteria, model, tol);
  CASES.push(row({
    id: 'closed.square.control.all-distance', category: 'rounded-square-control', order: 'closed',
    model, criteria: distCriteria.map((c) => JSON.stringify(c)), tolerance: tol, closed: true,
    expected: 'ok', actual: dist.ok ? 'ok' : `${dist.code}/${dist.detail}`, match: dist.ok,
    tieCount: dist.tieCount ?? 0, rootCounts: [], meshValid: dist.ok, auditPass: null,
    planArea: dist.planArea, detail: dist.digest, digest: dist.digest ?? '',
  }));
  // mixed-analytic control (D/E/REL share one analytic domain).
  const mixedCriteria = [DIST(-0.5, 20), ELEV(-0.5, 0), REL(-0.5, -10), DIST(-0.5, 20)];
  const mixed = productionControl(members, mixedCriteria, model, tol);
  CASES.push(row({
    id: 'closed.square.control.mixed-analytic', category: 'rounded-square-control', order: 'closed',
    model, criteria: mixedCriteria.map((c) => JSON.stringify(c)), tolerance: tol, closed: true,
    expected: 'ok', actual: mixed.ok ? 'ok' : `${mixed.code}/${mixed.detail}`, match: mixed.ok,
    tieCount: mixed.tieCount ?? 0, rootCounts: [], meshValid: mixed.ok, auditPass: null,
    planArea: mixed.planArea, detail: mixed.digest, digest: mixed.digest ?? '',
  }));
  return hybrid.ok ? { hybrid, control: dist } : { control: dist };
};

export const mismatchScenarios = (): void => {
  const members = roundedSquareMembers(10);
  const tol = 0.1;
  const model: ArcTangentModel = 'chord';
  // Member 1 (distance) off by +4 m and the relative member off by −2 m:
  // every adjacent hybrid joint must fail closed, no partial ring.
  recordGroup('closed.square.mismatch.d24', 'rounded-square-mismatch', {
    members, criteria: [FIXED(-0.5), DIST(-0.5, 24), FIXED(-0.5), REL(-0.5, -10)],
    models: [model, model, model, model],
    side: 'right', maxSearchDistance: 100, curveChordTolerance: tol,
    closed: true, target: flatTin(0),
  }, 'TRANSITION_REQUIRED');
  recordGroup('closed.square.mismatch.dz-12', 'rounded-square-mismatch', {
    members, criteria: [FIXED(-0.5), DIST(-0.5, 20), FIXED(-0.5), REL(-0.5, -12)],
    models: [model, model, model, model],
    side: 'right', maxSearchDistance: 100, curveChordTolerance: tol,
    closed: true, target: flatTin(0),
  }, 'TRANSITION_REQUIRED');
};

/** §30 corner-level categories over the primary arc pair (open, GAP). */
export const cornerScenarios = (): void => {
  const [bottom, right] = primaryArcPair(10);
  const base = {
    members: [bottom, right],
    models: ['chord', 'chord'] as ArcTangentModel[],
    side: 'right' as GradingSide,
    maxSearchDistance: 100, curveChordTolerance: 0.1,
    closed: false, target: flatTin(0),
  };
  const exact = 'EXACT_TIE_NOT_BUILDABLE';
  // Method variants: distance / elevation / relative all resolve the tie.
  recordGroup('corner.distance', 'analytic-variant', { ...base, criteria: [FIXED(-0.5), DIST(-0.5, 20)] }, exact);
  recordGroup('corner.elevation', 'analytic-variant', { ...base, criteria: [FIXED(-0.5), ELEV(-0.5, 0)] }, exact);
  recordGroup('corner.relative', 'analytic-variant', { ...base, criteria: [FIXED(-0.5), REL(-0.5, -10)] }, exact);
  // Order reversal: analytic incoming + surface outgoing.
  recordGroup('corner.reversed', 'order-reversal', {
    ...base, members: [reverseArcMember(right), reverseArcMember(bottom)],
    criteria: [DIST(-0.5, 20), FIXED(-0.5)],
  }, exact);
  // CUT (target above source, upward grade) and FILL (default target below).
  recordGroup('corner.cut', 'cut-fill', { ...base, criteria: [FIXED(0.5), DIST(0.5, 20)], target: flatTin(20) }, exact);
  recordGroup('corner.fill', 'cut-fill', { ...base, criteria: [FIXED(-0.5), DIST(-0.5, 20)] }, exact);
  // Tied at V: target elevation equals the source vertex (root at t=0).
  recordGroup('corner.tied-at-V', 'tied-at-V', { ...base, criteria: [FIXED(-0.5), DIST(-0.5, 20)], target: flatTin(10) }, 'TRANSITION_REQUIRED');
  // Target gap: TIN far from the joint.
  recordGroup('corner.target-gap', 'target-gap', {
    ...base,
    criteria: [FIXED(-0.5), DIST(-0.5, 20)],
    target: { points: [500, 500, 0, 900, 500, 0, 900, 900, 0, 500, 900, 0], triangles: [0, 1, 2, 0, 2, 3] },
  }, 'MEMBER_NO_SOLUTION');
  // Joint Z discontinuity: same XY, different Z ⇒ production exactXyz refuses.
  const zOff = {
    ...bottom,
    end: { x: bottom.end.x, y: bottom.end.y, z: 11 },
    source: { ...bottom.source, endZ: 11 },
  };
  recordGroup('corner.same-xy-diff-z', 'joint-z', {
    ...base, members: [zOff, right], criteria: [FIXED(-0.5), DIST(-0.5, 20)],
  }, 'GRADING_GROUP_CORNER_MISMATCH');
  // Bad chord tolerance (arc cannot linearize).
  recordGroup('corner.bad-tolerance', 'degenerate', {
    ...base, criteria: [FIXED(-0.5), DIST(-0.5, 20)], curveChordTolerance: 0,
  }, 'GRADING_ARC_LINEARIZE');
  // Search bound below the 20 m daylight ⇒ fail closed, no clamp.
  recordGroup('corner.max-search', 'max-search', {
    ...base, criteria: [FIXED(-0.5), DIST(-0.5, 20)], maxSearchDistance: 5,
  }, 'MEMBER_NO_SOLUTION');
  // Sloped target: plane z = 0.05·x (still covers the joint); exact tie.
  const slopedTin: GradingTargetMeshSnapshot = {
    points: [-400, -400, -20, 400, -400, 20, 400, 400, 20, -400, 400, -20],
    triangles: [0, 1, 2, 0, 2, 3],
  };
  recordGroup('corner.sloped-target', 'sloped-target', {
    ...base, criteria: [FIXED(-0.5), DIST(-0.5, 20)], target: slopedTin,
  }, 'GRADING_DAYLIGHT_DISAGREE');
  // Triangulation permutation of the flat target: identical tie expected.
  const spun = flatTin(0);
  const altTin: GradingTargetMeshSnapshot = { points: spun.points, triangles: [0, 1, 3, 1, 2, 3] };
  recordGroup('corner.alt-triangulation', 'triangulation', {
    ...base, criteria: [FIXED(-0.5), DIST(-0.5, 20)], target: altTin,
  }, exact);
  // Distance mismatch ladder about the exact 20 m offset.
  for (const step of [0, 1e-9, 1e-6, 1e-3, 1e-1, 1, 4]) {
    recordGroup(`corner.mismatch-ladder-${step}`, 'mismatch-ladder', {
      ...base, criteria: [FIXED(-0.5), DIST(-0.5, 20 + step)],
    }, step === 0 ? exact : 'TRANSITION_REQUIRED');
  }
  // Radius ladder: honest endpoint-anchored arcs (cy=sqrt(R²−50²)) keep the
  // tie exact. The joint uses the arc's natural end; the outgoing member is
  // rigidly anchored there (sub-fp shift), never a radius-distorting override.
  for (const radius of [500, 252.5, 120]) {
    const arc = anchoredRadiusArc(radius);
    if (!arc) continue;
    const out = translateArcMember(right, arc.end.x - SQUARE_SIDE, arc.end.y);
    recordGroup(`corner.radius-${radius}`, 'radius-sweep', {
      ...base, members: [arc, out], criteria: [FIXED(-0.5), DIST(-0.5, 20)],
    }, exact);
  }
};

export interface CorpusPayload {
  generated: string;
  rows: CorpusRow[];
  summary: {
    total: number;
    matched: number;
    mismatched: Array<{ id: string; expected: string; actual: string; detail?: string }>;
    digests: number;
    comparison: ControlComparison | null;
  };
}

export interface ControlComparison {
  available: boolean;
  planAreaEqual: boolean;
  meshSetEqual: boolean;
  tiePointsEqual: boolean;
  digestEqual: boolean;
  hybridTriangles: number;
  controlTriangles: number;
  maxTieDelta: number | null;
  detail: string;
}

/**
 * §27 control comparison. Compares the hybrid rounded square against the
 * production all-distance control where the flat-target semantics coincide:
 * tie points, canonical triangle set, plan area, and the canonical mesh
 * digest. Daylight point ordering/count may differ because the analytic
 * corner run inserts sector-path vertices — recorded honestly in `detail`.
 */
export const compareHybridToControl = (
  hybrid: HybridArcGroupResult,
  control: ControlResult,
): ControlComparison => {
  if (!control.ok || !control.points || !control.triangles) {
    return {
      available: false, planAreaEqual: false, meshSetEqual: false, tiePointsEqual: false,
      digestEqual: false, hybridTriangles: hybrid.mesh.triangles.length / 3,
      controlTriangles: 0, maxTieDelta: null, detail: control.detail ?? 'control unavailable',
    };
  }
  const hs = canonicalTriangles(hybrid.mesh.points, hybrid.mesh.triangles);
  const cs = canonicalTriangles(control.points, control.triangles);
  const meshSetEqual = hs.length === cs.length && hs.every((v, i) => v === cs[i]);
  const planAreaEqual = Math.abs(hybrid.planArea - (control.planArea ?? 0)) <= 1e-6 * Math.max(1, hybrid.planArea);
  let maxTieDelta: number | null = null;
  let tiePointsEqual = control.ties !== undefined && hybrid.corners.length === control.ties.length;
  if (control.ties && hybrid.corners.length === control.ties.length) {
    for (let i = 0; i < hybrid.corners.length; i += 1) {
      const t = hybrid.corners[i]!.tie;
      const c = control.ties[i]!;
      const d = Math.max(Math.abs(t[0] - c[0]), Math.abs(t[1] - c[1]), Math.abs(t[2] - c[2]));
      maxTieDelta = maxTieDelta === null ? d : Math.max(maxTieDelta, d);
      if (d > 1e-9) tiePointsEqual = false;
    }
  }
  return {
    available: true, planAreaEqual, meshSetEqual, tiePointsEqual,
    digestEqual: hybrid.meshDigest === control.digest,
    hybridTriangles: hs.length, controlTriangles: cs.length, maxTieDelta,
    detail: `hybridDigest=${hybrid.meshDigest} controlDigest=${control.digest}`,
  };
};

export const buildCorpus = (): CorpusPayload => {
  CASES.length = 0;
  openPairScenarios();
  const square = roundedSquareScenarios();
  mismatchScenarios();
  cornerScenarios();
  const mismatched = CASES.filter((r) => !r.match).map((r) => ({ id: r.id, expected: r.expected, actual: r.actual, ...(r.detail ? { detail: r.detail } : {}) }));
  const successDigests = new Set(CASES.filter((r) => r.meshValid && r.match).map((r) => r.digest));
  const comparison = square.hybrid && square.control ? compareHybridToControl(square.hybrid, square.control) : null;
  return {
    generated: 'phase20k-hybrid-arc-pair-groups',
    rows: CASES,
    summary: { total: CASES.length, matched: CASES.length - mismatched.length, mismatched, digests: successDigests.size, comparison },
  };
};

export const writeCorpus = (): CorpusPayload => {
  const payload = buildCorpus();
  const out = OUT_OVERRIDE ?? OUT;
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`phase20k corpus: ${payload.rows.length} rows, ${payload.summary.mismatched.length} mismatches → ${out}`);
  for (const m of payload.summary.mismatched) console.log(`  MISMATCH ${m.id}: expected ${m.expected}, got ${m.actual} ${m.detail ?? ''}`);
  return payload;
};

// Direct invocation guard (tsx).
const invokedDirectly = process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].split('/').pop()!);
if (invokedDirectly) writeCorpus();
