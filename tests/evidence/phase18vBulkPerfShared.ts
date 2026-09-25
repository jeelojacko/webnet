/**
 * Phase 18V bulk-edit performance harness (EVIDENCE TIER — TEST ONLY).
 *
 * Pure helpers for the manual perf campaign: mirror the production
 * `applyCadSurfaceEdits` state assembly so the dynamic edge spatial index can
 * be measured in isolation, plus one-edit bulk stack generators
 * (`set-elevation-many` / `raise-lower-points` / `move-points`).
 */
import {
  refreshEditEdges,
  type EditMeshState,
} from '../../src/engine/cad/cadSurfaceEditMesh';
import { tinEdgeKey } from '../../src/engine/cad/tin/tinTopology';
import { TIN_EDGE_FREE } from '../../src/engine/cad/tin/tinTypes';
import type { CadSurfaceEdit } from '../../src/engine/cad/cadTypes';
import type { CadSurfaceBuildResult } from '../../src/engine/cad/cadSurfaces';

export type PerfBuild = CadSurfaceBuildResult;

/** Assemble a live EditMeshState from an ok build (mirrors applyCadSurfaceEdits seeding). */
export const assembleState = (build: PerfBuild, surfaceId: string): EditMeshState => {
  if (build.outcome !== 'ok') throw new Error('base build failed');
  const state: EditMeshState = {
    surfaceId,
    pts: build.points.map((p) => ({ id: p.entityId, x: p.x, y: p.y, z: p.z })),
    active: build.points.map(() => true),
    byId: new Map(build.points.map((p, index) => [p.entityId, index])),
    tris: new Map(build.triangles.map((t, index) => [index, [t[0], t[1], t[2]]])),
    nextTri: build.triangles.length,
    edgeMap: new Map(),
    edgeKind: new Map(),
    vertTris: new Map(),
    userLines: new Set(),
  };
  build.triangles.forEach((tri, index) => {
    const kinds = build.edgeKinds[index] ?? [TIN_EDGE_FREE, TIN_EDGE_FREE, TIN_EDGE_FREE];
    const edges = [[tri[1], tri[2]], [tri[2], tri[0]], [tri[0], tri[1]]] as const;
    edges.forEach(([u, v], k) => {
      const key = tinEdgeKey(u, v);
      const prior = state.edgeKind.get(key) ?? TIN_EDGE_FREE;
      if (kinds[k] > prior) state.edgeKind.set(key, kinds[k]);
    });
  });
  refreshEditEdges(state);
  return state;
};

const refsOf = (cells: Array<[number, number]>): Array<{ key: string }> =>
  cells.map(([row, col]) => ({ key: `source:pt:${row}-${col}` }));

export const setManyEdit = (cells: Array<[number, number]>, tag: string, z = 1): CadSurfaceEdit[] => [
  { id: tag, kind: 'set-elevation-many', vertices: refsOf(cells), z },
];

export const raisePointsEdit = (cells: Array<[number, number]>, tag: string, deltaZ = 1): CadSurfaceEdit[] => [
  { id: tag, kind: 'raise-lower-points', vertices: refsOf(cells), deltaZ },
];

export const bulkMoveEdit = (
  cells: Array<[number, number]>,
  tag: string,
  deltaX: number,
  deltaY: number,
): CadSurfaceEdit[] => [
  { id: tag, kind: 'move-points', vertices: refsOf(cells), deltaX, deltaY },
];

export const singleMoveEdit = (
  cells: Array<[number, number]>,
  tag: string,
  spacing = 10,
): CadSurfaceEdit[] =>
  cells.map(([row, col], index) => ({
    id: `${tag}${index}`,
    kind: 'move-point',
    vertex: { key: `source:pt:${row}-${col}` },
    x: col * spacing + 0.1,
    y: row * spacing + 0.05,
  }));
