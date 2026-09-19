// Phase 18N follow-on — annotation arrowhead block seed contract.
//
// AXIS CONVENTION (pinned by src/engine/cad/annotation/__tests__/cadAnnotationArrowheads.test.ts):
//   Every arrowhead is authored in block-local units with the TIP AT THE
//   ORIGIN (0, 0) and the BODY EXTENDING BACKWARD along -X. The shape
//   therefore "points" along local +X. Block references rotate by
//   `rotationDeg` in the geometry convention (degrees CCW from +X, y-up), so
//   mapping an arrow direction onto local +X is exactly a rotation by that
//   direction's bearing: direction east (0 deg) -> rotationDeg 0, north
//   (90 deg) -> 90, and so on. There is deliberately NO 180-degree flip;
//   the tip must land at the destination end of the dimension line.
//
// SCALE CONVENTION: 1 block-local unit == 1 arrow-size factor. Callers scale
// via a block reference with scaleX = scaleY = size.
//
// SEED POLICY: text-free, and only line/polygon children, so the block
// renderer/export paths need no new primitive support. Arrowhead seeds are a
// contract/geometry slice only; they are not seeded into projects here.

import type { CadBlockChild, CadBlockDefinition } from '../cadTypes';

export const ARROWHEAD_SEED_PREFIX = 'webnet-annotation-arrowhead-';

const ARROWHEAD_LAYER = '0';

const line = (
  id: string,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): CadBlockChild => ({
  id,
  type: 'line',
  layerId: ARROWHEAD_LAYER,
  visible: true,
  locked: false,
  fromStationId: '',
  toStationId: '',
  fromX,
  fromY,
  toX,
  toY,
  sourceObservationIds: [],
});

const polygon = (
  id: string,
  points: ReadonlyArray<readonly [number, number]>,
): CadBlockChild => ({
  id,
  type: 'polygon',
  layerId: ARROWHEAD_LAYER,
  visible: true,
  locked: false,
  vertices: points.map(([x, y]) => ({ x, y })),
  vertexLabels: points.map(() => ''),
});

/** The 4-base arrowhead set. Geometry is tip-at-origin / body-to--X. */
export const ANNOTATION_ARROWHEAD_SEEDS: CadBlockDefinition[] = [
  {
    id: `${ARROWHEAD_SEED_PREFIX}closed-arrow`,
    name: 'Closed Arrow',
    basePoint: { x: 0, y: 0 },
    description: 'Filled triangular arrowhead: tip (0,0), base at x = -1.',
    entities: [polygon('closed-arrow-body', [[0, 0], [-1, 0.25], [-1, -0.25]])],
  },
  {
    id: `${ARROWHEAD_SEED_PREFIX}open-arrow`,
    name: 'Open Arrow',
    basePoint: { x: 0, y: 0 },
    description: 'Open arrowhead: two barbs from the tip (0,0) to x = -1.',
    entities: [
      line('open-arrow-barb-up', 0, 0, -1, 0.25),
      line('open-arrow-barb-down', 0, 0, -1, -0.25),
    ],
  },
  {
    id: `${ARROWHEAD_SEED_PREFIX}dot`,
    name: 'Dot',
    basePoint: { x: 0, y: 0 },
    description: 'Filled octagonal dot, radius 0.25, tangent to the tip at (0,0).',
    entities: [
      polygon('dot-body', [
        [0, 0],
        [-0.073223, 0.176777],
        [-0.25, 0.25],
        [-0.426777, 0.176777],
        [-0.5, 0],
        [-0.426777, -0.176777],
        [-0.25, -0.25],
        [-0.073223, -0.176777],
      ]),
    ],
  },
  {
    id: `${ARROWHEAD_SEED_PREFIX}architectural-tick`,
    name: 'Architectural Tick',
    basePoint: { x: 0, y: 0 },
    description: 'Single 45-degree slash; one endpoint is the tip at (0,0).',
    entities: [line('architectural-tick-slash', 0, 0, -0.5, 0.5)],
  },
];

export type ArrowheadDirectionId = 'east' | 'north' | 'west' | 'south' | 'northeast';

export interface ArrowheadDirectionPin {
  id: ArrowheadDirectionId;
  label: string;
  /** Arrow direction in world space: degrees CCW from +X, y-up. */
  directionDeg: number;
  /** Expected block-reference rotationDeg (NOT flipped by 180). */
  expectedRotationDeg: number;
}

/** Pin vectors guarding the no-180-reversal axis convention. */
export const ARROWHEAD_DIRECTIONS: ArrowheadDirectionPin[] = [
  { id: 'east', label: 'East', directionDeg: 0, expectedRotationDeg: 0 },
  { id: 'north', label: 'North', directionDeg: 90, expectedRotationDeg: 90 },
  { id: 'west', label: 'West', directionDeg: 180, expectedRotationDeg: 180 },
  { id: 'south', label: 'South', directionDeg: 270, expectedRotationDeg: 270 },
  { id: 'northeast', label: 'Northeast', directionDeg: 45, expectedRotationDeg: 45 },
];

/** Maps an arrow direction (deg CCW from +X, y-up) to block rotationDeg, normalized to [0, 360). */
export const arrowheadRotationDeg = (directionDeg: number): number => {
  if (!Number.isFinite(directionDeg)) {
    throw new RangeError(`arrowhead direction must be finite, got ${directionDeg}`);
  }
  return ((directionDeg % 360) + 360) % 360;
};

export interface ArrowheadPlacement {
  x: number;
  y: number;
  /** Arrow direction in world space: degrees CCW from +X, y-up (east = 0). */
  directionDeg: number;
  /** Arrow-size factor: world size of one block-local unit. */
  size: number;
}

/** Block-reference placement fields (no id) for an arrowhead block. */
export interface ArrowheadTransform {
  x: number;
  y: number;
  rotationDeg: number;
  scaleX: number;
  scaleY: number;
}

/**
 * Converts an arrowhead placement into block-reference fields. Local +X is
 * the arrow direction, so rotationDeg is the direction bearing directly.
 */
export const arrowheadTransform = (placement: ArrowheadPlacement): ArrowheadTransform => {
  if (!Number.isFinite(placement.size) || placement.size <= 0) {
    throw new RangeError(`arrowhead size must be finite and > 0, got ${placement.size}`);
  }
  return {
    x: placement.x,
    y: placement.y,
    rotationDeg: arrowheadRotationDeg(placement.directionDeg),
    scaleX: placement.size,
    scaleY: placement.size,
  };
};
