import { alignmentElementLength, getAlignmentElements } from '../cadAlignmentElements';
import { cadAlignmentRawStationToDisplayStation } from '../cadAlignmentStationing';
import { endSegment, pointOnElement, walkArc, walkLine, type Walker } from './profileSampling';
import type { CadSurfaceGrid } from '../cadSurfaces';
import type { CadAlignmentElement, CadStationEquation } from '../cadTypes';
import type { TinAdjacency, TinEdgeKinds } from '../tin/tinTypes';

/**
 * Phase 18J surface-profile extraction (engine only, pure + deterministic).
 *
 * Raw chainage is the geometric parameter; display station is labels only
 * (via cadAlignmentRawStationToDisplayStation — NEVER inverted).
 * LINE portions are topology-exact (TIN edge-crossing events; Z linear in
 * chainage within one triangle). ARC portions are topology-aware adaptive
 * subdivisions (display-approximation only). Boundaries terminate segments;
 * voids create gaps (never bridged).
 */

/** Display-approximation tolerance for arc subdivision (drawing units). */
export const PROFILE_ARC_VERTICAL_TOLERANCE = 0.001;

const PLANE_AGREEMENT_EPS = 1e-9;
/** Raw-station dedup epsilon (relative): shared-edge double reports merge. */
const RAW_EPS_REL = 1e-9;
const MAX_ARC_DEPTH = 12;

export type ProfileSampleEventKind =
  | 'edge-crossing'
  | 'vertex'
  | 'boundary-entry'
  | 'boundary-exit'
  | 'void-entry'
  | 'void-exit'
  | 'plane-break';

export interface ProfileSample {
  rawChainage: number;
  displayStation: number | null;
  x: number;
  y: number;
  elevation: number;
  alignmentElementIndex?: number;
  surfaceTriangleIndex?: number;
  eventKind?: ProfileSampleEventKind;
}

export interface ProfileSegment {
  samples: ProfileSample[];
}

export interface CadSurfaceProfileResult {
  profileId: string;
  revision: string;
  rawStartStation: number;
  rawEndStation: number;
  segments: ProfileSegment[];
  minElevation: number | null;
  maxElevation: number | null;
  coveredLength: number;
  gapLength: number;
  diagnostics: string[];
}

export interface ProfileExtractionMesh {
  points: Array<{ x: number; y: number; z: number }>;
  triangles: Array<[number, number, number]>;
  grid: CadSurfaceGrid;
  adjacency?: TinAdjacency[];
  edgeKinds?: TinEdgeKinds[];
}

export interface ExtractSurfaceProfileInput {
  profileId: string;
  revision: string;
  alignmentElements: readonly CadAlignmentElement[];
  startStation: number;
  stationEquations?: CadStationEquation[];
  mesh: ProfileExtractionMesh;
  arcTolerance?: number;
}

export { locateProfileElevation } from './profileMeshLocate';

export const extractSurfaceProfile = (input: ExtractSurfaceProfileInput): CadSurfaceProfileResult => {
  const elements = getAlignmentElements(input.alignmentElements);
  const tolerance = input.arcTolerance ?? PROFILE_ARC_VERTICAL_TOLERANCE;
  const alignmentView = {
    elements: [...elements],
    startStation: input.startStation,
    stationEquations: input.stationEquations,
  };
  const walker: Walker = {
    mesh: input.mesh,
    displayOf: (raw: number) => cadAlignmentRawStationToDisplayStation(alignmentView, raw),
    segments: [],
    current: [],
    diagnostics: [],
  };
  const rawStart = input.startStation;
  let traversed = 0;
  elements.forEach((element, elementIndex) => {
    const length = alignmentElementLength(element);
    const raw0 = rawStart + traversed;
    if (length > 1e-12) {
      if (element.kind === 'line') {
        const ends = [pointOnElement(element, 0), pointOnElement(element, length)];
        walkLine(walker, element, elementIndex, raw0, ends);
      } else {
        walkArc(walker, element, elementIndex, raw0, tolerance);
      }
    }
    traversed += length;
  });
  endSegment(walker);
  const rawEnd = rawStart + traversed;
  let minElevation: number | null = null;
  let maxElevation: number | null = null;
  let coveredLength = 0;
  const segments: ProfileSegment[] = walker.segments.map((samples) => ({ samples }));
  for (const segment of segments) {
    if (segment.samples.length === 0) continue;
    const first = segment.samples[0]!;
    const last = segment.samples[segment.samples.length - 1]!;
    coveredLength += Math.max(0, last.rawChainage - first.rawChainage);
    for (const sample of segment.samples) {
      if (minElevation == null || sample.elevation < minElevation) minElevation = sample.elevation;
      if (maxElevation == null || sample.elevation > maxElevation) maxElevation = sample.elevation;
    }
  }
  const totalLength = Math.max(0, rawEnd - rawStart);
  return {
    profileId: input.profileId,
    revision: input.revision,
    rawStartStation: rawStart,
    rawEndStation: rawEnd,
    segments,
    minElevation,
    maxElevation,
    coveredLength,
    gapLength: Math.max(0, totalLength - coveredLength),
    diagnostics: walker.diagnostics,
  };
};
