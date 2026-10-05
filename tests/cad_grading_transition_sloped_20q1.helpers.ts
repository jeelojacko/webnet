/** Phase 20Q.1 Wave A shared test stub (no production tiling; frames are only read post-admission). */
import type { MemberSolve } from '../src/engine/cad/grading/gradingGroupTransitionTile';

export const stubSlopedFrame = (len: number, z: number, d: number): MemberSolve => ({
  chords: [],
  stitched: {
    regions: [], diagnostics: [], nodeStations: [0, len],
    sourcePts: [{ x: 0, y: 0, z }, { x: len, y: 0, z }],
    daylightPts: [{ x: 0, y: d, z: z + 1 }, { x: len, y: d, z: z + 1 }],
    daylightFlat: [], distances: [d, d],
    candidateTriangleCount: 0, intersectionSegmentCount: 0, multipleSolutionCount: 0,
  },
  tIn: { nx: 1, ny: 0 }, tOut: { nx: 1, ny: 0 }, nIn: { nx: 0, ny: 1 }, nOut: { nx: 0, ny: 1 },
  gsIn: 0.5, gsOut: 0.5, nodeStations: [0, len],
});
