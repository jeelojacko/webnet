/**
 * Phase 20C Wave-1A — arc-source grading driver.
 *
 * Moved verbatim from `src/workers/surfaceGradingCompute.ts` (zero numerical
 * change): arc sources subdivide via `linearizeGradingArc` and run the exact
 * straight-chord solve per chord, stitched with `seamEquals`. Only
 * reorganized into small helpers that move contiguous statement blocks
 * unchanged.
 */
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

/** Stitch one solved chord in station order, dropping agreed joint dupes. */
const appendStitchedChord = (stitch: ArcStitch, chord: StraightChordSolve): void => {
  // Stitch in station order: the shared joint node is solved by both
  // adjacent chords, so drop the duplicate when both boundaries agree
  // under the zeroDelta floor (span-tagged same-plane convention).
  let skipFirst = 0;
  if (
    stitch.sourcePts.length > 0 &&
    seamEquals(stitch.sourcePts[stitch.sourcePts.length - 1]!, chord.sourcePts[0]!) &&
    seamEquals(stitch.daylightPts[stitch.daylightPts.length - 1]!, chord.daylightPts[0]!)
  ) {
    skipFirst = 1;
  }
  stitch.regions.push(...chord.regions);
  stitch.diagnostics.push(...chord.diagnostics);
  for (let i = skipFirst; i < chord.sourcePts.length; i += 1) {
    stitch.sourcePts.push(chord.sourcePts[i]!);
    stitch.daylightPts.push(chord.daylightPts[i]!);
    stitch.distances.push(chord.distances[i]!);
    stitch.nodeStations.push(chord.nodeStations[i]!);
  }
  for (let i = skipFirst * 3; i < chord.daylightFlat.length; i += 1) {
    stitch.daylightFlat.push(chord.daylightFlat[i]!);
  }
  stitch.candidateTriangleCount += chord.candidateTriangleCount;
  stitch.intersectionSegmentCount += chord.intersectionSegmentCount;
  stitch.multipleSolutionCount += chord.multipleSolutionCount;
};

type ChordStitchResult =
  | { ok: true; stitch: ArcStitch }
  | { ok: false; code: GradingDiagnosticCode; detail?: string };

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
  const stitch: ArcStitch = {
    regions: [],
    diagnostics: [],
    sourcePts: [],
    daylightPts: [],
    daylightFlat: [],
    distances: [],
    nodeStations: [],
    candidateTriangleCount: 0,
    intersectionSegmentCount: 0,
    multipleSolutionCount: 0,
  };
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
    appendStitchedChord(stitch, solved.solve);
  }
  return { ok: true, stitch };
};

/**
 * Phase 20K.1 Wave B2 — fail-closed seam gate: a nonempty arc strip whose
 * shared-index topology pinches or goes non-manifold fails with the
 * existing NO_SOLUTION code (PINCH/NON_MANIFOLD detail), never CURRENT.
 * Empty meshes pass through (the existing fully-tied ALREADY_TIED path).
 */
const gateArcSeamTopology = (outcome: GradingComputeOutcome): GradingComputeOutcome => {
  if (!outcome.ok) return outcome;
  const mesh = outcome.result.gradingMesh;
  if (mesh.triangles.length === 0) return outcome;
  const topo = validateGradingMeshTopology(mesh.points, mesh.triangles, { scope: 'arc' });
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
    }));
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
  }));
};
