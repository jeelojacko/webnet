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
import { buildGradingTopologyCertificateExact, collectTiedRunStarts } from './gradingTopologyCertificate';
import { countPositiveWidthStationRuns, deriveGradingTopologyExpectation } from './gradingTopologyExpectation';
import { validateGradingMeshTopology } from './gradingTopology';
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

/** Session-only topology certificate over the final assembled strip mesh. */
const flattenPoints = (pts: Array<{ x: number; y: number; z: number }>): number[] => {
  const out: number[] = [];
  for (const p of pts) out.push(p.x, p.y, p.z);
  return out;
};

interface StandaloneCertificate {
  certificate: ReturnType<typeof buildGradingTopologyCertificateExact>;
  /** Topology failure detail when the certificate could not be built. */
  detail: string;
}

const standaloneCertificate = (
  mesh: { points: number[]; triangles: number[] },
  sourcePts: Array<{ x: number; y: number; z: number }>,
  daylightPts: Array<{ x: number; y: number; z: number }>,
  daylightFlat: number[],
): StandaloneCertificate => {
  const tiedSplitCoords = collectTiedRunStarts(sourcePts, daylightPts);
  const regions = countPositiveWidthStationRuns(sourcePts, daylightPts);
  // Phase 20K.3 Wave B: explicit pre-mesh expectation (standalone open
  // strip 1/1, tied splits N/N); the gtop2 builder fails closed on mismatch.
  const expectation = deriveGradingTopologyExpectation({
    scope: 'standalone',
    closed: false,
    positiveWidthRegions: regions,
    tiedSplitCoords,
    empty: mesh.triangles.length === 0,
  });
  const certificate = buildGradingTopologyCertificateExact({
    scope: 'standalone',
    points: mesh.points,
    triangles: mesh.triangles,
    expectation,
    sourceBoundaryPoints: flattenPoints(sourcePts),
    // The exported daylight boundary is the deduped `daylightFlat`, not the
    // tiling array; digest the array products actually re-export.
    gradingBoundaryPoints: daylightFlat,
  });
  if (certificate) return { certificate, detail: '' };
  // Surface the authoritative topology code/detail (never a generic
  // missing-certificate string) so the existing fail-closed paths keep
  // their PINCH/NON_MANIFOLD specificity.
  const probe = validateGradingMeshTopology(mesh.points, mesh.triangles, {
    scope: 'arc',
    expectedComponents: expectation.expectedFaceComponents,
    expectedBoundaryLoops: expectation.expectedBoundaryCycles,
    tiedSplitCoords,
  });
  return {
    certificate: null,
    detail: probe.ok ? 'GRADING_TOPOLOGY_CERTIFICATE_MISSING' : `${probe.code}: ${probe.detail ?? ''}`,
  };
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
    sourcePts,
    daylightPts,
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
      sourceBoundaryPoints: flattenPoints(sourcePts),
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
      topologyCertificate: standaloneCertificate(
        { points: [], triangles: [] },
        sourcePts,
        daylightPts,
        daylightFlat,
      ).certificate ?? undefined,
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
  // Phase 20K.3 Wave B: a nonempty analytic mesh without a valid gtop2
  // certificate fails closed (existing NO_SOLUTION code).
  const analytic = mesh.ok ? standaloneCertificate(mesh, sourcePts, daylightPts, daylightFlat) : null;
  if (mesh.ok && !analytic!.certificate) {
    return { ok: false, code: 'NO_SOLUTION', detail: analytic!.detail };
  }
  if (!mesh.ok) {
    return {
      ok: true,
      result: {
        gradingId,
        revision,
        accuracy,
        regions,
        daylightPoints: daylightFlat,
        sourceBoundaryPoints: flattenPoints(sourcePts),
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
        topologyCertificate: standaloneCertificate(
          { points: [], triangles: [] },
          sourcePts,
          daylightPts,
          daylightFlat,
        ).certificate ?? undefined,
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
      sourceBoundaryPoints: flattenPoints(sourcePts),
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
      ...(analytic && analytic.certificate ? { topologyCertificate: analytic.certificate } : {}),
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
  // Phase 20K.3 Wave B: a nonempty mesh without a valid gtop2 certificate
  // fails closed (existing NO_SOLUTION code); empty ALREADY_TIED is exempt.
  const certified = standaloneCertificate(mesh, sourcePts, daylightPts, daylightFlat);
  if (!certified.certificate) {
    return { ok: false, code: 'NO_SOLUTION', detail: certified.detail };
  }
  const topologyCertificate = certified.certificate;
  return {
    ok: true,
    result: {
      gradingId,
      revision,
      accuracy,
      regions,
      daylightPoints: daylightFlat,
      sourceBoundaryPoints: flattenPoints(sourcePts),
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
      topologyCertificate,
    },
  };
};
