/**
 * Phase 20I — surface×analytic corner feasibility corpus runner (MEASUREMENT ONLY).
 *
 * Runs the pure study core (`phase20iSurfaceAnalyticCornerCore`) over the
 * hand-derived oracle matrix and writes `docs/evidence/phase20i/corpus.json`.
 * Every row carries case id, member order, criteria, source frames, target
 * digest, expected/actual outcome, ties, gaps, root count, extent, mesh-valid
 * flag, and digest. Deliberately-coordinated exact cases (`exact.*`) and
 * perturbed mismatches (`mismatch.*`) live in separate namespaces.
 *
 * Production comparisons (oracle 16 controls, oracle 18 freeze) call the
 * real engine seams directly; nothing is extrapolated.
 *
 * Usage: `npx tsx scripts/phase20iSurfaceAnalyticCornerStudy.ts`
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';
import { gradingSideNormal } from '../src/engine/cad/grading/gradingCourseFrame';
import type { GradingTargetMeshSnapshot } from '../src/engine/cad/grading/gradingComputeTypes';
import type {
  GradingCriterion,
  GradingSide,
  ResolvedGradingSource,
} from '../src/engine/cad/grading/gradingTypes';
import {
  intersectAnalyticPair,
  resolveSurfaceAnalyticCorner,
  studyRayTie,
  type SurfaceAnalyticCornerInput,
  type SurfaceAnalyticOutcome,
} from './phase20iSurfaceAnalyticCornerCore';
import { gradingPlaneGradient } from '../src/engine/cad/grading/gradingCornerMath';

const OUT = join(dirname(process.argv[1] ?? '.'), '..', 'docs', 'evidence', 'phase20i', 'corpus.json');

const digest = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

const FIXED = (g: number): GradingCriterion => ({ kind: 'fixed', gradeRatio: g });
const CUTFILL = (c: number, f: number): GradingCriterion =>
  ({ kind: 'cut-fill', cutGradeRatio: c, fillGradeRatio: f });
const DIST = (g: number, d: number): GradingCriterion => ({ kind: 'distance', gradeRatio: g, distance: d });
const ELEV = (g: number, e: number): GradingCriterion => ({ kind: 'elevation', gradeRatio: g, targetElevation: e });
const REL = (g: number, dz: number): GradingCriterion => ({ kind: 'relative-elevation', gradeRatio: g, relativeElevation: dz });

const M = (sx: number, sy: number, sz: number, ex: number, ey: number, ez: number): ResolvedGradingSource => ({
  startX: sx, startY: sy, endX: ex, endY: ey, startZ: sz, endZ: ez,
  length: Math.hypot(ex - sx, ey - sy), reoriented: false, isArc: false,
});

/**
 * Broad explicit TIN over a flat elevation (CCW pair), spun 10° about the
 * origin. The plane (z=const) is rotation-invariant, so every hand-derived
 * tie is unchanged; the spin keeps all study rays transverse to every edge
 * (axis-parallel rays on axis-aligned triangulations hit the production
 * interval fail-closed quirk documented by record.quirk-*).
 */
const flatTin = (z: number, half = 200): GradingTargetMeshSnapshot => rotTinInner(z, 10, half);
const rotTinInner = (z: number, deg: number, half: number): GradingTargetMeshSnapshot => {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const pts: Array<[number, number]> = [[-half, -half], [half, -half], [half, half], [-half, half]];
  return {
    points: pts.flatMap(([x, y]) => [x * c - y * s, x * s + y * c, z]),
    triangles: [0, 1, 2, 0, 2, 3],
  };
};

/** Alternate diagonal of the same spun quad (permutation control). */
const flatTinAlt = (z: number, half = 200): GradingTargetMeshSnapshot => {
  const base = rotTinInner(z, 10, half);
  return { points: base.points, triangles: [0, 1, 3, 1, 2, 3] };
};
/** Axis-aligned quad for the quirk probe only (production behavior sample). */
const axisTin = (z: number, half = 200): GradingTargetMeshSnapshot => ({
  points: [-half, -half, z, half, -half, z, half, half, z, -half, half, z],
  triangles: [0, 1, 2, 0, 2, 3],
});

const targetDigest = (t: GradingTargetMeshSnapshot): string => digest(t);

interface Row {
  id: string;
  order: string;
  criteria: string[];
  frames: string;
  targetDigest: string;
  expected: string;
  actual: string;
  match: boolean;
  surfaceTie: number[] | null;
  analyticTie: number[] | null;
  xyGap: number | null;
  zGap: number | null;
  rootCount: number;
  extent: number | null;
  meshValid: boolean | null;
  turn: string | null;
  detail?: string;
  digest: string;
}

const rows: Row[] = [];

const frameOf = (m: ResolvedGradingSource, side: GradingSide): string => {
  const dx = m.endX - m.startX;
  const dy = m.endY - m.startY;
  const len = Math.hypot(dx, dy);
  const n = gradingSideNormal(dx / len, dy / len, side);
  return `T=(${(dx / len).toFixed(4)},${(dy / len).toFixed(4)}) N=(${n?.nx.toFixed(4)},${n?.ny.toFixed(4)}) gs=${((m.endZ - m.startZ) / m.length).toFixed(4)}`;
};

const run = (
  id: string,
  input: SurfaceAnalyticCornerInput,
  expected: SurfaceAnalyticOutcome,
  order: string,
): ReturnType<typeof resolveSurfaceAnalyticCorner> => {
  const got = resolveSurfaceAnalyticCorner(input);
  const crit = [JSON.stringify(input.surfaceCriterion), JSON.stringify(input.analyticCriterion)];
  const row: Row = {
    id,
    order,
    criteria: crit,
    frames: `${frameOf(input.surfaceMember, input.side)} | ${frameOf(input.analyticMember, input.side)}`,
    targetDigest: targetDigest(input.target),
    expected,
    actual: got.outcome,
    match: got.outcome === expected,
    surfaceTie: got.surfaceTie ? [got.surfaceTie.x, got.surfaceTie.y, got.surfaceTie.z] : null,
    analyticTie: got.analyticTie ? [got.analyticTie.x, got.analyticTie.y, got.analyticTie.z] : null,
    xyGap: got.xyGap,
    zGap: got.zGap,
    rootCount: got.rootCount,
    extent: got.extent,
    meshValid: got.mesh ? got.mesh.valid : null,
    turn: got.turn,
    ...(got.detail ? { detail: got.detail } : {}),
    digest: '',
  };
  row.digest = digest({ ...row, digest: undefined });
  rows.push(row);
  return got;
};

// ---------------------------------------------------------------------------
// §18 primary oracle: V=(0,0,100), surface incoming, analytic outgoing.
const SIN = M(-60, 0, 100, 0, 0, 100);
const AOUT = M(0, 0, 100, 0, 60, 100);
const SURF = FIXED(-0.5);
const ANAL = REL(-0.25, -10);
const T90 = flatTin(90);

const exactInput = (
  surfaceCriterion = SURF, analyticCriterion = ANAL, target = T90, buildMesh = true,
): SurfaceAnalyticCornerInput => ({
  vx: 0, vy: 0, vz: 100,
  surfaceMember: SIN, surfaceIncoming: true,
  analyticMember: AOUT, analyticIncoming: false,
  side: 'right', surfaceCriterion, analyticCriterion,
  maxSearchDistance: 100, target, buildMesh,
});

run('exact.primary', exactInput(), 'EXACT_COMMON_TIE', 'surface-incoming/analytic-outgoing');

// Reverse order: analytic incoming + surface outgoing, mirrored frames.
const AIN = M(0, -60, 100, 0, 0, 100);
const SOUT = M(0, 0, 100, -60, 0, 100);
run('exact.reversed', {
  vx: 0, vy: 0, vz: 100,
  surfaceMember: SOUT, surfaceIncoming: false,
  analyticMember: AIN, analyticIncoming: true,
  side: 'right', surfaceCriterion: SURF, analyticCriterion: ANAL,
  maxSearchDistance: 100, target: T90, buildMesh: true,
}, 'EXACT_COMMON_TIE', 'analytic-incoming/surface-outgoing');

// Method variants: Distance / Absolute Elevation / Relative → same tie.
run('exact.distance', exactInput(SURF, DIST(-0.25, 40)), 'EXACT_COMMON_TIE', 'surface-incoming/analytic-outgoing');
run('exact.elevation', exactInput(SURF, ELEV(-0.25, 90)), 'EXACT_COMMON_TIE', 'surface-incoming/analytic-outgoing');
// Upward mirror: +grades, target 110 → tie (40,-20,110).
run('exact.mirror-up', {
  ...exactInput(FIXED(0.5), REL(0.25, 10), flatTin(110)),
}, 'EXACT_COMMON_TIE', 'surface-incoming/analytic-outgoing');

// Mismatches: target z=92; analytic Δ=-12 (d=48, Z=88).
run('mismatch.target-92', exactInput(SURF, ANAL, flatTin(92)), 'TRANSITION_REQUIRED', 'surface-incoming/analytic-outgoing');
run('mismatch.analytic-d12', exactInput(SURF, REL(-0.25, -12)), 'TRANSITION_REQUIRED', 'surface-incoming/analytic-outgoing');
// Reversed mismatch (target 92, reverse order).
run('mismatch.target-92-reversed', {
  vx: 0, vy: 0, vz: 100,
  surfaceMember: SOUT, surfaceIncoming: false,
  analyticMember: AIN, analyticIncoming: true,
  side: 'right', surfaceCriterion: SURF, analyticCriterion: ANAL,
  maxSearchDistance: 100, target: flatTin(92),
}, 'TRANSITION_REQUIRED', 'analytic-incoming/surface-outgoing');

// Joint-Z discontinuity: production `exactXyz` fails closed on any Z split,
// so the study gates BEFORE plane construction (SOURCE_JOINT_MISMATCH).
// Analytic joint Z 101 vs vz 100 previously built both planes through vz
// and reported EXACT_COMMON_TIE on fabricated geometry (Qa held 90).
run('fail.joint-z-analytic-off', {
  ...exactInput(),
  analyticMember: M(0, 0, 101, 0, 60, 101),
}, 'SOURCE_JOINT_MISMATCH', 'surface-incoming/analytic-outgoing');
run('fail.joint-z-analytic-off-reversed', {
  vx: 0, vy: 0, vz: 100,
  surfaceMember: M(0, 0, 101, -60, 0, 101), surfaceIncoming: false,
  analyticMember: AIN, analyticIncoming: true,
  side: 'right', surfaceCriterion: SURF, analyticCriterion: ANAL,
  maxSearchDistance: 100, target: T90,
}, 'SOURCE_JOINT_MISMATCH', 'analytic-incoming/surface-outgoing');
// CUT exact (cut-fill, target above source) + FILL exact (cut-fill, target below).
run('exact.cut', {
  ...exactInput(CUTFILL(0.5, 0.25), REL(0.25, 10), flatTin(110)),
}, 'EXACT_COMMON_TIE', 'surface-incoming/analytic-outgoing');
run('exact.fill', {
  ...exactInput(CUTFILL(-0.25, -0.5), ANAL, T90),
}, 'EXACT_COMMON_TIE', 'surface-incoming/analytic-outgoing');
// Target gap at V: TIN far from the joint.
run('fail.gap-at-V', exactInput(SURF, ANAL, {
  points: [500, 500, 90, 700, 500, 90, 700, 700, 90, 500, 700, 90],
  triangles: [0, 1, 2, 0, 2, 3],
}), 'SURFACE_TARGET_GAP', 'surface-incoming/analytic-outgoing');
// Tied at V: target == source elevation (existing behavior record).
run('record.tied-at-V', exactInput(SURF, ANAL, flatTin(100)), 'TRANSITION_REQUIRED', 'surface-incoming/analytic-outgoing');
// Triangulation permutation of the flat target: identical tie expected.
run('exact.target-alt-triangulation', exactInput(SURF, ANAL, flatTinAlt(90)), 'EXACT_COMMON_TIE', 'surface-incoming/analytic-outgoing');

// Sloped target z=90+0.05(x-40)+0.02(y+20), two triangulations. Vertices
// are spun 10° about the tie (40,-20) so every edge cuts the study rays
// transversely; the plane still pins the tie, so both triangulations agree.
const slopedTin = (alt: boolean): GradingTargetMeshSnapshot => {
  const z = (x: number, y: number): number => 90 + 0.05 * (x - 40) + 0.02 * (y + 20);
  const h = 260;
  const a = (10 * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const pts: Array<[number, number]> = [[-h, -h], [h, -h], [h, h], [-h, h]];
  return {
    points: pts.flatMap(([x, y]) => {
      const rx = 40 + (x - 40) * c - (y + 20) * s;
      const ry = -20 + (x - 40) * s + (y + 20) * c;
      return [rx, ry, z(rx, ry)];
    }),
    triangles: alt ? [0, 1, 3, 1, 2, 3] : [0, 1, 2, 0, 2, 3],
  };
};
// NOTE: z() is evaluated at the ROTATED vertex (rx,ry), so the mesh plane
// is the rotated slope (still pinned at the tie). Hand check at the tie:
// the rotated quad still covers the seam ray segment [0, tTie] and V.
run('exact.sloped-target', exactInput(SURF, ANAL, slopedTin(false)), 'EXACT_COMMON_TIE', 'surface-incoming/analytic-outgoing');
run('exact.sloped-target-alt', exactInput(SURF, ANAL, slopedTin(true)), 'EXACT_COMMON_TIE', 'surface-incoming/analytic-outgoing');

// Sloped source: gs=0.1 incoming; exact tie shifts to (40,-28,90).
const SIN_SLOPE = M(-60, 0, 94, 0, 0, 100);
run('exact.sloped-source', {
  ...exactInput(), surfaceMember: SIN_SLOPE,
}, 'EXACT_COMMON_TIE', 'surface-incoming/analytic-outgoing');
run('mismatch.sloped-source-z', {
  ...exactInput(SURF, ANAL, flatTin(92)), surfaceMember: SIN_SLOPE,
}, 'TRANSITION_REQUIRED', 'surface-incoming/analytic-outgoing');

// Arc-adjacent ladder: last chord of an N-chord circular-arc sampling.
// Arc A=(-60,0)→V=(0,0), R=100, center (-30,95.394...), frames converge.
const arcLadderMember = (n: number): ResolvedGradingSource => {
  const cx = -30;
  const cy = Math.sqrt(100 * 100 - 30 * 30);
  const aA = Math.atan2(0 - cy, -60 - cx);
  const aV = Math.atan2(0 - cy, 0 - cx);
  const lo = Math.min(aA, aV);
  const hi = Math.max(aA, aV);
  const p = (k: number): [number, number] => {
    const a = lo + ((hi - lo) * k) / n;
    return [cx + 100 * Math.cos(a), cy + 100 * Math.sin(a)];
  };
  const [px, py] = p(n - 1);
  return M(px, py, 100, 0, 0, 100);
};
for (const [label, n] of [['coarse', 1], ['medium', 4], ['fine', 16]] as const) {
  run(`exact.arc-ladder-${label}`, {
    ...exactInput(), surfaceMember: arcLadderMember(n),
  }, 'EXACT_COMMON_TIE', 'surface-incoming/analytic-outgoing');
}
// Reverse: analytic incoming arc from the south + straight surface outgoing
// west. Arc A2=(0,-60)->V=(0,0), R=100, center (-95.39,-30); last chord of an
// N-sampled arc is the incoming member (frames converge to the true tangent).
const arcLadderReverseMember = (n: number): ResolvedGradingSource => {
  const cx = -Math.sqrt(100 * 100 - 30 * 30);
  const cy = -30;
  const aA = Math.atan2(-60 - cy, 0 - cx);
  const aV = Math.atan2(0 - cy, 0 - cx);
  const lo = Math.min(aA, aV);
  const hi = Math.max(aA, aV);
  const a = lo + ((hi - lo) * (n - 1)) / n;
  return M(cx + 100 * Math.cos(a), cy + 100 * Math.sin(a), 100, 0, 0, 100);
};
for (const [label, n] of [['coarse', 1], ['medium', 4], ['fine', 16]] as const) {
  run(`exact.arc-ladder-reverse-${label}`, {
    vx: 0, vy: 0, vz: 100,
    surfaceMember: SOUT, surfaceIncoming: false,
    analyticMember: arcLadderReverseMember(n), analyticIncoming: true,
    side: 'right', surfaceCriterion: SURF, analyticCriterion: ANAL,
    maxSearchDistance: 100, target: T90,
  }, 'EXACT_COMMON_TIE', 'analytic-incoming-arc/surface-outgoing');
}

// Target pathology: V-covering triangle + two disjoint same-plane patches
// (plane z=100+0.5y everywhere). Roots at V (t=0) + both patches; the
// surface keeps the nearest (V) while the analytic tie matches the far root
// → ROOT_POLICY_CONFLICT. Single tilted triangle through the tie (plane
// z=-0.2236y+85.528, one transverse root) → EXACT_COMMON_TIE.
// All patch triangles are CCW (the target query is orientation-sensitive).
const patchTin: GradingTargetMeshSnapshot = {
  points: [
    -5, 5, 102.5, 0, -5, 97.5, 5, 5, 102.5,
    16, -12, 94, 24, -12, 94, 20, -7, 96.5,
    38, -23, 88.5, 46, -19, 90.5, 36, -19, 90.5,
  ],
  triangles: [0, 1, 2, 3, 4, 5, 6, 7, 8],
};
run('record.two-roots-conflict', exactInput(SURF, ANAL, patchTin), 'ROOT_POLICY_CONFLICT', 'surface-incoming/analytic-outgoing');
// Tilted single-root plane: restriction to the seam ray is 90+0.1(t-tTie).
const tiltB = 0.1 / -0.4472135954999579;
const tiltC = 90 - 20 * tiltB;
// Tie-only record: the minimal triangle covers the tie but not the Qs
// site, so no fan mesh is requested (mesh compatibility is oracle 6's).
run('record.one-root', exactInput(SURF, ANAL, {
  points: [-15, 5, tiltB * 5 + tiltC, 40, -20, 90, 15, 5, tiltB * 5 + tiltC],
  triangles: [0, 1, 2],
}, false), 'EXACT_COMMON_TIE', 'surface-incoming/analytic-outgoing');
// No root, covered target (plane above the ray) → SURFACE_NO_ROOT.
run('fail.no-root', exactInput(SURF, ANAL, flatTin(120)), 'SURFACE_NO_ROOT', 'surface-incoming/analytic-outgoing');
// Degenerate triangle (collinear) only → fail closed.
run('fail.degenerate-triangle', exactInput(SURF, ANAL, {
  points: [0, 0, 90, 10, 0, 90, 20, 0, 90],
  triangles: [0, 1, 2],
}), 'SURFACE_TARGET_GAP', 'surface-incoming/analytic-outgoing');

// Degenerate / failure battery.
run('fail.non-finite-grade', exactInput({ kind: 'fixed', gradeRatio: NaN }, ANAL), 'NON_FINITE_INPUT', 'surface-incoming/analytic-outgoing');
run('fail.non-finite-target', exactInput(SURF, ANAL, {
  points: [-200, -200, NaN, 200, -200, 90, 200, 200, 90, -200, 200, 90],
  triangles: [0, 1, 2, 0, 2, 3],
}), 'NON_FINITE_INPUT', 'surface-incoming/analytic-outgoing');
run('fail.zero-length', {
  ...exactInput(), surfaceMember: M(0, 0, 100, 0, 0, 100),
}, 'PLANE_DEGENERATE', 'surface-incoming/analytic-outgoing');
// Collinear same-travel joint: planes differ only across the shared normal,
// so the miter direction is perpendicular to both half-planes → ambiguous
// ray → SIDE_REJECT (production selectMiterRay behaves identically).
run('record.collinear', {
  ...exactInput(), analyticMember: M(0, 0, 100, 60, 0, 100),
}, 'SIDE_REJECT', 'surface-incoming/analytic-outgoing');
// Coincident planes: identical collinear members + identical grades.
run('fail.coincident', {
  vx: 0, vy: 0, vz: 100,
  surfaceMember: SIN, surfaceIncoming: true,
  analyticMember: M(0, 0, 100, 60, 0, 100), analyticIncoming: false,
  side: 'right', surfaceCriterion: FIXED(-0.5), analyticCriterion: DIST(-0.5, 20),
  maxSearchDistance: 100, target: T90,
}, 'PLANE_DEGENERATE', 'surface-incoming/analytic-outgoing');
// U-turn → ambiguous/inverted ray → SIDE_REJECT.
run('fail.uturn-side', {
  ...exactInput(), analyticMember: M(0, 0, 100, -60, 0, 100),
}, 'SIDE_REJECT', 'surface-incoming/analytic-outgoing');
// Beyond search: z=105 tent over V (covers V, no root) + z=98.55 patch with
// an early root (t=6.485); the analytic tie at t=44.72 exceeds tMax=22.36.
// Reverse-order mirror (surface outgoing west + analytic incoming north).
const tentTin: GradingTargetMeshSnapshot = {
  points: [-5, 5, 105, 0, -5, 105, 5, 5, 105, 4, -4, 98.55, 8, -4, 98.55, 4, 0, 98.55],
  triangles: [0, 1, 2, 3, 4, 5],
}; // CCW throughout
run('fail.max-extent', {
  ...exactInput(SURF, ANAL, tentTin),
  maxSearchDistance: 20,
}, 'MAX_EXTENT_REJECT', 'surface-incoming/analytic-outgoing');
run('fail.max-extent-reversed', {
  vx: 0, vy: 0, vz: 100,
  surfaceMember: SOUT, surfaceIncoming: false,
  analyticMember: AIN, analyticIncoming: true,
  side: 'right', surfaceCriterion: SURF, analyticCriterion: ANAL,
  maxSearchDistance: 20,
  target: {
    points: [-5, -5, 105, 5, -5, 105, 0, 5, 105, 4, 4, 98.55, 4, 0, 98.55, 8, 4, 98.55],
    triangles: [0, 1, 2, 3, 4, 5],
  }, // CCW throughout
}, 'MAX_EXTENT_REJECT', 'analytic-incoming/surface-outgoing');
// Seam-parallel analytic line: flat surface plane (FIXED 0) gives a vertical
// seam ray while the analytic line runs vertically too. The target quad is
// rotated 10° so the V root avoids the production ray/edge-parallel
// fail-closed quirk (inside-parallel rays return no interval).
const rotTin = (z: number, deg: number, half = 200): GradingTargetMeshSnapshot => rotTinInner(z, deg, half);
run('fail.seam-parallel', {
  vx: 0, vy: 0, vz: 100,
  surfaceMember: SIN, surfaceIncoming: true,
  analyticMember: M(0, 0, 100, 0, 60, 100), analyticIncoming: false,
  side: 'right', surfaceCriterion: FIXED(0), analyticCriterion: DIST(-0.25, 40),
  maxSearchDistance: 100, target: rotTin(100, 10),
}, 'ANALYTIC_SEAM_PARALLEL', 'surface-incoming/analytic-outgoing');
// Tie-behind-V search: side-consistent inputs cannot place the analytic
// crossing behind V (the selected ray stays in both half-planes while the
// terminal origin steps forward along its normal), so the guard is
// defense-in-depth. Exhaustive direction x order x criterion grid records it.
const behindGrid = (): { total: number; behind: number; outcomes: Record<string, number> } => {
  const dirs: Array<[number, number]> = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  const flat: GradingTargetMeshSnapshot = flatTin(90);
  const crits: GradingCriterion[] = [DIST(-0.25, 40), ELEV(-0.25, 90), REL(-0.25, -10)];
  const outcomes: Record<string, number> = {};
  let total = 0;
  let behind = 0;
  for (const [sx, sy] of dirs) for (const [ax, ay] of dirs) {
    for (const sIn of [true, false]) for (const aIn of [true, false]) for (const ac of crits) {
      const sm = sIn ? M(-sx * 60, -sy * 60, 100, 0, 0, 100) : M(0, 0, 100, sx * 60, sy * 60, 100);
      const am = aIn ? M(-ax * 60, -ay * 60, 100, 0, 0, 100) : M(0, 0, 100, ax * 60, ay * 60, 100);
      const got = resolveSurfaceAnalyticCorner({
        vx: 0, vy: 0, vz: 100, surfaceMember: sm, surfaceIncoming: sIn,
        analyticMember: am, analyticIncoming: aIn, side: 'right',
        surfaceCriterion: SURF, analyticCriterion: ac, maxSearchDistance: 100, target: flat,
      });
      total += 1;
      outcomes[got.outcome] = (outcomes[got.outcome] ?? 0) + 1;
      if (got.outcome === 'ANALYTIC_TIE_BEHIND_VERTEX') behind += 1;
    }
  }
  return { total, behind, outcomes };
};
const behindFound = behindGrid();
rows.push({
  id: 'record.behind-unreachable', order: 'direction-grid-search',
  criteria: ['FIXED(-0.5)', 'DIST/ELEV/REL'], frames: '4 dirs x 2 orders x 3 criteria',
  targetDigest: targetDigest(flatTin(90)), expected: 'DEFENSE_IN_DEPTH',
  actual: behindFound.behind === 0 ? 'DEFENSE_IN_DEPTH' : 'ANALYTIC_TIE_BEHIND_VERTEX',
  match: behindFound.behind === 0,
  surfaceTie: null, analyticTie: null, xyGap: null, zGap: null, rootCount: 0,
  extent: null, meshValid: null, turn: null,
  detail: `grid=${behindFound.total} behind=${behindFound.behind} outcomes=${JSON.stringify(behindFound.outcomes)}`,
  digest: '',
});
rows[rows.length - 1]!.digest = digest({ ...rows[rows.length - 1], digest: undefined });
// Ray/edge-parallel quirk evidence: the §18 surface plane (z=100+0.5y)
// tied along the side normal (0,-1). Axis-aligned quad → no interval
// (fail closed); 10°-rotated quad → tie (0,-20,90). Production code is
// untouched; the study only records the behavior.
{
  const plane = gradingPlaneGradient(
    { startX: 0, startY: 0, endX: 1, endY: 0, startZ: 100, endZ: 100, length: 1, reoriented: false, isArc: false },
    'right', -0.5, 0,
  )!;
  const axis = studyRayTie(axisTin(90), plane, 0, 0, 0, -1, 100);
  const spun = studyRayTie(rotTin(90, 10), plane, 0, 0, 0, -1, 100);
  for (const [id, probe, want] of [
    ['record.quirk-axis-aligned', axis, 'CORNER_NO_SOLUTION'],
    ['record.quirk-rotated', spun, 'tie'],
  ] as const) {
    const actual = probe.ok ? 'tie' : (probe.code ?? 'fail');
    const row: Row = {
      id, order: 'quirk-probe', criteria: ['FIXED(-0.5)', 'normal-ray'],
      frames: 'T=(1,0) N=(0,-1)', targetDigest: targetDigest(id.endsWith('aligned') ? axisTin(90) : rotTin(90, 10)),
      expected: want, actual, match: actual === want,
      surfaceTie: probe.tie ? [probe.tie.x, probe.tie.y, probe.tie.z] : null,
      analyticTie: null, xyGap: null, zGap: null, rootCount: probe.ok ? 1 : 0,
      extent: probe.tie ? Math.hypot(probe.tie.x, probe.tie.y) : null,
      meshValid: null, turn: null,
      detail: 'production ray/edge-parallel interval behavior',
      digest: '',
    };
    row.digest = digest({ ...row, digest: undefined });
    rows.push(row);
  }
}

// Large coordinates: translate exact + mismatch near E≈2M N≈7M.
const shift = (m: ResolvedGradingSource, dx: number, dy: number): ResolvedGradingSource =>
  ({ ...m, startX: m.startX + dx, startY: m.startY + dy, endX: m.endX + dx, endY: m.endY + dy });
const shiftTin = (t: GradingTargetMeshSnapshot, dx: number, dy: number): GradingTargetMeshSnapshot => ({
  points: t.points.map((v, i) => (i % 3 === 2 ? v : i % 3 === 0 ? v + dx : v + dy)),
  triangles: [...t.triangles],
});
const DX = 2000000;
const DY = 7000000;
const bigExact = run('exact.large-coords', {
  vx: DX, vy: DY, vz: 100,
  surfaceMember: shift(SIN, DX, DY), surfaceIncoming: true,
  analyticMember: shift(AOUT, DX, DY), analyticIncoming: false,
  side: 'right', surfaceCriterion: SURF, analyticCriterion: ANAL,
  maxSearchDistance: 100, target: shiftTin(T90, DX, DY), buildMesh: true,
}, 'EXACT_COMMON_TIE', 'surface-incoming/analytic-outgoing');
const bigMismatch = run('mismatch.large-coords', {
  vx: DX, vy: DY, vz: 100,
  surfaceMember: shift(SIN, DX, DY), surfaceIncoming: true,
  analyticMember: shift(AOUT, DX, DY), analyticIncoming: false,
  side: 'right', surfaceCriterion: SURF, analyticCriterion: ANAL,
  maxSearchDistance: 100, target: shiftTin(flatTin(92), DX, DY),
}, 'TRANSITION_REQUIRED', 'surface-incoming/analytic-outgoing');
void bigExact;
void bigMismatch;

// Perturbation ladder from exact: record PASS/FAIL + gaps. Steps below the
// shared zeroDelta floor stay EXACT; larger steps break it (TRANSITION).
// Cross-grade steps are structurally exact: the tie slides along the
// analytic line x=40 (xTie=40 cancels for every grade).
const ladderSteps = [0, Number.EPSILON, 1e-12, 1e-9, 1e-6, 1e-3, 1e-1];
const exactAt = (step: number): SurfaceAnalyticOutcome =>
  step <= Number.EPSILON ? 'EXACT_COMMON_TIE' : 'TRANSITION_REQUIRED';
for (const step of ladderSteps) {
  run(`ladder.target-elev-${step}`, exactInput(SURF, ANAL, flatTin(90 + step)), exactAt(step), 'perturbation');
}
for (const step of ladderSteps) {
  run(`ladder.analytic-dz-${step}`, exactInput(SURF, REL(-0.25, -10 + step)), exactAt(step), 'perturbation');
}
for (const step of ladderSteps) {
  run(`ladder.grade-${step}`, exactInput(FIXED(-0.5 + step), ANAL), 'EXACT_COMMON_TIE', 'perturbation');
}
for (const step of ladderSteps) {
  run(`ladder.analytic-dist-${step}`, exactInput(SURF, DIST(-0.25, 40 + step)), exactAt(step), 'perturbation');
}
for (const step of ladderSteps) {
  run(`ladder.analytic-elev-${step}`, exactInput(SURF, ELEV(-0.25, 90 + step)), exactAt(step), 'perturbation');
}
for (const step of ladderSteps) {
  const tin = flatTin(90);
  tin.points[2 * 3 + 2]! += 0;
  const pert = flatTin(90);
  pert.points[8]! += step;
  run(`ladder.tin-vert-${step}`, exactInput(SURF, ANAL, pert), exactAt(step), 'perturbation');
}
for (const step of ladderSteps) {
  const vz = 100 + step;
  run(`ladder.source-z-${step}`, {
    ...exactInput(),
    vx: 0, vy: 0, vz,
    surfaceMember: M(-60, 0, vz, 0, 0, vz),
    analyticMember: M(0, 0, vz, 0, 60, vz),
  }, exactAt(step), 'perturbation');
}
// Target-slope ladder through the tie (z=90+a(x-40)): the tie stays pinned
// for every non-coincident slope; a=-0.25 coincides with the surface plane
// (root collapses to V while the analytic tie holds the far root).
for (const a of [0.001, 0.01, 0.1]) {
  const h = 200;
  const pts: Array<[number, number]> = [[-h, -h], [h, -h], [h, h], [-h, h]];
  run(`ladder.target-slope-${a}`, exactInput(SURF, ANAL, {
    points: pts.flatMap(([x, y]) => [x, y, 90 + a * (x - 40)]),
    triangles: [0, 1, 2, 0, 2, 3],
  }), 'EXACT_COMMON_TIE', 'perturbation');
}
{
  const h = 200;
  const pts: Array<[number, number]> = [[-h, -h], [h, -h], [h, h], [-h, h]];
  run('ladder.target-slope-coincident', exactInput(SURF, ANAL, {
    points: pts.flatMap(([x, y]) => [x, y, 90 - 0.25 * (x - 40)]),
    triangles: [0, 1, 2, 0, 2, 3],
  }), 'ROOT_POLICY_CONFLICT', 'perturbation');
}
// Longitudinal-grade ladder on the incoming member (V pinned at 100).
// Structurally exact like the cross-grade ladder: seam and plane tilt
// together, so the tie slides along the analytic line x=40.
for (const step of ladderSteps) {
  run(`ladder.long-grade-${step}`, {
    ...exactInput(),
    surfaceMember: M(-60, 0, 100 - 60 * step, 0, 0, 100),
  }, 'EXACT_COMMON_TIE', 'perturbation');
}

// OVERLAP prototype (right-turn reflex): GAP/OVERLAP order-appropriate record.
const OIN = M(-60, 0, 100, 0, 0, 100);
const OOUT = M(0, 0, 100, 0, -60, 100);
run('exact.overlap', {
  vx: 0, vy: 0, vz: 100,
  surfaceMember: OIN, surfaceIncoming: true,
  analyticMember: OOUT, analyticIncoming: false,
  side: 'right', surfaceCriterion: SURF, analyticCriterion: ANAL,
  maxSearchDistance: 100, target: T90, buildMesh: true,
}, 'EXACT_COMMON_TIE', 'surface-incoming/analytic-outgoing');

// ---------------------------------------------------------------------------
// Closed four-method square (oracle 16) via per-corner study ties.
interface SquareCorner {
  id: string;
  v: [number, number];
  inMember: ResolvedGradingSource;
  outMember: ResolvedGradingSource;
  inKind: 'surface' | 'analytic';
  inCriterion: GradingCriterion;
  outKind: 'surface' | 'analytic';
  outCriterion: GradingCriterion;
}
const sq = (sx: number, sy: number, ex: number, ey: number): ResolvedGradingSource =>
  M(sx, sy, 10, ex, ey, 10);
const SQM = [sq(0, 0, 100, 0), sq(100, 0, 100, 100), sq(100, 100, 0, 100), sq(0, 100, 0, 0)];
const SQ_T90 = flatTin(0, 400);
const SQ_CRIT: GradingCriterion[] = [FIXED(-0.5), DIST(-0.5, 20), ELEV(-0.5, 0), REL(-0.5, -10)];
const SQ_TIE: Array<[number, number, number]> = [
  [120, -20, 0], [120, 120, 0], [-20, 120, 0], [-20, -20, 0],
];
const sqTangent = (m: ResolvedGradingSource): { tx: number; ty: number; nx: number; ny: number; gs: number } => {
  const dx = m.endX - m.startX;
  const dy = m.endY - m.startY;
  const len = Math.hypot(dx, dy);
  const n = gradingSideNormal(dx / len, dy / len, 'right')!;
  return { tx: dx / len, ty: dy / len, nx: n.nx, ny: n.ny, gs: 0 };
};
const squareCorners: SquareCorner[] = [0, 1, 2, 3].map((j) => ({
  id: `square.corner-${j}`,
  v: [SQM[j]!.endX, SQM[j]!.endY] as [number, number],
  inMember: SQM[j]!,
  outMember: SQM[(j + 1) % 4]!,
  inKind: j === 0 ? 'surface' : 'analytic',
  inCriterion: SQ_CRIT[j]!,
  outKind: (j + 1) % 4 === 0 ? 'surface' : 'analytic',
  outCriterion: SQ_CRIT[(j + 1) % 4]!,
}));
for (const c of squareCorners) {
  if (c.inKind === 'surface' || c.outKind === 'surface') {
    const surfIn = c.inKind === 'surface';
    run(`exact.${c.id}`, {
      vx: c.v[0], vy: c.v[1], vz: 10,
      surfaceMember: surfIn ? c.inMember : c.outMember,
      surfaceIncoming: surfIn,
      analyticMember: surfIn ? c.outMember : c.inMember,
      analyticIncoming: !surfIn,
      side: 'right',
      surfaceCriterion: surfIn ? c.inCriterion : c.outCriterion,
      analyticCriterion: surfIn ? c.outCriterion : c.inCriterion,
      maxSearchDistance: 100, target: SQ_T90,
    }, 'EXACT_COMMON_TIE', surfIn ? 'surface-incoming/analytic-outgoing' : 'analytic-incoming/surface-outgoing');
  } else {
    const fi = sqTangent(c.inMember);
    const fo = sqTangent(c.outMember);
    const tie = intersectAnalyticPair(
      c.v[0], c.v[1], 10,
      { nx: fi.tx, ny: fi.ty }, { nx: fi.nx, ny: fi.ny }, fi.gs, c.inCriterion,
      { nx: fo.tx, ny: fo.ty }, { nx: fo.nx, ny: fo.ny }, fo.gs, c.outCriterion,
      100,
    );
    const want = SQ_TIE[squareCorners.indexOf(c)]!;
    const match = tie.ok && tie.tie &&
      Math.abs(tie.tie.x - want[0]) < 1e-9 && Math.abs(tie.tie.y - want[1]) < 1e-9 &&
      Math.abs(tie.tie.z - want[2]) < 1e-9;
    const row: Row = {
      id: `exact.${c.id}`, order: 'analytic-analytic', criteria: [JSON.stringify(c.inCriterion), JSON.stringify(c.outCriterion)],
      frames: `${frameOf(c.inMember, 'right')} | ${frameOf(c.outMember, 'right')}`,
      targetDigest: 'analytic-no-target', expected: 'EXACT_COMMON_TIE',
      actual: tie.ok ? 'EXACT_COMMON_TIE' : 'ANALYTIC_LINE_INVALID',
      match: match ?? false,
      surfaceTie: null,
      analyticTie: tie.tie ? [tie.tie.x, tie.tie.y, tie.tie.z] : null,
      xyGap: null, zGap: null, rootCount: 0, extent: tie.extent ?? null,
      meshValid: null, turn: 'GAP', digest: '',
    };
    row.digest = digest({ ...row, digest: undefined });
    rows.push(row);
  }
}
// Closed mismatch: member 1 off (D=24) → both adjacent cross-domain
// corners fail. Corner 0 via the study core; corner 1 (analytic×analytic)
// via the terminal-line pair (limit Zs disagree: -2 vs 0).
{
  const c = squareCorners[0]!;
  run('mismatch.square-corner-0', {
    vx: c.v[0], vy: c.v[1], vz: 10,
    surfaceMember: c.inMember, surfaceIncoming: true,
    analyticMember: c.outMember, analyticIncoming: false,
    side: 'right', surfaceCriterion: c.inCriterion, analyticCriterion: DIST(-0.5, 24),
    maxSearchDistance: 100, target: SQ_T90,
  }, 'TRANSITION_REQUIRED', 'surface-incoming/analytic-outgoing');
}
{
  const f1 = sqTangent(SQM[1]!);
  const f2 = sqTangent(SQM[2]!);
  const tie = intersectAnalyticPair(
    100, 100, 10,
    { nx: f1.tx, ny: f1.ty }, { nx: f1.nx, ny: f1.ny }, f1.gs, DIST(-0.5, 24),
    { nx: f2.tx, ny: f2.ty }, { nx: f2.nx, ny: f2.ny }, f2.gs, ELEV(-0.5, 0),
    100,
  );
  const row: Row = {
    id: 'mismatch.square-corner-1', order: 'analytic-analytic',
    criteria: [JSON.stringify(DIST(-0.5, 24)), JSON.stringify(ELEV(-0.5, 0))],
    frames: `${frameOf(SQM[1]!, 'right')} | ${frameOf(SQM[2]!, 'right')}`,
    targetDigest: 'analytic-no-target', expected: 'TRANSITION_REQUIRED',
    actual: tie.ok ? 'EXACT_COMMON_TIE' : 'TRANSITION_REQUIRED',
    match: !tie.ok,
    surfaceTie: null,
    analyticTie: tie.tie ? [tie.tie.x, tie.tie.y, tie.tie.z] : null,
    xyGap: null, zGap: null, rootCount: 0, extent: tie.extent ?? null,
    meshValid: null, turn: 'GAP', detail: tie.detail ?? 'z-disagree', digest: '',
  };
  row.digest = digest({ ...row, digest: undefined });
  rows.push(row);
}

// Production controls (oracle 16) + freeze regression (oracle 18).
const controlSquare = (
  id: string,
  criteria: GradingCriterion[],
  memberCriteria: GradingCriterion[] | undefined,
  target: GradingTargetMeshSnapshot | undefined,
): void => {
  const out = computeGradingGroupFromSnapshots({
    groupId: 'study', revision: 'study',
    members: SQM, side: 'right', criterion: criteria[0]!,
    ...(memberCriteria ? { memberCriteria } : {}),
    maxSearchDistance: 100, curveChordTolerance: 0.01, closed: true,
    ...(target ? { target } : {}),
  });
  const row: Row = {
    id, order: 'closed-group-control', criteria: criteria.map((c) => JSON.stringify(c)),
    frames: SQM.map((m) => frameOf(m, 'right')).join(' | '),
    targetDigest: target ? targetDigest(target) : 'analytic-no-target',
    expected: id.includes('freeze') ? 'MEMBER_NO_SOLUTION/GRADING_GROUP_MIXED_TERMINATION_DOMAIN' : 'ok',
    actual: out.ok ? 'ok' : `${out.code}${out.detail ? `/${out.detail}` : ''}`,
    match: id.includes('freeze')
      ? (!out.ok && out.code === 'MEMBER_NO_SOLUTION' && out.detail === 'GRADING_GROUP_MIXED_TERMINATION_DOMAIN')
      : out.ok,
    surfaceTie: null,
    analyticTie: out.ok
      ? out.result.corners.map((c) => c.tiePointXyz ?? []).flat()
      : null,
    xyGap: null, zGap: null, rootCount: 0,
    extent: out.ok ? out.result.corners[0]?.miterExtent ?? null : null,
    meshValid: out.ok ? true : null, turn: null,
    digest: '',
  };
  row.digest = digest({ ...row, digest: undefined });
  rows.push(row);
};
controlSquare('control.all-surface', [FIXED(-0.5)], undefined, SQ_T90);
controlSquare('control.all-distance', [DIST(-0.5, 20)], undefined, undefined);
controlSquare('control.mixed-analytic', [DIST(-0.5, 20)], [DIST(-0.5, 20), ELEV(-0.5, 0), REL(-0.5, -10), DIST(-0.5, 20)], undefined);
controlSquare('freeze.surface-plus-analytic', [FIXED(-0.5)], [FIXED(-0.5), REL(-0.5, -10), FIXED(-0.5), FIXED(-0.5)], SQ_T90);

// ---------------------------------------------------------------------------
mkdirSync(dirname(OUT), { recursive: true });
const mismatches = rows.filter((r) => !r.match);
const payload = {
  generated: 'phase20i-surface-analytic-corner-study',
  rows,
  summary: {
    total: rows.length,
    matched: rows.length - mismatches.length,
    mismatched: mismatches.map((r) => ({ id: r.id, expected: r.expected, actual: r.actual, detail: r.detail })),
  },
};
writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`);
console.log(`phase20i corpus: ${rows.length} rows, ${mismatches.length} mismatches → ${OUT}`);
for (const m of mismatches) console.log(`  MISMATCH ${m.id}: expected ${m.expected}, got ${m.actual} ${m.detail ?? ''}`);
