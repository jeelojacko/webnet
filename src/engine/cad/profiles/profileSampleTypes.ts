import type { CadSurfaceGrid } from '../cadSurfaces';
import type { TinAdjacency, TinEdgeKinds } from '../tin/tinTypes';

/**
 * STRUCT-195.10 type-only leaf for surface-profile sample contracts.
 *
 * These declarations previously lived in `profileExtraction.ts` and were
 * imported (type-only) by `profileSampling.ts`, which formed a TYPE-only
 * import cycle. They are extracted here so both modules can depend on a
 * leaf with no cycle back into the profile extraction/sampling pair.
 *
 * No runtime code, no exported values: types only.
 */

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

export interface ProfileExtractionMesh {
  points: Array<{ x: number; y: number; z: number }>;
  triangles: Array<[number, number, number]>;
  grid: CadSurfaceGrid;
  adjacency?: TinAdjacency[];
  edgeKinds?: TinEdgeKinds[];
}
