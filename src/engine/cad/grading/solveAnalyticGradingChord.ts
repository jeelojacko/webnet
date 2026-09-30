/**
 * Phase 20F — analytic grading-chord solve (target-free criteria).
 *
 * Distance/elevation criteria terminate without a target surface: the
 * daylight offset is closed-form per station, so no TIN candidate query,
 * no intersection walk, and no agreement gate are involved. Output shape
 * is identical to `solveStraightChord` (counts truthfully zero, accuracy
 * EXACT); the thin `solveGradingChord` dispatcher routes surface criteria
 * to the exact straight-chord solver unchanged.
 */
import { gradingSideNormal } from './gradingCourseFrame';
import {
  finiteSource,
  solveStraightChord,
  type StraightChordInput,
  type StraightChordOutcome,
  type StraightChordSolve,
} from './solveStraightChord';
import { resolveAnalyticCriterionAt } from './gradingAnalyticCriterion';
import type {
  GradingCriterion,
  GradingSide,
} from './gradingTypes';
import { isTargetFreeCriterion } from './gradingTypes';
import type {
  GradingComputeSource,
  GradingTargetMeshSnapshot,
  TargetQuery,
} from './gradingComputeTypes';

export interface AnalyticChordInput {
  source: GradingComputeSource;
  side: GradingSide;
  criterion: GradingCriterion;
  maxSearchDistance: number;
  /** Arc-station offset added to every chord-local station. */
  stationBase?: number;
  /** Chord-u → arc-station scale (straight solve: 1). */
  stationScale?: number;
}

/** Dispatcher input: target/query required for surface criteria only. */
export type GradingChordInput = AnalyticChordInput & {
  target?: GradingTargetMeshSnapshot;
  query?: TargetQuery;
};

interface AnalyticFrame {
  nx: number;
  ny: number;
  tx: number;
  ty: number;
  gs: number;
  len: number;
}

type AnalyticFrameResult =
  | { ok: true; frame: AnalyticFrame }
  | { ok: false; code: 'NO_SOLUTION' | 'MAX_DISTANCE_REACHED'; detail?: string };

/** Validate source/side/search and derive the chord frame (no target). */
const resolveAnalyticFrame = (
  source: GradingComputeSource,
  side: GradingSide,
  maxSearchDistance: number,
): AnalyticFrameResult => {
  if (!finiteSource(source)) return { ok: false, code: 'NO_SOLUTION', detail: 'GRADING_BAD_SOURCE' };
  if (!(maxSearchDistance > 0) || !Number.isFinite(maxSearchDistance)) {
    return { ok: false, code: 'NO_SOLUTION', detail: 'GRADING_BAD_SEARCH_DISTANCE' };
  }
  const dx = source.endX - source.startX;
  const dy = source.endY - source.startY;
  const len = Math.hypot(dx, dy);
  if (!(len > 0) || !Number.isFinite(len)) {
    return { ok: false, code: 'NO_SOLUTION', detail: 'GRADING_DEGENERATE_SOURCE' };
  }
  const normal = gradingSideNormal(dx / len, dy / len, side);
  if (!normal) return { ok: false, code: 'NO_SOLUTION', detail: 'GRADING_BAD_SIDE' };
  // Finite endpoints can still overflow the derived longitudinal grade
  // ((endZ - startZ)/length -> non-finite); reject fail-closed so no NaN
  // or Infinite daylight/mesh value is ever produced downstream.
  const gs = (source.endZ - source.startZ) / source.length;
  if (!Number.isFinite(gs)) return { ok: false, code: 'NO_SOLUTION', detail: 'GRADING_BAD_SOURCE' };
  return {
    ok: true,
    frame: {
      nx: normal.nx,
      ny: normal.ny,
      tx: dx / len,
      ty: dy / len,
      gs,
      len: source.length,
    },
  };
};

type AnalyticOffsetResult =
  | { ok: true; g: number; distances: [number, number]; limitZ: [number, number] }
  | { ok: false; code: 'NO_SOLUTION' | 'MAX_DISTANCE_REACHED'; detail?: string };

/**
 * Closed-form offset per station through the shared analytic criterion
 * helper: constant D (distance), linear (E−Zsrc)/g (elevation), or constant
 * Δ/g (relative-elevation). Both endpoints are resolved independently so a
 * sloping source keeps its per-station offset honest.
 */
const analyticOffsets = (
  criterion: GradingCriterion,
  source: GradingComputeSource,
  maxSearchDistance: number,
): AnalyticOffsetResult => {
  const start = resolveAnalyticCriterionAt(criterion, source.startZ, maxSearchDistance);
  if (!start.ok) return start;
  const end = resolveAnalyticCriterionAt(criterion, source.endZ, maxSearchDistance);
  if (!end.ok) return end;
  return {
    ok: true,
    g: start.value.gradeRatio,
    distances: [start.value.horizontalDistance, end.value.horizontalDistance],
    limitZ: [start.value.limitElevation, end.value.limitElevation],
  };
};

/**
 * Exact analytic chord solve: Q(u) = P(u) + d(u)·N,
 * Z(u) = Zsrc(u) + g·d(u). Both endpoints only — d(u) is constant or
 * linear on a straight chord, so the segment between them is exact.
 */
export const solveAnalyticGradingChord = (
  input: AnalyticChordInput,
): StraightChordOutcome => {
  const { source, side, criterion, maxSearchDistance } = input;
  if (!isTargetFreeCriterion(criterion)) {
    return { ok: false, code: 'NO_SOLUTION', detail: 'GRADING_ANALYTIC_WRONG_CRITERION' };
  }
  const framed = resolveAnalyticFrame(source, side, maxSearchDistance);
  if (!framed.ok) return framed;
  const { nx, ny, tx, ty, gs, len } = framed.frame;
  const stationBase = input.stationBase ?? 0;
  const stationScale = input.stationScale ?? 1;
  const solved = analyticOffsets(criterion, source, maxSearchDistance);
  if (!solved.ok) return solved;
  const { g, distances, limitZ } = solved;
  const [d0, d1] = distances;
  const [z0, z1] = limitZ;
  const atSource = (u: number): { x: number; y: number; z: number } => ({
    x: source.startX + tx * u,
    y: source.startY + ty * u,
    z: source.startZ + gs * u,
  });
  const atDaylight = (u: number, d: number, z: number): { x: number; y: number; z: number } => {
    const s = atSource(u);
    // Relative-elevation carries the shared helper's exact signed-Δ limit
    // (sourceZ + Δ); distance/elevation keep the legacy g·d construction
    // byte-for-byte.
    return {
      x: s.x + nx * d,
      y: s.y + ny * d,
      z: criterion.kind === 'relative-elevation' ? z : s.z + g * d,
    };
  };
  const p0 = atSource(0);
  const p1 = atSource(len);
  const q0 = atDaylight(0, d0, z0);
  const q1 = atDaylight(len, d1, z1);
  const mapStation = (u: number): number => stationBase + u * stationScale;
  const solve: StraightChordSolve = {
    regions: [{ classification: 'FIXED', stationSpan: [mapStation(0), mapStation(len)] }],
    diagnostics: [],
    nodeStations: [mapStation(0), mapStation(len)],
    sourcePts: [p0, p1],
    daylightPts: [q0, q1],
    daylightFlat: [q0.x, q0.y, q0.z, q1.x, q1.y, q1.z],
    distances: [d0, d1],
    candidateTriangleCount: 0,
    intersectionSegmentCount: 0,
    multipleSolutionCount: 0,
  };
  return { ok: true, solve };
};

/**
 * Thin chord dispatcher: target-free criteria solve analytically (target
 * and query are ignored and may be absent); fixed/cut-fill run the exact
 * straight-chord solve with the caller's target snapshot and query.
 */
export const solveGradingChord = (input: GradingChordInput): StraightChordOutcome => {
  if (isTargetFreeCriterion(input.criterion)) {
    return solveAnalyticGradingChord(input);
  }
  if (!input.target || !input.query) {
    return { ok: false, code: 'NO_SOLUTION', detail: 'GRADING_BAD_TARGET_MESH' };
  }
  const straight: StraightChordInput = {
    source: input.source,
    side: input.side,
    criterion: input.criterion,
    maxSearchDistance: input.maxSearchDistance,
    target: input.target,
    query: input.query,
    stationBase: input.stationBase ?? 0,
    stationScale: input.stationScale ?? 1,
  };
  return solveStraightChord(straight);
};
