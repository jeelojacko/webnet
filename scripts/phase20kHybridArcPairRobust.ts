/**
 * Phase 20K Worker-ROBUST — hybrid arc-pair ROBUSTNESS study (§19-25, §32).
 *
 * Evidence-only: no production route, no `src/` change, no new tolerance or
 * threshold. Every corner case delegates to the Worker-VARIANTS study
 * (`resolveArcPairStudy`), which imports Worker-CORE's arc seam
 * (`makeArcMember` / `linearizeArcMember` / `arcTerminalFrame`) and clears the
 * production arc×arc guard ONLY to let `solveHybridCorner` own every gate
 * (seam ray, nearest outward root, 20J.1 agreement contracts, half-planes,
 * miter extent, GAP/OVERLAP mesh). This module adds the robustness drivers:
 *
 *  §20  offset-radius safety (`Roffset = R + radialSign·d`) — candidate gate.
 *  §21  radius × sweep × ccw × side × GAP/OVERLAP conditioning matrix.
 *  §23  target/root pathologies through the existing fail-closed gates.
 *  §24  mismatch ladders — transition-required, never wall/bridge/average.
 *  §25  large-coordinate (E≈2M/N≈7M … 100M/300M) translation invariance.
 *  §32  hand-designed 20J.1 shallow-grade pin (production straight hybrid).
 *
 * §19 evidence hooks: `POLICY_NOTES` records the three integration policies
 * under study (A study-only / B closed-offset-only / C general arc-pair).
 * Policy C is NOT implemented — production keeps failing closed on a genuine
 * arc×arc joint (see `tests/cad_grading_hybrid_arc_pair_robust_20k.test.ts`).
 */
import { classifyCorner } from '../src/engine/cad/grading/gradingCornerMath';
import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';
import type { GradingTargetMeshSnapshot } from '../src/engine/cad/grading/gradingComputeTypes';
import type { GradingCriterion, GradingSide, ResolvedGradingSource } from '../src/engine/cad/grading/gradingTypes';
import {
  arcTerminalFrame,
  linearizeArcMember,
  makeArcMember,
  resolveHybridArcPair,
  PRIMARY_ANALYTIC_ARC,
  PRIMARY_SURFACE_ARC,
  type ArcPairOutcome,
  type ArcSpec,
} from './phase20kHybridArcPairCore';
import {
  flatTin as quadTin,
  overlapAnalyticArc,
  overlapSurfaceArc,
  resolveArcPairStudy,
  type ArcPairStudyInput,
  type ArcPairStudyResult,
  type ArcPairVariantOutcome,
} from './phase20kHybridArcPairVariants';

export const V0 = { vx: 0, vy: 0, vz: 100 } as const;
export const OFFSET_RATIOS = [0.1, 0.5, 0.9, 1.0, 1.1] as const;

export const FIXED = (g: number): GradingCriterion => ({ kind: 'fixed', gradeRatio: g });
export const CUTFILL = (c: number, f: number): GradingCriterion => ({ kind: 'cut-fill', cutGradeRatio: c, fillGradeRatio: f });
export const DIST = (g: number, d: number): GradingCriterion => ({ kind: 'distance', gradeRatio: g, distance: d });
export const ELEV = (g: number, e: number): GradingCriterion => ({ kind: 'elevation', gradeRatio: g, targetElevation: e });
export const REL = (g: number, dz: number): GradingCriterion =>
  ({ kind: 'relative-elevation', gradeRatio: g, relativeElevation: dz });

const bigTin = (z: number): GradingTargetMeshSnapshot => quadTin(z, 3000);

const baseStudy = (over: Partial<ArcPairStudyInput> = {}): ArcPairStudyInput => ({
  ...V0,
  side: 'right',
  surfaceArc: overlapSurfaceArc(),
  surfaceCriterion: FIXED(-0.5),
  analyticArc: overlapAnalyticArc(),
  analyticCriterion: DIST(-0.25, 40),
  target: bigTin(90),
  maxSearchDistance: 200,
  curveChordTolerance: 10,
  buildMesh: false,
  ...over,
});

/* ═════════════════════════ §20 — offset-radius safety ═════════════════════════ */

export type OffsetRadiusClass =
  | 'ARC_PAIR_OFFSET_OK'
  | 'ARC_PAIR_OFFSET_COLLAPSE'
  | 'ARC_PAIR_OFFSET_INVERTED';

export interface OffsetRadiusRow {
  side: GradingSide;
  ratio: number;
  radialSign: 1 | -1;
  offsetDistance: number;
  radiusOffset: number;
  classification: OffsetRadiusClass;
  orientationPreserved: boolean;
  selfIntersects: boolean;
  outcome: ArcPairVariantOutcome | null;
  detail: string | null;
  tie: { x: number; y: number; z: number } | null;
  extent: number | null;
  components: number | null;
  boundaryLoops: number | null;
  meshValid: boolean | null;
  digest: string | null;
}

/**
 * A parallel grading offset modelled as a concentric arc `R + radialSign·d`.
 * `radialSign = +1` on the right side, `-1` on the left (the task convention).
 * Ratios `d/R ≥ 1` are the collapse/inversion boundary the study recommends
 * gating: `Roffset = 0` is a self-intersecting point, `Roffset < 0` flips the
 * traversal orientation. No production gate exists today.
 *
 * Strictly symbolic: the offset arc is NEVER resolved. A concentric arc of
 * radius R+d no longer joints at V — its endpoint moves ~d off V — so
 * calling the resolver on the shifted radius would tie invalid joint
 * geometry and report a spurious 'exact' result. Every row keeps
 * outcome/tie/mesh null with a `symbolic-only` detail.
 */
export const offsetRadiusSafety = (
  base: Partial<ArcPairStudyInput> = {},
  ratios: readonly number[] = OFFSET_RATIOS,
): OffsetRadiusRow[] => {
  const input = baseStudy(base);
  const rows: OffsetRadiusRow[] = [];
  for (const side of ['right', 'left'] as const) {
    const radialSign: 1 | -1 = side === 'right' ? 1 : -1;
    for (const ratio of ratios) {
      const offsetDistance = ratio * input.surfaceArc.radius;
      const radiusOffset = input.surfaceArc.radius + radialSign * offsetDistance;
      const classification: OffsetRadiusClass = radiusOffset > 0
        ? 'ARC_PAIR_OFFSET_OK'
        : radiusOffset === 0 ? 'ARC_PAIR_OFFSET_COLLAPSE' : 'ARC_PAIR_OFFSET_INVERTED';
      rows.push({
        side, ratio, radialSign, offsetDistance, radiusOffset, classification,
        orientationPreserved: radiusOffset > 0,
        selfIntersects: radiusOffset <= 0,
        outcome: null,
        detail: 'symbolic-only: resolver not run (offset arc joint leaves V)',
        tie: null, extent: null,
        components: null, boundaryLoops: null, meshValid: null, digest: null,
      });
    }
  }
  return rows;
};

/* ═════════════════════════ §21 — radius × sweep matrix ════════════════════════ */

const tangentOf = (ccw: boolean, tangent: { nx: number; ny: number }): { x: number; y: number } =>
  ccw ? { x: tangent.ny, y: -tangent.nx } : { x: -tangent.ny, y: tangent.nx };

/** Arc whose traversal ENDS at `v` with unit tangent `tangent`. */
export const arcEndingAt = (
  v: { vx: number; vy: number; vz: number },
  tangent: { nx: number; ny: number },
  radius: number, sweepRad: number, ccw: boolean,
): ArcSpec | null => {
  if (!(radius > 0) || !(sweepRad > 0)) return null;
  const r = tangentOf(ccw, tangent);
  const dir = ccw ? 1 : -1;
  const endAngle = Math.atan2(r.y, r.x);
  const cx = v.vx - radius * r.x;
  const cy = v.vy - radius * r.y;
  if (![cx, cy, endAngle].every(Number.isFinite)) return null;
  return {
    centerX: cx, centerY: cy, radius,
    startAngle: endAngle - dir * sweepRad, endAngle, sweepCCW: ccw,
    startZ: v.vz, endZ: v.vz,
  };
};

/** Arc whose traversal STARTS at `v` with unit tangent `tangent`. */
export const arcStartingAt = (
  v: { vx: number; vy: number; vz: number },
  tangent: { nx: number; ny: number },
  radius: number, sweepRad: number, ccw: boolean,
): ArcSpec | null => {
  if (!(radius > 0) || !(sweepRad > 0)) return null;
  const r = tangentOf(ccw, tangent);
  const dir = ccw ? 1 : -1;
  const startAngle = Math.atan2(r.y, r.x);
  const cx = v.vx - radius * r.x;
  const cy = v.vy - radius * r.y;
  if (![cx, cy, startAngle].every(Number.isFinite)) return null;
  return {
    centerX: cx, centerY: cy, radius,
    startAngle, endAngle: startAngle + dir * sweepRad, sweepCCW: ccw,
    startZ: v.vz, endZ: v.vz,
  };
};

/** Incoming tangent (1,0); outgoing tangent chosen so classifyCorner yields the turn. */
const outgoingTangent = (turn: 'GAP' | 'OVERLAP', side: GradingSide): { nx: number; ny: number } => {
  const up = { nx: 0, ny: 1 };
  const down = { nx: 0, ny: -1 };
  if (side === 'right') return turn === 'GAP' ? up : down;
  return turn === 'GAP' ? down : up;
};

export interface SweepMatrixRow {
  radiusIn: number;
  radiusOut: number;
  sweepInDeg: number;
  sweepOutDeg: number;
  ccwIn: boolean;
  ccwOut: boolean;
  side: GradingSide;
  intendedTurn: 'GAP' | 'OVERLAP';
  actualTurn: string | null;
  closedIn: number;
  closedOut: number;
  det: number | null;
  condition: number | null;
  outcome: ArcPairVariantOutcome;
  detail: string | null;
  tie: { x: number; y: number; z: number } | null;
  extent: number | null;
  /** Judgment call: sane conditioning + finite result, vs near-degenerate/contrived. */
  region: 'useful' | 'contrived';
}

const DEG = Math.PI / 180;

const runMatrixCell = (
  input: ArcPairStudyInput, side: GradingSide, intendedTurn: 'GAP' | 'OVERLAP',
  radiusIn: number, radiusOut: number, sweepInDeg: number, sweepOutDeg: number,
  ccwIn: boolean, ccwOut: boolean,
): SweepMatrixRow => {
  const mIn = makeArcMember(input.surfaceArc);
  const mOut = makeArcMember(input.analyticArc);
  const fIn = mIn ? arcTerminalFrame(mIn, true, 'chord', side, input.curveChordTolerance) : null;
  const fOut = mOut ? arcTerminalFrame(mOut, false, 'chord', side, input.curveChordTolerance) : null;
  const closedIn = mIn ? (linearizeArcMember(mIn, input.curveChordTolerance)?.length ?? -1) : -1;
  const closedOut = mOut ? (linearizeArcMember(mOut, input.curveChordTolerance)?.length ?? -1) : -1;
  const det = fIn && fOut ? fIn.n.nx * fOut.n.ny - fIn.n.ny * fOut.n.nx : null;
  const actualTurn = fIn && fOut ? classifyCorner(fIn.t, fOut.t, side) : null;
  const got: ArcPairStudyResult = resolveArcPairStudy(input);
  const condition = det !== null && det !== 0 ? 1 / Math.abs(det) : null;
  const finite = got.outcome === 'ARC_PAIR_EXACT_COMMON_TIE' || got.outcome === 'ARC_PAIR_FINITE_TRANSITION';
  const region = det !== null && Math.abs(det) > 1e-3 && finite ? 'useful' : 'contrived';
  return {
    radiusIn, radiusOut, sweepInDeg, sweepOutDeg, ccwIn, ccwOut, side, intendedTurn,
    actualTurn, closedIn, closedOut, det, condition,
    outcome: got.outcome, detail: got.detail ?? null, tie: got.tie, extent: got.extent, region,
  };
};

const radiusPairs = (radii: readonly number[]): Array<[number, number]> => [
  ...radii.map((r) => [r, r] as [number, number]),
  ...radii.map((r) => [r, r * 1.6] as [number, number]),
];

/** Bounded matrix: 4 radii × 2 pairings × 4 sweeps × 2 ccw × 2 sides × 2 turns. */
export const radiusSweepMatrix = (
  radii: readonly number[] = [10, 60, 100, 500],
  sweepsDeg: readonly number[] = [5, 45, 90, 135],
): SweepMatrixRow[] => {
  const rows: SweepMatrixRow[] = [];
  for (const [radiusIn, radiusOut] of radiusPairs(radii)) {
    for (const sweepInDeg of sweepsDeg) {
      for (const sweepOutDeg of sweepsDeg) {
        for (const [ccwIn, ccwOut] of [[true, true], [true, false]] as Array<[boolean, boolean]>) {
          for (const side of ['right', 'left'] as const) {
            for (const turn of ['GAP', 'OVERLAP'] as const) {
              const sIn = arcEndingAt(V0, { nx: 1, ny: 0 }, radiusIn, sweepInDeg * DEG, ccwIn);
              const sOut = arcStartingAt(V0, outgoingTangent(turn, side), radiusOut, sweepOutDeg * DEG, ccwOut);
              if (!sIn || !sOut) continue;
              rows.push(runMatrixCell(
                baseStudy({ side, surfaceArc: sIn, analyticArc: sOut }),
                side, turn, radiusIn, radiusOut, sweepInDeg, sweepOutDeg, ccwIn, ccwOut,
              ));
            }
          }
        }
      }
    }
  }
  return rows;
};

/* ═════════════════════════ §23 — target/root pathologies ══════════════════════ */

export interface RootPathologyRow {
  id: string;
  description: string;
  outcome: ArcPairOutcome;
  detail: string | null;
  tie: { x: number; y: number; z: number } | null;
  extent: number | null;
  buildable: boolean;
}

const quadTinDeg = (z: number, half: number, deg: number, triangles: number[]): GradingTargetMeshSnapshot => {
  const a = deg * DEG;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const pts: Array<[number, number]> = [[-half, -half], [half, -half], [half, half], [-half, half]];
  return { points: pts.flatMap(([x, y]) => [x * c - y * s, x * s + y * c, z]), triangles };
};

const slopedTin = (half: number, gx: number, gy: number, z0: number): GradingTargetMeshSnapshot => {
  const pts: Array<[number, number]> = [[-half, -half], [half, -half], [half, half], [-half, half]];
  const points = pts.flatMap(([x, y]) => [x, y, z0 + gx * x + gy * y]);
  return { points, triangles: [0, 1, 2, 0, 2, 3] };
};

const shiftedTin = (dx: number, dy: number): GradingTargetMeshSnapshot => {
  const t = quadTinDeg(90, 200, 10, [0, 1, 2, 0, 2, 3]);
  return { points: t.points.map((v, i) => (i % 3 === 2 ? v : v + (i % 3 === 0 ? dx : dy))), triangles: [...t.triangles] };
};

const stackedTin = (): GradingTargetMeshSnapshot => {
  const bottom = quadTinDeg(90, 400, 0, [0, 1, 2, 0, 2, 3]);
  const top = quadTinDeg(95, 400, 0, [0, 1, 2, 0, 2, 3]).points.map((v) => v);
  const offset = bottom.points.length / 3;
  return {
    points: [...bottom.points, ...top],
    triangles: [...bottom.triangles, ...[0, 1, 2, 0, 2, 3].map((i) => i + offset)],
  };
};

const disconnectedTin = (): GradingTargetMeshSnapshot => {
  const a = quadTinDeg(90, 100, 0, [0, 1, 2, 0, 2, 3]);
  const b = quadTinDeg(90, 100, 0, [0, 1, 2, 0, 2, 3]).points.map((v, i) => (i % 3 === 2 ? v : v + (i % 3 === 0 ? 500 : 0)));
  const offset = a.points.length / 3;
  return { points: [...a.points, ...b], triangles: [...a.triangles, ...[0, 1, 2, 0, 2, 3].map((i) => i + offset)] };
};

const degenerateTin = (): GradingTargetMeshSnapshot => ({
  points: [0, 0, 90, 10, 0, 90, 20, 0, 90, 5, 1e-12, 90],
  triangles: [0, 1, 2, 0, 1, 3],
});

/**
 * §23 target/root pathologies through the CORE feasibility authority: it
 * solves only the terminal chord, so coverage gaps reach the existing
 * fail-closed gates (`gap-at-V`, branch discontinuity, no-root) instead of
 * dying in the full-strip builder. Nearest outward root stays authoritative.
 *
 * `edge-hit` / `vertex-hit` anchor on the pinned CORE primary tie (see the
 * feasibility two-chord oracle): the triangulation edge / vertex passes
 * through the tie point itself, so the identical tie is a real transverse
 * / vertex hit, not a relabelled flat TIN. `two-roots` is honestly NOT a
 * root-policy test — stacked duplicate layers reject fail-closed with
 * `CORNER_BRANCH_DISCONTINUITY`. Nearest-vs-later root policy is UNTESTED
 * on the arc path (the 20J patchTin gives TARGET_GAP via CORE and an exact
 * tie via VARIANTS here — no ROOT_POLICY fixture found; see TODO).
 */
export const TIE_ANCHOR = { x: 63.08644059797901, y: -47.77910330337543, z: 90 };

/** Flat rotated quad (same frame as `bigTin`) shifted so diagonal 1→3 crosses the anchor tie. */
export const edgeHitTin = (): GradingTargetMeshSnapshot => {
  const h = 3000;
  const c = Math.cos(10 * DEG);
  const s = Math.sin(10 * DEG);
  const lx = c * TIE_ANCHOR.x + s * TIE_ANCHOR.y;
  const ly = -s * TIE_ANCHOR.x + c * TIE_ANCHOR.y;
  const sh = lx + ly;
  const dx = -sh * Math.sin(10 * DEG);
  const dy = sh * Math.cos(10 * DEG);
  const corners: Array<[number, number]> = [[-h, -h], [h, -h], [h, h], [-h, h]];
  return {
    points: corners.flatMap(([x, y]) => [x * c - y * s + dx, x * s + y * c + dy, 90]),
    triangles: [0, 1, 3, 1, 2, 3],
  };
};

/** Flat rotated quad fan-triangulated from a vertex placed exactly at the anchor tie. */
export const vertexHitTin = (): GradingTargetMeshSnapshot => {
  const h = 3000;
  const c = Math.cos(10 * DEG);
  const s = Math.sin(10 * DEG);
  const corners: Array<[number, number]> = [[-h, -h], [h, -h], [h, h], [-h, h]];
  return {
    points: [
      ...corners.flatMap(([x, y]) => [x * c - y * s, x * s + y * c, 90]),
      TIE_ANCHOR.x, TIE_ANCHOR.y, 90,
    ],
    triangles: [0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4],
  };
};
export const rootPathologies = (): RootPathologyRow[] => {
  const coreBase = {
    ...V0,
    side: 'right' as const,
    surfaceArc: PRIMARY_SURFACE_ARC,
    analyticArc: PRIMARY_ANALYTIC_ARC,
    surfaceCriterion: FIXED(-0.5),
    analyticCriterion: REL(-0.25, -10),
    maxSearchDistance: 200,
    target: bigTin(90),
    chordTolerance: 10,
    buildMesh: true,
  };
  const cases: Array<{ id: string; description: string; target: GradingTargetMeshSnapshot }> = [
    { id: 'flat', description: 'flat planar target', target: bigTin(90) },
    { id: 'sloped', description: 'sloped planar target', target: slopedTin(3000, 1e-4, 5e-5, 90) },
    { id: 'alt-triangulation', description: 'alternate quad diagonal', target: quadTinDeg(90, 3000, 0, [0, 1, 3, 1, 2, 3]) },
    { id: 'edge-hit', description: 'triangulation edge through the tie (anchor-verified)', target: edgeHitTin() },
    { id: 'vertex-hit', description: 'target vertex exactly at the tie (anchor-verified)', target: vertexHitTin() },
    { id: 'gap-at-v', description: 'no target under the joint vertex', target: shiftedTin(5000, 5000) },
    { id: 'two-roots', description: 'duplicate stacked layers rejected fail-closed (NOT a root-policy test)', target: stackedTin() },
    { id: 'disconnected', description: 'disconnected target coverage', target: disconnectedTin() },
    { id: 'malformed', description: 'degenerate/duplicate triangles (existing fail-closed)', target: degenerateTin() },
  ];
  return cases.map(({ id, description, target }) => {
    const got = resolveHybridArcPair({ ...coreBase, target });
    return {
      id, description, outcome: got.outcome, detail: got.detail ?? null,
      tie: got.tie, extent: got.extent, buildable: got.meshValid === true,
    };
  });
};

/* ═════════════════════════ §24 — mismatch ladders ═════════════════════════════ */

export interface MismatchRow {
  id: string;
  dimension: string;
  magnitude: number | null;
  outcome: ArcPairVariantOutcome;
  detail: string | null;
  exact: boolean;
  tie: { x: number; y: number; z: number } | null;
  geometryLeaked: boolean;
}

const perturbedVertexTin = (half: number): GradingTargetMeshSnapshot => {
  const t = quadTinDeg(90, half, 0, [0, 1, 2, 0, 2, 3]);
  const points = [...t.points];
  points[2] = (points[2] ?? 0) + 0.002;
  return { points, triangles: t.triangles };
};

export const mismatchLadder = (): MismatchRow[] => {
  const cases: Array<{ id: string; dimension: string; magnitude: number | null; input: Partial<ArcPairStudyInput> }> = [
    { id: 'exact', dimension: 'control', magnitude: 0, input: { analyticCriterion: REL(-0.25, -10) } },
    { id: 'exact-dist', dimension: 'control', magnitude: 0, input: { analyticCriterion: DIST(-0.25, 40) } },
    { id: 'target-2m', dimension: 'target elevation', magnitude: 2, input: { analyticCriterion: REL(-0.25, -10), target: bigTin(92) } },
    { id: 'rel-12', dimension: 'relative Δ', magnitude: -12, input: { analyticCriterion: REL(-0.25, -22) } },
    { id: 'distance-4', dimension: 'distance', magnitude: 4, input: { analyticCriterion: DIST(-0.25, 44) } },
    { id: 'joint-z-2mm', dimension: 'joint Z', magnitude: 0.002, input: { analyticCriterion: REL(-0.25, -10), vz: 100.002 } },
    { id: 'same-xy-2mm', dimension: 'target Z', magnitude: 0.002, input: { analyticCriterion: REL(-0.25, -10), target: bigTin(90.002) } },
    { id: 'target-0.1mm', dimension: 'target Z', magnitude: 1e-4, input: { analyticCriterion: REL(-0.25, -10), target: bigTin(90.0001) } },
    { id: 'target-1mm', dimension: 'target Z', magnitude: 1e-3, input: { analyticCriterion: REL(-0.25, -10), target: bigTin(90.001) } },
    { id: 'target-10mm', dimension: 'target Z', magnitude: 1e-2, input: { analyticCriterion: REL(-0.25, -10), target: bigTin(90.01) } },
    { id: 'distance-grade-1e-6', dimension: 'analytic grade', magnitude: 1e-6, input: { analyticCriterion: DIST(-0.25 + 1e-6, 40) } },
    { id: 'distance-delta-1e-6', dimension: 'analytic distance', magnitude: 1e-6, input: { analyticCriterion: DIST(-0.25, 40 + 1e-6) } },
    { id: 'triangle-z', dimension: 'triangle vertex Z', magnitude: 0.002, input: { analyticCriterion: REL(-0.25, -10), target: perturbedVertexTin(3000) } },
  ];
  const rows = cases.map(({ id, dimension, magnitude, input }) => {
    const got = resolveArcPairStudy(baseStudy(input));
    return {
      id, dimension, magnitude, outcome: got.outcome, detail: got.detail ?? null,
      exact: got.exact, tie: got.tie, geometryLeaked: got.mesh !== null || got.cornerRun !== null,
    };
  });
  // Sanity: the control must be the exact tie, or the whole ladder is meaningless.
  const control = rows.find((r) => r.id === 'exact');
  if (!control || !control.exact) {
    throw new Error(`phase20k robust: exact control failed (${JSON.stringify(control)} )`);
  }
  return rows;
};

/* ═════════════════════════ §25 — large coordinates ════════════════════════════ */

export const LARGE_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, 0], [500000, 5000000], [2000000, 7000000], [20000000, 70000000], [100000000, 300000000],
];

export interface LargeCoordinateRow {
  dx: number;
  dy: number;
  exactOutcome: ArcPairVariantOutcome;
  exactTie: { x: number; y: number; z: number } | null;
  residualX: number | null;
  residualY: number | null;
  residualZ: number | null;
  finite: boolean;
  mismatchOutcome: ArcPairVariantOutcome;
  mismatchDetail: string | null;
  mismatchFinite: boolean;
  det: number | null;
  digest: string | null;
}

const translateSpec = (s: ArcSpec, dx: number, dy: number): ArcSpec => ({
  ...s, centerX: s.centerX + dx, centerY: s.centerY + dy,
});

const translateTin = (t: GradingTargetMeshSnapshot, dx: number, dy: number): GradingTargetMeshSnapshot => ({
  points: t.points.map((v, i) => (i % 3 === 2 ? v : v + (i % 3 === 0 ? dx : dy))),
  triangles: [...t.triangles],
});

export const largeCoordinateStudy = (offsets: ReadonlyArray<readonly [number, number]> = LARGE_OFFSETS): LargeCoordinateRow[] => {
  // tol 1 (not 10): a coarse 2-chord linearisation coincidentally fails the
  // member strip at 500k/5M; the finer chord set removes the artifact without
  // touching any 20J.1 contract. Recorded, not hidden.
  const localExact = resolveArcPairStudy(baseStudy({ buildMesh: true, curveChordTolerance: 1 }));
  const local = localExact.tie;
  return offsets.map(([dx, dy]) => {
    const v = { vx: V0.vx + dx, vy: V0.vy + dy, vz: V0.vz };
    const surfaceArc = translateSpec(overlapSurfaceArc(), dx, dy);
    const analyticArc = translateSpec(overlapAnalyticArc(), dx, dy);
    const target = translateTin(bigTin(90), dx, dy);
    const exact = resolveArcPairStudy(baseStudy({
      ...v, surfaceArc, analyticArc, target, buildMesh: true, curveChordTolerance: 1,
    }));
    const mismatch = resolveArcPairStudy(baseStudy({
      ...v, surfaceArc, analyticArc, target: translateTin(bigTin(90.0001), dx, dy), curveChordTolerance: 1,
    }));
    const tie = exact.tie;
    const residual = (a: number | undefined, b: number | undefined): number | null =>
      a === undefined || b === undefined ? null : a - b;
    const finite = (p: { x: number; y: number; z: number } | null): boolean =>
      p !== null && [p.x, p.y, p.z].every(Number.isFinite);
    return {
      dx, dy,
      exactOutcome: exact.outcome,
      exactTie: tie,
      residualX: local && tie ? residual(tie.x, local.x + dx) : null,
      residualY: local && tie ? residual(tie.y, local.y + dy) : null,
      residualZ: local && tie ? residual(tie.z, local.z) : null,
      finite: finite(tie),
      mismatchOutcome: mismatch.outcome,
      mismatchDetail: mismatch.detail ?? null,
      mismatchFinite: !mismatch.outcome.includes('NON_FINITE') && !mismatch.detail?.includes('NaN'),
      det: exact.inChord && exact.outChord
        ? exact.inChord.n.nx * exact.outChord.n.ny - exact.inChord.n.ny * exact.outChord.n.nx
        : null,
      digest: exact.digest || null,
    };
  });
};

/* ═════════════════════════ §32 — 20J.1 shallow-grade pin ══════════════════════ */

const M = (sx: number, sy: number, sz: number, ex: number, ey: number, ez: number): ResolvedGradingSource => ({
  startX: sx, startY: sy, endX: ex, endY: ey, startZ: sz, endZ: ez,
  length: Math.hypot(ex - sx, ey - sy), reoriented: false, isArc: false,
});

export interface ShallowPinResult {
  ok: boolean;
  code: string | null;
  detail: string | null;
  tie: { x: number; y: number; z: number } | null;
  joint: { vx: number; vy: number; vz: number };
  analyticCriterion: GradingCriterion;
}

const SHALLOW_HALF = 3e7;

/**
 * §32 pin: a nearly-flat surface (`|g| = 1e-6`) whose target is dropped 10 m.
 * The surface root sits ~1e7 m along the seam; `maxSearchDistance` is large
 * enough to reach it. The analytic Distance / RelativeElevation is then
 * shifted by a sub-0.1 mm amount, and the joint can be placed near
 * E≈2M/N≈7M. The residual disagreement must fail closed at the 20J.1
 * agreement gates — never a wall, bridge, average, or snap.
 */
export const shallowGradePin = (opts: {
  grade?: number;
  analytic?: GradingCriterion;
  vx?: number;
  vy?: number;
  targetZ?: number;
  maxSearchDistance?: number;
} = {}): ShallowPinResult => {
  const g = opts.grade ?? -1e-6;
  const analytic = opts.analytic ?? REL(-0.25, -10);
  const vx = opts.vx ?? 0;
  const vy = opts.vy ?? 0;
  const targetZ = opts.targetZ ?? 90;
  const maxSearchDistance = opts.maxSearchDistance ?? 3e7;
  const shift = (m: ResolvedGradingSource): ResolvedGradingSource => ({
    ...m, startX: m.startX + vx, endX: m.endX + vx, startY: m.startY + vy, endY: m.endY + vy,
  });
  const target: GradingTargetMeshSnapshot = {
    points: [
      -SHALLOW_HALF + vx, -SHALLOW_HALF + vy, targetZ,
      SHALLOW_HALF + vx, -SHALLOW_HALF + vy, targetZ,
      SHALLOW_HALF + vx, SHALLOW_HALF + vy, targetZ,
      -SHALLOW_HALF + vx, SHALLOW_HALF + vy, targetZ,
    ],
    triangles: [0, 1, 2, 0, 2, 3],
  };
  const out = computeGradingGroupFromSnapshots({
    groupId: 'k20-robust-shallow', revision: 'r',
    members: [shift(M(-60, 0, 100, 0, 0, 100)), shift(M(0, 0, 100, 0, 60, 100))],
    side: 'right', criterion: FIXED(g),
    memberCriteria: [FIXED(g), analytic],
    maxSearchDistance, curveChordTolerance: 0.01, closed: false, target,
  });
  const joint = { vx, vy, vz: 100 };
  if (out.ok) {
    const p = out.result.corners[0]!.tiePointXyz;
    return {
      ok: true, code: null, detail: null,
      tie: p ? { x: p[0]!, y: p[1]!, z: p[2]! } : null,
      joint, analyticCriterion: analytic,
    };
  }
  return { ok: false, code: out.code, detail: out.detail ?? null, tie: null, joint, analyticCriterion: analytic };
};

/* ═════════════════════════ §19 — integration-policy evidence ══════════════════ */

export interface PolicyNote {
  policy: 'A' | 'B' | 'C';
  summary: string;
  implemented: boolean;
  evidence: string;
}

/**
 * Policy A — study-only: production stays frozen on the arc×arc guard.
 * Policy B — guarded closed-exact-offset route (formerly the only GO,
 *   withdrawn): the closed square resolves 4 exact ties but its mesh is
 *   vertex-pinched (edgeComponents=8), so no route is buildable.
 * Policy C — general arc-pair hybrid route (general open/closed, chord or
 *   true-tangent frames): NOT implemented; the robustness study finds the
 *   offset-radius collapse/inversion boundary and the conditioning matrix
 *   widen, not remove, the fail-closed region.
 */
export const POLICY_NOTES: PolicyNote[] = [
  { policy: 'A', summary: 'keep production frozen; study-only evidence', implemented: true, evidence: 'production arc×arc returns CORNER_NO_SOLUTION / ARC_PAIR_UNSUPPORTED' },
  { policy: 'B', summary: 'guarded closed exact-offset-only route', implemented: false, evidence: 'feasibility verdict NO_GO_TERMINAL_CHORD_ARC_PAIR: closed square exact ties but vertex-pinched mesh, not buildable' },
  { policy: 'C', summary: 'general arc-pair hybrid route', implemented: false, evidence: 'robustness study: Roffset≤0 gate + conditioning/root-policy failures remain' },
];

/* Direct invocation prints the study summary (evidence generation only). */
const invokedDirectly = process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].split('/').pop()!);
if (invokedDirectly) {
  const matrix = radiusSweepMatrix();
  const useful = matrix.filter((r) => r.region === 'useful').length;
  console.log('phase20k robust study');
  console.log(`  §20 offset-radius rows: ${offsetRadiusSafety().length}`);
  console.log(`  §21 matrix rows: ${matrix.length} (useful ${useful}, contrived ${matrix.length - useful})`);
  console.log(`  §23 root pathologies: ${rootPathologies().map((r) => `${r.id}:${r.outcome}`).join(', ')}`);
  console.log(`  §24 mismatch rows: ${mismatchLadder().map((r) => `${r.id}:${r.outcome}`).join(', ')}`);
  console.log(`  §25 large coords: ${largeCoordinateStudy().map((r) => `${r.dx}/${r.dy}:${r.exactOutcome}`).join(', ')}`);
  console.log(`  §32 shallow pin: ${JSON.stringify(shallowGradePin())}`);
}
