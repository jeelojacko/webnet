/**
 * Phase 20C Wave-1A — grading result assembly.
 *
 * Strip mesh + areas + stats over stitched polylines (solver-independent),
 * moved verbatim from `src/workers/surfaceGradingCompute.ts` (zero numerical
 * change).
 */
import {
  buildGradingStripMesh,
  mesh3dArea,
  meshPlanArea,
  tieStats,
} from './gradingMesh';
import { zeroDelta } from '../surfaces/volume/zero';
import type {
  GradingAccuracy,
  GradingDiagnostic,
  GradingResultRegion,
} from './gradingTypes';
import type {
  GradingComputeOutcome,
  TargetQuery,
} from './gradingComputeTypes';

export interface AssembledResultInput {
  gradingId: string;
  revision: string;
  sourceLength: number;
  accuracy: GradingAccuracy;
  regions: GradingResultRegion[];
  diagnostics: GradingDiagnostic[];
  sourcePts: Array<{ x: number; y: number; z: number }>;
  daylightPts: Array<{ x: number; y: number; z: number }>;
  daylightFlat: number[];
  distances: number[];
  nodeStations: number[];
  query: TargetQuery;
  candidateTriangleCount: number;
  intersectionSegmentCount: number;
  multipleSolutionCount: number;
}

interface CutFillLengths {
  cutSourceLength: number;
  fillSourceLength: number;
  tiedSourceLength: number;
}

/** Cut/fill/tied source lengths from delta-at-source sign along the stations. */
const splitCutFillLengths = (
  sourcePts: Array<{ x: number; y: number; z: number }>,
  nodeStations: number[],
  query: TargetQuery,
): CutFillLengths => {
  let cutSourceLength = 0;
  let fillSourceLength = 0;
  let tiedSourceLength = 0;
  for (let i = 0; i + 1 < sourcePts.length; i += 1) {
    const width = Math.max(0, nodeStations[i + 1]! - nodeStations[i]!);
    if (!(width > 0)) continue;
    const pa = sourcePts[i]!;
    const pb = sourcePts[i + 1]!;
    const za = query.elevationAt(pa.x, pa.y);
    const zb = query.elevationAt(pb.x, pb.y);
    if (za === null || zb === null) continue;
    const da = za - pa.z;
    const db = zb - pb.z;
    const zaZero = Math.abs(da) <= zeroDelta(da, 0);
    const zbZero = Math.abs(db) <= zeroDelta(db, 0);
    if (zaZero && zbZero) tiedSourceLength += width;
    else if (!zaZero && !zbZero && (da > 0) === (db > 0)) {
      if (da > 0) cutSourceLength += width;
      else fillSourceLength += width;
    } else {
      // Zero crossing inside: split proportionally (linear delta).
      const t = Math.abs(da - db) <= zeroDelta(da, db) ? 0.5 : Math.abs(da) / (Math.abs(da) + Math.abs(db));
      if (da > 0) {
        cutSourceLength += width * t;
        fillSourceLength += width * (1 - t);
      } else if (da < 0) {
        fillSourceLength += width * t;
        cutSourceLength += width * (1 - t);
      } else {
        tiedSourceLength += width * t;
        if (db > 0) cutSourceLength += width * (1 - t);
        else fillSourceLength += width * (1 - t);
      }
    }
  }
  return { cutSourceLength, fillSourceLength, tiedSourceLength };
};

/** Fully already-tied course: CURRENT with zero area (bake stays blocked). */
const tiedGradingResult = (
  input: AssembledResultInput,
): GradingComputeOutcome => {
  const {
    gradingId,
    revision,
    sourceLength,
    accuracy,
    regions,
    daylightFlat,
    distances,
    candidateTriangleCount,
    intersectionSegmentCount,
    multipleSolutionCount,
  } = input;
  const stats = tieStats(distances);
  return {
    ok: true,
    result: {
      gradingId,
      revision,
      accuracy,
      regions,
      daylightPoints: daylightFlat,
      gradingMesh: { points: [], triangles: [] },
      sourceLength,
      gradingPlanArea: 0,
      grading3dArea: 0,
      minProjectionDistance: stats.min,
      maxProjectionDistance: stats.max,
      meanProjectionDistance: stats.mean,
      cutSourceLength: 0,
      fillSourceLength: 0,
      tiedSourceLength: sourceLength,
      candidateTriangleCount,
      intersectionSegmentCount,
      multipleSolutionCount,
      diagnostics: [{ code: 'ALREADY_TIED' }],
    },
  };
};

/**
 * Phase 20F — analytic result assembly (no target query).
 *
 * Plan/3D area and projection-distance stats are real (mesh + tieStats
 * over the analytic polylines); source/target relation lengths are
 * unavailable without a target, so they read 0/0/0 rather than a faked
 * partition. Single FIXED region, zero candidate/intersection counts.
 */
export type AnalyticAssembledResultInput = Omit<AssembledResultInput, 'query'>;

export const assembleAnalyticGradingResult = (
  input: AnalyticAssembledResultInput,
): GradingComputeOutcome => {
  const {
    gradingId,
    revision,
    sourceLength,
    accuracy,
    regions,
    diagnostics,
    sourcePts,
    daylightPts,
    daylightFlat,
    distances,
    candidateTriangleCount,
    intersectionSegmentCount,
    multipleSolutionCount,
  } = input;
  const mesh = buildGradingStripMesh(sourcePts, daylightPts);
  const stats = tieStats(distances);
  if (!mesh.ok) {
    return {
      ok: true,
      result: {
        gradingId,
        revision,
        accuracy,
        regions,
        daylightPoints: daylightFlat,
        gradingMesh: { points: [], triangles: [] },
        sourceLength,
        gradingPlanArea: 0,
        grading3dArea: 0,
        minProjectionDistance: stats.min,
        maxProjectionDistance: stats.max,
        meanProjectionDistance: stats.mean,
        cutSourceLength: 0,
        fillSourceLength: 0,
        tiedSourceLength: 0,
        candidateTriangleCount,
        intersectionSegmentCount,
        multipleSolutionCount,
        diagnostics: [{ code: 'ALREADY_TIED' }],
      },
    };
  }
  return {
    ok: true,
    result: {
      gradingId,
      revision,
      accuracy,
      regions,
      daylightPoints: daylightFlat,
      gradingMesh: { points: mesh.points, triangles: mesh.triangles },
      sourceLength,
      gradingPlanArea: meshPlanArea(mesh.points, mesh.triangles),
      grading3dArea: mesh3dArea(mesh.points, mesh.triangles),
      minProjectionDistance: stats.min,
      maxProjectionDistance: stats.max,
      meanProjectionDistance: stats.mean,
      cutSourceLength: 0,
      fillSourceLength: 0,
      tiedSourceLength: 0,
      candidateTriangleCount,
      intersectionSegmentCount,
      multipleSolutionCount,
      diagnostics,
    },
  };
};

/** Strip mesh + areas + stats over stitched polylines (solver-independent). */
export const assembleGradingResult = (input: AssembledResultInput): GradingComputeOutcome => {
  const {
    gradingId,
    revision,
    sourceLength,
    accuracy,
    regions,
    diagnostics,
    sourcePts,
    daylightPts,
    daylightFlat,
    distances,
    nodeStations,
    query,
    candidateTriangleCount,
    intersectionSegmentCount,
    multipleSolutionCount,
  } = input;
  const mesh = buildGradingStripMesh(sourcePts, daylightPts);
  if (!mesh.ok) {
    return tiedGradingResult(input);
  }
  const { cutSourceLength, fillSourceLength, tiedSourceLength } = splitCutFillLengths(
    sourcePts,
    nodeStations,
    query,
  );
  const stats = tieStats(distances);
  return {
    ok: true,
    result: {
      gradingId,
      revision,
      accuracy,
      regions,
      daylightPoints: daylightFlat,
      gradingMesh: { points: mesh.points, triangles: mesh.triangles },
      sourceLength,
      gradingPlanArea: meshPlanArea(mesh.points, mesh.triangles),
      grading3dArea: mesh3dArea(mesh.points, mesh.triangles),
      minProjectionDistance: stats.min,
      maxProjectionDistance: stats.max,
      meanProjectionDistance: stats.mean,
      cutSourceLength,
      fillSourceLength,
      tiedSourceLength,
      candidateTriangleCount,
      intersectionSegmentCount,
      multipleSolutionCount,
      diagnostics,
    },
  };
};
