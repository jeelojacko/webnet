/**
 * Phase 20C Wave-1A — arc-source grading driver.
 *
 * Moved verbatim from `src/workers/surfaceGradingCompute.ts` (zero numerical
 * change): arc sources subdivide via `linearizeGradingArc` and run the exact
 * straight-chord solve per chord, stitched with `seamEquals`. Only
 * reorganized into small helpers that move contiguous statement blocks
 * unchanged.
 */
import { gradingSideNormal } from './gradingCourseFrame';
import { assembleSolvedGradingChain, assembleSurfaceChain, type ChordSeamChord } from './gradingChordSeam';
import { candidateTriangles } from './gradingTargetIndex';
import { samePlanNode } from './gradingGroupSectors';
import { linearizeGradingArc, type LinearizedGradingArc } from './gradingCurve';
import { validateGradingMeshTopology } from './gradingTopology';
import {
  assembleAnalyticGradingResult,
  assembleGradingResult,
} from './gradingResultAssemble';
import { solveGradingChord } from './solveAnalyticGradingChord';
import {
  type StraightChordSolve,
} from './solveStraightChord';
import { isTargetFreeCriterion } from './gradingTypes';
import type {
  GradingComputeOutcome,
  GradingComputeSource,
  GradingTargetMeshSnapshot,
  TargetQuery,
} from './gradingComputeTypes';
import { zeroDelta } from '../surfaces/volume/zero';
import type {
  GradingCriterion,
  GradingDiagnostic,
  GradingDiagnosticCode,
  GradingResultRegion,
  GradingSide,
} from './gradingTypes';

/**
 * Fail-closed cap on arc subdivision: a pathological tolerance must refuse
 * with a diagnostic, never hang the worker rebuilding the target index per
 * chord. R=50 m at 0.005 m needs 56 chords; 4096 covers any sane job.
 */
const MAX_ARC_SUBDIVISIONS = 4096;

export interface ArcSolveInput {
  gradingId: string;
  revision: string;
  source: GradingComputeSource;
  side: GradingSide;
  criterion: GradingCriterion;
  maxSearchDistance: number;
  tolerance: number;
  /** Absent for target-free (analytic) criteria; required otherwise. */
  target?: GradingTargetMeshSnapshot;
  /** Absent for target-free (analytic) criteria; required otherwise. */
  query?: TargetQuery;
}

/** Seam equality under the zeroDelta floor (plan + elevation). */
export const seamEquals = (
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): boolean =>
  Math.abs(a.x - b.x) <= zeroDelta(a.x, b.x) &&
  Math.abs(a.y - b.y) <= zeroDelta(a.y, b.y) &&
  Math.abs(a.z - b.z) <= zeroDelta(a.z, b.z);

type ArcSetupResult =
  | { ok: true; linearized: LinearizedGradingArc; segArc: number }
  | { ok: false; code: GradingDiagnosticCode; detail?: string };

/** Linearize the arc source at the definition's curve chord tolerance. */
const linearizeArcOrFail = (
  source: GradingComputeSource,
  tolerance: number,
): ArcSetupResult => {
  if (!Number.isFinite(tolerance) || !(tolerance > 0)) {
    return { ok: false, code: 'NO_SOLUTION', detail: 'GRADING_BAD_TOLERANCE' };
  }
  const linearized = linearizeGradingArc(
    source.arc!.centerX,
    source.arc!.centerY,
    source.arc!.radius,
    source.arc!.startAngle,
    source.arc!.endAngle,
    source.arc!.sweepCCW,
    source.startZ,
    source.endZ,
    tolerance,
  );
  if (!linearized) return { ok: false, code: 'NO_SOLUTION', detail: 'GRADING_ARC_LINEARIZE' };
  if (linearized.subdivisions > MAX_ARC_SUBDIVISIONS) {
    return { ok: false, code: 'NO_SOLUTION', detail: 'GRADING_ARC_TOO_FINE' };
  }
  // Uniform subdivision ⇒ uniform arc-length stations per chord.
  return { ok: true, linearized, segArc: source.length / linearized.subdivisions };
};

interface ArcStitch {
  regions: GradingResultRegion[];
  diagnostics: GradingDiagnostic[];
  sourcePts: Array<{ x: number; y: number; z: number }>;
  daylightPts: Array<{ x: number; y: number; z: number }>;
  daylightFlat: number[];
  distances: number[];
  nodeStations: number[];
  candidateTriangleCount: number;
  intersectionSegmentCount: number;
  multipleSolutionCount: number;
  /** Tied-station coordinates (zero-width pair run starts) for the B2 gate. */
  tiedSplitCoords: number[];
}

/** Chord source between two linearized arc samples. */
const chordSourceFor = (
  p0: { x: number; y: number; z: number },
  p1: { x: number; y: number; z: number },
  source: GradingComputeSource,
): GradingComputeSource | null => {
  const chordLen = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  if (!(chordLen > 0) || !Number.isFinite(chordLen)) return null;
  return {
    startX: p0.x,
    startY: p0.y,
    endX: p1.x,
    endY: p1.y,
    startZ: p0.z,
    endZ: p1.z,
    length: chordLen,
    reoriented: source.reoriented,
    isArc: false,
  };
};

/** Frame + solve of one linearized chord for the seam-aware stitch. */
interface SeamChordCarry {
  solve: StraightChordSolve;
  chordSource: GradingComputeSource;
  frame: { t: { nx: number; ny: number }; n: { nx: number; ny: number }; gs: number };
}

type ChordStitchResult =
  | { ok: true; stitch: ArcStitch }
  | { ok: false; code: GradingDiagnosticCode; detail?: string };

/** Per-chord analytic frame (same derivation as the chord solve itself). */
const seamFrameFor = (
  chordSource: GradingComputeSource,
  side: GradingSide,
): { t: { nx: number; ny: number }; n: { nx: number; ny: number }; gs: number } | null => {
  const dx = chordSource.endX - chordSource.startX;
  const dy = chordSource.endY - chordSource.startY;
  const len = Math.hypot(dx, dy);
  if (!(len > 0) || !Number.isFinite(len)) return null;
  const n = gradingSideNormal(dx / len, dy / len, side);
  if (!n) return null;
  return { t: { nx: dx / len, ny: dy / len }, n, gs: (chordSource.endZ - chordSource.startZ) / chordSource.length };
};

/** Stitch Surface chord solves through the shared internal-seam assembly. */
const stitchSurfaceSeam = (
  carries: SeamChordCarry[],
  input: ArcSolveInput,
): ChordStitchResult => {
  const { side, criterion, maxSearchDistance, target, query } = input;
  if (!target || !query) {
    return { ok: false, code: 'NO_SOLUTION', detail: 'GRADING_BAD_TARGET_MESH' };
  }
  // Seam-level candidates over the source bbox (mirrors the group path).
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of carries) {
    const s = c.chordSource;
    minX = Math.min(minX, s.startX, s.endX);
    minY = Math.min(minY, s.startY, s.endY);
    maxX = Math.max(maxX, s.startX, s.endX);
    maxY = Math.max(maxY, s.startY, s.endY);
  }
  const candidates = candidateTriangles(target, [
    { x: minX - maxSearchDistance, y: minY - maxSearchDistance },
    { x: maxX + maxSearchDistance, y: minY - maxSearchDistance },
    { x: maxX + maxSearchDistance, y: maxY + maxSearchDistance },
    { x: minX - maxSearchDistance, y: maxY + maxSearchDistance },
  ]);
  if (!candidates) return { ok: false, code: 'NO_SOLUTION', detail: 'GRADING_BAD_TARGET_MESH' };
  const assembled = assembleSurfaceChain(
    carries.map((c) => ({
      t: c.frame.t,
      n: c.frame.n,
      gs: c.frame.gs,
      chord: c.chordSource,
      solve: c.solve,
    })),
    { side, criterion, maxSearchDistance, target, candidates, query },
  );
  if (!assembled.ok) return { ok: false, code: 'NO_SOLUTION', detail: assembled.detail };
  const stitch: ArcStitch = {
    regions: [],
    diagnostics: [],
    sourcePts: assembled.value.sourcePts,
    daylightPts: assembled.value.daylightPts,
    daylightFlat: [],
    distances: assembled.value.distances,
    nodeStations: assembled.value.nodeStations,
    candidateTriangleCount: 0,
    intersectionSegmentCount: 0,
    multipleSolutionCount: 0,
    tiedSplitCoords: [],
  };
  for (const p of assembled.value.daylightPts) stitch.daylightFlat.push(p.x, p.y, p.z);
  // The boundary polyline drops bitwise-duplicate consecutive nodes
  // (repeated-V fan pairs share run-tip values); the strip pairs above
  // keep them for tiling. Exact-value dedup only — geometry untouched.
  const flat = stitch.daylightFlat;
  const clean: number[] = [];
  for (let i = 0; i + 2 < flat.length; i += 3) {
    const n = clean.length;
    if (n >= 3 && clean[n - 3] === flat[i] && clean[n - 2] === flat[i + 1] && clean[n - 1] === flat[i + 2]) continue;
    clean.push(flat[i]!, flat[i + 1]!, flat[i + 2]!);
  }
  stitch.daylightFlat = clean;
  // Tied-split stations: maximal runs of zero-width pairs (daylight back
  // on the source) legitimately pinch the strip — the run-start source
  // coordinates (real tied stations, not counts) attribute gate extras.
  let inRun = false;
  for (let i = 0; i < stitch.sourcePts.length; i += 1) {
    const tied = samePlanNode(stitch.daylightPts[i]!, stitch.sourcePts[i]!);
    if (tied && !inRun) {
      const sp = stitch.sourcePts[i]!;
      stitch.tiedSplitCoords.push(sp.x, sp.y, sp.z);
      inRun = true;
    } else if (!tied) {
      inRun = false;
    }
  }
  for (const c of carries) {
    stitch.regions.push(...c.solve.regions);
    stitch.diagnostics.push(...c.solve.diagnostics);
    stitch.candidateTriangleCount += c.solve.candidateTriangleCount;
    stitch.intersectionSegmentCount += c.solve.intersectionSegmentCount;
    stitch.multipleSolutionCount += c.solve.multipleSolutionCount;
  }
  stitch.intersectionSegmentCount += assembled.value.ties.length;
  return { ok: true, stitch };
};
const stitchAnalyticSeam = (
  carries: SeamChordCarry[],
  criterion: GradingCriterion,
  side: GradingSide,
  maxSearchDistance: number,
): ChordStitchResult => {
  const assembled = assembleSolvedGradingChain(
    carries.map((c): ChordSeamChord => ({
      t: c.frame.t,
      n: c.frame.n,
      gs: c.frame.gs,
      criterion,
      // Authoritative exact samples (solve endpoints may differ by 1 ulp).
      source: [
        { x: c.chordSource.startX, y: c.chordSource.startY, z: c.chordSource.startZ },
        { x: c.chordSource.endX, y: c.chordSource.endY, z: c.chordSource.endZ },
      ],
      daylight: [{ ...c.solve.daylightPts[0]! }, { ...c.solve.daylightPts[c.solve.daylightPts.length - 1]! }],
      nodeStations: [c.solve.nodeStations[0]!, c.solve.nodeStations[c.solve.nodeStations.length - 1]!],
      distances: [c.solve.distances[0]!, c.solve.distances[c.solve.distances.length - 1]!],
    })),
    maxSearchDistance,
    side,
  );
  if (!assembled.ok) return { ok: false, code: 'NO_SOLUTION', detail: assembled.detail };
  const stitch: ArcStitch = {
    regions: [],
    diagnostics: [],
    sourcePts: assembled.value.sourcePts,
    daylightPts: assembled.value.daylightPts,
    daylightFlat: [],
    distances: assembled.value.distances,
    nodeStations: assembled.value.nodeStations,
    candidateTriangleCount: 0,
    intersectionSegmentCount: 0,
    multipleSolutionCount: 0,
    tiedSplitCoords: [],
  };
  for (const p of assembled.value.daylightPts) stitch.daylightFlat.push(p.x, p.y, p.z);
  for (const c of carries) {
    stitch.regions.push(...c.solve.regions);
    stitch.diagnostics.push(...c.solve.diagnostics);
    stitch.candidateTriangleCount += c.solve.candidateTriangleCount;
    stitch.intersectionSegmentCount += c.solve.intersectionSegmentCount;
    stitch.multipleSolutionCount += c.solve.multipleSolutionCount;
  }
  return { ok: true, stitch };
};

/** Run the chord solve once per linearized chord (analytic when target-free). */
const solveArcChords = (
  input: ArcSolveInput,
  linearized: LinearizedGradingArc,
  segArc: number,
): ChordStitchResult => {
  const { source, side, criterion, maxSearchDistance, target, query } = input;
  if (!isTargetFreeCriterion(criterion) && (!target || !query)) {
    return { ok: false, code: 'NO_SOLUTION', detail: 'GRADING_BAD_TARGET_MESH' };
  }
  const analytic = isTargetFreeCriterion(criterion);
  const carries: SeamChordCarry[] = [];
  for (let k = 0; k < linearized.subdivisions; k += 1) {
    const p0 = linearized.points[k]!;
    const p1 = linearized.points[k + 1]!;
    const chordSource = chordSourceFor(p0, p1, source);
    if (!chordSource) {
      return { ok: false, code: 'NO_SOLUTION', detail: 'GRADING_ARC_LINEARIZE' };
    }
    const solved = solveGradingChord({
      source: chordSource,
      side,
      criterion,
      maxSearchDistance,
      ...(target !== undefined ? { target } : {}),
      ...(query !== undefined ? { query } : {}),
      stationBase: k * segArc,
      stationScale: segArc / chordSource.length,
    });
    if (!solved.ok) return solved;
    // Phase 20K.1 Waves C1/C2: internal seams assemble through the shared
    // chord-seam helpers (analytic tie / Surface corner, no averaging).
    const frame = seamFrameFor(chordSource, side);
    if (!frame) return { ok: false, code: 'NO_SOLUTION', detail: 'GRADING_DEGENERATE_SOURCE' };
    carries.push({ solve: solved.solve, chordSource, frame });
  }
  if (analytic) return stitchAnalyticSeam(carries, criterion, side, maxSearchDistance);
  return stitchSurfaceSeam(carries, input);
};

/**
 * Phase 20K.1 Wave B2 — fail-closed seam gate: a nonempty arc strip whose
 * shared-index topology pinches or goes non-manifold fails with the
 * existing NO_SOLUTION code (PINCH/NON_MANIFOLD detail), never CURRENT.
 * Empty meshes pass through (the existing fully-tied ALREADY_TIED path).
 */
const gateArcSeamTopology = (outcome: GradingComputeOutcome, tiedSplitCoords: readonly number[]): GradingComputeOutcome => {
  if (!outcome.ok) return outcome;
  const mesh = outcome.result.gradingMesh;
  if (mesh.triangles.length === 0) return outcome;
  const topo = validateGradingMeshTopology(mesh.points, mesh.triangles, { scope: 'arc', tiedSplitCoords: [...tiedSplitCoords] });
  if (topo.ok) return outcome;
  return { ok: false, code: 'NO_SOLUTION', detail: `${topo.code}: ${topo.detail ?? ''}` };
};

/**
 * Arc-source grading: subdivide at the curve chord tolerance and run the
 * exact straight-chord solve per chord. Arc sources WITHOUT circle
 * parameters are handled by the caller's single-chord path, not here.
 */
export const solveArcGrading = (input: ArcSolveInput): GradingComputeOutcome => {
  const setup = linearizeArcOrFail(input.source, input.tolerance);
  if (!setup.ok) return setup;
  const stitched = solveArcChords(input, setup.linearized, setup.segArc);
  if (!stitched.ok) return stitched;
  const stitch = stitched.stitch;
  // Phase 20F: analytic criteria assemble without a target query —
  // source/target relation lengths stay unavailable (never faked).
  if (isTargetFreeCriterion(input.criterion)) {
    return gateArcSeamTopology(assembleAnalyticGradingResult({
      gradingId: input.gradingId,
      revision: input.revision,
      sourceLength: input.source.length,
      accuracy: 'CURVE_APPROXIMATED',
      regions: stitch.regions,
      diagnostics: stitch.diagnostics,
      sourcePts: stitch.sourcePts,
      daylightPts: stitch.daylightPts,
      daylightFlat: stitch.daylightFlat,
      distances: stitch.distances,
      nodeStations: stitch.nodeStations,
      candidateTriangleCount: stitch.candidateTriangleCount,
      intersectionSegmentCount: stitch.intersectionSegmentCount,
      multipleSolutionCount: stitch.multipleSolutionCount,
    }), stitch.tiedSplitCoords);
  }
  if (!input.target || !input.query) {
    return { ok: false, code: 'NO_SOLUTION', detail: 'GRADING_BAD_TARGET_MESH' };
  }
  return gateArcSeamTopology(assembleGradingResult({
    gradingId: input.gradingId,
    revision: input.revision,
    sourceLength: input.source.length,
    accuracy: 'CURVE_APPROXIMATED',
    regions: stitch.regions,
    diagnostics: stitch.diagnostics,
    sourcePts: stitch.sourcePts,
    daylightPts: stitch.daylightPts,
    daylightFlat: stitch.daylightFlat,
    distances: stitch.distances,
    nodeStations: stitch.nodeStations,
    query: input.query,
    candidateTriangleCount: stitch.candidateTriangleCount,
    intersectionSegmentCount: stitch.intersectionSegmentCount,
    multipleSolutionCount: stitch.multipleSolutionCount,
  }), stitch.tiedSplitCoords);
};
